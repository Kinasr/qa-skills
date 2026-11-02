// @ts-check
// Private, replaceable snapshots for read-only pages outside the repository.
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, fchmodSync, ftruncateSync, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PATTERN } from "./keys.mjs";

/**
 * @param {{ root: string, page: "next" | "show", html: string, key?: string }} args
 * @returns {{ path: string } | { error: string }}
 */
export function writeSnapshot({ root, page, html, key }) {
  if (key !== undefined && !PATTERN.slug.test(key)) return { error: `Invalid Feature key: ${key}` };
  const dir = join(tmpdir(), "qa-skills");
  const existing = lstatSync(dir, { throwIfNoEntry: false });
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory()
    || (typeof process.getuid === "function" && existing.uid !== process.getuid()))) {
    return { error: `Refusing to write ${dir}: expected a directory owned by the current user, not a symlink.` };
  }
  if (!existing) mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const hash = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 12);
  const path = join(dir, `${page}-${hash}${key === undefined ? "" : `-${key}`}.html`);
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
