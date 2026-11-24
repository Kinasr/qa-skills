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
// Nothing here stages or commits: `commitLine` only words the command, which `lib/commit.mjs` makes
// as the project's Commit mode says (ADR-0062).
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * A file write in a Changeset.
 * @typedef {{
 *   path: string,
 *   text: string,
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
 * Result of writeAll: empty object on success, or { error, reason, code?, path? } on failure.
 * @typedef {{
 *   error?: string,
 *   reason?: string,
 *   code?: "EEXIST",
 *   path?: string,
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

/**
 * Returns `lstatSync(abs)` without following symlinks, or `null` when absent or under a non-directory.
 * @param {string} abs
 * @returns {import("node:fs").Stats | null}
 */
function statNoFollow(abs) {
  try {
    return lstatSync(abs);
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}

// The Changeset written under `repo`, all or none, in three phases:
//   1. stage: each regular write's text beside its target (`<path>.tmp`), and parent dirs for
//      `absent` writes, after the checks that `absent` asks for;
//   2. set aside: each target that exists, and each file to delete, renamed to `<path>.qa-init-aside`;
//      a path already taken by such a file is in the way, and stops the write;
//   3. put in place: each `absent` write opened exclusively (`wx`), then each staged file renamed
//      onto its target.
// Then the set-aside files are removed, and the write is done. A failure in any phase undoes them
// all: what was put in place is removed, what was set aside is renamed back, and what was staged and
// the empty directories it created are removed. Each undo step that fails is named in the reason,
// beside the failure that stopped the write, so neither hides the other. Returns `{}`, or
// `{error, reason, code?, path?}`.
/**
 * @param {string} repo
 * @param {Changeset} changeset
 * @returns {WriteAllResult}
 */
export function writeAll(repo, { writes, deletes = [] }) {
  const rel = (/** @type {string} */ abs) => relative(repo, abs).split(sep).join("/");
  /** @type {string[]} */
  const created = [];
  /** @type {Set<string>} */
  const createdSet = new Set();
  /** @type {string[]} */
  const staged = [];
  /** @type {string[]} */
  const aside = [];
  /** @type {string[]} */
  const placed = [];

  /** @param {string} absFile */
  const recordMissingDirs = (absFile) => {
    /** @type {string[]} */
    const missing = [];
    for (let d = dirname(absFile); statNoFollow(d) === null && dirname(d) !== d; d = dirname(d)) {
      missing.unshift(d);
    }
    for (const d of missing) {
      if (!createdSet.has(d)) {
        createdSet.add(d);
        created.push(d);
      }
    }
  };

  try {
    /** @type {Set<string>} */
    const seenWrites = new Set();
    /** @type {Set<string>} */
    const seenDeletes = new Set();
    for (const w of writes) {
      const abs = resolve(repo, w.path);
      if (seenWrites.has(abs)) throw new Error(`${w.path} appears more than once in writes`);
      seenWrites.add(abs);
    }
    for (const p of deletes) {
      const abs = resolve(repo, p);
      if (seenDeletes.has(abs)) throw new Error(`${p} appears more than once in deletes`);
      if (seenWrites.has(abs)) throw new Error(`${p} appears in both writes and deletes`);
      seenDeletes.add(abs);
    }

    const regularWrites = writes.filter((w) => !w.absent);
    const absentWrites = writes.filter((w) => w.absent);

    // Phase 0: fast-fail `absent` pre-check (including broken symlinks via `statNoFollow`).
    for (const w of absentWrites) {
      if (statNoFollow(join(repo, w.path)) !== null) {
        throw Object.assign(new Error(`${w.path} exists already`), { qaCode: "EEXIST", qaPath: w.path });
      }
    }

    // Phase 1: stage regular writes and create missing parent dirs for `absentWrites`.
    for (const w of regularWrites) {
      const abs = join(repo, w.path);
      recordMissingDirs(abs);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(`${abs}.tmp`, w.text);
      staged.push(abs);
      // A replaced regular file keeps its mode: the staged file is renamed onto it, so it would take the umask's.
      const st = statNoFollow(abs);
      if (st && st.isFile()) chmodSync(`${abs}.tmp`, st.mode & 0o7777);
    }
    for (const w of absentWrites) {
      const abs = join(repo, w.path);
      recordMissingDirs(abs);
      mkdirSync(dirname(abs), { recursive: true });
    }

    // Phase 2: set aside existing targets for regular writes and deletes.
    for (const abs of [...staged, ...deletes.map((p) => join(repo, p))]) {
      const st = statNoFollow(abs);
      if (st === null) continue;
      if (st.isDirectory()) throw new Error(`${rel(abs)} is a directory`);
      if (statNoFollow(`${abs}${SET_ASIDE_SUFFIX}`) !== null) throw new Error(`${rel(abs)}${SET_ASIDE_SUFFIX} is in the way`);
      try {
        renameSync(abs, `${abs}${SET_ASIDE_SUFFIX}`);
      } catch (e) {
        throw new Error(`${(/** @type {NodeJS.ErrnoException} */ (e)).code ?? (/** @type {Error} */ (e)).message}: ${rel(abs)} cannot be replaced`);
      }
      aside.push(abs);
    }

    // Phase 3: place `absentWrites` atomically via `openSync(abs, "wx")`, then rename `staged`.
    for (const w of absentWrites) {
      const abs = join(repo, w.path);
      let fd;
      try {
        fd = openSync(abs, "wx");
      } catch (err) {
        if (/** @type {NodeJS.ErrnoException} */ (err).code === "EEXIST") {
          throw Object.assign(new Error(`${w.path} exists already`), { qaCode: "EEXIST", qaPath: w.path });
        }
        throw err;
      }
      placed.push(abs);
      try {
        writeFileSync(fd, w.text);
      } finally {
        closeSync(fd);
      }
    }
    for (const abs of staged) {
      renameSync(`${abs}.tmp`, abs);
      placed.push(abs);
    }
  } catch (e) {
    const err = /** @type {Error & { qaCode?: "EEXIST", qaPath?: string }} */ (e);
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
    for (const d of [...created].reverse()) {
      undo(d, () => {
        try {
          rmdirSync(d);
        } catch (rmErr) {
          const code = /** @type {NodeJS.ErrnoException} */ (rmErr).code;
          if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST" && code !== "ENOTDIR") throw rmErr;
        }
      });
    }
    const reason = stuck.length ? `${err.message}; and ${stuck.join(", ")} could not be put back as it was` : err.message;
    return {
      error: `nothing was written: ${reason}`,
      reason,
      ...(err.qaCode !== undefined && { code: err.qaCode }),
      ...(err.qaPath !== undefined && { path: err.qaPath }),
    };
  }
  for (const abs of aside) rmSync(`${abs}${SET_ASIDE_SUFFIX}`, { force: true });
  return {};
}
