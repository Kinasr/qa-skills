// @ts-check
// `scan`'s history-aware facts. Every comparison reads `.qa/` at an earlier commit from git
// (`git-tree.mjs`), strips Bookkeeping, serialises canonically and diffs in-process
// (`stripped.mjs`). The target is the working tree, or the commit `--target` names.
//
// The facts go in the scan's `history` section, not in `results`: they are what `/qa-impact` is
// built on, not findings. The pass reports two things through `results`: a conflicted `watermark:`
// line as an Integrity error, and a scan finding (Outcome gap, Divergence) under a Dismissal that
// still holds, which it suppresses and lists under that Dismissal instead.
//
//   history.target        {ref, commit}; both null for the working tree
//   history.persist       the stripped-dirty check `--persist` needs: `.qa/` against HEAD
//   history.features[]    per Feature: candidate class, Watermark, stripped diff, the Rules and
//                         cases whose stripped entry changed in the window, its Affected Rules,
//                         open findings, and the oldest `mirror.at`
//   history.stales[]      per open Stale of a judged Feature (stored by a judge before ADR-0043, or by the Scan since),
//                         with where its pin stands
//   history.stale_obligations[]  per case and cause: the Stale the Scan owes a case that covers or
//                         relies on an Affected Rule, and whether the case already stores it. The
//                         Scan never writes it: `impact persist` does
//   history.reviews[]     per review stamp: fresh or void
//   history.dismissals[]  per dismissed finding: holds or re-armed, and why
//   history.undigested[]  per commit pin that resolves but records no digest (ADR-0033): the next
//                         CLI write to its file adds one; until then a squash merge orphans it
//
// The `feature_level` section is published only when the scan is asked for it: the Rules a
// Feature's Feature-level judge unit judges against its Boundaries (ADR-0039). `/qa-impact`'s plan
// asks for it; the `scan` command never does, so its printed output never changes.
//
// A pin whose commit is gone falls back on its digest (ADR-0033, lib/pin-digest.mjs): a Review or
// Dismissal compares it with the target's content, and a Watermark or `at_commit` re-anchors to
// the oldest commit on the target's first-parent history whose Feature knowledge matches it.
/** @import { Repository } from "./git-tree.mjs" */
/** @import { ParsedEntry, ParsedFile, ProjectConfig } from "./knowledge-file.mjs" */
/** @import { KeyIndex } from "./qa-index.mjs" */
/** @import { CommitPin, PinDigests } from "./pin-digest.mjs" */
/** @import { CaseScanResult } from "./scan-cases.mjs" */
/** @import { CodeScanResult } from "./scan-code.mjs" */
/** @import { ScanFinding } from "./scan-integrity.mjs" */
/** @import { StrippableFile } from "./stripped.mjs" */
/** @import { ScanContext, ScanResult } from "./scan.mjs" */
import { isMap } from "./dialect.mjs";
import { firstParentTouching, loadQaAt, repositoryOf, resolveRef } from "./git-tree.mjs";
import { resolveCommits } from "./git.mjs";
import { hasMintedPrefix, isTrackerKey, PATTERN, provisionalKeys, readTrackerReference, trackerReference } from "./keys.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { parse } from "./knowledge-file.mjs";
import { digests, featureDismissalHolds, isMigratedPin, pinsOf, writtenDigest } from "./pin-digest.mjs";
import { dependencyIndex, formatRuleRef, parseRuleRef, resolveRuleRef, ruleRefsIn } from "./rule-ref.mjs";
import { affectedRules } from "./affected-rules.mjs";
import { changedRuleKeys } from "./rule-diff.mjs";
import { relianceOf } from "./reliance.mjs";
import { causeRefs, isOpenFinding, restsOn } from "./stored-findings.mjs";
import { staleObligations } from "./stale-obligations.mjs";
import { impactProjection, claimProjection, unifiedDiff } from "./stripped.mjs";
import { isExecutionFile } from "./schema.mjs";
/** @import { DependencyIndex } from "./rule-ref.mjs" */
/** @import { AffectedRulesFacts } from "./affected-rules.mjs" */
/** @import { StaleObligation } from "./stale-obligations.mjs" */

/**
 * A `.qa/` file the history facts read: a parsed file (lib/knowledge-file.mjs), the unreadable
 * ones set aside where each fact is gathered.
 * @typedef {import("./knowledge-file.mjs").ParsedFile} HistoryFile
 */

/**
 * The classes a Feature can take, in the order the run applies them. `first_judgement` and
 * `candidate` are judged; `walk_only` is walked without judging.
 * @typedef {"first_judgement" | "candidate" | "walk_only" | "no_scenarios" | "all_empty" | "unresolvable_watermark" | "unchanged"} FeatureClass
 */

/**
 * A dismissal: the commit it pins and the digest of the content it rests on.
 * @typedef {{
 *   commit?: unknown,
 *   digest?: unknown,
 *   [key: string]: unknown,
 * }} DismissalRecord
 */

/**
 * A finding the knowledge layer holds, as the history facts read it: its kind, its subject, the
 * commit it was found at and the dismissal that settles it.
 * @typedef {{
 *   kind?: unknown,
 *   subject_key?: unknown,
 *   subject_kind?: unknown,
 *   evidence?: unknown,
 *   at_commit?: unknown,
 *   at_digest?: unknown,
 *   rests_on?: string,
 *   dismissed_case?: string,
 *   dismissed: DismissalRecord,
 *   [key: string]: unknown,
 * }} FindingRecord
 */

/**
 * The oldest `mirror.at` across a Feature file, its scenarios and their cases.
 * @typedef {{
 *   at: string,
 *   file: string,
 *   line: number,
 *   key: unknown,
 * }} OldestMirror
 */

/**
 * One Upstream Rule that changed under a Feature's Watermark, and the dependent Rules that lead
 * to it.
 * @typedef {{
 *   ref: string,
 *   via: string[],
 * }} UpstreamChange
 */

/**
 * One Feature's history: its class, its Watermark, what changed since it, and the open findings it
 * holds.
 * @typedef {{
 *   feature: string,
 *   file: string,
 *   class: FeatureClass,
 *   watermark: string | null,
 *   diff: string | null,
 *   rules_changed: string[],
 *   cases_changed: string[],
 *   upstream_changed: UpstreamChange[],
 *   affected_rules: AffectedRulesFacts,
 *   open_findings: number,
 *   oldest_mirror: OldestMirror | null,
 *   reason?: string,
 *   reanchored_from?: string | null,
 * }} FeatureSummary
 */

/**
 * A Feature-level judge unit's candidates (ADR-0039): the Rules it judges against the Feature's
 * Boundaries, and the Boundaries it judges them against.
 * @typedef {{
 *   feature: string,
 *   file: string,
 *   rules: string[],
 *   boundaries: string[],
 * }} FeatureLevelFacts
 */

/**
 * One open Stale of a judged Feature (a judge stored them before ADR-0043, the Scan does now), and whether
 * the commit it was found at still resolves. It stays readable and settleable as it is.
 * @typedef {{
 *   feature: string,
 *   file: string,
 *   line: number,
 *   key: string,
 *   at_commit: string | null,
 *   at_commit_resolves: boolean,
 *   reanchored_to?: string,
 * }} StaleFact
 */

/**
 * One review stamp, and whether it still holds.
 * @typedef {{
 *   feature: string | null,
 *   file: string,
 *   line: number,
 *   key: string,
 *   commit: string | null,
 *   status: "void" | "fresh",
 *   why?: string,
 * }} ReviewFact
 */

/**
 * One dismissed finding, and whether its Dismissal still holds.
 * @typedef {{
 *   feature: string | null,
 *   file: string,
 *   line: number,
 *   key: string | null,
 *   subject_kind?: string | null,
 *   finding_kind: string | null,
 *   finding_index: number,
 *   commit: string | null,
 *   status: "rearmed" | "holds",
 *   why: string[],
 *   suppressed?: { kind: string, code: string, line?: number }[],
 * }} DismissalFact
 */

/**
 * A commit pin that resolves but records no digest.
 * @typedef {{
 *   feature: string | null,
 *   file: string,
 *   line: number,
 *   key: string | null,
 *   pin: CommitPin["pin"],
 *   commit: string,
 * }} UndigestedFact
 */

/**
 * The dirty check `--persist` needs: `.qa/`'s stripped content, in the working tree, equals HEAD's.
 * @typedef {{
 *   clean: boolean,
 *   head: string | null,
 *   reason?: string,
 *   changed: { file: string, change: "added" | "deleted" | "modified" }[],
 * }} PersistCheck
 */

/**
 * The scan's `history` section: what the target is, and the facts each Feature, Stale, review,
 * dismissal and commit pin holds.
 * @typedef {{
 *   target: { ref: string | null, commit: string | null },
 *   persist: PersistCheck,
 *   features: FeatureSummary[],
 *   stales: StaleFact[],
 *   stale_obligations: StaleObligation[],
 *   reviews: ReviewFact[],
 *   dismissals: DismissalFact[],
 *   undigested: UndigestedFact[],
 * }} HistorySection
 */

/**
 * A result the scan reports, as the history facts read it: the code pass's, the case pass's or the
 * integrity pass's (lib/scan-code.mjs, lib/scan-cases.mjs, lib/scan-integrity.mjs).
 * @typedef {CodeScanResult | CaseScanResult | ScanFinding} ScanResult
 */

/**
 * `.qa/` at one state: its Key index, impact projections and stripped files, cases and Rules.
 * Raw stripped files are kept separately for the persist dirty check, which must still see
 * Coverage and an uncommitted Key rewrite.
 * @typedef {{
 *   files: HistoryFile[],
 *   index: KeyIndex,
 *   stripped: Map<string, string>,
 *   rawStripped: Map<string, string>,
 *   cases: Map<string, string>,
 *   rules: (slug: string | null) => Map<string, string>,
 *   boundaries: (slug: string | null) => Map<string, string>,
 *   scenarios: (slug: string) => HistoryFile[],
 *   rels: (slug: string) => string[],
 *   scenarioKey: (f: HistoryFile) => string,
 * }} Snapshot
 */

/**
 * The facts every history check reads: the target state, `.qa/` at any commit, and the pins.
 * @typedef {{
 *   ctx: ScanContext,
 *   repo: Repository | null,
 *   now: Snapshot,
 *   snapshotAt: (commit: string) => Snapshot,
 *   resolvePin: (v: unknown) => string | null,
 *   digestsAt: (commit: string | null) => PinDigests,
 *   reanchor: (slug: string, digest: string | null) => string | null,
 *   inScope: (slug: string | null) => boolean,
 *   caseFindings: (c: ParsedEntry) => FindingRecord[],
 *   featureFindings: (f: HistoryFile) => FindingRecord[],
 *   caseKey: (key: string | undefined) => string,
 *   deps: DependencyIndex,
 * }} History
 */

// The one result kind it emits, a conflicted `watermark:` line, is an Integrity error.
/** @type {readonly ["integrity_error"]} */
export const kinds = ["integrity_error"];

// The classes a Feature can take, in the order the run applies them. `first_judgement` and
// `candidate` are judged; `walk_only` is walked without judging.
/** @type {readonly string[]} */
const JUDGED = ["first_judgement", "candidate"];

/**
 * @param {string} classification
 * @returns {boolean}
 */
export const needsJudgement = (classification) => JUDGED.includes(classification);

/**
 * Whether a Feature's history makes an impact check due: its knowledge needs judgement, or an Upstream
 * Rule changed. The one predicate `/qa-next` and the Knowledge page share.
 * @param {Pick<FeatureSummary, "class" | "upstream_changed">} history
 * @returns {boolean}
 */
export const impactCheckDue = (history) => needsJudgement(history.class) || history.upstream_changed.length > 0;

// Which scan result kind a stored finding kind suppresses while its Dismissal holds.
/** @type {Record<string, "outcome_gap" | "divergence" | undefined>} */
const SCAN_KIND = { OutcomeGap: "outcome_gap", Divergence: "divergence" };

/**
 * @param {Record<string, unknown> | undefined} data
 * @returns {FindingRecord[]}
 */
const findingsOf = (data) => (Array.isArray(data?.finding) ? /** @type {FindingRecord[]} */ (data.finding).filter(isMap) : []);
// A pin or other scalar as written, for output: null when absent.
/**
 * @param {unknown} v
 * @returns {string | null}
 */
const written = (v) => (v === undefined || v === null ? null : String(v));
// The line a case's YAML key sits on, else its block, else its heading.
/**
 * @param {ParsedEntry} c
 * @param {string} key
 * @returns {number}
 */
const lineOf = (c, key) => c.keyLines[key] ?? c.blockLine ?? c.line;

/**
 * @param {ScanContext} ctx
 * @returns {void}
 */
export function run(ctx) {
  const repo = repositoryOf(ctx.root);
  const identity = identities(/** @type {HistoryFile[]} */ ([...ctx.files, ...(ctx.bookkeeping ?? [])]), ctx.config);
  /**
   * @param {string | undefined} key
   * @returns {string}
   */
  const caseKey = (key) => /** @type {string} */ (identity("case", "key", key));
  const now = snapshot(/** @type {HistoryFile[]} */ (ctx.files), identity);
  // The reverse Dependency index, built once for the whole run: every Feature's candidate
  // class reads it, and it never resolves anything in another Feature.
  const deps = dependencyIndex(now.index, now.files);
  /** @type {Map<string, Snapshot>} */
  const cache = new Map();

  // Whose findings the facts read: each case's and Feature's own at the target, or, when the
  // caller passes `bookkeeping` (parsed files: the settle's working tree (`impact persist`), whose
  // Bookkeeping may run ahead of the target it judged), those files' findings, matched by Key.
  const book = ctx.bookkeeping ? bookkeepingByKey(/** @type {HistoryFile[]} */ (ctx.bookkeeping), caseKey) : null;
  /**
   * @param {ParsedEntry} c
   * @returns {FindingRecord[]}
   */
  const caseFindings = (c) => (book ? book.cases.get(caseKey(c.key)) ?? [] : findingsOf(c.data));
  /**
   * @param {HistoryFile} f
   * @returns {FindingRecord[]}
   */
  const featureFindings = (f) => (book ? book.features.get(/** @type {string} */ (f.data.key)) ?? [] : findingsOf(f.data));

  // Every pin the facts read, resolved in one batch: the target's, and the findings' of
  // `bookkeeping` when given.
  const pinned = [...now.files, ...(ctx.bookkeeping ?? [])].flatMap((f) => pinsOf(f).map((p) => p.commit));
  const { resolved } = resolveCommits(ctx.root, pinned);
  /** @type {Map<string, PinDigests>} */
  const digestCache = new Map();
  /** @type {Map<string, string | null>} */
  const anchors = new Map();
  /** @type {string | null | undefined} */
  let tip;

  // What every fact reads: the target state, `.qa/` at any commit, and pins.
  /** @type {History} */
  const h = {
    ctx,
    repo,
    now,
    // `.qa/` at a full commit id, parsed and stripped once per commit.
    snapshotAt(commit) {
      if (!cache.has(commit)) cache.set(commit, snapshot(/** @type {HistoryFile[]} */ (loadQaAt(repo, commit)), identity));
      return /** @type {Snapshot} */ (cache.get(commit));
    },
    // The full commit id a pin names, or null when it is absent or resolves to nothing.
    resolvePin: (v) => (written(v) === null ? null : resolved.get(/** @type {string} */ (written(v))) ?? null),
    // The target's digests, or a commit's (lib/pin-digest.mjs).
    digestsAt(commit) {
      const key = commit ?? "";
      if (!digestCache.has(key)) digestCache.set(key, digests(commit ? loadQaAt(repo, commit) : now.files));
      return /** @type {PinDigests} */ (digestCache.get(key));
    },
    // The oldest commit on the target's first-parent history, among those touching `slug`'s files,
    // whose Feature knowledge has `digest`; null when none has, or there is no history. A digest
    // written before Upstream Rules joined it still matches on local knowledge alone.
    reanchor(slug, digest) {
      const key = `${slug}\0${digest}`;
      if (anchors.has(key)) return /** @type {string | null} */ (anchors.get(key));
      tip ??= ctx.target?.commit ?? (repo && resolveRef(repo.top, "HEAD"));
      let found = null;
      if (repo && tip && digest !== null) {
        const paths = now.rels(slug).map((rel) => `${repo.prefix}${rel}`);
        /** @param {string} c @returns {boolean} */
        const matches = (c) => {
          const d = h.digestsAt(c);
          return d.feature(slug) === digest || d.featureLocal(slug) === digest;
        };
        found = firstParentTouching(repo.top, tip, paths).find(matches) ?? null;
      }
      anchors.set(key, found);
      return found;
    },
    inScope: (slug) => !ctx.feature || slug === ctx.feature,
    caseFindings,
    featureFindings,
    caseKey,
    deps,
  };

  /** @type {FeatureSummary[]} */
  const features = [];
  /** @type {StaleFact[]} */
  const stales = [];
  /** @type {StaleObligation[]} */
  const obligations = [];
  /** @type {FeatureLevelFacts[]} */
  const levels = [];
  for (const [slug, decls] of now.index.features) {
    if (!h.inScope(slug)) continue;
    const f = feature(h, slug, decls[0].file);
    features.push(f.summary);
    if (needsJudgement(f.summary.class)) stales.push(...staleFacts(h, f));
    obligations.push(...staleObligations({
      feature: slug,
      affected: f.summary.affected_rules,
      cases: f.cases,
      target: ctx.target?.commit ?? (repo && resolveRef(repo.top, "HEAD")) ?? null,
      ruleText: (feature, rule) => now.rules(feature).get(rule),
      findingsOf: (entry) => h.caseFindings(entry),
      lineOf: (entry) => lineOf(entry, "finding"),
    }));
    if (ctx.featureLevel) {
      const level = featureLevel(h, slug, decls[0].file);
      if (level) levels.push(level);
    }
  }

  ctx.section("history", {
    target: { ref: ctx.target?.ref ?? null, commit: ctx.target?.commit ?? null },
    persist: persistCheck(h),
    features,
    stales,
    stale_obligations: obligations,
    reviews: reviews(h),
    dismissals: dismissals(h),
    undigested: undigested(h),
  });
  if (ctx.featureLevel) ctx.section("feature_level", { features: levels });
}

// The Feature-level judge unit's candidates (ADR-0039): the Rules it judges against the Feature's
// Boundaries. Every Rule changed since the Watermark is a candidate, and every Rule is one when a
// Boundary changed (or when the Feature has no Watermark yet), so a new Boundary drawn around an
// unchanged Rule is caught. A Feature with no Boundary has no unit, and one whose Watermark does
// not resolve is skipped, as its class says.
/**
 * @param {History} h
 * @param {string} slug
 * @param {HistoryFile} file
 * @returns {FeatureLevelFacts | null}
 */
function featureLevel(h, slug, file) {
  const boundaries = file.boundaries.map((b) => b.key);
  const rules = [...h.now.rules(slug).keys()];
  if (boundaries.length === 0) return null;
  const base = watermarkBase(h, slug, file);
  if (base === undefined) return null;
  if (base === null) return { feature: slug, file: file.rel, rules, boundaries };
  const then = h.snapshotAt(base);
  // A Boundary that moved (or came or went) sends every Rule back to the judge.
  if (changedRuleKeys(then.boundaries(slug), h.now.boundaries(slug)).length) return { feature: slug, file: file.rel, rules, boundaries };
  const changedRules = changedRuleKeys(then.rules(slug), h.now.rules(slug));
  return { feature: slug, file: file.rel, rules: rules.filter((key) => changedRules.includes(key)), boundaries };
}

// The commit a Feature's knowledge is compared at: its Watermark's, resolved, or the commit it
// re-anchors to (ADR-0033). `null` when the Feature has no Watermark yet, so every Rule is a
// candidate; `undefined` when its Watermark does not resolve, so the Feature is skipped.
/**
 * @param {History} h
 * @param {string} slug
 * @param {HistoryFile} file
 * @returns {string | null | undefined}
 */
function watermarkBase(h, slug, file) {
  const raw = file.data.watermark;
  if (raw === undefined || raw === null) return null;
  const W = h.resolvePin(raw);
  if (W) return W;
  const digest = writtenDigest(file.data.watermark_digest);
  if (digest === null) return undefined;
  return h.reanchor(slug, digest) ?? null;
}

// The pins of in-scope files that resolve but record no digest.
/**
 * @param {History} h
 * @returns {UndigestedFact[]}
 */
function undigested(h) {
  /** @type {UndigestedFact[]} */
  const out = [];
  for (const f of h.now.files) {
    if (f.unreadable) continue;
    const feature = h.now.index.featureOf(f);
    if (!h.inScope(feature)) continue;
    for (const p of pinsOf(f)) {
      if (p.digest !== null || h.resolvePin(p.commit) === null) continue;
      out.push({ feature, file: p.file, line: p.line, key: written(p.key), pin: p.pin, commit: p.commit });
    }
  }
  return out;
}

// Every finding in `files`, by the Key of the case or Feature holding it (its first declaration).
/**
 * @param {HistoryFile[]} files
 * @param {(key: string | undefined) => string} caseKey
 * @returns {{ cases: Map<string, FindingRecord[]>, features: Map<string, FindingRecord[]> }}
 */
function bookkeepingByKey(files, caseKey) {
  /** @type {Map<string, FindingRecord[]>} */
  const cases = new Map();
  /** @type {Map<string, FindingRecord[]>} */
  const features = new Map();
  for (const f of files) {
    if (f.unreadable) continue;
    if (f.type === "feature" && typeof f.data.key === "string" && !features.has(f.data.key)) features.set(f.data.key, findingsOf(f.data));
    if (f.type === "scenario") for (const c of f.cases) {
      const key = caseKey(c.key);
      if (!cases.has(key)) cases.set(key, findingsOf(c.data));
    }
  }
  return { cases, features };
}

// History resolves Case and Scenario identities through their typed `formerly:` records.
// Tombstone spelling conversions are equivalent too; every other field stays literal.
/**
 * @param {HistoryFile[]} files
 * @param {ProjectConfig} config
 * @returns {(scope: string, field: string, value: unknown) => unknown}
 */
function identities(files, config) {
  /** @type {{ case: Map<unknown, unknown>, scenario: Map<unknown, unknown>, [scope: string]: Map<unknown, unknown> }} */
  const aliases = { case: new Map(), scenario: new Map() };
  /**
   * @param {string} scope
   * @param {unknown} key
   * @param {Record<string, unknown>} data
   * @returns {void}
   */
  const add = (scope, key, data) => {
    for (const old of Array.isArray(data.formerly) ? data.formerly : []) {
      if (typeof old === "string") aliases[scope].set(old, key);
    }
  };
  for (const f of files) {
    if (f.unreadable || f.type !== "scenario") continue;
    add("scenario", f.data.key, f.data);
    for (const c of f.cases) add("case", c.key, c.data);
  }
  return (scope, field, v) => {
    if (field === "key") return aliases[scope]?.get(v) ?? v;
    if (scope === "feature" && field === "retired" && Array.isArray(v)) {
      return (/** @type {unknown[]} */ (v)).flatMap((key) => {
        if (typeof key !== "string") return [key];
        if (PATTERN.provisional.test(key)) return provisionalKeys(key);
        if (!hasMintedPrefix(key, ["tc", "ts", "rule"]) &&
            readTrackerReference(key) === null && isTrackerKey(key, config.trackerPattern)) return [trackerReference(key)];
        return [key];
      }).sort();
    }
    return v;
  };
}

// `.qa/` at one state: its Key index and stripped files, cases and Rules. Raw stripped files are
// kept separately for the persist dirty check, which must still see an uncommitted Key rewrite.
/**
 * @param {HistoryFile[]} files
 * @param {(scope: string, field: string, value: unknown) => unknown} [identity]
 * @returns {Snapshot}
 */
function snapshot(files, identity = (_scope, _field, v) => v) {
  files = files.filter((f) => !isExecutionFile(f));
  const index = buildIndex(files);
  /** @type {Map<string, string>} */
  const stripped = new Map();
  /** @type {Map<string, string>} */
  const rawStripped = new Map();
  /** @type {Map<string, string>} */
  const cases = new Map();
  /** @type {Map<string, Map<string, string>>} */
  const rules = new Map();
  /** @type {Map<string, Map<string, string>>} */
  const boundaries = new Map();
  for (const f of files) {
    if (f.unreadable) continue;
    rawStripped.set(f.rel, claimProjection(/** @type {StrippableFile} */ (f)).text);
    const s = claimProjection(/** @type {StrippableFile} */ (f), { identity });
    stripped.set(f.rel, f.type === "feature" ? impactProjection(/** @type {StrippableFile} */ (f), { identity }).text : s.text);
    if (f.type === "scenario") for (const [k, t] of s.cases) {
      const key = /** @type {string} */ (identity("case", "key", k));
      if (!cases.has(key)) cases.set(key, t);
    }
    if (f.type === "feature" && typeof f.data.key === "string") {
      if (!rules.has(f.data.key)) rules.set(f.data.key, s.rules);
      if (!boundaries.has(f.data.key)) boundaries.set(f.data.key, s.boundaries);
    }
  }
  /**
   * @param {HistoryFile} f
   * @param {string} slug
   * @returns {boolean}
   */
  const belongs = (f, slug) => !f.unreadable && ((f.type === "feature" && f.data.key === slug) || (f.type === "scenario" && index.featureOf(f) === slug));
  return {
    files,
    index,
    stripped,
    rawStripped,
    cases,
    rules: (slug) => rules.get(/** @type {string} */ (slug)) ?? new Map(),
    boundaries: (slug) => boundaries.get(/** @type {string} */ (slug)) ?? new Map(),
    scenarios: (slug) => files.filter((f) => !f.unreadable && f.type === "scenario" && index.featureOf(f) === slug),
    rels: (slug) => files.filter((f) => belongs(f, slug)).map((f) => f.rel),
    scenarioKey: (f) => /** @type {string} */ (identity("scenario", "key", f.data.key)),
  };
}

// One Feature's candidate class, with the impact-projection diff since its
// Watermark and what it touched. The Watermark's own resolvability is checked before the diff,
// which cannot be taken without it; the class is the earliest the order above gives.
/**
 * @param {History} h
 * @param {string} slug
 * @param {HistoryFile} file
 * @returns {{ summary: FeatureSummary, cases: { file: HistoryFile, entry: ParsedEntry }[], W: string | null }}
 */
function feature(h, slug, file) {
  const { ctx, now } = h;
  const scenarios = now.scenarios(slug);
  const cases = scenarios.flatMap((s) => s.cases.map((c) => ({ file: s, entry: c })));
  const raw = file.data.watermark;
  let W = h.resolvePin(raw);
  /** @type {FeatureSummary} */
  const summary = {
    feature: slug,
    file: file.rel,
    // The class is set below, in every branch; the summary starts without one.
    class: /** @type {FeatureClass} */ (/** @type {unknown} */ (null)),
    watermark: W ?? written(raw),
    diff: null,
    rules_changed: [],
    cases_changed: [],
    upstream_changed: [],
    affected_rules: { baseline: null, widen: [], new_rules: [], rules: [] },
    open_findings: h.featureFindings(file).filter(isOpenFinding).length + cases.reduce((n, c) => n + h.caseFindings(c.entry).filter(isOpenFinding).length, 0),
    oldest_mirror: oldestMirror(file, scenarios),
  };
  const conflict = conflictedWatermark(file.text);
  if (scenarios.length === 0) summary.class = "no_scenarios";
  else if (cases.length === 0) summary.class = "all_empty";
  else if (conflict) {
    summary.class = "unresolvable_watermark";
    summary.watermark = null;
    const fix = conflict.ours && conflict.theirs ? `\`git merge-base ${conflict.ours} ${conflict.theirs}\`` : "the merge-base of the two sides' Watermarks (`git merge-base <ours> <theirs>`)";
    ctx.emit({
      kind: "integrity_error",
      code: "conflicted_watermark",
      file: file.rel,
      line: conflict.line,
      feature: slug,
      key: slug,
      message: `\`watermark:\` is mid-merge: resolve it to ${fix}, and only to that, so neither branch's open Stale is lost, and delete \`watermark_digest:\` (the next CLI write restores it); the Feature is skipped until then`,
      ours: conflict.ours,
      theirs: conflict.theirs,
    });
  } else if (raw === undefined || raw === null) summary.class = "first_judgement";
  else if (!W && writtenDigest(file.data.watermark_digest) === null) summary.class = "unresolvable_watermark";
  else if (!W && !h.reanchor(slug, writtenDigest(file.data.watermark_digest))) {
    // Never skipped: with no commit to diff from, every case is judged.
    summary.class = "first_judgement";
    summary.reason = "watermark_reanchor_failed";
    summary.watermark = null;
  } else {
    if (!W) {
      W = h.reanchor(slug, writtenDigest(file.data.watermark_digest));
      summary.watermark = W;
      summary.reanchored_from = written(raw);
    }
    const then = h.snapshotAt(/** @type {string} */ (W));
    const diff = featureDiff(then, now, slug);
    // An Upstream Rule is compared at this Feature's Watermark and at the target, never through the
    // upstream Feature's own `rules_changed`. A Feature with no local diff is still a
    // candidate when one of them moved.
    summary.upstream_changed = upstreamChanged(then, now, slug, h.deps);
    // A Rule of another Feature that this Feature's cases rely on (no Dependency) is compared at this
    // Feature's Watermark too: it is Affected for this Feature, so the Feature is a candidate.
    summary.affected_rules = affectedRules({ then, now, feature: slug, baseline: W, target: h.deps });
    const relianceMoved = summary.affected_rules.rules.some((r) => !r.ref.startsWith(`${slug}/`));
    if (diff === "" && summary.upstream_changed.length === 0 && !relianceMoved) {
      summary.class = ctx.feature === slug && summary.open_findings > 0 ? "walk_only" : "unchanged";
    } else {
      summary.class = "candidate";
      summary.diff = diff === "" ? null : diff;
      summary.rules_changed = changedRuleKeys(then.rules(slug), now.rules(slug));
      summary.cases_changed = cases.map((c) => c.entry.key).filter((k) => then.cases.get(h.caseKey(k)) !== now.cases.get(h.caseKey(k)));
    }
  }
  // The Affected Rules are facts about every Feature that has a baseline, including an unchanged
  // one: a retired Upstream Rule may leave no local diff and no live Dependency edge, yet still
  // reach this Feature's Rules through the baseline.
  if (summary.class !== "unresolvable_watermark" && summary.affected_rules.baseline === null) {
    summary.affected_rules = affectedRules({
      then: W === null ? null : h.snapshotAt(W),
      now,
      feature: slug,
      baseline: W ?? null,
      target: h.deps,
    });
  }
  return { summary, cases, W };
}

// Scenario paths are navigation. Pair them by canonical Key before comparing their text.
/**
 * @param {Snapshot} then
 * @param {Snapshot} now
 * @param {string} slug
 * @returns {string}
 */
function featureDiff(then, now, slug) {
  const before = new Set(then.rels(slug));
  const oldScenarios = new Map(then.scenarios(slug).map((f) => /** @type {[string, string]} */ ([then.scenarioKey(f), f.rel])));
  const scenarios = new Map(now.scenarios(slug).map((f) => /** @type {[string, HistoryFile]} */ ([f.rel, f])));
  /** @type {Array<[string | null, string | null]>} */
  const pairs = [];
  for (const rel of now.rels(slug)) {
    const f = scenarios.get(rel);
    const old = f ? oldScenarios.get(now.scenarioKey(f)) : rel;
    pairs.push([rel, old && before.has(old) ? old : null]);
    before.delete(/** @type {string} */ (old));
  }
  // An unrelated replacement at the same path is still one diff. Identity matches take first
  // choice of the old files, so a reused path cannot steal a Scenario that moved elsewhere.
  for (const pair of pairs) if (pair[1] === null && before.has(/** @type {string} */ (pair[0]))) {
    pair[1] = pair[0];
    before.delete(/** @type {string} */ (pair[0]));
  }
  for (const rel of before) pairs.push([null, rel]);
  return pairs.sort(([a, oldA], [b, oldB]) => (/** @type {string} */ (a ?? oldA)).localeCompare(/** @type {string} */ (b ?? oldB))).map(([rel, old]) =>
    unifiedDiff(/** @type {string} */ (rel ?? old), old ? then.stripped.get(old) ?? null : null, rel ? now.stripped.get(rel) ?? null : null),
  ).join("");
}

// The Upstream Rules this Feature reaches whose stripped text differs between its Watermark and the
// target, each with the dependent Rules that lead to it. The walk is cycle-safe and uses the live
// Dependencies at the target; a Rule missing at either state counts as changed.
/**
 * @param {Snapshot} then
 * @param {Snapshot} now
 * @param {string} slug
 * @param {DependencyIndex} deps
 * @returns {UpstreamChange[]}
 */
function upstreamChanged(then, now, slug, deps) {
  /** @type {UpstreamChange[]} */
  const out = [];
  for (const { upstream, via } of deps.upstreamClosure(slug)) {
    if (then.rules(upstream.feature).get(upstream.rule) === now.rules(upstream.feature).get(upstream.rule)) continue;
    out.push({ ref: formatRuleRef(upstream), via: via.map(formatRuleRef) });
  }
  return out;
}

// A git conflict hunk holding a `watermark:` line: where it is, and each side's value.
/**
 * @param {string} text
 * @returns {{ line: number, ours: string | null, theirs: string | null } | null}
 */
function conflictedWatermark(text) {
  /** @type {"ours" | "base" | "theirs" | null} */
  let side = null;
  /** @type {number | null} */
  let line = null;
  /** @type {{ ours: string[], base: string[], theirs: string[] }} */
  const found = { ours: [], base: [], theirs: [] };
  text.replace(/\r\n/g, "\n").split("\n").forEach((l, i) => {
    if (/^<{7}(?: |$)/.test(l)) side = "ours";
    else if (side && /^\|{7}(?: |$)/.test(l)) side = "base";
    else if (side && /^={7}$/.test(l)) side = "theirs";
    else if (side && /^>{7}(?: |$)/.test(l)) side = null;
    else if (side) {
      const m = l.match(/^watermark:\s*(\S+)/);
      if (m) {
        line ??= i + 1;
        found[side].push(m[1]);
      }
    }
  });
  return line === null ? null : { line, ours: found.ours[0] ?? null, theirs: found.theirs[0] ?? null };
}

// The oldest `mirror.at` across the Feature file, its scenarios and their cases: how stale the
// tracker's copy may be.
/**
 * @param {HistoryFile} file
 * @param {HistoryFile[]} scenarios
 * @returns {OldestMirror | null}
 */
function oldestMirror(file, scenarios) {
  /** @type {OldestMirror | null} */
  let oldest = null;
  /**
   * @param {unknown} m
   * @param {{ file: string, line: number, key: unknown }} where
   * @returns {void}
   */
  const consider = (m, where) => {
    if (!isMap(m) || typeof m.at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(m.at)) return;
    if (!oldest || m.at < oldest.at) oldest = { at: m.at, ...where };
  };
  consider(file.data.mirror, { file: file.rel, line: file.keyLines.mirror ?? file.frontmatterLine, key: file.data.key });
  for (const s of scenarios) {
    consider(s.data.mirror, { file: s.rel, line: s.keyLines.mirror ?? s.frontmatterLine, key: s.data.key });
    for (const c of s.cases) consider(c.data.mirror, { file: s.rel, line: c.keyLines.mirror ?? c.blockLine ?? c.line, key: c.key });
  }
  return oldest;
}

// The open Stales of a judged Feature, whoever stored them (a judge before
// ADR-0043, the Scan since). Nothing clears them but the walk; the fact says where their pin stands. A pin whose
// commit is gone re-anchors by its `at_digest`.
/**
 * @param {History} h
 * @param {{ summary: FeatureSummary, cases: { file: HistoryFile, entry: ParsedEntry }[], W: string | null }} f
 * @returns {StaleFact[]}
 */
function staleFacts(h, { summary, cases }) {
  /** @type {StaleFact[]} */
  const out = [];
  for (const { file, entry } of cases) {
    for (const x of h.caseFindings(entry)) {
      if (x.kind !== "Stale" || !isOpenFinding(x)) continue;
      const pinned = h.resolvePin(x.at_commit);
      const S = pinned ?? (writtenDigest(x.at_digest) === null ? null : h.reanchor(summary.feature, writtenDigest(x.at_digest)));
      out.push({
        feature: summary.feature,
        file: file.rel,
        line: lineOf(entry, "finding"),
        key: entry.key,
        at_commit: written(x.at_commit),
        at_commit_resolves: pinned !== null,
        ...(pinned === null && S !== null && { reanchored_to: S }),
      });
    }
  }
  return out;
}

// Each scenario file of an in-scope Feature, with its Feature, for per-case facts.
/**
 * @param {{ now: Snapshot, inScope: (slug: string | null) => boolean }} args
 * @returns {Generator<{ f: HistoryFile, c: ParsedEntry, feature: string | null }, void, unknown>}
 */
function* scenarioCases({ now, inScope }) {
  for (const f of now.files) {
    if (f.unreadable || f.type !== "scenario") continue;
    const feature = now.index.featureOf(f);
    if (!inScope(feature)) continue;
    for (const c of f.cases) yield { f, c, feature };
  }
}

// Review freshness: a stamp is void when the case's claim projection at `review.commit`
// differs from the target's (compared by Key, so moving the entry does not void it), or when that
// commit does not resolve. Historical declarations and typed references resolve through
// `formerly:` before stripping; a Key rewrite changes identity, not the claim (ADR-0027). A gone
// commit's `review.digest` stands in for its entry, compared without `formerly:` (ADR-0033).
/**
 * @param {History} h
 * @returns {ReviewFact[]}
 */
function reviews(h) {
  /** @type {ReviewFact[]} */
  const out = [];
  for (const { f, c, feature } of scenarioCases(h)) {
    const r = c.data.review;
    if (!isMap(r)) continue;
    const R = h.resolvePin(r.commit);
    const digest = writtenDigest(r.digest);
    const why = isMigratedPin(r) ? (h.digestsAt(null).review(c.key) === digest ? null : "entry_changed") : R !== null ? reviewChange(h, c, R)
      : digest === null ? "commit_unresolvable"
      : h.digestsAt(null).review(c.key) === digest ? null : "entry_changed";
    out.push({
      feature,
      file: f.rel,
      line: lineOf(c, "review"),
      key: c.key,
      commit: written(r.commit),
      status: why ? "void" : "fresh",
      ...(why && { why }),
    });
  }
  return out;
}

// Why a Review of `c` is void against the target, given its pinned commit `R`, or null when it holds.
/**
 * @param {History} h
 * @param {ParsedEntry} c
 * @param {string} R
 * @returns {string | null}
 */
function reviewChange(h, c, R) {
  const then = h.snapshotAt(R);
  const key = h.caseKey(c.key);
  return then.cases.get(key) !== h.now.cases.get(key) ? "entry_changed" : null;
}

// Dismissal re-arm: a dismissed finding re-arms when its
// case's claim projection, or the stripped text of a Rule it rests on, moved since `dismissed.commit`,
// or that commit does not resolve and its `dismissed.digest` is absent or differs from the
// target's content (`content_changed`). An Outcome gap rests on the case's own text only. The Rules a
// finding rests on are those its evidence names and those its case covers. A Feature-level finding
// rests on no case or Rule text, so it re-arms only when its commit does not resolve and it has no
// digest.
// A carried Dismissal's `dismissed_case` keeps the original case of its commit pin across Merge.
//
// A holding Dismissal of a scan finding suppresses that scan result, which is listed under the
// Dismissal instead. An Outcome gap is one check, so its Dismissal matches by case. A case can
// diverge from the tracker in several ways, so a Divergence's Dismissal matches only the result
// whose message its evidence records; any other Divergence of the case is still reported.
/**
 * @param {History} h
 * @returns {DismissalFact[]}
 */
function dismissals(h) {
  const { ctx, now } = h;
  /** @type {DismissalFact[]} */
  const out = [];
  for (const [slug, decls] of now.index.features) {
    if (!h.inScope(slug)) continue;
    const file = decls[0].file;
    for (const [finding_index, x] of h.featureFindings(file).entries()) {
      if (!isMap(x.dismissed)) continue;
      const why = featureReArm(h, slug, x);
      out.push({
        feature: slug,
        file: file.rel,
        line: file.keyLines.finding ?? file.frontmatterLine,
        key: written(x.subject_key ?? x.rule),
        subject_kind: written(x.subject_kind),
        finding_kind: written(x.kind),
        finding_index,
        commit: written(x.dismissed.commit),
        status: why.length ? "rearmed" : "holds",
        why,
      });
    }
  }
  for (const { f, c, feature } of scenarioCases(h)) {
    for (const [finding_index, x] of h.caseFindings(c).entries()) {
      if (!isMap(x.dismissed)) continue;
      const D = h.resolvePin(x.dismissed.commit);
      /** @type {string[]} */
      const why = [];
      if (D === null || isMigratedPin(x.dismissed)) why.push(...goneDismissal(h, c.key, x));
      else {
        const then = h.snapshotAt(D);
        const key = h.caseKey(c.key);
        // Merge preserves the human pin. Its Dismissal still compares the original case's
        // encoding, with declaration identity canonicalised to the current survivor.
        const origin = h.caseKey(x.dismissed_case ?? c.key);
        if (caseIdentity(then.cases.get(origin), origin, key) !== now.cases.get(key)) why.push("case");
        if (x.kind !== "OutcomeGap") {
          const covers = Array.isArray(c.data.covers) ? c.data.covers.filter((k) => typeof k === "string") : [];
          // The Rules a finding rests on are those its evidence names, those its case covers, and
          // the Rules its setup relies on, and the Rule it rests on itself (`rests_on`). The Boundary
          // it rests on is compared as the Boundary's own text, not as a Rule.
          const { rule: restsOnRule, boundary: restsOnBoundary } = restsOn(x);
          const relies = relianceOf(/** @type {import("./knowledge-file.mjs").CaseEntry} */ (/** @type {unknown} */ (c)), /** @type {string} */ (feature)).refs.map((r) => r.text);
          const rules = [...new Set([...ruleRefsIn(String(x.evidence ?? "")), ...covers, ...relies, ...causeRefs(x), ...(restsOnRule !== null ? [restsOnRule] : [])])];
          for (const rule of rules) {
            const ref = parseRuleRef(rule);
            if (ref === null) {
              if (then.rules(feature).get(rule) !== now.rules(feature).get(rule)) why.push(rule);
              continue;
            }
            const before = resolveRuleRef(then.index, then.files, ref);
            const after = resolveRuleRef(now.index, now.files, ref);
            const beforeText = before.status === "live" ? then.rules(before.feature).get(before.rule) : null;
            const afterText = after.status === "live" ? now.rules(after.feature).get(after.rule) : null;
            if (beforeText !== afterText) why.push(rule);
          }
          if (restsOnBoundary !== null && then.boundaries(feature).get(restsOnBoundary) !== now.boundaries(feature).get(restsOnBoundary)) why.push(restsOnBoundary);
        }
      }
      /** @type {DismissalFact} */
      const d = {
        feature,
        file: f.rel,
        line: lineOf(c, "finding"),
        key: c.key,
        finding_kind: written(x.kind),
        finding_index,
        commit: written(x.dismissed.commit),
        status: why.length ? "rearmed" : "holds",
        why,
      };
      const kind = SCAN_KIND[/** @type {string} */ (x.kind)];
      if (d.status === "holds" && kind) {
        // Filled when `scan` settles its results, after this section is published; the section
        // holds this same object.
        d.suppressed = [];
        /**
         * @param {string | undefined} k
         * @returns {string}
         */
        const caseKey = (k) => k === x.dismissed_case ? h.caseKey(c.key) : h.caseKey(k);
        /**
         * @param {ScanResult} r
         * @returns {boolean}
         */
        const matches = (r) => r.kind === kind && r.key === c.key && r.file === f.rel && (kind !== "divergence" || sameFinding(/** @type {CodeScanResult} */ (r), x.evidence, caseKey));
        ctx.suppress((r) => {
          if (!matches(r)) return false;
          /** @type {{ kind: string, code: string, line?: number }[]} */ (d.suppressed).push({ kind: r.kind, code: r.code, line: r.line });
          return true;
        });
      }
      out.push(d);
    }
  }
  return out;
}

// Why a Dismissal whose commit is gone re-arms, by its digest: none when it matches the target's.
/**
 * @param {History} h
 * @param {string | null} key
 * @param {FindingRecord} x
 * @param {string | null} [feature] - the Feature's key, for a Feature-level finding
 * @returns {string[]}
 */
function goneDismissal(h, key, x, feature = null) {
  const digest = writtenDigest(x.dismissed.digest);
  if (digest === null) return ["commit_unresolvable"];
  return h.digestsAt(null).dismissal(key, /** @type {{ kind?: string, evidence?: unknown, rests_on?: string, rule?: string, [key: string]: unknown }} */ (x), feature) === digest ? [] : ["content_changed"];
}

// Why a Feature-level finding's Dismissal re-arms. A Rule Overreach (ADR-0039) rests on its Rule's
// and the Boundary's text: it re-arms when either moved since the Dismissal's commit. Every other
// Feature-level finding rests on no text, so its Dismissal holds while its commit resolves.
/**
 * @param {History} h
 * @param {string} slug
 * @param {FindingRecord} x
 * @returns {string[]}
 */
function featureReArm(h, slug, x) {
  if (isMigratedPin(x.dismissed)) return goneDismissal(h, null, x, slug);
  const rule = x.kind === "Overreach" && typeof x.rule === "string" ? x.rule : null;
  if (rule === null) return featureDismissalHolds(x.dismissed, h.resolvePin(x.dismissed.commit) !== null) ? [] : goneDismissal(h, null, x, slug);
  const D = h.resolvePin(x.dismissed.commit);
  if (D === null) return goneDismissal(h, null, x, slug);
  const then = h.snapshotAt(D);
  /** @type {string[]} */
  const why = [];
  if (then.rules(slug).get(rule) !== h.now.rules(slug).get(rule)) why.push(rule);
  const { boundary } = restsOn(x);
  if (boundary !== null && then.boundaries(slug).get(boundary) !== h.now.boundaries(slug).get(boundary)) why.push(boundary);
  return why;
}

// Only declaration identity changes in this comparison; claims and literal evidence stay intact.
/**
 * @param {string | undefined} text
 * @param {string} from
 * @param {string} to
 * @returns {string | undefined}
 */
function caseIdentity(text, from, to) {
  if (text === undefined || from === to) return text;
  const file = parse("merged-dismissal.md", `---\ntype: scenario\n---\n\n${text}\n`);
  return claimProjection(/** @type {StrippableFile} */ (file), { identity: (scope, field, value) =>
    scope === "case" && field === "key" && value === from ? to : value,
  }).cases.get(from);
}

// Evidence is literal. Recognise the typed case positions in generated Divergence messages;
// summaries, tracker values, Automation keys and function names stay intact.
/**
 * @param {CodeScanResult} result
 * @param {unknown} evidence
 * @param {(key: string | undefined) => string} caseKey
 * @returns {boolean}
 */
function sameFinding(result, evidence, caseKey) {
  if (result.message === evidence) return true;
  if (result.code === "tracker_key_vs_automates") {
    const name = result.function?.name;
    const template = `\`${name}\`'s tracker key names \`${result.key}\`, but \`${result.key}\` does not automate \`${result.automation}\``;
    if (result.message === template) {
      const parts = typeof evidence === "string" ? evidence.match(/^`([^`]+)`'s tracker key names `([^`]+)`, but `([^`]+)` does not automate `([^`]+)`$/) : null;
      return parts !== null && parts[1] === name && parts[4] === result.automation &&
        caseKey(parts[2]) === caseKey(result.key) && caseKey(parts[3]) === caseKey(result.key);
    }
  }
  const prefix = `\`${result.key}\``;
  const caseFirst = ["summary", "roles", "not_applicable_automatable", "canceled_but_automated", "tracker_key_vs_automates"];
  if (!caseFirst.includes(result.code) || !result.message.startsWith(prefix)) return false;
  // This code has another template beginning with a function name, which is literal text.
  if (result.code === "tracker_key_vs_automates" && !result.message.startsWith(`${prefix} automates \``)) return false;
  const old = typeof evidence === "string" ? evidence.match(/^`([^`]+)`/) : null;
  return old !== null && caseKey(old[1]) === caseKey(result.key) && /** @type {string} */ (evidence).slice(old[0].length) === result.message.slice(prefix.length);
}

// The dirty check `--persist` needs: `.qa/`'s stripped content, in the working tree,
// equals HEAD's.
/**
 * @param {{ ctx: ScanContext, repo: Repository | null, snapshotAt: (commit: string) => Snapshot }} h
 * @returns {PersistCheck}
 */
function persistCheck({ ctx, repo, snapshotAt }) {
  if (!repo) return { clean: false, head: null, reason: "not_a_repository", changed: [] };
  const head = resolveRef(repo.top, "HEAD");
  const work = ctx.target ? loadWorkingTree(ctx.root) : ctx.files;
  const mine = new Map(work.filter((f) => !isExecutionFile(f)).map((f) => /** @type {[string, string | null]} */ ([f.rel, f.unreadable ? null : claimProjection(/** @type {StrippableFile} */ (f)).text])));
  /** @type {Map<string, string>} */
  const base = head ? snapshotAt(head).rawStripped : new Map();
  /** @type {{ file: string, change: "added" | "deleted" | "modified" }[]} */
  const changed = [];
  for (const rel of [...new Set([...mine.keys(), ...base.keys()])].sort()) {
    if (!base.has(rel)) changed.push({ file: rel, change: "added" });
    else if (!mine.has(rel)) changed.push({ file: rel, change: "deleted" });
    else if (mine.get(rel) !== base.get(rel)) changed.push({ file: rel, change: "modified" });
  }
  return { clean: head !== null && changed.length === 0, head, ...(head === null && { reason: "no_commits" }), changed };
}
