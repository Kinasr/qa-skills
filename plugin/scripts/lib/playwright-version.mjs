// @ts-check
// Which `playwright-cli` this machine has, and whether it is new enough for `/qa-execute`.
// `/qa-execute` drives the app through its sessions, run-code and
// `--version`; `/qa-init` warns about the same shortfall without blocking.
import { spawnSync } from "node:child_process";

/** @type {string} */
export const MIN_PLAYWRIGHT_CLI = "0.1.22";
/** @type {string} */
export const UPGRADE_PLAYWRIGHT_CLI = "npm install -g @playwright/cli@latest";
// Generous: a cold Node start of the CLI can take seconds on a loaded machine, and a timeout
// reads as "too old".
const VERSION_TIMEOUT_MS = 5000;

/**
 * @param {string} version
 * @returns {number[]}
 */
const numbers = (version) => version.split(".").map(Number);

// Whether `version` ("0.1.22") is at least `min`, compared number by number so 0.1.100 > 0.1.22.
/**
 * @param {string} version
 * @param {string} [min]
 * @returns {boolean}
 */
export function atLeast(version, min = MIN_PLAYWRIGHT_CLI) {
  const [a, b] = [numbers(version), numbers(min)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [x, y] = [a[i] ?? 0, b[i] ?? 0];
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * What `playwright-cli --version` reports.
 * @typedef {{
 *   status: "missing",
 *   version?: never,
 *   found?: never,
 *   failure?: never,
 * } | {
 *   status: "old",
 *   found?: string,
 *   failure?: string,
 *   version?: never,
 * } | {
 *   status: "ok",
 *   version: string,
 *   found?: never,
 *   failure?: never,
 * }} PlaywrightCliVersionResult
 */

// What `playwright-cli --version` says under `env`, with a 5 s timeout:
//   {status: "missing"}                       not on the PATH (or not executable)
//   {status: "old", found?, failure?}         older than the minimum, or no version could be read
//                                             (`failure` says why: timed out, exited non-zero, printed none)
//   {status: "ok", version}
/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {PlaywrightCliVersionResult}
 */
export function playwrightCliVersion(env = process.env) {
  const r = spawnSync("playwright-cli", ["--version"], { env, encoding: "utf8", timeout: VERSION_TIMEOUT_MS });
  if (r.error && ["ENOENT", "EACCES"].includes(/** @type {string} */ (/** @type {NodeJS.ErrnoException} */ (r.error).code))) return { status: "missing" };
  if (r.error) return { status: "old", failure: /** @type {NodeJS.ErrnoException} */ (r.error).code === "ETIMEDOUT" ? `\`playwright-cli --version\` timed out after ${VERSION_TIMEOUT_MS / 1000} s` : `\`playwright-cli --version\` failed: ${r.error.message}` };
  if (r.status !== 0) return { status: "old", failure: `\`playwright-cli --version\` exited with status ${r.status}` };
  const version = /\d+\.\d+\.\d+/.exec(r.stdout)?.[0];
  if (!version) return { status: "old", failure: "`playwright-cli --version` printed no version" };
  return atLeast(version) ? { status: "ok", version } : { status: "old", found: version };
}
