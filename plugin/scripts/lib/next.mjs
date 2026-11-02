// @ts-check
// /qa-next: a read-only projection of scan facts, never another scanner.
import { basename, posix, resolve } from "node:path";
import { command as scan } from "./scan.mjs";
import { impactCheckDue, needsJudgement } from "./scan-history.mjs";
import { command as migrationStatus } from "./migration-status.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { labelDefinitions, isUnclassified } from "./case-labels.mjs";
import { projectConfig } from "./knowledge-file.mjs";
import { keyLabel, labelOf, summaries } from "./labels.mjs";
import { ACCESS_TRAIN_KEY, CODEGEN_TRAIN_KEY, DESIGN_TRAIN_KEY, SCHEMA_VERSION, TRAIN_KEYS, canonicalTrainKey, isSharedTrainKey } from "./schema.mjs";
import { trainFile, trainFor } from "./training.mjs";
import { readTrackerReference } from "./keys.mjs";
import { caseFields, caseLevel, caseSteps, sameOwnedFields, stepActor } from "./case-fields.mjs";
import { latestExecutionResults, resultHint } from "./execution-results.mjs";
import { parkedQuestions } from "./parked-questions.mjs";
import { parseDeferred } from "./deferred.mjs";
import { coverageDue } from "./coverage.mjs";
import { effectiveCategories } from "./categories.mjs";
import { canPublishLabels, publishedLabels, labelsDiffer } from "./publish-labels.mjs";
import { hasPublishTracker } from "./publish.mjs";
import { isStoredFinding, storedCaseFindings, storedFeatureFindings } from "./stored-findings.mjs";
import { nextPage } from "./next-page.mjs";
import { orThrow } from "./cli.mjs";
import { digests } from "./pin-digest.mjs";

/** @import { CaseFieldEntry } from "./case-fields.mjs" */
/** @import { CommandContext, CommandDefinition, CommandResult } from "./cli.mjs" */
/** @import { ExecutionResult } from "./execution-results.mjs" */
/** @import { ParsedEntry, ParsedFile } from "./knowledge-file.mjs" */
/** @import { SummariesLookup } from "./labels.mjs" */
/** @import { MigrationStatus } from "./migration-status.mjs" */
/** @import { NextFeatureInfo, NextLegendEntry, NextLocation, NextRoute, NextStep, NextTraining } from "./page.d.mts" */
/** @import { CaseDecl, KeyDecl, KeyIndex } from "./qa-index.mjs" */
/** @import { RuleCoverageIndex } from "./rule-coverage.mjs" */
/** @import { RunHealthNote } from "./scan-code.mjs" */
/** @import { HistorySection, ReviewFact, UpstreamChange } from "./scan-history.mjs" */
/** @import { ScanIndexSummary, ScanOutput } from "./scan.mjs" */
/** @import { HistoryDismissalsSource } from "./stored-findings.mjs" */

/**
 * A place a Scan result cites: the file it sits in and the line it is on.
 * @typedef {object} NextScanPlace
 * @property {string} file
 * @property {number} [line]
 * @property {string[]} [bind]
 */

/**
 * A place a result cites: either a nested result or a file and a line.
 * @typedef {{
 *   code?: string,
 *   file?: string,
 *   line?: number,
 *   function?: NextScanPlace,
 *   class?: NextScanPlace,
 *   functions?: NextScanPlace[],
 *   locations?: NextLocated[],
 * }} NextLocated
 */

/**
 * A Scan result, as the projection reads it: the kind and the code that name it, the keys, the
 * Feature and the Scenario it cites, and the place it sits at.
 * @typedef {object} NextScanResult
 * @property {string} kind
 * @property {string} code
 * @property {string} [key]
 * @property {string | null} [feature]
 * @property {string | null} [sync_feature]
 * @property {string | null} [scenario]
 * @property {string} [file]
 * @property {number} [line]
 * @property {string} [message]
 * @property {string} [stack]
 * @property {number} [count]
 * @property {string[]} [keys]
 * @property {string} [automation]
 * @property {string[]} [bind]
 * @property {string[]} [replace_in]
 * @property {NextScanPlace[]} [functions]
 * @property {NextScanPlace} [function]
 * @property {NextScanPlace} [class]
 * @property {NextLocated[]} [locations]
 * @property {boolean} [fresh]
 * @property {boolean} [linked]
 * @property {boolean} [owned_fields_match]
 * @property {string} [field]
 * @property {number} [version]
 * @property {number} [supported]
 * @property {NextRoute[]} [optional_routes]
 * @property {string} [reference]
}

/**
 * A case the projection reads: the file it sits in, its entry, its Feature and its Scenario,
 * and the line it is declared on. The index declares a case's entry with the case, so the entry
 * is there.
 * @typedef {{
 *   file: ParsedFile,
 *   entry: ParsedEntry,
 *   feature?: string | null,
 *   scenario?: string | null,
 *   line: number,
 * }} NextCase
 */

/**
 * The scan's Key index, as the projection reads it: the Features, the Scenarios and the Cases
 * the scan found, each with the Feature it belongs to.
 * @typedef {{
 *   features: ScanIndexSummary["features"] & Record<string, { file: string, rules: string[] }>,
 *   scenarios: ScanIndexSummary["scenarios"] & Record<string, { file: string, feature: string | null | undefined }>,
 *   cases: ScanIndexSummary["cases"] & Record<string, { file: string, line: number, scenario: string | null | undefined, feature: string | null | undefined }>,
 *   automations?: ScanIndexSummary["automations"],
 * }} NextScanIndex
 */

/**
 * The scan's results, as the projection reads them: the scan's own results, narrowed to the
 * fields the projection reads.
 * @typedef {Array<ScanOutput["results"][number] & NextScanResult>} NextResults
 */

/**
 * The scan's facts, as the projection reads them: the scan's own output, with the Key index and
 * the history section it publishes.
 * @typedef {ScanOutput & {
 *   results: NextResults,
 *   index: ScanIndexSummary & NextScanIndex,
 *   history: HistorySection,
 * }} NextFacts
 */

/**
 * A Next step, as the projection builds it: the page contract's step, with the signal it answers
 * and the priority that orders it.
 * @typedef {NextStep & { signal: string, priority: number }} NextStepRow
 */

/**
 * The context the projection reads: the `.qa/` root, the files it reads, the Key index, the
 * labels and the scan's facts.
 * @typedef {{
 *   root: string,
 *   files: ParsedFile[],
 *   index: KeyIndex,
 *   names: SummariesLookup,
 *   facts: NextFacts,
 * }} NextContext
 */

/**
 * A signal the projection turns into a Next step: the result it answers, the kind of step it
 * makes, its priority, the label it carries, the route it offers, and the conditions it applies
 * under.
 * @typedef {{
 *   source: string,
 *   code?: string,
 *   when?: (result: NextScanResult, context: NextContext) => boolean,
 *   kind: string,
 *   priority: string,
 *   label: string,
 *   route: (result: NextScanResult, context: NextContext) => NextRoute,
 *   prerequisites?: (result: NextScanResult, context: NextContext) => string[],
 * }} NextSignal
 */

/**
 * The schema state the projection reports: the scan's own note when the project declares a newer
 * schema version, or the version this CLI reads.
 * @typedef {{ code: string, version: number, supported: number, [key: string]: unknown }} NextSchemaState
 */

/**
 * The repository's global health, as the projection reports it: the key migration preflight, the
 * schema state, the run-health notes and the training state.
 * @typedef {{
 *   migration: MigrationStatus,
 *   schema: NextSchemaState,
 *   run_health: RunHealthNote[],
 *   training: NextTraining,
 * }} NextGlobalState
 */

/**
 * An information row about a Feature: the signal it carries, how many it counts and the label it
 * shows.
 * @typedef {NextFeatureInfo & { signal: string }} NextFeatureInformation
 */

/**
 * One Execution result, as the projection offers it: what it says, which case it belongs to, and
 * where it was run.
 * @typedef {{
 *   kind: string,
 *   key: string,
 *   label: string,
 *   result: string,
 *   reason?: string,
 *   date: string,
 *   target: string,
 *   out_of_date: boolean,
 *   at_login?: boolean,
 *   file: string,
 *   line: number,
 *   hint: string | null,
 * }} NextExecutionRow
 */

/**
 * A Feature's latest Execution results, as the projection offers them: how many passed, and the
 * rows that did not.
 * @typedef {{
 *   passed: { count: number, out_of_date: number },
 *   results: NextExecutionRow[],
 * }} NextExecutions
 */

/**
 * A Feature the projection lists: its key, its label, the counts of its steps, the information
 * rows, its Execution results and the step it starts with.
 * @typedef {{
 *   key: string,
 *   label: string,
 *   counts: Record<string, number>,
 *   information: NextFeatureInformation[],
 *   executions: NextExecutions | null,
 *   nothing_pending: boolean,
 *   top_next_step: NextStepRow | null,
 * }} NextFeatureState
 */

/**
 * The view the projection offers: the repository's global health, the Features it lists, the
 * steps it offers, and the page it wrote. This is the output type `next-page` reads as the
 * page's view.
 * @typedef {{
 *   root: string,
 *   feature: string | null,
 *   global: NextGlobalState,
 *   features: NextFeatureState[],
 *   next_steps: NextStepRow[],
 *   start_here: NextStepRow | null,
 *   next_steps_page?: { path: string } | { offer: true, pending: number },
 * }} NextProjection
 */

/**
 * The Key index, as the execution results read it: the cases, each with its entry and its
 * Feature.
 * @typedef {KeyIndex & { cases: Map<string, Array<CaseDecl & { entry: ParsedEntry, feature: string }>> }} ExecutionIndex
 */

/** @type {number} */
export const NEXT_STEPS_PAGE_OFFER_THRESHOLD = 15;
/**
 * @param {NextStepRow} step
 * @returns {boolean}
 */
export const isPendingStep = (step) => step.kind !== "unknown";
/** @type {NextLegendEntry[]} */
export const NEXT_LEGEND = [
  { kind: "blocking", emoji: "🛑", label: "blocking" },
  { kind: "at_risk", emoji: "⚠️", label: "at risk" },
  { kind: "parked", emoji: "❓", label: "parked" },
  { kind: "missing_knowledge", emoji: "📝", label: "missing knowledge" },
  { kind: "judge_needed", emoji: "🔍", label: "judge needed" },
  { kind: "publish_pending", emoji: "📤", label: "publish pending" },
  { kind: "binding", emoji: "🔗", label: "binding" },
  { kind: "automation_gap", emoji: "🤖", label: "Automation gap" },
  { kind: "unknown", emoji: "❔", label: "unknown" },
  // Execution results: information rows, never Next step kinds.
  { kind: "failed", emoji: "❌", label: "Failed" },
  { kind: "blocked", emoji: "⛔", label: "Blocked" },
  { kind: "information", emoji: "ℹ️", label: "information" },
  { kind: "nothing_pending", emoji: "✅", label: "nothing pending" },
  { kind: "start_here", emoji: "👉", label: "start here" },
];

// Lower comes first. Each slot limits rows to the contract's allowed output kinds.
/** @type {Record<string, { rank: number, kinds: string[] }>} */
const PRIORITY = {
  missing_project: { rank: 0, kinds: ["blocking"] },
  integrity: { rank: 10, kinds: ["blocking"] },
  conflict: { rank: 20, kinds: ["at_risk"] },
  overreach: { rank: 25, kinds: ["at_risk"] },
  stale: { rank: 30, kinds: ["at_risk"] },
  watermark: { rank: 40, kinds: ["judge_needed"] },
  parked: { rank: 50, kinds: ["parked"] },
  knowledge: { rank: 60, kinds: ["missing_knowledge"] },
  coverage: { rank: 65, kinds: ["missing_knowledge"] },
  publish: { rank: 70, kinds: ["publish_pending"] },
  outcome: { rank: 80, kinds: ["missing_knowledge"] },
  executable: { rank: 85, kinds: ["missing_knowledge"] },
  sync: { rank: 90, kinds: ["at_risk", "binding"] },
  training: { rank: 100, kinds: ["at_risk"] },
  overdue: { rank: 110, kinds: ["at_risk"] },
  automation: { rank: 120, kinds: ["automation_gap", "unknown"] },
};
// The key of the train file at `rel` (`train/<key>.md`, `.qa/`-prefixed once a step names it), or null for any other file.
/**
 * @param {string | undefined} rel
 * @returns {string | null}
 */
const trainKeyOf = (rel) => {
  const key = /** @type {string} */ (canonicalTrainKey(/^(?:\.qa\/)?train\/([^/]+)\.md$/.exec(rel ?? "")?.[1]));
  return TRAIN_KEYS.includes(key) ? key : null;
};
/**
 * @param {string} command
 * @param {...string} args
 * @returns {NextRoute}
 */
const commandRoute = (command, ...args) => ({ type: "command", command, args });
/**
 * @param {NextScanResult} r
 * @returns {NextRoute}
 */
const syncRoute = (r) => {
  const feature = r.sync_feature ?? r.feature;
  return commandRoute("/qa-sync", ...(feature ? [feature] : []));
};
/**
 * @returns {NextRoute}
 */
const migrationRoute = () => ({ type: "manual", text: "run migrate-keys on the default branch" });
/**
 * @param {NextScanResult} r
 * @returns {NextRoute}
 */
const publishRoute = (r) => commandRoute("/qa-publish", /** @type {string} */ (r.feature));
// An Automation gap is a `/qa-codegen` step only when code gen can run: it has a `test_runner`, and
// the project can bind a new test (the framework mints, or ADR-0012 names a tracker carrier).
// Without a runner, `/qa-init` comes first; a project with no binding route keeps the manual step.
/**
 * @param {NextScanResult} r
 * @param {NextContext} context
 * @returns {NextRoute}
 */
const automationGapRoute = (r, context) => {
  const config = projectConfig(context.index.project);
  const feature = typeof r.feature === "string" ? [r.feature] : [];
  if (!config.test_runner) return { type: "manual", text: `set up \`test_runner\` with /qa-init first, then /qa-codegen${feature.length ? ` ${r.feature}` : ""}` };
  const tracker = ["tracker_key_fn", "tracker_key_class"].some((role) => (config.annotationMap?.[role] ?? []).length > 0);
  if (!config.autMints && !(config.autExternal && tracker)) return { type: "manual", text: `write the test, then /qa-sync ${r.feature} binds it` };
  return commandRoute("/qa-codegen", ...feature);
};
// Every route into the change flow is a bare `/qa-design <feature>`: it settles the open findings,
// Stale causes included, before it designs anything (ADR-0043). `--review` adds the Reviews due.
/**
 * @param {string} feature
 * @param {...string} flags
 * @returns {NextRoute}
 */
const designRoute = (feature, ...flags) => commandRoute("/qa-design", feature, ...flags);
/**
 * @param {NextScanResult} r
 * @returns {NextRoute}
 */
const settleRoute = (r) => designRoute(/** @type {string} */ (r.feature));
/**
 * @param {NextScanResult} _r
 * @param {NextContext} context
 * @returns {string[]}
 */
const commitPrerequisite = (_r, { facts }) => facts.history.persist.clean ? [] : ["commit the knowledge"];
/** @type {string} */
const PUBLISH_DETAIL = "Publish fetches the tracker and decides the actual writes.";
/** @type {NextSignal[]} */
const SIGNALS = [
  { source: "publish_pending", code: "pending_repairs", kind: "publish_pending", priority: "publish", label: "Pending tracker repairs", route: publishRoute },
  { source: "publish_pending", code: "publish_pending", when: (r) => Boolean(r.linked && r.owned_fields_match), kind: "publish_pending", priority: "publish", label: "Publish: label copies differ or are unknown", route: publishRoute, prerequisites: (r) => (r.fresh ? [] : [`review it first (/qa-design ${r.feature} --review)`]) },
  { source: "publish_pending", code: "publish_pending", when: (r) => !r.fresh, kind: "publish_pending", priority: "publish", label: "Review it first: owned fields differ from Mirrored values", route: publishRoute, prerequisites: (r) => [`review it first (/qa-design ${r.feature} --review)`] },
  { source: "publish_pending", code: "publish_pending", when: (r) => /** @type {boolean} */ (r.linked), kind: "publish_pending", priority: "publish", label: "Ready to Publish: owned fields differ from Mirrored values", route: publishRoute },
  { source: "publish_pending", kind: "publish_pending", priority: "publish", label: "Ready to Publish: no Tracker key", route: publishRoute },
  { source: "bug_drafts", code: "bug_drafts", kind: "publish_pending", priority: "publish", label: "Bug drafts awaiting Publish", route: publishRoute },
  { source: "knowledge", code: "parked_questions", kind: "parked", priority: "parked", label: "Parked questions", route: (r) => ({ type: "manual", text: `get the answer, then /qa-deep-dive ${r.feature}` }) },
  { source: "knowledge", code: "uncovered_rule", kind: "missing_knowledge", priority: "knowledge", label: "no case names this Rule in `covers`", route: settleRoute },
  { source: "knowledge", code: "uncited_case", kind: "missing_knowledge", priority: "knowledge", label: "no `covers`: link it to a Rule", route: settleRoute },
  { source: "knowledge", code: "empty_scenario", kind: "missing_knowledge", priority: "knowledge", label: "Empty Test Scenario", route: (r) => commandRoute("/qa-design", /** @type {string} */ (r.feature), /** @type {string} */ (r.key)) },
  { source: "knowledge", code: "deferred_functionality", kind: "missing_knowledge", priority: "knowledge", label: "Deferred functionality", route: (r) => commandRoute("/qa-deep-dive", /** @type {string} */ (r.feature), /** @type {string} */ (r.reference)) },
  { source: "knowledge", code: "coverage_due", kind: "missing_knowledge", priority: "coverage", label: "Coverage due", route: (r) => commandRoute("/qa-deep-dive", /** @type {string} */ (r.feature)) },
  { source: "integrity_error", code: "missing_project", kind: "blocking", priority: "missing_project", label: "Project setup is missing", route: () => commandRoute("/qa-init") },
  { source: "integrity_error", code: "duplicate_automation_key", kind: "blocking", priority: "integrity", label: "Duplicate Automation key", route: syncRoute },
  { source: "integrity_error", code: "unresolved_automates", kind: "blocking", priority: "integrity", label: "Dead Automation binding", route: syncRoute },
  { source: "integrity_error", code: "duplicate_tracker_key", when: (r, { index }) => {
    const claims = index.tracker.claims.get(/** @type {string} */ (r.key)) ?? [];
    return new Set(claims.map((c) => c.entry.key)).size > 1 && claims.every((c) => c.feature === r.feature && c.entry.kind === claims[0].entry.kind && c.entry.kind !== "retired");
  }, kind: "blocking", priority: "integrity", label: "Duplicate Tracker key: choose a Merge survivor", route: syncRoute },
  { source: "integrity_error", when: (r, { files }) => {
    const file = files.find((f) => f.rel === r.file);
    return (r.code === "required" && r.field === "suite_key") ||
      (file?.type === "scenario" && ((r.code === "required" && r.field?.endsWith(".key")) ||
        (r.code === "pattern" && ["key", "case"].includes(/** @type {string} */ (r.field)))));
  }, kind: "blocking", priority: "integrity", label: "Keys need migration", route: migrationRoute },
  { source: "integrity_error", when: (r) => /^(tracker|tracker_formerly|mirror\.suite)(\.|$)/.test(r.field ?? "") || /\.(tracker|tracker_formerly)(\.|$)/.test(r.field ?? ""), kind: "blocking", priority: "integrity", label: "Resolve the Tracker key through an accepted /qa-sync Card", route: syncRoute },
  // A train file is repaired through its own command, which reads and rewrites it.
  { source: "integrity_error", when: (r) => trainKeyOf(r.file) !== null, kind: "blocking", priority: "integrity", label: "Repair the training file", route: (r) => commandRoute("/qa-train", /** @type {string} */ (trainKeyOf(r.file))) },
  { source: "integrity_error", kind: "blocking", priority: "integrity", label: "Repair the Integrity error", route: (r) => ({ type: "manual", text: `Repair the Integrity error at ${r.file}${r.line ? `:${r.line}` : ""}; preserve Tracker keys and use /qa-sync for Tracker key changes.` }) },
  { source: "stored_finding", code: "conflict", kind: "at_risk", priority: "conflict", label: "Open Conflict", route: settleRoute, prerequisites: commitPrerequisite },
  { source: "stored_finding", code: "overreach", kind: "at_risk", priority: "overreach", label: "Open Overreach", route: settleRoute, prerequisites: commitPrerequisite },
  { source: "stored_finding", code: "stale", kind: "at_risk", priority: "stale", label: "Open Stale", route: settleRoute, prerequisites: commitPrerequisite },
  { source: "history_feature", code: "watermark_behind", kind: "judge_needed", priority: "watermark", label: "Watermark behind: judgement needed", route: settleRoute, prerequisites: commitPrerequisite },
  { source: "review_overdue", kind: "at_risk", priority: "overdue", label: "Review overdue", route: (r) => designRoute(/** @type {string} */ (r.feature), "--review"), prerequisites: commitPrerequisite },
  { source: "outcome_gap", kind: "missing_knowledge", priority: "outcome", label: "Outcome gap: no Expected-result paragraph", route: () => ({ type: "manual", text: "write the Expected-result paragraph" }) },
  { source: "classification", code: "unclassified", kind: "missing_knowledge", priority: "knowledge", label: "Required classification missing", route: () => ({ type: "manual", text: "Assign the missing required Custom fields using their project descriptions; leave the case claim and Review unchanged." }) },
  { source: "executable", code: "no_steps", kind: "missing_knowledge", priority: "executable", label: "No executable steps", route: () => ({ type: "manual", text: "write the **Steps.** paragraph (or re-design the case)" }) },
  { source: "executable", code: "unnamed_actor", kind: "missing_knowledge", priority: "executable", label: "Step actor unnamed", route: () => ({ type: "manual", text: "prefix each step with `As <Role>, `" }) },
  { source: "divergence", code: "unclaimed_automation", kind: "binding", priority: "sync", label: "Unclaimed Automation", route: syncRoute },
  { source: "divergence", when: (r) => Object.hasOwn(r, "mirror"), kind: "at_risk", priority: "sync", label: "Divergence against stored Mirrored values", route: syncRoute },
  { source: "divergence", kind: "at_risk", priority: "sync", label: "Divergence against code", route: syncRoute },
  { source: "binding_proposal", kind: "binding", priority: "sync", label: "Binding proposal", route: syncRoute },
  { source: "train_warning", code: "codegen_upkeep", kind: "at_risk", priority: "training", label: "Codegen Training needs attention", route: (r) => commandRoute("/qa-train", `codegen --stack ${r.stack}`) },
  { source: "train_warning", code: "legacy_shadowed", kind: "at_risk", priority: "training", label: "Training file shadowed by its renamed file", route: (r) => ({ type: "manual", text: r.message }) },
  { source: "train_warning", code: "possible_credential", kind: "at_risk", priority: "training", label: "Possible credential in Training", route: (r) => ({ type: "manual", text: `remove the credential by hand at ${r.file}:${r.line}` }) },
  { source: "train_warning", kind: "at_risk", priority: "training", label: "Training needs attention", route: (r) => commandRoute("/qa-train", /** @type {string} */ (canonicalTrainKey(basename(/** @type {string} */ (r.file), ".md")))) },
  { source: "automation_state", code: "automation_gap", kind: "automation_gap", priority: "automation", label: "Automation gap: no Automation found", route: automationGapRoute },
  { source: "automation_state", code: "automation_unknown", kind: "unknown", priority: "automation", label: "Automation evidence unavailable", route: (r) => ({ type: "manual", text: `address the unavailable code evidence: ${r.message}` }) },
];

for (const { source, kind, priority } of SIGNALS) {
  if (!Object.hasOwn(PRIORITY, priority)) throw new Error(`Unknown next priority: ${priority} (${source})`);
  if (!PRIORITY[priority].kinds.includes(kind)) throw new Error(`Invalid next kind: ${kind} for ${priority} (${source})`);
}
// Every Feature has the same count fields, including upstream-only impact.
const KINDS = [...new Set([...SIGNALS.map((row) => row.kind), "impact_downstream"])];

/**
 * @param {NextScanResult} r
 * @returns {string[]}
 */
const bindingKeys = (r) => [...(r.bind ?? []), ...(r.functions ?? []).flatMap((f) => f.bind ?? [])];

// A proposal belongs to the code's Feature, which may differ from the cases it binds.
// Surface it for those Features too, retaining the owning Feature as the sync route.
/**
 * @param {NextScanResult[]} proposals
 * @param {NextFacts} facts
 * @param {KeyIndex} index
 * @returns {NextScanResult[]}
 */
function crossFeatureBindings(proposals, facts, index) {
  return proposals.flatMap((proposal) => {
    const features = new Set(bindingKeys(proposal).map((key) => index.cases.get(key)?.[0]?.feature));
    return [...features].filter((feature) => feature && feature !== proposal.feature && feature in facts.index.features)
      .map((feature) => ({ ...proposal, feature, sync_feature: proposal.feature }));
  });
}

// A recorded binding is already handled by scan's Integrity and Divergence routes.
// Group only cases waiting for their first binding, within the scan's Feature scope.
/**
 * @param {NextFacts} facts
 * @param {KeyIndex} index
 * @param {NextScanResult[]} proposals
 * @returns {NextScanResult[]}
 */
function automationStates(facts, index, proposals) {
  const unavailable = !facts.index.automations;
  const proposed = new Set(proposals.flatMap(bindingKeys));
  /** @type {NextScanResult[]} */
  const results = [];
  for (const [scenario, { feature }] of Object.entries(facts.index.scenarios)) {
    const file = index.scenarios.get(scenario)?.[0]?.file;
    const cases = (file?.cases ?? []).filter((c) => typeof c.key === "string" &&
      (c.data.automatable ?? true) === true && !(/** @type {unknown[]} */ (c.data.automates ?? [])).length && !proposed.has(c.key));
    if (!cases.length) continue;
    results.push({
      kind: "automation_state", code: unavailable ? "automation_unknown" : "automation_gap", feature, scenario,
      keys: cases.map((c) => c.key).sort(),
      locations: cases.map((c) => ({ file: /** @type {ParsedFile} */ (file).rel, line: c.line })),
      ...(unavailable && { message: facts.run_health.map((h) => h.message).join("; ") }),
    });
  }
  return results;
}

/**
 * @param {NextFacts} facts
 * @param {KeyIndex} index
 * @param {ParsedFile[]} files
 * @returns {NextScanResult[]}
 */
function publishSignals(facts, index, files) {
  const draftBugs = bugDraftSignals(facts, index, files);
  if (!hasPublishTracker(index.project)) return draftBugs;
  const project = index.project?.data ?? {};
  const definitions = labelDefinitions(project);
  const mapping = /** @type {{ tag_field?: string }} */ (project.tracker ?? {});
  const labelsEnabled = canPublishLabels(projectConfig(index.project).schemaVersion);
  const reviews = new Map(facts.history.reviews.map((r) => /** @type {[string, ReviewFact]} */ ([r.key, r])));
  const cases = Object.keys(facts.index.cases).flatMap((key) => {
    const { file, entry, feature, line } = /** @type {NextCase} */ (/** @type {CaseDecl[]} */ (index.cases.get(key))[0]);
    const linked = index.tracker.current("case", key) !== null;
    const fields = caseFields(/** @type {CaseFieldEntry} */ (entry), index.tracker.current("scenario", /** @type {string} */ (file.data.key)) ?? /** @type {string} */ (file.data.key));
    const fresh = reviews.get(key)?.status === "fresh";
    const ownedFieldsMatch = sameOwnedFields(fields, entry.data.mirror);
    if ((!linked && !fresh) || (linked && ownedFieldsMatch && !(labelsEnabled && labelsDiffer(publishedLabels(entry.data, definitions, mapping))))) return [];
    return [{ kind: "publish_pending", code: "publish_pending", key, feature, file: file.rel, line, linked, fresh, owned_fields_match: ownedFieldsMatch,
      message: PUBLISH_DETAIL }];
  });
  const featureFiles = Object.keys(facts.index.features).map((key) => ({ key, feature: key, file: /** @type {KeyDecl} */ (/** @type {KeyDecl[]} */ (index.features.get(key))[0]).file }));
  const repairs = featureFiles.flatMap(({ key, feature, file }) => {
    if (!Array.isArray(file.data.repairs) || !file.data.repairs.length) return [];
    return [{ kind: "publish_pending", code: "pending_repairs", key, feature, file: file.rel, line: file.keyLines.repairs,
      message: PUBLISH_DETAIL }];
  });
  return [...draftBugs, ...cases, ...repairs];
}

/**
 * One Publish step per Feature holding draft bugs, counting those whose case changed since
 * `case_digest`, those whose case a Feature retired, and those sharing a case with another bug file.
 * @param {NextFacts} facts
 * @param {KeyIndex} index
 * @param {ParsedFile[]} files
 * @returns {NextScanResult[]}
 */
function bugDraftSignals(facts, index, files) {
  const bugs = files.filter((file) => file.type === "bug");
  const drafts = bugs.filter((bug) => bug.data.status === "draft");
  if (!drafts.length) return [];
  const current = digests(files);
  const retired = new Set(files.flatMap((file) => file.type === "feature" &&
    Array.isArray(file.data.retired) ? file.data.retired.flatMap((token) => typeof token === "string" ? [readTrackerReference(token) ?? token] : []) : []));
  /** @type {Map<string, number>} */
  const perCase = new Map();
  for (const bug of bugs) {
    const key = bug.data.case;
    if (typeof key === "string") perCase.set(key, (perCase.get(key) ?? 0) + 1);
  }
  /** @type {Map<string, ParsedFile[]>} */
  const byFeature = new Map();
  for (const bug of drafts) {
    const feature = bug.data.feature;
    if (typeof feature !== "string") continue;
    if (facts.feature && facts.feature !== feature) continue;
    if (!index.features.has(feature)) continue;
    if (!byFeature.has(feature)) byFeature.set(feature, []);
    byFeature.get(feature)?.push(bug);
  }
  return [...byFeature].map(([feature, featureDrafts]) => {
    const cases = featureDrafts.flatMap((bug) => typeof bug.data.case === "string" ? [bug.data.case] : []);
    const stale = featureDrafts.filter((bug) => typeof bug.data.case === "string" && !retired.has(bug.data.case) &&
      index.cases.has(bug.data.case) && bug.data.case_digest !== current.review(bug.data.case)).length;
    const retiredBlocked = cases.filter((key) => retired.has(key)).length;
    const shared = cases.filter((key) => (perCase.get(key) ?? 0) > 1).length;
    const count = featureDrafts.length;
    return { kind: "bug_drafts", code: "bug_drafts", feature, count,
      keys: featureDrafts.flatMap((bug) => typeof bug.data.key === "string" ? [bug.data.key] : []).sort(),
      message: `${count} Bug draft${count === 1 ? "" : "s"} awaiting \`/qa-publish\`; stale ${stale}, retired-blocked ${retiredBlocked}, shared-case ${shared}.` };
  });
}

/**
 * @param {NextFacts} facts
 * @param {KeyIndex} index
 * @returns {NextScanResult[]}
 */
function classificationSteps(facts, index) {
  const { labels } = projectConfig(index.project);
  return Object.keys(facts.index.cases).flatMap((key) => {
    const { file, entry, feature, scenario, line } = /** @type {NextCase} */ (index.cases.get(key)?.[0]);
    return isUnclassified(entry.data, labels.customFields) ? [{ kind: "classification", code: "unclassified", key, feature, scenario, file: file.rel, line }] : [];
  });
}

// Execution readiness belongs to next, without Findings or Dismissals in the knowledge layer.
/**
 * @param {NextFacts} facts
 * @param {KeyIndex} index
 * @returns {NextScanResult[]}
 */
function executableSteps(facts, index) {
  const { execute_levels: levels, schemaVersion } = projectConfig(index.project);
  if (!levels) return [];
  return Object.keys(facts.index.cases).flatMap((key) => {
    const { file, entry, feature, scenario, line } = /** @type {NextCase} */ (/** @type {CaseDecl[]} */ (index.cases.get(key))[0]);
    if (!Object.hasOwn(levels, /** @type {string} */ (caseLevel(entry.data, file.data, schemaVersion)))) return [];
    const steps = caseSteps(/** @type {CaseFieldEntry} */ (entry));
    const roles = /** @type {string[]} */ (entry.data.roles ?? []);
    const code = !steps.length ? "no_steps" : roles.length >= 2 && steps.some((s) => !roles.includes(/** @type {string} */ (stepActor(s)))) ? "unnamed_actor" : null;
    return code ? [{ kind: "executable", code, key, feature, scenario, file: file.rel, line }] : [];
  });
}

// Each Feature's latest Execution results, or null when it has none. Failed rows come before
// Blocked, then by key; Passed shows as a count.
/**
 * @param {ParsedFile[]} files
 * @param {KeyIndex} index
 * @param {SummariesLookup} names
 * @param {string} root
 * @returns {Map<string | null | undefined, NextExecutions>}
 */
function executionsByFeature(files, index, names, root) {
  /** @type {Map<string | null | undefined, ExecutionResult[]>} */
  const byFeature = new Map();
  for (const result of latestExecutionResults(files, index).values()) {
    if (!byFeature.has(result.feature)) byFeature.set(result.feature, []);
    /** @type {ExecutionResult[]} */ (byFeature.get(result.feature)).push(result);
  }
  return new Map([...byFeature].map(([feature, all]) => {
    const passed = all.filter((r) => r.result === "passed");
    const rows = all.filter((r) => r.result !== "passed").sort((a, b) =>
      (a.result === b.result ? 0 : a.result === "failed" ? -1 : 1) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return /** @type {[string | null | undefined, NextExecutions]} */ ([feature, {
      passed: { count: passed.length, out_of_date: passed.filter((r) => r.out_of_date).length },
      results: rows.map((r) => ({
        kind: /** @type {string} */ (r.result), key: r.key, label: keyLabel(r.key, names.testCase(r.key)), result: /** @type {string} */ (r.result),
        ...(/** @type {boolean} */ (r.reason) && { reason: /** @type {string} */ (r.reason) }), date: r.date, target: /** @type {string} */ (r.target), out_of_date: r.out_of_date,
        ...(r.at_login && { at_login: true }), file: posix.join(basename(resolve(root)), r.file), line: r.line,
        hint: resultHint(/** @type {{ result?: string | null, reason?: string | null }} */ (r), /** @type {string} */ (feature)),
      })),
    }]);
  }));
}

/**
 * @param {NextScanResult} result
 * @param {NextContext} context
 * @returns {NextStepRow | null}
 */
function nextStep(result, context) {
  const { names, root, files } = context;
  const row = SIGNALS.find((r) => r.source === result.kind && (!r.code || r.code === result.code) && (!r.when || r.when(result, context)));
  if (!row) return null;
  const file = files.find((f) => f.rel === result.file);
  const entry = file?.cases?.find((c) => c.line <= /** @type {number} */ (result.line) && /** @type {number} */ (result.line) <= c.end);
  const key = result.key ?? entry?.key ?? (file?.type === "scenario" ? file.data.key : undefined);
  const keys = [...new Set([...(result.keys ?? []), key, result.automation, ...(result.bind ?? []), ...(result.replace_in ?? []),
    ...(result.functions ?? []).flatMap((f) => f.bind ?? []),
  ].filter((k) => typeof k === "string"))];
  const locations = locationsOf(result, root);
  const location = /** @type {NextLocation} */ (locations[0] ?? {});
  const located = { ...result, ...location };
  return {
    kind: row.kind, signal: result.code, feature: result.feature ?? null, keys,
    ...(result.code === "codegen_upkeep" && { stack: result.stack }),
    ...(result.scenario && { scenario: result.scenario }),
    ...(result.count !== undefined && { count: result.count }),
    ...(result.optional_routes && { optional_routes: result.optional_routes }),
    ...location, locations,
    labels: {
      signal: row.label,
      detail: result.kind === "divergence" ? null : result.message ?? null,
      feature: result.feature ? keyLabel(/** @type {string | undefined} */ (result.feature), names.feature(/** @type {string | undefined} */ (result.feature))) : null,
      keys: keys.map((k) => labelOf(names, k, result.feature ?? undefined)),
      ...(result.scenario && { scenario: labelOf(names, result.scenario, result.feature ?? undefined) }),
    },
    prerequisites: row.prerequisites?.(located, context) ?? [], route: row.route(located, context), priority: PRIORITY[row.priority].rank,
  };
}

// Code findings may name several functions, or also cite the knowledge binding. Keep every
// location, with the first flattened as file/line for the common single-location rendering.
/**
 * @param {NextLocated} result
 * @param {string} root
 * @returns {NextLocation[]}
 */
function locationsOf(result, root) {
  if (result.code === "missing_project") return [];
  const nested = result.function ? [result.function] : result.class ? [result.class] : result.functions ?? [];
  const places = [
    ...(result.locations ?? []).flatMap((p) => locationsOf(p, root)),
    ...nested.map(({ file, line }) => ({ file, ...(line && { line }) })),
  ];
  if (result.file) places.push({
    file: result.code === "key_prefix" ? result.file : posix.join(basename(resolve(root)), result.file),
    ...(result.line && { line: result.line }),
  });
  return [...new Map(places.map((p) => /** @type {[string, NextLocation]} */ ([`${p.file}:${p.line ?? ""}`, p]))).values()];
}

// History owns candidate classification and the stripped dirty check; next only projects them.
/**
 * @param {NextFacts} facts
 * @param {NextContext} context
 * @returns {NextScanResult[]}
 */
function impactSignals(facts, { files, index }) {
  /** @type {NextScanResult[]} */
  const out = facts.history.features.filter((f) => impactCheckDue(f) && !f.upstream_changed.length).map((f) => {
    const file = files.find((file) => file.rel === f.file);
    return { kind: "history_feature", code: "watermark_behind", feature: f.feature, key: f.feature,
      file: f.file, line: file?.keyLines.watermark ?? file?.keyLines.key };
  });
  for (const file of files) {
    if (file.unreadable) continue;
    // A Feature's own findings (ADR-0039): an Overreach the judge raised on one of its Rules.
    if (file.type === "feature") {
      const feature = typeof file.data.key === "string" ? file.data.key : null;
      if (feature === null || (facts.feature && facts.feature !== feature)) continue;
      for (const finding of storedFeatureFindings(/** @type {HistoryDismissalsSource} */ (facts.history), file)) {
        if (!isStoredFinding(finding) || finding.status === "dismissed") continue;
        out.push({ kind: "stored_finding", code: finding.kind.toLowerCase(), feature, key: /** @type {string} */ (finding.subject),
          file: finding.file, line: finding.line, message: /** @type {string} */ (finding.evidence) });
      }
      continue;
    }
    if (file.type !== "scenario") continue;
    const feature = index.featureOf(file);
    if (facts.feature && facts.feature !== feature) continue;
    for (const entry of file.cases) {
      for (const finding of storedCaseFindings(/** @type {HistoryDismissalsSource} */ (facts.history), file, entry)) {
        if (!isStoredFinding(finding) || finding.status === "dismissed") continue;
        out.push({ kind: "stored_finding", code: finding.kind.toLowerCase(), feature, key: entry.key,
          file: finding.file, line: finding.line, message: /** @type {string} */ (finding.evidence) });
      }
    }
  }
  return out;
}

/**
 * A downstream Feature whose Upstream Rule changed gets the specific impact command and cause,
 * once: the generic Watermark step is left to the Feature that has no upstream cause.
 * @param {NextFacts} facts
 * @param {NextContext} context
 * @returns {NextStepRow[]}
 */
function downstreamImpactSteps(facts, { names, files, root }) {
  return facts.history.features.filter((f) => impactCheckDue(f) && f.upstream_changed.length > 0).map((f) => {
    const file = files.find((candidate) => candidate.rel === f.file);
    const location = { file: posix.join(basename(resolve(root)), f.file), ...(file?.keyLines.watermark && { line: file.keyLines.watermark }) };
    const label = keyLabel(f.feature, names.feature(f.feature));
    /** @type {UpstreamChange[]} */
    const because = f.upstream_changed;
    return {
      kind: "impact_downstream", signal: "upstream_changed", priority: PRIORITY.watermark.rank,
      feature: f.feature, command: `/qa-design ${f.feature}`, because,
      keys: [], locations: [location], ...location,
      labels: { signal: "An Upstream Rule changed", feature: label, keys: [] },
      prerequisites: [], route: designRoute(f.feature),
    };
  });
}

/**
 * @param {NextStepRow} a
 * @param {NextStepRow} b
 * @returns {number}
 */
function byPriority(a, b) {
  /**
   * @param {string} left
   * @param {string} right
   * @returns {number}
   */
  const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  return a.priority - b.priority || compare(a.feature ?? "", b.feature ?? "") ||
    compare(a.keys.join("\0"), b.keys.join("\0")) || compare(a.signal, b.signal) ||
    compare(a.file ?? "", b.file ?? "") || (a.line ?? 0) - (b.line ?? 0);
}

// Training is information only: missing or empty command files never create Next steps.
/**
 * @param {KeyIndex} index
 * @returns {NextTraining}
 */
function trainingStatus(index) {
  const commands = TRAIN_KEYS.filter((key) => !isSharedTrainKey(key)).map((command) => {
    const { entries } = trainFor(index, command);
    const conventions = entries.filter((e) => e.kind === "convention").length;
    const practices = entries.filter((e) => e.kind === "practice").length;
    const trainedStacks = trainFile(index, command)?.data.trained_stacks;
    // Code gen is trained when it names a stack; its Conventions are per facet, not per file.
    const codegenTrained = command === CODEGEN_TRAIN_KEY && Array.isArray(trainedStacks) && trainedStacks.length > 0;
    return { command, trained: practices > 0 || (command === DESIGN_TRAIN_KEY && conventions > 0) || codegenTrained, conventions, practices };
  });
  return { commands, access_notes: trainFor(index, ACCESS_TRAIN_KEY).entries.filter((e) => e.kind === "access_note").length };
}

// Facts absent from scan's findings: questions are grouped per Feature, retaining every citation;
// the Uncovered Rules and Uncited cases are the Scan's own reports, read as they stand, and empty
// scenarios stand independently.
/**
 * @param {NextContext} context
 * @param {string | null | undefined} feature
 * @returns {NextStepRow[]}
 */
function knowledgeSteps(context, feature) {
  const { index, root, facts } = context;
  const effective = effectiveCategories(root);
  /** @type {NextScanResult[]} */
  const results = [];
  for (const [key, declarations] of index.features) {
    if (feature && key !== feature) continue;
    const file = declarations[0].file;
    const deferred = parseDeferred(file.text);
    for (const item of deferred) results.push({
      kind: "knowledge", code: "deferred_functionality", feature: key,
      file: file.rel, line: item.line, reference: item.reference,
      message: `${item.functionality}: ${item.reason}. From: ${item.reference}${item.place === null ? "" : `, ${item.place}`}`,
    });
    const questions = parkedQuestions(file);
    if (questions.length) results.push({
      kind: "knowledge", code: "parked_questions", feature: key, key,
      count: questions.length, message: `${questions.length} Parked questions`,
      locations: questions.map((q) => ({ file: file.rel, line: q.line })),
      optional_routes: hasPublishTracker(index.project) ? [commandRoute("/qa-publish", key)] : [],
    });
    // One Feature-level item however many triggers hold, naming the trigger the predicate found.
    const due = coverageDue(file, effective);
    if (due) results.push({
      kind: "knowledge", code: "coverage_due", feature: key, key,
      file: file.rel, line: file.keyLines.key,
      message: `${due.detail}; Coverage speaks for walked functionalities only; deferred: ${deferred.length}`,
    });
  }
  for (const [key, declarations] of index.scenarios) {
    const { file, line, feature: owner } = declarations[0];
    if ((!feature || owner === feature) && !file.cases.length) results.push({
      kind: "knowledge", code: "empty_scenario", feature: owner, key, file: file.rel, line,
    });
  }
  // The Scan owns both link reports (scan-links.mjs); neither is a Finding, so each is a plain step.
  for (const { feature: owner, rule, file, line } of facts.uncovered_rules) results.push({
    kind: "knowledge", code: "uncovered_rule", feature: owner, key: rule, file, line,
  });
  for (const { feature: owner, key, file, line } of facts.uncited_cases) results.push({
    kind: "knowledge", code: "uncited_case", feature: owner, key, file, line,
  });
  return /** @type {NextStepRow[]} */ (results.map((r) => nextStep(r, context)));
}

/**
 * @param {string} feature
 * @param {NextFacts} facts
 * @returns {NextFeatureInformation[]}
 */
function reviewInformation(feature, facts) {
  const fresh = new Set(facts.history.reviews.filter((r) => r.status === "fresh").map((r) => r.key));
  const count = Object.entries(facts.index.cases).filter(([key, c]) => c.feature === feature && !fresh.has(key)).length;
  return [{ kind: "information", signal: "unreviewed", count, labels: { signal: "Unreviewed Test Cases" } }];
}

/**
 * @param {KeyIndex} index
 * @param {SummariesLookup} names
 * @param {string | null | undefined} feature
 * @returns {import("./page.d.mts").InboxSummaries}
 */
function pageSummaries(index, names, feature) {
  const features = [...index.features].filter(([key]) => !feature || key === feature);
  return {
    features: Object.fromEntries(features.map(([key]) => [key, names.feature(key)])),
    scenarios: Object.fromEntries([...index.scenarios].filter(([, decls]) => !feature || decls[0].feature === feature).map(([key]) => [key, names.scenario(key)])),
    cases: Object.fromEntries([...index.cases].filter(([, decls]) => !feature || decls[0].feature === feature).map(([key]) => [key, names.testCase(key)])),
    rules: Object.fromEntries(features.map(([key, decls]) => [key, Object.fromEntries(decls[0].file.rules.map((rule) => [rule.key, rule.statement]))])),
  };
}

/** @type {CommandDefinition} */
export const command = {
  options: { root: "qa-dir?", page: "flag" },
  usage: "[<feature-key>] [--root <qa-dir>] [--page]",
  /**
   * @param {string[]} args
   * @param {CommandContext} ctx
   * @returns {CommandResult}
   */
  run(args, { root, page }) {
    const { json: facts } = /** @type {{ json: NextFacts }} */ (/** @type {unknown} */ (/** @type {CommandResult} */ (/** @type {NonNullable<CommandDefinition["run"]>} */ (scan.run)(args, /** @type {CommandContext} */ ({ root })))));
    const allFacts = facts.feature ? /** @type {NextFacts} */ (/** @type {CommandResult} */ (/** @type {NonNullable<CommandDefinition["run"]>} */ (scan.run)([], /** @type {CommandContext} */ ({ root }))).json) : facts;
    const proposals = allFacts.results.filter((r) => r.kind === "binding_proposal");
    const files = /** @type {ParsedFile[]} */ (loadWorkingTree(root));
    const index = buildIndex(files);
    const names = summaries(index);
    const version = projectConfig(index.project).schemaVersion;
    const newer = facts.results.find((r) => r.code === "schema_newer");
    const context = { root: /** @type {string} */ (root), files, index, names, facts };
    const results = [
      ...facts.results,
      ...crossFeatureBindings(proposals, facts, index),
      ...impactSignals(facts, context),
      ...publishSignals(facts, index, files),
      ...automationStates(facts, index, proposals),
      ...executableSteps(facts, index),
      ...classificationSteps(facts, index),
    ];
    const upkeepCodes = new Set(["ref_unresolved", "convention_drift", "citation_broken"]);
    const upkeep = results.filter((r) => r.kind === "train_warning" && upkeepCodes.has(r.code));
    /** @type {Map<string, NextScanResult[]>} */
    const groups = new Map();
    for (const result of upkeep) {
      const key = JSON.stringify([result.file, result.stack]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(result);
    }
    const ordinary = results.filter((r) => !upkeep.includes(r));
    const grouped = [...groups.values()].map((group) => ({ ...group[0], code: "codegen_upkeep", count: group.length, keys: [...new Set(group.map((r) => r.key).filter((key) => typeof key === "string"))], locations: group.map((r) => ({ file: r.file, line: r.line })), message: `${group.length} codegen Training warnings for stack ${group[0].stack}` }));
    const signalSteps = /** @type {NextStepRow[]} */ ([...ordinary, ...grouped].map((r) => nextStep(r, context)).filter(Boolean));
    const next_steps = [
      ...downstreamImpactSteps(facts, context),
      ...signalSteps,
      ...knowledgeSteps(context, facts.feature),
    ].sort(byPriority);
    const pendingSteps = next_steps.filter(isPendingStep);
    const executions = executionsByFeature(files, index, names, /** @type {string} */ (root));
    const features = Object.keys(facts.index.features).sort().map((key) => {
      const steps = next_steps.filter((s) => s.feature === key);
      const pending = steps.filter(isPendingStep);
      return {
        key, label: keyLabel(key, names.feature(key)),
        counts: Object.fromEntries(KINDS.map((kind) => /** @type {[string, number]} */ ([kind, steps.filter((s) => s.kind === kind).length]))),
        information: reviewInformation(key, facts),
        executions: executions.get(key) ?? null,
        nothing_pending: pending.length === 0, top_next_step: pending[0] ?? null,
      };
    });
    /** @type {NextProjection} */
    const json = {
      root: /** @type {string} */ (root),
      feature: facts.feature,
      global: {
        migration: /** @type {MigrationStatus} */ (/** @type {CommandResult} */ (/** @type {NonNullable<CommandDefinition["run"]>} */ (migrationStatus.run)([], /** @type {CommandContext} */ ({ root }))).json),
        schema: /** @type {NextSchemaState} */ (newer ?? { code: "current", version, supported: SCHEMA_VERSION }),
        run_health: facts.run_health,
        training: trainingStatus(index),
      },
      features,
      next_steps,
      start_here: pendingSteps[0] ?? null,
    };
    // The projection's own output is the view the page reads: the page contract (lib/page.d.mts)
    // names the fields the rendered document shows, and the projection writes exactly those, so
    // the view crosses the page's own boundary without a cast.
    if (page) json.next_steps_page = orThrow(nextPage(json, pageSummaries(index, names, facts.feature), NEXT_LEGEND));
    else if (pendingSteps.length > NEXT_STEPS_PAGE_OFFER_THRESHOLD) json.next_steps_page = { offer: true, pending: pendingSteps.length };
    return { exit: 0, json };
  },
};
