// @ts-check
// Inverse `covers` lookup shared by deep-dive's Feature state and ask's missing knowledge.
import { listOf } from "./dialect.mjs";

/** @import { CaseDecl } from "./qa-index.mjs" */

/**
 * The index shape holding cases for rule coverage lookups.
 * @typedef {{
 *   cases: ReadonlyMap<string, CaseDecl[]>,
 *   [key: string]: unknown,
 * }} RuleCoverageIndex
 */

/**
 * @param {RuleCoverageIndex} index
 * @param {string} feature
 * @param {string} rule
 * @returns {CaseDecl[]}
 */
export function casesCoveringRule(index, feature, rule) {
  return [...index.cases.values()].map((d) => d[0]).filter((d) => d.feature === feature)
    .filter((c) => listOf(c.entry.data.covers).includes(rule));
}
