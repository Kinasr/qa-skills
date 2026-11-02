// @ts-check
// Project stored findings with Scan's Dismissal status; history owns whether a pin holds.
import { isMap } from "./dialect.mjs";
import { PATTERN } from "./keys.mjs";

// The Finding kinds the knowledge layer stores: a judge's verdict (Conflict), the Stale (a judge's
// verdict on disk before ADR-0043, the Scan's own obligation since) and the Overreach (ADR-0039).
// A kind not listed is not a stored Finding: the Divergence and the Outcome gap are the Scan's own,
// stored only to record a Dismissal.
//
// A Stale stored with the cause the Scan recorded (`baseline` and `causes`) is mechanical. A Stale
// without them is every Stale on disk before the Scan stored its cause: it stays judged, readable
// and settleable (ADR-0043).
//
// The origin comes from the finding, not from its kind. An Overreach rests on the key it crosses:
// a Waived Rule, which the Scan finds mechanically, or a Boundary, which only the judge can see.
// So an Overreach resting on a `boundary_` key is judged, and one resting on a `rule_` key is
// mechanical.

/**
 * What a finding rests on: the Rule key it names, the Boundary key it names, or neither.
 * One predicate for that question, so every reader classifies the same key the same way
 * (CODING_STANDARDS: "One predicate per domain question").
 * @param {unknown} finding - the stored Finding, as `.qa/` holds it
 * @returns {{ rule: string | null, boundary: string | null }}
 */
export const restsOn = (finding) => {
  const key = isMap(finding) && typeof finding.rests_on === "string" ? finding.rests_on : null;
  if (key === null) return { rule: null, boundary: null };
  if (PATTERN.boundary.test(key)) return { rule: null, boundary: key };
  return PATTERN.rule.test(key) ? { rule: key, boundary: null } : { rule: null, boundary: null };
};

/**
 * Whether a finding is open: neither dismissed nor held. The one predicate for the question, so a
 * reader and a writer never disagree on which findings still ask for attention.
 * @param {unknown} finding - the stored Finding, as `.qa/` holds it
 * @returns {boolean}
 */
export const isOpenFinding = (finding) => isMap(finding) && !isMap(finding.dismissed) && !isMap(finding.holds);

/**
 * The Rules a Stale names as its cause and as what it reaches (`causes` and `affects`), as written.
 * The one list the three readers of "what a Dismissal rests on" add to the Rules the evidence names,
 * the case covers and its setup relies on: the Scan's re-arm (scan-history), the pin digest and the
 * walk's rest list (settle-walk), so a change to any of them re-arms the Dismissal.
 * @param {unknown} finding - the stored Finding, as `.qa/` holds it
 * @returns {string[]}
 */
export const causeRefs = (finding) => {
  if (!isMap(finding)) return [];
  const refs = (/** @type {unknown} */ list) => (Array.isArray(list) ? list.filter((r) => typeof r === "string") : []);
  return [...refs(finding.causes), ...refs(finding.affects)];
};

/**
 * Whether a Stale carries the structured cause the Scan stores with it: the Watermark commit it was
 * taken from and the Rules that caused it.
 * @param {unknown} finding - the stored Finding, as `.qa/` holds it
 * @returns {boolean}
 */
export const isStaleObligation = (finding) =>
  isMap(finding) && finding.kind === "Stale" && typeof finding.baseline === "string" && finding.baseline !== "" && Array.isArray(finding.causes) && finding.causes.length > 0;

/**
 * Where a stored Finding comes from: a judge's verdict or the Scan; null for any other kind.
 * @param {unknown} finding - the stored Finding, as `.qa/` holds it
 * @returns {"judged" | "mechanical" | null}
 */
export const findingOrigin = (finding) => {
  if (!isMap(finding)) return null;
  if (finding.kind === "Stale") return isStaleObligation(finding) ? "mechanical" : "judged";
  if (finding.kind === "Conflict") return "judged";
  if (finding.kind !== "Overreach") return null;
  return restsOn(finding).boundary !== null ? "judged" : "mechanical";
};

/**
 * Whether a finding is a Finding the knowledge layer stores.
 * @param {unknown} finding
 * @returns {boolean}
 */
export const isStoredFinding = (finding) => findingOrigin(finding) !== null;

/**
 * Whether a finding is a Finding a judge's verdict derives; the Scan derives the other kinds.
 * @param {unknown} finding
 * @returns {boolean}
 */
export const isJudgedFinding = (finding) => findingOrigin(finding) === "judged";

/**
 * Whether a finding is a Finding the Scan derives.
 * @param {unknown} finding
 * @returns {boolean}
 */
export const isMechanicalFinding = (finding) => findingOrigin(finding) === "mechanical";

/** @import { DismissalFact } from "./scan-history.mjs" */

/**
 * A stored finding on a case, with its dismissal status.
 * @typedef {{
 *   kind: string,
 *   status: "dismissed" | "open",
 *   evidence?: unknown,
 *   rests_on?: unknown,
 *   subject?: unknown,
 *   file: string,
 *   line: number,
 * }} StoredFinding
 */

/**
 * @typedef {{
 *   dismissals: readonly DismissalFact[],
 *   [key: string]: unknown,
 * }} HistoryDismissalsSource
 */

/**
 * @typedef {{
 *   rel: string,
 *   [key: string]: unknown,
 * }} StoredFindingFile
 */

/**
 * A Feature file, as the Feature-level findings are read from it.
 * @typedef {{
 *   rel: string,
 *   data: {
 *     finding?: unknown,
 *     [key: string]: unknown,
 *   },
 *   keyLines: Record<string, number | undefined>,
 *   frontmatterLine: number,
 * }} StoredFindingFeatureFile
 */

/**
 * @typedef {{
 *   key: string,
 *   line: number,
 *   blockLine?: number | null,
 *   keyLines: Record<string, number | undefined>,
 *   data: {
 *     finding?: unknown,
 *     [key: string]: unknown,
 *   },
 *   [key: string]: unknown,
 * }} StoredFindingEntry
 */

/**
 * @param {HistoryDismissalsSource} history
 * @param {StoredFindingFile} file
 * @param {StoredFindingEntry} entry
 * @returns {StoredFinding[]}
 */
export function storedCaseFindings(history, file, entry) {
  const dismissals = history.dismissals.filter((d) => d.file === file.rel && d.key === entry.key);
  return (Array.isArray(entry.data.finding) ? entry.data.finding : []).filter(isMap).map((finding) => {
    // History emits Dismissals in stored order, including findings of other kinds.
    // Pair by occurrence: a kind and pin may match while the supporting Rules differ.
    const dismissal = isMap(finding.dismissed) ? dismissals.shift() : null;
    return { kind: /** @type {string} */ (finding.kind), status: dismissal?.status === "holds" ? "dismissed" : "open",
      evidence: finding.evidence, rests_on: finding.rests_on, file: file.rel, line: entry.keyLines.finding ?? entry.blockLine ?? entry.line };
  });
}

/**
 * The Feature-level findings of a Feature file (ADR-0039), with their dismissal status. The
 * subject is the Rule the finding is about.
 * @param {HistoryDismissalsSource} history
 * @param {StoredFindingFeatureFile} file
 * @returns {StoredFinding[]}
 */
export function storedFeatureFindings(history, file) {
  const dismissals = history.dismissals.filter((d) => d.file === file.rel);
  return (Array.isArray(file.data.finding) ? file.data.finding : []).filter(isMap).map((finding) => {
    // History emits the Dismissals of a Feature's findings in stored order.
    const dismissal = isMap(finding.dismissed) ? dismissals.shift() : null;
    return { kind: /** @type {string} */ (finding.kind), status: dismissal?.status === "holds" ? "dismissed" : "open",
      evidence: finding.evidence, rests_on: finding.rests_on, subject: finding.subject_key ?? finding.rule,
      file: file.rel, line: file.keyLines.finding ?? file.frontmatterLine };
  });
}
