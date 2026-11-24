// @ts-check
// `.qa/` as it stood at a commit, for `scan`'s history-aware facts: where `.qa/` sits in its
// repository, what a ref or pin names, ancestry and first-parent history, and `.qa/`'s files at a
// commit.
// Read-only git (`rev-parse`, `merge-base --is-ancestor`, `rev-list`, `ls-tree`, `cat-file`), never a
// checkout. `git.mjs` batch-resolves pins for the Integrity checks; this module serves history.
/** @import { ParsedFile, UnreadableFile } from "./knowledge-file.mjs" */
/** @import { TreeEntries } from "./qa-index.mjs" */
import { gitReason, runGitBuffer } from "./git.mjs";
import { parseTree } from "./knowledge-file.mjs";
import { readWorkingTree } from "./qa-index.mjs";

/**
 * The repository `.qa/` sits in: its top level, and `.qa/`'s path prefix inside it (`.qa/`, or `""`
 * if it is the top level itself).
 * @typedef {{
 *   top: string,
 *   prefix: string,
 * }} Repository
 */

/**
 * `.qa/`'s files at a commit, by relative path.
 * @typedef {Map<string, string>} QaFiles
 */

// Where `.qa/` sits in its repository: the top level and `.qa/`'s path prefix inside it (`.qa/`,
// or `""` if it is the top level itself). Null when `root` is not inside a git repository.
/**
 * @param {string | undefined} root
 * @returns {Repository | null}
 */
export function repositoryOf(root) {
  if (!root) return null;
  const r = runGitBuffer(root, ["rev-parse", "--show-toplevel", "--show-prefix"]);
  if (r.status !== 0) return null;
  const [top, prefix = ""] = r.stdout.toString("utf8").split("\n");
  return { top, prefix };
}

// The full id of the commit `ref` names, or null.
/**
 * @param {string | undefined} dir
 * @param {unknown} ref
 * @returns {string | null}
 */
export function resolveRef(dir, ref) {
  if (!dir || typeof ref !== "string" || ref === "" || ref.startsWith("-")) return null;
  const r = runGitBuffer(dir, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  return r.status === 0 ? r.stdout.toString("utf8").trim() : null;
}

// Whether commit `a` is an ancestor of `b` and not `b` itself. Both are full ids.
/**
 * @param {string} dir
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function isStrictAncestor(dir, a, b) {
  return a !== b && runGitBuffer(dir, ["merge-base", "--is-ancestor", a, b]).status === 0;
}

/**
 * The commits on `tip`'s first-parent history that touch any of `paths` (repository-relative,
 * literal), oldest first, or an explicit error when git cannot answer.
 * @param {string} dir
 * @param {string} tip
 * @param {readonly string[]} paths
 * @returns {{ ok: true, commits: string[] } | { ok: false, error: string }}
 */
export function firstParentTouchingResult(dir, tip, paths) {
  if (paths.length === 0) return { ok: true, commits: [] };
  const r = runGitBuffer(dir, ["--literal-pathspecs", "rev-list", "--first-parent", "--reverse", tip, "--", ...paths]);
  if (r.status === 0 && !r.error) return { ok: true, commits: r.stdout.toString("utf8").split("\n").filter(Boolean) };
  return { ok: false, error: gitReason(r, "rev-list") };
}

// The commits on `tip`'s first-parent history that touch any of `paths` (repository-relative,
// literal), oldest first. Empty when `paths` is empty or git cannot say.
/**
 * @param {string} dir
 * @param {string} tip
 * @param {readonly string[]} paths
 * @returns {string[]}
 */
export function firstParentTouching(dir, tip, paths) {
  const res = firstParentTouchingResult(dir, tip, paths);
  return res.ok ? res.commits : [];
}

// A commit's files never change, so each commit's `.qa/` is read from git once per process, by
// `.qa/`'s prefix and the commit's full id; a read that fails is asked again next time.
/** @type {Map<string, QaFiles>} */
const qaByCommit = new Map();

// Every `.md` file under `.qa/` at `commit`, as rel path → text, in a stable order, or an
// explicit error when git cannot list or read them. Each call returns its own map.
/**
 * @param {Repository | null} repo
 * @param {string | null | undefined} commit
 * @returns {{ ok: true, files: QaFiles } | { ok: false, error: string }}
 */
export function readQaAtResult(repo, commit) {
  if (!repo || !commit) return { ok: false, error: !repo ? "not inside a git repository" : "missing commit" };
  const key = `${repo.prefix}\0${commit}`;
  /** @type {QaFiles | undefined} */
  let files = qaByCommit.get(key);
  if (!files) {
    const res = readFromGitResult(repo, commit);
    if (!res.ok) return res;
    files = res.files;
    if (/^[0-9a-f]{40,64}$/.test(commit)) qaByCommit.set(key, files);
  }
  return { ok: true, files: new Map(files) };
}

// Every `.md` file under `.qa/` at `commit`, as rel path → text, in a stable order. Each call
// returns its own map, or an empty map when git cannot list or read them.
/**
 * @param {Repository | null} repo
 * @param {string | null | undefined} commit
 * @returns {QaFiles}
 */
export function readQaAt(repo, commit) {
  const res = readQaAtResult(repo, commit);
  return res.ok ? res.files : new Map();
}

// `readQaAtResult`'s files, or an explicit error when git cannot list or read them.
/**
 * @param {Repository} repo
 * @param {string} commit
 * @returns {{ ok: true, files: QaFiles } | { ok: false, error: string }}
 */
function readFromGitResult(repo, commit) {
  /** @type {QaFiles} */
  const files = new Map();
  const ls = runGitBuffer(repo.top, ["ls-tree", "-r", "-z", "--full-tree", commit, "--", repo.prefix || "."]);
  if (ls.status !== 0 || ls.error) return { ok: false, error: gitReason(ls, "ls-tree") };
  /** @type {Array<{ sha: string, rel: string }>} */
  const blobs = [];
  for (const entry of ls.stdout.toString("utf8").split("\0")) {
    const m = entry.match(/^\d+ blob ([0-9a-f]+)\t(.*)$/s);
    if (!m || !m[2].startsWith(repo.prefix)) continue;
    const rel = m[2].slice(repo.prefix.length);
    if (rel.endsWith(".md")) blobs.push({ sha: m[1], rel });
  }
  blobs.sort((x, y) => (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0));
  if (blobs.length === 0) return { ok: true, files };
  const cat = runGitBuffer(repo.top, ["cat-file", "--batch"], { input: blobs.map((b) => `${b.sha}\n`).join("") });
  if (cat.status !== 0 || cat.error) return { ok: false, error: gitReason(cat, "cat-file") };
  const out = cat.stdout;
  let at = 0;
  for (const b of blobs) {
    const eol = out.indexOf(10, at);
    if (eol < 0) return { ok: false, error: `git cat-file truncated output at ${b.sha}` };
    const size = Number(out.toString("utf8", at, eol).split(" ")[2]);
    if (!Number.isFinite(size)) return { ok: false, error: `git cat-file missing blob ${b.sha}` };
    files.set(b.rel, out.toString("utf8", eol + 1, eol + 1 + size));
    at = eol + 1 + size + 1;
  }
  return { ok: true, files };
}

// Each `read*` gives `[rel, text]` entries for lib/knowledge-file.mjs `parseTree`, and its `load*`
// twin the files parsed: `*QaAt` a commit's `.qa/`, `*WorkingTree` (lib/qa-index.mjs) the working
// tree's, and `*QaTree` either one.

// `.qa/` at `commit`, parsed exactly as the working tree's is.
/**
 * @param {Repository | null} repo
 * @param {string | null | undefined} commit
 * @returns {Array<ParsedFile | UnreadableFile>}
 */
export const loadQaAt = (repo, commit) => parseTree(readQaAt(repo, commit));

// `.qa/` under `root` as it stands at `commit`, or the working tree's when `commit` is null.
/**
 * @param {string} root
 * @param {string | null | undefined} commit
 * @returns {QaFiles | TreeEntries}
 */
export const readQaTree = (root, commit) => (commit ? readQaAt(repositoryOf(root), commit) : readWorkingTree(root));

/**
 * @param {string} root
 * @param {string | null | undefined} commit
 * @returns {Array<ParsedFile | UnreadableFile>}
 */
export const loadQaTree = (root, commit) => parseTree(readQaTree(root, commit));
