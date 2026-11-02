// @ts-check
// What `/qa-impact` does with its usable replies (supersede and
// carry-forward, the Watermark). `settle` works out, per case, the findings
// list the run leaves; `impact report` prints it and `impact persist` writes it. Everything here
// reads `scan`'s history facts (the Stale obligations, Dismissal re-arm, the stripped-dirty
// check) and never re-derives them.
//
// Per case, on a usable reply, with the run's target T:
//   - a Conflict verdict replaces the open Conflicts on the case with one new finding pinned to T;
//   - Current clears an open Conflict whose sides were compared;
//   - a verdict matching a dismissed finding (it re-emerges) leaves the dismissed finding as it is
//     while its Dismissal holds, and nothing new is written; once the Dismissal has re-armed, the
//     new open finding replaces it. A Current verdict drops a dismissed Conflict: it was
//     resolved;
//   - a Stale is never a verdict (ADR-0043): the Scan owes one to every case that covers or relies
//     on an Affected Rule, and the run stores it with its cause, whatever the judge said. A stored
//     Stale is left exactly as it is: a Conflict neither displaces it nor is displaced by it, and
//     one stored without a cause, as every Stale was before, stays open until it is settled;
//   - Outcome gaps and Divergences are scans, never judged: their findings are left as they are.
//   - an Overreach (ADR-0039) is the Scan's own, never judged: it replaces the open Overreaches on
//     the case with the one this run's Scan raised, and the ones the Scan no longer raises are
//     resolved: the Rule is not Waived any more, or the case no longer covers it.
// A case-vs-case Conflict is written on both cases, each naming the other, with no winner picked.
// A unit with no usable reply leaves every finding in its file untouched.
//
// Persist writes into the working tree, whose knowledge equals HEAD's (the stripped-dirty check)
// but whose Bookkeeping may run ahead of the target, so the existing findings are the working
// tree's, and `scan` is asked for its facts about those.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isMap } from "./dialect.mjs";
import { featureUnitId, isFeatureUnit } from "./dispatch.mjs";
import { loadQaTree, repositoryOf } from "./git-tree.mjs";
import { checkFile, edit, parse } from "./knowledge-file.mjs";
import { backfill } from "./pin-digest.mjs";
import { buildIndex, loadWorkingTree, rootConfig } from "./qa-index.mjs";
import { scan } from "./scan.mjs";
import { holdsQuote } from "./schema.mjs";
import { isQualifiedRuleRef, isRuleRef, ruleRefsIn } from "./rule-ref.mjs";
import { findingOrigin, isJudgedFinding, isMechanicalFinding, isOpenFinding, isStaleObligation } from "./stored-findings.mjs";

/** @import { JudgeOverreach, JudgeResult, JudgeVerdict } from "./check-reply.mjs" */

/** A usable judge outcome's checked reply: the verdicts and the Overreaches the walk reads. */
/** @typedef {{ verdicts: JudgeVerdict[], overreaches: JudgeOverreach[] }} JudgeChecked */
/** @import { ImpactPlan, ImpactPlanFeature, JudgeBrief, PersistCheck } from "./impact.mjs" */
/** @import { FeatureFile, KeyIndex } from "./qa-index.mjs" */
/** @import { EditChange, ParsedEntry, ParsedFile } from "./knowledge-file.mjs" */
/** @import { DismissalFact, StaleFact } from "./scan-history.mjs" */
/** @import { StaleObligation } from "./stale-obligations.mjs" */
/** @import { ScanResult } from "./scan.mjs" */

/**
 * @typedef {{
 *   kind: "Conflict" | "Stale" | "Current" | "Overreach" | string,
 *   at_commit: string | null,
 *   evidence?: string,
 *   rests_on?: string,
 *   dismissed?: {
 *     commit: string | null,
 *     by?: string,
 *     at?: string,
 *     reason?: string,
 *     ticket?: string,
 *     digest?: unknown,
 *   },
 *   [key: string]: unknown,
 * }} PersistFinding
 */

/**
 * @typedef {{
 *   target: { ref: string | null, commit: string | null },
 *   persist: PersistCheck,
 *   stales: StaleFact[],
 *   stale_obligations: StaleObligation[],
 *   dismissals: DismissalFact[],
 *   [key: string]: unknown,
 * }} ScanHistory
 */

/**
 * @typedef {{
 *   unit: { feature: string, scenario: string | null, [key: string]: unknown },
 *   usable: boolean,
 *   checked?: JudgeResult | null,
 * }} CheckedOutcome
 */

/**
 * @typedef {{
 *   feature: string,
 *   scenario: string,
 *   file: string,
 *   key: string,
 *   findings: Array<{ kind: string, at_commit: string | null, carried: boolean, origin: "judged" | "mechanical" | null }>,
 * }} WalkItem
 */

/**
 * @typedef {{
 *   feature: string,
 *   file: string | null,
 *   from: string | null,
 *   to: string | null,
 *   hold: string | null,
 * }} WatermarkItem
 */

/**
 * @typedef {{
 *   code: string,
 *   feature?: string,
 *   scenario?: string,
 *   key?: string,
 * }} PersistNote
 */

/**
 * @typedef {{
 *   feature: string,
 *   scenario: string,
 *   file: string,
 *   key: string,
 *   verdict: string,
 *   before: unknown[],
 *   after: unknown[],
 *   changed: boolean,
 *   entry?: ParsedEntry,
 *   raised?: PersistFinding[],
 * }} SettledCase
 */

/**
 * @typedef {{
 *   feature?: string,
 *   scenario?: string,
 *   file: string,
 *   key: string,
 *   at_commit: string | null,
 *   at_commit_resolves?: boolean | null,
 *   evidence: string | null,
 *   because?: string,
 * }} CarriedItem
 */

/**
 * A Feature's findings after the run (ADR-0039): the Feature-level unit's Overreaches and the
 * findings of other kinds, which are the Scan's own and stay as they are.
 * @typedef {{
 *   feature: string,
 *   file: string,
 *   before: unknown[],
 *   after: unknown[],
 *   changed: boolean,
 * }} SettledFeature
 */

/**
 * @typedef {{
 *   root: string,
 *   target: string | null,
 *   index: { project?: unknown },
 *   persistCheck: PersistCheck,
 *   cases: SettledCase[],
 *   features: SettledFeature[],
 *   carried: CarriedItem[],
 *   missing: Array<{ feature: string, scenario: string, key: string }>,
 *   dismissed: { held: number, rearmed: number, total: number },
 *   walk: unknown[],
 *   watermarks: unknown[],
 *   notes: PersistNote[],
 * }} SettledFindings
 */

/**
 * @typedef {{
 *   advanced: boolean,
 *   from: string | null,
 *   to?: string | null,
 *   reason?: string | null,
 * }} PersistedWatermark
 */

/**
 * @typedef {{
 *   feature: string,
 *   watermark: PersistedWatermark,
 *   written: string[],
 *   blocked: Array<{ file: string, line?: number | null, message: string }>,
 * }} PersistedFeature
 */

/**
 * @typedef {{
 *   features: PersistedFeature[],
 *   paths: string[],
 * }} WrittenFindings
 */

// A pin as written, as `scan`'s facts key it: null when absent.
/** @type {(v: unknown) => string | null} */
export const written = (v) => (v === undefined || v === null ? null : String(v));

// `plan` as `impact plan` printed it, `outcomes` each unit's checked reply (scenario key →
// `{unit, usable, checked}`), `complete` the Features every non-empty scenario file of which got a
// usable reply. With `persist`, the findings the run starts from are the working tree's, which it
// writes into; otherwise those of the state it judged. Returns what the run leaves, case by case,
// and what `writeFindings` needs to write it.
/**
 * @param {ImpactPlan} plan
 * @param {Map<string, CheckedOutcome>} outcomes
 * @param {Set<string>} complete
 * @param {{ persist?: boolean }} [options]
 * @returns {SettledFindings}
 */
export function settleFindings(plan, outcomes, complete, { persist = false } = {}) {
  const root = plan.root;
  const T = plan.target.commit;
  const judgedAt = loadQaTree(root, /** @type {string} */ (T));
  const atIndex = buildIndex(judgedAt);
  const work = persist ? loadWorkingTree(root) : judgedAt;
  const workIndex = persist ? buildIndex(work) : atIndex;
  const s = scan(root, { feature: plan.feature ?? undefined, target: T ? /** @type {{ ref: string, commit: string }} */ (plan.target) : null, bookkeeping: persist ? work : null });
  const staleFact = new Map(/** @type {ScanHistory} */ (s.history).stales.map((f) => [`${f.key}\0${f.at_commit}`, f]));
  // Dismissal facts, by the Key of the case that holds the finding and by the Feature that holds a
  // Feature-level one. The facts come from the target's tree, the findings from the working
  // tree's, so pairing them by position would shift a fact onto another finding as soon as a case
  // was inserted, moved or removed since the target, and a holding Dismissal would re-arm.
  /** @type {Map<string, DismissalFact[]>} */
  const factsByKey = new Map();
  /** @type {Set<string>} */
  const featureFiles = new Set([...atIndex.features.values()].map((decls) => decls[0].file.rel));
  for (const fact of /** @type {ScanHistory} */ (s.history).dismissals) {
    const key = featureFiles.has(fact.file) ? `feature:${fact.feature}` : `case:${fact.key}`;
    const group = factsByKey.get(key);
    if (group) group.push(fact);
    else factsByKey.set(key, [fact]);
  }
  // Pair by stored occurrence within the Key: several sides can share a kind and commit pin.
  /** @type {Map<unknown, DismissalFact>} */
  const dismissalFact = new Map();
  for (const file of work) {
    if (file.unreadable) continue;
    if (file.type === "feature") {
      const feature = typeof file.data.key === "string" ? file.data.key : null;
      if (feature !== null) pairDismissals(dismissalFact, factsByKey.get(`feature:${feature}`), file.data.finding);
      continue;
    }
    for (const entry of file.cases ?? []) pairDismissals(dismissalFact, factsByKey.get(`case:${entry.key}`), entry.data.finding);
  }

  // Every derived finding, by the case it goes on, with the Rules or cases it names.
  /** @type {Map<string, Array<{ finding: PersistFinding, subjects: string[] }>>} */
  const derived = new Map();
  // The Feature-level Overreaches this run raised (ADR-0039), by the Feature they belong to.
  /** @type {Map<string, PersistFinding[]>} */
  const featureRaised = new Map();
  /** @type {Map<string, JudgeVerdict>} */
  const verdictOf = new Map();
  /** @type {PersistNote[]} */
  const notes = [];
  /** @type {(key: string, finding: PersistFinding, subjects: string[]) => void} */
  const add = (key, finding, subjects) => {
    if (!derived.has(key)) derived.set(key, []);
    if (!(/** @type {Array<{ finding: PersistFinding, subjects: string[] }>} */ (derived.get(key))).some((x) => isDeepStrictEqual(x.finding, finding))) (/** @type {Array<{ finding: PersistFinding, subjects: string[] }>} */ (derived.get(key))).push({ finding, subjects });
  };
  for (const o of outcomes.values()) {
    if (!o.usable) continue;
    const checked = /** @type {JudgeChecked} */ (o.checked);
    // The Feature-level unit (ADR-0039) judges a Feature's Rules against its Boundaries: its
    // Overreaches are Feature-level findings, with the Rule as their subject.
    if (isFeatureUnit(o.unit)) {
      const list = featureRaised.get(o.unit.feature) ?? [];
      for (const x of checked.overreaches) {
        list.push({ kind: "Overreach", at_commit: T, evidence: overreachEvidence(x, "rule"), rests_on: x.boundary, rule: x.subject });
      }
      featureRaised.set(o.unit.feature, list);
      continue;
    }
    const scenario = atIndex.scenarios.get(/** @type {string} */ (o.unit.scenario))?.[0]?.file;
    const featureFile = atIndex.features.get(o.unit.feature)?.[0]?.file;
    // The colliding cases of other files the unit was sent as context: a Conflict may name one as
    // its other side. The brief is the one source of which they were, since the cap may have
    // dropped them.
    const context = new Set(Object.keys(/** @type {JudgeBrief} */ (JSON.parse(readFileSync(/** @type {string} */ (o.unit.brief_json), "utf8"))).context_text ?? {}));
    const inFile = new Set((scenario?.cases ?? []).map((c) => c.key));
    for (const v of checked.verdicts) verdictOf.set(v.key, v);
    for (const v of checked.verdicts) {
      if (v.verdict !== "Conflict") continue;
      const others = otherCases(v, scenario, featureFile, context);
      const rules = v.rules.filter((r) => isRuleRef(r));
      add(v.key, { kind: "Conflict", at_commit: T, evidence: conflictEvidence(v, others), ...(others.length === 0 && rules.length === 1 && isQualifiedRuleRef(rules[0]) ? { rule: rules[0] } : {}) }, others.length ? others : rules);
      if (others.length === 0 && rules.length === 0) {
        notes.push({ code: "conflict_side_unknown", feature: o.unit.feature, scenario: o.unit.scenario ?? undefined, key: v.key });
      }
      // The other side, unless it already names this case in a Conflict of its own. A context case
      // is judged in a unit of its own, which sees this case as its context: nothing is written on
      // it from here.
      for (const other of others) {
        if (!inFile.has(other)) continue;
        const own = /** @type {JudgeChecked} */ (o.checked).verdicts.find((x) => x.key === other);
        if (own?.verdict === "Conflict" && otherCases(own, scenario, featureFile, context).includes(v.key)) continue;
        add(other, { kind: "Conflict", at_commit: T, evidence: conflictEvidence({ ...v, quote_case: v.quote_other, quote_other: v.quote_case }, [v.key]) }, [v.key]);
      }
    }
    // The Overreach the judge raised (ADR-0039): a case that checks behaviour a Boundary hands
    // elsewhere. It comes as a list beside the verdict, so a case can carry both.
    for (const x of checked.overreaches) {
      add(x.subject, { kind: "Overreach", at_commit: T, evidence: overreachEvidence(x, "case"), rests_on: x.boundary }, [x.boundary]);
    }
  }
  // The Overreach (ADR-0039): the Scan's mechanical finding on a case whose `covers` names a Waived
  // Rule. It is not judged, so it is derived from the Scan whatever the judge said.
  for (const r of s.results) {
    const o = overreachOf(r, T);
    if (o) add(o.key, o.finding, o.subjects);
  }

  /** @type {SettledCase[]} */
  const cases = [];
  /** @type {CarriedItem[]} */
  const carried = [];
  /** @type {Array<{ feature: string, scenario: string, key: string }>} */
  const missing = [];
  const dismissed = { held: 0, rearmed: 0, total: 0 };
  const judgedFeatures = new Set(plan.scope.features.filter((f) => f.judged).map((f) => f.feature));
  for (const f of plan.scope.features) {
    if (!f.judged) continue;
    for (const sc of /** @type {NonNullable<typeof f.scenarios>} */ (f.scenarios)) {
      if (sc.status !== "unit") continue;
      const o = outcomes.get(/** @type {string} */ (sc.scenario));
      const judgedFile = atIndex.scenarios.get(/** @type {string} */ (sc.scenario))?.[0]?.file;
      const unit = plan.units.find((u) => u.scenario === sc.scenario);
      const brief = o?.usable ? /** @type {JudgeBrief} */ (JSON.parse(readFileSync(/** @type {NonNullable<typeof unit>} */ (unit).brief_json, "utf8"))) : null;
      const compared = new Set((brief?.upstream_rules ?? []).map((r) => r.ref));
      for (const c of judgedFile?.cases ?? []) {
        // Only the cases the unit was sent are settled: the judge never read the others, so their
        // stored findings stay exactly as they are.
        if (sc.selected && !sc.selected.includes(c.key)) continue;
        const decl = workIndex.cases.get(c.key)?.[0];
        if (!decl) {
          if (o?.usable) missing.push({ feature: f.feature, scenario: /** @type {string} */ (sc.scenario), key: c.key });
          continue;
        }
        const before = Array.isArray(/** @type {ParsedEntry} */ (decl.entry).data.finding) ? /** @type {unknown[]} */ (/** @type {ParsedEntry} */ (decl.entry).data.finding) : [];
        const place = { feature: f.feature, scenario: /** @type {string} */ (sc.scenario), file: decl.file.rel, key: c.key };
        if (!o?.usable) {
          // No verdict: the judged findings stay as they are. Its open Stales stored without a cause are still carried.
          for (const x of before) if (isOpenFinding(x) && /** @type {PersistFinding} */ (x).kind === "Stale" && !isStaleObligation(x)) carried.push({ ...place, ...carriedOf(/** @type {Record<string, unknown>} */ (x), staleFact, c.key), because: "no_usable_reply" });
          // The Scan's own Overreach (ADR-0039) is raised whatever changed since the Watermark, so
          // it is written on the case whether or not a judge judged it.
          const m = mergeMechanical(before, derived.get(c.key) ?? [], { key: c.key, dismissalFact });
          dismissed.held += m.held;
          dismissed.rearmed += m.rearmed;
          dismissed.total += m.after.filter((x) => isMap(x) && isMap(x.dismissed)).length;
          cases.push({ ...place, verdict: verdictOf.get(c.key)?.verdict ?? "Current", before, after: m.after, changed: !isDeepStrictEqual(before, m.after), entry: /** @type {ParsedEntry} */ (decl.entry), raised: m.raised });
          continue;
        }
        const r = merge(before, derived.get(c.key) ?? [], { dismissalFact, compared });
        for (const x of r.carried) carried.push({ ...place, ...carriedOf(/** @type {Record<string, unknown>} */ (x), staleFact, c.key), because: "not_cleared" });
        dismissed.held += r.held;
        dismissed.rearmed += r.rearmed;
        dismissed.total += r.after.filter((x) => isMap(x) && isMap(x.dismissed)).length;
        cases.push({ ...place, verdict: verdictOf.get(c.key)?.verdict ?? "Current", before, after: r.after, changed: !isDeepStrictEqual(before, r.after), entry: /** @type {ParsedEntry} */ (decl.entry), raised: r.raised });
      }
    }
  }
  // The Scan's own Overreach (ADR-0039) on the cases of a Feature nothing judged: no judge unit
  // covers them, but the Scan raises the Overreach whatever changed since the Watermark, so it is
  // written and resolved here all the same. No Watermark advances: nothing was judged.
  for (const f of plan.scope.features) {
    if (f.judged) continue;
    for (const decl of casesOf(workIndex, f.feature)) {
      const before = Array.isArray(decl.entry.data.finding) ? /** @type {unknown[]} */ (decl.entry.data.finding) : [];
      const m = mergeMechanical(before, derived.get(decl.entry.key) ?? [], { key: decl.entry.key, dismissalFact });
      dismissed.held += m.held;
      dismissed.rearmed += m.rearmed;
      dismissed.total += m.after.filter((x) => isMap(x) && isMap(x.dismissed)).length;
      if (!isDeepStrictEqual(before, m.after)) {
        cases.push({ feature: f.feature, scenario: decl.scenario ?? "", file: decl.file.rel, key: decl.entry.key, verdict: "Current", before, after: m.after, changed: true, entry: decl.entry, raised: m.raised });
      }
    }
  }

  // The Stale the Scan owes (ADR-0043): every case that covers or relies on an Affected Rule, stored
  // with its cause whatever the judge said and whether or not its Feature was judged. A Stale the
  // case already stores for the same change (the same baseline and cause digest, open or closed) is
  // not owed again, so a rescan never duplicates one. It goes after the case's other findings and
  // displaces none: a stored Conflict stays, and stays first.
  /** @type {Map<string, StaleObligation[]>} */
  const owed = new Map();
  for (const o of /** @type {ScanHistory} */ (s.history).stale_obligations) {
    if (o.stored) continue;
    owed.set(o.key, [...(owed.get(o.key) ?? []), o]);
  }
  for (const [key, list] of owed) {
    const decl = workIndex.cases.get(key)?.[0];
    if (!decl) continue;
    const raised = list.map((o) => staleOf(o, T));
    const place = cases.find((c) => c.key === key && c.file === decl.file.rel);
    if (place) {
      place.after = [...place.after, ...raised];
      place.raised = [...(place.raised ?? []), ...raised];
      place.changed = !isDeepStrictEqual(place.before, place.after);
      continue;
    }
    const before = Array.isArray(decl.entry.data.finding) ? /** @type {unknown[]} */ (decl.entry.data.finding) : [];
    cases.push({ feature: list[0].feature, scenario: decl.scenario ?? "", file: decl.file.rel, key, verdict: "Current", before, after: [...before, ...raised], changed: true, entry: decl.entry, raised });
  }

  // The Feature's findings after the run (ADR-0039): the Feature-level unit's Overreaches replace
  // the open ones, and a stored one the run no longer raises is resolved. A unit with no usable
  // reply leaves every finding as it is.
  /** @type {SettledFeature[]} */
  const features = [];
  for (const f of plan.scope.features) {
    const file = workIndex.features.get(f.feature)?.[0]?.file ?? null;
    if (!file) continue;
    const before = Array.isArray(file.data.finding) ? /** @type {unknown[]} */ (file.data.finding) : [];
    const o = outcomes.get(featureUnitId(f.feature));
    const merged = mergeFeature(before, featureRaised.get(f.feature) ?? [], dismissalFact, file.boundaries.map((b) => b.key), o?.usable === true);
    dismissed.held += merged.held;
    dismissed.rearmed += merged.rearmed;
    dismissed.total += merged.after.filter((x) => isMap(x) && isMap(x.dismissed)).length;
    features.push({ feature: f.feature, file: file.rel, before, after: merged.after, changed: !isDeepStrictEqual(before, merged.after) });
  }

  // The walk visits every case with a finding this run raised and still open, and every
  // carried open Stale of the Features judged.
  /** @type {WalkItem[]} */
  const walk = [];
  /** @type {(x: { feature: string, scenario: string, file: string, key: string }, finding: { kind: string, at_commit: string | null, carried: boolean, origin: "judged" | "mechanical" | null }) => void} */
  const visit = (x, finding) => {
    let w = walk.find((y) => y.key === x.key && y.file === x.file);
    if (!w) walk.push((w = { feature: x.feature, scenario: x.scenario, file: x.file, key: x.key, findings: [] }));
    w.findings.push(finding);
  };
  for (const c of cases) for (const x of /** @type {PersistFinding[]} */ (c.raised)) visit(c, { kind: x.kind, at_commit: x.at_commit, carried: false, origin: findingOrigin(x) });
  for (const x of carried) visit(/** @type {{ feature: string, scenario: string, file: string, key: string }} */ (x), { kind: "Stale", at_commit: x.at_commit, carried: true, origin: "judged" });

  // A judged case missing from the working tree (only under `--target`) cannot hold its finding,
  // so its Feature's Watermark holds: advancing it would record the case as judged and settled.
  const watermarks = [...judgedFeatures].map((feature) => {
    const f = plan.scope.features.find((x) => x.feature === feature);
    const file = workIndex.features.get(feature)?.[0]?.file ?? null;
    const hold = !complete.has(feature) ? "incomplete" : file === null ? "feature_file_gone" : missing.some((m) => m.feature === feature) ? "missing_cases" : null;
    return { feature, file: file?.rel ?? null, from: /** @type {NonNullable<typeof f>} */ (f).watermark ?? null, to: T, hold };
  });
  return { root, target: T, index: atIndex, persistCheck: /** @type {ScanHistory} */ (s.history).persist, cases, features, carried, missing, dismissed, walk, watermarks, notes };
}

// The dismissed findings of one case or Feature, paired with the Dismissal facts of its Key: both
// are in stored order, so the nth of each is the same Dismissal.
/**
 * @param {Map<unknown, DismissalFact>} dismissalFact
 * @param {DismissalFact[] | undefined} facts
 * @param {unknown} findings
 * @returns {void}
 */
function pairDismissals(dismissalFact, facts, findings) {
  if (!facts) return;
  for (const x of Array.isArray(findings) ? findings : []) {
    if (!isMap(x) || !isMap(x.dismissed)) continue;
    const fact = facts.shift();
    if (fact) dismissalFact.set(x, fact);
  }
}

// The Feature's findings after the run (ADR-0039): the Overreaches the judge raised replace the
// open ones, and a stored one the run no longer raises is resolved: the Boundary it rested on was
// withdrawn, or the Rule no longer crosses it. A dismissed Overreach stays while its Dismissal
// holds, and absorbs the fresh finding that re-emerges under it. The findings of other kinds are
// the Scan's own and stay as they are.
/**
 * @param {unknown[]} before
 * @param {PersistFinding[]} raised
 * @param {Map<unknown, DismissalFact>} dismissalFact
 * @param {string[]} boundaries - the Feature's Boundary keys
 * @param {boolean} judged - the Feature-level unit judged the Feature, with a usable reply
 * @returns {{after: unknown[], held: number, rearmed: number}}
 */
function mergeFeature(before, raised, dismissalFact, boundaries, judged) {
  /**
   * @param {{ rests_on?: unknown, rule?: unknown }} x
   * @returns {string}
   */
  const key = (x) => `${String(x.rests_on ?? "")}\0${String(x.rule ?? "")}`;
  const fresh = new Map(raised.map((x) => [key(x), x]));
  /** @type {unknown[]} */
  const out = [];
  let held = 0;
  let rearmed = 0;
  for (const x of before) {
    if (!isMap(x)) {
      out.push(x);
      continue;
    }
    if (x.kind !== "Overreach" || findingOrigin(x) !== "judged") {
      out.push(x);
      continue;
    }
    if (!isOpenFinding(x)) {
      const fact = dismissalFact.get(x);
      if (fact?.status === "holds") {
        out.push(x);
        fresh.delete(key(x));
        held++;
      } else rearmed++;
      continue;
    }
    // An open Overreach: resolved when the Boundary it rested on was withdrawn, or when the unit
    // judged the Feature and did not raise it again.
    if (!boundaries.includes(String(x.rests_on ?? ""))) continue;
    if (judged) continue;
    out.push(x);
  }
  out.push(...fresh.values());
  return { after: out, held, rearmed };
}

// One case's findings after the run: `before` as the working tree holds them, `fresh` what this
// run's verdicts derive for it (`{finding, subjects}`).
/**
 * @param {unknown[]} before
 * @param {Array<{ finding: PersistFinding, subjects: string[] }>} fresh
 * @param {{ dismissalFact: Map<unknown, DismissalFact>, compared: Set<string> }} param2
 * @returns {{ after: unknown[], carried: unknown[], held: number, rearmed: number, raised: PersistFinding[] }}
 */
function merge(before, fresh, { dismissalFact, compared }) {
  // Only comparisons actually rejudged are cleared: a qualified side absent from the Change bundle stays.
  /** @param {Record<string, unknown>} x */
  const unjudged = (x) => x.kind === "Conflict" && ruleRefsIn(String(x.evidence ?? "")).some((r) => isQualifiedRuleRef(r) && !compared.has(r));
  // What this run raises, by where it comes from: a judge's verdict, and the Scan's Overreach. Each
  // origin supersedes the stored findings of its own kind and leaves the other's alone. The origin
  // comes from the finding, not its kind: an Overreach resting on a Boundary is the judge's, one
  // resting on a Waived Rule is the Scan's.
  /** @type {{ judged: Array<{ finding: PersistFinding, subjects: string[] }>, mechanical: Array<{ finding: PersistFinding, subjects: string[] }> }} */
  const pending = {
    judged: fresh.filter((d) => isJudgedFinding(d.finding)),
    mechanical: fresh.filter((d) => isMechanicalFinding(d.finding)),
  };
  // First the Dismissals. A fresh finding re-emerging under one that holds is absorbed by it; one
  // that re-armed gives way to the fresh finding. A dismissed finding that does not re-emerge is
  // kept, unless nothing of its own origin was raised: then it was resolved.
  const kept = new Set();
  let held = 0;
  let rearmed = 0;
  for (const x of before) {
    if (!isMap(x) || x.kind === "Stale") continue;
    const origin = findingOrigin(x);
    if (origin === null || isOpenFinding(x)) continue;
    const list = pending[origin];
    const i = list.findIndex((d) => reEmerges(d, x));
    if (i === -1) {
      if (list.length || unjudged(x)) kept.add(x);
    } else if (dismissalFact.get(x)?.status === "holds") {
      kept.add(x);
      list.splice(i, 1);
      held++;
    } else rearmed++;
  }

  // Then the open findings. What this run raises replaces them. Otherwise (Current, or a verdict a
  // holding Dismissal absorbed) a Conflict is cleared. A Stale is no verdict (ADR-0043): it stays as
  // it is, and one stored without a cause is reported as carried. An Overreach the run no longer
  // raises is resolved: the Rule is not Waived any more, the case no longer covers it, or the
  // Boundary it crossed is withdrawn.
  const after = [];
  const carried = [];
  for (const x of before) {
    if (!isMap(x)) {
      after.push(x);
      continue;
    }
    const origin = findingOrigin(x);
    if (x.kind === "Stale") {
      // A Dismissal of a Stale cause that re-armed (a Rule it rests on changed again) reopens it.
      if (isStaleObligation(x) && !isOpenFinding(x) && isMap(x.dismissed) && dismissalFact.get(x)?.status === "rearmed") {
        const { dismissed: _, ...reopened } = x;
        after.push(reopened);
        rearmed++;
        continue;
      }
      after.push(x);
      if (isOpenFinding(x) && !isStaleObligation(x)) carried.push(x);
    } else if (origin === null || unjudged(x)) after.push(x);
    else if (!isOpenFinding(x)) {
      if (kept.has(x)) after.push(x);
    }
  }
  const raised = [...pending.judged, ...pending.mechanical].map((d) => d.finding);
  after.push(...raised);
  return { after, carried, held, rearmed, raised };
}

// One case's mechanical findings after the run: the Scan's own Overreach (ADR-0039), which is
// raised whatever changed since the Watermark and so is written whatever a judge said. The judged
// findings are left exactly as they are: nothing judged them.
/**
 * @param {unknown[]} before
 * @param {Array<{ finding: PersistFinding, subjects: string[] }>} fresh
 * @param {{ key: string, dismissalFact: Map<unknown, DismissalFact> }} param2
 * @returns {{ after: unknown[], held: number, rearmed: number, raised: PersistFinding[] }}
 */
function mergeMechanical(before, fresh, { key, dismissalFact }) {
  const pending = fresh.filter((d) => isMechanicalFinding(d.finding));
  // The Dismissals first: a fresh finding re-emerging under one that holds is absorbed by it; one
  // that re-armed gives way to the fresh finding.
  const kept = new Set();
  let held = 0;
  let rearmed = 0;
  for (const x of before) {
    if (!isMap(x)) continue;
    if (findingOrigin(x) !== "mechanical" || x.kind === "Stale" || isOpenFinding(x)) continue;
    const i = pending.findIndex((d) => reEmerges(d, x));
    if (i === -1) {
      if (pending.length) kept.add(x);
    } else if (dismissalFact.get(x)?.status === "holds") {
      kept.add(x);
      pending.splice(i, 1);
      held++;
    } else rearmed++;
  }
  // Then the open findings: what this run raises replaces them, and one it no longer raises is
  // resolved. The findings of other origins are the judge's, and stay as they are.
  const after = [];
  for (const x of before) {
    if (!isMap(x)) {
      after.push(x);
      continue;
    }
    if (findingOrigin(x) !== "mechanical" || x.kind === "Stale") {
      after.push(x);
      continue;
    }
    if (!isOpenFinding(x) && kept.has(x)) after.push(x);
  }
  const raised = pending.map((d) => d.finding);
  after.push(...raised);
  return { after, held, rearmed, raised };
}

// The cases a Feature holds in the working tree, each with its declaration.
/**
 * @param {KeyIndex} index
 * @param {string} feature
 * @returns {Array<{ file: ParsedFile, line: number, feature: string | null, scenario: string | null, entry: ParsedEntry }>}
 */
function casesOf(index, feature) {
  /** @type {Array<{ file: ParsedFile, line: number, feature: string | null, scenario: string | null, entry: ParsedEntry }>} */
  const out = [];
  for (const decls of index.cases.values()) {
    const decl = decls[0];
    if (decl.feature === feature) out.push(decl);
  }
  return out;
}

// The Overreach the Scan raised on a case (ADR-0039): a Finding of its own, resting on the Waived
// Rule it names. The Scan's result carries the key it rests on; no other kind does.
/**
 * @param {ScanResult} r
 * @param {string | null} at
 * @returns {{ key: string, finding: PersistFinding, subjects: string[] } | null}
 */
function overreachOf(r, at) {
  if (r.kind !== "overreach") return null;
  const key = /** @type {string} */ (r.key);
  const restsOn = /** @type {string} */ (r.rests_on);
  return { key, finding: { kind: "Overreach", at_commit: at, evidence: norm(r.message), rests_on: restsOn }, subjects: [restsOn] };
}

// The evidence of an Overreach the judge raised: the Boundary it rests on, the subject's own words
// and the Boundary's, and what crosses.
/**
 * @param {JudgeOverreach} x
 * @param {"case" | "rule"} subject
 * @returns {string}
 */
function overreachEvidence(x, subject) {
  const other = norm(x.boundary_quote);
  const stop = /[.!?]$/.test(other) ? "" : ".";
  const who = subject === "rule" ? "the Rule" : "the case";
  return `${x.boundary}: ${who} says "${norm(x.subject_quote)}" but the Boundary says "${other}"${stop} ${norm(x.crossing)}`;
}

// Whether fresh finding `d` is dismissed finding `x` re-emerging: the same kind and, for a
// Conflict, the same other side, when `x`'s evidence names one this run's does not share. An
// Overreach rests on one Rule or one Boundary, so only the same one is the same finding. A Stale
// is never raised by a verdict, so it never re-emerges here.
/**
 * @param {{ finding: PersistFinding, subjects: string[] }} d
 * @param {Record<string, unknown>} x
 * @returns {boolean}
 */
function reEmerges(d, x) {
  if (d.finding.kind !== x.kind) return false;
  if (x.kind === "Overreach") return d.finding.rests_on === x.rests_on;
  if (x.kind !== "Conflict" || d.subjects.length === 0) return true;
  const evidence = String(x.evidence ?? "");
  const named = (/** @type {string} */ k) => new RegExp(`(?<![0-9A-Za-z_/-])${k}(?![0-9A-Za-z_/-])`).test(evidence);
  if (d.subjects.some(named)) return true;
  // Its evidence names a Rule of its own, not this one: a different Conflict.
  return ruleRefsIn(evidence).length === 0;
}

/**
 * @param {Record<string, unknown>} x
 * @param {Map<string, StaleFact>} staleFact
 * @param {string} key
 * @returns {{ at_commit: string | null, at_commit_resolves: boolean | null, evidence: string | null }}
 */
const carriedOf = (x, staleFact, key) => {
  const fact = staleFact.get(`${key}\0${written(x.at_commit)}`);
  return { at_commit: written(x.at_commit), at_commit_resolves: fact?.at_commit_resolves ?? null, evidence: written(x.evidence) };
};

// The cases a Conflict's other side is. The judge's contract has no field for it (and its prompt is
// never edited), so it is inferred from the reply: the cases its `rules` name, of the file or of
// the unit's context (a colliding case of another file), else the one other case of the file whose
// summary or prose holds `quote_other` word for word, when no Rule of the Feature does. A context
// case is a side only when named. The `yaml` block is not searched: earlier findings quote other
// cases there. A Conflict against a Rule names no case.
/**
 * @param {JudgeVerdict} v
 * @param {ParsedFile | undefined | null} scenario
 * @param {ParsedFile | FeatureFile | undefined | null} featureFile
 * @param {ReadonlySet<string>} context - the Keys of the context cases the unit was sent
 * @returns {string[]}
 */
function otherCases(v, scenario, featureFile, context) {
  const keys = new Set((scenario?.cases ?? []).map((c) => c.key).filter((k) => k !== v.key));
  const named = v.rules.filter((r) => keys.has(r) || context.has(r));
  if (named.length) return [...new Set(named)];
  if (v.rules.some((r) => isQualifiedRuleRef(r))) return [];
  const q = norm(v.quote_other);
  if (!q) return [];
  const lines = featureFile ? (/** @type {ParsedFile} */ (featureFile)).text.replace(/\r\n/g, "\n").split("\n") : [];
  if (featureFile && (/** @type {ParsedFile} */ (featureFile)).rules.some((r) => holdsQuote(lines.slice(r.line - 1, r.end).join("\n"), q))) return [];
  const claim = (/** @type {ParsedEntry} */ c) => [c.summary, ...c.prose.map((p) => p.text)].join("\n");
  const holding = (scenario?.cases ?? []).filter((c) => c.key !== v.key && holdsQuote(claim(c), q));
  return holding.length === 1 ? [holding[0].key] : [];
}

/** @type {(s: unknown) => string} */
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * @param {JudgeVerdict} v
 * @param {string[]} others
 * @returns {string}
 */
function conflictEvidence(v, others) {
  const rules = v.rules.filter((r) => isRuleRef(r));
  const side = others.length ? others : rules;
  const what = others.length ? others.join(", ") : rules.length === 1 ? "the Rule" : rules.length ? "the Rules" : "the other side";
  const why = norm(v.why);
  const other = norm(v.quote_other);
  // The sentence ends at the quote when the quote ends one itself.
  const stop = /[.!?]$/.test(other) ? "" : ".";
  return `${side.length ? `${side.join(", ")}: ` : ""}the case says "${norm(v.quote_case)}" but ${what} ${others.length > 1 || rules.length > 1 ? "say" : "says"} "${other}"${stop}${why ? ` ${why}` : ""}`;
}

// The Stale the Scan owes a case, as it is stored: the Watermark it was taken from, the Rules that
// caused it and the Affected Rules of the case they reach, pinned to the run's target.
/**
 * @param {StaleObligation} o
 * @param {string | null} at
 * @returns {PersistFinding}
 */
const staleOf = (o, at) => ({
  kind: "Stale",
  at_commit: at,
  baseline: o.baseline,
  causes: o.causes,
  affects: o.affects,
  cause_digest: o.cause_digest,
  evidence: `${o.causes.join(", ")} changed since ${o.baseline.slice(0, 12)}`,
});

// Writes what `settle` left, Feature by Feature: each changed case's `finding` list, the
// Feature-level findings (ADR-0039). The Watermark is never written here: it waits for checkpoint 2
// (the walk's end, once the fixes and any new cases are committed), so a Feature every non-empty
// scenario file of which got a usable reply reports `awaiting_checkpoint` and the walk records it.
// Every file is rendered and passed through `check-file` first; one failure blocks every write of
// that Feature.
/**
 * @param {SettledFindings} settled
 * @returns {WrittenFindings}
 */
export function writeFindings(settled) {
  const { root, target } = settled;
  const repo = repositoryOf(root);
  /** @type {(rel: string) => string} */
  const repoPath = (rel) => `${repo?.prefix ?? ".qa/"}${rel}`;
  // The Features the run writes: each judged Feature (its Watermark) and each Feature whose
  // Feature-level findings changed.
  /** @type {Map<string, { watermark: WatermarkItem | null, cases: SettledCase[], findings: unknown[] | null, file: string | null }>} */
  const jobs = new Map();
  /**
   * @param {string} feature
   * @returns {{ watermark: WatermarkItem | null, cases: SettledCase[], findings: unknown[] | null, file: string | null }}
   */
  const job = (feature) => {
    if (!jobs.has(feature)) jobs.set(feature, { watermark: null, cases: [], findings: null, file: null });
    return /** @type {{ watermark: WatermarkItem | null, cases: SettledCase[], findings: unknown[] | null, file: string | null }} */ (jobs.get(feature));
  };
  for (const w of /** @type {WatermarkItem[]} */ (settled.watermarks)) job(w.feature).watermark = w;
  for (const c of settled.cases) if (c.changed) job(c.feature).cases.push(c);
  for (const f of settled.features) if (f.changed) {
    const j = job(f.feature);
    j.findings = f.after;
    j.file = f.file;
  }

  /** @type {PersistedFeature[]} */
  const features = [];
  for (const [feature, j] of jobs) {
    /** @type {Map<string, { cases: SettledCase[], findings: unknown[] | null, watermark: string | null }>} */
    const edits = new Map(); // `.qa/` path → {cases: [case], findings, watermark}
    /** @type {(rel: string) => { cases: SettledCase[], findings: unknown[] | null, watermark: string | null }} */
    const at = (rel) => {
      if (!edits.has(rel)) edits.set(rel, { cases: [], findings: null, watermark: null });
      return /** @type {{ cases: SettledCase[], findings: unknown[] | null, watermark: string | null }} */ (edits.get(rel));
    };
    for (const c of j.cases) at(c.file).cases.push(c);
    // The Feature-level findings (ADR-0039): the Feature file's own `finding` list.
    if (j.findings !== null && j.file !== null) at(j.file).findings = j.findings;
    const hold = j.watermark?.hold ?? "no_judge_unit";
    const due = j.watermark !== null && j.watermark.hold === null;

    /** @type {Array<{ file: string, line?: number | null, message: string }>} */
    const errors = [];
    /** @type {Map<string, string>} */
    const outputs = new Map();
    const config = rootConfig(root);
    for (const [rel, e] of edits) {
      const text = readFileSync(join(root, rel), "utf8");
      const out = editFindings(parse(rel, text), e);
      errors.push(...out.errors.map((m) => ({ file: repoPath(rel), message: m })));
      if (out.errors.length) continue;
      const checked = checkFile(out.file, config);
      errors.push(...checked.errors.map((x) => ({ file: repoPath(rel), line: x.line, message: x.message })));
      const filled = backfill(root, rel, out.text);
      if (filled !== text) outputs.set(rel, filled);
    }
    if (!errors.length) for (const [rel, text] of outputs) writeFileSync(join(root, rel), text);
    const watermark = { advanced: false, from: j.watermark?.from ?? null, reason: errors.length ? "write_blocked" : due ? "awaiting_checkpoint" : hold };
    features.push({ feature, watermark, written: errors.length ? [] : [...outputs.keys()].map(repoPath).sort(), blocked: errors });
  }
  const paths = features.flatMap((f) => f.written).sort();
  return { features, paths };
}

// One `.qa/` file with its edits (lib/knowledge-file.mjs `edit`): each case's `finding` list, the
// Feature file's own `finding` list and the frontmatter's `watermark`. Errors are messages, one per
// case. A file `edit` cannot read is left as it is, for its check to refuse.
/**
 * @param {ParsedFile} file
 * @param {{ cases: SettledCase[], findings: unknown[] | null, watermark: string | null }} param1
 * @returns {{ text: string, file: ParsedFile, errors: string[] }}
 */
function editFindings(file, { cases, findings, watermark }) {
  /** @type {EditChange[]} */
  const changes = cases.map((c) => ({ at: c.key, set: { finding: c.after } }));
  // The Feature-level findings (ADR-0039) sit in the Feature file's own `finding` list.
  if (findings !== null) changes.push({ set: { finding: findings } });
  // The old Watermark's digest goes with it; the write backfills the new one's.
  if (watermark) changes.push({ set: { watermark, watermark_digest: undefined } });
  const r = edit(file, changes);
  if (r.ok || r.unreadable) return { text: r.text, file: r.file, errors: [] };
  /** @type {(key: string) => unknown} */
  const ofCase = (key) => cases.find((c) => c.key === key)?.after;
  const errors = r.errors.map((e) =>
    e.code === "no_block"
      ? `\`${e.at}\` has no \`yaml\` block to hold its findings`
      : e.code === "render" && e.field === "finding"
        ? `\`${e.at}\`: its findings cannot be written in the YAML dialect: ${JSON.stringify(ofCase(/** @type {string} */ (e.at)))}`
        : `\`${e.at}\`: ${e.message}`,
  );
  return { text: r.text, file: r.file, errors };
}
