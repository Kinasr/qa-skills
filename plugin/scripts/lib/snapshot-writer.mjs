// @ts-check
// Private, replaceable snapshots for read-only pages outside the repository.
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, fchmodSync, ftruncateSync, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PATTERN } from "./keys.mjs";
import { ensurePrivateDir, writeSecretFile } from "./platform-privacy.mjs";

/** @import { PlatformRefusal } from "./platform.mjs" */
/** @import { PrivacyContext } from "./platform-privacy.mjs" */

/**
 * Snapshot output target parameters.
 * @typedef {{
 *   root: string,
 *   page: "show" | "next",
 *   html: string,
 *   key?: string,
 *   context?: PrivacyContext,
 * }} WriteSnapshotInput
 */

/**
 * Writes an immutable card-page HTML snapshot to a private directory in temp storage.
 * @param {WriteSnapshotInput} input
 * @returns {{ path: string } | { error: string, refusal?: PlatformRefusal }}
 */
export function writeSnapshot({ root, page, html, key, context = {} }) {
  if (key !== undefined && !PATTERN.slug.test(key)) return { error: `Invalid Feature key: ${key}` };
  const platform = context.platform ?? process.platform;
  const tempBase = platform === "win32" ? (context.env?.TEMP ?? context.env?.TMP ?? tmpdir()) : tmpdir();
  const dir = join(tempBase, "qa-skills");
  const lstat = context.fs?.lstatSync ?? lstatSync;
  const existing = lstat(dir, { throwIfNoEntry: false });
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory()
    || (platform !== "win32" && typeof process.getuid === "function" && existing.uid !== process.getuid()))) {
    return { error: `Refusing to write ${dir}: expected a directory owned by the current user, not a symlink.` };
  }
  const hash = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 12);
  const path = join(dir, `${page}-${hash}${key === undefined ? "" : `-${key}`}.html`);

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
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ELOOP") return { error: `Refusing to write ${path}: file is a symlink.` };
    throw error;
  }
  try {
    fchmodSync(fd, 0o600);
    ftruncateSync(fd, 0);
    writeFileSync(fd, html);
  } finally {
    closeSync(fd);
  }
  return { path };
}
