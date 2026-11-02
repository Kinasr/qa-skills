// @ts-check
// Scan reports about the links between Test Cases and Rules (ADR-0043): the Uncited cases, whose
// `covers` is empty whatever their Reliance holds, and the Uncovered Rules, which no case covers.
// Both are reports published beside `results`, never Findings: they carry no Verdict, no
// Dismissal and no count, and nothing waits on them. Reliance is never coverage, so a Rule covered
// only through Reliance is Uncovered; a Waived Rule is deliberately left without a case, so it is
// never Uncovered. (The code's "unlinked" is a case with no Tracker key: a different report.)
import { listOf } from "./dialect.mjs";
import { relianceOf, reverseReliance } from "./reliance.mjs";
import { casesCoveringRule } from "./rule-coverage.mjs";

/** @import { CaseEntry } from "./knowledge-file.mjs" */
/** @import { ScanContext } from "./scan.mjs" */

/**
 * A Test Case with no `covers`: where it sits, and the Rules its `relies_on` names, as written.
 * @typedef {{
 *   feature: string,
 *   scenario: string,
 *   key: string,
 *   file: string,
 *   line: number,
 *   relies_on: string[],
 * }} UncitedCase
 */

/**
 * A live, un-Waived Rule that no case covers: where it sits, and the Keys of the cases whose
 * Reliance names it. `relied_on_by` is information: Reliance is never coverage.
 * @typedef {{
 *   feature: string,
 *   rule: string,
 *   file: string,
 *   line: number,
 *   relied_on_by: string[],
 * }} UncoveredRule
 */

/**
 * This pass reports no results, so it contributes no result kind.
 * @type {readonly string[]}
 */
export const kinds = [];

/**
 * @param {ScanContext} ctx
 * @returns {void}
 */
export function run(ctx) {
  ctx.section("uncited_cases", uncitedCases(ctx));
  ctx.section("uncovered_rules", uncoveredRules(ctx));
}

// The cases whose `covers` names no Rule, in file and line order. A case in a file that names no
// Feature is left to the Integrity check that reports the file: it has no Feature to link within.
/**
 * @param {ScanContext} ctx
 * @returns {UncitedCase[]}
 */
function uncitedCases(ctx) {
  /** @type {UncitedCase[]} */
  const out = [];
  for (const f of ctx.files) {
    if (f.unreadable || f.type !== "scenario") continue;
    const feature = ctx.index.featureOf(f);
    if (feature === null || (ctx.feature && ctx.feature !== feature)) continue;
    const scenario = typeof f.data.key === "string" ? f.data.key : "";
    for (const c of f.cases) {
      if (listOf(c.data.covers).length) continue;
      out.push({ feature, scenario, key: c.key, file: f.rel, line: c.line, relies_on: relianceOf(/** @type {CaseEntry} */ (c), feature).refs.map((r) => r.text) });
    }
  }
  return out.sort(byPlace);
}

// The live Rules no case covers, never a Waived one, in file and line order. A retired Rule has no
// heading in its Feature file, so it is never listed.
/**
 * @param {ScanContext} ctx
 * @returns {UncoveredRule[]}
 */
function uncoveredRules(ctx) {
  const reliance = reverseReliance(ctx.index);
  /** @type {UncoveredRule[]} */
  const out = [];
  for (const [feature, decls] of ctx.index.features) {
    if (ctx.feature && ctx.feature !== feature) continue;
    const file = decls[0].file;
    for (const rule of file.rules) {
      if (rule.waiver || casesCoveringRule(ctx.index, feature, rule.key).length) continue;
      const reliedOnBy = [...new Set((reliance.get(`${feature}/${rule.key}`) ?? []).map((use) => use.case))].sort();
      out.push({ feature, rule: rule.key, file: file.rel, line: rule.line, relied_on_by: reliedOnBy });
    }
  }
  return out.sort(byPlace);
}

/**
 * @param {{ file: string, line: number }} a
 * @param {{ file: string, line: number }} b
 * @returns {number}
 */
function byPlace(a, b) {
  return a.file.localeCompare(b.file) || a.line - b.line;
}
