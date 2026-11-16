// @ts-check
// Whether a command is installed on this machine: `onPath("playwright-cli")` is true when a directory
// of the PATH holds an executable file of that name; a file that is not executable, or a directory
// of that name, does not count. On win32 the platform module resolves it instead, and
// `probeOnPath` keeps a refused shim or planted wrapper (`refused`) apart from `missing`.
/** @import { PlatformContext, PlatformRefusal } from "./platform.mjs" */
import { constants } from "node:fs";
import { delimiter, join } from "node:path";
import { mapStatusRefusal, mergePlatformFs, spawnNodeCli } from "./platform.mjs";

/**
 * Result of probing whether a command is available on `PATH`.
 * @typedef {{
 *   status: "ok",
 *   file?: string,
 *   refusal?: never,
 * } | {
 *   status: "missing",
 *   file?: never,
 *   refusal?: PlatformRefusal,
 * } | {
 *   status: "refused",
 *   file?: never,
 *   refusal: PlatformRefusal,
 * }} OnPathResult
 */

/**
 * Probe `PATH` for `command`, distinguishing `ok`, `missing`, and `refused`.
 * @param {string} command
 * @param {PlatformContext} [context]
 * @returns {OnPathResult}
 */
export function probeOnPath(command, context = {}) {
  const platform = context.platform ?? process.platform;
  const env = context.env ?? process.env;
  if (platform === "win32") {
    const kind = command === "playwright-cli" ? "playwright-cli" : "path-tool";
    const resolved = spawnNodeCli({ kind, file: command, args: [], options: { env } }, { ...context, platform, env });
    if (!resolved.refusal) return { status: "ok", file: resolved.file };
    const mapped = mapStatusRefusal(resolved.refusal);
    return mapped.status === "missing" ? { ...mapped, refusal: resolved.refusal } : mapped;
  }
  const fs = mergePlatformFs(context.fs);
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const file = join(dir, command);
    try {
      if (!fs.statSync(file).isFile()) continue;
      fs.accessSync(file, constants.X_OK);
      return { status: "ok", file };
    } catch {
      // Missing or non-executable entries keep searching PATH.
    }
  }
  return { status: "missing" };
}

/**
 * Whether `command` resolves cleanly on `PATH`.
 * @param {string} command
 * @param {PlatformContext} [context]
 * @returns {boolean}
 */
export function onPath(command, context = {}) {
  return probeOnPath(command, context).status === "ok";
}
