// @ts-check
// A Rule fix on the walk (ADR-0043): the engineer's fix to a Rule goes through deep-dive's Rule-edit
// transition (`reconcile`, rule-edit.mjs), and every settled cause that rests on the fixed Rule is
// reopened. This module holds the two questions the settle engine (settle-walk.mjs) asks about it:
//   - `reopenable`: which closed mechanical Stale causes rest on a fixed Rule, so the walk offers
//     them again;
//   - `editedSincePersist`: which Rules reaching a Feature changed between the commit `persist`
//     judged and HEAD, so checkpoint 2 can tell an edit the transition rechecked from one it did not.
// A cause "rests on" a Rule when the Stale names it (`causes`, `affects`) or its case covers or
// relies on it: the same list a Dismissal re-arms on.
/** @import { ParsedFile } from "./knowledge-file.mjs" */
/** @import { AffectedSnapshot } from "./affected-rules.mjs" */
import { affectedRules } from "./affected-rules.mjs";
import { isMap } from "./dialect.mjs";
import { relianceOf } from "./reliance.mjs";
import { changedRuleKeys } from "./rule-diff.mjs";
import { dependencyIndex, parseRuleRef } from "./rule-ref.mjs";
import { refusalsFor } from "./refusal.mjs";
import { causeRefs, isOpenFinding, isStaleObligation } from "./stored-findings.mjs";

/** @type {Record<string, string>} */
export const RULE_FIX_REFUSALS = {
  rule_fix_arguments: "`rule-fix` takes the one Feature whose Rules the engineer fixed, as `rule-fix <feature> --dir <run-dir> --stdin`.",
  no_feature: "No such Feature: a Rule fix follows the Rule edits of an existing Feature.",
  no_rule_edit: "The Feature's Rules in the working tree do not differ from HEAD: edit the Rule first and run `rule-fix` before committing it (the Scan owes a Stale for a Rule edit already committed once `impact plan --persist` runs again).",
  rules_edited_since_persist: "Rules reaching a Feature of this run were edited and committed after `persist`, without the Rule fix: checkpoint 2 would certify them unchecked. Run `impact plan --persist` again so the Scan stores the Stale they owe, or revert the edit.",
};
export const { refuse: ruleFixRefuse } = refusalsFor(RULE_FIX_REFUSALS);

/** `<feature>/<rule>` for a Rule ref as a case of `feature` writes it (a local key or already qualified). */
/**
 * @param {string} text
 * @param {string} feature the Feature of the case that writes the ref
 * @returns {string}
 */
const qualified = (text, feature) => {
  const ref = parseRuleRef(text);
  return ref ? `${ref.feature}/${ref.rule}` : `${feature}/${text}`;
};

/**
 * A stored mechanical Stale that is closed (held or dismissed) and rests on a fixed Rule.
 * @typedef {object} Reopenable
 * @property {string} file the scenario file, relative to the root
 * @property {string} feature
 * @property {string} case the Test Case's Key
 * @property {"holds" | "dismissed"} was how the cause was closed
 * @property {string[]} rules the fixed Rules (`<feature>/<rule>`) it rests on
 * @property {number} index its place in the case's `finding` list
 */

/**
 * The closed mechanical Stale causes that rest on one of `fixed` (`<feature>/<rule>` refs).
 * @param {readonly ParsedFile[]} files
 * @param {(file: ParsedFile) => string | null} featureOf
 * @param {ReadonlySet<string>} fixed
 * @returns {Reopenable[]}
 */
export function reopenable(files, featureOf, fixed) {
  /** @type {Reopenable[]} */
  const out = [];
  for (const file of files) {
    if ("unreadable" in file && file.unreadable) continue;
    if (file.type !== "scenario") continue;
    const feature = featureOf(file);
    if (feature === null) continue;
    for (const entry of file.cases) {
      const list = Array.isArray(entry.data.finding) ? entry.data.finding : [];
      const covers = Array.isArray(entry.data.covers) ? entry.data.covers.filter((k) => typeof k === "string") : [];
      const relies = relianceOf(entry, feature).refs.map((r) => r.text);
      list.forEach((finding, index) => {
        if (!isMap(finding) || !isStaleObligation(finding) || isOpenFinding(finding)) return;
        const rests = new Set([...causeRefs(finding), ...covers, ...relies].map((r) => qualified(r, feature)));
        const rules = [...fixed].filter((r) => rests.has(r)).sort();
        if (rules.length === 0) return;
        out.push({ file: file.rel, feature, case: entry.key, was: isMap(finding.holds) ? "holds" : "dismissed", rules, index });
      });
    }
  }
  return out;
}

/**
 * Whether two sets of parsed files hold the same Rule texts for one Feature.
 * @param {AffectedSnapshot} then
 * @param {AffectedSnapshot} now
 * @param {string} feature
 * @returns {string[]} the Rules (`<feature>/<rule>`) of `feature` that changed, were added or retired
 */
const ownChanged = (then, now, feature) => changedRuleKeys(then.rules(feature), now.rules(feature)).map((k) => `${feature}/${k}`);

/**
 * The Rules reaching `feature` whose text differs between `then` (the commit `persist` judged) and
 * `now`: its own, the Upstream Rules it rests on, and the Rules added since.
 * @param {AffectedSnapshot} then
 * @param {AffectedSnapshot} now
 * @param {string} feature
 * @param {string} baseline
 * @returns {string[]}
 */
export function editedSincePersist(then, now, feature, baseline) {
  const target = dependencyIndex(now.index, now.files);
  const facts = affectedRules({ then, now, feature, baseline, target });
  const refs = new Set(ownChanged(then, now, feature));
  for (const rule of facts.rules) for (const cause of rule.causes) refs.add(cause.ref);
  for (const key of facts.new_rules) refs.add(`${feature}/${key}`);
  return [...refs].sort();
}
