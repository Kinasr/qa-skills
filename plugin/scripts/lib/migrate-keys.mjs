// @ts-check
// `migrate-keys`: ordered legacy Key and level rewrites, then the schema-5 marker.
// lib/migration-plan.mjs decides what changes; this applies it to the working tree and nothing else:
//
//   - a Case or Scenario declaration takes its minted Key, its old Key and any `new_…` history go to
//     `formerly:`, a tracker key to `tracker:`, and a `migrate_as:` it used is deleted
//   - the heading carrying that Key, and the Scenario's filename, follow it
//   - missing Feature Suite keys are minted in a batch, only on the default branch
//   - `project.md`'s `schema_version` becomes SUITE_KEYS_SCHEMA_VERSION (Case/Scenario boundary 2, Suite 3)
//
// The Key rewrite never commits, writes no Watermark or human stamp, and edits nothing the plan does not
// name (lib/knowledge-file.mjs `edit` leaves every other byte alone), so each human pin stays
// verbatim and lib/scan-history.mjs sees no comparable change. It refuses a `.qa/` with uncommitted
// changes, so an interrupted run is undone with git: restore `.qa/` from the starting commit, then
// run it again. Every refusal comes before the first write.
// On schema 4, `migrate-keys` advances only the schema-5 marker, preserving cases and pins.
// `--levels` follows the Key rewrite: it moves levels onto cases and carries only verified fresh
// Reviews and Dismissals with a new digest and `migrated: 4`, preserving their original provenance.
//
// Success is `{ok: true, changed, schema_version: {from, to}, mapping, consumed, renamed,
// rewritten, check}`: `mapping` is the plan's, `consumed` the `migrate_as:` Keys it used, `renamed`
// `{from, to}` paths, `rewritten` the files whose text changed, and `check.errors` what check-file
// finds in the result, for the engineer reviewing it as a PR. Identity errors refuse before writing. A refusal is `{ok: false, refusals}`,
// exit 1.
/** @import { CheckProblem } from "./check-file.mjs" */
/** @import { CommandDefinition } from "./cli.mjs" */
/** @import { EditChange, EditError, ParsedBoundary, ParsedFile, ParsedRule, ProjectConfig } from "./knowledge-file.mjs" */
/** @import { LegacyMigrationIndex, LevelMigrationPlan, MigrationMappingRow, MigrationPlanSuccess, MigrationRewrite } from "./migration-plan.mjs" */
/** @import { MintedKeys } from "./mint.mjs" */
/** @import { PinDigests } from "./pin-digest.mjs" */
/** @import { RefusalFact, RefusalResult } from "./refusal.mjs" */
/** @import { ScanFinding, KnowledgeIndex } from "./scan-integrity.mjs" */
/** @import { UnreadSchemaRefusal } from "./schema-guard.mjs" */
import { dirname, resolve } from "node:path";
import { writeAll } from "./changeset.mjs";
import { scan } from "./scan.mjs";
import { isMap } from "./dialect.mjs";
import { UsageError } from "./cli.mjs";
import { defaultBranch, hasOrigin, resolveCommits, uncommittedUnder } from "./git.mjs";
import { loadQaAt, repositoryOf } from "./git-tree.mjs";
import { checkFile, edit, parse, projectConfig, ruleItem } from "./knowledge-file.mjs";
import { planLevelMigration, planMigration } from "./migration-plan.mjs";
import { backfill, digests, isMigratedPin, pinsOf, writtenDigest } from "./pin-digest.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { refusalsWithoutLines } from "./refusal.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { ANY_SCHEMA_VERSION, LAYER_FREE_CASE_SCHEMA_VERSION, LEVEL_ON_CASE_SCHEMA_VERSION, RULE_LIST_SCHEMA_VERSION, SUITE_KEYS_SCHEMA_VERSION } from "./schema.mjs";
import { mint } from "./mint.mjs";
import { run as integrity } from "./scan-integrity.mjs";
import { coverageDigest } from "./coverage.mjs";

const { fact } = refusalsWithoutLines((code, data) => ({
  wrote: false,
  ...(code === "dirty_tree" && { fix: "commit or restore the changes" }),
  ...(code === "not_default_branch" && { fix: "git remote set-head origin --auto" }),
  ...(code === "identity_error" && { fix: "fix the identity error" }),
  ...(code === "unreadable_file" && { fix: "fix the file" }),
  ...(code === "rule_outside_section" && { fix: "move the heading under ## Rules or ## Boundaries" }),
  ...(code === "prose_in_section" && { fix: "move the prose above the section heading or into a Rule's elaboration" }),
  ...(code === "changed_tree" && { retry: true }),
  ...data,
}));
// Refusals are states of the tree, not usage errors: exit 1.
/**
 * @param {...RefusalFact} facts
 * @returns {RefusalResult}
 */
const refused = (...facts) => ({ exit: 1, json: { ok: false, refusals: facts } });

// The documented fix for a Key collision (ADR-0027).
const COLLISION_FIX = [
  "Add `migrate_as: tc_…` (`ts_…` for a Scenario), a Key of your choosing, to one of the colliding entries.",
  "Commit that edit: the migration refuses an uncommitted `.qa/`.",
  "Run `migrate-keys` again.",
].map((text, i) => ({ step: i + 1, text }));

/**
 * A `.qa/` file the migration reads: the parsed file (lib/knowledge-file.mjs), with the message of
 * a file that could not be read.
 * @typedef {ParsedFile & { unreadable?: string }} MigrationFile
 */

/**
 * The refusal that stopped the migration: what went wrong, and the data that says so.
 * @typedef {{
 *   code: string,
 *   data: Record<string, unknown>,
 * }} MigrationRefusal
 */

/**
 * The heading a rewrite replaces: the line it sits on, and the Key it holds and the one it takes.
 * @typedef {{ line: number, from: string, to: string }} RewriteHeading
 */

/**
 * `edit`'s verdict on a file: its new text, or the errors that stopped it.
 * @typedef {{
 *   ok: true,
 *   text: string,
 *   errors?: readonly EditError[],
 * } | {
 *   ok: false,
 *   text: string,
 *   errors: readonly EditError[],
 * }} EditVerdict
 */

/**
 * One file's rewrite: its new text and the path it takes, or the refusal that stopped it.
 * @typedef {{
 *   refusal: MigrationRefusal,
 *   text?: never,
 *   rename?: never,
 * } | {
 *   refusal?: never,
 *   text: string,
 *   rename?: string,
 * }} RewriteOutcome
 */

/**
 * A check-file error in the migrated tree, with the file it is in.
 * @typedef {CheckProblem & { file: string }} MigrationCheckError
 */

/**
 * What the migration did: the new text of every file it touched, the renames, the `migrate_as:`
 * Keys it consumed, the schema version it moved and the check's errors — or the refusal that
 * stopped it.
 * @typedef {{
 *   refusal: MigrationRefusal,
 * } | {
 *   refusal?: never,
 *   writes: Map<string, string>,
 *   after: ParsedFile[],
 *   config: ProjectConfig,
 *   renamed: { from: string, to: string }[],
 *   consumed: string[],
 *   schema: { from: number, to: number },
 *   checkErrors: MigrationCheckError[],
 *   pins?: PinOutcome[],
 * }} MigrationOutcome
 */

/**
 * The migration's success: what it changed, the schema version it moved, and the plan it applied.
 * @typedef {{
 *   ok: true,
 *   changed: boolean,
 *   schema_version: { from: number, to: number },
 *   mapping: MigrationMappingRow[],
 *   consumed: string[],
 *   renamed: { from: string, to: string }[],
 *   rewritten: string[],
 *   check: { errors: MigrationCheckError[] },
 *   pins?: PinOutcome[],
 * }} MigrationSuccess
 */

// Migrates the `.qa/` directory `root` in place.
/**
 * @param {string} root
 * @param {{ levels?: boolean, levelMap?: string, currentTree?: () => ReadonlyArray<{ rel: string, text?: unknown }> }} [options] `currentTree` is the final changed-tree read; a test injects one to hold a concurrent edit still.
 * @returns {LevelMigrationResult | UnreadSchemaRefusal | RefusalResult | { exit: 0, json: MigrationSuccess }}
 */
export function migrateKeys(root, { levels = false, levelMap = "", currentTree } = {}) {
  if (levels) return migrateLevels(root, levelMap);
  const newer = refuseUnreadSchema(root, ANY_SCHEMA_VERSION);
  if (newer) return newer;
  if (!repositoryOf(root)) return refused(fact("not_in_git", { root }));
  const dirty = uncommittedUnder(root);
  if (dirty.error) return refused(fact("git_status_failed", { reason: dirty.error }));
  if (/** @type {string[]} */ (dirty.paths).length) return refused(fact("dirty_tree", { paths: /** @type {string[]} */ (dirty.paths) }));

  const files = /** @type {MigrationFile[]} */ (loadWorkingTree(root));
  const unreadable = files.filter((f) => f.unreadable || f.problems.length);
  if (unreadable.length) {
    return refused(...unreadable.map((f) => fact("unreadable_file", {
      file: f.rel, problems: f.unreadable ? [f.unreadable] : f.problems.map((p) => p.message),
    })));
  }
  const index = buildIndex(files);
  if (!index.project) return refused(fact("no_project", { root }));

  // The plan reads the legacy tree through its own projection of the index (lib/migration-plan.mjs).
  const plan = planMigration(/** @type {LegacyMigrationIndex} */ (index));
  if (!plan.ok) {
    return refused(...[...Map.groupBy(plan.errors, (e) => e.code)].map(([code, errors]) => fact(code, {
      errors, ...(code === "collision" ? { fix: COLLISION_FIX } : {}),
    })));
  }
  const missingSuites = files.filter((f) => f.type === "feature" && f.data.suite_key === undefined);
  if (missingSuites.length) {
    // With no \`origin\` there is no shared default branch for two clones to split a Feature across.
    const branch = defaultBranch(root);
    if (hasOrigin(root) && !branch.onDefault) return refused(fact("not_default_branch", { branch }));
    const minted = mint("su", { root, count: missingSuites.length });
    if (minted.error) return refused(fact("rewrite_failed", { reason: minted.error }));
    missingSuites.forEach((f, i) => plan.rewrites.push({ file: f.rel, set: { suite_key: /** @type {MintedKeys} */ (minted).keys[i] } }));
  }
  const result = apply(files, plan, index.project);
  if (result.refusal) return refused(fact(result.refusal.code, result.refusal.data));
  const final = result.schema.from === LAYER_FREE_CASE_SCHEMA_VERSION
    ? migrateRuleList(root, files, result, currentTree)
    : { result };
  if ("refusal" in final) return refused(fact(final.refusal.code, final.refusal.data));
  const migrated = final.result;

  const errors = integrityFindings(root, migrated.after, migrated.config).filter((e) => e.kind === "integrity_error" &&
    (["duplicate_key", "duplicate_suite_key", "duplicate_tracker_key", "retired_key_live", "heading"].includes(e.code) || e.field === "mirror.suite" ||
      ["key", "suite_key", "tracker", "tracker_formerly", "retired", "retired_features", "formerly", "rule"].includes(/** @type {string} */ (e.field?.split(".").at(-1)))));
  if (errors.length) return refused(fact("identity_error", { errors }));

  const written = writeAll(root, {
    writes: [...migrated.writes].map(([path, text]) => ({ path, text: backfill(root, path, text) })),
    deletes: migrated.renamed.map(({ from }) => from).filter((from) => !migrated.writes.has(from)),
  });
  if (written.error) return refused(fact("write_failed", { reason: written.error }));
  return { exit: 0, json: {
    ok: true,
    changed: migrated.writes.size > 0,
    schema_version: migrated.schema,
    mapping: plan.mapping,
    consumed: migrated.consumed,
    renamed: migrated.renamed,
    rewritten: [...migrated.writes.keys()].sort(),
    check: { errors: migrated.checkErrors },
    ...(migrated.pins ? { pins: migrated.pins } : {}),
  } };
}

// The check errors a rewrite introduced: in a file it changed, the occurrences of a `(code, field)`
// pair beyond the count the same file already reported before the rewrite. Lines move, so none is
// compared; an error already in another file is never the rewrite's.
/**
 * @param {readonly MigrationCheckError[]} before
 * @param {readonly MigrationCheckError[]} after
 * @param {ReadonlySet<string>} rewritten
 * @returns {MigrationCheckError[]}
 */
export function introducedCheckErrors(before, after, rewritten) {
  /** @type {Map<string, number>} */
  const remaining = new Map();
  /** @param {{ file: string, code: string, field?: string }} error */
  const key = (error) => `${error.file}\0${error.code}\0${error.field ?? ""}`;
  for (const error of before) remaining.set(key(error), (remaining.get(key(error)) ?? 0) + 1);
  /** @type {MigrationCheckError[]} */
  const introduced = [];
  for (const error of after) {
    if (!rewritten.has(error.file)) continue;
    const count = remaining.get(key(error)) ?? 0;
    if (count > 0) remaining.set(key(error), count - 1);
    else introduced.push(error);
  }
  return introduced;
}

// The schema 6 step (ADR-0061): the Rule and Boundary heading form becomes the numbered item form.
// The rewrite changes layout only; `checkFile` and the identity pass read the result before anything
// is written. The neutral canonical form changes every stored digest once, so the step decides which
// pins were fresh under the OLD (raw entry) computation before it re-pins them with the NEW digest and
// `migrated: 6`, as `migrateLevels` carries a pin across the level rewrite.
/**
 * @param {string} root
 * @param {MigrationFile[]} files
 * @param {Extract<MigrationOutcome, { writes: Map<string, string> }>} applied
 * @param {() => ReadonlyArray<{ rel: string, text?: unknown }>} [currentTree]
 * @returns {{ refusal: MigrationRefusal } | { result: Extract<MigrationOutcome, { writes: Map<string, string> }> }}
 */
function migrateRuleList(root, files, applied, currentTree = () => loadWorkingTree(root)) {
  const postFiles = /** @type {MigrationFile[]} */ (applied.after);
  /** @type {Map<string, string>} */
  const texts = new Map(postFiles.map((f) => [f.rel, applied.writes.get(f.rel) ?? f.text]));
  // 1. Rewrite every heading entry into an item, word for word.
  for (const file of postFiles) {
    if (file.type !== "feature") continue;
    const text = /** @type {string} */ (texts.get(file.rel));
    const done = rewriteFeatureRules(file.rel, text);
    if (done.refusal) return done;
    if (done.text !== text) texts.set(file.rel, done.text);
  }
  // 2. Recompute each Feature's Coverage digest from the rewritten entries.
  for (const file of postFiles) {
    if (file.type !== "feature") continue;
    const current = parse(file.rel, /** @type {string} */ (texts.get(file.rel)));
    if (current.data.coverage_digest === undefined) continue;
    const digest = coverageDigest(current.text);
    if (current.data.coverage_digest === digest) continue;
    const done = edit(current, [{ set: { coverage_digest: digest } }]);
    if (!done.ok) return { refusal: { code: "rewrite_failed", data: { file: file.rel, errors: done.errors } } };
    texts.set(file.rel, done.text);
  }

  const afterRules = [...texts].map(([rel, text]) => parse(rel, text));
  const nowDigests = digests(afterRules);
  const legacyNow = digests(postFiles, { legacy: true });
  const repo = /** @type {import("./git-tree.mjs").Repository} */ (repositoryOf(root));
  const resolved = resolveCommits(root, postFiles.flatMap((f) => pinsOf(f).map((p) => p.commit))).resolved;
  const { pins, changes } = carryPins(postFiles, { nowDigests, legacyNow, resolved, repo });

  for (const [rel, edits] of changes) {
    const done = edit(parse(rel, /** @type {string} */ (texts.get(rel))), edits);
    if (!done.ok) return { refusal: { code: "rewrite_failed", data: { file: rel, errors: done.errors } } };
    texts.set(rel, done.text);
  }

  // 3. The schema marker moves with the format.
  const project = postFiles.find((f) => f.type === "project" && !f.unreadable);
  if (!project) return { refusal: { code: "no_project", data: { root } } };
  const marked = edit(parse(project.rel, /** @type {string} */ (texts.get(project.rel))), [{ set: { schema_version: RULE_LIST_SCHEMA_VERSION } }]);
  if (!marked.ok) return { refusal: { code: "rewrite_failed", data: { file: project.rel, errors: marked.errors } } };
  texts.set(project.rel, marked.text);

  // 4. Nothing is written until every result reads: the rewrite may carry an error that was already
  // in the tree, as the earlier steps' `check.errors` do, but it may not introduce one.
  const writes = new Map([...texts].filter(([rel, text]) => applied.writes.has(rel) || files.find((f) => f.rel === rel)?.text !== text));
  const beforeConfig = projectConfig(files.find((f) => f.type === "project"));
  const errorsBefore = files.flatMap((f) => checkFile(f, beforeConfig).errors.map((e) => ({ file: f.rel, ...e })));
  const after = [...texts].map(([rel, text]) => parse(rel, text));
  const config = projectConfig(after.find((f) => f.type === "project"));
  const checkErrors = after.flatMap((f) => checkFile(f, config).errors.map((e) => ({ file: f.rel, ...e })));
  const introduced = introducedCheckErrors(errorsBefore, checkErrors, new Set(writes.keys()));
  if (introduced.length) return { refusal: { code: "rewrite_failed", data: { errors: introduced } } };
  // 5. The `.qa/` read at the end must be the one the step started from.
  const current = currentTree();
  if (current.length !== files.length || current.some((f) => files.find((before) => before.rel === f.rel)?.text !== f.text)) {
    return { refusal: { code: "changed_tree", data: {} } };
  }

  return {
    result: {
      ...applied,
      writes,
      after,
      config,
      schema: { from: applied.schema.from, to: RULE_LIST_SCHEMA_VERSION },
      checkErrors,
      pins,
    },
  };
}

// The pin-carry pass: a Watermark, Review or Dismissal that was fresh under the old (raw entry)
// computation takes the new neutral digest; one that had already changed is reported stale, and one
// whose commit is gone with no stored digest is unverified. Neither of the last two is touched.
/**
 * @param {MigrationFile[]} files
 * @param {{
 *   nowDigests: PinDigests,
 *   legacyNow: PinDigests,
 *   resolved: Map<string, string | null>,
 *   repo: import("./git-tree.mjs").Repository,
 * }} context
 * @returns {{ pins: PinOutcome[], changes: Map<string, EditChange[]> }}
 */
function carryPins(files, { nowDigests, legacyNow, resolved, repo }) {
  const aliases = { case: new Map(), scenario: new Map() };
  /** @param {"case" | "scenario"} scope @param {unknown} key @param {Record<string, unknown>} data */
  const recordAlias = (scope, key, data) => {
    if (typeof key !== "string" || !Array.isArray(data.formerly)) return;
    for (const old of data.formerly) if (typeof old === "string") aliases[scope].set(old, key);
  };
  for (const f of files) {
    if (f.unreadable || f.type !== "scenario") continue;
    recordAlias("scenario", f.data.key, f.data);
    for (const c of f.cases) recordAlias("case", c.key, c.data);
  }
  /** @param {string} scope @param {string} field @param {unknown} v */
  const identity = (scope, field, v) => (field === "key" ? (aliases[/** @type {"case" | "scenario"} */ (scope)]?.get(v) ?? v) : v);

  /** @type {Map<string, { legacy: PinDigests, legacyAliased: PinDigests, now: PinDigests }>} */
  const byCommit = new Map();
  /** @param {string} commit */
  const at = (commit) => {
    if (!byCommit.has(commit)) {
      const qa = loadQaAt(repo, commit);
      byCommit.set(commit, { legacy: digests(qa, { legacy: true }), legacyAliased: digests(qa, { legacy: true, identity }), now: digests(qa) });
    }
    return /** @type {{ legacy: PinDigests, legacyAliased: PinDigests, now: PinDigests }} */ (byCommit.get(commit));
  };
  /** @param {unknown} commit @returns {string | null} */
  const full = (commit) => (typeof commit === "string" ? resolved.get(commit) ?? null : null);

  /** @type {PinOutcome[]} */
  const pins = [];
  /** @type {Map<string, EditChange[]>} */
  const changes = new Map();
  /** @param {string} rel @param {EditChange} change */
  const change = (rel, change) => {
    if (!changes.has(rel)) changes.set(rel, []);
    /** @type {EditChange[]} */ (changes.get(rel)).push(change);
  };

  /**
   * Key and historical aliases of an entry, so renamed entries resolve pins at pre-migration commits.
   * @param {string} key
   * @param {Record<string, unknown>} data
   * @returns {string[]}
   */
  const keyAliases = (key, data) => [
    key,
    ...(Array.isArray(data.formerly) ? data.formerly.filter((k) => typeof k === "string") : []),
  ];
  /**
   * @template K, V
   * @param {readonly K[]} keys
   * @param {(key: K) => V | null} read
   * @returns {V | null}
   */
  const firstNonNull = (keys, read) => {
    for (const k of keys) {
      const value = read(k);
      if (value !== null) return value;
    }
    return null;
  };

  for (const file of files) {
    if (file.unreadable) continue;
    const feature = file.type === "feature" ? /** @type {string} */ (file.data.key) : null;
    const featureSlug = feature ?? (typeof file.data.feature === "string" ? file.data.feature : null);
    // The Watermark is a commit pin too: it carries the Feature digest the pin was taken at.
    if (file.type === "feature") {
      const raw = file.data.watermark;
      if (raw !== undefined && raw !== null) {
        const W = full(raw);
        const stored = writtenDigest(file.data.watermark_digest);
        /** @type {PinOutcome["status"] | null} */
        let status = null;
        /** @type {string | null} */
        let digest = null;
        if (W !== null) {
          // With a stored digest, re-pin only a digest that was fresh at that commit; otherwise
          // the pin had already moved and stays as it is. With none, there is nothing to re-pin.
          if (stored === null) status = "carried";
          else if (stored === at(W).legacy.feature(/** @type {string} */ (feature))) {
            status = "carried";
            digest = at(W).now.feature(/** @type {string} */ (feature));
          } else status = "stale";
        } else if (stored !== null && stored === legacyNow.feature(/** @type {string} */ (feature))) {
          status = "carried";
          digest = nowDigests.feature(/** @type {string} */ (feature));
        } else if (stored !== null && stored === legacyNow.featureLocal(/** @type {string} */ (feature))) {
          status = "carried";
          digest = nowDigests.featureLocal(/** @type {string} */ (feature));
        }
        pins.push({ file: file.rel, key: feature, pin: "watermark", status: status ?? "unverified" });
        if (status === "carried" && digest !== null) change(file.rel, { set: { watermark_digest: digest } });
      }
    }
    // A Review is fresh under the old computation when its commit's claim equals the target's, or,
    // with the commit gone, when its stored digest matches the target's.
    for (const entry of file.type === "scenario" ? file.cases : []) {
      const review = entry.data.review;
      if (!isMap(review)) continue;
      const R = full(review.commit);
      /** @type {PinOutcome["status"]} */
      let status;
      if (R !== null && !isMigratedPin(review)) {
        const atCommit = firstNonNull(keyAliases(entry.key, entry.data), (k) => at(R).legacyAliased.review(k));
        status = atCommit !== null && atCommit === legacyNow.review(entry.key) ? "carried" : "stale";
      } else {
        const stored = writtenDigest(review.digest);
        status = stored === null ? "unverified" : stored === legacyNow.review(entry.key) ? "carried" : "stale";
      }
      pins.push({ file: file.rel, key: entry.key, pin: "review", status });
      if (status === "carried") change(file.rel, { at: entry.key, set: { review: { ...review, digest: nowDigests.review(entry.key), migrated: RULE_LIST_SCHEMA_VERSION } } });
    }
    // Dismissals, Feature-level and case-level, by the same before/after rule, plus `at_digest`.
    const owners = file.type === "feature" ? [{ key: null, data: file.data }] : file.type === "scenario" ? file.cases.map((c) => ({ key: c.key, data: c.data })) : [];
    for (const owner of owners) {
      if (!Array.isArray(owner.data.finding)) continue;
      let touched = false;
      const ownerAliases = owner.key === null ? [null] : keyAliases(owner.key, owner.data);
      const finding = owner.data.finding.map((x) => {
        if (!isMap(x)) return x;
        let next = x;
        const storedAt = writtenDigest(x.at_digest);
        if (x.at_commit !== undefined && x.at_commit !== null && storedAt !== null && featureSlug !== null) {
          const A = full(x.at_commit);
          /** @type {string | null} */
          let updatedAt = null;
          if (A !== null) {
            if (storedAt === at(A).legacy.feature(featureSlug)) updatedAt = at(A).now.feature(featureSlug);
            else if (storedAt === at(A).legacy.featureLocal(featureSlug)) updatedAt = at(A).now.featureLocal(featureSlug);
          } else if (storedAt === legacyNow.feature(featureSlug)) {
            updatedAt = nowDigests.feature(featureSlug);
          } else if (storedAt === legacyNow.featureLocal(featureSlug)) {
            updatedAt = nowDigests.featureLocal(featureSlug);
          }
          if (updatedAt !== null && updatedAt !== storedAt) {
            next = { ...next, at_digest: updatedAt };
            touched = true;
          }
        }
        if (!isMap(x.dismissed)) return next;
        const key = owner.key ?? (typeof x.subject_key === "string" ? x.subject_key : typeof x.rule === "string" ? x.rule : null);
        const dismissed = x.dismissed;
        const D = full(dismissed.commit);
        const noText = owner.key === null && !(x.kind === "Overreach" && typeof x.rule === "string");
        /** @type {PinOutcome["status"]} */
        let status;
        if (D !== null && !isMigratedPin(dismissed)) {
          const atCommit = noText ? null : firstNonNull(ownerAliases, (k) => at(D).legacyAliased.dismissal(k, x, feature));
          status = noText || (atCommit !== null && atCommit === legacyNow.dismissal(owner.key, x, feature)) ? "carried" : "stale";
        } else {
          const stored = writtenDigest(dismissed.digest);
          status = stored === null ? "unverified" : stored === legacyNow.dismissal(owner.key, x, feature) ? "carried" : "stale";
        }
        pins.push({ file: file.rel, key, pin: "dismissed", status });
        if (status !== "carried") return next;
        touched = true;
        return { ...next, dismissed: { ...dismissed, digest: nowDigests.dismissal(owner.key, x, feature), migrated: RULE_LIST_SCHEMA_VERSION } };
      });
      if (touched) change(file.rel, { at: owner.key === null ? undefined : owner.key, set: { finding } });
    }
  }
  return { pins, changes };
}

// One Feature's heading-form entries rewritten as numbered items, in file order and number, with
// their fields and elaboration indented to the content indent. A heading outside its section cannot
// become an item there, and prose before a section's first entry would fall outside every item, so
// each refuses rather than moving text.
/**
 * @param {string} rel
 * @param {string} text
 * @returns {{ refusal: MigrationRefusal, text?: never } | { refusal?: never, text: string }}
 */
function rewriteFeatureRules(rel, text) {
  const file = parse(rel, text);
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const finalNewline = normalized.endsWith("\n");
  /** @type {Array<{ line: number, end: number, rendered: string }>} */
  const replacements = [];
  /** @type {Array<[string, Array<ParsedRule | ParsedBoundary>]>} */
  const sections = [["Rules", file.rules ?? []], ["Boundaries", file.boundaries ?? []]];
  for (const [expected, list] of sections) {
    const ordered = [...list].sort((a, b) => a.line - b.line);
    const inSection = ordered.filter((entry) => headingSection(file, entry.line) === expected);
    const firstRewrite = inSection.find((entry) => entry.form === "heading");
    const heading = (file.sections ?? []).find((section) => section.level === 2 && section.title === expected);
    if (firstRewrite && heading) {
      for (let line = heading.line + 1; line < firstRewrite.line; line++) {
        const lineText = lines[line - 1];
        if (!lineText.trim() || /^#{1,6}[ \t]/.test(lineText) || inSection.some((entry) => line >= entry.line && line <= entry.end)) continue;
        return { refusal: { code: "prose_in_section", data: { file: rel, line, section: expected } } };
      }
    }
    for (const entry of ordered) {
      const section = headingSection(file, entry.line);
      if (section !== expected) {
        return { refusal: { code: "rule_outside_section", data: { file: rel, line: entry.line, key: entry.key, section } } };
      }
      if (entry.form !== "heading") continue;
      const number = inSection.indexOf(entry) + 1;
      /** @type {{ name: string, value: string }[]} */
      let fields = [];
      if (expected === "Rules") {
        const ruleFields = /** @type {{ fields?: Array<{ name: string, value: string }> }} */ (entry).fields ?? [];
        fields = ruleFields.map(({ name, value }) => ({ name, value }));
      } else {
        const owner = /** @type {{ owner: string | null }} */ (entry).owner;
        if (owner !== null) fields = [{ name: "Owner", value: owner }];
      }
      replacements.push({
        line: entry.line,
        end: entry.end,
        rendered: ruleItem({ number, key: entry.key, statement: entry.statement, fields, elaboration: entry.elaboration }),
      });
    }
  }
  if (!replacements.length) return { text };
  const out = [...lines];
  for (const replacement of replacements.sort((a, b) => b.line - a.line)) {
    const body = replacement.rendered.split("\n");
    // Keep one blank line before whatever follows the entry, as the heading form had.
    if (replacement.end < out.length) body.push("");
    out.splice(replacement.line - 1, replacement.end - replacement.line + 1, ...body);
  }
  const joined = out.join(file.eol);
  return { text: finalNewline && !joined.endsWith(file.eol) ? `${joined}${file.eol}` : joined };
}

// The `##` heading a line sits under; an H1 ends it, as the parser's section membership says.
/**
 * @param {ParsedFile} file
 * @param {number} line
 * @returns {string | null}
 */
function headingSection(file, line) {
  /** @type {string | null} */
  let title = null;
  for (const section of file.sections ?? []) {
    if (section.line >= line) break;
    if (section.level <= 2) title = section.level === 2 ? section.title : null;
  }
  return title;
}

// The new text of every file the plan touches, in memory: `{writes: Map(rel after rename → text),
// renamed: [{from, to}], consumed, schema, checkErrors}`, or `{refusal: {code, data}}` when any
// rewrite or rename cannot be made.
/**
 * @param {MigrationFile[]} files
 * @param {MigrationPlanSuccess} plan
 * @param {ParsedFile} project
 * @returns {MigrationOutcome}
 */
function apply(files, plan, project) {
  const byRel = new Map(files.map((f) => [f.rel, f]));
  /** @type {Map<string, string>} */
  const changed = new Map(); // old rel → new text
  /** @type {Map<string, string>} */
  const renames = new Map(); // old rel → new rel
  for (const [rel, ops] of Map.groupBy(plan.rewrites, (op) => op.file)) {
    const done = rewriteFile(/** @type {MigrationFile} */ (byRel.get(rel)), ops);
    if (done.refusal) return done;
    changed.set(rel, done.text);
    if (done.rename) renames.set(rel, done.rename);
  }
  const schemaFrom = projectConfig(project).schemaVersion;
  // Schema 5 is a pure marker after the level-on-case migration; legacy projects still cross
  // the Key/Suite and level-rewrite boundaries separately, preserving inherited claims.
  const schemaTo = schemaFrom >= LEVEL_ON_CASE_SCHEMA_VERSION ? Math.max(schemaFrom, LAYER_FREE_CASE_SCHEMA_VERSION) : SUITE_KEYS_SCHEMA_VERSION;
  if (schemaFrom < schemaTo) {
    const done = edit(project, [{ set: { schema_version: schemaTo } }]);
    if (!done.ok) return { refusal: { code: "rewrite_failed", data: { file: project.rel, errors: done.errors } } };
    changed.set(project.rel, done.text);
  }

  const gone = new Set(renames.keys());
  /** @type {Set<string>} */
  const taken = new Set();
  for (const to of renames.values()) {
    if ((byRel.has(to) && !gone.has(to)) || taken.has(to)) return { refusal: { code: "rename_target_exists", data: { file: to } } };
    taken.add(to);
  }
  const writes = new Map([...changed].map(([rel, text]) => /** @type {[string, string]} */ ([renames.get(rel) ?? rel, text])));
  const after = files.map((f) => (changed.has(f.rel) ? parse(renames.get(f.rel) ?? f.rel, /** @type {string} */ (changed.get(f.rel))) : f));
  const config = projectConfig(after.find((f) => f.type === "project"));
  const checkErrors = after.flatMap((f) => checkFile(f, config).errors.map((e) => ({ file: f.rel, ...e })));
  const consumed = plan.rewrites.filter((op) => op.set && "migrate_as" in op.set).map((op) => plan.mapping.find((m) => m.file === op.file && m.at === op.at)?.to);
  return {
    writes, after, config,
    renamed: [...renames].map(([from, to]) => ({ from, to })),
    consumed: /** @type {string[]} */ (consumed.filter(Boolean)),
    schema: { from: schemaFrom, to: schemaTo },
    checkErrors,
  };
}

// One file's plan operations (migration-plan.mjs) applied to its input text. Headings are replaced
// first, a line for a line, so every other operation's address holds; the heading's new Key then
// addresses its entry for the field edits.
/**
 * @param {MigrationFile} file
 * @param {MigrationRewrite[]} ops
 * @returns {RewriteOutcome}
 */
function rewriteFile(file, ops) {
  const lines = file.text.split(/(\r?\n)/); // even indices are lines, odd their separators
  /** @type {Map<string, string>} */
  const renamedTo = new Map();
  for (const { heading } of /** @type {Array<MigrationRewrite & { heading: RewriteHeading }>} */ (ops.filter((op) => op.heading))) {
    const at = (heading.line - 1) * 2;
    const line = lines[at];
    const m = line.match(/^(#{1,6}[ \t]+)(.*)$/s);
    if (!m || !m[2].startsWith(heading.from)) return { refusal: { code: "rewrite_failed", data: { file: file.rel, line: heading.line, errors: [`the heading no longer starts with \`${heading.from}\``] } } };
    lines[at] = m[1] + heading.to + m[2].slice(heading.from.length);
    renamedTo.set(heading.from, heading.to);
  }
  const reparsed = parse(file.rel, lines.join(""));
  const changes = ops.filter((op) => op.set).map(({ at, set }) => (at === undefined ? { set } : { at: renamedTo.get(at) ?? at, set }));
  /** @type {EditVerdict} */
  const done = changes.length ? edit(reparsed, changes) : { ok: true, text: reparsed.text };
  if (!done.ok) return { refusal: { code: "rewrite_failed", data: { file: file.rel, errors: done.errors } } };
  return { text: done.text, rename: ops.find((op) => op.rename)?.rename };
}

// What the integrity pass (lib/scan-integrity.mjs) finds in the migrated tree `files` of the
// `.qa/` directory `root`.
/**
 * @param {string} root
 * @param {ParsedFile[]} files
 * @param {ProjectConfig} config
 * @returns {ScanFinding[]}
 */
export function integrityFindings(root, files, config) {
  /** @type {ScanFinding[]} */
  const findings = [];
  // The repository under test is `.qa/`'s parent, as `scan` reads it (lib/scan.mjs).
  integrity({ files, index: buildIndex(files), config, root, repo: dirname(resolve(root)), emit: (e) => findings.push(/** @type {ScanFinding} */ (e)) });
  return findings;
}

// The command line's `migrate-keys [--root <qa-dir>]` (scripts/scan.mjs).
/** @type {CommandDefinition} */
export const command = {
  options: { root: "qa-dir", levels: "flag", "map-level": "value" },
  usage: "[--levels [--map-level <from=level+tag,...>]] [--root <qa-dir>]",
  run(args, { root, levels, "map-level": levelMap }) {
    if (args.length) throw new UsageError("migrate-keys takes no argument: it migrates the whole `.qa/`");
    if (levelMap && !levels) throw new UsageError("--map-level requires --levels");
    return migrateKeys(/** @type {string} */ (root), { levels: Boolean(levels), levelMap: /** @type {string | undefined} */ (levelMap) });
  },
};


/**
 * What happened to one Review or Dismissal pin: `carried` was fresh and took a migrated digest,
 * `stale` had already changed and stays so, `unverified` could not be checked and is untouched.
 * @typedef {{ file: string, key: string | null, pin: "watermark" | "review" | "dismissed", status: "carried" | "stale" | "unverified" }} PinOutcome
 */

/**
 * `migrate-keys --levels`' result: a refusal naming its `code` and what the engineer must settle
 * (`needed`, `errors`, `execute_levels`, `duplicates`), or the migration's report. `tags_without_meaning`
 * names the Tags a mapping created with an empty meaning.
 * @typedef {{ exit: 1, json: { ok: false, code?: string, text: string, needed?: string[], errors?: readonly unknown[], execute_levels?: LevelMigrationPlan["execute_levels"], duplicates?: LevelMigrationPlan["duplicates"] } }
 *   | { exit: 0, json: { ok: true, changed: boolean, schema_version: { from: number, to: number }, rewritten?: string[], pins?: PinOutcome[], execute_levels?: LevelMigrationPlan["execute_levels"], duplicates?: LevelMigrationPlan["duplicates"], tags_without_meaning?: string[] } }} LevelMigrationResult
 */

/**
 * @param {string} root
 * @param {string} levelMap
 * @returns {LevelMigrationResult | UnreadSchemaRefusal}
 */
function migrateLevels(root, levelMap) {
  const guard = refuseUnreadSchema(root, ANY_SCHEMA_VERSION);
  if (guard) return guard;
  const no = (/** @type {string} */ code, /** @type {string} */ text, /** @type {{ needed?: string[], errors?: readonly unknown[], execute_levels?: LevelMigrationPlan["execute_levels"], duplicates?: LevelMigrationPlan["duplicates"] }} */ extra = {}) => (/** @type {LevelMigrationResult} */ ({ exit: 1, json: { ok: false, code, text, ...extra } }));
  const files = /** @type {MigrationFile[]} */ (loadWorkingTree(root));
  if (files.some((f) => f.unreadable || f.problems.length)) return no("unreadable_file", "Nothing was written: fix the unreadable knowledge files.");
  const project = files.find((f) => f.type === "project");
  if (!project) return no("no_project", "Nothing was written: project.md is missing.");
  const version = projectConfig(project).schemaVersion;
  if (version < SUITE_KEYS_SCHEMA_VERSION) return no("schema_migration_required", "Nothing was written: run `migrate-keys` and commit its changes before `migrate-keys --levels`.");
  if (version >= LEVEL_ON_CASE_SCHEMA_VERSION) return { exit: 0, json: { ok: true, changed: false, schema_version: { from: version, to: version } } };
  const repo = repositoryOf(root);
  if (!repo) return no("not_in_git", "Nothing was written: the level migration requires a git repository.");
  const dirty = uncommittedUnder(root);
  if (dirty.error || dirty.paths?.length) return no("dirty_tree", "Nothing was written: commit or restore the .qa changes before migrating.");
  /** @type {Record<string, import("./migration-plan.mjs").LevelMapping>} */
  const mappings = /** @type {Record<string, import("./migration-plan.mjs").LevelMapping>} */ (Object.create(null));
  for (const item of levelMap ? levelMap.split(",") : []) {
    const m = /^([^=,+]+)=([^=,+]+)\+([^=,+]+)$/.exec(item);
    if (!m) return no("bad_level_mapping", "Use --map-level from=level+tag (comma-separated for several mappings).");
    if (Object.hasOwn(mappings, m[1])) return no("bad_level_mapping", "Each legacy level has exactly one mapping.");
    mappings[m[1]] = { level: m[2], tag: m[3] };
  }
  const plan = planLevelMigration(files, mappings);
  if (!plan.ok) return no(plan.needed.length ? "level_mapping_required" : plan.errors[0].code, "Nothing was written: resolve the level migration preview, then run `migrate-keys --levels` again.", { needed: plan.needed, errors: plan.errors, execute_levels: plan.execute_levels, duplicates: plan.duplicates });
  const texts = new Map(files.map((f) => [f.rel, f.text]));
  for (const op of plan.rewrites) {
    if (op.text !== undefined) texts.set(op.file, op.text);
    if (op.set) {
      const out = edit(parse(op.file, /** @type {string} */ (texts.get(op.file))), [{ set: op.set }]);
      if (!out.ok) return no("rewrite_failed", "Nothing was written: a migration rewrite failed.", { errors: out.errors });
      texts.set(op.file, out.text);
    }
  }
  const facts = scan(root).history;
  const migratedDigests = digests([...texts].map(([rel, text]) => parse(rel, text)));
  /** @type {PinOutcome[]} */
  const pins = [];
  for (const file of files) {
    /** @type {EditChange[]} */
    const changes = [];
    const cases = file.type === "scenario" ? file.cases : [];
    for (const entry of cases) {
      const review = entry.data.review;
      if (!isMap(review)) continue;
      const fact = facts.reviews.find((r) => r.file === file.rel && r.key === entry.key);
      /** @type {PinOutcome["status"]} */
      const status = fact?.status === "fresh" ? "carried" : fact?.why === "entry_changed" ? "stale" : "unverified";
      pins.push({ file: file.rel, key: entry.key, pin: "review", status });
      if (status === "carried") changes.push({ at: entry.key, set: { review: { ...review, digest: migratedDigests.review(entry.key), migrated: LEVEL_ON_CASE_SCHEMA_VERSION } } });
    }
    const owners = file.type === "feature" ? [{ key: null, data: file.data }] : cases;
    const dismissals = facts.dismissals.filter((d) => d.file === file.rel);
    for (const owner of owners) {
      if (!Array.isArray(owner.data.finding)) continue;
      let changed = false;
      // History numbers an owner's findings over its map items only.
      let findingIndex = -1;
      const finding = owner.data.finding.map((x) => {
        if (isMap(x)) findingIndex++;
        if (!isMap(x) || !isMap(x.dismissed)) return x;
        const key = owner.key ?? (typeof x.subject_key === "string" ? x.subject_key : typeof x.rule === "string" ? x.rule : null);
        const fact = dismissals.find((d) => d.key === key && d.finding_index === findingIndex);
        /** @type {PinOutcome["status"]} */
        const status = fact?.status === "holds" ? "carried" : fact?.why.includes("commit_unresolvable") || !fact ? "unverified" : "stale";
        pins.push({ file: file.rel, key, pin: "dismissed", status });
        if (status !== "carried") return x;
        changed = true;
        return { ...x, dismissed: { ...x.dismissed, digest: migratedDigests.dismissal(owner.key, x, typeof file.data.key === "string" ? file.data.key : null), migrated: LEVEL_ON_CASE_SCHEMA_VERSION } };
      });
      if (changed) changes.push({ ...(owner.key === null ? {} : { at: owner.key }), set: { finding } });
    }
    if (changes.length) {
      const out = edit(parse(file.rel, /** @type {string} */ (texts.get(file.rel))), changes);
      if (!out.ok) return no("rewrite_failed", "Nothing was written: a pin could not be carried.", { errors: out.errors });
      texts.set(file.rel, out.text);
    }
  }
  const after = [...texts].map(([rel, text]) => parse(rel, text));
  const config = projectConfig(after.find((f) => f.type === "project"));
  const errors = after.flatMap((f) => checkFile(f, config).errors.map((e) => ({ file: f.rel, ...e })));
  if (errors.length) return no("invalid_migration", "Nothing was written: the migrated files would fail validation.", { errors });
  const identityErrors = integrityFindings(root, after, config).filter((e) => e.kind === "integrity_error" && ["duplicate_key", "duplicate_suite_key", "duplicate_tracker_key", "retired_key_live"].includes(e.code));
  if (identityErrors.length) return no("identity_error", "Nothing was written: the migrated tree has an identity error.", { errors: identityErrors });
  const current = loadWorkingTree(root);
  if (current.length !== files.length || current.some((f) => files.find((before) => before.rel === f.rel)?.text !== f.text)) return no("changed_tree", "Nothing was written: knowledge changed while the migration was verifying pins. Run it again.");
  const writes = [...texts].filter(([rel, text]) => files.find((f) => f.rel === rel)?.text !== text).map(([path, text]) => ({ path, text }));
  const written = writeAll(root, { writes });
  if (written.error) return no("write_failed", written.error);
  return { exit: 0, json: { ok: true, changed: writes.length > 0, schema_version: { from: version, to: LEVEL_ON_CASE_SCHEMA_VERSION }, rewritten: writes.map((w) => w.path), pins, execute_levels: plan.execute_levels, duplicates: plan.duplicates, tags_without_meaning: plan.created_tags } };
}
