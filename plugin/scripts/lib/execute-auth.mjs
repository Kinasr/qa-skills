// @ts-check
// A Run's logins (ADR-0036): what `execute open` and the scheduler (`execute next`/`record`/`resume`)
// agree on about a login kept for the Run, a note that cannot log in and the Executions that need it.
//
// A CLI login's state lives at `<run>/auth/<acc>.json`, mode 0600 in a 0700 dir: made lazily by the
// first `execute open` that needs the note, loaded by later ones, deleted by the scheduler once no
// unstarted Execution needs the note (`sweepAuth`), swept whole by `ingest`. The engineer's saved
// `login_state` is never copied or deleted. Nothing here is a model's to read (the Tester's Read
// guard denies `auth/`) and no function returns a state file's content.
//
// Pausing and skipping are facts of `dispatch.json` (`paused`, `retried`, `skipped`, `stale`), kept as
// plain arrays so a Run survives between calls; the functions here change a state object in place and
// leave the saving to the caller.
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { casePreconditions, stepActor } from "./case-fields.mjs";
import { parse } from "./knowledge-file.mjs";

/** @import { ExecuteDispatchState, ExecuteExecution, ExecuteSession } from "./execute.mjs" */
/** @import { ExecutionGuard, ExecutionGuardStop, ExecutionLogEntry } from "./execution-guard.mjs" */
/** @import { CaseFieldEntry } from "./case-fields.mjs" */

/**
 * Result of skipping an Access note across queued units.
 * @typedef {{
 *   blocked: string[],
 *   omitted: string[],
 * }} ApplySkipsResult
 */

export const AUTH_DIR = "auth";

/**
 * @param {string} runDir
 * @param {string} acc
 * @returns {string}
 */
export const authFile = (runDir, acc) => join(runDir, AUTH_DIR, `${acc}.json`);

// Moves a CLI login's freshly saved state `from` into the Run's auth/ dir under the note's key and
// returns its path. The file is restricted before it is moved.
/**
 * @param {string} runDir
 * @param {string} acc
 * @param {string} from
 * @returns {string}
 */
export function keepAuth(runDir, acc, from) {
  mkdirSync(join(runDir, AUTH_DIR), { recursive: true, mode: 0o700 });
  chmodSync(join(runDir, AUTH_DIR), 0o700);
  chmodSync(from, 0o600);
  const kept = authFile(runDir, acc);
  renameSync(from, kept);
  return kept;
}

/**
 * @param {string} runDir
 * @param {string | null | undefined} acc
 * @returns {void}
 */
export const dropAuth = (runDir, acc) => rmSync(authFile(runDir, /** @type {string} */ (acc)), { force: true });

// The notes some Execution that has not started yet will open a session for (a skipped note, never):
// none once dispatch has stopped, since nothing more starts.
/**
 * @param {ExecuteDispatchState} state
 * @param {Map<string, ExecuteExecution>} byId
 * @returns {Set<string>}
 */
function neededNotes(state, byId) {
  if (state.stopped) return new Set();
  return new Set(/** @type {string[]} */ (state.units.filter((u) => u.status === "queued").flatMap((u) => (/** @type {ExecuteExecution} */ (byId.get(u.id))).sessions.map((s) => s.acc)).filter((acc) => acc && !state.skipped.includes(acc))));
}

// Deletes the kept login of every note no unstarted Execution needs.
/**
 * @param {string} runDir
 * @param {ExecuteDispatchState} state
 * @param {Map<string, ExecuteExecution>} byId
 * @returns {void}
 */
export function sweepAuth(runDir, state, byId) {
  const dir = join(runDir, AUTH_DIR);
  if (!existsSync(dir)) return;
  const needed = neededNotes(state, byId);
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".json") && !needed.has(file.slice(0, -".json".length))) rmSync(join(dir, file), { force: true });
  }
}

// The notes whose login the Execution just recorded may have ended: a Role's last call landed on the
// sign-in page (`at_login`), or the guard stopped it `no-access`, which the last logged call caused.
/**
 * @param {ExecutionGuard | null | undefined} guard
 * @returns {string[]}
 */
export function endedStale(guard) {
  if (!Array.isArray(guard?.sessions) || !Array.isArray(guard.log)) return [];
  const accOf = new Map(guard.sessions.map((s) => [s.role, s.acc]));
  const last = new Map(guard.log.map((e) => [e.role, e]));
  const stale = new Set([...last].filter(([, e]) => e.at_login).map(([role]) => accOf.get(role)));
  if (guard.stopped === "no-access" && guard.log.length) stale.add(accOf.get((/** @type {ExecutionLogEntry} */ (guard.log.at(-1))).role));
  return /** @type {string[]} */ ([...stale].filter(Boolean));
}

// Whether session `s` of Execution `ex` is only the `setup_role` helper: a setup session that no
// precondition of the case opens with `As <Role>, `. Such a session may be left out of a case; a case
// Role's, or a case setup Role's, may not.
/**
 * @param {ExecuteExecution} ex
 * @param {ExecuteSession} s
 * @returns {boolean}
 */
export function isHelper(ex, s) {
  if (!s.setup) return false;
  const entry = parse("case.md", `---\ntype: scenario\n---\n\n${ex.text}`).cases[0];
  return !(entry ? casePreconditions(/** @type {CaseFieldEntry} */ (entry)) : []).some((p) => stepActor(p, { precondition: true }) === s.role);
}

// Pauses `acc` after `refusal` (the open refusal's fact): its Executions stay queued and `next` stops
// starting them. `roles` are the Roles of the queued Executions that use it, `reason` the refusal's own words.
/**
 * @param {ExecuteDispatchState} state
 * @param {Map<string, ExecuteExecution>} byId
 * @param {string} acc
 * @param {{ error?: unknown, line?: unknown, code?: unknown, [key: string]: unknown }} refusal
 * @returns {void}
 */
export function pauseNote(state, byId, acc, refusal) {
  if (state.paused.some((p) => p.acc === acc)) return;
  const roles = [...new Set(state.units.filter((u) => u.status === "queued").flatMap((u) => (/** @type {ExecuteExecution} */ (byId.get(u.id))).sessions.filter((s) => s.acc === acc).map((s) => s.role)))].filter((r) => r !== "-");
  const reason = String(refusal.error ?? refusal.line ?? refusal.code).replace(/\s+/g, " ").trim().slice(0, 300);
  state.paused.push({ acc, ...(roles.length && { roles }), reason });
}

// Skips `acc` for the rest of the Run: lifts its pause and Blocks every queued Execution that has it as
// a case Role or case setup Role `no-access`; one that has it only as the `setup_role` helper is
// `omitted` (its helper session is left out when it opens). Returns `{blocked, omitted}`, Execution ids.
/**
 * @param {ExecuteDispatchState} state
 * @param {Map<string, ExecuteExecution>} byId
 * @param {string} acc
 * @returns {ApplySkipsResult}
 */
export function skipNote(state, byId, acc) {
  state.paused = state.paused.filter((p) => p.acc !== acc);
  if (!state.skipped.includes(acc)) state.skipped.push(acc);
  return applySkips(state, byId);
}

// Blocks the queued Executions that cannot go on without a skipped note. Idempotent.
/**
 * @param {ExecuteDispatchState} state
 * @param {Map<string, ExecuteExecution>} byId
 * @returns {ApplySkipsResult}
 */
export function applySkips(state, byId) {
  /** @type {string[]} */
  const blocked = [];
  /** @type {string[]} */
  const omitted = [];
  for (const unit of state.units.filter((u) => u.status === "queued")) {
    const ex = /** @type {ExecuteExecution} */ (byId.get(unit.id));
    const skipped = ex.sessions.filter((s) => state.skipped.includes(/** @type {string} */ (s.acc)));
    if (!skipped.length) continue;
    const caseSession = skipped.find((s) => !isHelper(ex, s));
    if (!caseSession) {
      omitted.push(unit.id);
      continue;
    }
    unit.status = "failed";
    unit.final = true;
    unit.blocked = { reason: "no-access", why: `The Access note ${caseSession.acc} could not log in and was skipped.` };
    blocked.push(unit.id);
  }
  return { blocked, omitted };
}
