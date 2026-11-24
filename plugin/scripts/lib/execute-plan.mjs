// @ts-check
// The frozen plan of a `/qa-execute` Run, `<run>/execute.json`: the Run's shared shapes, the one
// validated reader, and the lookups every action uses to open the plan and one of its Executions.
// `execute plan` writes the plan and `execute confirm` freezes it with `confirmed: true`; nothing
// changes it after that. A Run's mutable state is execute-state.mjs's.
//
// The Tester wrapper reads the plan through `readPlan` too, and imports nothing of the scheduler's
// dispatch state (ADR-0035's boundary stays small).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError, orThrow } from "./cli.mjs";
import { refusalsWithoutLines } from "./refusal.mjs";
import { openRunDir, readRunFile } from "./run-dir.mjs";

/**
 * @import { RunFileResult } from "./run-dir.mjs"
 * @import { RefusalResult } from "./refusal.mjs"
 */

export const PLAN_FILE = "execute.json";

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
 *   automation_retries?: number,
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
 * Shape checked by isPlan before narrowing to ExecutePlan.
 * @typedef {{
 *   confirmed?: boolean,
 *   run?: string,
 *   target?: { slug?: string, origin?: string },
 *   commit?: string,
 *   playwright_cli?: string,
 *   created_at: string,
 *   skipped?: unknown[],
 *   executions: Array<{
 *     id?: string,
 *     key?: string,
 *     summary?: string,
 *     feature?: string,
 *     digest?: string,
 *     review?: string,
 *     roles?: unknown[],
 *     access?: unknown[],
 *     cap: number,
 *   }>,
 * }} CandidatePlan
 */

/**
 * Result of looking up an execution in an execute plan.
 * @typedef {{
 *   pinned: ExecutePlan,
 *   ex: ExecuteExecution,
 *   runDir: string,
 *   refusal?: undefined,
 * } | {
 *   pinned?: undefined,
 *   ex?: undefined,
 *   runDir?: undefined,
 *   refusal: RefusalResult,
 * }} ExecutionLookupResult
 */

const { stop } = refusalsWithoutLines();

// Whether `plan` (a parsed `execute.json`) is the shape `execute plan` writes: the one answer every
// action that reads the plan gives.
/**
 * @param {CandidatePlan} plan
 * @returns {plan is ExecutePlan}
 */
function isPlan(plan) {
  const text = (/** @type {unknown} */ v) => typeof v === "string" && v !== "";
  const list = (/** @type {unknown} */ v) => Array.isArray(v);
  return Boolean(plan) && typeof plan.confirmed === "boolean" && text(plan.run) && text(plan.target?.slug) && text(plan.target?.origin) && text(plan.commit) && text(plan.playwright_cli) &&
    Number.isFinite(Date.parse(plan.created_at)) && list(plan.skipped) && list(plan.executions) &&
    plan.executions.every((e) => text(e?.id) && text(e.key) && text(e.summary) && text(e.feature) && text(e.digest) && text(e.review) && list(e.roles) && list(e.access) && Number.isSafeInteger(e.cap) && e.cap >= 1);
}

// The Run's plan file, `{value}` (null when `missing` is undefined and there is none) or `{error}`.
/**
 * @param {string} runDir
 * @param {string} [missing]
 * @returns {RunFileResult<ExecutePlan>}
 */
const readPlanFile = (runDir, missing) => readRunFile(runDir, PLAN_FILE, { by: "execute plan", restart: "execute plan", missing });

// The one place the plan is read and validated: `{plan}`, `{plan: null}` when the file is absent,
// or `{error}` when it is not JSON.
/**
 * @param {string} runDir
 * @param {string} [missing]
 * @returns {{ plan: ExecutePlan | null, error?: string }}
 */
function readValidPlan(runDir, missing) {
  const read = readPlanFile(runDir, missing);
  if (read.error) return { plan: null, error: read.error };
  return { plan: isPlan(/** @type {CandidatePlan} */ (read.value)) ? /** @type {ExecutePlan} */ (read.value) : null };
}

// The Run's validated plan, or null when it is absent or not the shape `execute plan` wrote.
/**
 * @param {string} runDir
 * @returns {ExecutePlan | null}
 */
export function readPlan(runDir) {
  return readValidPlan(runDir).plan;
}

// The Run's validated plan, or structured facts naming why it cannot be used: `{plan}`, or
// `{plan: null, file, reason, errno?}` where reason is `missing`, `unreadable`, `not_json`, or `invalid`.
/**
 * @param {string} runDir
 * @returns {{ plan: ExecutePlan, file?: never, reason?: never, errno?: never } | { plan: null, file: string, reason: "missing" | "unreadable" | "not_json" | "invalid", errno?: string }}
 */
export function planOrCause(runDir) {
  const file = join(runDir, PLAN_FILE);
  if (!existsSync(file)) return { plan: null, file, reason: "missing" };
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    const errno = /** @type {NodeJS.ErrnoException} */ (error).code;
    return { plan: null, file, reason: "unreadable", ...(errno && { errno }) };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { plan: null, file, reason: "not_json" };
  }
  return isPlan(/** @type {CandidatePlan} */ (value))
    ? { plan: /** @type {ExecutePlan} */ (value) }
    : { plan: null, file, reason: "invalid" };
}

// The Run's plan: `{pinned, runDir}`; a usage error when there is no run dir or plan, or it is not one.
/**
 * @param {string | undefined} dir
 * @param {string} action
 * @returns {{ pinned: ExecutePlan, runDir: string }}
 */
export function plannedRun(dir, action) {
  const opened = orThrow(openRunDir(dir, { cmd: "execute", action, from: "execute plan" }));
  const read = readValidPlan(opened.dir, `no plan in ${opened.dir}: run \`execute plan\` first`);
  if (read.error) throw new UsageError(read.error);
  if (!read.plan) throw new UsageError(`${join(opened.dir, PLAN_FILE)} is not the plan \`execute plan\` wrote: start a new run with \`execute plan\``);
  return { pinned: read.plan, runDir: opened.dir };
}

// The Run's plan and the Execution `id` in it: `{pinned, ex, runDir}`, or `{refusal}`.
/**
 * @param {string | undefined} dir
 * @param {string} id
 * @param {string} action
 * @returns {ExecutionLookupResult}
 */
export function execution(dir, id, action) {
  const { pinned, runDir } = plannedRun(dir, action);
  const ex = pinned.executions.find((e) => e.id === id);
  return ex ? { pinned, ex, runDir } : { refusal: stop("unknown_execution", { execution: id }) };
}
