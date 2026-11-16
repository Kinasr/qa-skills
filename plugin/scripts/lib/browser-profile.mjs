// @ts-check
// Where a `playwright-cli` session's Chromium profile lives. Without `--profile`, Chromium's
// profile is a temp directory in the OS temp dir, which can outlive the session with its cookies
// and storage. With it, the profile sits under the directory the session runs from (an
// Execution's), outside the Tester's Read allow-list, and its caller removes it once the session is
// closed, as it holds a Role's signed-in cookies.
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensurePrivateDir } from "./platform-privacy.mjs";

/** @import { PlatformRefusal } from "./platform.mjs" */
/** @import { PrivacyContext } from "./platform-privacy.mjs" */

/** @type {"profiles"} */
export const PROFILES_DIR = "profiles";

/**
 * @param {string} cwd
 * @param {string} session
 * @returns {string}
 */
export const profileDir = (cwd, session) => resolve(join(cwd, PROFILES_DIR, session));

/**
 * The `open` flag that keeps session `session`'s profile under `cwd`.
 * @param {string} cwd
 * @param {string} session
 * @returns {string}
 */
export const profileFlag = (cwd, session) => `--profile=${profileDir(cwd, session)}`;

/**
 * Resolve the `--profile` flag after verifying on `win32` that the profile directory ACL is private.
 * On POSIX, computes the flag without touching the filesystem.
 * @param {string} cwd
 * @param {string} session
 * @param {PrivacyContext} [context]
 * @returns {{ ok: true, flag: string } | { ok: false, refusal: PlatformRefusal }}
 */
export function ensureProfileFlag(cwd, session, context = {}) {
  const platform = context.platform ?? process.platform;
  if (platform === "win32") {
    const dirCheck = ensurePrivateDir(profileDir(cwd, session), context);
    if (!dirCheck.ok) return dirCheck;
  }
  return { ok: true, flag: profileFlag(cwd, session) };
}

/**
 * Removes session `session`'s profile, once the session is closed.
 * @param {string} cwd
 * @param {string} session
 * @returns {void}
 */
export function dropProfile(cwd, session) {
  rmSync(profileDir(cwd, session), { recursive: true, force: true });
}
