// @ts-check
// `check-file`: write-time local validation of one parsed `.qa/` file (ADR-0008),
// behind lib/knowledge-file.mjs. Pure: it reads no file, so the CLI's `check-file <path>`, `scan`
// and every writer check text before or without anything on disk.
//
// Local means this file and nothing else, with one reading of configuration (`projectConfig`): a
// live Case and Scenario Keys follow the declared schema version; Tracker fields and legacy
// Keys use `tracker.key_pattern`. Scenario and Feature files take project configuration too. Nothing
// is resolved against another file: `covers`, `automates`, `feature:`, role and level membership
// and key uniqueness across `.qa/` are relational and belong to `scan`.
//
// Every problem is `{code, field?, line?, message}`. Codes:
//   dialect    outside the YAML dialect, or a markdown structure the schema cannot read
//   conflict_marker  a git conflict marker left in the file
//   type       no `type`, or one outside the closed vocabulary
//   required   a required key is missing
//   pattern    a key does not match its kind's pattern
//   date       not an ISO `YYYY-MM-DD` date
//   duplicate  a key declared twice in the file, or a `match` prefix two Access notes share
//   heading    a structured heading is malformed, or its key disagrees with its block or frontmatter
//   shape      a value has the wrong form (a list where a scalar belongs, …)
//   invalid    a per-type local rule fails
//   bug_config_missing  the tracker's bug-publish group is partial, or `bug_fields` has no group
//   bug_type_collides   `tracker.bug_type` names a Suite, Scenario or Case issue type
//   secret     a train file holds a credential: text in a known token format on any line of any
//              file in `train/`, or a credential-named key in an Access note's block
// Warnings use `unknown_key` for preserved unknown keys (the schema-evolution stance), and
// `automation_key_overlap` when a regex matches a minted-Key witness (ADR-0027).
/**
 * @import { LabelDefinitions } from "./case-labels.mjs"
 * @import { TrainEntryDescriptor } from "./schema.mjs"
 */
import { publishDestinationProblems } from "./publish-labels.mjs";
import { caseLabelProblems, labelDefinitionProblems, labelDefinitions } from "./case-labels.mjs";
import { cliLoginUser, isMatchPrefix, PASSWORD_VIA } from "./access-note.mjs";
import { parseCategoryDraft, validateCategories } from "./category-file.mjs";
import { testRunnerMatchesStack } from "./stacks/descriptors.mjs";
import { credentialIn, credentialMessage, redactPairs, secretsIn, tokenIn, WITHHELD } from "./credentials.mjs";
import { sensitiveLiteralName } from "./sensitive-literals.mjs";
import { isMap } from "./dialect.mjs";
import { EVIDENCE_SUMMARY, isExecutionEvidence } from "./evidence-record.mjs";
import { compileKeyPattern, hasMintedPrefix, isCaseKey, isFixtureName, isFormerKey, isHostname, isLiveCaseKey, isModelLabel, isRetiredKey, isScenarioKey, isTrackerKey, KEY_OVERLAP_WITNESSES, parseMintRecipe, PATTERN, readTrackerReference, TIERS } from "./keys.mjs";
import { keyedHeading } from "./markdown.mjs";
import { isRuleRef } from "./rule-ref.mjs";
import { ACCESS_TRAIN_KEY, AUTOMATION_ATTEMPT, AUTOMATION_BLOCKED_REASONS, AUTOMATION_DIAGNOSTIC_CAP, AUTOMATION_DIAGNOSTICS_MAX, AUTOMATION_RESULTS, BUG_ROUTES, BUG_STATUSES, CATEGORIES_TRAIN_KEY, CODEGEN_FACETS, CODEGEN_SIGNALS, CODEGEN_TRAIN_KEY, DESIGN_TRAIN_KEY, EXECUTE_TRAIN_KEY, CODEFIX_TRAIN_KEY, canonicalTrainKey, EXECUTION_SKIPPED, FINDING_KINDS, LEVEL_ON_CASE_SCHEMA_VERSION, MINTED_KEYS_SCHEMA_VERSION, SUITE_KEYS_SCHEMA_VERSION, isBugFile, isExecutionFile, isSchemaVersion, KNOWN, MIRROR_FIELDS, MIRROR_LISTS, MIRROR_OPTIONAL, MIRROR_PROSE, SUBJECT_KINDS, TRAIN_ENTRIES, TRAIN_KEYS, trainEntry, TYPES } from "./schema.mjs";

/**
 * A problem reported on a .qa file.
 * @typedef {{
 *   code: string,
 *   field?: string,
 *   line?: number | null,
 *   message: string,
 * }} CheckProblem
 */

/**
 * The result of checking a .qa file.
 * @typedef {{
 *   type: string | null,
 *   ok: boolean,
 *   errors: CheckProblem[],
 *   warnings: CheckProblem[],
 * }} CheckResult
 */

/**
 * A reason a scenario execution may be blocked.
 * @typedef {"no-access" | "unreachable" | "precondition" | "step" | "ambiguous-actor" | "action-cap" | "off-target" | "connection-lost"} BlockedReason
 */

/**
 * A single parsed entry (a case, execution, or train entry).
 * @typedef {{
 *   key: string,
 *   summary?: string,
 *   statement?: string,
 *   line: number,
 *   end?: number,
 *   data: Record<string, unknown>,
 *   keyLines: Record<string, number>,
 *   blockLine?: number | null,
 *   blockEnd?: number | null,
 *   prose?: Array<{ line: number, text: string }>,
 *   [key: string]: unknown,
 * }} ParsedEntry
 */

/**
 * A parsed section (heading).
 * @typedef {{
 *   level: number,
 *   title: string,
 *   line: number,
 *   end: number,
 * }} ParsedSection
 */

/**
 * A parsed .qa file.
 * @typedef {{
 *   rel?: string,
 *   name?: string,
 *   dir?: string,
 *   text?: string,
 *   eol?: string,
 *   type?: string | null,
 *   data?: Record<string, unknown>,
 *   keyLines?: Record<string, unknown>,
 *   frontmatter?: { line: number, end: number } | null,
 *   frontmatterLine?: number,
 *   h1?: { line: number, key: string | null, text: string } | null,
 *   sections?: ParsedSection[],
 *   fences?: Array<{ lang?: string, line: number, end: number }>,
 *   problems?: Array<{ code?: string, line?: number, message: string }>,
 *   cases?: ParsedEntry[],
 *   executions?: ParsedEntry[],
 *   rules?: Array<{ key: string, statement: string, line: number, end?: number }>,
 *   conventions?: ParsedEntry[],
 *   practices?: ParsedEntry[],
 *   access_notes?: ParsedEntry[],
 *   recipes?: ParsedEntry[],
 *   actions?: ParsedEntry[],
 *   uploads?: ParsedEntry[],
 *   [key: string]: unknown,
 * }} ParsedFile
 */

/**
 * Project configuration options used by file checking.
 * @typedef {{
 *   pathInsideRepo?: (path: string) => boolean,
 *   labels?: LabelDefinitions,
 *   schemaVersion?: number,
 *   trackerPattern?: RegExp | null,
 *   autPattern?: RegExp | null,
 *   [key: string]: unknown,
 * }} CheckConfig
 */

/**
 * @callback ProblemReporter
 * @param {string} code
 * @param {string | undefined} field
 * @param {string} message
 * @param {number | null} [line]
 * @returns {void}
 */

/**
 * Checking context passed to check functions.
 * @typedef {{
 *   report: ProblemReporter,
 *   warn: ProblemReporter,
 *   file: ParsedFile,
 *   secretLines: Set<number>,
 *   pathInsideRepo?: (path: string) => boolean,
 *   labels?: LabelDefinitions,
 *   schemaVersion?: number,
 *   trackerPattern?: RegExp | null,
 *   autPattern?: RegExp | null,
 *   line?: (key: string) => number | undefined,
 *   fmLine?: number,
 *   type?: string,
 * }} CheckContext
 */

/**
 * @typedef {{
 *   prefixes: Map<string, string>,
 *   accounts: Map<string, string>,
 * }} AccessPrefixRegistry
 */

// `file` is lib/knowledge-file.mjs's `parse`; `config` its `projectConfig`, whose `trackerPattern`
// and `autPattern` judge keys.
/**
 * @param {ParsedFile} file
 * @param {CheckConfig} config
 * @returns {CheckResult}
 */
export function checkFile(file, config) {
  const out = { errors: /** @type {CheckProblem[]} */ ([]), warnings: /** @type {CheckProblem[]} */ ([]) };
  // Train, Execution and project diagnostics never repeat credentials: withhold fields or
  // messages that would. A train file is identified by its place, whatever its declared type.
  const isTrainFile = /^train\/[^/]+$/.test(/** @type {string} */ (file.rel));
  const execution = isExecutionFile(/** @type {{ type?: unknown, rel: string }} */ (file));
  const bug = isBugFile(/** @type {{ type?: unknown, rel: string }} */ (file));
  /** @param {unknown} s */
  const leaks = (s) => (isTrainFile || execution || bug || file.type === "project") && typeof s === "string" && (credentialIn(s) !== null || (file.type === "project" && redactPairs(s) !== s));
  /** @param {CheckProblem[]} list */
  const into = (list) =>
    /**
     * @param {string} code
     * @param {string | undefined} field
     * @param {string} message
     * @param {number | null} [line]
     */
    (code, field, message, line) =>
      list.push(problem(code, leaks(field) ? undefined : field, leaks(message) ? WITHHELD_PROBLEM : message, line));
  // `secretLines`: the lines a `secret` error already cites.
  /** @type {CheckContext} */
  const ctx = {
    report: into(out.errors),
    warn: into(out.warnings),
    file,
    secretLines: new Set(),
    schemaVersion: config.schemaVersion,
    labels: config.labels,
    pathInsideRepo: config.pathInsideRepo,
    trackerPattern: config.trackerPattern,
    autPattern: config.autPattern,
  };
  checkDoc(file, ctx);
  if (isTrainFile) refuseTokens(ctx, file);
  if (isTrainFile && /** @type {Record<string, unknown>} */ (file.data ?? {}).key === CODEGEN_TRAIN_KEY) refuseSensitiveLiterals(ctx, file);
  if (execution) {
    if ((/** @type {string} */ (file.rel)).startsWith("executions/") && file.type !== "execution") ctx.report("invalid", "type", "files under `executions/` must have type execution", file.frontmatterLine);
    (/** @type {string} */ (file.text)).replace(/\r\n/g, "\n").split("\n").forEach((text, i) => {
      if (credentialIn(text)) ctx.report("secret", undefined, "Execution records never hold credentials", i + 1);
      if (URL_WITH_QUERY.test(text)) ctx.report("invalid", "url", "Execution URLs must have no query or fragment", i + 1);
    });
  }
  if (bug) {
    if ((/** @type {string} */ (file.rel)).startsWith("bugs/") && file.type !== "bug") ctx.report("invalid", "type", "files under `bugs/` must have type bug", file.frontmatterLine);
    (/** @type {string} */ (file.text)).replace(/\r\n/g, "\n").split("\n").forEach((text, i) => {
      if (credentialIn(text)) ctx.report("secret", undefined, "Bug drafts never hold credentials", i + 1);
      if (URL_WITH_QUERY.test(text)) ctx.report("invalid", "url", "Bug drafts must have no query or fragment in a URL", i + 1);
    });
  }
  return finish(out, ctx.type ?? null);
}

// A URL that still carries a query or fragment, which an Execution record never holds.
const URL_WITH_QUERY = /[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]*[?#]/i;

// Everything `checkFile` checks but the train-file token refusal, which runs whatever this finds:
// `ctx.type` is the declared type once it is known and valid.
/**
 * @param {ParsedFile} file
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkDoc(file, ctx) {
  const { report, warn } = ctx;
  for (const p of /** @type {Array<{ code?: string, line?: number, message: string }>} */ (file.problems)) report(/** @type {string} */ (p.code), undefined, p.message, p.line);
  if (!file.frontmatter) {
    report("type", "type", "no frontmatter, so no `type`: every `.qa/` markdown file declares one", 1);
    return;
  }
  const data = /** @type {Record<string, unknown>} */ (file.data);
  ctx.line = (key) => /** @type {number | undefined} */ (/** @type {NonNullable<typeof file.keyLines>} */ (file.keyLines)[key]);
  ctx.fmLine = /** @type {number} */ (file.frontmatterLine); // cited for a key that is missing altogether

  const type = /** @type {string} */ (data.type);
  if (type === undefined) {
    report("type", "type", "no `type`: every `.qa/` markdown file declares one", file.frontmatterLine);
    return;
  }
  if (!TYPES.includes(type)) {
    report("type", "type", `unknown type \`${type}\`; the vocabulary is ${TYPES.join(", ")}`, (/** @type {(k: string) => number | undefined} */ (ctx.line))("type"));
    return;
  }
  ctx.type = type;
  // A Bug draft lives at `bugs/<bg_key>-<slug>.md`, and nothing else does.
  const rel = String(file.rel ?? "");
  if (type === "bug" && !/^bugs\/[^/]+\.md$/.test(rel)) {
    report("invalid", "file", "a `type: bug` file lives at `bugs/<bg_key>-<slug>.md`", file.frontmatterLine);
  }
  // An Observation is named by its file (`<date>-<slug>.md`), not by a key (ADR-0016).
  if (data.key === undefined && !["observation", "execution"].includes(type)) report("required", "key", "missing `key`", file.frontmatterLine);

  if (type === "train") {
    const shared = data.key === CATEGORIES_TRAIN_KEY ? ["retired"] : [];
    const own = canonicalTrainKey(data.key) === CODEFIX_TRAIN_KEY ? ["fix_attempts", "flaky_repeats", "pr"] : data.key === EXECUTE_TRAIN_KEY ? ["setup_role", "automation_retries"] : data.key === CODEGEN_TRAIN_KEY ? ["pr", "trained_stacks", "codegen_repeats", "codegen_attempts"] : [];
    for (const k of Object.keys(data)) {
      if (!KNOWN.train.includes(k) && !shared.includes(k) && !own.includes(k)) report("invalid", k, "a train file's frontmatter holds `type` and `key` only (execute also allows `setup_role` and `automation_retries`; codegen also allows `pr`, `trained_stacks`, `codegen_repeats` and `codegen_attempts`; codefix also allows `fix_attempts`, `flaky_repeats` and `pr`; categories also allows `retired`)", (/** @type {(k: string) => number | undefined} */ (ctx.line))(k));
    }
  } else if (!["observation", "execution", "bug"].includes(type)) {
    for (const k of Object.keys(data)) {
      if (!KNOWN[type].includes(k) && !(type === "scenario" && k === "level")) warn("unknown_key", k, `unknown key \`${k}\`; preserved`, (/** @type {(k: string) => number | undefined} */ (ctx.line))(k));
    }
  }

  CHECKS[type](data, file, ctx);
}

const WITHHELD_PROBLEM = "the problem on this line is withheld: its message would repeat what looks like a credential";

/**
 * @param {string} code
 * @param {string | undefined} field
 * @param {string} message
 * @param {number | null} [line]
 * @returns {CheckProblem}
 */
function problem(code, field, message, line) {
  const p = /** @type {CheckProblem} */ ({ code });
  if (field !== undefined) p.field = field;
  if (line !== undefined) p.line = line;
  p.message = message;
  return p;
}

/**
 * @param {{ errors: CheckProblem[], warnings: CheckProblem[] }} out
 * @param {string | null} type
 * @returns {CheckResult}
 */
function finish(out, type) {
  /** @param {CheckProblem} a @param {CheckProblem} b */
  const byLine = (a, b) => (a.line ?? 0) - (b.line ?? 0);
  return { type, ok: out.errors.length === 0, errors: out.errors.sort(byLine), warnings: out.warnings.sort(byLine) };
}

// ---------------------------------------------------------------------------------------------
// Value checks. Each takes the value, a dotted field name for reports, and the line to cite.

/**
 * @param {unknown} v
 * @returns {v is string}
 */
const nonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

/**
 * @param {unknown} v
 * @returns {v is string}
 */
function isDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * @param {CheckContext} ctx
 * @param {unknown} v
 * @param {string} field
 * @param {number | undefined} line
 * @returns {void}
 */
function checkDate(ctx, v, field, line) {
  if (!isDate(v)) ctx.report("date", field, `\`${field}\` is not an ISO YYYY-MM-DD date: ${v}`, line);
}

// A date, or an ISO date-time with an offset (the form an Execution record's `executed_at` takes).
/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isDateOrDateTime(v) {
  return isDate(v) || (typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
    isDate(v.slice(0, 10)) && Number.isFinite(Date.parse(v)));
}

/**
 * @param {CheckContext} ctx
 * @param {unknown} v
 * @param {string} field
 * @param {number | undefined} line
 * @returns {v is Record<string, unknown>}
 */
function checkMap(ctx, v, field, line) {
  if (isMap(v)) return true;
  ctx.report("shape", field, `\`${field}\` must be a map`, line);
  return false;
}

/**
 * @param {CheckContext} ctx
 * @param {unknown} v
 * @param {string} field
 * @param {number | undefined} line
 * @returns {v is unknown[]}
 */
function checkList(ctx, v, field, line) {
  if (Array.isArray(v)) return true;
  ctx.report("shape", field, `\`${field}\` must be a list`, line);
  return false;
}

// A list whose every item matches `test`, reported as a `pattern` error per bad item.
/**
 * @param {CheckContext} ctx
 * @param {unknown} v
 * @param {string} field
 * @param {number | undefined} line
 * @param {(item: unknown) => boolean} test
 * @param {string} kind
 * @returns {void}
 */
function checkKeyList(ctx, v, field, line, test, kind) {
  if (!checkList(ctx, v, field, line)) return;
  for (const item of v) {
    if (!test(item)) ctx.report("pattern", field, `\`${field}\` entry \`${item}\` is not a ${kind}`, line);
  }
}

// A Feature file's own key: a human slug.
/**
 * @param {CheckContext} ctx
 * @param {Record<string, unknown>} d
 * @returns {void}
 */
function checkSlugKey(ctx, d) {
  if (d.key !== undefined && (typeof d.key !== "string" || !PATTERN.slug.test(d.key))) {
    ctx.report("pattern", "key", `Feature key \`${d.key}\` is not a slug`, (/** @type {(k: string) => number | undefined} */ (ctx.line))("key"));
  }
}

// A Case or Scenario has one current Tracker key and a list of former Tracker keys.
/**
 * @param {CheckContext} ctx
 * @param {Record<string, unknown>} d
 * @param {(k: string) => string} field
 * @param {(k: string) => number | undefined} line
 * @returns {void}
 */
function checkTrackerFields(ctx, d, field, line) {
  if (!ctx.trackerPattern) {
    for (const k of ["tracker", "tracker_formerly"]) {
      if (d[k] !== undefined) ctx.report("invalid", field(k), `\`${k}\` needs a configured tracker`, line(k));
    }
    return;
  }
  if (d.tracker !== undefined && !isTrackerKey(d.tracker, ctx.trackerPattern)) {
    ctx.report("pattern", field("tracker"), "`tracker` must match `tracker.key_pattern`", line("tracker"));
  }
  if (d.tracker_formerly !== undefined) {
    checkKeyList(ctx, d.tracker_formerly, field("tracker_formerly"), line("tracker_formerly"),
      (k) => isTrackerKey(k, ctx.trackerPattern), "Tracker key");
  }
}

/**
 * @param {CheckContext} ctx
 * @param {Record<string, unknown>} obj
 * @param {readonly string[]} keys
 * @param {string} prefix
 * @param {number | null | undefined} line
 * @returns {void}
 */
function checkRequired(ctx, obj, keys, prefix, line) {
  for (const k of keys) {
    if (obj[k] === undefined) ctx.report("required", prefix ? `${prefix}.${k}` : k, `missing \`${prefix ? `${prefix}.${k}` : k}\``, line);
  }
}

/**
 * @param {CheckContext} ctx
 * @param {unknown} v
 * @param {string} field
 * @param {number | undefined} line
 * @returns {void}
 */
function checkGenerated(ctx, v, field, line) {
  if (!checkMap(ctx, v, field, line)) return;
  checkRequired(ctx, v, ["by", "at"], field, line);
  if (v.by !== undefined && !nonEmptyString(v.by)) ctx.report("shape", `${field}.by`, `\`${field}.by\` must be an actor`, line);
  if (v.at !== undefined) checkDate(ctx, v.at, `${field}.at`, line);
}

/**
 * @param {CheckContext} ctx
 * @param {unknown} v
 * @param {"case" | "scenario" | "feature"} kind
 * @param {string} field
 * @param {number | undefined} line
 * @returns {void}
 */
function checkMirror(ctx, v, kind, field, line) {
  if (!checkMap(ctx, v, field, line)) return;
  // Publish records a Feature's Suite; existing group Mirrors remain valid.
  const fields = kind === "feature" && v.suite !== undefined ? ["suite", ...(v.group !== undefined ? ["group"] : [])] : MIRROR_FIELDS[kind];
  checkRequired(ctx, v, [...fields, "at"], field, line);
  const optional = MIRROR_OPTIONAL[kind] ?? [];
  if (v.at !== undefined) checkDate(ctx, v.at, `${field}.at`, line);
  for (const k of fields) {
    const x = v[k];
    if (x === undefined || x === null) continue;
    const list = MIRROR_LISTS.includes(k);
    if (list ? !Array.isArray(x) || (/** @type {unknown[]} */ (x)).some((r) => typeof r !== "string") : typeof x !== "string") {
      ctx.report("shape", `${field}.${k}`, `\`${field}.${k}\` must be ${list ? "a list of strings" : "a string"} or null`, line);
    }
  }
  for (const k of optional) {
    if (v[k] === undefined || v[k] === null) continue;
    const prose = MIRROR_PROSE.includes(k) || k === "tags";
    if (prose ? !Array.isArray(v[k]) || (/** @type {unknown[]} */ (v[k])).some((x) => typeof x !== "string") : typeof v[k] !== "string") ctx.report("shape", `${field}.${k}`, `\`${field}.${k}\` must be ${prose ? "a list of strings" : "a string"} or null`, line);
  }
  for (const k of Object.keys(v)) {
    if (!fields.includes(k) && !optional.includes(k) && k !== "at") ctx.warn("unknown_key", `${field}.${k}`, `unknown key \`${field}.${k}\`; preserved`, line);
  }
}

/**
 * @param {CheckContext} ctx
 * @param {unknown} v
 * @param {string} field
 * @param {number | undefined} line
 * @param {readonly string[]} [extra]
 * @returns {void}
 */
function checkStamp(ctx, v, field, line, extra = []) {
  if (!checkMap(ctx, v, field, line)) return;
  checkRequired(ctx, v, ["by", "at", "commit"], field, line);
  if (v.at !== undefined) checkDate(ctx, v.at, `${field}.at`, line);
  if (v.digest !== undefined) checkDigest(ctx, v.digest, `${field}.digest`, line);
  if (v.migrated !== undefined && (v.migrated !== LEVEL_ON_CASE_SCHEMA_VERSION || v.digest === undefined)) ctx.report("invalid", `${field}.migrated`, "a migrated pin requires schema 4 and its carried digest", line);
  for (const k of Object.keys(v)) {
    if (![...["by", "at", "commit", "digest", "migrated"], ...extra].includes(k)) ctx.warn("unknown_key", `${field}.${k}`, `unknown key \`${field}.${k}\`; preserved`, line);
  }
}

// A pin's content digest (ADR-0033): the hex the CLI writes beside the commit it locates.
/**
 * @param {CheckContext} ctx
 * @param {unknown} v
 * @param {string} field
 * @param {number | undefined} line
 * @returns {void}
 */
function checkDigest(ctx, v, field, line) {
  if (typeof v !== "string" || !/^[0-9a-f]{16}$/.test(v)) ctx.report("shape", field, `\`${field}\` must be the 16-hex-digit digest the CLI writes`, line);
}

// A finding list: on a case, or (with `featureLevel`) the Feature's unattached findings.
/**
 * @param {CheckContext} ctx
 * @param {unknown} v
 * @param {string} field
 * @param {number | undefined} line
 * @param {boolean} featureLevel
 * @returns {void}
 */
function checkFindings(ctx, v, field, line, featureLevel) {
  if (!checkList(ctx, v, field, line)) return;
  for (const f of v) {
    if (!checkMap(ctx, f, field, line)) continue;
    // A Feature-level Overreach (ADR-0039) rests on a Rule, its subject; every other Feature-level
    // finding rests on a tracker subject.
    const rule = featureLevel && f.kind === "Overreach";
    const required = rule ? ["kind", "rule", "at_commit", "evidence"] : featureLevel ? ["kind", "subject_kind", "subject_key", "at_commit", "evidence"] : ["kind", "at_commit", "evidence"];
    checkRequired(ctx, f, required, field, line);
    if (f.kind !== undefined && !FINDING_KINDS.includes(/** @type {string} */ (f.kind))) {
      ctx.report("invalid", `${field}.kind`, `finding kind \`${f.kind}\` is not one of ${FINDING_KINDS.join(", ")}`, line);
    }
    if (rule && f.rule !== undefined && !PATTERN.rule.test(String(f.rule))) {
      ctx.report("pattern", `${field}.rule`, `\`${field}.rule\` must be a Rule key`, line);
    }
    if (featureLevel && !rule && f.subject_kind !== undefined && !SUBJECT_KINDS.includes(/** @type {string} */ (f.subject_kind))) {
      ctx.report("invalid", `${field}.subject_kind`, `subject_kind \`${f.subject_kind}\` is not one of ${SUBJECT_KINDS.join(", ")}`, line);
    }
    if (f.at_digest !== undefined) checkDigest(ctx, f.at_digest, `${field}.at_digest`, line);
    // A Stale the Scan stored with its cause (ADR-0043): the Watermark commit it was taken from,
    // the Rules that caused it, the Affected Rules it reaches, and the digest that identifies it.
    if (f.baseline !== undefined && (typeof f.baseline !== "string" || f.baseline === "")) {
      ctx.report("shape", `${field}.baseline`, `\`${field}.baseline\` must be the commit the Stale was taken from`, line);
    }
    for (const list of ["causes", "affects"]) {
      if (f[list] !== undefined) checkKeyList(ctx, f[list], `${field}.${list}`, line, (k) => typeof k === "string" && isRuleRef(k), "Rule reference");
    }
    if (f.cause_digest !== undefined) checkDigest(ctx, f.cause_digest, `${field}.cause_digest`, line);
    if (f.dismissed !== undefined) checkStamp(ctx, f.dismissed, `${field}.dismissed`, line, ["reason", "ticket"]);
    if (f.dismissed_case !== undefined && !isLiveCaseKey(f.dismissed_case)) {
      ctx.report("pattern", `${field}.dismissed_case`, "`dismissed_case` must be a minted Case Key", line);
    }
  }
}

// The declared keys of one file, reporting any declared twice.
/**
 * @param {CheckContext} ctx
 * @returns {(key: string, field: string, line: number | undefined) => void}
 */
function keyRegistry(ctx) {
  /** @type {Map<string, number | undefined>} */
  const seen = new Map();
  return (key, field, line) => {
    if (seen.has(key)) ctx.report("duplicate", field, `key \`${key}\` is declared twice in this file (also line ${seen.get(key)})`, line);
    else seen.set(key, line);
  };
}

// The `### ` headings of a file, each with the parsed entry it heads in `list` (a keyed heading
// whose kind the parser recognised), or null.
/**
 * @param {ParsedFile} file
 * @param {ParsedEntry[]} list
 * @returns {Array<ParsedSection & { entry: ParsedEntry | null }>}
 */
const entryHeadings = (file, list) =>
  (/** @type {ParsedSection[]} */ (file.sections)).filter((s) => s.level === 3).map((s) => ({ ...s, entry: list.find((e) => e.line === s.line) ?? null }));

// ---------------------------------------------------------------------------------------------
// Per-type checks.

/** @type {Record<string, (d: Record<string, unknown>, file: ParsedFile, ctx: CheckContext) => void>} */
const CHECKS = { project: checkProject, feature: checkFeature, scenario: checkScenario, train: checkTrain, observation: checkObservation, execution: checkExecutionFields, bug: checkBug };

/**
 * A Bug draft's closed frontmatter (ADR-0026's outward write, drafted locally first). `record` is
 * required except on a standalone `fix-handoff`: a chained one carries the Automation it was handed
 * off from, so only a draft with no Automation at all may omit the record. `tracker` and
 * `published_at` belong to a published draft only.
 * @param {Record<string, unknown>} d
 * @param {ParsedFile} _file
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkBug(d, _file, ctx) {
  const L = /** @type {(k: string) => number | undefined} */ (ctx.line);
  for (const k of Object.keys(d)) {
    if (!KNOWN.bug.includes(k)) ctx.report("invalid", k, "unknown Bug draft field", L(k));
  }
  checkRequired(ctx, d, ["status", "case", "feature", "case_digest", "run", "commit", "drafted_at", "route", "target"], "", ctx.fmLine);
  const standaloneHandoff = d.route === "fix-handoff" && (d.automations === undefined || (Array.isArray(d.automations) && d.automations.length === 0));
  if (!standaloneHandoff) checkRequired(ctx, d, ["record"], "", ctx.fmLine);
  if (d.key !== undefined && !(typeof d.key === "string" && PATTERN.bug.test(d.key))) ctx.report("pattern", "key", "`key` must be a `bg_` Bug draft Key", L("key"));
  if (d.status !== undefined && !(typeof d.status === "string" && BUG_STATUSES.includes(d.status))) ctx.report("invalid", "status", "`status` is draft or published", L("status"));
  if (d.case !== undefined && !isLiveCaseKey(d.case)) ctx.report("pattern", "case", "`case` must be a minted Case Key", L("case"));
  if (d.feature !== undefined && !(typeof d.feature === "string" && PATTERN.slug.test(d.feature))) ctx.report("pattern", "feature", "`feature` must be a Feature key", L("feature"));
  if (d.case_digest !== undefined) checkDigest(ctx, d.case_digest, "case_digest", L("case_digest"));
  if (d.run !== undefined && !(typeof d.run === "string" && /^[0-9a-hjkmnp-tv-z]{8}$/.test(d.run))) ctx.report("pattern", "run", "`run` must be eight lowercase Crockford characters", L("run"));
  if (d.commit !== undefined && !(typeof d.commit === "string" && /^[a-f0-9]{6,64}$/i.test(d.commit))) ctx.report("pattern", "commit", "`commit` must be hexadecimal", L("commit"));
  if (d.drafted_at !== undefined && !isDateOrDateTime(d.drafted_at)) ctx.report("date", "drafted_at", "`drafted_at` must be an ISO date or date-time with an offset", L("drafted_at"));
  if (d.route !== undefined && !(typeof d.route === "string" && BUG_ROUTES.includes(d.route))) ctx.report("invalid", "route", `\`route\` is one of ${BUG_ROUTES.join(", ")}`, L("route"));
  if (d.target !== undefined && !(typeof d.target === "string" && PATTERN.slug.test(d.target))) ctx.report("pattern", "target", "`target` must be a slug", L("target"));
  if (d.record !== undefined) {
    const m = typeof d.record === "string" ? /^executions\/\d{4}-\d{2}-\d{2}-([0-9a-hjkmnp-tv-z]{8})\.md$/.exec(d.record) : null;
    if (!m) ctx.report("invalid", "record", "`record` is the Run's `executions/<date>-<run>.md`", L("record"));
    else if (typeof d.run === "string" && m[1] !== d.run) ctx.report("invalid", "record", "`record` names this Run's id", L("record"));
  }
  if (d.roles !== undefined && !stringList(d.roles)) ctx.report("shape", "roles", "`roles` is a list of Role names", L("roles"));
  if (d.automations !== undefined) {
    const pattern = ctx.autPattern ?? PATTERN.aut;
    checkKeyList(ctx, d.automations, "automations", L("automations"), (k) => typeof k === "string" && pattern.test(k), "Automation key");
  }
  if (d.redacted !== undefined && d.redacted !== true) ctx.report("invalid", "redacted", "`redacted` is written only as `true`", L("redacted"));
  if (d.status === "draft") {
    for (const k of ["tracker", "published_at"]) {
      if (d[k] !== undefined) ctx.report("invalid", k, `a draft holds no \`${k}\`; publish writes it`, L(k));
    }
  }
  if (d.status === "published") {
    checkRequired(ctx, d, ["tracker", "published_at"], "", ctx.fmLine);
    if (d.tracker !== undefined && !nonEmptyString(d.tracker)) ctx.report("shape", "tracker", "`tracker` must be a non-empty Tracker key", L("tracker"));
    else if (d.tracker !== undefined && ctx.trackerPattern && !isTrackerKey(d.tracker, ctx.trackerPattern)) ctx.report("pattern", "tracker", "`tracker` must match `tracker.key_pattern`", L("tracker"));
    if (d.published_at !== undefined && !isDateOrDateTime(d.published_at)) ctx.report("date", "published_at", "`published_at` must be an ISO date or date-time with an offset", L("published_at"));
  }
}

// Execution history has no dependency on today's project configuration.
/**
 * @param {ParsedFile} file
 * @returns {CheckResult}
 */
export function checkExecution(file) {
  return checkFile(file, {});
}

/**
 * @param {Record<string, unknown>} d
 * @param {ParsedFile} file
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkExecutionFields(d, file, ctx) {
  const L = /** @type {(k: string) => number | undefined} */ (ctx.line);
  for (const k of Object.keys(d)) {
    if (!KNOWN.execution.includes(k)) ctx.report("invalid", k, "unknown Execution record field", L(k));
  }
  // `playwright_cli` records the Tester's driver; a Run whose cases hold Automation evidence only
  // never ran one, so it is optional then and still required as soon as an Execution result exists.
  const executed = (/** @type {ParsedEntry[]} */ (file.executions ?? [])).some((entry) => entry.data?.result !== undefined);
  checkRequired(ctx, d, ["run", "executed_at", "target", "url", "commit", ...(executed ? ["playwright_cli"] : [])], "", ctx.fmLine);
  const selection = d.selection;
  const parts = ["scope", "tags", "levels"];
  if (selection !== undefined && (!isMap(selection) || Object.keys(selection).some((k) => !parts.includes(k)) ||
      !parts.every((k) => Array.isArray(selection[k]) && selection[k].every((/** @type {unknown} */ v) => typeof v === "string")))) {
    ctx.report("shape", "selection", "`selection` must hold scope, tags and levels string lists", L("selection"));
  }
  if (d.run !== undefined && !(typeof d.run === "string" && /^[0-9a-hjkmnp-tv-z]{8}$/.test(d.run))) {
    ctx.report("pattern", "run", "`run` must be eight lowercase Crockford characters", L("run"));
  }
  const dateTime = typeof d.executed_at === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(d.executed_at) &&
    isDate(d.executed_at.slice(0, 10)) && Number.isFinite(Date.parse(d.executed_at));
  if (d.executed_at !== undefined && !dateTime) ctx.report("date", "executed_at", "`executed_at` must be an ISO date-time with an offset", L("executed_at"));
  if (file.rel !== `executions/${String(d.executed_at).slice(0, 10)}-${d.run}.md`) {
    ctx.report("invalid", "file", "an Execution record lives at `executions/<executed_at date>-<run>.md`", ctx.fmLine);
  }
  if (d.target !== undefined && !(typeof d.target === "string" && PATTERN.slug.test(d.target))) ctx.report("pattern", "target", "`target` must be a slug", L("target"));
  if (d.url !== undefined) {
    let origin;
    try {
      const u = new URL(/** @type {string} */ (d.url));
      if (["http:", "https:"].includes(u.protocol)) origin = u.origin;
    } catch { /* The local error below never repeats the URL. */ }
    if (d.url !== origin) ctx.report("invalid", "url", "`url` must be an http(s) origin only", L("url"));
  }
  if (d.commit !== undefined && !/^[a-f0-9]+$/i.test(String(d.commit))) ctx.report("pattern", "commit", "`commit` must be hexadecimal", L("commit"));
  if (d.playwright_cli !== undefined && !(typeof d.playwright_cli === "string" && /^\d+\.\d+\.\d+$/.test(d.playwright_cli))) {
    ctx.report("pattern", "playwright_cli", "`playwright_cli` must be a version string", L("playwright_cli"));
  }
  /** @type {Set<string>} */
  const keys = new Set();
  /**
   * @param {string} key
   * @param {number | undefined} line
   */
  const declare = (key, line) => {
    if (keys.has(key)) ctx.report("duplicate", "key", "a Key occurs more than once in the record", line);
    keys.add(key);
  };
  if (d.skipped !== undefined) {
    const order = ["level", "conflict", "no-steps", "no-expected"];
    if (!Array.isArray(d.skipped)) ctx.report("shape", "skipped", "`skipped` must be a list", L("skipped"));
    else for (const s of d.skipped) {
      if (!isMap(s) || Object.keys(s).some((k) => !["key", "reasons"].includes(k)) || !nonEmptyString(s.key) ||
          !Array.isArray(s.reasons) || s.reasons.length === 0 ||
          !(/** @type {string[]} */ (s.reasons)).every((r, i) => order.includes(r) && (i === 0 || order.indexOf(r) > order.indexOf((/** @type {string[]} */ (s.reasons))[i - 1])))) {
        ctx.report("invalid", "skipped", "a skip holds `key` and non-empty reasons in level, conflict, no-steps, no-expected order", L("skipped"));
      }
      if (isMap(s)) declare(/** @type {string} */ (s.key), L("skipped"));
    }
  }
  if (!(/** @type {ParsedEntry[]} */ (file.executions)).length) ctx.report("required", "execution", "an Execution record needs at least one Execution block", ctx.fmLine);
  for (const h of /** @type {ParsedSection[]} */ (file.sections)) {
    if (h.level !== 3 && h.line > (/** @type {ParsedEntry[]} */ (file.executions))[0]?.line) ctx.report("invalid", "execution", "Execution blocks take no extra headings", h.line);
  }
  for (const h of entryHeadings(file, /** @type {ParsedEntry[]} */ (file.executions))) {
    if (!h.entry) ctx.report("heading", "execution", "an Execution heading is `### <Key>: <summary>`", h.line);
    else {
      declare(h.entry.key, h.line);
      checkExecutionEntry(ctx, h.entry);
    }
  }
}

/**
 * The closed vocabulary of reasons a scenario execution may be blocked.
 * @type {readonly string[]}
 */
export const BLOCKED_REASONS = ["no-access", "unreachable", "precondition", "step", "ambiguous-actor", "action-cap", "off-target", "connection-lost"];
/**
 * The reasons a Tester report may carry: every Blocked reason except `unreachable`, which only the
 * CLI sets before dispatch. A guard-only reason is still checked against the guard's stop.
 * @type {readonly string[]}
 */
export const TESTER_REASONS = BLOCKED_REASONS.filter((reason) => reason !== "unreachable");
/**
 * @param {unknown} v
 * @returns {v is number}
 */
const integer = (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0;
/**
 * @param {unknown} v
 * @returns {v is string[]}
 */
const stringList = (v) => Array.isArray(v) && v.every(nonEmptyString);

/**
 * The `automation:` list of one case block: one entry per Automation the Run ran for that
 * case, each a closed set. A shared Automation appears in every case block it covers, so an id is
 * unique only within its block.
 * @param {CheckContext} ctx
 * @param {Record<string, unknown>} d
 * @param {ParsedEntry} e
 * @returns {void}
 */
function checkAutomation(ctx, d, e) {
  if (d.automation === undefined) return;
  const field = `${e.key}.automation`;
  const at = e.keyLines.automation ?? e.blockLine;
  /** @param {string} message */
  const invalid = (message) => ctx.report("invalid", field, message, at);
  if (!Array.isArray(d.automation) || d.automation.length === 0) return invalid("`automation` is a non-empty list of Automation results");
  const ids = new Set();
  const keys = ["id", "stack", "selector", "result", "reason", "attempts", "diagnostics", "target"];
  for (const entry of d.automation) {
    if (!isMap(entry) || Object.keys(entry).some((k) => !keys.includes(k))) {
      invalid(`an Automation entry holds ${keys.join(", ")}`);
      continue;
    }
    if (!nonEmptyString(entry.id) || !nonEmptyString(entry.stack) || !nonEmptyString(entry.selector)) {
      invalid("an Automation entry holds a non-empty id, stack and selector");
      continue;
    }
    if (ids.has(entry.id)) {
      invalid("an Automation id occurs once in a case block");
      continue;
    }
    ids.add(entry.id);
    if (!AUTOMATION_RESULTS.includes(String(entry.result))) {
      invalid("`result` is passed, failed, flaky or blocked");
      continue;
    }
    if (entry.result === "blocked") {
      if (!AUTOMATION_BLOCKED_REASONS.includes(String(entry.reason))) {
        invalid("a Blocked Automation needs one of the closed reasons");
        continue;
      }
    } else if (entry.reason !== undefined) {
      invalid("`reason` appears only on a Blocked Automation");
      continue;
    }
    if (!Array.isArray(entry.attempts) || entry.attempts.length === 0 || !entry.attempts.every((a) => typeof a === "string" && AUTOMATION_ATTEMPT.test(a))) {
      invalid("`attempts` holds ordered passed, failed or blocked:<reason> attempts");
      continue;
    }
    if (entry.diagnostics !== undefined && (!Array.isArray(entry.diagnostics) || entry.diagnostics.length < 1 || entry.diagnostics.length > AUTOMATION_DIAGNOSTICS_MAX ||
        !entry.diagnostics.every((s) => typeof s === "string" && s.length > 0 && s.length <= AUTOMATION_DIAGNOSTIC_CAP))) {
      invalid(`diagnostics holds 1–${AUTOMATION_DIAGNOSTICS_MAX} non-empty strings of at most ${AUTOMATION_DIAGNOSTIC_CAP} characters`);
      continue;
    }
    if (entry.target !== undefined && entry.target !== "own") invalid("`target` is `own` when the tests chose their own base URL");
  }
}

/**
 * @param {CheckContext} ctx
 * @param {ParsedEntry} e
 * @returns {void}
 */
function checkExecutionEntry(ctx, e) {
  if (!e.blockLine) return ctx.report("required", e.key, "an Execution needs a `yaml` block after its heading", e.line);
  const d = e.data;
  const f = (/** @type {string} */ k) => `${e.key}.${k}`;
  const at = (/** @type {string} */ k) => e.keyLines[k] ?? e.blockLine;
  const bad = (/** @type {string} */ code, /** @type {string} */ k, /** @type {string} */ message) => ctx.report(code, f(k), message, at(k));
  checkRequired(ctx, d, ["key", "feature", "digest", "review", ...(d.result !== undefined || d.automation === undefined ? ["result", "roles", "access", "reached", "actions"] : [])], e.key, e.blockLine);
  for (const k of Object.keys(d)) if (!KNOWN.execution_case.includes(k)) bad("invalid", k, "unknown Execution field");
  if (d.key !== undefined && d.key !== e.key) bad("heading", "key", "the Execution heading and block keys must agree");
  if (d.result === undefined) {
    for (const k of ["roles", "access", "reached", "actions"]) {
      if (d[k] !== undefined) bad("invalid", k, "an Execution field appears only when an Execution followed");
    }
  }
  checkAutomation(ctx, d, e);
  if (d.execution_skipped !== undefined) {
    const list = d.execution_skipped;
    const valid = Array.isArray(list) && list.length > 0 &&
      list.every((r, i) => typeof r === "string" && EXECUTION_SKIPPED.includes(r) &&
        (i === 0 || EXECUTION_SKIPPED.indexOf(r) > EXECUTION_SKIPPED.indexOf(/** @type {string} */ (list[i - 1]))));
    if (!valid) bad("invalid", "execution_skipped", "`execution_skipped` holds no-steps, no-expected or not-run, once each, in that order");
    else if (d.result !== undefined) bad("invalid", "execution_skipped", "`execution_skipped` appears only when no Execution result is recorded");
  }
  if (d.feature !== undefined && !(typeof d.feature === "string" && PATTERN.slug.test(d.feature))) bad("pattern", "feature", "`feature` must be a slug");
  if (d.tracker !== undefined && !nonEmptyString(d.tracker)) bad("shape", "tracker", "`tracker` must be a non-empty string");
  if (d.result !== undefined && !["passed", "failed", "blocked"].includes(/** @type {string} */ (d.result))) bad("invalid", "result", "`result` must be passed, failed or blocked");
  if (d.result === "blocked" && d.reason === undefined) bad("required", "reason", "a Blocked Execution needs a reason");
  if (d.reason !== undefined && (d.result !== "blocked" || !BLOCKED_REASONS.includes(/** @type {string} */ (d.reason)))) bad("invalid", "reason", "`reason` is one of the Blocked reasons, only on a Blocked Execution");
  if (d.digest !== undefined) checkDigest(ctx, d.digest, f("digest"), at("digest"));
  if (d.review !== undefined && !["fresh", "void", "none"].includes(/** @type {string} */ (d.review))) bad("invalid", "review", "`review` must be fresh, void or none");
  for (const k of ["dirty", "stale", "at_login", "redacted"]) if (d[k] !== undefined && d[k] !== true) bad("invalid", k, "a flag must be true when present");
  for (const k of ["roles", "access", "created"]) {
    if (d[k] !== undefined && !stringList(d[k])) bad("shape", k, "a list of non-empty strings is required");
  }
  if (Array.isArray(d.access) && d.access.some((k) => typeof k !== "string" || !PATTERN.acc.test(k))) bad("pattern", "access", "`access` items must be Access note keys");
  if (d.reached !== undefined && !integer(d.reached)) bad("shape", "reached", "`reached` must be an integer at least zero");
  else if ((["unreachable", "precondition"].includes(/** @type {string} */ (d.reason)) && d.reached !== 0) ||
      ((["passed", "failed"].includes(/** @type {string} */ (d.result)) || d.reason === "ambiguous-actor") && /** @type {number} */ (d.reached) < 1)) {
    bad("invalid", "reached", "`reached` must be zero for unreachable/precondition and positive for passed/failed/ambiguous-actor");
  }
  if (d.actions !== undefined) {
    const a = /** @type {Record<string, unknown>} */ (d.actions);
    if (!isMap(a) || Object.keys(a).some((k) => !["used", "cap"].includes(k)) || !integer(a.used) || !integer(a.cap) || a.cap < 1 || a.used > a.cap) {
      bad("shape", "actions", "`actions` holds integer used and cap with 0 ≤ used ≤ cap and cap ≥ 1");
    } else if (d.reason === "action-cap" && a.used !== a.cap) bad("invalid", "actions", "an action-cap stop requires used === cap");
    else if (["passed", "failed"].includes(/** @type {string} */ (d.result)) && a.used < 1) bad("invalid", "actions", "a Passed or Failed Execution used at least one action");
  }
  if (d.preconditions !== undefined) {
    let unmet = false;
    const valid = Array.isArray(d.preconditions) && d.preconditions.every((p) => {
      if (!isMap(p) || Object.keys(p).some((k) => !["text", "status", "how"].includes(k)) || !nonEmptyString(p.text) ||
          !["established", "checked", "unmet", "skipped"].includes(/** @type {string} */ (p.status)) || (p.how !== undefined && !nonEmptyString(p.how)) ||
          (unmet && p.status !== "skipped")) return false;
      if (p.status === "unmet") unmet = true;
      return true;
    });
    if (!valid) bad("invalid", "preconditions", "preconditions hold text, status and optional how; every item after unmet must be skipped");
  }
  if (d.interpretations !== undefined && (!Array.isArray(d.interpretations) || d.interpretations.length < 1 || d.interpretations.length > 5 ||
      !(/** @type {unknown[]} */ (d.interpretations)).every((s) => typeof s === "string" && s.length <= 200 && /^(?:setup|step [1-9]\d*|expected): (?:.+ → .+|.+…)$/.test(s)))) {
    bad("invalid", "interpretations", "interpretations hold 1–5 strings of at most 200 characters: setup, step N or expected: question → action");
  }
  checkExecutionProse(ctx, e);
}

/**
 * @param {CheckContext} ctx
 * @param {ParsedEntry} e
 * @returns {void}
 */
function checkExecutionProse(ctx, e) {
  const d = e.data;
  const report = (/** @type {string} */ code, /** @type {string} */ field, /** @type {string} */ message, line = e.blockEnd) => ctx.report(code, `${e.key}.${field}`, message, /** @type {number | undefined} */ (line));
  if ((/** @type {Array<{ line: number, text: string }>} */ (e.prose)).some((p) => p.line < (/** @type {number} */ (e.blockLine)) && p.text.trim())) report("invalid", "prose", "the YAML block must immediately follow the Execution heading");
  const required = d.result === "failed" ? ["Expected", "Seen"] : d.result === "blocked" ? ["Why"] : [];
  const order = [...required, "Evidence", "Trace"];
  const fences = (/** @type {Array<{ lang?: string, line: number, end: number }>} */ (ctx.file.fences)).filter((f) => f.line > (/** @type {number} */ (e.blockEnd)) && f.line <= (/** @type {number} */ (e.end)));
  const evidence = evidenceBlockOf(ctx.file, fences);
  /** @type {Map<string, { line: number, lines: string[] }>} */
  const sections = new Map();
  /** @type {{ line: number, lines: string[] } | undefined} */
  let current;
  let previous = -1;
  for (const { line, text } of /** @type {Array<{ line: number, text: string }>} */ (e.prose)) {
    if (evidence && line >= evidence.open && line <= evidence.close) {
      if (line === evidence.open && (!current || current !== sections.get("Trace"))) report("invalid", "evidence", "the Element evidence block comes right after the Trace", line);
      continue;
    }
    if (evidence && line > evidence.close && text.trim()) {
      report("invalid", "evidence", "nothing follows the Element evidence block", line);
      continue;
    }
    if (/^<\/?details\b/i.test(text)) {
      report("invalid", "prose", "Execution prose folds nothing but its one Element evidence block", line);
      continue;
    }
    if (!text.trim()) {
      if (current) current.lines.push("");
      continue;
    }
    const label = text.match(/^\*\*([^*]+)\.\*\*(?:\s+(.*))?$/);
    if (label) {
      const name = label[1];
      const index = order.indexOf(name);
      if (index === -1 || index <= previous) report("invalid", "prose", "Execution prose labels must match the result, once each, in order", line);
      previous = index;
      current = { line, lines: label[2] ? [label[2]] : [] };
      sections.set(name, current);
    } else if (current) current.lines.push(text);
    else report("invalid", "prose", "Execution prose must start with a result label", line);
  }
  if (fences.some((f) => f.line !== evidence?.fence) || (/** @type {ParsedSection[]} */ (ctx.file.sections)).some((s) => s.line > e.line && s.line <= (/** @type {number} */ (e.end)))) {
    report("invalid", "prose", "Execution prose takes no headings or fences");
  }
  for (const name of required) {
    if (!sections.get(name)?.lines.join("\n").trim()) report("required", name, `the result requires non-empty ${name} prose`);
  }
  for (const [name, cap] of [["Seen", 600], ["Why", 300], ["Evidence", 1000]]) {
    const section = sections.get(/** @type {string} */ (name));
    if (section && (!section.lines.join("\n").trim() || section.lines.join("\n").trim().length > (/** @type {number} */ (cap)))) report("invalid", /** @type {string} */ (name), `${name} must be non-empty and at most ${cap} characters`, section.line);
  }
  const trace = sections.get("Trace");
  const used = /** @type {number} */ ((/** @type {Record<string, unknown> | undefined} */ (d.actions))?.used);
  if (used > 0 && !trace) report("required", "Trace", "actions taken require a Trace");
  const items = trace ? trace.lines.filter((line) => line.trim()) : [];
  if (evidence) checkEvidenceBlock(ctx, e, evidence, items.length);
  if (!trace) return;
  if (!(used > 0) || items.length < 1 || items.length > used || !items.every((line, i) => {
    const item = line.match(/^(\d+)\. `([^`]+)`$/);
    return item && Number(item[1]) === i + 1 &&
      /^.+ (?:do [a-z-]+(?: .+)?|request [A-Z]+ \S+) → \S.*$/.test(item[2]) &&
      !/--(?:query|header|json)\b/.test(item[2]);
  })) report("invalid", "Trace", "Trace numbers 1 to used command code spans, only when used is positive", trace.line);
}

/**
 * An Execution's folded Element evidence block: `open` and `close` its `<details>` lines, `fence`
 * the `json` fence's opening line, and `json` the text inside the fence.
 * @typedef {{ open: number, close: number, fence: number, json: string }} EvidenceBlock
 */

// An Execution's one folded Element evidence block, when its prose holds a single `json` fence
// wrapped exactly as ingest writes it. Any other fence stays a fence the prose does not take.
/**
 * @param {ParsedFile} file
 * @param {Array<{ lang?: string, line: number, end: number }>} fences
 * @returns {EvidenceBlock | null}
 */
function evidenceBlockOf(file, fences) {
  if (fences.length !== 1 || fences[0].lang !== "json") return null;
  const { line, end } = fences[0];
  const lines = (/** @type {string} */ (file.text)).replace(/\r\n/g, "\n").split("\n");
  // 1-based line numbers: `lines[n - 1]` is line n.
  const wrapped = lines[line - 3] === EVIDENCE_SUMMARY && lines[line - 2] === "" && lines[line - 1] === "```json" && lines[end - 1] === "```" &&
    lines[end] === "" && lines[end + 1] === "</details>";
  return wrapped ? { open: line - 2, close: end + 2, fence: line, json: lines.slice(line, end - 1).join("\n") } : null;
}

// The evidence JSON: an object keyed by Trace numbers, each once and naming a shown Trace entry,
// each value the closed evidence shape. Every decoded string, keys included, meets the record's
// credential and URL bars, which the raw lines alone miss behind a JSON escape.
/**
 * @param {CheckContext} ctx
 * @param {ParsedEntry} e
 * @param {EvidenceBlock} block
 * @param {number} traced
 * @returns {void}
 */
function checkEvidenceBlock(ctx, e, block, traced) {
  const { json } = block;
  const invalid = (/** @type {string} */ message) => ctx.report("invalid", `${e.key}.evidence`, message, block.fence);
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return invalid("the Element evidence block must be JSON");
  }
  if (!isMap(parsed) || !Object.keys(parsed).length) return invalid("the Element evidence block is an object keyed by Trace numbers");
  const keys = objectKeys(json);
  if (new Set(keys).size !== keys.length) invalid("each Trace number keys the Element evidence once");
  if (!keys.every((k) => /^[1-9]\d*$/.test(k) && Number(k) <= traced)) invalid("Element evidence keys name Trace entries");
  if (!Object.values(parsed).every(isExecutionEvidence)) invalid("Element evidence holds aria, locator, excerpt and truncated, or target none");
  /** @type {string[]} */
  const strings = [];
  /** @param {unknown} v */
  const collect = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (isMap(v)) for (const [k, inner] of Object.entries(v)) {
      strings.push(k);
      collect(inner);
    }
  };
  collect(parsed);
  if (strings.some((s) => credentialIn(s))) ctx.report("secret", undefined, "Execution records never hold credentials", block.fence);
  if (strings.some((s) => URL_WITH_QUERY.test(s))) ctx.report("invalid", "url", "Execution URLs must have no query or fragment", block.fence);
}

// The decoded keys of a parsed JSON text's top-level object, in order and with any repeats, which
// `JSON.parse` would silently collapse. Only called once `JSON.parse` accepted the text, so every
// string closes.
/**
 * @param {string} json
 * @returns {string[]}
 */
function objectKeys(json) {
  /** @type {string[]} */
  const keys = [];
  let depth = 0;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
    else if (ch === '"') {
      const start = i;
      for (i += 1; json[i] !== '"'; i++) if (json[i] === "\\") i += 1;
      if (depth === 1 && /^\s*:/.test(json.slice(i + 1))) keys.push(/** @type {string} */ (JSON.parse(json.slice(start, i + 1))));
    }
  }
  return keys;
}

/**
 * Text validation stays pure; the working-tree reader supplies realpath containment when present.
 * @param {unknown} value
 * @param {string} field
 * @param {CheckContext} ctx
 * @param {number | undefined} line
 * @returns {void}
 */
function checkProjectPath(value, field, ctx, line) {
  if (typeof value !== "string" || !value.trim() || /^(?:\/|[A-Za-z]:)/.test(value) || /[\\\0]/.test(value) || value.split("/").includes("..") || (ctx.pathInsideRepo && !ctx.pathInsideRepo(value))) ctx.report("invalid", field, "project paths must be repo-relative without parent traversal or symlink escape", line);
}

// A tracker field's default value: a scalar, or a list of scalars, written as one field.
/**
 * @param {unknown} v
 * @returns {boolean}
 */
const isBugFieldScalar = (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/**
 * The tracker fields a `bug_fields` default may not set, because publish writes them itself.
 * @param {Record<string, unknown>} tracker
 * @returns {Set<string>}
 */
function reservedBugFields(tracker) {
  const reserved = ["labels", "summary", "description", "environment", "issuetype", "project", "status"];
  if (nonEmptyString(tracker.marker_field)) reserved.push(tracker.marker_field.trim().toLowerCase());
  return new Set(reserved);
}

// `bug_fields` (ADR-0025): a block list of `{field, value}` maps whose names may not repeat or take a
// field publish writes itself.
/**
 * @param {CheckContext} ctx
 * @param {unknown} fields
 * @param {Record<string, unknown>} tracker
 * @param {number | undefined} line
 * @returns {void}
 */
function checkBugFields(ctx, fields, tracker, line) {
  if (!Array.isArray(fields)) {
    ctx.report("shape", "bug_fields", "`bug_fields` must be a block list of `{field, value}` maps", line);
    return;
  }
  const reserved = reservedBugFields(tracker);
  const seen = new Set();
  for (const entry of fields) {
    if (!isMap(entry) || !nonEmptyString(entry.field) || !Object.hasOwn(entry, "value") || Object.keys(entry).some((k) => k !== "field" && k !== "value") || !(isBugFieldScalar(entry.value) || (Array.isArray(entry.value) && entry.value.every(isBugFieldScalar)))) {
      ctx.report("invalid", "bug_fields", "each `bug_fields` entry is a `{field, value}` map, its value a scalar or a list of scalars", line);
      continue;
    }
    const name = /** @type {string} */ (entry.field).trim().toLowerCase();
    if (seen.has(name)) ctx.report("duplicate", "bug_fields", `\`bug_fields\` repeats the field \`${name}\``, line);
    else if (reserved.has(name)) ctx.report("invalid", "bug_fields", `\`bug_fields\` may not set \`${name}\`: publish writes it itself`, line);
    seen.add(name);
  }
}

/**
 * @param {Record<string, unknown>} d
 * @param {ParsedFile} _file
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkProject(d, _file, ctx) {
  const L = /** @type {(k: string) => number | undefined} */ (ctx.line);
  for (const p of [...labelDefinitionProblems(d), ...publishDestinationProblems(d)]) ctx.report(p.code, p.field, p.message, L(p.field.split(".")[0]));
  if (d.key !== undefined && d.key !== "project") ctx.report("pattern", "key", "a project file's key is `project`", L("key"));
  checkRequired(ctx, d, ["stack", "annotation_map", "module_paths", "concurrency_cap"], "", ctx.fmLine);
  // `schema_version` is optional: a `project.md` without it being version 1; a newer one is scan's warning.
  if (d.schema_version !== undefined && !isSchemaVersion(d.schema_version)) {
    ctx.report("invalid", "schema_version", "`schema_version` must be an integer ≥ 1", L("schema_version"));
  }

  if (d.stack !== undefined && checkMap(ctx, d.stack, "stack", L("stack"))) {
    for (const k of ["language", "framework"]) {
      if (!nonEmptyString(d.stack[k])) ctx.report("required", `stack.${k}`, `\`stack.${k}\` must be non-empty`, L("stack"));
    }
    if (d.stack.root !== undefined) checkProjectPath(d.stack.root, "stack.root", ctx, L("stack"));
    const levels = d.stack.levels;
    if (!Array.isArray(levels) || levels.length === 0) {
      ctx.report("invalid", "stack.levels", "`stack.levels` must be a non-empty list", L("stack"));
    } else {
      for (const l of levels) {
        if (typeof l !== "string" || !PATTERN.slug.test(l)) ctx.report("pattern", "stack.levels", `level \`${l}\` is not a slug`, L("stack"));
      }
      if (new Set(levels).size !== levels.length) ctx.report("duplicate", "stack.levels", "`stack.levels` repeats a level", L("stack"));
    }
  }

  if (d.code_host !== undefined && checkMap(ctx, d.code_host, "code_host", L("code_host"))) {
    checkRequired(ctx, d.code_host, ["tool"], "code_host", L("code_host"));
    if (d.code_host.tool !== undefined && d.code_host.tool !== "gh" && d.code_host.tool !== "glab") ctx.report("invalid", "code_host.tool", "`code_host.tool` must be gh or glab", L("code_host"));
  }

  if (d.test_runner !== undefined && checkMap(ctx, d.test_runner, "test_runner", L("test_runner"))) {
    const r = d.test_runner;
    const text = JSON.stringify(r);
    if (secretsIn(r).length || credentialIn(text) || redactPairs(text) !== text) ctx.report("secret", "test_runner", "`test_runner` never holds credentials; use the runner's inherited environment", L("test_runner"));
    if (r.dir !== undefined) checkProjectPath(r.dir, "test_runner.dir", ctx, L("test_runner"));
    checkRequired(ctx, r, ["tool", "target_env"], "test_runner", L("test_runner"));
    if (r.tool !== undefined && !testRunnerMatchesStack(r.tool, isMap(d.stack) ? d.stack : null)) ctx.report("invalid", "test_runner.tool", "`test_runner.tool` must name a built-in runner matching the stack", L("test_runner"));
    if (r.task !== undefined && (r.tool !== "gradle" || !nonEmptyString(r.task))) ctx.report("invalid", "test_runner.task", "`test_runner.task` is a non-empty Gradle task, only for gradle", L("test_runner"));
    if (Array.isArray(r.args) && r.args.some((w) => typeof w === "string" && /^(?:--(?:output|reporter|add-reporter|test-list|grep|retries|tests|repeat-each|max-failures|workers|rerun)(?:=|$)|-g|-j|-x|-pl|-D(?:test|surefire\.rerunFailingTestsCount|maven\.test\.failure\.ignore)(?:=|$))/.test(w))) ctx.report("invalid", "test_runner.args", "`test_runner.args` cannot override CLI-managed flags", L("test_runner"));
    if (r.target_env !== undefined && (!Array.isArray(r.target_env) || r.target_env.some((name) => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /^(PATH|HOME|NODE_OPTIONS|JAVA_TOOL_OPTIONS|GRADLE_OPTS|MAVEN_OPTS)$|^PLAYWRIGHT_/.test(name)))) ctx.report("invalid", "test_runner.target_env", "`test_runner.target_env` must list environment names excluding reserved process controls", L("test_runner"));
    for (const field of ["launcher", "args"]) {
      const v = r[field];
      if (v !== undefined && (!Array.isArray(v) || (field === "launcher" && v.length === 0) || v.some((w) => typeof w !== "string" || w.includes("\0") || (field === "launcher" && !w.trim())))) ctx.report("invalid", `test_runner.${field}`, "runner argv must be a list of literal words; launcher must be non-empty", L("test_runner"));
    }
  }

  if (d.level_migrations !== undefined && checkMap(ctx, d.level_migrations, "level_migrations", L("level_migrations"))) {
    const levels = isMap(d.stack) && Array.isArray(d.stack.levels) ? d.stack.levels : [];
    for (const [from, to] of Object.entries(d.level_migrations)) {
      if (!PATTERN.slug.test(from) || !levels.includes(to)) ctx.report("invalid", `level_migrations.${from}`, "a migrated level must name a project level", L("level_migrations"));
    }
  }

  if (d.targets !== undefined && checkMap(ctx, d.targets, "targets", L("targets"))) {
    if (!Object.keys(d.targets).length) ctx.report("invalid", "targets", "`targets` must be a non-empty map", L("targets"));
    for (const [slug, value] of Object.entries(d.targets)) {
      const field = `targets.${slug}`;
      if (!PATTERN.slug.test(slug)) ctx.report("pattern", field, `target \`${slug}\` is not a slug`, L("targets"));
      let origin;
      try {
        const url = new URL(/** @type {string} */ (value));
        if (url.protocol === "http:" || url.protocol === "https:") origin = url.origin;
      } catch { /* An unparseable URL is reported below. */ }
      if (typeof value !== "string" || value !== origin) {
        ctx.report("invalid", field, `\`${field}\` must be an exact http or https origin, with no path, trailing slash, query, fragment or userinfo`, L("targets"));
      }
    }
  }

  if (d.execute_levels !== undefined && checkMap(ctx, d.execute_levels, "execute_levels", L("execute_levels"))) {
    if (!Object.keys(d.execute_levels).length) ctx.report("invalid", "execute_levels", "`execute_levels` must be a non-empty map", L("execute_levels"));
    const levels = isMap(d.stack) && Array.isArray(d.stack.levels) ? d.stack.levels : [];
    for (const [slug, mode] of Object.entries(d.execute_levels)) {
      const field = `execute_levels.${slug}`;
      if (!PATTERN.slug.test(slug)) ctx.report("pattern", field, `level \`${slug}\` is not a slug`, L("execute_levels"));
      if (!(/** @type {unknown[]} */ (levels)).includes(slug)) ctx.report("invalid", field, `\`${field}\` must name a level in \`stack.levels\``, L("execute_levels"));
      if (mode !== "browser" && mode !== "api") ctx.report("invalid", field, `\`${field}\` must be \`browser\` or \`api\``, L("execute_levels"));
    }
  }

  if (d.tracker !== undefined && checkMap(ctx, d.tracker, "tracker", L("tracker"))) {
    checkRequired(ctx, d.tracker, ["provider", "project", "key_pattern"], "tracker", L("tracker"));
    if (d.tracker.key_pattern !== undefined && !compileKeyPattern(/** @type {string} */ (d.tracker.key_pattern))) {
      ctx.report("invalid", "tracker.key_pattern", "`tracker.key_pattern` does not compile as a regular expression", L("tracker"));
    }
    // ADR-0026: optional publish group; issue_types is a non-empty list and remaining fields are non-empty strings when present.
    const it = d.tracker.issue_types;
    if (it !== undefined && (!Array.isArray(it) || it.length === 0)) {
      ctx.report("invalid", "tracker.issue_types", "`tracker.issue_types` must be a non-empty list", L("tracker"));
    }
    for (const f of ["suite_type", "scenario_type", "case_type", "link_type", "initial_status", "marker_label", "marker_field", "retire_transition", "tag_field"]) {
      const v = d.tracker[f];
      if (v !== undefined && !nonEmptyString(v)) {
        ctx.report("invalid", `tracker.${f}`, `\`tracker.${f}\` must be a non-empty string`, L("tracker"));
      }
    }
  }

  // Bug publishing (ADR-0025): the tracker group is all-or-nothing, and `bug_fields` needs it.
  const tracker = isMap(d.tracker) ? d.tracker : {};
  const bugGroup = ["bug_type", "bug_link_type", "bug_link_direction"];
  const given = bugGroup.filter((key) => tracker[key] !== undefined);
  if ((given.length > 0 && given.length < bugGroup.length) || (d.bug_fields !== undefined && given.length < bugGroup.length)) {
    ctx.report("bug_config_missing", "tracker", "`tracker` needs `bug_type`, `bug_link_type` and `bug_link_direction` together", L("tracker"));
  }
  for (const key of ["bug_type", "bug_link_type"]) {
    if (tracker[key] !== undefined && !nonEmptyString(tracker[key])) ctx.report("invalid", `tracker.${key}`, `\`tracker.${key}\` must be a non-empty string`, L("tracker"));
  }
  if (tracker.bug_link_direction !== undefined && tracker.bug_link_direction !== "outward" && tracker.bug_link_direction !== "inward") {
    ctx.report("invalid", "tracker.bug_link_direction", "`tracker.bug_link_direction` must be `outward` or `inward`", L("tracker"));
  }
  if (nonEmptyString(tracker.bug_type) && [tracker.suite_type, tracker.scenario_type, tracker.case_type].includes(tracker.bug_type)) {
    ctx.report("bug_type_collides", "tracker.bug_type", "`tracker.bug_type` must differ from the Suite, Scenario and Case issue types", L("tracker"));
  }
  if (d.bug_fields !== undefined) checkBugFields(ctx, d.bug_fields, tracker, L("bug_fields"));

  if (d.annotation_map !== undefined && checkMap(ctx, d.annotation_map, "annotation_map", L("annotation_map"))) {
    checkRequired(ctx, d.annotation_map, ["automation_key"], "annotation_map", L("annotation_map"));
    for (const [role, names] of Object.entries(d.annotation_map)) {
      const field = `annotation_map.${role}`;
      if (!Array.isArray(names) || names.length === 0) {
        ctx.report("invalid", field, `\`${field}\` must be a non-empty list of identifiers`, L("annotation_map"));
        continue;
      }
      for (const n of names) {
        if (typeof n !== "string" || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(n)) {
          ctx.report("invalid", field, `\`${n}\` is not an annotation identifier`, L("annotation_map"));
        }
      }
    }
  }

  const ap = /** @type {string | undefined} */ (d.automation_key_pattern);
  if (ap !== undefined && (typeof ap !== "string" || !compileKeyPattern(ap))) {
    ctx.report("invalid", "automation_key_pattern", "`automation_key_pattern` does not compile as a regular expression", L("automation_key_pattern"));
  }
  const pattern = compileKeyPattern(ap);
  const witness = pattern && KEY_OVERLAP_WITNESSES.find((key) => pattern.test(key));
  if (witness) {
    ctx.warn("automation_key_overlap", "automation_key_pattern",
      `\`automation_key_pattern\` matches minted-Key witness \`${witness}\`; absence of this warning does not prove disjointness`, L("automation_key_pattern"));
  }
  // ADR-0013: the recipe implies the pattern, so a project sets one or the other, and the recipe's
  // Key prefix needs a class annotation to live in.
  if (d.automation_key_mint !== undefined) {
    const { error } = parseMintRecipe(/** @type {string} */ (d.automation_key_mint));
    if (error) ctx.report("invalid", "automation_key_mint", error, L("automation_key_mint"));
    if (ap !== undefined) {
      ctx.report("invalid", "automation_key_mint", "set `automation_key_mint` or `automation_key_pattern`, not both: the recipe implies the pattern", L("automation_key_mint"));
    }
    if (isMap(d.annotation_map) && d.annotation_map.automation_key_prefix === undefined) {
      ctx.report("invalid", "annotation_map.automation_key_prefix", "`automation_key_mint` needs `annotation_map.automation_key_prefix`, the class annotation that carries the Key prefix", L("annotation_map"));
    }
  }

  if (d.module_paths !== undefined && (!Array.isArray(d.module_paths) || d.module_paths.length === 0)) {
    ctx.report("invalid", "module_paths", "`module_paths` must be a non-empty list", L("module_paths"));
  }

  if (d.roles !== undefined && checkList(ctx, d.roles, "roles", L("roles"))) {
    for (const r of d.roles) if (!nonEmptyString(r)) ctx.report("invalid", "roles", `role \`${r}\` is not a string`, L("roles"));
    if (new Set(d.roles).size !== d.roles.length) ctx.report("duplicate", "roles", "`roles` repeats a role", L("roles"));
  }

  if (d.concurrency_cap !== undefined && !(Number.isInteger(d.concurrency_cap) && /** @type {number} */ (d.concurrency_cap) >= 1)) {
    ctx.report("invalid", "concurrency_cap", "`concurrency_cap` must be an integer ≥ 1", L("concurrency_cap"));
  }

  // ADR-0021: optional, and so is each Tier; one left out runs on the session's own model.
  if (d.tiers !== undefined && checkMap(ctx, d.tiers, "tiers", L("tiers"))) {
    for (const k of Object.keys(d.tiers)) {
      if (!(/** @type {readonly string[]} */ (TIERS)).includes(k)) ctx.warn("unknown_key", `tiers.${k}`, `\`tiers.${k}\` is not a Tier: the Tiers are ${TIERS.join(", ")}`, L("tiers"));
    }
    for (const k of TIERS) {
      const v = d.tiers[k];
      if (v !== undefined && !isModelLabel(v)) {
        ctx.report("pattern", `tiers.${k}`, `\`tiers.${k}\` is not a model label (a non-empty string with no whitespace): ${JSON.stringify(v)}`, L("tiers"));
      }
    }
  }

  // `scout` is optional, as is `allowed_hosts`; `[]` turns `observe:` off. Each entry is matched exactly
  // against a URL's host, so one with a scheme, port, path or wildcard would never match.
  if (d.scout !== undefined && checkMap(ctx, d.scout, "scout", L("scout"))) {
    for (const k of Object.keys(d.scout)) {
      if (k !== "allowed_hosts") ctx.warn("unknown_key", `scout.${k}`, `unknown key \`scout.${k}\`; preserved`, L("scout"));
    }
    const hosts = d.scout.allowed_hosts;
    if (hosts !== undefined && checkList(ctx, hosts, "scout.allowed_hosts", L("scout"))) {
      for (const h of hosts) {
        if (!isHostname(h)) ctx.report("invalid", "scout.allowed_hosts", `\`${h}\` is not a bare hostname: write the host alone, with no scheme, port, path or \`*\``, L("scout"));
      }
    }
  }

  if (d.retired_features !== undefined) {
    checkKeyList(ctx, d.retired_features, "retired_features", L("retired_features"), (k) => PATTERN.slug.test(/** @type {string} */ (k)) || PATTERN.suite.test(/** @type {string} */ (k)), "Feature slug or Suite key");
  }
}

// Merge persists tracker writes here; only Publish carries them out.
/**
 * @param {CheckContext} ctx
 * @param {unknown} repairs
 * @param {number | undefined} line
 * @returns {void}
 */
function checkRepairs(ctx, repairs, line) {
  if (!checkList(ctx, repairs, "repairs", line)) return;
  for (const [i, repair] of repairs.entries()) {
    const field = `repairs.${i}`;
    if (!checkMap(ctx, repair, field, line)) continue;
    const fields = repair.kind === "remark" ? ["kind", "tracker", "key"] : ["kind", "tracker"];
    checkRequired(ctx, repair, fields, field, line);
    if (!["remark", "retire"].includes(/** @type {string} */ (repair.kind))) ctx.report("invalid", `${field}.kind`, "a repair's kind must be remark or retire", line);
    if (!isTrackerKey(repair.tracker, ctx.trackerPattern)) ctx.report("pattern", `${field}.tracker`, "a repair needs a configured Tracker key", line);
    if (repair.kind === "remark" && !(typeof repair.key === "string" && (PATTERN.case.test(repair.key) || PATTERN.scenario.test(repair.key) || PATTERN.suite.test(repair.key)))) {
      ctx.report("pattern", `${field}.key`, "a remark needs a minted case, scenario or Suite Key", line);
    }
    for (const key of Object.keys(repair)) if (!fields.includes(key)) ctx.report("invalid", `${field}.${key}`, "a repair has an unexpected field", line);
  }
}

/**
 * @param {Record<string, unknown>} d
 * @param {ParsedFile} file
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkFeature(d, file, ctx) {
  const L = /** @type {(k: string) => number | undefined} */ (ctx.line);
  const declare = keyRegistry(ctx);
  checkRequired(ctx, d, ["generated", "sources"], "", ctx.fmLine);
  checkSlugKey(ctx, d);
  if (d.key !== undefined) declare(/** @type {string} */ (d.key), "key", L("key"));
  if (/** @type {number} */ (ctx.schemaVersion) >= SUITE_KEYS_SCHEMA_VERSION && d.suite_key === undefined) {
    ctx.report("required", "suite_key", "missing `suite_key`; rerun `migrate-keys` on the default branch", ctx.fmLine);
  }
  if (d.suite_key !== undefined) {
    if (typeof d.suite_key !== "string" || !PATTERN.suite.test(d.suite_key)) ctx.report("pattern", "suite_key", "`suite_key` must be a minted `su_` Key", L("suite_key"));
    declare(/** @type {string} */ (d.suite_key), "suite_key", L("suite_key"));
  }
  // An unquoted commit id that happens to be all digits reads as a number in the dialect; it still
  // names a commit, and whether it resolves is scan's question.
  if (d.watermark !== undefined && !nonEmptyString(d.watermark) && !(Number.isSafeInteger(d.watermark) && /** @type {number} */ (d.watermark) >= 0)) {
    ctx.report("shape", "watermark", "`watermark` must name a commit", L("watermark"));
  }
  if (d.watermark_digest !== undefined) checkDigest(ctx, d.watermark_digest, "watermark_digest", L("watermark_digest"));
  if (d.coverage_digest !== undefined) checkDigest(ctx, d.coverage_digest, "coverage_digest", L("coverage_digest"));
  if (d.mirror !== undefined) checkMirror(ctx, d.mirror, "feature", "mirror", L("mirror"));
  if ((/** @type {Record<string, unknown> | undefined} */ (d.mirror))?.suite !== undefined && (/** @type {Record<string, unknown>} */ (d.mirror)).suite !== null && !isTrackerKey((/** @type {Record<string, unknown>} */ (d.mirror)).suite, ctx.trackerPattern)) {
    ctx.report("pattern", "mirror.suite", "`mirror.suite` must match `tracker.key_pattern`", L("mirror"));
  }
  if (d.repairs !== undefined) checkRepairs(ctx, d.repairs, L("repairs"));
  if (d.finding !== undefined) checkFindings(ctx, d.finding, "finding", L("finding"), true);
  if (d.retired !== undefined) {
    /** @param {unknown} k */
    const retirable = (k) => isRetiredKey(k, ctx.trackerPattern) ||
      (/** @type {number} */ (ctx.schemaVersion) < MINTED_KEYS_SCHEMA_VERSION && typeof k === "string" &&
        !hasMintedPrefix(k) && readTrackerReference(k) === null && isCaseKey(k, ctx.trackerPattern));
    checkKeyList(ctx, d.retired, "retired", L("retired"), retirable, "case, scenario, Suite, Rule or Boundary key");
    if (Array.isArray(d.retired) && d.retired.includes(d.suite_key)) ctx.report("duplicate", "retired", "a live Suite key matches a tombstone", L("retired"));
  }
  if (d.formerly !== undefined) checkKeyList(ctx, d.formerly, "formerly", L("formerly"), (k) => PATTERN.slug.test(/** @type {string} */ (k)), "Feature key");
  if (d.generated !== undefined) checkGenerated(ctx, d.generated, "generated", L("generated"));
  if (d.sources !== undefined) checkList(ctx, d.sources, "sources", L("sources"));

  for (const e of /** @type {ParsedSection[]} */ (file.sections)) {
    if (e.level !== 3 || !e.title.startsWith("rule_")) continue;
    const h = keyedHeading(e.title);
    if (!h) {
      ctx.report("heading", "rule", `a Rule heading is \`### rule_<key>: <statement>\`: ${e.title}`, e.line);
      continue;
    }
    if (!PATTERN.rule.test(h.key)) ctx.report("pattern", "rule", `Rule key \`${h.key}\` does not match ${PATTERN.rule}`, e.line);
    declare(h.key, "rule", e.line);
  }
  for (const e of /** @type {ParsedSection[]} */ (file.sections)) {
    if (e.level !== 3 || !e.title.startsWith("boundary_")) continue;
    const h = keyedHeading(e.title);
    if (!h) {
      ctx.report("heading", "boundary", `a Boundary heading is \`### boundary_<key>: <statement>\`: ${e.title}`, e.line);
      continue;
    }
    if (!PATTERN.boundary.test(h.key)) ctx.report("pattern", "boundary", `Boundary key \`${h.key}\` does not match ${PATTERN.boundary}`, e.line);
  }
}

/**
 * @param {Record<string, unknown>} d
 * @param {ParsedFile} file
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkScenario(d, file, ctx) {
  const L = /** @type {(k: string) => number | undefined} */ (ctx.line);
  const declare = keyRegistry(ctx);
  /** @param {unknown} k */
  const legacyKey = (k) => /** @type {number} */ (ctx.schemaVersion) < MINTED_KEYS_SCHEMA_VERSION &&
    !hasMintedPrefix(/** @type {string} */ (k)) && isCaseKey(/** @type {string} */ (k), ctx.trackerPattern);
  /** @param {unknown} k */
  const caseKey = (k) => isLiveCaseKey(k) || legacyKey(k);
  /** @param {unknown} k */
  const scenarioKey = (k) => isScenarioKey(k) || legacyKey(k);
  const keyKind = /** @type {number} */ (ctx.schemaVersion) >= MINTED_KEYS_SCHEMA_VERSION ? "minted Key of its kind" :
    ctx.trackerPattern ? "minted, tracker or Provisional key" : "minted or Provisional key (no tracker is configured)";
  checkRequired(ctx, d, ["feature", "generated"], "", ctx.fmLine);
  if (d.key !== undefined) {
    if (!scenarioKey(d.key)) ctx.report("pattern", "key", `scenario key \`${d.key}\` is not a ${keyKind}`, L("key"));
    declare(/** @type {string} */ (d.key), "key", L("key"));
  }
  if (d.feature !== undefined && (typeof d.feature !== "string" || !PATTERN.slug.test(d.feature))) {
    ctx.report("pattern", "feature", `\`feature\` \`${d.feature}\` is not a Feature key`, L("feature"));
  }
  if (d.level !== undefined) {
    if (/** @type {number} */ (ctx.schemaVersion) >= LEVEL_ON_CASE_SCHEMA_VERSION) ctx.report("scenario_level", "level", "a Test Scenario carries no level; run `migrate-keys --levels`", L("level"));
    else if (!nonEmptyString(d.level)) ctx.report("shape", "level", "`level` must be a level slug", L("level"));
  }
  checkTrackerFields(ctx, d, (k) => k, L);
  if (d.migrate_as !== undefined && !isScenarioKey(d.migrate_as)) {
    ctx.report("pattern", "migrate_as", "`migrate_as` must be a minted Scenario Key", L("migrate_as"));
  }
  if (d.mirror !== undefined) checkMirror(ctx, d.mirror, "scenario", "mirror", L("mirror"));
  if (d.formerly !== undefined) checkKeyList(ctx, d.formerly, "formerly", L("formerly"), (k) => isFormerKey(k, ctx.trackerPattern), "historical Key");
  if (d.generated !== undefined) checkGenerated(ctx, d.generated, "generated", L("generated"));
  if (d.sources !== undefined) checkList(ctx, d.sources, "sources", L("sources"));

  const h1 = (/** @type {ParsedSection[]} */ (file.sections)).find((e) => e.level === 1);
  const parsed = h1 && keyedHeading(h1.title);
  if (!parsed) {
    ctx.report("heading", "h1", "a scenario file's H1 is `# <key>: <summary>`", h1?.line);
  } else if (d.key !== undefined && parsed.key !== d.key) {
    ctx.report("heading", "h1", `H1 key \`${parsed.key}\` differs from frontmatter key \`${d.key}\``, h1.line);
  }

  for (const e of entryHeadings(file, /** @type {ParsedEntry[]} */ (file.cases))) {
    const h = keyedHeading(e.title);
    if (!h) {
      ctx.report("heading", "case", `a Test Case heading is \`### <key>: <summary>\`: ${e.title}`, e.line);
    } else if (!e.entry?.blockLine) {
      ctx.report("required", "case", `Test Case \`${h.key}\` has no \`yaml\` block after its heading`, e.line);
    } else {
      checkCase(ctx, h, e.line, e.entry, declare, caseKey, keyKind);
    }
  }
}

// One Test Case's block; its YAML errors are the file's `problems`, reported already.
/**
 * @param {CheckContext} ctx
 * @param {{ key: string, text: string }} heading
 * @param {number} headingLine
 * @param {ParsedEntry} entry
 * @param {(key: string, field: string, line: number | undefined) => void} declare
 * @param {(k: unknown) => boolean} caseKey
 * @param {string} keyKind
 * @returns {void}
 */
function checkCase(ctx, heading, headingLine, entry, declare, caseKey, keyKind) {
  const c = entry.data;
  const at = (/** @type {string} */ k) => entry.keyLines[k] ?? entry.blockLine;
  const f = (/** @type {string} */ k) => `${heading.key}.${k}`;

  if (!caseKey(heading.key)) ctx.report("pattern", "case", `case key \`${heading.key}\` is not a ${keyKind}`, headingLine);
  declare(heading.key, "case", headingLine);
  if (c.key === undefined) ctx.report("required", f("key"), `Test Case \`${heading.key}\`'s block has no \`key\``, entry.blockLine);
  else if (c.key !== heading.key) {
    ctx.report("heading", f("key"), `heading key \`${heading.key}\` differs from block key \`${c.key}\``, at("key"));
  }

  for (const k of Object.keys(c)) {
    if (!KNOWN.case.includes(k) && !ctx.labels?.customFields.some((f) => f.name === k)) ctx.warn("unknown_key", f(k), `unknown key \`${k}\`; preserved`, at(k));
  }
  for (const p of caseLabelProblems(c, ctx.labels ?? labelDefinitions({}))) ctx.report(p.code, f(p.field), p.message, at(p.field));
  for (const name of ["mirror_fields", "mirror_field_targets"]) {
    if (c[name] === undefined || !checkMap(ctx, c[name], f(name), at(name))) continue;
    for (const [key, value] of Object.entries(c[name])) {
      const valid = name === "mirror_field_targets" ? nonEmptyString(value) : value === null || typeof value === "string" || (Array.isArray(value) && value.every((v) => typeof v === "string"));
      if (!valid) ctx.report("shape", f(`${name}.${key}`), `\`${name}.${key}\` must hold ${name === "mirror_field_targets" ? "a tracker field name" : "a scalar, scalar list or null"}`, at(name));
    }
  }
  checkTrackerFields(ctx, c, f, at);
  if (c.migrate_as !== undefined && !isLiveCaseKey(c.migrate_as)) {
    ctx.report("pattern", f("migrate_as"), "`migrate_as` must be a minted Case Key", at("migrate_as"));
  }
  if (c.automates !== undefined) checkKeyList(ctx, c.automates, f("automates"), at("automates"), (k) => /** @type {RegExp} */ (ctx.autPattern).test(/** @type {string} */ (k)), "Automation key");
  if (c.covers !== undefined) checkKeyList(ctx, c.covers, f("covers"), at("covers"), (k) => PATTERN.rule.test(/** @type {string} */ (k)), "Rule key");
  if (c.relies_on !== undefined) checkKeyList(ctx, c.relies_on, f("relies_on"), at("relies_on"), (k) => typeof k === "string" && isRuleRef(k), "Rule reference");
  if (c.formerly !== undefined) checkKeyList(ctx, c.formerly, f("formerly"), at("formerly"), (k) => isFormerKey(k, ctx.trackerPattern), "historical Key");
  if (c.automatable !== undefined && typeof c.automatable !== "boolean") {
    ctx.report("shape", f("automatable"), "`automatable` must be true or false", at("automatable"));
  }
  if (c.level === undefined && /** @type {number} */ (ctx.schemaVersion) >= LEVEL_ON_CASE_SCHEMA_VERSION) ctx.report("required", f("level"), "a Test Case requires one level", entry.blockLine);
  if (c.level !== undefined && !nonEmptyString(c.level)) ctx.report("shape", f("level"), "`level` must be a level slug", at("level"));
  if (c.roles !== undefined) checkList(ctx, c.roles, f("roles"), at("roles"));
  if (c.sources !== undefined) checkList(ctx, c.sources, f("sources"), at("sources"));
  if (c.mirror !== undefined) checkMirror(ctx, c.mirror, "case", f("mirror"), at("mirror"));
  if (c.review !== undefined) checkStamp(ctx, c.review, f("review"), at("review"));
  if (c.review_by !== undefined) checkDate(ctx, c.review_by, f("review_by"), at("review_by"));
  if (c.finding !== undefined) checkFindings(ctx, c.finding, f("finding"), at("finding"), false);
  if (c.generated !== undefined) checkGenerated(ctx, c.generated, f("generated"), at("generated"));
}

// An Observation (ADR-0016): what a UI scout saw in the live application, dated and never
// edited. Its front matter is closed: a field outside it is refused, not preserved, since nothing
// else may ride into committed evidence.
/**
 * @param {Record<string, unknown>} d
 * @param {ParsedFile} file
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkObservation(d, file, ctx) {
  for (const k of Object.keys(d)) {
    if (!KNOWN.observation.includes(k)) ctx.report("invalid", k, `\`${k}\` is not an Observation field: its front matter holds ${KNOWN.observation.map((f) => `\`${f}\``).join(", ")} only`, (/** @type {(k: string) => number | undefined} */ (ctx.line))(k));
  }
  checkRequired(ctx, d, KNOWN.observation.slice(1), "", ctx.fmLine);
  if (d.observed_at !== undefined) checkDate(ctx, d.observed_at, "observed_at", (/** @type {(k: string) => number | undefined} */ (ctx.line))("observed_at"));
  if (d.url !== undefined) checkObservedUrl(ctx, d.url, (/** @type {(k: string) => number | undefined} */ (ctx.line))("url"));
  // The version the app showed, as written (`2.14.1` is text, `2.14` reads as a number), or null.
  const v = d.app_version;
  if (v !== undefined && v !== null && !nonEmptyString(v) && typeof v !== "number") {
    ctx.report("shape", "app_version", "`app_version` is the version the app showed, or `null` when it showed none", (/** @type {(k: string) => number | undefined} */ (ctx.line))("app_version"));
  }
  if (d.request !== undefined && !nonEmptyString(d.request)) {
    ctx.report("shape", "request", "`request` is the engineer's request, in words", (/** @type {(k: string) => number | undefined} */ (ctx.line))("request"));
  }
  checkObservationBody(ctx, file);
}

// The body is the steps taken, then the facts seen: a `## Steps` section listing them, a `## Facts`
// section after it numbering what they showed 1, 2, 3 … so each fact can be cited by its number, and
// optionally a `## Not seen` section after the facts numbering the parts of the request the scout
// could not reach, each behind input its read-only rules forbid.
const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+\S/;
/**
 * @param {CheckContext} ctx
 * @param {ParsedFile} file
 * @returns {void}
 */
function checkObservationBody(ctx, file) {
  const lines = (/** @type {string} */ (file.text)).replace(/\r\n/g, "\n").split("\n");
  const fenced = new Set();
  for (const e of /** @type {Array<{ line: number, end: number }>} */ (file.fences)) for (let l = e.line; l <= e.end; l++) fenced.add(l);
  const headings = /** @type {ParsedSection[]} */ (file.sections);
  // The list items under the `##` heading `name`, up to the next heading, outside any fence.
  /** @param {string} name */
  const section = (name) => {
    const heading = headings.find((h) => h.level === 2 && h.title === name);
    if (!heading) return null;
    const next = headings.find((h) => h.line > heading.line);
    const items = [];
    for (let l = heading.line + 1; l < (next?.line ?? lines.length + 1); l++) {
      if (!fenced.has(l) && LIST_ITEM.test(lines[l - 1])) items.push(lines[l - 1]);
    }
    return { line: heading.line, items };
  };
  const steps = section("Steps");
  const facts = section("Facts");
  if (!steps?.items.length) ctx.report("required", "steps", "an Observation lists the steps taken under a `## Steps` heading", steps?.line);
  if (!facts?.items.length) ctx.report("required", "facts", "an Observation numbers the facts seen under a `## Facts` heading", facts?.line);
  if (steps && facts && facts.line < steps.line) {
    ctx.report("heading", "facts", "`## Facts` comes after `## Steps`: the steps first, then what they showed", facts.line);
  }
  /** @param {string[]} items */
  const numbered = (items) => items.every((item, i) => new RegExp(`^\\s*${i + 1}\\.\\s`).test(item));
  if (facts?.items.length && !numbered(facts.items)) {
    ctx.report("invalid", "facts", "facts are numbered 1, 2, 3 … in order, one numbered line each", facts.line);
  }
  const notSeen = section("Not seen");
  if (!notSeen) return;
  if ((facts && notSeen.line < facts.line) || (steps && notSeen.line < steps.line)) {
    ctx.report("heading", "not_seen", "`## Not seen` comes after `## Facts`: what was seen first, then what was not", notSeen.line);
  }
  if (!notSeen.items.length || !numbered(notSeen.items)) {
    ctx.report("invalid", "not_seen", "the parts not seen are numbered 1, 2, 3 … in order, one numbered line each", notSeen.line);
  }
}

// The page observed: an http(s) URL naming a host, with no query string or fragment, since either
// can carry a token and an Observation is committed. No problem repeats the value.
const OBSERVED_URL = /^https?:\/\/[^\s/?#]+\S*$/;
/**
 * @param {CheckContext} ctx
 * @param {unknown} v
 * @param {number | undefined} line
 * @returns {void}
 */
function checkObservedUrl(ctx, v, line) {
  if (!nonEmptyString(v)) return ctx.report("shape", "url", "`url` must be the observed page's URL", line);
  if (!OBSERVED_URL.test(v)) return ctx.report("pattern", "url", "`url` is an http(s) URL naming a host", line);
  if (/[?#]/.test(v)) ctx.report("invalid", "url", "`url` carries a query string or a fragment, which can hold a token: an Observation records the address without them", line);
}

/**
 * Code gen's frontmatter: the mode, the stacks it has trained, and the two retry caps.
 * @param {Record<string, unknown>} d
 * @param {ParsedFile} file
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkCodegenFrontmatter(d, file, ctx) {
  const line = /** @type {(k: string) => number | undefined} */ (ctx.line);
  if (d.pr !== undefined && !["on-request", "always"].includes(/** @type {string} */ (d.pr))) {
    ctx.report("invalid", "pr", "`pr` must be on-request or always", line("pr"));
  }
  for (const [key, max] of /** @type {[string, number][]} */ ([["codegen_repeats", 10], ["codegen_attempts", 5]])) {
    const v = d[key];
    if (v !== undefined && (!Number.isInteger(v) || /** @type {number} */ (v) < 1 || /** @type {number} */ (v) > max)) {
      ctx.report("invalid", key, `\`${key}\` must be an integer from 1 to ${max}`, line(key));
    }
  }
  if (d.trained_stacks === undefined) return;
  if (!Array.isArray(d.trained_stacks)) {
    return ctx.report("invalid", "trained_stacks", "`trained_stacks` is a list of stack roots", line("trained_stacks"));
  }
  if (d.trained_stacks.length > 1) ctx.report("invalid", "trained_stacks", "`trained_stacks` holds at most one stack root", line("trained_stacks"));
  if (!d.trained_stacks.every(nonEmptyString)) {
    return ctx.report("invalid", "trained_stacks", "`trained_stacks` holds stack roots, each a non-empty repository-relative path", line("trained_stacks"));
  }
  // A stack enters `trained_stacks` only when every facet has a Convention for it. An engineer
  // writing the frontmatter early, before the last facet is settled, is refused here.
  for (const stack of d.trained_stacks) {
    const covered = new Set((file.conventions ?? []).filter((e) => e.data.stack === stack).map((e) => e.data.facet));
    if (!CODEGEN_FACETS.every((facet) => covered.has(facet))) {
      ctx.report("invalid", "trained_stacks", `\`trained_stacks\` names \`${stack}\`, which has no Convention for every facet; a stack is trained only when all ${CODEGEN_FACETS.length} are covered`, line("trained_stacks"));
    }
  }
}

/**
 * @param {Record<string, unknown>} d
 * @param {ParsedFile} file
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkTrain(d, file, ctx) {
  const declare = keyRegistry(ctx);
  if (d.key === CODEGEN_TRAIN_KEY) checkCodegenFrontmatter(d, file, ctx);
  const accessPrefixes = { prefixes: /** @type {Map<string, string>} */ (new Map()), accounts: /** @type {Map<string, string>} */ (new Map()) }; // `(role, prefix)`, and a test account's `login_state` or `(origin, user)` → the Access note that claimed it first
  if (d.key === EXECUTE_TRAIN_KEY) for (const secret of secretsIn(d)) {
    const line = (/** @type {(k: string) => number | undefined} */ (ctx.line))(secret.key) ?? ctx.fmLine;
    ctx.secretLines.add(/** @type {number} */ (line));
    ctx.report("secret", secret.key, `execute training holds a credential (${secret.why}); training never holds a credential`, line);
  }
  if (d.key === EXECUTE_TRAIN_KEY && d.setup_role !== undefined && !nonEmptyString(d.setup_role)) {
    ctx.report("shape", "setup_role", "`setup_role` must be a non-empty Role name", (/** @type {(k: string) => number | undefined} */ (ctx.line))("setup_role"));
  }
  if (d.key === EXECUTE_TRAIN_KEY && d.automation_retries !== undefined &&
      (!Number.isInteger(d.automation_retries) || /** @type {number} */ (d.automation_retries) < 0 || /** @type {number} */ (d.automation_retries) > 5)) {
    ctx.report("invalid", "automation_retries", "`automation_retries` must be an integer from 0 to 5", (/** @type {(k: string) => number | undefined} */ (ctx.line))("automation_retries"));
  }
  if (canonicalTrainKey(d.key) === CODEFIX_TRAIN_KEY) {
    const line = (/** @type {string} */ key) => (/** @type {(k: string) => number | undefined} */ (ctx.line))(key);
    for (const [key, min, max] of /** @type {[string, number, number][]} */ ([["fix_attempts", 1, 5], ["flaky_repeats", 3, 10]])) {
      if (d[key] !== undefined && (!Number.isInteger(d[key]) || Number(d[key]) < min || Number(d[key]) > max)) ctx.report("invalid", key, `${key} must be an integer from ${min} to ${max}`, line(key));
    }
    if (d.pr !== undefined && !["on-request", "always"].includes(String(d.pr))) ctx.report("invalid", "pr", "pr must be on-request or always", line("pr"));
  }
  if (d.key !== undefined) {
    const rel = `train/${d.key}.md`;
    if (!TRAIN_KEYS.includes(/** @type {string} */ (canonicalTrainKey(d.key)))) {
      ctx.report("invalid", "key", `a train file's key is its target, one of ${TRAIN_KEYS.map((k) => `\`${k}\``).join(", ")}; not \`${d.key}\``, (/** @type {(k: string) => number | undefined} */ (ctx.line))("key"));
    } else if (file.rel !== rel) {
      ctx.report("invalid", "key", `a train file keyed \`${d.key}\` lives at \`${rel}\``, (/** @type {(k: string) => number | undefined} */ (ctx.line))("key"));
    }
  }
  // The shared categories file has its own entry kind, validated by the resolver's checker.
  if (d.key === CATEGORIES_TRAIN_KEY) return checkCategoriesFile(file, ctx);
  const entries = TRAIN_ENTRIES.flatMap(({ list }) => /** @type {ParsedEntry[]} */ (file[list]));
  for (const e of entryHeadings(file, entries)) checkTrainEntry(ctx, d, file, e, declare, accessPrefixes);
}

// `train/categories.md` is checked by the resolver's whole-file validation, not the command train
// entry kinds. Its dialect problems are already on the parsed file, so only its own findings are
// added here.
/**
 * @param {ParsedFile} file
 * @param {CheckContext} ctx
 * @returns {void}
 */
function checkCategoriesFile(file, ctx) {
  const parsed = parseCategoryDraft(/** @type {string} */ (file.text), {
    type: file.type ?? null,
    key: /** @type {Record<string, unknown>} */ (file.data).key,
    frontmatterLine: file.frontmatterLine ?? 1,
    retiredLine: /** @type {Record<string, number>} */ (file.keyLines).retired ?? null,
    retired: /** @type {Record<string, unknown>} */ (file.data).retired,
    problems: /** @type {{ code?: string, line?: number, message: string }[]} */ (file.problems),
  });
  for (const error of validateCategories(parsed)) {
    if (error.code === "dialect" || error.code === "conflict_marker") continue;
    ctx.report(error.code, error.field, error.message, error.line);
  }
}

// One `### ` heading of a train file and the entry it heads, if the parser recognised one.
/**
 * @param {CheckContext} ctx
 * @param {Record<string, unknown>} d
 * @param {ParsedFile} file
 * @param {ParsedSection & { entry: ParsedEntry | null }} e
 * @param {(key: string, field: string, line: number | undefined) => void} declare
 * @param {AccessPrefixRegistry} accessPrefixes
 * @returns {void}
 */
function checkTrainEntry(ctx, d, file, e, declare, accessPrefixes) {
  const h = keyedHeading(e.title);
  const descriptor = h && trainEntry(h.key);
  const kind = descriptor?.kind;
  if (!kind) {
    const shown = credentialIn(e.title) ? WITHHELD : e.title;
    return ctx.report("heading", "entry", `a train entry heading is \`### cnv_<slug>: <statement>\`, \`### prc_<slug>: <statement>\` or \`### acc_<slug>: <what it reaches>\` (execute also accepts \`rcp_\`, \`act_\` and \`upl_\`): ${shown}`, e.line);
  }
  declare((/** @type {{ key: string, text: string }} */ (h)).key, kind, e.line);
  if ((/** @type {TrainEntryDescriptor} */ (descriptor)).target && d.key !== (/** @type {TrainEntryDescriptor} */ (descriptor)).target) {
    return ctx.report("invalid", (/** @type {{ key: string, text: string }} */ (h)).key, "Recipes, API actions and upload fixtures belong in `train/execute.md` only", e.line);
  }
  // Access notes live in `train/access.md` alone, and that file holds no Practice.
  const misplaced = kind === "access_note" ? d.key !== ACCESS_TRAIN_KEY : kind === "practice" && d.key === ACCESS_TRAIN_KEY;
  if (misplaced) {
    return ctx.report("invalid", (/** @type {{ key: string, text: string }} */ (h)).key, kind === "access_note"
      ? `Access note \`${(/** @type {{ key: string, text: string }} */ (h)).key}\` belongs in \`train/${ACCESS_TRAIN_KEY}.md\`, the only file Access notes are read from`
      : `Practice \`${(/** @type {{ key: string, text: string }} */ (h)).key}\` belongs in a command's train file: \`train/${ACCESS_TRAIN_KEY}.md\` holds Access notes only`, e.line);
  }
  if (kind === "access_note") return checkAccessNote(ctx, /** @type {{ key: string, text: string }} */ (h), e.line, e.entry, accessPrefixes);
  // Conventions are design's and codegen's: the form of a Test Case, or of generated test code.
  if (kind === "convention" && d.key !== DESIGN_TRAIN_KEY && d.key !== CODEGEN_TRAIN_KEY) {
    ctx.report("invalid", (/** @type {{ key: string, text: string }} */ (h)).key, `Convention \`${(/** @type {{ key: string, text: string }} */ (h)).key}\` belongs in \`train/${DESIGN_TRAIN_KEY}.md\` or \`train/${CODEGEN_TRAIN_KEY}.md\`: a Convention is about the form of what the agent writes, which only design and codegen learn; state how this command should work as a Practice (\`prc_\`)`, e.line);
  }
  const label = (/** @type {TrainEntryDescriptor} */ (descriptor)).label;
  const entry = e.entry;
  if (!entry?.blockLine) {
    return ctx.report("required", (/** @type {{ key: string, text: string }} */ (h)).key, `${label} \`${(/** @type {{ key: string, text: string }} */ (h)).key}\` has no \`yaml\` block after its heading`, e.line);
  }
  checkRequired(ctx, entry.data, ["sources", "added"], (/** @type {{ key: string, text: string }} */ (h)).key, entry.blockLine);
  if (entry.data.sources !== undefined) checkList(ctx, entry.data.sources, `${(/** @type {{ key: string, text: string }} */ (h)).key}.sources`, entry.blockLine);
  if (entry.data.added !== undefined) checkDate(ctx, entry.data.added, `${(/** @type {{ key: string, text: string }} */ (h)).key}.added`, entry.blockLine);
  if (d.key === EXECUTE_TRAIN_KEY) checkExecuteEntry(ctx, kind, entry);
  else if (entry.data.features !== undefined) ctx.report("invalid", `${(/** @type {{ key: string, text: string }} */ (h)).key}.features`, "Feature scopes belong in `train/execute.md` only", entry.keyLines.features);
  if (d.key === CODEGEN_TRAIN_KEY && kind === "convention") checkCodegenConvention(ctx, entry);
  if (d.key === CODEGEN_TRAIN_KEY && kind === "practice") checkCodegenPractice(ctx, entry);
  // A Practice's example is optional: an operational instruction often has none.
  const fences = (/** @type {Array<{ line: number, end: number }>} */ (file.fences)).filter((f) => f.line > e.line && f.line <= e.end).length;
  if (kind === "convention" && fences < 2) {
    ctx.report("required", (/** @type {{ key: string, text: string }} */ (h)).key, `Convention \`${(/** @type {{ key: string, text: string }} */ (h)).key}\` has no fenced example`, e.line);
  }
  // A codegen prohibition shows what not to write as well as what to write.
  if (d.key === CODEGEN_TRAIN_KEY && kind === "convention" && /^(?:never|do not|don['’]t|avoid)\b/i.test(/** @type {string} */ (entry.statement ?? "")) && fences < 3) {
    ctx.report("required", (/** @type {{ key: string, text: string }} */ (h)).key, `Convention \`${(/** @type {{ key: string, text: string }} */ (h)).key}\` is a prohibition, so it carries an anti-example beside its example`, e.line);
  }
}

// A repo-relative path: no absolute path or drive, no backslash or NUL, and no `..` segment.
const REPO_RELATIVE = (/** @type {string} */ p) => p.trim() !== "" && !/^(?:\/|[A-Za-z]:)/.test(p) && !/[\\\0]/.test(p) && !p.split("/").includes("..");

/** @param {CheckContext} ctx @param {ParsedEntry} entry */
function checkCodegenConvention(ctx, entry) {
  const d = entry.data;
  const bad = (/** @type {string} */ key, /** @type {string} */ message) => ctx.report("invalid", `${entry.key}.${key}`, message, entry.keyLines[key] ?? entry.blockLine);
  if (!nonEmptyString(d.stack) || !REPO_RELATIVE(/** @type {string} */ (d.stack))) bad("stack", "a Convention's `stack` is the project's stack root, a repository-relative path");
  if (!CODEGEN_FACETS.includes(/** @type {string} */ (d.facet))) bad("facet", `a Convention's \`facet\` is one of ${CODEGEN_FACETS.join(", ")}`);
  if (!Array.isArray(d.sources) || !d.sources.length || !d.sources.every((s) => typeof s === "string" && /^(?:human:.+|code:.+#L[1-9][0-9]*@[0-9a-f]{7})$/.test(s))) {
    bad("sources", "a Convention's `sources` cite `code:<path>#L<line>@<sha7>` or `human:<name>`");
  }
  if (d.refs !== undefined && (!Array.isArray(d.refs) || !d.refs.every((r) => typeof r === "string" && REPO_RELATIVE(r)))) {
    bad("refs", "`refs` holds repository-relative paths");
  }
  if (d.signal !== undefined) {
    const signal = d.signal;
    const facet = /** @type {string} */ (d.facet);
    const expected = CODEGEN_SIGNALS[facet];
    if (!isMap(signal)) bad("signal", "`signal` is a map of `id`, `value` and `corpus`");
    else {
      if (!expected) bad("signal", "only a `placement`, `key-carrier` or `test-naming` Convention carries a `signal`");
      else if (signal.id !== expected) bad("signal", `a \`${facet}\` Convention's signal records \`id: ${expected}\``);
      if (!nonEmptyString(signal.value)) bad("signal", "`signal.value` is the one deterministic value the Convention records");
      if (typeof signal.corpus !== "string" || !/^\d+\/\d+$/.test(signal.corpus)) bad("signal", "`signal.corpus` is the observed share, `X/N`");
      if (Object.keys(signal).some((k) => !["id", "value", "corpus"].includes(k))) bad("signal", "`signal` holds `id`, `value` and `corpus` only");
    }
  }
}

// What a Practice may name, and what belongs to the CLI that proves generated code. The strategy
// stays with the command: a Practice says how the agent works, never how a test is run.
const RUNNER_WORD = /\b(?:playwright|gradle|gradlew|maven|mvn|mvnw|junit|surefire|pytest|jest|vitest|npx|test_runner)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?tests?\b|\b(?:codegen|fix)\s+verify\b/i;

/** @param {CheckContext} ctx @param {ParsedEntry} entry */
function checkCodegenPractice(ctx, entry) {
  const text = [entry.statement, ...(entry.prose ?? []).map((p) => p.text)].join("\n");
  const named = RUNNER_WORD.exec(text);
  if (named) {
    ctx.report("invalid", entry.key, `a codegen Practice never names a runner or verification command (\`${named[0]}\`): how code gen proves a test is the CLI's own step, and a Practice covers only how the agent works`, entry.line);
  }
}

// Execute's operating metadata; membership and fixture existence are relational checks.
/**
 * @param {CheckContext} ctx
 * @param {string} kind
 * @param {ParsedEntry} entry
 * @returns {void}
 */
function checkExecuteEntry(ctx, kind, entry) {
  const d = entry.data;
  const bad = (/** @type {string} */ key, /** @type {string} */ message, code = "shape") => ctx.report(code, `${entry.key}.${key}`, message, entry.keyLines[key] ?? entry.blockLine);
  for (const secret of secretsIn(d)) {
    const line = entry.keyLines[secret.key] ?? entry.blockLine;
    ctx.secretLines.add(line);
    ctx.report("secret", entry.key, `execute training holds a credential (${secret.why}); training never holds a credential`, line);
  }
  const string = (/** @type {string} */ key) => { if (d[key] !== undefined && !nonEmptyString(d[key])) bad(key, `\`${key}\` must be a non-empty string`); };
  /**
   * @param {string} key
   * @param {(v: unknown) => boolean} [predicate]
   * @param {boolean} [nonEmpty]
   */
  const list = (key, predicate = nonEmptyString, nonEmpty = false) => {
    if (d[key] !== undefined && (!Array.isArray(d[key]) || (nonEmpty && d[key].length === 0) || !(/** @type {unknown[]} */ (d[key])).every(predicate))) bad(key, `\`${key}\` must be ${nonEmpty ? "a non-empty list" : "a list"} of names`);
  };
  list("features", (v) => typeof v === "string" && PATTERN.slug.test(v));
  if (kind === "recipe") {
    if (d.create === undefined && d.fixtures === undefined) bad("create", "a recipe needs `create` and/or `fixtures`", "required");
    string("create");
    string("tag_field");
    list("fixtures", nonEmptyString, true);
    if (d.required !== undefined && (!isMap(d.required) || !Object.values(d.required).every(nonEmptyString))) bad("required", "`required` maps field names to valid values or patterns");
    if (d.disposable !== undefined && d.disposable !== true) bad("disposable", "`disposable`, when present, is `true`");
  }
  if (kind === "action") {
    checkRequired(ctx, d, ["phrase", "method", "path"], entry.key, entry.blockLine);
    string("phrase");
    if (d.method !== undefined && !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(/** @type {string} */ (d.method))) bad("method", "`method` must be an HTTP method");
    if (d.path !== undefined && (!nonEmptyString(d.path) || /^[a-z][a-z0-9+.-]*:/i.test(d.path) || /^[\\/]{2}/.test(d.path) || /[\\\s\x00-\x1f]/.test(d.path))) bad("path", "`path` must be relative to the target origin");
    list("query");
    list("body");
  }
  if (kind === "upload") {
    if (d.file !== undefined) {
      if (!isFixtureName(d.file)) bad("file", "`file` must be a bare name under `.qa/fixtures/`");
      if (["format", "bytes", "content"].some((key) => d[key] !== undefined)) bad("file", "use `file` or generated `format`/`bytes`/`content`, exclusively");
    } else {
      if (!["png", "jpg", "pdf", "csv", "txt", "json"].includes(/** @type {string} */ (d.format))) bad("format", "a generated fixture needs `format`: png, jpg, pdf, csv, txt or json");
      if (d.bytes !== undefined && (!Number.isInteger(d.bytes) || /** @type {number} */ (d.bytes) < 1 || /** @type {number} */ (d.bytes) > 10485760)) bad("bytes", "`bytes` must be an integer from 1 to 10485760");
      if (d.content !== undefined && typeof d.content !== "string") bad("content", "`content` must be a string");
      if (d.bytes !== undefined && d.content !== undefined) bad("content", "use `bytes` or `content`, exclusively");
    }
  }
}

// Text in a known token format on any line of a train file: in a heading, the prose,
// a comment, a fenced example or a line outside the dialect, where no block check can see it. Named
// by the entry it sits in, by line, unless the entry's key is itself a token; never quoted.
/**
 * @param {CheckContext} ctx
 * @param {ParsedFile} file
 * @returns {void}
 */
function refuseTokens(ctx, file) {
  const sections = (/** @type {ParsedSection[]} */ (file.sections)).filter((e) => e.level <= 3);
  (/** @type {string} */ (file.text)).replace(/\r\n/g, "\n").split("\n").forEach((text, i) => {
    const line = i + 1;
    const what = tokenIn(text);
    if (!what || ctx.secretLines.has(line)) return;
    const h = sections.findLast((e) => e.line <= line);
    const key = h?.level === 3 ? keyedHeading(h.title)?.key : undefined;
    const entry = key && !tokenIn(key) ? trainEntry(key) : undefined;
    ctx.report("secret", entry ? key : undefined, credentialMessage(line, `text in the format of ${what}`, entry, key), line);
  });
}

// A codegen train file's sensitive string literals: an example that hard-codes a value under a
// credential-named key would teach the generator to write this same secret into test code. The
// value is never repeated; the line and the name are.
/**
 * @param {CheckContext} ctx
 * @param {ParsedFile} file
 * @returns {void}
 */
function refuseSensitiveLiterals(ctx, file) {
  const sections = (/** @type {ParsedSection[]} */ (file.sections)).filter((e) => e.level <= 3);
  (/** @type {string} */ (file.text)).replace(/\r\n/g, "\n").split("\n").forEach((text, i) => {
    const line = i + 1;
    const name = sensitiveLiteralName(text);
    if (!name || ctx.secretLines.has(line)) return;
    const h = sections.findLast((e) => e.line <= line);
    const key = h?.level === 3 ? keyedHeading(h.title)?.key : undefined;
    ctx.report("secret", key && !tokenIn(key) ? key : undefined, `training holds a string literal assigned to or passed as \`${name}\`: training never holds a credential`, line);
  });
}

// What an Access note's `via` may be: a connector (`mcp:name`, `cli:name`) or a password's home
// (`PASSWORD_VIA`: `env:NAME`, `file:<path>`).
const VIA = new RegExp(`^(mcp:[a-z0-9_-]+|cli:[a-z0-9_-]+)$|${PASSWORD_VIA.source}`);

// An app test account: the note logs in to an app, every `match` a `url:` prefix, as a CLI
// login or a saved login state.
/**
 * @param {Record<string, unknown>} a
 * @returns {boolean}
 */
function appTestAccount(a) {
  const urlsOnly = Array.isArray(a.match) && a.match.length > 0 && a.match.every((m) => typeof m === "string" && m.startsWith("url:"));
  const saved = a.via === "cli:playwright-cli" && isMap(a.identifiers) && nonEmptyString(a.identifiers.login_state);
  return urlsOnly && (cliLoginUser(a) !== null || saved);
}

/**
 * @param {CheckContext} ctx
 * @param {Record<string, unknown>} a
 * @param {string} field
 * @param {number | undefined} line
 * @returns {void}
 */
function checkAccessRole(ctx, a, field, line) {
  if (!nonEmptyString(a.role) || a.role !== a.role.trim()) {
    return ctx.report("shape", field, `\`${field}\` must be a non-empty Role name with no surrounding whitespace`, line);
  }
  if (!appTestAccount(a)) {
    ctx.report("invalid", field, `\`${field}\` belongs on an app test account only: every \`match\` a \`url:\` prefix, and a CLI login or \`via: cli:playwright-cli\` with \`identifiers.login_state\``, line);
  }
}

// One note is one test account: `identifiers.login_state`, and `identifiers.user` on an origin,
// belong to the first note that names them, whatever the Roles. The message names neither value.
/**
 * @param {CheckContext} ctx
 * @param {Record<string, unknown>} a
 * @param {string} key
 * @param {Map<string, string>} accounts
 * @param {number | undefined} line
 * @returns {void}
 */
function claimAccount(ctx, a, key, accounts, line) {
  if (!isMap(a.identifiers)) return;
  /** @type {Array<[string, string, string]>} */
  const claims = [];
  if (nonEmptyString(a.identifiers.login_state)) claims.push(["login_state", `state\n${a.identifiers.login_state}`, "a login-state file"]);
  if (nonEmptyString(a.identifiers.user) && Array.isArray(a.match)) {
    for (const m of a.match) {
      const origin = typeof m === "string" && m.startsWith("url:") ? originOf(m.slice(4)) : null;
      if (origin) claims.push(["user", `user\n${origin}\n${a.identifiers.user}`, "a user on that origin"]);
    }
  }
  for (const [field, claim, what] of claims) {
    const held = accounts.get(claim);
    if (held && held !== key) {
      ctx.report("duplicate", `${key}.identifiers`, `\`${key}.identifiers.${field}\` is ${what} that \`${held}\` already uses: one note is one test account, whatever its Role`, line);
    } else {
      accounts.set(claim, key);
    }
  }
}

/**
 * @param {string} url
 * @returns {string | null}
 */
const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

// An Access note (ADR-0015): how to reach a tracker or URL Reference behind a login, never
// the credential. `via` says where the credential lives, always outside anything git tracks; `match`
// holds the prefixes of the normalised Reference URIs the note reaches (`isMatchPrefix`). A
// `file:<path>` is the git-ignored password file of a CLI login (ADR-0019), which only the CLI
// reads: so only on a note that logs in to an app as `identifiers.user`, every `match` a `url:` prefix.
//
// An optional `role` names the Role the note's test account logs in as: a non-empty, trimmed
// string, only on an app test account (every `match` a `url:` prefix, and a CLI login or
// `via: cli:playwright-cli` with `identifiers.login_state`). A prefix is claimed once per Role, and
// one note is one account: no `login_state`, and no `(origin, identifiers.user)`, is shared between
// notes whatever their Roles. Whether the Role is in `project.roles` is `scan-integrity`'s to say.
//
// No problem on an Access note repeats a value from it: each names the field and the rule, so a
// credential pasted into the wrong field never reaches check-file's or scan's output.
//
// Its block's YAML errors are the file's `problems`: the dialect reader quotes the line it cannot
// read, and `report` withholds one that looks like a credential.
/**
 * @param {CheckContext} ctx
 * @param {{ key: string, text: string }} h
 * @param {number} headingLine
 * @param {ParsedEntry | null} entry
 * @param {AccessPrefixRegistry} param4
 * @returns {void}
 */
function checkAccessNote(ctx, h, headingLine, entry, { prefixes, accounts }) {
  if (!entry?.blockLine) {
    return ctx.report("required", h.key, `Access note \`${h.key}\` has no \`yaml\` block after its heading`, headingLine);
  }
  const a = entry.data;
  const at = (/** @type {string} */ k) => entry.keyLines[k] ?? entry.blockLine;
  const f = (/** @type {string} */ k) => `${h.key}.${k}`;
  checkRequired(ctx, a, ["match", "via", "sources", "added"], h.key, entry.blockLine);
  if (a.via !== undefined && !(typeof a.via === "string" && VIA.test(a.via))) {
    ctx.report("pattern", f("via"), `\`${f("via")}\` is \`env:NAME\`, \`mcp:name\`, \`cli:name\` or \`file:<path>\`, naming where the credential lives outside anything git tracks`, at("via"));
  } else if (typeof a.via === "string" && a.via.startsWith("file:")) {
    const urlsOnly = Array.isArray(a.match) && a.match.every((m) => typeof m === "string" && m.startsWith("url:"));
    if (!cliLoginUser(a) || !urlsOnly) {
      ctx.report("invalid", f("via"), `\`${f("via")}\` names a password file, which only the CLI reads to log in to an app: it needs \`identifiers.user\` and only \`url:\` prefixes in \`match\``, at("via"));
    }
  }
  const roleKey = a.role === undefined ? "" : typeof a.role === "string" ? a.role : "\0";
  if (a.role !== undefined) checkAccessRole(ctx, a, f("role"), at("role"));
  claimAccount(ctx, a, h.key, accounts, at("identifiers"));
  if (a.match !== undefined) {
    if (!Array.isArray(a.match) || a.match.length === 0) {
      ctx.report("shape", f("match"), `\`${f("match")}\` must be a non-empty list of \`tracker:\` or \`url:\` prefixes`, at("match"));
    } else {
      a.match.forEach((m, n) => {
        const entry = `\`${f("match")}\` entry ${n + 1}`;
        if (!isMatchPrefix(m)) {
          ctx.report("pattern", f("match"), `${entry} is not a \`tracker:\` prefix or a \`url:\` prefix naming a host`, at("match"));
        } else if (prefixes.has(`${roleKey}\n${m}`)) {
          // The longest prefix wins, so an identical one leaves no winner.
          ctx.report("duplicate", f("match"), `${entry} is a prefix \`${prefixes.get(`${roleKey}\n${m}`)}\` already matches${a.role === undefined ? "" : " for that Role"}: two notes with one prefix leave no way to choose between them`, at("match"));
        } else {
          prefixes.set(`${roleKey}\n${m}`, h.key);
        }
      });
    }
  }
  if (a.sources !== undefined) checkList(ctx, a.sources, f("sources"), at("sources"));
  if (a.added !== undefined && !isDate(a.added)) ctx.report("date", f("added"), `\`${f("added")}\` is not an ISO YYYY-MM-DD date`, at("added"));
  // Its field is the note, whatever key the credential sits under; the message says where.
  for (const s of secretsIn(a)) {
    const where = s.path ? f(s.path) : h.key;
    ctx.secretLines.add(at(s.key));
    ctx.report("secret", h.key, `\`${where}\` holds a credential (${s.why}): an Access note names where the credential lives in \`via\`, never the credential itself`, at(s.key));
  }
}
