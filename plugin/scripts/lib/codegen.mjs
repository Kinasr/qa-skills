// @ts-check
// `/qa-codegen`'s CLI family (ADR-0052): `plan`, `start`, `verify`, `done` and `fail`.
//
// A Run plans one item per eligible case (one case, one new Automation), then each item is written
// by the model, proved by `verify`, and bound by `done`. The CLI owns the parts a model must not
// decide: the eligible set and its closed skip reasons, the scope and identity edit guard, the Key
// minted at the first verify, the repeated passing proof, the Expected-to-line mapping storage, the
// credential scan, and the one write of `automates`. It never writes an Execution record: a verify
// is a test run, not a Tester's Execution.
//
// State is `<run-dir>/codegen.json`; nothing here commits or stages.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { noArguments, requireOption, UsageError } from "./cli.mjs";
import { buildIndex, buildScopeState, loadWorkingTree, resolveScopeToken } from "./qa-index.mjs";
import { checkFile, edit, parse, projectConfig } from "./knowledge-file.mjs";
import { automationCoverage, supportedCodegenLevels } from "./automation-coverage.mjs";
import { CODEGEN_APPROACH_NAMES, codegenApproaches } from "./codegen-approaches.mjs";
import { caseFields, caseLevels, caseMatchesLevels, casePreconditions, caseSteps, stepActor } from "./case-fields.mjs";
import { isDeclaredTag } from "./case-labels.mjs";
import { scan } from "./scan.mjs";
import { storedCaseFindings } from "./stored-findings.mjs";
import { refusalsWithoutLines } from "./refusal.mjs";
import { newRunDir, newRunId, readRunFile, writeJsonAtomic } from "./run-dir.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { ANY_SCHEMA_VERSION, CODEGEN_TRAIN_KEY, LEVEL_ON_CASE_SCHEMA_VERSION } from "./schema.mjs";
import { resolvesUnderAny, within } from "./paths.mjs";
import { cleanConventions, practicesText, trainFile } from "./training.mjs";
import { resolveAdapter, testRunnerMatchesStack } from "./stack.mjs";
import { buildCodeIndex, indexSource, keyPatterns } from "./code-index.mjs";
import { carrierNames, filesUnder } from "./code-source.mjs";
import { mint } from "./mint.mjs";
import { prefixFits, suggestPrefix } from "./keys.mjs";
import { annotation } from "./sync-code.mjs";
import { checkEdits } from "./edit-guard.mjs";
import { writeQa } from "./qa-write.mjs";
import { commitPrItem, dirtyPaths, planPr, prActions, prResult, scrubText, snapshotPrTree } from "./pr.mjs";
import { diffTrees, fileText, headCommit, restoreTree, sameFile } from "./pr-git.mjs";
import { rebuildPrChain, rollbackUntilPassing } from "./regress-chain.mjs";
import { fixSelections } from "./fix-regress.mjs";
import { regressionDependents } from "./stacks/regress-refs.mjs";
import { proveSelection } from "./test-proof.mjs";
import { addedCredential } from "./secret-scan.mjs";
import { runSelection } from "./runners/index.mjs";
import { isMap } from "./dialect.mjs";
import { accessFor } from "./access.mjs";
import { headerCredential } from "./access-note.mjs";
import { latestLevelFailures } from "./execution-results.mjs";
import { hasUnmappedSplit, resolveLevelTargets, spanningTargetsData, spansMultipleTargets, unmappedLevelsData } from "./level-target.mjs";
import { doneSections, failSections, planSections, prepareSections, recordSections, regressSections, reviewsSections, startSections, verifySections } from "./codegen-json.mjs";

/**
 * @import { CommandAction, CommandContext, CommandResult } from "./cli.mjs"
 * @import { RefusalFact } from "./refusal.mjs"
 * @import { ParsedEntry, ParsedFile, ProjectConfig, TestRunner } from "./knowledge-file.mjs"
 * @import { GuardEdit } from "./edit-guard.mjs"
 * @import { AutomationSelection, RunnerResult } from "./test-runner.mjs"
 * @import { PrFile } from "./pr-git.mjs"
 * @import { IndexedClass, IndexedFunction } from "./code-index.mjs"
 * @import { StackAdapter, StackUnavailableNote } from "./stack.mjs"
 * @import { TrainFile } from "./training.mjs"
 * @import { CodegenApproachName } from "./codegen-approaches.mjs"
 * @import { TargetSpec } from "./level-target.mjs"
 * @import { KeyIndex, ScopeCase, ScopeState } from "./qa-index.mjs"
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
 *   choice?: { level: string, approach: CodegenApproachName, reason: string, practice?: string },
 *   prior_results?: import("./execution-results.mjs").LevelFailure[],
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
 *   unsupported: Array<{ key: string, levels: string[] }>,
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

const { stop, fact } = refusalsWithoutLines();

const CLOSED_REASONS = new Set(["cap-reached", "out-of-scope", "blocked", "app-disagrees", "case-wrong", "not-expressible", "convention-conflict", "invalid-key-prefix", "no-auth", "dirty", "regressed"]);

// The one refusal every `no_code_adapter` stop returns. A stack with no fitting adapter keeps the
// plain line; one whose adapter fits but could not load here carries the adapter's own note.
/**
 * @param {{ language?: unknown } | null | undefined} stack
 * @param {StackUnavailableNote | null} [unavailable]
 * @returns {CommandResult}
 */
export function noAdapterRefusal(stack, unavailable = null) {
  return stop("no_code_adapter", {
    stack: typeof stack?.language === "string" ? stack.language : null,
    ...(unavailable && { unavailable }),
  });
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
const strings = (value) => Array.isArray(value) ? /** @type {string[]} */ (value.filter((v) => typeof v === "string")) : [];

// ---------------------------------------------------------------------------------------------
// Scope (shared resolver in lib/qa-index.mjs, adapted to codegen's refusal envelope)

/**
 * @param {string} token
 * @param {KeyIndex} index
 * @param {ScopeState} state
 * @returns {{ cases: ScopeCase[], alias?: string, refusal?: undefined } | { refusal: CommandResult }}
 */
function resolveScope(token, index, state) {
  const res = resolveScopeToken(token, index, state);
  if (res.ok) return { cases: res.cases, ...(res.alias !== undefined && { alias: res.alias }) };
  return { refusal: stop(res.code, { key: res.key, ...(res.feature !== undefined && { feature: res.feature }) }) };
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
 * @param {ScopeCase} c
 * @param {ProjectConfig} config
 * @param {ReturnType<typeof scan>} facts
 * @param {Set<string>} named
 * @param {{ code: ReturnType<typeof buildCodeIndex>, proposals: Set<string> }} code
 * @param {import("./automation-coverage.mjs").AutomationCoverage} coverage
 * @param {string[]} supported
 * @returns {string[]}
 */
function skipReasons(c, config, facts, named, code, coverage, supported) {
  const entry = /** @type {ParsedEntry} */ (c.entry);
  const findings = storedCaseFindings(facts.history, c.file, entry);
  const tracker = typeof entry.data.tracker === "string" ? entry.data.tracker : null;
  const carriesTracker = tracker !== null && code.code.functions.some((fn) => fn.trackerKeys.some((t) => t.key === tracker));
  const review = facts.history.reviews.find((r) => r.key === entry.key)?.status ?? "none";
  return /** @type {string[]} */ ([
    !coverage.gap && (coverage.covered.length > 0 || (!coverage.bound.length && strings(entry.data.automates).length > 0)) && "automated",
    (code.proposals.has(entry.key) || carriesTracker) && "binding-pending",
    entry.data.automatable === false && "not-automatable",
    caseSteps(/** @type {import("./case-fields.mjs").CaseFieldEntry} */ (entry)).length === 0 && "no-steps",
    !caseFields(/** @type {import("./case-fields.mjs").CaseFieldEntry} */ (entry)).expected && "no-expected",
    findings.some((f) => f.kind === "Conflict" && f.status === "open") && "conflict",
    review !== "fresh" && !named.has(entry.key) && "unreviewed",
    (coverage.bound.length ? !coverage.supported.length : !supported.length) && "no-stack",
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
 * @param {ScopeCase} c
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
function plan(args, { root, stack: requestedStack, pr: requestedPr, choices: rawChoices }) {
  const files = loadWorkingTree(/** @type {string} */ (root));
  const index = buildIndex(files);
  const config = projectConfig(index.project);
  const project = files.find((f) => f.rel === "project.md");
  const problems = /** @type {Array<{ code: string, field?: string, message?: string, line?: number | null }>} */ (project && !project.unreadable ? checkFile(project, config).errors : [{ code: "missing_project" }]);
  const runnerToolProblem = problems.length > 0 && problems.every((e) => e.code === "invalid" && e.field === "test_runner.tool");
  if (!project || project.unreadable || project.type !== "project") return stop("invalid_project", { problems });
  const unread = refuseUnreadSchema(/** @type {string} */ (root), ANY_SCHEMA_VERSION);
  if (unread) return unread;
  if (problems.length && !runnerToolProblem) return stop("invalid_project", { problems });
  const schema = refuseUnreadSchema(/** @type {string} */ (root), LEVEL_ON_CASE_SCHEMA_VERSION);
  if (schema) return schema;
  const repo = dirname(resolve(/** @type {string} */ (root)));
  const stack = config.stack?.root ?? ".";
  if (requestedStack !== undefined && requestedStack !== stack) return stop("unknown_stack", { stack: requestedStack, root: stack });
  const train = /** @type {TrainFile | null} */ (trainFile(index, CODEGEN_TRAIN_KEY));
  const dead = unresolvedRefs(train, repo, stack, config);
  if (dead.length) return stop("training_refs_unresolved", { conventions: dead, next: "/qa-train codegen" });
  const runner = config.test_runner;
  if (runnerToolProblem || !runner || !testRunnerMatchesStack(runner.tool, config.stack)) return stop("no_test_runner", { ...(runner && { tool: runner.tool }), ...(config.stack && { stack: config.stack.language }), next: "/qa-init" });
  const { adapter, unavailable: adapterNote } = resolveAdapter(config.stack, repo);
  if (!adapter) return noAdapterRefusal(config.stack, adapterNote);

  const targets = args.filter((a) => a.startsWith("target:")).map((a) => a.slice(7));
  if (targets.length > 1) return stop("multiple_targets", { targets });
  const rawUrl = args.find((a) => /^[a-z][a-z0-9+.-]*:\/\//i.test(a));
  if (!config.targets) return stop("no_targets", { example: "targets: {staging: https://app.example.test}" });
  const explicitTarget = targets[0];
  if (rawUrl || (explicitTarget !== undefined && !Object.hasOwn(config.targets, explicitTarget))) {
    return stop("unknown_target", { target: rawUrl ?? explicitTarget ?? "", targets: Object.keys(config.targets) });
  }

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

  const state = buildScopeState(index);
  /** @type {Set<ScopeCase>} */
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
  if (!union.size) return stop("no_cases", { scope, next: "/qa-design" });
  const selectedCases = [...union].sort((a, b) => a.file.rel.localeCompare(b.file.rel) || (a.line ?? 0) - (b.line ?? 0));
  const facts = scan(/** @type {string} */ (root));
  const selectedFiles = new Set(selectedCases.map((c) => c.file.rel));
  const broken = facts.results.filter((r) => r.kind === "integrity_error" && selectedFiles.has(/** @type {string} */ (r.file)));
  if (broken.length) return stop("integrity_error", { errors: broken.map(({ code, file, line, key, message }) => ({ code, file, line, key, message })) });
  const requestedLevels = new Set(levels);
  const executable = supportedCodegenLevels(train, config);
  const unavailable = [...requestedLevels].filter((l) => !executable.includes(l));
  if (requestedLevels.size && unavailable.length === requestedLevels.size) return stop("no_codegen_level", { levels, executable });
  const selected = selectedCases.filter((c) => (!tags.length || strings(c.entry?.data.tags).some((tag) => tags.includes(tag))) && caseMatchesLevels(c.entry?.data ?? {}, c.file.data, config.schemaVersion, requestedLevels));
  if (!selected.length) return stop("no_matching_cases", { selection: { scope, tags, levels } });
  const code = buildCodeIndex(repo, config.modulePaths, config.annotationMap, adapter, keyPatterns(config));
  const proposals = new Set(facts.results.filter((r) => r.kind === "binding_proposal" && ["mint_and_bind", "rebind"].includes(/** @type {string} */ (r.code))).flatMap((r) => [...strings(r.bind), ...strings(r.replace_in)]));
  const automationPaths = new Map(Object.entries(facts.index.automations ?? {}));
  const coverage = new Map(selected.map((c) => {
    const all = automationCoverage(c.entry?.data ?? {}, c.file.data, config, train, automationPaths);
    const wanted = (/** @type {string} */ level) => !levels.length || levels.includes(level);
    const supported = all.supported.filter(wanted);
    const covered = all.covered.filter(wanted);
    const missing = all.missing.filter(wanted);
    return [c, { ...all, supported, covered, missing, gap: all.bound.length ? c.entry?.data.automatable !== false && missing.length > 0 : all.gap }];
  }));
  const unsupported = selected.flatMap((c) => {
    const levels = /** @type {import("./automation-coverage.mjs").AutomationCoverage} */ (coverage.get(c)).unsupported;
    return levels.length ? [{ key: /** @type {string} */ (c.entry?.key), levels }] : [];
  });
  const reasons = new Map(selected.map((c) => [c, skipReasons(c, config, facts, named, { code, proposals }, /** @type {import("./automation-coverage.mjs").AutomationCoverage} */ (coverage.get(c)), executable)]));
  const skipped = selected.filter((c) => /** @type {string[]} */ (reasons.get(c)).length > 0).map((c) => ({ key: /** @type {string} */ (c.entry?.key), reasons: /** @type {string[]} */ (reasons.get(c)) }));
  const free = selected.filter((c) => /** @type {string[]} */ (reasons.get(c)).length === 0);
  if (!free.length) return stop("no_eligible_cases", { skipped, unsupported });
  /** @type {Record<string, unknown>} */
  let choices = {};
  try {
    const parsed = rawChoices === undefined ? {} : JSON.parse(String(rawChoices));
    if (!isMap(parsed)) return stop("invalid_choice");
    choices = parsed;
  } catch { return stop("invalid_choice"); }
  // Under `level:<x>`, a Layer-free case whose choice names another level is skipped, not refused.
  const otherLevel = (/** @type {ScopeCase} */ c) => {
    if (!levels.length || caseLevels(c.entry?.data ?? {}, c.file.data, config.schemaVersion).length) return false;
    const choice = choices[String(c.entry?.key)];
    return isMap(choice) && typeof choice.level === "string" && !levels.includes(choice.level);
  };
  for (const c of free.filter(otherLevel)) skipped.push({ key: /** @type {string} */ (c.entry?.key), reasons: ["other-level"] });
  const eligible = free.filter((c) => !otherLevel(c));
  if (!eligible.length) return stop("no_eligible_cases", { skipped, unsupported });
  for (const c of eligible) {
    if (caseLevels(c.entry?.data ?? {}, c.file.data, config.schemaVersion).length) continue;
    const choice = choices[String(c.entry?.key)];
    if (!isMap(choice) || typeof choice.level !== "string" || !executable.includes(choice.level) ||
        (levels.length > 0 && !levels.includes(choice.level)) ||
        !CODEGEN_APPROACH_NAMES.includes(/** @type {CodegenApproachName} */ (choice.approach)) ||
        !codegenApproaches(train, config.levels).some((entry) => entry.approach === choice.approach && entry.level === choice.level) ||
        typeof choice.reason !== "string" ||
        (choice.practice !== undefined && (typeof choice.practice !== "string" || !choice.practice.trim()))) return stop("invalid_choice", { case: c.entry?.key });
  }
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
  const levelFailures = latestLevelFailures(files, index);
  /** @type {CodegenItem[]} */
  const items = eligible.flatMap((c) => {
    const entry = /** @type {ParsedEntry} */ (c.entry);
    const missing = /** @type {import("./automation-coverage.mjs").AutomationCoverage} */ (coverage.get(c)).missing;
    const choice = /** @type {CodegenItem["choice"]} */ (caseLevels(entry.data, c.file.data, config.schemaVersion).length ? undefined : choices[entry.key]);
    return (missing.length ? missing : [/** @type {NonNullable<CodegenItem["choice"]>} */ (choice).level]).map((level) => {
      const prior = choice ? (levelFailures.get(entry.key) ?? []).filter((f) => f.level !== level && executable.includes(f.level)) : [];
      return {
        id: "",
        case: entry.key,
        feature: String(c.feature ?? ""),
        scenario: c.file.rel,
        ...(typeof c.file.data.key === "string" && { scenario_key: c.file.data.key }),
        summary: String(entry.summary ?? ""),
        level,
        ...(choice && { choice }),
        ...(prior.length && { prior_results: prior }),
        ...(typeof entry.data.tracker === "string" && { tracker: entry.data.tracker }),
        expected: expectedSentences(caseFields(/** @type {import("./case-fields.mjs").CaseFieldEntry} */ (entry)).expected),
        status: "pending",
        attempts: 0,
      };
    });
  });
  items.forEach((item, i) => { item.id = `cg_${i + 1}`; });
  const targetResolution = resolveLevelTargets({
    targets: config.targets,
    levelTargets: config.level_targets,
    levels: items.map((item) => item.level),
    explicitTarget,
  });
  if (hasUnmappedSplit(targetResolution, config.targets)) {
    return stop("unmapped_levels", unmappedLevelsData(targetResolution, config.targets, config.level_targets));
  }
  if (spansMultipleTargets(targetResolution)) {
    return stop("spanning_targets", spanningTargetsData("/qa-codegen", targetResolution, { scope, tags }));
  }
  const target = /** @type {TargetSpec} */ (targetResolution.singleTarget);
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
    unsupported,
    dirty: dirtyPaths(repo, config.modulePaths),
    done: [],
    pr,
  };
  writeCodegen(dir, stateOut);
  const warnings = facts.results.filter((r) => r.kind === "train_warning" && ["convention_drift", "citation_broken"].includes(r.code) && r.stack === stack);
  return {
    exit: 0,
    json: {
      action: "plan",
      ok: true,
      dir,
      run,
      sections: planSections({
        header: planHeader(stateOut, dir, aliases),
        start: `node <plugin>/scripts/scan.mjs codegen start --dir ${dir}`,
        items: items.map((i) => ({ id: i.id, case: i.case, summary: i.summary, level: i.level, scenario: i.scenario, ...(i.choice && { choice: i.choice }), ...(i.prior_results && { prior_results: i.prior_results }) })),
        skipped,
        unsupported,
        prefixes,
        warnings,
      }),
    },
  };
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
 * The confirm's header: counts, stack, target, mode and the run dir. The cases, skipped cases,
 * unsupported levels, prefixes and warnings are sections of their own.
 * @param {CodegenState} state
 * @param {string} dir
 * @param {string[]} aliases
 * @returns {string}
 */
function planHeader(state, dir, aliases) {
  const count = new Set(state.items.map((item) => item.case)).size;
  return [
    `Code generate ${count} case${count === 1 ? "" : "s"} (${state.items.length} items) on stack ${state.stack.root} against ${state.target.slug} (${state.target.origin}).`,
    `Mode: ${modeText(state.pr?.mode)}.`,
    ...aliases.map((a) => `Former key: ${a}`),
    `Run dir: ${dir}`,
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
  writeJsonAtomic(join(dir, "codegen.json"), state);
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
      action: "start", ok: true, brief,
      sections: startSections(item, resumed),
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
  return Object.fromEntries(Object.entries(tree).filter(([path]) => modulePaths.some((root) => within(path, root))));
}

/**
 * The item's baseline snapshot entry for `path` (`before_tree` when captured, else legacy `before`).
 * @param {CodegenItem} item
 * @param {string} path
 * @returns {PrFile | null}
 */
function beforeFileOf(item, path) {
  return item.before_tree ? (item.before_tree[path] ?? null) : (item.before?.[path] ?? null);
}

/**
 * Every changed path outside `.qa/` against the item's full baseline (`before_tree` when present).
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @returns {{ after: Record<string, PrFile>, changes: Record<string, PrFile | null> }}
 */
function nonQaChanges(state, item) {
  const beforeTree = /** @type {Record<string, PrFile>} */ (item.before_tree ?? item.before ?? {});
  const after = item.before_tree ? snapshotPrTree(state.repo) : moduleSnapshot(state.repo, state.module_paths);
  const changes = Object.fromEntries(Object.entries(diffTrees(beforeTree, after)).filter(([path]) => !within(path, ".qa")));
  return { after, changes };
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
  const keepRef = (/** @type {string} */ ref) => resolvesUnderAny(state.repo, ref, bases);
  const conventions = cleanConventions(train, keepRef);
  const practices = practicesText(index, CODEGEN_TRAIN_KEY);
  const refs = [...new Set(/** @type {ParsedEntry[]} */ (train?.conventions ?? []).flatMap((entry) => strings(entry.data?.refs).filter(keepRef)))];
  const listing = refsListing(state.repo, refs);
  const adapter = resolveAdapter(config.stack, state.repo).adapter;
  const code = adapter ? buildCodeIndex(state.repo, config.modulePaths, config.annotationMap, adapter, keyPatterns(config)) : null;
  const siblings = siblingAutomationFiles(index, item, code);
  const evidence = passedEvidence(files, item.case);
  const passed = evidence ? passedEvidenceLines(evidence) : ["(none: expected values come only from the case's prose and the Rules above)"];
  const entry = index.cases.get(item.case)?.[0]?.entry;
  const roles = strings(entry?.data.roles);
  const setupRoles = entry ? casePreconditions(/** @type {import("./case-fields.mjs").CaseFieldEntry} */ (entry)).map((p) => stepActor(p, { precondition: true })).filter((role) => role !== null) : [];
  const uri = `url:${state.target.origin}/`;
  const credentials = [...new Set(roles.length ? [...roles, ...setupRoles] : [null, ...setupRoles])].flatMap((role) => {
    const note = accessFor(index, [uri], { role, passwordFiles: true, headerCredentials: true })[uri];
    const metadata = headerCredential(note);
    return metadata ? [{ role: role ?? "(no Role)", ...metadata }] : [];
  });
  return [
    `# Codegen ${item.id}: ${item.case} — ${item.summary}`,
    "",
    ...(item.choice ? [`Choice: ${item.choice.level}, ${item.choice.approach} — ${item.choice.reason}${item.choice.practice ? ` (Practice ${item.choice.practice})` : ""}`, ""] : []),
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
    ...passed,
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
    "## Header credentials",
    "",
    ...(credentials.length ? credentials.map((credential) => `- Role: ${credential.role}; header: ${credential.header}; scheme: ${credential.scheme ?? "(none)"}; variable: ${credential.name}${credential.source === "auth" ? " (from the Auth file; the CLI sets it when it runs the test, and CI must set it as a secret)" : ""}`) : ["(none)"]),
    "Read each variable from the runtime environment through the project's existing loading convention; do not add a dotenv dependency.",
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
 * One Passed entry of the chosen record: its level when the record names one, its prose and the
 * responses it mocked. A top-level typedef so the brief renders each entry from one shape.
 * @typedef {{
 *   level?: string,
 *   text: string,
 *   routes: string[],
 * }} PassedEvidenceEntry
 */

/**
 * The latest Passed Execution of `key`, with one entry per passed level of the chosen record. Each
 * entry keeps its own text and its own routes; an entry whose prose is empty still keeps its routes.
 * @param {ReturnType<typeof loadWorkingTree>} files
 * @param {string} key
 * @returns {PassedEvidenceEntry[] | null}
 */
function passedEvidence(files, key) {
  /** @type {{ at: number, entries: PassedEvidenceEntry[] } | null} */
  let best = null;
  for (const file of files) {
    if (file.unreadable || file.type !== "execution") continue;
    const passed = file.executions.filter((entry) => entry.key === key && entry.data.result === "passed");
    if (!passed.length) continue;
    const at = Date.parse(String(file.data.executed_at));
    if (best === null || at > best.at) {
      best = {
        at,
        entries: passed.map((entry) => ({
          ...(typeof entry.data.level === "string" && entry.data.level && { level: entry.data.level }),
          text: entry.prose.map((p) => p.text.trim()).filter(Boolean).join("\n"),
          routes: strings(entry.data.routes),
        })).filter((entry) => entry.text || entry.routes.length),
      };
    }
  }
  return best && best.entries.length ? best.entries : null;
}

/**
 * The Passed evidence lines: each entry with its own routes and its own text, headed by its level
 * when the case passed at more than one. Routes are never dropped for an entry without prose.
 * @param {PassedEvidenceEntry[]} entries
 * @returns {string[]}
 */
function passedEvidenceLines(entries) {
  const several = entries.length > 1;
  /** @type {string[]} */
  const lines = entries.flatMap((entry) => [
    ...(several && entry.level ? [`Level ${entry.level}:`, ""] : []),
    ...(entry.routes.length ? ["Mocked responses (the Execution's recorded routes):", ...entry.routes.map((route) => `- ${route}`), ""] : []),
    ...(entry.text ? [entry.text, ""] : []),
  ]);
  while (lines[lines.length - 1] === "") lines.pop();
  return lines;
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
  if (item.status !== "in_progress") return stop(item.status === "pending" ? "not_started" : "wrong_state", { item: item.id, status: item.status, ...(item.status === "pending" && { next: "codegen start" }) });
  if (item.attempts >= state.training.codegen_attempts) {
    const draft = recordFailure(state, loaded.dir, item, "cap-reached");
    return stop("cap-reached", { item: item.id, attempts: item.attempts, cap: state.training.codegen_attempts, ...(draft && { draft }) });
  }
  /** @type {Record<string, PrFile | null>} */
  const changes = nonQaChanges(state, item).changes;
  const guarded = guardChanges(state, item, changes);
  if (!guarded.ok) return guarded.refusal;
  const qaOutside = knowledgeChange(state, item);
  if (qaOutside) return qaOutside;
  const secret = secretRefusal(state, item, changes);
  if (secret) return secret;
  const dirty = Object.keys(changes).filter((path) => (state.dirty ?? []).includes(path));
  if (dirty.length) {
    const draft = recordFailure(state, loaded.dir, item, "dirty");
    return { exit: 1, json: { ok: false, refusals: [fact("dirty", { item: item.id, paths: dirty, ...(draft && { draft }) })] } };
  }
  const files = loadWorkingTree(state.root);
  const config = projectConfig(buildIndex(files).project);
  const { adapter, unavailable: adapterNote } = resolveAdapter(config.stack, state.repo);
  if (!adapter) return noAdapterRefusal(config.stack, adapterNote);
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
    const outcome = runSelection({ selection, runner: state.runner, root: state.root, repo: state.repo, dir: output, origin: state.target.origin, env, retries: 0 });
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
    return {
      exit: 0,
      json: {
        action: "verify", ok: true, passed: false, ...(item.key && { key: item.key }),
        sections: verifySections({ passed: false, passes, repeats, failed_at: failed.repeat, reason: failed.reason, diagnostics: failed.diagnostics }),
      },
    };
  }
  // The passing snapshot is the tree the runner proved: the carrier is already rendered on it.
  item.snapshot = nonQaChanges(state, item).changes;
  writeCodegen(loaded.dir, state);
  return {
    exit: 0,
    json: {
      action: "verify", ok: true, passed: true, ...(item.key && { key: item.key }),
      sections: verifySections({ passed: true, passes, repeats, selector: selection.file, ...(item.key === undefined && item.tracker !== undefined && { tracker: item.tracker }) }),
    },
  };
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
  return path === undefined ? null : { exit: 1, json: { ok: false, refusals: [fact("out_of_scope", { path, area: "knowledge" })] } };
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
  const edits = Object.entries(changes).map(([path, file]) => ({ path, before: fileText(state.repo, beforeFileOf(item, path)), after: fileText(state.repo, file) }));
  const result = checkEdits({ repo: state.repo, modulePaths: state.module_paths, annotationMap: config.annotationMap, adapter, patterns: keyPatterns(config), edits });
  if (result.ok) return { ok: true };
  const refusals = result.refusals.map((refusal) => fact(refusal.code, refusal));
  return { ok: false, refusal: { exit: 1, json: { ok: false, refusals } } };
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
    const beforeText = fileText(state.repo, beforeFileOf(item, path)) ?? "";
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
  const { adapter, unavailable: adapterNote } = resolveAdapter(config.stack, state.repo);
  if (!adapter) return { refusal: noAdapterRefusal(config.stack, adapterNote) };
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
  if (typeof item.tracker !== "string") return { refusal: stop("invalid_key_carrier", { missing: "tracker_key" }) };
  const names = carrierNames(config.annotationMap, "tracker_key_fn");
  if (!names.length) return { refusal: stop("invalid_key_carrier", { field: "annotation_map.tracker_key_fn" }) };
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
    if (proposal === null) return { refusal: stop("invalid_key_prefix", { missing: "prefix" }) };
    prefix = proposal;
    if (fn.classes.length) write = { kind: "class", cls: fn.classes[0] };
    else if (adapter.fileKeyPrefix) write = { kind: "header", file: path };
    else return { refusal: stop("invalid_key_prefix", { missing: "class" }) };
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
  if (item.status !== "in_progress" || !item.passing || !item.snapshot) return stop("no_passing_verify", { item: item.id, next: "codegen verify" });
  const external = Boolean(item.key === undefined && item.carried);
  const schema = refuseUnreadSchema(state.root, LEVEL_ON_CASE_SCHEMA_VERSION);
  if (schema) return schema;
  const qaOutside = knowledgeChange(state, item);
  if (qaOutside) return qaOutside;
  /** @type {Record<string, PrFile | null>} */
  const changes = nonQaChanges(state, item).changes;
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
  const preExisting = Object.keys(changes).some((path) => item.before_tree?.[path] !== undefined);
  if (external) {
    finishDoneItem(loaded.dir, state, item, mapping.value, preExisting);
  } else {
    const prepared = prepareAutomates(state, item, /** @type {string} */ (item.key));
    if ("refusal" in prepared) return prepared.refusal;
    const tx = writeQa({
      root: state.root,
      minSchema: LEVEL_ON_CASE_SCHEMA_VERSION,
      writes: [{ path: prepared.rel, text: prepared.text }],
      skipUnchanged: true,
      afterCommit() {
        if (state.pr && state.pr.mode.kind !== "working-tree") {
          const committed = commitPrItem(state.pr, {
            id: item.id,
            case: item.case,
            ...(item.key && { automation: item.key }),
            ...(item.file && { file: item.file }),
            cases: [{ key: item.case, summary: item.summary }],
            expects: mapping.value,
            ...(item.hypothesis && { summary: item.hypothesis }),
          }, /** @type {Record<string, PrFile>} */ (item.before_tree ?? {}));
          if (committed.failure) return { ok: false, refusal: prResult(committed.failure) };
        }
        finishDoneItem(loaded.dir, state, item, mapping.value, preExisting);
        return { ok: true };
      },
    });
    if (!tx.ok) {
      if (tx.kind === "schema") return tx.refusal;
      if (tx.kind === "check") {
        return stop("automates_write", {
          errors: tx.errors.map(({ code, field, line, message }) => ({
            code,
            ...(field && { field }),
            ...(line && { line }),
            message,
          })),
        });
      }
      if (tx.kind === "write") return stop("automates_write", { errors: [{ code: "write_failed", message: tx.error }] });
      if (!tx.rolledBack) return stop("automates_write", { errors: [tx.rollbackError ?? "rollback failed"] });
      if (tx.kind === "afterCommit" && tx.refusal) return tx.refusal;
      throw new Error(`codegen done: ${tx.error ?? "failed"}`);
    }
  }
  return {
    exit: 0,
    json: {
      action: "done", ok: true, ...(item.key && { key: item.key }), ...(!external && { automates: [item.key] }),
      regress: preExisting,
      sections: doneSections(item, mapping.value),
    },
  };
}

/**
 * @param {string} dir
 * @param {CodegenState} state
 * @param {CodegenItem} item
 * @param {Record<string, string[]>} expects
 * @param {boolean} preExisting
 * @returns {void}
 */
function finishDoneItem(dir, state, item, expects, preExisting) {
  item.status = "done";
  item.expects = expects;
  item.pre_existing = preExisting;
  item.after_tree = snapshotPrTree(state.repo);
  state.done = [...(state.done ?? []), item.id];
  state.regressPassed = false;
  delete state.regression;
  writeCodegen(dir, state);
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
    return { refusal: stop("expects_invalid", { expected: "json" }) };
  }
  if (!isMap(input)) return { refusal: stop("expects_invalid", { expected: "json_object" }) };
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
 * @param {string} key
 * @returns {{ rel: string, text: string } | { refusal: CommandResult }}
 */
function prepareAutomates(state, item, key) {
  const files = loadWorkingTree(state.root);
  const index = buildIndex(files);
  const decl = index.cases.get(item.case)?.[0];
  if (!decl) return { refusal: stop("automates_write", { case: item.case }) };
  const rel = decl.file.rel;
  const text = readFileSync(join(state.root, rel), "utf8");
  const existing = strings(decl.entry?.data.automates);
  const automates = existing.includes(key) ? existing : [...existing, key];
  const first = edit(parse(rel, text), [{ at: item.case, set: { automates } }]);
  if (first.errors.length) {
    return { refusal: stop("automates_write", { errors: first.errors.map((e) => ({ code: e.code, ...(e.field && { field: e.field }), ...(e.line && { line: e.line }), ...(e.at && { at: e.at }) })) }) };
  }
  return { rel, text: first.text };
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
  if (state.items.some((item) => item.status === "pending" || item.status === "in_progress")) return stop("items_pending", { items: state.items.filter((item) => item.status === "pending" || item.status === "in_progress").map((item) => item.id), next: "codegen done" });
  if (state.pr?.journal) return stop("already_prepared", { branch: state.pr.branch, next: "codegen regress" });
  const config = projectConfig(buildIndex(loadWorkingTree(state.root)).project);
  const all = fixSelections(state.repo, config);
  const itemOf = (/** @type {string} */ id) => state.items.find((item) => item.id === id && item.status !== "pending");
  if (!(state.done ?? []).some((id) => itemOf(id)?.pre_existing)) {
    state.regressPassed = true;
    writeCodegen(loaded.dir, state);
    return { exit: 0, json: { ok: true, sections: regressSections({ checked: 0, rolled_back: state.regress?.rolled_back ?? [] }) } };
  }
  const touched = new Set();
  for (const id of state.done ?? []) {
    const item = itemOf(id);
    if (!item?.after_tree) continue;
    for (const path of Object.keys(diffTrees(/** @type {Record<string, PrFile>} */ (item.before_tree ?? {}), item.after_tree))) {
      if (state.module_paths.some((root) => within(path, root))) touched.add(path);
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
    return proveSelection({ selection, runner: state.runner, root: state.root, repo: state.repo, dir: output, origin: state.target.origin, env, retries: 0 }, 1).passed;
  };
  const rollback = (/** @type {string} */ id) => {
    const item = itemOf(id);
    if (!item) return;
    const beforeTree = /** @type {Record<string, PrFile>} */ (item.before_tree ?? item.before ?? {});
    const afterTree = item.after_tree ?? beforeTree;
    const paths = Object.keys(diffTrees(beforeTree, afterTree));
    if (paths.length > 0) restoreTree(state.repo, beforeTree, afterTree, { paths });
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
      ok: result.ok,
      sections: regressSections({ checked: result.checked, rolled_back: result.rolled }),
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
      action: "fail", ok: true, ...(draft && { draft }),
      sections: failSections(item),
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
  const touched = nonQaChanges(state, item).changes;
  if (!Object.keys(touched).length) return null;
  const folder = join(dir, "codegen", item.id);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, "draft.patch");
  writeFileSync(path, scrubText(patchText(state.repo, /** @type {Record<string, PrFile>} */ (item.before_tree ?? item.before ?? {}), touched)));
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
  const { after, changes } = nonQaChanges(state, item);
  const paths = Object.keys(changes);
  if (paths.length > 0) restoreTree(state.repo, /** @type {Record<string, PrFile>} */ (item.before_tree ?? item.before ?? {}), after, { paths });
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
  const found = addedCredential(Object.entries(changes).map(([path, after]) => ({
    path,
    before: fileText(state.repo, beforeFileOf(item, path)),
    after: fileText(state.repo, after),
  })));
  return found ? { exit: 1, json: { ok: false, refusals: [fact("secret", found)] } } : null;
}

// An `unreviewed` skip waits on a Review: the plan, or its `no_eligible_cases` refusal, names
// `/qa-design <feature> --review` once per Feature with such a case (`reviews` and the confirm's
// `text`, or the refusal's `next`).
/**
 * @param {CommandResult} result
 * @param {string} root
 * @returns {CommandResult}
 */
function withReviews(result, root) {
  /** @typedef {{ key: string, reasons: string[] }} Skip */
  const json = /** @type {{ ok?: boolean, refusals?: Array<{ code: string, skipped?: Skip[] }>, sections?: import("./report-sections.mjs").ReportSection[], skipped?: Skip[] }} */ (result.json);
  const refusal = json.ok === false ? json.refusals?.[0] ?? null : null;
  if (json.ok === false && refusal?.code !== "no_eligible_cases") return result;
  const skippedSection = (json.sections ?? []).find((section) => section.id === "skipped");
  const skipped = (refusal ?? json).skipped ?? (skippedSection && "items" in skippedSection ? /** @type {Skip[]} */ (skippedSection.items) : []);
  const keys = skipped.filter((s) => s.reasons.includes("unreviewed")).map((s) => s.key);
  if (!keys.length) return result;
  const cases = buildIndex(loadWorkingTree(root)).cases;
  const features = [...new Set(keys.map((key) => cases.get(key)?.[0]?.feature).filter((f) => typeof f === "string"))].sort();
  const reviews = features.map((feature) => `/qa-design ${feature} --review`);
  if (!reviews.length) return result;
  if (refusal) return { ...result, json: { ...json, refusals: [{ ...refusal, next: reviews.join(", ") }, ...(json.refusals ?? []).slice(1)] } };
  return { ...result, json: { ...json, sections: [...(json.sections ?? []), ...reviewsSections(reviews)] } };
}

// ---------------------------------------------------------------------------------------------
// The command

/** @type {Record<string, CommandAction>} */
export const codegenActions = {
  plan: {
    options: { root: "qa-dir", stack: "value", pr: "flag", choices: "value" },
    usage: "[<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--stack <root>] [--choices <json>] [--pr] [--root <qa-dir>]",
    run: (args, ctx) => withReviews(plan(args, ctx), /** @type {string} */ (ctx.root)),
  },
  start: { options: { dir: "value" }, usage: "--dir <run-dir>", run: start },
  verify: { options: { dir: "value", item: "value", hypothesis: "value" }, usage: "--dir <run-dir> --item <id> --hypothesis <line>", run: verify },
  done: { options: { dir: "value", item: "value", expects: "value" }, usage: "--dir <run-dir> --item <id> --expects <json>", run: done },
  regress: { options: { dir: "value" }, usage: "--dir <run-dir>", run: regress },
  fail: { options: { dir: "value", item: "value", reason: "value", cnv: "value" }, usage: "--dir <run-dir> --item <id> --reason <reason> [--cnv <key>]", run: fail },
  ...codegenPrActions(),
};

/**
 * The shared `pr-prepare`/`pr-record` actions, with codegen's own PR line. Running `codegen regress`
 * before `pr-prepare` is the skill's step order (ADR-0057), not a refusal here. Both report through
 * sections; `pr-prepare` keeps the push and create argv outside, because the skill runs exactly them.
 * @returns {Record<string, CommandAction>}
 */
function codegenPrActions() {
  return Object.fromEntries(Object.entries(prActions({ file: "codegen.json" })).map(([name, action]) => [name, {
    ...action,
    run(/** @type {string[]} */ args, /** @type {CommandContext} */ ctx) {
      const result = /** @type {CommandResult} */ (action.run(args, ctx));
      if (result.exit !== 0) return result;
      const json = /** @type {Record<string, unknown>} */ (result.json);
      if (name === "pr-prepare") {
        return {
          ...result,
          json: {
            ok: true,
            ...(json.push !== undefined && { push: json.push }),
            ...(json.create !== undefined && { create: json.create }),
            sections: prepareSections(json),
          },
        };
      }
      const record = /** @type {import("./pr.mjs").PrRecord} */ (json.record);
      const text = scrubText(`Codegen PR: ${record.url ?? (record.pushed ? "branch pushed; PR creation failed; an existing PR may need to be located manually" : "push failed")}${record.error ? ` — ${record.error}` : ""}`).replace(/\s+/g, " ");
      return { ...result, json: { ok: true, sections: recordSections(text) } };
    },
  }]));
}

/** @type {import("./cli.mjs").CommandDefinition} */
export const command = { actions: codegenActions };
