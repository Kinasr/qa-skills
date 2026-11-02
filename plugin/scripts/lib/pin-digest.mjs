// @ts-check
// Commit pins' content digests (ADR-0033). A squash or rebase merge replaces a branch's
// commits, so a SHA pinned on the branch is missing from every fresh clone. Each pin also records a
// digest of the stripped content it compares, as Bookkeeping, so no change question sees it:
//
//   review.digest       the case's stripped entry less Tags and Custom fields
//   dismissed.digest    the case plus the Rules the finding rested on; a Feature-level finding
//                       rests on neither, so its digest is one constant
//   finding.at_digest   the Feature's impact projection: its Feature file without `## Coverage`,
//                       its scenario files and the Upstream Rules it reaches transitively
//   watermark_digest    the same, beside the scalar `watermark:`
//
// A digest only locates content. `scan`'s history compares a Review's or a Dismissal's with the
// target's when its commit is gone, and re-anchors a Watermark or an `at_commit` to the commit whose
// content matches. The diff and the judge still decide staleness (ADR-0002). A Watermark digest
// written before Upstream Rules joined it still re-anchors on local knowledge alone.
//
// A digest hashes plain stripped text: no `formerly:` identity is applied, so a Key rewrite changes
// it. That fails toward attention: the Review voids, or the Feature is judged afresh.
//
//   digests(files)                    one `.qa/` state's digest per pin kind
//   pinsOf(file)                      a parsed file's commit pins, each with its digest if it has one
//   backfill(root, rel, text)         `text` with a digest on each pin that resolves and lacks one
//   backfillChangeset(root, base, c)  `backfill` over a Changeset's `.qa/` writes
/**
 * @import { Changeset } from "./changeset.mjs"
 * @import { Repository } from "./git-tree.mjs"
 * @import { CaseEntry, EditChange, ParsedEntry, ParsedFile, UnreadableFile } from "./knowledge-file.mjs"
 * @import { KeyIndex } from "./qa-index.mjs"
 * @import { StrippableFile, Stripped } from "./stripped.mjs"
 */
import { LEVEL_ON_CASE_SCHEMA_VERSION } from "./schema.mjs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { isMap } from "./dialect.mjs";
import { loadQaAt, repositoryOf } from "./git-tree.mjs";
import { resolveCommits } from "./git.mjs";
import { parseRuleRef, resolveRuleRef, ruleRefsIn } from "./rule-ref.mjs";
import { edit, parse } from "./knowledge-file.mjs";
import { buildIndex } from "./qa-index.mjs";
import { dependencyIndex, formatRuleRef } from "./rule-ref.mjs";
import { relianceOf } from "./reliance.mjs";
import { causeRefs, restsOn } from "./stored-findings.mjs";
import { impactProjection, claimProjection } from "./stripped.mjs";

/**
 * One .qa/ state's content digests.
 * @typedef {{
 *   index: KeyIndex,
 *   review(key: string): string | null,
 *   dismissal(key: string | null, finding: { kind?: string, evidence?: unknown, rests_on?: string, rule?: string, [key: string]: unknown }, feature?: string | null): string | null,
 *   feature(slug: string): string | null,
 *   featureLocal(slug: string): string | null,
 * }} PinDigests
 */

/**
 * One commit pin found in a knowledge file.
 * @typedef {{
 *   pin: "watermark" | "review" | "at_commit" | "dismissed",
 *   commit: string,
 *   digest: string | null,
 *   file: string,
 *   line: number,
 *   key: string,
 *   caseKey: string | null,
 *   finding?: Record<string, unknown>,
 * }} CommitPin
 */

/**
 * @param {readonly unknown[]} parts
 * @returns {string}
 */
export const digestOf = (parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);

// A digest as written, for comparison: null when absent.
/**
 * @param {unknown} v
 * @returns {string | null}
 */
export const writtenDigest = (v) => (typeof v === "string" && v !== "" ? v : null);

// A migration carries the verified human statement by its migrated digest. The original commit,
// author and date remain provenance; only the migration writes this marker.
/**
 * @param {unknown} stamp
 * @returns {boolean}
 */
export const isMigratedPin = (stamp) => isMap(stamp) && stamp.migrated === LEVEL_ON_CASE_SCHEMA_VERSION && writtenDigest(stamp.digest) !== null;

// What a Feature-level Dismissal rests on: nothing, so every one has this digest.
/** @type {string} */
export const FEATURE_DISMISSAL = digestOf(["dismissal"]);
// Whether a Feature-level Dismissal holds: while its commit resolves, or it carries that digest.
/**
 * @param {{ digest?: unknown } | null | undefined} dismissed
 * @param {boolean} resolves
 * @returns {boolean}
 */
export const featureDismissalHolds = (dismissed, resolves) => resolves || writtenDigest(dismissed?.digest) === FEATURE_DISMISSAL;

// One `.qa/` state's digests. Each is null when the state holds nothing to digest (the case or
// Feature is absent).
/**
 * @param {readonly (ParsedFile | UnreadableFile)[]} files
 * @returns {PinDigests}
 */
export function digests(files) {
  const index = buildIndex(files);
  /** @type {Map<ParsedFile, Stripped>} */
  const stripped = new Map();
  /**
   * @param {ParsedFile} f
   * @returns {Stripped}
   */
  const s = (f) => {
    if (!stripped.has(f)) stripped.set(f, claimProjection(/** @type {StrippableFile} */ (f)));
    return /** @type {Stripped} */ (stripped.get(f));
  };
  // The Feature's impact projection is what a Watermark or Stale pin digests (ADR-0033 as
  // amended): a Coverage-only change moves neither.
  /** @type {Map<ParsedFile, Stripped>} */
  const projections = new Map();
  /**
   * @param {ParsedFile} f
   * @returns {Stripped}
   */
  const projected = (f) => {
    if (!projections.has(f)) projections.set(f, impactProjection(/** @type {StrippableFile} */ (f)));
    return /** @type {Stripped} */ (projections.get(f));
  };
  /**
   * @param {string} key
   * @returns {string | null}
   */
  const caseText = (key) => {
    const d = index.cases.get(key)?.[0];
    return d ? s(d.file).cases.get(key) ?? null : null;
  };
  /**
   * @param {string} slug
   * @param {string} key
   * @returns {string | null}
   */
  const ruleText = (slug, key) => {
    const f = index.features.get(slug)?.[0]?.file;
    return f ? s(f).rules.get(key) ?? null : null;
  };
  /**
   * @param {string} slug
   * @param {string} key
   * @returns {string | null}
   */
  const boundaryText = (slug, key) => {
    const f = index.features.get(slug)?.[0]?.file;
    return f ? s(f).boundaries.get(key) ?? null : null;
  };
  // Scenario paths are navigation, so scenario files are taken in Key order, not by path.
  /**
   * @param {string} slug
   * @returns {string | null}
   */
  const featureLocal = (slug) => {
    const own = (/** @type {ParsedFile} */ f) => !f.unreadable && ((f.type === "feature" && f.data.key === slug) || (f.type === "scenario" && index.featureOf(f) === slug));
    const mine = /** @type {ParsedFile[]} */ (files.filter(/** @type {(f: ParsedFile | UnreadableFile) => boolean} */ (own)));
    if (!mine.some((f) => f.type === "feature")) return null;
    // The Feature file first (its sort key is empty), then each scenario by Key, then by text.
    const parts = mine.map((f) => `${f.type === "feature" ? "" : String(f.data.key ?? f.rel)}\0${f.type === "feature" ? projected(f).text : s(f).text}`);
    return digestOf(["feature", ...parts.sort()]);
  };
  const deps = dependencyIndex(index, files);
  // The Feature's local knowledge plus the stripped text of every Upstream Rule it reaches
  // transitively, so a squash re-anchors only where both match. A Feature with no Upstream
  // Rule keeps `featureLocal`'s digest.
  /**
   * @param {string} slug
   * @returns {string | null}
   */
  const feature = (slug) => {
    const local = featureLocal(slug);
    if (local === null) return null;
    /** @type {Array<[string, string | null]>} */
    const upstream = deps.upstreamClosure(slug)
      .map(({ upstream: ref }) => /** @type {[string, string | null]} */ ([formatRuleRef(ref), ruleText(ref.feature, ref.rule)]))
      .sort(([a], [b]) => a.localeCompare(b));
    // A Rule of another Feature that its cases rely on, with no Dependency, joins the same way.
    const carried = new Set(upstream.map(([key]) => key));
    /** @type {Map<string, string | null>} */
    const relied = new Map();
    for (const decls of index.cases.values()) {
      for (const d of decls) {
        if ((d.feature ?? index.featureOf(d.file)) !== slug) continue;
        for (const { ref } of relianceOf(/** @type {CaseEntry} */ (d.entry), slug).refs) {
          const key = formatRuleRef(ref);
          if (ref.feature !== slug && !carried.has(key)) relied.set(key, ruleText(ref.feature, ref.rule));
        }
      }
    }
    const reliance = [...relied].sort(([a], [b]) => a.localeCompare(b));
    if (upstream.length === 0 && reliance.length === 0) return local;
    return digestOf(["feature", local, "upstream", ...upstream, ...(reliance.length ? ["reliance", ...reliance] : [])]);
  };
  return {
    index,
    review(key) {
      const t = caseText(key);
      return t === null ? null : digestOf(["case", t]);
    },
    // A finding's Dismissal on case `key`, or on the Feature when `key` is null. An Outcome gap
    // rests on its case alone; any other finding also on the Rules its evidence names, its case
    // covers and the Rule it rests on (`rests_on`), as `scan`'s re-arm reads them. A Boundary it
    // rests on is digested as the Boundary's own text. A Feature-level Rule Overreach (ADR-0039)
    // rests on its Rule's and the Boundary's text; every other Feature-level finding rests on no
    // text at all.
    dismissal(key, finding, feature = null) {
      if (key === null) {
        const rule = finding.kind === "Overreach" && typeof finding.rule === "string" ? finding.rule : null;
        if (rule === null || feature === null) return FEATURE_DISMISSAL;
        const { boundary } = restsOn(finding);
        return digestOf(["dismissal", ruleText(feature, rule), ...(boundary !== null ? [boundaryText(feature, boundary)] : [])]);
      }
      const d = index.cases.get(key)?.[0];
      if (!d) return null;
      const covers = Array.isArray((/** @type {ParsedEntry} */ (d.entry)).data.covers) ? (/** @type {ParsedEntry} */ (d.entry)).data.covers.filter((k) => typeof k === "string") : [];
      const { rule: restsOnRule, boundary: restsOnBoundary } = restsOn(finding);
      const relies = relianceOf(/** @type {CaseEntry} */ (d.entry), /** @type {string} */ (d.feature)).refs.map((r) => r.text);
      const rules = finding.kind === "OutcomeGap" ? [] : [...new Set([...ruleRefsIn(String(finding.evidence ?? "")), ...covers, ...relies, ...causeRefs(finding), ...(restsOnRule !== null ? [restsOnRule] : [])])].sort();
      const boundaries = finding.kind === "OutcomeGap" || restsOnBoundary === null ? [] : [restsOnBoundary];
      return digestOf(["dismissal", caseText(key), ...rules.map((r) => {
        const ref = parseRuleRef(r);
        if (ref === null) return [r, ruleText(/** @type {string} */ (d.feature), r)];
        const resolved = resolveRuleRef(index, files, ref);
        return [r, resolved.status === "live" ? ruleText(resolved.feature, resolved.rule) : null];
      }), ...boundaries.map((b) => [b, boundaryText(/** @type {string} */ (d.feature), b)])]);
    },
    feature,
    featureLocal,
  };
}

// Every commit pin in a parsed file, in file order:
//   {pin, commit, digest, file, line, key, caseKey, finding?}
// `pin` is `watermark`, `review`, `at_commit` or `dismissed`; `commit` the id as written; `digest`
// the stored one or null; `caseKey` the case it sits on, null for the Feature file's.
/**
 * @param {import("./knowledge-file.mjs").QaFile} file
 * @returns {CommitPin[]}
 */
export function pinsOf(file) {
  /** @type {CommitPin[]} */
  const out = [];
  if (file.unreadable || !file.frontmatter) return out;
  const id = (/** @type {unknown} */ v) => (v === undefined || v === null ? null : String(v));
  const findings = (/** @type {unknown} */ list, /** @type {{ file: string, line: number, key: string, caseKey: string | null }} */ where) => {
    for (const x of Array.isArray(list) ? list : []) {
      if (!isMap(x)) continue;
      if (id(x.at_commit)) out.push({ ...where, pin: "at_commit", commit: /** @type {string} */ (id(x.at_commit)), digest: writtenDigest(x.at_digest), finding: x });
      if (isMap(x.dismissed) && id(x.dismissed.commit)) out.push({ ...where, pin: "dismissed", commit: /** @type {string} */ (id(x.dismissed.commit)), digest: writtenDigest(x.dismissed.digest), finding: x });
    }
  };
  if (file.type === "feature") {
    const at = (/** @type {string} */ k) => ({ file: file.rel, line: file.keyLines[k] ?? file.frontmatterLine, key: /** @type {string} */ (file.data.key), caseKey: null });
    if (id(file.data.watermark)) out.push({ ...at("watermark"), pin: "watermark", commit: /** @type {string} */ (id(file.data.watermark)), digest: writtenDigest(file.data.watermark_digest) });
    findings(file.data.finding, at("finding"));
  }
  if (file.type === "scenario") for (const c of file.cases) {
    const at = (/** @type {string} */ k) => ({ file: file.rel, line: c.keyLines[k] ?? c.blockLine ?? c.line, key: c.key, caseKey: c.key });
    const r = c.data.review;
    if (isMap(r) && id(r.commit)) out.push({ ...at("review"), pin: "review", commit: /** @type {string} */ (id(r.commit)), digest: writtenDigest(r.digest) });
    findings(c.data.finding, at("finding"));
  }
  return out;
}

// The digest pin `p` of `file` takes at a state `d` (`digests` of the pin's commit), or null.
/**
 * @param {PinDigests} d
 * @param {ParsedFile} file
 * @param {CommitPin} p
 * @returns {string | null}
 */
function digestAt(d, file, p) {
  if (p.pin === "review") return d.review(/** @type {string} */ (p.caseKey));
  if (p.pin === "dismissed") return d.dismissal(p.caseKey, /** @type {Record<string, unknown>} */ (p.finding), file.type === "feature" ? /** @type {string} */ (file.data.key) : null);
  const slug = file.type === "feature" ? file.data.key : d.index.cases.get(/** @type {string} */ (p.caseKey))?.[0]?.feature ?? d.index.scenarios.get(/** @type {string} */ (file.data.key))?.[0]?.feature ?? null;
  return typeof slug === "string" ? d.feature(slug) : null;
}

// Each commit's digests, once per process: a commit's files never change.
/** @type {Map<string, PinDigests>} */
const byCommit = new Map();
/**
 * @param {Repository} repo
 * @param {string} commit
 * @returns {PinDigests}
 */
function digestsAtCommit(repo, commit) {
  const key = `${repo.top}\0${repo.prefix}\0${commit}`;
  if (!byCommit.has(key)) byCommit.set(key, digests(loadQaAt(repo, commit)));
  return /** @type {PinDigests} */ (byCommit.get(key));
}

// `text` (the file at `.qa/`-relative `rel`, about to be written under `.qa/` dir `root`) with a
// digest added to each of its pins that resolves and has none. A resolving Watermark's digest is
// also corrected: a conflicted Watermark resolved to the merge-base may keep one side's. A pin whose
// commit is gone, or whose commit holds nothing to digest, is left as it is; so is a file `edit`
// cannot read.
/**
 * @param {string} root
 * @param {string} rel
 * @param {string} text
 * @returns {string}
 */
export function backfill(root, rel, text) {
  const file = parse(rel, text);
  const missing = pinsOf(file).filter((p) => p.digest === null || p.pin === "watermark");
  if (missing.length === 0 || file.problems.length) return text;
  const repo = repositoryOf(root);
  if (!repo) return text;
  const { resolved } = resolveCommits(root, missing.map((p) => p.commit));
  /** @type {Map<CommitPin, string>} */
  const filled = new Map(); // pin → digest
  for (const p of missing) {
    const full = resolved.get(p.commit);
    const digest = full ? digestAt(digestsAtCommit(repo, full), file, p) : null;
    if (digest !== null && digest !== p.digest) filled.set(p, digest);
  }
  if (filled.size === 0) return text;

  const withFindings = (/** @type {unknown} */ list, /** @type {string | null} */ owner) => (/** @type {Array<Record<string, unknown>>} */ (list)).map((x) => {
    if (!isMap(x)) return x;
    const at = [...filled].find(([p]) => p.finding === x && p.pin === "at_commit" && p.caseKey === owner)?.[1];
    const dis = [...filled].find(([p]) => p.finding === x && p.pin === "dismissed" && p.caseKey === owner)?.[1];
    let y = x;
    if (at !== undefined) y = besidePin(y, "at_commit", "at_digest", at);
    if (dis !== undefined) y = { ...y, dismissed: besidePin(/** @type {Record<string, unknown>} */ (y.dismissed), "commit", "digest", dis) };
    return y;
  });
  const touched = (/** @type {string | null} */ owner) => [...filled.keys()].some((p) => p.caseKey === owner && (p.pin === "at_commit" || p.pin === "dismissed"));
  /** @type {EditChange[]} */
  const changes = [];
  if (file.type === "feature") {
    /** @type {Record<string, unknown>} */
    const set = {};
    const w = [...filled].find(([p]) => p.pin === "watermark")?.[1];
    if (w !== undefined) set.watermark_digest = w;
    if (touched(null)) set.finding = withFindings(file.data.finding, null);
    if (Object.keys(set).length) changes.push({ set });
  }
  if (file.type === "scenario") for (const c of file.cases) {
    /** @type {Record<string, unknown>} */
    const set = {};
    const r = [...filled].find(([p]) => p.pin === "review" && p.caseKey === c.key)?.[1];
    if (r !== undefined) set.review = besidePin(/** @type {Record<string, unknown>} */ (c.data.review), "commit", "digest", r);
    if (touched(c.key)) set.finding = withFindings(c.data.finding, c.key);
    if (Object.keys(set).length) changes.push({ at: c.key, set });
  }
  const out = edit(file, changes);
  return out.ok ? out.text : text;
}

// Map `m` with `key: value` placed right after its `pin` key.
/**
 * @param {Record<string, unknown>} m
 * @param {string} pin
 * @param {string} key
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
const besidePin = (m, pin, key, value) => Object.fromEntries(Object.entries(m).flatMap(([k, v]) => (k === pin ? [[k, v], [key, value]] : [[k, v]])));

// A Changeset (lib/changeset.mjs) whose paths are relative to `base`, with `backfill` made on each
// write of a `.md` file under the `.qa/` dir `root`.
/**
 * @param {string | undefined} root
 * @param {string} base
 * @param {Changeset} changeset
 * @returns {Changeset}
 */
export function backfillChangeset(root, base, changeset) {
  if (!root) return changeset;
  const writes = changeset.writes.map((w) => {
    const rel = relative(root, join(base, w.path)).split(sep).join("/");
    if (rel.startsWith("..") || !rel.endsWith(".md")) return w;
    return { ...w, text: backfill(root, rel, /** @type {string} */ (w.text)) };
  });
  return { ...changeset, writes };
}
