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
import { resolve } from "node:path";
import { commitLine } from "./changeset.mjs";
import { parseShellWords, UsageError } from "./cli.mjs";
import { defaultBranch, gitReason, runGit } from "./git.mjs";
import { repositoryOf } from "./git-tree.mjs";
import { isContained, isSafeRelativePath } from "./paths.mjs";
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
  const words = parseShellWords(line, { allowDoubleQuotes: true, allowNewlines: true, allowAndOperator: true });
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

// Whether `path` is relative to `repo` and stays inside it: not absolute, no `..` segment, and no
// path that resolves outside. A NUL byte is no path at all.
/**
 * @param {string} repo
 * @param {string} path
 * @returns {boolean}
 */
function safePath(repo, path) {
  if (!isSafeRelativePath(path)) return false;
  const top = resolve(repo);
  const abs = resolve(top, path);
  return abs !== top && isContained(top, abs);
}

// The path-scoped commit: `git add` the paths, then `git commit --only` them. A failure is reported
// as git words it and never retried; the paths' index entries go back to what they were before.
/**
 * Stage and commit only `paths` in `repo` (`git commit --only`), restoring those paths' prior
 * index entries if staging or committing fails.
 * @param {string} repo
 * @param {readonly string[]} paths
 * @param {string} message
 * @returns {{ ok: true, sha: string } | { ok: false, stage: "ls-files" | "add" | "commit" | "rev-parse", reason: string }}
 */
export function commitPaths(repo, paths, message) {
  if (paths.length === 0) return { ok: false, stage: "add", reason: "no paths specified" };
  const before = runGit(repo, ["--literal-pathspecs", "ls-files", "--stage", "-z", "--", ...paths]);
  if (before.error || before.status !== 0) return { ok: false, stage: "ls-files", reason: gitReason(before, "ls-files") };
  const added = runGit(repo, ["--literal-pathspecs", "add", "--", ...paths]);
  if (added.error || added.status !== 0) {
    return { ok: false, stage: "add", reason: restoreStagedIndex(repo, paths, before.stdout, gitReason(added, "add")) };
  }
  const made = runGit(repo, ["--literal-pathspecs", "commit", "-m", message, "--only", "--", ...paths]);
  if (made.error || made.status !== 0) {
    return { ok: false, stage: "commit", reason: restoreStagedIndex(repo, paths, before.stdout, gitReason(made, "commit")) };
  }
  const head = runGit(repo, ["rev-parse", "HEAD"]);
  if (head.error || head.status !== 0) return { ok: false, stage: "rev-parse", reason: gitReason(head, "rev-parse") };
  const sha = head.stdout.trim();
  if (!sha) return { ok: false, stage: "rev-parse", reason: "git committed but HEAD cannot be read" };
  return { ok: true, sha };
}

/**
 * @param {string} repo
 * @param {CommitMode} mode
 * @param {readonly string[]} paths
 * @param {string} message
 * @param {string | null} line
 * @returns {CommitResult}
 */
function make(repo, mode, paths, message, line) {
  const res = commitPaths(repo, paths, message);
  if (!res.ok) return outcome(mode, "failed", res.reason, line);
  return { ok: true, mode, status: "committed", sha: res.sha, commit: line };
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
function restoreStagedIndex(repo, paths, stage, reason) {
  const entries = stage.split("\0").filter(Boolean);
  const had = new Set(entries.map((e) => e.slice(e.indexOf("\t") + 1)));
  const gone = paths.filter((p) => !had.has(p));
  const steps = [
    ...(gone.length ? [runGit(repo, ["--literal-pathspecs", "rm", "-q", "--cached", "--ignore-unmatch", "--", ...gone])] : []),
    ...(entries.length ? [runGit(repo, ["--literal-pathspecs", "update-index", "-z", "--index-info"], { input: entries.map((e) => `${e}\0`).join("") })] : []),
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

// The command line's `commit` (scripts/scan.mjs): the project's Commit mode, then the one `commit`
// line from `--input <file>` or stdin.
/** @type {CommandDefinition} */
export const command = {
  options: { stdin: "flag", confirmed: "flag", root: "qa-dir" },
  usage: "--input <path> [--confirmed] [--root <qa-dir>]",
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
