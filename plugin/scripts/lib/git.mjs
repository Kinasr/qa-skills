// @ts-check
// Git, read-only, for `scan`. Every call goes through `git -C <dir>` and never writes.

import { spawnSync } from "node:child_process";

/**
 * Outcome of resolving commits: `ok` is boolean or null (if no ids asked),
 * and `resolved` maps each asked commit id to its full 40-char hex sha or null.
 * @typedef {{
 *   ok: boolean | null,
 *   resolved: Map<string, string | null>,
 * }} ResolvedCommitsResult
 */

/**
 * Line blame result: commit sha and author timestamp in seconds.
 * @typedef {{
 *   commit: string,
 *   time: number,
 * }} BlameLineResult
 */

/**
 * Result of checking uncommitted paths in a list.
 * @typedef {{
 *   paths: string[],
 *   error?: never,
 * } | {
 *   error: { path: string, reason?: string },
 *   paths?: never,
 * }} UncommittedPathsResult
 */

/**
 * Result of checking all uncommitted paths under a directory.
 * @typedef {{
 *   paths: string[],
 *   error?: never,
 * } | {
 *   error: string | undefined,
 *   paths?: never,
 * }} UncommittedUnderResult
 */

/**
 * Information about repository default and current branches.
 * @typedef {{
 *   default: string | null,
 *   current: string | null,
 *   onDefault: boolean,
 * }} DefaultBranchResult
 */

// A pin names a commit by its hex id, full or abbreviated. Branch names and revision expressions
// move, so they never count as naming a commit.
const COMMIT_ID = /^[0-9a-f]{7,40}$/;

// Resolves each id to the full id of an existing commit, or null. One `git` process for the whole
// batch. `ok` is false when `dir` is not inside a git repository, and then nothing resolves; with
// nothing asked, git is not run and `ok` is null.
/**
 * @param {string} dir
 * @param {readonly (string | unknown)[]} ids
 * @returns {ResolvedCommitsResult}
 */
export function resolveCommits(dir, ids) {
  /** @type {Map<string, string | null>} */
  const resolved = new Map();
  const asked = [...new Set(ids.filter((id) => typeof id === "string"))];
  if (asked.length === 0) return { ok: null, resolved };
  for (const id of asked) resolved.set(id, null);
  const hex = asked.filter((id) => COMMIT_ID.test(id));
  if (hex.length === 0) return { ok: isRepo(dir), resolved };
  const r = spawnSync("git", ["-C", dir, "cat-file", "--batch-check"], {
    input: hex.map((id) => `${id}^{commit}\n`).join(""),
    encoding: "utf8",
  });
  if (r.status !== 0) return { ok: false, resolved };
  const lines = r.stdout.split("\n");
  hex.forEach((id, i) => {
    const m = (lines[i] ?? "").match(/^([0-9a-f]{40}) commit /);
    resolved.set(id, m ? m[1] : null);
  });
  return { ok: true, resolved };
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
function isRepo(dir) {
  return spawnSync("git", ["-C", dir, "rev-parse", "--git-dir"], { encoding: "utf8" }).status === 0;
}

// Whether git tracks `path` (relative to `dir`), so a fresh clone holds it. Outside a repository
// nothing is tracked.
/**
 * @param {string} dir
 * @param {string} path
 * @returns {boolean}
 */
export function isTracked(dir, path) {
  return spawnSync("git", ["-C", dir, "ls-files", "--error-unmatch", "--", path], { encoding: "utf8" }).status === 0;
}

// Who last wrote one line: `{commit, time}` (author time, seconds) for a committed line, or null
// for an uncommitted one, a file git does not track, or a `dir` outside a repository.
/**
 * @param {string} dir
 * @param {string} file
 * @param {number} line
 * @returns {BlameLineResult | null}
 */
export function blameLine(dir, file, line) {
  const r = spawnSync("git", ["-C", dir, "blame", "--porcelain", "-L", `${line},${line}`, "--", file], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const commit = r.stdout.match(/^([0-9a-f]{40}) /)?.[1];
  const time = Number(r.stdout.match(/^author-time (\d+)$/m)?.[1]);
  if (!commit || /^0+$/.test(commit) || !Number.isFinite(time)) return null;
  return { commit, time };
}

// Paths, relative to `dir`, of the files under it that match `pathspec`, tracked or
// untracked but not ignored, or null outside a repository.
/**
 * @param {string} dir
 * @param {string} pathspec
 * @returns {string[] | null}
 */
export function listFiles(dir, pathspec) {
  const r = spawnSync("git", ["-C", dir, "ls-files", "--cached", "--others", "--exclude-standard", "--", pathspec], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return [...new Set(r.stdout.split("\n").filter(Boolean))].sort();
}

// Whether `path` (relative to `dir`) holds work git has not committed: untracked, staged or
// modified. An ignored or missing file, and any path outside a repository, holds none.
/**
 * @param {string} dir
 * @param {string} path
 * @returns {boolean}
 */
export function isUncommitted(dir, path) {
  const r = pathStatus(dir, path);
  return r.status === 0 && r.stdout.trim() !== "";
}

/**
 * @param {string} dir
 * @param {string} path
 * @param {boolean} [literal]
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
function pathStatus(dir, path, literal = false) {
  return spawnSync("git", ["-C", dir, ...(literal ? ["--literal-pathspecs"] : []), "status", "--porcelain", "--untracked-files=all", "--", path], { encoding: "utf8" });
}

// The uncommitted paths in a literal list, preserving its order. A failed check names its path
// rather than treating it as clean; an empty list runs no git command.
/**
 * @param {string} dir
 * @param {readonly string[]} paths
 * @returns {UncommittedPathsResult}
 */
export function uncommittedPaths(dir, paths) {
  /** @type {string[]} */
  const dirty = [];
  for (const path of paths) {
    const r = pathStatus(dir, path, true);
    if (r.status !== 0) return { error: { path, reason: r.stderr?.trim() || r.error?.message } };
    if (r.stdout.trim() !== "") dirty.push(path);
  }
  return { paths: dirty };
}

// Every uncommitted path (untracked, staged or modified) under `dir`, or under `roots` when given,
// relative to `dir`, in a stable order; `{error}` when git cannot say. A rename names its new path
// only.
/**
 * @param {string} dir
 * @param {readonly string[]} [roots]
 * @returns {UncommittedUnderResult}
 */
export function uncommittedUnder(dir, roots = []) {
  const r = spawnSync("git", ["-C", dir, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...(roots.length ? roots : ["."])], { encoding: "utf8" });
  if (r.status !== 0) return { error: r.stderr?.trim() || r.error?.message };
  const prefix = spawnSync("git", ["-C", dir, "rev-parse", "--show-prefix"], { encoding: "utf8" }).stdout.trim();
  const fields = r.stdout.split("\0").filter(Boolean);
  /** @type {string[]} */
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    paths.push(fields[i].slice(3));
    if (/^[RC]/.test(fields[i])) i += 1;
  }
  return { paths: [...new Set(paths.map((p) => p.slice(prefix.length)))].sort() };
}

// Whether the repository has an \`origin\` remote at all.
/** @type {(dir: string) => boolean} */
export const hasOrigin = (dir) => spawnSync("git", ["-C", dir, "remote"], { encoding: "utf8" }).stdout?.split("\n").includes("origin") ?? false;

// Branch identity, rather than commit equality: a detached HEAD is off the default branch.
/**
 * @param {string} dir
 * @returns {DefaultBranchResult}
 */
export function defaultBranch(dir) {
  /** @param {string} ref */
  const symbolic = (ref) => {
    const r = spawnSync("git", ["-C", dir, "symbolic-ref", "--quiet", ref], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const remote = symbolic("refs/remotes/origin/HEAD");
  const resolved = remote && spawnSync("git", ["-C", dir, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/HEAD^{commit}"], { encoding: "utf8" }).status === 0;
  const name = resolved && remote.startsWith("refs/remotes/origin/") ? remote.slice("refs/remotes/origin/".length) : null;
  const head = symbolic("HEAD");
  const current = head?.startsWith("refs/heads/") ? head.slice("refs/heads/".length) : null;
  return { default: name, current, onDefault: name !== null && name === current };
}
