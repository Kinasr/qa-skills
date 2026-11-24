// @ts-check
// `deep-dive`: the deterministic half of `/qa-deep-dive`. The skill
// fetches, grills and writes; everything here only reads, except `reconcile`'s one `change.json`.
//
//   refs <ref>...        classify each Reference and resolve what is local (references.mjs), with
//                        `access`: per Reference URI, the Access note to reach it through or null
//                        (lib/access.mjs `accessFor`; only a tracker or url Reference to fetch has
//                        one), and `train`: `train/deep-dive.md`, as `feature` returns it, so a run
//                        without a Feature key reads its Practices before the first fetch
//   feature <key>        whether the Feature key is usable, and the Feature's state: its Rules with
//                        every case covering each, retired keys, sources, scenario files, next step,
//                        `caseIndex`: every case of the Feature once, with its summary, `covers`,
//                        effective level and the scan's Review freshness, `openQuestions`: its
//                        Parked question texts, `categories`: the effective Coverage category list,
//                        `coverage`: its `## Coverage` lines or null, `deferred_count`: the count beside
//                        Coverage, `deferred_functionality`: the items to reconcile,
//                        `proposed_rules`: the kept Proposed Rules a full inventory settles, and `train`:
//                        `train/deep-dive.md` as lib/training.mjs returns it (printed only for a
//                        usable key)
//   roles <name>...      which roles `project.roles` lacks, with the `/qa-init --add-role` command
//                        for each: deep-dive never writes project.md
//   reconcile <key> --input <path> [--dir <run-dir>]
//                        the Rule-edit transition (lib/rule-edit.mjs): the confirmed forecast against
//                        the Rules edited since HEAD, Boundary pairs, downstream Rules and the next
//                        Feature; writes only the widened Rules and the forecast of each edited
//                        statement into the run dir's `change.json`
//   amend <key> <rule>...
//                        the bounded amendment inventory: those Rules, the cases linked to them
//   check <key> --input <path>
//                        a drafted Feature file, before the skill writes it: `check-file` plus the
//                        re-run rules and the Coverage contract, then the changeset (the Feature,
//                        plus the uncommitted Observations it cites: this run's), the draft's
//                        `coverage_digest`, suggested commit and next step
/**
 * @import { CommandDefinition, OptionSpec } from "./cli.mjs"
 * @import { CaseEntry, ParsedFile, ParsedSection, ProjectConfig } from "./knowledge-file.mjs"
 * @import { CaseDecl, KeyIndex, RuleCoverageIndex } from "./qa-index.mjs"
 * @import { DependencyEnd } from "./rule-ref.mjs"
 * @import { HistorySection } from "./scan-history.mjs"
 */
import { readDesignQuestions, questionText } from "./design-questions.mjs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { accessFor } from "./access.mjs";
import { caseLevel } from "./case-fields.mjs";
import { effectiveCategories } from "./categories.mjs";
import { commitLine } from "./changeset.mjs";
import { HANDOFF_FILE, readHandoff, uncommittedKnowledge } from "./change-handoff.mjs";
import { openRunDir } from "./run-dir.mjs";
import { coverageDigest, coverageProblems, parseCoverage } from "./coverage.mjs";
import { deferredProblems, parseDeferred } from "./deferred.mjs";
import { parseProposedRules, proposedRulesProblems } from "./proposed-rules.mjs";
import { listOf } from "./dialect.mjs";
import { UsageError } from "./cli.mjs";
import { isUncommitted } from "./git.mjs";
import { readQaAt, repositoryOf, resolveRef } from "./git-tree.mjs";
import { PATTERN } from "./keys.mjs";
import { checkFile, parse, projectConfig } from "./knowledge-file.mjs";
import { buildIndex, casesCoveringRule, loadWorkingTree, rootConfig } from "./qa-index.mjs";
import { parkedQuestions } from "./parked-questions.mjs";
import { referenceShapeError, resolveReference } from "./references.mjs";
import { scan } from "./scan.mjs";
import { dependencyProblems } from "./scan-integrity.mjs";
import { refuseSuiteSchema } from "./schema-guard.mjs";
import { DEEP_DIVE_TRAIN_KEY } from "./schema.mjs";
import { trainFor } from "./training.mjs";
import { dependencyEnds, dependencyIndex } from "./rule-ref.mjs";
import { relianceOf } from "./reliance.mjs";
import { retiredLinks } from "./link-repair.mjs";
import { ruleEdit, ruleTexts } from "./rule-diff.mjs";
import { parseForecast, reconcile } from "./rule-edit.mjs";
import { buildAmendJson, buildCheckJson, buildFeatureJson, buildReconcileJson, buildRefsJson, buildResumeJson, buildRolesJson } from "./deep-dive-json.mjs";

/**
 * @typedef {ProjectConfig & {
 *   root: string,
 *   repo: string,
 *   files: readonly (ParsedFile & { unreadable?: unknown })[],
 *   index: KeyIndex,
 * }} DeepDiveContext
 */

/**
 * @typedef {{
 *   feature: string,
 *   status: "existing" | "new",
 *   suite_key: unknown,
 *   rel: string,
 *   file: string,
 *   path: string,
 *   data: Record<string, unknown>,
 *   rules: Array<{
 *     key: string,
 *     statement: string,
 *     line: number,
 *     depends_on: DependencyEnd[],
 *     dependents: DependencyEnd[],
 *     covered_by: Array<{ case: string | undefined, scenario: string | null | undefined, file: string, line: number | undefined }>,
 *     waiver?: string,
 *     waiver_line?: number | null,
 *   }>,
 *   other_rules: DependencyEnd[],
 *   boundaries?: Array<{ key: string, statement: string, owner: string | null, line: number, end: number }>,
 *   retired: string[],
 *   sources: string[],
 *   open_questions: boolean,
 *   scenario_files: string[],
 *   roles: string[],
 *   next_step: string,
 * }} FeatureState
 */

/**
 * One case of the Feature as a re-run reads it: its Key, Scenario key, place, summary, covered
 * Rules, effective Level (`case ?? scenario`) and Review freshness from the scan's facts.
 * @typedef {{
 *   key: string,
 *   scenario: string | null,
 *   file: string,
 *   line: number,
 *   summary: string,
 *   covers: string[],
 *   level: string | null,
 *   review: "fresh" | "void" | null,
 * }} FeatureCaseIndexEntry
 */

// The `.qa/` tree at `root`, its Key index and `project.md`'s configuration, read as `scan` reads
// it. The repository under test is the parent of `.qa/`.
/**
 * @param {string} [root]
 * @returns {DeepDiveContext}
 */
function load(root) {
  const files = /** @type {readonly (ParsedFile & { unreadable?: unknown })[]} */ (loadWorkingTree(root));
  const index = buildIndex(files);
  return { root: resolve(/** @type {string} */ (root)), repo: dirname(resolve(/** @type {string} */ (root))), files, index, ...projectConfig(index.project) };
}

// The command line's `deep-dive <action>` (scripts/scan.mjs): each prints `{json, exit}`. Every action
// takes the same options, which may come before it.
/** @type {OptionSpec} */
const OPTIONS = { root: "qa-dir", stdin: "flag", dir: "value", confirm: "value" };

// `--confirm a,b`: the link ids the engineer confirmed, trimmed, empty entries dropped.
/**
 * @param {unknown} value
 * @returns {string[]}
 */
const confirmList = (value) => (typeof value === "string" ? value.split(",").map((x) => x.trim()).filter(Boolean) : []);

/** @type {CommandDefinition} */
export const command = {
  options: OPTIONS,
  actions: {
    refs: {
      usage: "<ref>... [--root <qa-dir>]",
      run(args, { root }) {
        if (args.length === 0) throw new UsageError("deep-dive refs takes at least one <ref>");
        const ctx = load(root);
        const references = args.map((input) => resolveReference(input, ctx));
        const ok = references.every((r) => r.status !== "failed");
        // Only a Reference the agent fetches can sit behind a login; every other one is null.
        const reached = accessFor(ctx.index, references.filter((r) => r.status === "pending").map((r) => /** @type {string} */ (r.uri)));
        const access = Object.fromEntries(references.filter((r) => r.uri).map((r) => [r.uri, reached[/** @type {string} */ (r.uri)] ?? null]));
        return { json: buildRefsJson({ ok, references, access, train: trainFor(ctx.index, DEEP_DIVE_TRAIN_KEY) }), exit: ok ? 0 : 1 };
      },
    },

    feature: {
      usage: "<key> [--root <qa-dir>]",
      run(args, { root }) {
        if (args.length !== 1) throw new UsageError("deep-dive feature takes exactly one <key>");
        const guard = refuseSuiteSchema(/** @type {string} */ (root));
        if (guard) return guard;
        const ctx = load(root);
        const [key] = args;
        const problem = keyProblem(ctx, key);
        if (problem) return { json: { action: "feature", ok: false, feature: key, ...problem }, exit: 1 };
        const { rel, data, ...state } = featureState(ctx, key);
        // The re-run reads the cases, not only their locations: the scan's own Review facts join
        // the case index, so freshness is the one computation, never a second one here.
        const reviews = state.scenario_files.length ? reviewFreshness(scan(ctx.root, { feature: key })) : new Map();
        const feature = ctx.index.features.get(key)?.[0]?.file ?? null;
        const deferred = feature ? parseDeferred(feature.text) : [];
        return {
          json: buildFeatureJson({
            ...state,
            ...featureIndex(ctx, key, reviews),
            categories: effectiveCategories(ctx.root).categories,
            coverage: feature ? parseCoverage(feature.text)?.lines ?? null : null,
            deferred_count: deferred.length,
            deferred_functionality: deferred,
            proposed_rules: feature ? parseProposedRules(feature.text) : [],
            train: trainFor(ctx.index, DEEP_DIVE_TRAIN_KEY),
          }),
          exit: 0,
        };
      },
    },

    // A missing role is reported, never an error: the Feature is still written.
    roles: {
      usage: "<name>... [--root <qa-dir>]",
      run(args, { root }) {
        if (args.length === 0) throw new UsageError("deep-dive roles takes at least one <name>");
        const { roles } = load(root);
        const names = [...new Set(args)];
        const missing = names.filter((n) => !roles.has(n));
        const json = buildRolesJson({
          known: names.filter((n) => roles.has(n)),
          missing: missing.map((role) => ({ role, command: `/qa-init --add-role ${/^[A-Za-z0-9_.-]+$/.test(role) ? role : JSON.stringify(role)}` })),
        });
        return { json, exit: 0 };
      },
    },

    // The Rule-edit transition: the Rules just edited, against the forecast the engineer confirmed.
    // Writes only `change.json` in `--dir`, and only when the forecast names widened Rules or confirms
    // a Rule whose statement was edited since the Watermark.
    reconcile: {
      usage: "<key> --input <path> [--dir <run-dir>] [--root <qa-dir>]",
      run(args, { root, stdin, dir }) {
        if (args.length !== 1) throw new UsageError("deep-dive reconcile takes exactly one <key>");
        if (!stdin) throw new UsageError("deep-dive reconcile reads the confirmed forecast from --input <file> or --stdin");
        const guard = refuseSuiteSchema(/** @type {string} */ (root));
        if (guard) return guard;
        const res = reconcile(load(root), args[0], parseForecast(stdin()), dir);
        if (!res.json.ok) return res;
        return { exit: res.exit, json: buildReconcileJson(/** @type {Parameters<typeof buildReconcileJson>[0]} */ (res.json)) };
      },
    },

    // Continues a change the quick path handed off (`impact quick-check`): its References, the
    // confirmed Rule edits, the open questions and what is already written, read from the run dir's
    // `handoff.json`. Writes nothing.
    resume: {
      usage: "--dir <run-dir> [--root <qa-dir>]",
      run(args, { root, dir }) {
        if (args.length !== 0) throw new UsageError("deep-dive resume takes no arguments, only --dir <run-dir>");
        const opened = openRunDir(dir, { cmd: "deep-dive", action: "resume", from: "impact quick" });
        if (opened.error) throw new UsageError(opened.error);
        const design = readDesignQuestions(/** @type {string} */ (opened.dir));
        if (design.error) throw new UsageError(design.error);
        const held = readHandoff(/** @type {string} */ (opened.dir));
        if (held.error) throw new UsageError(held.error);
        const designData = design.data?.questions.length ? design.data : null;
        if (!held.handoff && !designData) {
          return { json: { action: "resume", ok: false, errors: [{ code: "no_handoff", dir: opened.dir }] }, exit: 1 };
        }
        // Preserve the quick path's confirmed edits when design reuses its Run.
        const prior = held.handoff ?? { references: [], edits: [], open_questions: [], written: [] };
        const references = designData === null ? prior.references : [...new Set([...prior.references, ...designData.references])];
        const { edits, written } = prior;
        const openQuestions = [...prior.open_questions, ...(designData?.questions ?? []).map(questionText)];
        const feature = designData?.feature ?? edits[0]?.feature ?? null;
        const now = new Set(uncommittedKnowledge(/** @type {string} */ (root)));
        return {
          json: buildResumeJson({
            dir: opened.dir,
            feature,
            references,
            edits,
            open_questions: openQuestions,
            design_questions: designData?.questions ?? [],
            written,
            uncommitted: written.filter((file) => now.has(file)),
            next_step: designData !== null ? `/qa-deep-dive ${feature} --dir ${opened.dir}` : ["/qa-deep-dive", ...(feature ? [feature] : []), ...references].join(" "),
          }),
          exit: 0,
        };
      },
    },

    // The bounded amendment inventory: only the Rules named, and the cases linked to them.
    amend: {
      usage: "<key> <rule>... [--root <qa-dir>]",
      run(args, { root }) {
        if (args.length < 2) throw new UsageError("deep-dive amend takes a <key> and at least one <rule>");
        const guard = refuseSuiteSchema(/** @type {string} */ (root));
        if (guard) return guard;
        const ctx = load(root);
        const [key, ...wanted] = args;
        const json = amendment(ctx, key, [...new Set(wanted)]);
        return { json, exit: json.ok ? 0 : 1 };
      },
    },

    check: {
      usage: "<key> --input <path> [--confirm <link>,...] [--root <qa-dir>]",
      run(args, { root, stdin, confirm }) {
        if (args.length !== 1) throw new UsageError("deep-dive check takes exactly one <key>");
        if (!stdin) throw new UsageError("deep-dive check reads the drafted Feature file from --input <file> or --stdin");
        const guard = refuseSuiteSchema(/** @type {string} */ (root));
        if (guard) return guard;
        const json = checkDraft(load(root), args[0], stdin(), confirmList(confirm));
        return { json, exit: json.ok ? 0 : 1 };
      },
    },
  },
};

// Why `key` cannot name the Feature of this run, or null. `invalid`: not a kebab-case Feature key.
// `retired`: in `project.md`'s `retired_features`. `succeeded`: in another Feature's `formerly`. A
// Retired key is never reused.
/**
 * @param {DeepDiveContext} ctx
 * @param {string} key
 * @returns {{ status: "invalid" | "retired" | "succeeded", current?: string, error: string } | null}
 */
function keyProblem(ctx, key) {
  if (!PATTERN.slug.test(key)) return { status: "invalid", error: `\`${key}\` is not a Feature key: a kebab-case slug (${PATTERN.slug})` };
  if (listOf(ctx.index.project?.data.retired_features).includes(key)) {
    return { status: "retired", error: `\`${key}\` is a Retired Feature key in project.md's \`retired_features\`, and is never reused` };
  }
  for (const [other, decls] of ctx.index.features) {
    if (other !== key && listOf(decls[0].file.data.formerly).includes(key)) {
      return { status: "succeeded", current: other, error: `\`${key}\` is a former key of Feature \`${other}\`; re-run on \`${other}\` instead` };
    }
  }
  return null;
}

// The Feature `key` names as it stands: `new` (no Feature file yet) or `existing` (a re-run updates
// it), its Rules with every case whose `covers` names each, and where its file is. `rel` is the
// file's path within `.qa/`; `file` is the same path as the repository under test sees it.
/**
 * @param {DeepDiveContext} ctx
 * @param {string} key
 * @returns {FeatureState}
 */
function featureState(ctx, key) {
  const { index } = ctx;
  const dependencies = dependencyIndex(index, ctx.files);
  const file = index.features.get(key)?.[0].file ?? null;
  const rel = file ? file.rel : `features/${key}/${key}.md`;
  const rules = (file?.rules ?? []).map((r) => ({
    key: r.key,
    statement: r.statement,
    line: r.line,
    depends_on: dependencyEnds(ctx.index, ctx.files, dependencies.upstreamOf(key, r.key)),
    dependents: dependencyEnds(ctx.index, ctx.files, dependencies.dependentsOf(key, r.key)),
    covered_by: casesCoveringRule(/** @type {RuleCoverageIndex} */ (index), key, r.key)
      .map((c) => ({ case: /** @type {NonNullable<CaseDecl["entry"]>} */ ((/** @type {CaseDecl} */ (c)).entry).key, scenario: (/** @type {CaseDecl} */ (c)).scenario, file: repoPath(ctx, (/** @type {ParsedFile} */ (c.file)).rel), line: (/** @type {CaseDecl} */ (c)).line })),
    ...(r.waiver === null ? {} : { waiver: r.waiver, waiver_line: r.waiverLine }),
  }));
  const scenarioFiles = ctx.files.filter((f) => !f.unreadable && f.type === "scenario" && index.featureOf(/** @type {ParsedFile} */ (f)) === key).map((f) => repoPath(ctx, f.rel));
  return {
    feature: key,
    status: file ? "existing" : "new",
    suite_key: file?.data.suite_key ?? null,
    rel,
    file: repoPath(ctx, rel),
    path: join(ctx.root, rel),
    data: file?.data ?? {},
    rules,
    other_rules: dependencyEnds(ctx.index, ctx.files, [...index.rules].flatMap(([feature, rules]) =>
      feature === key ? [] : [...rules.keys()].map((rule) => ({ feature, rule })))),
    ...(file?.boundaries.length ? { boundaries: file.boundaries.map(({ key, statement, owner, line, end }) => ({ key, statement, owner, line, end })) } : {}),
    retired: listOf(file?.data.retired),
    sources: listOf(file?.data.sources),
    open_questions: Boolean(file && /^## Open questions\s*$/m.test(file.text)),
    scenario_files: scenarioFiles,
    roles: [...ctx.roles],
    next_step: `/qa-design ${key}`,
  };
}

// The Feature-wide case index a re-run reads, deduplicated by Key (its first declaration), and its
// Parked question texts in file order. Cases are never filtered by coverage: one whose `covers`
// names no live Rule is still knowledge the re-run must reconcile.
/**
 * @param {DeepDiveContext} ctx
 * @param {string} key
 * @param {ReadonlyMap<string, "fresh" | "void">} reviews
 * @returns {{ caseIndex: FeatureCaseIndexEntry[], openQuestions: Array<{ text: string }> }}
 */
function featureIndex(ctx, key, reviews) {
  /** @type {FeatureCaseIndexEntry[]} */
  const caseIndex = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const decls of ctx.index.cases.values()) {
    const c = decls[0];
    if (c.feature !== key || seen.has(c.entry.key)) continue;
    seen.add(c.entry.key);
    const entry = /** @type {CaseEntry} */ (c.entry);
    caseIndex.push({
      key: c.entry.key,
      scenario: c.scenario,
      file: repoPath(ctx, c.file.rel),
      line: c.line,
      summary: entry.summary,
      covers: listOf(entry.data.covers),
      level: /** @type {string | null} */ (caseLevel(entry.data, c.file.data, ctx.schemaVersion) ?? null),
      review: reviews.get(c.entry.key) ?? null,
    });
  }
  const file = ctx.index.features.get(key)?.[0].file;
  return { caseIndex, openQuestions: (file ? parkedQuestions(file) : []).map((q) => ({ text: q.text })) };
}

// The Rules in play on an existing Feature and the cases linked to them: those whose `covers` names
// one, and those, of any Feature, whose Reliance does. Everything else is only counted, so an
// amendment never reads a case it does not touch.
/**
 * @param {DeepDiveContext} ctx
 * @param {string} key
 * @param {string[]} wanted
 * @returns {{ ok: boolean, [key: string]: unknown }}
 */
function amendment(ctx, key, wanted) {
  const problem = keyProblem(ctx, key);
  if (problem) return { action: "amend", ok: false, feature: key, errors: [{ code: problem.status, feature: key, ...(problem.current && { current: problem.current }) }] };
  const state = featureState(ctx, key);
  if (state.status === "new") return { action: "amend", ok: false, feature: key, errors: [{ code: "no_feature", feature: key }] };
  const have = new Set(state.rules.map((r) => r.key));
  const missing = wanted.filter((r) => !have.has(r));
  if (missing.length) return { action: "amend", ok: false, feature: key, errors: missing.map((rule) => ({ code: "unknown_rule", rule, feature: key })) };
  const rules = state.rules.filter((r) => wanted.includes(r.key));
  const reviews = state.scenario_files.length ? reviewFreshness(scan(ctx.root, { feature: key })) : new Map();
  /** @type {Array<FeatureCaseIndexEntry & { feature: string, via: string[] }>} */
  const cases = [];
  /** @type {Set<string>} */
  const seen = new Set();
  let total = 0;
  for (const decls of ctx.index.cases.values()) {
    const decl = decls[0];
    if (seen.has(decl.entry.key)) continue;
    seen.add(decl.entry.key);
    const entry = /** @type {CaseEntry} */ (decl.entry);
    const feature = /** @type {string} */ (decl.feature);
    if (feature === key) total++;
    const covers = listOf(entry.data.covers);
    /** @type {string[]} */
    const via = [];
    if (feature === key && covers.some((r) => wanted.includes(r))) via.push("covers");
    if (relianceOf(entry, feature).refs.some(({ ref }) => ref.feature === key && wanted.includes(ref.rule))) via.push("relies_on");
    if (via.length === 0) continue;
    cases.push({
      key: entry.key,
      feature,
      scenario: decl.scenario,
      file: repoPath(ctx, decl.file.rel),
      line: decl.line,
      summary: entry.summary,
      covers,
      level: /** @type {string | null} */ (caseLevel(entry.data, decl.file.data, ctx.schemaVersion) ?? null),
      review: feature === key ? reviews.get(entry.key) ?? null : null,
      via,
    });
  }
  cases.sort((a, b) => (a.feature === key ? 0 : 1) - (b.feature === key ? 0 : 1) || a.key.localeCompare(b.key));
  const own = cases.filter((c) => c.feature === key).length;
  return buildAmendJson({
    feature: key,
    rules,
    cases,
    omitted: { rules: state.rules.length - rules.length, cases: total - own },
    boundaries: state.boundaries,
    next_step: state.next_step,
  });
}

// The scan's Review facts as Key → freshness, the computation the catalogue also reads.
/**
 * @param {ReturnType<typeof scan>} output
 * @returns {Map<string, "fresh" | "void">}
 */
function reviewFreshness(output) {
  return new Map(/** @type {{ history: HistorySection }} */ (output).history.reviews.map((r) => [r.key, r.status]));
}

// A path under `.qa/` as the repository under test sees it: what a changeset lists, and what the
// suggested commit names, run from the repository root.
/**
 * @param {{ root: string, repo: string }} ctx
 * @param {string} rel
 * @returns {string}
 */
function repoPath(ctx, rel) {
  return relative(ctx.repo, join(ctx.root, rel)).split(sep).join("/");
}

// The Feature file `rel` as HEAD committed it, or null when HEAD holds no such file: a new Feature,
// or one whose file exists only in the working tree. The committed version is the baseline a draft
// may not shrink, even when the working tree already lost what HEAD still has.
/**
 * @param {{ root: string }} ctx
 * @param {string} rel
 * @returns {ParsedFile | null}
 */
function committedFeature(ctx, rel) {
  const repo = repositoryOf(ctx.root);
  if (!repo) return null;
  const head = resolveRef(ctx.root, "HEAD");
  if (!head) return null;
  const text = readQaAt(repo, head).get(rel);
  return text === undefined ? null : parse(rel, text);
}

// A drafted Feature file for `key`, checked against the Feature file it replaces (none for a new
// Feature). Every blocking check reads this one file, its own current version and `project.md`'s
// tracker pattern, as `check-file` does: local, in ADR-0008's sense. A Retired Feature key is
// relational, so it is a warning here; `feature` is where the skill settles the key.
//
// Errors are `{code, field?, line?, message}`: check-file's own, then these:
//   feature_key         not a kebab-case Feature key
//   key                 the draft's `key` is not the Feature key
//   rule_dropped        a Rule left without its key moving to `retired:`
//   link_unrepaired     a retiring Rule is still named by a `covers`, Reliance or Dependency, neither repaired nor confirmed
//   confirm_unknown     a `--confirm` id names no listed link
//   retired_reused      a Retired key heads a live Rule
//   retired_removed     a key left `retired:`
//   source_removed      a source left `sources`; sources only grow
//   no_sources          no source at all
//   reference           an added source is not a Reference URI
//   coverage_*          the `## Coverage` section's own contract (lib/coverage.mjs)
//   deferred_*          the `## Deferred` section's syntax and sources (lib/deferred.mjs)
//   bookkeeping         `watermark`, `watermark_digest`, `finding` or an existing `mirror` changed, or `formerly` shrank
//   rule_outside_rules  a `rule_` heading or numbered item outside `## Rules`
// Warnings add `retired_feature_key` to check-file's `unknown_key`.
/**
 * @param {DeepDiveContext} ctx
 * @param {string} key
 * @param {string} text
 * @param {readonly string[]} [confirmed] link ids the engineer confirmed (`--confirm`)
 * @returns {{ ok: boolean, [key: string]: unknown }}
 */
function checkDraft(ctx, key, text, confirmed = []) {
  /** @type {Array<{ code: string, field?: string, line?: number | null, key?: string, ref?: string, link?: string, [key: string]: unknown }>} */
  const errors = [];
  /** @type {Array<{ code: string, [key: string]: unknown }>} */
  const warnings = [];
  const problem = keyProblem(ctx, key);
  if (problem?.status === "invalid") {
    return buildCheckJson({ ok: false, feature: key, status: "invalid", coverage_digest: coverageDigest(text), errors: [{ code: "feature_key", feature: key }], warnings });
  }
  if (problem) warnings.push({ code: "retired_feature_key", feature: key });
  /**
   * @param {string} code
   * @param {Record<string, unknown>} [facts]
   * @param {number | null} [line]
   * @param {string} [field]
   */
  const report = (code, facts = {}, line, field) => errors.push({ code, ...facts, ...(field && { field }), ...(line && { line }) });

  const state = featureState(ctx, key);
  const draft = parse(state.rel, text);
  const checked = checkFile(draft, rootConfig(ctx.root));
  errors.push(...checked.errors);
  warnings.push(...checked.warnings);
  // Coverage is Feature knowledge (ADR-0041), so the draft's own section is held to the effective
  // list and the Feature as HEAD committed it: an uncommitted deletion of the section is still a
  // drop. A Feature not yet committed has no committed version, so nothing is refused.
  const current = committedFeature(ctx, state.rel);
  errors.push(...coverageProblems(draft, effectiveCategories(ctx.root), { current }));
  errors.push(...deferredProblems(draft, ctx));
  errors.push(...proposedRulesProblems(draft));
  // The draft replaces this Feature in the tree, so a Dependency it adds resolves against every
  // other Feature as it stands, with the Scan's own checks.
  const files = state.status === "existing"
    ? ctx.files.map((f) => (!f.unreadable && f.type === "feature" && f.data.key === key ? draft : f))
    : [...ctx.files, draft];
  for (const problem of dependencyProblems(buildIndex(files), files, draft)) {
    errors.push({ code: problem.code, ...(problem.line && { line: problem.line }), ...(problem.ref && { ref: problem.ref }), key: problem.key });
  }
  const d = draft.data;
  const was = state.data;
  /** @param {string} k */
  const line = (k) => draft.keyLines[k] ?? draft.frontmatterLine;

  if (d.key !== undefined && d.key !== key) report("key", { key: d.key, feature: key }, line("key"), "key");

  // Rules: a key stays, or moves to `retired:`; a Retired key never comes back.
  const draftRules = new Map(draft.rules.map((r) => [r.key, r]));
  const retiredNow = listOf(d.retired);
  for (const k of state.retired) {
    if (!retiredNow.includes(k)) report("retired_removed", { key: k }, line("retired"), "retired");
  }
  for (const r of draft.rules) {
    if (retiredNow.includes(r.key) || state.retired.includes(r.key)) {
      report("retired_reused", { rule: r.key }, r.line, "rule");
    }
  }
  // A Rule that leaves lists every link that names it, across Features; each must be repaired in
  // the tree or confirmed with `--confirm`, or the draft is refused (link-repair.mjs).
  /** @type {Array<{ key: string, statement: string, covered_by: unknown, links: unknown }>} */
  const retired = [];
  const confirmedIds = new Set(confirmed);
  /** @type {Set<string>} */
  const listedIds = new Set();
  for (const r of state.rules) {
    if (draftRules.has(r.key)) continue;
    if (retiredNow.includes(r.key)) {
      const links = retiredLinks(ctx, key, r.key, draft, confirmedIds);
      for (const l of links) {
        listedIds.add(l.id);
        if (l.resolution === "unrepaired") {
          const error = { code: "link_unrepaired", link: l.id, rule: r.key, kind: l.kind, owner: l.owner, file: l.file, feature: l.feature, line: l.line, field: "retired" };
          errors.push(error);
        }
      }
      retired.push({ key: r.key, statement: r.statement, covered_by: r.covered_by, links });
    } else report("rule_dropped", { rule: r.key }, undefined, "rule");
  }
  for (const id of confirmedIds) {
    if (!listedIds.has(id)) report("confirm_unknown", { link: id }, undefined, "confirm");
  }
  const before = new Map(state.rules.map((r) => [r.key, r]));
  // The same structural diff the Scan's history asks: one Rule entry's whole stripped text, so a
  // statement, elaboration, Waiver or Dependency edit is a change. `state.rules` is the summary;
  // the parsed file holds the parts `ruleEdit` classifies.
  const beforeFile = ctx.index.features.get(key)?.[0]?.file ?? null;
  const beforeRules = new Map((beforeFile?.rules ?? []).map((r) => [r.key, r]));
  const beforeTexts = beforeFile ? ruleTexts(beforeFile) : new Map();
  const afterTexts = ruleTexts(draft);
  const added = draft.rules.filter((r) => !before.has(r.key)).map((r) => r.key);
  const edited = draft.rules.flatMap((r) => {
    const was = beforeRules.get(r.key);
    if (!was) return [];
    const edit = ruleEdit(was, r, beforeTexts.get(r.key) ?? "", afterTexts.get(r.key) ?? "");
    return edit ? [edit] : [];
  });

  // Sources only grow, and each one this run adds is a Reference. A source carried over is left
  // alone, whatever its form: removing it is not deep-dive's to do.
  const sources = listOf(d.sources);
  for (const s of state.sources) {
    if (!sources.includes(s)) report("source_removed", { source: s }, line("sources"), "sources");
  }
  if (Array.isArray(d.sources) && d.sources.length === 0) report("no_sources", {}, line("sources"), "sources");
  const sourcesAdded = (Array.isArray(d.sources) ? d.sources : []).filter((s) => !state.sources.includes(s));
  for (const s of sourcesAdded) {
    const error = referenceShapeError(s, ctx);
    if (error) report("reference", { source: s }, line("sources"), "sources");
  }

  // Bookkeeping is not deep-dive's to write. A new Feature may carry `mirror: {group, at}`.
  /**
   * @param {unknown} a
   * @param {unknown} b
   */
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of ["watermark", "watermark_digest", "finding", ...(was.suite_key !== undefined ? ["suite_key"] : [])]) {
    if (!same(d[k], was[k])) report("bookkeeping", { key: k }, line(k), k);
  }
  if (was.mirror !== undefined && !same(d.mirror, was.mirror)) {
    report("bookkeeping", { key: "mirror" }, line("mirror"), "mirror");
  }
  for (const k of listOf(was.formerly)) {
    if (!listOf(d.formerly).includes(k)) report("bookkeeping", { key: k }, line("formerly"), "formerly");
  }

  for (const h of ruleHeadingsOutsideRules(draft)) {
    report("rule_outside_rules", {}, h.line, "rule");
  }

  const ok = errors.length === 0;
  const changeset = ok ? [state.file, ...runObservations(ctx, sources)] : undefined;
  return buildCheckJson({
    ok,
    feature: key,
    status: state.status,
    file: state.file,
    path: state.path,
    coverage_digest: coverageDigest(text),
    proposed_rules_left: parseProposedRules(text),
    errors: errors.sort((a, b) => (a.line ?? 0) - (b.line ?? 0)),
    warnings,
    rules: { added, edited, retired },
    sources_added: sourcesAdded,
    ...(ok && changeset ? { changeset, commit: commitLine(changeset, `qa(${key}): /qa-deep-dive`), next_step: state.next_step } : {}),
  });
}

// The Observations this run made (ADR-0016): the draft's `file:` sources under
// `.qa/observations/` that git has not committed yet, in path order. A committed one was cited from
// an earlier run, so it has nothing left to commit.
/**
 * @param {{ root: string, repo: string }} ctx
 * @param {readonly string[]} sources
 * @returns {string[]}
 */
function runObservations(ctx, sources) {
  const dir = `${repoPath(ctx, "observations")}/`;
  const files = sources.filter((s) => s.startsWith(`file:${dir}`)).map((s) => s.slice("file:".length));
  return [...new Set(files)].filter((f) => isUncommitted(ctx.repo, f)).sort();
}

// The `rule_` headings and numbered `rule_` items of a parsed file whose nearest `##` above is not
// `## Rules`.
/**
 * @param {ParsedFile} file
 * @returns {Array<{ line: number }>}
 */
function ruleHeadingsOutsideRules(file) {
  /** @type {string | null} */
  let section = null;
  /** @type {Array<{ line: number }>} */
  const out = [];
  for (const e of file.sections) {
    if (e.level <= 2) section = e.level === 2 ? e.title : null;
    else if (e.level === 3 && e.title.startsWith("rule_") && section !== "Rules") out.push(e);
  }
  for (const item of file.items ?? []) {
    if (item.key.startsWith("rule_") && item.section !== "Rules") out.push(item);
  }
  return out.sort((a, b) => a.line - b.line);
}
