// @ts-check
// The command line's adapter: scripts/scan.mjs names each mode's command module, and this
// runs one call against it. Nothing here knows a mode beyond what its command declares.
//
// A command is `{actions: {<name>: {options, usage, run}}, refuse?}`, or `{options, usage, run,
// refuse?}` for a mode that takes no action. A command may give `options` beside its `actions`
// instead, and then no action gives its own: its actions share them, and they may come before
// the action. `run(args, ctx)` returns, or resolves, `{exit, json}`;
// a refusal is one too, `json.ok` false. A usage error is a thrown `UsageError`, from the adapter or
// from `run`: printed `{ok: false, error}`, exit 2, unless the command's `refuse(e)` words it.
//
// `options` is `{name: kind}`. Kinds, as `parseArgs` reads them:
//   "value"     `--name <value>`
//   "values"    `--name <value>` repeated, collected into a list
//   "flag"      `--name`, `true`
//   "optional"  `--name [<value>]`, `true` when no value follows
//   "qa-dir"    `--root`: the `.qa/` directory, default `./.qa`, which must exist
//   "qa-dir?"   `--root`: the same, which need not exist yet
//   "commit"    `--target <ref>`: `{ref, commit}` inside the repository holding `root`, else null
//   "dir-alias" `--out`: `--dir`'s deprecated old name, read as `--dir`
// `usage` is the synopsis after `<mode> <action>`: a string, or one per form of the action.
// An action may give `parse(argv)` -> `{positional, options}` instead, for a tail that is not options at all
// (`tester do`'s command words); `options` then holds only the kinds `options` declares.
//
// `ctx` is the options as resolved, plus `stdin` (a reader of stdin when `--stdin` was given, else
// null), `input` (a reader of stdin, always: input is read from it with no flag), `seed`
// (`QA_SKILLS_MINT_SEED`, which only a test sets) and `env` (the caller's environment).
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { repositoryOf, resolveRef } from "./git-tree.mjs";

// The CLI's own entry, which a brief tells a subagent to run and a scout runs on its own account.
/** @type {string} */
export const SCAN_CLI = fileURLToPath(new URL("../scan.mjs", import.meta.url));

/**
 * @typedef {"value" | "values" | "flag" | "optional" | "qa-dir" | "qa-dir?" | "commit" | "dir-alias"} OptionKind
 * @typedef {Record<string, OptionKind>} OptionSpec
 */

/**
 * Command execution context provided to command action `run` functions.
 * @typedef {{
 *   stdin: (() => string) | null,
 *   input: () => string,
 *   seed: string | undefined,
 *   env: Record<string, string | undefined>,
 *   root?: string,
 *   dir?: string,
 *   target?: { ref: string, commit: string } | null,
 *   [key: string]: unknown,
 * }} CommandContext
 */

/**
 * @typedef {CommandContext} Context
 */

/**
 * @typedef {{
 *   exit: number,
 *   json: {
 *     ok?: boolean,
 *     mode?: string | null,
 *     [key: string]: unknown,
 *   },
 * }} CommandResult
 */

/**
 * A command action's `run` is declared as a method, so a handler may narrow `ctx` to the options its
 * own spec guarantees (`root` is a `.qa/` directory once the spec names `qa-dir`).
 * @typedef {{
 *   options?: OptionSpec,
 *   usage?: string | readonly string[],
 *   parse?: (argv: readonly string[]) => { positional: string[], options: Record<string, unknown> },
 *   run(args: string[], ctx: CommandContext): CommandResult | Promise<CommandResult>,
 * }} CommandAction
 */

/**
 * @typedef {{
 *   options?: OptionSpec,
 *   usage?: string | readonly string[],
 *   actions?: Record<string, CommandAction>,
 *   parse?: (argv: readonly string[]) => { positional: string[], options: Record<string, unknown> },
 *   run?(args: string[], ctx: CommandContext): CommandResult | Promise<CommandResult>,
 *   refuse?: (err: UsageError) => CommandResult,
 * }} CommandDefinition
 */

/**
 * @typedef {Record<string, CommandDefinition>} CommandRegistry
 */

/**
 * @typedef {Error & { detail: Record<string, unknown> }} UsageError
 */

// A usage error. `detail.code` names it, for a command that words its own refusals. It is a class
// expression typed by its construct signature: a declared `class ... extends Error` would put
// `Error`'s own statics (`prepareStackTrace` is typed `any` in @types/node) on the export, which
// scripts/check-types.mjs walks.
/**
 * @type {new (message: string, detail?: Record<string, unknown>) => UsageError}
 */
export const UsageError = class extends Error {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(message, detail = {}) {
    super(message);
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
};

// The usage errors an action's own arguments can raise, worded alike: `command` (such as "execute open")
// takes no positional argument, and needs the option `option` (`--execution <id>`), which `what` describes.
/**
 * @param {string} command
 * @param {readonly unknown[]} args
 * @param {string} only
 * @returns {void}
 */
export function noArguments(command, args, only) {
  if (args.length) throw new UsageError(`${command} takes no arguments, only ${only}`);
}

/**
 * @param {string} command
 * @param {unknown} value
 * @param {string} option
 * @param {string} what
 * @returns {void}
 */
export function requireOption(command, value, option, what) {
  if (value === undefined) throw new UsageError(`${command} needs ${option}, ${what}`);
}

// `result`, or its `error` thrown as a usage error: for a lib function that returns `{error}`.
/**
 * `result`, or its `error` thrown as a usage error: for a lib function that returns `{error}`.
 * @template [T=unknown]
 * @param {T} result
 * @returns {Exclude<T, { error: unknown }>}
 */
export function orThrow(result) {
  if (/** @type {{ error?: string }} */ (result).error) throw new UsageError(/** @type {{ error: string }} */ (result).error);
  return /** @type {Exclude<T, { error: unknown }>} */ (result);
}

// One call: `[mode, ...argv]` against `modes` ({mode: command}). Returns `{exit, json}`, `json`
// carrying `mode` first; a promise of it when the action's `run` returns one.
/**
 * @param {CommandRegistry} modes
 * @param {readonly string[]} param1
 * @param {{ env: Record<string, string | undefined>, input: () => string }} param2
 * @returns {CommandResult | Promise<CommandResult>}
 */
export function runCommand(modes, [mode, ...argv], { env, input }) {
  const command = Object.hasOwn(modes, mode ?? "") ? modes[mode] : null;
  /**
   * @param {CommandResult} param0
   * @returns {CommandResult}
   */
  const done = ({ exit, json }) => ({ exit, json: { mode: mode ?? null, ...json } });
  /**
   * @param {unknown} e
   * @returns {CommandResult}
   */
  const refused = (e) => {
    if (!(e instanceof UsageError)) throw e;
    return done(command?.refuse ? command.refuse(e) : { exit: 2, json: { ok: false, error: e.message } });
  };
  try {
    if (!command) throw new UsageError(mode ? `unknown mode \`${mode}\`; ${usage(modes)}` : usage(modes));
    // A command with its own `options` shares them across its actions, and its action is the first
    // argument that is no option; else the action comes first and takes its own.
    /** @type {CommandDefinition | CommandAction} */
    let entry = command;
    let { positional, options } = command.options ? parseArgs(argv, command.options) : /** @type {{ positional: string[], options: Record<string, unknown> }} */ ({ positional: argv });
    if (command.actions) {
      const names = Object.keys(command.actions);
      const action = positional[0];
      if (!Object.hasOwn(command.actions, action ?? "")) throw new UsageError(`${mode} takes an action: ${names.join(", ")}`, { code: "unknown_action", action, actions: names });
      entry = { ...command.actions[action], options: command.options ?? command.actions[action].options };
      positional = positional.slice(1);
    }
    if (!command.options) ({ positional, options } = entry.parse ? entry.parse(positional) : parseArgs(positional, /** @type {OptionSpec} */ (entry.options)));
    const resolved = resolveOptions(options, /** @type {OptionSpec} */ (entry.options));
    /** @type {CommandContext} */
    const ctx = { ...resolved, stdin: resolved.stdin ? input : null, input, seed: env.QA_SKILLS_MINT_SEED, env };
    // A command without actions always has `run`; the registry (R-close) states it per command.
    const result = /** @type {NonNullable<CommandDefinition["run"]>} */ (entry.run)(positional, ctx);
    return typeof (/** @type {Promise<CommandResult> | undefined} */ (result))?.then === "function" ? (/** @type {Promise<CommandResult>} */ (result)).then(done, refused) : done(/** @type {CommandResult} */ (result));
  } catch (e) {
    return refused(e);
  }
}

// Every mode's synopsis, one line each form: the text a bare or unknown mode prints. A mode kept
// as another's former name (the same command under a second name) prints only under the first
// name `modes` lists it by, so a registry lists the current name before the former one.
/**
 * @param {CommandRegistry} modes
 * @returns {string}
 */
export function usage(modes) {
  return `usage: scan.mjs ${Object.entries(modes)
    .filter(([mode, command], _, all) => all.find(([, other]) => other === command)?.[0] === mode)
    .flatMap(([mode, command]) => usageOf(mode, command))
    .join(" | ")}`;
}

// One mode's synopsis lines, `<mode> [<action>] <usage>`.
/**
 * @param {string} mode
 * @param {CommandDefinition} command
 * @returns {string[]}
 */
export function usageOf(mode, command) {
  /**
   * @param {string} prefix
   * @param {string | readonly string[] | undefined} u
   * @returns {string[]}
   */
  const forms = (prefix, u) => [u].flat().map((s) => (s ? `${prefix} ${s}` : prefix));
  if (!command.actions) return forms(mode, command.usage);
  return Object.entries(command.actions).flatMap(([name, a]) => forms(`${mode} ${name}`, a.usage));
}

// Positional arguments plus `--name value` / `--flag` options, checked against `spec`.
/**
 * @param {readonly string[]} argv
 * @param {OptionSpec} spec
 * @returns {{ positional: string[], options: Record<string, unknown> }}
 */
function parseArgs(argv, spec) {
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string, unknown>} */
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (!Object.hasOwn(spec, name)) throw new UsageError(`unknown option ${a}`, { code: "unknown_option", option: a });
    if (spec[name] === "flag") options[name] = true;
    else if (spec[name] === "values") {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new UsageError(`${a} needs a value`, { code: "option_needs_value", option: a });
      const list = /** @type {unknown[]} */ (options[name] ?? (options[name] = []));
      list.push(argv[++i]);
    }
    else if (spec[name] === "optional") options[name] = i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    else if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`, { code: "option_needs_value", option: a });
    else options[name] = argv[++i];
  }
  return { positional, options };
}

// `options` with `--root`, `--out` and `--target` resolved as `spec` declares them.
/**
 * @param {Record<string, unknown>} options
 * @param {OptionSpec} spec
 * @returns {Record<string, unknown>}
 */
function resolveOptions(options, spec) {
  const resolved = { ...options };
  for (const [name, kind] of Object.entries(spec)) {
    if (kind === "qa-dir" || kind === "qa-dir?") {
      resolved[name] = options[name] ?? ".qa";
      if (kind === "qa-dir" && !isDir(/** @type {string} */ (resolved[name]))) throw new UsageError(`no \`.qa/\` directory at ${resolved[name]}`, { code: "no_qa_dir", root: resolved[name] });
    } else if (kind === "dir-alias") {
      if (options.dir !== undefined && options[name] !== undefined) throw new UsageError(`--${name} is --dir's old name: pass --dir only`, { code: "dir_and_out" });
      resolved.dir = options.dir ?? options[name];
      delete resolved[name];
    }
  }
  for (const [name, kind] of Object.entries(spec)) if (kind === "commit") resolved[name] = targetOf(/** @type {string} */ (resolved.root), /** @type {string | undefined} */ (options[name]));
  return resolved;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

// `--target <ref>` as `{ref, commit}`, or null when absent.
/**
 * @param {string} root
 * @param {string | undefined} ref
 * @returns {{ ref: string, commit: string } | null}
 */
function targetOf(root, ref) {
  if (ref === undefined) return null;
  if (!repositoryOf(root)) throw new UsageError(`--target needs \`.qa/\` inside a git repository; ${root} is not`, { code: "target_outside_git", root });
  const commit = resolveRef(root, ref);
  if (!commit) throw new UsageError(`--target \`${ref}\` names no commit`, { code: "target_unknown", ref });
  return { ref, commit };
}
