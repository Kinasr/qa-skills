// @ts-check
// Path containment, in one place: a repository-relative path compared as text, and a ref resolved
// through real paths against the directories it may live under. A missing path, a symlink escape
// and a path outside every base are all unresolved.
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

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
      const rel = relative(realBase, real);
      return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
    } catch {
      return false;
    }
  });
}
