// @ts-check
// `tester`: the Tester's one command (ADR-0035). With the plugin hook that admits nothing else, it is the security boundary of /qa-execute:
// the command grammar, the action cap and the origin checks all live here, never in the model.
//
//   do <execution-id> <role> <command> <arg>… --dir <run-dir>
//       Runs one allow-listed `playwright-cli` command (lib/tester-command.mjs) in the Role's session
//       of that Execution, from `<run>/executions/<id>/`. `<role>` is the Role (single-quoted when
//       multi-word), its slug, or `-`. The tail after `<role>` is the Tester's own: only a trailing
//       `--dir <run-dir>` and `--root <qa-dir>` are options, so `--dir` can still be typed text.
//       Before each call: `stopped` set -> refuse; `used >= cap` -> `stopped: "action-cap"` and refuse;
//       else `used` counts it, and a refusal (role, grammar, URL) counts too. After a command the page
//       is checked against the target origin (every tab after click, dblclick, press, dialog-* and a
//       submitting fill; deferred while a dialog is open) and a sign-in page is told apart (lib/
//       execution-guard.mjs `verdict`, else a password field when the session has no `login_url`). A
//       structured command or probe error makes the CLI probe the active page once more: if it cannot
//       be read (none, `about:blank`, a browser error page, a dead active tab) the sticky stop is
//       `connection-lost`; a positively seen off-origin or SSO tab still wins. Prints `{ok, command, text, used, cap, page_url, modal?,
//       at_login?, stopped?}`: `text` keeps the `### Result|Page|Snapshot|Modal state|Error` blocks of
//       playwright-cli, with typed text masked and credentials redacted; the trailer is the last fields. Every counted call is
//       logged in `guard.json` (`log`), the trace ingest reads. An admitted element action's entry
//       also carries `evidence` (its ARIA path in the snapshot the Tester was shown, the emitted
//       locator, and a DOM excerpt probed before the action, lib/element-evidence.mjs); `press` and
//       `upload` carry `target: "none"`. None of it is shown to the Tester. A refusal prints
//       `{ok: false, refusals, used, cap, stopped?}` and exits 1. Header-only sessions refuse
//       `header_only_session`; missing notes or invalid/missing credential sources also refuse `do`.
//
//   request <execution-id> <role> <METHOD> <url> [--query k=v]… [--header Name:value]… [--json <body>] [--auth absent|invalid|expired] --dir <run-dir>
//       Sends one HTTP request with the Role's Header credential and browser cookies when present;
//       a Credential variant sends no session cookies. Header-only sessions use fetch. For an API case
//       (lib/tester-request.mjs): the URL is resolved against the target origin, `--query` merged, and
//       its origin and the account's `match` checked before it is sent; `cookie`, `authorization`,
//       `proxy-authorization`, `host` and the configured credential header are refused. It shares `do`'s tail, Role lookup, cap
//       and log: a counted call, a refusal included. Prints `{ok, method, url, status, headers, body,
//       truncated?, response, auth_rejected?, used, cap, stopped?}`: `body` is the response trimmed and redacted, the
//       whole redacted body is in the file `response` names (`executions/<id>/responses/<n>.json`),
//       and `Set-Cookie` and the echo of the call are never returned. A transport failure prints
//       `{ok: false, method, url, error, used, cap}`, counted. The trace entry is `{n, role, cmd:
//       "request", args: [METHOD, <url without query>], status, http_status?, auth?, auth_rejected?}`, never a query,
//       header or body.
/**
 * @import { CommandAction, CommandContext, CommandDefinition, CommandResult } from "./cli.mjs"
 * @import { ExecutionEvidence, ExecutionGuard, ExecutionGuardStop, ExecutionLogEntry, ExecutionRoute, ExecutionSession, PageClassification, SessionObservation, SessionTab } from "./execution-guard.mjs"
 * @import { TesterAllowedCommand } from "./tester-command.mjs"
 */
import { readFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { accessNoteNamed } from "./access.mjs";
import { HEADER_CREDENTIAL_REFUSALS, readHeaderCredential, readExpiredHeaderCredential, headerCredentialValues, maskCredentialValue } from "./header-credential.mjs";
import { headerCredential } from "./access-note.mjs";
import { randomBytes } from "node:crypto";
import { retainCredentialValues } from "./used-credentials.mjs";
import { requestTransport } from "./request-transport.mjs";
import { UsageError } from "./cli.mjs";
import { redactCutBody, redactPageText, redactQueryParams, redactValue } from "./credentials.mjs";
import { cacheAfterCommand, elementEvidence, snapshotNodes } from "./element-evidence.mjs";
import { classify, elementExcerpt, executionDir, guardExempt, keptOutput, matchesNote, observe, pageGone, passwordShown, playwright, PROBE_TIMEOUT_MS, readGuard, tabsOf, unreadablePage, verdict, writeGuard } from "./execution-guard.mjs";
import { refusalsFor } from "./refusal.mjs";
/** @import { PlatformContext } from "./platform.mjs" */
import { isPasswordField, readPassword, scrubSnapshots, spellings } from "./typed-secret.mjs";
import { ELEMENT_COMMANDS, REF_LESS_COMMANDS, parseTesterCommand, routePattern } from "./tester-command.mjs";
import { CREDENTIAL_VARIANTS, METHODS, errorLine, inlineBody, parseTesterRequest, responseOf } from "./tester-request.mjs";

/**
 * Serialised response stored in `executions/<id>/responses/<n>.json`.
 * @typedef {{
 *   status: number,
 *   headers: unknown,
 *   body: unknown,
 * }} TesterResponseFile
 */

const REFUSALS = {
  ...HEADER_CREDENTIAL_REFUSALS,
  not_open: "The Execution has no open sessions; it is opened before its Tester starts.",
  closed: "The Execution's sessions are closed.",
  stopped: "The Execution is stopped; end your report, the stop decides the result.",
  action_cap: "The action cap is spent; the Execution is stopped. End your report.",
  unknown_role: "The Execution has no session for that Role; use a Role of the brief, its slug, or `-`.",
  header_only_session: "A header-only session supports tester request only.",
  header_note_missing: "The session's Access note or pinned root is unavailable; start a new Run.",
  unknown_command: "That is not a tester command.",
  bad_ref: "A <ref> comes from the snapshot and never starts with `-`.",
  bad_arguments: "The command's arguments do not fit its grammar.",
  bad_expect: "`--expect=` needs non-empty text.",
  bad_url: "`goto` and `request` take an http or https URL.",
  bad_method: "`request` takes one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.",
  bad_header: "`--header` takes Name:value, once per name.",
  forbidden_header: "The session supplies `cookie`, `authorization`, `proxy-authorization` and `host`; a request never sets them.",
  bad_json: "`--json` takes one JSON object or array.",
  bad_upload: "`upload` takes the bare name of a fixture the brief lists.",
  off_target_url: "`goto` and `request` stay on the target origin.",
  outside_match: "`goto` and `request` stay inside what this Role's account covers.",
  no_playwright_cli: "`playwright-cli` is not on the PATH.",
  refused_playwright_cli: "`playwright-cli` was refused by Windows executable policy.",
  no_password_source: "`fill-password` needs a Role whose Access note has a password source; this Role's note has none.",
  password_unavailable: "The Role's password source could not be read.",
  password_off_target: "`fill-password` works only on a page of the target origin.",
  not_password_field: "`fill-password` types only into an input of type password.",
};
const { refuse } = refusalsFor(REFUSALS);

const ID = /^[A-Za-z0-9_-]+$/;
const OPTIONS = ["dir", "root"];
const MAX_ARGS = 8;
const MAX_ARG = 200;
const EXPECT_POLL_PAUSE_MS = 200;
/** How long `tester do` polls for an `--expect=<text>` message after an action. */
export const EXPECT_WAIT_MS = 5000;

/**
 * Tests may pass a smaller positive integer via `QA_TESTER_EXPECT_WAIT_MS` to keep not-seen cases cheap.
 * @param {NodeJS.ProcessEnv | undefined} env
 * @param {PlatformContext | undefined} platformContext
 * @returns {number}
 */
function expectWaitBound(env, platformContext) {
  const raw = (platformContext?.env ?? env ?? process.env)?.QA_TESTER_EXPECT_WAIT_MS;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return EXPECT_WAIT_MS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed < EXPECT_WAIT_MS ? parsed : EXPECT_WAIT_MS;
}

/**
 * Poll `playwright-cli find -- <expected>` synchronously until a match is reported or the bound passes.
 * `undefined` when no poll got an answer, so a dead session never reads as "not seen".
 * @param {string} execDir
 * @param {string} sessionName
 * @param {string} expected
 * @param {NodeJS.ProcessEnv | undefined} env
 * @param {PlatformContext | undefined} platformContext
 * @returns {boolean | undefined}
 */
function waitForExpect(execDir, sessionName, expected, env, platformContext) {
  const boundMs = expectWaitBound(env, platformContext);
  const pauseMs = Math.min(EXPECT_POLL_PAUSE_MS, boundMs);
  const deadline = Date.now() + boundMs;
  const lock = new Int32Array(new SharedArrayBuffer(4));
  let answered = false;
  for (;;) {
    const asked = playwright(execDir, sessionName, ["find", "--", expected], env, PROBE_TIMEOUT_MS, platformContext);
    if (asked.missing || asked.refused) return undefined;
    const text = asked.error ? "" : asked.text.replace(/\r\n/g, "\n");
    if (text.includes("### Result\nFound ")) return true;
    if (text.includes("### Result\nNo matches found")) answered = true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return answered ? false : undefined;
    Atomics.wait(lock, 0, 0, Math.min(pauseMs, remaining));
  }
}

// `argv` without its trailing `--dir <v>` / `--root <v>` pairs, which are the only options.
/**
 * @param {readonly string[]} argv
 * @returns {{ positional: string[], options: Record<string, string> }}
 */
export function tailOptions(argv) {
  /** @type {Record<string, string>} */
  const options = {};
  let end = argv.length;
  while (end >= 2 && OPTIONS.includes(argv[end - 2].replace(/^--/, "")) && argv[end - 2].startsWith("--") && options[argv[end - 2].slice(2)] === undefined) {
    options[argv[end - 2].slice(2)] = argv[end - 1];
    end -= 2;
  }
  return { positional: argv.slice(0, end), options };
}

// The words as the trace keeps them: the text `fill` and `dialog-accept` type is `<typed>`, and a
// list or a word too long is cut.
/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {string} origin
 * @param {readonly string[]} [routeOrigins]
 * @returns {string[]}
 */
function loggedArgs(command, args, origin, routeOrigins = []) {
  if (command === "route" || command === "unroute") {
    const resolved = routePattern(args[0], origin, routeOrigins);
    const pattern = resolved.ok ? resolved.pattern.split(/[?#]/)[0] : resolved.url;
    return [...(pattern ? [pattern] : []), ...args.slice(1).filter(a => a.startsWith("--")).map(a => a.split(/[=\s]/)[0])];
  }
  if (command === "fill-password") return [args[0], "<typed>"];
  const masked = command === "fill" ? args.map((a, i) => (i === 1 ? "<typed>" : a)) : command === "dialog-accept" ? args.map(() => "<typed>") : args;
  return /** @type {string[]} */ (masked.slice(0, MAX_ARGS).map((a) => (typeof a === "string" && a.length > MAX_ARG ? `${a.slice(0, MAX_ARG)}…` : a)));
}

// The screenshot a `screenshot` call wrote, as the wrapper printed it: a markdown link or image to
// an image file. It is kept in the trace so `/qa-bug` can offer it later, and nothing else is.
/**
 * @param {string} text
 * @returns {string | undefined}
 */
function screenshotPath(text) {
  return /!?\[[^\]]*\]\(([^)\s]+\.(?:png|jpe?g|webp|gif))\)/i.exec(text)?.[1];
}

/**
 * @param {ExecutionGuard} guard
 * @param {string} role
 * @returns {ExecutionSession | undefined}
 */
const sessionFor = (guard, role) => guard.sessions.find((s) => s.role === role || s.slug === role);

/**
 * @param {ExecutionGuard} guard
 * @returns {{ used: number, cap: number, stopped?: ExecutionGuardStop }}
 */
const trailer = (guard) => ({ used: guard.used, cap: guard.cap, ...(guard.stopped && { stopped: guard.stopped }) });

/**
 * @param {ExecutionGuard} guard
 * @param {string} code
 * @param {Record<string, unknown>} [data]
 * @returns {{ exit: number, json: Record<string, unknown> }}
 */
const stop = (guard, code, data) => {
  const { exit, json } = refuse(code, data, 1);
  return { exit, json: { ...json, ...trailer(guard) } };
};

/** @type {Record<ExecutionGuardStop, string>} */
const WHY = {
  "action-cap": "The action budget is spent",
  "off-target": "The browser left the target origin",
  "no-access": "The app sent the browser to a sign-in page on another origin",
  "connection-lost": "The browser or the app was lost",
};

/**
 * What a page check found: the classification used for the stop, whether the active page is gone,
 * and the URL the output may keep.
 * @typedef {{
 *   check: PageClassification,
 *   lost: boolean,
 *   currentUrl: string | undefined,
 * }} PageCheck
 */

/**
 * The page check after a command: positive off-origin/SSO evidence first, then a fresh probe when a
 * structured command or probe error was seen, then the ordinary fail-closed path. A defined URL with
 * no candidate error is always classified, `about:blank` included; only no URL at all fails closed.
 * @param {{
 *   execDir: string,
 *   session: ExecutionSession,
 *   origin: string,
 *   loginUrl: string | null,
 *   seen: SessionObservation,
 *   tabs: readonly SessionTab[],
 *   errorSeen: boolean,
 *   env: NodeJS.ProcessEnv | undefined,
 * }} options
 * @returns {PageCheck}
 */
function pageCheck({ execDir, session, origin, loginUrl, seen, tabs, errorSeen, env }) {
  /**
   * @param {string | undefined} url
   * @param {readonly SessionTab[]} listed
   * @returns {PageClassification}
   */
  const judge = (url, listed) => verdict({ cwd: execDir, session: session.name, origin, loginUrl, url, tabs: listed, env });
  const tabOffOrSso = tabs.some((t) => ["off", "sso"].includes(classify(t.url, origin, loginUrl).kind));
  const urlOffOrSso = seen.url !== undefined && !unreadablePage(seen.url) && ["off", "sso"].includes(classify(seen.url, origin, loginUrl).kind);
  if (tabOffOrSso) return { check: judge(seen.url, tabs), lost: false, currentUrl: seen.url };
  if (urlOffOrSso) return { check: judge(seen.url, []), lost: false, currentUrl: seen.url };
  if (errorSeen) {
    const probe = observe(execDir, session.name, "", env);
    if (pageGone(probe)) return { check: { kind: "ok" }, lost: true, currentUrl: seen.url };
    return { check: judge(probe.url, tabs), lost: false, currentUrl: probe.url };
  }
  if (tabs.length) return { check: judge(seen.url, tabs), lost: false, currentUrl: seen.url };
  // With no candidate error a defined URL is classified as before: `about:blank` is neutral.
  if (seen.url !== undefined) return { check: judge(seen.url, []), lost: false, currentUrl: seen.url };
  return { check: { kind: "off" }, lost: false, currentUrl: undefined };
}

/**
 * @typedef {{
 *   execDir: string,
 *   guard: ExecutionGuard,
 *   n: number,
 *   session: ExecutionSession | undefined,
 *   role: string,
 *   words: string[],
 *   entry: (cmd: string, logged: readonly string[]) => { n: number, role: string, cmd: string, args: readonly string[] },
 *   refused: (code: string, data?: Record<string, unknown>, logged?: { n: number, role: string, cmd: string, args: readonly string[] }) => { exit: number, json: Record<string, unknown> },
 *   done?: never,
 * } | {
 *   done: { exit: number, json: Record<string, unknown> },
 *   execDir?: never,
 *   guard?: never,
 *   n?: never,
 *   session?: never,
 *   role?: never,
 *   words?: never,
 *   entry?: never,
 *   refused?: never,
 * }} AdmittedResult
 */

// What `do` and `request` share before they run anything: the Execution's open guard, the call
// counted (a stop or the cap refuses first) and its Role's session. `{done}` is the refusal to print,
// else `{execDir, guard, n, session, role, entry(cmd, args), refused(code, data, entry)}`.
/**
 * @param {string} tool
 * @param {string} usage
 * @param {readonly string[]} args
 * @param {{ dir?: string, [key: string]: unknown }} ctx
 * @returns {AdmittedResult}
 */
function admit(tool, usage, args, { dir }) {
  const [id, role, ...words] = args;
  if (id === undefined || role === undefined) throw new UsageError(`tester ${tool} takes <execution-id> <role> ${usage} --dir <run-dir>`);
  if (dir === undefined) throw new UsageError(`tester ${tool} needs --dir <run-dir> after the command, the run dir of the brief`);
  if (!ID.test(id)) throw new UsageError(`\`${id}\` is not an Execution id`);
  const execDir = executionDir(resolve(dir), id);
  const guard = /** @type {ExecutionGuard | null} */ (readGuard(execDir));
  if (!guard) return { done: refuse("not_open", { execution: id }, 1) };
  if (guard.closed) return { done: refuse("closed", { execution: id }, 1) };
  if (guard.stopped) return { done: stop(guard, "stopped", { stopped: guard.stopped }) };
  if (guard.used >= guard.cap) {
    guard.stopped = "action-cap";
    writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));
    return { done: stop(guard, "action_cap") };
  }
  guard.used += 1;
  const n = guard.used;
  const session = sessionFor(guard, role);
  /**
   * @param {string} cmd
   * @param {readonly string[]} logged
   * @returns {{ n: number, role: string, cmd: string, args: readonly string[] }}
   */
  const entry = (cmd, logged) => ({ n, role: session?.role ?? role, cmd, args: logged });
  /**
   * @param {string} code
   * @param {Record<string, unknown>} [data]
   * @param {{ n: number, role: string, cmd: string, args: readonly string[] }} [logged]
   * @returns {{ exit: number, json: Record<string, unknown> }}
   */
  const refused = (code, data, logged) => {
    guard.log.push({ ...(/** @type {ExecutionLogEntry} */ (logged)), status: "refused", code });
    writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));
    return stop(guard, code, data);
  };
  return { execDir, guard, n, session, role, words, entry, refused };
}

/**
 * Resolve and retain masking literals before grammar or transport refusals can return.
 * @param {string} execDir
 * @param {ExecutionSession | undefined} session
 * @param {readonly ExecutionSession[]} sessions
 * @param {boolean} [typedSecret] whether `fill-password` was used in this Execution
 * @returns {{ pinned: import("./execute.mjs").ExecutePlan, note: import("./access.mjs").ShownAccessNote | null, header: import("./header-credential.mjs").HeaderResolution, expired: import("./header-credential.mjs").HeaderResolution, values: string[], refusal?: import("./platform.mjs").PlatformRefusal }}
 */
function sessionCredentials(execDir, session, sessions, typedSecret = false) {
  const runDir = dirname(dirname(execDir));
  const pinned = /** @type {import("./execute.mjs").ExecutePlan} */ (JSON.parse(readFileSync(join(runDir, "execute.json"), "utf8")));
  const note = session?.acc && pinned.root ? accessNoteNamed(pinned.root, session.acc, { headerCredentials: true }) : null;
  if ((session?.header && !pinned.root) || (pinned.root && session?.acc && (!note || note.withheld))) {
    return { pinned, note, header: { refusal: { code: "header_note_missing", message: REFUSALS.header_note_missing } }, expired: { credential: null }, values: [] };
  }
  const header = session?.header && note?.header_via === undefined
    ? { refusal: { code: "header_credential_invalid", message: HEADER_CREDENTIAL_REFUSALS.header_credential_invalid } }
    : readHeaderCredential(pinned.root ?? "", note);
  const expired = readExpiredHeaderCredential(pinned.root ?? "", note);
  const values = [...headerCredentialValues(header.credential ?? null), ...headerCredentialValues(expired.credential ?? null)];
  // Other Roles can be echoed by this session too. Their resolution failures do not change
  // this session's admission, but every available literal must be masked and retained.
  for (const other of sessions) {
    if (other === session || !other.acc || !pinned.root) continue;
    const note = accessNoteNamed(pinned.root, other.acc, { headerCredentials: true });
    values.push(...headerCredentialValues(readHeaderCredential(pinned.root, note).credential ?? null), ...headerCredentialValues(readExpiredHeaderCredential(pinned.root, note).credential ?? null));
  }
  // Once `fill-password` typed a Role's password in this Execution, every Role's is scrubbed from here on.
  if (typedSecret && pinned.root) {
    for (const other of sessions) {
      if (!other.acc) continue;
      const typed = readPassword(pinned.root, accessNoteNamed(pinned.root, other.acc, { headerCredentials: true }));
      if (typed.password) values.push(...spellings(typed.password));
    }
  }
  const retained = retainCredentialValues(runDir, values);
  return { pinned, note, header, expired, values, ...(!retained.ok && { refusal: retained.refusal }) };
}

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function doCommand(args, ctx) {
  const { env } = ctx;
  const platformContext = /** @type {PlatformContext | undefined} */ (ctx.platformContext);
  const admitted = admit("do", "<command> [<arg>…]", args, ctx);
  if (admitted.done) return admitted.done;
  const { execDir, guard, n, session, role, words } = admitted;
  const { pinned, note, header, expired, values, refusal: retentionRefusal } = sessionCredentials(execDir, session, guard.sessions, guard.typed_secret === true);
  if (retentionRefusal) return admitted.refused(retentionRefusal.code, { error: retentionRefusal.message, ...(retentionRefusal.command && { command: retentionRefusal.command }) }, admitted.entry("do", []));
  if (header.refusal?.code === "header_note_missing") return admitted.refused("header_note_missing", {}, admitted.entry("do", []));
  // A Role with no note to log in from (`via: none`) or only a Header credential has no password source.
  if (words[0] === "fill-password" && session && (session.kind === "header-only" || session.acc === null)) {
    return admitted.refused("no_password_source", { access: session.acc, error: "this Role has no Access note with a password source" }, admitted.entry("fill-password", words.length > 1 ? [words[1], "<typed>"] : []));
  }
  if (session?.kind === "header-only") return admitted.refused("header_only_session", {}, admitted.entry("do", []));
  if (header.refusal) return admitted.refused(header.refusal.code, { error: header.refusal.message }, admitted.entry("do", []));
  if (expired.refusal) return admitted.refused(expired.refusal.code, { error: expired.refusal.message }, admitted.entry("do", []));
  const safe = /** @template T @param {T} value @returns {T} */ (value) => maskCredentialValue(value, values);
  const [command = "", ...rest] = words;
  // A `goto`'s word is a URL and a route's is a pattern, so the trace keeps each with its query
  // scrubbed as a page_url is; a refused route's pattern is already cut of its query.
  const traceWords = loggedArgs(command, safe(rest), guard.origin, guard.route_origins);
  const refusalEntry = safe(admitted.entry(command, command === "goto" || command === "route" || command === "unroute" ? traceWords.map(redactQueryParams) : traceWords));
  /**
   * @param {string} code
   * @param {Record<string, unknown>} [data]
   * @returns {{ exit: number, json: Record<string, unknown> }}
   */
  const refused = (code, data) => admitted.refused(code, safe(data), refusalEntry);

  if (!session) return refused("unknown_role", { role, roles: guard.sessions.map((s) => s.role) });
  // Without a named login URL (including a root login dropped by loginUrlOf), always protect
  // the root so a broad route cannot preempt later password-field classification. Also retain
  // that Role's observed sign-in URLs after it navigates away; refusal needs no new probe.
  const loginUrls = session.login_url ? [session.login_url] : [`${guard.origin}/`, ...guard.log.filter(e => e.role === session.role && e.at_login && e.page_url).map(e => /** @type {string} */ (e.page_url))];
  const parsed = parseTesterCommand(words, { origin: guard.origin, uploads: guard.uploads ?? {}, loginUrls, routeOrigins: guard.route_origins, signInUrls: guard.route_sign_in_urls });
  // A refused `goto` URL is logged as the parser cut it, else not at all: it may hold credentials.
  if (!parsed.ok && command === "goto" && parsed.code === "bad_url") return admitted.refused(parsed.code, safe({ error: parsed.error }), safe(admitted.entry(command, parsed.url ? [parsed.url] : [])));
  if (!parsed.ok) return refused(parsed.code, { error: parsed.error });
  if (parsed.href) {
    if (new URL(parsed.href).origin !== guard.origin) return refused("off_target_url", { origin: guard.origin });
    if (!matchesNote(guard.match[session.role] ?? [], parsed.href)) return refused("outside_match", { role: session.role });
  }
  // The account's match covers the Run's own origin; another configured target's origin is not
  // the account's, and a route answers there without sending the request.
  if (parsed.route?.pattern && !parsed.route.unroute && parsed.route.pattern.startsWith(`${guard.origin}/`)) {
    const prefix = parsed.route.pattern.split(/[*{\\]/)[0];
    if (!matchesNote(guard.match[session.role] ?? [], prefix)) return refused("route_outside_match", { role: session.role, error: "The route's literal prefix is outside this Role's account match" });
  }
  const entry = parsed.logged
    ? safe(admitted.entry(command, parsed.logged.map(redactQueryParams)))
    : parsed.expect !== undefined
      ? safe(admitted.entry(command, traceWords.slice(0, -1)))
      : refusalEntry;
  /** @type {ExecutionRoute | undefined} */
  const route = parsed.route && { ...parsed.route, ...(parsed.route.pattern && { pattern: redactQueryParams(parsed.route.pattern) }) };
  /** @type {string[] | undefined} */
  let fillArgs;
  if (parsed.secret) {
    const found = readPassword(pinned.root ?? "", note);
    if (found.none) return refused("no_password_source", { access: session.acc, error: `Access note ${session.acc ?? "(none)"} has no password source` });
    if (found.error !== undefined) return refused("password_unavailable", { access: session.acc, error: found.error });
    const onPage = observe(execDir, session.name, "", env, platformContext).url;
    if (onPage === undefined || unreadablePage(onPage) || new URL(onPage).origin !== guard.origin) return refused("password_off_target", { origin: guard.origin });
    if (!isPasswordField(execDir, session.name, parsed.argv[0], env, platformContext)) return refused("not_password_field", {});
    const typed = spellings(found.password);
    values.push(...typed);
    const retained = retainCredentialValues(dirname(dirname(execDir)), typed);
    if (!retained.ok) return refused(retained.refusal.code, { error: retained.refusal.message, ...(retained.refusal.command && { command: retained.refusal.command }) });
    guard.typed_secret = true;
    fillArgs = ["fill", parsed.argv[0], "--", found.password];
  }
  writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));

  // The excerpt is taken before the action, while the ref still points at the element; it is never
  // an action of its own and its output never reaches the Tester.
  const ref = ELEMENT_COMMANDS.has(/** @type {TesterAllowedCommand} */ (parsed.command)) ? parsed.argv[0] : undefined;
  const probe = ref === undefined ? null : elementExcerpt(execDir, session.name, ref, env);
  const ran = playwright(execDir, session.name, fillArgs ?? [parsed.command, ...parsed.argv], env, undefined, platformContext);
  if (ran.missing) return refused("no_playwright_cli");
  if (ran.refused) return refused("refused_playwright_cli", { check: ran.refusal.code, reason: ran.refusal.message });
  // The snapshot files the command wrote are scrubbed before anything reads them, the Tester included.
  if (guard.typed_secret) scrubSnapshots(execDir, values);
  const seen = observe(execDir, session.name, ran.text, env, platformContext);
  const wasModal = guard.modal === true;
  const tabsSeen = !seen.modal && (parsed.tabs || wasModal) ? tabsOf(execDir, session.name, env, platformContext) : { tabs: [] };
  // A structured command or probe error is only a candidate: the active page decides.
  const errorSeen = Boolean(ran.error || ran.stderr || seen.error || tabsSeen.error);
  let check = /** @type {PageClassification} */ ({ kind: "ok" });
  let lost = false;
  let currentUrl = seen.url;
  if (seen.modal) guard.modal = true;
  else {
    delete guard.modal;
    ({ check, lost, currentUrl } = pageCheck({ execDir, session, origin: guard.origin, loginUrl: session.login_url, seen, tabs: tabsSeen.tabs, errorSeen, env }));
    // With no `login_url` to tell it by, a same-origin sign-in page is the one with a password field.
    if (!lost && check.kind === "ok" && !session.login_url && passwordShown(execDir, session.name, env)) check = { kind: "login" };
  }
  // The probes above may have written snapshot files too.
  if (guard.typed_secret) scrubSnapshots(execDir, values);
  const stopped = /** @type {ExecutionGuardStop | null} */ (check.kind === "sso" ? "no-access" : check.kind === "off" ? "off-target" : lost ? "connection-lost" : null);
  if (stopped) guard.stopped = stopped;
  /** @type {{ text: string, seen: boolean } | undefined} */
  let expectResult;
  // An open dialog is the action's answer itself; `find` cannot read the page behind it.
  if (parsed.expect !== undefined && !ran.error && !stopped && !lost && !seen.modal) {
    const seenExpect = waitForExpect(execDir, session.name, parsed.expect, env, platformContext);
    if (guard.typed_secret) scrubSnapshots(execDir, values);
    if (seenExpect !== undefined) expectResult = { text: redactPageText(safe(parsed.expect), guardExempt(/** @type {ExecutionGuard} */ (guard))), seen: seenExpect };
  }
  const left = check.kind === "off" || check.kind === "sso";
  const atLogin = check.kind === "login";
  if (atLogin) guard.at_login.push(n);
  // A URL of the target keeps its query, credential-named parameters redacted; off the target only the origin is kept.
  const page_url = left ? check.origin : lost || currentUrl === undefined ? undefined : redactQueryParams(safe(currentUrl));
  /** @type {ExecutionEvidence | undefined} */
  const evidence = ref !== undefined
    ? elementEvidence({ nodes: safe(snapshotNodes(execDir, session.name)), ref, text: safe(ran.text), typed: parsed.typed, probe: safe(probe ?? { ok: false }) })
    : REF_LESS_COMMANDS.has(/** @type {TesterAllowedCommand} */ (parsed.command)) ? { target: "none" } : undefined;
  // The evidence above used the snapshot the Tester was shown; only now does this call's snapshot
  // replace it (or a navigation without one drop it). A cache that cannot be written costs the next
  // action's ARIA path, never this one's result.
  try {
    cacheAfterCommand({ execDir, session: session.name, command: parsed.command, text: safe(ran.text), url: safe(seen.url), tab: tabsSeen.tabs.find((t) => t.current)?.index });
  } catch {
    // The cache is best-effort.
  }
  const shot = parsed.command === "screenshot" && !ran.error && !lost ? screenshotPath(ran.text) : undefined;
  guard.log.push(safe({
    ...entry, status: ran.error || lost ? "error" : "ok", ...(route && { route }), ...(expectResult && { expect: expectResult }), ...(evidence && { evidence }), ...(page_url !== undefined && { page_url }),
    ...(shot && { screenshot: shot }), ...(parsed.command === "screenshot" && session && { session: session.name }),
    ...(atLogin && { at_login: true }), ...(seen.modal && { modal: true }),
  }));
  writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));

  const text = stopped ? `### Error\nError: ${WHY[stopped]} (${stopped}); the Execution is stopped. End your report.` : keptOutput(safe(ran.text), parsed.typed, guardExempt(/** @type {ExecutionGuard} */ (guard)));
  return { exit: 0, json: safe({ action: "do", ok: !ran.error && !stopped, command: parsed.command, text, ...(expectResult && { expect: expectResult }), used: guard.used, cap: guard.cap, page_url, ...(seen.modal && { modal: true }), ...(atLogin && { at_login: true }), ...(stopped && { stopped }) }) };
}

const WRITE_FAILED = "the response could not be saved";

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult | Promise<CommandResult>}
 */
function requestCommand(args, ctx) {
  const { env } = ctx;
  const platformContext = /** @type {PlatformContext | undefined} */ (ctx.platformContext);
  const admitted = admit("request", `<METHOD> <url> [--query k=v]… [--header Name:value]… [--json <body>] [--auth ${CREDENTIAL_VARIANTS.join("|")}]`, args, ctx);
  if (admitted.done) return admitted.done;
  const { execDir, guard, n, session, words } = admitted;
  // What the trace may keep of a refused call: a valid method, and a URL cut to its origin and path.
  const early = typeof words[0] === "string" && METHODS.includes(words[0].toUpperCase()) ? [words[0].toUpperCase()] : [];
  let values = /** @type {string[]} */ ([]);
  /** @type {import("./tester-request.mjs").CredentialVariant | undefined} */
  let auth;
  const safe = /** @template T @param {T} value @returns {T} */ (value) => maskCredentialValue(value, values);
  /**
   * @param {string} code
   * @param {Record<string, unknown>} [data]
   * @param {readonly string[]} [logged]
   * @returns {{ exit: number, json: Record<string, unknown> }}
   */
  const refused = (code, data, logged = early) => admitted.refused(code, safe(data), { ...admitted.entry("request", safe(logged)), ...(auth && { auth }) });

  if (!session) return refused("unknown_role", { role: admitted.role, roles: guard.sessions.map((s) => s.role) });
  const resolved = sessionCredentials(execDir, session, guard.sessions, guard.typed_secret === true);
  if (resolved.refusal) return refused(resolved.refusal.code, { error: resolved.refusal.message, ...(resolved.refusal.command && { command: resolved.refusal.command }) });
  const { pinned, note, header, expired } = resolved;
  values = resolved.values;
  if (header.refusal?.code === "header_note_missing" || (session.kind === "header-only" && !pinned.root)) return refused("header_note_missing");
  const parsed = parseTesterRequest(words, { origin: guard.origin, header: headerCredential(note)?.header });
  if (parsed.ok) auth = parsed.auth;
  if (!parsed.ok) return refused(parsed.code, { error: parsed.error }, parsed.method ? [parsed.method, /** @type {string} */ (parsed.url)] : early);
  if (header.refusal && !(auth === "absent" && header.refusal.code === "header_credential_missing")) return refused(header.refusal.code, { error: header.refusal.message, ...(header.refusal.gitignore_line && { gitignore_line: header.refusal.gitignore_line }) });
  const real = header.credential ?? null;
  if (!auth && session.kind === "header-only" && real === null) return refused("header_credential_invalid", { error: HEADER_CREDENTIAL_REFUSALS.header_credential_invalid });
  if (expired.refusal) return refused(expired.refusal.code, { error: expired.refusal.message, ...(expired.refusal.gitignore_line && { gitignore_line: expired.refusal.gitignore_line }) });
  if ((auth === "invalid" || auth === "expired") && !real) return refused("header_credential_required", { error: HEADER_CREDENTIAL_REFUSALS.header_credential_required });
  if (auth === "expired" && !expired.credential) return refused("expired_credential_missing", { error: HEADER_CREDENTIAL_REFUSALS.expired_credential_missing });
  if (auth === "expired" && expired.credential?.value.trim() === real?.value.trim()) return refused("expired_credential_invalid", { error: "The expired credential must differ from the real Header credential." });
  let credential = real;
  if (auth === "absent") credential = null;
  else if (auth === "expired") credential = expired.credential;
  else if (auth === "invalid" && real) {
    let value;
    do { value = randomBytes(32).toString("hex"); } while (value === real.value || value === expired.credential?.value);
    credential = { ...real, value };
    const generated = headerCredentialValues(credential);
    const retained = retainCredentialValues(dirname(dirname(execDir)), generated);
    if (!retained.ok) return refused(retained.refusal.code, { error: retained.refusal.message, ...(retained.refusal.command && { command: retained.refusal.command }) });
    values.push(...generated);
  }
  const logged = [parsed.method, parsed.url];
  if (new URL(parsed.href).origin !== guard.origin) return refused("off_target_url", { origin: guard.origin }, [parsed.method, new URL(parsed.href).origin]);
  if (!matchesNote(guard.match[session.role] ?? [], parsed.href)) return refused("outside_match", { role: session.role }, logged);
  writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));

  const finish = (/** @type {import("./request-transport.mjs").RequestTransportResult} */ ran) => {
    if (ran.missing) return refused("no_playwright_cli", {}, logged);
    if (ran.refused) return refused("refused_playwright_cli", { check: ran.refusal?.code, reason: ran.refusal?.message }, logged);
    if (ran.refusal) return refused(ran.refusal.code, { error: ran.refusal.message, ...(ran.refusal.command && { command: ran.refusal.command }) }, logged);
    const got = ran.error ? { error: errorLine(ran.error, values) } : ran.result ? responseOf(ran.result, { href: parsed.href, origin: guard.origin, values }) : { error: "the request returned no result" };
    const entry = { ...admitted.entry("request", safe(logged)), ...(auth && { auth }) };
    const shown = safe({ method: parsed.method, url: parsed.url });
    if (got.error !== undefined) {
      // A transport error is only a candidate: a page that is gone stops the Execution, a live one
      // leaves the Tester its single retry.
      const probe = session.kind === "header-only" || guard.modal ? undefined : observe(execDir, session.name, "", env, platformContext);
      if (probe && pageGone(probe)) guard.stopped = "connection-lost";
      guard.log.push({ ...entry, status: "error" });
      writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));
      return { exit: 0, json: { action: "request", ok: false, ...shown, error: got.error, used: guard.used, cap: guard.cap, ...(guard.stopped && { stopped: guard.stopped }) } };
    }

    const authRejected = !auth && got.status === 401 && ran.credential_sent === true ? { auth_rejected: true } : {};
    // A JSON body cut at the return limit no longer parses, and the line-based page scrub alone would
    // keep a credential-named subtree's nested children.
    const text = /** @type {string} */ (got.body);
    const exempt = guardExempt(/** @type {ExecutionGuard} */ (guard));
    const body = got.parsed ? redactValue(got.body, exempt) : got.cut ? redactCutBody(text, exempt) : redactPageText(text, exempt);
    const inline = inlineBody(body);
    let file;
    try {
      mkdirSync(join(execDir, "responses"), { recursive: true });
      file = join(realpathSync(execDir), "responses", `${n}.json`);
      writeFileSync(file, `${JSON.stringify(/** @type {TesterResponseFile} */ ({ status: got.status, headers: redactValue(got.headers), body }), null, 2)}\n`);
    } catch {
      guard.log.push({ ...entry, status: "error", ...authRejected });
      writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));
      return { exit: 0, json: { action: "request", ok: false, ...shown, ...authRejected, error: WRITE_FAILED, used: guard.used, cap: guard.cap } };
    }
    guard.log.push({ ...entry, status: "ok", http_status: got.status, ...authRejected });
    writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));
    return { exit: 0, json: { action: "request", ok: true, ...shown, ...authRejected, status: got.status, headers: redactValue(got.headers), body: inline.body, ...((inline.trimmed || got.cut) && { truncated: true }), response: file, used: guard.used, cap: guard.cap } };
  };
  const ran = requestTransport({ execDir, session, request: parsed, credential, values, env, platformContext });
  return ran instanceof Promise ? ran.then(finish) : finish(ran);
}

/** @type {CommandDefinition} */
export const command = {
  actions: {
    do: { options: { dir: "value", root: "value" }, usage: "<execution-id> <role> <command> [<arg>…] --dir <run-dir>", parse: tailOptions, run: doCommand },
    request: { options: { dir: "value", root: "value" }, usage: `<execution-id> <role> <METHOD> <url> [--query k=v]… [--header Name:value]… [--json <body>] [--auth ${CREDENTIAL_VARIANTS.join("|")}] --dir <run-dir>`, parse: tailOptions, run: requestCommand },
  },
};
