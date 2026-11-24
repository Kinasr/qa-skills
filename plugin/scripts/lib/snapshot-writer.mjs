// @ts-check
// Private, replaceable snapshots for read-only pages outside the repository.
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, fchmodSync, ftruncateSync, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PATTERN } from "./keys.mjs";
import { firstEnv, isRootedWin32, scratchJoin } from "./platform.mjs";
import { ensurePrivateDir, writeSecretFile } from "./platform-privacy.mjs";

/** @import { PlatformRefusal } from "./platform.mjs" */
/** @import { PrivacyContext } from "./platform-privacy.mjs" */

/** @typedef {PrivacyContext & { fs?: { fchmodSync?: typeof fchmodSync } }} SnapshotContext */

/**
 * Snapshot output target parameters.
 * @typedef {{
 *   root: string,
 *   page: "show" | "next",
 *   html: string,
 *   key?: string,
 *   context?: SnapshotContext,
 * }} WriteSnapshotInput
 */

/**
 * Writes an immutable card-page HTML snapshot to a private directory in temp storage.
 * @param {WriteSnapshotInput} input
 * @returns {{ path: string } | { error: string, refusal?: PlatformRefusal, facts?: Record<string, unknown> }}
 */
export function writeSnapshot({ root, page, html, key, context = {} }) {
  if (key !== undefined && !PATTERN.slug.test(key)) return { error: `Invalid Feature key: ${key}`, facts: { key } };
  const platform = context.platform ?? process.platform;
  const winTemp = platform === "win32" ? ["TEMP", "TMP"].map((name) => firstEnv(context.env ?? {}, [name])).find((value) => value !== undefined && isRootedWin32(value)) : undefined;
  const dir = platform === "win32" ? scratchJoin(winTemp ?? tmpdir(), "qa-skills") : join(tmpdir(), "qa-skills");
  const lstat = context.fs?.lstatSync ?? lstatSync;
  const existing = lstat(dir, { throwIfNoEntry: false });
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory()
    || (platform !== "win32" && typeof process.getuid === "function" && existing.uid !== process.getuid()))) {
    const target_kind = existing.isSymbolicLink() ? "symlink" : !existing.isDirectory() ? "not_directory" : undefined;
    return {
      error: `Refusing to write ${dir}: expected a directory owned by the current user, not a symlink.`,
      facts: { file: dir, ...(target_kind ? { target_kind } : { cause: "owner_mismatch" }) },
    };
  }
  const hash = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 12);
  const name = `${page}-${hash}${key === undefined ? "" : `-${key}`}.html`;
  const path = platform === "win32" ? scratchJoin(dir, name) : join(dir, name);

  if (platform === "win32") {
    const dirPrivacy = ensurePrivateDir(dir, context, { suggestDir: false });
    if (!dirPrivacy.ok) return { error: dirPrivacy.refusal.message, refusal: dirPrivacy.refusal };
    const written = writeSecretFile(path, html, context, { suggestDir: false });
    if (!written.ok) return { error: written.refusal.message, refusal: written.refusal };
    return { path: written.path };
  }

  if (!existing) mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  let fd;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ELOOP") return { error: `Refusing to write ${path}: file is a symlink.`, facts: { file: path, os_error: "ELOOP", target_kind: "symlink" } };
    throw error;
  }
  try {
    try {
      (context.fs?.fchmodSync ?? fchmodSync)(fd, 0o600);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EPERM") throw error;
      return { error: `Refusing to write ${path}: the file is owned by another user.`, facts: { file: path, cause: "owner_mismatch", target_kind: "file" } };
    }
    ftruncateSync(fd, 0);
    writeFileSync(fd, html);
  } finally {
    closeSync(fd);
  }
  return { path };
}
