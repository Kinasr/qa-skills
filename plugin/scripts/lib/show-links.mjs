// @ts-check
// Link slot: Reliance from the reverse Reliance index and both Dependency directions from the
// Rule-dependency index, both built on the full acquisition index so cross-Feature links survive a
// scoped view. Nothing reverse is stored; the indexes are built once per acquisition.
/** @import {ShowInventoryEntry} from './show-acquisition.mjs' */
/** @import {ScanAcquisition} from './scan.mjs' */
import { casesCoveringRule } from './rule-coverage.mjs';
import { reverseReliance } from './reliance.mjs';
import { dependencyEnds, dependencyIndex, formatRuleRef } from './rule-ref.mjs';

/**
 * One case that rests on a Rule, as the reverse Reliance index yields it.
 * @typedef {{
 *   feature: string,
 *   case: string,
 *   file: import('./knowledge-file.mjs').ParsedFile,
 * }} RelianceUse
 */

/**
 * The two reverse indexes, shared by every Feature of one acquisition.
 * @typedef {{
 *   reliance: Map<string, RelianceUse[]>,
 *   dependencies: ReturnType<typeof dependencyIndex>,
 * }} LinkIndexes
 */

/** @type {WeakMap<ScanAcquisition, LinkIndexes>} */
const linkIndexes = new WeakMap();

/**
 * @param {ScanAcquisition} acquisition
 * @returns {LinkIndexes}
 */
function indexesOf(acquisition) {
  let indexes = linkIndexes.get(acquisition);
  if (!indexes) {
    indexes = {
      reliance: reverseReliance(acquisition.index),
      dependencies: dependencyIndex(acquisition.index, acquisition.files),
    };
    linkIndexes.set(acquisition, indexes);
  }
  return indexes;
}

/**
 * A relying case's summary, read from the file that declares it rather than the page projection, so
 * a cross-Feature case still has one in a scoped view.
 * @param {RelianceUse} use
 * @returns {string}
 */
function relianceSummary(use) {
  return use.file.cases?.find(entry => entry.key === use.case)?.summary ?? use.case;
}

/**
 * @param {import('./rule-ref.mjs').RuleRef[]} refs
 * @param {ScanAcquisition} acquisition
 * @returns {import('./page.d.mts').ShowRuleLink[]}
 */
function dependencyLinks(refs, acquisition) {
  return dependencyEnds(acquisition.index, acquisition.files, refs)
    .map(end => ({ feature: end.feature, key: end.rule, summary: end.statement }));
}

/**
 * @param {ShowInventoryEntry} feature
 * @param {ScanAcquisition} acquisition
 * @returns {import('./page.d.mts').ShowLinksSection}
 */
export function showLinks(feature, acquisition) {
  const { reliance, dependencies } = indexesOf(acquisition);
  /** @type {Record<string, import('./page.d.mts').ShowLinksSection['rules'][string]>} */
  const rules = {};
  for (const rule of feature.featureFile?.rules ?? []) {
    const ref = { feature: feature.key, rule: rule.key };
    /** @type {Map<string, import('./page.d.mts').ShowRuleLink>} */
    const relied = new Map();
    for (const use of reliance.get(formatRuleRef(ref)) ?? []) {
      const key = `${use.feature}/${use.case}`;
      if (!relied.has(key)) relied.set(key, { feature: use.feature, key: use.case, summary: relianceSummary(use) });
    }
    rules[rule.key] = {
      covers: casesCoveringRule(acquisition.index, feature.key, rule.key).map(declaration => declaration.entry.key),
      relied_on_by: [...relied.values()],
      dependencies: dependencyLinks(dependencies.upstreamOf(feature.key, rule.key), acquisition),
      dependents: dependencyLinks(dependencies.dependentsOf(feature.key, rule.key), acquisition),
    };
  }
  return { rules };
}
