// @ts-check
// The `.qa/` schema vocabulary: the file types, each type's known keys, the Mirrored
// fields, the train targets and entry kinds, and how a field's value is written back. The parser,
// the checker and every writer read it from here; none keeps its own copy.
import { PATTERN } from "./keys.mjs";

// `observation` (ADR-0016): a UI scout's dated record of the live application, kept in
// `.qa/observations/` and cited by a Feature as an ordinary `file:` Reference.
/** @type {readonly string[]} */
export const TYPES = ["project", "feature", "scenario", "train", "observation", "execution", "bug"];
// A mistyped history file still stays outside knowledge comparisons.
/**
 * @param {{ type?: unknown, rel: string }} file
 * @returns {boolean}
 */
export const isExecutionFile = (file) => file.type === "execution" || file.rel.startsWith("executions/");
// Bug drafts sit beside the knowledge, never in it: they load into the scan's `bugs`, not `files`.
/**
 * @param {{ type?: unknown, rel: string }} file
 * @returns {boolean}
 */
export const isBugFile = (file) => file.type === "bug" || file.rel.startsWith("bugs/");
/** @type {readonly string[]} */
export const BUG_STATUSES = ["draft", "published"];
/** @type {readonly string[]} */
export const BUG_ROUTES = ["execution-failed", "no-automation-failed", "fix-handoff"];
/** @type {readonly string[]} */
export const FINDING_KINDS = ["Conflict", "Stale", "Divergence", "OutcomeGap", "Overreach"];
/** @type {readonly string[]} */
export const SUBJECT_KINDS = ["automation", "tracker_case", "tracker_scenario", "tracker_suite"];

// An Automation run's closed vocabulary: its results, the reasons it can be Blocked, and the
// bounds of the diagnostics the record keeps. The parser writes them; `check-file` refuses others.
/** @type {readonly string[]} */
export const AUTOMATION_RESULTS = ["passed", "failed", "flaky", "blocked"];
/** @type {readonly string[]} */
export const AUTOMATION_BLOCKED_REASONS = ["no-command", "runner-error", "no-result", "skipped", "not-run"];
/** The most characters one Automation diagnostic keeps, after redaction. @type {number} */
export const AUTOMATION_DIAGNOSTIC_CAP = 600;
/** The most diagnostics one Automation entry keeps. @type {number} */
export const AUTOMATION_DIAGNOSTICS_MAX = 5;
// One ordered attempt: `passed`, `failed`, or `blocked:<one of the closed reasons>`.
/** @type {RegExp} */
export const AUTOMATION_ATTEMPT = /^(?:passed|failed|blocked:(?:no-command|runner-error|no-result|skipped|not-run))$/;
// A case block's reasons an Execution did not run, in their canonical order.
export const EXECUTION_SKIPPED = ["no-steps", "no-expected", "not-run"];

// The latest `project.md` schema this CLI reads (ADR-0027): `schema_version`, where a `project.md`
// without one is version 1. A `.qa/` declaring a newer one, or a malformed one, is refused by every
// command that writes into the repository (lib/schema-guard.mjs), and `scan` warns of a newer one.
/** @type {number} */
export const ANY_SCHEMA_VERSION = 1;
/** @type {number} */
export const MINTED_KEYS_SCHEMA_VERSION = 2;
/** @type {number} */
export const SUITE_KEYS_SCHEMA_VERSION = 3;
/** @type {number} */
export const LEVEL_ON_CASE_SCHEMA_VERSION = 4;
/** @type {number} */
export const SCHEMA_VERSION = LEVEL_ON_CASE_SCHEMA_VERSION;

/**
 * Pending schema boundaries in the order the engineer runs them. Keys and Suite keys share one
 * migration command, which establishes both boundaries before levels can move.
 * @param {number} version
 * @returns {{ version: number, command: string }[]}
 */
export function pendingMigrations(version) {
  return [
    { version: SUITE_KEYS_SCHEMA_VERSION, command: "migrate-keys" },
    { version: LEVEL_ON_CASE_SCHEMA_VERSION, command: "migrate-keys --levels" },
  ].filter((step) => version < step.version);
}
// New projects start with permanent Case, Scenario and Suite keys.
/** @type {number} */
export const INIT_SCHEMA_VERSION = SCHEMA_VERSION;
// Whether `v` is a `schema_version` at all: an integer ≥ 1.
/**
 * @param {unknown} v
 * @returns {boolean}
 */
export const isSchemaVersion = (v) => Number.isInteger(v) && /** @type {number} */ (v) >= 1;

// Each type's keys in the order a writer places them; `case` is a Test Case's block.
/**
 * @type {Record<string, readonly string[]> & {
 *   readonly project: readonly string[],
 *   readonly feature: readonly string[],
 *   readonly scenario: readonly string[],
 *   readonly train: readonly string[],
 *   readonly observation: readonly string[],
 *   readonly execution: readonly string[],
 *   readonly execution_case: readonly string[],
 *   readonly case: readonly string[],
 * }}
 */
export const KNOWN = {
  project: [
    "type", "key", "schema_version", "stack", "tracker", "annotation_map", "module_paths", "roles", "role_meaning", "tags", "retired_tags", "custom_fields", "bug_fields", "level_migrations",
    "concurrency_cap", "tiers", "scout", "targets", "execute_levels", "test_runner", "code_host", "retired_features", "automation_key_pattern", "automation_key_mint",
  ],
  feature: ["type", "key", "suite_key", "watermark", "watermark_digest", "coverage_digest", "mirror", "finding", "repairs", "retired", "formerly", "generated", "sources"],
  scenario: ["type", "key", "migrate_as", "feature", "tracker", "tracker_formerly", "mirror", "formerly", "generated", "sources"],
  train: ["type", "key"],
  observation: ["type", "observed_at", "url", "app_version", "request"],
  execution: ["type", "run", "executed_at", "target", "url", "commit", "playwright_cli", "skipped", "selection"],
  execution_case: ["automation", "key", "tracker", "feature", "result", "reason", "execution_skipped", "digest", "dirty", "review", "stale", "roles", "access", "reached", "actions", "at_login", "redacted", "created", "preconditions", "interpretations"],
  bug: [
    "type", "key", "status", "case", "feature", "case_digest", "run", "commit", "drafted_at", "route", "target", "record",
    "roles", "automations", "redacted", "tracker", "published_at",
  ],
  case: [
    "key", "migrate_as", "tracker", "tracker_formerly", "automates", "automatable", "level", "roles", "tags", "covers", "relies_on", "mirror", "mirror_fields", "mirror_field_targets", "review", "review_by",
    "finding", "formerly", "generated", "sources",
  ],
};

// The Mirrored values per type, each a tracker value or `null` when the tracker holds
// none, plus the date they were copied. The list fields (`MIRROR_LISTS`) hold a list; every other
// one a string. A list field with no value is `null`, the form `/qa-sync` writes, or `[]`, which
// the file check accepts too: the two are one value.
/**
 * @type {Record<string, readonly string[]> & {
 *   readonly case: readonly string[],
 *   readonly scenario: readonly string[],
 *   readonly feature: readonly string[],
 * }}
 */
export const MIRROR_FIELDS = {
  case: ["status", "auto_status", "roles", "summary"],
  scenario: ["suite", "summary"],
  feature: ["group"],
};
/** @type {readonly string[]} */
export const MIRROR_LISTS = ["roles"];
// Publish stores its owned fields too; old Mirrors remain valid. Prose holds lines in the dialect.
/** @type {readonly string[]} */
export const MIRROR_PROSE = ["preconditions", "steps", "expected"];
/**
 * @type {Record<string, readonly string[]> & {
 *   readonly case: readonly string[],
 * }}
 */
export const MIRROR_OPTIONAL = { case: [...MIRROR_PROSE, "level", "scenario", "tags", "tags_target"] };
// A list field with no value: absent, `null` or `[]`. It compares equal to another, and
// there is nothing in it to compare to what the knowledge layer owns.
/**
 * @param {unknown} v
 * @returns {boolean}
 */
export const noList = (v) => v === undefined || v === null || (Array.isArray(v) && v.length === 0);
// A summary as it is compared and written: every run of whitespace is one space, and the
// ends are trimmed. A tracker's summary often carries stray spaces; they are no change and no
// Divergence, and a mirror stores the summary in this form.
/**
 * @template {string | null | undefined} [T=string]
 * @param {T} s
 * @returns {string}
 */
export const oneLine = (s) => (/** @type {string} */ (s)).replace(/\s+/g, " ").trim();
// A quote is verbatim in a text when it is there word for word, however either wraps its lines:
// the one test the judge's reply check and the Finding writer share.
/** @type {(text: string, quote: string) => boolean} */
export const holdsQuote = (text, quote) => oneLine(text).includes(oneLine(quote));
/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export const sameSummary = (a, b) => oneLine(a) === oneLine(b);

// The Mirrored values always written quoted, as the backfill writes them.
/** @type {readonly string[]} */
export const QUOTED = ["status", "auto_status", "summary", "group"];

/**
 * How lib/knowledge-file.mjs's `edit` writes a field's value.
 * @typedef {{
 *   quoted?: readonly string[],
 *   blockList?: boolean,
 *   item?: string,
 *   keepEmpty?: boolean,
 * }} FieldRenderRule
 */

// How lib/knowledge-file.mjs's `edit` writes a field's value, by scope (a file's `type`, or `case`
// for a Test Case's block) and field; `*` holds what every scope shares. `quoted` names the fields
// of a map value always written quoted, `item` how a list's strings are written (`token`, or
// `role`: a token only when it is one word), and `blockList` writes a list of maps as a block list,
// one map per line. `keepEmpty` preserves a required empty list. Any other field is written on
// one line, its strings as tokens.
/**
 * @type {Record<string, Record<string, FieldRenderRule>>}
 */
export const FIELD_RENDER = {
  "*": {
    mirror: { quoted: QUOTED },
    finding: { blockList: true, quoted: ["evidence", "reason"] },
  },
  project: { roles: { item: "role" }, custom_fields: { blockList: true, quoted: ["description"] }, bug_fields: { blockList: true } },
  feature: { repairs: { blockList: true } },
  execution: { skipped: { blockList: true } },
  execution_case: { automation: { blockList: true }, roles: { item: "role", keepEmpty: true }, access: { keepEmpty: true }, preconditions: { blockList: true } },
};

// Training is one file per target (ADR-0015): `train/<key>.md`, its key from this closed
// list. `design` holds the Conventions; `access` holds the Access notes every fetching command
// reads.
/** @type {string} */
export const DESIGN_TRAIN_KEY = "design";
/** @type {string} */
export const DEEP_DIVE_TRAIN_KEY = "deep-dive";
/** @type {string} */
export const SYNC_TRAIN_KEY = "sync";
/** @type {string} */
export const INIT_TRAIN_KEY = "init";
/** @type {string} */
export const IMPACT_TRAIN_KEY = "impact";
/** @type {string} */
export const PUBLISH_TRAIN_KEY = "publish";
/** @type {string} */
export const NEXT_TRAIN_KEY = "next";
/** @type {string} */
export const ASK_TRAIN_KEY = "ask";
/** @type {string} */
export const ACCESS_TRAIN_KEY = "access";
/** @type {string} */
export const EXECUTE_TRAIN_KEY = "execute";
/** @type {string} */
export const CODEFIX_TRAIN_KEY = "codefix";
/** @type {string} */
export const CODEGEN_TRAIN_KEY = "codegen";
/** @type {string} */
export const BUG_TRAIN_KEY = "bug";
// Code gen's twelve closed facets: a stack is trained only when every one has a Convention.
/** @type {readonly string[]} */
export const CODEGEN_FACETS = ["placement", "structure", "test-naming", "key-carrier", "interaction-layer", "addressing", "fixtures", "test-data", "helpers", "waits", "assertions", "imports"];
// The facets that may carry a `signal`, each with the one id it records.
/** @type {Readonly<Record<string, string>>} */
export const CODEGEN_SIGNALS = { placement: "placement-dir", "key-carrier": "key-carrier", "test-naming": "test-naming" };
// Shared training, not a command file: the Coverage category extensions the deep dive and design
// walk. It is absent from Training status and never a Next step on its own.
/** @type {string} */
export const CATEGORIES_TRAIN_KEY = "categories";
/** @type {readonly string[]} */
export const TRAIN_KEYS = [DESIGN_TRAIN_KEY, DEEP_DIVE_TRAIN_KEY, SYNC_TRAIN_KEY, INIT_TRAIN_KEY, IMPACT_TRAIN_KEY, PUBLISH_TRAIN_KEY, NEXT_TRAIN_KEY, ASK_TRAIN_KEY, ACCESS_TRAIN_KEY, EXECUTE_TRAIN_KEY, CODEFIX_TRAIN_KEY, CODEGEN_TRAIN_KEY, BUG_TRAIN_KEY, CATEGORIES_TRAIN_KEY];

// A target renamed since it shipped: its old key, file and `/qa-train` argument still resolve
// to it, so a repo keeps its `train/fix.md` until it renames the file.
/** @type {Readonly<Record<string, string>>} */
export const LEGACY_TRAIN_KEYS = { fix: CODEFIX_TRAIN_KEY };

/**
 * The target a train key names, its legacy key resolved; the key itself otherwise.
 * @template T
 * @param {T} key
 * @returns {T | string}
 */
export const canonicalTrainKey = (key) => (typeof key === "string" && Object.hasOwn(LEGACY_TRAIN_KEYS, key) ? LEGACY_TRAIN_KEYS[key] : key);

/**
 * Whether a train file is keyed by a legacy key (`LEGACY_TRAIN_KEYS`) rather than its target's own.
 * @param {unknown} key
 * @returns {boolean}
 */
export const isLegacyTrainKey = (key) => typeof key === "string" && Object.hasOwn(LEGACY_TRAIN_KEYS, key);

/**
 * Whether a train key names a shared file rather than a command's: `access` and `categories` are
 * read by other commands and never appear as Training status commands or Next steps of their own.
 * @param {string} key
 * @returns {boolean}
 */
export const isSharedTrainKey = (key) => key === ACCESS_TRAIN_KEY || key === CATEGORIES_TRAIN_KEY;

/**
 * A train file entry descriptor by heading prefix.
 * @typedef {{
 *   prefix: string,
 *   kind: string,
 *   label: string,
 *   list: string,
 *   pattern: RegExp,
 *   target?: string,
 * }} TrainEntryDescriptor
 */

// A train file's entry kinds, by heading prefix: each `kind`, the `pattern` its key matches,
// and the `list` a parsed train file (and the scan index) keeps its entries in.
/** @type {readonly TrainEntryDescriptor[]} */
export const TRAIN_ENTRIES = [
  { prefix: "cnv_", kind: "convention", label: "Convention", list: "conventions", pattern: PATTERN.cnv },
  { prefix: "prc_", kind: "practice", label: "Practice", list: "practices", pattern: PATTERN.prc },
  { prefix: "acc_", kind: "access_note", label: "Access note", list: "access_notes", pattern: PATTERN.acc },
  { prefix: "rcp_", kind: "recipe", label: "Data recipe", list: "recipes", pattern: PATTERN.rcp, target: EXECUTE_TRAIN_KEY },
  { prefix: "act_", kind: "action", label: "API action", list: "actions", pattern: PATTERN.act, target: EXECUTE_TRAIN_KEY },
  { prefix: "upl_", kind: "upload", label: "Upload fixture", list: "uploads", pattern: PATTERN.upl, target: EXECUTE_TRAIN_KEY },
];

// The entry kind a train heading's key names, or null when it is none of them.
/**
 * @param {string} key
 * @returns {TrainEntryDescriptor | null}
 */
export const trainEntry = (key) => TRAIN_ENTRIES.find((e) => e.pattern.test(key)) ?? null;
