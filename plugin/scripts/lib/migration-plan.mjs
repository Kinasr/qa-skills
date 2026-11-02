// @ts-check
// Pure ADR-0027 migration planning over qa-index.mjs's buildIndex result. No disk or git access.
import { edit, projectConfig } from "./knowledge-file.mjs";
import { buildIndex } from "./qa-index.mjs";
import { isKey, isMap } from "./dialect.mjs";
import { passKey, storedPass } from "./design-duplicates.mjs";
import { LEVEL_ON_CASE_SCHEMA_VERSION } from "./schema.mjs";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { ALPHABET, PATTERN, provisionalKeys, readTrackerReference, trackerReference } from "./keys.mjs";

/**
 * Recipe v1: first 40 SHA-256 bits, most significant group first, eight Crockford characters.
 * @param {"scenario" | "case" | string} kind
 * @param {string} tracker
 * @returns {string}
 */
function hashedKey(kind, tracker) {
  const bytes = createHash("sha256").update(`${kind}:${tracker}`, "utf8").digest();
  let bits = 0n;
  for (const byte of bytes.subarray(0, 5)) bits = (bits << 8n) | BigInt(byte);
  let suffix = "";
  for (let shift = 35n; shift >= 0n; shift -= 5n) suffix += ALPHABET[Number((bits >> shift) & 31n)];
  return `${kind === "case" ? "tc" : "ts"}_${suffix}`;
}

/**
 * @typedef {{
 *   kind: "scenario" | "case",
 *   file: string,
 *   at?: string,
 *   from: string,
 *   to: string,
 *   tracker?: string,
 *   formerly: string[],
 * }} MigrationMappingRow
 */

/**
 * @typedef {{
 *   file: string,
 *   at?: string,
 *   set?: Record<string, unknown>,
 *   text?: string,
 *   heading?: { line: number, from: string, to: string },
 *   rename?: string,
 * }} MigrationRewrite
 */

/**
 * @typedef {{
 *   code: string,
 *   file: string,
 *   at?: string,
 *   field?: string,
 *   key?: string,
 *   from?: string,
 *   kind?: string,
 *   override?: unknown,
 *   message?: string,
 *   other?: unknown,
 * }} MigrationError
 */

/**
 * @typedef {{
 *   ok: true,
 *   recipe: 1,
 *   mapping: MigrationMappingRow[],
 *   rewrites: MigrationRewrite[],
 *   errors: MigrationError[],
 * }} MigrationPlanSuccess
 */

/**
 * @typedef {{
 *   ok: false,
 *   recipe: 1,
 *   mapping: MigrationMappingRow[],
 *   rewrites: MigrationRewrite[],
 *   errors: MigrationError[],
 * }} MigrationPlanFailure
 */

/**
 * @typedef {MigrationPlanSuccess | MigrationPlanFailure} MigrationPlanResult
 */

/**
 * @typedef {{
 *   file: {
 *     rel: string,
 *     dir: string,
 *     name: string,
 *     data: Record<string, unknown>,
 *     h1?: { line: number, key: string } | null,
 *   },
 *   entry?: {
 *     line: number,
 *     key?: string,
 *     data: Record<string, unknown>,
 *   } | null,
 * }} LegacyDeclaration
 */

/**
 * @typedef {{
 *   scenarios: ReadonlyMap<string, readonly LegacyDeclaration[]>,
 *   cases: ReadonlyMap<string, readonly LegacyDeclaration[]>,
 *   features: ReadonlyMap<string, readonly { file: { rel: string, data: { key?: string, retired?: unknown } } }[]>,
 *   rules: ReadonlyMap<string, ReadonlyMap<string, readonly { file: { rel: string }, line: number }[]>>,
 *   boundaries: ReadonlyMap<string, ReadonlyMap<string, readonly { file: { rel: string }, line: number }[]>>,
 * }} LegacyMigrationIndex
 */

// `index` is buildIndex's parsed legacy tree. The caller owns file readability and schema checks.
// Returns {ok, recipe: 1, mapping, rewrites, errors}. Each mapping row names a live declaration:
// {kind, file, at?, from, to, tracker, formerly}; `formerly` retains its historical aliases.
// A refusal returns no mapping or rewrites. Errors name the input file and the conflicting Key,
// override or ancestry. Collisions include tracker bindings and aliases, but not historical aliases.
//
// Rewrite operations address the INPUT files, before any rename:
//   {file, at?, set}    knowledge-file.mjs edit's field change; undefined removes a field
//   {file, heading: {line, from, to}}  replace only the Key of this parsed heading
//   {file, rename}     the scenario's new relative path, keeping its slug
// `at` is a case Key, omitted for frontmatter. Apply field and heading edits against the input
// locations before renaming. No operation authorises a whole-text replacement. The legacy schema
// has no other structured internal Case/Scenario references: finding subjects and mirror parents
// name tracker items, `feature` and `covers` name unchanged Feature and Rule Keys. Prose, evidence,
// sources, automates, Mirrors and human pins are never rewritten. Applying the plan and the
// schema-version bump is `migrate-keys`' job; this module only plans.
/**
 * @param {LegacyMigrationIndex} index
 * @returns {MigrationPlanResult}
 */
export function planMigration(index) {
  /** @type {MigrationMappingRow[]} */
  const mapping = [];
  /** @type {MigrationRewrite[]} */
  const rewrites = [];
  /** @type {MigrationError[]} */
  const errors = [];
  /** @type {Map<string, { file: string, at?: string, field?: string }>} */
  const claimed = new Map();
  const claim = (/** @type {string} */ key, /** @type {{ file: string, at?: string, field?: string }} */ where) => {
    if (claimed.has(key)) errors.push({ code: "collision", key, ...where, other: claimed.get(key) });
    else claimed.set(key, where);
  };
  for (const [kind, declarations] of /** @type {const} */ ([["scenario", index.scenarios], ["case", index.cases]])) {
    for (const [from, decls] of declarations) for (const decl of decls) {
      const data = kind === "case" ? (/** @type {{ data: Record<string, unknown> }} */ (decl.entry)).data : decl.file.data;
      const where = { file: decl.file.rel, ...(kind === "case" ? { at: from } : {}) };
      const permanent = PATTERN[kind].test(from);
      if (permanent && data.migrate_as !== undefined) {
        errors.push({ code: "invalid_override", ...where, from, kind, override: data.migrate_as,
          message: `\`${from}\` is already permanent; remove \`migrate_as\` because migration cannot change its Key` });
        continue;
      }
      if (data.migrate_as !== undefined && (typeof data.migrate_as !== "string" || !PATTERN[kind].test(data.migrate_as))) {
        errors.push({ code: "invalid_override", ...where, from, kind, override: data.migrate_as });
        continue;
      }
      const history = data.formerly ?? [];
      const ancestors = Array.isArray(history) ? [...new Set(history.filter((key) => typeof key === "string" && key.startsWith("new_")))] : [];
      // `formerly` is a flat alias list, not ancestry edges. A former provisional Key is
      // older than the live one; multiple former provisional Keys have no provable ordering.
      if (!Array.isArray(history) || (!permanent && ancestors.length > 1) || ancestors.some((key) => !PATTERN.provisional.test(key)) ||
          (from.startsWith("new_") && !PATTERN.provisional.test(from))) {
        errors.push({ code: "unresolved_ancestry", ...where, from });
        continue;
      }
      const ancestor = ancestors[0] ??
        (PATTERN.provisional.test(from) ? from : null);
      const to = permanent ? from : /** @type {string} */ (data.migrate_as) ?? (ancestor
        ? /** @type {string} */ (provisionalKeys(ancestor).find((key) => PATTERN[kind].test(key))) : hashedKey(kind, from));
      const tracker = /** @type {string | undefined} */ (data.tracker ?? (!permanent && !PATTERN.provisional.test(from) ? from : undefined));
      const formerly = [...new Set([.../** @type {string[]} */ (history), ...(!permanent ? [from] : [])])];
      mapping.push({ kind, from, to, ...where, tracker, formerly });
      claim(to, where);
      if (tracker !== undefined) claim(trackerReference(tracker), where);
      for (const alias of /** @type {string[]} */ (data.tracker_formerly ?? [])) claim(trackerReference(alias), where);
      if (!permanent) rewrites.push({ ...where, set: { key: to, tracker, formerly,
        ...(data.migrate_as !== undefined ? { migrate_as: undefined } : {}) } });
      if (from !== to) {
        const heading = kind === "case" ? decl.entry : decl.file.h1;
        if (heading?.key === from) rewrites.push({ file: decl.file.rel, heading: { line: heading.line, from, to } });
        if (kind === "scenario" && decl.file.name.startsWith(`${from}-`)) {
          rewrites.push({ file: decl.file.rel, rename: posix.join(decl.file.dir, to + decl.file.name.slice(from.length)) });
        }
      }
    }
  }
  for (const decls of index.features.values()) for (const { file } of decls) {
    const retired = (/** @type {readonly string[]} */ (file.data.retired ?? [])).flatMap((key) => PATTERN.provisional.test(key)
      ? provisionalKeys(key)
      : PATTERN.case.test(key) || PATTERN.scenario.test(key) || PATTERN.suite.test(key) || PATTERN.rule.test(key) || PATTERN.boundary.test(key) || readTrackerReference(key) !== null
        ? [key] : [trackerReference(key)]);
    /** @type {Map<string, { file: string, line?: number, field?: string }>} */
    const rules = new Map([...index.rules.get(/** @type {string} */ (file.data.key)) ?? []].map(([key, decls]) => [key, { file: decls[0].file.rel, line: decls[0].line }]));
    /** @type {Map<string, { file: string, line?: number, field?: string }>} */
    const boundaries = new Map([...index.boundaries.get(/** @type {string} */ (file.data.key)) ?? []].map(([key, decls]) => [key, { file: decls[0].file.rel, line: decls[0].line }]));
    for (const key of retired) {
      const where = { file: file.rel, field: "retired" };
      const local = PATTERN.rule.test(key) ? rules : PATTERN.boundary.test(key) ? boundaries : null;
      if (!local) claim(key, where);
      else if (local.has(key)) errors.push({ code: "collision", key, ...where, other: local.get(key) });
      else local.set(key, where);
    }
    if (JSON.stringify(retired) !== JSON.stringify(file.data.retired ?? [])) rewrites.push({ file: file.rel, set: { retired } });
  }
  return errors.length ? { ok: false, recipe: 1, mapping: [], rewrites: [], errors }
    : { ok: true, recipe: 1, mapping, rewrites, errors: [] };
}

/**
 * @typedef {{ level: string, tag?: string }} LevelMapping
 * @typedef {{ code: string, file?: string, key?: string, message: string, errors?: import("./knowledge-file.mjs").EditError[] }} LevelMigrationError
 * @typedef {{ ok: boolean, needed: string[], rewrites: MigrationRewrite[], errors: LevelMigrationError[], execute_levels: { before: Record<string, unknown>, after: Record<string, unknown>, unresolved: { from: string, mode: unknown, levels: string[] }[] }, duplicates: { feature: string | null, level: string | null, keys: string[] }[], created_tags: string[] }} LevelMigrationPlan
 */

/**
 * The level mappings a migrated project records in `level_migrations`: each legacy level and the
 * project level it became.
 * @param {Record<string, unknown> | undefined} projectData - `project.md`'s frontmatter data
 * @returns {Record<string, LevelMapping>}
 */
export function recordedLevelMappings(projectData) {
  const recorded = isMap(projectData?.level_migrations) ? projectData.level_migrations : {};
  return Object.fromEntries(Object.entries(recorded).filter(([, level]) => typeof level === "string").map(([from, level]) => [from, { level: /** @type {string} */ (level) }]));
}

/**
 * The level migration's representation, also used when comparing a historical fix pin with a
 * migrated project. It changes no human stamp and never writes a file. A Scenario whose rewrite
 * cannot be applied is a `level_rewrite_failed` error, never returned as it was.
 * @param {readonly import("./knowledge-file.mjs").ParsedFile[]} files
 * @param {Readonly<Record<string, LevelMapping>>} mappings
 * @returns {{ files: import("./knowledge-file.mjs").ParsedFile[], errors: LevelMigrationError[] }}
 */
export function levelMigrationFiles(files, mappings) {
  /** @type {LevelMigrationError[]} */
  const errors = [];
  const migrated = files.map((file) => {
    if (file.type !== "scenario" || file.unreadable || file.problems.length) return file;
    /** @type {import("./knowledge-file.mjs").EditChange[]} */
    const changes = [{ set: { level: undefined } }];
    for (const entry of file.cases) {
      const level = entry.data.level ?? file.data.level;
      const mapping = typeof level === "string" ? mappings[level] : undefined;
      const tags = [...new Set([...(Array.isArray(entry.data.tags) ? entry.data.tags : []), ...(mapping?.tag ? [mapping.tag] : [])])];
      changes.push({ at: entry.key, set: { level: mapping?.level ?? level, ...(mapping?.tag ? { tags } : {}) } });
    }
    const out = edit(file, changes);
    if (out.ok) return out.file;
    errors.push({ code: "level_rewrite_failed", file: file.rel, message: `the level rewrite of ${file.rel} could not be applied`, errors: out.errors });
    return file;
  });
  return { files: migrated, errors };
}

/**
 * @param {readonly import("./knowledge-file.mjs").ParsedFile[]} files
 * @param {Readonly<Record<string, LevelMapping>>} mappings
 * @returns {LevelMigrationPlan}
 */
export function planLevelMigration(files, mappings) {
  const index = buildIndex(files);
  const project = index.project;
  const config = projectConfig(project);
  const execute = isMap(project?.data.execute_levels) ? project.data.execute_levels : {};
  const values = files.filter((f) => f.type === "scenario").flatMap((f) => [f.data.level, ...f.cases.map((c) => c.data.level ?? f.data.level)]);
  const needed = [...new Set([...values, ...Object.keys(execute)].filter((v) => typeof v === "string").filter((v) => !config.levels.has(v) && !Object.hasOwn(mappings, v)))].sort();
  /** @type {LevelMigrationPlan["errors"]} */
  const errors = [];
  for (const [from, mapping] of Object.entries(mappings)) {
    if (config.levels.has(from) || !config.levels.has(mapping.level) || !mapping.tag || !isKey(mapping.tag)) errors.push({ code: "bad_level_mapping", message: `map the legacy level ${from} to a project level plus a Tag name` });
  }
  for (const f of files.filter((f) => f.type === "scenario")) for (const c of f.cases) {
    if (typeof (c.data.level ?? f.data.level) !== "string" || !(c.data.level ?? f.data.level)) errors.push({ code: "case_level_required", file: f.rel, key: c.key, message: "set the case's level before migrating" });
  }
  /** @type {Record<string, unknown>} */
  const afterExecute = {};
  for (const [level, mode] of Object.entries(execute)) {
    const target = mappings[level]?.level ?? level;
    if (Object.hasOwn(afterExecute, target) && afterExecute[target] !== mode) errors.push({ code: "execute_level_conflict", message: `execution modes disagree for ${target}; settle execute_levels before migrating` });
    afterExecute[target] = mode;
  }
  const { files: after, errors: rewriteErrors } = levelMigrationFiles(files, mappings);
  errors.push(...rewriteErrors);
  /** @type {LevelMigrationPlan["duplicates"]} */
  const duplicates = [];
  const previews = needed.length ? [...config.levels].map((level) => levelMigrationFiles(files, { ...mappings, ...Object.fromEntries(needed.map((from) => [from, { level }])) }).files) : [after];
  for (const preview of previews) {
    const cases = preview.filter((f) => f.type === "scenario").flatMap((file) => file.cases.map((entry) => ({ file, entry })));
    const original = new Map(files.filter((f) => f.type === "scenario").flatMap((file) => file.cases.map((entry) => {
      const inherited = { ...entry, data: { ...entry.data, level: entry.data.level ?? file.data.level } };
      return [entry.key, passKey(storedPass(inherited))];
    })));
    for (let i = 0; i < cases.length; i++) for (let j = 0; j < i; j++) {
      const a = cases[i], b = cases[j];
      if (a.file.data.feature !== b.file.data.feature || original.get(a.entry.key) === original.get(b.entry.key)) continue;
      const pass = storedPass(a.entry);
      if (passKey(pass) !== passKey(storedPass(b.entry))) continue;
      const keys = [b.entry.key, a.entry.key].sort();
      if (!duplicates.some((d) => d.level === pass.level && d.keys.join() === keys.join())) duplicates.push({ feature: typeof a.file.data.feature === "string" ? a.file.data.feature : null, level: pass.level, keys });
    }
  }
  // A Tag a mapping creates has no meaning, so a `/qa-design` filler never assigns it until the engineer gives one.
  const tags = { ...config.labels.tags };
  /** @type {string[]} */
  const created = [];
  for (const mapping of Object.values(mappings)) if (mapping.tag && !Object.hasOwn(tags, mapping.tag) && !config.labels.retiredTags.includes(mapping.tag)) { tags[mapping.tag] = ""; created.push(mapping.tag); }
  /** @type {MigrationRewrite[]} */
  const rewrites = after.filter((f, i) => f.text !== files[i].text).map((f) => ({ file: f.rel, text: f.text }));
  if (project) {
    const stack = isMap(project.data.stack) ? project.data.stack : {};
    const prior = isMap(project.data.level_migrations) ? project.data.level_migrations : {};
    rewrites.push({ file: project.rel, set: {
      schema_version: LEVEL_ON_CASE_SCHEMA_VERSION,
      stack: { ...stack, levels: [...new Set([...config.levels].map((level) => mappings[level]?.level ?? level))] },
      ...(Object.keys(execute).length ? { execute_levels: afterExecute } : {}),
      ...(Object.keys(tags).length ? { tags } : {}),
      ...(Object.keys(mappings).length ? { level_migrations: { ...prior, ...Object.fromEntries(Object.entries(mappings).map(([from, m]) => [from, m.level])) } } : {}),
    } });
  }
  return { ok: needed.length === 0 && errors.length === 0, needed, errors, rewrites, execute_levels: { before: execute, after: afterExecute, unresolved: needed.filter((from) => Object.hasOwn(execute, from)).map((from) => ({ from, mode: execute[from], levels: [...config.levels] })) }, duplicates, created_tags: created };
}
