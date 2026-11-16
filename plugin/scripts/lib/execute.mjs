// @ts-check
// Planning pins the working-tree claim. No login or browser opens before the engineer confirms.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { checkFile, projectConfig } from "./knowledge-file.mjs";
import { digestOf, digests } from "./pin-digest.mjs";
import { loadQaAt, repositoryOf, resolveRef } from "./git-tree.mjs";
import { caseMatchesLevels, caseLevels, caseFields, casePreconditions, caseSteps, stepActor } from "./case-fields.mjs";
import { isHeaderOnly, isNoLogin, signInUrl } from "./access-note.mjs";
import { hasPasswordSource } from "./typed-secret.mjs";
import { readHeaderCredential } from "./header-credential.mjs";
import { accessFor, accessNotes, rolesCoveringIn } from "./access.mjs";
import { isDeclaredTag } from "./case-labels.mjs";
import { executeTraining } from "./execute-training.mjs";
import { latestLevelFailures } from "./execution-results.mjs";
import { trainFile } from "./training.mjs";
import { loginUrlOf } from "./execution-guard.mjs";
import { loginFor } from "./scout.mjs";
import { noArguments } from "./cli.mjs";
/** @import { PlatformContext } from "./platform.mjs" */
import { MIN_PLAYWRIGHT_CLI, UPGRADE_PLAYWRIGHT_CLI, playwrightCliVersion } from "./playwright-version.mjs";
import { newRunDir, newRunId } from "./run-dir.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { claimProjection } from "./stripped.mjs";
import { ACCESS_TRAIN_KEY, CODEGEN_TRAIN_KEY, EXECUTE_TRAIN_KEY, LEVEL_ON_CASE_SCHEMA_VERSION, SCHEMA_VERSION } from "./schema.mjs";
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
import { unguardedReason } from "./host-admission.mjs";
import { parseDecisions } from "./refusal.mjs";
import { supportLink } from "./support-link.mjs";
import { LEVEL_TARGET_REFUSALS, hasUnmappedSplit, levelTargetRefusalLine, resolveLevelTargets, spansMultipleTargets, unmappedLevelsData } from "./level-target.mjs";

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
 *   bound_levels?: string[],
 *   selected_levels?: string[],
 *   omitted_levels?: string[],
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
 * A case a `level:` filter excluded before eligibility: a filter exclusion, not an eligibility skip.
 * @typedef {{
 *   key: string,
 *   bound_levels: string[],
 * }} ExecuteExcluded
 */

/**
 * A Layer-free case the plan narrowed to its sole Automation's level while other executable levels
 * exist: this Run exercises only `level`, and `left_out_levels` are not exercised (ADR-0056).
 * @typedef {{
 *   key: string,
 *   level: string,
 *   left_out_levels: string[],
 *   prior_results?: import("./execution-results.mjs").LevelFailure[],
 * }} ExecuteNarrowed
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
 * An Unguarded Run's pin (ADR-0057): present only when `execute plan` found a host whose Tester
 * guard cannot be verified, other than Claude Code below the floor. `digest` seals the pre-run Card the engineer acknowledges; `acknowledged` is
 * set by `execute confirm` from the engineer's Reply, after the digest check.
 * @typedef {{ reason: string, digest: string, acknowledged?: boolean }} ExecuteUnguarded
 */

/**
 * `<run>/execute.json` contract shape owned by `execute`.
 * @typedef {{
 *   root?: string,
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
 *   excluded?: ExecuteExcluded[],
 *   narrowed?: ExecuteNarrowed[],
 *   selection?: ExecuteSelection,
 *   automation?: AutoRun,
 *   no_password_source?: { role: string, access: string | null }[],
 *   unguarded?: ExecuteUnguarded,
 *   route_origins?: string[],
 *   route_sign_in_urls?: string[],
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
 *   reply?: string,
 * }} ExecuteUnit
 */

/**
 * `<run>/dispatch.json` shape owned by `execute` (specialization of DispatchState).
 * @typedef {DispatchState<ExecuteUnit> & {
 *   locks: Record<string, ExecuteLock>,
 *   paused: ExecutePausedNote[],
 *   retried: string[],
 *   skipped: string[],
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
  unmapped_levels: LEVEL_TARGET_REFUSALS.unmapped_levels,
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
  no_default_level: "A Layer-free case needs a default Test level: name one in a `train/execute.md` Practice or give exactly one `execute_levels` entry the `browser` mode.",
  no_executable_level: "None of the requested Test levels is in `execute_levels`.",
  integrity_error: "A selected file has an Integrity error; fix it before executing.",
  no_playwright_cli: "`/qa-execute` drives the app through `playwright-cli`, which is not on the PATH; install it first.",
  refused_playwright_cli: "`/qa-execute` refused the `playwright-cli` binary or shim resolved from PATH.",
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
  duplicate_run_dir: "Pass each Run dir only once to `execute confirm`.",
  unguarded_unacknowledged: "This host's Tester guard cannot be verified: the Run starts only after the engineer explicitly acknowledges an Unguarded Run on the pre-run Card.",
  invalid_decisions: "The Reply's decisions are not a JSON object.",
  card_changed: "The pre-run Card changed since it was shown; plan again and show the new Card.",
}, (code, data) => {
  if (Object.hasOwn(FILTER_REFUSALS, code) && Array.isArray(data.valid)) {
    return { ...data, line: `${FILTER_REFUSALS[code]} Valid values: ${data.valid.join(", ") || "(none)"}.` };
  }
  const line = levelTargetRefusalLine(code, data);
  return line !== null ? { ...data, line } : data;
});

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

/** @typedef {import("./access.mjs").ShownAccessNote} AccessNote */

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

// The fallback level for a Layer-free case with no `level:` filter: the distinct level a Practice names
// when exactly one does, else the single level whose mode is `browser`. `level: null` means neither
// resolved, so a Layer-free case needing this fallback stops `no_default_level`.
/**
 * @param {{ default_levels?: string[] }} training
 * @param {Record<string, string>} executeLevels
 * @returns {{ level: string | null, browser: string[], named: string[] }}
 */
function resolveDefaultLevel(training, executeLevels) {
  const named = [...new Set(training.default_levels ?? [])];
  const browser = Object.keys(executeLevels).filter((level) => executeLevels[level] === "browser");
  const level = named.length === 1 ? (Object.hasOwn(executeLevels, named[0]) ? named[0] : null)
    : named.length === 0 ? (browser.length === 1 ? browser[0] : null) : null;
  return { level, browser, named };
}

// The skip reasons of a case, in the fixed order: `manual` (no Tester can perform it), `level` (no
// selected level is executable, including a Layer-free case whose default or requested level cannot
// run), `conflict` (an open Conflict, re-armed Dismissals included), `no-steps` and `no-expected`
// (both read from the prose).
/**
 * @param {ScopeCase} c
 * @param {ReturnType<typeof projectConfig>} config
 * @param {HistorySection} history
 * @param {string[]} [levels]
 * @returns {string[]}
 */
function skipReasons(c, config, history, levels = caseLevels(c.entry.data)) {
  const findings = storedCaseFindings(history, c.file, c.entry);
  return /** @type {string[]} */ ([
    c.entry.data.manual === false && "manual",
    !levels.some((level) => Object.hasOwn(config.execute_levels, level)) && "level",
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
// no sessions). A Role whose note logs in as nobody (`via: none`, ADR-0063) gets a session with no
// login and holds no note. Each session is `{role, acc, setup}`: `role` the Role or `-` for a case
// with none, `acc` its note's key or null when no login, `setup` true for a Role that never acts in a
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
    if (!found.has(role)) found.set(role, (/** @type {(s: unknown, u: string[], o?: { passwordFiles?: boolean, headerCredentials?: boolean, role?: string | null }) => Record<string, AccessNote | null>} */ (accessFor))(index, [uri], { passwordFiles: true, headerCredentials: true, role })[uri]);
    return found.get(role);
  };
  const rolesOnly = rolesCoveringIn(index, uri, { passwordFiles: true, headerCredentials: true });
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
      if (role !== null && note && isNoLogin(note)) sessions.push({ role, acc: null, setup });
      else if (note) {
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
    const header = readHeaderCredential(root, note);
    if (header.refusal) return stop(header.refusal.code, { access: key, error: header.refusal.message, ...(header.refusal.gitignore_line && { gitignore_line: header.refusal.gitignore_line }) });
    if (isHeaderOnly(note)) continue;
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
/**
 * Verify `playwright-cli` availability and version for `/qa-execute`.
 * @param {Record<string, string | undefined>} env
 * @param {PlatformContext} [platformContext]
 * @returns {{ refusal: RefusalResult, version?: never } | { version: string, refusal?: never }}
 */
export function checkPlaywrightCli(env, platformContext = {}) {
  const found = playwrightCliVersion(env, platformContext);
  if (found.status === "missing") return { refusal: stop("no_playwright_cli", { upgrade: UPGRADE_PLAYWRIGHT_CLI }) };
  if (found.status === "refused") return { refusal: stop("refused_playwright_cli", { check: found.refusal.code, reason: found.refusal.message }) };
  if (found.status === "old") return { refusal: stop("old_playwright_cli", { ...(found.found && { found: found.found }), ...(found.failure && { failure: found.failure }), minimum: MIN_PLAYWRIGHT_CLI, upgrade: UPGRADE_PLAYWRIGHT_CLI }) };
  return { version: /** @type {string} */ (found.version) };
}

const word = (/** @type {string} */ s) => `'${s.replaceAll("'", `'\\''`)}'`;
const cases = (/** @type {number} */ n) => `${n} case${n === 1 ? "" : "s"}`;
const skippedLines = (/** @type {ExecuteSkipped[]} */ skipped) => skipped.map(({ key, reasons }) => `  ${key} (${reasons.join(", ")})`);

/**
 * Shared selection and alias header lines for a confirm prompt.
 * @param {ExecuteSelection} selection
 * @param {readonly string[]} aliases
 * @returns {string[]}
 */
function selectionHeaderLines(selection, aliases) {
  return [
    ...(selection.tags.length || selection.levels.length ? [`Selection: ${[...selection.scope, ...selection.tags.map((t) => `tag:${t}`), ...selection.levels.map((l) => `level:${l}`)].join(" ")}`] : []),
    ...aliases.map((a) => `Former key: ${a}`),
  ];
}

/**
 * Per-Run body lines: Levels, narrowed, excluded, Roles → Access notes, blocked, warnings, dirty, skipped.
 * @param {{
 *   executions: ExecuteExecution[],
 *   skipped: ExecuteSkipped[],
 *   warnings: string[],
 *   excluded: ExecuteExcluded[],
 *   narrowed: ExecuteNarrowed[],
 *   noPassword: { role: string, access: string | null }[],
 * }} options
 * @returns {string[]}
 */
function runDetailLines({ executions, skipped, warnings, excluded, narrowed, noPassword }) {
  const running = executions.filter((e) => !e.blocked);
  const blocked = executions.filter((e) => e.blocked);
  const logins = [...new Set(running.flatMap((e) => e.sessions).map(({ role, acc, setup }) =>
    `  ${role === "-" ? "(no Role)" : role} → ${acc ?? (role === "-" ? "unauthenticated" : "no login")}${setup ? " (setup)" : ""}`))];
  /** @param {string[]} levels */
  const levelList = (levels) => levels.length ? levels.join(", ") : "(none)";
  /** @type {Map<string, { bound: string[], selected: string[], executed: string[] }>} */
  const levelCases = new Map();
  for (const execution of executions) {
    if (!levelCases.has(execution.key)) {
      levelCases.set(execution.key, {
        bound: execution.bound_levels ?? [],
        selected: execution.selected_levels ?? [execution.level],
        executed: [],
      });
    }
    const entry = /** @type {{ bound: string[], selected: string[], executed: string[] }} */ (levelCases.get(execution.key));
    if (!entry.executed.includes(execution.level)) entry.executed.push(execution.level);
  }
  const levelLines = [...levelCases].map(([key, { bound, selected, executed }]) =>
    `  ${key}: bound ${levelList(bound)}; selected ${levelList(selected)}; executed ${levelList(executed)}; omitted ${levelList(bound.filter((level) => !selected.includes(level)))}`);
  return [
    ...(levelLines.length ? ["Levels:", ...levelLines] : []),
    ...(narrowed.length ? [
      "Layer-free cases narrowed to their Automation's level (other executable levels are not exercised):",
      ...narrowed.map(({ key, level, left_out_levels, prior_results }) => `  ${key}: ${level}; left out: ${levelList(left_out_levels)}${prior_results?.length ? `; prior: ${prior_results.map((r) => `${r.level} ${r.result}${r.reason ? ` (${r.reason})` : ""}`).join(", ")}` : ""}`),
      "Run one at another level with `level:<name>`.",
    ] : []),
    ...(excluded.length ? [`Excluded by filters (${excluded.length}), not skipped:`, ...excluded.map((e) => `  ${e.key}: bound ${levelList(e.bound_levels)}`)] : []),
    ...(logins.length ? ["Roles → Access notes:", ...logins] : []),
    ...noPassword.map(({ role }) => `Role ${role} has no password source; a case that signs in as ${role} will Block`),
    ...(blocked.length ? [`Blocked before dispatch (${blocked.length}), no result is earned:`, ...blocked.map((e) => `  ${e.key} (${(/** @type {ExecuteBlocked} */ (e.blocked)).reason}): ${(/** @type {ExecuteBlocked} */ (e.blocked)).why}`)] : []),
    ...warnings.map((w) => `Warning: ${w}`),
    ...(executions.some((e) => e.dirty) ? [`Uncommitted case text runs as edited: ${executions.filter((e) => e.dirty).map((e) => e.key).join(", ")}`] : []),
    ...(skipped.length ? [`Skipped (${skipped.length}), their previous result stays the latest:`, ...skippedLines(skipped)] : []),
  ];
}

/**
 * @param {ExecuteUnguarded | undefined} unguarded
 * @returns {string[]}
 */
function unguardedLines(unguarded) {
  return unguarded ? [
    `No verified Tester guard: ${unguarded.reason}`,
    "This would be an Unguarded Run: only prompt instructions keep the Tester from running other commands or reading credentials.",
    "It starts only if you explicitly acknowledge running without the Tester guard; a plain yes to the plan does not.",
  ] : [];
}

/**
 * @returns {string[]}
 */
function dataHandlingLines() {
  return [
    "Data handling: configured credential sources are denied to the Tester.",
    "Recognised credential patterns are scrubbed from command output, saved responses and guard logs.",
    "Application data is not kept confidential.",
    "Use non-production targets with test accounts; entities the Tester creates are left for you to clean up.",
    `Details: ${supportLink("data-handling")}`,
  ];
}

/**
 * @param {{ dir: string, root: string }} options
 * @returns {string[]}
 */
function runFooterLines({ dir, root }) {
  return [
    `Run dir: ${dir}`,
    `When the Run is over: node <plugin>/scripts/scan.mjs execute ingest --dir ${word(dir)}${root === ".qa" ? "" : ` --root ${word(root)}`}`,
  ];
}

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
 *   excluded: ExecuteExcluded[],
 *   narrowed: ExecuteNarrowed[],
 *   noPassword: { role: string, access: string | null }[],
 *   unguarded?: ExecuteUnguarded,
 * }} options
 * @returns {string}
 */
function confirmText({ target, executions, skipped, aliases, warnings, dir, root, selection, excluded, narrowed, noPassword, unguarded }) {
  return [
    `Execute ${cases(new Set(executions.map((e) => e.key)).size)} against ${target.slug} (${target.origin}).`,
    ...selectionHeaderLines(selection, aliases),
    ...runDetailLines({ executions, skipped, warnings, excluded, narrowed, noPassword }),
    ...unguardedLines(unguarded),
    ...dataHandlingLines(),
    ...runFooterLines({ dir, root }),
  ].join("\n");
}

/**
 * Per-Run planning summary shared by `plan`'s prepared Runs and `multiConfirmText`.
 * @typedef {{
 *   target: ExecuteTarget,
 *   executions: ExecuteExecution[],
 *   skipped: ExecuteSkipped[],
 *   excluded: ExecuteExcluded[],
 *   narrowed: ExecuteNarrowed[],
 *   warnings: string[],
 *   noPassword: { role: string, access: string | null }[],
 *   pinned: ExecutePlan,
 *   dir: string,
 * }} PreparedRun
 */

/**
 * Confirm text for a multi-Run plan across multiple Level targets.
 * @param {{
 *   runs: PreparedRun[],
 *   totalCases: number,
 *   aliases: string[],
 *   selection: ExecuteSelection,
 *   unguarded?: ExecuteUnguarded,
 *   root: string,
 * }} options
 * @returns {string}
 */
function multiConfirmText({ runs, totalCases, aliases, selection, unguarded, root }) {
  return [
    `Execute ${cases(totalCases)} as ${runs.length} Runs:`,
    ...selectionHeaderLines(selection, aliases),
    ...runs.flatMap((r, i) => [
      "",
      `Run ${i + 1} of ${runs.length}: ${r.target.slug} (${r.target.origin}) — ${cases(new Set(r.executions.map((e) => e.key)).size)}.`,
      ...runDetailLines(r),
      ...runFooterLines({ dir: r.dir, root }),
    ]),
    "",
    ...unguardedLines(unguarded),
    ...dataHandlingLines(),
  ].join("\n");
}

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function plan(args, { root, env, platformContext }) {
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
  const explicitTarget = targets[0];
  if (rawUrl || (explicitTarget !== undefined && !Object.hasOwn(config.targets, explicitTarget))) {
    return stop("unknown_target", { target: rawUrl ?? explicitTarget ?? "", targets: Object.keys(config.targets) });
  }
  if (!config.execute_levels) return stop("no_execute_levels");
  const training = executeTraining(trainFile(index, EXECUTE_TRAIN_KEY));
  const defaultResolution = resolveDefaultLevel(training, config.execute_levels);
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
  const soleAutomationLevel = (/** @type {ScopeCase} */ c) => {
    const bound = caseLevels(c.entry.data);
    if (bound.length) return null;
    const automated = [...new Set(strings(c.entry.data.automates)
      .flatMap((id) => facts.index.automations?.[id]?.level ?? []))];
    return automated.length === 1 && Object.hasOwn(config.execute_levels, automated[0]) ? automated[0] : null;
  };
  const executableLevels = (/** @type {ScopeCase} */ c) => {
    const bound = caseLevels(c.entry.data);
    if (bound.length) return bound;
    const sole = soleAutomationLevel(c);
    return sole !== null ? [sole] : defaultResolution.level ? [defaultResolution.level] : [];
  };
  if (!scope.length && !tags.length && !levels.length) return stop("no_scope", { features: [...index.features.keys()].filter(state.liveFeature).map((key) => {
    const inFeature = state.cases.filter((c) => c.feature === key);
    const skipped = inFeature.filter((c) => skipReasons(c, config, facts.history, executableLevels(c)).length).length;
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
  const tagged = scopeCases.filter((c) => !requestedTags.size || strings(c.entry.data.tags).some((tag) => requestedTags.has(tag)));
  // A `level:` filter picks every Layer-free case and every case bound to a requested level. A
  // case bound only elsewhere never enters the Run: a filter exclusion, not an eligibility skip.
  // Execute refuses projects below schema 4, so caseLevels needs no file/schema for Scenario inheritance.
  const levelMatches = (/** @type {ScopeCase} */ c) => caseMatchesLevels(c.entry.data, {}, config.schemaVersion, requestedLevels);
  const selected = tagged.filter(levelMatches);
  /** @type {ExecuteExcluded[]} */
  const excluded = requestedLevels.size ? tagged.filter((c) => !levelMatches(c)).map((c) => ({ key: c.entry.key, bound_levels: caseLevels(c.entry.data) })) : [];
  if (!selected.length) return stop("no_matching_cases", { selection, ...(excluded.length && { excluded }) });
  const needsDefault = requestedLevels.size === 0 && selected.some((c) => caseLevels(c.entry.data).length === 0 && executableLevels(c).length === 0);
  if (needsDefault) {
    return stop("no_default_level", { browser: defaultResolution.browser, practice: defaultResolution.named });
  }
  /** @type {Map<ScopeCase, { bound: string[], selected: string[], omitted: string[] }>} */
  const levelPlan = new Map(selected.map((c) => {
    const bound = caseLevels(c.entry.data);
    const planned = bound.length
      ? bound.filter((level) => Object.hasOwn(config.execute_levels, level) && (!requestedLevels.size || requestedLevels.has(level)))
      : requestedLevels.size
        ? [...requestedLevels].filter((level) => Object.hasOwn(config.execute_levels, level))
        : executableLevels(c);
    return [c, { bound, selected: planned, omitted: bound.filter((level) => !planned.includes(level)) }];
  }));
  // Scan already resolves source paths through automationLevel. An unresolved Automation can
  // serve a Layer-free case's sole selected level; a bound case keeps the legacy-only fallback.
  const legacyAutomations = trainFile(index, CODEGEN_TRAIN_KEY)?.data.approaches === undefined;
  const automationsAt = (/** @type {ScopeCase} */ c, /** @type {string} */ level) => {
    if (c.entry.data.automatable === false) return [];
    const { bound, selected: selectedLevels } = /** @type {{ bound: string[], selected: string[] }} */ (levelPlan.get(c));
    const fallback = bound.length === 0
      ? selectedLevels.length === 1 ? selectedLevels[0] : null
      : legacyAutomations && bound.length === 1 ? bound[0] : null;
    return strings(c.entry.data.automates).filter((id) => {
      const automation = facts.index.automations?.[id];
      if (!automation) return false;
      const resolved = automation.level ?? fallback;
      return resolved === level;
    });
  };
  // A selected `automates` key whose code side has a duplicate or a pattern error would run the
  // wrong test: refuse the whole Run before it creates a run directory.
  const dueKeys = new Set(selected.flatMap((c) => c.entry.data.automatable !== false ? strings(c.entry.data.automates) : []));
  const codeBroken = facts.results.filter((r) => r.kind === "integrity_error" &&
    ["duplicate_automation_key", "automation_key_pattern"].includes(/** @type {string} */ (r.code)) && dueKeys.has(/** @type {string} */ (r.key)));
  if (codeBroken.length) {
    return stop("integrity_error", { errors: codeBroken.map(({ code, key, function: fn, message }) => ({ code, key, ...(fn !== undefined && { function: fn }), message })) });
  }
  const reasons = new Map(selected.map((c) => [c, skipReasons(c, config, facts.history, (/** @type {{ selected: string[] }} */ (levelPlan.get(c))).selected)]));
  // An incomplete case (no steps, or no Expected result) or one no Tester can perform still runs its
  // Automation: its Automation evidence is useful even though no Tester Execution can follow. It
  // records `execution_skipped` instead. A case at another level, in conflict, or without an
  // Automation stays skipped.
  const promoted = new Set(selected.filter((c) => {
    const rs = /** @type {string[]} */ (reasons.get(c));
    return rs.length > 0 && rs.every((r) => ["manual", "no-steps", "no-expected"].includes(r)) &&
      (/** @type {{ selected: string[] }} */ (levelPlan.get(c))).selected.some((level) => automationsAt(c, level).length > 0);
  }));
  const skipped = selected.filter((c) => (/** @type {string[]} */ (reasons.get(c))).length && !promoted.has(c))
    .map((c) => ({ key: c.entry.key, reasons: /** @type {string[]} */ (reasons.get(c)) }));
  const runnable = selected.filter((c) => !(/** @type {string[]} */ (reasons.get(c))).length);
  const unexecutable = unavailable.length ? [`Requested Test levels cannot execute: ${unavailable.join(", ")}; matching cases at those levels are skipped.`] : [];
  if (!runnable.length && !promoted.size) {
    return { exit: 0, json: { action: "plan", ok: true, executions: 0, skipped, text: ["Nothing to execute: every selected case is skipped.", ...unexecutable.map((w) => `Warning: ${w}`), ...skippedLines(skipped)].join("\n") } };
  }
  const runnableSet = new Set(runnable);
  const plannedPairs = selected.filter((c) => runnableSet.has(c) || promoted.has(c)).flatMap((c) =>
    (/** @type {{ selected: string[] }} */ (levelPlan.get(c))).selected
      .filter((level) => !promoted.has(c) || automationsAt(c, level).length > 0)
      .map((level) => ({ c, level })));
  const targetResolution = resolveLevelTargets({
    targets: config.targets,
    levelTargets: config.level_targets,
    levels: plannedPairs.map((pair) => pair.level),
    explicitTarget,
  });
  if (hasUnmappedSplit(targetResolution, config.targets)) {
    return stop("unmapped_levels", unmappedLevelsData(targetResolution, config.targets, config.level_targets));
  }
  const cli = checkPlaywrightCli(env, /** @type {PlatformContext | undefined} */ (platformContext));
  if (cli.refusal) return cli.refusal;
  const head = digests(loadQaAt(repo, commit));
  const stripped = new Map();
  /** @param {{ file: KnowledgeFile, entry: { key: string } }} param0 */
  const textOf = ({ file, entry }) => {
    if (!stripped.has(file)) stripped.set(file, claimProjection(file));
    return stripped.get(file).cases.get(entry.key);
  };
  const executable = Object.keys(config.execute_levels);
  const levelFailures = latestLevelFailures(files, index, defaultResolution.level);
  const { tier, label } = tierFor(index.project, "tester");
  const cap = concurrencyCap(index.project);
  const adapter = resolveAdapter(config.stack, repo.top).adapter;
  const hasDueAutomations = plannedPairs.some(({ c, level }) => automationsAt(c, level).length > 0);
  const code = hasDueAutomations && adapter ? buildCodeIndex(repo.top, config.modulePaths, config.annotationMap, adapter, keyPatterns(config)) : null;
  const reason = unguardedReason({ env });
  const groups = targetResolution.groups;
  const single = !spansMultipleTargets(targetResolution);

  /** @type {Map<string, ExecuteSkipped[]>} */
  const skippedByTarget = new Map(groups.map((g) => [g.target.slug, []]));
  if (single) {
    skippedByTarget.set(groups[0].target.slug, skipped);
  } else {
    for (const c of selected) {
      const rs = /** @type {string[]} */ (reasons.get(c));
      if (!rs.length || promoted.has(c)) continue;
      const caseSelected = (/** @type {{ selected: string[] }} */ (levelPlan.get(c))).selected;
      const owner = groups.find((g) => g.levels.some((l) => caseSelected.includes(l))) ?? groups[0];
      /** @type {ExecuteSkipped[]} */ (skippedByTarget.get(owner.target.slug)).push({ key: c.entry.key, reasons: rs });
    }
  }

  /** @type {PreparedRun[]} */
  const prepared = [];
  for (const [groupIndex, group] of groups.entries()) {
    const target = group.target;
    const groupPairs = single ? plannedPairs : plannedPairs.filter(({ level }) => group.levels.includes(level));
    const groupRunnable = single ? runnable : runnable.filter((c) => groupPairs.some((p) => p.c === c));
    const access = resolveCaseAccess(groupRunnable, { index, target });
    const refused = loginRefusal(/** @type {string} */ (root), target, access);
    if (refused) return refused;
    const accessByKey = new Map(access.cases.map((c) => [c.entry.key, c]));
    /** @type {ExecuteExecution[]} */
    const executions = groupPairs.map(({ c, level }, i) => {
      const run = accessByKey.get(c.entry.key);
      const { entry, feature } = c;
      const planned = /** @type {{ bound: string[], selected: string[], omitted: string[] }} */ (levelPlan.get(c));
      const selectedLevels = single ? planned.selected : planned.selected.filter((l) => group.levels.includes(l));
      const omittedLevels = planned.bound.filter((l) => !selectedLevels.includes(l));
      const text = textOf(c);
      const digest = digestOf(["case", text]);
      const automations = automationsAt(c, level);
      return {
        id: `ex_${i + 1}`, key: entry.key, summary: entry.summary,
        ...(/** @type {{ tracker: string } | undefined} */ (entry.data.tracker && { tracker: entry.data.tracker })), feature,
        text, level, bound_levels: planned.bound, selected_levels: selectedLevels, omitted_levels: omittedLevels,
        mode: config.execute_levels[level], digest, dirty: head.review(entry.key) !== digest,
        review: facts.history.reviews.find((r) => r.key === entry.key)?.status ?? "none",
        stale: storedCaseFindings(facts.history, c.file, entry).some((/** @type {StoredFinding} */ f) => f.kind === "Stale" && f.status === "open"),
        ...(automations.length && { automations }),
        roles: run ? run.roles : strings(entry.data.roles), access: run ? run.access : [], sessions: run ? run.sessions : [],
        cap: 10 + 5 * (caseSteps(entry).length + casePreconditions(entry).length),
        ...(promoted.has(c) && { execution_skipped: /** @type {string[]} */ (reasons.get(c)) }),
        ...(run?.blocked && { blocked: run.blocked }),
      };
    });
    // A Layer-free case the plan put at its Automation's sole level, while other executable levels
    // exist: name it so the plan says which levels this Run leaves unexercised (ADR-0056).
    const running = new Set(executions.filter((e) => !e.blocked).map((e) => e.key));
    /** @type {ExecuteNarrowed[]} */
    const narrowed = requestedLevels.size === 0 && executable.length > 1
      ? selected.flatMap((c) => {
        if (!running.has(c.entry.key)) return [];
        const sole = soleAutomationLevel(c);
        if (sole === null) return [];
        const leftOut = executable.filter((level) => level !== sole);
        const prior = (levelFailures.get(c.entry.key) ?? []).filter((f) => leftOut.includes(f.level));
        return [{ key: c.entry.key, level: sole, left_out_levels: leftOut, ...(prior.length && { prior_results: prior }) }];
      })
      : [];
    const groupSkipped = /** @type {ExecuteSkipped[]} */ (skippedByTarget.get(target.slug));
    // Filter exclusions belong to the whole invocation rather than one target, so attach them to the first Run.
    const groupExcluded = groupIndex === 0 ? excluded : [];
    const routeOrigins = otherTargetOrigins(config.targets, target.origin);
    const routeSignInUrls = signInUrlsOn(/** @type {string} */ (root), [target.origin, ...routeOrigins]);
    /** @type {ExecutePlan} */
    const pinned = { root: resolve(/** @type {string} */ (root)), confirmed: false, run: newRunId(), target, created_at: new Date().toISOString(), playwright_cli: cli.version, commit, tester: { tier, label }, concurrency_cap: cap, executions, skipped: groupSkipped, ...(groupExcluded.length && { excluded: groupExcluded }), ...(narrowed.length && { narrowed }), selection, ...(routeOrigins.length && { route_origins: routeOrigins }), ...(routeSignInUrls.length && { route_sign_in_urls: routeSignInUrls }) };
    const due = [...new Set(executions.flatMap((e) => e.automations ?? []))];
    if (due.length) {
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
    // A Role whose note holds no user and password the CLI logs in with cannot be signed in by `fill-password` (ADR-0066).
    const noPassword = [...new Map(executions.filter((e) => !e.blocked).flatMap((e) => e.sessions)
      .filter((s) => s.role !== "-" && !hasPasswordSource(s.acc === null ? null : access.notes.get(s.acc)))
      .map((s) => [`${s.role}\0${s.acc}`, { role: s.role, access: s.acc }])).values()];
    if (noPassword.length) pinned.no_password_source = noPassword;
    if (reason !== null) pinned.unguarded = { reason, digest: unguardedDigest(pinned, reason) };
    // Unexecutable-level warnings are invocation-wide, so include them once on the first Run.
    const warnings = [...access.warnings, ...(groupIndex === 0 ? unexecutable : [])];
    prepared.push({ target, executions, skipped: groupSkipped, excluded: groupExcluded, narrowed, warnings, noPassword, pinned, dir: "" });
  }

  // Create run directories only after every Run passed planning and login checks.
  for (const item of prepared) {
    const dir = /** @type {{ make(): string }} */ (newRunDir(undefined, "qa-skills-execute-")).make();
    mkdirSync(join(dir, ".playwright"));
    writeFileSync(join(dir, "execute.json"), `${JSON.stringify(item.pinned, null, 2)}\n`);
    item.dir = dir;
  }

  if (single) {
    const only = prepared[0];
    return { exit: 0, json: { action: "plan", ok: true, dir: only.dir, executions: only.executions.length, skipped: only.skipped, ...(only.excluded.length && { excluded: only.excluded }), ...(only.narrowed.length && { narrowed: only.narrowed }), warnings: only.warnings, ...(only.pinned.unguarded && { unguarded: true }), text: confirmText({ target: only.target, executions: only.executions, skipped: only.skipped, aliases, warnings: only.warnings, dir: only.dir, root: /** @type {string} */ (root), selection, excluded: only.excluded, narrowed: only.narrowed, noPassword: only.noPassword, unguarded: only.pinned.unguarded }) } };
  }

  const allNarrowed = prepared.flatMap((p) => p.narrowed);
  const allWarnings = prepared.flatMap((p) => p.warnings);
  const totalCases = new Set(prepared.flatMap((p) => p.executions.map((e) => e.key))).size;
  return {
    exit: 0,
    json: {
      action: "plan",
      ok: true,
      runs: prepared.map((p) => ({
        dir: p.dir,
        target: p.target.slug,
        origin: p.target.origin,
        executions: p.executions.length,
        skipped: p.skipped,
        ...(p.excluded.length && { excluded: p.excluded }),
        ...(p.narrowed.length && { narrowed: p.narrowed }),
        warnings: p.warnings,
      })),
      executions: prepared.reduce((sum, p) => sum + p.executions.length, 0),
      skipped,
      ...(excluded.length && { excluded }),
      ...(allNarrowed.length && { narrowed: allNarrowed }),
      warnings: allWarnings,
      ...(reason !== null && { unguarded: true }),
      text: multiConfirmText({ runs: prepared, totalCases, aliases, selection, unguarded: prepared[0].pinned.unguarded, root: /** @type {string} */ (root) }),
    },
  };
}

// Freezes the plan: from here `execute.json` never changes and every mutable fact of the Run lives
// in `dispatch.json` (lib/execute-dispatch.mjs): lib/dispatch.mjs's policy state, one queued unit
// per Execution not already Blocked and the Tester's Delegates as the chain (its model, then the
// Fallback), plus the Access note `locks` and the login lifecycle's `paused`, `retried` and `skipped`
// notes (lib/execute-auth.mjs).
/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function confirm(args, { dir, stdin, env }) {
  noArguments("execute confirm", args, "--dir <run-dir>... [--stdin]");
  const rawDirs = /** @type {string[] | string | undefined} */ (/** @type {unknown} */ (dir));
  const dirs = Array.isArray(rawDirs) ? rawDirs : rawDirs ? [rawDirs] : [];
  if (!dirs.length) plannedRun(undefined, "confirm");
  // Cache stdin so multi-Run Unguarded acknowledgements validate every Run against the single reply.
  const cachedStdin = stdin ? (() => {
    /** @type {string | undefined} */
    let text;
    return () => text ?? (text = stdin());
  })() : null;
  /** @type {Array<{ pinned: ExecutePlan, runDir: string, units: Array<{ id: string }> }>} */
  const prepared = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const d of dirs) {
    const { pinned, runDir } = plannedRun(d, "confirm");
    if (seen.has(runDir)) return stop("duplicate_run_dir", { dir: runDir });
    seen.add(runDir);
    if (pinned.confirmed) return stop("already_confirmed", { run: pinned.run });
    if (pinned.unguarded) {
      const refused = unguardedReply(pinned, cachedStdin, env);
      if (refused) return refused;
      pinned.unguarded = { ...pinned.unguarded, acknowledged: true };
    }
    prepared.push({ pinned, runDir, units: pinned.executions.filter((e) => !e.blocked).map((e) => ({ id: e.id })) });
  }
  for (const { pinned, runDir, units } of prepared) {
    const label = pinned.tester?.label ?? FALLBACK;
    /** @type {ExecuteDispatchState} */
    const state = { ...newDispatch({ units, chain: label === FALLBACK ? [FALLBACK] : [label, FALLBACK], cap: pinned.concurrency_cap }), locks: {}, paused: [], retried: [], skipped: [] };
    writeFileSync(join(runDir, "dispatch.json"), `${JSON.stringify(state, null, 2)}\n`);
    writeFileSync(join(runDir, "execute.json"), `${JSON.stringify(/** @type {ExecutePlan} */ ({ ...pinned, confirmed: true }), null, 2)}\n`);
  }
  if (prepared.length === 1) {
    const { pinned, runDir, units } = prepared[0];
    return { exit: 0, json: { action: "confirm", ok: true, dir: runDir, units: units.length, ...(pinned.unguarded && { unguarded: true }) } };
  }
  const unguarded = prepared.some(({ pinned }) => Boolean(pinned.unguarded));
  return {
    exit: 0,
    json: {
      action: "confirm",
      ok: true,
      runs: prepared.map(({ runDir, units }) => ({ dir: runDir, units: units.length })),
      units: prepared.reduce((sum, r) => sum + r.units.length, 0),
      ...(unguarded && { unguarded: true }),
    },
  };
}

/**
 * The origins of the project's other configured targets: a Tester route may also answer requests
 * the target's pages send there, such as a UI calling its API on its own origin.
 * @param {Record<string, unknown>} targets
 * @param {string} own
 * @returns {string[]}
 */
function otherTargetOrigins(targets, own) {
  /** @param {unknown} value @returns {string[]} */
  const originOf = (value) => {
    try {
      const url = new URL(String(value));
      return ["http:", "https:"].includes(url.protocol) ? [url.origin] : [];
    } catch {
      return [];
    }
  };
  const self = originOf(own)[0] ?? own;
  return [...new Set(Object.values(targets).flatMap(originOf))].filter((origin) => origin !== self);
}

/**
 * The sign-in URLs Training names on `origins` (the Run's own and the other configured ones):
 * each Access note's `identifiers.login_url`, resolved as `loginUrlOf` resolves it on the origin of
 * the note's first `url:` match, and its `identifiers.sign_in_urls`. A route on one of those origins
 * is checked against them, beside the session's own login URL, and a route on another configured
 * origin is refused when none is known there.
 * @param {string} root
 * @param {readonly string[]} origins
 * @returns {string[]}
 */
function signInUrlsOn(root, origins) {
  /** @type {string[]} */
  const urls = [];
  for (const note of accessNotes(trainFile(root, ACCESS_TRAIN_KEY))) {
    const ids = note.identifiers && typeof note.identifiers === "object" ? /** @type {Record<string, unknown>} */ (note.identifiers) : {};
    const home = (Array.isArray(note.match) ? note.match : []).find((m) => typeof m === "string" && m.startsWith("url:"));
    const homeOrigin = signInUrl(home?.slice(4));
    // The note's login URL as its own session would resolve it, on the origin its `match` names.
    const named = [homeOrigin === null ? null : loginUrlOf({ identifiers: ids }, new URL(homeOrigin).origin), ...(Array.isArray(ids.sign_in_urls) ? ids.sign_in_urls.map((u) => signInUrl(u)) : [])];
    for (const url of named) if (url !== null && origins.includes(new URL(url).origin) && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

// The pre-run Card's seal for an Unguarded Run: the frozen plan as shown, and why no guard holds.
/**
 * @param {ExecutePlan} pinned
 * @param {string} reason
 * @returns {string}
 */
function unguardedDigest(pinned, reason) {
  const { confirmed, unguarded, ...shown } = pinned;
  return digestOf(["unguarded", shown, reason]);
}

// The engineer's acknowledgment, mapped from their own words on the pre-run Card, under the same
// digest check as any Reply: the Card must be unchanged and the host still unable to hold the guard.
/**
 * @param {ExecutePlan} pinned
 * @param {(() => string) | null | undefined} stdin
 * @param {NodeJS.ProcessEnv | undefined} env
 * @returns {import("./refusal.mjs").RefusalResult | null}
 */
function unguardedReply(pinned, stdin, env) {
  const { unguarded } = pinned;
  if (!unguarded) return null;
  if (!stdin) return stop("unguarded_unacknowledged", { run: pinned.run, reason: unguarded.reason });
  const parsed = parseDecisions(stdin());
  if ("errors" in parsed) return stop("invalid_decisions", {});
  if (parsed.input.acknowledge !== "unguarded") return stop("unguarded_unacknowledged", { run: pinned.run, reason: unguarded.reason });
  const reason = unguardedReason({ env });
  if (reason === null || unguardedDigest(pinned, reason) !== unguarded.digest) return stop("card_changed", { run: pinned.run, rebuild: true });
  return null;
}

/** @type {CommandDefinition} */
export const command = {
  actions: /** @type {Record<string, CommandAction>} */ ({
    plan: { options: { root: "qa-dir" }, usage: "[<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--root <qa-dir>]", run: plan },
    confirm: { options: { dir: "values", stdin: "flag" }, usage: "--dir <run-dir>... [--stdin]", run: confirm },
    ...openActions,
    ...briefActions,
    ...ingestActions,
    ...runActions,
    ...automationActions,
    ...followUpActions,
  }),
};
