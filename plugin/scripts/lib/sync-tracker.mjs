// @ts-check
// The tracker side of `/qa-sync`'s card (ADR-0003, ADR-0027): Mirror refresh
// and Tracker intake, in that order, ahead of the code repairs. The tracker stays read-only: the
// skill fetches it with the agent's tracker tools and hands this module what it fetched as one
// JSON payload, so everything here is deterministic.
//
// The payload (`tracker.json` in the run dir, lib/sync.mjs), normalised by the skill from the
// tracker's own fields:
//
//   {at: "YYYY-MM-DD",                                  the date it was fetched: every `mirror.at`
//    scenarios: [{requested, current, item: {key, issue_type, mark, summary, suite}}],
//    cases: [{requested, current, item: {key, issue_type, mark, scenario, summary, status,
//             auto_status, roles, level, preconditions?, steps?, expected?}}]}
//   `requested` is the fetched key; `current` and `item.key` are the key the tracker returned.
//   Discovery and marked lists hold plain items. A plain scoped item also reports its key as
//   requested and current. Several requests may resolve to one current item when values agree.
//   `issue_type` is the item's actual tracker issue kind and `mark` the value of the configured
//   mark field (`tracker.marker_field`), each a string or null. Every fetched item carries both:
//   one left out would read as unmarked and make a published item an intake candidate.
//   `marked_cases` and `marked_scenarios` are separate project-wide lists in the same shapes when
//   the marker query is enabled; `labels` on scoped cases also identifies marks off the default
//   branch. The same mark and kind are read on each of these paths.
//   `marked_suites`: `[{key, issue_type, mark, summary?}]`. Publish's mark search includes
//   wrong-type hits; sync's marker query returns the project's marked Test Suites, for the
//   Unlanded check. Required whenever it was asked for, even when empty: an omitted list is an
//   incomplete search.
//   `suites` (optional): `[{key, issue_type, mark, summary}]` or `{key, not_found: true}`, the
//   Test Suites fetched for a Suite Attach (lib/sync-attach.mjs): the ones `sync scope` names in
//   `suite_items` and those its `suite_search` finds. Left out, no Suite is a candidate.
//   `stories` (publish runs only): `[{key, issue_type, comments: [{id, body}]}]`, one per
//   tracker Reference a Feature names, or `{key, not_found: true}`.
//
// where a scenario or case the tracker no longer holds is `{requested, not_found: true}` instead
// (nothing else is read from it): it gives `tracker_scenario_vanished` or `tracker_case_vanished`.
// A scenario or case `sync scope` named that the payload neither holds nor marks is a fetch that
// stopped short (ADR-0017): the payload is invalid, and nothing is said to have vanished,
//
// or `{error: "<why the fetch failed>", access_note?: "<acc_slug>"}`: `access_note` names the
// Access note (`train/access.md`, ADR-0015) a failed fetch went through, so the card can name it
// and its `via`; it is checked as a key (`acc_<slug>`) and null is none. A value the tracker does
// not hold is `null` (for `roles`, `[]` reads as `null`); a prose field left out means it was not
// fetched. A failed fetch, or a payload not of this shape, drops the tracker sections with a note,
// and the code repairs still run.
//
// Tracker scope, per Feature: its known scenarios and cases (found through the shared tracker
// resolver, lib/tracker-resolver.mjs, never by their Keys), the new scenarios under its suites (the
// set of `mirror.suite` values) and the cases under both. The separate marked lists are
// project-wide; other entries outside that scope are ignored.
/** @import { ConfirmedLabel, LabelDestination, LabelDestinationRequest, LabelCopies } from "./publish-labels.mjs" */
/** @import { LabelDefinitions } from "./case-labels.mjs" */
import { accessFor, trackerUri } from "./access.mjs";
import { list } from "./markdown.mjs";
import { isMap } from "./dialect.mjs";
import { labelDefinitions } from "./case-labels.mjs";
import { projectConfig } from "./knowledge-file.mjs";
import { canPublishLabels, configuredLabelDestinations, recoveredLabelCopies, sameLabelValue, managedTags, hasPublishTags, singleLabelValue } from "./publish-labels.mjs";
import { PATTERN, trackerReference } from "./keys.mjs";
import { featureFile } from "./qa-index.mjs";
import { proseLines } from "./markdown.mjs";
import { line, role } from "./render.mjs";
import { MIRROR_FIELDS, MIRROR_LISTS, noList, oneLine, QUOTED, sameSummary } from "./schema.mjs";

/**
 * A tracker scenario item as reported in tracker.json.
 * @typedef {{
 *   key: string,
 *   issue_type?: string | null,
 *   mark?: string | null,
 *   summary?: string | null,
 *   suite?: string | null,
 *   not_found?: boolean,
 *   [key: string]: unknown,
 * }} TrackerScenarioItem
 */

/**
 * A scoped scenario entry in tracker.json (requested/current/item or not_found).
 * @typedef {{
 *   requested?: string,
 *   current?: string,
 *   item?: TrackerScenarioItem,
 *   not_found?: boolean,
 *   key?: string,
 *   issue_type?: string | null,
 *   mark?: string | null,
 *   summary?: string | null,
 *   suite?: string | null,
 *   [key: string]: unknown,
 * }} TrackerScenarioRecord
 */

/**
 * A tracker case item as reported in tracker.json.
 * @typedef {{
 *   key: string,
 *   label_values?: ConfirmedLabel[],
 *   issue_type?: string | null,
 *   mark?: string | null,
 *   scenario?: string | null,
 *   summary?: string | null,
 *   status?: string | null,
 *   auto_status?: string | null,
 *   level?: string | null,
 *   roles?: string[] | null,
 *   labels?: string[],
 *   linked_issues?: TrackerLinkedIssue[],
 *   preconditions?: string | null,
 *   steps?: string | null,
 *   expected?: string | null,
 *   not_found?: boolean,
 *   [key: string]: unknown,
 * }} TrackerCaseItem
 */

/**
 * One issue linked to a fetched Test Case (`issuelinks`). `direction` is `outward` when the linked
 * issue sat in `outwardIssue` on the case's link entry, `inward` when it sat in `inwardIssue`.
 * @typedef {{
 *   key: string,
 *   issue_type?: string | null,
 *   status?: string | null,
 *   status_category?: string | null,
 *   summary?: string | null,
 *   links: Array<{ link_type: string, direction: "outward" | "inward" }>,
 * }} TrackerLinkedIssue
 */

/**
 * A Bug-shaped tracker item: a bug created from a Bug draft, found by its mark, or fetched by
 * Tracker key for its status.
 * @typedef {{
 *   key: string,
 *   issue_type?: string | null,
 *   status?: string | null,
 *   status_category?: string | null,
 *   summary?: string | null,
 *   not_found?: boolean,
 *   [key: string]: unknown,
 * }} TrackerBugItem
 */

/**
 * A scoped case entry in tracker.json (requested/current/item or not_found).
 * @typedef {{
 *   requested?: string,
 *   current?: string,
 *   item?: TrackerCaseItem,
 *   label_values?: ConfirmedLabel[],
 *   not_found?: boolean,
 *   key?: string,
 *   issue_type?: string | null,
 *   mark?: string | null,
 *   scenario?: string | null,
 *   summary?: string | null,
 *   status?: string | null,
 *   auto_status?: string | null,
 *   level?: string | null,
 *   roles?: string[] | null,
 *   labels?: string[],
 *   preconditions?: string | null,
 *   steps?: string | null,
 *   expected?: string | null,
 *   [key: string]: unknown,
 * }} TrackerCaseRecord
 */

/**
 * A tracker suite item as reported in tracker.json.
 * @typedef {{
 *   key: string,
 *   issue_type?: string | null,
 *   mark?: string | null,
 *   summary?: string | null,
 *   not_found?: boolean,
 *   [key: string]: unknown,
 * }} TrackerSuiteItem
 */

/**
 * A tracker story item as reported in tracker.json.
 * @typedef {{
 *   key: string,
 *   issue_type?: string | null,
 *   comments?: Array<{ id: string, body: string }>,
 *   not_found?: boolean,
 *   [key: string]: unknown,
 * }} TrackerStoryItem
 */

/**
 * The tracker.json payload contract.
 * @typedef {{
 *   at?: string,
 *   label_destinations?: LabelDestination[],
 *   error?: unknown,
 *   access_note?: string | null,
 *   scenarios?: TrackerScenarioRecord[],
 *   cases?: TrackerCaseRecord[],
 *   marked_scenarios?: TrackerScenarioItem[],
 *   marked_cases?: TrackerCaseItem[],
 *   marked_suites?: TrackerSuiteItem[],
 *   marked_bugs?: TrackerBugItem[],
 *   bug_statuses?: TrackerBugItem[],
 *   suites?: TrackerSuiteItem[],
 *   stories?: TrackerStoryItem[],
 * }} TrackerPayload
 */

/**
 * @typedef {{
 *   code: string,
 *   message: string,
 *   why?: string,
 *   error?: string,
 *   access_note?: string,
 *   [key: string]: unknown,
 * }} TrackerNote
 */

/**
 * @typedef {{
 *   ok: true,
 *   at: string,
 *   scenarios: Map<string, TrackerScenarioItem>,
 *   cases: Map<string, TrackerCaseItem>,
 *   requests: {
 *     scenarios: Map<string, string | null>,
 *     cases: Map<string, string | null>,
 *   },
 *   markedCases: Map<string, TrackerCaseItem>,
 *   markedScenarios: Map<string, TrackerScenarioItem>,
 *   markedSuites: Map<string, TrackerSuiteItem>,
 *   markedBugs: Map<string, TrackerBugItem>,
 *   bugStatuses: Map<string, TrackerBugItem>,
 *   suites: Map<string, TrackerSuiteItem>,
 *   suitesNotFound: Set<string>,
 *   stories: Map<string, TrackerStoryItem>,
 *   label_destinations: LabelDestination[],
 * } | {
 *   ok: false,
 *   note: TrackerNote | null,
 *   at?: undefined,
 * }} TrackerState
 */

/**
 * @typedef {{
 *   code: string,
 *   feature: string,
 *   file: string,
 *   line: number,
 *   key: string,
 *   tracker: string,
 *   message: string,
 *   current?: string,
 *   knowledge?: string,
 *   mirror?: string | null,
 *   [key: string]: unknown,
 * }} TrackerDivergence
 */

/**
 * @typedef {{
 *   code: string,
 *   kind?: "case" | "scenario",
 *   feature: string,
 *   file?: string,
 *   line?: number,
 *   key?: string,
 *   tracker?: string,
 *   current?: string,
 *   tracker_formerly?: string[],
 *   changes?: Record<string, { from: unknown, to: unknown }>,
 *   diverges?: string[],
 *   mirror?: Record<string, unknown>,
 *   mirror_fields?: LabelCopies["mirror_fields"],
 *   mirror_field_targets?: LabelCopies["mirror_field_targets"],
 *   mirrors?: Array<{ kind: "case" | "scenario", file: string, line: number, key: string }>,
 *   at?: string,
 *   edits: string[],
 *   message: string,
 *   n?: number | string,
 *   [key: string]: unknown,
 * }} RefreshItem
 */

/**
 * @typedef {{
 *   code: "intake_scenario",
 *   feature: string | null,
 *   key: string,
 *   summary: string,
 *   suite?: string | null,
 *   candidates?: string[],
 *   needs: string[],
 *   edits: string[],
 *   message: string,
 *   permanent_key?: string,
 *   n?: number | string,
 *   [key: string]: unknown,
 * } | {
 *   code: "intake_case",
 *   feature: string | null,
 *   scenario?: string | null,
 *   key: string,
 *   summary: string,
 *   file: string | null,
 *   level: string | null,
 *   tracker_level?: string | null,
 *   roles?: string[],
 *   unknown_roles?: string[],
 *   automatable?: boolean,
 *   automates?: string[],
 *   mirror: { roles?: string[], at?: string, [key: string]: unknown },
 *   requires?: unknown,
 *   needs: string[],
 *   edits: string[],
 *   message: string,
 *   permanent_key?: string,
 *   n?: number | string,
 *   [key: string]: unknown,
 * }} IntakeItem
 */

/**
 * @typedef {{
 *   tracker: TrackerState,
 *   requireMarks?: boolean,
 *   requireSuites?: boolean,
 *   unlanded?: { query?: unknown, suite_query?: unknown, [key: string]: unknown },
 *   feature?: string,
 *   named?: Record<string, string>,
 *   tracker_scope?: { scenarios: string[], suites: string[], cases: string[] },
 *   root: string,
 *   seed?: number,
 *   trackerAnalysis?: ReturnType<typeof analyse>,
 *   trackerFacts?: ReturnType<typeof facts>,
 *   config: {
 *     trackerPattern?: RegExp,
 *     autPattern?: RegExp,
 *     levels: Set<string>,
 *     roles: Set<string>,
 *     [key: string]: unknown,
 *   },
 *   scan: {
 *     results: Array<{
 *       kind: string,
 *       code: string,
 *       key?: string,
 *       automation?: string,
 *       annotation?: unknown,
 *       [key: string]: unknown,
 *     }>,
 *   },
 *   files: Array<{
 *     rel: string,
 *     type: string,
 *     unreadable?: boolean,
 *     frontmatterLine?: number,
 *     h1?: { text: string },
 *     data: Record<string, unknown> & { key?: string, mirror?: Record<string, unknown> },
 *     cases: Array<{ key: string, summary?: string, data: Record<string, unknown> & { roles?: string[], mirror?: Record<string, unknown> }, keyLines: Record<string, number | undefined>, blockLine?: number, line: number }>,
 *     keyLines: Record<string, number | undefined>,
 *     blockLine?: number,
 *     line?: number,
 *     [key: string]: unknown,
 *   }>,
 *   index: {
 *     features: Map<string, Array<{ feature?: string, file: { rel: string, h1?: { text: string }, data: Record<string, unknown>, dir?: string } }>>,
 *     scenarios: Map<string, Array<{ feature: string, file: { rel: string, h1?: { text: string }, data: Record<string, unknown>, cases: Array<{ data: Record<string, unknown> }> } }>>,
 *     cases: Map<string, Array<{ feature: string, file: { rel: string }, entry: { summary: string, data: Record<string, unknown> } }>>,
 *     suites: Map<string, Array<{ feature: string }>>,
 *     featureOf(file: unknown): string | undefined,
 *     project?: { rel: string, data: { tracker?: { tag_field?: string, marker_label?: string, marker_field?: string, suite_type?: string, case_type?: string, scenario_type?: string, [key: string]: unknown }, [key: string]: unknown } },
 *     tracker: {
 *       current(kind: string, key: string): string | null,
 *       resolve(key: string): { status: string },
 *     },
 *     [key: string]: unknown,
 *   },
 *   [key: string]: unknown,
 * }} SyncTrackerContext
 */

/**
 * @typedef {{
 *   claim(key: string, item?: unknown): { code: string, [key: string]: unknown } | null,
 *   permanentKey(kind: string, reuse?: string): { key: string, error?: never } | { error: string, key?: never },
 *   createQa(rel: string, text: string, item?: unknown): void,
 *   append(rel: string, text: string): void,
 *   placed: Map<string, string>,
 *   intaken: Array<{ kind: string, key: string, tracker: string, reused: boolean }>,
 *   set(ref: { file: string, key?: string }, field: string, value: unknown): void,
 *   [key: string]: unknown,
 * }} SyncTrackerPlan
 */

/**
 * @typedef {{
 *   lines: string[],
 *   error?: never,
 * } | {
 *   error: string,
 *   lines?: never,
 * }} YamlLineResult
 */

/**
 * @typedef {{
 *   text: string,
 *   error?: never,
 * } | {
 *   error: string,
 *   text?: never,
 *   value?: string,
 * }} FrontmatterResult
 */

/**
 * @typedef {{
 *   files: Array<SyncTrackerContext["files"][0]>,
 *   known: string[],
 *   suites: Set<string>,
 *   cases: string[],
 * }} PerFeatureFacts
 */

/**
 * @typedef {{
 *   key: "refresh",
 *   title: "Mirror refresh",
 *   codes: string[],
 *   tracker: true,
 *   items: (ctx: SyncTrackerContext) => RefreshItem[],
 *   apply: (ctx: SyncTrackerContext, item: RefreshItem, plan: SyncTrackerPlan) => { code: string, [key: string]: unknown } | null,
 * }} RefreshSection
 */

/**
 * @typedef {{
 *   key: "intake",
 *   title: "Tracker intake",
 *   codes: string[],
 *   tracker: true,
 *   info: (ctx: SyncTrackerContext) => Record<string, unknown>,
 *   items: (ctx: SyncTrackerContext) => IntakeItem[],
 *   apply: (ctx: SyncTrackerContext, item: IntakeItem, plan: SyncTrackerPlan) => { code: string, [key: string]: unknown } | null,
 * }} IntakeSection
 */

// ---------------------------------------------------------------------------------------------
// The payload.

/** @param {unknown} v */
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
/** @param {unknown} v */
const strOrNull = (v) => v === null || typeof v === "string";
const PROSE = [
  ["preconditions", "Preconditions"],
  ["steps", "Steps"],
  ["expected", "Expected result"],
];
const FIELDS = {
  scenario: ["key", "issue_type", "mark", "summary", "suite"],
  case: ["key", "issue_type", "mark", "scenario", "summary", "status", "auto_status", "roles", "level"],
};
const MARK_FIELDS = ["issue_type", "mark"];

// The traced label identities a fetch resolved, or none when it left them out.
/**
 * @param {unknown} value
 * @returns {LabelDestination[]}
 */
const readLabelDestinations = (value) => (Array.isArray(value) ? value.filter(isMap).map((destination) => ({
  name: typeof destination.name === "string" ? destination.name : "",
  fields: (Array.isArray(destination.fields) ? destination.fields : [])
    .filter((field) => isMap(field) && typeof field.id === "string" && (field.cardinality === "single" || field.cardinality === "multiple"))
    .map((field) => ({ id: /** @type {string} */ (field.id), cardinality: /** @type {"single" | "multiple"} */ (field.cardinality) })),
})) : []);

// The kind (`case`/`scenario`) the project's configured issue types give `issueType`, or null.
/**
 * @param {{ index: { project?: { data: { tracker?: { case_type?: string, scenario_type?: string, [key: string]: unknown }, [key: string]: unknown } } } }} ctx
 * @param {unknown} issueType
 * @returns {"case" | "scenario" | null}
 */
export function kindOfType(ctx, issueType) {
  const tracker = ctx.index.project?.data.tracker;
  if (typeof issueType !== "string") return null;
  if (tracker?.case_type === issueType) return "case";
  if (tracker?.scenario_type === issueType) return "scenario";
  return null;
}

// Whether a fetched item carries a non-blank mark.
/**
 * @param {{ mark?: unknown, [key: string]: unknown }} e
 * @returns {e is { mark: string, [key: string]: unknown }}
 */
export const hasMark = (e) => typeof e.mark === "string" && e.mark.trim() !== "";

// Whether a fetched item is a Bug rather than a Test Case, Scenario or Suite: its issue type is the
// configured bug type, or its mark is a `bg_` Key. `/qa-sync` and the Unlanded check leave it alone.
/**
 * @param {{ index: { project?: { data: { tracker?: { bug_type?: string, [key: string]: unknown }, [key: string]: unknown } } } }} ctx
 * @param {{ issue_type?: unknown, mark?: unknown }} item
 * @returns {boolean}
 */
export function isBugItem(ctx, item) {
  const bugType = ctx.index.project?.data.tracker?.bug_type;
  if (typeof bugType === "string" && bugType.trim() && item.issue_type === bugType) return true;
  return typeof item.mark === "string" && PATTERN.bug.test(item.mark.trim());
}

// The tracker as `ctx.tracker`: `{ok: true, at, scenarios: Map, cases: Map, requests, markedCases: Map,
// markedScenarios: Map, markedSuites: Map, suites: Map, suitesNotFound: Set, stories: Map}` or `{ok: false, note}` (`note` null when the project has no
// tracker, so nothing is missing). `ctx.requireMarks === false` lets a payload leave `issue_type`
// and `mark` out: publish reads it that way until it carries marks; sync always requires them.
// Item maps use current keys. `requests.cases` and `requests.scenarios` map each requested key to
// its current key, or null for not_found. Completeness checks requests, never current keys.
/**
 * @param {SyncTrackerContext} ctx
 * @param {string | null | undefined} text
 * @returns {TrackerState}
 */
export function readTracker(ctx, text) {
  const marks = ctx.requireMarks !== false;
  if (!isMap(ctx.index.project?.data.tracker)) return { ok: false, note: null };
  /**
   * @param {string} code
   * @param {string} why
   * @param {Record<string, unknown>} [extra]
   * @returns {TrackerState}
   */
  const skipped = (code, why, extra = {}) => ({ ok: false, note: { code, message: `${why}: the tracker sections are skipped`, ...extra } });
  if (text === null || text === undefined) return skipped("tracker_not_fetched", "no tracker payload was given");
  /**
   * @param {string} why
   * @returns {TrackerState}
   */
  const invalid = (why) => skipped("tracker_payload_invalid", `the tracker payload is not the fetched shape (${why})`, { why });
  /** @type {TrackerPayload} */
  let p;
  try {
    p = JSON.parse(text);
  } catch (e) {
    return invalid(`not JSON: ${/** @type {{ message: string }} */ (e).message}`);
  }
  if (!isMap(p)) return invalid("not a JSON object");
  if (p.error !== undefined) {
    // The Access note the fetch went through (ADR-0015), so the card can name it; null is none.
    const through = p.access_note ?? null;
    if (through !== null && !(typeof through === "string" && PATTERN.acc.test(through))) return invalid("`access_note` must be an Access note key (`acc_<slug>`)");
    return skipped("tracker_fetch_failed", `the tracker fetch failed: ${String(p.error)}`, { error: String(p.error), ...(through !== null && { access_note: through }) });
  }
  const pattern = ctx.config.trackerPattern;
  if (!pattern) return invalid("`project.md`'s `tracker.key_pattern` does not compile");
  const problems = [];
  if (!isDate(p.at)) problems.push("`at` must be the ISO date of the fetch");
  // `marked` collects a list's entries carrying the not-found marker (one the tracker no longer
  // holds).
  /** @type {Record<string, Map<string, string | null>> & { scenarios: Map<string, string | null>, cases: Map<string, string | null> }} */
  const requests = { scenarios: new Map(), cases: new Map() };
  /**
   * @template {{ key: string }} T
   * @param {keyof TrackerPayload} name
   * @param {(e: T) => string | null} check
   * @param {Set<string>} marked
   * @returns {Map<string, T>}
   */
  const entries = (name, check, marked) => {
    const map = new Map();
    if (!Array.isArray(p[name])) {
      problems.push(`\`${name}\` must be a list`);
      return map;
    }
    /** @type {Array<Record<string, unknown>>} */ (p[name]).forEach((record, i) => {
      let e = record;
      let requested;
      if (requests[name]) {
        // Scoped lists are answers to requests: `{requested, current, item}` or `{requested, not_found: true}`.
        requested = isMap(record) ? record.requested : undefined;
        if (typeof requested !== "string" || !pattern.test(requested)) return problems.push(`${name}[${i}] has no tracker \`requested\` key`);
        if (requests[name].has(requested)) return problems.push(`${requested} is listed twice`);
        if (record.not_found !== undefined) {
          if (record.not_found !== true) return problems.push(`${requested}: \`not_found\` must be true`);
          if (record.current !== undefined || record.item !== undefined) return problems.push(`${requested}: \`not_found\` cannot carry \`current\` or \`item\``);
          requests[name].set(requested, null);
          marked.add(requested);
          return;
        }
        if (typeof record.current !== "string" || !pattern.test(record.current) || !isMap(record.item) || record.item.key !== record.current) return problems.push(`${requested}: \`current\` must match the fetched item's tracker \`key\``);
        if (record.item.not_found !== undefined) return problems.push(`${requested}: a fetched \`item\` cannot be \`not_found\``);
        e = record.item;
      }
      if (!isMap(e) || typeof e.key !== "string" || !pattern.test(e.key)) return problems.push(`${name}[${i}] has no tracker \`key\``);
      if (!requests[name] && (map.has(e.key) || marked.has(e.key))) return problems.push(`${e.key} is listed twice`);
      if (e.not_found !== undefined) {
        if (e.not_found !== true) return problems.push(`${e.key}: \`not_found\` must be true`);
        marked.add(e.key);
        return;
      }
      const bad = check(/** @type {T} */ (e));
      if (bad) return problems.push(`${e.key}: ${bad}`);
      const other = map.get(e.key);
      if (other && Object.keys({ ...other, ...e }).some((field) => !sameValue(field, other[field], e[field]))) return problems.push(`${e.key} has conflicting fetched values`);
      requests[name]?.set(/** @type {string} */ (requested), e.key);
      map.set(e.key, /** @type {T} */ (e));
    });
    return map;
  };
  /** @param {Record<string, unknown>} e @param {string[]} fields */
  const scalars = (e, fields) => fields.find((f) => e[f] === undefined || !strOrNull(e[f]));
  // The item's kind and mark: each a string or null, and present on every fetched item once marks
  // are required.
  /** @param {Record<string, unknown>} e */
  const markFault = (e) => {
    const f = MARK_FIELDS.find((name) => (e[name] === undefined ? marks : !strOrNull(e[name])));
    return f ? `\`${f}\` must be a string or null` : null;
  };
  const notFound = { scenarios: new Set(), cases: new Set(), suites: new Set() };
  /** @param {TrackerScenarioItem} e */
  const checkScenario = (e) => {
    const f = scalars(e, ["summary", "suite"]);
    return f ? `\`${f}\` must be a string or null` : markFault(e);
  };
  const scenarios = entries("scenarios", checkScenario, notFound.scenarios);
  const project = ctx.index.project?.data ?? {};
  const definitions = labelDefinitions(project);
  const destinations = configuredLabelDestinations(definitions, project.tracker ?? {});
  /** @param {TrackerCaseItem} e */
  const checkCase = (e) => {
    const f = scalars(e, ["scenario", "summary", "status", "auto_status", "level"]);
    if (f) return `\`${f}\` must be a string or null`;
    const bad = markFault(e);
    if (bad) return bad;
    if (e.roles === undefined || (e.roles !== null && (!Array.isArray(e.roles) || e.roles.some((r) => typeof r !== "string")))) return "`roles` must be a list of strings or null";
    if (e.labels !== undefined && (!Array.isArray(e.labels) || e.labels.some((label) => typeof label !== "string"))) return "`labels` must be a list of strings";
    if (e.linked_issues !== undefined) {
      if (!Array.isArray(e.linked_issues)) return "`linked_issues` must be a list";
      for (const issue of e.linked_issues) {
        if (!isMap(issue) || typeof issue.key !== "string" || !pattern.test(issue.key)) return "`linked_issues` needs a tracker `key` on every entry";
        const record = /** @type {Record<string, unknown>} */ (issue);
        const field = ["issue_type", "status", "status_category", "summary"].find((name) => record[name] !== undefined && !strOrNull(record[name]));
        if (field) return `linked issue ${issue.key}: \`${field}\` must be a string or null`;
        if (!Array.isArray(issue.links) || issue.links.some((link) => !isMap(link) || typeof link.link_type !== "string" || (link.direction !== "outward" && link.direction !== "inward"))) return `linked issue ${issue.key}: \`links\` must be a list of {link_type, direction}`;
      }
    }
    if (e.labels !== undefined) e.labels = [...new Set(e.labels)].sort();
    if (e.label_values !== undefined) {
      if (!Array.isArray(e.label_values)) return "`label_values` must be a list of observations";
      const seen = new Set();
      /** @type {ConfirmedLabel[]} */
      const normalized = [];
      for (const observation of e.label_values) {
        if (!isMap(observation) || typeof observation.id !== "string" || seen.has(observation.id)) return "`label_values` needs distinct observation ids";
        seen.add(observation.id);
        const field = definitions.customFields.find((f) => observation.id === `label:field:${f.name}`);
        const name = observation.id === "label:tags" ? project.tracker?.tag_field : field?.tracker_field;
        const destination = destinations.find((d) => d.name === name);
        if (!destination || observation.destination !== name || observation.kind !== (observation.id === "label:tags" ? "tags" : "custom_field")) return "`label_values` has an unconfigured id, kind or destination";
        const value = observation.value;
        if (destination.cardinality === "multiple") {
          if (value !== null && (!Array.isArray(value) || value.some((v) => typeof v !== "string"))) return "a multiple `label_values` observation must be a string list or null";
          const values = [...new Set(/** @type {string[]} */ (value ?? []))].sort();
          const managed = new Set(managedTags(definitions));
          const tags = observation.kind === "tags" && name === "labels" ? values.filter((v) => managed.has(v)) : values;
          normalized.push({ id: observation.id, kind: observation.kind, destination: observation.destination, value: tags });
        } else {
          if (value !== null && typeof value !== "string" && !(Array.isArray(value) && !value.length)) return "a single `label_values` observation must be a string or empty";
          normalized.push({ id: observation.id, kind: "custom_field", destination: observation.destination, value: singleLabelValue(value) });
        }
      }
      e.label_values = normalized.sort((a, b) => a.id.localeCompare(b.id));
      const tags = e.label_values.find((v) => v.kind === "tags" && v.destination === "labels");
      if (tags && e.labels !== undefined) {
        const actual = recoveredLabelCopies({ labels: e.labels }, definitions, project.tracker ?? {}).mirror?.tags;
        if (!sameLabelValue("multiple", tags.value, actual ?? [])) return "`labels` and `label_values` have conflicting managed Tags";
      }
    }
    const prose = PROSE.find(([k]) => e[k] !== undefined && !strOrNull(e[k]));
    return prose ? `\`${prose[0]}\` must be a string or null` : null;
  };
  const cases = entries("cases", checkCase, notFound.cases);
  // A publish run's stories: each Reference's issue type and comments, or not_found.
  /** @param {TrackerStoryItem} e */
  const checkStory = (e) => {
    if (e.issue_type !== undefined && !strOrNull(e.issue_type)) return "`issue_type` must be a string or null";
    return !Array.isArray(e.comments) || e.comments.some((c) => !isMap(c) || typeof c.id !== "string" || typeof c.body !== "string") ? "`comments` must be a list of {id, body}" : null;
  };
  /** @param {TrackerSuiteItem} e */
  const checkSuite = (e) => (e.summary === undefined || !strOrNull(e.summary) ? "`summary` must be a string or null" : markFault(e));
  const suites = p.suites === undefined ? new Map() : entries("suites", checkSuite, notFound.suites);
  const stories = p.stories === undefined ? new Map() : entries("stories", checkStory, new Set());
  // The project-wide marked lists are required whenever the marker query is on: a fetch that
  // stopped short must not read as nothing Unlanded.
  const markedMissing = new Set();
  const query = Boolean(ctx.unlanded?.query);
  const markedCases = p.marked_cases === undefined && !query ? new Map() : entries("marked_cases", checkCase, markedMissing);
  /** @param {Record<string, unknown>} e */
  const checkMarkedSuite = (e) => (e.summary !== undefined && !strOrNull(e.summary) ? "`summary` must be a string or null" : markFault(e));
  const markedSuites = p.marked_suites === undefined && !ctx.requireSuites && !ctx.unlanded?.suite_query ? new Map() : entries("marked_suites", checkMarkedSuite, markedMissing);
  const markedScenarios = p.marked_scenarios === undefined && !query ? new Map() : entries("marked_scenarios", checkScenario, markedMissing);
  // Bug-shaped lists: the mark search's `marked_bugs` and the statuses of local published bugs.
  // Neither answers a scoped request, and `not_found` is allowed only on `bug_statuses`.
  /**
   * @param {keyof TrackerPayload} name
   * @param {boolean} allowNotFound
   * @returns {Map<string, TrackerBugItem>}
   */
  const bugEntries = (name, allowNotFound) => {
    const map = new Map();
    if (p[name] === undefined) return map;
    if (!Array.isArray(p[name])) {
      problems.push(`\`${name}\` must be a list`);
      return map;
    }
    /** @type {Array<Record<string, unknown>>} */ (p[name]).forEach((record, i) => {
      if (!isMap(record) || typeof record.key !== "string" || !pattern.test(record.key)) return problems.push(`${name}[${i}] has no tracker \`key\``);
      if (map.has(record.key)) return problems.push(`${record.key} is listed twice`);
      if (record.not_found !== undefined) {
        if (!allowNotFound) return problems.push(`${record.key}: \`not_found\` is not allowed in \`${name}\``);
        if (record.not_found !== true) return problems.push(`${record.key}: \`not_found\` must be true`);
        map.set(record.key, { key: record.key, not_found: true });
        return;
      }
      const field = ["issue_type", "status", "status_category", "summary"].find((entry) => record[entry] !== undefined && !strOrNull(record[entry]));
      if (field) return problems.push(`${record.key}: \`${field}\` must be a string or null`);
      map.set(record.key, /** @type {TrackerBugItem} */ (record));
    });
    return map;
  };
  const markedBugs = bugEntries("marked_bugs", false);
  const bugStatuses = bugEntries("bug_statuses", true);
  // A scoped item is marked too when its label or its mark field says so.
  const marker = (/** @type {{ data: { tracker: { marker_label: string } } }} */ (ctx.index.project)).data.tracker.marker_label;
  for (const [key, tc] of cases) if (((marker && tc.labels?.includes(marker)) || hasMark(tc)) && !markedCases.has(key)) markedCases.set(key, tc);
  for (const [key, ts] of scenarios) if (hasMark(ts) && !markedScenarios.has(key)) markedScenarios.set(key, ts);
  for (const [name, marked, held, fields] of /** @type {Array<[string, ReadonlyMap<string, Record<string, unknown>>, ReadonlyMap<string, Record<string, unknown>>, string[]]>} */ ([["cases", markedCases, cases, [...FIELDS.case, ...PROSE.map(([field]) => field), "labels", "label_values"]], ["scenarios", markedScenarios, scenarios, FIELDS.scenario]])) {
    for (const [key, item] of marked) {
      const other = held.get(key);
      if (other && fields.some((field) => (field === "label_values" || (item[field] !== undefined && other[field] !== undefined)) && !sameValue(field, item[field], other[field]))) problems.push(`${key} has conflicting values in \`${name}\` and \`marked_${name}\``);
    }
  }
  // A marked Suite's key must agree with any case or scenario list holding the same key.
  for (const [key, item] of markedSuites) {
    for (const other of [cases, scenarios, markedCases, markedScenarios, suites]) {
      const held = other.get(key);
      if (held && MARK_FIELDS.some((field) => held[field] !== item[field])) problems.push(`${key} has conflicting kind or mark across lists`);
    }
  }
  if (markedMissing.size) problems.push("a marked list contains a not-found marker instead of a marked item");
  if (problems.length) return invalid(problems.slice(0, 5).join("; ") + (problems.length > 5 ? `; and ${problems.length - 5} more` : ""));
  // A fetch that stopped short leaves scenarios or cases out; one is held only when fetched or
  // marked.
  const scope = scopeSets(ctx);
  const counts = [];
  const missing = [];
  for (const [name, noun] of /** @type {Array<["scenarios" | "cases", string]>} */ ([["scenarios", "Test Scenario"], ["cases", "Test Case"]])) {
    const scoped = [...scope[name]].sort(byKey);
    const left = scoped.filter((key) => !requests[name].has(key));
    if (left.length) counts.push(`${left.length} of the ${scoped.length} ${noun}${scoped.length === 1 ? "" : "s"}`);
    missing.push(...left);
  }
  if (missing.length) {
    const shown = missing.length > 5 ? [...missing.slice(0, 5), `${missing.length - 5} more`] : missing;
    return invalid(`leaves out ${counts.join(" and ")} to fetch, ${list(shown)}: fetch what is missing, or mark each one the tracker no longer holds as \`not_found\``);
  }
  return { ok: true, at: /** @type {string} */ (p.at), scenarios, cases, requests, markedCases, markedScenarios, markedSuites, markedBugs, bugStatuses, suites, suitesNotFound: notFound.suites, stories, label_destinations: readLabelDestinations(p.label_destinations) };
}

// ---------------------------------------------------------------------------------------------
// The analysis every tracker section reads, computed once per card.

const CANCELED = /^cancell?ed$/i;
/** @param {string} a @param {string} b */
const byKey = (a, b) => a.localeCompare(b, "en", { numeric: true });
/** @param {unknown[]} a @param {unknown[]} b */
const sameSet = (a, b) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;
/** @param {unknown} v */
const stringsIn = (v) => (Array.isArray(v) ? v.filter((k) => typeof k === "string") : []);

// Whether two values of Mirrored field `field` are the same: lists as sets, summaries by
// `sameSummary`, any other as it is. What counts as one value is `noList` and `oneLine`'s, in
// lib/schema.mjs.
/**
 * @param {string} field
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
const sameValue = (field, a, b) =>
  MIRROR_LISTS.includes(field)
    ? (noList(a) && noList(b)) || (Array.isArray(a) && Array.isArray(b) && sameSet(a, b))
    : field === "summary" && typeof a === "string" && typeof b === "string"
      ? sameSummary(a, b)
      : JSON.stringify(a) === JSON.stringify(b);

// The Mirrored values of one tracker entry of `kind`, in the order a mirror is written, before
// `at`. The payload names each field as the mirror does (lib/schema.mjs's MIRROR_FIELDS); a
// list field with no value is `null`, and a summary is written as `oneLine` has it.
/**
 * @param {"case" | "scenario"} kind
 * @param {Record<string, unknown>} e
 * @returns {Record<string, unknown>}
 */
const mirrored = (kind, e) =>
  Object.fromEntries(
    MIRROR_FIELDS[kind].map((f) => [f, MIRROR_LISTS.includes(f) && noList(e[f]) ? null : f === "summary" && typeof e[f] === "string" ? oneLine(e[f]) : e[f]]),
  );

// The `.qa/` file at `rel`, as the card read it.
/**
 * @param {SyncTrackerContext} ctx
 * @param {string} rel
 */
const fileAt = (ctx, rel) => ctx.files.find((f) => f.rel === rel);

/**
 * @param {SyncTrackerContext} ctx
 * @returns {{
 *   refresh: RefreshItem[],
 *   restamp: Map<string, Array<{ kind: "case" | "scenario", file: string, line: number, key: string }>>,
 *   divergences: TrackerDivergence[],
 *   intake: IntakeItem[],
 *   canceled: string[],
 *   unsummarised: string[],
 * }}
 */
function analyse(ctx) {
  if (ctx.trackerAnalysis) return ctx.trackerAnalysis;
  const k = facts(ctx);
  /** @type {ReturnType<typeof analyse>} */
  const out = { refresh: [], restamp: new Map(), divergences: [], intake: [], canceled: [], unsummarised: [] };
  for (const F of k.features) refreshFeature(ctx, out, F);
  for (const F of k.features) intakeFeature(ctx, out, F, k);
  return (ctx.trackerAnalysis = out);
}

// The facts about `.qa/` every section shares: the Features in scope, each one's scenario files,
// known scenarios and cases (by their tracker keys, through the shared resolver) and suites.
/**
 * @param {SyncTrackerContext} ctx
 * @returns {{
 *   suiteFeatures: Map<string, Set<string>>,
 *   perFeature: Map<string, { files: Array<SyncTrackerContext["files"][0]>, known: string[], suites: Set<string>, cases: string[] }>,
 *   features: string[],
 * }}
 */
function facts(ctx) {
  if (ctx.trackerFacts) return ctx.trackerFacts;
  // Suite → the Features whose scenarios name it, across all of `.qa/`.
  /** @type {Map<string, Set<string>>} */
  const suiteFeatures = new Map();
  /** @type {Map<string, { files: Array<SyncTrackerContext["files"][0]>, known: string[], suites: Set<string>, cases: string[] }>} */
  const perFeature = new Map();
  for (const f of ctx.files) {
    if (f.unreadable || f.type !== "scenario") continue;
    const F = ctx.index.featureOf(f);
    if (!F || !ctx.index.features.has(F)) continue;
    if (!perFeature.has(F)) perFeature.set(F, { files: [], known: [], suites: new Set(), cases: [] });
    const s = /** @type {{ files: Array<SyncTrackerContext["files"][0]>, known: string[], suites: Set<string>, cases: string[] }} */ (perFeature.get(F));
    s.files.push(f);
    const scenarioTracker = ctx.index.tracker.current("scenario", /** @type {string} */ (f.data.key));
    if (scenarioTracker) s.known.push(scenarioTracker);
    for (const suite of [f.data.mirror?.suite, featureFile(ctx.index, F)?.data.mirror?.suite].filter((v) => typeof v === "string")) {
      s.suites.add(suite);
      if (!suiteFeatures.has(suite)) suiteFeatures.set(suite, new Set());
      /** @type {Set<string>} */ (suiteFeatures.get(suite)).add(F);
    }
    for (const c of f.cases) {
      const tracker = ctx.index.tracker.current("case", c.key);
      if (tracker) s.cases.push(tracker);
    }
  }
  const features = (ctx.feature ? [ctx.feature] : [...perFeature.keys()].sort()).filter((F) => perFeature.has(F));
  return (ctx.trackerFacts = { suiteFeatures, perFeature, features });
}

// ---- Mirror refresh -------------------------------------------------------------------------

// Copies whose configured destination no longer matches: clearing the target makes them unknown
// again if the destination is re-enabled. The copied values themselves stay.
/**
 * @param {Record<string, unknown>} data
 * @param {LabelDefinitions} definitions
 * @param {{ tag_field?: string }} mapping
 * @param {LabelCopies} copies The copies this fetch observed, which already carry the current target.
 * @returns {{ tags: boolean, fields: string[] }}
 */
function staleLabelTargets(data, definitions, mapping, copies) {
  const mirror = isMap(data.mirror) ? data.mirror : {};
  const targets = isMap(data.mirror_field_targets) ? data.mirror_field_targets : {};
  const observed = copies.mirror_field_targets ?? {};
  return {
    tags: typeof mirror.tags_target === "string" && !hasPublishTags(mapping) && copies.mirror?.tags_target === undefined,
    fields: Object.entries(targets).flatMap(([name, target]) => {
      if (observed[name] !== undefined) return [];
      const field = definitions.customFields.find((candidate) => candidate.name === name);
      return field && field.tracker_field !== target ? [name] : [];
    }),
  };
}

/**
 * @param {SyncTrackerContext} ctx
 * @param {ReturnType<typeof analyse>} out
 * @param {string} F
 */
function refreshFeature(ctx, out, F) {
  const T = /** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker);
  const { perFeature } = facts(ctx);
  const resolver = ctx.index.tracker;
  for (const f of /** @type {{ files: Array<SyncTrackerContext["files"][0]> }} */ (perFeature.get(F)).files) {
    const scenarioKey = /** @type {string} */ (f.data.key);
    const scenarioTracker = resolver.current("scenario", scenarioKey);
    if (scenarioTracker) {
      const current = T.requests.scenarios.get(scenarioTracker);
      const ts = T.scenarios.get(/** @type {string} */ (current));
      const where = { feature: F, file: f.rel, line: f.keyLines.key ?? /** @type {number} */ (f.frontmatterLine), key: scenarioKey, tracker: scenarioTracker };
      if (!ts) out.divergences.push({ code: "tracker_scenario_vanished", ...where, message: `the tracker no longer holds scenario \`${scenarioTracker}\`: it stays in \`.qa/\` until a person retires it` });
      else {
        trackerMove(out, { kind: "scenario", ...where }, /** @type {string} */ (current), f.data);
        mirror(ctx, out, { kind: "scenario", ...where, line: f.keyLines.mirror ?? where.line, owned: { summary: f.h1?.text }, before: f.data.mirror, next: mirrored("scenario", ts) });
      }
    }
    for (const c of f.cases) {
      const tracker = resolver.current("case", c.key);
      if (!tracker) continue;
      const current = T.requests.cases.get(tracker);
      const tc = T.cases.get(/** @type {string} */ (current));
      const where = { feature: F, file: f.rel, line: /** @type {number} */ (c.line), key: c.key, tracker };
      if (!tc) {
        out.divergences.push({ code: "tracker_case_vanished", ...where, message: `the tracker no longer holds \`${tracker}\`: it stays in \`.qa/\` until a person retires it` });
        continue;
      }
      trackerMove(out, { kind: "case", ...where }, /** @type {string} */ (current), c.data);
      if (scenarioTracker && tc.scenario !== (T.requests.scenarios.get(scenarioTracker) ?? scenarioTracker)) {
        out.divergences.push({ code: "tracker_case_moved", ...where, knowledge: scenarioKey, mirror: tc.scenario, message: `the tracker holds \`${tracker}\` under \`${tc.scenario}\`, not \`${scenarioTracker}\`` });
      }
      const owned = { summary: c.summary, roles: stringsIn(c.data.roles) };
      const project = ctx.index.project?.data ?? {};
      const definitions = labelDefinitions(project);
      const mapping = project.tracker ?? {};
      const labelsEnabled = canPublishLabels(projectConfig(ctx.index.project).schemaVersion);
      const copies = labelsEnabled ? recoveredLabelCopies(tc, definitions, mapping) : {};
      const stale = labelsEnabled ? staleLabelTargets(c.data, definitions, mapping, copies) : { tags: false, fields: [] };
      mirror(ctx, out, { kind: "case", ...where, line: c.keyLines.mirror ?? c.blockLine ?? c.line, owned, before: c.data.mirror, next: { ...mirrored("case", tc), ...copies.mirror }, labels: { before: /** @type {LabelCopies} */ (c.data), next: copies, stale } });
    }
  }
}

/**
 * @param {ReturnType<typeof analyse>} out
 * @param {{ kind: "case" | "scenario", feature: string, file: string, line: number, key: string, tracker: string }} where
 * @param {string} current
 * @param {Record<string, unknown>} data
 */
function trackerMove(out, where, current, data) {
  if (current === where.tracker) return;
  const message = `the tracker now holds \`${where.tracker}\` as \`${current}\`: keep the old Tracker key as an alias`;
  out.divergences.push({ code: "tracker_key_moved", ...where, current, message });
  out.refresh.push({ code: "move_tracker", ...where, current, tracker_formerly: [...stringsIn(data.tracker_formerly), where.tracker], changes: { tracker: { from: where.tracker, to: current } }, diverges: ["tracker"], edits: [], message });
}

// One mirror against the tracker's values: a `refresh_mirror` item when a value moved (`sameValue`
// says when it did not) or the mirror is missing, else a re-stamp when its `at` is older than the
// fetch. A value that did not move keeps what the mirror holds, in whatever form it holds it.
// Unknown keys a mirror holds are kept.
/**
 * @param {SyncTrackerContext} ctx
 * @param {ReturnType<typeof analyse>} out
 * @param {{
 *   kind: "case" | "scenario",
 *   feature: string,
 *   file: string,
 *   line: number,
 *   key: string,
 *   tracker: string,
 *   owned: { summary?: string, roles?: string[] },
 *   before: unknown,
 *   next: Record<string, unknown>,
 *   labels?: { before: LabelCopies, next: LabelCopies, stale?: { tags: boolean, fields: string[] } },
 * }} param2
 */
function mirror(ctx, out, { kind, feature, file, line, key, tracker, owned, before, next, labels }) {
  const old = isMap(before) ? /** @type {Record<string, unknown>} */ (before) : {};
  /** @type {Record<string, { from: unknown, to: unknown }>} */
  const changes = {};
  if (labels?.stale?.tags) next.tags_target = null;
  for (const [k, v] of Object.entries(next)) {
    const was = old[k] === undefined ? null : old[k];
    if (k === "tags" ? Object.hasOwn(old, k) && sameLabelValue("multiple", /** @type {string[] | null} */ (was), /** @type {string[]} */ (v)) : sameValue(k, was, v)) next[k] = was;
    else changes[k] = { from: was, to: v };
  }
  for (const [name, value] of Object.entries(labels?.next.mirror_fields ?? {})) {
    const previous = labels?.before.mirror_fields;
    const target = labels?.next.mirror_field_targets?.[name];
    const field = labelDefinitions(ctx.index.project?.data ?? {}).customFields.find((f) => f.name === name);
    if (!previous || !Object.hasOwn(previous, name) || labels?.before.mirror_field_targets?.[name] !== target || !sameLabelValue(field?.multiple ? "multiple" : "single", previous[name], value)) {
      changes[`label:field:${name}`] = { from: previous?.[name] ?? null, to: value };
    }
  }
  const staleFields = labels?.stale?.fields ?? [];
  for (const name of staleFields) changes[`mirror_field_targets.${name}`] = { from: labels?.before.mirror_field_targets?.[name] ?? null, to: null };
  const extra = Object.fromEntries(Object.entries(old).filter(([k]) => !(k in next) && k !== "at"));
  const at = ctx.tracker.at;
  const labelFields = labels?.next.mirror_fields === undefined ? undefined : { ...labels.before.mirror_fields, ...labels.next.mirror_fields };
  const labelTargets = labels !== undefined && (labels.next.mirror_fields !== undefined || staleFields.length)
    ? Object.fromEntries(Object.entries({ ...labels.before.mirror_field_targets, ...labels.next.mirror_field_targets }).filter(([name]) => !staleFields.includes(name)))
    : undefined;
  if (Object.keys(changes).length || !isMap(before)) {
    /** @type {Record<string, unknown>} */
    const after = { ...next, ...extra, at };
    const diverges = [];
    if (typeof after.summary === "string" && typeof owned.summary === "string" && !sameSummary(after.summary, owned.summary)) diverges.push("summary");
    if (kind === "case" && Array.isArray(after.roles) && !noList(after.roles) && !sameSet(/** @type {unknown[]} */ (owned.roles), after.roles)) diverges.push("roles");
    const moved = Object.keys(changes).join(", ") || "it had none";
    out.refresh.push({
      code: "refresh_mirror",
      kind,
      feature,
      file,
      line,
      key,
      tracker,
      changes,
      diverges,
      mirror: after,
      ...(labelFields !== undefined && { mirror_fields: labelFields }),
      ...(labelTargets !== undefined && { mirror_field_targets: labelTargets }),
      edits: [],
      message: `refresh \`${key}\`'s mirror from the tracker (${moved})${diverges.length ? `; it will differ from the owned ${diverges.join(" and ")}, a Divergence` : ""}`,
    });
  } else if (old.at !== at) {
    if (!out.restamp.has(feature)) out.restamp.set(feature, []);
    /** @type {Array<{ kind: "case" | "scenario", file: string, line: number, key: string }>} */ (out.restamp.get(feature)).push({ kind, file, line, key });
  }
}

// ---- Tracker intake -------------------------------------------------------------------------

// The intake items of one Feature: the tracker cases missing from `.qa/` under its known
// scenarios, then each new scenario under its suites with that scenario's cases. A tracker item is a
// candidate only when it has no mark and the shared resolver finds no claim on its tracker key,
// whether live, aliased or retired (ADR-0027). Canceled cases are skipped and counted.
/**
 * @param {SyncTrackerContext} ctx
 * @param {ReturnType<typeof analyse>} out
 * @param {string} F
 * @param {ReturnType<typeof facts>} k
 */
function intakeFeature(ctx, out, F, k) {
  const T = /** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker);
  const s = /** @type {{ files: Array<SyncTrackerContext["files"][0]>, known: string[], suites: Set<string>, cases: string[] }} */ (k.perFeature.get(F));
  const resolver = ctx.index.tracker;
  /** @param {TrackerCaseItem | TrackerScenarioItem} e @param {Map<string, unknown>} marked */
  const candidate = (e, marked) => !isBugItem(ctx, e) && !hasMark(e) && !marked.has(e.key) && resolver.resolve(e.key).status === "absent"
    && ![...T.requests.cases, ...T.requests.scenarios].some(([requested, current]) => current === e.key && resolver.resolve(requested).status !== "absent");
  /** @param {string} scenario */
  const cases = (scenario) => [...T.cases.values()].filter((tc) => tc.scenario === scenario && candidate(tc, T.markedCases)).sort((a, b) => byKey(a.key, b.key));
  /** @param {TrackerCaseItem} tc @param {{ file: string | null, requires?: unknown[] }} place */
  const add = (tc, place) => {
    if (CANCELED.test(tc.status ?? "")) return out.canceled.push(tc.key);
    if (!tc.summary?.trim()) return out.unsummarised.push(tc.key);
    out.intake.push(intakeCase(ctx, F, tc, place));
  };

  for (const f of s.files) {
    const scenario = T.requests.scenarios.get(/** @type {string} */ (resolver.current("scenario", /** @type {string} */ (f.data.key))));
    if (!scenario) continue;
    for (const tc of cases(scenario)) add(tc, { file: f.rel });
  }

  const fresh = [...T.scenarios.values()].filter((ts) => s.suites.has(/** @type {string} */ (ts.suite)) && candidate(ts, T.markedScenarios)).sort((a, b) => byKey(a.key, b.key));
  for (const ts of fresh) {
    if (out.intake.some((i) => i.code === "intake_scenario" && i.key === ts.key)) continue; // a suite two Features share
    if (!ts.summary?.trim()) {
      out.unsummarised.push(ts.key);
      continue;
    }
    const features = [...(k.suiteFeatures.get(/** @type {string} */ (ts.suite)) ?? [])].sort();
    const feature = features.length === 1 ? features[0] : null;
    const summary = oneLine(ts.summary);
    /** @type {IntakeItem} */
    const item = {
      code: "intake_scenario",
      feature,
      key: ts.key,
      summary,
      suite: ts.suite,
      ...(!feature && { candidates: features }),
      needs: feature ? [] : ["feature"],
      edits: ["feature"],
      message: feature
        ? `take in tracker scenario \`${ts.key}\` (${summary}) as a new file of \`${feature}\`, under a new \`ts_\` Key`
        : `take in tracker scenario \`${ts.key}\` (${summary}): suite \`${ts.suite}\` belongs to ${features.map((x) => `\`${x}\``).join(" and ")}; ask which Feature holds it`,
    };
    out.intake.push(item);
    for (const tc of cases(ts.key)) add(tc, { file: null, requires: [item] });
  }
}

// The file a scenario is written at: its permanent Key then its summary's slug.
/**
 * @param {SyncTrackerContext} ctx
 * @param {string} feature
 * @param {string} key
 * @param {string} summary
 * @returns {string}
 */
function scenarioPath(ctx, feature, key, summary) {
  const dir = featureFile(ctx.index, feature).dir;
  const slug = summary.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/, "");
  return `${dir}/${key}${slug ? `-${slug}` : ""}.md`;
}

// One intake item: the case as it will be written, except its Key (minted by `apply`, or the marked
// Key an Unlanded case reuses) and its prose, which `apply` renders from
// the payload. The level is the tracker's, else a `ui`/`api` summary prefix, else asked (a tracker
// level outside `project.stack.levels` is shown as `tracker_level`). The roles are seeded from the
// tracker's; one outside `project.roles` is asked about rather than written as an Integrity error.
/**
 * @param {SyncTrackerContext} ctx
 * @param {string} F
 * @param {TrackerCaseItem} tc
 * @param {{ file: string | null, requires?: unknown[] }} param3
 * @returns {IntakeItem}
 */
export function intakeCase(ctx, F, tc, { file, requires }) {
  const levels = ctx.config.levels;
  const summary = oneLine(tc.summary);
  const tracked = typeof tc.level === "string" ? tc.level.trim().toLowerCase() : null;
  const prefix = summary.match(/^\[?(ui|api)\b/i)?.[1].toLowerCase() ?? null;
  const level = [tracked, prefix].find((l) => l && levels.has(l)) ?? null;
  const roles = tc.roles ?? [];
  const unknownRoles = roles.filter((r) => !ctx.config.roles.has(r));
  const needs = [...(PROSE.some(([f]) => tc[f] === undefined) ? ["prose"] : []), ...(level ? [] : ["level"]), ...(unknownRoles.length ? ["roles"] : [])];
  return {
    code: "intake_case",
    feature: F,
    scenario: tc.scenario,
    key: tc.key,
    summary,
    file,
    level,
    ...(tracked && !levels.has(tracked) && { tracker_level: tc.level }),
    roles,
    unknown_roles: unknownRoles,
    automatable: tc.auto_status !== "Not Applicable",
    automates: automationsNaming(ctx, tc.key),
    mirror: { ...mirrored("case", tc), at: ctx.tracker.at },
    ...(requires && { requires }),
    needs,
    edits: ["level", "roles"],
    message: `take in tracker case \`${tc.key}\` (${summary}) under \`${tc.scenario}\`, unreviewed, under a new \`tc_\` Key`,
  };
}

// The Automation keys whose function's tracker-key annotation names `key`, from the scan's
// Divergences (an Unclaimed Automation, or one bound elsewhere), never re-derived.
/**
 * @param {{ scan: { results: Array<{ kind: string, code: string, key?: string, automation?: string, annotation?: unknown, [key: string]: unknown }> }, config: { autPattern?: RegExp, [key: string]: unknown } }} ctx
 * @param {string} key
 * @returns {string[]}
 */
export function automationsNaming(ctx, key) {
  /** @type {string[]} */
  const out = [];
  for (const r of ctx.scan.results) {
    if (r.kind !== "divergence" || !stringsIn(r.annotation).includes(key)) continue;
    const aut = r.code === "unclaimed_automation" ? r.key : r.code === "tracker_key_vs_automates" ? r.automation : null;
    if (aut && (ctx.config.autPattern ?? PATTERN.aut).test(aut) && !out.includes(aut)) out.push(aut);
  }
  return out;
}

// `[field, value]` pairs as YAML lines, each read back to be sure: `{lines}` or `{error}`.
/**
 * @param {Array<[string, unknown]>} fields
 * @returns {YamlLineResult}
 */
function yamlLines(fields) {
  /** @type {string[]} */
  const lines = [];
  for (const [field, value] of fields) {
    const r = line(field, value, field === "mirror" ? { strings: QUOTED } : field === "roles" ? { item: role } : {});
    if (r.error) return { error: r.error };
    lines.push(/** @type {string} */ (r.text));
  }
  return { lines };
}

// A new case entry, in the backfill's shape: the block, then the tracker's prose under its
// labelled paragraphs, or no prose at all. Its Key is `item.permanent_key`, and the tracker's key
// goes beside it as `tracker:` (ADR-0027). `{text}`, or `{error}` for a value the dialect cannot
// hold.
/**
 * @param {IntakeItem} item
 * @param {Record<string, unknown>} tc
 * @param {string | null} level
 * @param {string | undefined} at
 * @returns {FrontmatterResult}
 */
function caseEntry(item, tc, level, at) {
  const block = yamlLines([
    ["key", item.permanent_key],
    ["tracker", item.key],
    ["automates", item.automates],
    ["automatable", item.automatable],
    ["level", level],
    ["roles", item.roles],
    ["covers", []],
    ["mirror", item.mirror],
    ["sources", [trackerReference(item.key)]],
    ["generated", { by: "script:qa-sync", at }],
  ]);
  if (block.error) return block;
  /** @type {string[]} */
  const prose = [];
  for (const [field, label] of PROSE) {
    const text = tc[field];
    if (typeof text === "string" && text.trim()) prose.push(`**${label}.**`, "", ...proseLines(text), "");
  }
  return { text: [`### ${item.permanent_key}: ${item.summary}`, "", "```yaml", .../** @type {string[]} */ (block.lines), "```", ...(prose.length ? ["", ...prose] : [])].join("\n") };
}

/**
 * @param {IntakeItem} item
 * @param {string} feature
 * @param {string | undefined} at
 * @returns {FrontmatterResult}
 */
function scenarioHead(item, feature, at) {
  const fm = yamlLines([
    ["type", "scenario"],
    ["key", item.permanent_key],
    ["feature", feature],
    ["tracker", item.key],
    ["mirror", { suite: item.suite, summary: item.summary, at }],
    ["sources", [trackerReference(item.key)]],
    ["generated", { by: "script:qa-sync", at }],
  ]);
  if (fm.error) return fm;
  return { text: ["---", .../** @type {string[]} */ (fm.lines), "---", "", `# ${item.permanent_key}: ${item.summary}`, ""].join("\n") };
}

// ---------------------------------------------------------------------------------------------
// The sections. Each is `{key, title, tracker: true, info?, items(ctx), apply(ctx, item, plan)}`;
// a `tracker` section is dropped from the card when the tracker could not be read.

/** @type {RefreshSection} */
export const refresh = {
  key: "refresh",
  title: "Mirror refresh",
  codes: ["move_tracker", "refresh_mirror", "restamp_mirrors"],
  tracker: true,
  items(ctx) {
    const a = analyse(ctx);
    const restamps = [...a.restamp].map(([feature, mirrors]) => ({
      code: "restamp_mirrors",
      feature,
      at: ctx.tracker.at,
      mirrors,
      edits: [],
      message: `the tracker still agrees with ${mirrors.length} mirror${mirrors.length === 1 ? "" : "s"} of \`${feature}\`: mark ${mirrors.length === 1 ? "it" : "them"} as checked on ${ctx.tracker.at}`,
    }));
    return [...a.refresh, ...restamps];
  },
  apply(ctx, item, plan) {
    if (item.code === "move_tracker") {
      const found = ctx.index.tracker.resolve(/** @type {string} */ (item.current));
      if (found.status !== "absent") return { code: "tracker_key_collision", key: /** @type {string} */ (item.key), tracker: item.current, status: found.status, message: `\`${item.current}\` is already claimed or retired: the tracker move cannot be accepted` };
      const clash = plan.claim(/** @type {string} */ (item.current), item.n);
      if (clash) return clash;
      const ref = item.kind === "case" ? { file: /** @type {string} */ (item.file), key: item.key } : { file: /** @type {string} */ (item.file) };
      plan.set(ref, "tracker", item.current);
      plan.set(ref, "tracker_formerly", item.tracker_formerly);
      return null;
    }
    if (item.code === "refresh_mirror") {
      const ref = item.kind === "case" ? { file: /** @type {string} */ (item.file), key: item.key } : { file: /** @type {string} */ (item.file) };
      plan.set(ref, "mirror", item.mirror);
      for (const field of ["mirror_fields", "mirror_field_targets"]) if (item[field] !== undefined) plan.set(ref, field, item[field]);
      return null;
    }
    for (const m of /** @type {NonNullable<typeof item.mirrors>} */ (item.mirrors)) {
      const f = /** @type {{ data: { mirror?: unknown }, cases: Array<{ key: string, data: { mirror?: unknown } }> }} */ (fileAt(ctx, m.file));
      const before = m.kind === "scenario" ? f.data.mirror : (/** @type {{ data: { mirror?: unknown } }} */ (f.cases.find((c) => c.key === m.key))).data.mirror;
      plan.set(m.kind === "scenario" ? { file: m.file } : { file: m.file, key: m.key }, "mirror", { .../** @type {Record<string, unknown>} */ (before), at: item.at });
    }
    return null;
  },
};

/** @type {IntakeSection} */
export const intake = {
  key: "intake",
  title: "Tracker intake",
  codes: ["intake_scenario", "intake_case"],
  tracker: true,
  info(ctx) {
    const a = analyse(ctx);
    return { canceled: a.canceled.length, canceled_keys: a.canceled, ...(a.unsummarised.length && { unsummarised_keys: a.unsummarised }) };
  },
  items: (ctx) => analyse(ctx).intake,
  apply(ctx, item, plan) {
    const T = /** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker);
    if (item.code === "intake_scenario") {
      if (typeof item.feature !== "string" || !ctx.index.features.has(item.feature)) {
        return { code: "needs_edit", message: `name the Feature that holds scenario \`${item.key}\` (edit item ${item.n} with \`feature\`)` };
      }
      const permanent = /** @type {{ key: string, error?: string }} */ (plan.permanentKey("ts", item.permanent_key));
      if (permanent.error) return { code: "mint", item: item.n, message: permanent.error };
      const taken = { ...item, permanent_key: permanent.key };
      const head = /** @type {{ text: string, error?: string }} */ (scenarioHead(taken, item.feature, T.at));
      if (head.error) return { code: "unwritable", item: item.n, value: head.error, message: head.error };
      const clash = plan.claim(permanent.key, item.n) ?? plan.claim(item.key, item.n);
      if (clash) return clash;
      const rel = scenarioPath(ctx, item.feature, permanent.key, item.summary);
      plan.createQa(rel, head.text, item.n);
      plan.placed.set(item.key, rel);
      plan.intaken.push({ kind: "scenario", key: permanent.key, tracker: item.key, reused: Boolean(item.permanent_key) });
      return null;
    }
    if (item.needs.includes("prose")) return { code: "prose_not_fetched", message: `fetch \`${item.key}\`'s preconditions, steps and expected result, then build the card again` };
    if (item.level === null || item.level === undefined) return { code: "needs_edit", message: `name \`${item.key}\`'s level (edit item ${item.n} with \`level\`)` };
    if (!ctx.config.levels.has(item.level)) return { code: "bad_level", message: `\`${item.level}\` is not one of \`project.stack.levels\`: ${[...ctx.config.levels].join(", ")}` };
    const roles = badRoles(ctx, /** @type {Extract<IntakeItem, { code: "intake_case" }>} */ (item));
    if (roles) return roles;
    // A case with no file requires its new scenario's intake, applied before it. A reply dropping
    // that intake drops the case too, so the file is missing only when the scenario's own
    // intake was refused: that refusal already stops the apply, and the case adds none of its own.
    const rel = item.file ?? plan.placed.get(/** @type {string} */ (item.scenario));
    if (!rel) return null;
    const permanent = /** @type {{ key: string, error?: string }} */ (plan.permanentKey("tc", item.permanent_key));
    if (permanent.error) return { code: "mint", item: item.n, message: permanent.error };
    const taken = { ...item, permanent_key: permanent.key };
    const entry = /** @type {{ text: string, error?: string }} */ (caseEntry(taken, /** @type {Record<string, unknown>} */ (T.markedCases.get(item.key) ?? T.cases.get(item.key)), item.level, T.at));
    if (entry.error) return { code: "unwritable", item: item.n, value: entry.error, message: `${entry.error}: drop this item and fix the value in the tracker` };
    const clash = plan.claim(permanent.key, item.n) ?? plan.claim(item.key, item.n);
    if (clash) return clash;
    plan.append(rel, entry.text);
    plan.intaken.push({ kind: "case", key: permanent.key, tracker: item.key, reused: Boolean(item.permanent_key) });
    return null;
  },
};

// Why an intake case's (edited) roles cannot be written, or null: they are a list of
// `project.roles`. Left as the tracker's with a role outside it, the person still has to answer.
/**
 * @param {SyncTrackerContext} ctx
 * @param {Extract<IntakeItem, { code: "intake_case" }>} item
 * @returns {{ code: string, message: string } | null}
 */
function badRoles(ctx, item) {
  if (!Array.isArray(item.roles) || item.roles.some((r) => typeof r !== "string")) return { code: "bad_roles", message: "`roles` is a list of role names" };
  const unknown = item.roles.filter((r) => !ctx.config.roles.has(r));
  if (!unknown.length) return null;
  const asFetched = JSON.stringify(item.roles) === JSON.stringify(item.mirror.roles ?? []);
  const which = unknown.map((r) => `\`${r}\``).join(", ");
  return asFetched
    ? { code: "needs_edit", message: `${which} ${unknown.length === 1 ? "is" : "are"} not in \`project.roles\`: add ${unknown.length === 1 ? "it" : "them"} with \`/qa-init --add-role\` and build the card again, or edit item ${item.n}'s \`roles\`` }
    : { code: "bad_roles", message: `${which} ${unknown.length === 1 ? "is" : "are"} not in \`project.roles\`` };
}

// Case and Scenario Divergences the fetch shows (vanished, moved), for the card to print.
/**
 * @param {SyncTrackerContext} ctx
 * @returns {TrackerDivergence[]}
 */
export function trackerDivergences(ctx) {
  return ctx.tracker.ok ? analyse(ctx).divergences : [];
}

// `sync scope`'s `access` (ADR-0015): the Access note the configured tracker is reached
// through, as lib/access.mjs shows it (matched by `trackerUri`, `tracker:DEMO-` for `DEMO-` keys, so
// `tracker:DEMO-` beats `tracker:`), or null when none covers it or the project has no tracker.
/**
 * @param {SyncTrackerContext} ctx
 * @returns {Record<string, unknown> | null}
 */
export function trackerAccess(ctx) {
  const uri = trackerUri(ctx.index.project?.data.tracker);
  return uri ? accessFor(ctx.index, [uri])[uri] : null;
}

// What `sync scope` names, as sets: the known scenarios, the suites, and the cases to fetch, with the
// keys named for an Attach.
// `readTracker` reads the cases to tell a payload that stopped short, so this runs before
// `ctx.tracker` is set.
/**
 * @param {SyncTrackerContext} ctx
 * @returns {{ scenarios: Set<string>, suites: Set<string>, cases: Set<string> }}
 */
function scopeSets(ctx) {
  if (ctx.tracker_scope) return { scenarios: new Set(ctx.tracker_scope.scenarios), suites: new Set(ctx.tracker_scope.suites), cases: new Set(ctx.tracker_scope.cases) };
  const k = facts(ctx);
  const scenarios = new Set();
  const suites = new Set();
  const cases = new Set();
  for (const F of k.features) {
    const s = /** @type {PerFeatureFacts} */ (k.perFeature.get(F));
    for (const key of s.known) scenarios.add(key);
    for (const suite of s.suites) suites.add(suite);
    for (const key of s.cases) cases.add(key);
  }
  // A key the engineer named for an Attach is fetched like any other (lib/sync-attach.mjs).
  for (const [entry, key] of Object.entries(ctx.named ?? {})) {
    if (ctx.index.cases.has(entry)) cases.add(key);
    else if (ctx.index.scenarios.has(entry)) scenarios.add(key);
  }
  return { scenarios, suites, cases };
}

// `sync scope`: what the skill fetches, field-limited: the known scenarios, the suites (whose new
// scenarios it fetches too), and the cases `.qa/` links to a tracker case (`tracker:`). With a payload, `prose` lists the intake candidates whose prose it has
// not fetched yet (null until a payload is given).
/**
 * @param {SyncTrackerContext} ctx
 * @returns {{ tracker: boolean, scenarios: string[], suites: string[], cases: string[], fields: Record<string, string[]>, label_destinations: LabelDestinationRequest[], mark_field: string | null, prose: string[] | null }}
 */
export function trackerScope(ctx) {
  const { scenarios, suites, cases } = scopeSets(ctx);
  const prose = ctx.tracker.ok ? analyse(ctx).intake.filter((i) => i.code === "intake_case" && i.needs.includes("prose")).map((i) => i.key) : null;
  /** @param {Set<string>} set */
  const sorted = (set) => [...set].sort(byKey);
  const fields = ctx.index.project?.data.tracker?.marker_label ? { ...FIELDS, case: [...FIELDS.case, "labels"] } : FIELDS;
  const markField = ctx.index.project?.data.tracker?.marker_field;
  const project = ctx.index.project?.data ?? {};
  const label_destinations = canPublishLabels(projectConfig(ctx.index.project).schemaVersion) ? configuredLabelDestinations(labelDefinitions(project), project.tracker ?? {}) : [];
  return { tracker: isMap(project.tracker), scenarios: sorted(scenarios), suites: sorted(suites), cases: sorted(cases), fields, label_destinations, mark_field: typeof markField === "string" ? markField : null, prose };
}
