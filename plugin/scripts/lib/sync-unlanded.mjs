// @ts-check
// Published tracker items missing from all of `.qa/`, checked only on the default branch (ADR-0027).
//
// A tracker item that carries the publish mark holds the framework Key `/qa-publish` wrote, in the
// configured mark field. Each marked item the shared resolver finds no `tracker:` claim on is
// settled by its mark against `.qa/`:
//   - a `tc_`/`ts_` Key `.qa/` does not hold is Unlanded, and intake reuses that Key;
//   - a Key `.qa/` holds without a link is a recovery for `/qa-publish`, not reported here;
//   - a Retired Key, a malformed or wrong-kind mark, and a legacy `new_…` mark that maps to no single
//     permanent Key (through `formerly:`) are reported, and never taken in.
//
// A marked Test Suite (ADR-0029) is settled by its tracker key before its mark: a Suite some
// Feature names in `mirror.suite` is claimed, so a Suite attached and not yet remarked stays quiet.
// Otherwise a Suite key some Feature holds is a recovery for `/qa-publish`; a live Suite key no
// Feature holds makes it an Unlanded Suite, settled by Attach to an existing Feature, retired by hand
// or a Dismissal, never taken in as a new Feature; a Retired, malformed or wrong-kind mark is
// reported. Unlanded cases under an Unlanded Suite take its Attach target as their Feature.
/** @import { ScenarioDecl, CaseDecl, SuiteDecl } from "./qa-index.mjs" */
/** @import { IntakeItem, TrackerCaseItem, TrackerScenarioItem, TrackerSuiteItem, TrackerState } from "./sync-tracker.mjs" */
/** @import { TrackerEntry, TrackerResolveResult } from "./tracker-resolver.mjs" */
/** @import { SyncCardItem } from "./sync-json.mjs" */
import { defaultBranch, resolveCommits } from "./git.mjs";
import { resolveRef } from "./git-tree.mjs";
import { PATTERN, provisionalKeys } from "./keys.mjs";
import { featureDismissalHolds } from "./pin-digest.mjs";
import { featureFile } from "./qa-index.mjs";
import { localDate } from "./scan.mjs";
import { oneLine } from "./schema.mjs";
import { attachUnlandedSuite, isSuiteType, retiredKeys } from "./sync-attach.mjs";
import { hasMark, intake, intakeCase, isBugItem, kindOfType } from "./sync-tracker.mjs";

/**
 * @typedef {{
 *   project?: unknown,
 *   marker_label: string,
 *   marker_field?: string,
 *   case_type?: string,
 *   scenario_type?: string,
 *   suite_type?: string,
 * }} UnlandedQuery
 */

/**
 * @typedef {{
 *   code: string,
 *   onDefault?: boolean,
 *   branch?: string,
 *   defaultBranch?: string,
 *   [key: string]: unknown,
 * }} UnlandedSkipNote
 */

/**
 * @typedef {{
 *   query: UnlandedQuery | null,
 *   scenario_query: UnlandedQuery | null,
 *   suite_query: UnlandedQuery | null,
 *   note: UnlandedSkipNote | null,
 * }} UnlandedScope
 */

/**
 * @typedef {{
 *   code: string,
 *   kind: "case" | "scenario" | "suite",
 *   key: string,
 *   mark?: string | null,
 *   why?: string,
 *   [key: string]: unknown,
 * }} UnlandedReport
 */

/**
 * @typedef {{
 *   kind: string,
 *   subject_kind: string,
 *   subject_key: string,
 *   at_commit: string,
 *   evidence: string,
 *   dismissed: {
 *     by: string,
 *     at: string,
 *     commit: string,
 *     reason?: string,
 *     ticket?: string,
 *     digest?: unknown,
 *     [key: string]: unknown,
 *   },
 *   [key: string]: unknown,
 * }} UnlandedFinding
 */

/**
 * @typedef {{
 *   suites: Array<{ item: TrackerSuiteItem, key: string }>,
 *   cases: Array<{ item: TrackerCaseItem, key: string }>,
 *   scenarios: Array<{ item: TrackerScenarioItem, key: string }>,
 *   reports: UnlandedReport[],
 *   blocked: Set<string>,
 * }} SettleResult
 */

/**
 * @typedef {{
 *   report?: UnlandedReport,
 *   held?: string,
 *   missing?: string,
 * }} SettleOneResult
 */

/**
 * @typedef {{
 *   feature?: string,
 *   file: { rel: string, [key: string]: unknown },
 *   [key: string]: unknown,
 * }} ResolvedScenario
 */

/**
 * @typedef {{
 *   code: string,
 *   key: string,
 *   summary: string | null,
 *   mark?: string,
 *   feature?: string | null,
 *   scenario?: string | null,
 *   evidence: string,
 *   needs: string[],
 *   edits: string[],
 *   message?: string,
 *   intake_needs?: string[],
 *   permanent_key?: string,
 *   permanent_scenario_key?: string,
 *   unlanded_suite?: string,
 *   creates_scenario?: TrackerScenarioItem,
 *   resolution?: string,
 *   by?: string,
 *   reason?: string,
 *   ticket?: string,
 *   n?: number | string,
 *   [key: string]: unknown,
 * }} UnlandedCardItem
 */

/**
 * @typedef {{
 *   unlandedNotes?: Array<{ code: string, key: string, [key: string]: unknown }>,
 *   suiteAttached?: Map<string, string>,
 *   unlandedFindings?: Map<string, UnlandedFinding[]>,
 *   placed: Set<string>,
 *   set: (target: { file: string } | { file: string, key: string }, field: string, value: unknown) => void,
 *   [key: string]: unknown,
 * }} UnlandedPlan
 */

/**
 * The tracker entry as this pass reads it: where the Key sits, not the parsed file around it (the
 * policy check walks an export's types to a fixed depth).
 * @typedef {{
 *   kind: string,
 *   key: string,
 *   file: { rel: string },
 *   line: number,
 *   feature?: string,
 *   scenario?: string | null,
 * }} UnlandedTrackerEntry
 */

/**
 * @typedef {{
 *   features: Map<string, Array<{ feature?: string, file: { rel: string, [key: string]: unknown }, [key: string]: unknown }>>,
 *   scenarios: Map<string, Array<{ feature?: string, file: { rel: string, data?: Record<string, unknown>, [key: string]: unknown }, [key: string]: unknown }>>,
 *   cases: Map<string, Array<{ feature?: string, file: { rel: string, [key: string]: unknown }, entry: { data?: Record<string, unknown>, [key: string]: unknown }, [key: string]: unknown }>>,
 *   suites: Map<string, unknown>,
 *   project?: { data: { tracker?: Record<string, unknown>, [key: string]: unknown }, [key: string]: unknown } | null,
 *   tracker: {
 *     resolve: (key: string) => { status: string, entry?: UnlandedTrackerEntry, [key: string]: unknown },
 *     [key: string]: unknown,
 *   },
 *   [key: string]: unknown,
 * }} UnlandedIndex
 */

/**
 * @typedef {{
 *   repo: string,
 *   index: UnlandedIndex,
 *   files: Array<{ rel: string, type?: string | null, unreadable?: unknown, data: { finding?: unknown, mirror?: { suite?: string | null, [key: string]: unknown }, [key: string]: unknown }, [key: string]: unknown }>,
 *   feature?: string | null,
 *   tracker: TrackerState,
 *   unlanded: { query?: unknown, suite_query?: unknown, scenario_query?: unknown, note?: unknown, [key: string]: unknown },
 *   unlandedSettled?: SettleResult,
 *   unlandedItems?: UnlandedCardItem[],
 *   [key: string]: unknown,
 * }} UnlandedContext
 */

/** @param {string} key */
const evidenceOf = (key) => `tracker case \`${key}\` carries the publish marker, but \`.qa/\` neither holds it nor names it as a Retired key`;

/** @param {string} key @param {string} mark */
const suiteEvidenceOf = (key, mark) => `tracker Test Suite \`${key}\` is marked with Suite key \`${mark}\`, which no Feature holds, and no Feature names it as its Suite`;

/** @param {{ data: { finding?: unknown, [key: string]: unknown } }} file @returns {UnlandedFinding[]} */
const findingsOf = (file) => Array.isArray(file.data.finding) ? /** @type {UnlandedFinding[]} */ (file.data.finding) : [];

/** @param {unknown} v @returns {string[]} */
const stringsIn = (v) => (Array.isArray(v) ? v.filter((k) => typeof k === "string") : []);

/** @param {{ key: string }} a @param {{ key: string }} b */
const byKey = (a, b) => a.key.localeCompare(b.key, "en", { numeric: true });

// The subjects of an Unlanded item's Dismissal.
const SUBJECTS = ["tracker_case", "tracker_suite"];

/**
 * @param {UnlandedContext} ctx
 * @returns {UnlandedScope}
 */
export function unlandedScope(ctx) {
  const tracker = /** @type {Record<string, unknown> | undefined} */ (ctx.index.project?.data.tracker);
  const off = { query: null, scenario_query: null, suite_query: null };
  if (!tracker?.marker_label) return { ...off, note: null };
  const branch = defaultBranch(ctx.repo);
  if (!branch.onDefault) return { ...off, note: { code: "unlanded_check_skipped", ...branch } };
  const base = { project: tracker.project, marker_label: /** @type {string} */ (tracker.marker_label), ...(/** @type {Record<string, string>} */ (tracker.marker_field && { marker_field: /** @type {string} */ (tracker.marker_field) })) };
  return {
    query: { ...base, ...(/** @type {Record<string, string>} */ (tracker.case_type && { case_type: /** @type {string} */ (tracker.case_type) })) },
    scenario_query: { ...base, ...(/** @type {Record<string, string>} */ (tracker.scenario_type && { scenario_type: /** @type {string} */ (tracker.scenario_type) })) },
    suite_query: { ...base, ...(/** @type {Record<string, string>} */ (tracker.suite_type && { suite_type: /** @type {string} */ (tracker.suite_type) })) },
    note: null,
  };
}

/** @type {Array<["case" | "scenario", RegExp]>} */
const SHAPE = [["case", PATTERN.case], ["scenario", PATTERN.scenario]];

// Every marked item settled against `.qa/`: `{suites, cases, scenarios, reports}`. `suites`, `cases`
// and `scenarios` are the Unlanded ones, `{item, key}` with the Key their mark holds. `reports` are the items to
// report and never take in. `blocked` holds the tracker scenarios whose own mark stops a case from
// creating them (reported, or a Key `.qa/` holds without a link).
/**
 * @param {UnlandedContext} ctx
 * @returns {SettleResult}
 */
function settle(ctx) {
  if (ctx.unlandedSettled) return ctx.unlandedSettled;
  /** @type {SettleResult} */
  const out = { suites: [], cases: [], scenarios: [], reports: [], blocked: new Set() };
  ctx.unlandedSettled = out;
  if (!ctx.unlanded.query || !ctx.tracker.ok) return out;
  const live = { case: ctx.index.cases, scenario: ctx.index.scenarios };
  const retired = new Set(ctx.files.filter((f) => !f.unreadable && f.type === "feature").flatMap((f) => stringsIn(f.data.retired)));
  /** @param {"case" | "scenario"} kind @param {({ entry?: { data?: Record<string, unknown> }, file?: { data?: Record<string, unknown>, rel?: string } })} d */
  const formerlyOf = (kind, d) => stringsIn(kind === "case" ? /** @type {NonNullable<CaseDecl["entry"]>} */ (/** @type {CaseDecl} */ (d).entry).data.formerly : /** @type {ScenarioDecl} */ (d).file.data.formerly);
  /** @param {"case" | "scenario" | "suite"} kind @param {{ key: string, mark?: string | null }} item @param {string} code @param {string} why @returns {UnlandedReport} */
  const report = (kind, item, code, why) => ({ code, kind, key: item.key, mark: item.mark ?? null, why });

  /** @param {"case" | "scenario"} kind @param {TrackerCaseItem | TrackerScenarioItem} item @returns {SettleOneResult | null} */
  const settleOne = (kind, item) => {
    if (isBugItem(/** @type {Parameters<typeof isBugItem>[0]} */ (ctx), item)) return null;
    // A tracker key some entry claims, as `tracker:`, an alias or a tombstone, is not Unlanded.
    if (ctx.index.tracker.resolve(item.key).status !== "absent") return null;
    if (!hasMark(item)) return { report: report(kind, item, "unlanded_mark_malformed", "the mark field is empty") };
    const mark = /** @type {string} */ (item.mark).trim();
    const typed = kindOfType(/** @type {Parameters<typeof kindOfType>[0]} */ (ctx), item.issue_type);
    if (typed && typed !== kind) return { report: report(kind, item, "unlanded_mark_wrong_kind", `the item is a ${typed}, not a ${kind}`) };
    const legacy = PATTERN.provisional.test(mark);
    const shape = SHAPE.find(([, pattern]) => pattern.test(mark))?.[0];
    if (!legacy && !shape) return { report: report(kind, item, "unlanded_mark_malformed", "the mark is not a Key") };
    if (shape && shape !== kind) return { report: report(kind, item, "unlanded_mark_wrong_kind", `the mark is a ${shape} Key`) };
    if (legacy) {
      // A legacy mark maps to one permanent Key through `formerly:`, or is unmappable.
      const held = live[kind].has(mark) ? [mark] : [...live[kind]].filter(([, ds]) => ds.some((d) => formerlyOf(kind, d).includes(mark))).map(([key]) => key);
      if (held.length === 1) return { held: held[0] };
      if (!held.length && (retired.has(mark) || provisionalKeys(mark).some((key) => PATTERN[kind].test(key) && retired.has(key)))) {
        return { report: report(kind, item, "unlanded_mark_retired", "the mark is a Retired key") };
      }
      return { report: report(kind, item, "unlanded_mark_unmappable", held.length ? `it maps to ${held.length} Keys` : "no Key of `.qa/` records it in `formerly`") };
    }
    if (live[kind].has(mark)) return { held: mark };
    if (retired.has(mark)) return { report: report(kind, item, "unlanded_mark_retired", "the mark is a Retired key") };
    return { missing: mark };
  };

  // A Suite is claimed by its tracker key first, so its mark is not read.
  const claimed = new Set(ctx.files.filter((f) => !f.unreadable && f.type === "feature").map((f) => f.data.mirror?.suite).filter((k) => typeof k === "string"));
  const retiredSuites = retiredKeys(/** @type {Parameters<typeof retiredKeys>[0]} */ (/** @type {unknown} */ (ctx)));
  /** @param {TrackerSuiteItem} item @returns {UnlandedReport | null} */
  const settleSuite = (item) => {
    if (isBugItem(/** @type {Parameters<typeof isBugItem>[0]} */ (ctx), item)) return null;
    if (claimed.has(item.key)) return null;
    if (!hasMark(item)) return report("suite", item, "unlanded_mark_malformed", "the mark field is empty");
    const mark = /** @type {string} */ (item.mark).trim();
    if (!isSuiteType(/** @type {Parameters<typeof isSuiteType>[0]} */ (/** @type {unknown} */ (ctx)), item.issue_type)) return report("suite", item, "unlanded_mark_wrong_kind", `the item is a ${item.issue_type ?? "tracker item of no issue type"}, not a Test Suite`);
    const shape = SHAPE.find(([, pattern]) => pattern.test(mark))?.[0];
    if (shape) return report("suite", item, "unlanded_mark_wrong_kind", `the mark is a ${shape} Key`);
    if (!PATTERN.suite.test(mark)) return report("suite", item, "unlanded_mark_malformed", "the mark is not a Suite key");
    if (ctx.index.suites.has(mark)) return null;
    if (retiredSuites.has(mark)) return report("suite", item, "unlanded_mark_retired", "the mark is a Retired key");
    out.suites.push({ item, key: mark });
    return null;
  };
  if (ctx.unlanded.suite_query) {
    for (const item of [.../** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker).markedSuites.values()].sort(byKey)) {
      const r = settleSuite(item);
      if (r) out.reports.push(r);
    }
  }

  for (const kind of /** @type {const} */ (["scenario", "case"])) {
    const marked = kind === "case" ? /** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker).markedCases : /** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker).markedScenarios;
    for (const item of [...marked.values()].sort(byKey)) {
      const r = settleOne(kind, item);
      if (!r) continue;
      if (r.report) {
        out.reports.push(r.report);
        if (kind === "scenario") out.blocked.add(item.key);
      } else if (r.held) {
        if (kind === "scenario") out.blocked.add(item.key);
      } else if (kind === "case") out.cases.push({ item: /** @type {TrackerCaseItem} */ (item), key: /** @type {string} */ (r.missing) });
      else out.scenarios.push({ item: /** @type {TrackerScenarioItem} */ (item), key: /** @type {string} */ (r.missing) });
    }
  }
  // A marked scenario `.qa/` lacks, with no Unlanded case under it, is reported on its own.
  for (const { item } of out.scenarios) {
    if (!out.cases.some((c) => c.item.scenario === item.key)) out.reports.push({ code: "unlanded_scenario", kind: "scenario", key: item.key, mark: item.mark, why: "no Unlanded case sits under it" });
  }
  return out;
}

// The Divergences the marks give: items reported and never taken in.
/**
 * @param {UnlandedContext} ctx
 * @returns {UnlandedReport[]}
 */
export const unlandedReports = (ctx) => settle(ctx).reports;

// The `.qa/` scenario a tracker scenario key (or a live Key a person named) stands for, or undefined.
/**
 * @param {UnlandedContext} ctx
 * @param {string | null | undefined} ref
 * @returns {ResolvedScenario | undefined}
 */
function scenarioDecl(ctx, ref) {
  const named = ctx.index.scenarios.get(/** @type {string} */ (ref))?.[0];
  if (named) return named;
  const r = /** @type {TrackerResolveResult} */ (ctx.index.tracker.resolve(/** @type {string} */ (ref)));
  return r.status === "unique" && r.entry.kind === "scenario" ? r.entry : undefined;
}

/**
 * @typedef {{
 *   key: string,
 *   title: string,
 *   codes: string[],
 *   tracker: boolean,
 *   only: (ctx: UnlandedContext) => boolean,
 *   items: (ctx: UnlandedContext) => UnlandedCardItem[],
 *   apply: (ctx: UnlandedContext, item: UnlandedCardItem, plan: UnlandedPlan) => { code: string, [key: string]: unknown } | null,
 * }} UnlandedSection
 */

/** @type {UnlandedSection} */
export const unlanded = {
  key: "unlanded",
  title: "Unlanded cases and Suites",
  codes: ["unlanded_suite", "unlanded_case"],
  tracker: true,
  only: (ctx) => Boolean(ctx.unlanded.query),
  items(ctx) {
    if (!ctx.unlanded.query) return [];
    if (ctx.unlandedItems) return ctx.unlandedItems;
    const s = settle(ctx);
    // Feature-level findings rest on no case or Rule; scan-history re-arms only an unresolved pin
    // with no digest (ADR-0033).
    const dismissed = ctx.files.filter((f) => f.type === "feature").flatMap(findingsOf).filter((f) => f.kind === "Divergence" && SUBJECTS.includes(f.subject_kind) && f.dismissed);
    const { resolved } = resolveCommits(ctx.repo, dismissed.map((f) => f.dismissed.commit));
    /** @param {string} kind @param {string} key @param {string} evidence */
    const holds = (kind, key, evidence) => dismissed.some((f) => f.subject_kind === kind && f.subject_key === key && f.evidence === evidence && featureDismissalHolds(f.dismissed, Boolean(resolved.get(f.dismissed.commit))));
    const suites = s.suites.filter(({ item, key }) => !holds("tracker_suite", item.key, suiteEvidenceOf(item.key, key))).map(({ item, key: mark }) => ({
      code: "unlanded_suite", key: item.key, summary: item.summary ?? null, mark, feature: ctx.feature ?? null, evidence: suiteEvidenceOf(item.key, mark),
      needs: ["resolution"], edits: ["resolution", "feature", "by", "reason", "ticket"],
      message: `tracker Test Suite \`${item.key}\` is marked \`${mark}\`, a Suite key no Feature holds: attach it to an existing Feature, retire it by hand, or dismiss it`,
    }));
    const unlandedSuites = new Set(suites.map((u) => u.key));
    const cases = s.cases.filter(({ item }) => !holds("tracker_case", item.key, evidenceOf(item.key))).map(({ item: tc, key: permanent }) => {
      const decl = scenarioDecl(ctx, tc.scenario);
      const candidate = intakeCase(/** @type {Parameters<typeof intakeCase>[0]} */ (/** @type {unknown} */ (ctx)), /** @type {string} */ (decl?.feature), { ...tc, summary: tc.summary ?? "" }, { file: decl?.file.rel ?? null });
      if (!candidate.summary) candidate.needs.push("summary");
      const scenario = /** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker).scenarios.get(/** @type {string} */ (tc.scenario)) ?? /** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker).markedScenarios.get(/** @type {string} */ (tc.scenario));
      // A case under an Unlanded Suite takes the Suite's Attach target as its Feature, at apply.
      const suite = !decl && unlandedSuites.has(/** @type {string} */ (/** @type {TrackerScenarioItem} */ (scenario)?.suite)) ? /** @type {TrackerScenarioItem} */ (scenario).suite : null;
      const feature = decl?.feature ?? (suite ? null : ctx.feature ?? null);
      const parent = s.scenarios.find((m) => m.item.key === tc.scenario);
      if (!decl && (s.blocked.has(/** @type {string} */ (tc.scenario)) || !scenario?.summary?.trim())) candidate.needs.push("scenario");
      if (!decl && !feature && !suite) candidate.needs.push("feature");
      return { ...candidate, feature, code: "unlanded_case", evidence: evidenceOf(tc.key), permanent_key: permanent, ...(parent && { permanent_scenario_key: parent.key }), ...(suite && { unlanded_suite: suite }),
        ...(scenario && !decl && { creates_scenario: scenario }),
        intake_needs: candidate.needs, needs: ["resolution"], edits: ["resolution", "feature", "scenario", "by", "reason", "ticket", ...candidate.edits] };
    });
    return (ctx.unlandedItems = [...suites, ...cases]);
  },
  apply(ctx, item, plan) {
    if (!item.resolution) return { code: "needs_edit" };
    if (item.resolution === "retired_by_hand") {
      (plan.unlandedNotes ??= []).push({ code: "unlanded_retired_by_hand", key: item.key });
      return null;
    }
    const suite = item.code === "unlanded_suite";
    // An Unlanded Suite's items come first on the Card, so its Attach is planned before its cases.
    if (!suite && item.unlanded_suite && item.feature == null) item = { ...item, feature: plan.suiteAttached?.get(item.unlanded_suite) ?? null };
    if (item.resolution === "dismiss") {
      if (!/^human:[^\s"\\]+$/.test(item.by ?? "")) return { code: "not_human" };
      const file = featureFile(/** @type {Parameters<typeof featureFile>[0]} */ (ctx.index), /** @type {string} */ (item.feature));
      if (!file) return { code: "needs_edit", field: "feature" };
      const head = resolveRef(ctx.repo, "HEAD");
      if (!head) return { code: "no_head" };
      const pending = (plan.unlandedFindings ??= new Map());
      const findings = [...(pending.get(file.rel) ?? findingsOf(file))];
      const finding = { kind: "Divergence", subject_kind: suite ? "tracker_suite" : "tracker_case", subject_key: item.key, at_commit: head, evidence: item.evidence,
        dismissed: { by: /** @type {string} */ (item.by), at: localDate(), commit: head, ...(item.reason !== undefined && { reason: item.reason }), ...(item.ticket !== undefined && { ticket: item.ticket }) } };
      const old = findings.findIndex((f) => f.kind === finding.kind && f.subject_kind === finding.subject_kind && f.subject_key === item.key && f.evidence === item.evidence);
      if (old === -1) findings.push(finding);
      else findings[old] = finding;
      pending.set(file.rel, findings);
      plan.set({ file: file.rel }, "finding", findings);
      return null;
    }
    if (suite) {
      if (item.resolution !== "attach") return { code: "bad_resolution" };
      if (!item.feature) return { code: "needs_edit", field: "feature" };
      const problem = attachUnlandedSuite(/** @type {Parameters<typeof attachUnlandedSuite>[0]} */ (/** @type {unknown} */ (ctx)), item.feature, item.key, /** @type {Parameters<typeof attachUnlandedSuite>[3]} */ (/** @type {unknown} */ (plan)), item.n);
      if (problem) return problem;
      (plan.suiteAttached ??= new Map()).set(item.key, item.feature);
      return null;
    }
    if (item.resolution !== "intake") return { code: "bad_resolution" };
    if (!item.summary) return { code: "intake_summary_missing", key: item.key };
    const decl = scenarioDecl(ctx, item.scenario);
    if (!decl && !plan.placed.has(/** @type {string} */ (item.scenario))) {
      if (ctx.index.tracker.resolve(/** @type {string} */ (item.scenario)).status === "retired") return { code: "retired_intake_scenario", key: item.scenario };
      if (settle(ctx).blocked.has(/** @type {string} */ (item.scenario))) return { code: "needs_edit", field: "scenario" };
      const ts = /** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker).scenarios.get(/** @type {string} */ (item.scenario)) ?? /** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker).markedScenarios.get(/** @type {string} */ (item.scenario));
      if (!ts?.summary?.trim()) return { code: "needs_edit", field: "scenario" };
      const problem = intake.apply(/** @type {Parameters<typeof intake.apply>[0]} */ (/** @type {unknown} */ (ctx)), /** @type {IntakeItem} */ ({ code: "intake_scenario", key: ts.key, summary: oneLine(ts.summary), suite: ts.suite, feature: item.feature, n: item.n, permanent_key: item.permanent_scenario_key }), /** @type {Parameters<typeof intake.apply>[2]} */ (/** @type {unknown} */ (plan)));
      if (problem) return problem;
    }
    return intake.apply(/** @type {Parameters<typeof intake.apply>[0]} */ (/** @type {unknown} */ (ctx)), /** @type {IntakeItem} */ (/** @type {unknown} */ ({ ...item, code: "intake_case", file: decl?.file.rel ?? null, needs: item.intake_needs })), /** @type {Parameters<typeof intake.apply>[2]} */ (/** @type {unknown} */ (plan)));
  },
};
