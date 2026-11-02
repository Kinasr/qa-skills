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
// the support-matrix row and the version found.
import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { refusalsFor } from "./refusal.mjs";

/** @type {string} */
export const CLAUDE_CODE_FLOOR = "2.1.308";

/** @import { RefusalResult } from "./refusal.mjs" */

/**
 * @typedef {{ status: number | null, stdout: string, error?: Error }} HostVersionOutput
 * @typedef {{ env: NodeJS.ProcessEnv, encoding: "utf8", timeout: number, killSignal: "SIGKILL", maxBuffer: number }} HostSpawnOptions
 * @typedef {(file: string, args: string[], options: HostSpawnOptions) => HostVersionOutput} HostSpawn
 */

/**
 * @param {string | null} version
 * @param {string} reason
 * @returns {RefusalResult}
 */
function unverified(version, reason) {
  return refusalsFor({ host_unverified: `Application access requires [Claude Code](https://github.com/Kinasr/qa-skills/blob/v0.3.6/docs/support.md#claude-code) >= ${CLAUDE_CODE_FLOOR}. Version found: ${version ?? "none could be read"}. ${reason}` }).stop("host_unverified", { version });
}

/**
 * Recheck the running host; no persisted Run value authorizes application access.
 * @param {{ env?: NodeJS.ProcessEnv, spawn?: HostSpawn, timeoutMs?: number }} [options]
 * @returns {RefusalResult | null}
 */
export function admitHost({ env = process.env, spawn = spawnSync, timeoutMs = 2000 } = {}) {
  const source = env.CLAUDE_CODE_EXECPATH;
  if (!source || !isAbsolute(source)) return unverified(null, "The running host executable is unavailable.");
  let result;
  try {
    result = spawn(source, ["--version"], { env, encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 4096 });
  } catch {
    return unverified(null, "The running host version command failed.");
  }
  if (result.error || result.status !== 0) return unverified(null, "The running host version command failed or timed out.");
  const match = /^(\d+\.\d+\.\d+) \(Claude Code\)\n$/.exec(result.stdout);
  if (!match) return unverified(null, "The running host printed an unrecognised version format.");
  const version = match[1];
  if (env.AI_AGENT !== undefined) {
    const agent = /^claude-code_(\d+)-(\d+)-(\d+)_agent$/.exec(env.AI_AGENT);
    if (!agent || agent.slice(1).join(".") !== version) {
      return unverified(version, "AI_AGENT is malformed or disagrees with the running host.");
    }
  }
  const found = version.split(".").map(BigInt);
  const floor = CLAUDE_CODE_FLOOR.split(".").map(BigInt);
  for (let i = 0; i < floor.length; i++) {
    if (found[i] > floor[i]) break;
    if (found[i] < floor[i]) return unverified(version, "The running host is below the supported floor.");
  }
  return null;
}
