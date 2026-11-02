// @ts-check
// Local git for the PR plumbing: reads needed to decide a mode and a base, and the one write that
// builds an item's commit on a temporary index. Nothing here switches the checkout, stages in the
// engineer's index, or reaches the network.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { UsageError } from "./cli.mjs";

// A file as git would store it: its mode and the id of its blob, which is written to the object
// database when the file is read, so its bytes are read back with `fileBytes` and never held here.
/** @typedef {{ mode: string, oid: string }} PrFile */
/** @typedef {Record<string, PrFile>} PrTree */

/**
 * One git call in `repo`; `index` points it at a temporary index. `--no-optional-locks` keeps
 * read-only commands from refreshing the engineer's index, and `--literal-pathspecs` keeps a path
 * such as `tests/[id].txt` literal.
 * @param {string} repo
 * @param {readonly string[]} args
 * @param {{ input?: string | Buffer, index?: string }} [options]
 * @returns {import("node:child_process").SpawnSyncReturns<Buffer>}
 */
export function prGit(repo, args, { input, index } = {}) {
  return spawnSync("git", ["-C", repo, "--literal-pathspecs", "--no-optional-locks", ...args], {
    input,
    env: { ...process.env, ...(index && { GIT_INDEX_FILE: index }) },
    maxBuffer: 1 << 28,
  });
}

/**
 * `result`'s trimmed stdout, or a usage error naming git's first stderr line.
 * @param {ReturnType<typeof prGit>} result
 * @returns {string}
 */
export function gitOutput(result) {
  if (result.status !== 0) {
    const why = result.stderr.toString("utf8").trim().split("\n")[0] || "git failed";
    throw new UsageError(why, { code: "git_error", why });
  }
  return result.stdout.toString("utf8").trim();
}

/**
 * `result`'s trimmed stdout, or null when git refused.
 * @param {string} repo
 * @param {readonly string[]} args
 * @param {{ input?: string | Buffer }} [options]
 * @returns {string | null}
 */
export function gitMaybe(repo, args, options = {}) {
  const result = prGit(repo, args, options);
  return result.status === 0 ? result.stdout.toString("utf8").trim() : null;
}

/**
 * @param {string} repo
 * @param {readonly string[]} args
 * @returns {boolean}
 */
export function gitOk(repo, args) {
  return prGit(repo, args).status === 0;
}

// The working tree's tracked and untracked files, excluding what git ignores, by path. Snapshotting
// all of them is what lets `done` notice an edit outside module_paths and refuse it. Each file is
// hashed into the object database by one batched `git hash-object` call, so a snapshot holds blob
// ids, never the repository's bytes.
/** @param {string} repo @returns {PrTree} */
export function snapshotPrTree(repo) {
  const names = gitOutput(prGit(repo, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]));
  /** @type {PrTree} */
  const tree = {};
  /** @type {{ name: string, mode: string }[]} */
  const batch = [];
  for (const name of new Set(names.split("\0").filter(Boolean))) {
    const stat = statOf(repo, name);
    if (!stat) continue;
    // `--stdin-paths` reads one path per line, drops a trailing carriage return and unquotes a line
    // that opens with `"`, so those paths go one at a time, as does a symlink (hashed as its target).
    if (stat.isSymbolicLink() || /[\n\r]/.test(name) || name.startsWith('"')) {
      const file = workingFile(repo, name);
      if (file) tree[name] = file;
    } else batch.push({ name, mode: modeOf(stat) });
  }
  if (batch.length) {
    const oids = gitOutput(prGit(repo, ["hash-object", "-w", "--no-filters", "--stdin-paths"], { input: batch.map((b) => `${b.name}\n`).join("") })).split("\n");
    batch.forEach((b, i) => { tree[b.name] = { mode: b.mode, oid: oids[i] }; });
  }
  return tree;
}

/** @param {string} repo @param {string} path @returns {import("node:fs").Stats | null} */
function statOf(repo, path) {
  try {
    return lstatSync(join(repo, path));
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === "ENOENT") return null;
    throw e;
  }
}

/** @param {import("node:fs").Stats} stat @returns {string} */
const modeOf = (stat) => (stat.isSymbolicLink() ? "120000" : stat.mode & 0o111 ? "100755" : "100644");

// One path's working-tree file and git mode, or null when it is absent. A symlink is its target
// path, as git stores it; its bytes are never followed here.
/**
 * @param {string} repo
 * @param {string} path
 * @returns {PrFile | null}
 */
export function workingFile(repo, path) {
  const stat = statOf(repo, path);
  if (!stat) return null;
  const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(join(repo, path))) : readFileSync(join(repo, path));
  return { mode: modeOf(stat), oid: gitOutput(prGit(repo, ["hash-object", "-w", "--stdin"], { input: bytes })) };
}

// A snapshot file's bytes, read back from the object database. No ref holds a snapshot's blobs, so
// a `git gc` that prunes unreachable objects (at once with `--prune=now`, or two weeks on by
// default) can remove one; that is refused by name rather than read as an empty file.
/**
 * @param {string} repo
 * @param {PrFile} file
 * @returns {Buffer}
 */
export function fileBytes(repo, file) {
  const blob = prGit(repo, ["cat-file", "blob", file.oid]);
  if (blob.status !== 0) {
    const why = `git no longer holds the snapshot blob ${file.oid}; a \`git gc\` pruned it, so start this item again`;
    throw new UsageError(why, { code: "snapshot_pruned", why });
  }
  return blob.stdout;
}

// A snapshot file's text, or null for no file.
/**
 * @param {string} repo
 * @param {PrFile | null | undefined} file
 * @returns {string | null}
 */
export const fileText = (repo, file) => (file ? fileBytes(repo, file).toString("utf8") : null);

/**
 * @param {PrFile | null | undefined} a
 * @param {PrFile | null | undefined} b
 * @returns {boolean}
 */
export const sameFile = (a, b) => (a?.mode === b?.mode && a?.oid === b?.oid);

/**
 * The paths whose content or mode differs between two snapshots, with their `after` value (null
 * when the path is gone).
 * @param {PrTree} before
 * @param {PrTree} after
 * @returns {Record<string, PrFile | null>}
 */
export function diffTrees(before, after) {
  /** @type {Record<string, PrFile | null>} */
  const changes = {};
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!sameFile(before[path], after[path])) changes[path] = after[path] ?? null;
  }
  return changes;
}

// The commit a ref names, or null.
/** @param {string} repo @param {string} ref @returns {string | null} */
export const refCommit = (repo, ref) => gitMaybe(repo, ["rev-parse", "--verify", "--quiet", ref]);

/** @param {string} repo @returns {string | null} */
export const headCommit = (repo) => refCommit(repo, "HEAD^{commit}");

/** @param {string} repo @param {string} commit @returns {boolean} */
export const commitExists = (repo, commit) => gitOk(repo, ["cat-file", "-e", `${commit}^{commit}`]);

// Point a branch at `commit` only while it does not exist: the old-value form of update-ref makes
// the create a no-op against a ref that appeared meanwhile, so `pr-prepare` never overwrites one.
/**
 * @param {string} repo
 * @param {string} ref
 * @param {string} commit
 * @returns {boolean}
 */
export const createRef = (repo, ref, commit) => gitOk(repo, ["update-ref", ref, commit, "0".repeat(commit.length)]);

/** @param {string} repo @returns {boolean} */
export const committerIdentity = (repo) => prGit(repo, ["var", "GIT_COMMITTER_IDENT"]).status === 0;

// The repository `origin` names as `host/owner/repo`, or null when it has no usable origin.
/** @param {string} repo @returns {string | null} */
export function originSlug(repo) {
  const url = gitMaybe(repo, ["remote", "get-url", "origin"]);
  return url ? slugOf(url) : null;
}

/**
 * @param {string} url
 * @returns {string | null}
 */
export function slugOf(url) {
  const cleaned = url.trim().replace(/\/+$/, "");
  let host = "";
  let path = "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)) {
    try {
      const parsed = new URL(cleaned);
      host = parsed.hostname;
      path = parsed.pathname.replace(/^\/+/, "");
    } catch {
      return null;
    }
  } else {
    const match = cleaned.match(/^(?:[^@/]+@)?([^/:]+)[:/](.+)$/);
    if (!match) return null;
    host = match[1];
    path = match[2];
  }
  path = path.replace(/\.git$/, "");
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path)) return null;
  return `${host}/${path}`;
}

// HEAD's upstream when it lives under `refs/remotes/origin/`, as the ref's full short name
// (`origin/main`), else null.
/** @param {string} repo @returns {string | null} */
export function upstreamRef(repo) {
  const ref = gitMaybe(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  return ref && ref.startsWith("origin/") ? ref : null;
}

// `origin`'s default branch ref (`origin/main`) from its HEAD symref, else the conventional `main`
// when that remote ref exists, else null.
/** @param {string} repo @returns {string | null} */
export function defaultBaseRef(repo) {
  const fromHead = gitMaybe(repo, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (fromHead && fromHead.startsWith("origin/")) return fromHead;
  return refCommit(repo, "refs/remotes/origin/main") ? "origin/main" : null;
}

/**
 * @param {string} repo
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export const isAncestor = (repo, a, b) => (a === b ? true : gitOk(repo, ["merge-base", "--is-ancestor", a, b]));

/**
 * Whether any of `paths` changed between `a` and `b`.
 * @param {string} repo
 * @param {string} a
 * @param {string} b
 * @param {readonly string[]} paths
 * @returns {boolean}
 */
export function pathsChanged(repo, a, b, paths) {
  if (a === b || paths.length === 0) return false;
  return prGit(repo, ["diff", "--quiet", a, b, "--", ...paths]).status !== 0;
}

// A path's blob and mode at a commit, or null when the commit does not hold it.
/**
 * @param {string} repo
 * @param {string} commit
 * @param {string} path
 * @returns {PrFile | null}
 */
export function commitFile(repo, commit, path) {
  const listing = prGit(repo, ["ls-tree", "-z", commit, "--", path]);
  if (listing.status !== 0) return null;
  const record = listing.stdout.toString("utf8").split("\0").find(Boolean);
  const match = record?.match(/^(\d{6}) (\w+) ([0-9a-f]+)\t([\s\S]*)$/);
  if (!match || match[2] !== "blob") return null;
  return { mode: match[1], oid: match[3] };
}

// Write `file` at `path`, or unlink it when `file` is null. The journal already checked that the
// current content is the Run's final content, so this is the only overwrite of a touched path.
/**
 * @param {string} repo
 * @param {string} path
 * @param {PrFile | null} file
 * @returns {void}
 */
export function writeTreeFile(repo, path, file) {
  const target = join(repo, path);
  if (!file) {
    rmSync(target, { force: true });
    return;
  }
  const bytes = fileBytes(repo, file);
  mkdirSync(dirname(target), { recursive: true });
  if (file.mode === "120000") {
    rmSync(target, { force: true });
    symlinkSync(bytes.toString("utf8"), target);
    return;
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) rmSync(target, { force: true });
  writeFileSync(target, bytes);
  chmodSync(target, file.mode === "100755" ? 0o755 : 0o644);
}

// Whether the path is a symlink whose real target escapes every allowed root.
/**
 * @param {string} repo
 * @param {string} path
 * @param {readonly string[]} roots
 * @returns {boolean}
 */
export function symlinkEscapes(repo, path, roots) {
  let stat;
  try {
    stat = lstatSync(join(repo, path));
  } catch {
    return false;
  }
  if (!stat.isSymbolicLink()) return false;
  let resolved;
  try {
    resolved = realpathSync(join(repo, path));
  } catch {
    return true;
  }
  return !roots.some((root) => {
    let base;
    try {
      base = realpathSync(join(repo, root));
    } catch {
      base = join(repo, root);
    }
    return resolved === base || resolved.startsWith(`${base}/`);
  });
}

// Build one item's commit on a temporary index seeded from `parent`: the item's paths are written
// from the working tree, the tree is written, and a commit is made with `parent`. `-S` is never
// passed, so a project's signing configuration cannot be triggered from here.
/**
 * @param {string} repo
 * @param {string} parent
 * @param {Record<string, PrFile | null>} changes
 * @param {string} message
 * @returns {string}
 */
export function itemCommit(repo, parent, changes, message) {
  const scratch = mkdtempSync(join(tmpdir(), "qa-pr-index-"));
  const index = join(scratch, "index");
  try {
    gitOutput(prGit(repo, ["read-tree", parent], { index }));
    const entries = Object.entries(changes).map(([path, file]) => {
      // The snapshot wrote every file's blob, so its id goes in as it is.
      const sha = file ? file.oid : "0".repeat(parent.length);
      return `${file?.mode ?? "0"} ${sha}\t${path}\0`;
    }).join("");
    if (entries) gitOutput(prGit(repo, ["update-index", "-z", "--index-info"], { index, input: entries }));
    const tree = gitOutput(prGit(repo, ["write-tree"], { index }));
    return gitOutput(prGit(repo, ["commit-tree", tree, "-p", parent], { input: `${message}\n` }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
