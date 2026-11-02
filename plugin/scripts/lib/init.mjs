// @ts-check
// `init`: the deterministic half of `/qa-init`. The agent reads the repository (there is no detection
// script) and builds a proposal in which every value carries the evidence it came from. The model
// words the card and the closing report; everything that checks, dispatches or writes is here, and
// every action prints JSON (lib/init-json.mjs): facts, labels and glossary pieces, never prose.
//
//   state            the run's first call, before any evidence is read: `train` (`train/init.md`,
//                    lib/training.mjs) and `access`, the Access note the tracker is read through, or
//                    null (lib/access.mjs). The configured tracker's note (`tracker:DEMO-`, the longest
//                    prefix winning); with none configured, only the unscoped `tracker:` note.
//                    And `pointer`, the Agent pointer (lib/agent-pointer.mjs): reported, never written.
//                    Read-only, on a first run, on maintenance and before `add-role` alike.
//   smoke --model <label> [--reply <file>] [--dir <run>]   the smoke test of a model label
//                    (lib/init-smoke.mjs): without `--reply`, the brief and the subagent prompt
//                    written into the run dir (made when `--dir` names none); with it, the reply the
//                    agent saved judged and the outcome recorded there. Never writes in the
//                    repository. `inherit` is never smoke-tested.
//   card --stdin [--dir <run>]   the one card: the settings with their evidence, the test stack and
//                    the file the card would write (`project.md`), through `check-file`. It keeps the
//                    proposal and the card's digest in the run dir (a fresh OS temp dir when `--dir`
//                    names none). Never writes in the repository.
//   apply --dir <run> --stdin   JSON decisions on stdin, validated against the card kept in the run
//                    dir and applied: written in one write at the end, or not at all. Only
//                    `.qa/project.md`; never code, `.gitignore` or agent instructions. It never
//                    stages or commits, and a dirty tree is fine.
//   add-role <name>... roles appended to an existing `project.md`, validated locally and written,
//                    with no scan and no card.
//
// With a `project.md` already in `.qa/`, `card` and `apply` maintain it ("Maintenance" below): the
// card shows the file as it stands beside fresh detection, every item stays as it is unless the
// decisions name it, and a change that would cause Integrity errors is written only once the
// decisions confirm it.
//
// What `card` prints: `{ok, dir, card}`, or `{ok: false, refusals}` (exit 1) for a proposal with problems.
// What `apply` prints: `{dir, ok, confirm, rebuild, ...}`: `applied`, `dropped` and `report` once
// written; `refusals` (exit 1) with `rebuild` when the card is to be built again; `confirm: true`
// (exit 0, nothing written) with the `changes` and the `decisions` that confirm them.
//
// A Tier's model is a label in `project.md`'s `tiers`: a proposal naming `delegates` is refused, and a
// `tiers.*` label other than `inherit` goes on either card only once its smoke test passed in the run
// dir (one test per distinct label, whichever Tiers pick it). One run dir serves the whole `/qa-init`:
// the first `smoke` or `card` makes it.
// A proposal:
//   {fields: {<field>: {value, evidence}}, stacks?: [...], chosen_stack?, chosen_by?}
// `evidence` is one of
//   {file, count, sample}      read from the repository
//   {tracker, count, sample}   read from the tracker (`tracker` says what was read)
//   {asked: true}              the engineer's answer (a question on the card)
//   {default: true}            the framework's default, for a field that has one
//   {picked: true}             the engineer's pick of a Tier's model label (a `tiers.*` field only),
//                              no question; a label other than `inherit` must have passed its smoke
//                              test in the run dir
/**
 * @import { CardAdapter, CardApplyDone, CardApplyOut, CardChangeset, CardConfirm, CardContext, CardDecisions, CardLifecycle, CardRefusal, CardRefused } from "./card-run.mjs"
 * @import { CommandAction, CommandContext, CommandDefinition, CommandResult, OptionSpec, UsageError } from "./cli.mjs"
 * @import { InitCardData, InitCardItem, InitCheckError, InitDecisionError, InitDecisions, InitEvidence, InitFieldItem, InitFieldSource, InitGlossary, InitItem, InitMaintenanceData, InitMaintenanceItem, InitMaintenanceSource, InitMintingItem, InitMintingSource, InitNote, InitStack, InitStackItem, InitStackRow, InitStackSource, InitUnread } from "./init-json.mjs"
 * @import { SmokeOutcome, SmokeRecord, SmokeStarted, SmokeState } from "./init-smoke.mjs"
 * @import { RefusalFact, RefusalResult } from "./refusal.mjs"
 * @import { NewRunDirResult, OpenRunDirResult } from "./run-dir.mjs"
 */
import { cardRun } from "./card-run.mjs";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { accessFor, trackerUri } from "./access.mjs";
import { pointerFor } from "./agent-pointer.mjs";
import { glossaryOf, summaries } from "./labels.mjs";
import { commitLine, writeAll } from "./changeset.mjs";
import { buildCodeIndex, keyPatterns } from "./code-index.mjs";
import { DEFAULT_CONCURRENCY } from "./delegates.mjs";
import { isMap } from "./dialect.mjs";
import { findingData } from "./finding-data.mjs";
import { decisionsOf, fact, noteOf, refusalOf, firstCardData, maintenanceCardData, NOTES, refuse, unreadData } from "./init-json.mjs";
import { givenOption, MINTING, MINTING_FIELDS, settledOptions } from "./init-minting.mjs";
import { judgeSmoke, smokeStarted, smokeState, startSmoke } from "./init-smoke.mjs";
import { FALLBACK, isModelLabel, TIERS, trackerReference } from "./keys.mjs";
import { checkFile, edit, parse, projectConfig } from "./knowledge-file.mjs";
import { onPath } from "./on-path.mjs";
import { playwrightCliVersion } from "./playwright-version.mjs";
import { buildIndex, loadWorkingTree, locate, rootConfig } from "./qa-index.mjs";
import { block, inline, line, role } from "./render.mjs";
import { newRunDir, openRunDir } from "./run-dir.mjs";
import { localDate, scan } from "./scan.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { casesCarrying, categoryOverlaps, editedMeanings, LABEL_KEYS, removedLabels } from "./init-labels.mjs";
import { ANY_SCHEMA_VERSION, FIELD_RENDER, INIT_SCHEMA_VERSION, INIT_TRAIN_KEY } from "./schema.mjs";
import { resolveAdapter, wordsOf } from "./stack.mjs";
import { trainFor } from "./training.mjs";

/**
 * @typedef {{ dir: string | null, exists: boolean, make(): string, error?: undefined } | { error: string, dir?: undefined, exists?: undefined, make?: undefined }} InitNewRunDir
 * @typedef {{ dir: string, error?: undefined } | { error: string, dir?: undefined }} InitOpenRunDir
 * @typedef {{ dir: string | null, make?: () => string, error?: undefined } | { error: string, dir?: undefined, make?: undefined }} InitEitherRunDir
 */

/**
 * The specification of a field on the card.
 * @typedef {{
 *   name: string,
 *   label: string,
 *   kind: string,
 *   required?: boolean,
 *   tracker?: boolean,
 *   publish?: boolean,
 *   sparse?: boolean,
 *   fromTracker?: boolean,
 *   default?: unknown,
 *   picked?: boolean,
 *   askable?: boolean,
 *   persist?: boolean,
 *   editable?: boolean,
 * }} InitFieldDefinition
 */

/**
 * A proposal read from stdin on a first run or maintenance.
 * @typedef {object} InitProposal
 * @property {Record<string, { value?: unknown, evidence?: InitEvidence | null }>} [fields]
 * @property {InitStack[]} [stacks]
 * @property {string} [chosen_stack]
 * @property {string} [chosen_by]
 * @property {unknown} [delegates]
 */

/**
 * The directory and repository context loaded for an init call.
 * @typedef {{
 *   root: string,
 *   repo: string,
 *   dir: string | null,
 *   project: boolean,
 *   repoPath: (rel: string) => string,
 * }} InitContext
 */

/**
 * A parsed project file.
 * @typedef {{
 *   rel: string,
 *   name: string,
 *   dir: string,
 *   text: string,
 *   frontmatter: string | null,
 *   data: Record<string, unknown>,
 *   problems: Array<{ code: string, line: number, message: string }>,
 * }} ParsedProject
 */

/**
 * @typedef {(ParsedProject & { problem?: never }) | { problem: { code: string, lines: number[] }, frontmatter?: never, data?: never, text?: never }} ReadProjectResult
 */

/**
 * A problem discovered while building or checking a card.
 * @typedef {{
 *   code: string,
 *   field?: string,
 *   what?: string,
 *   missing?: string[],
 *   root?: string,
 *   quote?: string | null,
 *   file?: string | null,
 *   roots?: string[],
 *   outside?: string[],
 *   value?: unknown,
 *   dir?: boolean,
 *   why?: string,
 *   path?: string,
 *   errors?: unknown[],
 *   lines?: number[],
 *   [key: string]: unknown,
 * }} InitProblem
 */

/**
 * @typedef {{
 *   problems: InitProblem[],
 *   problem: (code: string, field?: string, data?: Record<string, unknown>) => void,
 * }} ProblemList
 */

/**
 * An item of the first-run card as `init` builds it.
 * @typedef {(InitFieldSource & { field: string }) | (InitStackSource & { field?: string }) | (InitMintingSource & { field?: string })} FirstCardItem
 */

/**
 * The declaration snippet for an Automation-key carrier.
 * @typedef {{
 *   status: string,
 *   annotation: string,
 *   language?: string,
 *   framework?: string,
 *   message?: string,
 *   fix?: string,
 *   words?: unknown,
 *   home?: unknown,
 *   path?: string,
 *   text?: string,
 *   [key: string]: unknown,
 * }} InitAnnotationSnippet
 */

/**
 * What `check-file` says of a file: its errors and warnings.
 * @typedef {{
 *   ok: boolean,
 *   errors: Array<{ code: string, field: string, line?: number, message: string }>,
 *   warnings: Array<{ code: string }>,
 * }} InitFileCheck
 */

/**
 * What building a first-run card returns.
 * @typedef {{
 *   ok: boolean,
 *   seal?: unknown,
 *   items: FirstCardItem[],
 *   stacks: InitStackRow[],
 *   files: Array<{ path: string, text: string, check?: InitFileCheck }>,
 *   snippet: InitAnnotationSnippet | null,
 *   notes: Array<{ code: string, overlaps?: string[] }>,
 *   problems: InitProblem[],
 * }} FirstBuildCardResult
 */

/**
 * A proposal with no shape to build on: only the problems, no card.
 * @typedef {{
 *   ok: false,
 *   problems: InitProblem[],
 * }} InitUnbuilt
 */

/**
 * An item of the maintenance card as `init` builds it.
 * @typedef {InitMaintenanceSource & { kind: string, field: string }} MaintenanceCardItem
 */

/**
 * What building a maintenance card returns.
 * @typedef {{
 *   ok: boolean,
 *   seal?: unknown,
 *   items: MaintenanceCardItem[],
 *   check: InitCheckError[],
 *   notes: Array<{ code: string, overlaps?: string[] }>,
 *   problems: InitProblem[],
 *   current: ParsedProject,
 *   data: Record<string, unknown>,
 * }} MaintenanceBuildCardResult
 */

/**
 * @typedef {{
 *   errors: unknown[],
 *   unread: Array<{ role: string, file: string, line: number, key: string, name: string }>,
 * }} MaintenanceEffect
 */

/**
 * One key annotation as `init` reads it: where the code index found the key and what it names.
 * @typedef {{
 *   role: string,
 *   file: string,
 *   line: number,
 *   key: string,
 *   name: string,
 * }} InitAnnotation
 */

/**
 * What a `project.md` reading `text` resolves: its scan, and every key annotation the code index
 * reads under its `stack`, `module_paths` and `annotation_map`.
 * @typedef {{
 *   scan: InitScan,
 *   annotations: InitAnnotation[],
 * }} InitReferrers
 */

/**
 * One result of `scan` as `newResults` counts it: `kind` says which check (`integrity_error`,
 * `divergence`, …) and `code` which one; the rest say where it is and what it is against.
 * @typedef {{
 *   kind: string,
 *   code: string,
 *   file?: string,
 *   line?: number,
 *   key?: string,
 *   field?: string,
 *   automation?: unknown,
 *   function?: { file: string, line?: number },
 * }} InitScanResult
 */

/**
 * What `scan` resolves, as `referrers` reads it: the results of one `project.md`.
 * @typedef {{
 *   results: InitScanResult[],
 * }} InitScan
 */

/**
 * @typedef {{
 *   item: MaintenanceCardItem,
 *   answer: string,
 *   value?: unknown,
 *   effect: MaintenanceEffect,
 *   described?: Array<{ kind: string, name: string, cases: number }>,
 * }} MaintenanceChange
 */

/**
 * @typedef {{
 *   adopt: Set<number>,
 *   drop: Set<number>,
 *   values: Map<number, unknown>,
 *   field: Map<string, MaintenanceCardItem>,
 *   final: (name: string) => unknown,
 * }} MaintenanceReply
 */

/**
 * Internal apply result before lifecycle wrapping.
 * @typedef {{
 *   refused: RefusalFact[],
 *   cause?: string,
 *   confirm?: never,
 *   changeset?: never,
 *   report?: never,
 *   applied?: never,
 *   dropped?: never,
 * } | {
 *   confirm: CardConfirm,
 *   refused?: never,
 *   cause?: never,
 *   changeset?: never,
 *   report?: never,
 *   applied?: never,
 *   dropped?: never,
 * } | {
 *   applied: number[],
 *   dropped: number[],
 *   changeset: CardChangeset,
 *   report: (commit: string | null) => unknown,
 *   refused?: never,
 *   cause?: never,
 *   confirm?: never,
 * }} InternalApplyResult
 */

// The card's fields, in the card's order, each with its label. `default` fills a field the proposal
// leaves out. `tracker` fields are all present or all absent: a trackerless project omits `tracker`.
/** @type {readonly InitFieldDefinition[]} */
const FIELDS = [
  { name: "stack.language", label: "Test language", kind: "string", required: true },
  { name: "stack.framework", label: "Test framework", kind: "string", required: true },
  { name: "stack.levels", label: "Test levels", kind: "list", required: true },
  { name: "module_paths", label: "Module paths", kind: "list", required: true },
  { name: "tracker.provider", label: "Tracker", kind: "string", tracker: true },
  { name: "tracker.project", label: "Tracker project", kind: "string", tracker: true },
  { name: "tracker.key_pattern", label: "Tracker key shape", kind: "string", tracker: true },
  // Publish config (ADR-0026): optional, with no defaults (ADR-0025).
  { name: "tracker.issue_types", label: "Tracker issue types", kind: "list", publish: true },
  { name: "tracker.suite_type", label: "Test Suite issue type", kind: "string", publish: true },
  { name: "tracker.scenario_type", label: "Test Scenario issue type", kind: "string", publish: true },
  { name: "tracker.case_type", label: "Test Case issue type", kind: "string", publish: true },
  { name: "tracker.link_type", label: "Story link type", kind: "string", publish: true },
  { name: "tracker.initial_status", label: "Initial status", kind: "string", publish: true },
  { name: "tracker.marker_label", label: "Marker label", kind: "string", publish: true },
  { name: "tracker.marker_field", label: "Marker field", kind: "string", publish: true },
  { name: "tracker.bug_type", label: "Bug issue type", kind: "string", publish: true, sparse: true },
  { name: "tracker.bug_link_type", label: "Bug link type", kind: "string", publish: true, sparse: true },
  { name: "tracker.bug_link_direction", label: "Bug link direction", kind: "string", publish: true, sparse: true },
  { name: "bug_fields", label: "Bug fields", kind: "records", persist: true, sparse: true },
  { name: "tracker.tag_field", label: "Tag destination (multi-value field or labels)", kind: "string", publish: true },
  { name: "annotation_map.automation_key", label: "Automation-key annotation", kind: "list", required: true },
  { name: "annotation_map.tracker_key_fn", label: "Tracker-key annotation on tests", kind: "list" },
  { name: "annotation_map.tracker_key_class", label: "Tracker-key annotation on test classes", kind: "list" },
  // The class annotation carrying the Key prefix, with `automation_key_mint` (ADR-0013).
  { name: "annotation_map.automation_key_prefix", label: "Key prefix annotation", kind: "list" },
  // At most one of these two (check-file refuses both): the shape of keys the project's own tool
  // mints (ADR-0012), or the recipe the framework mints them from in the project's shape (ADR-0013).
  { name: "automation_key_pattern", label: "Automation-key pattern", kind: "string", persist: true },
  { name: "automation_key_mint", label: "Automation-key recipe", kind: "map", persist: true, editable: false },
  { name: "roles", label: "Roles", kind: "list", fromTracker: true },
  { name: "concurrency_cap", label: "Parallel calls", kind: "integer", default: DEFAULT_CONCURRENCY },
  // A Tier's model label; one left out runs on `inherit`, the Fallback (ADR-0021).
  // `picked`: the engineer's pick in the interview is its evidence (`{picked: true}`), no question.
  ...TIERS.map((t) => ({ name: `tiers.${t}`, label: `Model for the ${t} Tier`, kind: "string", picked: true })),
  { name: "targets", label: "Targets", kind: "map", askable: true, persist: true },
  { name: "execute_levels", label: "Execution levels", kind: "map", askable: true, persist: true },
  // What labels a Test Case: optional, with no defaults (a suggestion is a question with a suggested
  // answer, never `{default: true}`). A Tag maps to its one-line meaning, which may be empty.
  // `custom_fields` is a list of definitions `{name, description, values, multiple, required}`.
  { name: "role_meaning", label: "What the Roles mean", kind: "string" },
  { name: "tags", label: "Tags", kind: "map" },
  { name: "retired_tags", label: "Retired Tags", kind: "list" },
  { name: "custom_fields", label: "Custom fields", kind: "records" },
  { name: "stack.root", label: "Stack root", kind: "string", sparse: true },
  { name: "test_runner", label: "Test runner", kind: "map", askable: true, persist: true, sparse: true },
  { name: "code_host", label: "Code host", kind: "map", askable: true, persist: true, sparse: true },
];
/** @type {Map<string, InitFieldDefinition>} */
const FIELD = new Map(FIELDS.map((f) => [f.name, f]));
// The card's fields under one map of `project.md` (`tracker`, `annotation_map`, `tiers`).
/** @param {string} map @returns {string[]} */
const subfields = (map) => FIELDS.filter((f) => f.name.startsWith(`${map}.`)).map((f) => f.name.slice(map.length + 1));
/** @param {string} field @returns {string} */
const fieldLabelOf = (field) => (/** @type {InitFieldDefinition} */ (FIELD.get(field))).label;
const MINTING_LABEL = "Who mints Automation keys";

// The command line's `init <action>` (scripts/scan.mjs): the options each takes (as lib/cli.mjs reads
// them; `<qa-dir>` need not exist yet), and what it does. The one list of actions.
/** @type {Record<string, CommandAction>} */
const ACTIONS = {
  // Called before the path (first run, maintenance, add-role) is picked, so it takes no part in it.
  // `root` need not exist yet.
  state: {
    options: { root: "qa-dir?" },
    usage: "[--root <qa-dir>]",
    /**
     * @param {string[]} args
     * @param {CommandContext} ctx
     * @returns {CommandResult}
     */
    run(args, { root }) {
      if (args.length) return refuse("state_arguments");
      const abs = resolve(/** @type {string} */ (root));
      const index = /** @type {{ project?: { data?: { tracker?: unknown } } | null }} */ (buildIndex(loadWorkingTree(abs)));
      // With no tracker configured, only an unscoped `tracker:` Access note covers it.
      const uri = trackerUri(index.project?.data?.tracker) ?? trackerReference("");
      return { json: { ok: true, train: trainFor(index, INIT_TRAIN_KEY), access: accessFor(index, [uri])[uri], pointer: pointerFor(dirname(abs)) }, exit: 0 };
    },
  },

  // A first run and maintenance show different cards, so the path is settled first.
  card: {
    options: { root: "qa-dir?", stdin: "flag", dir: "value" },
    usage: "--stdin [--dir <run-dir>] [--root <qa-dir>]",
    /**
     * @param {string[]} args
     * @param {CommandContext} options
     * @returns {CommandResult}
     */
    run: (args, options) => showCard(args, options, hasProject(options.root)),
  },

  apply: {
    options: { root: "qa-dir?", stdin: "flag", dir: "value" },
    usage: "--dir <run-dir> --stdin [--root <qa-dir>]",
    /**
     * @param {string[]} args
     * @param {CommandContext} options
     * @returns {CommandResult}
     */
    run(args, options) {
      const maintenance = hasProject(options.root);
      const newer = maintenance && refuseUnreadSchema(/** @type {string} */ (options.root), ANY_SCHEMA_VERSION);
      return newer || keptCard(args, options, maintenance);
    },
  },

  // The smoke test of a model label (lib/init-smoke.mjs): without `--reply` it starts one, writing the
  // brief and the prompt into the run dir (made when `--dir` names none, or a path not there yet);
  // with `--reply <file>` it judges the reply the agent saved and records the outcome in the run dir
  // the start used. `inherit` is never smoke-tested.
  smoke: {
    options: { model: "value", reply: "value", dir: "value" },
    usage: "--model <label> [--reply <file>] [--dir <run-dir>]",
    /**
     * @param {string[]} args
     * @param {CommandContext & { model?: string, reply?: string }} ctx
     * @returns {CommandResult}
     */
    run(args, { model, reply, dir }) {
      if (args.length) return refuse("smoke_arguments", { options: Object.keys(/** @type {OptionSpec} */ (ACTIONS.smoke.options)) });
      if (model === undefined) return refuse("smoke_no_model");
      if (!isModelLabel(model)) return refuse("smoke_not_label", { model });
      if (model === FALLBACK) return refuse("smoke_fallback");
      if (reply === undefined) {
        const run = /** @type {InitNewRunDir} */ (newRunDir(dir, "qa-init-"));
        if (run.error) return refuse("run_dir", { reason: run.error });
        const at = (/** @type {() => string} */ (run.make))();
        return { json: { ok: true, dir: at, model, ...startSmoke(at, model) }, exit: 0 };
      }
      if (dir === undefined) return refuse("smoke_needs_dir", { model });
      const run = /** @type {InitOpenRunDir} */ (openRunDir(dir, { cmd: "init", action: "smoke", from: "init smoke" }));
      if (run.error) return refuse("run_dir", { reason: run.error });
      if (!smokeStarted(/** @type {string} */ (run.dir), model)) return refuse("smoke_not_started", { model });
      const outcome = judgeSmoke(/** @type {string} */ (run.dir), model, resolve(reply));
      return { json: { ok: outcome.ok, dir: run.dir, model, ...(!outcome.ok && { reason: outcome.reason, ...(outcome.excerpt !== undefined && { excerpt: outcome.excerpt }) }) }, exit: outcome.ok ? 0 : 1 };
    },
  },

  // `--add-role <name>...`: skips the scan and the card, validates locally and writes. Adding a role
  // orphans nothing, so it needs no approval.
  "add-role": {
    options: { root: "qa-dir?" },
    usage: "<name>... [--root <qa-dir>]",
    /**
     * @param {string[]} args
     * @param {CommandContext} ctx
     * @returns {CommandResult}
     */
    run(args, { root }) {
      if (args.length === 0) return refuse("role_names");
      if (args.some((a) => !a.trim())) return refuse("blank_role");
      const ctx = load(root);
      const path = ctx.repoPath("project.md");
      if (!ctx.project) return refuse("no_project", { path }, 1);
      const newer = refuseUnreadSchema(/** @type {string} */ (root), ANY_SCHEMA_VERSION);
      if (newer) return newer;
      const current = readProject(ctx);
      if (current.problem) return refuse("project_unreadable", { lines: current.problem.lines }, 1);
      // A `roles` that is no list is repaired on the card, never overwritten here.
      if (current.data.roles !== undefined && !Array.isArray(current.data.roles)) {
        const { errors } = checkAt(ctx, path);
        if (!errors.length) throw new Error("init: a `roles` that is no list passed its check");
        return refuse("add_role_check_file", { path, errors: errors.map(checkError) }, 1);
      }
      const roles = current.data.roles ?? [];
      const names = [...new Set(args.map((a) => a.trim()))];
      const added = names.filter((n) => !roles.includes(n));
      const already = names.filter((n) => roles.includes(n));
      const written = { path, added, already };
      if (!added.length) return { json: { ok: true, ...written, commit: null }, exit: 0 };
      const unwritable = added.filter((n) => line("roles", [n], { item: role }).error);
      if (unwritable.length) return refuse("role_unwritable", { path, names: unwritable }, 1);
      const text = editProject(current, new Map([["roles", [...roles, ...added]]]));
      if (text.error) throw new Error(`init: roles cannot be written: ${text.error}`);
      const check = checkAt(ctx, path, text.text);
      if (!check.ok) return refuse("add_role_check_file", { path, errors: check.errors.map(checkError) }, 1);
      const put = writeAll(ctx.repo, { writes: [{ path, text: text.text }] });
      if (put.error) return refuse("add_role_write_failed", { reason: put.reason }, 1);
      return { json: { ok: true, ...written, commit: commitLine([path], "qa: /qa-init --add-role") }, exit: 0 };
    },
  },
};

// Every refusal is `init`'s own, its usage errors included.
/** @type {CommandDefinition} */
export const command = { actions: ACTIONS, refuse: (e) => refuse(/** @type {string} */ (e.detail.code), e.detail) };


// The existing `project.md`, parsed (lib/knowledge-file.mjs), or `{problem}` (a refusal's `{code,
// lines}`) when `edit` cannot edit it in place (no frontmatter, or lines outside the dialect a
// rewrite could not preserve).
/**
 * @param {InitContext} ctx
 * @returns {ReadProjectResult}
 */
function readProject(ctx) {
  const file = parse("project.md", readFileSync(join(ctx.root, "project.md"), "utf8"));
  // A blank file is no `project.md` to edit in place, though `edit` would build one from nothing.
  const { ok, errors } = edit(file, []);
  return /** @type {ReadProjectResult} */ (ok && file.frontmatter ? file : { problem: { code: "project_unreadable", lines: errors.filter((e) => e.line).map((e) => e.line) } });
}

// `project.md` with top-level fields set (`undefined` removes one), every other line as it was,
// line endings included: unknown keys and the prose body are preserved (ADR-0008), and no
// knowledge file is touched.
/**
 * @param {ParsedProject} current
 * @param {Map<string, unknown>} fields
 * @returns {({ text: string, error?: undefined } | { error: string, text?: undefined })}
 */
function editProject(current, fields) {
  const r = /** @type {{ ok: true, text: string, message?: never } | { ok: false, message: string, text?: never }} */ (edit(current, [{ set: Object.fromEntries(fields) }]));
  return r.ok ? { text: r.text } : { error: r.message };
}

// `check-file` on the repo-relative `path`, its text read from disk unless `text` is given: found
// the way the CLI's `check-file <path>` finds it (lib/qa-index.mjs `locate`).
/**
 * @param {InitContext} ctx
 * @param {string} path
 * @param {string} [text]
 * @returns {{ ok: boolean, errors: Array<{ code: string, field: string, line?: number, message: string }>, warnings: Array<{ code: string }> }}
 */
function checkAt(ctx, path, text = readFileSync(join(ctx.repo, path), "utf8")) {
  const { rel, config } = locate(join(ctx.repo, path));
  return /** @type {InitFileCheck} */ (checkFile(parse(rel, text), config));
}

// Whether `.qa/` at `root` holds a `project.md`: maintenance, else a first run.
/**
 * @param {string} [root]
 * @returns {boolean}
 */
const hasProject = (root) => existsSync(join(resolve(/** @type {string} */ (root)), "project.md"));

// The `.qa/` directory at `root`, which need not exist yet, and the repository around it.
/**
 * @param {string} [root]
 * @param {string | null} [dir]
 * @returns {InitContext}
 */
function load(root, dir) {
  const abs = resolve(/** @type {string} */ (root));
  const repo = dirname(abs);
  return {
    root: abs,
    repo,
    dir: dir ?? null,
    project: hasProject(abs),
    repoPath: (rel) => relative(repo, join(abs, rel)).split(sep).join("/"),
  };
}

// ---------------------------------------------------------------------------------------------
// The card.

// A list of problems, each `{code, field?, ...data}`, and `problem`, which adds one.
/**
 * @returns {ProblemList}
 */
function problemList() {
  /** @type {InitProblem[]} */
  const problems = [];
  return { problems, problem: (code, field, data) => problems.push({ code, ...(field && { field }), ...data }) };
}

// The first-run card of `proposal`: `{ok, seal, items, stacks, files, snippet, notes, problems}`; `seal` is
// what a card is told apart by, missing when the proposal has no shape to build on. `edited` names the
// fields the engineer answered (`apply` only): their values need no evidence, since the engineer
// gave them.
/**
 * @param {InitContext} ctx
 * @param {InitProposal} proposal
 * @param {Set<string>} [edited]
 * @param {boolean} [rootDropped] An explicit drop suppresses the chosen-root fallback.
 * @returns {FirstBuildCardResult | InitUnbuilt}
 */
function buildCard(ctx, proposal, edited = new Set(), rootDropped = false) {
  const { problems, problem } = problemList();
  /** @type {Array<{ code: string, overlaps?: string[] }>} */
  const notes = [];
  if (!isMap(proposal) || !isMap(proposal.fields)) {
    problem("shape", undefined, { what: "proposal" });
    return { ok: false, problems };
  }

  const rows = fieldRows(proposal, problem, edited);
  /** @param {string} name */
  const value = (name) => rows.find((r) => r.field === name)?.value;

  const anyTracker = subfields("tracker").some((k) => value(`tracker.${k}`) !== undefined);
  const trackerRows = FIELDS.filter((f) => f.tracker && value(f.name) !== undefined);
  if (!anyTracker) {
    notes.push({ code: "no_tracker" });
  } else if (trackerRows.length < FIELDS.filter((f) => f.tracker).length) {
    problem("tracker_partial", undefined, { missing: FIELDS.filter((f) => f.tracker && value(f.name) === undefined).map((f) => f.name) });
  }
  if (!anyTracker && ["tracker_key_fn", "tracker_key_class"].some((k) => value(`annotation_map.${k}`) !== undefined)) {
    notes.push({ code: "tracker_key_without_tracker" });
  }

  const stacks = stackRows(ctx, proposal, value("module_paths"), problem, { ask: true });

  noDelegates(proposal, problem);
  const passed = new Set(subfields("tiers").map((k) => `tiers.${k}`).filter((f) => smokeTested(ctx, f, value(f), problem)));

  const date = localDate();
  const data = projectData(value);
  const chosen = stacks.find((s) => s.chosen);
  if (chosen && value("stack.root") === undefined && !rootDropped) Object.assign(/** @type {Record<string, unknown>} */ (data.stack), { root: chosen.root });
  /** @type {Array<{ path: string, text: string, check?: InitFileCheck }>} */
  const files = [{ path: ctx.repoPath("project.md"), text: projectText(data, date, stacks) }];
  for (const f of files) {
    f.check = checkAt(ctx, f.path, f.text);
    for (const w of f.check.warnings) if (w.code === "automation_key_overlap") notes.push({ code: w.code });
  }
  notes.push(...labelNotes(ctx, data));
  for (const f of files) if (!(/** @type {InitFileCheck} */ (f.check)).ok) problem("check_file", undefined, { path: f.path, errors: (/** @type {InitFileCheck} */ (f.check)).errors });

  const snippet = annotationSnippet(ctx, data);
  const items = cardItems(rows, stacks, proposal.chosen_by).map((i) => (passed.has(/** @type {string} */ (i.field)) ? { ...i, smokePassed: true } : i));
  const seal = { items, stacks, files: files.map(({ path, text }) => ({ path, text })) };
  return { ok: problems.length === 0, seal, items, stacks, files, snippet, notes, problems };
}

// The card's numbered items, in the card's order: the test stack, then each field row (the minting
// fields as one choice). The Fallback is always `inherit`, so it is no item; a Tier
// setting whose label passed its smoke test says so (`smokePassed`, set by `buildCard`). Each item says
// what the decisions may do with it:
//   edits    the answers it takes: `value` (a field), `stack` or `minting`
//   type     how a `value` is read: "list", "integer" or text
//   drop     "optional" (it may be dropped), or why not: "required", "default", "stack", "minting"
//   needs    the answers it must have (those of a question), unless it is dropped where it may be
/**
 * @param {Array<{ field: string, value: unknown, evidence: InitEvidence | null }>} rows
 * @param {InitStackRow[]} stacks
 * @param {string} [chosenBy]
 * @returns {FirstCardItem[]}
 */
function cardItems(rows, stacks, chosenBy) {
  /** @type {Array<Omit<InitFieldSource & { field: string }, "n" | "needs"> | Omit<InitStackSource, "n" | "needs"> | Omit<InitMintingSource, "n" | "needs">>} */
  const items = [];
  if (stacks.length) {
    const pick = stacks.find((s) => s.chosen);
    const quoted = pick !== undefined && Array.isArray(pick.guidance) && pick.guidance.length > 0 && chosenBy !== "human";
    items.push({ kind: "stack", label: "Test stack", edits: ["stack"], drop: "stack", question: stacks.length > 1 && !quoted, chosen: pick === undefined ? null : stacks.indexOf(pick), by: stacks.length === 1 ? "only" : quoted ? "guidance" : pick === undefined ? null : chosenBy === "human" ? "human" : "unquoted" });
  }
  /** @param {string} name */
  const row = (name) => rows.find((r) => r.field === name);
  for (const f of FIELDS) {
    // Who mints Automation keys is one item, where the first of its settings comes.
    if (f.name === (/** @type {InitFieldDefinition} */ (FIELDS.find((x) => MINTING_FIELDS.includes(x.name)))).name) {
      const given = Object.fromEntries(MINTING_FIELDS.filter(row).map((name) => [name, { value: (/** @type {{ field: string, value: unknown, evidence: InitEvidence | null }} */ (row(name))).value, evidence: (/** @type {{ field: string, value: unknown, evidence: InitEvidence | null }} */ (row(name))).evidence }]));
      const question = Object.values(given).some((g) => g.evidence?.asked === true);
      items.push({ kind: "minting", label: MINTING_LABEL, edits: ["minting"], drop: "minting", question, choice: givenOption(given), options: settledOptions(given), given });
    }
    if (MINTING_FIELDS.includes(f.name) || !row(f.name)) continue;
    const r = /** @type {{ field: string, value: unknown, evidence: InitEvidence | null }} */ (row(f.name));
    const drop = f.required ? "required" : f.default !== undefined ? "default" : "optional";
    items.push({ kind: "field", field: f.name, label: f.label, edits: ["value"], type: f.kind === "string" ? "text" : f.kind, drop, ...(f.default !== undefined && { default: f.default }), question: r.evidence?.asked === true, value: r.value ?? null, evidence: r.evidence });
  }
  return items.map((item, i) => ({ n: i + 1, ...item, needs: item.question ? item.edits : [] }));
}

// The test stacks the agent found, each `{root, language, framework, count, sample, last_commit?,
// guidance?: [{file, line?, quote}]}`, with the one `project.md` binds marked `chosen` (one
// stack per `.qa/`). Among several, the chosen one is the stack the repository's own guidance files
// name as primary, quoted, or the one the engineer picked (`chosen_by: "human"`); and every module
// path is a test root of that stack, so a legacy stack that also uses the tracker-key annotation
// is never bound by mistake. With `ask` (the first-run card), a stack not chosen
// that way is no problem: the card asks the engineer to choose it.
/**
 * @param {InitContext} ctx
 * @param {InitProposal} proposal
 * @param {unknown} modulePaths
 * @param {ProblemList["problem"]} problem
 * @param {{ ask?: boolean }} [param4]
 * @returns {InitStackRow[]}
 */
function stackRows(ctx, proposal, modulePaths, problem, { ask = false } = {}) {
  if (proposal.stacks === undefined) return [];
  if (!Array.isArray(proposal.stacks) || proposal.stacks.some((s) => !isMap(s) || typeof s.root !== "string" || !s.root.trim())) {
    problem("shape", undefined, { what: "stacks" });
    return [];
  }
  const roots = proposal.stacks.map((s) => posix.normalize(s.root.replace(/\/+$/, "")));
  const chosen = proposal.stacks.length === 1 ? roots[0] : typeof proposal.chosen_stack === "string" ? posix.normalize(proposal.chosen_stack.replace(/\/+$/, "")) : null;
  const rows = proposal.stacks.map((s, i) => ({ ...s, root: roots[i], chosen: roots[i] === chosen }));
  for (const s of rows) {
    const shown = ["language", "framework", "sample"].every((k) => typeof (/** @type {Record<string, unknown>} */ (s))[k] === "string" && (/** @type {string} */ ((/** @type {Record<string, unknown>} */ (s))[k])).trim()) && Number.isInteger(s.count) && (/** @type {number} */ (s.count)) >= 0;
    if (!shown) problem("stack_evidence", undefined, { root: s.root });
    for (const g of Array.isArray(s.guidance) ? s.guidance : []) {
      if (!quotes(ctx, g)) problem("guidance_unquoted", undefined, { root: s.root, quote: g?.quote ?? null, file: g?.file ?? null });
    }
  }
  const pick = rows.find((s) => s.chosen);
  if (proposal.stacks.length > 1 && !ask) {
    const quoted = Array.isArray(pick?.guidance) && pick.guidance.length > 0;
    if (!pick) problem("stack_not_chosen", undefined, { roots: rows.map((s) => s.root) });
    else if (!quoted && proposal.chosen_by !== "human") {
      problem("stack_not_chosen", undefined, { root: pick.root });
    }
  }
  if (pick && Array.isArray(modulePaths)) {
    /** @param {string} p @param {string} root */
    const under = (p, root) => root === "." || p === root || p.startsWith(`${root}/`);
    const outside = modulePaths.filter((p) => typeof p === "string" && !under(posix.normalize(p), pick.root));
    if (outside.length) {
      problem("module_path_outside_stack", "module_paths", { root: pick.root, outside });
    }
  }
  return rows;
}

// Whether guidance `{file, line?, quote}` quotes a file of the repository: the quote, whitespace
// collapsed, is within the file (at `line`, when given). The pre-selection rests on these words,
// so they are the file's own.
/**
 * @param {InitContext} ctx
 * @param {{ file: string, line?: number, quote: string }} g
 * @returns {boolean}
 */
function quotes(ctx, g) {
  if (!isMap(g) || typeof g.file !== "string" || typeof g.quote !== "string" || !g.quote.trim()) return false;
  const abs = resolve(ctx.repo, g.file);
  if (relative(ctx.repo, abs).startsWith("..") || !existsSync(abs) || !statSync(abs).isFile()) return false;
  /** @param {string} s */
  const flat = (s) => s.replace(/\s+/g, " ").trim();
  const text = readFileSync(abs, "utf8");
  const where = Number.isInteger(g.line) && (/** @type {number} */ (g.line)) >= 1 ? text.split("\n")[(/** @type {number} */ (g.line)) - 1] ?? "" : text;
  return flat(where).includes(flat(g.quote));
}

// A Tier's model is a label under `tiers` (ADR-0021): a proposal that lists Delegates to add is not
// in the card's shape.
/**
 * @param {InitProposal} proposal
 * @param {ProblemList["problem"]} problem
 * @returns {void}
 */
function noDelegates(proposal, problem) {
  if (proposal.delegates !== undefined) problem("shape", undefined, { what: "delegates" });
}

// Whether setting `field` holding `value` needs a passing smoke test (ADR-0021): a Tier
// setting naming a label other than `inherit`. A value that is no label at all is the file check's
// to report.
/**
 * @param {string} field
 * @param {unknown} value
 * @returns {boolean}
 */
const needsSmoke = (field, value) => field.startsWith("tiers.") && value !== FALLBACK && isModelLabel(/** @type {string} */ (value));

// Only a tested label goes on the card: whether `field`'s `label` passed its smoke test in the run
// dir (lib/init-smoke.mjs), adding the problem that keeps it off when it needs one and did not.
/**
 * @param {InitContext} ctx
 * @param {string} field
 * @param {unknown} label
 * @param {ProblemList["problem"]} problem
 * @returns {boolean}
 */
function smokeTested(ctx, field, label, problem) {
  if (!needsSmoke(field, label)) return false;
  const { passed, ...why } = smokeState(ctx.dir, /** @type {string} */ (label));
  if (!passed) problem("not_smoke_tested", field, { value: label, ...why, dir: ctx.dir !== null });
  return passed === true;
}

// One row per field of the card: the value and the evidence it came from.
/**
 * @param {InitProposal} proposal
 * @param {ProblemList["problem"]} problem
 * @param {Set<string>} edited
 * @returns {Array<{ field: string, value: unknown, evidence: InitEvidence | null }>}
 */
function fieldRows(proposal, problem, edited) {
  unknownFields(/** @type {Record<string, unknown>} */ (proposal.fields), problem);
  /** @type {Array<{ field: string, value: unknown, evidence: InitEvidence | null }>} */
  const rows = [];
  for (const f of FIELDS) {
    const given = (/** @type {Record<string, { value?: unknown, evidence?: InitEvidence | null }>} */ (proposal.fields))[f.name];
    if (given === undefined || given === null || given.value === undefined) {
      if (f.default !== undefined) rows.push({ field: f.name, value: f.default, evidence: { default: true } });
      else if (f.required) problem("missing", f.name);
      continue;
    }
    // An unanswered askable map is shown as a question, without a placeholder in project.md.
    const unanswered = f.askable === true && given.value === null && given.evidence?.asked === true;
    rows.push({ field: f.name, value: unanswered ? undefined : given.value, ...evidenceOf(f, given, problem, edited.has(f.name)) });
  }
  return rows;
}

/**
 * @param {Record<string, unknown>} fields
 * @param {ProblemList["problem"]} problem
 * @returns {void}
 */
function unknownFields(fields, problem) {
  for (const name of Object.keys(fields)) {
    if (!FIELD.has(name)) problem("unknown_field", name);
  }
}

// A proposed value's `{evidence, question?}`, reporting what makes the evidence unfit.
/**
 * @param {InitFieldDefinition} f
 * @param {{ value?: unknown, evidence?: InitEvidence | null }} given
 * @param {ProblemList["problem"]} problem
 * @param {boolean} edited
 * @returns {{ evidence: InitEvidence | null, question?: boolean }}
 */
function evidenceOf(f, given, problem, edited) {
  const evidence = given.evidence ?? null;
  const why = edited ? null : evidenceProblem(evidence, f);
  if (why) problem("no_evidence", f.name, { why });
  // The vocabulary is the tracker's Role field; `@Test.User` is who a test runs as.
  else if (f.fromTracker && (/** @type {InitEvidence} */ (evidence)).file !== undefined) {
    problem("roles_from_code", f.name, { file: (/** @type {InitEvidence} */ (evidence)).file });
  }
  return { evidence, ...(evidence?.asked === true && { question: true }) };
}

// Why a field's evidence is not what the card needs (`none`, `no_default`, `not_picked` or
// `incomplete`), or null
// (every proposed value carries file + count + sample; a value nothing in the repository
// shows is asked).
/**
 * @param {InitEvidence | null} e
 * @param {InitFieldDefinition} f
 * @returns {"none" | "no_default" | "not_picked" | "incomplete" | null}
 */
function evidenceProblem(e, f) {
  if (!isMap(e)) return "none";
  if ((/** @type {InitEvidence} */ (e)).asked === true) return null;
  if ((/** @type {InitEvidence} */ (e)).default === true) return f.default !== undefined ? null : "no_default";
  if ((/** @type {InitEvidence} */ (e)).picked === true) return f.picked ? null : "not_picked";
  const counted = Number.isInteger((/** @type {InitEvidence} */ (e)).count) && (/** @type {number} */ ((/** @type {InitEvidence} */ (e)).count)) >= 0 && typeof (/** @type {InitEvidence} */ (e)).sample === "string" && (/** @type {InitEvidence} */ (e)).sample.trim() !== "";
  if (typeof (/** @type {InitEvidence} */ (e)).file === "string" && (/** @type {InitEvidence} */ (e)).file.trim() && counted) return null;
  if (typeof (/** @type {InitEvidence} */ (e)).tracker === "string" && (/** @type {InitEvidence} */ (e)).tracker.trim() && counted) return null;
  return "incomplete";
}

// `project.md`'s frontmatter data from the card's values.
/**
 * @param {(name: string) => unknown} value
 * @returns {Record<string, unknown>}
 */
function projectData(value) {
  /** @type {Record<string, unknown>} */
  const d = { type: "project", key: "project", schema_version: INIT_SCHEMA_VERSION };
  d.stack = { language: value("stack.language"), framework: value("stack.framework"), levels: value("stack.levels"), ...(value("stack.root") !== undefined && { root: value("stack.root") }) };
  // The given subfields of one map, in the card's order.
  /** @param {string} name */
  const map = (name) => Object.fromEntries(subfields(name).filter((k) => value(`${name}.${k}`) !== undefined).map((k) => [k, value(`${name}.${k}`)]));
  const tracker = map("tracker");
  // A partial tracker is the card's `tracker_partial` problem, not a second one from check-file.
  if (FIELDS.filter((f) => f.tracker).every((f) => tracker[f.name.slice("tracker.".length)] !== undefined)) d.tracker = tracker;
  d.annotation_map = map("annotation_map");
  for (const f of FIELDS) if (f.persist && value(f.name) !== undefined) d[f.name] = value(f.name);
  d.module_paths = value("module_paths");
  const roles = value("roles");
  if (Array.isArray(roles) ? roles.length : roles !== undefined) d.roles = roles;
  // An empty list of labels is no label: the file omits it.
  for (const name of LABEL_KEYS) {
    const given = value(name);
    if (given !== undefined && !(Array.isArray(given) && !given.length) && !(isMap(given) && !Object.keys(given).length)) d[name] = given;
  }
  d.concurrency_cap = value("concurrency_cap");
  const tiers = map("tiers");
  if (Object.keys(tiers).length) d.tiers = tiers;
  return d;
}

/**
 * @param {Array<[string, unknown, (import("./render.mjs").RenderOptions & { blockList?: boolean })?]>} entries
 * @returns {string}
 */
function frontmatter(entries) {
  const out = [];
  for (const [field, value, options] of entries) {
    if (value === undefined) continue;
    const r = options?.blockList && Array.isArray(value) ? block(field, value, options) : line(field, value, options);
    out.push(r.error ? `${field}: ${safeInline(value)}` : r.text);
  }
  return out.join("\n");
}

// A value the dialect cannot hold still renders, so `check-file` reports it on the card.
/**
 * @param {unknown} value
 * @returns {string}
 */
function safeInline(value) {
  try {
    return inline(value);
  } catch {
    return JSON.stringify(value);
  }
}

/**
 * @param {Record<string, unknown>} d
 * @param {string} date
 * @param {InitStackRow[]} stacks
 * @returns {string}
 */
function projectText(d, date, stacks) {
  const fm = frontmatter([
    ["type", d.type],
    ["key", d.key],
    ["schema_version", d.schema_version],
    ["stack", d.stack],
    ["tracker", d.tracker],
    ["annotation_map", d.annotation_map],
    ["automation_key_pattern", d.automation_key_pattern],
    ["automation_key_mint", d.automation_key_mint],
    ["module_paths", d.module_paths],
    ["roles", d.roles, { item: role }],
    ["role_meaning", d.role_meaning],
    ["tags", d.tags],
    ["retired_tags", d.retired_tags],
    ["custom_fields", d.custom_fields, { blockList: true, strings: FIELD_RENDER.project.custom_fields.quoted }],
    ["bug_fields", d.bug_fields, { blockList: FIELD_RENDER.project.bug_fields.blockList }],
    ["concurrency_cap", d.concurrency_cap],
    ["tiers", d.tiers],
    ["targets", d.targets],
    ["execute_levels", d.execute_levels],
    ["test_runner", d.test_runner],
    ["code_host", d.code_host],
  ]);
  const body = [`Written by \`/qa-init\` on ${date} from evidence in this repository, and accepted on its card.`];
  const pick = stacks.find((s) => s.chosen);
  const others = stacks.filter((s) => !s.chosen);
  if (pick && others.length) {
    const why = (pick.guidance ?? []).filter((g) => isMap(g) && typeof g.quote === "string" && g.quote.trim()).map((g) => `${g.file}: "${g.quote.trim()}"`);
    body.push(`One test stack per \`.qa/\`: this one binds \`${pick.root}\`${why.length ? `, which the repository's guidance names as primary (${why.join("; ")})` : ", picked by the engineer"}.`);
    body.push(`Other test stacks in this repository, not bound here: ${others.map((s) => `\`${s.root}\` (${s.language ?? "?"}, ${s.framework ?? "?"})`).join(", ")}.`);
  }
  return `---\n${fm}\n---\n\n# Project\n\n${body.join("\n\n")}\n`;
}

// The note for Custom-field values that repeat a Coverage category key, or none.
/**
 * @param {InitContext} ctx
 * @param {Record<string, unknown>} data
 * @returns {Array<{ code: string, overlaps?: string[] }>}
 */
function labelNotes(ctx, data) {
  const overlaps = categoryOverlaps(ctx.root, data);
  return overlaps.length ? [{ code: "label_repeats_category", overlaps }] : [];
}

// The Automation-key carrier's declaration, reported and never written: it ships in the reviewed
// binding PR. `status` is the stack adapter's (lib/stack.mjs `declaration.state`):
// `declared` or `imported` need nothing. A stack whose carriers need no declaration has none (null).
/**
 * @param {InitContext} ctx
 * @param {Record<string, unknown>} data
 * @returns {InitAnnotationSnippet | null}
 */
function annotationSnippet(ctx, data) {
  const cfg = /** @type {{ stack: { language: string, framework: string }, modulePaths?: string[], annotationMap?: Record<string, string[]> }} */ (projectConfig({ data }));
  const [name] = Array.isArray((/** @type {{ automation_key?: unknown }} */ (data.annotation_map)).automation_key) ? (/** @type {{ automation_key?: unknown }} */ (data.annotation_map)).automation_key : [];
  if (typeof name !== "string") return null;
  // The configuration this card proposes, so its own stack, resolved for the repository.
  const { adapter, unavailable } = resolveAdapter(cfg.stack, ctx.repo);
  if (unavailable) return { status: "unavailable", annotation: name, language: cfg.stack.language, framework: cfg.stack.framework, message: unavailable.message, fix: unavailable.fix, words: wordsOf(null) };
  if (!adapter) return { status: "no_scanner", annotation: name, language: cfg.stack?.language, framework: cfg.stack?.framework, words: wordsOf(null) };
  if (!adapter.needsDeclaration) return { status: "none_needed", annotation: name, words: adapter.words };
  const { declaration } = adapter;
  const state = declaration.state({ repo: ctx.repo, config: cfg });
  if (state.status !== "missing") return { status: state.status, annotation: name, ...(state.path && { path: state.path }), home: state.home, words: adapter.words };
  const { home } = state.proposed;
  return { status: "missing", annotation: name, path: state.proposed.path, home, text: declaration.text(home, name), ...declaration.snippet, words: adapter.words };
}

// First-run and maintenance Cards share the sealed lifecycle, with their own builders and writes.
/**
 * @param {boolean} maintenance
 * @returns {CardLifecycle<InitContext, InitProposal, FirstBuildCardResult | MaintenanceBuildCardResult, Record<string, unknown>>}
 */
function lifecycle(maintenance) {
  return cardRun(/** @type {CardAdapter<InitContext, InitProposal, FirstBuildCardResult | MaintenanceBuildCardResult, Record<string, unknown>>} */ ({
    kind: maintenance ? "init-maintenance" : "init", run: { by: "init card", restart: "init card" }, fact,
    build(ctx, proposal) {
      const built = /** @type {FirstBuildCardResult | MaintenanceBuildCardResult} */ (maintenance ? buildMaintenance(ctx, proposal) : buildCard(ctx, proposal));
      return { card: built, seal: built.seal, ...(!built.ok && { refused: refusals(built.problems) }) };
    },
    data: (ctx, built) => maintenance ? maintenanceCardData({ ...(/** @type {MaintenanceBuildCardResult} */ (built)), notes: withNotes((/** @type {MaintenanceBuildCardResult} */ (built)).notes) }) : firstCardData({ ...(/** @type {FirstBuildCardResult} */ (built)), notes: withNotes((/** @type {FirstBuildCardResult} */ (built)).notes) }, fieldLabelOf),
    decisions: (ctx, built, input) => { const decisions = decisionsOf(JSON.stringify(input), (/** @type {FirstBuildCardResult} */ (built)).items, maintenance); return { ...decisions, errors: (/** @type {InitDecisionError[]} */ (decisions.errors)).map(refusalOf) }; },
    apply(ctx, built, decisions, proposal) {
      const out = maintenance ? maintenanceApply(ctx, (/** @type {MaintenanceBuildCardResult} */ (built)), /** @type {InitDecisions} */ (decisions), proposal) : firstApply(ctx, (/** @type {FirstBuildCardResult} */ (built)), /** @type {InitDecisions} */ (decisions), proposal);
      return /** @type {CardApplyOut<Record<string, unknown>>} */ ({ ...out, message: "qa: /qa-init", data: out.refused ? (out.cause ? { cause: out.cause } : {}) : { applied: out.applied, dropped: out.dropped } });
    },
  }));
}

// A problem as a refusal: its setting named by label, and by item number on a card that was shown.
/**
 * @param {InitProblem} p
 * @param {Array<FirstCardItem | MaintenanceCardItem>} [items]
 * @returns {RefusalFact}
 */
function situate(p, items = []) {
  const out = { ...p };
  if (FIELD.has(/** @type {string} */ (p.field))) {
    const item = items.find((i) => (i.kind === "field" && i.field === p.field) || (i.kind === "minting" && MINTING_FIELDS.includes(/** @type {string} */ (p.field))));
    Object.assign(out, { label: MINTING_FIELDS.includes(/** @type {string} */ (p.field)) && item ? MINTING_LABEL : fieldLabelOf(/** @type {string} */ (p.field)), ...(item && { item: item.n }) });
  }
  if (p.missing) out.missing = p.missing.map(fieldLabelOf);
  if (p.errors) out.errors = (/** @type {Array<{ code: string, field: string, line?: number, message: string }>} */ (p.errors)).map(checkError);
  return refusalOf(out);
}
/**
 * @param {InitProblem[]} problems
 * @param {Array<FirstCardItem | MaintenanceCardItem>} [items]
 * @returns {RefusalFact[]}
 */
const refusals = (problems, items) => problems.map((p) => situate(p, items));

// A check error of a file, its setting named by label and its line kept apart from the factual line.
/**
 * @param {{ code: string, field: string, line?: number, message: string }} param0
 * @returns {InitCheckError}
 */
const checkError = ({ code, field, line: at, message }) => ({ code, ...(FIELD.has(field) && { label: fieldLabelOf(field) }), ...(at !== undefined && { at_line: at }), message });

// The cards shown say when the machine has no `playwright-cli`, or one too old for `/qa-execute`,
// which it and the UI scout behind `/qa-deep-dive`'s `observe:` drive. Only a card shows it, so
// neither the digest nor the report holds it.
/**
 * @returns {Array<{ code: string }>}
 */
const playwrightNotes = () => {
  if (!onPath("playwright-cli")) return [{ code: "no_playwright_cli" }];
  return playwrightCliVersion().status === "old" ? [{ code: "old_playwright_cli" }] : [];
};
/**
 * @param {Array<{ code: string }>} notes
 * @returns {Array<{ code: string }>}
 */
const withNotes = (notes) => [...notes, ...playwrightNotes()];

// The card of the proposal on stdin: the maintenance card when `maintenance`, else the first run's.
/**
 * @param {string[]} args
 * @param {{ root?: string, stdin?: (() => string) | null, dir?: string }} param1
 * @param {boolean} maintenance
 * @returns {CommandResult}
 */
function showCard(args, { root, stdin, dir }, maintenance) {
  if (args.length) return refuse("bad_arguments", { action: "card" });
  // The proposal is read from stdin only with `--stdin`.
  if (!stdin) return refuse("no_proposal");
  let proposal;
  try {
    proposal = /** @type {InitProposal} */ (JSON.parse(stdin()));
  } catch {
    return refuse("proposal_not_json");
  }
  const run = /** @type {InitEitherRunDir} */ (dir === undefined ? newRunDir(undefined, "qa-init-") : openRunDir(dir, { cmd: "init", action: "card", from: ["init smoke", "init card"] }));
  if (run.error) return refuse("run_dir", { reason: run.error });
  const { exit, ...json } = lifecycle(maintenance).card(load(/** @type {string} */ (root), run.dir), /** @type {string | (() => string)} */ (run.dir ?? run.make), proposal);
  if (!json.ok) delete (/** @type {{ rebuild?: boolean }} */ (json)).rebuild;
  return { exit, json };
}

// Apply decisions against the sealed Card, then return the write report or pending confirmation.
/**
 * @param {string[]} args
 * @param {{ root?: string, dir?: string, stdin?: (() => string) | null }} param1
 * @param {boolean} maintenance
 * @returns {CommandResult}
 */
function keptCard(args, { root, dir, stdin }, maintenance) {
  if (args.length) return refuse("bad_arguments", { action: "apply" });
  if (dir === undefined) return refuse("needs_dir");
  if (!stdin) return refuse("apply_needs_stdin");
  const run = /** @type {InitOpenRunDir} */ (openRunDir(dir, { cmd: "init", action: "apply", from: "init card" }));
  if (run.error) return refuse("run_dir", { reason: run.error });
  const { exit, ...json } = lifecycle(maintenance).apply(load(root, run.dir), /** @type {string} */ (run.dir), stdin());
  if (exit === 2) return { exit, json: { ok: false, refusals: (/** @type {CardRefused} */ (json)).refusals } };
  return { exit, json: { dir: run.dir, ...(!json.ok && { confirm: false, rebuild: false }), ...json } };
}

// The first-run decisions `d`, applied to the `built` card. Every item is written as the card shows it
// unless dropped, so an item neither taken nor dropped is open, and a taken question needs its answer.
/**
 * @param {InitContext} ctx
 * @param {FirstBuildCardResult} built
 * @param {InitDecisions} d
 * @param {InitProposal} input
 * @returns {InternalApplyResult}
 */
function firstApply(ctx, built, d, input) {
  const errors = [];
  const itemOf = new Map(built.items.map((i) => [i.n, i]));
  for (const n of d.drop) if ((/** @type {FirstCardItem} */ (itemOf.get(n))).drop !== "optional") errors.push({ code: "not_droppable", item: n, why: (/** @type {FirstCardItem} */ (itemOf.get(n))).drop });
  const open = built.items.filter((i) => !d.drop.includes(i.n) && !d.take.includes(i.n)).map((i) => i.n);
  if (open.length) errors.push({ code: "unaddressed", items: open });
  for (const n of d.take) for (const field of (/** @type {FirstCardItem} */ (itemOf.get(n))).needs) if (!(field in (d.edits[n] ?? {}))) errors.push({ code: "needs_edit", item: n, field });
  for (const [n, e] of Object.entries(d.edits)) {
    if (e.stack !== undefined && !built.stacks.some((s) => s.root === e.stack)) errors.push({ code: "no_such_stack", item: Number(n), given: e.stack });
    if (e.minting !== undefined && !MINTING.some((o) => o.k === e.minting)) errors.push({ code: "no_such_option", item: Number(n), given: e.minting });
    else if (e.minting !== undefined && !(/** @type {InitMintingSource} */ (itemOf.get(Number(n)))).options.includes(/** @type {number} */ (e.minting))) errors.push({ code: "minting_unsettled", item: Number(n), option: e.minting });
  }
  if (errors.length) return { refused: errors.map(refusalOf) };

  const { proposal, edited } = answered(input, built, d);
  const rootDropped = built.items.some((i) => i.field === "stack.root" && d.drop.includes(i.n));
  const final = buildCard(ctx, proposal, edited, rootDropped);
  if (!final.ok) {
    // Problems the shown card already had come from the repository; any other, from the answers.
    const fromShown = final.problems.every((p) => built.problems.some((q) => isDeepStrictEqual(p, q)));
    return { refused: refusals(final.problems, built.items), cause: fromShown ? "repository" : "answers" };
  }
  const stack = { language: (/** @type {{ value: string }} */ (final.items.find((i) => i.field === "stack.language"))).value, framework: (/** @type {{ value: string }} */ (final.items.find((i) => i.field === "stack.framework"))).value };
  const notes = [...final.notes, { code: "commit_before_persist" }];
  return {
    applied: built.items.filter((i) => !d.drop.includes(i.n)).map((i) => i.n),
    dropped: d.drop,
    changeset: { writes: final.files.map(({ path, text }) => ({ path, text })) },
    report: (commit) => ({ files: final.files.map((f) => f.path), commit, snippet: final.snippet && { ...final.snippet, ...stack }, notes: notes.map(noteOf), glossary: glossaryOf(notes.flatMap((n) => NOTES[n.code].term ?? [])) }),
  };
}

// The proposal as the decisions answer it, with the fields the engineer answered (`edited`): a value
// given for a field, a field dropped, a test stack chosen, and who mints Automation keys chosen among
// the options the interview settled.
/**
 * @param {InitProposal} proposal
 * @param {FirstBuildCardResult} card
 * @param {InitDecisions} d
 * @returns {{ proposal: InitProposal, edited: Set<string> }}
 */
function answered(proposal, card, d) {
  const fields = { ...proposal.fields };
  /** @type {Set<string>} */
  const edited = new Set();
  const out = { ...proposal, fields };
  for (const item of card.items) {
    const e = d.edits[item.n] ?? {};
    if (d.drop.includes(item.n)) delete fields[/** @type {string} */ (item.field)];
    if (e.value !== undefined) {
      fields[/** @type {string} */ (item.field)] = { value: e.value, evidence: { edited: true } };
      edited.add(/** @type {string} */ (item.field));
    }
    if (e.stack !== undefined) Object.assign(out, { chosen_stack: e.stack, chosen_by: "human" });
    if (e.minting !== undefined) for (const o of MINTING) if (o.k !== e.minting) for (const f of o.fields) delete fields[f];
  }
  return { proposal: out, edited };
}

// ---------------------------------------------------------------------------------------------
// Maintenance: `card` and `apply` on an existing `project.md`.
//
// The proposal is fresh detection, held to the first run's evidence rules, but only for the fields
// the agent re-read: a field left out keeps its value, and no default stands in for it. The card
// shows the current file's check errors, every setting as the file holds it and, where detection
// disagrees, the detected value with its evidence. Every item stays as it is unless the decisions
// name it: `adopt`, a `value` edit or `drop`.
//
// One rule for every field but `type` and `key`: a change that would cause Integrity errors (the
// ones `scan` would newly report against the rest of `.qa/`, plus the key annotations in the code
// that would not be read) is written only once the decisions confirm it (`confirm`), and init never
// rewrites knowledge to follow it. `retired_features` is no field of the card, so it is never
// touched. `project.md` is edited in place: every line but a changed field's stays as it was.

// A field's value in `project.md`'s data, or undefined.
/**
 * @param {Record<string, unknown>} data
 * @param {string} name
 * @returns {unknown}
 */
function valueAt(data, name) {
  const [head, sub] = name.split(".");
  if (sub === undefined) return data[head];
  return isMap(data[head]) ? (/** @type {Record<string, unknown>} */ (data[head]))[sub] : undefined;
}

// One map of `project.md` rebuilt with its card subfields set: the card's order first (for
// `tiers`, `{deep?, standard?, light?}`), then any other key as it was.
/**
 * @param {Record<string, unknown>} base
 * @param {string} head
 * @param {(name: string) => unknown} value
 * @returns {Record<string, unknown>}
 */
function rebuildMap(base, head, value) {
  const order = head === "tiers" ? TIERS : subfields(head);
  /** @type {Record<string, unknown>} */
  const map = isMap(base[head]) ? { ...(/** @type {Record<string, unknown>} */ (base[head])) } : {};
  for (const k of subfields(head)) {
    const v = value(`${head}.${k}`);
    if (v === undefined) delete map[k];
    else map[k] = v;
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of order) if (Object.hasOwn(map, k)) out[k] = map[k];
  for (const [k, v] of Object.entries(map)) if (!Object.hasOwn(out, k)) out[k] = v;
  return out;
}

// The new value of each top-level field `heads` names, given each card field's value.
/**
 * @param {Record<string, unknown>} base
 * @param {string[]} heads
 * @param {(name: string) => unknown} value
 * @returns {Map<string, unknown>}
 */
function tops(base, heads, value) {
  const out = new Map();
  for (const head of heads) {
    if (subfields(head).length === 0) {
      out.set(head, value(head));
      continue;
    }
    const map = rebuildMap(base, head, value);
    // A tracker is all four fields or none: with none, a trackerless project omits it.
    out.set(head, head === "tracker" && Object.keys(map).length === 0 ? undefined : map);
  }
  return out;
}

/**
 * @param {string} name
 * @returns {string}
 */
const headOf = (name) => name.split(".")[0];

// `project.md`'s text (`current.text`) with one field set to `value`, every other as `data` holds
// it: `{text}`, or `{error}` when the value cannot be written.
/**
 * @param {ParsedProject} current
 * @param {Record<string, unknown>} data
 * @param {string} name
 * @param {unknown} value
 * @returns {({ text: string, error?: undefined } | { error: string, text?: undefined })}
 */
const withField = (current, data, name, value) => editProject(current, tops(data, [headOf(name)], (n) => (n === name ? value : valueAt(data, n))));

// What `project.md` reading `text` instead of the baseline's text would do (`{errors, unread}`):
// the Integrity errors `scan` newly reports against the rest of `.qa/`, and the key annotations in
// the code that would not be read (a dropped annotation name or module path, or a stack no
// scanner reads).
/**
 * @param {InitContext} ctx
 * @param {InitReferrers} baseline
 * @param {string} text
 * @returns {MaintenanceEffect}
 */
function effectOf(ctx, baseline, text) {
  const after = referrers(ctx, text);
  return { errors: newResults(baseline.scan, after.scan), unread: unread(baseline.annotations, after.annotations) };
}
/**
 * @param {MaintenanceEffect} effect
 * @returns {{ errors: number, unread: number }}
 */
const counts = (effect) => ({ errors: effect.errors.length, unread: effect.unread.length });

// What a `project.md` reading `text` resolves: its scan, and every key annotation the code index
// reads under its `stack`, `module_paths` and `annotation_map`.
/**
 * @param {InitContext} ctx
 * @param {string} text
 * @returns {InitReferrers}
 */
function referrers(ctx, text) {
  const cfg = projectConfig(parse("project.md", text));
  const { adapter } = resolveAdapter(cfg.stack, ctx.repo);
  /** @type {InitAnnotation[]} */
  const annotations = [];
  if (adapter) {
    const code = buildCodeIndex(ctx.repo, cfg.modulePaths, cfg.annotationMap, adapter, keyPatterns(cfg));
    /**
     * @param {string} role
     * @param {{ file: string }} owner
     * @param {string} name
     * @param {Array<{ key: string, line: number }>} keys
     */
    const read = (role, owner, name, keys) => keys.forEach(({ key, line: at }) => annotations.push({ role, file: owner.file, line: at, key, name }));
    for (const fn of code.functions) {
      read("automation_key", fn, fn.name, fn.automationKeys);
      read("tracker_key_fn", fn, fn.name, fn.trackerKeys);
    }
    for (const c of code.classes) read("tracker_key_class", c, c.path, c.trackerKeys);
  }
  return { scan: scan(ctx.root, /** @type {Parameters<typeof scan>[1]} */ ({ project: text })), annotations };
}

// The annotations read `before` and not `after`.
/**
 * @param {Array<{ role: string, file: string, line: number, key: string }>} before
 * @param {Array<{ role: string, file: string, line: number, key: string }>} after
 * @returns {InitAnnotation[]}
 */
function unread(before, after) {
  /** @param {{ role: string, file: string, line: number, key: string }} a */
  const id = (a) => JSON.stringify([a.role, a.file, a.line, a.key]);
  const still = new Set(after.map(id));
  return /** @type {InitAnnotation[]} */ (before.filter((a) => !still.has(id(a))));
}

// The Integrity errors of scan `after` that scan `before` does not have, counted as a multiset by
// where and what they are (not by message). Only the rest of `.qa/` counts: not `project.md`'s own
// errors, and not a binding proposal beside one, which would count it twice.
/**
 * @param {InitScan} before
 * @param {InitScan} after
 * @returns {InitScanResult[]}
 */
function newResults(before, after) {
  /** @param {InitScanResult} r */
  const id = (r) => JSON.stringify([r.kind, r.code, r.file ?? null, r.line ?? null, r.key ?? null, r.field ?? null, r.automation ?? null, r.function ? `${r.function.file}:${r.function.line}` : null]);
  /** @param {InitScanResult} r */
  const referrer = (r) => r.kind === "integrity_error" && r.file !== "project.md";
  const seen = new Map();
  for (const r of before.results.filter(referrer)) seen.set(id(r), (seen.get(id(r)) ?? 0) + 1);
  const out = [];
  for (const r of after.results.filter(referrer)) {
    const n = seen.get(id(r)) ?? 0;
    if (n > 0) seen.set(id(r), n - 1);
    else out.push(r);
  }
  return out;
}

// `.qa/`'s summaries, for the labels that name a key with its summary.
/**
 * @param {InitContext} ctx
 * @returns {import("./labels.mjs").SummariesLookup}
 */
const qaSummaries = (ctx) => summaries(buildIndex(loadWorkingTree(ctx.root)));

// The maintenance card of `proposal`: `{ok, seal, items, check, notes, problems}`, and what
// `apply` builds on (`current`, `data`). Every item says what the decisions may do with it:
//   edits    "value" when a value may be given for it, else none
//   drop     "optional" (it may be dropped), or why not: "required", "default", "unset" (the file
//            does not hold it)
//   adopt    whether `adopt` takes what the card proposes: a detected value that disagrees
//   effect   what adopting it would cause (`{errors, unread}`, counts), where it may be adopted
/**
 * @param {InitContext} ctx
 * @param {InitProposal} proposal
 * @returns {MaintenanceBuildCardResult | InitUnbuilt}
 */
function buildMaintenance(ctx, proposal) {
  const { problems, problem } = problemList();
  const current = readProject(ctx);
  if (current.problem) return { ok: false, problems: [{ code: "project_unreadable", lines: current.problem.lines }] };
  if (!isMap(proposal) || !isMap(proposal.fields)) {
    problem("shape", undefined, { what: "proposal" });
    return { ok: false, problems };
  }
  const path = ctx.repoPath("project.md");
  const data = current.data;
  let before = null;
  const baseline = () => (before ??= referrers(ctx, current.text));

  unknownFields(/** @type {Record<string, unknown>} */ (proposal.fields), problem);
  /** @type {Array<Omit<MaintenanceCardItem, "n"> & { effect?: { errors: number, unread: number }, detected?: unknown }>} */
  const items = [];
  for (const f of FIELDS) {
    const cur = valueAt(data, f.name);
    // A setting the file does not hold and nothing proposes (publish setup, labels) is no item.
    if ((f.publish || f.sparse || LABEL_KEYS.includes(f.name)) && cur === undefined && (!proposal.fields || proposal.fields[f.name] === undefined)) continue;
    const drop = f.required ? "required" : f.default !== undefined ? "default" : cur === undefined ? "unset" : "optional";
    /** @type {Omit<MaintenanceCardItem, "n"> & { effect?: { errors: number, unread: number }, detected?: unknown }} */
    const item = { kind: "field", field: f.name, label: f.label, edits: f.editable === false ? [] : ["value"], type: f.kind === "string" ? "text" : f.kind, drop, adopt: false, ...(cur !== undefined && { current: cur }) };
    const given = (/** @type {Record<string, { value?: unknown, evidence?: InitEvidence | null }>} */ (proposal.fields))[f.name];
    if (isMap(given) && (/** @type {{ value?: unknown }} */ (given)).value !== undefined) {
      Object.assign(item, { detected: (/** @type {{ value: unknown }} */ (given)).value, evidence: evidenceOf(f, given, problem, false).evidence });
      item.adopt = !isDeepStrictEqual((/** @type {{ value: unknown }} */ (given)).value, cur);
      if (item.adopt) smokeTested(ctx, f.name, /** @type {string} */ ((/** @type {{ value: unknown }} */ (given)).value), problem);
    }
    if (item.adopt) {
      const text = withField(current, data, f.name, item.detected);
      if (text.error) problem("unwritable", f.name, { value: item.detected });
      else item.effect = counts(effectOf(ctx, baseline(), (/** @type {{ text: string }} */ (text)).text));
    }
    items.push(item);
  }
  stackRows(ctx, proposal, undefined, problem);
  noDelegates(proposal, problem);
  const numbered = items.map((item, i) => (/** @type {MaintenanceCardItem} */ ({ n: i + 1, ...item })));
  const checked = checkAt(ctx, path);
  const check = checked.errors;
  const notes = [...checked.warnings.filter((w) => w.code === "automation_key_overlap").map(({ code }) => ({ code })), ...labelNotes(ctx, data)];
  const seal = { items: numbered, check, text: current.text, problems };
  return { ok: problems.length === 0, seal, items: numbered, check: check.map(checkError), notes, problems, current, data };
}

// The maintenance decisions `d`, applied to the `built` card. The steps run in this order, each stopping
// the apply with nothing written:
//   1. what the decisions may name: a drop of an item that cannot be dropped, an adoption of one with
//      nothing to adopt;
//   2. each change and what it would cause on its own;
//   3. the whole write, validated before anything is written;
//   4. an issued confirmation before a change that causes Integrity errors is written.
/**
 * @param {InitContext} ctx
 * @param {MaintenanceBuildCardResult} built
 * @param {InitDecisions} d
 * @param {InitProposal} proposal
 * @returns {InternalApplyResult}
 */
function maintenanceApply(ctx, built, d, proposal) {
  const itemOf = new Map(built.items.map((i) => [i.n, i]));
  const errors = [];
  for (const n of d.drop) if ((/** @type {MaintenanceCardItem} */ (itemOf.get(n))).drop !== "optional") errors.push({ code: "not_droppable", item: n, why: (/** @type {MaintenanceCardItem} */ (itemOf.get(n))).drop });
  for (const n of d.take) if (!(/** @type {MaintenanceCardItem} */ (itemOf.get(n))).adopt) errors.push({ code: "nothing_to_adopt", item: n, why: (/** @type {MaintenanceCardItem} */ (itemOf.get(n))).detected === undefined ? "undetected" : "agrees" });
  if (errors.length) return { refused: errors.map(refusalOf) };
  const reply = replyOf(built, d);
  const changes = changesOf(ctx, built, reply);
  const out = filesOf(ctx, built, reply, changes, proposal);
  if (out.problems.length) return { refused: refusals(out.problems, built.items), cause: "answers" };
  const described = describedMeanings(ctx, built, out.files);
  for (const c of changes) c.described = described.get(c.item.field) ?? [];
  const pending = changes.filter((c) => causes(c) && !d.confirm.includes(c.item.n));
  if (pending.length) return { confirm: confirmation(ctx, pending, d) };
  return writeReply(ctx, built, reply, out, changes);
}

// What the confirmation shows: each change that would cause Integrity errors, and the decisions that
// confirm them, the engineer's own with `confirm` added.
/**
 * @param {InitContext} ctx
 * @param {MaintenanceChange[]} pending
 * @param {InitDecisions} d
 * @returns {CardConfirm}
 */
function confirmation(ctx, pending, d) {
  const s = qaSummaries(ctx);
  const changes = pending.map((c) => ({ n: c.item.n, label: c.item.label, answer: c.answer, ...(c.answer !== "drop" && { value: c.value }), errors: c.effect.errors.map((e) => findingData(/** @type {Record<string, unknown>} */ (e), s)), unread: c.effect.unread.map(unreadData), ...(c.described?.length && { described: c.described }) }));
  const terms = pending.flatMap((c) => (c.described ?? []).map((d) => (d.kind === "tag" ? "Tag" : d.kind === "field" ? "Custom field" : "Role")));
  return { changes, words: currentWords(ctx), glossary: glossaryOf(["Integrity error", ...terms]), decisions: { ...d.input, confirm: [...new Set([...d.confirm, ...pending.map((c) => c.item.n)])].sort((a, b) => a - b) } };
}

// The words of the stack `project.md` names now (lib/stack.mjs `wordsOf`): a maintenance change's
// unread keys are those its current stack reads.
/**
 * @param {InitContext} ctx
 * @returns {unknown}
 */
const currentWords = (ctx) => wordsOf(resolveAdapter(rootConfig(ctx.root).stack, ctx.repo).adapter);

// Whether a change would cause Integrity errors, or leave key annotations in the code unread.
/**
 * @param {MaintenanceChange} c
 * @returns {boolean}
 */
const causes = (c) => c.effect.errors.length + c.effect.unread.length + (c.described?.length ?? 0) > 0;

// The meanings the write would edit, by the `project.md` key they are in, each with the number of
// cases that carry what it is about: a Tag, a Custom field's description and what the Roles mean
// are changes of meaning, so the engineer confirms them knowing how many cases they touch.
/**
 * @param {InitContext} ctx
 * @param {MaintenanceBuildCardResult} built
 * @param {Array<{ path: string, text: string }>} files
 * @returns {Map<string, Array<{ kind: string, name: string, cases: number }>>}
 */
function describedMeanings(ctx, built, files) {
  const project = files.find((f) => f.path === ctx.repoPath("project.md"));
  const edits = project ? editedMeanings(built.data, parse("project.md", project.text).data) : [];
  /** @type {Map<string, Array<{ kind: string, name: string, cases: number }>>} */
  const out = new Map();
  if (!edits.length) return out;
  const cases = [...buildIndex(loadWorkingTree(ctx.root)).cases.values()].map((decls) => decls[0].entry.data);
  for (const e of edits) out.set(e.field, [...(out.get(e.field) ?? []), { kind: e.kind, name: e.name, cases: casesCarrying(e, cases) }]);
  return out;
}

// What the maintenance decisions make of the card `built`: `{adopt, drop, values, field, final}`, where
// `final(name)` is a setting's value once written.
/**
 * @param {MaintenanceBuildCardResult} built
 * @param {InitDecisions} d
 * @returns {MaintenanceReply}
 */
function replyOf(built, d) {
  const field = new Map(built.items.map((i) => [i.field, i]));
  const adopt = new Set(d.take);
  const drop = new Set(d.drop);
  const values = new Map(Object.entries(d.edits).filter(([, e]) => e.value !== undefined).map(([n, e]) => [Number(n), e.value]));
  /** @param {string} name */
  const final = (name) => {
    const i = field.get(name);
    if (!i) return valueAt(built.data, name);
    if (values.has(i.n)) return values.get(i.n);
    if (adopt.has(i.n)) return i.detected;
    if (drop.has(i.n)) return undefined;
    return valueAt(built.data, name);
  };
  return { adopt, drop, values, field, final };
}

// Each change the decisions make (`{item, answer, value?, effect}`), with what it would cause on its own
// against the file as it stands.
/**
 * @param {InitContext} ctx
 * @param {MaintenanceBuildCardResult} built
 * @param {MaintenanceReply} reply
 * @returns {MaintenanceChange[]}
 */
function changesOf(ctx, built, reply) {
  const { adopt, values, final } = reply;
  const base = built.data;
  const changes = [];
  let before = null;
  const baseline = () => (before ??= referrers(ctx, built.current.text));
  for (const f of FIELDS) {
    const to = final(f.name);
    if (isDeepStrictEqual(valueAt(base, f.name), to)) continue;
    const item = (/** @type {MaintenanceCardItem} */ (reply.field.get(f.name)));
    const answer = values.has(item.n) ? "value" : adopt.has(item.n) ? "adopt" : "drop";
    // Every value of the card renders: a typed one is text, a list or a number, and a detected one
    // that cannot is refused when the card is built (`unwritable`).
    const text = withField(built.current, base, f.name, to);
    if (text.error) throw new Error(`init: ${f.name} cannot be written: ${text.error}`);
    changes.push({ item, answer, ...(answer !== "drop" && { value: to }), effect: effectOf(ctx, baseline(), (/** @type {{ text: string }} */ (text)).text) });
  }
  return changes;
}

// The files the decisions write (`{files, heads, next, problems}`): `project.md` with each changed
// top-level field (`heads`, their values `next`), and what keeps it from being written.
/**
 * @param {InitContext} ctx
 * @param {MaintenanceBuildCardResult} built
 * @param {MaintenanceReply} reply
 * @param {MaintenanceChange[]} changes
 * @param {InitProposal} proposal
 * @returns {{ files: Array<{ path: string, text: string }>, heads: string[], next: Map<string, unknown>, problems: InitProblem[] }}
 */
function filesOf(ctx, built, reply, changes, proposal) {
  const { problems, problem } = problemList();
  const { final } = reply;
  const base = built.data;
  const heads = [...new Set(changes.map((c) => headOf(c.item.field)))];
  const next = tops(base, heads, final);
  const anyTracker = subfields("tracker").some((k) => final(`tracker.${k}`) !== undefined);
  const trackerFields = FIELDS.filter((f) => f.tracker);
  const trackerGiven = trackerFields.filter((f) => final(f.name) !== undefined);
  if (anyTracker && trackerGiven.length < trackerFields.length) {
    problem("tracker_partial", undefined, { missing: trackerFields.filter((f) => final(f.name) === undefined).map((f) => f.name) });
    // Rendered as it was, so the partial tracker is this one problem, not a second from check-file.
    if (next.has("tracker")) next.set("tracker", base.tracker);
  }
  stackRows(ctx, proposal, final("module_paths"), problem);
  for (const c of changes) smokeTested(ctx, c.item.field, final(c.item.field), problem);

  const files = [];
  if (heads.length) {
    const text = editProject(built.current, next);
    if (text.error) throw new Error(`init: project.md cannot be written: ${text.error}`);
    files.push({ path: ctx.repoPath("project.md"), text: (/** @type {{ text: string }} */ (text)).text });
    // A Tag or a Custom-field value is retired, never removed, renamed or reused.
    if (heads.some((h) => LABEL_KEYS.includes(h))) for (const r of removedLabels(built.data, parse("project.md", files[0].text).data)) problem("label_removed", r.field, { name: r.name });
  }
  for (const f of files) {
    const check = checkAt(ctx, f.path, f.text);
    if (!check.ok) problem("check_file", undefined, { path: f.path, errors: check.errors });
  }
  return { files, heads, next, problems };
}

// The files the decisions write, for the lifecycle to write every one or none, and the closing report:
// the files written with the suggested commit, the Integrity errors and unread key annotations the
// write made, and the Automation-key annotation's declaration once its name changes. What the report
// names of the repository is read before it is written.
/**
 * @param {InitContext} ctx
 * @param {MaintenanceBuildCardResult} built
 * @param {MaintenanceReply} reply
 * @param {{ files: Array<{ path: string, text: string }>, heads: string[], next: Map<string, unknown> }} param3
 * @param {MaintenanceChange[]} changes
 * @returns {InternalApplyResult}
 */
function writeReply(ctx, built, reply, { files, heads, next }, changes) {
  const s = qaSummaries(ctx);
  const done = { applied: changes.filter((c) => c.answer !== "drop").map((c) => c.item.n), dropped: changes.filter((c) => c.answer === "drop").map((c) => c.item.n) };
  const none = { errors: [], unread: [] };
  // Every change at once, from the file as it stands to the one written.
  const project = files.find((f) => f.path === ctx.repoPath("project.md"));
  const warnings = checkAt(ctx, ctx.repoPath("project.md"), project?.text).warnings;
  const notes = [...warnings.filter((w) => w.code === "automation_key_overlap").map(({ code }) => ({ code })), ...labelNotes(ctx, project ? parse("project.md", project.text).data : built.data)].map(noteOf);
  const todo = project ? effectOf(ctx, referrers(ctx, built.current.text), project.text) : none;
  const { final } = reply;
  const renamed = heads.includes("annotation_map") && !isDeepStrictEqual(final("annotation_map.automation_key"), valueAt(built.data, "annotation_map.automation_key"));
  const declared = renamed ? annotationSnippet(ctx, { ...built.data, annotation_map: next.get("annotation_map") }) : null;
  const snippet = declared ? { ...declared, language: final("stack.language"), framework: final("stack.framework") } : null;
  return {
    ...done,
    changeset: { writes: files.map(({ path, text }) => ({ path, text })) },
    report: (commit) => ({ files: files.map((f) => f.path), commit, todo: { errors: todo.errors.map((e) => findingData(/** @type {Record<string, unknown>} */ (e), s)), unread: todo.unread.map(unreadData) }, words: currentWords(ctx), snippet, ...(notes.length && { notes }), glossary: glossaryOf(todo.errors.length ? ["Integrity error"] : []) }),
  };
}
