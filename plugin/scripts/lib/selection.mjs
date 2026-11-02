// @ts-check
// The cases a change selects for the judge (ADR-0043). The plan and `brief judge` both call it, so
// the unit the plan writes and the unit a re-run of `brief judge` reads never disagree.
//
// Selected: the Stale cases (the Scan's obligations, and every open Stale a case already stores,
// with a cause or without one), the new and edited cases (the case diff since the Watermark), the cases `/qa-ask`
// escalated, and every case that collides with one of those: one that shares a governing Rule with it
// (a Rule it covers or relies on). The selection is the whole Feature on a first assessment, a new
// Rule, a Rule the engineer widened (Run data), or a Boundary change.
/** @import { CaseEntry, ParsedFile, UnreadableFile } from "./knowledge-file.mjs" */
/** @import { KeyIndex } from "./qa-index.mjs" */
/** @import { FeatureSummary } from "./scan-history.mjs" */
/** @import { StaleObligation } from "./stale-obligations.mjs" */
/** @import { ChangeData } from "./change-data.mjs" */
import { relianceOf } from "./reliance.mjs";
import { formatRuleRef } from "./rule-ref.mjs";
import { needsJudgement } from "./scan-history.mjs";
import { isOpenFinding } from "./stored-findings.mjs";

/**
 * Why a case is selected, in the order the checks run.
 * @typedef {"stale" | "new_or_edited" | "escalated" | "collides" | "widened"} SelectionReason
 */

/**
 * @typedef {{
 *   widen: string[],
 *   keys: Set<string>,
 *   reasons: Map<string, SelectionReason[]>,
 * }} Selection
 */

// The Rules that govern a case, qualified `feature/rule`: those it covers and those it relies on.
/**
 * @param {CaseEntry} entry
 * @param {string} feature
 * @returns {string[]}
 */
export function governingOf(entry, feature) {
  const covers = Array.isArray(entry.data.covers) ? entry.data.covers.filter((k) => typeof k === "string").map((k) => `${feature}/${k}`) : [];
  const relies = relianceOf(entry, feature).refs.map((r) => formatRuleRef(r.ref));
  return [...new Set([...covers, ...relies])];
}

// Whether a case whose governing Rules are `governing` collides with cases whose governing Rules
// are `claimed`: it shares one. The selection and the judge brief's context both ask this.
/**
 * @param {readonly string[]} governing
 * @param {ReadonlySet<string>} claimed
 * @returns {boolean}
 */
export const collides = (governing, claimed) => governing.some((r) => claimed.has(r));

/**
 * Every case of `feature`, in tree order.
 * @param {readonly (ParsedFile | UnreadableFile)[]} files
 * @param {KeyIndex} index
 * @param {string} feature
 * @returns {CaseEntry[]}
 */
export function casesOfFeature(files, index, feature) {
  /** @type {CaseEntry[]} */
  const out = [];
  for (const f of files) {
    if ("unreadable" in f || f.type !== "scenario" || index.featureOf(f) !== feature) continue;
    out.push(.../** @type {CaseEntry[]} */ (f.cases ?? []));
  }
  return out;
}

// Whether the plan judges a Feature: one whose class needs judgement, and an `unchanged` one in
// which `/qa-ask` escalated a case (Run data), which nothing but the escalation puts in the plan.
/**
 * @param {Pick<FeatureSummary, "feature" | "class">} facts
 * @param {ChangeData | null | undefined} change
 * @returns {boolean}
 */
export const isJudged = (facts, change) =>
  needsJudgement(facts.class) || (takesEscalation(facts.class) && (change?.escalated ?? []).some((e) => e.feature === facts.feature));

// Whether a case escalated in a Feature of this class reaches a judge: a class that needs judgement
// anyway, and `unchanged`.
/**
 * @param {string | null | undefined} classification
 * @returns {boolean}
 */
export const takesEscalation = (classification) => needsJudgement(/** @type {string} */ (classification)) || classification === "unchanged";

/**
 * @param {{
 *   files: readonly (ParsedFile | UnreadableFile)[],
 *   index: KeyIndex,
 *   facts: FeatureSummary,
 *   obligations: readonly StaleObligation[],
 *   change?: ChangeData | null,
 * }} input
 * @returns {Selection}
 */
export function selectCases({ files, index, facts, obligations, change }) {
  const feature = facts.feature;
  const cases = casesOfFeature(files, index, feature);
  /** @type {Map<string, SelectionReason[]>} */
  const reasons = new Map();
  /**
   * @param {string} key
   * @param {SelectionReason} why
   */
  const add = (key, why) => {
    const list = reasons.get(key) ?? [];
    if (!list.includes(why)) list.push(why);
    reasons.set(key, list);
  };

  /** @type {string[]} */
  const widen = [];
  if (facts.class === "first_judgement") widen.push("first_assessment");
  for (const why of facts.affected_rules?.widen ?? []) if (!widen.includes(why)) widen.push(why);
  if (change?.widened.some((w) => w.feature === feature)) widen.push("widened_rule");
  if (widen.length) {
    for (const c of cases) add(c.key, "widened");
    return { widen, keys: new Set(reasons.keys()), reasons };
  }

  const have = new Set(cases.map((c) => c.key));
  for (const o of obligations) if (o.feature === feature) add(o.key, "stale");
  for (const c of cases) if (Array.isArray(c.data.finding) && c.data.finding.some((f) => isOpenFinding(f) && /** @type {{ kind?: unknown }} */ (f).kind === "Stale")) add(c.key, "stale");
  for (const key of facts.cases_changed) add(key, "new_or_edited");
  for (const e of change?.escalated ?? []) if (e.feature === feature) add(e.case, "escalated");
  for (const key of [...reasons.keys()]) if (!have.has(key)) reasons.delete(key);

  // The cases that collide with a selected one: they share a governing Rule.
  const governing = new Map(cases.map((c) => [c.key, governingOf(c, feature)]));
  const claimed = new Set([...reasons.keys()].flatMap((k) => governing.get(k) ?? []));
  for (const c of cases) if (!reasons.has(c.key) && collides(governing.get(c.key) ?? [], claimed)) add(c.key, "collides");
  return { widen, keys: new Set(reasons.keys()), reasons };
}
