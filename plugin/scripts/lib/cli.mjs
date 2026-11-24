// @ts-check
// The command line's adapter: scripts/scan.mjs names each mode's command module, and this
// runs one call against it. Nothing here knows a mode beyond what its command declares.
//
// A command is `{actions: {<name>: {options, usage, run}}}`, or `{options, usage, run}` for a
// mode that takes no action. A command may give `options` beside its `actions` instead, and then
// no action gives its own: its actions share them, and they may come before the action.
// `run(args, ctx)` returns, or resolves, `{exit, json}`; a refusal is one too, `json.ok` false.
// A usage error is a thrown `UsageError`, from the adapter or from `run`: emitted `{ok: false,
// refusals: [{code, ...facts}]}`, exit 2.
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
// An action that declares `stdin: "flag"` also takes `--input <path>`, which the adapter adds:
// it reads the same bytes from that file, so an agent writes its input to a file and runs one
// plain command, with no pipe or heredoc. `--stdin` and `--input` together are a usage error.
//
// `ctx` is the options as resolved, plus `stdin` (a reader of the action's input when `--stdin` or
// `--input` was given, else null), `input` (a reader of stdin, always: input is read from it with
// no flag), `seed` (`QA_SKILLS_MINT_SEED`, which only a test sets) and `env` (the caller's environment).
/** @import { MigrationStatus } from "./migration-status.mjs" */
/** @import { PlatformContext } from "./platform.mjs" */
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { repositoryOf, resolveRef } from "./git-tree.mjs";
import { migrationStatus } from "./migration-status.mjs";
import { loadWorkingTree } from "./qa-index.mjs";
import { refuse } from "./refusal.mjs";
import { runDirRoot } from "./run-dir.mjs";

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
 *   omitMigration?: boolean,
 * }} CommandAction
 */

/**
 * @typedef {{
 *   options?: OptionSpec,
 *   usage?: string | readonly string[],
 *   actions?: Record<string, CommandAction>,
 *   parse?: (argv: readonly string[]) => { positional: string[], options: Record<string, unknown> },
 *   run?(args: string[], ctx: CommandContext): CommandResult | Promise<CommandResult>,
 *   omitMigration?: boolean,
 * }} CommandDefinition
 */

/**
 * @typedef {Record<string, CommandDefinition>} CommandRegistry
 */

/**
 * @typedef {Error & { detail: Record<string, unknown> }} UsageError
 */

// A usage error. `detail.code` names the refusal code and remaining properties become its facts
// (defaulting to `usage_error` with `reason`). It is a class expression typed by its construct
// signature: a declared `class ... extends Error` would put `Error`'s own statics
// (`prepareStackTrace` is typed `any` in @types/node) on the export, which scripts/check-types.mjs walks.
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
  if (args.length) throw new UsageError(`${command} takes no arguments, only ${only}`, { code: "bad_arguments", command, only });
}

/**
 * @param {string} command
 * @param {unknown} value
 * @param {string} option
 * @param {string} what
 * @returns {void}
 */
export function requireOption(command, value, option, what) {
  if (value === undefined) throw new UsageError(`${command} needs ${option}, ${what}`, { code: "missing_option", command, option, what });
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

/**
 * Extracts the first string value from a parsed option (`string` or `string[]`).
 * @param {unknown} value
 * @returns {string | undefined}
 */
function firstString(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" ? candidate : undefined;
}

/**
 * Resolves the `.qa/` root for `migration`: an explicitly passed `--root`, else the root recorded
 * in `--dir`, else the resolved `root` (which `resolveOptions` defaults to `".qa"`). A run dir whose
 * state files carry no `root` (`design override`, `design keep`) falls back to that same default.
 * @param {Record<string, unknown> | undefined} options
 * @param {string | undefined} explicitRoot
 * @returns {string}
 */
function resolveQaRoot(options, explicitRoot) {
  if (typeof explicitRoot === "string") return explicitRoot;
  const dir = firstString(options?.dir ?? options?.out);
  if (dir !== undefined) return runDirRoot(dir) ?? ".qa";
  // Neither `--root` nor `--dir` was passed: match `migration-status` (`root: "qa-dir?"`), which defaults `--root` to `".qa"`.
  return typeof options?.root === "string" ? options.root : ".qa";
}

/**
 * Whether `json` already carries the migration status: at the top level, or in a `global` object.
 * @param {Record<string, unknown>} json
 * @returns {boolean}
 */
function carriesMigration(json) {
  if (Object.hasOwn(json, "migration")) return true;
  const global = json.global;
  return global !== null && typeof global === "object" && Object.hasOwn(global, "migration");
}

// One call: `[mode, ...argv]` against `modes` ({mode: command}). Returns `{exit, json}`, `json`
// carrying `mode` first and `migration` on non-usage-error outputs; a promise of it when the
// action's `run` returns one.
/**
 * @param {CommandRegistry} modes
 * @param {readonly string[]} param1
 * @param {{ env: Record<string, string | undefined>, input: () => string, platformContext?: PlatformContext }} param2
 * @returns {CommandResult | Promise<CommandResult>}
 */
export function runCommand(modes, [mode, ...argv], { env, input, platformContext }) {
  const command = Object.hasOwn(modes, mode ?? "") ? modes[mode] : null;
  /** @type {(CommandDefinition | CommandAction) | undefined} */
  let entry;
  /** @type {Record<string, unknown> | undefined} */
  let parsedOptions;
  /** @type {string | undefined} */
  let explicitRoot;
  let isCliUsageError = false;
  /**
   * @param {CommandResult} param0
   * @param {boolean} [usageError]
   * @returns {CommandResult}
   */
  const done = ({ exit, json }, usageError = false) => {
    if (usageError || entry?.omitMigration || command?.omitMigration || carriesMigration(json)) {
      return { exit, json: { mode: mode ?? null, ...json } };
    }
    /** @type {MigrationStatus} */
    const migration = migrationStatus(loadWorkingTree(resolveQaRoot(parsedOptions, explicitRoot)));
    return { exit, json: { mode: mode ?? null, migration, ...json } };
  };
  /**
   * @param {unknown} e
   * @returns {CommandResult}
   */
  const refused = (e) => {
    if (!(e instanceof UsageError)) throw e;
    const { code, ...rest } = e.detail ?? {};
    const result =
      typeof code === "string" && code.length > 0
        ? refuse(code, rest)
        : refuse("usage_error", { ...rest, reason: e.message });
    // A usage error from the shared parser is exempt from `migration`.
    return done(result, isCliUsageError);
  };
  try {
    isCliUsageError = true;
    if (!command) throw new UsageError(mode ? `unknown mode \`${mode}\`; ${usage(modes)}` : usage(modes), { code: "unknown_mode", ...(mode !== undefined && { mode }), usage: usage(modes) });
    // A command with its own `options` shares them across its actions, and its action is the first
    // argument that is no option; else the action comes first and takes its own.
    entry = command;
    let { positional, options } = command.options ? parseArgs(argv, withInputFile(command.options)) : /** @type {{ positional: string[], options: Record<string, unknown> }} */ ({ positional: argv });
    if (command.actions) {
      const names = Object.keys(command.actions);
      const action = positional[0];
      if (!Object.hasOwn(command.actions, action ?? "")) throw new UsageError(`${mode} takes an action: ${names.join(", ")}`, { code: "unknown_action", action, actions: names });
      entry = { ...command.actions[action], options: command.options ?? command.actions[action].options };
      positional = positional.slice(1);
    }
    const spec = /** @type {OptionSpec} */ (entry.options);
    if (!command.options) ({ positional, options } = entry.parse ? entry.parse(positional) : parseArgs(positional, withInputFile(spec)));
    parsedOptions = validateOptionConflicts(options, spec);
    explicitRoot = typeof parsedOptions.root === "string" ? parsedOptions.root : undefined;
    isCliUsageError = false;
    const resolved = resolveOptions(parsedOptions, spec);
    parsedOptions = resolved;
    const file = /** @type {string | undefined} */ (resolved.input);
    delete resolved.input;
    /** @type {CommandContext} */
    const ctx = {
      ...resolved,
      stdin: file !== undefined ? inputFile(file) : resolved.stdin ? input : null,
      input,
      seed: env.QA_SKILLS_MINT_SEED,
      env,
      ...(platformContext && { platformContext }),
    };
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

// `spec` as the command line reads it: with `input: "value"` beside a declared `stdin: "flag"`.
/**
 * @param {OptionSpec | undefined} spec
 * @returns {OptionSpec}
 */
export function withInputFile(spec = {}) {
  return spec.stdin === "flag" && !Object.hasOwn(spec, "input") ? { ...spec, input: "value" } : spec;
}

// A reader of `--input <path>`'s bytes, the same text `--stdin` would read: a file that cannot be
// read is a usage error when the action reads it.
/**
 * @param {string} path
 * @returns {() => string}
 */
function inputFile(path) {
  return () => {
    try {
      return readFileSync(path, "utf8");
    } catch (e) {
      const reason = /** @type {NodeJS.ErrnoException} */ (e).code ?? /** @type {Error} */ (e).message;
      throw new UsageError(`--input ${path} cannot be read: ${reason}`, { code: "input_unreadable", path, reason });
    }
  };
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

// Checks mutual option conflicts (`--dir` + `--out`, `--stdin` + `--input`) as CLI usage errors
// before filesystem/git checks (`qa-dir`, `commit`) run.
/**
 * @param {Record<string, unknown>} options
 * @param {OptionSpec | undefined} spec
 * @returns {Record<string, unknown>}
 */
function validateOptionConflicts(options, spec = {}) {
  const resolved = { ...options };
  for (const [name, kind] of Object.entries(spec)) {
    if (kind !== "dir-alias") continue;
    if (options.dir !== undefined && options[name] !== undefined) throw new UsageError(`--${name} is --dir's old name: pass --dir only`, { code: "dir_and_out", old: `--${name}`, keep: "--dir" });
    resolved.dir = options.dir ?? options[name];
    delete resolved[name];
  }
  if (resolved.input !== undefined && resolved.stdin) throw new UsageError("pass --stdin or --input <path>, not both", { code: "stdin_and_input" });
  return resolved;
}

// `options` with `--root` and `--target` resolved as `spec` declares them.
/**
 * @param {Record<string, unknown>} options
 * @param {OptionSpec | undefined} spec
 * @returns {Record<string, unknown>}
 */
function resolveOptions(options, spec = {}) {
  const resolved = { ...options };
  for (const [name, kind] of Object.entries(spec)) {
    if (kind === "qa-dir" || kind === "qa-dir?") {
      resolved[name] = options[name] ?? ".qa";
      if (kind === "qa-dir" && !isDir(/** @type {string} */ (resolved[name]))) throw new UsageError(`no \`.qa/\` directory at ${resolved[name]}`, { code: "no_qa_dir", root: resolved[name] });
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

/**
 * Options controlling relaxed syntax accepted by `parseShellWords`. Defaults are fail-closed.
 * @typedef {{
 *   allowDoubleQuotes?: boolean,
 *   allowNewlines?: boolean,
 *   allowAndOperator?: boolean,
 * }} ShellWordOptions
 */

/**
 * Parse a shell command line into decoded literal words, returning `null` on any disallowed
 * quoting, operator, or control character.
 * @param {unknown} line
 * @param {ShellWordOptions} [options]
 * @returns {string[] | null}
 */
export function parseShellWords(line, options = {}) {
  const { allowDoubleQuotes = false, allowNewlines = false, allowAndOperator = false } = options;
  if (typeof line !== "string" || line.includes("\0") || (!allowNewlines && /[\r\n]/.test(line))) return null;
  const segment = allowDoubleQuotes
    ? /([A-Za-z0-9_@%+=:,./-]+)|'([^']*)'|\\(')|"([^"$`\\!]*)"/y
    : /([A-Za-z0-9_@%+=:,./-]+)|'([^']*)'|\\(')/y;
  /** @type {string[]} */
  const words = [];
  let offset = 0;
  while (offset < line.length) {
    if (line[offset] === " " || line[offset] === "\t") {
      offset++;
      continue;
    }
    if (
      allowAndOperator &&
      line.startsWith("&&", offset) &&
      (offset + 2 === line.length || line[offset + 2] === " " || line[offset + 2] === "\t")
    ) {
      words.push("&&");
      offset += 2;
      continue;
    }
    let decoded = "";
    let matched = false;
    for (;;) {
      segment.lastIndex = offset;
      const match = segment.exec(line);
      if (!match) break;
      matched = true;
      decoded += match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
      offset = segment.lastIndex;
    }
    if (!matched) return null;
    if (offset < line.length && line[offset] !== " " && line[offset] !== "\t") return null;
    words.push(decoded);
  }
  return words;
}
