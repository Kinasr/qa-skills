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
//       `{ok: false, refusals, used, cap, stopped?}` and exits 1.
//
//   request <execution-id> <role> <METHOD> <url> [--query k=v]… [--header Name:value]… [--json <body>] --dir <run-dir>
//       Sends one HTTP request in the Role's session, so its cookies apply, for a `level: api` case
//       (lib/tester-request.mjs): the URL is resolved against the target origin, `--query` merged, and
//       its origin and the account's `match` checked before it is sent; `cookie`, `authorization`,
//       `proxy-authorization` and `host` headers are refused. It shares `do`'s tail, Role lookup, cap
//       and log: a counted call, a refusal included. Prints `{ok, method, url, status, headers, body,
//       truncated?, response, used, cap, stopped?}`: `body` is the response trimmed and redacted, the
//       whole redacted body is in the file `response` names (`executions/<id>/responses/<n>.json`),
//       and `Set-Cookie` and the echo of the call are never returned. A transport failure prints
//       `{ok: false, method, url, error, used, cap}`, counted. The trace entry is `{n, role, cmd:
//       "request", args: [METHOD, <url without query>], status, http_status?}`, never a query,
//       header or body.
/**
 * @import { CommandAction, CommandContext, CommandDefinition, CommandResult } from "./cli.mjs"
 * @import { ExecutionEvidence, ExecutionGuard, ExecutionGuardStop, ExecutionLogEntry, ExecutionSession, PageClassification, SessionObservation, SessionTab } from "./execution-guard.mjs"
 * @import { TesterAllowedCommand } from "./tester-command.mjs"
 */
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UsageError } from "./cli.mjs";
import { redactPageText, redactQueryParams, redactValue } from "./credentials.mjs";
import { cacheAfterCommand, elementEvidence, snapshotNodes } from "./element-evidence.mjs";
import { classify, elementExcerpt, executionDir, keptOutput, matchesNote, observe, pageGone, passwordShown, playwright, readGuard, sectionsOf, tabsOf, unreadablePage, verdict, writeGuard } from "./execution-guard.mjs";
import { refusalsFor } from "./refusal.mjs";
import { ELEMENT_COMMANDS, REF_LESS_COMMANDS, parseTesterCommand } from "./tester-command.mjs";
import { METHODS, errorLine, inlineBody, parseTesterRequest, requestCode, responseOf } from "./tester-request.mjs";

/**
 * Serialised response stored in `executions/<id>/responses/<n>.json`.
 * @typedef {{
 *   status: number,
 *   headers: unknown,
 *   body: unknown,
 * }} TesterResponseFile
 */

const { refuse } = refusalsFor({
  not_open: "The Execution has no open sessions; it is opened before its Tester starts.",
  closed: "The Execution's sessions are closed.",
  stopped: "The Execution is stopped; end your report, the stop decides the result.",
  action_cap: "The action cap is spent; the Execution is stopped. End your report.",
  unknown_role: "The Execution has no session for that Role; use a Role of the brief, its slug, or `-`.",
  unknown_command: "That is not a tester command.",
  bad_ref: "A <ref> comes from the snapshot and never starts with `-`.",
  bad_arguments: "The command's arguments do not fit its grammar.",
  bad_url: "`goto` and `request` take an http or https URL.",
  bad_method: "`request` takes one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.",
  bad_header: "`--header` takes Name:value, once per name.",
  forbidden_header: "The session supplies `cookie`, `authorization`, `proxy-authorization` and `host`; a request never sets them.",
  bad_json: "`--json` takes one JSON object or array.",
  bad_upload: "`upload` takes the bare name of a fixture the brief lists.",
  off_target_url: "`goto` and `request` stay on the target origin.",
  outside_match: "`goto` and `request` stay inside what this Role's account covers.",
  no_playwright_cli: "`playwright-cli` is not on the PATH.",
});

const ID = /^[A-Za-z0-9_-]+$/;
const OPTIONS = ["dir", "root"];
const MAX_ARGS = 8;
const MAX_ARG = 200;

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
 * @returns {string[]}
 */
function loggedArgs(command, args) {
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
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function doCommand(args, ctx) {
  const { env } = ctx;
  const admitted = admit("do", "<command> [<arg>…]", args, ctx);
  if (admitted.done) return admitted.done;
  const { execDir, guard, n, session, role, words } = admitted;
  const [command = "", ...rest] = words;
  // A `goto`'s word is a URL and the trace keeps it, so its query is scrubbed as a page_url is.
  const entry = admitted.entry(command, command === "goto" ? loggedArgs(command, rest).map(redactQueryParams) : loggedArgs(command, rest));
  /**
   * @param {string} code
   * @param {Record<string, unknown>} [data]
   * @returns {{ exit: number, json: Record<string, unknown> }}
   */
  const refused = (code, data) => admitted.refused(code, data, entry);

  if (!session) return refused("unknown_role", { role, roles: guard.sessions.map((s) => s.role) });
  const parsed = parseTesterCommand(words, { origin: guard.origin, uploads: guard.uploads ?? {} });
  // A refused `goto` URL is logged as the parser cut it, else not at all: it may hold credentials.
  if (!parsed.ok && command === "goto" && parsed.code === "bad_url") return admitted.refused(parsed.code, { error: parsed.error }, admitted.entry(command, parsed.url ? [parsed.url] : []));
  if (!parsed.ok) return refused(parsed.code, { error: parsed.error });
  if (parsed.href) {
    if (new URL(parsed.href).origin !== guard.origin) return refused("off_target_url", { origin: guard.origin });
    if (!matchesNote(guard.match[session.role] ?? [], parsed.href)) return refused("outside_match", { role: session.role });
  }
  writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));

  // The excerpt is taken before the action, while the ref still points at the element; it is never
  // an action of its own and its output never reaches the Tester.
  const ref = ELEMENT_COMMANDS.has(/** @type {TesterAllowedCommand} */ (parsed.command)) ? parsed.argv[0] : undefined;
  const probe = ref === undefined ? null : elementExcerpt(execDir, session.name, ref, env);
  const ran = playwright(execDir, session.name, [parsed.command, ...parsed.argv], env);
  if (ran.missing) return refused("no_playwright_cli");
  const seen = observe(execDir, session.name, ran.text, env);
  const wasModal = guard.modal === true;
  const tabsSeen = !seen.modal && (parsed.tabs || wasModal) ? tabsOf(execDir, session.name, env) : { tabs: [] };
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
  const stopped = /** @type {ExecutionGuardStop | null} */ (check.kind === "sso" ? "no-access" : check.kind === "off" ? "off-target" : lost ? "connection-lost" : null);
  if (stopped) guard.stopped = stopped;
  const left = check.kind === "off" || check.kind === "sso";
  const atLogin = check.kind === "login";
  if (atLogin) guard.at_login.push(n);
  // A URL of the target keeps its query, credential-named parameters redacted; off the target only the origin is kept.
  const page_url = left ? check.origin : lost || currentUrl === undefined ? undefined : redactQueryParams(currentUrl);
  /** @type {ExecutionEvidence | undefined} */
  const evidence = ref !== undefined
    ? elementEvidence({ nodes: snapshotNodes(execDir, session.name), ref, text: ran.text, typed: parsed.typed, probe: probe ?? { ok: false } })
    : REF_LESS_COMMANDS.has(/** @type {TesterAllowedCommand} */ (parsed.command)) ? { target: "none" } : undefined;
  // The evidence above used the snapshot the Tester was shown; only now does this call's snapshot
  // replace it (or a navigation without one drop it). A cache that cannot be written costs the next
  // action's ARIA path, never this one's result.
  try {
    cacheAfterCommand({ execDir, session: session.name, command: parsed.command, text: ran.text, url: seen.url, tab: tabsSeen.tabs.find((t) => t.current)?.index });
  } catch {
    // The cache is best-effort.
  }
  const shot = parsed.command === "screenshot" && !ran.error && !lost ? screenshotPath(ran.text) : undefined;
  guard.log.push({
    ...entry, status: ran.error || lost ? "error" : "ok", ...(evidence && { evidence }), ...(page_url !== undefined && { page_url }),
    ...(shot && { screenshot: shot }), ...(parsed.command === "screenshot" && session && { session: session.name }),
    ...(atLogin && { at_login: true }), ...(seen.modal && { modal: true }),
  });
  writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));

  const text = stopped ? `### Error\nError: ${WHY[stopped]} (${stopped}); the Execution is stopped. End your report.` : keptOutput(ran.text, parsed.typed);
  return { exit: 0, json: { action: "do", ok: !ran.error && !stopped, command: parsed.command, text, used: guard.used, cap: guard.cap, page_url, ...(seen.modal && { modal: true }), ...(atLogin && { at_login: true }), ...(stopped && { stopped }) } };
}

const WRITE_FAILED = "the response could not be saved";

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function requestCommand(args, ctx) {
  const { env } = ctx;
  const admitted = admit("request", "<METHOD> <url> [--query k=v]… [--header Name:value]… [--json <body>]", args, ctx);
  if (admitted.done) return admitted.done;
  const { execDir, guard, n, session, words } = admitted;
  // What the trace may keep of a refused call: a valid method, and a URL cut to its origin and path.
  const early = typeof words[0] === "string" && METHODS.includes(words[0].toUpperCase()) ? [words[0].toUpperCase()] : [];
  /**
   * @param {string} code
   * @param {Record<string, unknown>} [data]
   * @param {readonly string[]} [logged]
   * @returns {{ exit: number, json: Record<string, unknown> }}
   */
  const refused = (code, data, logged = early) => admitted.refused(code, data, admitted.entry("request", logged));

  if (!session) return refused("unknown_role", { role: admitted.role, roles: guard.sessions.map((s) => s.role) });
  const parsed = parseTesterRequest(words, { origin: guard.origin });
  if (!parsed.ok) return refused(parsed.code, { error: parsed.error }, parsed.method ? [parsed.method, /** @type {string} */ (parsed.url)] : early);
  const logged = [parsed.method, parsed.url];
  if (new URL(parsed.href).origin !== guard.origin) return refused("off_target_url", { origin: guard.origin }, [parsed.method, new URL(parsed.href).origin]);
  if (!matchesNote(guard.match[session.role] ?? [], parsed.href)) return refused("outside_match", { role: session.role }, logged);
  writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));

  const ran = playwright(execDir, session.name, ["run-code", requestCode(parsed)], env);
  if (ran.missing) return refused("no_playwright_cli", {}, logged);
  const result = sectionsOf(ran.text).find((s) => s.name === "Result");
  const got = ran.error ? { error: errorLine(ran.error) } : result ? responseOf(result.body, { href: parsed.href, origin: guard.origin }) : { error: "the request returned no result" };
  const entry = admitted.entry("request", logged);
  const shown = { method: parsed.method, url: parsed.url };
  if (got.error !== undefined) {
    // A transport error is only a candidate: a page that is gone stops the Execution, a live one
    // leaves the Tester its single retry.
    const probe = guard.modal ? undefined : observe(execDir, session.name, "", env);
    if (probe && pageGone(probe)) guard.stopped = "connection-lost";
    guard.log.push({ ...entry, status: "error" });
    writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));
    return { exit: 0, json: { action: "request", ok: false, ...shown, error: got.error, used: guard.used, cap: guard.cap, ...(guard.stopped && { stopped: guard.stopped }) } };
  }

  const body = got.parsed ? redactValue(got.body) : redactPageText(/** @type {string} */ (got.body));
  const inline = inlineBody(body);
  let file;
  try {
    mkdirSync(join(execDir, "responses"), { recursive: true });
    file = join(realpathSync(execDir), "responses", `${n}.json`);
    writeFileSync(file, `${JSON.stringify(/** @type {TesterResponseFile} */ ({ status: got.status, headers: redactValue(got.headers), body }), null, 2)}\n`);
  } catch {
    guard.log.push({ ...entry, status: "error" });
    writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));
    return { exit: 0, json: { action: "request", ok: false, ...shown, error: WRITE_FAILED, used: guard.used, cap: guard.cap } };
  }
  guard.log.push({ ...entry, status: "ok", http_status: got.status });
  writeGuard(execDir, /** @type {ExecutionGuard} */ (guard));
  return { exit: 0, json: { action: "request", ok: true, ...shown, status: got.status, headers: redactValue(got.headers), body: inline.body, ...((inline.trimmed || got.cut) && { truncated: true }), response: file, used: guard.used, cap: guard.cap } };
}

/** @type {CommandDefinition} */
export const command = {
  actions: {
    do: { options: { dir: "value", root: "value" }, usage: "<execution-id> <role> <command> [<arg>…] --dir <run-dir>", parse: tailOptions, run: doCommand },
    request: { options: { dir: "value", root: "value" }, usage: "<execution-id> <role> <METHOD> <url> [--query k=v]… [--header Name:value]… [--json <body>] --dir <run-dir>", parse: tailOptions, run: requestCommand },
  },
};
