// @ts-check
// `migrate-keys`: the ordered rewrites of legacy `.qa/` Keys and case levels.
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
/** @import { EditError, ParsedFile, ProjectConfig } from "./knowledge-file.mjs" */
/** @import { LegacyMigrationIndex, LevelMigrationPlan, MigrationMappingRow, MigrationPlanSuccess, MigrationRewrite } from "./migration-plan.mjs" */
/** @import { MintedKeys } from "./mint.mjs" */
/** @import { RefusalFact, RefusalResult } from "./refusal.mjs" */
/** @import { ScanFinding, KnowledgeIndex } from "./scan-integrity.mjs" */
/** @import { UnreadSchemaRefusal } from "./schema-guard.mjs" */
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { writeAll } from "./changeset.mjs";
import { scan } from "./scan.mjs";
import { isMap } from "./dialect.mjs";
import { UsageError } from "./cli.mjs";
import { defaultBranch, hasOrigin, uncommittedUnder } from "./git.mjs";
import { repositoryOf } from "./git-tree.mjs";
import { checkFile, edit, parse, projectConfig } from "./knowledge-file.mjs";
import { planLevelMigration, planMigration } from "./migration-plan.mjs";
import { backfill, digests } from "./pin-digest.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { refusalsFor } from "./refusal.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { ANY_SCHEMA_VERSION, LEVEL_ON_CASE_SCHEMA_VERSION, SUITE_KEYS_SCHEMA_VERSION } from "./schema.mjs";
import { mint } from "./mint.mjs";
import { run as integrity } from "./scan-integrity.mjs";

const NOTHING = "Nothing was written.";
const { fact } = refusalsFor({
  not_in_git: `\`.qa/\` is not inside a git repository, so an interrupted migration could not be undone. ${NOTHING}`,
  dirty_tree: `\`.qa/\` has uncommitted changes. Commit or restore them, then run the migration again. ${NOTHING}`,
  git_status_failed: `Git could not say whether \`.qa/\` has uncommitted changes. ${NOTHING}`,
  not_default_branch: `Suite backfill runs only on the default branch, identified by origin/HEAD. If origin/HEAD is unset, run \`git remote set-head origin --auto\`. ${NOTHING}`,
  identity_error: `The migrated tree has an identity error. Fix it before migrating. ${NOTHING}`,
  no_project: `\`.qa/project.md\` is missing, so there is no schema version to bump. ${NOTHING}`,
  unreadable_file: `The file cannot be read as a \`.qa/\` file, so it cannot be rewritten safely. Fix it, then run the migration again. ${NOTHING}`,
  collision: `Entries would take the same Key, tracker key or tombstone. ${NOTHING}`,
  invalid_override: `A \`migrate_as:\` is not a Key of its kind. ${NOTHING}`,
  unresolved_ancestry: `An entry's \`new_…\` history does not resolve to one oldest ancestor. ${NOTHING}`,
  rewrite_failed: `A rewrite of the file could not be applied. ${NOTHING}`,
  rename_target_exists: `A Scenario file would be renamed onto another file. ${NOTHING}`,
});
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
 * }} MigrationSuccess
 */

// Migrates the `.qa/` directory `root` in place.
/**
 * @param {string} root
 * @param {{ levels?: boolean, levelMap?: string }} [options]
 * @returns {LevelMigrationResult | UnreadSchemaRefusal | RefusalResult | { exit: 0, json: MigrationSuccess }}
 */
export function migrateKeys(root, { levels = false, levelMap = "" } = {}) {
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

  const errors = integrityFindings(root, result.after, result.config).filter((e) => e.kind === "integrity_error" &&
    (["duplicate_key", "duplicate_suite_key", "duplicate_tracker_key", "retired_key_live", "heading"].includes(e.code) || e.field === "mirror.suite" ||
      ["key", "suite_key", "tracker", "tracker_formerly", "retired", "retired_features", "formerly", "rule"].includes(/** @type {string} */ (e.field?.split(".").at(-1)))));
  if (errors.length) return refused(fact("identity_error", { errors }));

  for (const [rel, text] of result.writes) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), backfill(root, rel, text));
  }
  for (const { from } of result.renamed) unlinkSync(join(root, from));
  return { exit: 0, json: {
    ok: true,
    changed: result.writes.size > 0,
    schema_version: result.schema,
    mapping: plan.mapping,
    consumed: result.consumed,
    renamed: result.renamed,
    rewritten: [...result.writes.keys()].sort(),
    check: { errors: result.checkErrors },
  } };
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
  if (schemaFrom < SUITE_KEYS_SCHEMA_VERSION) {
    const done = edit(project, [{ set: { schema_version: SUITE_KEYS_SCHEMA_VERSION } }]);
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
    schema: { from: schemaFrom, to: Math.max(schemaFrom, SUITE_KEYS_SCHEMA_VERSION) },
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
 * @typedef {{ file: string, key: string | null, pin: "review" | "dismissed", status: "carried" | "stale" | "unverified" }} PinOutcome
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
 * @returns {LevelMigrationResult}
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
    /** @type {import("./knowledge-file.mjs").EditChange[]} */
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
