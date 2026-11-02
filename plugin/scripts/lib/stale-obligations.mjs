// @ts-check
// The Stale obligations the Scan raises (ADR-0043): every case that covers an Affected Rule, or
// relies on one (local or foreign), is Stale. No case is read and no judge is asked; the cause is
// the Rules that changed since the Feature's Watermark, found through the Affected Rules fact.
//
// One obligation per (case, cause): a case reached by two changed Rules owes two, so settling one
// leaves the other open. An obligation is identified by the Watermark commit it was taken from and
// the digest of its causes' text at the target, so rescanning the same change finds it already
// stored, and a second edit of the same Rule is a second cause (`cause_digest`).
/** @import { ParsedEntry, ParsedFile } from "./knowledge-file.mjs" */
/** @import { AffectedRulesFacts } from "./affected-rules.mjs" */
import { relianceOf } from "./reliance.mjs";
import { digestOf } from "./pin-digest.mjs";
import { formatRuleRef, parseRuleRef } from "./rule-ref.mjs";

/**
 * One Stale the Scan owes a case, as `history.stale_obligations[]` publishes it.
 * @typedef {{
 *   feature: string,
 *   file: string,
 *   line: number,
 *   key: string,
 *   baseline: string,
 *   target: string | null,
 *   causes: string[],
 *   affects: string[],
 *   cause_digest: string,
 *   via: Array<"covers" | "relies_on">,
 *   stored: boolean,
 * }} StaleObligation
 */

// A Rule as a case names it: its key within its own Feature, else `feature/rule`.
/**
 * @param {string} qualified `feature/rule`
 * @param {string} feature the case's Feature
 * @returns {string}
 */
const spelled = (qualified, feature) => (qualified.startsWith(`${feature}/`) ? qualified.slice(feature.length + 1) : qualified);

/**
 * Whether a case already stores this change: a Stale with the same baseline and cause digest,
 * open or closed.
 * @param {readonly Record<string, unknown>[]} stored
 * @param {string} baseline
 * @param {string} digest
 * @returns {boolean}
 */
const isStored = (stored, baseline, digest) =>
  stored.some((x) => x.kind === "Stale" && x.baseline !== undefined && String(x.baseline) === baseline && x.cause_digest !== undefined && String(x.cause_digest) === digest);

/**
 * The Stale obligations of one Feature's cases.
 * @param {{
 *   feature: string,
 *   affected: AffectedRulesFacts,
 *   cases: ReadonlyArray<{ file: ParsedFile, entry: ParsedEntry }>,
 *   target: string | null,
 *   ruleText: (feature: string, rule: string) => string | undefined,
 *   findingsOf: (entry: ParsedEntry) => Array<Record<string, unknown>>,
 *   lineOf: (entry: ParsedEntry) => number,
 * }} args
 * @returns {StaleObligation[]}
 */
export function staleObligations({ feature, affected, cases, target, ruleText, findingsOf, lineOf }) {
  const baseline = affected.baseline;
  if (baseline === null || affected.rules.length === 0) return [];
  const byRef = new Map(affected.rules.map((r) => [r.ref, r]));
  /** @type {StaleObligation[]} */
  const out = [];
  for (const { file, entry } of cases) {
    /** @type {Map<string, { affects: Set<string>, via: Set<"covers" | "relies_on"> }>} */
    const byCause = new Map();
    /**
     * @param {string} qualified the Affected Rule the case names
     * @param {"covers" | "relies_on"} via
     * @returns {void}
     */
    const touch = (qualified, via) => {
      const rule = byRef.get(qualified);
      if (!rule) return;
      for (const cause of rule.causes) {
        const key = spelled(cause.ref, feature);
        if (!byCause.has(key)) byCause.set(key, { affects: new Set(), via: new Set() });
        const found = /** @type {{ affects: Set<string>, via: Set<"covers" | "relies_on"> }} */ (byCause.get(key));
        found.affects.add(spelled(qualified, feature));
        found.via.add(via);
      }
    };
    const covers = Array.isArray(entry.data.covers) ? entry.data.covers : [];
    for (const key of covers) if (typeof key === "string") touch(`${feature}/${key}`, "covers");
    for (const { ref } of relianceOf(/** @type {import("./knowledge-file.mjs").CaseEntry} */ (entry), feature).refs) touch(formatRuleRef(ref), "relies_on");
    if (byCause.size === 0) continue;

    const stored = findingsOf(entry);
    for (const cause of [...byCause.keys()].sort()) {
      const { affects, via } = /** @type {{ affects: Set<string>, via: Set<"covers" | "relies_on"> }} */ (byCause.get(cause));
      const ref = parseRuleRef(cause) ?? { feature, rule: cause };
      const digest = digestOf([[cause, ruleText(ref.feature, ref.rule) ?? null]]);
      out.push({
        feature,
        file: file.rel,
        line: lineOf(entry),
        key: entry.key,
        baseline,
        target,
        causes: [cause],
        affects: [...affects].sort(),
        cause_digest: digest,
        via: /** @type {Array<"covers" | "relies_on">} */ (["covers", "relies_on"].filter((v) => via.has(/** @type {"covers" | "relies_on"} */ (v)))),
        stored: isStored(stored, baseline, digest),
      });
    }
  }
  return out;
}
