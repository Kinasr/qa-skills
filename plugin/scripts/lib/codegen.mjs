// @ts-check
// `/qa-codegen`'s CLI family (ADR-0052): `plan`, `start`, `verify`, `done` and `fail`.
//
// A Run plans one item per eligible case (one case, one new Automation), then each item is written
// by the model, proved by `verify`, and bound by `done`. The CLI owns the parts a model must not
// decide: the eligible set and its closed skip reasons, the additive edit guard, the Key minted at
// the first verify, the repeated passing proof, the structural Expected-to-line mapping, the
// credential scan, and the one write of `automates`. It never writes an Execution record: a verify
// is a test run, not a Tester's Execution.
//
// State is `<run-dir>/codegen.json`; nothing here commits or stages.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { noArguments, requireOption, UsageError } from "./cli.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { checkFile, edit, parse, projectConfig } from "./knowledge-file.mjs";
import { caseFields, caseLevel, caseSteps } from "./case-fields.mjs";
import { isDeclaredTag } from "./case-labels.mjs";
import { scan } from "./scan.mjs";
import { storedCaseFindings } from "./stored-findings.mjs";
import { refusalsFor } from "./refusal.mjs";
import { newRunDir, newRunId, readRunFile } from "./run-dir.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { CODEGEN_TRAIN_KEY, LEVEL_ON_CASE_SCHEMA_VERSION, SCHEMA_VERSION } from "./schema.mjs";
import { liveRefs } from "./codegen-refs.mjs";
import { resolvesUnderAny } from "./paths.mjs";
import { practicesText, trainFile } from "./training.mjs";
import { resolveAdapter, testRunnerMatchesStack } from "./stack.mjs";
import { buildCodeIndex, indexSource, keyPatterns } from "./code-index.mjs";
import { carrierNames, filesUnder } from "./code-source.mjs";
import { mint } from "./mint.mjs";
import { prefixFits, readTrackerReference, suggestPrefix } from "./keys.mjs";
import { annotation } from "./sync-code.mjs";
import { checkEdits } from "./edit-guard.mjs";
import { commitPrItem, dirtyPaths, planPr, prActions, prResult, scrubText, snapshotPrTree } from "./pr.mjs";
import { diffTrees, fileText, headCommit, sameFile, writeTreeFile } from "./pr-git.mjs";
import { rebuildPrChain, rollbackUntilPassing } from "./regress-chain.mjs";
import { fixSelections } from "./fix-regress.mjs";
import { regressionDependents } from "./stacks/regress-refs.mjs";
import { proveSelection } from "./test-proof.mjs";
import { credentialIn } from "./credentials.mjs";
import { runSelection } from "./runners/index.mjs";
import { isMap } from "./dialect.mjs";

/**
 * @import { CommandAction, CommandContext, CommandResult } from "./cli.mjs"
 * @import { RefusalFact, RefusalResult } from "./refusal.mjs"
 * @import { ParsedEntry, ParsedFile, ProjectConfig, TestRunner } from "./knowledge-file.mjs"
 * @import { GuardEdit } from "./edit-guard.mjs"
 * @import { AutomationSelection, RunnerResult } from "./test-runner.mjs"
 * @import { PrFile } from "./pr-git.mjs"
 * @import { IndexedClass, IndexedFunction, KeyPatterns } from "./code-index.mjs"
 * @import { StackAdapter } from "./stack.mjs"
 * @import { TrainFile } from "./training.mjs"
 */

/**
 * @typedef {{ id: string, text: string }} ExpectedSentence
 * @typedef {{ scenario: string, prefix: string | null, proposal: true }} CodegenPrefix
 * @typedef {{
 *   id: string,
 *   case: string,
 *   feature: string,
 *   scenario: string,
 *   scenario_key?: string,
 *   summary: string,
 *   level: string,
 *   tracker?: string,
 *   expected: ExpectedSentence[],
 *   status: "pending" | "in_progress" | "done" | "failed",
 *   attempts: number,
 *   key?: string,
 *   passing?: boolean,
 *   hypothesis?: string,
 *   started_at?: string,
 *   before?: Record<string, PrFile>,
 *   before_qa?: Record<string, PrFile>,
 *   before_tree?: Record<string, PrFile>,
 *   after_tree?: Record<string, PrFile>,
 *   snapshot?: Record<string, PrFile | null>,
 *   verify?: Record<string, unknown>,
 *   expects?: Record<string, string[]>,
 *   file?: string,
 *   carried?: boolean,
 *   pre_existing?: boolean,
 *   draft?: string,
 *   failure?: { reason: string, cnv?: string },
 * }} CodegenItem
 * @typedef {{
 *   run: string,
 *   created_at: string,
 *   commit: string,
 *   repo: string,
 *   root: string,
 *   module_paths: string[],
 *   target: { slug: string, origin: string },
 *   stack: { root: string, tool: string },
 *   runner: TestRunner,
 *   training: { pr: string, codegen_repeats: number, codegen_attempts: number },
 *   prefixes: CodegenPrefix[],
 *   items: CodegenItem[],
 *   skipped: Array<{ key: string, reasons: string[] }>,
 *   dirty?: string[],
 *   done?: string[],
 *   regression?: AutomationSelection[],
 *   regressPassed?: boolean,
 *   regress?: { checked: number, rolled_back: string[] },
 *   pr?: import("./pr.mjs").PrState,
 * }} CodegenState
 * @typedef {{
 *   annotate: Array<{ fn: { file: string, line: number, class: string, name: string }, handle: { key: string } }>,
 *   rekey: never[],
 *   prefix: Array<{ cls: { file: string, line: number, path: string }, prefix: string }>,
 *   header: Array<{ prefix: string }>,
 * }} RenderOps
 * @typedef {{ name: string, names: string[], home: string | null, prefix: { name: string, home: string | null } }} RenderCarrier
 * @typedef {{ render: (text: string, ops: RenderOps, carrier: RenderCarrier, file: string) => { text: string, errors: Array<{ kind: string, message: string }> } }} RenderAdapter
 * @typedef {{ kind: "class", cls: IndexedClass } | { kind: "header", file: string }} PrefixWrite
 */

const { stop, fact } = refusalsFor({
  invalid_project: "Fix `.qa/project.md` before writing code.",
  unknown_stack: "`--stack` must name `project.stack.root`.",
  untrained_stack: "Teach code gen your project's style first with `/qa-train codegen --stack`.",
  training_refs_unresolved: "A codegen Convention points at a path that is gone; repair it with `/qa-train codegen`.",
  no_test_runner: "Set `test_runner` in `project.md` with `/qa-init` so a generated test can be proved.",
  no_code_adapter: "The project's stack has no code adapter to read and write its tests with.",
  no_targets: "Add a target origin to `.qa/project.md`: targets: {staging: https://app.example.test}",
  multiple_targets: "A Run takes at most one target.",
  unknown_target: "Choose one of the configured target names; raw URLs are not targets.",
  invalid_filter: "Use tag:<name> or level:<name> with a non-blank name and no whitespace or extra colon.",
  unknown_tag: "The requested Tag is not declared in the project.",
  retired_tag: "The requested Tag is retired.",
  unknown_level: "The requested Test level is not declared in the project.",
  ambiguous_key: "The scope token names more than one declaration.",
  unknown_key: "The scope token names no live Key or Tracker key.",
  retired_key: "The scope token was retired and cannot be automated.",
  no_cases: "The scope holds no live Test Case; design cases first with `/qa-design`.",
  integrity_error: "A selected file has an Integrity error; fix it before generating code.",
  no_codegen_level: "None of the requested Test levels runs on this stack (`execute_levels`).",
  no_matching_cases: "No live Test Case in the scope matches the requested Tags and Test levels.",
  no_eligible_cases: "Every selected case is skipped; there is nothing to generate.",
  unknown_item: "The item id is not in this Run's plan.",
  wrong_state: "The item is not in a state that step acts on.",
  not_started: "Start the item before verifying it.",
  item_in_progress: "Another item is still in progress; finish or fail it first.",
  no_pending_item: "Every planned item is done or failed.",
  no_passing_verify: "Verify a passing tree before `codegen done`.",
  changed_after_verify: "The tree changed after the passing verify; verify again before `done`.",
  not_one_new_test: "The first verify needs exactly one new test function in the touched test files.",
  not_additive: "An edit changed or deleted a test function that existed before the item.",
  secret: "An added line holds what looks like a credential or a sensitive literal.",
  invalid_key_prefix: "The Key prefix is missing or does not fit `automation_key_mint`.",
  invalid_key_carrier: "The stack could not render the Automation key's carrier.",
  test_missing: "No test function carries the item's Automation key.",
  "cap-reached": "The item used every `codegen_attempts` edit-and-verify cycle.",
  unknown_reason: "`--reason` names no closed codegen failure reason.",
  unknown_cnv: "`--cnv` names no Convention in `train/codegen.md`.",
  expects_invalid: "`--expects` must be a JSON object of Expected sentence ids to `file:line` strings.",
  expects_unmapped: "Every Expected sentence needs at least one line in `--expects`.",
  expects_unknown: "`--expects` names an Expected sentence id the case does not have.",
  expects_line: "A mapped value is not `<file>:<line>` under `module_paths`.",
  expects_not_added: "A mapped line was not added by this item.",
  expects_not_in_test: "A mapped line is blank, a comment, an import, or outside the new test and its new support.",
  automates_write: "The case's `automates` could not be written.",
  "external-mint-required": "`--pr` is not available: the project's own tool mints Automation keys. Run in the working tree, then mint with your tool and run `/qa-sync`.",
  dirty: "A pre-existing dirty path under `module_paths` is touched; commit or revert it first.",
  items_pending: "Finish or fail every item before `codegen regress`.",
  already_prepared: "The PR is already prepared; `codegen regress` runs before `pr-prepare`.",
  regress_required: "Run `codegen regress` before `pr-prepare`: a done item touched a pre-existing file.",
});

const CLOSED_REASONS = new Set(["cap-reached", "out-of-scope", "blocked", "app-disagrees", "case-wrong", "not-expressible", "convention-conflict", "invalid-key-prefix", "no-auth", "dirty", "regressed"]);

/**
 * @param {unknown} value
 * @returns {string[]}
 */
const strings = (value) => Array.isArray(value) ? /** @type {string[]} */ (value.filter((v) => typeof v === "string")) : [];

/** @param {string} path @param {string} root */
const under = (path, root) => root === "." || root === "" || path === root || path.startsWith(`${root.replace(/\/+$/, "")}/`);

// ---------------------------------------------------------------------------------------------
// Scope (execute's tokens, kept here because the codegen contract does not reshape execute's planner)

/**
 * @typedef {{
 *   kind: string,
 *   key: string,
 *   feature?: string | null,
 *   scenario?: string | null,
 *   file: ParsedFile,
 *   entry?: ParsedEntry | null,
 *   line?: number | null,
 * }} ScopeDeclaration
 * @typedef {{
 *   retired: Map<string, string>,
 *   declarations: ScopeDeclaration[],
 *   cases: ScopeDeclaration[],
 *   casesFor: (d: ScopeDeclaration) => ScopeDeclaration[],
 *   liveFeature: (key: string) => boolean,
 * }} ScopeState
 */

/**
 * @param {ReturnType<typeof buildIndex>} index
 * @returns {ScopeState}
 */
function scopeState(index) {
  const retired = new Map(strings(index.project?.data.retired_features).map((key) => [key, "retired_features"]));
  for (const [key, declarations] of index.features) for (const { file } of declarations) {
    for (const token of strings(file.data.retired)) retired.set(readTrackerReference(token) ?? token, key);
  }
  const liveFeature = (/** @type {string} */ key) => !retired.has(key);
  const live = (/** @type {ScopeDeclaration} */ d) => liveFeature(d.feature ?? d.key) && !retired.has(d.key) && !retired.has(/** @type {string} */ (d.scenario));
  /** @type {Array<[string, Map<string, Array<{ file: ParsedFile, line: number, feature?: string | null }>>]>} */
  const maps = [["feature", index.features], ["suite", index.suites], ["scenario", index.scenarios], ["case", index.cases]];
  /** @type {ScopeDeclaration[]} */
  const declarations = [];
  for (const [kind, map] of maps) for (const [key, entries] of map) {
    for (const { file, line } of entries) {
      const entry = kind === "case" ? (file.cases.find((c) => c.key === key) ?? null) : null;
      declarations.push({ kind, key, feature: index.featureOf(file), scenario: typeof file.data.key === "string" ? file.data.key : null, file, entry, line: entry?.line ?? line });
    }
  }
  const cases = declarations.filter((d) => d.kind === "case").filter(live);
  const casesFor = (/** @type {ScopeDeclaration} */ d) => cases.filter((c) => d.kind === "case" ? c.key === d.key : d.kind === "scenario" ? c.scenario === d.key : c.feature === (d.feature ?? d.key));
  return { retired, declarations: declarations.filter(live), cases, casesFor, liveFeature };
}

/**
 * @param {string} token
 * @param {ReturnType<typeof buildIndex>} index
 * @param {ScopeState} state
 * @returns {{ cases: ScopeDeclaration[], alias?: string, refusal?: undefined } | { refusal: RefusalResult }}
 */
function resolveScope(token, index, state) {
  const choose = (/** @type {ScopeDeclaration[]} */ found, former = false) => {
    if (found.length > 1) return { refusal: stop("ambiguous_key", { key: token }) };
    if (!found.length) return null;
    return { cases: state.casesFor(found[0]), ...(former && { alias: `${token} → ${found[0].key}` }) };
  };
  const direct = choose(state.declarations.filter((d) => d.key === token));
  if (direct) return direct;
  const tracker = index.tracker.resolve(token);
  if (tracker.status === "ambiguous") return { refusal: stop("ambiguous_key", { key: token }) };
  if (tracker.status === "unique") {
    if (state.retired.has(tracker.entry.key) || !state.liveFeature(/** @type {string} */ (tracker.entry.feature))) return { refusal: stop("retired_key", { key: token }) };
    return { cases: state.casesFor(tracker.entry) };
  }
  if (state.retired.has(token)) return { refusal: stop("retired_key", { key: token, feature: state.retired.get(token) }) };
  const former = choose(state.declarations.filter((d) => d.kind !== "suite" && strings((d.entry ?? d.file).data.formerly).includes(token)), true);
  return former ?? { refusal: stop("unknown_key", { key: token }) };
}

// ---------------------------------------------------------------------------------------------
// The plan

/**
 * The CLI's split of an Expected result: each list item, then each sentence in it.
 * @param {string | null | undefined} expected
 * @returns {ExpectedSentence[]}
 */
function expectedSentences(expected) {
  if (!expected) return [];
  /** @type {string[]} */
  const items = [];
  for (const line of expected.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^([-*+]|\d+[.)])\s+/.test(line)) items.push(line.replace(/^([-*+]|\d+[.)])\s+/, ""));
    else if (items.length) items[items.length - 1] += ` ${line}`;
    else items.push(line);
  }
  const sentences = items.flatMap((item) => item.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(*])/u).map((s) => s.trim()).filter(Boolean));
  return sentences.map((text, i) => ({ id: `e${i + 1}`, text }));
}

/**
 * A case's eligibility, in the settled skip order.
 * @param {ScopeDeclaration} c
 * @param {ProjectConfig} config
 * @param {ReturnType<typeof scan>} facts
 * @param {Set<string>} named
 * @param {{ code: ReturnType<typeof buildCodeIndex>, proposals: Set<string> }} code
 * @returns {string[]}
 */
function skipReasons(c, config, facts, named, code) {
  const entry = /** @type {ParsedEntry} */ (c.entry);
  const findings = storedCaseFindings(facts.history, c.file, entry);
  const tracker = typeof entry.data.tracker === "string" ? entry.data.tracker : null;
  const carriesTracker = tracker !== null && code.code.functions.some((fn) => fn.trackerKeys.some((t) => t.key === tracker));
  const review = facts.history.reviews.find((r) => r.key === entry.key)?.status ?? "none";
  const level = String(entry.data.level ?? "");
  return /** @type {string[]} */ ([
    strings(entry.data.automates).length > 0 && "automated",
    (code.proposals.has(entry.key) || carriesTracker) && "binding-pending",
    entry.data.automatable === false && "not-automatable",
    caseSteps(/** @type {import("./case-fields.mjs").CaseFieldEntry} */ (entry)).length === 0 && "no-steps",
    !caseFields(/** @type {import("./case-fields.mjs").CaseFieldEntry} */ (entry)).expected && "no-expected",
    findings.some((f) => f.kind === "Conflict" && f.status === "open") && "conflict",
    review !== "fresh" && !named.has(entry.key) && "unreviewed",
    !Object.hasOwn(config.execute_levels ?? {}, level) && "no-stack",
    !keyRoute(entry, config) && "no-key-route",
  ].filter(Boolean));
}

// ADR-0012: a project whose own tool mints can bind only from a Tracker key the tool can write.
/**
 * @param {ParsedEntry} entry
 * @param {ProjectConfig} config
 * @returns {boolean}
 */
function keyRoute(entry, config) {
  if (config.autMints) return true;
  if (!config.autExternal) return false;
  if (typeof entry.data.tracker !== "string") return false;
  return carrierNames(config.annotationMap, "tracker_key_fn").length > 0 || carrierNames(config.annotationMap, "tracker_key_class").length > 0;
}

/**
 * @param {TrainFile | null} train
 * @param {string} repo
 * @param {string} stack
 * @param {ProjectConfig} config
 * @returns {Array<{ convention: string, ref: string }>}
 */
function unresolvedRefs(train, repo, stack, config) {
  if (!train) return [];
  const existing = config.modulePaths.filter((p) => existsSync(join(repo, p)));
  const stackRoot = resolve(repo, stack);
  const bases = existing.length ? existing : existsSync(stackRoot) ? [stackRoot] : [];
  /** @type {Array<{ convention: string, ref: string }>} */
  const dead = [];
  for (const entry of /** @type {ParsedEntry[]} */ (train.conventions ?? [])) {
    for (const ref of strings(entry.data?.refs)) if (!resolvesUnderAny(repo, ref, bases)) dead.push({ convention: entry.key, ref });
  }
  return dead;
}

// Whether the Scenario already has a prefixed class or test file: its cases' Automations and Tracker
// keys name the test functions to look at.
/**
 * @param {ScopeDeclaration} c
 * @param {ReturnType<typeof buildCodeIndex>} code
 * @returns {boolean}
 */
function scenarioPrefixed(c, code) {
  const cases = c.file.cases;
  const automations = cases.flatMap((entry) => strings(entry.data.automates));
  const trackers = cases.map((entry) => entry.data.tracker).filter((tracker) => typeof tracker === "string");
  const functions = code.functions.filter((fn) => fn.automationKeys.some((key) => automations.includes(key.key)) || fn.trackerKeys.some((key) => trackers.includes(key.key)));
  return functions.some((fn) => fn.classes.some((cls) => cls.keyPrefixes.length > 0) || (code.headers?.find((header) => header.file === fn.file)?.keyPrefixes.length ?? 0) > 0);
}

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function plan(args, { root, stack: requestedStack, pr: requestedPr }) {
  const files = loadWorkingTree(/** @type {string} */ (root));
  const index = buildIndex(files);
  const config = projectConfig(index.project);
  const project = files.find((f) => f.rel === "project.md");
  const problems = /** @type {Array<{ code: string, field?: string, message?: string, line?: number | null }>} */ (project ? checkFile(project, config).errors : [{ code: "missing_project" }]);
  const runnerToolProblem = problems.length > 0 && problems.every((e) => e.code === "invalid" && e.field === "test_runner.tool");
  if (project?.type !== "project" || (config.schemaVersion ?? 0) > SCHEMA_VERSION) return stop("invalid_project", { problems });
  if (problems.length && !runnerToolProblem) return stop("invalid_project", { problems });
  const schema = refuseUnreadSchema(/** @type {string} */ (root), LEVEL_ON_CASE_SCHEMA_VERSION);
  if (schema) return schema;
  const repo = dirname(resolve(/** @type {string} */ (root)));
  const stack = config.stack?.root ?? ".";
  if (requestedStack !== undefined && requestedStack !== stack) return stop("unknown_stack", { stack: requestedStack, root: stack });
  const train = /** @type {TrainFile | null} */ (trainFile(index, CODEGEN_TRAIN_KEY));
  if (!strings(train?.data?.trained_stacks).includes(stack)) return stop("untrained_stack", { stack, train: `/qa-train codegen --stack ${stack}` });
  const dead = unresolvedRefs(train, repo, stack, config);
  if (dead.length) return stop("training_refs_unresolved", { conventions: dead, next: "/qa-train codegen" });
  const runner = config.test_runner;
  if (runnerToolProblem || !runner || !testRunnerMatchesStack(runner.tool, config.stack)) return stop("no_test_runner", { ...(runner && { tool: runner.tool }), ...(config.stack && { stack: config.stack.language }) });
  const adapter = resolveAdapter(config.stack, repo).adapter;
  if (!adapter) return stop("no_code_adapter", { stack: config.stack?.language ?? null });

  const targets = args.filter((a) => a.startsWith("target:")).map((a) => a.slice(7));
  if (targets.length > 1) return stop("multiple_targets", { targets });
  const rawUrl = args.find((a) => /^[a-z][a-z0-9+.-]*:\/\//i.test(a));
  if (!config.targets) return stop("no_targets");
  const slug = targets[0] ?? Object.keys(config.targets)[0];
  if (rawUrl || !Object.hasOwn(config.targets, slug)) return stop("unknown_target", { target: rawUrl ?? slug, targets: Object.keys(config.targets) });
  const target = { slug, origin: config.targets[slug] };

  const invalid = args.find((a) => /^(tag|level):/.test(a) && !/^(tag|level):[^\s:]+$/u.test(a));
  if (invalid !== undefined) return stop("invalid_filter", { token: invalid });
  const tags = args.filter((a) => a.startsWith("tag:")).map((a) => a.slice(4));
  const levels = args.filter((a) => a.startsWith("level:")).map((a) => a.slice(6));
  const scope = args.filter((a) => !/^(target|tag|level):/.test(a));
  const validTags = Object.keys(config.labels.tags);
  const unknownTag = tags.find((t) => !isDeclaredTag(config.labels, t));
  if (unknownTag !== undefined) return stop("unknown_tag", { tag: unknownTag, valid: validTags });
  const retiredTag = tags.find((t) => config.labels.retiredTags.includes(t));
  if (retiredTag !== undefined) return stop("retired_tag", { tag: retiredTag, valid: validTags });
  const unknownLevel = levels.find((l) => !config.levels.has(l));
  if (unknownLevel !== undefined) return stop("unknown_level", { level: unknownLevel, valid: [...config.levels] });

  const state = scopeState(index);
  /** @type {Set<ScopeDeclaration>} */
  const union = new Set(scope.length ? [] : state.cases);
  /** @type {Set<string>} */
  const named = new Set();
  /** @type {string[]} */
  const aliases = [];
  for (const token of scope) {
    const found = resolveScope(token, index, state);
    if (found.refusal) return found.refusal;
    for (const c of found.cases) {
      union.add(c);
      if (token === c.entry?.key || index.tracker.resolve(token).status === "unique") named.add(/** @type {string} */ (c.entry?.key));
    }
    if (found.alias) aliases.push(found.alias);
  }
  if (!union.size) return stop("no_cases", { scope });
  const selectedCases = [...union].sort((a, b) => a.file.rel.localeCompare(b.file.rel) || (a.line ?? 0) - (b.line ?? 0));
  const facts = scan(/** @type {string} */ (root));
  const selectedFiles = new Set(selectedCases.map((c) => c.file.rel));
  const broken = facts.results.filter((r) => r.kind === "integrity_error" && selectedFiles.has(/** @type {string} */ (r.file)));
  if (broken.length) return stop("integrity_error", { errors: broken.map(({ code, file, line, key, message }) => ({ code, file, line, key, message })) });
  const requestedLevels = new Set(levels);
  const executable = Object.keys(config.execute_levels ?? {});
  const unavailable = [...requestedLevels].filter((l) => !executable.includes(l));
  if (requestedLevels.size && unavailable.length === requestedLevels.size) return stop("no_codegen_level", { levels, executable });
  const selected = selectedCases.filter((c) => (!tags.length || strings(c.entry?.data.tags).some((tag) => tags.includes(tag))) && (!levels.length || levels.includes(String(c.entry?.data.level))));
  if (!selected.length) return stop("no_matching_cases", { selection: { scope, tags, levels } });
  const code = buildCodeIndex(repo, config.modulePaths, config.annotationMap, adapter, keyPatterns(config));
  const proposals = new Set(facts.results.filter((r) => r.kind === "binding_proposal" && ["mint_and_bind", "rebind"].includes(/** @type {string} */ (r.code))).flatMap((r) => [...strings(r.bind), ...strings(r.replace_in)]));
  const reasons = new Map(selected.map((c) => [c, skipReasons(c, config, facts, named, { code, proposals })]));
  const skipped = selected.filter((c) => /** @type {string[]} */ (reasons.get(c)).length > 0).map((c) => ({ key: /** @type {string} */ (c.entry?.key), reasons: /** @type {string[]} */ (reasons.get(c)) }));
  const eligible = selected.filter((c) => /** @type {string[]} */ (reasons.get(c)).length === 0);
  if (!eligible.length) return stop("no_eligible_cases", { skipped });
  /** @type {CodegenPrefix[]} */
  const prefixes = [];
  if (config.autRecipe) {
    const seen = new Set();
    for (const c of eligible) {
      const scenario = String(c.file.data.key ?? c.file.rel);
      if (seen.has(scenario)) continue;
      seen.add(scenario);
      if (scenarioPrefixed(c, code)) continue;
      const title = c.file.h1?.text ?? /** @type {string} */ (c.entry?.summary);
      prefixes.push({ scenario, prefix: suggestPrefix(title.replace(/^[^:]*:\s*/, ""), config.autRecipe), proposal: true });
    }
  }
  // ADR-0012: the project's own tool mints its keys, so the framework cannot make a self-consistent
  // branch; the Run stays in the working tree. `pr: always` is downgraded, `--pr` is refused.
  const trainingPr = typeof train?.data?.pr === "string" ? train.data.pr : "on-request";
  const asked = Boolean(requestedPr) || trainingPr === "always";
  if (requestedPr && config.autExternal) return stop("external-mint-required", { stack, next: "run in the working tree, mint with your tool, then /qa-sync" });
  const qaPaths = [...new Set(eligible.map((c) => `.qa/${c.file.rel.replaceAll("\\", "/")}`))];
  const commit = headCommit(repo) ?? "";
  const run = newRunId();
  let pr = planPr({
    skill: "codegen",
    repo,
    run,
    commit,
    modulePaths: config.modulePaths,
    qaPaths,
    requested: asked,
    ...(config.code_host && { codeHost: config.code_host }),
    target,
  });
  if (config.autExternal && asked) {
    pr = { ...pr, mode: { kind: "working-tree", reason: "external-mint-required", confirm: "Working tree only: the project's own tool mints Automation keys; mint with it, then `/qa-sync`" } };
  }
  /** @type {CodegenItem[]} */
  const items = eligible.map((c, i) => {
    const entry = /** @type {ParsedEntry} */ (c.entry);
    return {
      id: `cg_${i + 1}`,
      case: entry.key,
      feature: String(c.feature ?? ""),
      scenario: c.file.rel,
      ...(typeof c.file.data.key === "string" && { scenario_key: c.file.data.key }),
      summary: String(entry.summary ?? ""),
      level: String(caseLevel(entry.data, c.file.data, config.schemaVersion) ?? ""),
      ...(typeof entry.data.tracker === "string" && { tracker: entry.data.tracker }),
      expected: expectedSentences(caseFields(/** @type {import("./case-fields.mjs").CaseFieldEntry} */ (entry)).expected),
      status: "pending",
      attempts: 0,
    };
  });
  const dir = /** @type {{ make(): string }} */ (newRunDir(undefined, "qa-skills-codegen-")).make();
  /** @type {CodegenState} */
  const stateOut = {
    run,
    created_at: new Date().toISOString(),
    commit,
    repo,
    root: resolve(/** @type {string} */ (root)),
    module_paths: config.modulePaths,
    target,
    stack: { root: stack, tool: runner.tool },
    runner,
    training: {
      pr: typeof train?.data?.pr === "string" ? train.data.pr : "on-request",
      codegen_repeats: Number(train?.data?.codegen_repeats ?? 3),
      codegen_attempts: Number(train?.data?.codegen_attempts ?? 3),
    },
    prefixes,
    items,
    skipped,
    dirty: dirtyPaths(repo, config.modulePaths),
    done: [],
    pr,
  };
  writeCodegen(dir, stateOut);
  const warnings = facts.results.filter((r) => r.kind === "train_warning" && ["convention_drift", "citation_broken"].includes(r.code) && r.stack === stack);
  const text = [planText(stateOut, dir, aliases), ...warnings.map((warning) => `Warning ${warning.code}: ${warning.message}`)].join("\n");
  return { exit: 0, json: { action: "plan", ok: true, dir, run, pr_mode: pr.mode, warnings, items: items.map((i) => ({ id: i.id, case: i.case, summary: i.summary, level: i.level, scenario: i.scenario })), skipped, prefixes, text } };
}

/**
 * The mode sentence on the confirm, in codegen's own words.
 * @param {import("./pr.mjs").PrMode | undefined} mode
 * @returns {string}
 */
function modeText(mode) {
  if (!mode) return "working tree only (no PR was asked for)";
  if (mode.kind === "working-tree") return `working tree only (${mode.reason === "not-requested" ? "no PR was asked for" : mode.reason === "dirty" ? "the test tree is dirty" : mode.reason === "dirty-knowledge" ? "a selected Scenario file is dirty" : mode.confirm.replace(/^Working tree only: /, "")})`;
  if (mode.kind === "branch") return `branch ${mode.confirm.replace(/^Branch \S+ only: /, "")}; the branch is created at pr-prepare`;
  return mode.confirm;
}

/**
 * @param {CodegenState} state
 * @param {string} dir
 * @param {string[]} aliases
 * @returns {string}
 */
function planText(state, dir, aliases) {
  return [
    `Code generate ${state.items.length} case${state.items.length === 1 ? "" : "s"} on stack ${state.stack.root} against ${state.target.slug} (${state.target.origin}).`,
    `Mode: ${modeText(state.pr?.mode)}.`,
    ...aliases.map((a) => `Former key: ${a}`),
    "Cases:",
    ...state.items.map((i) => `  ${i.id} ${i.case}: ${i.summary} (${i.level})`),
    ...(state.skipped.length ? [`Skipped (${state.skipped.length}):`, ...state.skipped.map((s) => `  ${s.key} (${s.reasons.join(", ")})`)] : []),
    ...(state.skipped.some((s) => s.reasons.includes("binding-pending")) ? ["Run `/qa-sync` for the binding-pending cases before generating their tests."] : []),
    ...(state.prefixes.length ? ["Key prefixes to confirm:", ...state.prefixes.map((p) => `  ${p.scenario}: ${p.prefix ?? "(name one)"}`)] : []),
    `Run dir: ${dir}`,
    `When you confirm: node <plugin>/scripts/scan.mjs codegen start --dir ${dir}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// State

/**
 * @param {string} dir
 * @param {CodegenState} state
 * @returns {void}
 */
function writeCodegen(dir, state) {
  const path = join(dir, "codegen.json");
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, path);
}

/**
 * @param {string | undefined} dir
 * @param {string} action
 * @returns {{ state: CodegenState, dir: string }}
 */
function load(dir, action) {
  requireOption(`codegen ${action}`, dir, "--dir <run-dir>", "the run dir `codegen plan` printed");
  const resolved = resolve(String(dir));
  const read = readRunFile(resolved, "codegen.json", { by: "codegen plan", restart: "codegen plan", missing: `no codegen.json in ${resolved}: run \`codegen plan\` first` });
  if (read.error) throw new UsageError(read.error);
  return { state: /** @type {CodegenState} */ (read.value), dir: resolved };
}

/**
 * @param {CodegenState} state
 * @param {string | undefined} id
 * @param {string} action
 * @returns {{ item: CodegenItem } | { refusal: CommandResult }}
 */
function itemOf(state, id, action) {
  requireOption(`codegen ${action}`, id, "--item <id>", "the item id `codegen start` returned");
  const item = state.items.find((i) => i.id === id);
  return item ? { item } : { refusal: stop("unknown_item", { item: id }) };
}

// ---------------------------------------------------------------------------------------------
// start

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function start(args, { dir }) {
  noArguments("codegen start", args, "--dir <run-dir>");
  const loaded = load(dir, "start");
  const state = loaded.state;
  const currentIndex = buildIndex(loadWorkingTree(state.root));
  const currentConfig = projectConfig(currentIndex.project);
  const currentTrain = /** @type {TrainFile | null} */ (trainFile(currentIndex, CODEGEN_TRAIN_KEY));
  const dead = unresolvedRefs(currentTrain, state.repo, state.stack.root, currentConfig);
  if (dead.length) return stop("training_refs_unresolved", { conventions: dead, next: "/qa-train codegen" });
  const active = state.items.find((i) => i.status === "in_progress");
  const resumed = active !== undefined;
  const item = active ?? state.items.find((i) => i.status === "pending");
  if (!item) return stop("no_pending_item");
  if (resumed) {
    // An interrupted turn is rolled back and retried: the carrier, the key and the passing
    // snapshot belong to the discarded tree, while the attempt count still counts against the cap.
    restoreItem(state, item);
    delete item.key;
    delete item.carried;
    delete item.snapshot;
    delete item.passing;
    delete item.verify;
    delete item.file;
  } else {
    item.attempts = 0;
    item.before = moduleSnapshot(state.repo, state.module_paths);
    item.before_qa = moduleSnapshot(state.repo, [".qa"]);
  }
  item.status = "in_progress";
  item.started_at = new Date().toISOString();
  item.before_tree = snapshotPrTree(state.repo);
  const folder = join(loaded.dir, "codegen", item.id);
  mkdirSync(folder, { recursive: true });
  const brief = join(folder, "brief.md");
  writeFileSync(brief, briefText(state, item));
  writeCodegen(loaded.dir, state);
  return {
    exit: 0,
    json: {
      action: "start", ok: true, ...(resumed && { resumed: true }),
      item: { id: item.id, case: item.case, summary: item.summary, level: item.level, scenario: item.scenario }, brief,
      text: `${resumed ? "Resumed" : "Item"} ${item.id} (${item.case}): write one test, then \`codegen verify --item ${item.id} --hypothesis "<one line>"\`.`,
    },
  };
}

/**
 * @param {string} repo
 * @param {readonly string[]} modulePaths
 * @returns {Record<string, PrFile>}
 */
function moduleSnapshot(repo, modulePaths) {
  const tree = snapshotPrTree(repo);
  return Object.fromEntries(Object.entries(tree).filter(([path]) => modulePaths.some((root) => under(path, root))));
}

/**
 * @param {Record<string, PrFile | null>} a
 * @param {Record<string, PrFile | null>} b
 * @returns {boolean}
 */
function sameChanges(a, b) {
  const left = new Set(Object.keys(a));
  const right = new Set(Object.keys(b));
  return left.size === right.size && [...left].every((path) => sameFile(a[path], b[path]));
}

/**
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @returns {string}
 */
function briefText(state, item) {
  const files = loadWorkingTree(state.root);
  const index = buildIndex(files);
  const feature = index.features.get(item.feature)?.[0]?.file;
  const rules = /** @type {Array<{ key: string, statement: string }>} */ (feature?.rules ?? []);
  const train = /** @type {TrainFile | null} */ (trainFile(index, CODEGEN_TRAIN_KEY));
  const config = projectConfig(index.project);
  const existing = config.modulePaths.filter((p) => existsSync(join(state.repo, p)));
  const bases = existing.length ? existing : existsSync(resolve(state.repo, state.stack.root)) ? [state.stack.root] : [];
  const keep = (/** @type {string[]} */ refs) => liveRefs(refs, (ref) => resolvesUnderAny(state.repo, ref, bases));
  const conventions = cleanConventions(train, keep);
  const practices = practicesText(index, CODEGEN_TRAIN_KEY);
  const refs = [...new Set(/** @type {ParsedEntry[]} */ (train?.conventions ?? []).flatMap((entry) => keep(strings(entry.data?.refs))))];
  const listing = refsListing(state.repo, refs);
  const adapter = resolveAdapter(config.stack, state.repo).adapter;
  const code = adapter ? buildCodeIndex(state.repo, config.modulePaths, config.annotationMap, adapter, keyPatterns(config)) : null;
  const siblings = siblingAutomationFiles(index, item, code);
  const evidence = passedEvidence(files, item.case);
  return [
    `# Codegen ${item.id}: ${item.case} — ${item.summary}`,
    "",
    "## The case (pinned text)",
    "",
    caseText(index, item.case),
    "## Expected sentences to map",
    "",
    ...item.expected.map((sentence) => `- ${sentence.id}: ${sentence.text}`),
    "",
    "## Feature Rules (for terms only; they never supply a locator)",
    "",
    ...(rules.length ? rules.map((rule) => `- ${rule.key}: ${rule.statement}`) : ["(none)"]),
    "",
    "## Passed Execution evidence",
    "",
    ...(evidence ? [evidence.text] : ["(none: expected values come only from the case's prose and the Rules above)"]),
    "",
    `## Conventions (train/codegen.md, stack ${state.stack.root})`,
    "",
    ...(conventions ? [conventions] : ["(none)"]),
    "",
    "## Practices",
    "",
    ...(practices ? [practices] : ["(none)"]),
    "",
    "## Where the code is (the CLI's listing of the Conventions' `refs` paths)",
    "",
    ...(listing.length ? listing : ["(none)"]),
    "",
    "## A sibling Automation's spec file",
    "",
    ...(siblings.length ? siblings : ["(none)"]),
    "",
    "## Target and runner",
    "",
    `Target: ${state.target.slug} (${state.target.origin})`,
    `Runner: ${state.runner.tool} in ${state.runner.dir}`,
    "",
    "## What you may read",
    "",
    "- this brief and `.qa/train/codegen.md`;",
    "- the support files the listing above names;",
    "- a sibling Automation's spec file, for its shape only;",
    "- never `.env*`, auth state, Access notes, or another test file for style.",
    "",
    "## Where expected values may come from",
    "",
    "This case's prose, the Feature Rules above, or a Passed Execution's evidence. Never from application source.",
    "",
    "## Where you may write",
    "",
    `Only under \`module_paths\` (${state.module_paths.join(", ")}) minus the deny list: never \`.qa/\`, runner or build config, lockfiles, \`.env*\`, auth state or snapshot baselines.`,
    `Write one new test for ${item.case}. The first verify mints its key; never write an Automation key yourself.`,
    "",
  ].join("\n");
}

/**
 * @param {ReturnType<typeof buildIndex>} index
 * @param {string} key
 * @returns {string}
 */
function caseText(index, key) {
  const decl = index.cases.get(key)?.[0];
  if (!decl) return "(the case is gone)";
  const entry = decl.file.cases.find((c) => c.key === key);
  return entry ? entry.prose.map((p) => p.text).join("\n") : "(the case is gone)";
}

/**
 * The brief carries each Convention with only its live refs, including block-style YAML lists.
 * @param {TrainFile | null} train
 * @param {(refs: string[]) => string[]} keep
 * @returns {string | null}
 */
function cleanConventions(train, keep) {
  if (!train) return null;
  const lines = train.text.replace(/\r\n/g, "\n").split("\n");
  const entries = /** @type {ParsedEntry[]} */ (train.conventions ?? []);
  return entries.map((entry) => {
    const chunk = lines.slice(entry.line - 1, entry.end);
    const at = entry.keyLines.refs === undefined ? -1 : entry.keyLines.refs - entry.line;
    if (at >= 0) {
      let end = at + 1;
      while (end < chunk.length && /^\s+-\s/.test(chunk[end])) end++;
      chunk.splice(at, end - at, `refs: ${JSON.stringify(keep(strings(entry.data.refs)))}`);
    }
    return chunk.join("\n").replace(/\s+$/, "");
  }).join("\n\n") || null;
}

/**
 * @param {string} repo
 * @param {string[]} refs
 * @returns {string[]}
 */
function refsListing(repo, refs) {
  /** @type {string[]} */
  const lines = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const ref of refs) {
    const abs = resolve(repo, ref);
    /** @type {string[]} */
    const at = [];
    try {
      if (statSync(abs).isDirectory()) at.push(...filesUnder(repo, [ref], () => true));
      else if (statSync(abs).isFile()) at.push(ref.replaceAll("\\", "/"));
    } catch {
      continue;
    }
    for (const file of at.sort()) {
      if (seen.has(file)) continue;
      seen.add(file);
      lines.push(`- ${file}`);
      for (const name of declarationsOf(repo, file)) lines.push(`  - ${name}`);
    }
  }
  return lines;
}

/**
 * @param {string} repo
 * @param {string} file
 * @returns {string[]}
 */
function declarationsOf(repo, file) {
  let text;
  try {
    text = readFileSync(join(repo, file), "utf8");
  } catch {
    return [];
  }
  /** @type {string[]} */
  const names = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?(?:async\s+)?(?:class|function|interface|type|const|let|var|fun|object)\s+([A-Za-z_][\w]*)/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * The file of a sibling Automation in the item's Scenario, which the brief may read for its shape.
 * @param {ReturnType<typeof buildIndex>} index
 * @param {CodegenItem} item
 * @param {ReturnType<typeof buildCodeIndex> | null} code
 * @returns {string[]}
 */
function siblingAutomationFiles(index, item, code) {
  const scenario = index.scenarios.get(String(index.cases.get(item.case)?.[0]?.file.data.key ?? ""))?.[0]?.file;
  if (!scenario || !code) return [];
  /** @type {string[]} */
  const automations = [];
  for (const c of scenario.cases) automations.push(...strings(c.data.automates));
  const files = automations.flatMap((automation) => code.functions.filter((fn) => fn.automationKeys.some((key) => key.key === automation)).map((fn) => fn.file));
  return [...new Set(files)];
}

/**
 * @param {ReturnType<typeof loadWorkingTree>} files
 * @param {string} key
 * @returns {{ text: string } | null}
 */
function passedEvidence(files, key) {
  /** @type {{ at: number, text: string } | null} */
  let best = null;
  for (const file of files) {
    if (file.unreadable || file.type !== "execution") continue;
    for (const entry of file.executions) {
      if (entry.key !== key || entry.data.result !== "passed") continue;
      const at = Date.parse(String(file.data.executed_at));
      if (best === null || at > best.at) best = { at, text: entry.prose.map((p) => p.text.trim()).filter(Boolean).join("\n") };
    }
  }
  return best && best.text ? { text: best.text } : null;
}

// ---------------------------------------------------------------------------------------------
// verify

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function verify(args, { dir, seed, env, item: id, hypothesis }) {
  noArguments("codegen verify", args, "--dir <run-dir> --item <id> --hypothesis <line>");
  requireOption("codegen verify", hypothesis, "--hypothesis <line>", "one line naming what this edit proves");
  const loaded = load(dir, "verify");
  const state = loaded.state;
  const found = itemOf(state, /** @type {string | undefined} */ (id), "verify");
  if ("refusal" in found) return found.refusal;
  const item = found.item;
  if (item.status !== "in_progress") return stop(item.status === "pending" ? "not_started" : "wrong_state", { item: item.id, status: item.status });
  if (item.attempts >= state.training.codegen_attempts) {
    const draft = recordFailure(state, loaded.dir, item, "cap-reached");
    return stop("cap-reached", { item: item.id, attempts: item.attempts, cap: state.training.codegen_attempts, ...(draft && { draft }) });
  }
  const current = moduleSnapshot(state.repo, state.module_paths);
  /** @type {Record<string, PrFile | null>} */
  const changes = diffTrees(/** @type {Record<string, PrFile>} */ (item.before ?? {}), current);
  const guarded = guardChanges(state, item, changes);
  if (!guarded.ok) return guarded.refusal;
  const qaOutside = knowledgeChange(state, item);
  if (qaOutside) return qaOutside;
  const additive = additiveRefusal(state, item, changes);
  if (additive) return additive;
  const secret = secretRefusal(state, item, changes);
  if (secret) return secret;
  const dirty = Object.keys(changes).filter((path) => (state.dirty ?? []).includes(path));
  if (dirty.length) {
    const draft = recordFailure(state, loaded.dir, item, "dirty");
    return { exit: 1, json: { ok: false, refusals: [fact("dirty", { item: item.id, paths: dirty, ...(draft && { draft }) })] } };
  }
  const files = loadWorkingTree(state.root);
  const config = projectConfig(buildIndex(files).project);
  const adapter = resolveAdapter(config.stack, state.repo).adapter;
  if (!adapter) return stop("no_code_adapter", { stack: config.stack?.language ?? null });
  /** @type {AutomationSelection | null} */
  let selection = null;
  if (item.key) {
    selection = selectionFor(state, item.key);
  } else {
    const added = addedFunction(state, item, changes, adapter, config);
    if ("refusal" in added) return added.refusal;
    if (!item.carried) {
      const rendered = config.autExternal
        ? writeTrackerCarrier(state, item, added, adapter, config)
        : mintAndRender(state, item, changes, seed);
      if ("refusal" in rendered) return rendered.refusal;
      item.carried = true;
      if ("key" in rendered) item.key = /** @type {string} */ (rendered.key);
      item.file = rendered.path ?? added.path;
    }
    const fresh = freshFunction(state, added, adapter, config) ?? added.fn;
    item.file = fresh.file;
    selection = selectionOf(config, fresh);
  }
  if (!selection) return stop("test_missing", { item: item.id, key: item.key ?? item.tracker ?? "" });
  item.attempts += 1;
  const repeats = state.training.codegen_repeats;
  let passes = 0;
  /** @type {{ passed: false, reason: string, instance?: string, diagnostics: string[], repeat: number } | null} */
  let failed = null;
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const output = join(loaded.dir, "codegen", `${item.id}-${item.attempts}-${repeat}`);
    mkdirSync(output, { recursive: true });
    const outcome = runSelection({ selection, runner: state.runner, repo: state.repo, dir: output, origin: state.target.origin, env, retries: 0 });
    const proof = proofOf(outcome.parsed);
    if (!proof.passed) {
      failed = { ...proof, repeat };
      break;
    }
    passes += 1;
  }
  item.hypothesis = String(hypothesis);
  item.passing = failed === null;
  item.verify = { hypothesis: String(hypothesis), repeats, passes, ...(failed && { failed_at: failed.repeat }), at: new Date().toISOString() };
  if (failed) {
    writeCodegen(loaded.dir, state);
    return { exit: 0, json: { action: "verify", ok: true, passed: false, ...(item.key && { key: item.key }), passes, repeats, failed_at: failed.repeat, diagnostics: failed.diagnostics, text: `Verify failed at repetition ${failed.repeat} of ${repeats} (${failed.reason}): ${failed.diagnostics.join(" ")}`.trim() } };
  }
  // The passing snapshot is the tree the runner proved: the carrier is already rendered on it.
  item.snapshot = diffTrees(/** @type {Record<string, PrFile>} */ (item.before ?? {}), moduleSnapshot(state.repo, state.module_paths));
  writeCodegen(loaded.dir, state);
  return { exit: 0, json: { action: "verify", ok: true, passed: true, ...(item.key && { key: item.key }), passes, repeats, selector: selection.file, text: `Verify passed ${passes} of ${repeats} repetitions for ${item.key ?? `${item.tracker} (tracker key; mint with your tool, then \`/qa-sync\`)`}.` } };
}

/**
 * `/qa-codegen` never edits the knowledge layer; the CLI alone writes `automates` at `done`.
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @returns {CommandResult | null}
 */
function knowledgeChange(state, item) {
  const changes = diffTrees(/** @type {Record<string, PrFile>} */ (item.before_qa ?? {}), moduleSnapshot(state.repo, [".qa"]));
  const path = Object.keys(changes)[0];
  return path === undefined ? null : { exit: 1, json: { ok: false, refusals: [fact("out_of_scope", { path, message: "The item changed the knowledge layer." })] } };
}

/**
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @param {Record<string, PrFile | null>} changes
 * @returns {{ ok: true } | { ok: false, refusal: CommandResult }}
 */
function guardChanges(state, item, changes) {
  const files = loadWorkingTree(state.root);
  const config = projectConfig(buildIndex(files).project);
  const adapter = resolveAdapter(config.stack, state.repo).adapter;
  /** @type {GuardEdit[]} */
  const edits = Object.entries(changes).map(([path, file]) => ({ path, before: fileText(state.repo, item.before?.[path] ?? null), after: fileText(state.repo, file) }));
  const result = checkEdits({ repo: state.repo, modulePaths: state.module_paths, annotationMap: config.annotationMap, adapter, patterns: keyPatterns(config), edits });
  if (result.ok) return { ok: true };
  const refusals = result.refusals.map((refusal) => ({ ...fact(refusal.code, { ...(refusal.path && { path: refusal.path }), message: String(refusal.message ?? "") }), ...(refusal.path && { path: refusal.path }) }));
  return { ok: false, refusal: { exit: 1, json: { ok: false, refusals } } };
}

/**
 * The additive rule: a pre-existing file keeps every test function's bytes, and loses no token.
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @param {Record<string, PrFile | null>} changes
 * @returns {CommandResult | null}
 */
function additiveRefusal(state, item, changes) {
  const config = projectConfig(buildIndex(loadWorkingTree(state.root)).project);
  const adapter = resolveAdapter(config.stack, state.repo).adapter;
  if (!adapter) return null;
  const patterns = keyPatterns(config);
  for (const [path, after] of Object.entries(changes)) {
    const before = item.before?.[path] ?? null;
    if (!before) continue;
    const beforeText = fileText(state.repo, before);
    const afterText = fileText(state.repo, after);
    if (beforeText === null || afterText === null) continue;
    for (const region of spans(beforeText, path, config.annotationMap, adapter, patterns)) {
      if (!afterText.includes(region.text)) return { exit: 1, json: { ok: false, refusals: [fact("not_additive", { path, test: region.name, message: `The test function \`${region.name}\` is no longer byte-identical.` })] } };
    }
    if (!subsequence(tokens(beforeText), tokens(afterText))) return { exit: 1, json: { ok: false, refusals: [fact("not_additive", { path, message: "The edit deletes a token that existed before the item." })] } };
  }
  return null;
}

/**
 * @param {string} text
 * @param {string} path
 * @param {Record<string, string[]>} annotationMap
 * @param {StackAdapter} adapter
 * @param {KeyPatterns} patterns
 * @returns {Array<{ name: string, text: string }>}
 */
function spans(text, path, annotationMap, adapter, patterns) {
  const index = indexSource(text, path, annotationMap, adapter, patterns);
  const lines = text.split("\n");
  const starts = index.functions.map((f) => f.line).concat(index.classes.map((c) => c.line)).sort((a, b) => a - b);
  /** @type {Map<number, number>} */
  const offsets = new Map();
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    offsets.set(i + 1, offset);
    offset += lines[i].length + 1;
  }
  return index.functions.map((fn) => {
    const next = starts.find((line) => line > fn.line) ?? lines.length + 1;
    const start = offsets.get(fn.line) ?? 0;
    const end = next <= lines.length ? offsets.get(next) ?? text.length : text.length;
    return { name: fn.name, text: text.slice(start, end) };
  });
}

/** @param {string} text @returns {string[]} */
const tokens = (text) => text.match(/\S+/g) ?? [];

/**
 * @param {string[]} before
 * @param {string[]} after
 * @returns {boolean}
 */
function subsequence(before, after) {
  let i = 0;
  for (const token of after) if (i < before.length && before[i] === token) i++;
  return i === before.length;
}

/**
 * The one test function the item added, from the pre-item and current trees.
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @param {Record<string, PrFile | null>} changes
 * @param {StackAdapter} adapter
 * @param {ProjectConfig} config
 * @returns {{ path: string, fn: IndexedFunction } | { refusal: CommandResult }}
 */
function addedFunction(state, item, changes, adapter, config) {
  const patterns = keyPatterns(config);
  /** @type {Array<{ path: string, fn: IndexedFunction }>} */
  const added = [];
  for (const [path, after] of Object.entries(changes)) {
    const beforeText = fileText(state.repo, item.before?.[path] ?? null) ?? "";
    const afterText = fileText(state.repo, after) ?? "";
    const before = new Set(indexSource(beforeText, path, config.annotationMap, adapter, patterns).functions.map((f) => `${f.class}\0${f.name}`));
    for (const fn of indexSource(afterText, path, config.annotationMap, adapter, patterns).functions) if (!before.has(`${fn.class}\0${fn.name}`)) added.push({ path, fn });
  }
  if (added.length !== 1) return { refusal: stop("not_one_new_test", { count: added.length }) };
  return added[0];
}

/**
 * The one new test function as the tree now holds it, after a carrier write shifted its line.
 * @param {CodegenState} state
 * @param {{ path: string, fn: IndexedFunction }} added
 * @param {StackAdapter} adapter
 * @param {ProjectConfig} config
 * @returns {IndexedFunction | null}
 */
function freshFunction(state, added, adapter, config) {
  const text = readFileSync(join(state.repo, added.path), "utf8");
  return indexSource(text, added.path, config.annotationMap, adapter, keyPatterns(config)).functions
    .find((fn) => fn.class === added.fn.class && fn.name === added.fn.name) ?? null;
}

/**
 * @param {ProjectConfig} config
 * @param {IndexedFunction} fn
 * @returns {AutomationSelection}
 */
function selectionOf(config, fn) {
  const titles = [...fn.classes.map((c) => c.name), fn.name];
  return {
    id: fn.automationKeys[0]?.key ?? `${fn.file}:${fn.line}`,
    stack: config.stack?.root ?? ".",
    file: fn.file,
    line: fn.line,
    titles,
    package: fn.package,
    literal: !fn.parameterised && titles.every((t) => t.length > 0 && t.trim() === t && !/[›\r\n]|\$\{/.test(t)),
    tagged: fn.automationKeys.length > 0 && carrierNames(config.annotationMap, "automation_key").includes("tag"),
  };
}

/**
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @param {Record<string, PrFile | null>} changes
 * @param {string | undefined} seed
 * @returns {{ key: string, path: string } | { refusal: CommandResult }}
 */
function mintAndRender(state, item, changes, seed) {
  const config = projectConfig(buildIndex(loadWorkingTree(state.root)).project);
  const adapter = resolveAdapter(config.stack, state.repo).adapter;
  if (!adapter) return { refusal: stop("no_code_adapter", { stack: config.stack?.language ?? null }) };
  const found = addedFunction(state, item, changes, adapter, config);
  if ("refusal" in found) return found;
  const { path, fn } = found;
  const chosen = choosePrefix(state, item, fn, path, config, adapter);
  if ("refusal" in chosen) return chosen;
  const minted = mint("aut", { root: state.root, ...(chosen.prefix !== undefined && { prefix: chosen.prefix }), ...(seed !== undefined && { seed }) });
  if (minted.error) return { refusal: stop("invalid_key_prefix", { reason: minted.error }) };
  const key = /** @type {{ keys: string[] }} */ (minted).keys[0];
  const text = readFileSync(join(state.repo, path), "utf8");
  const rendered = /** @type {RenderAdapter} */ (/** @type {unknown} */ (adapter)).render(text, {
    annotate: [{ fn: { file: path, line: fn.line, class: fn.class, name: fn.name }, handle: { key } }],
    rekey: [],
    prefix: chosen.write?.kind === "class" ? [{ cls: { file: path, line: chosen.write.cls.line, path: chosen.write.cls.path }, prefix: /** @type {string} */ (chosen.prefix) }] : [],
    header: chosen.write?.kind === "header" ? [{ prefix: /** @type {string} */ (chosen.prefix) }] : [],
  }, writeCarrier(config, state.repo, adapter), path);
  if (rendered.errors.length) return { refusal: stop("invalid_key_carrier", { errors: rendered.errors }) };
  writeFileSync(join(state.repo, path), rendered.text);
  return { key, path };
}

/**
 * ADR-0012: the project's own tool mints the Automation key, so the framework writes only the
 * case's Tracker key on the new test and leaves it Unkeyed.
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @param {{ path: string, fn: IndexedFunction }} added
 * @param {StackAdapter} adapter
 * @param {ProjectConfig} config
 * @returns {{ path: string } | { refusal: CommandResult }}
 */
function writeTrackerCarrier(state, item, added, adapter, config) {
  if (typeof item.tracker !== "string") return { refusal: stop("invalid_key_carrier", { reason: "the case has no Tracker key" }) };
  const names = carrierNames(config.annotationMap, "tracker_key_fn");
  if (!names.length) return { refusal: stop("invalid_key_carrier", { reason: "`annotation_map.tracker_key_fn` names no carrier" }) };
  const { path, fn } = added;
  const text = readFileSync(join(state.repo, path), "utf8");
  const rendered = /** @type {RenderAdapter} */ (/** @type {unknown} */ (adapter)).render(text, {
    annotate: [{ fn: { file: path, line: fn.line, class: fn.class, name: fn.name }, handle: { key: item.tracker } }],
    rekey: [],
    prefix: [],
    header: [],
  }, { name: names[0], names, home: trackerHome(state, names[0]), prefix: { name: "", home: null } }, path);
  if (rendered.errors.length) return { refusal: stop("invalid_key_carrier", { errors: rendered.errors }) };
  writeFileSync(join(state.repo, path), rendered.text);
  return { path };
}

/**
 * The package an existing test file imports the tracker carrier from, for a stack that needs one.
 * @param {CodegenState} state
 * @param {string} name
 * @returns {string | null}
 */
function trackerHome(state, name) {
  for (const file of filesUnder(state.repo, [state.stack.root], () => true)) {
    let text;
    try {
      text = readFileSync(join(state.repo, file), "utf8");
    } catch {
      continue;
    }
    const match = new RegExp(`^[\\t ]*import[\\t ]+([\\w.]+)\\.${name.replaceAll(".", "\\.")}[\\t ]*$`, "m").exec(text);
    if (match) return match[1];
  }
  return null;
}

/**
 * @param {ProjectConfig} config
 * @param {string} repo
 * @param {StackAdapter} adapter
 * @returns {RenderCarrier}
 */
function writeCarrier(config, repo, adapter) {
  const ann = annotation(/** @type {import("./sync-code.mjs").SyncCodeContext} */ (/** @type {unknown} */ ({ config, repo, stack: { adapter } })));
  return { name: ann.name ?? "", names: ann.names ?? [], home: ann.home ?? null, prefix: ann.prefix ?? { name: carrierNames(config.annotationMap, "automation_key_prefix")[0] ?? "", home: null } };
}

/**
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @param {IndexedFunction} fn
 * @param {string} path
 * @param {ProjectConfig} config
 * @param {StackAdapter} adapter
 * @returns {{ prefix?: string, write?: PrefixWrite } | { refusal: CommandResult }}
 */
function choosePrefix(state, item, fn, path, config, adapter) {
  const recipe = config.autRecipe;
  if (!recipe) return {};
  const nearest = [...fn.classes].reverse().find((c) => c.keyPrefixes.length > 0);
  const header = adapter.fileKeyPrefix ? indexSource(readFileSync(join(state.repo, path), "utf8"), path, config.annotationMap, adapter, keyPatterns(config)).header : null;
  let prefix = nearest?.keyPrefixes.at(-1)?.key ?? header?.keyPrefixes[0]?.key;
  /** @type {PrefixWrite | undefined} */
  let write;
  if (prefix === undefined) {
    const proposal = state.prefixes.find((p) => p.scenario === item.scenario_key || p.scenario === item.scenario)?.prefix ?? null;
    if (proposal === null) return { refusal: stop("invalid_key_prefix", { reason: "no Key prefix exists, and the plan proposed none" }) };
    prefix = proposal;
    if (fn.classes.length) write = { kind: "class", cls: fn.classes[0] };
    else if (adapter.fileKeyPrefix) write = { kind: "header", file: path };
    else return { refusal: stop("invalid_key_prefix", { reason: "a test in no class has nowhere to carry a Key prefix" }) };
  }
  if (!prefixFits(prefix, recipe)) return { refusal: stop("invalid_key_prefix", { prefix }) };
  return { prefix, ...(write && { write }) };
}

/**
 * @param {CodegenState} state
 * @param {string} key
 * @returns {AutomationSelection | null}
 */
function selectionFor(state, key) {
  const config = projectConfig(buildIndex(loadWorkingTree(state.root)).project);
  const adapter = resolveAdapter(config.stack, state.repo).adapter;
  if (!adapter) return null;
  const code = buildCodeIndex(state.repo, config.modulePaths, config.annotationMap, adapter, keyPatterns(config));
  const fn = code.functions.find((f) => f.automationKeys.some((k) => k.key === key));
  if (!fn) return null;
  const titles = [...fn.classes.map((c) => c.name), fn.name];
  return {
    id: key,
    stack: config.stack?.root ?? ".",
    file: fn.file,
    line: fn.line,
    titles,
    literal: !fn.parameterised && titles.every((t) => t.length > 0 && t.trim() === t && !/[›\r\n]|\$\{/.test(t)),
    tagged: carrierNames(config.annotationMap, "automation_key").includes("tag"),
  };
}

/**
 * Every instance passed and none skipped: the codegen verify predicate, distinct from execute's
 * Automation-result aggregation.
 * @param {RunnerResult} parsed
 * @returns {{ passed: true } | { passed: false, reason: string, instance?: string, diagnostics: string[] }}
 */
function proofOf(parsed) {
  if (parsed.reason) return { passed: false, reason: parsed.reason, diagnostics: parsed.diagnostics };
  const entries = Object.entries(parsed.instances);
  if (!entries.length) return { passed: false, reason: "no-result", diagnostics: parsed.diagnostics };
  for (const [id, attempts] of entries) {
    for (const attempt of attempts) if (attempt.result !== "passed") return { passed: false, reason: attempt.reason ?? attempt.result, instance: id, diagnostics: parsed.diagnostics };
  }
  return { passed: true };
}

// ---------------------------------------------------------------------------------------------
// done

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function done(args, { dir, item: id, expects: given }) {
  noArguments("codegen done", args, "--dir <run-dir> --item <id> --expects <json>");
  const expects = /** @type {string | undefined} */ (given);
  requireOption("codegen done", expects, "--expects <json>", "the Expected-to-line mapping");
  const loaded = load(dir, "done");
  const state = loaded.state;
  const found = itemOf(state, /** @type {string | undefined} */ (id), "done");
  if ("refusal" in found) return found.refusal;
  const item = found.item;
  if (item.status !== "in_progress" || !item.passing || !item.snapshot) return stop("no_passing_verify", { item: item.id });
  const current = moduleSnapshot(state.repo, state.module_paths);
  const qaOutside = knowledgeChange(state, item);
  if (qaOutside) return qaOutside;
  /** @type {Record<string, PrFile | null>} */
  const changes = diffTrees(/** @type {Record<string, PrFile>} */ (item.before ?? {}), current);
  const secret = secretRefusal(state, item, changes);
  if (secret) return secret;
  if (!sameChanges(item.snapshot, changes)) return stop("changed_after_verify", { item: item.id });
  const dirty = Object.keys(changes).filter((path) => (state.dirty ?? []).includes(path));
  if (dirty.length) {
    const draft = recordFailure(state, loaded.dir, item, "dirty");
    return { exit: 1, json: { ok: false, refusals: [fact("dirty", { item: item.id, paths: dirty, ...(draft && { draft }) })] } };
  }
  const mapping = parseExpects(/** @type {string} */ (expects));
  if ("refusal" in mapping) return mapping.refusal;
  const structural = checkExpects(state, item, mapping.value, changes);
  if (structural) return structural;
  const external = Boolean(item.key === undefined && item.carried);
  if (!external) {
    const written = writeAutomates(state, item, /** @type {string} */ (item.key));
    if (written) return written;
  }
  const preExisting = Object.keys(changes).some((path) => item.before_tree?.[path] !== undefined);
  item.status = "done";
  item.expects = mapping.value;
  item.pre_existing = preExisting;
  item.after_tree = snapshotPrTree(state.repo);
  state.done = [...(state.done ?? []), item.id];
  state.regressPassed = false;
  delete state.regression;
  if (state.pr && state.pr.mode.kind !== "working-tree" && !external) {
    const committed = commitPrItem(state.pr, {
      id: item.id,
      case: item.case,
      ...(item.key && { automation: item.key }),
      ...(item.file && { file: item.file }),
      cases: [{ key: item.case, summary: item.summary }],
      expects: mapping.value,
      ...(item.hypothesis && { summary: item.hypothesis }),
    }, /** @type {Record<string, PrFile>} */ (item.before_tree ?? {}));
    if (committed.failure) return prResult(committed.failure);
  }
  writeCodegen(loaded.dir, state);
  const mappingText = Object.entries(mapping.value).map(([id, lines]) => `\n  ${id} → ${lines.join(", ")}`).join("");
  return {
    exit: 0,
    json: {
      action: "done", ok: true, ...(item.key && { key: item.key }), ...(!external && { automates: [item.key] }),
      regress: preExisting,
      text: external
        ? `${item.id} (${item.case}): wrote the tracker-key carrier for ${item.tracker}. Mint with your tool, then \`/qa-sync\`.${mappingText}`
        : `${item.id} (${item.case}): bound automates: [${item.key}]${mappingText}${preExisting ? "\nRun `codegen regress` before `pr-prepare`: a pre-existing file was touched." : ""}`,
    },
  };
}

/**
 * @param {string} text
 * @returns {{ value: Record<string, string[]> } | { refusal: CommandResult }}
 */
function parseExpects(text) {
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    return { refusal: stop("expects_invalid", { message: "it is not JSON" }) };
  }
  if (!isMap(input)) return { refusal: stop("expects_invalid", { message: "it is not a JSON object" }) };
  /** @type {Record<string, string[]>} */
  const value = {};
  for (const [id, given] of Object.entries(input)) {
    const lines = typeof given === "string" ? [given] : Array.isArray(given) ? given : null;
    if (!lines || !lines.length || lines.some((l) => typeof l !== "string")) return { refusal: stop("expects_invalid", { sentence: id }) };
    value[id] = /** @type {string[]} */ (lines);
  }
  return { value };
}

/**
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @param {Record<string, string[]>} mapping
 * @param {Record<string, PrFile | null>} changes
 * @returns {CommandResult | null}
 */
function checkExpects(state, item, mapping, changes) {
  const known = new Set(item.expected.map((s) => s.id));
  for (const id of Object.keys(mapping)) if (!known.has(id)) return { exit: 1, json: { ok: false, refusals: [fact("expects_unknown", { sentence: id })] } };
  for (const sentence of item.expected) if (!mapping[sentence.id]?.length) return { exit: 1, json: { ok: false, refusals: [fact("expects_unmapped", { sentence: sentence.id, text: sentence.text })] } };
  for (const [id, lines] of Object.entries(mapping)) {
    for (const line of lines) {
      const parsed = /^(.*):(\d+)$/.exec(line);
      if (!parsed) return refusal("expects_line", id, line);
      const [, path, number] = parsed;
      if (!state.module_paths.some((root) => under(path, root))) return refusal("expects_line", id, line);
      const after = fileText(state.repo, changes[path]);
      if (after === null) return refusal("expects_not_added", id, line);
      const before = fileText(state.repo, item.before?.[path] ?? null);
      const at = Number(number);
      if (!addedLines(before, after).has(at)) return refusal("expects_not_added", id, line);
      const lineText = after.split("\n")[at - 1] ?? "";
      if (!usableLine(lineText)) return { exit: 1, json: { ok: false, refusals: [fact("expects_not_in_test", { sentence: id, value: line, message: "the line is blank, a comment or an import" })] } };
      if (!insideNewTest(state, path, at, before, after)) return refusal("expects_not_in_test", id, line);
    }
  }
  return null;
}

/**
 * @param {string} code
 * @param {string} sentence
 * @param {string} value
 * @returns {CommandResult}
 */
const refusal = (code, sentence, value) => ({ exit: 1, json: { ok: false, refusals: [fact(code, { sentence, value })] } });

/**
 * @param {string | null} before
 * @param {string} after
 * @returns {Set<number>}
 */
function addedLines(before, after) {
  const a = after.split("\n");
  if (before === null) return new Set(a.map((_, i) => i + 1));
  const b = before.split("\n");
  let prefix = 0;
  while (prefix < b.length && prefix < a.length && b[prefix] === a[prefix]) prefix++;
  let suffix = 0;
  while (suffix < b.length - prefix && suffix < a.length - prefix && b[b.length - 1 - suffix] === a[a.length - 1 - suffix]) suffix++;
  const out = new Set();
  for (let i = prefix; i < a.length - suffix; i++) out.add(i + 1);
  return out;
}

/** @param {string} line @returns {boolean} */
function usableLine(line) {
  const text = line.trim();
  if (text === "") return false;
  if (text.startsWith("//") || text.startsWith("/*") || text.startsWith("*") || text.startsWith("#")) return false;
  if (/^(?:import|export\s+\*|export\s+\{[^}]*\}\s+from|from\s+\S+\s+import|package|use)\b/.test(text)) return false;
  return true;
}

/**
 * @param {CodegenState} state
 * @param {string} path
 * @param {number} line
 * @param {string | null} beforeText
 * @param {string} afterText
 * @returns {boolean}
 */
function insideNewTest(state, path, line, beforeText, afterText) {
  const config = projectConfig(buildIndex(loadWorkingTree(state.root)).project);
  const adapter = resolveAdapter(config.stack, state.repo).adapter;
  if (!adapter) return false;
  const patterns = keyPatterns(config);
  const after = indexSource(afterText, path, config.annotationMap, adapter, patterns);
  const before = beforeText === null ? null : indexSource(beforeText, path, config.annotationMap, adapter, patterns);
  const existed = new Set((before?.functions ?? []).map((f) => `${f.class}\0${f.name}`));
  const fresh = after.functions.filter((f) => !existed.has(`${f.class}\0${f.name}`));
  const boundaries = after.functions.map((f) => f.line).concat(after.classes.map((c) => c.line)).sort((x, y) => x - y);
  const inRegion = (/** @type {number} */ start) => {
    const next = boundaries.find((at) => at > start) ?? afterText.split("\n").length + 1;
    return line >= start && line < next;
  };
  if (fresh.some((f) => inRegion(f.line))) return true;
  if (beforeText === null) return true;
  const oldBoundaries = (before?.functions ?? []).map((f) => f.line).concat((before?.classes ?? []).map((c) => c.line)).sort((x, y) => x - y);
  const inOld = (/** @type {number} */ start) => {
    const next = oldBoundaries.find((at) => at > start) ?? Number.MAX_SAFE_INTEGER;
    return line >= start && line < next;
  };
  return !(before?.functions ?? []).some((f) => inOld(f.line));
}

/**
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @param {string} key
 * @returns {CommandResult | null}
 */
function writeAutomates(state, item, key) {
  const files = loadWorkingTree(state.root);
  const decl = buildIndex(files).cases.get(item.case)?.[0];
  if (!decl) return stop("automates_write", { case: item.case });
  const rel = decl.file.rel;
  const text = readFileSync(join(state.root, rel), "utf8");
  const existing = strings(decl.entry?.data.automates);
  const automates = existing.includes(key) ? existing : [...existing, key];
  const first = edit(parse(rel, text), [{ at: item.case, set: { automates } }]);
  if (first.errors.length) return stop("automates_write", { errors: first.errors.map((e) => e.message) });
  writeFileSync(join(state.root, rel), first.text);
  return null;
}

// ---------------------------------------------------------------------------------------------
// regress

/**
 * The shared rollback loop over the Automations a done item's files hold: a regressing insertion
 * rolls the item back in reverse completion order, restoring its test files and its Scenario's
 * `automates` together, and rebuilding the surviving PR chain.
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function regress(args, { dir, env }) {
  noArguments("codegen regress", args, "--dir <run-dir>");
  const loaded = load(dir, "regress");
  const state = loaded.state;
  if (state.items.some((item) => item.status === "pending" || item.status === "in_progress")) return stop("items_pending", { items: state.items.filter((item) => item.status === "pending" || item.status === "in_progress").map((item) => item.id) });
  if (state.pr?.journal) return stop("already_prepared", { branch: state.pr.branch });
  const config = projectConfig(buildIndex(loadWorkingTree(state.root)).project);
  const all = fixSelections(state.repo, config);
  const itemOf = (/** @type {string} */ id) => state.items.find((item) => item.id === id && item.status !== "pending");
  if (!(state.done ?? []).some((id) => itemOf(id)?.pre_existing)) {
    state.regressPassed = true;
    writeCodegen(loaded.dir, state);
    return { exit: 0, json: { ok: true, checked: 0, rolled_back: state.regress?.rolled_back ?? [], text: "Codegen regress: no done item touched a pre-existing file." } };
  }
  const touched = new Set();
  for (const id of state.done ?? []) {
    const item = itemOf(id);
    if (!item?.after_tree) continue;
    for (const path of Object.keys(diffTrees(/** @type {Record<string, PrFile>} */ (item.before_tree ?? {}), item.after_tree))) {
      if (state.module_paths.some((root) => under(path, root))) touched.add(path);
    }
  }
  /** @type {Record<string, string>} */
  const support = {};
  for (const path of touched) {
    if (all.some((selection) => selection.file === path)) continue;
    const item = (state.done ?? []).map(itemOf).find((candidate) => candidate?.before_tree?.[path] || candidate?.after_tree?.[path]);
    const before = fileText(state.repo, item?.before_tree?.[path] ?? null);
    const after = fileText(state.repo, item?.after_tree?.[path] ?? null);
    if (before !== null || after !== null) support[path] = [before, after].filter((text) => text !== null).join("\n");
  }
  const dependents = regressionDependents(state.repo, config, support);
  const selections = all.filter((selection) => touched.has(selection.file) || dependents.includes(selection.file));
  state.regression ??= selections;
  state.regressPassed = false;
  writeCodegen(loaded.dir, state);
  mkdirSync(join(loaded.dir, "regress"), { recursive: true });
  const batch = mkdtempSync(join(loaded.dir, "regress", "check-"));
  /** @type {string[]} */
  const rolled = [...(state.regress?.rolled_back ?? [])];
  const idsOf = (/** @type {CodegenItem} */ item) => [item.key, item.file].filter((value) => typeof value === "string");
  const active = (/** @type {AutomationSelection[]} */ wanted) => {
    if (!state.done?.length) return [];
    const surviving = new Set((state.done ?? []).flatMap((id) => { const item = itemOf(id); return item ? idsOf(item) : []; }));
    return wanted.filter((selection) => surviving.has(selection.id) || surviving.has(selection.file) ||
      !state.items.some((item) => item.status === "failed" && item.failure?.reason === "regressed" && idsOf(item).some((id) => id === selection.id || id === selection.file)));
  };
  const passes = (/** @type {AutomationSelection} */ selection, /** @type {number} */ cycle) => {
    const output = join(batch, String(cycle), selection.id.replace(/[^\w-]/g, "_"));
    mkdirSync(output, { recursive: true });
    return proveSelection({ selection, runner: state.runner, repo: state.repo, dir: output, origin: state.target.origin, env, retries: 0 }, 1).passed;
  };
  const rollback = (/** @type {string} */ id) => {
    const item = itemOf(id);
    if (!item) return;
    const beforeTree = /** @type {Record<string, PrFile>} */ (item.before_tree ?? {});
    for (const path of Object.keys(diffTrees(beforeTree, item.after_tree ?? beforeTree))) writeTreeFile(state.repo, path, beforeTree[path] ?? null);
    if (state.pr && state.pr.mode.kind !== "working-tree") rebuildPrChain(state.pr, id);
    item.status = "failed";
    item.passing = false;
    item.failure = { reason: "regressed" };
  };
  const result = rollbackUntilPassing({
    selections,
    active,
    refresh: () => fixSelections(state.repo, config),
    passes,
    lastCompleted: () => (state.done ?? []).pop() ?? null,
    rollback,
    rolled,
    onChecked: (checked, list) => { state.regress = { checked, rolled_back: list }; },
    save: () => writeCodegen(loaded.dir, state),
  });
  state.regressPassed = result.ok;
  writeCodegen(loaded.dir, state);
  return {
    exit: result.ok ? 0 : 1,
    json: {
      ok: result.ok, checked: result.checked, rolled_back: result.rolled,
      text: `Codegen regress: ${result.checked} checked, ${result.rolled.length} rolled back.${result.ok ? "" : " Review the run dir and fix the touched support code."}`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// fail

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function fail(args, { dir, item: id, reason: givenReason, cnv: givenCnv }) {
  noArguments("codegen fail", args, "--dir <run-dir> --item <id> --reason <reason> [--cnv <key>]");
  const reason = /** @type {string | undefined} */ (givenReason);
  requireOption("codegen fail", reason, "--reason <reason>", "one closed failure reason");
  const loaded = load(dir, "fail");
  const state = loaded.state;
  const found = itemOf(state, /** @type {string | undefined} */ (id), "fail");
  if ("refusal" in found) return found.refusal;
  const item = found.item;
  if (item.status !== "in_progress") return stop("wrong_state", { item: item.id, status: item.status });
  if (!CLOSED_REASONS.has(String(reason))) return stop("unknown_reason", { reason });
  const cnv = /** @type {string | undefined} */ (givenCnv);
  if (reason === "convention-conflict") {
    const train = /** @type {TrainFile | null} */ (trainFile(buildIndex(loadWorkingTree(state.root)), CODEGEN_TRAIN_KEY));
    const keys = new Set(/** @type {ParsedEntry[]} */ (train?.conventions ?? []).map((entry) => entry.key));
    if (!cnv || !keys.has(cnv)) return stop("unknown_cnv", { cnv: cnv ?? null });
  }
  const draft = recordFailure(state, loaded.dir, item, String(reason), cnv && reason === "convention-conflict" ? { cnv } : {});
  return {
    exit: 0,
    json: {
      action: "fail", ok: true, item: item.id, reason, ...(item.failure?.cnv && { cnv: item.failure.cnv }), ...(draft && { draft }),
      text: `${item.id} (${item.case}) failed: ${reason}.${draft ? ` Unverified draft kept at ${draft}.` : ""}`,
    },
  };
}

/**
 * Record one terminal failure: keep a scrubbed draft of the item's unverified work, restore every
 * path it changed, and save the state. Shared by `fail` and the automatic cap and dirty failures.
 * @param {CodegenState} state
 * @param {string} dir
 * @param {CodegenItem} item
 * @param {string} reason
 * @param {{ cnv?: string }} [extra]
 * @returns {string | null}
 */
function recordFailure(state, dir, item, reason, extra = {}) {
  const draft = writeDraft(state, dir, item);
  restoreItem(state, item);
  item.status = "failed";
  item.passing = false;
  item.failure = { reason, ...extra };
  writeCodegen(dir, state);
  return draft;
}

/**
 * The unverified draft, as a whole-file patch, scrubbed like every text that leaves the session.
 * @param {CodegenState} state
 * @param {string} dir
 * @param {CodegenItem} item
 * @returns {string | null}
 */
function writeDraft(state, dir, item) {
  const changes = diffTrees(/** @type {Record<string, PrFile>} */ (item.before_tree ?? {}), snapshotPrTree(state.repo));
  const touched = Object.fromEntries(Object.entries(changes).filter(([path]) => state.module_paths.some((root) => under(path, root))));
  if (!Object.keys(touched).length) return null;
  const folder = join(dir, "codegen", item.id);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, "draft.patch");
  writeFileSync(path, scrubText(patchText(state.repo, /** @type {Record<string, PrFile>} */ (item.before_tree ?? {}), touched)));
  item.draft = path;
  return path;
}

/**
 * A whole-file unified patch, so a failed item's work can be applied by hand.
 * @param {string} repo
 * @param {Record<string, PrFile>} before
 * @param {Record<string, PrFile | null>} changes
 * @returns {string}
 */
function patchText(repo, before, changes) {
  /** @type {string[]} */
  const out = [];
  for (const [path, after] of Object.entries(changes).sort(([a], [b]) => a.localeCompare(b))) {
    const a = fileText(repo, before[path] ?? null);
    const b = fileText(repo, after);
    out.push(`diff --git a/${path} b/${path}`);
    if (a === null) out.push(`new file mode ${after?.mode ?? "100644"}`);
    else if (b === null) out.push(`deleted file mode ${before[path]?.mode ?? "100644"}`);
    out.push(a === null ? "--- /dev/null" : `--- a/${path}`, b === null ? "+++ /dev/null" : `+++ b/${path}`);
    const removed = a === null ? [] : a.replace(/\n$/, "").split("\n");
    const added = b === null ? [] : b.replace(/\n$/, "").split("\n");
    out.push(`@@ -1,${removed.length} +1,${added.length} @@`);
    for (const line of removed) out.push(`-${line}`);
    for (const line of added) out.push(`+${line}`);
  }
  return `${out.join("\n")}\n`;
}

/**
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @returns {void}
 */
function restoreItem(state, item) {
  const current = moduleSnapshot(state.repo, state.module_paths);
  const changes = diffTrees(/** @type {Record<string, PrFile>} */ (item.before ?? {}), current);
  for (const path of Object.keys(changes)) writeTreeFile(state.repo, path, item.before?.[path] ?? null);
}

// ---------------------------------------------------------------------------------------------
// The credential and sensitive-literal scan, on every line the item added

/**
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @param {Record<string, PrFile | null>} changes
 * @returns {CommandResult | null}
 */
function secretRefusal(state, item, changes) {
  void state;
  for (const [path, after] of Object.entries(changes)) {
    const text = fileText(state.repo, after);
    if (text === null) continue;
    const added = addedLines(fileText(state.repo, item.before?.[path] ?? null), text);
    const lines = text.split("\n");
    for (const line of added) {
      if (credentialIn(lines[line - 1] ?? "") || sensitiveLiteral(lines[line - 1] ?? "")) return { exit: 1, json: { ok: false, refusals: [fact("secret", { path, at_line: line })] } };
    }
  }
  return null;
}

/** @param {string} line @returns {boolean} */
function sensitiveLiteral(line) {
  return /\b(?:password|passwd|passcode|secret|api[_-]?key|token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*(?:"[^"]+"|'[^']+'|`[^`]+`)/i.test(line);
}

// ---------------------------------------------------------------------------------------------
// The command

/** @type {Record<string, CommandAction>} */
export const codegenActions = {
  plan: {
    options: { root: "qa-dir", stack: "value", pr: "flag" },
    usage: "[<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--stack <root>] [--pr] [--root <qa-dir>]",
    run: plan,
  },
  start: { options: { dir: "value" }, usage: "--dir <run-dir>", run: start },
  verify: { options: { dir: "value", item: "value", hypothesis: "value" }, usage: "--dir <run-dir> --item <id> --hypothesis <line>", run: verify },
  done: { options: { dir: "value", item: "value", expects: "value" }, usage: "--dir <run-dir> --item <id> --expects <json>", run: done },
  regress: { options: { dir: "value" }, usage: "--dir <run-dir>", run: regress },
  fail: { options: { dir: "value", item: "value", reason: "value", cnv: "value" }, usage: "--dir <run-dir> --item <id> --reason <reason> [--cnv <key>]", run: fail },
  ...codegenPrActions(),
};

/**
 * The shared `pr-prepare`/`pr-record` actions, with codegen's own pre-flight: a branch or PR Run
 * whose done item touched a pre-existing file needs a passing `codegen regress` first.
 * @returns {Record<string, CommandAction>}
 */
function codegenPrActions() {
  return Object.fromEntries(Object.entries(prActions({ file: "codegen.json" })).map(([name, action]) => [name, {
    ...action,
    run(/** @type {string[]} */ args, /** @type {CommandContext} */ ctx) {
      if (name === "pr-prepare" && typeof ctx.dir === "string") {
        /** @type {CodegenState | undefined} */
        let state;
        try {
          state = JSON.parse(readFileSync(join(resolve(ctx.dir), "codegen.json"), "utf8"));
        } catch {
          state = undefined;
        }
        if (state?.pr && state.pr.mode.kind !== "working-tree" && Array.isArray(state.items) &&
          state.items.some((item) => item.status === "done" && item.pre_existing) && !state.regressPassed) return stop("regress_required", { run: state.run });
      }
      const result = /** @type {CommandResult} */ (action.run(args, ctx));
      if (name === "pr-record" && result.exit === 0) {
        const record = /** @type {import("./pr.mjs").PrRecord} */ (result.json.record);
        result.json.text = scrubText(`Codegen PR: ${record.url ?? (record.pushed ? "branch pushed; PR creation failed; an existing PR may need to be located manually" : "push failed")}${record.error ? ` — ${record.error}` : ""}`).replace(/\s+/g, " ");
      }
      return result;
    },
  }]));
}

/** @type {import("./cli.mjs").CommandDefinition} */
export const command = { actions: codegenActions };
