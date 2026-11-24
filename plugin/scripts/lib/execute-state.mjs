// @ts-check
// All mutable state of a `/qa-execute` Run: `<run>/dispatch.json`. The plan (execute-plan.mjs) is
// frozen at confirm; this file is the one module that creates, reads and saves the state that moves
// under it. `execute confirm` creates it (`newRunState`), the scheduler loads and saves it
// (`loadState`, `saveState`), and every save goes through lib/run-dir.mjs's atomic writer, so
// no action reaches into the file itself.
//
// The state is lib/dispatch.mjs's policy state (`DispatchState<ExecuteUnit>`) plus the Run's own
// facts: the Access note `locks`, and the login lifecycle's `paused`, `retried` and `skipped` notes
// (lib/execute-auth.mjs).
import { join } from "node:path";
import { UsageError } from "./cli.mjs";
import { newDispatch } from "./dispatch.mjs";
import { readRunFile, writeJsonAtomic } from "./run-dir.mjs";

/**
 * @import { DispatchState } from "./dispatch.mjs"
 * @import { ExecuteBlocked } from "./execute-plan.mjs"
 * @import { RunFileResult } from "./run-dir.mjs"
 */

export const DISPATCH_FILE = "dispatch.json";

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
 * What ingest needs of a dispatched unit.
 * @typedef {{
 *   blocked?: ExecuteBlocked,
 *   spent?: boolean,
 *   returned?: boolean,
 *   reply?: string,
 * }} DispatchMark
 */

// The state `execute confirm` creates: the policy state over one queued unit per Execution not
// already Blocked, plus an empty lock and login-lifecycle record.
/**
 * @param {{ units: ExecuteUnit[], chain: string[], cap: number }} options
 * @returns {ExecuteDispatchState}
 */
export function newRunState({ units, chain, cap }) {
  return { ...newDispatch({ units, chain, cap }), locks: {}, paused: [], retried: [], skipped: [] };
}

// The Run's state as written, or null when the file is absent, not JSON, or not the shape this
// module writes. Read by the actions that may run before a confirm (nothing is there yet).
/**
 * @param {string} runDir
 * @returns {ExecuteDispatchState | null}
 */
export function readState(runDir) {
  /** @type {RunFileResult<ExecuteDispatchState>} */
  const read = readRunFile(runDir, DISPATCH_FILE, { by: "execute confirm", restart: "execute plan" });
  if (read.error || !Array.isArray(read.value?.units)) return null;
  return /** @type {ExecuteDispatchState} */ (read.value);
}

// The Run's state, with the login-lifecycle notes an older write may leave out; a usage error when
// there is none, naming the call that makes one.
/**
 * @param {string} runDir
 * @returns {ExecuteDispatchState}
 */
export function loadState(runDir) {
  /** @type {RunFileResult<ExecuteDispatchState>} */
  const read = readRunFile(runDir, DISPATCH_FILE, { by: "execute confirm", restart: "execute plan", missing: `no ${DISPATCH_FILE} in ${runDir}: run \`execute confirm\` first` });
  if (read.error) throw new UsageError(read.error);
  const state = /** @type {ExecuteDispatchState} */ (read.value);
  for (const field of ["paused", "retried", "skipped"]) (/** @type {Record<string, unknown>} */ (state))[field] ??= [];
  return state;
}

// Written whole through a rename, so a call that dies never leaves half a state behind.
/**
 * @param {string} runDir
 * @param {ExecuteDispatchState} state
 * @returns {void}
 */
export function saveState(runDir, state) {
  writeJsonAtomic(join(runDir, DISPATCH_FILE), state);
}

// What ingest needs of the Run's dispatch: `Map<execution id, {blocked?, spent?, returned?, reply?}>`. `blocked` is
// the `{reason, why}` a unit was Blocked with here (`unreachable`); `spent` marks an Execution whose
// retries ran out without it ever acting or reporting (not stopped by a tripped breaker), which is
// Blocked "no report" rather than not run; `returned` marks one whose last Tester was dispatched and
// came back, whatever its reply, so a missing report is Blocked rather than not run even with no
// guarded call (a failed guard hook looks like that); `reply` is the Tester's recorded text for a
// no-report Execution, alongside `spent` when its retries were spent. Empty when the Run never reached `dispatch.json`.
/**
 * @param {string} runDir
 * @returns {Map<string, DispatchMark>}
 */
export function dispatchMarks(runDir) {
  /** @type {Map<string, DispatchMark>} */
  const marks = new Map();
  const state = readState(runDir);
  if (!state) return marks;
  const { units, stopped } = state;
  for (const u of units) {
    if (u.blocked) marks.set(u.id, { blocked: u.blocked });
    else {
      /** @type {DispatchMark} */
      const mark = {};
      if (u.status === "failed" && !u.final && !stopped) mark.spent = true;
      if (u.status !== "queued" && u.status !== "in_flight" && u.attempts?.some((a) => a.settled !== undefined)) mark.returned = true;
      if (u.reply) mark.reply = u.reply;
      if (Object.keys(mark).length) marks.set(u.id, mark);
    }
  }
  return marks;
}

// Removes every reply a record kept in `dispatch.json`, so the raw text does not outlive the Run.
// Absent or unreadable state, or no unit holding a reply, writes nothing.
/**
 * @param {string} runDir
 * @returns {void}
 */
export function clearReplies(runDir) {
  const state = readState(runDir);
  if (!state) return;
  let cleared = false;
  for (const u of state.units) {
    if (u.reply !== undefined) {
      delete u.reply;
      cleared = true;
    }
  }
  if (cleared) saveState(runDir, state);
}
