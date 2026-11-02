// @ts-check
// `execute next` and `execute record`: the
// CLI schedules a whole Run, so the cap and the Access note locks hold whatever the skill does. The
// skill's loop is `next` -> spawn every returned Tester in the background, brief verbatim -> on each
// reply `record` -> `next` again, until `next` says `done`; then `ingest`.
//
//   next --dir <run-dir> [--root <qa-dir>]
//       Starts Executions in selection order, rolling (a slot freed by `record` is filled by the next
//       call), while fewer than `concurrency_cap` are in flight. A case Role's note is held exclusive,
//       a setup-only Role's note shared (shared holders may overlap, never an exclusive one); an
//       Execution whose notes are held is skipped, not a stop, and an unauthenticated one holds
//       nothing. Each Execution it starts is opened (`execute open`) and its brief is written to
//       `executions/<id>/brief.md`. When nothing is in flight and the only thing left is a retry
//       waiting out its cooldown, it sleeps until the cooldown ends. If opening one Execution finds
//       the target `unreachable`, the ones this call already opened in the batch are closed and
//       Blocked `unreachable` with it (ingest reads that from `dispatch.json`), and the rest of the
//       queue is tried again. An open refusal that names an Access note (`login_failed`, a missing
//       secret, a note edited away) pauses that note (ADR-0036): the batch is closed, its
//       Executions stay queued unstarted, and the rest of the queue is tried again without any that
//       need the note. A note the engineer already resumed that fails a second time is skipped
//       instead (see `resume`). Any other open refusal is `next`'s own: the batch is closed and left queued.
//
//       Before it schedules anything, the call rechecks the running host (lib/host-admission.mjs):
//       one it cannot verify at the supported Claude Code floor refuses `host_unverified`, leaving
//       the Run untouched. Cleanup and ingest never need the check.
//       Prints `{action: "next", ok, start: [{id, brief, model}], paused, done, in_flight}`: `brief`
//       is the file's path, `model` the Tester Tier's label (null for `inherit`: the skill omits it),
//       `paused` the notes that cannot log in, `[{acc, roles?, reason}]` (`roles` the Roles of the
//       queued Executions that use the note, left out when there are none; `reason` the refusal's own
//       words, no secret in them), `done` true when nothing is in flight and nothing more can start
//       (never while a paused note holds an Execution), and `in_flight` the Executions in flight
//       after this call, the ones just started included. `blocked` lists the Executions this call Blocked.
//       The skill's order: drain what is in flight, then ask the engineer once about every paused
//       note, `resume` each, then `next` again.
//
//   record --dir <run-dir> --execution <id> --status ok|failed|timeout|refused|quota
//       Settles the attempt `next` started for that Execution and closes its sessions. The status is
//       what the harness said about the Tester's reply; the report is what counts: a valid
//       `report.md` settles the attempt whatever the status was. Otherwise the attempt failed, and it
//       is retryable only while `guard.json` shows `used === 0` and no stop (no command reached the
//       app, so a re-run repeats nothing): the Execution is reset (`executions/<id>/` removed) and
//       requeued behind a cooldown. After any command ran the failure is final: it feeds the breaker
//       (lib/dispatch.mjs, with its Fallback) but is never requeued. Prints `{action: "record", ok,
//       execution, status, usable, settled, retry, problems?, announcements?, in_flight, done}`.
//
//   resume --dir <run-dir> --note <acc> [--skip]
//       The engineer's answer for a paused note. Without `--skip` ("done")
//       the pause is lifted for one retry: the next `next` opens the Executions that need it, re-reading
//       the Access notes from the working tree, and a second failure counts as a skip. With `--skip` every
//       queued Execution that has the note as a case Role (or case setup Role) is Blocked `no-access`
//       (`reached: 0`, the Why names the note) and one that has it only as the `setup_role` helper runs
//       with that session left out. Prints `{action: "resume", ok, note, skipped, blocked: [{id, reason}],
//       omitted: [id], paused}`, `paused` what is still paused. Refuses `not_paused` for any other note.
//
// A kept CLI login (`<run>/auth/<acc>.json`, lib/execute-auth.mjs) is deleted once no queued Execution
// needs its note, and before an Execution opens when the note's previous Execution ended at a sign-in
// page or stopped `no-access`, so it logs in once more.
//
// All mutable state is `<run>/dispatch.json`: lib/dispatch.mjs's state, plus `locks`
// (`{<acc>: {mode: "exclusive" | "shared", holders: [id]}}`), `paused`, `retried` (resumed notes),
// `skipped` and `stale` (notes to log in again). Cooldowns are real time;
// QA_SKILLS_DISPATCH_SCALE scales them, which only a test sets.
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError, noArguments, orThrow, requireOption } from "./cli.mjs";
import { activeDelegate, finished, inFlight, launch, nextReadyAt, POLICY, ready, settle } from "./dispatch.mjs";
import { applySkips, dropAuth, endedStale, isHelper, pauseNote, skipNote, sweepAuth } from "./execute-auth.mjs";
import { executionBrief } from "./execute-brief.mjs";
import { readAutomation } from "./execute-automation.mjs";
import { executionDecision } from "./execute-chain.mjs";
import { openActions, execution, plannedRun } from "./execute-open.mjs";
import { checkedReport } from "./execution-report.mjs";
import { executionDir, readGuard } from "./execution-guard.mjs";
import { refusalsFor } from "./refusal.mjs";
import { admitHost } from "./host-admission.mjs";
import { readRunFile } from "./run-dir.mjs";
import { subagentModel } from "./tiers.mjs";

/**
 * @import { CommandAction, CommandContext, CommandResult } from "./cli.mjs"
 * @import { RefusalResult } from "./refusal.mjs"
 * @import { RunFileResult } from "./run-dir.mjs"
 * @import { ExecuteBlocked, ExecuteDispatchState, ExecuteExecution, ExecuteLock, ExecutePausedNote, ExecutePlan, ExecuteSession, ExecuteUnit } from "./execute.mjs"
 * @import { DispatchedUnit, SettlementOutcome, UnitStatus } from "./dispatch.mjs"
 * @import { ExecutionGuard } from "./execution-guard.mjs"
 */

/**
 * What ingest needs of a dispatched unit.
 * @typedef {{
 *   blocked?: ExecuteBlocked,
 *   spent?: boolean,
 * }} DispatchMark
 */

/**
 * Result of executionBrief from unadopted execute-brief.mjs.
 * @typedef {{
 *   refusal?: CommandResult,
 *   text?: string,
 * }} ExecutionBriefResult
 */

/**
 * Result of applySkips or skipNote from unadopted execute-auth.mjs.
 * @typedef {{
 *   blocked: string[],
 *   omitted: string[],
 * }} ApplySkipsResult
 */

/**
 * Result of checkedReport from unadopted execution-report.mjs.
 * @typedef {{
 *   missing: true,
 *   ok?: never,
 *   problems?: never,
 *   report?: never,
 * } | {
 *   missing?: never,
 *   ok: false,
 *   problems: Array<{ line?: number, message: string }>,
 *   report?: never,
 * } | {
 *   missing?: never,
 *   ok: true,
 *   problems?: never,
 *   report: Record<string, unknown>,
 * }} CheckedReportResult
 */

const { stop } = refusalsFor({
  not_confirmed: "The Run is not confirmed; confirm the plan before starting Executions.",
  not_in_flight: "The Execution is not in flight; record each attempt `execute next` started, once.",
  not_paused: "That Access note is not paused; resume only a note `execute next` listed under `paused`.",
});

const STATE = "dispatch.json";
const STATUSES = ["ok", "failed", "timeout", "refused", "quota"];

/**
 * @param {string} runDir
 * @returns {ExecuteDispatchState}
 */
function load(runDir) {
  /** @type {RunFileResult<ExecuteDispatchState>} */
  const read = readRunFile(runDir, STATE, { by: "execute confirm", restart: "execute plan", missing: `no ${STATE} in ${runDir}: run \`execute confirm\` first` });
  if (read.error) throw new UsageError(read.error);
  const state = /** @type {ExecuteDispatchState} */ (read.value);
  for (const field of ["paused", "retried", "skipped", "stale"]) (/** @type {Record<string, unknown>} */ (state))[field] ??= [];
  return state;
}

// Written whole through a rename, so a call that dies never leaves half a state behind.
/**
 * @param {string} runDir
 * @param {ExecuteDispatchState} state
 * @returns {void}
 */
function save(runDir, state) {
  const tmp = join(runDir, `${STATE}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, join(runDir, STATE));
}

// What ingest needs of the Run's dispatch: `Map<execution id, {blocked?, spent?}>`. `blocked` is the
// `{reason, why}` a unit was Blocked with here (`unreachable`); `spent` marks an Execution whose
// retries ran out without it ever acting or reporting (not stopped by a tripped breaker), which is
// Blocked "no report" rather than not run. Empty when the Run never reached `dispatch.json`.
/**
 * @param {string} runDir
 * @returns {Map<string, DispatchMark>}
 */
export function dispatchMarks(runDir) {
  /** @type {Map<string, DispatchMark>} */
  const marks = new Map();
  if (!existsSync(join(runDir, STATE))) return marks;
  /** @type {RunFileResult<ExecuteDispatchState>} */
  const read = readRunFile(runDir, STATE, { by: "execute confirm", restart: "execute plan" });
  if (read.error || !Array.isArray(read.value?.units)) return marks;
  const { units, stopped } = /** @type {ExecuteDispatchState} */ (read.value);
  for (const u of units) {
    if (u.blocked) marks.set(u.id, { blocked: u.blocked });
    else if (u.status === "failed" && !u.final && !stopped) marks.set(u.id, { spent: true });
  }
  return marks;
}

// The Access notes an Execution holds and how: `Map<acc, "exclusive" | "shared">`. A case Role's note is
// exclusive; a setup-only Role's note is shared unless the case also acts as that note's Role. A helper
// session of a skipped note is never opened, so holds nothing.
/**
 * @param {ExecuteExecution} ex
 * @param {readonly string[]} skipped
 * @returns {Map<string, "exclusive" | "shared">}
 */
function needs(ex, skipped) {
  /** @type {Map<string, "exclusive" | "shared">} */
  const held = new Map();
  for (const s of ex.sessions) {
    if (s.acc === null || (skipped.includes(s.acc) && isHelper(ex, s))) continue;
    if (!s.setup) held.set(s.acc, "exclusive");
    else if (!held.has(s.acc)) held.set(s.acc, "shared");
  }
  return held;
}

/**
 * @param {Record<string, ExecuteLock>} locks
 * @param {Map<string, "exclusive" | "shared">} want
 * @returns {boolean}
 */
const available = (locks, want) => [...want].every(([acc, mode]) => !locks[acc] || (mode === "shared" && locks[acc].mode === "shared"));

/**
 * @param {Record<string, ExecuteLock>} locks
 * @param {string} id
 * @param {Map<string, "exclusive" | "shared">} want
 * @returns {void}
 */
function hold(locks, id, want) {
  for (const [acc, mode] of want) {
    locks[acc] ??= { mode, holders: [] };
    locks[acc].holders.push(id);
  }
}

/**
 * @param {Record<string, ExecuteLock>} locks
 * @param {string} id
 * @returns {void}
 */
function release(locks, id) {
  for (const [acc, held] of Object.entries(locks)) {
    held.holders = held.holders.filter((h) => h !== id);
    if (!held.holders.length) delete locks[acc];
  }
}

/**
 * @param {string} runDir
 * @param {string} id
 * @returns {void}
 */
const reset = (runDir, id) => rmSync(executionDir(runDir, id), { recursive: true, force: true });

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Opens each unit of `batch` in order and writes its brief; stops at the first refusal. Returns
// `{opened}` or `{opened, refusal}`, `opened` the units that are now open.
/**
 * @param {Array<DispatchedUnit<ExecuteUnit>>} batch
 * @param {{ runDir: string, root?: string, env: Record<string, string | undefined> }} context
 * @returns {{ opened: Array<DispatchedUnit<ExecuteUnit>>, refusal?: CommandResult }}
 */
function openBatch(batch, { runDir, root, env }) {
  /** @type {Array<DispatchedUnit<ExecuteUnit>>} */
  const opened = [];
  for (const unit of batch) {
    if (unit.attempts.length) reset(runDir, unit.id);
    const result = /** @type {CommandResult} */ (openActions.open.run([], { dir: runDir, root, execution: unit.id, env }));
    if (result.exit !== 0) return { opened, refusal: result };
    const brief = /** @type {ExecutionBriefResult} */ (executionBrief(runDir, unit.id, { root }));
    if (brief.refusal) return { opened, refusal: brief.refusal };
    writeFileSync(join(executionDir(runDir, unit.id), "brief.md"), /** @type {string} */ (brief.text));
    opened.push(unit);
  }
  return { opened };
}

/**
 * @param {Array<DispatchedUnit<ExecuteUnit>>} units
 * @param {{ runDir: string, env: Record<string, string | undefined> }} context
 * @returns {void}
 */
const closeAll = (units, { runDir, env }) => {
  for (const u of units) {
    openActions.close.run([], { dir: runDir, execution: u.id, env });
    reset(runDir, u.id);
  }
};

/**
 * @param {string[]} args
 * @param {CommandContext} context
 * @returns {Promise<CommandResult>}
 */
async function next(args, { dir, root, env }) {
  noArguments("execute next", args, "--dir <run-dir> and --root <qa-dir>");
  const { pinned, runDir } = plannedRun(dir, "next");
  if (!pinned.confirmed) return stop("not_confirmed", { run: pinned.run });
  const hostRefusal = admitHost({ env });
  if (hostRefusal) return hostRefusal;
  const state = load(runDir);
  const byId = new Map(pinned.executions.map((e) => [e.id, e]));
  // The Automation decides the Execution: a Passed, Flaky or Blocked case, a case marked
  // `execution_skipped` at plan time, and a case whose due Automation has no result all finish
  // without a Tester. Only a Failed aggregate (or a case with no Automation) starts one.
  const automation = new Map(readAutomation(runDir).map((entry) => [entry.id, entry]));
  for (const unit of state.units) {
    if (unit.status !== "queued") continue;
    const ex = byId.get(unit.id);
    if (ex && ((ex.execution_skipped?.length ?? 0) > 0 || !executionDecision(ex, automation).follow)) {
      unit.status = "done";
      unit.final = true;
    }
  }
  save(runDir, state);
  /** @type {Array<{ id: string, reason: string }>} */
  const blocked = [];

  for (;;) {
    const now = Date.now();
    for (const u of (/** @type {ApplySkipsResult} */ (applySkips(state, byId))).blocked) {
      blocked.push({ id: u, reason: "no-access" });
      reset(runDir, u);
    }
    const scratch = structuredClone(state.locks);
    /**
     * @param {DispatchedUnit<ExecuteUnit>} u
     * @returns {boolean}
     */
    const admit = (u) => {
      const ex = /** @type {ExecuteExecution} */ (byId.get(u.id));
      if (ex.sessions.some((s) => state.paused.some((p) => p.acc === s.acc))) return false;
      const want = needs(ex, state.skipped);
      if (!available(scratch, want)) return false;
      hold(scratch, u.id, want);
      return true;
    };
    const batch = ready(state, now, admit);
    if (!batch.length && !inFlight(state).length) {
      const at = nextReadyAt(state);
      if (at !== null && at > now) {
        await sleep(at - now);
        continue;
      }
    }

    for (const acc of new Set(batch.flatMap((u) => (/** @type {ExecuteExecution} */ (byId.get(u.id))).sessions.map((s) => s.acc)))) {
      if (state.stale.includes(/** @type {string} */ (acc))) dropAuth(runDir, acc);
    }
    state.stale = state.stale.filter((acc) => !batch.some((u) => (/** @type {ExecuteExecution} */ (byId.get(u.id))).sessions.some((s) => s.acc === acc)));
    const { opened, refusal } = openBatch(batch, { runDir, root, env });
    if (refusal) {
      closeAll(/** @type {Array<DispatchedUnit<ExecuteUnit>>} */ ([...opened, batch[opened.length]].filter(Boolean)), { runDir, env });
      const first = (/** @type {Array<{ access?: unknown, code?: unknown }> | undefined} */ (refusal.json.refusals))?.[0];
      if (typeof first?.access === "string" && first.code !== "unreachable") {
        if (state.retried.includes(first.access)) {
          for (const id of (/** @type {ApplySkipsResult} */ (skipNote(state, byId, first.access))).blocked) {
            blocked.push({ id, reason: "no-access" });
            reset(runDir, id);
          }
        } else pauseNote(state, byId, first.access, first);
        save(runDir, state);
        continue;
      }
      if (first?.code !== "unreachable") return refusal;
      const why = `The target ${pinned.target.origin} could not be reached.`;
      for (const u of /** @type {Array<DispatchedUnit<ExecuteUnit>>} */ ([...opened, batch[opened.length]])) {
        u.status = "failed";
        u.final = true;
        u.blocked = { reason: "unreachable", why };
        reset(runDir, u.id);
        blocked.push({ id: u.id, reason: "unreachable" });
      }
      save(runDir, state);
      continue;
    }

    const model = subagentModel(activeDelegate(state));
    const start = opened.map((unit) => {
      launch(state, unit, now);
      hold(state.locks, unit.id, needs(/** @type {ExecuteExecution} */ (byId.get(unit.id)), state.skipped));
      return { id: unit.id, brief: join(executionDir(runDir, unit.id), "brief.md"), model };
    });
    save(runDir, state);
    sweepAuth(runDir, state, byId);
    return { exit: 0, json: { action: "next", ok: true, start, paused: state.paused, done: finished(state), in_flight: inFlight(state).length, ...(blocked.length && { blocked }) } };
  }
}

/**
 * @param {string[]} args
 * @param {CommandContext} context
 * @returns {CommandResult}
 */
function recordAttempt(args, { dir, execution: id, status, env }) {
  noArguments("execute record", args, "--dir <run-dir>, --execution <id> and --status <status>");
  requireOption("execute record", id, "--execution <id>", "an id `execute next` started");
  if (status === undefined || !STATUSES.includes(/** @type {string} */ (status))) throw new UsageError(`execute record needs --status, one of ${STATUSES.join(", ")}`);
  const found = execution(dir, /** @type {string} */ (id), "record");
  if (found.refusal) return found.refusal;
  const { pinned, ex, runDir } = found;
  if (!pinned.confirmed) return stop("not_confirmed", { run: pinned.run });
  const state = load(runDir);
  const unit = state.units.find((u) => u.id === id);
  if (unit?.status !== "in_flight") return stop("not_in_flight", { execution: id });

  openActions.close.run([], { dir: runDir, execution: /** @type {string} */ (id), env });
  const execDir = executionDir(runDir, /** @type {string} */ (id));
  const guard = readGuard(execDir);
  const used = Number.isSafeInteger(guard?.used) && /** @type {ExecutionGuard} */ (guard).used > 0 ? /** @type {ExecutionGuard} */ (guard).used : 0;
  const stopped = guard?.stopped ?? null;
  for (const acc of /** @type {string[]} */ (endedStale(guard))) if (!state.stale.includes(acc)) state.stale.push(acc);
  const checked = /** @type {CheckedReportResult} */ (checkedReport(execDir, ex, { stopped, used }));
  const usable = checked.ok === true;
  const problems = checked.ok === false ? checked.problems : [];
  /** @type {SettlementOutcome} */
  const outcome = {
    status: /** @type {string} */ (status), error_kind: status === "ok" ? null : status === "failed" ? "other" : /** @type {string} */ (status), usable,
    ...(!usable && { retryable: used === 0 && !stopped }),
  };
  const scale = Number(env.QA_SKILLS_DISPATCH_SCALE);
  const announcements = settle(state, unit, outcome, Date.now(), POLICY.cooldown_ms * (Number.isFinite(scale) && scale > 0 ? scale : 1));
  release(state.locks, /** @type {string} */ (id));
  const retry = (/** @type {UnitStatus} */ (unit.status)) === "queued";
  if (retry) reset(runDir, /** @type {string} */ (id));
  save(runDir, state);
  sweepAuth(runDir, state, new Map(pinned.executions.map((e) => [e.id, e])));
  return {
    exit: 0,
    json: {
      action: "record", ok: true, execution: id, status, usable, settled: unit.status, retry,
      ...(problems.length && { problems: problems.map(({ line, message }) => ({ ...(line !== undefined && { line }), message })) }),
      ...(announcements.length && { announcements }),
      in_flight: inFlight(state).length, done: finished(state),
    },
  };
}

/**
 * @param {string[]} args
 * @param {CommandContext} context
 * @returns {CommandResult}
 */
function resumeNote(args, { dir, note: acc, skip }) {
  noArguments("execute resume", args, "--dir <run-dir>, --note <acc> and --skip");
  requireOption("execute resume", acc, "--note <acc>", "a note `execute next` listed under `paused`");
  const { pinned, runDir } = plannedRun(dir, "resume");
  if (!pinned.confirmed) return stop("not_confirmed", { run: pinned.run });
  const state = load(runDir);
  if (!state.paused.some((p) => p.acc === acc)) return stop("not_paused", { note: acc, paused: state.paused.map((p) => p.acc) });
  const byId = new Map(pinned.executions.map((e) => [e.id, e]));
  /** @type {string[]} */
  let blocked = [];
  /** @type {string[]} */
  let omitted = [];
  if (skip) {
    ({ blocked, omitted } = /** @type {ApplySkipsResult} */ (skipNote(state, byId, /** @type {string} */ (acc))));
    for (const id of blocked) reset(runDir, id);
  } else {
    state.paused = state.paused.filter((p) => p.acc !== acc);
    state.retried.push(/** @type {string} */ (acc));
    dropAuth(runDir, /** @type {string} */ (acc));
  }
  save(runDir, state);
  sweepAuth(runDir, state, byId);
  return { exit: 0, json: { action: "resume", ok: true, note: acc, skipped: skip === true, blocked: blocked.map((id) => ({ id, reason: "no-access" })), omitted, paused: state.paused } };
}

/** @type {Record<string, CommandAction>} */
export const runActions = {
  next: { options: { root: "qa-dir", dir: "value" }, usage: "--dir <run-dir> [--root <qa-dir>]", run: next },
  resume: { options: { dir: "value", note: "value", skip: "flag" }, usage: "--dir <run-dir> --note <acc> [--skip]", run: resumeNote },
  record: { options: { dir: "value", execution: "value", status: "value" }, usage: "--dir <run-dir> --execution <id> --status ok|failed|timeout|refused|quota", run: recordAttempt },
};
