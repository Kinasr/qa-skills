// @ts-check
// `execute open` and `execute close`: the lifecycle of one
// Execution's browser sessions, which the skill reaches through `execute next` and `record` and
// the tests through these actions directly.
//
//   open --dir <run-dir> --execution <id> [--root <qa-dir>]
//       Opens one session per Role of the Execution, named `<run-id>-<exec-id>-<role-slug>`, from
//       `<run>/executions/<id>/` (every `playwright-cli` call of the Execution runs there). Each
//       session name is registered in `guard.json` before its browser opens, so a Run that dies half
//       way can still close all of them. A session logs in (a CLI login, ADR-0019, whose state the Run
//       keeps under `auth/` for the Executions after this one, ADR-0036) or loads the engineer's saved
//       state, or, for a role-less case with no covering note, stays unauthenticated; it then goes to
//       the target origin, which is checked as after any command. A session with a login that lands on
//       the note's sign-in page or a password field is stale: a kept CLI login is deleted and made
//       again once; a saved state, or a login that is no better when fresh, refuses `login_failed`,
//       which `execute next` turns into a paused note. A target that cannot be reached, a CLI login's
//       first page included, is `unreachable`, never `login_failed`. Nothing here counts toward the
//       action cap. Fills `guard.uploads` with the fixtures the Tester may attach. A failure closes
//       what was opened and removes the guard. A note `execute resume --skip` skipped is left out of
//       an Execution that only used it as the `setup_role` helper.
//
//       Before anything opens, the call rechecks the running host (lib/host-admission.mjs) against the
//       supported Claude Code floor: one it cannot verify refuses `host_unverified`, having made no
//       login or browser call and changed nothing.
//
//   close --dir <run-dir> --execution <id>
//       Closes that Execution's sessions, login ones included, one `close` each, never `close-all`.
//
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accessNoteNamed } from "./access.mjs";
import { cliLoginUser } from "./access-note.mjs";
import { UsageError, noArguments, orThrow, requireOption } from "./cli.mjs";
import { authFile, dropAuth, isHelper, keepAuth } from "./execute-auth.mjs";
import { executeTraining, fixtureExists } from "./execute-training.mjs";
import { GUARD_FILE, executionDir, loginUrlOf, namedSessions, observe, passwordShown, playwright, readGuard, verdict, writeGuard } from "./execution-guard.mjs";
import { MIN_PLAYWRIGHT_CLI, UPGRADE_PLAYWRIGHT_CLI, playwrightCliVersion } from "./playwright-version.mjs";
import { refusalsFor } from "./refusal.mjs";
import { admitHost } from "./host-admission.mjs";
import { EXECUTE_TRAIN_KEY } from "./schema.mjs";
import { loginFor } from "./scout.mjs";
import { trainFile } from "./training.mjs";
import { openRunDir, readRunFile } from "./run-dir.mjs";

/**
 * @import { ExecutePlan, ExecuteExecution, ExecuteDispatchState } from "./execute.mjs"
 * @import { ExecutionGuard, ExecutionGuardStop, ExecutionSession, PageClassification } from "./execution-guard.mjs"
 * @import { RefusalResult } from "./refusal.mjs"
 * @import { CommandResult, OptionSpec } from "./cli.mjs"
 * @import { RunFileResult } from "./run-dir.mjs"
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
 * Shape of an Access note read by execution commands.
 * @typedef {{
 *   key: string,
 *   withheld?: boolean,
 *   match?: string[],
 *   via?: string,
 *   role?: string,
 *   identifiers?: Record<string, string>,
 *   login_url?: string,
 * }} AccessNote
 */

/**
 * Shape of an upload entry in execute training.
 * @typedef {{
 *   kind: string,
 *   key: string,
 *   features?: string[],
 *   file?: string,
 *   format?: string,
 *   bytes?: number,
 *   content?: string,
 * }} ExecuteTrainingUploadEntry
 */

/**
 * Result of scout loginFor.
 * @typedef {{
 *   refusal?: RefusalResult,
 *   reach: (dir: string, session: string) => { refusal?: RefusalResult, unreachable?: boolean, state: string },
 *   record: { login?: string, user?: unknown },
 * }} ScoutLoginResult
 */

const { stop } = refusalsFor({
  not_confirmed: "The Run is not confirmed; confirm the plan before opening an Execution.",
  unknown_execution: "The Run holds no Execution with that id.",
  execution_blocked: "The Execution was Blocked before dispatch and has no sessions to open.",
  already_open: "The Execution already has a guard; reset its dir before opening it again.",
  no_playwright_cli: "`/qa-execute` drives the app through `playwright-cli`, which is not on the PATH; install it first.",
  old_playwright_cli: "`/qa-execute` needs a newer `playwright-cli`; upgrade it first.",
  note_withheld: "The Access note holds what looks like a credential; fix `train/access.md` with `/qa-train access`.",
  note_missing: "The Access note is gone from `train/access.md`; add it back with `/qa-train access`.",
  unreachable: "The target could not be reached; check the app is up, then open the Execution again.",
});

// Whether `plan` (a parsed `execute.json`) is the shape `execute plan` writes: the one answer every
// action that reads the plan gives.
/**
 * @param {CandidatePlan} plan
 * @returns {plan is ExecutePlan}
 */
export function isPlan(plan) {
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
export const readPlanFile = (runDir, missing) => readRunFile(runDir, "execute.json", { by: "execute plan", restart: "execute plan", missing });

// The Run's plan: `{pinned, runDir}`; a usage error when there is no run dir or plan, or it is not one.
/**
 * @param {string | undefined} dir
 * @param {string} action
 * @returns {{ pinned: ExecutePlan, runDir: string }}
 */
export function plannedRun(dir, action) {
  const opened = orThrow(openRunDir(dir, { cmd: "execute", action, from: "execute plan" }));
  const read = /** @type {{ error?: string, value?: ExecutePlan }} */ (readPlanFile(opened.dir, `no plan in ${opened.dir}: run \`execute plan\` first`));
  if (read.error) throw new UsageError(read.error);
  if (!isPlan(/** @type {CandidatePlan} */ (read.value))) throw new UsageError(`${join(opened.dir, "execute.json")} is not the plan \`execute plan\` wrote: start a new run with \`execute plan\``);
  return { pinned: read.value, runDir: opened.dir };
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

// Small synthetic files for the formats a `upl_` recipe names: the format's magic bytes, padded to `bytes`.
/** @type {Record<string, Buffer>} */
const MAGIC = { png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pdf: Buffer.from("%PDF-1.4\n"), csv: Buffer.from("a,b\n1,2\n"), txt: Buffer.from("qa fixture\n"), json: Buffer.from('{"qa": "fixture"}') };
const DEFAULT_BYTES = 256;
/**
 * @param {{ format: string, bytes?: number, content?: string }} param0
 * @returns {Buffer}
 */
function synthetic({ format, bytes, content }) {
  if (typeof content === "string") return Buffer.from(content);
  const size = bytes ?? DEFAULT_BYTES;
  const filler = ["png", "jpg", "pdf"].includes(format) ? 0 : 0x20;
  return Buffer.concat([MAGIC[format], Buffer.alloc(Math.max(0, size - MAGIC[format].length), filler)]).subarray(0, size);
}

// `{<name>: <real path>}`: the fixtures `upload <name>` may attach to this Execution. Generated ones
// (`format`, `bytes`, `content` of a `upl_` recipe) are written to the Execution's `uploads/` as
// `<name>.<format>`; committed ones (`file`) stay under `.qa/fixtures/`, kept to what resolves inside it.
/**
 * @param {string} root
 * @param {string} feature
 * @param {string} execDir
 * @returns {Record<string, string>}
 */
function fixtures(root, feature, execDir) {
  /** @type {Record<string, string>} */
  const uploads = {};
  for (const entry of executeTraining(trainFile(root, EXECUTE_TRAIN_KEY)).entries.filter((/** @type {ExecuteTrainingUploadEntry} */ e) => e.kind === "upl")) {
    if (Array.isArray(entry.features) && !entry.features.includes(feature)) continue;
    if (typeof entry.file === "string") {
      if (fixtureExists(root, entry.file)) uploads[entry.file] = realpathSync(join(root, "fixtures", entry.file));
    } else if (Object.hasOwn(MAGIC, entry.format)) {
      const name = `${entry.key.slice("upl_".length)}.${entry.format}`;
      mkdirSync(join(execDir, "uploads"), { recursive: true });
      const path = join(realpathSync(join(execDir, "uploads")), name);
      writeFileSync(path, synthetic(entry));
      uploads[name] = path;
    }
  }
  return uploads;
}

// How session `s` gets its login state: `{state}`, a path `state-load` takes, with `reused` when a CLI
// login of the Run was kept for the note, `fresh` when one was just made (it is kept now, for the Executions
// after this one), `saved` for the engineer's own file; `{refusal}` when the login fails, with `unreachable`
// when the app could not be reached at all; `{state: null}` for an unauthenticated session.
/**
 * @param {ExecutionSession} s
 * @param {{ root: string, runDir: string, origin: string, execDir: string, notes: Map<string | null, AccessNote> }} param1
 * @returns {{ state: string | null, reused?: boolean, fresh?: boolean, saved?: boolean, refusal?: undefined, unreachable?: undefined } | { state?: undefined, reused?: undefined, fresh?: undefined, saved?: undefined, refusal: RefusalResult, unreachable?: boolean }}
 */
function loginStateFor(s, { root, runDir, origin, execDir, notes }) {
  if (s.acc === null) return { state: null };
  const note = notes.get(s.acc);
  const kept = authFile(runDir, s.acc);
  if (cliLoginUser(note) && existsSync(kept)) return { state: kept, reused: true };
  const login = /** @type {ScoutLoginResult} */ (loginFor(root, /** @type {import("./scout.mjs").ScoutAccessNote} */ (note), `${origin}/`));
  if (login.refusal) return { refusal: login.refusal };
  const reached = login.reach(execDir, s.name);
  if (reached.refusal) return { refusal: reached.refusal, ...(reached.unreachable && { unreachable: true }) };
  return login.record.login === "cli" ? { state: keepAuth(runDir, s.acc, reached.state), fresh: true } : { state: reached.state, saved: true };
}

// The refusal a login refusal of the scout's words (`{ok, reason, error, …}`) becomes here.
/**
 * @param {RefusalResult} scout
 * @param {string | null} access
 * @returns {RefusalResult}
 */
function asRefusal(scout, access) {
  const { ok, reason, error, ...extra } = scout.json;
  return stop(/** @type {string} */ (reason), { access, error, ...extra });
}

// Opens session `s`, logs it in and lands it on the target: `{seen, url}` (what `verdict` made of the
// landing page), or `{refusal}`. A session with a login that lands on a sign-in page or a password
// field has a stale state (observed, never timed): a kept CLI login is deleted and made again, once; a
// saved state, or a login just made, that is no better cannot get in and refuses `login_failed`.
/**
 * @param {ExecutionSession} s
 * @param {{ root: string, runDir: string, origin: string, execDir: string, notes: Map<string | null, AccessNote>, env: Record<string, string | undefined>, attempted: string[] }} c
 * @returns {{ seen: PageClassification, url?: string, refusal?: undefined } | { seen?: undefined, url?: undefined, refusal: RefusalResult }}
 */
function openAndLand(s, c) {
  const { origin, execDir, env, attempted, runDir } = c;
  for (;;) {
    const reached = loginStateFor(s, c);
    if (reached.unreachable) return { refusal: stop("unreachable", { origin, error: reached.refusal.json.error }) };
    if (reached.refusal) return { refusal: asRefusal(reached.refusal, s.acc) };
    if (!attempted.includes(s.name)) attempted.push(s.name);
    const opened = playwright(execDir, s.name, ["open"], env);
    if (opened.missing) return { refusal: stop("no_playwright_cli", { upgrade: UPGRADE_PLAYWRIGHT_CLI }) };
    if (opened.error) return { refusal: stop("unreachable", { origin, error: opened.error }) };
    if (reached.state) {
      const loaded = playwright(execDir, s.name, ["state-load", reached.state], env);
      if (loaded.error) {
        if (!reached.saved) dropAuth(runDir, s.acc);
        return { refusal: stop("login_failed", { access: s.acc, error: `could not load the login state: ${loaded.error}` }) };
      }
    }
    const landed = playwright(execDir, s.name, ["goto", `${origin}/`], env);
    if (landed.error) return { refusal: stop("unreachable", { origin, error: landed.error }) };
    const { url } = observe(execDir, s.name, /** @type {string} */ (landed.text), env);
    const seen = url === undefined ? /** @type {PageClassification} */ ({ kind: "off" }) : verdict({ cwd: execDir, session: s.name, origin, loginUrl: s.login_url, url, tabs: [], env });
    const stale = s.acc !== null && (seen.kind === "login" || seen.kind === "sso" || (seen.kind === "ok" && passwordShown(execDir, s.name, env)));
    if (!stale) return { seen, url };
    if (reached.reused) {
      dropAuth(runDir, s.acc);
      playwright(execDir, s.name, ["close"], env);
      continue;
    }
    if (reached.fresh) dropAuth(runDir, s.acc);
    return { refusal: stop("login_failed", { access: s.acc, error: reached.fresh ? "a fresh login still lands on the sign-in page: the password may be wrong, or the page asked for more" : "the saved login state lands on the sign-in page: log in again and save the state" }) };
  }
}

// The notes `execute resume --skip` skipped, from the Run's `dispatch.json` (none before a Run is confirmed).
/**
 * @param {string} runDir
 * @returns {string[]}
 */
function skippedNotes(runDir) {
  /** @type {RunFileResult<ExecuteDispatchState>} */
  const read = readRunFile(runDir, "dispatch.json", { by: "execute confirm", restart: "execute plan" });
  return Array.isArray(read.value?.skipped) ? read.value.skipped : [];
}

/**
 * What `open` and `close` read of the command context: the run directory, the Execution, the
 * environment, and for `open` the `.qa/` root. A caller inside a run builds it by hand.
 * @typedef {{ dir?: string, root?: string, execution?: string, env: Record<string, string | undefined> }} OpenContext
 */

/**
 * @param {string[]} args
 * @param {OpenContext} ctx
 * @returns {CommandResult}
 */
function openExecution(args, { dir, root, execution: id, env }) {
  noArguments("execute open", args, "--dir <run-dir> and --execution <id>");
  requireOption("execute open", id, "--execution <id>", "an id of the plan's Executions");
  const found = execution(dir, /** @type {string} */ (id), "open");
  if (found.refusal) return found.refusal;
  const { pinned, ex, runDir } = found;
  if (!pinned.confirmed) return stop("not_confirmed", { run: pinned.run });
  if (ex.blocked) return stop("execution_blocked", { execution: id, reason: ex.blocked.reason });
  const execDir = executionDir(runDir, /** @type {string} */ (id));
  if (readGuard(execDir)) return stop("already_open", { execution: id });
  const hostRefusal = admitHost({ env });
  if (hostRefusal) return hostRefusal;
  const cli = playwrightCliVersion(env);
  if (cli.status === "missing") return stop("no_playwright_cli", { upgrade: UPGRADE_PLAYWRIGHT_CLI });
  if (cli.status === "old") return stop("old_playwright_cli", { ...(cli.found && { found: cli.found }), ...(cli.failure && { failure: cli.failure }), minimum: MIN_PLAYWRIGHT_CLI, upgrade: UPGRADE_PLAYWRIGHT_CLI });

  const origin = pinned.target.origin;
  /** @type {Map<string | null, AccessNote>} */
  const notes = new Map();
  for (const key of ex.access) {
    const note = accessNoteNamed(/** @type {string} */ (root), key);
    if (!note) return stop("note_missing", { access: key });
    if (note.withheld) return stop("note_withheld", { access: key });
    notes.set(key, note);
  }
  const skipped = skippedNotes(runDir);
  const sessions = namedSessions(pinned.run, /** @type {string} */ (id), ex.sessions.filter((s) => !(skipped.includes(/** @type {string} */ (s.acc)) && isHelper(ex, s)))).map((s) => ({ ...s, login_url: loginUrlOf(notes.get(s.acc), origin) }));
  mkdirSync(join(runDir, ".playwright"), { recursive: true });
  mkdirSync(execDir, { recursive: true });
  /** @type {ExecutionGuard} */
  const guard = {
    id: /** @type {string} */ (id), run: pinned.run, origin, cap: ex.cap, used: 0, stopped: null, sessions, login_sessions: sessions.filter((s) => cliLoginUser(notes.get(s.acc))).map((s) => `${s.name}-login`),
    match: Object.fromEntries(sessions.map((s) => [s.role, s.acc === null ? [`url:${origin}/`] : (/** @type {NonNullable<ReturnType<typeof notes.get>>} */ (notes.get(s.acc)).match ?? []).filter((m) => typeof m === "string")])),
    uploads: fixtures(/** @type {string} */ (root), ex.feature, execDir), at_login: [], log: [],
  };
  writeGuard(execDir, guard);

  /** @type {string[]} */
  const attempted = [];
  /** @type {Array<{ role: string, name: string, page_url?: string, stopped?: string }>} */
  const landing = [];
  /** @param {RefusalResult} refusal */
  const fail = (refusal) => {
    for (const name of attempted) playwright(execDir, name, ["close"], env);
    rmSync(join(execDir, GUARD_FILE), { force: true });
    return refusal;
  };
  for (const s of sessions) {
    const entered = openAndLand(s, { root: /** @type {string} */ (root), runDir, origin, execDir, notes, env, attempted });
    if (entered.refusal) return fail(entered.refusal);
    const { seen, url } = entered;
    if (seen.kind === "off") guard.stopped ??= "off-target";
    landing.push({ role: s.role, name: s.name, page_url: seen.kind === "off" ? seen.origin : url, ...(seen.kind === "off" && { stopped: "off-target" }) });
  }
  writeGuard(execDir, guard);
  return { exit: 0, json: { action: "open", ok: true, execution: id, dir: execDir, cap: guard.cap, sessions: sessions.map(({ role, name, acc, setup }) => ({ role, name, acc, setup })), landing } };
}

/**
 * @param {string[]} args
 * @param {OpenContext} ctx
 * @returns {CommandResult}
 */
function closeExecution(args, { dir, execution: id, env }) {
  noArguments("execute close", args, "--dir <run-dir> and --execution <id>");
  requireOption("execute close", id, "--execution <id>", "an id of the plan's Executions");
  const found = execution(dir, /** @type {string} */ (id), "close");
  if (found.refusal) return found.refusal;
  const execDir = executionDir(found.runDir, /** @type {string} */ (id));
  const guard = readGuard(execDir);
  /** @type {string[]} */
  const closed = [];
  if (guard && !guard.closed) {
    for (const name of [...guard.sessions.map((s) => s.name), ...(guard.login_sessions ?? [])]) {
      if (!playwright(execDir, name, ["close"], env).missing) closed.push(name);
    }
    writeGuard(execDir, { ...guard, closed: true });
  }
  return { exit: 0, json: { action: "close", ok: true, execution: id, closed } };
}

/**
 * One of the actions the run's own steps call, and the command line takes: `run` reads an
 * {@link OpenContext}, which the command line's context holds.
 * @typedef {{ options: OptionSpec, usage: string, run(args: string[], ctx: OpenContext): CommandResult }} OpenAction
 */

/** @type {{ open: OpenAction, close: OpenAction }} */
export const openActions = {
  open: { options: { root: "qa-dir", dir: "value", execution: "value" }, usage: "--dir <run-dir> --execution <id> [--root <qa-dir>]", run: openExecution },
  close: { options: { dir: "value", execution: "value" }, usage: "--dir <run-dir> --execution <id>", run: closeExecution },
};
