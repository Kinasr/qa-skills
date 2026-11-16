// @ts-check
// Whether the running Claude Code host is at or above the supported floor. The check rechecks the
// running host on every call that opens an application session (`execute next` before it schedules,
// `execute open` at the shared opening boundary), so a persisted Run never authorizes a host session
// the running host was not admitted for: a refusal makes no login or browser call and leaves the
// Run unchanged, while cleanup and ingest stay available.
//
// The source is the running host binary named by `CLAUDE_CODE_EXECPATH`, asked for `--version` with a
// short bound and parsed strictly against the full format (a version, the process name and a trailing
// newline, and nothing else). `AI_AGENT`, when present, is a strict cross-check: malformed or
// disagreeing refuses. There is no `AI_AGENT`-only fallback and no PATH `claude`. Absent, empty,
// non-executable, failing, timed-out or malformed source refuses, as does one below the floor, so an
// unrecognised future format refuses until it is re-qualified. The refusal, `host_unverified`, names
// the failed check, the host as identified, the version found and the `AI_AGENT` seen, and links the
// running plugin version's support row. Every failure but the floor can still run as an acknowledged
// Unguarded Run (ADR-0057); below the floor the fix is an upgrade, so none is offered.
import { spawnSync } from "node:child_process";
import { posix, win32 } from "node:path";
import { spawnNodeCli } from "./platform.mjs";
import { refusalsFor } from "./refusal.mjs";
import { supportLink } from "./support-link.mjs";

/** @type {string} */
export const CLAUDE_CODE_FLOOR = "2.1.308";

/** @import { RefusalResult } from "./refusal.mjs" */

/**
 * @typedef {{ status: number | null, stdout: string, error?: Error }} HostVersionOutput
 * @typedef {{ env: NodeJS.ProcessEnv, encoding: "utf8", timeout: number, killSignal: "SIGKILL", maxBuffer: number }} HostSpawnOptions
 * @typedef {(file: string, args: string[], options: HostSpawnOptions) => HostVersionOutput} HostSpawn
 */

/**
 * The one admission check that failed. Each but `below_floor` means the host's metadata cannot be
 * verified, which an acknowledged Unguarded Run may run past.
 * @typedef {"exec_path_missing" | "exec_path_not_absolute" | "exec_path_unsupported" | "version_command_failed" | "version_command_timed_out" | "version_format" | "ai_agent_malformed" | "ai_agent_disagrees" | "below_floor"} HostCheck
 */

/** @type {Record<HostCheck, string>} */
const CHECKS = {
  exec_path_missing: "CLAUDE_CODE_EXECPATH is unset or empty.",
  exec_path_not_absolute: "CLAUDE_CODE_EXECPATH is not an absolute path.",
  exec_path_unsupported: "CLAUDE_CODE_EXECPATH must name an .exe or .js/.cjs/.mjs file on Windows.",
  version_command_failed: "The running host version command failed.",
  version_command_timed_out: "The running host version command timed out.",
  version_format: "The running host printed an unrecognised version format.",
  ai_agent_malformed: "AI_AGENT is malformed.",
  ai_agent_disagrees: "AI_AGENT disagrees with the running host version.",
  below_floor: `The running host is below the supported floor. Upgrade Claude Code to >= ${CLAUDE_CODE_FLOOR}; an Unguarded Run is not offered.`,
};

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {HostCheck} check
 * @param {string | null} version
 * @returns {RefusalResult}
 */
function unverified(env, check, version) {
  const host = isClaudeCodeHost(env) ? "Claude Code, unverified" : "not Claude Code";
  const agent = env.AI_AGENT === undefined ? "unset" : JSON.stringify(env.AI_AGENT);
  return refusalsFor({ host_unverified: `Application access requires [Claude Code](${supportLink("claude-code")}) >= ${CLAUDE_CODE_FLOOR}. Host: ${host}. Version found: ${version ?? "none could be read"}. Failed check: ${check}: ${CHECKS[check]} AI_AGENT seen: ${agent}.` }).stop("host_unverified", { version, check });
}

/** @param {RefusalResult} refusal @returns {string} */
const lineOf = (refusal) => String(refusal.json.refusals[0].line);
/** @param {RefusalResult} refusal @returns {boolean} */
const belowFloor = (refusal) => refusal.json.refusals[0].check === "below_floor";

/**
 * Recheck the running host; no persisted Run value authorizes application access.
 * @param {{ env?: NodeJS.ProcessEnv, spawn?: HostSpawn, timeoutMs?: number, platform?: NodeJS.Platform }} [options]
 * @returns {RefusalResult | null}
 */
export function admitHost({ env = process.env, spawn = spawnSync, timeoutMs = 2000, platform = process.platform } = {}) {
  const source = env.CLAUDE_CODE_EXECPATH;
  if (!source) return unverified(env, "exec_path_missing", null);
  const pathIsAbsolute = platform === "win32" ? win32.isAbsolute : posix.isAbsolute;
  if (!pathIsAbsolute(source)) return unverified(env, "exec_path_not_absolute", null);
  /** @type {HostSpawnOptions} */
  const spawnOptions = { env, encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 4096 };
  const resolved = spawnNodeCli({ kind: "exec-path", file: source, args: ["--version"], options: spawnOptions }, { platform, env });
  if (resolved.refusal) return unverified(env, "exec_path_unsupported", null);
  let result;
  try {
    result = spawn(resolved.file, resolved.args, resolved.options);
  } catch {
    return unverified(env, "version_command_failed", null);
  }
  if (/** @type {NodeJS.ErrnoException | undefined} */ (result.error)?.code === "ETIMEDOUT") return unverified(env, "version_command_timed_out", null);
  if (result.error || result.status !== 0) return unverified(env, "version_command_failed", null);
  const versionPattern = platform === "win32"
    ? /^(\d+\.\d+\.\d+) \(Claude Code\)\r?\n$/
    : /^(\d+\.\d+\.\d+) \(Claude Code\)\n$/;
  const match = versionPattern.exec(result.stdout);
  if (!match) return unverified(env, "version_format", null);
  const version = match[1];
  // The floor decides before the cross-check: a host known to be below it is refused for an
  // upgrade, never offered an Unguarded Run because its AI_AGENT also drifted.
  const found = version.split(".").map(BigInt);
  const floor = CLAUDE_CODE_FLOOR.split(".").map(BigInt);
  for (let i = 0; i < floor.length; i++) {
    if (found[i] > floor[i]) break;
    if (found[i] < floor[i]) return unverified(env, "below_floor", version);
  }
  if (env.AI_AGENT !== undefined) {
    const agent = /^claude-code_(\d+)-(\d+)-(\d+)_agent$/.exec(env.AI_AGENT);
    if (!agent) return unverified(env, "ai_agent_malformed", version);
    if (agent.slice(1).join(".") !== version) return unverified(env, "ai_agent_disagrees", version);
  }
  return null;
}

/**
 * Whether the running host identifies as Claude Code, by either signal it sets: a
 * `CLAUDE_CODE_EXECPATH`, or an `AI_AGENT` naming `claude-code_`. It names the host on a refusal
 * and the pre-run Card ("Claude Code, unverified" or "not Claude Code"); it does not decide
 * admission, which `admitHost` alone verifies.
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
export function isClaudeCodeHost(env) {
  return Boolean(env.CLAUDE_CODE_EXECPATH) || (env.AI_AGENT ?? "").startsWith("claude-code_");
}

/**
 * Why the running host's Tester guard cannot be verified, or null when it is admitted or is
 * Claude Code below the floor (refused, never offered an Unguarded Run): the one reason an
 * Unguarded Run's pre-run Card names and its digest seals, at plan and at confirm alike.
 * @param {{ env?: NodeJS.ProcessEnv, spawn?: HostSpawn, timeoutMs?: number, platform?: NodeJS.Platform }} [options]
 * @returns {string | null}
 */
export function unguardedReason(options = {}) {
  const refusal = admitHost(options);
  return refusal && !belowFloor(refusal) ? lineOf(refusal) : null;
}

/**
 * Admit a confirmed Run's application session. A host whose Tester guard cannot be verified admits
 * only an Unguarded Run (ADR-0057): one the engineer acknowledged on the pre-run Card, recorded by
 * `execute confirm`, and only for the reason it acknowledged. Below the floor never admits.
 * `unguarded` says so, so a Run never proceeds without a verified guard silently.
 * @param {Pick<import("./execute.mjs").ExecutePlan, "unguarded">} pinned
 * @param {{ env?: NodeJS.ProcessEnv, spawn?: HostSpawn, timeoutMs?: number, platform?: NodeJS.Platform }} [options]
 * @returns {{ refusal: RefusalResult | null, unguarded: boolean }}
 */
export function admitRun(pinned, options = {}) {
  const refusal = admitHost(options);
  if (!refusal) return { refusal: null, unguarded: false };
  // Only the failure the engineer acknowledged admits the Run; any other refuses as before.
  const acknowledged = !belowFloor(refusal) && pinned.unguarded?.acknowledged === true && pinned.unguarded.reason === lineOf(refusal);
  return acknowledged ? { refusal: null, unguarded: true } : { refusal, unguarded: false };
}
