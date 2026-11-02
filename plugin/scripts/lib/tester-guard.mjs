// @ts-check
import { lstatSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, sep } from "node:path";
import { tailOptions } from "./tester.mjs";

/**
 * Binding marker parsed from the first line of an Execution brief.
 * @typedef {{
 *   run: string,
 *   execution: string,
 * }} BindingMarker
 */

/**
 * Tester binding written to `executions/<id>/tester.json`.
 * @typedef {{
 *   agent_id: string,
 * }} TesterBinding
 */

/**
 * Result of binding a Tester to an Execution.
 * @typedef {{ execDir: string } | { error: string }} BindTesterResult
 */

/** @type {"qa-skills:tester"} */
export const TESTER_AGENT = "qa-skills:tester";
const BINDING_FILE = "tester.json";
const ID = /^[A-Za-z0-9_-]+$/;
const MARKER = /^<!-- qa-execute-binding (\{.*\}) -->$/;

/**
 * The first line of every Execution brief: the binding hook reads it from the Tester's prompt.
 * @param {string} runDir
 * @param {string} id
 * @returns {string}
 */
export const bindingLine = (runDir, id) => `<!-- qa-execute-binding ${JSON.stringify(/** @type {BindingMarker} */ ({ run: runDir, execution: id }))} -->`;

/**
 * The Execution directory a guard and a binding make real, or null: `execDir` resolved, holding a
 * plain `guard.json`.
 * @param {string} execDir
 * @returns {string | null}
 */
function guardedDir(execDir) {
  try {
    const real = realpathSync(execDir);
    const guard = join(real, "guard.json");
    return realpathSync(guard) === guard && statSync(guard).isFile() ? real : null;
  } catch {
    return null;
  }
}

/**
 * Whether the guarded Execution at `execDir` was launched as the subagent `agentId` (its own
 * `tester.json`, written by `bindTester` from the launch, never by the Tester).
 * @param {string} execDir
 * @param {string | undefined} agentId
 * @returns {boolean}
 */
function boundTo(execDir, agentId) {
  if (typeof agentId !== "string" || !agentId) return false;
  const real = guardedDir(execDir);
  if (!real) return false;
  try {
    const file = join(real, BINDING_FILE);
    if (realpathSync(file) !== file || !statSync(file).isFile()) return false;
    /** @type {TesterBinding} */
    return /** @type {{ agent_id?: string } | null} */ (JSON.parse(readFileSync(file, "utf8")))?.agent_id === agentId;
  } catch {
    return false;
  }
}

/**
 * PostToolUse of the session's own `Agent` call: binds the launched Tester's `agentId` to the
 * Execution its brief names, so the guard admits it there and nowhere else. A relaunch rebinds.
 * Returns null for any other launch, else `{execDir}` or `{error}`.
 * @param {{
 *   tool_name?: string,
 *   tool_input?: {
 *     subagent_type?: string | null,
 *     prompt?: string | null,
 *     [key: string]: unknown,
 *   } | null,
 *   tool_response?: {
 *     agentId?: string | null,
 *     [key: string]: unknown,
 *   } | null,
 *   [key: string]: unknown,
 * } | null | undefined} event
 * @returns {BindTesterResult | null}
 */
export function bindTester(event) {
  if (event?.tool_input?.subagent_type !== TESTER_AGENT) return null;
  const agentId = event.tool_response?.agentId;
  const prompt = event.tool_input.prompt;
  if (typeof agentId !== "string" || !agentId) return { error: "the launch returned no agent id" };
  const marker = typeof prompt === "string" ? MARKER.exec(prompt.split("\n")[0]) : null;
  /** @type {BindingMarker | null} */
  let named;
  try {
    named = /** @type {BindingMarker | null} */ (marker && JSON.parse(marker[1]));
  } catch {
    named = null;
  }
  if (!named || typeof named.run !== "string" || !isAbsolute(named.run) || typeof named.execution !== "string" || !ID.test(named.execution)) {
    return { error: "the prompt is not an Execution brief from `execute next`" };
  }
  const execDir = guardedDir(join(named.run, "executions", named.execution));
  if (!execDir) return { error: `Execution ${named.execution} is not open` };
  try {
    const file = join(execDir, BINDING_FILE);
    writeFileSync(`${file}.tmp`, `${JSON.stringify(/** @type {TesterBinding} */ ({ agent_id: agentId }), null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
  } catch {
    return { error: `Execution ${named.execution} could not be bound` };
  }
  return { execDir };
}

/**
 * Decode only literal shell words; concatenation permits the shell's 'it'\''s' spelling.
 * @param {string | undefined} command
 * @returns {string[] | null}
 */
function literalWords(command) {
  if (typeof command !== "string" || /[\r\n\0]/.test(command)) return null;
  const word = /(?:[A-Za-z0-9_@%+=:,./-]+|'[^']*'|\\')+/y;
  /** @type {string[]} */
  const words = [];
  let offset = 0;
  while (offset < command.length) {
    if (command[offset] === " " || command[offset] === "\t") {
      offset++;
      continue;
    }
    word.lastIndex = offset;
    const match = word.exec(command);
    if (!match) return null;
    words.push(match[0].replace(/'([^']*)'|\\'/g, (_, quoted) => quoted ?? "'"));
    offset = word.lastIndex;
    if (offset < command.length && command[offset] !== " " && command[offset] !== "\t") return null;
  }
  return words;
}

/**
 * The wrapper owns argument grammar; this boundary admits only its two entry points, on the
 * Execution `agentId` was launched for: its id, and a `--dir` read as the wrapper reads it.
 * @param {string | undefined} command
 * @param {string | undefined} root
 * @param {string | undefined} agentId
 * @returns {boolean}
 */
export function testerCommandAllowed(command, root, agentId) {
  if (typeof root !== "string" || !isAbsolute(root)) return false;
  const words = literalWords(command);
  if (!words || words[0] !== "node" || words[2] !== "tester" || !["do", "request"].includes(words[3])) return false;
  const { positional, options } = /** @type {{ positional: string[], options: Record<string, string | undefined> }} */ (tailOptions(words.slice(4)));
  const [id] = positional;
  if (!ID.test(id ?? "") || typeof options.dir !== "string" || !isAbsolute(options.dir)) return false;
  if (!boundTo(join(options.dir, "executions", id), agentId)) return false;
  const scripts = [join(root, "scripts", "scan.mjs")];
  try {
    scripts.push(join(realpathSync(root), "scripts", "scan.mjs"));
  } catch {
    // The root as supplied is still an exact match; no other alias is trusted.
  }
  return scripts.includes(words[1]);
}

/**
 * Future artifacts are checked by resolving their deepest existing ancestor, never by prefix.
 * @param {string} path
 * @returns {string}
 */
function artifactRealPath(path) {
  /** @type {string[]} */
  const missing = [];
  let ancestor = path;
  while (true) {
    try {
      lstatSync(ancestor);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT" || dirname(ancestor) === ancestor) throw error;
      missing.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
      continue;
    }
    // lstat sees a dangling symlink; let realpath fail rather than treating it as missing.
    return join(realpathSync(ancestor), ...missing);
  }
}

/**
 * @param {string | undefined} path
 * @param {string | undefined} agentId
 * @returns {boolean}
 */
export function testerReadAllowed(path, agentId) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0") || path.split(sep).includes("..")) return false;
  if (authPath(path.split(sep))) return false;
  try {
    const real = artifactRealPath(path);
    const parts = real.split(sep);
    if (authPath(parts)) return false;
    const at = parts.lastIndexOf("executions");
    if (at < 0 || !parts[at + 1]) return false;
    const artifacts = parts.slice(at + 2);
    if (!(artifacts[0] === ".playwright-cli" && artifacts.length >= 2)
      && !(artifacts[0] === "responses" && artifacts.length === 2 && artifacts[1].endsWith(".json"))) return false;
    return boundTo(parts.slice(0, at + 2).join(sep), agentId);
  } catch {
    return false;
  }
}

/**
 * The one file a Tester writes: its own Execution's report, beside a valid guard.
 * @param {string | undefined} path
 * @param {string | undefined} agentId
 * @returns {boolean}
 */
export function testerWriteAllowed(path, agentId) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0") || path.split(sep).includes("..")) return false;
  if (authPath(path.split(sep))) return false;
  try {
    const real = artifactRealPath(path);
    const parts = real.split(sep);
    if (authPath(parts)) return false;
    if (parts.length < 4 || parts.at(-1) !== "report.md" || parts.at(-3) !== "executions" || !parts.at(-2)) return false;
    try {
      // An existing report must be a plain file: a link would redirect the write elsewhere.
      if (!lstatSync(path).isFile()) return false;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") return false;
    }
    return boundTo(dirname(real), agentId);
  } catch {
    return false;
  }
}

/**
 * @param {readonly string[]} parts
 * @returns {boolean}
 */
const authPath = (parts) => parts.includes("auth") || parts.some((part, i) => part === ".qa" && parts[i + 1] === ".auth");
