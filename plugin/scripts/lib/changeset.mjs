// @ts-check
// The Changeset: the files a command writes in the repository, as data, and the two things every
// writer does with one. A Changeset is
//
//   {writes: [{path, text, absent?}], deletes: [path]}
//
// `path` is relative to the directory `writeAll` is given (the repository, for every writer but one
// that is given `.qa/`). `absent` names a write whose target must not exist when the write is made: it
// refuses the whole write rather than replace what has appeared since the Card was built. A rename is
// a write at the new path and a delete of the old one.
//
//   writeAll(repo, changeset)      every write and delete made, or none
//   commitLine(paths, message)     the suggested path-scoped commit for the files written
//   changedPaths(changeset)        every path a Changeset touches, sorted: what a commit line names
//
// Nothing here stages or commits: `commitLine` only words the command the engineer may run (ADR-0024).
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/**
 * A file write in a Changeset.
 * @typedef {{
 *   path: string,
 *   text?: string,
 *   absent?: boolean,
 * }} ChangesetWrite
 */

/**
 * The Changeset shape: file writes and optional deletions.
 * @typedef {{
 *   writes: readonly ChangesetWrite[],
 *   deletes?: readonly string[],
 * }} Changeset
 */

/**
 * Result of writeAll: empty object on success, or { error, reason } on failure.
 * @typedef {{
 *   error?: string,
 *   reason?: string,
 * }} WriteAllResult
 */

// What `writeAll` renames a target to while the write is under way, beside it.
const SET_ASIDE_SUFFIX = ".qa-init-aside";

// The suggested path-scoped commit for the files written; nothing is ever staged or committed here.
/**
 * @param {readonly string[]} paths
 * @param {string | null | undefined} [message]
 * @returns {string}
 */
export const commitLine = (paths, message) => {
  const list = paths.map(shellArg).join(" ");
  return `git add -- ${list} && git commit -m ${/^[^"$`\\!]*$/.test(`${message}`) ? `"${message}"` : shellArg(`${message}`)} -- ${list}`;
};

// One POSIX shell word: as it is when nothing in it is special to a shell, else single-quoted.
/** @type {(s: string) => string} */
const shellArg = (s) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);

// Every path a Changeset writes or deletes, sorted.
/**
 * @param {Changeset} changeset
 * @returns {string[]}
 */
export const changedPaths = ({ writes, deletes = [] }) => [...writes.map((w) => w.path), ...deletes].sort();

// The Changeset written under `repo`, all or none, in three phases:
//   1. stage: each write's text beside its target (`<path>.tmp`), after the checks that `absent` asks
//      for;
//   2. set aside: each target that exists, and each file to delete, renamed to `<path>.qa-init-aside`;
//      a path already taken by such a file is in the way, and stops the write;
//   3. put in place: each staged file renamed onto its target.
// Then the set-aside files are removed, and the write is done. A failure in any phase undoes them
// all: what was put in place is removed, what was set aside is renamed back, and what was staged and
// the directories it created are removed. Each undo step that fails is named in the reason, beside the
// failure that stopped the write, so neither hides the other. Returns `{}`, or `{error, reason}`.
/**
 * @param {string} repo
 * @param {Changeset} changeset
 * @returns {WriteAllResult}
 */
export function writeAll(repo, { writes, deletes = [] }) {
  const rel = (/** @type {string} */ abs) => relative(repo, abs).split(sep).join("/");
  /** @type {string[]} */
  const created = [];
  /** @type {string[]} */
  const staged = [];
  /** @type {string[]} */
  const aside = [];
  /** @type {string[]} */
  const placed = [];
  try {
    for (const w of writes) {
      if (w.absent && existsSync(join(repo, w.path))) throw new Error(`${w.path} exists already`);
    }
    for (const w of writes) {
      const abs = join(repo, w.path);
      for (let d = dirname(abs); !existsSync(d); d = dirname(d)) created.unshift(d);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(`${abs}.tmp`, /** @type {string} */ (w.text));
      staged.push(abs);
      // A replaced file keeps its mode: the staged file is renamed onto it, so it would take the umask's.
      if (existsSync(abs)) chmodSync(`${abs}.tmp`, statSync(abs).mode & 0o7777);
    }
    for (const abs of [...staged, ...deletes.map((p) => join(repo, p))].filter((t) => existsSync(t))) {
      if (existsSync(`${abs}${SET_ASIDE_SUFFIX}`)) throw new Error(`${rel(abs)}${SET_ASIDE_SUFFIX} is in the way`);
      try {
        renameSync(abs, `${abs}${SET_ASIDE_SUFFIX}`);
      } catch (e) {
        throw new Error(`${(/** @type {NodeJS.ErrnoException} */ (e)).code ?? (/** @type {Error} */ (e)).message}: ${rel(abs)} cannot be replaced`);
      }
      aside.push(abs);
    }
    for (const abs of staged) {
      renameSync(`${abs}.tmp`, abs);
      placed.push(abs);
    }
  } catch (e) {
    /** @type {string[]} */
    const stuck = [];
    const undo = (/** @type {string} */ abs, /** @type {() => void} */ step) => {
      try {
        step();
      } catch {
        stuck.push(rel(abs));
      }
    };
    for (const abs of placed) undo(abs, () => rmSync(abs, { force: true }));
    for (const abs of aside) undo(abs, () => renameSync(`${abs}${SET_ASIDE_SUFFIX}`, abs));
    for (const abs of staged.filter((t) => !placed.includes(t))) undo(abs, () => rmSync(`${abs}.tmp`, { force: true }));
    for (const d of created.reverse()) undo(d, () => rmSync(d, { recursive: true, force: true }));
    const reason = stuck.length ? `${(/** @type {Error} */ (e)).message}; and ${stuck.join(", ")} could not be put back as it was` : (/** @type {Error} */ (e)).message;
    return { error: `nothing was written: ${reason}`, reason };
  }
  for (const abs of aside) rmSync(`${abs}${SET_ASIDE_SUFFIX}`, { force: true });
  return {};
}
