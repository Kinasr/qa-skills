// @ts-check
// Integrity errors on the knowledge side: a reference that cannot resolve, a key
// that does not match its kind's pattern, a key
// naming two things, a file outside the dialect. Also `unknown_key` warnings: an unknown key is
// reported and preserved, never deleted. And a `schema_warning` when
// `project.md` declares a `schema_version` newer than this CLI's: the scan still runs, and
// every command that writes refuses (lib/schema-guard.mjs).
//
// Each file's local problems come from `check-file` itself, so scan and write-time validation can
// never disagree about one file. Everything relational is checked here.
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { shownKey } from "./credentials.mjs";
import { isMap } from "./dialect.mjs";
import { executeIntegrity } from "./execute-training.mjs";
import { resolveCommits } from "./git.mjs";
import { PATTERN, provisionalKeys, readTrackerReference } from "./keys.mjs";
import { checkFile } from "./knowledge-file.mjs";
import { relianceOf } from "./reliance.mjs";
import { formatRuleRef, isQualifiedRuleRef, parseDependsField, resolveRuleRef } from "./rule-ref.mjs";
import { ACCESS_TRAIN_KEY, LEVEL_ON_CASE_SCHEMA_VERSION, SCHEMA_VERSION } from "./schema.mjs";

/** @import { TrackerClaim, TrackerResolver } from "./tracker-resolver.mjs" */
/** @import { ParsedEntry, ParsedFile, ProjectConfig, UnreadableFile } from "./knowledge-file.mjs" */
/** @import { KeyIndex } from "./qa-index.mjs" */
/** @import { QaFile, ScanContext } from "./scan.mjs" */

/**
 * Result kinds emitted by the integrity scan pass.
 * @typedef {"integrity_error" | "unknown_key" | "schema_warning"} IntegrityKind
 */

/**
 * A finding emitted by the integrity scan pass.
 * @typedef {{
 *   kind: IntegrityKind,
 *   code: string,
 *   message: string,
 *   file?: string,
 *   line?: number,
 *   field?: string,
 *   key?: string,
 *   feature?: string,
 *   [key: string]: unknown,
 * }} ScanFinding
 */

/**
 * One Dependency problem of a Feature file: the check's code, the `Depends on:` line it sits on, the
 * dependent Rule, and the reference at fault where one is.
 * @typedef {{
 *   code: string,
 *   line: number,
 *   feature: string,
 *   key: string,
 *   ref?: string,
 *   reason?: "rule" | "feature",
 *   message: string,
 * }} DependencyProblem
 */

/**
 * An entry in one of knowledge index's declaration maps.
 * @typedef {{
 *   file: ParsedFile,
 *   line: number,
 *   feature?: string,
 *   [key: string]: unknown,
 * }} IndexDeclaration
 */

/**
 * Knowledge index structure expected by relational integrity checks.
 * @typedef {{
 *   project?: ParsedFile | null,
 *   features: Map<string, IndexDeclaration[]>,
 *   scenarios: Map<string, IndexDeclaration[]>,
 *   cases: Map<string, IndexDeclaration[]>,
 *   suites: Map<string, IndexDeclaration[]>,
 *   rules: Map<string, Map<string, unknown>>,
 *   tracker: TrackerResolver,
 *   featureOf: (file: ParsedFile) => string | null | undefined,
 *   [key: string]: unknown,
 * }} KnowledgeIndex
 */

/**
 * The part of the scan's context the integrity pass reads: the `.qa/` root, the repository under
 * test as a path, the parsed files, the Key index, the project's settings, and where a result is
 * reported.
 * @typedef {Pick<ScanContext, "root" | "repo" | "files" | "index" | "config" | "emit">} IntegrityContext
 */

/** @type {readonly IntegrityKind[]} */
export const kinds = ["integrity_error", "unknown_key", "schema_warning"];

/**
 * @param {IntegrityContext} ctx
 * @returns {void}
 */
export function run(ctx) {
  const { index } = ctx;
  const error = (/** @type {string} */ code, /** @type {Record<string, unknown>} */ where, /** @type {string} */ message, extra = {}) => ctx.emit({ kind: "integrity_error", code, ...where, message, ...extra });

  if (!index.project) error("missing_project", { file: "project.md" }, "no `project.md` in `.qa/`: roles, levels and the key pattern are unknown");
  const { schemaVersion } = ctx.config;
  if (schemaVersion > SCHEMA_VERSION) {
    ctx.emit({
      kind: "schema_warning",
      code: "schema_newer",
      file: "project.md",
      line: (/** @type {ParsedFile} */ (index.project)).keyLines.schema_version,
      version: schemaVersion,
      supported: SCHEMA_VERSION,
      message: `\`project.md\` declares \`schema_version: ${schemaVersion}\`, newer than the ${SCHEMA_VERSION} this CLI reads: this scan may misread it, and every command that writes refuses until qa-skills is updated`,
    });
  }

  for (const f of /** @type {readonly ParsedFile[]} */ (ctx.files)) {
    const where = { file: f.rel, feature: index.featureOf(f) ?? undefined };
    if (f.unreadable) {
      error("unreadable", where, `cannot read the file: ${f.unreadable}`);
      continue;
    }
    if (RESERVED.includes(f.name)) error("reserved_name", where, `\`${f.name}\` is a reserved name and stays unused in \`.qa/\``, { name: f.name });
    local(ctx, f, where, error);
    for (const { code, message, ...at } of executeIntegrity(f, { root: ctx.root, roles: ctx.config.roles, features: /** @type {Set<string>} */ (/** @type {unknown} */ (index.features)) })) error(code, { ...where, ...at }, message);
    if (f.type === "scenario") scenario(ctx, f, error);
    if (f.type === "feature") waivers(ctx, f, where, error);
    if (f.type === "feature") boundaries(ctx, f, where, error);
    if (f.type === "feature") for (const problem of dependencyProblems(index, ctx.files, f)) {
      const { code, message, ...at } = problem;
      error(code, { file: f.rel, ...at }, message);
    }
    if (f.type === "train" && f.data.key === ACCESS_TRAIN_KEY) accessRoles(ctx, f, where, error);
  }
  uniqueness(ctx, error);
  for (const [key, declarations] of index.suites) {
    if (declarations.length < 2) continue;
    for (const d of declarations) error("duplicate_suite_key", { file: d.file.rel, line: d.line, feature: d.feature, key, field: "suite_key" }, `Suite key \`${key}\` names two Features`);
  }
  trackerUniqueness(ctx, error);
  retired(ctx, error);
  pins(ctx, error);
  projectConfig(ctx, error);
}

const RESERVED = ["index.md", "log.md"];
const HUMAN = /^human:\S/;
const keysIn = (/** @type {unknown} */ v) => (Array.isArray(v) ? /** @type {string[]} */ (v.filter((k) => typeof k === "string")) : []);

/**
 * @param {IntegrityContext} ctx
 * @param {ParsedFile} f
 * @param {Record<string, unknown>} where
 * @param {(code: string, where: Record<string, unknown>, message: string, extra?: Record<string, unknown>) => void} error
 * @returns {void}
 */
function boundaries(ctx, f, where, error) {
  for (const b of f.boundaries) {
    if (f.boundaries.filter((other) => other.key === b.key).length > 1) error("duplicate_boundary_key", { ...where, key: b.key, line: b.line },
      `Boundary key \`${b.key}\` is declared more than once in its Feature`);
    if (!b.owner) error("boundary_no_owner", { ...where, key: b.key, line: b.line },
      `Boundary \`${b.key}\` needs \`Owner: <feature_key | none>\` as its first non-blank line`);
    else if (b.owner !== "none" && !ctx.index.features.has(b.owner)) error("boundary_unknown_owner", { ...where, key: b.key, line: b.line },
      `Boundary \`${b.key}\` names unknown Feature \`${b.owner}\` as its owner`);
    else if (b.owner !== "none" && b.owner === f.data.key) error("boundary_self_owner", { ...where, key: b.key, line: b.line },
      `Boundary \`${b.key}\` names its own Feature as owner; a Boundary hands behaviour elsewhere`);
  }
}

/**
 * @param {IntegrityContext} ctx
 * @param {(code: string, where: Record<string, unknown>, message: string, extra?: Record<string, unknown>) => void} error
 * @returns {void}
 */
function trackerUniqueness(ctx, error) {
  for (const [key, claims] of ctx.index.tracker.claims) {
    if (claims.length < 2) continue;
    const places = claims.map((c) => `${c.field} in ${c.file.rel}:${c.line}`).join(", ");
    for (const c of claims) {
      error("duplicate_tracker_key", { file: c.file.rel, line: c.line, feature: c.feature ?? undefined, key, field: c.field }, `tracker key \`${key}\` names two things: ${places}`);
    }
  }
}

// A Rule's Waiver (ADR-0039): the `Waived: <reason>` field under the Rule's heading says the Rule
// is deliberately left without a Test Case. A Waiver with no reason says nothing, so it is an
// Integrity error on the Waiver's own line.
/**
 * @param {IntegrityContext} ctx
 * @param {ParsedFile} f
 * @param {Record<string, unknown>} where
 * @param {(code: string, where: Record<string, unknown>, message: string, extra?: Record<string, unknown>) => void} error
 * @returns {void}
 */
function waivers(ctx, f, where, error) {
  for (const rule of f.rules) {
    if (rule.waiver !== "" || rule.waiverLine === null) continue;
    error("empty_waiver", { ...where, line: rule.waiverLine, key: rule.key },
      `Rule \`${rule.key}\` is Waived with no reason: a Waiver says why the Rule is deliberately left without a Test Case`);
  }
}

// A Rule's Dependency (ADR-0040): a qualified reference to an Upstream Rule of another Feature. The
// checks are the field's syntax (malformed, empty, repeated), then each reference resolved only in
// the Feature it names: an unknown Feature or Rule there is unresolved, a retired one is retired,
// and one in the dependent Rule's own Feature adds nothing. A retired target is retired, never
// unresolved, so the engineer knows the upstream knowledge was withdrawn rather than mistyped.
/**
 * @param {KeyIndex} index
 * @param {readonly (ParsedFile | UnreadableFile)[]} files
 * @param {ParsedFile} file
 * @returns {DependencyProblem[]}
 */
export function dependencyProblems(index, files, file) {
  if (file.type !== "feature" || typeof file.data.key !== "string") return [];
  const feature = file.data.key;
  /** @type {DependencyProblem[]} */
  const out = [];
  for (const rule of file.rules) {
    const fields = rule.fields.filter((f) => f.name === "Depends on");
    // Every field is read once, by the shared parser, so the Scan's codes and the resolver read
    // the same references.
    const parsed = fields.map((field) => parseDependsField(field));
    for (const field of fields.slice(1)) {
      out.push({ code: "repeated_dependency_field", line: field.line, feature, key: rule.key,
        message: `Rule \`${rule.key}\` has a repeated \`Depends on:\` field; a Rule records one Dependency` });
    }
    for (const [i, field] of fields.entries()) {
      if (!field.value) {
        out.push({ code: "empty_dependency", line: field.line, feature, key: rule.key,
          message: `Rule \`${rule.key}\` has an empty \`Depends on:\`; name the Upstream Rule as \`<feature>/<rule>\`` });
        continue;
      }
      for (const text of parsed[i].malformed) {
        out.push({ code: "malformed_dependency", line: field.line, feature, key: rule.key, ref: text,
          message: `Rule \`${rule.key}\` has the malformed Dependency \`${text}\`; write \`<feature>/<rule>\`` });
      }
    }
    // The first field is the Rule's Dependency; the others are the repeated error above.
    const depends = parsed.length ? parsed[0] : null;
    if (!depends) continue;
    for (const ref of depends.refs) {
      const text = formatRuleRef(ref);
      const resolved = resolveRuleRef(index, files, ref);
      if (resolved.status === "retired") {
        const what = resolved.reason === "feature" ? "retired Feature" : "retired Rule";
        out.push({ code: "retired_dependency", line: depends.line, feature, key: rule.key, ref: text, reason: resolved.reason,
          message: `Rule \`${rule.key}\` depends on \`${text}\`, which is a ${what}` });
        continue;
      }
      if (resolved.status === "unresolved") {
        const what = resolved.reason === "feature" ? "no Feature in `.qa/`" : `no live Rule of \`${ref.feature}\``;
        out.push({ code: "unresolved_dependency", line: depends.line, feature, key: rule.key, ref: text, reason: resolved.reason,
          message: `Rule \`${rule.key}\` depends on \`${text}\`, which names ${what}` });
        continue;
      }
      if (ref.feature === feature) {
        out.push({ code: "same_feature_dependency", line: depends.line, feature, key: rule.key, ref: text,
          message: `Rule \`${rule.key}\` depends on \`${text}\` in its own Feature; a Dependency names an Upstream Rule of another Feature` });
      }
    }
  }
  return out;
}

// An Access note's `role` is one of `project.roles`, as a case's Roles are. The error names
// the note and never the Role: a note that named a credential there would not reach this output
// (`check-file`'s promise). A `role` that is no string is `check-file`'s `shape` error.
/**
 * @param {IntegrityContext} ctx
 * @param {ParsedFile} f
 * @param {Record<string, unknown>} where
 * @param {(code: string, where: Record<string, unknown>, message: string, extra?: Record<string, unknown>) => void} error
 * @returns {void}
 */
function accessRoles(ctx, f, where, error) {
  for (const e of /** @type {ParsedEntry[]} */ (f.access_notes)) {
    const role = e.data.role;
    if (typeof role !== "string" || !role.trim() || ctx.config.roles.has(role)) continue;
    const key = shownKey(e.key);
    error("unknown_role", { ...where, line: e.keyLines.role ?? e.blockLine, key }, `Access note \`${key}\` names a Role that is not in \`project.roles\``);
  }
}

// Invariants 3, 7, 8 and 9 for one scenario file and its cases.
/**
 * @param {IntegrityContext} ctx
 * @param {ParsedFile} f
 * @param {(code: string, where: Record<string, unknown>, message: string, extra?: Record<string, unknown>) => void} error
 * @returns {void}
 */
function scenario(ctx, f, error) {
  const { index, config } = ctx;
  const fk = f.data.feature;
  const at = (/** @type {number | undefined} */ line, extra = {}) => ({ file: f.rel, line, feature: typeof fk === "string" ? fk : undefined, ...extra });
  const home = typeof fk === "string" ? index.features.get(fk)?.[0] : undefined;

  if (typeof fk === "string" && PATTERN.slug.test(fk)) {
    if (!home) error("unresolved_feature", at(f.keyLines.feature), `\`feature: ${fk}\` names no Feature in \`.qa/\``, { key: f.data.key });
    else if (home.file.dir !== f.dir) {
      error("misplaced_scenario", at(f.keyLines.feature), `scenario \`${f.data.key}\` belongs to \`${fk}\` but sits in \`${f.dir}/\`, not \`${home.file.dir}/\``, { key: f.data.key });
    }
  }

  // Until the project reaches the level-on-case schema a Scenario still carries its level.
  if (typeof config.schemaVersion === "number" && config.schemaVersion < LEVEL_ON_CASE_SCHEMA_VERSION) checkLevel(f.data.level, at(f.keyLines.level, { key: f.data.key }));

  const rules = home ? index.rules.get(/** @type {string} */ (fk)) ?? new Map() : null;
  for (const c of f.cases) {
    const line = (/** @type {string} */ k) => c.keyLines[k] ?? c.blockLine ?? c.line;
    const where = (/** @type {string} */ k) => at(line(k), { key: c.key });
    if (Array.isArray(c.data.roles)) {
      for (const role of c.data.roles) {
        if (!config.roles.has(role)) error("unknown_role", where("roles"), `role \`${role}\` of \`${c.key}\` is not in \`project.roles\``, { role });
      }
    }
    checkLevel(c.data.level, where("level"));
    if (rules && Array.isArray(c.data.covers)) {
      for (const rule of c.data.covers) {
        if (typeof rule !== "string" || !PATTERN.rule.test(rule) || rules.has(rule)) continue; // malformed: check-file's
        const elsewhere = [...index.rules].filter(([, m]) => m.has(rule)).map(([k]) => k);
        if (elsewhere.length) {
          error("cross_feature_covers", where("covers"), `\`${c.key}\` covers \`${rule}\` of ${elsewhere.map((k) => `\`${k}\``).join(", ")}; a case covers Rules of its own Feature \`${fk}\` only`, { rule, features: elsewhere });
        } else {
          error("unresolved_covers", where("covers"), `\`${c.key}\` covers \`${rule}\`, which is no live Rule of \`${fk}\``, { rule });
        }
      }
    }
    // Reliance (ADR-0043): a Rule the case's setup rests on, in this Feature or another. A local
    // entry is a key of the case's own Feature; a qualified entry names another Feature, and the
    // duplicate spelling of its own Feature is refused so each Rule has one.
    if (typeof fk === "string" && Array.isArray(c.data.relies_on)) {
      for (const { text, ref, local } of relianceOf(c, fk).refs) {
        if (isQualifiedRuleRef(text) && local) {
          error("same_feature_reliance_qualified", where("relies_on"), `\`${c.key}\` relies on \`${text}\` in its own Feature; write the local Rule key`, { ref: text });
          continue;
        }
        const resolved = resolveRuleRef(index, ctx.files, ref);
        if (resolved.status === "retired") {
          const what = resolved.reason === "feature" ? "retired Feature" : "retired Rule";
          error("retired_reliance", where("relies_on"), `\`${c.key}\` relies on \`${text}\`, which is a ${what}`, { ref: text, reason: resolved.reason });
          continue;
        }
        if (resolved.status === "unresolved") {
          const what = resolved.reason === "feature" ? "no Feature in `.qa/`" : `no live Rule of \`${ref.feature}\``;
          error("unresolved_reliance", where("relies_on"), `\`${c.key}\` relies on \`${text}\`, which names ${what}`, { ref: text, reason: resolved.reason });
        }
      }
    }
  }

  /**
   * @param {unknown} level
   * @param {Record<string, unknown>} where
   * @returns {void}
   */
  function checkLevel(level, where) {
    if (typeof level === "string" && level && !config.levels.has(level)) {
      error("unknown_level", where, `level \`${level}\` is not in \`project.stack.levels\``, { level });
    }
  }
}

// Invariant 1: a Key names one concept across `.qa/`. Features, scenarios and cases share one
// namespace; `rule_` keys are per Feature. A train file's key is its target, not a global key
// (ADR-0015), and a Delegate's model label is no Key (ADR-0020), so a Feature may be named
// `access` or `sonnet`.
/**
 * @param {IntegrityContext} ctx
 * @param {(code: string, where: Record<string, unknown>, message: string, extra?: Record<string, unknown>) => void} error
 * @returns {void}
 */
function uniqueness(ctx, error) {
  const { index } = ctx;
  /** @type {Map<string, Array<{ file: ParsedFile, line: number, kind: string }>>} */
  const all = new Map();
  for (const [kind, map] of /** @type {Array<[string, Map<string, Array<{ file: ParsedFile, line: number }>>]>} */ ([["feature", index.features], ["scenario", index.scenarios], ["case", index.cases]])) {
    for (const [key, decls] of map) {
      if (!all.has(key)) all.set(key, []);
      /** @type {Array<{ file: ParsedFile, line: number, kind: string }>} */ (all.get(key)).push(...decls.map((d) => ({ ...d, kind })));
    }
  }
  for (const [key, decls] of all) {
    if (decls.length < 2) continue;
    const places = decls.map((d) => `${d.kind} in ${d.file.rel}:${d.line}`).join(", ");
    for (const d of decls) {
      error("duplicate_key", { file: d.file.rel, line: d.line, feature: ctx.index.featureOf(d.file) ?? undefined, key }, `key \`${key}\` names ${decls.length} concepts: ${places}; settle it by hand, keeping one body as with a git conflict, never by Merge`);
    }
  }
}

// `check-file`'s verdict on one file, as Integrity errors and `unknown_key` warnings, under the
// scanned tree's own configuration.
/**
 * @param {IntegrityContext} ctx
 * @param {ParsedFile} f
 * @param {Record<string, unknown>} where
 * @param {(code: string, where: Record<string, unknown>, message: string, extra?: Record<string, unknown>) => void} error
 * @returns {void}
 */
function local(ctx, f, where, error) {
  const r = checkFile(f, ctx.config);
  for (const p of r.errors) error(p.code, { ...where, ...(p.line && { line: p.line }) }, p.message, p.field ? { field: p.field } : {});
  for (const w of r.warnings) {
    ctx.emit({ kind: "unknown_key", code: w.code, ...where, ...(w.line && { line: w.line }), ...(w.field && { field: w.field }), message: w.message });
  }
}

// Invariant 12: a Retired key is never reused, so none may name a live concept. `retired:` on a
// Feature holds case, scenario, Rule and Boundary keys (the latter two of that Feature only); `formerly:` holds the
// keys a concept succeeded; `retired_features` holds Feature keys.
/**
 * @param {IntegrityContext} ctx
 * @param {(code: string, where: Record<string, unknown>, message: string, extra?: Record<string, unknown>) => void} error
 * @returns {void}
 */
function retired(ctx, error) {
  const { index } = ctx;
  const live = (/** @type {string} */ key) => index.cases.has(key) || index.scenarios.has(key) || index.suites.has(key);
  const flag = (/** @type {Record<string, unknown>} */ where, /** @type {string} */ key, /** @type {string} */ list) => error("retired_key_live", { ...where, key }, `\`${key}\` is listed in \`${list}\` but still names a live concept`);
  for (const f of /** @type {readonly ParsedFile[]} */ (ctx.files)) {
    if (f.unreadable) continue;
    const feature = index.featureOf(f) ?? undefined;
    const at = (/** @type {number | undefined} */ line) => ({ file: f.rel, line: line ?? f.frontmatterLine, feature });
    if (f.type === "feature") {
      const rules = index.rules.get(/** @type {string} */ (f.data.key)) ?? new Map();
      const boundaries = index.boundaries.get(/** @type {string} */ (f.data.key)) ?? new Map();
      for (const k of keysIn(f.data.retired)) {
        if (readTrackerReference(k) !== null) continue;
        const keys = [k, ...provisionalKeys(k)];
        for (const key of keys) if (PATTERN.rule.test(key) ? rules.has(key) : PATTERN.boundary.test(key) ? boundaries.has(key) : live(key)) flag(at(f.keyLines.retired), key, "retired");
      }
      for (const k of keysIn(f.data.formerly)) if (index.features.has(k)) flag(at(f.keyLines.formerly), k, "formerly");
    }
    if (f.type === "scenario") {
      for (const k of keysIn(f.data.formerly)) if (live(k)) flag(at(f.keyLines.formerly), k, "formerly");
      for (const c of f.cases) {
        for (const k of keysIn(c.data.formerly)) if (live(k)) flag(at(c.keyLines.formerly ?? c.line), k, `${c.key}.formerly`);
      }
    }
    if (f.type === "project") {
      for (const k of keysIn(f.data.retired_features)) if (index.features.has(k) || index.suites.has(k)) flag(at(f.keyLines.retired_features), k, "retired_features");
    }
  }
}

// Invariants 11, 14 and 15 on pins and stamps: every `watermark` and finding `at_commit` names a
// commit, and `review.by` and `dismissed.by` are `human:`. A `review.commit` or `dismissed.commit`
// that does not resolve is not an error here: it voids the review or re-arms the finding.
/**
 * @param {IntegrityContext} ctx
 * @param {(code: string, where: Record<string, unknown>, message: string, extra?: Record<string, unknown>) => void} error
 * @returns {void}
 */
function pins(ctx, error) {
  /** @type {Array<{ id: string, code: string, what: string, where: Record<string, unknown> }>} */
  const wanted = [];
  const want = (/** @type {unknown} */ id, /** @type {string} */ code, /** @type {string} */ what, /** @type {Record<string, unknown>} */ where) => {
    if (id !== undefined && id !== null) wanted.push({ id: String(id), code, what, where });
  };
  const findings = (/** @type {unknown} */ list, /** @type {Record<string, unknown>} */ where) => {
    for (const x of Array.isArray(list) ? list : []) {
      if (!isMap(x)) continue;
      want(x.at_commit, "unresolved_at_commit", "a finding's `at_commit`", where);
      if (isMap(x.dismissed) && x.dismissed.by !== undefined && !HUMAN.test(/** @type {string} */ (x.dismissed.by))) {
        error("non_human_dismissal", { ...where, field: "dismissed.by" }, `\`dismissed.by\` is \`${x.dismissed.by}\`; only a person dismisses a finding (\`human:<name>\`)`);
      }
    }
  };
  for (const f of /** @type {readonly ParsedFile[]} */ (ctx.files)) {
    if (f.unreadable) continue;
    const feature = ctx.index.featureOf(f) ?? undefined;
    if (f.type === "feature") {
      const at = (/** @type {string} */ k) => ({ file: f.rel, line: f.keyLines[k] ?? f.frontmatterLine, feature, key: f.data.key });
      want(f.data.watermark, "unresolved_watermark", "`watermark`", at("watermark"));
      findings(f.data.finding, at("finding"));
    }
    if (f.type !== "scenario") continue;
    for (const c of f.cases) {
      const at = (/** @type {string} */ k) => ({ file: f.rel, line: c.keyLines[k] ?? c.blockLine ?? c.line, feature, key: c.key });
      findings(c.data.finding, at("finding"));
      const review = c.data.review;
      if (isMap(review) && review.by !== undefined && !HUMAN.test(/** @type {string} */ (review.by))) {
        error("non_human_review", { ...at("review"), field: "review.by" }, `\`review.by\` is \`${review.by}\`; only a person reviews a case (\`human:<name>\`)`);
      }
    }
  }
  const { ok, resolved } = resolveCommits(ctx.root, wanted.map((w) => w.id));
  for (const w of wanted) {
    if (resolved.get(w.id)) continue;
    const why = ok ? "names no commit in this repository" : "cannot resolve: `.qa/` is not inside a git repository";
    error(w.code, w.where, `${w.what} \`${w.id}\` ${why}`, { commit: w.id, repository: ok });
  }
}

// Relational config checks: every module path exists in the repository under test.
/**
 * @param {IntegrityContext} ctx
 * @param {(code: string, where: Record<string, unknown>, message: string, extra?: Record<string, unknown>) => void} error
 * @returns {void}
 */
function projectConfig(ctx, error) {
  const project = ctx.index.project;
  if (!project) return;
  const at = (/** @type {string} */ k, /** @type {string} */ field) => ({ file: project.rel, line: project.keyLines[k] ?? project.frontmatterLine, field });
  for (const p of ctx.config.modulePaths) {
    let dir;
    try {
      dir = statSync(resolve(ctx.repo, p)).isDirectory();
    } catch {
      dir = false;
    }
    if (!dir) error("missing_module_path", at("module_paths", "module_paths"), `module path \`${p}\` is not a directory in the repository`, { path: p });
  }
}
