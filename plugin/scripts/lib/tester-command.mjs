// @ts-check
// The closed command set of `tester do` and each command's fixed grammar. Pure: words in, the argv `playwright-cli` is called with out, or a refusal code. Nothing
// the Tester types is ever a flag: free text goes after a `--`, which playwright-cli's argument parser
// reads as "everything after is positional" (checked against 0.1.22), and a `<ref>` starting with `-`
// is refused.
/** @import { ExecutionRoute } from "./execution-guard.mjs" */
import { isFixtureName } from "./keys.mjs";

/**
 * @typedef {"goto" | "go-back" | "reload" | "snapshot" | "screenshot" | "click" | "dblclick" | "fill" | "fill-password" | "check" | "uncheck" | "select" | "hover" | "press" | "tab-list" | "tab-select" | "dialog-accept" | "dialog-dismiss" | "upload" | "console" | "route" | "unroute"} TesterAllowedCommand
 */

/**
 * A successful tester command parse result.
 * @typedef {{
 *   ok: true,
 *   command: string,
 *   argv: string[],
 *   tabs: boolean,
 *   typed?: string,
 *   href?: string,
 *   route?: ExecutionRoute,
 *   logged?: string[],
 *   secret?: true,
 *   expect?: string,
 *   code?: never,
 *   error?: never,
 *   url?: never,
 * }} TesterCommandSuccess
 */

/**
 * A refusal of a tester command parse.
 * @typedef {{
 *   ok: false,
 *   code: string,
 *   error: string,
 *   url?: string,
 *   command?: never,
 *   argv?: never,
 *   tabs?: never,
 *   typed?: never,
 *   href?: never,
 *   expect?: never,
 * }} TesterCommandRefusal
 */

/**
 * @typedef {TesterCommandSuccess | TesterCommandRefusal} TesterCommandResult
 */

/** @type {readonly TesterAllowedCommand[]} */
export const TESTER_ALLOWED = ["goto", "go-back", "reload", "snapshot", "screenshot", "click", "dblclick", "fill", "fill-password", "check", "uncheck", "select", "hover", "press", "tab-list", "tab-select", "dialog-accept", "dialog-dismiss", "upload", "console", "route", "unroute"];

/**
 * The commands whose first positional word is a snapshot ref, so an admitted one gets element
 * evidence. The wrapper reads this set; it is the one place a newly allowed ref command is named.
 * @type {ReadonlySet<TesterAllowedCommand>}
 */
export const ELEMENT_COMMANDS = new Set(["click", "dblclick", "fill", "fill-password", "select", "check", "uncheck", "hover"]);

/**
 * Actions with no element target, including route changes. Their evidence says
 * `target: "none"` and nothing more.
 * @type {ReadonlySet<TesterAllowedCommand>}
 */
export const REF_LESS_COMMANDS = new Set(["press", "upload", "route", "unroute"]);

const BUTTON = /^(left|right|middle)$/;
const KEY = /^(?:[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*|[^\sA-Za-z0-9])$/;
// After these, a new tab or a navigation may have taken the browser off the target (point 4).
const TABS_AFTER = new Set(["click", "dblclick", "press", "dialog-accept", "dialog-dismiss"]);
// Action commands that accept one trailing `--expect=<text>` wait target (ADR-0070).
const EXPECT_COMMANDS = new Set(["click", "dblclick", "press", "fill", "select", "check", "uncheck"]);
const EXPECT_USAGE = "[--expect=<text>]";

// A refusal of a parse, `tester-request.mjs`'s too.
/**
 * @param {string} code
 * @param {string} error
 * @returns {TesterCommandRefusal}
 */
export const no = (code, error) => ({ ok: false, code, error });

/**
 * @param {string} command
 * @param {string[]} argv
 * @param {{ typed?: string, href?: string, tabs?: boolean, route?: ExecutionRoute, logged?: string[], secret?: true, expect?: string }} [extra]
 * @returns {TesterCommandSuccess}
 */
const yes = (command, argv, extra = {}) => ({ ok: true, command, argv, tabs: TABS_AFTER.has(command), ...extra });

/**
 * Compare URL text with one spelling for UTF-8, percent escapes and unreserved characters.
 * Keep encoded separators encoded (a single star can match %2F, but cannot match /), and
 * preserve only the pattern's raw glob syntax; encoded braces remain literal URL text.
 * @param {string} value
 * @param {boolean} [glob]
 * @returns {string}
 */
function canonicalRouteUrl(value, glob = false) {
  let encoded = encodeURI(value.replace(/[\t\r\n]/g, "").trim().toWellFormed());
  if (glob) encoded = encoded.replace(/%7B/g, "{").replace(/%7D/g, "}").replace(/%5C/g, "\\");
  return encoded.replace(/%25([0-9a-f]{2})/gi, "%$1").replace(/%[0-9a-f]{2}/gi, escape => {
    const char = String.fromCharCode(parseInt(escape.slice(1), 16));
    return /^[A-Za-z0-9._~-]$/.test(char) ? char : escape.toUpperCase();
  });
}

// Playwright's URL globs: * stays within a path component, ** crosses /, **/ can match
// zero directories, {a,b} is an alternative, and backslash quotes a character. ? is literal.
// Keep this matcher local to command admission; it never runs code supplied by the Tester.
/**
 * @param {string} glob
 * @returns {RegExp | null}
 */
function routeGlob(glob) {
  const tokens = ["^"];
  let group = false;
  const literal = (/** @type {string} */ c) => c.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "\\" && i + 1 < glob.length) tokens.push(literal(glob[++i]));
    else if (c === "*") {
      let stars = 1;
      while (glob[i + 1] === "*") { stars++; i++; }
      if (stars > 1 && glob[i + 1] === "/") { tokens.push("(?:.*/)?"); i++; }
      else tokens.push(stars > 1 ? ".*" : "[^/]*");
    } else if (c === "{") {
      if (group) return null;
      group = true;
      tokens.push("(?:");
    } else if (c === "}") {
      if (!group) return null;
      group = false;
      tokens.push(")");
    } else tokens.push(c === "," && group ? "|" : literal(c));
  }
  return group ? null : new RegExp(tokens.join("") + "$");
}

/**
 * Resolve only the authority with URL, preserving the path's glob syntax (URL encodes braces
 * and changes backslashes). With no baseURL in the browser, the emitted glob is always absolute.
 * A refusal's optional `url` is the only safe pattern the trace may retain: no credentials or
 * query, no malformed URL or dot segments, and only the origin when off target.
 * @param {string | undefined} raw
 * @param {string} origin
 * @param {readonly string[]} [routeOrigins] the origins of the project's other configured targets, which a
 *   full URL may also name
 * @returns {{ pattern: string, origin: string, ok: true } | TesterCommandRefusal}
 */
export function routePattern(raw, origin, routeOrigins = []) {
  if (!raw) return no("route_bad_pattern", "A route needs a non-empty URL pattern");
  const full = /^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/([^/?#]*)([\s\S]*)$/.exec(raw);
  if (full && /[*{}\\]/.test(full[1])) return no("route_host_glob", "The route host must be literal");
  let url;
  try { url = new URL(raw, `${origin}/`); }
  catch { return no("route_bad_pattern", "The route pattern is not a valid URL or target path"); }
  if (!full && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) return no("route_bad_pattern", "A full route URL needs // before the host");
  const path = full ? full[2] : raw;
  // URL removes literal and percent-encoded dot segments before Playwright matches the glob.
  // Refuse them rather than checking a prefix or login URL the browser will never use. Include
  // backslash separators and URL-ignored whitespace so they cannot disguise a dot segment.
  const segments = path.split(/[?#]/)[0].replace(/[\t\r\n]/g, "").trim().split(/[/\\]/);
  const dotSegment = segments.some(segment => /^(?:\.|%2e){1,2}$/i.test(segment));
  const base = full && routeOrigins.includes(url.origin) ? url.origin : origin;
  const pattern = base + (path.startsWith("/") ? "" : "/") + path;
  const cut = dotSegment ? undefined : url.origin === base ? pattern.split(/[?#]/)[0] : url.origin;
  /** @param {string} code @param {string} error @returns {TesterCommandRefusal} */
  const refuse = (code, error) => ({ ...no(code, error), ...(cut && { url: cut }) });
  if (url.username || url.password) return refuse("route_credentials", "A route URL cannot contain credentials");
  if (url.origin !== base && url.protocol !== new URL(origin).protocol) return refuse("route_scheme", "A route uses the target's scheme");
  if (url.origin !== base) return refuse("route_off_target", "A route stays on the target origin or another configured target's origin");
  if (dotSegment) return refuse("route_dot_segment", "A route pattern cannot contain dot path segments");
  return { ok: true, pattern, origin: base };
}

// `words` is `[<command>, <arg>…]`; `{origin, uploads}` is the Execution's target origin and its
// `guard.uploads`. `{ok: true, command, argv, tabs, typed?, href?}` or `{ok: false, code, error}`:
// `argv` follows the command name, `tabs` says every tab is checked afterwards, `typed` is the text
// the guard masks, `href` the resolved URL of a `goto`.
/**
 * @param {readonly string[]} words
 * @param {{ origin: string, uploads: Record<string, string>, loginUrls?: readonly string[], routeOrigins?: readonly string[], signInUrls?: readonly string[] }} options
 * @returns {TesterCommandResult}
 */
export function parseTesterCommand(words, { origin, uploads, loginUrls = [], routeOrigins = [], signInUrls = [] }) {
  const [command, ...rawArgs] = words;
  if (typeof command !== "string" || !TESTER_ALLOWED.includes(/** @type {TesterAllowedCommand} */ (command))) return no("unknown_command", `\`${command ?? ""}\` is not a tester command; the commands are ${TESTER_ALLOWED.join(", ")}`);
  if (rawArgs.some((a) => typeof a !== "string" || a.includes("\0"))) return no("bad_arguments", `${command} takes plain text arguments`);
  let args = rawArgs;
  /** @type {string | undefined} */
  let expect;
  if (EXPECT_COMMANDS.has(command) && args.length > 0 && args[args.length - 1].startsWith("--expect=")) {
    const value = args[args.length - 1].slice("--expect=".length);
    if (value === "") return no("bad_expect", "`--expect=` needs non-empty text");
    expect = value;
    args = args.slice(0, -1);
  }
  const withExpect = (/** @type {{ typed?: string, href?: string, tabs?: boolean, route?: ExecutionRoute, logged?: string[], secret?: true }} */ extra = {}) => ({ ...extra, ...(expect !== undefined && { expect }) });
  const count = (/** @type {number} */ min, /** @type {number} */ max, /** @type {string} */ usage) => (args.length < min || args.length > max ? no("bad_arguments", `usage: ${command} ${usage}`) : null);
  const ref = () => (args[0] === "" || args[0].startsWith("-") ? no("bad_ref", `\`${command}\` needs a <ref> from the snapshot, which never starts with \`-\``) : null);

  switch (/** @type {TesterAllowedCommand} */ (command)) {
    case "go-back": case "reload": case "snapshot": case "screenshot": case "tab-list": case "dialog-dismiss": case "console":
      return count(0, 0, "(no arguments)") ?? yes(command, []);
    case "route": case "unroute": {
      if (command === "unroute") {
        const bad = count(0, 1, "['<pattern>']");
        if (bad) return bad;
        if (!args.length) return yes(command, [], { route: { unroute: true }, logged: [] });
      }
      const resolved = routePattern(args[0], origin, routeOrigins);
      if (!resolved.ok) return resolved;
      const { pattern } = resolved;
      // Removing a route cannot intercept login traffic or widen the account's access.
      if (command === "unroute") return yes(command, ["--", pattern], { route: { unroute: true, pattern }, logged: [pattern] });
      // Login classification ignores query parameters. Compare the pattern's path to that URL,
      // so a query-specific route cannot evade the sign-in boundary.
      const glob = routeGlob(canonicalRouteUrl(pattern.replaceAll("\\?", "?").split("?")[0], true));
      if (!glob) return no("route_bad_pattern", "The route glob has unbalanced or nested braces");
      // On another configured origin, the sign-in URLs Training names there stand in for the
      // session's; with none known, nothing says which of its requests sign in, so refuse.
      const known = [...(resolved.origin === origin ? loginUrls : []), ...signInUrls.filter((url) => new URL(url).origin === resolved.origin)];
      if (resolved.origin !== origin && !known.length) return no("route_sign_in_unknown", `No sign-in URL is known on ${resolved.origin}: name it in an Access note's \`identifiers.sign_in_urls\` in \`.qa/train/access.md\``);
      if (known.some(url => glob.test(canonicalRouteUrl(url.split(/[?#]/)[0])))) return no("route_login_url", "A route cannot match a sign-in URL: the session's login URL, or one an Access note names");
      /** @type {Record<string, string>} */
      const options = {};
      for (const arg of args.slice(1)) {
        const at = arg.indexOf("=");
        const name = at < 0 ? arg : arg.slice(0, at);
        if (name === "--header") return no("route_header", "Routes cannot rewrite outgoing request headers with --header");
        if (name === "--remove-header") return no("route_remove_header", "Routes cannot rewrite outgoing request headers with --remove-header");
        if (!["--status", "--body", "--content-type"].includes(name)) return no("route_unknown_option", "route takes only --status=, --body= and --content-type=");
        if (Object.hasOwn(options, name)) return no("route_repeated_option", "Each route option appears at most once");
        if (at < 0) return no("route_option_value", "Route options need = followed by their value");
        options[name] = arg.slice(at + 1);
      }
      const status = options["--status"];
      const body = options["--body"];
      const contentType = options["--content-type"];
      if (status !== undefined && (!/^[0-9]{3}$/.test(status) || Number(status) < 100 || Number(status) > 599)) return no("route_status", "--status= needs an integer from 100 through 599");
      if (contentType !== undefined && !["application/json", "text/plain"].includes(contentType)) return no("route_content_type", "--content-type= takes application/json or text/plain");
      const bytes = body === undefined ? undefined : Buffer.byteLength(body, "utf8");
      if (bytes !== undefined && bytes > 65536) return no("route_body_too_large", "A route body is at most 65,536 UTF-8 bytes");
      if (status === undefined && body === undefined) return no("route_no_response", "route needs --status= or --body= to answer a request");
      /** @type {ExecutionRoute} */
      const route = { pattern, ...(status !== undefined && { status: Number(status) }), ...(contentType !== undefined && { content_type: contentType }), ...(bytes !== undefined && { body_bytes: bytes }) };
      const answers = [
        ...(status !== undefined ? [{ sent: `--status=${Number(status)}`, logged: `--status=${Number(status)}` }] : []),
        ...(body !== undefined ? [{ sent: `--body=${body}`, logged: `--body=${bytes} bytes` }] : []),
        ...(contentType !== undefined ? [{ sent: `--content-type=${contentType}`, logged: `--content-type=${contentType}` }] : []),
      ];
      return yes(command, [...answers.map((answer) => answer.sent), "--", pattern], {
        route, typed: body,
        logged: [pattern, ...answers.map((answer) => answer.logged)],
      });
    }
    case "goto": {
      const bad = count(1, 1, "<url>");
      if (bad) return bad;
      let url;
      try {
        url = new URL(args[0], `${origin}/`);
      } catch {
        return no("bad_url", "`goto` needs an http or https URL");
      }
      // What the trace may keep of a URL with credentials in it: its origin and path, its origin when off the target.
      if (url.username || url.password) return { ...no("bad_url", "`goto` needs an http or https URL without credentials in it"), url: url.origin === origin ? url.origin + url.pathname : url.origin };
      if (!["http:", "https:"].includes(url.protocol)) return no("bad_url", "`goto` needs an http or https URL");
      return yes(command, [url.href], { href: url.href });
    }
    case "click": case "dblclick": {
      const bad = count(1, 2, `<ref> [left|right|middle] ${EXPECT_USAGE}`) ?? ref();
      if (bad) return bad;
      if (args[1] !== undefined && !BUTTON.test(args[1])) return no("bad_arguments", `usage: ${command} <ref> [left|right|middle] ${EXPECT_USAGE}`);
      return yes(command, args, withExpect());
    }
    case "check": case "uncheck":
      return count(1, 1, `<ref> ${EXPECT_USAGE}`) ?? ref() ?? yes(command, args, withExpect());
    case "hover":
      return count(1, 1, "<ref>") ?? ref() ?? yes(command, args);
    case "fill": {
      const bad = count(2, 3, `<ref> <text> [--submit] ${EXPECT_USAGE}`) ?? ref();
      if (bad) return bad;
      const submit = args.length === 3;
      if (submit && args[2] !== "--submit") return no("bad_arguments", `usage: fill <ref> <text> [--submit] ${EXPECT_USAGE}`);
      return yes(command, [args[0], ...(submit ? ["--submit"] : []), "--", args[1]], withExpect({ typed: args[1], tabs: submit }));
    }
    // The wrapper types the Role's password itself: argv holds only the ref, and `secret` tells it to.
    case "fill-password":
      return count(1, 1, "<ref>") ?? ref() ?? yes(command, [args[0]], { secret: true });
    case "select":
      return count(2, 2, `<ref> <value> ${EXPECT_USAGE}`) ?? ref() ?? yes(command, [args[0], "--", args[1]], withExpect());
    case "press":
      return count(1, 1, `<key> ${EXPECT_USAGE}`) ?? (KEY.test(args[0]) ? yes(command, args, withExpect()) : no("bad_arguments", "`press` takes one key, such as Enter or Control+a"));
    case "tab-select":
      return count(1, 1, "<n>") ?? (/^[0-9]+$/.test(args[0]) ? yes(command, args) : no("bad_arguments", "`tab-select` takes a tab number from `tab-list`"));
    case "dialog-accept": {
      const bad = count(0, 1, "[<text>]");
      return bad ?? yes(command, args.length ? ["--", args[0]] : [], args.length ? { typed: args[0] } : {});
    }
    case "upload": {
      const bad = count(1, 1, "<fixture-name>");
      if (bad) return bad;
      if (!isFixtureName(args[0]) || !Object.hasOwn(uploads, args[0])) return no("bad_upload", "`upload` takes the bare name of a fixture the brief lists");
      return yes(command, [uploads[args[0]]]);
    }
  }
}
