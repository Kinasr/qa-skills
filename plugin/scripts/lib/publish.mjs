// @ts-check
// Publish seals a Card, accepts a Reply, then commits the successful `tracker:` links and Mirrored values.
/**
 * @import { CardAdapter, CardApplyOut, CardChangeset, CardRecord, CardRefusal, CardRefused } from "./card-run.mjs"
 * @import { CommandContext, CommandResult, OptionSpec } from "./cli.mjs"
 * @import { RefusalFact } from "./refusal.mjs"
 * @import { SyncContext } from "./sync.mjs"
 * @import { SyncDecisions } from "./sync-json.mjs"
 * @import { TrackerCaseItem, TrackerNote, TrackerPayload, TrackerScenarioItem, TrackerState, TrackerSuiteItem, SyncTrackerContext } from "./sync-tracker.mjs"
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { accessNoteNamed } from "./access.mjs";
import { cardRun } from "./card-run.mjs";
import { UsageError } from "./cli.mjs";
import { changedPaths } from "./changeset.mjs";
import { checkFile } from "./check-file.mjs";
import { hasBugPublishTracker } from "./knowledge-file.mjs";
import { loadBugs } from "./bug.mjs";
import { bugAttachmentsFor, bugCandidates, bugFieldsFor, bugMissing, bugNeedsConfirm, bugResultMatches, publishedBugs, publishDecisions } from "./publish-bugs.mjs";
import { uncommittedPaths } from "./git.mjs";
import { PATTERN, readTrackerReference, trackerReference } from "./keys.mjs";
import { glossaryOf, keyLabel, summaries } from "./labels.mjs";
import { table } from "./markdown.mjs";
import { featureFile } from "./qa-index.mjs";
import { refusalsFor, object } from "./refusal.mjs";
import { newRunDir, openRunDir, readRunFile } from "./run-dir.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { ANY_SCHEMA_VERSION, oneLine, PUBLISH_TRAIN_KEY } from "./schema.mjs";
import { loadSyncContext, sourceSeal } from "./sync.mjs";
import { REFUSALS as SYNC_REFUSALS } from "./sync-json.mjs";
import { cascade } from "./sync-plan.mjs";
import { readTracker, trackerAccess, trackerScope } from "./sync-tracker.mjs";
import { suiteCandidates } from "./publish-suite.mjs";
import { publishedPlan } from "./publish-plan.mjs";
import { publisherPrompt } from "./publish-prompt.mjs";
import { caseFields, PROSE_FIELDS, sameOwned, sameOwnedFields, writtenMirror } from "./case-fields.mjs";
import { practicesText, trainFor } from "./training.mjs";
import { labelDefinitions, caseLabelProblems } from "./case-labels.mjs";
import { publishedLabels, configuredLabelDestinations, canPublishLabels, hasPublishTags, declaresTags, labelsDiffer, resolveLabelDestinations, confirmedLabelsMatch, sameLabelValue, confirmedLabelCopies, publishDestinationProblems, recoveredLabelCopies } from "./publish-labels.mjs";
/** @import { LabelOperation, ConfirmedLabel, LabelDestinationRequest, PublishedLabel, LabelCopies } from "./publish-labels.mjs" */
import { parkedCandidates, parkedMatches, parkedStories, parkedWrites } from "./publish-parked.mjs";
/** @import { RunFileResult } from "./run-dir.mjs" */

/**
 * Publish's `run.json`: the command name and the Feature the run is scoped to, null when none.
 * @typedef {{
 *   command: "publish",
 *   feature: string | null,
 *   execute_run?: string,
 * }} PublishRunRecord
 */

/**
 * Publish's `publish.json`: the accepted decisions and confirmed divergence items.
 * @typedef {{
 *   decisions: Record<string, unknown>,
 *   confirmed: number[],
 * }} PublishFileRecord
 */

/**
 * A write action for the publisher agent.
 * @typedef {{
 *   action: string,
 *   n: number,
 *   key: string,
 *   tracker_key?: string,
 *   issue_type?: string,
 *   fields?: Record<string, unknown> | import("./publish-bugs.mjs").BugField[],
 *   link?: import("./publish-bugs.mjs").BugLink,
 *   attachments?: import("./publish-bugs.mjs").BugAttachment[],
 *   labels?: LabelOperation[],
 *   suite?: string,
 *   marker?: string | { label: string, field: string, value: string, aliases?: string[] },
 *   to?: string,
 *   type?: string,
 *   transition?: string,
 *   comment_id?: string | null,
 *   body?: string,
 * }} PublisherWrite
 */

/**
 * Publish's `scout-publisher.json`: the writes to perform, the output file, and the timestamp.
 * @typedef {{
 *   writes: PublisherWrite[],
 *   output_file: string,
 *   at: string | null,
 * }} ScoutPublisherRecord
 */

/**
 * A single result item from the publisher agent in `publisher-results.json`.
 * @typedef {{
 *   n: number,
 *   key: string,
 *   error?: string,
 *   access_note?: string,
 *   rebuild?: true,
 *   kind?: "comment",
 *   comment_id?: string,
 *   tracker_key?: string,
 *   linked?: string[],
 *   attached?: string[],
 *   labels?: ConfirmedLabel[],
 * }} PublisherResult
 */

/**
 * Publish's `publisher-results.json`: written by the Publisher agent (trusted).
 * @typedef {{
 *   results: PublisherResult[],
 * }} PublisherResultsRecord
 */

/**
 * A run dir opened or made for publish.
 * @typedef {({ dir: string | null, exists?: boolean, make?: () => string, error?: never }) | ({ dir?: never, exists?: never, make?: never, error: string })} PublishRunDir
 */

/**
 * The tracker configuration fields Publish reads from `.qa/project.md`.
 * @typedef {{
 *   suite_type: string,
 *   scenario_type: string,
 *   case_type: string,
 *   link_type: string,
 *   initial_status: string,
 *   marker_label: string,
 *   marker_field: string,
 *   retire_transition?: string,
 *   tag_field?: string,
 *   provider?: string,
 *   project?: string,
 *   [key: string]: unknown,
 * }} PublishTrackerMapping
 */

/**
 * The publish command and lifecycle context, extending SyncTrackerContext.
 * @typedef {SyncTrackerContext & {
 *   repo: string,
 *   dir: string,
 *   execute_run?: string,
 *   followUps?: import("./follow-ups.mjs").FollowUps,
 *   bugs: import("./bug.mjs").LoadedBug[],
 *   allBugs?: import("./bug.mjs").LoadedBug[],
 *   olderBugs?: import("./bug.mjs").LoadedBug[],
 *   access?: Record<string, unknown> | null,
 *   feature?: string,
 *   payload: string | null,
 *   requireMarks?: boolean,
 *   requireSuites?: boolean,
 *   tracker: TrackerState,
 *   mapping: PublishTrackerMapping,
 *   phase?: string,
 *   confirmed?: number[],
 *   scan: { history: { reviews: Array<{ key: string, status?: string, [key: string]: unknown }> } },
 *   config: SyncTrackerContext["config"] & { schemaVersion: number, trackerPattern: RegExp, modulePaths: string[], bug_publish?: import("./knowledge-file.mjs").BugPublishConfig },
 *   repoPath: (rel: string) => string,
 * }} PublishContext
 */

/**
 * The result of `publish scope`.
 * @typedef {CommandResult & {
 *   json: {
 *     ok?: boolean,
 *     dir?: string,
 *     payload_file?: string,
 *     tracker?: unknown,
 *     fields?: unknown,
 *     label_destinations?: LabelDestinationRequest[],
 *     mark_field?: string,
 *     mark_search?: { field: string, values: string[] },
 *     bug_statuses?: string[],
 *     scenarios?: unknown,
 *     suites?: unknown,
 *     cases?: unknown,
 *     stories?: unknown,
 *     fetch_prose?: string[],
 *     access?: { key?: string, [key: string]: unknown } | null,
 *     train?: unknown,
 *     refusals?: Array<{ reason?: string, line?: string, [key: string]: unknown }>,
 *     text?: string,
 *     [key: string]: unknown,
 *   },
 * }} PublishScopeResult
 */

/**
 * The command context of a publish action.
 * @typedef {Partial<Omit<CommandContext, "stdin">> & {
 *   root: string,
 *   dir?: string,
 *   seed?: string,
 *   run?: string,
 *   stdin?: (() => string) | null,
 * }} PublishActionContext
 */

/**
 * The publish command definition.
 * @typedef {{
 *   options: OptionSpec,
 *   actions: {
 *     scope: { usage: string, run: (args: string[], options: PublishActionContext) => PublishScopeResult },
 *     card: { usage: string, run: (args: string[], options: PublishActionContext) => CommandResult },
 *     apply: { usage: string, run: (args: string[], options: PublishActionContext) => CommandResult },
 *     record: { usage: string, run: (args: string[], options: PublishActionContext) => CommandResult },
 *     [key: string]: { usage?: string | readonly string[], run: (args: string[], options: PublishActionContext) => CommandResult },
 *   },
 *   refuse: (e: UsageError) => CommandResult,
 * }} PublishCommand
 */

/**
 * A Card item in Publish's lifecycle.
 * @typedef {{
 *   n?: number,
 *   code: string,
 *   key: string,
 *   label: string,
 *   feature?: string,
 *   file?: string,
 *   tracker_key?: string,
 *   suite?: string,
 *   scenario?: string,
 *   target?: { scenario: string, suite: string },
 *   requires?: Array<PublishCardItem | number>,
 *   needs?: string[],
 *   edits?: string[],
 *   stories?: string[],
 *   links?: Array<{ to: string, type: string }>,
 *   fields?: Record<string, unknown>,
 *   bug_fields?: import("./publish-bugs.mjs").BugField[],
 *   bug_answer_fields?: import("./publish-bugs.mjs").BugFieldSpec[],
 *   bug_required?: Array<{ id: string, name: string, allowed_values?: unknown[] }>,
 *   bug_link?: import("./publish-bugs.mjs").BugLink,
 *   attachments?: import("./publish-bugs.mjs").BugAttachment[],
 *   attachments_dropped?: import("./publish-bugs.mjs").DroppedAttachment[],
 *   attachments_note?: string,
 *   stale?: boolean,
 *   in_tracker?: boolean,
 *   hits?: import("./publish-bugs.mjs").BugHit[],
 *   open_hits?: import("./publish-bugs.mjs").BugHit[],
 *   other_bugs?: Array<{ key: string, status: string, run: string | null, tracker: string | null }>,
 *   group?: import("./publish-bugs.mjs").BugGroup,
 *   recovered?: boolean,
 *   unverified?: string,
 *   takeable?: boolean,
 *   labels?: LabelOperation[],
 *   issue_type?: string,
 *   marker?: string | { label: string, field: string, value: string, aliases?: string[] },
 *   changes?: Record<string, { from: unknown, to: unknown }>,
 *   markdown?: string | null,
 *   diverges?: string[],
 *   transition?: string,
 *   repair_index?: number,
 *   story?: string,
 *   comment_id?: string | null,
 *   body?: string,
 *   mirror?: Record<string, unknown>,
 *   mirror_fields?: LabelCopies["mirror_fields"],
 *   mirror_field_targets?: LabelCopies["mirror_field_targets"],
 *   [key: string]: unknown,
 * }} PublishCardItem
 */

/**
 * An item skipped during candidate gathering.
 * @typedef {{
 *   key: string,
 *   label: string,
 *   reason?: string,
 *   remedy?: string,
 *   subject?: string,
 *   tracker?: string,
 *   current?: unknown,
 *   tracker_key?: string,
 *   feature?: string,
 *   file?: string,
 *   repair_index?: number,
 *   field?: string,
 *   hits?: string[],
 *   claim?: string,
 *   issue_type?: string | null,
 *   expected?: string,
 *   with?: string[],
 *   [key: string]: unknown,
 * }} PublishSkippedItem
 */

/**
 * Publish's Card data representation.
 * @typedef {{
 *   notices?: string[],
 *   counts: { changes: number, questions: number },
 *   items: PublishCardItem[],
 *   skipped: PublishSkippedItem[],
 *   fields: Record<string, string>,
 *   glossary: Array<{ term: string, explanation: string }>,
 *   labels: Record<string, string>,
 * }} PublishCardData
 */

/**
 * Publish's validated reply decisions passed to apply.
 * @typedef {{
 *   take: number[],
 *   drop: number[],
 *   discard: number[],
 *   edits: Record<string, Record<string, unknown>>,
 *   fields: Record<string, Record<string, unknown>>,
 *   attach: Record<string, string[]>,
 *   confirmed: number[],
 *   confirm: number[],
 *   input: { confirm?: number[], [key: string]: unknown },
 * }} PublishApplyDecisions
 */

const RUN = { by: "publish", restart: "publish scope" };
const PUBLISH_FIELDS = ["suite_type", "scenario_type", "case_type", "link_type", "initial_status", "marker_label", "marker_field"];
const FIELD_LABELS = { summary: "summary", preconditions: "preconditions", steps: "steps", expected: "Expected-result paragraph", roles: "Roles", level: "level", scenario: "Test Scenario", status: "initial status", issue_type: "issue type", marker: "publish marker", links: "story links", confirm: "overwrite tracker changes" };
const EMPTY = { writes: [], deletes: [] };
const MESSAGE = "qa: /qa-publish tracker links and Mirrors";
const { fact, refuse, refusalOf } = refusalsFor({
  ...SYNC_REFUSALS,
  unknown_action: "The requested publish action is unavailable.",
  execute_run_mismatch: "The publish Run is scoped to a different execute Run.",
  bug_card_incomplete: "The bug Card needs complete create metadata, fields and a current case link before publishing.",
  bug_type_unknown: "The configured bug type is not on the tracker's create screen.",
  bug_link_type_unknown: "The configured bug link type is not one the tracker offers.",
  bug_field_unknown: "A `bug_fields` default names no field on the bug create screen.",
  bug_field_ambiguous: "A `bug_fields` default names more than one field on the bug create screen.",
  bug_field_invalid: "A `bug_fields` default or a Card answer does not fit its field's schema or allowed values.",
  answer_conflict: "An item is answered in more than one of `take`, `drop` and `discard`.",
  ambiguous_case_drafts: "Two in-scope Bug drafts share a case; take or discard them by number.",
  draft_in_tracker: "A draft already exists in the tracker; it cannot be discarded without a new Card.",
  no_follow_ups: "The Run has no follow-ups.json; run execute follow-ups first.",
  state_unreadable: "The Run follow-ups are unreadable.",
  run_with_feature: "A Run scope cannot name a Feature.",
  bug_publishing_not_configured: "Bug publishing is not configured; use /qa-init.",
  no_tracker: "No tracker is configured, so there is nothing to publish to.",
  publishing_not_configured: "Publishing isn't configured; set the publish fields with /qa-init.",
  publish_config_missing: "Publish needs the named tracker fields in .qa/project.md; set them with /qa-init.",
  dirty_publish_paths: "The paths Publish would rewrite have uncommitted changes.",
  tracker_not_ready: "The tracker fetch is unavailable or invalid.",
  publish_labels_invalid: "Publish label configuration has Integrity errors; fix them with /qa-init.",
  repairs_invalid: "The Feature's pending tracker repairs are malformed.",
  no_reply: "No accepted Reply is recorded in the run directory.",
  no_publisher_brief: "No Publisher brief is recorded in the run directory.",
  publisher_output_invalid: "The Publisher output does not match the accepted writes.",
  git_failed: "Git could not commit the Publish; the named paths remain uncommitted.",
  git_status_failed: "Git could not check the Publish paths for uncommitted changes.",
});

/**
 * @param {string} dir
 * @returns {boolean}
 */
export function isPublishRunDir(dir) {
  try { return (/** @type {PublishRunRecord} */ (JSON.parse(readFileSync(join(dir, "run.json"), "utf8")))).command === "publish"; } catch { return false; }
}

/**
 * @param {{ data: { tracker?: unknown } } | null | undefined} project
 * @returns {boolean}
 */
export function hasPublishTracker(project) {
  return object(project?.data.tracker) && missingPublishFields(project).length === 0;
}

/**
 * Return the publish fields that are absent or blank on the project's tracker.
 * @param {{ data: { tracker?: unknown } } | null | undefined} project
 * @returns {string[]}
 */
export function missingPublishFields(project) {
  const tracker = project?.data.tracker;
  return PUBLISH_FIELDS.filter((field) => !object(tracker) || typeof tracker[field] !== "string" || !tracker[field].trim());
}

/**
 * @template T
 * @param {string} action
 * @param {string[]} args
 * @param {PublishActionContext} param2
 * @param {(ctx: PublishContext, line?: string) => T} act
 * @returns {T | CommandResult}
 */
function withRun(action, args, { root, dir, seed, stdin, run: executeRun }, act) {
  if (executeRun && args.length) return refuse("run_with_feature");
  if (["apply", "record", "publisher"].includes(action) && args.length) return refuse("apply_takes_no_feature");
  if (args.length > 1) return refuse("too_many_features", { action });
  if (args[0] !== undefined && !PATTERN.slug.test(args[0])) return refuse("not_feature_key", { given: args[0] });
  const newer = refuseUnreadSchema(root, ANY_SCHEMA_VERSION);
  if (newer) return newer;
  if (action === "apply" && !stdin) return refuse("apply_needs_stdin");
  const run = /** @type {PublishRunDir} */ (action === "scope" ? newRunDir(dir, "qa-publish-") : openRunDir(dir, { cmd: "publish", action, from: RUN.restart }));
  if (run.error) return refuse("run_dir", { reason: run.error });
  /** @type {RunFileResult<PublishRunRecord>} */
  const saved = run.exists === false ? { value: null } : readRunFile(/** @type {string} */ (run.dir), "run.json", RUN);
  if (saved.error) return refuse("run_dir", { reason: saved.error });
  if (!saved.value && action !== "scope") return refuse("run_dir", { reason: `No publish run in ${run.dir}: run publish scope first.` });
  if (saved.value && saved.value.command !== "publish") return refuse("run_dir", { reason: "The run belongs to another command." });
  if (saved.value?.execute_run && args.length) return refuse("run_with_feature");
  if (saved.value && args[0] !== undefined && saved.value.feature !== args[0]) return refuse("run_scoped_elsewhere", { scoped: saved.value.feature, named: args[0] });
  if (saved.value && executeRun && saved.value.execute_run !== resolve(executeRun)) return refuse("execute_run_mismatch");
  executeRun = saved.value?.execute_run ?? (executeRun ? resolve(executeRun) : undefined);
  /** @type {import("./follow-ups.mjs").FollowUps | undefined} */
  let followUps;
  if (executeRun) {
    const path = join(executeRun, "follow-ups.json");
    if (!existsSync(path)) return refuse("no_follow_ups");
    try {
      const state = /** @type {import("./follow-ups.mjs").FollowUps} */ (JSON.parse(readFileSync(path, "utf8")));
      if (typeof state?.run !== "string" || !Array.isArray(state.items)) return refuse("state_unreadable");
      followUps = state;
    } catch { return refuse("state_unreadable"); }
  }
  const feature = args[0] ?? saved.value?.feature ?? undefined;
  const payload = run.dir && existsSync(join(run.dir, "tracker.json")) ? readFileSync(join(run.dir, "tracker.json"), "utf8") : null;
  const ctx = /** @type {PublishContext} */ (/** @type {unknown} */ (loadSyncContext(root, feature, seed, payload)));
  ctx.execute_run = executeRun;
  ctx.followUps = followUps;
  const allBugs = loadBugs(root);
  const drafts = allBugs.filter((bug) => bug.file.type === "bug" && bug.file.data.status === "draft");
  ctx.allBugs = allBugs;
  ctx.bugs = executeRun
    ? drafts.filter((bug) => Boolean(followUps?.items.some((item) => item.kind === "bug" && item.state === "done" && item.draft === bug.file.data.key && bug.file.data.run === followUps.run)))
    : drafts.filter((bug) => feature === undefined || bug.file.data.feature === feature);
  const casesInScope = new Set(ctx.bugs.map((bug) => String(bug.file.data.case)));
  ctx.olderBugs = executeRun
    ? drafts.filter((bug) => !ctx.bugs.includes(bug) && casesInScope.has(String(bug.file.data.case)))
    : [];
  if (executeRun) ctx.tracker_scope = { scenarios: [], suites: [], cases: [...new Set(ctx.bugs.flatMap((bug) => {
    const key = ctx.index.tracker.current("case", String(bug.file.data.case));
    return key ? [key] : [];
  }))] };
  ctx.requireMarks = true;
  ctx.requireSuites = true;
  ctx.tracker = readTracker(ctx, payload);
  if (ctx.tracker.ok) {
    const fetched = /** @type {TrackerPayload} */ (JSON.parse(/** @type {string} */ (payload)));
    if (![fetched.marked_cases, fetched.marked_scenarios, fetched.marked_suites].every(Array.isArray)) {
      ctx.tracker = { ok: false, note: { code: "tracker_payload_invalid", message: "Publish needs marked_cases, marked_scenarios and marked_suites from the completed mark search." } };
    }
  }
  if (feature && !ctx.index.features.has(feature)) return refuse("no_feature", { slug: feature, root });
  const tracker = /** @type {PublishTrackerMapping} */ (ctx.index.project?.data.tracker);
  if (!object(ctx.index.project?.data.tracker)) return refuse("no_tracker");
  const missing = missingPublishFields(ctx.index.project);
  if (missing.length) {
    if (missing.length === PUBLISH_FIELDS.length) return refuse("publishing_not_configured");
    return refuse("publish_config_missing", { fields: missing.map((field) => `tracker.${field}`) });
  }
  if (executeRun && !hasBugPublishTracker(ctx.index.project)) return refuse("bug_publishing_not_configured");
  ctx.mapping = tracker;
  ctx.access = trackerAccess(ctx);
  // A Run scope carries only Bug drafts: case label configuration and pending repairs are not in
  // scope, so their problems never block it.
  if (!executeRun) {
    const destinationProblems = publishDestinationProblems(ctx.index.project?.data ?? {});
    const labelProblems = checkFile(ctx.index.project, ctx.config).errors.filter((e) =>
      ["tags", "retired_tags", "custom_fields", "tracker.tag_field"].some((prefix) => e.field === prefix || e.field?.startsWith(`${prefix}.`)) || destinationProblems.some((p) => p.field === e.field));
    if (labelProblems.length) return refuse("publish_labels_invalid", { errors: labelProblems });
    for (const [key, declarations] of ctx.index.features) {
      if (ctx.feature && key !== ctx.feature) continue;
      for (const { file } of /** @type {Array<{ file: { rel: string, data: Record<string, unknown>, keyLines: Record<string, unknown> } }>} */ (declarations)) {
        if (file.data.repairs === undefined && file.keyLines.repairs === undefined) continue;
        const errors = checkFile(file, ctx.config).errors.filter((/** @type {{ field?: string, code: string }} */ e) => e.field?.startsWith("repairs") || ["dialect", "duplicate"].includes(e.code));
        if (errors.length) return refuse("repairs_invalid", { file: file.rel, errors });
      }
    }
  }
  if (action === "scope") {
    const dirty = publishDirtyPaths(ctx, executeRun ? [] : candidates(ctx).items);
    if (dirty.length) return refuse("dirty_publish_paths", { paths: dirty });
  }
  ctx.dir = run.make ? run.make() : /** @type {string} */ (run.dir);
  if (!saved.value) writeFileSync(join(ctx.dir, "run.json"), `${JSON.stringify(/** @type {PublishRunRecord} */ ({ command: "publish", feature: feature ?? null, ...(executeRun && { execute_run: executeRun }) }))}\n`);
  return act(ctx, action === "apply" ? (/** @type {() => string} */ (stdin))() : undefined);
}

/**
 * @param {{ exit: number, [key: string]: unknown }} param0
 * @returns {CommandResult}
 */
const finish = ({ exit, ...json }) => ({ exit, json });

/** @type {PublishCommand} */
export const command = {
  options: { root: "qa-dir", stdin: "flag", dir: "value", run: "value" },
  actions: {
    scope: { usage: "[<feature>] [--dir <run-dir>] [--root <qa-dir>]", run: (args, options) => withRun("scope", args, options, (ctx) => {
      const scope = trackerScope(ctx);
      const { tracker, mark_field, scenarios, suites, cases } = scope;
      const scopedBugs = [...ctx.bugs, ...(ctx.olderBugs ?? [])];
      const fields = scopedBugs.length && ctx.config.bug_publish ? { ...scope.fields, case: [...scope.fields.case, "issuelinks"] } : scope.fields;
      const bugCases = ctx.config.bug_publish ? scopedBugs.flatMap((bug) => {
        const key = ctx.index.tracker.current("case", String(bug.file.data.case));
        return key ? [key] : [];
      }) : [];
      // The local published bugs of an in-scope case, so the scout can tell a linked hit from one
      // whose earlier link failed. The CLI filters linked keys after the fetch.
      const bugStatuses = ctx.config.bug_publish ? (ctx.allBugs ?? []).filter((bug) => bug.file.data.status === "published" && typeof bug.file.data.tracker === "string" && scopedBugs.some((scoped) => scoped.file.data.case === bug.file.data.case)).map((bug) => String(bug.file.data.tracker)) : [];
      const fetch_prose = ctx.execute_run ? [] : missingProse(ctx, candidates(ctx).items);
      return /** @type {PublishScopeResult} */ ({ exit: 0, json: { dir: ctx.dir, payload_file: join(ctx.dir, "tracker.json"), tracker, fields, label_destinations: canPublishLabels(ctx.config.schemaVersion) ? configuredLabelDestinations(labelDefinitions(ctx.index.project?.data ?? {}), ctx.mapping) : [], mark_field, mark_search: markSearch(ctx), scenarios, suites, cases: [...new Set([...cases, ...bugCases])].sort(), ...(scopedBugs.length && ctx.config.bug_publish && { bug_metadata: { issue_type: ctx.config.bug_publish.issue_type, project: ctx.mapping.project }, bug_statuses: [...new Set(bugStatuses)].sort() }), stories: ctx.execute_run ? [] : parkedStories(/** @type {import("./publish-parked.mjs").PublishContext} */ (/** @type {unknown} */ (ctx))), fetch_prose, access: trackerAccess(ctx), train: trainFor(ctx.index, PUBLISH_TRAIN_KEY) } });
    }) },
    card: { usage: "[<feature>] --dir <run-dir> [--root <qa-dir>]", run: (args, options) => withRun("card", args, options, (ctx) => finish((/** @type {(ctx: PublishContext, dir: string) => import("./card-run.mjs").CardShown<PublishCardData> | import("./card-run.mjs").CardRefused} */ (lifecycle.card))(ctx, ctx.dir))) },
    apply: { usage: "--dir <run-dir> --stdin [--root <qa-dir>]", run: (args, options) => withRun("apply", args, options, (ctx, text) => finish(lifecycle.apply(ctx, ctx.dir, /** @type {string} */ (text)))) },
    record: { usage: "--dir <run-dir> [--root <qa-dir>]", run: (args, options) => withRun("record", args, options, (ctx) => accepted(ctx, "record")) },
  },
  refuse: (e) => refuse(/** @type {string} */ (e.detail.code), e.detail),
};

/**
 * @param {unknown} v
 * @returns {string[]}
 */
const stringsIn = (v) => (Array.isArray(v) ? v.filter((k) => typeof k === "string") : []);
// A publish mark is the permanent Key; a mark written before the migration is the entry's former `new_…` Key.
/**
 * @param {string} key
 * @param {Record<string, unknown>} data
 * @returns {string[]}
 */
const marksFor = (key, data) => [...new Set([key, ...stringsIn(data.formerly).filter((key) => PATTERN.provisional.test(key))])];

/**
 * @param {PublishContext} ctx
 * @returns {{ field: string, values: string[] }}
 */
function markSearch(ctx) {
  /** @type {string[]} */
  const values = [];
  if (ctx.execute_run) return { field: ctx.mapping.marker_field, values: [...ctx.bugs, ...(ctx.olderBugs ?? [])].map((bug) => String(bug.file.data.key)) };
  for (const [key, declarations] of ctx.index.cases) for (const d of declarations) {
    if (!ctx.feature || d.feature === ctx.feature) values.push(...marksFor(key, /** @type {Record<string, unknown>} */ (d.entry.data)));
  }
  for (const [key, declarations] of ctx.index.scenarios) for (const d of declarations) {
    if (!ctx.feature || d.feature === ctx.feature) values.push(...marksFor(key, /** @type {Record<string, unknown>} */ (d.file.data)));
  }
  for (const declarations of ctx.index.features.values()) for (const { file } of declarations) {
    if ((!ctx.feature || file.data.key === ctx.feature) && typeof file.data.suite_key === "string") values.push(file.data.suite_key);
  }
  if (ctx.config.bug_publish) for (const bug of ctx.bugs) values.push(String(bug.file.data.key));
  return { field: ctx.mapping.marker_field, values: [...new Set(values)] };
}

// The tracker keys an entry claims: its current one and its former ones (ADR-0027).
/**
 * @param {Record<string, unknown>} data
 * @returns {string[]}
 */
function claimedKeys(data) {
  return [...new Set([data.tracker, ...stringsIn(data.tracker_formerly)].filter((/** @type {unknown} */ k) => typeof k === "string"))];
}

// Why Publish refuses a Case or Scenario the resolver cannot settle, or null. Two declarations of
// one Key are a person's to reconcile; distinct entries of one kind and Feature are a Merge, which
// applies within one Feature only (ADR-0027).
/**
 * @param {PublishContext} ctx
 * @param {"case" | "scenario"} kind
 * @param {string} key
 * @returns {{ reason: string, remedy: string, with: string[] } | null}
 */
function ambiguity(ctx, kind, key) {
  const declarations = (kind === "case" ? ctx.index.cases : ctx.index.scenarios).get(key) ?? [];
  if (declarations.length > 1) return { reason: "ambiguous_same_key", remedy: "reconcile", with: [] };
  const d = declarations[0];
  if (!d) return null;
  for (const tracker of claimedKeys(kind === "case" ? (/** @type {{ entry: { data: Record<string, unknown> } }} */ (d)).entry.data : (/** @type {{ file: { data: Record<string, unknown> } }} */ (d)).file.data)) {
    const found = /** @type {{ status: "absent" | "retired" } | { status: "unique", entry: unknown } | { status: "ambiguous", entries: Array<{ kind: string, key: string, feature?: string }> }} */ (ctx.index.tracker.resolve(tracker));
    if (found.status !== "ambiguous") continue;
    const others = found.entries.filter((e) => !(e.kind === kind && e.key === key));
    const merge = others.length > 0 && others.every((/** @type {{ kind: string, feature?: string }} */ e) => e.kind === kind && e.feature === d.feature);
    const names = [...new Set(others.map((e) => e.key))];
    if (merge) return { reason: "ambiguous_merge", remedy: "merge", with: names };
    return { reason: others.length ? "ambiguous_tracker_key" : "ambiguous_same_key", remedy: "reconcile", with: names };
  }
  return null;
}

/**
 * @param {PublishContext} ctx
 * @param {string} value
 * @param {Record<string, unknown>} data
 * @returns {{ label: string, field: string, value: string, aliases?: string[] }}
 */
const marker = (ctx, value, data) => {
  const aliases = marksFor(value, data).filter((key) => key !== value);
  return { label: ctx.mapping.marker_label, field: ctx.mapping.marker_field, value, ...(aliases.length && { aliases }) };
};

/**
 * @param {Record<string, unknown>} hit
 * @returns {Record<string, unknown>}
 */
const caseFieldsFromTracker = (hit) => Object.fromEntries(["summary", "preconditions", "steps", "expected", "roles", "level", "scenario"].map((field) => [field, hit[field]]));

/**
 * @param {PublishContext} ctx
 * @param {"case" | "scenario"} kind
 * @param {string} key
 * @param {Record<string, unknown>} data
 * @returns {{ refusal?: { reason: string, hits?: string[], tracker_key?: string, issue_type?: string | null, expected?: string, current?: string | null, claim?: string }, hit?: TrackerCaseItem | TrackerScenarioItem | TrackerSuiteItem }}
 */
function markedHit(ctx, kind, key, data) {
  if (!ctx.tracker.ok) return {};
  const values = marksFor(key, data);
  const hits = [...new Map([...ctx.tracker.markedCases, ...ctx.tracker.markedScenarios, ...ctx.tracker.markedSuites].filter(([, item]) => values.includes(/** @type {string} */ (item.mark)))).values()];
  if (hits.length > 1) return { refusal: { reason: "multiple_mark_hits", hits: hits.map((item) => item.key) } };
  const hit = hits[0];
  const own = kind === "case" ? ctx.tracker.markedCases : ctx.tracker.markedScenarios;
  if (hit && (hit.issue_type !== (/** @type {Record<string, string>} */ (ctx.mapping))[`${kind}_type`] || !own.has(hit.key))) {
    return { refusal: { reason: "mark_wrong_kind", tracker_key: hit.key, issue_type: hit.issue_type, expected: (/** @type {Record<string, string>} */ (ctx.mapping))[`${kind}_type`] } };
  }
  if (hit) {
    const current = ctx.index.tracker.current(kind, key);
    const claim = ctx.index.tracker.resolve(hit.key);
    if ((current && current !== hit.key) || (!current && claim.status !== "absent")) {
      return { refusal: { reason: "mark_linked_elsewhere", tracker_key: hit.key, current, claim: claim.status } };
    }
  }
  return { hit };
}

/**
 * @param {PublishContext} ctx
 * @returns {{ items: PublishCardItem[], skipped: PublishSkippedItem[] }}
 */
function candidates(ctx) {
  /** @type {PublishCardItem[]} */
  const cases = [];
  /** @type {Map<string, PublishCardItem>} */
  const scenarios = new Map();
  /** @type {PublishSkippedItem[]} */
  const skipped = [];
  const summary = summaries(ctx.index);
  const resolver = ctx.index.tracker;
  const reviews = new Map(ctx.scan.history.reviews.map((/** @type {{ key: string, [key: string]: unknown }} */ r) => [r.key, r]));
  const { suites, refused: refusedFeatures } = /** @type {{ suites: Map<string, PublishCardItem>, refused: Set<string> }} */ (suiteCandidates(ctx, summary, skipped));
  /** @type {Map<string, { reason: string, hits?: string[], tracker_key?: string, issue_type?: string | null, expected?: string, current?: string | null, claim?: string, [key: string]: unknown }>} */
  const refusedScenarios = new Map();
  for (const [key, decls] of ctx.index.scenarios) {
    const d = decls[0];
    if (ctx.feature && d.feature !== ctx.feature) continue;
    const { hit, refusal } = markedHit(ctx, "scenario", key, /** @type {Record<string, unknown>} */ (d.file.data));
    if (refusal) {
      refusedScenarios.set(key, refusal);
      skipped.push({ key, label: keyLabel(key, summary.scenario(key)), ...refusal });
      continue;
    }
    if (ambiguity(ctx, "scenario", key) || resolver.current("scenario", key)) continue;
    if (hit) scenarios.set(key, { code: "recover_scenario", key, label: keyLabel(key, summary.scenario(key)),
      feature: d.feature, file: d.file.rel, tracker_key: hit.key,
      mirror: { suite: (/** @type {TrackerScenarioItem} */ (hit)).suite, summary: typeof hit.summary === "string" ? oneLine(hit.summary) : null, at: ctx.tracker.at }, needs: [], edits: [] });
  }
  for (const [key, decls] of ctx.index.cases) {
    const d = decls[0];
    if (ctx.feature && !decls.some((x) => x.feature === ctx.feature)) continue;
    const label = keyLabel(key, d.entry.summary);
    const review = reviews.get(key);
    const scenario = (/** @type {{ data: { key: string } }} */ (/** @type {unknown} */ (d.file))).data.key;
    const parentRefusal = ambiguity(ctx, "scenario", scenario) ?? refusedScenarios.get(scenario);
    const refused = ambiguity(ctx, "case", key) ?? (parentRefusal && { ...parentRefusal, subject: scenario });
    if (refused) { skipped.push({ key, label, ...refused }); continue; }
    const tracker = resolver.current("case", key);
    const { hit, refusal } = markedHit(ctx, "case", key, /** @type {Record<string, unknown>} */ (d.entry.data));
    if (refusal) { skipped.push({ key, label, ...refusal }); continue; }
    if (!tracker && hit) {
      const copies = canPublishLabels(ctx.config.schemaVersion) ? recoveredLabelCopies(hit, labelDefinitions(ctx.index.project?.data ?? {}), ctx.mapping) : {};
      cases.push({ code: "recover_case", key, label, feature: d.feature, file: d.file.rel,
        tracker_key: hit.key, ...copies, mirror: { ...copies.mirror, status: (/** @type {TrackerCaseItem} */ (hit)).status, auto_status: (/** @type {TrackerCaseItem} */ (hit)).auto_status,
          ...writtenMirror(caseFieldsFromTracker(hit)), summary: typeof hit.summary === "string" ? oneLine(hit.summary) : null,
          at: ctx.tracker.at }, needs: [], edits: [] });
      continue;
    }
    const creating = tracker === null;
    // A refused Suite holds back only the creates that would hang under it; updates still go.
    if (refusedFeatures.has(d.feature) && (creating || !(resolver.current("scenario", scenario) ?? scenarios.get(scenario)?.tracker_key))) {
      skipped.push({ key, label, reason: "suite_refused", subject: d.feature });
      continue;
    }
    const scenarioLink = resolver.current("scenario", scenario);
    const moved = /** @type {[string, string, string] | undefined} */ ([["cases", tracker, key], ["scenarios", scenarioLink, scenario]].find(([name, requested]) => {
      const current = (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).requests?.[/** @type {"cases" | "scenarios"} */ (name)].get(/** @type {string} */ (requested));
      return current && current !== requested;
    }));
    if (moved) {
      const [name, requested, subject] = moved;
      skipped.push({ key, label, reason: "tracker_key_moved", remedy: "sync", subject, tracker: requested, current: (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).requests[/** @type {"cases" | "scenarios"} */ (name)].get(requested) });
      continue;
    }
    const scenarioTracker = scenarioLink ?? scenarios.get(scenario)?.tracker_key;
    const fields = caseFields(d.entry, scenarioTracker ?? scenario);
    const feature = /** @type {{ rel: string, data: { suite_key?: string, mirror?: { suite?: string }, sources?: unknown } } | undefined} */ (featureFile(ctx.index, d.feature));
    const definitions = labelDefinitions(ctx.index.project?.data ?? {});
    const invalidLabels = canPublishLabels(ctx.config.schemaVersion) ? caseLabelProblems(d.entry.data, definitions) : [];
    if (invalidLabels.length) { skipped.push({ key, label, reason: "case_labels_invalid", problems: invalidLabels }); continue; }
    const projection = canPublishLabels(ctx.config.schemaVersion) ? publishedLabels(d.entry.data, definitions, ctx.mapping) : [];
    const currentLabels = !creating && ctx.tracker.ok ? ctx.tracker.cases.get(/** @type {string} */ (tracker)) : undefined;
    const observedCopies = currentLabels ? recoveredLabelCopies(currentLabels, definitions, ctx.mapping) : {};
    const observed = publishedLabels({ ...d.entry.data, ...observedCopies, mirror: { ...(/** @type {object} */ (d.entry.data.mirror) ?? {}), ...observedCopies.mirror }, mirror_fields: observedCopies.mirror_fields, mirror_field_targets: observedCopies.mirror_field_targets }, definitions, ctx.mapping);
    const matching = projection.filter((p) => !p.known && observed.some((o) => o.id === p.id && o.known && sameLabelValue(p.cardinality, p.desired, o.copy)));
    const resolved = resolveLabelDestinations(projection, ctx.tracker.ok ? ctx.tracker.label_destinations : [], ctx.mapping);
    if (resolved.problems.length && (creating || labelsDiffer(projection) || !sameOwnedFields(fields, d.entry.data.mirror))) { skipped.push({ key, label, reason: "label_destination_invalid", problems: resolved.problems }); continue; }
    if (matching.length) {
      const operations = resolved.labels.filter((op) => matching.some((p) => p.id === op.id));
      const confirmations = observed.filter((o) => matching.some((p) => p.id === o.id)).map((o) => ({ id: o.id, kind: o.kind, destination: o.destination, value: o.copy }));
      const copies = confirmedLabelCopies(operations, /** @type {import("./publish-labels.mjs").ConfirmedLabel[]} */ (confirmations));
      cases.push({ code: "local_copy_case", key, label, feature: d.feature, file: d.file.rel, tracker_key: /** @type {string} */ (tracker), ...copies, markdown: `Records label copies locally; no tracker write.\n\n${table(["Label", "Destination", "Observed value"], matching.map((p) => [p.name, p.destination, observed.find((o) => o.id === p.id)?.copy ?? "clear"]))}`, needs: [], edits: [] });
    }
    const pending = projection.filter((p) => !matching.includes(p));
    if (!creating && sameOwnedFields(fields, d.entry.data.mirror) && !labelsDiffer(pending)) continue;
    const reason = !review ? "unreviewed" : review.status !== "fresh" ? "review_not_fresh" : null;
    if (reason) { skipped.push({ key, label, reason }); continue; }
    const unavailable = !feature ? "parent_creation_not_supported" : !creating && ctx.tracker.ok && !ctx.tracker.cases.has(tracker) ? "tracker_case_vanished" : null;
    if (unavailable) { skipped.push({ key, label, reason: unavailable }); continue; }
    const suiteOf = (/** @type {unknown} */ s) => (ctx.tracker.ok ? ctx.tracker.scenarios.get(/** @type {string} */ (resolver.current("scenario", (/** @type {{ file: { data: { key: string } } }} */ (s)).file.data.key)))?.suite : null) ?? (/** @type {{ file: { data: { mirror?: { suite?: string } } } }} */ (s)).file.data.mirror?.suite;
    const knownSuite = suites.get(d.feature)?.tracker_key ?? scenarios.get(scenario)?.mirror?.suite ?? (ctx.tracker.ok ? ctx.tracker.scenarios.get(/** @type {string} */ (scenarioTracker))?.suite : null) ?? (/** @type {{ data: { mirror?: { suite?: string } } }} */ (/** @type {unknown} */ (d.file))).data.mirror?.suite ?? (/** @type {NonNullable<typeof feature>} */ (feature)).data.mirror?.suite
      ?? [...ctx.index.scenarios.values()].flat().filter((s) => s.file.data.feature === d.feature).map(suiteOf).find((s) => typeof s === "string" && (/** @type {RegExp} */ (ctx.config.trackerPattern)).test(s));
    if (!knownSuite && !(/** @type {NonNullable<typeof feature>} */ (feature)).data.suite_key) { skipped.push({ key, label, reason: "suite_key_missing", remedy: "migrate-keys" }); continue; }
    if (!knownSuite && !suites.has(d.feature)) suites.set(d.feature, {
      code: "create_suite", key: d.feature, label: keyLabel(d.feature, summary.feature(d.feature)), feature: d.feature, file: (/** @type {NonNullable<typeof feature>} */ (feature)).rel,
      needs: [], edits: [], issue_type: ctx.mapping.suite_type, marker: marker(ctx, /** @type {string} */ ((/** @type {NonNullable<typeof feature>} */ (feature)).data.suite_key), {}), fields: { summary: summary.feature(d.feature) },
    });
    const suite = /** @type {string} */ (knownSuite ?? d.feature);
    const suiteItem = suites.get(d.feature);
    if (!scenarioTracker && !scenarios.has(scenario)) scenarios.set(scenario, {
      code: "create_scenario", key: scenario, label: keyLabel(scenario, summary.scenario(scenario)), feature: d.feature, file: d.file.rel,
      suite, requires: suiteItem ? [suiteItem] : [], needs: [], edits: [], issue_type: ctx.mapping.scenario_type,
      marker: marker(ctx, scenario, /** @type {Record<string, unknown>} */ ((/** @type {{ data: Record<string, unknown> }} */ (/** @type {unknown} */ (d.file))).data)), fields: { summary: summary.scenario(scenario), suite },
    });
    const scenarioItem = scenarios.get(scenario);
    // The case's own current and former Tracker keys never come back as story links.
    const own = new Set(claimedKeys(/** @type {Record<string, unknown>} */ (d.entry.data)));
    const references = (/** @type {unknown} */ sources) => (Array.isArray(sources) ? sources : []).map(readTrackerReference).filter((key) => key !== null)
      .filter((s) => s !== scenario && s !== scenarioTracker && s !== suite && !own.has(s) && (/** @type {RegExp} */ (ctx.config.trackerPattern)).test(s));
    const mine = references(d.entry.data.sources);
    const stories = [...new Set(mine.length ? mine : references(feature?.data.sources))];
    const current = creating ? undefined : (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).cases?.get(/** @type {string} */ (tracker));
    const labelBefore = (/** @type {PublishedLabel} */ p) => {
      const observed = current?.label_values?.find((c) => c.id === p.id && c.destination === p.destination);
      return observed ? observed.value : p.destination === "labels" && Array.isArray(current?.labels) ? current.labels.filter((value) => p.managed?.includes(value)).sort() : p.known ? p.copy : null;
    };
    const diverges = creating ? [] : Object.keys(fields).filter((field) => !sameOwned(field, current?.[field], (/** @type {Record<string, unknown> | undefined} */ (d.entry.data.mirror))?.[field]));
    const fieldValue = (/** @type {string} */ field, /** @type {unknown} */ value) => field === "scenario" && typeof value === "string" ? keyLabel(value, summary.scenario(scenario) ?? (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).scenarios?.get(value)?.summary ?? "Test Scenario") : value;
    cases.push({ code: creating ? "create_case" : "update_case", key, label, feature: d.feature, file: d.file.rel, scenario, suite,
      ...(resolved.labels.some((op) => pending.some((p) => p.id === op.id)) && { labels: resolved.labels.filter((op) => pending.some((p) => p.id === op.id)) }),
      target: { scenario: keyLabel(scenario, summary.scenario(scenario)), suite: suiteItem?.label ?? keyLabel(suite, "Test Suite") }, requires: /** @type {PublishCardItem[]} */ ([suiteItem, scenarioItem].filter(Boolean)), needs: [], edits: [], stories,
      ...(creating ? {
        issue_type: ctx.mapping.case_type, marker: marker(ctx, key, /** @type {Record<string, unknown>} */ (d.entry.data)),
        links: stories.map((story) => ({ to: story, type: ctx.mapping.link_type })), fields: { ...fields, status: ctx.mapping.initial_status },
      } : {
        tracker_key: /** @type {string} */ (tracker), fields, changes: Object.fromEntries([...Object.entries(fields).map(([field, value]) => [field, { from: current?.[field] ?? null, to: value }]), ...pending.map((p) => [p.id, { from: labelBefore(p), to: p.desired }])]),
        markdown: table(["Field", "Tracker value", "New value"], [...Object.entries(fields).map(([field, value]) => [(/** @type {Record<string, string>} */ (FIELD_LABELS))[field], fieldValue(field, current?.[field] ?? null), fieldValue(field, value)]), ...pending.map((p) => [p.name, labelBefore(p) ?? "unknown", p.clear ? "clear" : p.desired])]),
        diverges, needs: diverges.length ? ["confirm"] : [],
      }),
    });
  }
  /** @type {PublishCardItem[]} */
  const repairs = [];
  for (const [feature, declarations] of ctx.index.features) {
    if (ctx.feature && ctx.feature !== feature) continue;
    const file = declarations[0].file;
    for (const [repair_index, repair] of (/** @type {Array<{ kind: string, key?: string, tracker?: string, [key: string]: unknown }>} */ (file.data.repairs ?? [])).entries()) {
      const key = /** @type {string} */ (repair.kind === "remark" ? repair.key : repair.tracker);
      const label = keyLabel(key, PATTERN.suite.test(key) ? summary.feature(feature) : summary.testCase(key) ?? summary.scenario(key));
      if (repair.kind === "retire" && !(typeof ctx.mapping.retire_transition === "string" && ctx.mapping.retire_transition.trim())) {
        skipped.push({ key, label, tracker_key: repair.tracker, feature, file: file.rel, repair_index, reason: "retire_transition_missing", field: "tracker.retire_transition" });
        continue;
      }
      repairs.push({ code: repair.kind, key, label,
        tracker_key: repair.tracker, feature, file: file.rel, repair_index,
        ...(repair.kind === "remark" ? { fields: { [ctx.mapping.marker_field]: repair.key } } : { transition: ctx.mapping.retire_transition }), needs: [], edits: [] });
    }
  }
  // A Suite remark runs before the creates under that Suite, which depend on it.
  const suiteRemarks = repairs.filter((r) => r.code === "remark" && PATTERN.suite.test(r.key));
  for (const remark of suiteRemarks) {
    for (const item of [...scenarios.values(), ...cases]) if (["create_scenario", "create_case"].includes(item.code) && item.suite === remark.tracker_key) item.requires = [remark, ...(item.requires ?? [])];
  }
  const items = [...suites.values(), ...suiteRemarks, ...scenarios.values(), ...cases, ...repairs.filter((r) => !suiteRemarks.includes(r))];
  items.forEach((item, at) => { item.n = at + 1; });
  for (const item of items) if (item.requires) item.requires = item.requires.map((parent) => /** @type {number} */ ((/** @type {PublishCardItem} */ (parent)).n));
  return { items, skipped };
}

/**
 * @param {PublishContext} ctx
 * @param {string[]} args
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
const gitFor = (ctx, args) => spawnSync("git", ["--literal-pathspecs", ...args], { cwd: ctx.repo, encoding: "utf8" });

/**
 * The publish paths that are dirty: an item's file changed in any way, or a bug file whose staged and
 * unstaged content differ (a split index). The dirty-tree check itself is `git.mjs`'s
 * `uncommittedPaths`; only the bug-file split-index rule is publish's own.
 * @param {PublishContext} ctx
 * @param {PublishCardItem[]} items
 * @returns {string[]}
 */
function publishDirtyPaths(ctx, items) {
  const paths = [...new Set(items.filter((i) => !["create_bug", "recover_bug", "older_draft"].includes(i.code)).map((i) => ctx.repoPath(/** @type {string} */ (i.file))))].sort();
  const result = uncommittedPaths(ctx.repo, paths);
  if (result.error) throw new UsageError("Publish paths could not be checked", { code: "git_status_failed", ...result.error });
  return [...new Set([.../** @type {string[]} */ (result.paths), ...splitIndexBugPaths(ctx)])].sort();
}

/**
 * The local bug files whose index entry and working-tree content both changed, which publish refuses
 * so its whole-file record never commits half of an edit.
 * @param {PublishContext} ctx
 * @returns {string[]}
 */
function splitIndexBugPaths(ctx) {
  /** @type {string[]} */
  const paths = [];
  for (const bug of (ctx.allBugs ?? ctx.bugs)) {
    const path = ctx.repoPath(bug.rel);
    const status = gitFor(ctx, ["status", "--porcelain=v1", "-z", "--", path]);
    if (status.status !== 0) throw new UsageError("Publish paths could not be checked", { code: "git_status_failed" });
    if (status.stdout.split("\0").some((line) => line.length > 2 && line[0] !== " " && line[0] !== "?" && line[1] !== " ")) paths.push(path);
  }
  return paths;
}

/**
 * @param {PublishContext} ctx
 * @param {PublishCardItem[]} items
 * @returns {string[]}
 */
function missingProse(ctx, items) {
  return items.filter((i) => ["update_case", "recover_case"].includes(i.code) && PROSE_FIELDS.some((f) =>
    (i.code === "recover_case" ? (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).markedCases : (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).cases)?.get(/** @type {string} */ (i.tracker_key))?.[f] === undefined,
  )).map((i) => /** @type {string} */ (i.tracker_key));
}

/**
 * @param {PublishContext} ctx
 * @returns {{ card?: PublishCardData, seal?: unknown, refused?: CardRefusal[] }}
 */
function build(ctx) {
  if (!ctx.tracker.ok) {
    const note = /** @type {TrackerNote | null | undefined} */ (ctx.tracker.note);
    const access = note?.access_note ? accessNoteNamed(ctx.index, /** @type {string} */ (note.access_note)) : null;
    return { refused: [fact("tracker_not_ready", { note: access ? { ...note, access } : note })] };
  }
  const scoped = ctx.execute_run ? { items: /** @type {PublishCardItem[]} */ ([]), skipped: /** @type {PublishSkippedItem[]} */ ([]) } : candidates(ctx);
  const bugs = bugCandidates(ctx, { cases: scoped.items, skipped: scoped.skipped });
  if (bugs.refused.length) return { refused: bugs.refused };
  const cases = [...scoped.items, ...bugs.items];
  const missing = missingProse(ctx, scoped.items);
  if (missing.length) return { refused: [fact("prose_not_fetched", { keys: missing })] };
  const dirty = publishDirtyPaths(ctx, cases);
  if (dirty.length) return { refused: [fact("dirty_publish_paths", { paths: dirty })] };
  const parked = ctx.execute_run ? { items: [], skipped: [] } : parkedCandidates(/** @type {import("./publish-parked.mjs").PublishContext} */ (/** @type {unknown} */ (ctx)), cases.length);
  /** @type {PublishCardItem[]} */
  const items = [...cases, ...parked.items];
  const skipped = [...scoped.skipped, ...bugs.skipped, ...parked.skipped];
  const card = { notices: labelNotices(ctx), counts: { changes: items.length, questions: items.filter((i) => i.diverges?.length).length }, items, skipped, fields: { ...FIELD_LABELS, ...Object.fromEntries(items.flatMap((i) => (i.labels ?? []).map((p) => [p.id, p.name]))) }, glossary: glossaryOf(new Set(["Publish", "Review", ...(items.some((i) => i.diverges?.length) ? ["Divergence", "Mirrored value"] : [])])), labels: Object.fromEntries([...items, ...skipped].map((i) => [i.key, i.label])) };
  return { card, seal: { card, payload: ctx.payload, files: ctx.files.map((f) => [f.rel, f.text]), bugs: [...ctx.bugs, ...(ctx.olderBugs ?? [])].map((b) => [b.rel, b.file.text]), execute_run: ctx.execute_run, followUps: ctx.followUps, source: sourceSeal(/** @type {SyncContext} */ (/** @type {unknown} */ (ctx))) } };
}

const lifecycle = cardRun(/** @type {CardAdapter<PublishContext, unknown, PublishCardData, PublishCardData>} */ ({
  kind: "publish", keepData: true, run: RUN, fact, build, data: (_ctx, card) => card,
  decisions: (_ctx, card, input) => {
    const decisions = publishDecisions(input, card.items);
    return { ...decisions, errors: decisions.errors.map(refusalOf) };
  },
  /**
   * @param {PublishContext} ctx
   * @param {PublishCardData} card
   * @param {PublishApplyDecisions} reply
   */
  apply(ctx, card, reply) {
    const cascaded = /** @type {Array<{ n: number, [key: string]: unknown }>} */ (cascade(reply.drop, card.items));
    const cascadedNumbers = cascaded.map((/** @type {{ n: number }} */ c) => c.n);
    const dropped = new Set([...reply.drop, ...cascadedNumbers]);
    const discarded = card.items.filter((i) => (reply.discard ?? []).includes(/** @type {number} */ (i.n)));
    const open = card.items.filter((i) => i.takeable !== false && !reply.take.includes(/** @type {number} */ (i.n)) && !dropped.has(/** @type {number} */ (i.n)) && !(reply.discard ?? []).includes(/** @type {number} */ (i.n))).map((i) => /** @type {number} */ (i.n));
    if (open.length) return { refused: [fact("unaddressed", { items: open })], data: { open } };
    const items = card.items.filter((i) => reply.take.includes(/** @type {number} */ (i.n)) && !dropped.has(/** @type {number} */ (i.n)));
    const divergences = items.filter((i) => i.diverges?.length && !reply.confirm.includes(/** @type {number} */ (i.n)) && !ctx.confirmed?.includes(/** @type {number} */ (i.n)));
    const answers = reply.fields ?? {};
    const needs = items.flatMap((item) => item.code === "create_bug" ? bugMissing(item, answers).map((field) => ({ item: /** @type {number} */ (item.n), field: field.id, ...(field.allowed_values && { allowed_values: field.allowed_values }) })) : []);
    const confirmItems = items.filter((item) => item.code === "create_bug" && bugNeedsConfirm(item)).map((item) => ({ item: /** @type {number} */ (item.n), key: item.key, stale: item.stale === true, ...(item.open_hits?.length && { open_hits: item.open_hits }) }));
    const effectiveConfirmed = new Set([...(ctx.confirmed ?? []), ...(reply.confirmed ?? []), ...(reply.confirm ?? [])]);
    if (ctx.phase !== "record" && (reply.confirmed ?? []).length) {
      /** @type {number[]} */
      let pending = [];
      try { pending = /** @type {number[]} */ (JSON.parse(readFileSync(join(ctx.dir, "card.json"), "utf8")).pending?.confirmed ?? []); } catch {}
      if (!(reply.confirmed ?? []).every((n) => pending.includes(n))) return { refused: [fact("confirmation_not_pending")] };
      if ((reply.confirmed ?? []).some((n) => !confirmItems.some((entry) => entry.item === n))) return { refused: [fact("confirmation_not_pending")] };
    }
    const unconfirmed = confirmItems.filter((entry) => !effectiveConfirmed.has(entry.item));
    if (cascaded.length || divergences.length || needs.length || unconfirmed.length) {
      const confirmNumbers = [...new Set([...(reply.confirmed ?? []), ...unconfirmed.map((entry) => entry.item)])];
      const decisions = {
        ...reply.input,
        ...(cascaded.length && { take: reply.take.filter((n) => !dropped.has(n)), drop: [...dropped].sort((a, b) => a - b), edits: Object.fromEntries(Object.entries(reply.edits).filter(([n]) => !dropped.has(Number(n)))) }),
        ...((divergences.length || cascaded.length) && { confirm: [...new Set([...cascadedNumbers, ...divergences.map((i) => /** @type {number} */ (i.n))])] }),
        ...(confirmNumbers.length && { confirmed: confirmNumbers }),
      };
      return { confirm: {
        ...(cascaded.length && { cascade: cascaded.map((/** @type {{ n: number }} */ c) => ({ ...c, label: (/** @type {PublishCardItem} */ (card.items.find((i) => i.n === c.n))).label })), removed: Object.keys(reply.edits).map(Number).filter((n) => dropped.has(n)) }),
        ...(divergences.length && { divergences: divergences.map(({ n, label, changes, diverges }) => ({ n, label, changes, diverges })) }),
        ...(needs.length && { needs_edit: needs }),
        ...(unconfirmed.length && { confirm_items: unconfirmed }),
        decisions,
      } };
    }
    if (ctx.phase === "record") return record(ctx, items, discarded, reply);
    const { confirm: _confirm, confirmed: _confirmed, ...decisions } = reply.input;
    writeFileSync(join(ctx.dir, "publish.json"), `${JSON.stringify(/** @type {PublishFileRecord} */ ({ decisions, confirmed: [...effectiveConfirmed] }), null, 2)}\n`);
    return { changeset: EMPTY, data: { dir: ctx.dir, applied: items.map((i) => i.n), dropped: reply.drop, ...(discarded.length && { discarded: discarded.map((i) => i.n) }) }, report: () => null };
  },
}));

/**
 * @param {PublishContext} ctx
 * @param {string} phase
 * @returns {CommandResult}
 */
function accepted(ctx, phase) {
  /** @type {RunFileResult<PublishFileRecord>} */
  const saved = readRunFile(ctx.dir, "publish.json", RUN);
  if (saved.error) return refuse("run_dir", { reason: saved.error });
  if (!saved.value) return refuse("no_reply");
  ctx.phase = phase;
  ctx.confirmed = saved.value.confirmed;
  return finish(lifecycle.apply(ctx, ctx.dir, JSON.stringify(saved.value.decisions)));
}

/**
 * @param {string[]} args
 * @param {PublishActionContext} options
 * @returns {CommandResult}
 */
export function publisherBrief(args, options) {
  return withRun("publisher", args, options, (ctx) => {
    const checked = accepted(ctx, "brief");
    if (!checked.json.ok) return checked;
    const card = (/** @type {CardRecord<unknown, PublishCardData> & { card: PublishCardData }} */ (JSON.parse(readFileSync(join(ctx.dir, "card.json"), "utf8")))).card;
    const items = card.items.filter((i) => (/** @type {number[]} */ (checked.json.applied)).includes(/** @type {number} */ (i.n)));
    /** @type {PublishFileRecord} */
    const saved = JSON.parse(readFileSync(join(ctx.dir, "publish.json"), "utf8"));
    const writes = writesFor(ctx, items, /** @type {PublishApplyDecisions} */ (saved.decisions));
    const brief_file = join(ctx.dir, "scout-publisher.brief.md");
    const output_file = join(ctx.dir, "publisher-results.json");
    const access = trackerAccess(ctx);
    const practices = practicesText(ctx.index, PUBLISH_TRAIN_KEY);
    const record = /** @type {ScoutPublisherRecord} */ ({ writes, output_file, at: ctx.tracker.at });
    writeFileSync(join(ctx.dir, "scout-publisher.json"), `${JSON.stringify(record, null, 2)}\n`);
    writeFileSync(brief_file, publisherPrompt({ writes, output: output_file, tracker: { provider: ctx.mapping.provider, project: ctx.mapping.project }, access, practices }));
    return { exit: 0, json: { ok: true, dir: ctx.dir, brief_file, output_file, access: access?.key ?? null, writes: writes.length, ...(writes.length ? {} : { no_publisher: true }) } };
  });
}

// Recovery and local-copy items record locally; they never make a Publisher write.
/**
 * @param {{ code: string }} item
 * @returns {boolean}
 */
const noPublisherWrite = (item) => item.code.startsWith("recover_") || item.code === "local_copy_case";

/**
 * @param {PublishContext} ctx
 * @param {PublishCardItem[]} items
 * @param {PublishApplyDecisions} decisions
 * @returns {PublisherWrite[]}
 */
function writesFor(ctx, items, decisions) {
  const answers = decisions.fields ?? {};
  const attach = decisions.attach ?? {};
  const cases = items.filter((i) => i.code !== "create_bug" && i.code !== "post_comment" && i.code !== "retire" && !noPublisherWrite(i));
  return [
    ...cases.map((i) => ({ action: i.code, n: /** @type {number} */ (i.n), key: i.key, ...(["update_case", "remark"].includes(i.code) ? { tracker_key: i.tracker_key } : { issue_type: i.issue_type }), fields: i.fields, ...(i.labels && { labels: i.labels }),
      ...(i.code === "create_case" && { suite: i.suite }), ...(i.marker && { marker: i.marker }),
    })),
    ...cases.flatMap((i) => (i.links ?? []).map((link) => ({ action: "link_case", n: /** @type {number} */ (i.n), key: i.key, ...link }))),
    ...items.filter((i) => i.code === "retire").map((i) => ({ action: i.code, n: /** @type {number} */ (i.n), key: i.key, tracker_key: /** @type {string} */ (i.tracker_key), transition: /** @type {string} */ (i.transition) })),
    ...items.filter((i) => i.code === "create_bug").map((i) => ({ action: "create_bug", n: /** @type {number} */ (i.n), key: i.key, issue_type: i.issue_type, fields: bugFieldsFor(i, answers), marker: i.marker, link: i.bug_link, attachments: bugAttachmentsFor(i, attach) })),
    ...parkedWrites(/** @type {import("./publish-parked.mjs").ParkedCommentItem[]} */ (items.filter((i) => i.code === "post_comment"))),
  ];
}

/**
 * @param {PublishContext} ctx
 * @param {PublishCardItem[]} items
 * @param {PublishCardItem[]} discarded
 * @param {PublishApplyDecisions} decisions
 * @returns {{ refused: CardRefusal[], rebuild?: boolean, data?: Record<string, unknown> } | { changeset: CardChangeset, data: Record<string, unknown>, report: () => unknown }}
 */
function record(ctx, items, discarded, decisions) {
  const writes = writesFor(ctx, items, decisions);
  /** @type {RunFileResult<ScoutPublisherRecord>} */
  const brief = readRunFile(ctx.dir, "scout-publisher.json", RUN);
  if (brief.error) return { refused: [fact("run_dir", { reason: brief.error })] };
  if (writes.length && !brief.value) return { refused: [fact("no_publisher_brief")] };
  if (writes.length && !isDeepStrictEqual(brief.value, { writes, output_file: join(ctx.dir, "publisher-results.json"), at: ctx.tracker.at })) return { refused: [fact("publisher_output_invalid")] };
  /** @type {RunFileResult<PublisherResultsRecord>} */
  const output = writes.length || existsSync(join(ctx.dir, "publisher-results.json")) ? readRunFile(ctx.dir, "publisher-results.json", RUN) : { value: { results: [] } };
  if (output.error || !object(output.value) || !Array.isArray(output.value.results)) return { refused: [fact("publisher_output_invalid", { reason: output.error ?? "results must be a list" })] };
  const results = /** @type {PublisherResultsRecord} */ (output.value).results;
  const former = new Set(ctx.files.flatMap((f) => [f.data.mirror?.suite, f.data.formerly, ...f.cases.map((c) => c.data.formerly)].flatMap((keys) => Array.isArray(keys) ? keys : [keys])));
  const held = (/** @type {string} */ key) => former.has(key) || ctx.index.tracker.resolve(key).status !== "absent";
  const access = trackerAccess(ctx);
  const bugCaseKey = (/** @type {PublishCardItem} */ item) => {
    const link = item.bug_link?.case;
    if (typeof link === "string") return link;
    if (link && typeof link === "object" && "after" in link) return results.find((result) => result.n === link.after)?.tracker_key ?? null;
    return null;
  };
  const matches = (/** @type {PublisherResult} */ result, /** @type {PublishCardItem | undefined} */ item) => {
    if (!object(result) || !item || result.key !== (item.code === "post_comment" ? item.story : item.key)) return false;
    if (noPublisherWrite(item)) return false;
    const fields = ["n", "key", "error", "access_note", ...(item.code === "create_bug" ? ["tracker_key", "linked", "attached", "rebuild"] : []), ...(item.labels ? ["labels"] : []), ...(["create_suite", "create_case", "create_scenario"].includes(item.code) ? ["rebuild"] : []), ...(item.code === "post_comment" ? ["kind", "comment_id"] : ["update_case", "remark", "retire"].includes(item.code) ? [] : item.code === "create_case" ? ["tracker_key", "linked"] : ["tracker_key"])];
    if (Object.keys(result).some((key) => !fields.includes(key))) return false;
    if (result.error !== undefined && (typeof result.error !== "string" || !result.error.trim())) return false;
    if (result.rebuild !== undefined && (result.rebuild !== true || result.error === undefined || result.tracker_key !== undefined || result.linked !== undefined)) return false;
    if (result.access_note !== undefined && (result.error === undefined || result.access_note !== access?.key)) return false;
    if (item.labels && result.error === undefined && !confirmedLabelsMatch(item.labels, result.labels)) return false;
    if (["update_case", "remark", "retire"].includes(item.code)) return true;
    if (item.code === "post_comment") {
      if (result.kind !== undefined && result.kind !== "comment") return false;
      if (result.comment_id !== undefined && (typeof result.comment_id !== "string" || !result.comment_id.trim() || (item.comment_id !== null && result.comment_id !== item.comment_id))) return false;
      return result.error !== undefined || parkedMatches(result, /** @type {import("./publish-parked.mjs").ParkedCommentItem} */ (item));
    }
    if (result.tracker_key === undefined) return result.error !== undefined && result.linked === undefined;
    if (typeof result.tracker_key !== "string" || !ctx.config.trackerPattern.test(result.tracker_key) || held(result.tracker_key)) return false;
    const own = item.code === "create_case" ? (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).cases : item.code === "create_scenario" ? (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).scenarios : null;
    const existing = own?.get(/** @type {string} */ (result.tracker_key));
    if (existing || [(/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).cases, (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).scenarios, (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).markedCases, (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).markedScenarios, (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).markedSuites].some((m) => m.has(/** @type {string} */ (result.tracker_key))) || items.some((i) => i.suite === result.tracker_key)) return false;
    if (item.code === "create_bug") return bugResultMatches(result, item, bugAttachmentsFor(item, decisions.attach ?? {}), bugCaseKey(item));
    return item.code === "create_case"
      ? Array.isArray(result.linked) && result.linked.every((key) => (/** @type {string[]} */ (item.stories)).includes(key)) && new Set(result.linked).size === result.linked.length
      : result.linked === undefined;
  };
  if (!results.every((result) => matches(result, items.find((i) => i.n === result?.n))) || new Set(results.map((r) => r.n)).size !== results.length) return { refused: [fact("publisher_output_invalid")] };
  const targets = results.filter((r) => r.tracker_key !== undefined || r.comment_id !== undefined).map((r) => r.tracker_key !== undefined ? trackerReference(r.tracker_key) : `comment:${r.key}:${r.comment_id}`);
  if (new Set(targets).size !== targets.length) return { refused: [fact("publisher_output_invalid")] };
  /** @type {PublishCardItem[]} */
  const successes = [];
  /** @type {Array<{ n: number, key: string, label: string, error: string, rebuild?: boolean, requires?: number[], access?: unknown }>} */
  const failed = [];
  /** @type {Array<{n: number, key: string, error: string, remedy: string}>} */
  const manual = [];
  for (const item of items) {
    if (noPublisherWrite(item)) { successes.push(item); continue; }
    const result = results.find((r) => r.n === item.n);
    if (item.code === "create_bug" && result?.tracker_key) {
      successes.push(item);
      const linked = result.linked?.includes(/** @type {string} */ (bugCaseKey(item)));
      const ticked = bugAttachmentsFor(item, decisions.attach ?? {});
      const missing = ticked.filter((attachment) => !(result.attached ?? []).includes(attachment.name));
      if (result.error || !linked || missing.length) {
        const remedy = [
          ...(linked ? [] : [`Link ${result.tracker_key} to ${bugCaseKey(item)} by hand.`]),
          ...(missing.length ? [`Attach ${missing.map((attachment) => attachment.name).join(", ")} from ${ctx.execute_run ?? ctx.dir} by hand.`] : []),
          ...(!result.error && (linked || missing.length) ? [`Inspect ${result.tracker_key} by hand; do not republish it.`] : []),
          ...(result.error && linked && !missing.length ? [`Inspect ${result.tracker_key} by hand; do not republish it.`] : []),
        ].join(" ");
        manual.push({ n: /** @type {number} */ (item.n), key: item.key, error: result.error ?? (linked ? "An attachment was not uploaded." : "The case link was not completed."), remedy });
      }
      continue;
    }
    const parents = (/** @type {number[]} */ (item.requires ?? [])).filter((n) => !successes.some((i) => i.n === n));
    const error = !result ? "No result was recorded." : result.error ?? (parents.length ? "A required parent write did not succeed."
      : item.code === "create_case" && (/** @type {string[]} */ (result.linked)).length !== (/** @type {string[]} */ (item.stories)).length ? "The story links were not completed." : null);
    if (error) failed.push({ n: /** @type {number} */ (item.n), key: item.key, label: item.label, error, ...(result?.rebuild && { rebuild: true }), ...(parents.length && { requires: parents }), ...(result?.access_note && { access }) });
    else successes.push(item);
  }
  const at = brief.value?.at ?? ctx.tracker.at ?? null;
  const rendered = publishedPlan(ctx, successes.filter((i) => i.code !== "post_comment" && i.code !== "create_bug" && i.code !== "recover_bug"), results.filter((r) => successes.some((i) => i.n === r.n && i.code !== "post_comment")), at);
  if (!rendered.ok) return { refused: (/** @type {RefusalFact[]} */ (rendered.errors)).map(refusalOf) };
  rendered.changeset.writes.push(...publishedBugs(ctx, successes, results, at));
  const deletes = discarded.map((item) => ctx.repoPath(/** @type {string} */ (item.file)));
  if (deletes.length) rendered.changeset.deletes = [...(rendered.changeset.deletes ?? []), ...deletes];
  const paths = changedPaths(/** @type {{ writes: Array<{ path: string, text: string, absent?: boolean }>, deletes?: string[] }} */ (rendered.changeset));
  return { changeset: /** @type {CardChangeset} */ (rendered.changeset), data: { applied: successes.map((i) => i.n), failed, ...(manual.length && { manual }), ...(discarded.length && { discarded: discarded.map((i) => i.n) }), ...(failed.some((i) => i.rebuild) && { rebuild: true }) }, report: () => {
    if (!paths.length) return { files: [], commit: null };
    const committed = paths.filter((path) => existsSync(join(ctx.repo, path)) || gitFor(ctx, ["ls-files", "--error-unmatch", "--", path]).status === 0);
    if (!committed.length) return { files: [], commit: null };
    for (const args of [["add", "--", ...committed], ["commit", "--only", "-m", MESSAGE, "--", ...committed]]) {
      const result = gitFor(ctx, args);
      if (result.status !== 0) throw new UsageError("Publish commit failed", { code: "git_failed", paths: committed, written: true, reason: result.stderr?.trim() || result.error?.message || `git ${args[0]} exited ${result.status}` });
    }
    const commit = gitFor(ctx, ["rev-parse", "HEAD"]).stdout.trim();
    return { files: committed, commit };
  } };
}

/**
 * @param {PublishContext} ctx
 * @returns {string[]}
 */
function labelNotices(ctx) {
  if (!canPublishLabels(ctx.config.schemaVersion)) return ["Label publishing needs the level-on-case migration; this run publishes claims only."];
  const definitions = labelDefinitions(ctx.index.project?.data ?? {});
  const unpublished = [...(declaresTags(definitions) && !hasPublishTags(ctx.mapping) ? ["Tags"] : []), ...definitions.customFields.filter((f) => f.tracker_field === undefined).map((f) => f.name)];
  const mappingChanged = [...ctx.index.cases.values()].flat().some(({ entry }) => {
    const data = entry.data;
    const mirror = /** @type {{ tags_target?: string } | undefined} */ (data.mirror);
    const targets = /** @type {Record<string, string> | undefined} */ (data.mirror_field_targets);
    return Boolean(mirror?.tags_target && mirror.tags_target !== ctx.mapping.tag_field) || Object.entries(targets ?? {}).some(([name, target]) => definitions.customFields.find((f) => f.name === name)?.tracker_field !== target);
  });
  return [...(unpublished.length ? [`Unpublished label kinds: ${unpublished.join(", ")}.`] : []), ...(mappingChanged ? ["Label destination mappings may have changed; the old destination is left untouched."] : [])];
}
