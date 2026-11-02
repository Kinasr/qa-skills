// @ts-check
// Planning pins the working-tree claim. No login or browser opens before the engineer confirms.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { checkFile, projectConfig } from "./knowledge-file.mjs";
import { digestOf, digests } from "./pin-digest.mjs";
import { loadQaAt, repositoryOf, resolveRef } from "./git-tree.mjs";
import { caseFields, casePreconditions, caseSteps, stepActor } from "./case-fields.mjs";
import { accessFor, rolesCoveringIn } from "./access.mjs";
import { isDeclaredTag } from "./case-labels.mjs";
import { executeTraining } from "./execute-training.mjs";
import { trainFile } from "./training.mjs";
import { loginFor } from "./scout.mjs";
import { noArguments } from "./cli.mjs";
import { MIN_PLAYWRIGHT_CLI, UPGRADE_PLAYWRIGHT_CLI, playwrightCliVersion } from "./playwright-version.mjs";
import { newRunDir, newRunId } from "./run-dir.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { claimProjection } from "./stripped.mjs";
import { EXECUTE_TRAIN_KEY, LEVEL_ON_CASE_SCHEMA_VERSION, SCHEMA_VERSION } from "./schema.mjs";
import { scan } from "./scan.mjs";
import { storedCaseFindings } from "./stored-findings.mjs";
import { refusalsFor } from "./refusal.mjs";
import { FALLBACK, readTrackerReference } from "./keys.mjs";
import { concurrencyCap } from "./delegates.mjs";
import { newDispatch } from "./dispatch.mjs";
import { tierFor } from "./tiers.mjs";
import { openActions, plannedRun } from "./execute-open.mjs";
import { briefActions } from "./execute-brief.mjs";
import { ingestActions } from "./execute-ingest.mjs";
import { followUpActions } from "./follow-ups.mjs";
import { automationActions } from "./execute-automation.mjs";
import { buildCodeIndex, keyPatterns } from "./code-index.mjs";
import { resolveAdapter } from "./stack.mjs";
import { runActions } from "./execute-dispatch.mjs";

/**
 * @import { DispatchState } from "./dispatch.mjs"
 * @import { CommandAction, CommandContext, CommandDefinition, CommandResult } from "./cli.mjs"
 * @import { RefusalFact, RefusalResult } from "./refusal.mjs"
 * @import { HistorySection } from "./scan-history.mjs"
 */

/**
 * Target configuration recorded in an ExecutePlan.
 * @typedef {{
 *   slug: string,
 *   origin: string,
 * }} ExecuteTarget
 */

/**
 * Tester delegate configuration recorded in an ExecutePlan.
 * @typedef {{
 *   tier: string,
 *   label: string,
 * }} ExecuteTester
 */

/**
 * Reason and explanation for an execution blocked before dispatch.
 * @typedef {{
 *   reason: string,
 *   why: string,
 * }} ExecuteBlocked
 */

/**
 * Session specification for an execution in an ExecutePlan.
 * @typedef {{
 *   role: string,
 *   acc: string | null,
 *   setup: boolean,
 * }} ExecuteSession
 */

/**
 * Pinned test case execution in an ExecutePlan.
 * @typedef {{
 *   id: string,
 *   key: string,
 *   summary: string,
 *   tracker?: string,
 *   feature: string,
 *   text: string,
 *   level: string,
 *   mode: string,
 *   digest: string,
 *   dirty: boolean,
 *   review: string,
 *   stale: boolean,
 *   roles: string[],
 *   access: string[],
 *   sessions: ExecuteSession[],
 *   cap: number,
 *   blocked?: ExecuteBlocked,
 *   automations?: string[],
 *   execution_skipped?: string[],
 * }} ExecuteExecution
 */

/**
 * Information on a case skipped during execution planning.
 * @typedef {{
 *   key: string,
 *   reasons: string[],
 * }} ExecuteSkipped
 */

/**
 * The Automation half of a Run's frozen plan (<run>/execute.json): the repository the code index
 * read, the project's `test_runner` (absent when none is declared), and every Automation due in
 * the Run. `execute automation` runs them; `ingest` reads its results.
 * @typedef {{
 *   repo: string,
 *   runner?: import("./knowledge-file.mjs").TestRunner,
 *   selections: import("./test-runner.mjs").AutomationSelection[],
 * }} AutoRun
 */

/**
 * `<run>/execute.json` contract shape owned by `execute`.
 * @typedef {{
 *   confirmed: boolean,
 *   run: string,
 *   target: ExecuteTarget,
 *   created_at: string,
 *   playwright_cli: string,
 *   commit: string,
 *   tester: ExecuteTester,
 *   concurrency_cap: number,
 *   executions: ExecuteExecution[],
 *   skipped: ExecuteSkipped[],
 *   selection?: ExecuteSelection,
 *   automation?: AutoRun,
 * }} ExecutePlan
 */

/**
 * The requested scope and filter values, preserving order and repeats.
 * @typedef {{ scope: string[], tags: string[], levels: string[] }} ExecuteSelection
 */

/**
 * Lock state tracked per Access note in execute's dispatch.json.
 * @typedef {{
 *   mode: "exclusive" | "shared",
 *   holders: string[],
 * }} ExecuteLock
 */

/**
 * Paused note entry in execute's dispatch.json.
 * @typedef {{
 *   acc: string,
 *   roles?: string[],
 *   reason: string,
 * }} ExecutePausedNote
 */

/**
 * Unit tracked in execute's dispatch state machine.
 * @typedef {{
 *   id: string,
 *   blocked?: ExecuteBlocked,
 * }} ExecuteUnit
 */

/**
 * `<run>/dispatch.json` shape owned by `execute` (specialization of DispatchState).
 * @typedef {DispatchState<ExecuteUnit> & {
 *   locks: Record<string, ExecuteLock>,
 *   paused: ExecutePausedNote[],
 *   retried: string[],
 *   skipped: string[],
 *   stale: string[],
 * }} ExecuteDispatchState
 */

/**
 * Shape of a parsed file in the working tree.
 * @typedef {{
 *   rel: string,
 *   type?: string,
 *   data: Record<string, unknown>,
 *   [key: string]: unknown,
 * }} KnowledgeFile
 */

/**
 * An entry in one of qa-index's declaration maps.
 * @typedef {{
 *   file: KnowledgeFile,
 *   line?: number,
 *   feature?: string,
 *   scenario?: string,
 *   entry?: Record<string, unknown> & { key: string, summary: string, data: Record<string, unknown> },
 *   [key: string]: unknown,
 * }} IndexDeclaration
 */

/**
 * Stored finding reported by scan.
 * @typedef {{
 *   kind: string,
 *   status: string,
 *   evidence?: unknown,
 *   file: string,
 *   line: number,
 * }} StoredFinding
 */

/**
 * A declaration discovered during scope indexing.
 * @typedef {{
 *   kind: string,
 *   key: string,
 *   feature?: string,
 *   scenario?: string,
 *   file: KnowledgeFile & { rel: string, data: Record<string, unknown> },
 *   entry?: Record<string, unknown> & { key: string, summary: string, data: Record<string, unknown> },
 *   line?: number,
 *   [key: string]: unknown,
 * }} ScopeDeclaration
 */

/**
 * A case declaration discovered during scope indexing.
 * @typedef {{
 *   kind: "case",
 *   key: string,
 *   feature: string,
 *   scenario?: string,
 *   file: KnowledgeFile & { rel: string, data: Record<string, unknown> },
 *   entry: import("./knowledge-file.mjs").ParsedEntry & { summary: string },
 *   line: number,
 *   [key: string]: unknown,
 * }} ScopeCase
 */

/**
 * Index state for scope resolution.
 * @typedef {{
 *   retired: Map<string, string>,
 *   declarations: ScopeDeclaration[],
 *   cases: ScopeCase[],
 *   casesFor: (d: ScopeDeclaration) => ScopeCase[],
 *   liveFeature: (key: string) => boolean,
 * }} ScopeState
 */

/**
 * Outcome of resolving a scope token.
 * @typedef {{
 *   cases: ScopeCase[],
 *   alias?: string,
 *   refusal?: undefined,
 * } | {
 *   cases?: undefined,
 *   alias?: undefined,
 *   refusal: RefusalResult,
 * }} ScopeResolveResult
 */

/**
 * A test case with resolved Access notes and browser sessions.
 * @typedef {ScopeCase & {
 *   roles: string[],
 *   access: string[],
 *   sessions: ExecuteSession[],
 *   blocked?: ExecuteBlocked,
 * }} ResolvedAccessCase
 */

/** @type {Record<string, string>} */
const FILTER_REFUSALS = {
  unknown_tag: "The requested Tag is not declared in the project.",
  retired_tag: "The requested Tag is retired.",
  unknown_level: "The requested Test level is not declared in the project.",
};

const { stop } = refusalsFor({
  invalid_project: "Fix `.qa/project.md` before executing cases.",
  no_targets: "Add a target origin to `.qa/project.md`: targets: {staging: https://app.example.test}",
  multiple_targets: "A Run takes at most one target.",
  unknown_target: "Choose one of the configured target names; raw URLs are not targets.",
  no_execute_levels: "Add executable levels to `.qa/project.md`: execute_levels: {ui: browser, api: api}",
  not_a_repository: "Execution needs `.qa/` inside a git repository.",
  no_commits: "Execution needs a resolving HEAD; commit the repository first.",
  no_scope: "Choose a live Feature, Suite, Scenario or Test Case Key, a Tracker key, or a Tag or Test level filter.",
  invalid_filter: "Use tag:<name> or level:<name> with a non-blank name and no whitespace or extra colon.",
  ...FILTER_REFUSALS,
  ambiguous_key: "The scope token names more than one declaration.",
  unknown_key: "The scope token names no live Key or Tracker key.",
  retired_key: "The scope token was retired and cannot be executed.",
  no_cases: "The scope holds no live Test Case; design cases first with `/qa-design`.",
  no_matching_cases: "No live Test Case in the scope matches the requested Tags and Test levels.",
  no_executable_level: "None of the requested Test levels is in `execute_levels`.",
  integrity_error: "A selected file has an Integrity error; fix it before executing.",
  no_playwright_cli: "`/qa-execute` drives the app through `playwright-cli`, which is not on the PATH; install it first.",
  old_playwright_cli: "`/qa-execute` needs a newer `playwright-cli`; upgrade it first.",
  note_withheld: "The Access note holds what looks like a credential; fix `train/access.md` with `/qa-train access`.",
  login_secret_missing: "Put the login secret the Access note names where it says, then plan again.",
  login_state_missing: "Save the login state the Access note names, then plan again.",
  no_login_state: "Name a login-state file in the Access note with `/qa-train access`.",
  wrong_via: "Change the Access note to a saved login or a CLI login with `/qa-train access`.",
  login_state_tracked: "Stop git tracking the login-state file, then plan again.",
  login_state_not_ignored: "Git-ignore the login-state file, then plan again.",
  login_secret_tracked: "Stop git tracking the password file, then plan again.",
  login_secret_not_ignored: "Git-ignore the password file, then plan again.",
  already_confirmed: "The Run is already confirmed; its plan is frozen.",
}, (code, data) => Object.hasOwn(FILTER_REFUSALS, code) && Array.isArray(data.valid) ? { ...data, line: `${FILTER_REFUSALS[code]} Valid values: ${data.valid.join(", ") || "(none)"}.` } : data);

/**
 * A parsed qa index.
 * @typedef {{
 *   project?: KnowledgeFile | null,
 *   features: Map<string, IndexDeclaration[]>,
 *   suites: Map<string, IndexDeclaration[]>,
 *   scenarios: Map<string, IndexDeclaration[]>,
 *   cases: Map<string, IndexDeclaration[]>,
 *   train?: Map<string, Array<{ file: KnowledgeFile }>>,
 *   tracker: { resolve: (token: string) => { status: string, entry: ScopeDeclaration } },
 * }} KnowledgeIndex
 */

/**
 * @typedef {object} AccessNote
 * @property {string} key
 * @property {string} [via]
 * @property {string} [quirks]
 * @property {boolean} [withheld]
 */

/**
 * @param {unknown} value
 * @returns {string[]}
 */
const strings = (value) => Array.isArray(value) ? /** @type {string[]} */ (value.filter((v) => typeof v === "string")) : [];

/**
 * @param {KnowledgeIndex} index
 * @returns {ScopeState}
 */
function scopeState(index) {
  const retired = new Map(strings(/** @type {NonNullable<typeof index.project>} */ (index.project).data.retired_features).map((key) => [key, "retired_features"]));
  for (const [key, declarations] of index.features) for (const { file } of declarations) {
    for (const token of strings(file.data.retired)) retired.set(readTrackerReference(token) ?? token, key);
  }
  const liveFeature = (/** @type {string} */ key) => !retired.has(key);
  const live = (/** @type {ScopeDeclaration} */ d) => liveFeature(d.feature ?? d.key) && !retired.has(d.key) && !retired.has(/** @type {string} */ (d.scenario));
  const declarations = (/** @type {Array<[string, Map<string, IndexDeclaration[]>]>} */ ([["feature", index.features], ["suite", index.suites], ["scenario", index.scenarios], ["case", index.cases]]))
    .flatMap(([kind, map]) => [...map].flatMap(([key, ds]) => ds.map((/** @type {IndexDeclaration} */ d) => ({ ...d, kind, key })))).filter(live);
  const cases = /** @type {ScopeCase[]} */ (declarations.filter((d) => d.kind === "case"));
  const casesFor = (/** @type {ScopeDeclaration} */ d) => cases.filter((c) => d.kind === "case" ? c.key === d.key : d.kind === "scenario" ? c.scenario === d.key : c.feature === (d.feature ?? d.key));
  return { retired, declarations, cases, casesFor, liveFeature };
}

/**
 * @param {string} token
 * @param {KnowledgeIndex} index
 * @param {ScopeState} state
 * @returns {ScopeResolveResult}
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
    if (state.retired.has(tracker.entry.key) || !state.liveFeature(/** @type {string} */ (tracker.entry.feature))) return { refusal: stop("retired_key", { key: token, feature: state.retired.get(tracker.entry.key) ?? "retired_features" }) };
    return { cases: state.casesFor(tracker.entry) };
  }
  if (tracker.status === "absent") {
    const suite = choose(state.declarations.filter((d) => d.kind === "feature" && /** @type {{ suite?: string } | undefined} */ (d.file.data.mirror)?.suite === token));
    if (suite) return suite;
  }
  if (state.retired.has(token)) return { refusal: stop("retired_key", { key: token, feature: state.retired.get(token) }) };
  const former = choose(state.declarations.filter((d) => d.kind !== "suite" && strings((d.entry ?? d.file).data.formerly).includes(token)), true);
  return former ?? { refusal: stop("unknown_key", { key: token }) };
}

// The skip reasons of a case, in the fixed order: `level` (its case level is
// none or not in `execute_levels`), `conflict` (an open Conflict, re-armed Dismissals included),
// `no-steps` and `no-expected` (both read from the prose).
/**
 * @param {ScopeCase} c
 * @param {ReturnType<typeof projectConfig>} config
 * @param {HistorySection} history
 * @returns {string[]}
 */
function skipReasons(c, config, history) {
  const findings = storedCaseFindings(history, c.file, c.entry);
  return /** @type {string[]} */ ([
    !Object.hasOwn(config.execute_levels, /** @type {string} */ (c.entry.data.level)) && "level",
    findings.some((/** @type {StoredFinding} */ f) => f.kind === "Conflict" && f.status === "open") && "conflict",
    caseSteps(c.entry).length === 0 && "no-steps",
    !(/** @type {{ expected?: string | null }} */ (caseFields(c.entry))).expected && "no-expected",
  ].filter(Boolean));
}

// Each case with the `roles` it logs in as, the `sessions` it holds and the `access` note keys that
// serve them. Notes are looked up on the target, `url:<origin>/`, per Role and never fall back
// here: a case Role, or a case setup Role (a precondition opened `As <Role>, ` for a Role outside
// `roles`), needs a `(prefix, role)` note; a case with no Roles takes the role-less note, runs
// unauthenticated when no note covers the target, and has nothing to log in as when only Role-tagged
// notes do. A case with a Role no note covers is Blocked `no-access` before dispatch (`blocked`, with
// no sessions). Each session is `{role, acc, setup}`: `role` the Role or `-` for a case with none,
// `acc` its note's key or null when unauthenticated, `setup` true for a Role that never acts in a
// Step (shared lock). The `setup_role` of `train/execute.md` joins every case after its own sessions
// unless it is already one of them; with no note covering the target it is warned, never Blocked.
// `access` lists the sessions' notes in that order; `notes` maps each key to its note.
/**
 * @param {ScopeCase[]} cases
 * @param {{ index: KnowledgeIndex, target: ExecuteTarget }} options
 * @returns {{ cases: ResolvedAccessCase[], warnings: string[], notes: Map<string, AccessNote> }}
 */
function resolveCaseAccess(cases, { index, target }) {
  const uri = `url:${target.origin}/`;
  const found = new Map();
  const lookup = (/** @type {string | null} */ role) => {
    if (!found.has(role)) found.set(role, (/** @type {(s: unknown, u: string[], o?: { passwordFiles?: boolean, role?: string | null }) => Record<string, AccessNote | null>} */ (accessFor))(index, [uri], { passwordFiles: true, role })[uri]);
    return found.get(role);
  };
  const rolesOnly = rolesCoveringIn(index, uri, { passwordFiles: true });
  const helper = executeTraining(trainFile(index, EXECUTE_TRAIN_KEY)).setup_role;
  const setupRole = typeof helper === "string" && helper.trim() ? helper : null;
  const helperNote = setupRole && lookup(setupRole);
  const warnings = setupRole && !helperNote ? [`\`setup_role\` ${setupRole} has no Access note covering ${target.origin}, so no helper session opens; a case that needs one is Blocked \`precondition\`.`] : [];
  const notes = new Map();
  const resolved = cases.map((c) => {
    const roles = /** @type {string[]} */ (c.entry.data.roles ?? []);
    const setupRoles = [...new Set(casePreconditions(c.entry).map((/** @type {string} */ p) => stepActor(p, { precondition: true })).filter((/** @type {string | null} */ r) => r && !roles.includes(r)))];
    /** @type {ExecuteSession[]} */
    const sessions = [];
    /** @type {string[]} */
    const missing = [];
    /**
     * @param {string | null} role
     * @param {boolean} setup
     */
    const open = (role, setup) => {
      const note = lookup(role);
      if (note) {
        sessions.push({ role: role ?? "-", acc: note.key, setup });
        notes.set(note.key, note);
      } else if (role !== null) missing.push(`(${target.origin}, ${role})`);
      else if (rolesOnly.length) missing.push(`(${target.origin}, no-role), which only Role-tagged notes cover (${rolesOnly.join(", ")})`);
      else sessions.push({ role: "-", acc: null, setup });
    };
    for (const role of roles.length ? roles : [null]) open(role, false);
    for (const role of setupRoles) open(role, true);
    if (helperNote && ![...roles, ...setupRoles].includes(setupRole)) open(setupRole, true);
    if (missing.length) return { ...c, roles, access: [], sessions: [], blocked: { reason: "no-access", why: `No Access note covers ${missing.join(", ")}; add one with \`/qa-train access\`.` } };
    return { ...c, roles, access: /** @type {string[]} */ ([...new Set(sessions.map((s) => s.acc).filter(Boolean))]), sessions };
  });
  return { cases: resolved, warnings, notes };
}

// The refusal for the first Access note a runnable Execution logs in with that cannot log in yet: it
// holds a credential, has the wrong shape, or its secret or saved state is missing or tracked by git.
// Reuses the UI scout's checks (`loginFor`) without logging in: nothing opens before the confirm.
/**
 * @param {string} root
 * @param {ExecuteTarget} target
 * @param {{ cases: ResolvedAccessCase[], notes: Map<string, AccessNote> }} ctx
 * @returns {RefusalResult | null}
 */
function loginRefusal(root, target, { cases, notes }) {
  for (const key of new Set(cases.filter((c) => !c.blocked).flatMap((c) => c.access))) {
    const note = notes.get(key);
    if (/** @type {AccessNote} */ (note).withheld) return stop("note_withheld", { access: key });
    const { refusal } = /** @type {{ refusal?: RefusalResult }} */ (loginFor(root, /** @type {import("./scout.mjs").ScoutAccessNote} */ (note), `${target.origin}/`));
    if (refusal) {
      const { ok, reason, error, ...extra } = refusal.json;
      return stop(/** @type {string} */ (reason), { access: key, error, ...extra });
    }
  }
  return null;
}

// The `playwright-cli` version a Run records, or a refusal when it is missing or too old.
/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ version: string, refusal?: undefined } | { version?: undefined, refusal: RefusalResult }}
 */
function checkPlaywrightCli(env) {
  const found = playwrightCliVersion(env);
  if (found.status === "missing") return { refusal: stop("no_playwright_cli", { upgrade: UPGRADE_PLAYWRIGHT_CLI }) };
  if (found.status === "old") return { refusal: stop("old_playwright_cli", { ...(found.found && { found: found.found }), ...(found.failure && { failure: found.failure }), minimum: MIN_PLAYWRIGHT_CLI, upgrade: UPGRADE_PLAYWRIGHT_CLI }) };
  return { version: /** @type {string} */ (found.version) };
}

const word = (/** @type {string} */ s) => `'${s.replaceAll("'", `'\\''`)}'`;
const cases = (/** @type {number} */ n) => `${n} case${n === 1 ? "" : "s"}`;
const skippedLines = (/** @type {ExecuteSkipped[]} */ skipped) => skipped.map(({ key, reasons }) => `  ${key} (${reasons.join(", ")})`);

// The CLI-written confirm: what the engineer says yes to before any login or browser opens.
/**
 * @param {{
 *   target: ExecuteTarget,
 *   executions: ExecuteExecution[],
 *   skipped: ExecuteSkipped[],
 *   aliases: string[],
 *   warnings: string[],
 *   dir: string,
 *   root: string,
 *   selection: ExecuteSelection,
 * }} options
 * @returns {string}
 */
function confirmText({ target, executions, skipped, aliases, warnings, dir, root, selection }) {
  const running = executions.filter((e) => !e.blocked);
  const blocked = executions.filter((e) => e.blocked);
  const logins = [...new Set(running.flatMap((e) => e.sessions).map(({ role, acc, setup }) =>
    `  ${role === "-" ? "(no Role)" : role} → ${acc ?? "unauthenticated"}${setup ? " (setup)" : ""}`))];
  return [
    `Execute ${cases(executions.length)} against ${target.slug} (${target.origin}).`,
    ...(selection.tags.length || selection.levels.length ? [`Selection: ${[...selection.scope, ...selection.tags.map((t) => `tag:${t}`), ...selection.levels.map((l) => `level:${l}`)].join(" ")}`] : []),
    ...aliases.map((a) => `Former key: ${a}`),
    ...(logins.length ? ["Roles → Access notes:", ...logins] : []),
    ...(blocked.length ? [`Blocked before dispatch (${blocked.length}), no result is earned:`, ...blocked.map((e) => `  ${e.key} (${(/** @type {ExecuteBlocked} */ (e.blocked)).reason}): ${(/** @type {ExecuteBlocked} */ (e.blocked)).why}`)] : []),
    ...warnings.map((w) => `Warning: ${w}`),
    ...(executions.some((e) => e.dirty) ? [`Uncommitted case text runs as edited: ${executions.filter((e) => e.dirty).map((e) => e.key).join(", ")}`] : []),
    ...(skipped.length ? [`Skipped (${skipped.length}), their previous result stays the latest:`, ...skippedLines(skipped)] : []),
    "Data handling: configured credential sources are denied to the Tester.",
    "Recognised credential patterns are scrubbed from command output, saved responses and guard logs.",
    "Application data is not kept confidential.",
    "Use non-production targets with test accounts; entities the Tester creates are left for you to clean up.",
    "Details: https://github.com/Kinasr/qa-skills/blob/v0.3.6/docs/support.md#data-handling",
    `Run dir: ${dir}`,
    `When the Run is over: node <plugin>/scripts/scan.mjs execute ingest --dir ${word(dir)}${root === ".qa" ? "" : ` --root ${word(root)}`}`,
  ].join("\n");
}

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function plan(args, { root, env }) {
  const files = loadWorkingTree(root);
  const index = /** @type {KnowledgeIndex} */ (buildIndex(files));
  const config = projectConfig(index.project);
  const project = /** @type {KnowledgeFile | undefined} */ (files.find((f) => f.rel === "project.md"));
  const problems = project ? checkFile(project, config).errors : [{ code: "missing_project" }];
  if (project?.type !== "project" || problems.length || config.schemaVersion > SCHEMA_VERSION) return stop("invalid_project", { problems });
  const schema = refuseUnreadSchema(/** @type {string} */ (root), LEVEL_ON_CASE_SCHEMA_VERSION);
  if (schema) return schema;
  if (!config.targets) return stop("no_targets");
  const targets = args.filter((a) => a.startsWith("target:")).map((a) => a.slice(7));
  if (targets.length > 1) return stop("multiple_targets", { targets });
  const rawUrl = args.find((a) => /^[a-z][a-z0-9+.-]*:\/\//i.test(a));
  const slug = targets[0] ?? Object.keys(config.targets)[0];
  if (rawUrl || !Object.hasOwn(config.targets, slug)) return stop("unknown_target", { target: rawUrl ?? slug, targets: Object.keys(config.targets) });
  const target = { slug, origin: config.targets[slug] };
  if (!config.execute_levels) return stop("no_execute_levels");
  const repo = repositoryOf(root);
  if (!repo) return stop("not_a_repository");
  const commit = resolveRef(root, "HEAD");
  if (!commit) return stop("no_commits");
  const facts = scan(root);
  const state = scopeState(index);
  const tags = args.filter((a) => a.startsWith("tag:")).map((a) => a.slice(4));
  const levels = args.filter((a) => a.startsWith("level:")).map((a) => a.slice(6));
  const scope = args.filter((a) => !/^(target|tag|level):/.test(a));
  /** @type {ExecuteSelection} */
  const selection = { scope, tags, levels };
  if (!scope.length && !tags.length && !levels.length) return stop("no_scope", { features: [...index.features.keys()].filter(state.liveFeature).map((key) => {
    const inFeature = state.cases.filter((c) => c.feature === key);
    const skipped = inFeature.filter((c) => skipReasons(c, config, facts.history).length).length;
    return { key, executable: inFeature.length - skipped, skipped, total: inFeature.length };
  }) });
  const invalid = args.find((a) => /^(tag|level):/.test(a) && !/^(tag|level):[^\s:]+$/u.test(a));
  if (invalid !== undefined) return stop("invalid_filter", { token: invalid });
  const validTags = Object.keys(config.labels.tags);
  const unknownTag = tags.find((t) => !isDeclaredTag(config.labels, t));
  if (unknownTag !== undefined) return stop("unknown_tag", { tag: unknownTag, valid: validTags });
  const retiredTag = tags.find((t) => config.labels.retiredTags.includes(t));
  if (retiredTag !== undefined) return stop("retired_tag", { tag: retiredTag, valid: validTags });
  const unknownLevel = levels.find((l) => !config.levels.has(l));
  if (unknownLevel !== undefined) return stop("unknown_level", { level: unknownLevel, valid: [...config.levels] });
  /** @type {Set<ScopeCase>} */
  const union = new Set(scope.length ? [] : state.cases);
  /** @type {string[]} */
  const aliases = [];
  for (const token of scope) {
    const resolved = resolveScope(token, index, state);
    if (resolved.refusal) return resolved.refusal;
    for (const c of /** @type {ScopeCase[]} */ (resolved.cases)) union.add(c);
    if (resolved.alias) aliases.push(resolved.alias);
  }
  if (!union.size) return stop("no_cases", { scope });
  const scopeCases = [...union].sort((a, b) => a.file.rel.localeCompare(b.file.rel) || a.line - b.line);
  const selectedFiles = new Set(scopeCases.map((c) => c.file.rel));
  const broken = facts.results.filter((r) => r.kind === "integrity_error" && selectedFiles.has(/** @type {string} */ (r.file)));
  if (broken.length) return stop("integrity_error", { errors: broken.map(({ code, file, line, key, message }) => ({ code, file, line, key, message })) });
  const requestedTags = new Set(tags);
  const requestedLevels = new Set(levels);
  const unavailable = [...requestedLevels].filter((l) => !Object.hasOwn(config.execute_levels, l));
  if (requestedLevels.size && unavailable.length === requestedLevels.size) return stop("no_executable_level", { levels, executable: Object.keys(config.execute_levels) });
  const selected = scopeCases.filter((c) => (!requestedTags.size || strings(c.entry.data.tags).some((tag) => requestedTags.has(tag))) &&
    (!requestedLevels.size || requestedLevels.has(/** @type {string} */ (c.entry.data.level))));
  if (!selected.length) return stop("no_matching_cases", { selection });
  // A selected `automates` key whose code side has a duplicate or a pattern error would run the
  // wrong test: refuse the whole Run before it creates a run directory.
  const dueKeys = new Set(selected.flatMap((c) => c.entry.data.automatable !== false ? strings(c.entry.data.automates) : []));
  const codeBroken = facts.results.filter((r) => r.kind === "integrity_error" &&
    ["duplicate_automation_key", "automation_key_pattern"].includes(/** @type {string} */ (r.code)) && dueKeys.has(/** @type {string} */ (r.key)));
  if (codeBroken.length) {
    return stop("integrity_error", { errors: codeBroken.map(({ code, key, function: fn, message }) => ({ code, key, ...(fn !== undefined && { function: fn }), message })) });
  }
  const reasons = new Map(selected.map((c) => [c, skipReasons(c, config, facts.history)]));
  // An incomplete case (no steps, or no Expected result) still runs its Automation: its Automation
  // evidence is useful even though no Tester Execution can follow. It records `execution_skipped`
  // instead. A case at another level, in conflict, or without an Automation stays skipped.
  const promoted = new Set(selected.filter((c) => {
    const rs = /** @type {string[]} */ (reasons.get(c));
    return rs.length > 0 && rs.every((r) => ["no-steps", "no-expected"].includes(r)) &&
      c.entry.data.automatable !== false && strings(c.entry.data.automates).length > 0;
  }));
  const skipped = selected.filter((c) => (/** @type {string[]} */ (reasons.get(c))).length && !promoted.has(c))
    .map((c) => ({ key: c.entry.key, reasons: /** @type {string[]} */ (reasons.get(c)) }));
  const runnable = selected.filter((c) => !(/** @type {string[]} */ (reasons.get(c))).length);
  const unexecutable = unavailable.length ? [`Requested Test levels cannot execute: ${unavailable.join(", ")}; matching cases at those levels are skipped.`] : [];
  if (!runnable.length && !promoted.size) {
    return { exit: 0, json: { action: "plan", ok: true, executions: 0, skipped, text: ["Nothing to execute: every selected case is skipped.", ...unexecutable.map((w) => `Warning: ${w}`), ...skippedLines(skipped)].join("\n") } };
  }
  const cli = checkPlaywrightCli(env);
  if (cli.refusal) return cli.refusal;
  const head = digests(loadQaAt(repo, commit));
  const stripped = new Map();
  /** @param {{ file: KnowledgeFile, entry: { key: string } }} param0 */
  const textOf = ({ file, entry }) => {
    if (!stripped.has(file)) stripped.set(file, claimProjection(file));
    return stripped.get(file).cases.get(entry.key);
  };
  const access = resolveCaseAccess(runnable, { index, target });
  const refused = loginRefusal(/** @type {string} */ (root), target, access);
  if (refused) return refused;
  const accessByKey = new Map(access.cases.map((c) => [c.entry.key, c]));
  /** @type {ExecuteExecution[]} */
  const executions = selected.filter((c) => accessByKey.has(c.entry.key) || promoted.has(c)).map((c, i) => {
    const run = accessByKey.get(c.entry.key);
    const { entry, feature } = c;
    const text = textOf(c);
    const digest = digestOf(["case", text]);
    const level = /** @type {string} */ (entry.data.level);
    return {
      id: `ex_${i + 1}`, key: entry.key, summary: entry.summary,
      ...(/** @type {{ tracker: string } | undefined} */ (entry.data.tracker && { tracker: entry.data.tracker })), feature,
      text, level, mode: config.execute_levels[level], digest, dirty: head.review(entry.key) !== digest,
      review: facts.history.reviews.find((r) => r.key === entry.key)?.status ?? "none",
      stale: storedCaseFindings(facts.history, c.file, entry).some((/** @type {StoredFinding} */ f) => f.kind === "Stale" && f.status === "open"),
      ...(entry.data.automatable !== false && strings(entry.data.automates).length && { automations: strings(entry.data.automates) }),
      roles: run ? run.roles : strings(entry.data.roles), access: run ? run.access : [], sessions: run ? run.sessions : [],
      cap: 10 + 5 * (caseSteps(entry).length + casePreconditions(entry).length),
      ...(promoted.has(c) && { execution_skipped: /** @type {string[]} */ (reasons.get(c)) }),
      ...(run?.blocked && { blocked: run.blocked }),
    };
  });
  const dir = /** @type {{ make(): string }} */ (newRunDir(undefined, "qa-skills-execute-")).make();
  mkdirSync(join(dir, ".playwright"));
  const { tier, label } = tierFor(index.project, "tester");
  /** @type {ExecutePlan} */
  const pinned = { confirmed: false, run: newRunId(), target, created_at: new Date().toISOString(), playwright_cli: cli.version, commit, tester: { tier, label }, concurrency_cap: concurrencyCap(index.project), executions, skipped, selection };
  const adapter = resolveAdapter(config.stack, repo.top).adapter;
  const due = [...new Set(executions.flatMap((e) => e.automations ?? []))];
  if (due.length) {
    const code = adapter ? buildCodeIndex(repo.top, config.modulePaths, config.annotationMap, adapter, keyPatterns(config)) : null;
    const selections = code ? due.flatMap((id) => {
      const fn = code.functions.find((f) => f.automationKeys.some((k) => k.key === id));
      if (!fn) return [];
      const titles = [...fn.classes.map((c) => c.name), fn.name];
      return [{
        id, stack: config.stack?.root ?? ".", file: fn.file, line: fn.line, titles,
        package: fn.package,
        literal: !fn.parameterised && titles.every((t) => t.length > 0 && t.trim() === t && !/[›\r\n]|\$\{/.test(t)),
        tagged: (config.annotationMap?.automation_key ?? []).includes("tag"),
      }];
    }) : [];
    /** @type {AutoRun} */
    const automation = { repo: repo.top, ...(config.test_runner && { runner: config.test_runner }), selections };
    pinned.automation = automation;
  }
  writeFileSync(join(dir, "execute.json"), `${JSON.stringify(pinned, null, 2)}\n`);
  const warnings = [...access.warnings, ...unexecutable];
  return { exit: 0, json: { action: "plan", ok: true, dir, executions: executions.length, skipped, warnings, text: confirmText({ target, executions, skipped, aliases, warnings, dir, root: /** @type {string} */ (root), selection }) } };
}

// Freezes the plan: from here `execute.json` never changes and every mutable fact of the Run lives
// in `dispatch.json` (lib/execute-dispatch.mjs): lib/dispatch.mjs's policy state, one queued unit
// per Execution not already Blocked and the Tester's Delegates as the chain (its model, then the
// Fallback), plus the Access note `locks` and the login lifecycle's `paused`, `retried`, `skipped` and
// `stale` notes (lib/execute-auth.mjs).
/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function confirm(args, { dir }) {
  noArguments("execute confirm", args, "--dir <run-dir>");
  const { pinned, runDir } = plannedRun(dir, "confirm");
  if (pinned.confirmed) return stop("already_confirmed", { run: pinned.run });
  const units = pinned.executions.filter((e) => !e.blocked).map((e) => ({ id: e.id }));
  const label = pinned.tester?.label ?? FALLBACK;
  /** @type {ExecuteDispatchState} */
  const state = { ...newDispatch({ units, chain: label === FALLBACK ? [FALLBACK] : [label, FALLBACK], cap: pinned.concurrency_cap }), locks: {}, paused: [], retried: [], skipped: [], stale: [] };
  writeFileSync(join(runDir, "dispatch.json"), `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(join(runDir, "execute.json"), `${JSON.stringify(/** @type {ExecutePlan} */ ({ ...pinned, confirmed: true }), null, 2)}\n`);
  return { exit: 0, json: { action: "confirm", ok: true, dir: runDir, units: units.length } };
}

/** @type {CommandDefinition} */
export const command = {
  actions: /** @type {Record<string, CommandAction>} */ ({
    plan: { options: { root: "qa-dir" }, usage: "[<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--root <qa-dir>]", run: plan },
    confirm: { options: { dir: "value" }, usage: "--dir <run-dir>", run: confirm },
    ...openActions,
    ...briefActions,
    ...ingestActions,
    ...runActions,
    ...automationActions,
    ...followUpActions,
  }),
};
