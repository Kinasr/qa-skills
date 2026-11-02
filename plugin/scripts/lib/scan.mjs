// @ts-check
// `scan`: the global relational pass over `.qa/` (ADR-0008). It never writes, never blocks and never crashes on bad input.
//
// The work is split into passes, each its own module exporting `kinds` (the result kinds it may
// emit) and `run(ctx)`. A pass reads the shared context and reports through `ctx.emit`; it never
// touches another pass's state. A new concern (the code index, history) is a new pass module and
// one line in PASSES.
//
// Every result is `{kind, code, file?, line?, feature?, key?, message, ...}`: `kind` says what it
// is (integrity_error, divergence, …) so no reader re-derives it, `code` says which check.
//
// A pass may also publish a named section of facts beside `results` (`ctx.section`), and withdraw
// another pass's result that a stored decision settles (`ctx.suppress`), listing it in its own
// section instead.
/** @import { CommandDefinition } from "./cli.mjs" */
/** @import { CaseEntry, ParsedEntry, ParsedFile, ProjectConfig, QaFile, UnreadableFile } from "./knowledge-file.mjs" */
/** @import { KeyIndex } from "./qa-index.mjs" */
/** @import { AutomationIndexEntry, RunHealthNote, ScanAdapter } from "./scan-code.mjs" */
/** @import { HistorySection, FeatureLevelFacts } from "./scan-history.mjs" */
/** @import { UncitedCase, UncoveredRule } from "./scan-links.mjs" */
/** @import { StackUnavailableNote } from "./stack.mjs" */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { UsageError } from "./cli.mjs";
import { shownKey } from "./credentials.mjs";
import { readQaTree } from "./git-tree.mjs";
import { parseTree, projectConfig } from "./knowledge-file.mjs";
import { PATTERN } from "./keys.mjs";
import { buildIndex } from "./qa-index.mjs";
import * as cases from "./scan-cases.mjs";
import * as code from "./scan-code.mjs";
import * as history from "./scan-history.mjs";
import * as integrity from "./scan-integrity.mjs";
import * as links from "./scan-links.mjs";
import * as train from "./scan-train.mjs";
import { isBugFile, TRAIN_ENTRIES } from "./schema.mjs";
import { resolveAdapter } from "./stack.mjs";

/**
 * A Test Case as the knowledge layer parses it: its heading, its block's values and its prose.
 * @typedef {import("./knowledge-file.mjs").CaseEntry} CaseEntry
 */

/**
 * A `.qa/` file the scan reads: its frontmatter values, its heading and its Test Cases.
 * @typedef {import("./knowledge-file.mjs").ParsedFile} ParsedQaFile
 */

/**
 * A `.qa/` file that could not be read: nothing of it is known.
 * @typedef {import("./knowledge-file.mjs").UnreadableFile} UnreadableQaFile
 */

/**
 * @typedef {import("./knowledge-file.mjs").QaFile} QaFile
 */

/**
 * A result the scan reports: what it is (`kind`), which check found it (`code`), where it sits
 * (`file`, `line`, `feature`) and what it says (`message`). A pass adds the fields of its own kind.
 * @typedef {{
 *   kind: string,
 *   code: string,
 *   message: string,
 *   file?: string,
 *   line?: number,
 *   feature?: string,
 *   rests_on?: string,
 *   [key: string]: unknown,
 * }} ScanResult
 */

/**
 * The stack the passes read: the adapter as `scan-code` names it (its separator, words and flags,
 * not the parse it runs), with the version it reported and the note when it cannot load.
 * @typedef {{
 *   adapter: ScanAdapter | null,
 *   version: string | null,
 *   unavailable: StackUnavailableNote | null,
 * }} ScanStack
 */

/**
 * The context every pass reads: the `.qa/` root, the repository under test, the parsed files, the
 * Key index, the project's settings, the resolved stack, the Feature and the target the scan reads,
 * and where a result is reported, a section published, a result suppressed, a run-health note made
 * or the Automation keys listed.
 * @typedef {{
 *   root: string,
 *   repo: string,
 *   files: QaFile[],
 *   bugs: QaFile[],
 *   index: KeyIndex,
 *   config: ProjectConfig,
 *   stack: ScanStack,
 *   feature?: string,
 *   target?: { ref: string | null, commit: string | null } | null,
 *   today: string,
 *   bookkeeping?: QaFile[] | null,
 *   featureLevel?: boolean,
 *   emit: (result: ScanResult) => void,
 *   section: (name: string, value: unknown) => void,
 *   suppress: (test: (result: ScanResult) => boolean) => void,
 *   health: (note: RunHealthNote) => void,
 *   indexAutomations: (map: Map<string, AutomationIndexEntry>) => void,
 * }} ScanContext
 */

/**
 * A pass the scan runs: the result kinds it may emit, and the pass itself.
 * @typedef {{
 *   kinds: readonly string[],
 *   run: (ctx: ScanContext) => void,
 * }} ScanPass
 */

/**
 * The scan's own options: the Feature to limit it to, the target it reads `.qa/` at, the day
 * `review_by` is measured against, the bookkeeping files it reads findings from in place of the
 * target's own, and the `project.md` text it reads in place of the file's own.
 * @typedef {{
 *   feature?: string,
 *   target?: { ref: string | null, commit: string | null } | null,
 *   today?: string,
 *   bookkeeping?: QaFile[] | null,
 *   featureLevel?: boolean,
 *   project?: string,
 * }} ScanOptions
 */

/**
 * The Key index the scan reports: where each Key is declared, and the Automation keys the code
 * index read.
 * @typedef {{
 *   features: Record<string, { file: string, rules: string[] } | null>,
 *   scenarios: Record<string, { file: string, feature: string | null | undefined } | null>,
 *   cases: Record<string, { file: string, line: number, scenario: string | null | undefined, feature: string | null | undefined } | null>,
 *   train: Record<string, { file: string, [list: string]: unknown } | null>,
 *   automations?: Record<string, AutomationIndexEntry>,
 * }} ScanIndexSummary
 */

/**
 * What one scan reports: the Feature it was scoped to, the counts by result kind, the Key index it
 * built, the results it kept, the run-health notes and the sections the passes published. The
 * Uncited cases and Uncovered Rules are reports beside `results`, never Findings, so no count holds them.
 * @typedef {{
 *   feature: string | null,
 *   counts: Record<string, number>,
 *   index: ScanIndexSummary,
 *   results: ScanResult[],
 *   run_health: RunHealthNote[],
 *   history: HistorySection,
 *   uncited_cases: UncitedCase[],
 *   uncovered_rules: UncoveredRule[],
 *   feature_level?: { features: FeatureLevelFacts[] },
 *   [key: string]: unknown,
 * }} ScanOutput
 */

/** @type {readonly ScanPass[]} */
const PASSES = [integrity, cases, links, train, code, history];

// The scan's own top-level fields, which no pass's section may replace.
const RESERVED_SECTIONS = ["mode", "root", "feature", "counts", "index", "results", "run_health"];

// `root` is the `.qa/` directory; the repository under test is its parent. `feature`, when given,
// limits results to that Feature (results tied to no Feature, such as `project.md`'s, are always
// kept). `target`, when given, is `{ref, commit}`: the scan reads `.qa/` as it stands at that
// commit instead of the working tree. `today` is an ISO date, for `review_by`. `bookkeeping`, when
// given, is parsed files whose findings the history facts read in place of the target's own
// (`/qa-design`'s settle, which writes into a working tree that may run ahead of its target).
// `featureLevel`, when given, publishes the `feature_level` section: the Rules a Feature's
// Feature-level judge unit judges against its Boundaries (ADR-0039). `project`, when given, is text
// the scan reads as `project.md` in place of the file's own
// (`/qa-init`, counting what a configuration change would orphan before it is written).
/**
 * @param {string | undefined} root
 * @param {ScanOptions} [options]
 * @returns {ScanOutput}
 */
export function scan(root, options = {}) {
  return acquireScan(root, options).facts;
}

/**
 * One scan and its full parsed context, retained for read-only projections. Scope limits
 * reported facts only; cross-Feature indexes always see the complete tree.
 * @typedef {{ files: QaFile[], bugs: QaFile[], index: KeyIndex, config: ProjectConfig, facts: ScanOutput, allResults: ScanResult[] }} ScanAcquisition
 */
/**
 * @param {string | undefined} root
 * @param {ScanOptions} [options]
 * @returns {ScanAcquisition}
 */
export function acquireScan(root, { feature, target = null, today = localDate(), bookkeeping = null, featureLevel = false, project } = {}) {
  const tree = new Map(readQaTree(/** @type {string} */ (root), target?.commit));
  if (project !== undefined) tree.set("project.md", project);
  const parsed = parseTree(tree);
  // Bug drafts sit beside the knowledge, never in it: they load into `bugs`, so no knowledge pass
  // sees them and a draft never raises a knowledge Integrity error.
  const bugs = parsed.filter(isBugFile);
  const files = parsed.filter((file) => !isBugFile(file));
  // Bug files claim a Tracker key once published, but no knowledge pass reads them.
  const index = buildIndex([...files, ...bugs]);
  /** @type {ScanResult[]} */
  const results = [];
  /** @type {Record<string, unknown>} */
  const sections = {};
  /** @type {Array<(result: ScanResult) => boolean>} */
  const suppressors = [];
  /** @type {RunHealthNote[]} */
  const health = [];
  /** @type {Map<string, AutomationIndexEntry> | null} */
  let automations = null;
  const repo = dirname(resolve(/** @type {string} */ (root)));
  const config = projectConfig(index.project);
  /** @type {ScanContext} */
  const ctx = {
    root: resolve(/** @type {string} */ (root)),
    repo,
    files,
    bugs,
    index,
    config,
    // The stack adapter for this run (lib/stack.mjs `resolveAdapter`), resolved once here.
    stack: resolveAdapter(config.stack, repo),
    feature,
    target,
    today,
    bookkeeping,
    featureLevel,
    emit(result) {
      results.push(result);
    },
    section(name, value) {
      if (RESERVED_SECTIONS.includes(name)) throw new Error(`a pass cannot publish a section named \`${name}\``);
      sections[name] = value;
    },
    suppress(test) {
      suppressors.push(test);
    },
    // Run health: what this run could not do, such as code binding
    // skipped. `{code, message}`; never a result about the knowledge, so never scoped or counted.
    health(note) {
      health.push(note);
    },
    // The code index, from the pass that built it: Automation key → `{file, line, class, name,
    // feature}`, listed in the output's `index` beside the Key index.
    indexAutomations(map) {
      automations = map;
    },
  };
  for (const pass of PASSES) pass.run(ctx);

  /**
   * @param {ScanResult} r
   * @returns {boolean}
   */
  const inScope = (r) => !feature || r.feature === undefined || r.feature === null || r.feature === feature;
  const allResults = results.filter((r) => !suppressors.some((s) => s(r))).sort(byPlace);
  const kept = allResults.filter(inScope);
  const counts = Object.fromEntries(PASSES.flatMap((p) => p.kinds).map((k) => [k, 0]));
  for (const r of kept) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  // The history pass publishes its `history` section (lib/scan-history.mjs), among the others.
  const facts = /** @type {ScanOutput} */ ({ feature: feature ?? null, counts, index: summarise(index, feature, automations), results: kept, run_health: health, ...sections });
  return { files, bugs, index, config, facts, allResults };
}

/**
 * @param {ScanResult} a
 * @param {ScanResult} b
 * @returns {number}
 */
function byPlace(a, b) {
  return (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0) || a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code);
}

// Key → file, for skills to locate a concept without grep. Only the first declaration of a Key is
// listed; a second one is an Integrity error. Scoped like the results. A train entry's key in a
// token format is shown as `shownKey` shows it.
/**
 * @param {KeyIndex} index
 * @param {string | undefined} feature
 * @param {Map<string, AutomationIndexEntry> | null} automations
 * @returns {ScanIndexSummary}
 */
function summarise(index, feature, automations) {
  /**
   * @template D
   * @param {D[]} decls
   * @returns {D}
   */
  const first = (decls) => decls[0];
  /**
   * @template D, V
   * @param {Map<string, D[]>} map
   * @param {(first: D) => V | null} fn
   * @returns {Record<string, V | null>}
   */
  const pick = (map, fn) => Object.fromEntries([...map].map(([k, d]) => /** @type {[string, V | null]} */ ([k, fn(first(d))])).filter(([, v]) => v));
  /**
   * @param {unknown} f
   * @returns {boolean}
   */
  const inFeature = (f) => !feature || f === feature;
  return {
    features: pick(index.features, (d) =>
      inFeature(d.file.data.key) ? { file: d.file.rel, rules: [...(index.rules.get(/** @type {string} */ (d.file.data.key))?.keys() ?? [])] } : null,
    ),
    scenarios: pick(index.scenarios, (d) => (inFeature(d.feature) ? { file: d.file.rel, feature: d.feature } : null)),
    cases: pick(index.cases, (d) => (inFeature(d.feature) ? { file: d.file.rel, line: d.line, scenario: d.scenario, feature: d.feature } : null)),
    train: pick(index.train, ({ file: f }) => /** @type {{ file: string, [list: string]: unknown }} */ ({ file: f.rel, ...Object.fromEntries(TRAIN_ENTRIES.filter(({ target }) => !target || target === f.data.key).map(({ list }) => [list, (/** @type {ParsedEntry[]} */ (f[list])).map((e) => shownKey(e.key))])) })),
    ...(automations && { automations: Object.fromEntries([...automations].filter(([, a]) => inFeature(a.feature))) }),
  };
}

// Today, as the machine's local ISO date.
/**
 * @returns {string}
 */
export function localDate() {
  const d = new Date();
  /**
   * @param {number} n
   * @returns {string}
   */
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The command line's `scan [<feature>]` (scripts/scan.mjs): never writes and never blocks, exit 0
// whatever it finds. With `--target` it reads `.qa/` at that commit instead of the working tree.
/** @type {CommandDefinition} */
export const command = {
  options: { root: "qa-dir", target: "commit" },
  usage: "[<feature>] [--target <ref>] [--root <qa-dir>]",
  run(args, { root, target }) {
    if (args.length > 1) throw new UsageError("scan takes at most one <feature>");
    const [feature] = args;
    if (feature !== undefined && !PATTERN.slug.test(feature)) throw new UsageError(`\`${feature}\` is not a Feature key`);
    const result = scan(/** @type {string} */ (root), { feature, target });
    // A Feature whose own file is broken is still a Feature to scan: its directory, or a scenario
    // naming it, says so. Under --target only the target's `.qa/` counts.
    const known =
      feature === undefined ||
      feature in result.index.features ||
      Object.keys(result.index.scenarios).length > 0 ||
      (!target && existsSync(join(/** @type {string} */ (root), "features", feature)));
    if (!known) throw new UsageError(`no Feature \`${feature}\` in ${root}`);
    return { exit: 0, json: { root, ...result } };
  },
};
