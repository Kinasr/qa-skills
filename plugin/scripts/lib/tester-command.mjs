// @ts-check
// The closed command set of `tester do` and each command's fixed grammar. Pure: words in, the argv `playwright-cli` is called with out, or a refusal code. Nothing
// the Tester types is ever a flag: free text goes after a `--`, which playwright-cli's argument parser
// reads as "everything after is positional" (checked against 0.1.22), and a `<ref>` starting with `-`
// is refused.
import { isFixtureName } from "./keys.mjs";

/**
 * @typedef {"goto" | "go-back" | "reload" | "snapshot" | "screenshot" | "click" | "dblclick" | "fill" | "check" | "uncheck" | "select" | "hover" | "press" | "tab-list" | "tab-select" | "dialog-accept" | "dialog-dismiss" | "upload" | "console"} TesterAllowedCommand
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
 * }} TesterCommandRefusal
 */

/**
 * @typedef {TesterCommandSuccess | TesterCommandRefusal} TesterCommandResult
 */

/** @type {readonly TesterAllowedCommand[]} */
export const TESTER_ALLOWED = ["goto", "go-back", "reload", "snapshot", "screenshot", "click", "dblclick", "fill", "check", "uncheck", "select", "hover", "press", "tab-list", "tab-select", "dialog-accept", "dialog-dismiss", "upload", "console"];

/**
 * The commands whose first positional word is a snapshot ref, so an admitted one gets element
 * evidence. The wrapper reads this set; it is the one place a newly allowed ref command is named.
 * @type {ReadonlySet<TesterAllowedCommand>}
 */
export const ELEMENT_COMMANDS = new Set(["click", "dblclick", "fill", "select", "check", "uncheck", "hover"]);

/**
 * Actions with no element target: `press <key>` and `upload <fixture>`. Their evidence says
 * `target: "none"` and nothing more.
 * @type {ReadonlySet<TesterAllowedCommand>}
 */
export const REF_LESS_COMMANDS = new Set(["press", "upload"]);

const BUTTON = /^(left|right|middle)$/;
const KEY = /^(?:[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*|[^\sA-Za-z0-9])$/;
// After these, a new tab or a navigation may have taken the browser off the target (point 4).
const TABS_AFTER = new Set(["click", "dblclick", "press", "dialog-accept", "dialog-dismiss"]);

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
 * @param {{ typed?: string, href?: string, tabs?: boolean }} [extra]
 * @returns {TesterCommandSuccess}
 */
const yes = (command, argv, extra = {}) => ({ ok: true, command, argv, tabs: TABS_AFTER.has(command), ...extra });

// `words` is `[<command>, <arg>…]`; `{origin, uploads}` is the Execution's target origin and its
// `guard.uploads`. `{ok: true, command, argv, tabs, typed?, href?}` or `{ok: false, code, error}`:
// `argv` follows the command name, `tabs` says every tab is checked afterwards, `typed` is the text
// the guard masks, `href` the resolved URL of a `goto`.
/**
 * @param {readonly string[]} words
 * @param {{ origin: string, uploads: Record<string, string> }} options
 * @returns {TesterCommandResult}
 */
export function parseTesterCommand(words, { origin, uploads }) {
  const [command, ...args] = words;
  if (typeof command !== "string" || !TESTER_ALLOWED.includes(/** @type {TesterAllowedCommand} */ (command))) return no("unknown_command", `\`${command ?? ""}\` is not a tester command; the commands are ${TESTER_ALLOWED.join(", ")}`);
  if (args.some((a) => typeof a !== "string" || a.includes("\0"))) return no("bad_arguments", `${command} takes plain text arguments`);
  const count = (/** @type {number} */ min, /** @type {number} */ max, /** @type {string} */ usage) => (args.length < min || args.length > max ? no("bad_arguments", `usage: ${command} ${usage}`) : null);
  const ref = () => (args[0] === "" || args[0].startsWith("-") ? no("bad_ref", `\`${command}\` needs a <ref> from the snapshot, which never starts with \`-\``) : null);

  switch (/** @type {TesterAllowedCommand} */ (command)) {
    case "go-back": case "reload": case "snapshot": case "screenshot": case "tab-list": case "dialog-dismiss": case "console":
      return count(0, 0, "(no arguments)") ?? yes(command, []);
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
      const bad = count(1, 2, "<ref> [left|right|middle]") ?? ref();
      if (bad) return bad;
      if (args[1] !== undefined && !BUTTON.test(args[1])) return no("bad_arguments", `usage: ${command} <ref> [left|right|middle]`);
      return yes(command, args);
    }
    case "check": case "uncheck": case "hover":
      return count(1, 1, "<ref>") ?? ref() ?? yes(command, args);
    case "fill": {
      const bad = count(2, 3, "<ref> <text> [--submit]") ?? ref();
      if (bad) return bad;
      const submit = args.length === 3;
      if (submit && args[2] !== "--submit") return no("bad_arguments", "usage: fill <ref> <text> [--submit]");
      return yes(command, [args[0], ...(submit ? ["--submit"] : []), "--", args[1]], { typed: args[1], tabs: submit });
    }
    case "select":
      return count(2, 2, "<ref> <value>") ?? ref() ?? yes(command, [args[0], "--", args[1]]);
    case "press":
      return count(1, 1, "<key>") ?? (KEY.test(args[0]) ? yes(command, args) : no("bad_arguments", "`press` takes one key, such as Enter or Control+a"));
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
