// @ts-check
// What the core and every stack adapter (lib/stack.mjs) share about the code under test: the files
// under the module paths, and the Key-carrier names `annotation_map` gives a role. It imports
// neither, so the core never needs an adapter and an adapter never needs the core.
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// The Key-carrier names `annotation_map` gives one role, in order.
/**
 * @param {Record<string, unknown> | null | undefined} annotationMap
 * @param {string} role
 * @returns {string[]}
 */
export function carrierNames(annotationMap, role) {
  return Array.isArray(annotationMap?.[role]) ? annotationMap[role].filter((n) => typeof n === "string") : [];
}

// Repository-relative paths of every file under the module paths that `keep` accepts, each listed
// once. An unreadable directory is skipped, never fatal.
/**
 * @param {string} repo
 * @param {readonly string[]} modulePaths
 * @param {(name: string) => boolean} keep
 * @returns {string[]}
 */
export function filesUnder(repo, modulePaths, keep) {
  const out = new Set();
  /** @param {string} dir */
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && keep(e.name)) out.add(relative(repo, abs).split(sep).join("/"));
    }
  };
  for (const p of modulePaths) {
    const abs = resolve(repo, p);
    if (isDir(abs)) walk(abs);
  }
  return [...out].sort();
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
