// @ts-check
// Path containment, in one place: a repository-relative path compared as text, and a ref resolved
// through real paths against the directories it may live under. A missing path, a symlink escape
// and a path outside every base are all unresolved.
//
// One helper per prefix question:
//   isContained(base, target, options)  absolute filesystem path inside another        (here)
//   within(path, root)                  repo-relative POSIX text at or under a root     (here)
//   refUnder(ref, prefix)               knowledge ref `feature/rule` under a key        (rule-ref.mjs)
//   urlUnder(value, origin)             URL or route pattern on an origin               (execution-guard.mjs)
//   isSafeRelativePath(path)            input validation: is it a safe repo-relative path at all?  (here)
import { lstatSync, realpathSync } from "node:fs";
import nodePath, { basename, dirname, isAbsolute, join, resolve, win32 } from "node:path";

/**
 * The slice of `node:path` that `isContained` uses; pass `win32` to apply Windows rules on any host.
 * @typedef {Pick<typeof import("node:path"), "relative" | "resolve" | "isAbsolute" | "sep">} PathFlavour
 */

/**
 * Whether `target` is `base` or lies inside it. `path` picks the path flavour (default: the host's
 * `node:path`; pass `win32` for drive letters and case-insensitive comparison on any host). `strict`
 * refuses `target === base`. A non-traversal name like `..foo.kt` is contained; a cross-drive
 * target is not.
 * @param {string} base
 * @param {string} target
 * @param {{ path?: PathFlavour, strict?: boolean }} [options]
 * @returns {boolean}
 */
export function isContained(base, target, options = {}) {
  const flavour = options.path ?? nodePath;
  const rel = flavour.relative(flavour.resolve(base), flavour.resolve(target));
  if (rel === "") return !options.strict;
  return rel !== ".." && !rel.startsWith(`..${flavour.sep}`) && !rel.startsWith("../") && !flavour.isAbsolute(rel);
}

/**
 * Low-level segment guard for repo-relative file paths: rejects non-strings, empty strings, NUL
 * bytes, absolute paths (POSIX, UNC, or Windows drive paths), drive-relative prefixes, and `..`
 * traversal segments across `/` and `\`. Complementary to `access-note.mjs:isRepoRelativePath`.
 * @param {unknown} path
 * @returns {path is string}
 */
export function isSafeRelativePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.includes("\0") &&
    !isAbsolute(path) &&
    !win32.isAbsolute(path) &&
    !/^[A-Za-z]:/.test(path) &&
    !path.split(/[\\/]/).includes("..")
  );
}

/**
 * Whether `path` is `root` or lies under it, comparing repository-relative POSIX paths. `"."` and
 * `""` mean the whole repository.
 * @param {string} path
 * @param {string} root
 * @returns {boolean}
 */
export function within(path, root) {
  const at = root === "." || root === "" ? "" : root.replace(/^\.\//, "").replace(/\/+$/, "");
  const candidate = path.replace(/^\.\//, "");
  return at === "" || candidate === at || candidate.startsWith(`${at}/`);
}

/**
 * Whether `ref` resolves to `base` or under it for any of `bases`, after resolving both. A missing
 * path, a dangling symlink and a path outside every base are unresolved.
 * @param {string} repo
 * @param {string} ref
 * @param {readonly string[]} bases
 * @returns {boolean}
 */
export function resolvesUnderAny(repo, ref, bases) {
  let real;
  try {
    real = realpathSync(resolve(repo, ref));
  } catch {
    return false;
  }
  return bases.some((base) => {
    try {
      const realBase = realpathSync(resolve(repo, base));
      return isContained(realBase, real);
    } catch {
      return false;
    }
  });
}

/**
 * Whether `rel` resolves inside `baseDir`'s realpath, walking up through missing leaf segments via
 * `resolveRealPath` to reject escaping or dangling ancestor symlinks for both existing and planned
 * paths. Unlike `resolvesUnderAny`, `rel` need not exist on disk yet.
 * @param {string} baseDir
 * @param {string} rel
 * @returns {boolean}
 */
export function resolvesInside(baseDir, rel) {
  let baseReal;
  try {
    baseReal = realpathSync(resolve(baseDir));
  } catch {
    return false;
  }
  const resolved = resolveRealPath(baseDir, rel);
  if ("error" in resolved) return false;
  return isContained(baseReal, resolved.real);
}

/**
 * Resolve `rel` under `baseDir`, walking up through missing path segments and rejecting any
 * existing or dangling symlink that cannot be resolved.
 * @param {string} baseDir
 * @param {string} rel
 * @returns {{ real: string } | { error: string }}
 */
export function resolveRealPath(baseDir, rel) {
  const abs = resolve(baseDir, rel);
  /** @type {string[]} */
  const tail = [];
  let probe = abs;
  for (;;) {
    try {
      return { real: join(realpathSync(probe), ...tail) };
    } catch (e) {
      const code = /** @type {NodeJS.ErrnoException} */ (e).code ?? "unresolvable";
      if (code !== "ENOENT") return { error: code };
      try {
        if (lstatSync(probe).isSymbolicLink()) return { error: "dangling_symlink" };
      } catch {
        // Not present either: keep walking to the deepest existing ancestor.
      }
      const parent = dirname(probe);
      if (parent === probe) return { error: "unresolvable" };
      tail.unshift(basename(probe));
      probe = parent;
    }
  }
}
