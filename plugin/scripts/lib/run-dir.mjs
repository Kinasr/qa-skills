// @ts-check
// The run dir (ADR-0024): where a command that keeps a run (`sync`, `impact`, `design`,
// `delegate`, `init`) writes what a later call reads back. One convention for all of them:
//   - `--dir <run-dir>` names it. `--out` is the deprecated alias `impact plan`, `design plan` and
//     `design split` still take (lib/cli.mjs's `dir-alias` option).
//   - Every path is absolute, so the `dir` a command prints can be passed back from anywhere.
//   - A command that makes one makes it only once every check that can refuse the call has passed
//     (`newRunDir`'s `make`), so a refused call leaves no dir behind.
//   - Opening one tells a missing dir, a missing file and a corrupt file apart (`openRunDir`,
//     `readRunFile`), each naming the path and the command that recovers.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { drawKey } from "./keys.mjs";

// A Run is named by a random id: 8 lowercase Crockford characters from a CSPRNG, drawn as `mint`
// draws keys.
const RUN_ID_LENGTH = 8;
/**
 * @returns {string}
 */
export const newRunId = () => drawKey(RUN_ID_LENGTH);

/**
 * @typedef {{
 *   dir: string | null,
 *   exists: boolean,
 *   make(): string,
 *   error?: undefined,
 * } | {
 *   error: string,
 *   dir?: undefined,
 *   exists?: undefined,
 *   make?: undefined,
 * }} NewRunDirResult
 */

// A run dir a call may make: `dir` (absolute; null until a temp dir is made when `--dir` named
// none), whether it already `exists`, and `make()`, which makes it (a fresh `<prefix>*` dir in the
// OS temp dir, else `dir` with its parents) and returns its absolute path. Nothing is made until
// `make()` is called. `{error}` when `--dir` names something that is not a directory.
/**
 * @param {string | undefined} dir
 * @param {string} prefix
 * @returns {NewRunDirResult}
 */
export function newRunDir(dir, prefix) {
  const abs = dir === undefined ? null : resolve(dir);
  if (abs !== null && existsSync(abs) && !isDir(abs)) return { error: `${abs} is not a run dir: name a directory, or a path that does not exist yet` };
  return {
    dir: abs,
    exists: abs !== null && isDir(abs),
    make() {
      if (abs === null) return mkdtempSync(join(tmpdir(), prefix));
      mkdirSync(abs, { recursive: true });
      return abs;
    },
  };
}

/**
 * @typedef {{ dir: string, error?: undefined } | { error: string, dir?: undefined }} OpenRunDirResult
 */

// An existing run dir `--dir` names, for `<cmd> <action>`, which a `from` call made (one command,
// or a list of the commands that may have): `{dir}`, absolute, or `{error}`.
/**
 * @param {string | undefined} dir
 * @param {{ cmd: string, action: string, from: string | readonly string[] }} options
 * @returns {OpenRunDirResult}
 */
export function openRunDir(dir, { cmd, action, from }) {
  if (dir === undefined) return { error: needsDir(cmd, action, from) };
  const abs = resolve(dir);
  if (!isDir(abs)) return { error: `no run dir at ${abs}: run ${commands(from)} first` };
  return { dir: abs };
}

/**
 * @template [T=unknown]
 * @typedef {{ dir: string, plan: T, error?: undefined } | { error: string, dir?: undefined, plan?: undefined }} OpenPlanResult
 */

// The run dir `--dir` names for `<cmd> <action>`, which takes no other argument, and the plan
// `<cmd> plan` left in it: `{dir, plan}`, absolute, or `{error}`.
/**
 * @template [T=unknown]
 * @param {string} cmd
 * @param {string} action
 * @param {readonly string[]} args
 * @param {string | undefined} dir
 * @returns {OpenPlanResult<T>}
 */
export function openPlan(cmd, action, args, dir) {
  const from = `${cmd} plan`;
  if (args.length !== 0) return { error: `${cmd} ${action} takes no arguments, only --dir <run-dir>` };
  const run = openRunDir(dir, { cmd, action, from });
  if (run.error) return /** @type {OpenPlanResult<T>} */ (run);
  /** @type {RunFileResult<T>} */
  const plan = readRunFile(/** @type {string} */ (run.dir), "plan.json", { by: from, restart: from, missing: `no plan in ${run.dir}: run \`${from}\` first` });
  return plan.error ? /** @type {OpenPlanResult<T>} */ (plan) : { dir: /** @type {string} */ (run.dir), plan: /** @type {T} */ (plan.value) };
}

/**
 * @template [T=unknown]
 * @typedef {{ value: T, error?: undefined } | { value: null, error?: undefined } | { error: string, value?: undefined }} RunFileResult
 */

// A JSON file in a run dir, which `by` wrote: `{value}`, or `{error}`. An absent file is
// `{value: null}` when `missing` is undefined, else the usage error `missing`. A file that cannot
// be read, which names its cause, or is not JSON is always a usage error; `restart` names what starts a fresh run. `by` and `restart` are
// each a command or a list of them.
/**
 * @template [T=unknown]
 * @param {string} dir
 * @param {string} name
 * @param {{ by: string | readonly string[], restart: string | readonly string[], missing?: string }} options
 * @returns {RunFileResult<T>}
 */
export function readRunFile(dir, name, { by, restart, missing }) {
  const path = join(dir, name);
  if (!existsSync(path)) return missing === undefined ? { value: null } : { error: missing };
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const cause = /** @type {NodeJS.ErrnoException} */ (error).code ?? String(error);
    return { error: `${path} cannot be read (${cause}): start a new run with ${commands(restart)}` };
  }
  try {
    return { value: /** @type {T} */ (JSON.parse(text)) };
  } catch {
    return { error: `${path} is not the JSON ${commands(by)} wrote: start a new run with ${commands(restart)}` };
  }
}

// The usage error of `<cmd> <action>` called without the run dir `from` printed.
/**
 * @param {string} cmd
 * @param {string} action
 * @param {string | readonly string[]} from
 * @returns {string}
 */
function needsDir(cmd, action, from) {
  return `${cmd} ${action} needs --dir <run-dir>, the \`dir\` ${[from].flat().join(" or ")} printed`;
}

// One command or a list of them, as a message names them: "`a`" or "`a` or `b`".
/**
 * @param {string | readonly string[]} from
 * @returns {string}
 */
const commands = (from) => [from].flat().map((c) => `\`${c}\``).join(" or ");

/**
 * @param {string} path
 * @returns {boolean}
 */
function isDir(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

const PRIMARY_STATE_FILES = [
  "execute.json",
  "plan.json",
  "dispatch.spec.json",
  "dispatch.json",
  "codegen.json",
  "follow-ups.json",
  "run.json",
  "publish.json",
  "card.json",
  "change.json",
  "scout-ui.json",
  "scout-tracker.json",
  "automation.json",
];

let stageSeq = 0;

/**
 * A staged JSON write ready to commit atomically or abort.
 * @typedef {{
 *   path: string,
 *   temp: string,
 *   commit: () => void,
 *   abort: () => void,
 * }} StagedJson
 */

/**
 * Stages `value` formatted as JSON in a unique temporary file beside `path`, returning commit
 * and abort handles.
 * @param {string} path
 * @param {unknown} value
 * @param {{ compact?: boolean }} [options]
 * @returns {StagedJson}
 */
export function stageJson(path, value, { compact = false } = {}) {
  const temp = `${path}.tmp.${process.pid}.${++stageSeq}`;
  const body = compact ? `${JSON.stringify(value)}\n` : `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(temp, body);
  } catch (err) {
    try { rmSync(temp, { force: true }); } catch {}
    throw err;
  }
  let settled = false;
  return {
    path,
    temp,
    commit() {
      if (settled) throw new Error(`staged JSON already settled: ${path}`);
      settled = true;
      try {
        renameSync(temp, path);
      } catch (err) {
        try { rmSync(temp, { force: true }); } catch {}
        throw err;
      }
    },
    abort() {
      if (settled) return;
      settled = true;
      try { rmSync(temp, { force: true }); } catch {}
    },
  };
}

/**
 * Writes `value` formatted as JSON atomically via a unique temporary file and rename.
 * @param {string} path
 * @param {unknown} value
 * @param {{ compact?: boolean }} [options]
 * @returns {void}
 */
export function writeJsonAtomic(path, value, options) {
  stageJson(path, value, options).commit();
}

/**
 * Finds the `.qa/` root recorded in a run directory's state JSON file, prioritizing
 * command-primary state files over alphabetical remaining `*.json` files.
 * @param {string} dir
 * @returns {string | undefined}
 */
export function runDirRoot(dir) {
  if (!isDir(dir)) return undefined;
  const names = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const primary = PRIMARY_STATE_FILES.filter((name) => names.includes(name));
  const extra = names.filter((name) => !PRIMARY_STATE_FILES.includes(name));
  for (const name of [...primary, ...extra]) {
    try {
      const data = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (typeof data?.root === "string") return data.root;
    } catch {
      // Unreadable or non-JSON file falls through to the next candidate.
    }
  }
  return undefined;
}
