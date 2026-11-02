// @ts-check
// The settlement's check of the forecast (ADR-0043). The selection widens to the whole Feature for a
// widened Rule, which only the engineer can say, and the engineer says it in the run dir's
// `change.json`. A run dir that is fresh, lost or from another clone says nothing, and the selection
// would be narrower with no sound. So `impact plan --persist`, which the Watermark follows, takes a
// Feature only when each Rule whose statement was edited since that Watermark has a forecast in the
// run dir for the statement it has now.
//
// It does not ask where the selection is the whole Feature already (a first assessment, a new Rule, a
// Boundary change), nor of an edit that touches only a Rule's elaboration, Waiver or Dependency,
// which the links still reach.
// Below schema 3 (`SUITE_KEYS_SCHEMA_VERSION`) it asks nothing: nothing can record a forecast there, so persist is as before.
/** @import { ChangeData } from "./change-data.mjs" */
/** @import { KeyIndex } from "./qa-index.mjs" */
/** @import { FeatureSummary } from "./scan-history.mjs" */
import { statementEdits, statementOf } from "./affected-rules.mjs";
import { forecastCovers } from "./change-data.mjs";
import { rootConfig } from "./qa-index.mjs";
import { needsJudgement } from "./scan-history.mjs";
import { SUITE_KEYS_SCHEMA_VERSION } from "./schema.mjs";

// The Rules the plan has no forecast for, qualified `feature/rule`, in order. `root` is the `.qa/`
// directory, whose `project.md` declares the schema.
/**
 * @param {{
 *   root: string,
 *   features: readonly Pick<FeatureSummary, "feature" | "class" | "affected_rules">[],
 *   index: KeyIndex,
 *   change: ChangeData | null | undefined,
 * }} input `index` is the knowledge the plan judges
 * @returns {string[]}
 */
export function unforecastRules({ root, features, index, change }) {
  if (rootConfig(root).schemaVersion < SUITE_KEYS_SCHEMA_VERSION) return [];
  /** @type {string[]} */
  const out = [];
  for (const { feature, class: classification, affected_rules: affected } of features) {
    if (!needsJudgement(classification) || affected.widen.length) continue;
    for (const rule of statementEdits(affected, feature)) {
      if (!forecastCovers(change, feature, rule, statementOf(index, feature, rule))) out.push(`${feature}/${rule}`);
    }
  }
  return out.sort();
}
