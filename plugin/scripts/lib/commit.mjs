// @ts-check
// The one commit a command makes of the files it wrote, as the project's Commit mode says (ADR-0062).
//
//   commit({mode, repo, line, confirmed})  the outcome, as data
//   parseCommitLine(line)                  the paths and message of a `commitLine`, or null
//   command                                `scan.mjs commit`
//
// The agent pipes the `commit` line a command printed, exactly as printed; only a line `commitLine`
// words is accepted, so the agent never words paths, a message or a flag of its own. `print` never
// writes: it gives the line back. `ask` asks before it makes the commit. `auto` makes it, except on
// the default branch, with no branch checked out, or where the default branch cannot be told, where
// it asks instead. The commit is path-scoped: `git add` and `git commit --only` name only the line's
// paths, so another staged or unstaged change stays as it was. Hooks and signing apply; nothing is
// pushed or retried, and a failed commit puts those paths' index entries back as they were.
/** @import { CommandDefinition } from "./cli.mjs" */
/** @import { CommitMode } from "./schema.mjs" */
import { spawnSync } from "node:child_process";
import { isAbsolute, resolve, sep } from "node:path";
import { commitLine } from "./changeset.mjs";
import { UsageError } from "./cli.mjs";
import { defaultBranch } from "./git.mjs";
import { repositoryOf } from "./git-tree.mjs";
import { rootConfig } from "./qa-index.mjs";

/**
 * What `commit` decides and does, as `scan.mjs commit` prints it.
 * @typedef {{
 *   ok: boolean,
 *   mode: CommitMode,
 *   status: "print" | "ask" | "committed" | "failed" | "refused",
 *   reason?: string,
 *   sha?: string,
 *   commit: string | null,
 * }} CommitResult
 */

/**
 * @param {{
 *   mode: CommitMode,
 *   repo: string | null,
 *   line: string,
 *   confirmed?: boolean,
 * }} options
 * @returns {CommitResult}
 */
export function commit({ mode, repo, line: given, confirmed = false }) {
  const parsed = parseCommitLine(given.trim());
  const line = parsed ? given.trim() : null;
  /** @param {string} reason */
  const refused = (reason) => outcome(mode, "refused", reason, line);
  /** @param {string} reason */
  const ask = (reason) => outcome(mode, "ask", reason, line);
  if (!parsed) return refused("the input is not a commit line a qa-skills command printed");
  if (repo === null) return refused("not a git repository");
  const top = resolve(repo);
  const bad = parsed.paths.find((path) => !safePath(top, path));
  if (bad !== undefined) return refused(`${bad} is not a path inside the repository`);
  if (mode === "print") return { ok: true, mode, status: "print", commit: line };
  if (mode === "ask" && !confirmed) return ask("commit_mode is ask");
  if (mode === "auto" && !confirmed) {
    const { default: on, current, onDefault } = defaultBranch(top);
    if (current === null) return ask("HEAD is detached");
    if (onDefault) return ask("HEAD is on the default branch");
    if (on === null) return ask("the default branch cannot be told");
  }
  return make(top, mode, parsed.paths, parsed.message, line);
}

// The paths and message of a line `commitLine` words, read back word by word: `git add -- <paths>
// && git commit -m <message> -- <paths>`, the same paths twice. Null for anything else, including a
// line that reads but that `commitLine` would not word the same way.
/**
 * @param {string} line
 * @returns {{ paths: string[], message: string } | null}
 */
export function parseCommitLine(line) {
  const words = shellWords(line);
  if (!words) return null;
  const and = words.indexOf("&&");
  if (and < 0) return null;
  const [add, rest] = [words.slice(0, and), words.slice(and + 1)];
  if (add.slice(0, 3).join(" ") !== "git add --" || rest.slice(0, 3).join(" ") !== "git commit -m" || rest[4] !== "--") return null;
  const paths = add.slice(3);
  const message = rest[3];
  if (paths.length === 0 || message === undefined || message.trim() === "" || paths.join("\0") !== rest.slice(5).join("\0")) return null;
  return commitLine(paths, message) === line ? { paths, message } : null;
}

// The POSIX shell words of `line` in the forms `commitLine` writes: bare characters, a
// double-quoted run with no character special inside double quotes, single-quoted runs, and `\'`
// between them. Null for any other quoting.
/**
 * @param {string} line
 * @returns {string[] | null}
 */
function shellWords(line) {
  /** @type {string[]} */
  const words = [];
  let word = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === " ") {
      if (word !== null) words.push(word);
      word = null;
      continue;
    }
    word ??= "";
    if (c === "'" || c === '"') {
      const end = line.indexOf(c, i + 1);
      if (end < 0) return null;
      const inside = line.slice(i + 1, end);
      if (c === '"' && /["$`\\!]/.test(inside)) return null;
      word += inside;
      i = end;
    } else if (c === "\\") {
      if (line[i + 1] !== "'") return null;
      word += "'";
      i++;
    } else {
      word += c;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

// Whether `path` is relative to `repo` and stays inside it: not absolute, no `..` segment, and no
// path that resolves outside. A NUL byte is no path at all.
/**
 * @param {string} repo
 * @param {string} path
 * @returns {boolean}
 */
function safePath(repo, path) {
  if (path === "" || path.includes("\0") || isAbsolute(path) || path.split(/[\\/]/).includes("..")) return false;
  const abs = resolve(repo, path);
  return abs !== repo && abs.startsWith(`${repo}${sep}`);
}

// The path-scoped commit: `git add` the paths, then `git commit --only` them. A failure is reported
// as git words it and never retried; the paths' index entries go back to what they were before.
/**
 * @param {string} repo
 * @param {CommitMode} mode
 * @param {readonly string[]} paths
 * @param {string} message
 * @param {string | null} line
 * @returns {CommitResult}
 */
function make(repo, mode, paths, message, line) {
  /** @param {string} reason */
  const failed = (reason) => outcome(mode, "failed", reason, line);
  const git = (/** @type {string[]} */ ...args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  const before = git("ls-files", "--stage", "-z", "--", ...paths);
  if (before.error || before.status !== 0) return failed(reasonOf(before));
  const added = git("add", "--", ...paths);
  if (added.error || added.status !== 0) return failed(restored(repo, paths, before.stdout, reasonOf(added)));
  const made = git("commit", "-m", message, "--only", "--", ...paths);
  if (made.error || made.status !== 0) return failed(restored(repo, paths, before.stdout, reasonOf(made)));
  const head = git("rev-parse", "HEAD");
  const sha = head.status === 0 ? head.stdout.trim() : "";
  if (!sha) return failed(reasonOf(head) || "git committed but HEAD cannot be read");
  return { ok: true, mode, status: "committed", sha, commit: line };
}

// Puts the index entries of `paths` back to `stage` (`git ls-files --stage -z` from before the
// `git add`): a path that had none is removed from the index again, and one that had entries gets
// them back. Gives `reason`, with a note when the index could not be put back.
/**
 * @param {string} repo
 * @param {readonly string[]} paths
 * @param {string} stage
 * @param {string} reason
 * @returns {string}
 */
function restored(repo, paths, stage, reason) {
  const entries = stage.split("\0").filter(Boolean);
  const had = new Set(entries.map((e) => e.slice(e.indexOf("\t") + 1)));
  const gone = paths.filter((p) => !had.has(p));
  const steps = [
    ...(gone.length ? [spawnSync("git", ["-C", repo, "rm", "-q", "--cached", "--ignore-unmatch", "--", ...gone], { encoding: "utf8" })] : []),
    ...(entries.length ? [spawnSync("git", ["-C", repo, "update-index", "-z", "--index-info"], { input: entries.map((e) => `${e}\0`).join(""), encoding: "utf8" })] : []),
  ];
  return steps.every((s) => !s.error && s.status === 0) ? reason : `${reason}\n(the index of these paths could not be put back as it was)`;
}

// A result that did not commit: `ask` is the one such status that is no failure.
/**
 * @param {CommitMode} mode
 * @param {"ask" | "failed" | "refused"} status
 * @param {string} reason
 * @param {string | null} commit
 * @returns {CommitResult}
 */
const outcome = (mode, status, reason, commit) => ({ ok: status === "ask", mode, status, reason, commit });

// What git said, trimmed: its stderr, else the spawn's error, else its stdout.
/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} r
 * @returns {string}
 */
const reasonOf = (r) => r.stderr?.trim() || r.error?.message || r.stdout?.trim() || `git exited with status ${r.status}`;

// The command line's `commit` (scripts/scan.mjs): the project's Commit mode, then the one `commit`
// line from `--input <file>` or stdin.
/** @type {CommandDefinition} */
export const command = {
  options: { stdin: "flag", confirmed: "flag", root: "qa-dir" },
  usage: "--stdin [--confirmed] [--root <qa-dir>]",
  run(args, ctx) {
    if (args.length) throw new UsageError("commit takes no argument: write the command's `commit` line to a file and pass it with --input <file>");
    if (!ctx.stdin) throw new UsageError("commit reads the command's `commit` line from --input <file> or --stdin");
    const root = /** @type {string} */ (ctx.root);
    const result = commit({
      mode: rootConfig(root).commitMode,
      repo: repositoryOf(root)?.top ?? null,
      line: ctx.stdin(),
      confirmed: ctx.confirmed === true,
    });
    return { exit: result.ok ? 0 : 1, json: result };
  },
};
