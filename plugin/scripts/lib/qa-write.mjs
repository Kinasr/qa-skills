// @ts-check
// Gated `.qa/` write transaction primitive (`writeQa`): enforces the schema gate, `.qa/`-relative
// path containment, `checkFile` validation, pin-digest backfill, companion run-dir JSON staging,
// atomic `.qa/` commit via `changeset.mjs:writeAll`, and pre-image rollback across `.qa/` and
// companion run-dir JSON files on failure.
/**
 * @import { ChangesetWrite } from "./changeset.mjs"
 * @import { CheckProblem } from "./check-file.mjs"
 * @import { CommandResult } from "./cli.mjs"
 * @import { StagedJson } from "./run-dir.mjs"
 * @import { UnreadSchemaRefusal } from "./schema-guard.mjs"
 */
import { chmodSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { writeAll } from "./changeset.mjs";
import { checkFile, parse, projectConfig } from "./knowledge-file.mjs";
import { isContained } from "./paths.mjs";
import { backfillChangeset } from "./pin-digest.mjs";
import { rootConfig } from "./qa-index.mjs";
import { stageJson } from "./run-dir.mjs";
import { ANY_SCHEMA_VERSION } from "./schema.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";

/**
 * A companion JSON write staged alongside a `.qa/` transaction.
 * @typedef {{
 *   path: string,
 *   value: unknown,
 * }} StagedJsonSpec
 */

/**
 * Synchronous post-`.qa/` hook result; `{ ok: false, refusal }` triggers `.qa/` rollback.
 * @typedef {{ ok: true } | { ok: false, refusal: CommandResult } | void} AfterCommitResult
 */

/**
 * Options for `writeQa`. All write/delete paths are strictly `.qa/`-relative under `root`.
 * @typedef {{
 *   root: string,
 *   minSchema?: number,
 *   writes?: readonly ChangesetWrite[],
 *   deletes?: readonly string[],
 *   skipUnchanged?: boolean,
 *   stage?: readonly StagedJsonSpec[],
 *   afterCommit?: () => AfterCommitResult,
 * }} WriteQaOptions
 */

/**
 * A `checkFile` validation problem tagged with the caller's path and normalized `.qa/`-relative path.
 * @typedef {CheckProblem & { path: string, rel: string }} WriteQaCheckError
 */

/**
 * Successful `writeQa` transaction result with normalized `/`-separated `.qa/`-relative paths.
 * @typedef {{
 *   ok: true,
 *   written: string[],
 *   deleted: string[],
 * }} WriteQaOk
 */

/**
 * Failure returned when `.qa/` fails the schema version gate.
 * @typedef {{
 *   ok: false,
 *   kind: "schema",
 *   refusal: UnreadSchemaRefusal,
 * }} WriteQaSchemaFailure
 */

/**
 * Failure returned when any write fails `checkFile` validation.
 * @typedef {{
 *   ok: false,
 *   kind: "check",
 *   errors: WriteQaCheckError[],
 * }} WriteQaCheckFailure
 */

/**
 * Failure returned on path containment, validation, pre-image, or atomic `.qa/` write failure.
 * @typedef {{
 *   ok: false,
 *   kind: "write",
 *   error: string,
 *   reason: string,
 *   code?: "EEXIST",
 *   path?: string,
 *   rolledBack: true,
 * }} WriteQaWriteFailure
 */

/**
 * Failure returned when staging or committing companion run-dir JSON fails.
 * @typedef {{
 *   ok: false,
 *   kind: "stage",
 *   error: string,
 *   reason: string,
 *   rolledBack: boolean,
 *   rollbackError?: string,
 * }} WriteQaStageFailure
 */

/**
 * Failure returned when synchronous `afterCommit` refuses, throws, or fails rollback.
 * @typedef {{
 *   ok: false,
 *   kind: "afterCommit",
 *   refusal?: CommandResult,
 *   error?: string,
 *   rolledBack: boolean,
 *   rollbackError?: string,
 * }} WriteQaAfterCommitFailure
 */

/**
 * Discriminated union returned by `writeQa`.
 * @typedef {WriteQaOk | WriteQaSchemaFailure | WriteQaCheckFailure | WriteQaWriteFailure | WriteQaStageFailure | WriteQaAfterCommitFailure} WriteQaResult
 */

/**
 * Validated `.qa/` write entry after containment normalization.
 * @typedef {{
 *   origPath: string,
 *   rel: string,
 *   abs: string,
 *   text: string,
 *   absent?: boolean,
 * }} ValidatedWrite
 */

/**
 * Pre-image of a `.qa/` target captured before mutation.
 * @typedef {{
 *   exists: false,
 *   rel: string,
 *   abs: string,
 * } | {
 *   exists: true,
 *   kind: "file",
 *   rel: string,
 *   abs: string,
 *   text: string,
 *   mode: number,
 * } | {
 *   exists: true,
 *   kind: "symlink",
 *   rel: string,
 *   abs: string,
 *   target: string,
 * }} QaPreImage
 */

/**
 * Pre-image of a staged companion run-dir JSON file captured before staging.
 * @typedef {{
 *   exists: false,
 *   abs: string,
 * } | {
 *   exists: true,
 *   kind: "file",
 *   abs: string,
 *   bytes: Buffer,
 *   mode: number,
 * } | {
 *   exists: true,
 *   kind: "symlink",
 *   abs: string,
 *   target: string,
 * }} StagePreImage
 */

let rbSeq = 0;

/**
 * Validates and resolves a `.qa/`-relative path inside `absRoot`.
 * @param {string} absRoot
 * @param {string} rawPath
 * @returns {{ ok: true, abs: string, rel: string } | { ok: false, reason: string }}
 */
function resolveQaRelative(absRoot, rawPath) {
  if (
    rawPath.includes("\0") ||
    isAbsolute(rawPath) ||
    /^[A-Za-z]:/.test(rawPath) ||
    rawPath.startsWith("\\")
  ) {
    return { ok: false, reason: `${rawPath} must be a .qa/-relative path` };
  }
  const abs = resolve(absRoot, rawPath);
  const relRaw = relative(absRoot, abs);
  if (!isContained(absRoot, abs, { strict: true })) {
    return { ok: false, reason: `${rawPath} escapes .qa/ root` };
  }
  return { ok: true, abs, rel: relRaw.split(sep).join("/") };
}

/**
 * Returns `lstatSync(abs)` without following symlinks, or `null` on `ENOENT`/`ENOTDIR`.
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

/**
 * Builds a write-phase failure result.
 * @param {string} reason
 * @param {"EEXIST"} [code]
 * @param {string} [path]
 * @returns {WriteQaWriteFailure}
 */
function writeFailure(reason, code, path) {
  return {
    ok: false,
    kind: "write",
    error: `nothing was written: ${reason}`,
    reason,
    ...(code !== undefined && { code }),
    ...(path !== undefined && { path }),
    rolledBack: true,
  };
}

/**
 * Phase 1: validates `.qa/` write/delete containment and uniqueness plus companion stage uniqueness.
 * @param {string} absRoot
 * @param {readonly ChangesetWrite[]} rawWrites
 * @param {readonly string[]} rawDeletes
 * @param {readonly StagedJsonSpec[]} rawStage
 * @returns {{
 *   ok: true,
 *   writes: ValidatedWrite[],
 *   deletes: string[],
 * } | {
 *   ok: false,
 *   failure: WriteQaWriteFailure | WriteQaStageFailure,
 * }}
 */
function validateInputs(absRoot, rawWrites, rawDeletes, rawStage) {
  /** @type {ValidatedWrite[]} */
  const writes = [];
  /** @type {Set<string>} */
  const seenWrites = new Set();
  for (const w of rawWrites) {
    const resolved = resolveQaRelative(absRoot, w.path);
    if (!resolved.ok) return { ok: false, failure: writeFailure(resolved.reason) };
    if (seenWrites.has(resolved.abs)) return { ok: false, failure: writeFailure(`${w.path} appears more than once in writes`) };
    seenWrites.add(resolved.abs);
    writes.push({
      origPath: w.path,
      rel: resolved.rel,
      abs: resolved.abs,
      text: w.text,
      ...(w.absent !== undefined && { absent: w.absent }),
    });
  }

  /** @type {string[]} */
  const deletes = [];
  /** @type {Set<string>} */
  const seenDeletes = new Set();
  for (const p of rawDeletes) {
    const resolved = resolveQaRelative(absRoot, p);
    if (!resolved.ok) return { ok: false, failure: writeFailure(resolved.reason) };
    if (seenDeletes.has(resolved.abs)) return { ok: false, failure: writeFailure(`${p} appears more than once in deletes`) };
    if (seenWrites.has(resolved.abs)) return { ok: false, failure: writeFailure(`${p} appears in both writes and deletes`) };
    seenDeletes.add(resolved.abs);
    deletes.push(resolved.rel);
  }

  /** @type {Set<string>} */
  const seenStage = new Set();
  for (const s of rawStage) {
    const stageAbs = resolve(s.path);
    if (seenStage.has(stageAbs)) {
      const reason = `duplicate staged path ${s.path}`;
      return { ok: false, failure: { ok: false, kind: "stage", error: `nothing was written: ${reason}`, reason, rolledBack: true } };
    }
    seenStage.add(stageAbs);
  }

  return { ok: true, writes, deletes };
}

/**
 * Phase 2: runs `checkFile` unconditionally on every write using staged `project.md` config if valid.
 * @param {string} absRoot
 * @param {readonly ValidatedWrite[]} writes
 * @returns {WriteQaCheckFailure | null}
 */
function checkWrites(absRoot, writes) {
  const baseConfig = rootConfig(absRoot);
  let checkConfig = baseConfig;
  const projectWrite = writes.find((w) => w.rel === "project.md");
  if (projectWrite) {
    const parsedProject = parse("project.md", projectWrite.text);
    if (parsedProject.type === "project") {
      checkConfig = { ...projectConfig(parsedProject), pathInsideRepo: baseConfig.pathInsideRepo };
    }
  }
  /** @type {WriteQaCheckError[]} */
  const checkErrors = [];
  for (const w of writes) {
    const checked = checkFile(parse(w.rel, w.text), checkConfig);
    for (const err of checked.errors) {
      checkErrors.push({ ...err, path: w.origPath, rel: w.rel });
    }
  }
  return checkErrors.length > 0 ? { ok: false, kind: "check", errors: checkErrors } : null;
}

/**
 * Phase 3: runs `backfillChangeset` and drops unchanged non-`absent` regular files when `skipUnchanged` is set.
 * @param {string} absRoot
 * @param {readonly ValidatedWrite[]} writes
 * @param {readonly string[]} deletes
 * @param {boolean | undefined} skipUnchanged
 * @returns {{ ok: true, writes: ChangesetWrite[] } | { ok: false, failure: WriteQaWriteFailure }}
 */
function prepareWrites(absRoot, writes, deletes, skipUnchanged) {
  /** @type {ChangesetWrite[]} */
  const normalizedWrites = writes.map((w) => ({
    path: w.rel,
    text: w.text,
    ...(w.absent !== undefined && { absent: w.absent }),
  }));
  const backfilled = backfillChangeset(absRoot, absRoot, { writes: normalizedWrites, deletes });
  if (skipUnchanged !== true) return { ok: true, writes: [...backfilled.writes] };

  /** @type {ChangesetWrite[]} */
  const filtered = [];
  for (const w of backfilled.writes) {
    if (w.absent) {
      filtered.push(w);
      continue;
    }
    const abs = join(absRoot, w.path);
    try {
      const st = statNoFollow(abs);
      if (st && st.isFile() && readFileSync(abs, "utf8") === w.text) continue;
    } catch (err) {
      return { ok: false, failure: writeFailure(err instanceof Error ? err.message : String(err)) };
    }
    filtered.push(w);
  }
  return { ok: true, writes: filtered };
}

/**
 * Captures deduplicated `.qa/` pre-images and missing ancestor dirs before Phase 5 mutation.
 * @param {string} absRoot
 * @param {readonly ChangesetWrite[]} writes
 * @param {readonly string[]} deletes
 * @returns {{
 *   ok: true,
 *   preImages: Map<string, QaPreImage>,
 *   createdDirs: string[],
 * } | {
 *   ok: false,
 *   failure: WriteQaWriteFailure,
 * }}
 */
function captureQaState(absRoot, writes, deletes) {
  /** @type {Map<string, QaPreImage>} */
  const preImages = new Map();
  /** @type {string[]} */
  const createdDirs = [];
  /** @type {Set<string>} */
  const createdDirSet = new Set();

  for (const relPath of [...writes.map((w) => w.path), ...deletes]) {
    const abs = join(absRoot, relPath);
    try {
      const st = statNoFollow(abs);
      if (st === null) {
        preImages.set(abs, { exists: false, rel: relPath, abs });
      } else if (st.isFile()) {
        preImages.set(abs, {
          exists: true,
          kind: "file",
          rel: relPath,
          abs,
          text: readFileSync(abs, "utf8"),
          mode: st.mode & 0o7777,
        });
      } else if (st.isSymbolicLink()) {
        preImages.set(abs, {
          exists: true,
          kind: "symlink",
          rel: relPath,
          abs,
          target: readlinkSync(abs),
        });
      } else {
        return { ok: false, failure: writeFailure(`${relPath} is not a file or symlink`) };
      }
    } catch (err) {
      return { ok: false, failure: writeFailure(err instanceof Error ? err.message : String(err)) };
    }
  }

  for (const w of writes) {
    const abs = join(absRoot, w.path);
    /** @type {string[]} */
    const missing = [];
    for (
      let d = dirname(abs);
      d !== absRoot && d !== dirname(d) && isContained(absRoot, d, { strict: true }) && statNoFollow(d) === null;
      d = dirname(d)
    ) {
      missing.unshift(d);
    }
    for (const d of missing) {
      if (!createdDirSet.has(d)) {
        createdDirSet.add(d);
        createdDirs.push(d);
      }
    }
  }

  return { ok: true, preImages, createdDirs };
}

/**
 * Captures pre-images and stages companion run-dir JSON writes; aborts earlier temps on failure.
 * @param {readonly StagedJsonSpec[]} rawStage
 * @returns {{
 *   ok: true,
 *   preImages: StagePreImage[],
 *   staged: StagedJson[],
 * } | {
 *   ok: false,
 *   failure: WriteQaStageFailure,
 * }}
 */
function stageCompanionJson(rawStage) {
  /** @type {StagePreImage[]} */
  const preImages = [];
  /** @type {StagedJson[]} */
  const staged = [];
  for (const spec of rawStage) {
    const abs = resolve(spec.path);
    try {
      const st = statNoFollow(abs);
      if (st === null) {
        preImages.push({ exists: false, abs });
      } else if (st.isFile()) {
        preImages.push({
          exists: true,
          kind: "file",
          abs,
          bytes: readFileSync(abs),
          mode: st.mode & 0o7777,
        });
      } else if (st.isSymbolicLink()) {
        preImages.push({
          exists: true,
          kind: "symlink",
          abs,
          target: readlinkSync(abs),
        });
      } else {
        throw Object.assign(new Error(`EISDIR: ${spec.path} is a directory`), { code: "EISDIR" });
      }
      staged.push(stageJson(spec.path, spec.value));
    } catch (err) {
      for (const s of staged) s.abort();
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, failure: { ok: false, kind: "stage", error: `nothing was written: ${reason}`, reason, rolledBack: true } };
    }
  }
  return { ok: true, preImages, staged };
}

/**
 * Restores `.qa/` from captured pre-images, restoring files, symlinks, POSIX modes, and pruning created dirs.
 * @param {string} absRoot
 * @param {ReadonlyMap<string, QaPreImage>} qaPreImages
 * @param {readonly string[]} createdDirs
 * @returns {{ rolledBack: boolean, rollbackError?: string }}
 */
function rollbackQaState(absRoot, qaPreImages, createdDirs) {
  if (qaPreImages.size === 0) return { rolledBack: true };
  /** @type {ChangesetWrite[]} */
  const filePreImages = [];
  /** @type {string[]} */
  const absentOrSymlinkTargets = [];
  /** @type {Array<{ abs: string, rel: string, target: string }>} */
  const symlinkPreImages = [];
  /** @type {Array<{ abs: string, rel: string, mode: number }>} */
  const fileModes = [];
  for (const pre of qaPreImages.values()) {
    if (!pre.exists) {
      absentOrSymlinkTargets.push(pre.rel);
    } else if (pre.kind === "file") {
      filePreImages.push({ path: pre.rel, text: pre.text });
      fileModes.push({ abs: pre.abs, rel: pre.rel, mode: pre.mode });
    } else {
      absentOrSymlinkTargets.push(pre.rel);
      symlinkPreImages.push({ abs: pre.abs, rel: pre.rel, target: pre.target });
    }
  }
  /** @type {string[]} */
  const rollbackErrors = [];
  const rb = writeAll(absRoot, { writes: filePreImages, deletes: absentOrSymlinkTargets });
  if (rb.error) {
    rollbackErrors.push(rb.error);
  } else {
    for (const sym of symlinkPreImages) {
      try {
        mkdirSync(dirname(sym.abs), { recursive: true });
        symlinkSync(sym.target, sym.abs);
      } catch (err) {
        rollbackErrors.push(`${sym.rel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    for (const fm of fileModes) {
      try {
        chmodSync(fm.abs, fm.mode);
      } catch (err) {
        rollbackErrors.push(`${fm.rel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    for (const d of [...createdDirs].reverse()) {
      try {
        rmdirSync(d);
      } catch (err) {
        const code = /** @type {NodeJS.ErrnoException} */ (err).code;
        if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST" && code !== "ENOTDIR") {
          rollbackErrors.push(`${relative(absRoot, d).split(sep).join("/")}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  return rollbackErrors.length
    ? { rolledBack: false, rollbackError: rollbackErrors.join("; ") }
    : { rolledBack: true };
}

/**
 * Restores `stage[0..count-1]` from captured pre-images without short-circuiting on errors.
 * @param {readonly StagePreImage[]} stagePreImages
 * @param {number} count
 * @returns {string[]}
 */
function rollbackStageRange(stagePreImages, count) {
  /** @type {string[]} */
  const errors = [];
  for (let k = count - 1; k >= 0; k--) {
    const pre = stagePreImages[k];
    try {
      if (!pre.exists) {
        rmSync(pre.abs, { force: true });
      } else if (pre.kind === "file") {
        const rbTemp = `${pre.abs}.rollback.${process.pid}.${++rbSeq}`;
        try {
          writeFileSync(rbTemp, pre.bytes);
          chmodSync(rbTemp, pre.mode);
          renameSync(rbTemp, pre.abs);
        } catch (err) {
          try { rmSync(rbTemp, { force: true }); } catch {}
          throw err;
        }
      } else {
        rmSync(pre.abs, { force: true });
        symlinkSync(pre.target, pre.abs);
      }
    } catch (err) {
      errors.push(`${pre.abs}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errors;
}

/**
 * Executes a gated `.qa/` write transaction across schema check, path containment, `checkFile`,
 * pin-digest backfill, companion JSON staging, atomic write, and rollback.
 * @param {WriteQaOptions} options
 * @returns {WriteQaResult}
 */
export function writeQa(options) {
  const absRoot = resolve(options.root);
  // Phase 1: schema gate & path containment.
  const schema = refuseUnreadSchema(absRoot, options.minSchema ?? ANY_SCHEMA_VERSION);
  if (schema) return { ok: false, kind: "schema", refusal: schema };

  const rawStage = options.stage ?? [];
  const validated = validateInputs(absRoot, options.writes ?? [], options.deletes ?? [], rawStage);
  if (!validated.ok) return validated.failure;

  // Phase 2: unconditional `checkFile` gate.
  const checkFailure = checkWrites(absRoot, validated.writes);
  if (checkFailure) return checkFailure;

  // Phase 3: pin-digest backfill and optional `skipUnchanged`.
  const prepared = prepareWrites(absRoot, validated.writes, validated.deletes, options.skipUnchanged);
  if (!prepared.ok) return prepared.failure;
  const preparedWrites = prepared.writes;
  const preparedDeletes = validated.deletes;
  const hasPreparedQa = preparedWrites.length > 0 || preparedDeletes.length > 0;

  // Phase 4: `.qa/` pre-image capture & companion run-dir JSON staging.
  /** @type {Map<string, QaPreImage>} */
  let qaPreImages = new Map();
  /** @type {string[]} */
  let createdDirs = [];
  if ((rawStage.length > 0 || options.afterCommit !== undefined) && hasPreparedQa) {
    const captured = captureQaState(absRoot, preparedWrites, preparedDeletes);
    if (!captured.ok) return captured.failure;
    qaPreImages = captured.preImages;
    createdDirs = captured.createdDirs;
  }

  const stageResult = stageCompanionJson(rawStage);
  if (!stageResult.ok) return stageResult.failure;
  const { preImages: stagePreImages, staged } = stageResult;

  // Phase 5: atomic `.qa/` commit via `writeAll`.
  if (hasPreparedQa) {
    const written = writeAll(absRoot, { writes: preparedWrites, deletes: preparedDeletes });
    if (written.error) {
      for (const s of staged) s.abort();
      return writeFailure(written.reason ?? written.error, written.code, written.path);
    }
  }

  // Phase 6: synchronous `afterCommit`, staged JSON commits, and automatic pre-image rollback.
  if (options.afterCommit !== undefined) {
    /** @type {AfterCommitResult} */
    let res;
    try {
      res = options.afterCommit();
    } catch (err) {
      for (const s of staged) s.abort();
      const rb = rollbackQaState(absRoot, qaPreImages, createdDirs);
      return {
        ok: false,
        kind: "afterCommit",
        error: err instanceof Error ? err.message : String(err),
        ...rb,
      };
    }
    if (res != null && typeof res === "object" && "then" in res && typeof res.then === "function") {
      for (const s of staged) s.abort();
      rollbackQaState(absRoot, qaPreImages, createdDirs);
      throw new TypeError("writeQa: afterCommit must be synchronous");
    }
    if (res && res.ok === false) {
      for (const s of staged) s.abort();
      const rb = rollbackQaState(absRoot, qaPreImages, createdDirs);
      return {
        ok: false,
        kind: "afterCommit",
        refusal: res.refusal,
        ...rb,
      };
    }
  }

  for (let i = 0; i < staged.length; i++) {
    try {
      staged[i].commit();
    } catch (err) {
      for (let m = i + 1; m < staged.length; m++) staged[m].abort();
      const stageRollbackErrors = rollbackStageRange(stagePreImages, i);
      const qaRb = rollbackQaState(absRoot, qaPreImages, createdDirs);
      const allRollbackErrors = [
        ...stageRollbackErrors,
        ...(qaRb.rollbackError !== undefined ? [qaRb.rollbackError] : []),
      ];
      const rolledBack = stageRollbackErrors.length === 0 && qaRb.rolledBack;
      const rollbackError = allRollbackErrors.length ? allRollbackErrors.join("; ") : undefined;
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        kind: "stage",
        error: `nothing was written: ${reason}`,
        reason,
        rolledBack,
        ...(rollbackError !== undefined && { rollbackError }),
      };
    }
  }

  return {
    ok: true,
    written: preparedWrites.map((w) => w.path),
    deleted: [...preparedDeletes],
  };
}
