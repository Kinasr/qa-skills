// @ts-check
// Scan facts, locations and labels for the model to word (ADR-0024).
import { labelOf } from "./labels.mjs";

/**
 * @import { SummariesLookup } from "./labels.mjs";
 */

/**
 * Formatted finding data for prompt / card rendering.
 * @typedef {{
 *   code: string,
 *   line: string,
 *   place: string,
 *   labels: Record<string, string>,
 *   label?: string,
 *   at_line?: number,
 *   kind?: string,
 *   [key: string]: unknown,
 * }} FindingData
 */

/**
 * @param {Record<string, unknown>} r
 * @param {SummariesLookup} s
 * @returns {FindingData}
 */
export function findingData(r, s) {
  const { message, line: atLine, ...data } = r;
  const at = /** @type {{ file?: string, line?: number }} */ (r.file !== undefined ? r : r.function ?? r.class);
  /** @type {Record<string, string>} */
  const labels = {};
  /** @param {unknown} key */
  const label = (key) => {
    if (typeof key !== "string") return;
    labels[key] = labelOf(s, key);
  };
  for (const field of ["key", "feature", "rule", "automation", "rests_on"]) label(r[field]);
  for (const field of ["features", "annotation", "knowledge"]) if (Array.isArray(r[field])) {
    for (const key of r[field]) if (s.testCase(key) !== undefined || s.scenario(key) !== undefined || s.feature(key) !== undefined || s.rule(key) !== undefined) label(key);
  }
  return { ...data, code: /** @type {string} */ (r.code), line: (/** @type {string} */ (message)).replace(/[\r\n\u2028\u2029]+/g, " "), place: `${at.file}${at.line ? `:${at.line}` : ""}`, labels, ...(r.key !== undefined && { label: labels[/** @type {string} */ (r.key)] }), ...(atLine !== undefined && { at_line: /** @type {number} */ (atLine) }) };
}
