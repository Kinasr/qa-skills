// @ts-check
// What `execute open|close` and `tester do` share about one Execution's browser sessions:
// `guard.json` and its shape, the `playwright-cli` call every one of them
// makes, and the page and origin checks that run after a command.
//
// `<run>/executions/<id>/guard.json` (the CLI's alone: the Tester may not read it, see tester-guard.mjs):
//   id, run, origin   the Execution, the Run and the target origin
//   cap, used         the action budget and the calls counted so far (refusals count)
//   stopped           null, or the sticky stop: "action-cap" | "off-target" | "no-access" | "connection-lost"
//   sessions          [{role, slug, name, acc, setup, login_url}] one per Role; `role` is the Role or
//                     `-`, `name` the playwright-cli session, `login_url` its note's sign-in page
//                     (origin + path) when the note names one that is not `/`, else null (then a
//                     same-origin page with a password field is the sign-in page, `passwordShown`)
//   login_sessions    [name] the browser sessions a CLI login opens, registered like `sessions`
//   match             {<role>: [prefixes]} the Access note's `match`, checked before `goto`
//   uploads           {<name>: <real path>} what `upload <name>` may attach
//   at_login          [n] the calls that landed on a same-origin sign-in page
//   log               [{n, role, cmd, args, status, code?, page_url?, at_login?, modal?, evidence?}] the trace
//                     ingest reads: `args` with typed text masked, `page_url` cut to its origin when
//                     off the target, `status` "ok" | "error" | "refused", `evidence` the element
//                     evidence of an admitted element action (or `target: "none"` for a ref-less one)
//   modal             true while a dialog blocks the page (the origin check is deferred)
//   closed            true once `execute close` closed the sessions
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { covers } from "./access.mjs";
import { redactPageText } from "./credentials.mjs";

/**
 * Sticky stop reasons for an Execution guard.
 * @typedef {"action-cap" | "off-target" | "no-access" | "connection-lost"} ExecutionGuardStop
 */

/**
 * Every sticky guard stop, in the order the brief names them.
 * @type {readonly ExecutionGuardStop[]}
 */
export const GUARD_STOPS = ["action-cap", "off-target", "no-access", "connection-lost"];

/**
 * The guard stops a Tester report may not choose: they are set only by the guard, while `no-access`
 * is also a reason a Tester may report.
 * @type {readonly ExecutionGuardStop[]}
 */
export const GUARD_ONLY_STOPS = ["action-cap", "off-target", "connection-lost"];

/**
 * Session entry recorded in an Execution guard.
 * @typedef {{
 *   role: string,
 *   slug: string,
 *   name: string,
 *   acc: string | null,
 *   setup: boolean,
 *   login_url: string | null,
 * }} ExecutionSession
 */

/**
 * One element in a DOM excerpt: its tag and allow-listed attributes.
 * @typedef {{
 *   tag: string,
 *   attributes: Record<string, string>,
 * }} ExecutionExcerptNode
 */

/**
 * The DOM excerpt of an element action: the target and its ancestors up to `body`, with a boundary
 * when an iframe or shadow root stopped the walk and a marker for anything a limit cut.
 * @typedef {{
 *   element: ExecutionExcerptNode,
 *   ancestors: ExecutionExcerptNode[],
 *   boundary?: "iframe" | "shadow" | "unknown",
 *   truncated?: {
 *     ancestors?: true,
 *     attributes?: true,
 *     classes?: true,
 *     values?: true,
 *     bytes?: true,
 *   },
 * }} ExecutionExcerpt
 */

/**
 * Evidence for one admitted element action: the ref's ARIA path in the snapshot the Tester was
 * shown, the locator playwright-cli emitted, and the DOM excerpt taken before the action. A
 * ref-less action records `target: "none"` instead.
 * @typedef {{
 *   aria?: string,
 *   locator?: string,
 *   excerpt?: ExecutionExcerpt | "unavailable",
 *   target?: "none",
 *   truncated?: {
 *     aria?: true,
 *     locator?: true,
 *     excerpt?: true,
 *   },
 * }} ExecutionEvidence
 */

/**
 * Command log entry in an Execution guard.
 * @typedef {{
 *   n: number,
 *   role: string,
 *   cmd: string,
 *   args: readonly string[],
 *   status: "ok" | "error" | "refused",
 *   code?: string,
 *   page_url?: string,
 *   at_login?: boolean,
 *   modal?: boolean,
 *   http_status?: number,
 *   screenshot?: string,
 *   session?: string,
 *   evidence?: ExecutionEvidence,
 * }} ExecutionLogEntry
 */

/**
 * `<run>/executions/<id>/guard.json` shape owned by `execution-guard`.
 * @typedef {{
 *   id: string,
 *   run: string,
 *   origin: string,
 *   cap: number,
 *   used: number,
 *   stopped: ExecutionGuardStop | null,
 *   sessions: ExecutionSession[],
 *   login_sessions?: string[],
 *   match: Record<string, string[]>,
 *   uploads?: Record<string, string>,
 *   at_login: number[],
 *   log: ExecutionLogEntry[],
 *   modal?: boolean,
 *   closed?: boolean,
 * }} ExecutionGuard
 */

/**
 * One `### Name` section from playwright-cli's output.
 * @typedef {{
 *   name: string,
 *   body: string,
 * }} OutputSection
 */

/**
 * Result of running a command via playwright-cli: `stderr` is kept for infrastructure classification,
 * already scrubbed by the existing credential redaction.
 * @typedef {{ missing: true, text?: undefined, error?: undefined, stderr?: undefined } | { missing?: false, text: string, error?: string, stderr?: string }} PlaywrightResult
 */

/**
 * Observation of current session page URL and modal state; `error` is the probe's own failure, if it
 * could not read the page.
 * @typedef {{
 *   url: string | undefined,
 *   modal: boolean,
 *   error?: string,
 * }} SessionObservation
 */

/**
 * Information on an open browser tab in a session.
 * @typedef {{
 *   index: number,
 *   current: boolean,
 *   url: string,
 * }} SessionTab
 */

/**
 * The tabs a probe could list, and the probe's own failure when it could not.
 * @typedef {{
 *   tabs: SessionTab[],
 *   error?: string,
 * }} TabsObservation
 */

/**
 * Classification category of a page URL relative to target and sign-in URL.
 * @typedef {"ok" | "login" | "sso" | "off" | "neutral"} PageKind
 */

/**
 * Result of classifying a page URL.
 * @typedef {{
 *   kind: PageKind,
 *   origin?: string,
 * }} PageClassification
 */

/** @type {"guard.json"} */
export const GUARD_FILE = "guard.json";
const CALL_TIMEOUT_MS = 60000;

/**
 * @param {string} runDir
 * @param {string} id
 * @returns {string}
 */
export const executionDir = (runDir, id) => join(runDir, "executions", id);

/**
 * The guard of the Execution in `execDir`, or null when `execute open` has not made one.
 * @param {string} execDir
 * @returns {ExecutionGuard | null}
 */
export function readGuard(execDir) {
  const file = join(execDir, GUARD_FILE);
  if (!existsSync(file)) return null;
  try {
    return /** @type {ExecutionGuard} */ (JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Written whole through a rename, so a Tester killed mid-write never leaves half a guard behind.
 * @param {string} execDir
 * @param {ExecutionGuard} guard
 * @returns {void}
 */
export function writeGuard(execDir, guard) {
  const file = join(execDir, GUARD_FILE);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(guard, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

/**
 * A Role's slug in a session name: lower case, runs of other characters one `-`; the role-less `-` is "default".
 * @param {string} role
 * @returns {string}
 */
export const slugOf = (role) => (role === "-" ? "default" : role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "role");

/**
 * The sessions of an Execution, each given its `slug` and `name` (`<run-id>-<exec-id>-<slug>`, a
 * collision `-2`, `-3`…): `sessions` is the plan's `{role, acc, setup}`.
 * @template {{ role: string }} S
 * @param {string} run
 * @param {string} id
 * @param {readonly S[]} sessions
 * @returns {Array<S & { slug: string, name: string }>}
 */
export function namedSessions(run, id, sessions) {
  /** @type {Map<string, number>} */
  const taken = new Map();
  return sessions.map((s) => {
    const base = slugOf(s.role);
    const seen = (taken.get(base) ?? 0) + 1;
    taken.set(base, seen);
    const slug = seen === 1 ? base : `${base}-${seen}`;
    return { ...s, slug, name: `${run}-${id}-${slug}` };
  });
}

/**
 * Whether the account's `match` prefixes cover `href`: a note picks the test account, so `goto` and
 * `request` stay inside what it covers (post-command checks are origin-only).
 * @param {readonly string[]} match
 * @param {string} href
 * @returns {boolean}
 */
export const matchesNote = (match, href) => match.some((p) => covers(p, `url:${href}`));

/**
 * A note's `login_url` as `origin + path`, or null when it names none or only the root (a root login
 * URL would flag every page of the app).
 * @param {{ identifiers?: { login_url?: unknown } | null } | null | undefined} note
 * @param {string} origin
 * @returns {string | null}
 */
export function loginUrlOf(note, origin) {
  const named = note?.identifiers?.login_url;
  if (typeof named !== "string" || !named) return null;
  try {
    const url = new URL(named, `${origin}/`);
    return url.pathname === "/" ? null : url.origin + url.pathname;
  } catch {
    return null;
  }
}

/**
 * One `playwright-cli` call in session `session`, run from `cwd` (the Execution's dir): `{missing}`
 * when it is not on the PATH, else `{text, error?}`, `error` the first line of a `### Error`.
 * `timeoutMillis` is the wrapper's bound for this call, a probe's own shorter one included.
 * @param {string} cwd
 * @param {string} session
 * @param {readonly string[]} args
 * @param {NodeJS.ProcessEnv | undefined} [env]
 * @param {number} [timeoutMillis]
 * @returns {PlaywrightResult}
 */
export function playwright(cwd, session, args, env, timeoutMillis = CALL_TIMEOUT_MS) {
  const r = spawnSync("playwright-cli", [`-s=${session}`, ...args], { cwd, env, encoding: "utf8", timeout: timeoutMillis });
  if (/** @type {NodeJS.ErrnoException | undefined} */ (r.error)?.code === "ENOENT") return { missing: true };
  const stderr = redactPageText(typeof r.stderr === "string" ? r.stderr : "");
  if (r.error) return { text: redactPageText(typeof r.stdout === "string" ? r.stdout : ""), error: /** @type {NodeJS.ErrnoException} */ (r.error).code === "ETIMEDOUT" ? "playwright-cli timed out" : r.error.message, ...(stderr && { stderr }) };
  const text = /** @type {string} */ (r.stdout);
  const section = sectionsOf(text).find((s) => s.name === "Error");
  if (section) return { text, error: section.body.split("\n").find((l) => l.startsWith("Error: "))?.slice("Error: ".length) ?? "playwright-cli failed", ...(stderr && { stderr }) };
  return r.status === 0 ? { text, ...(stderr && { stderr }) } : { text, error: "playwright-cli failed", ...(stderr && { stderr }) };
}

/**
 * playwright-cli's output as `[{name, body}]`, one per `### Name` block.
 * @param {string} text
 * @returns {OutputSection[]}
 */
export function sectionsOf(text) {
  return text.split(/^### /m).slice(1).map((block) => {
    const at = block.indexOf("\n");
    return at === -1 ? { name: block.trim(), body: "" } : { name: block.slice(0, at).trim(), body: block.slice(at + 1).trim() };
  });
}

/**
 * The blocks a Tester sees: Result, Page, Snapshot, Modal state and Error. `### Ran Playwright code`
 * is dropped since it echoes what was typed, `typed` is masked wherever the rest repeats it, and what
 * still looks like a credential (a console line, a page's text) is redacted as a `request` body is.
 * @param {string} text
 * @param {string | undefined} typed
 * @returns {string}
 */
export function keptOutput(text, typed) {
  const keep = ["Result", "Page", "Snapshot", "Modal state", "Error"];
  const shown = sectionsOf(text).filter((s) => keep.includes(s.name)).map((s) => `### ${s.name}\n${maskTyped(s.body, typed)}`).join("\n");
  return redactPageText(shown);
}

/**
 * What touches a short typed text without being it: part of a word, a path, a URL or a query.
 */
const WORD_CHARS = "A-Za-z0-9_/.:?&=#%~@+-";

/**
 * `body` without `typed`, whatever its length: its JSON-quoted form always, and the bare text wherever it
 * occurs, except that a text of under four characters is masked only as a whole token, since it would
 * otherwise mangle a word, a path or a number that merely contains it.
 * @param {string} body
 * @param {string | undefined} typed
 * @returns {string}
 */
export function maskTyped(body, typed) {
  if (typeof typed !== "string" || typed === "") return body;
  const out = body.replaceAll(JSON.stringify(typed), '"<typed>"');
  if (typed.length >= 4) return out.replaceAll(typed, "<typed>");
  const text = typed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return out.replace(new RegExp(`(?<![${WORD_CHARS}])${text}(?![${WORD_CHARS}])`, "g"), "<typed>");
}

/**
 * What the sign-in check asks of a page: is a password field on it? It tells a sign-in page apart where
 * the session has no `login_url` to go by.
 */
const PASSWORD_SHOWN = "() => document.querySelector('input[type=password]') !== null";

/**
 * @param {string} cwd
 * @param {string} session
 * @param {NodeJS.ProcessEnv | undefined} [env]
 * @returns {boolean}
 */
export function passwordShown(cwd, session, env) {
  const asked = playwright(cwd, session, ["eval", PASSWORD_SHOWN], env);
  if (asked.error || asked.missing) return false;
  return sectionsOf(asked.text).find((section) => section.name === "Result")?.body.split("\n")[0].trim() === "true";
}

// The wrapper's own element excerpt probe, beside the sign-in and URL probes: the target's tag and
// allow-listed attributes, then each ancestor's up to `body`, stopping at an iframe or shadow root
// with `boundary`. No text and no child content; the wrapper bounds and scrubs what comes back.
export const ELEMENT_EXCERPT_PROBE = [
  "el => {",
  "const fixed = {id:1,name:1,type:1,role:1,placeholder:1,for:1,href:1,class:1};",
  "const attrs = (n) => {const a = {}; for (const at of n.attributes) {const k = at.name.toLowerCase(); if (fixed[k] || k.startsWith('aria-') || k.startsWith('data-')) a[k] = at.value;} return a;};",
  "const chain = [];",
  "let node = el;",
  "let boundary;",
  "for (let i = 0; node && i < 32; i++) {",
  "chain.push({tag: node.tagName.toLowerCase(), attributes: attrs(node)});",
  "if (node.tagName.toLowerCase() === 'body') {try {if (node.ownerDocument && node.ownerDocument.defaultView && node.ownerDocument.defaultView.frameElement) boundary = 'iframe';} catch (e) {} break;}",
  "const parent = node.parentElement;",
  "if (parent) {node = parent; continue;}",
  "let root = null;",
  "try {root = node.getRootNode ? node.getRootNode() : null;} catch (e) {}",
  "if (root && root.host) boundary = 'shadow';",
  "else {try {boundary = node.ownerDocument && node.ownerDocument.defaultView && node.ownerDocument.defaultView.frameElement ? 'iframe' : 'unknown';} catch (e) {boundary = 'unknown';}}",
  "node = null;",
  "}",
  "const first = chain[0] || {tag: '', attributes: {}};",
  "return {element: first, ancestors: chain.slice(1), ...(boundary ? {boundary} : {})};",
  "}",
].join(" ");

/** A probe's own bound: five seconds, separate from a command's. */
const PROBE_TIMEOUT_MS = 5000;

/**
 * What the wrapper's fixed excerpt probe returned for `ref` before an action: its parsed object,
 * or `{ok: false}` when playwright-cli, the locator or the JSON failed. The action runs either way.
 * @param {string} cwd
 * @param {string} session
 * @param {string} ref
 * @param {NodeJS.ProcessEnv | undefined} [env]
 * @returns {{ ok: true, value: unknown } | { ok: false }}
 */
export function elementExcerpt(cwd, session, ref, env) {
  const asked = playwright(cwd, session, ["eval", ELEMENT_EXCERPT_PROBE, ref], env, PROBE_TIMEOUT_MS);
  if (asked.missing || asked.error) return { ok: false };
  const result = sectionsOf(asked.text).find((section) => section.name === "Result");
  if (!result) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(result.body) };
  } catch {
    return { ok: false };
  }
}

const PAGE_URL = /^- Page URL: (\S.*)$/m;

/**
 * The page a call left the session on, and whether a dialog blocks it: from `### Page`, else one
 * internal `eval` (not counted); no URL while a dialog is open.
 * @param {string} cwd
 * @param {string} session
 * @param {string} text
 * @param {NodeJS.ProcessEnv | undefined} [env]
 * @returns {SessionObservation}
 */
export function observe(cwd, session, text, env) {
  const modal = sectionsOf(text).some((s) => s.name === "Modal state");
  const page = sectionsOf(text).find((s) => s.name === "Page");
  let url = page && PAGE_URL.exec(page.body)?.[1].trim();
  /** @type {string | undefined} */
  let error;
  if (!url && !modal) {
    const asked = playwright(cwd, session, ["eval", "() => location.href"], env);
    if (asked.missing) error = "playwright-cli is not on the PATH";
    else if (asked.error) error = redactPageText(asked.error);
    else {
      const result = sectionsOf(asked.text).find((s) => s.name === "Result");
      if (!result) error = "the page probe returned no result";
      else {
        try {
          url = JSON.parse(result.body.split("\n")[0]);
        } catch {
          url = undefined;
          error = "the page probe returned no URL";
        }
      }
    }
  }
  return { url: typeof url === "string" && url ? url : undefined, modal, ...(error && { error }) };
}

/**
 * Whether a page URL is unreadable as the app's active page: none, `about:blank`, or a browser's
 * own error page.
 * @param {string | undefined} url
 * @returns {boolean}
 */
export const unreadablePage = (url) => url === undefined || url === "" || url === "about:blank" || url.startsWith("about:neterror") || /^(?:chrome|edge|chromium)-error:/.test(url);

/**
 * Whether the active page of an observation is gone: its probe failed, or the page it read is
 * unreadable as the app.
 * @param {SessionObservation} observation
 * @returns {boolean}
 */
export const pageGone = (observation) => Boolean(observation.error) || unreadablePage(observation.url);

/**
 * Every tab of the session: `[{index, current, url}]` from `tab-list` (an internal call, not
 * counted), and the probe's own `error` when it could not list them.
 * @param {string} cwd
 * @param {string} session
 * @param {NodeJS.ProcessEnv | undefined} [env]
 * @returns {TabsObservation}
 */
export function tabsOf(cwd, session, env) {
  const listed = playwright(cwd, session, ["tab-list"], env);
  if (listed.missing) return { tabs: [], error: "playwright-cli is not on the PATH" };
  if (listed.error) return { tabs: [], error: redactPageText(listed.error) };
  const tabs = [...listed.text.matchAll(/^- (\d+):( \(current\))? \[[^\]]*\]\((\S+?)\)(?: \[crashed\])?$/gm)]
    .map((m) => ({ index: Number(m[1]), current: Boolean(m[2]), url: m[3] }));
  return { tabs };
}

/**
 * What a page URL is to the Execution, `origin` its target and `loginUrl` its session's sign-in page:
 *   ok       on the target
 *   login    on a same-origin sign-in page (logged as `at_login`, never a stop)
 *   sso      on a sign-in page of another origin: no access (ahead of `off`)
 *   off      off the target origin, `origin` the only thing kept of it
 *   neutral  about:blank, which a new tab shows until its page loads
 * @param {string} url
 * @param {string} origin
 * @param {string | null} loginUrl
 * @returns {PageClassification}
 */
export function classify(url, origin, loginUrl) {
  if (url === "about:blank") return { kind: "neutral" };
  let u;
  try {
    u = new URL(url);
  } catch {
    return { kind: "off", origin: "null" };
  }
  const atLogin = loginUrl !== null && u.origin + u.pathname === loginUrl;
  if (atLogin && new URL(loginUrl).origin !== origin) return { kind: "sso", origin: u.origin };
  if (u.origin !== origin) return { kind: "off", origin: u.origin };
  return { kind: atLogin ? "login" : "ok" };
}

/** @type {Record<PageKind, number>} */
const RANK = { sso: 4, off: 3, login: 2, ok: 1, neutral: 0 };

/**
 * The checks after a command: `urls` the page URL and, when `tabs` were listed, every tab's. Returns
 * `{kind, origin?}` of the worst one. On `off` and `sso` the offending tabs are put away first: a
 * new tab is closed, the original tab goes `go-back` once.
 * @param {{
 *   cwd: string,
 *   session: string,
 *   origin: string,
 *   loginUrl: string | null,
 *   url: string | undefined,
 *   tabs: readonly SessionTab[],
 *   env?: NodeJS.ProcessEnv,
 * }} options
 * @returns {PageClassification}
 */
export function verdict({ cwd, session, origin, loginUrl, url, tabs, env }) {
  /** @type {Array<SessionTab & PageClassification>} */
  const seen = tabs.length ? tabs.map((t) => ({ ...t, ...classify(t.url, origin, loginUrl) })) : url === undefined ? [] : [{ index: 0, current: true, url, ...classify(url, origin, loginUrl) }];
  const worst = seen.reduce((w, s) => (RANK[s.kind] > RANK[w.kind] ? s : w), /** @type {PageClassification} */ ({ kind: "ok" }));
  if (worst.kind === "off" || worst.kind === "sso") {
    const away = seen.filter((s) => s.kind === "off" || s.kind === "sso");
    for (const s of away.filter((a) => a.index > 0).sort((a, b) => b.index - a.index)) playwright(cwd, session, ["tab-close", String(s.index)], env);
    if (away.some((a) => a.index === 0)) {
      if (tabs.length && !tabs.find((t) => t.index === 0)?.current) playwright(cwd, session, ["tab-select", "0"], env);
      playwright(cwd, session, ["go-back"], env);
    }
  }
  return worst;
}
