// @ts-check
// Coverage, prose sections and legend slot, backed by existing domain predicates.
import { parseDeferred } from './deferred.mjs';
import { parkedQuestions } from './parked-questions.mjs';
import { parseCoverage, coverageDue } from './coverage.mjs';
import { CATEGORIES_TRAIN_KEY, effectiveCategoriesFromText } from './categories.mjs';
/** @import {ShowKnowledgeSection} from './page.d.mts' */
/** @import {ShowInventoryEntry} from './show-acquisition.mjs' */
/** @import {ScanAcquisition} from './scan.mjs' */
/**
 * @param {ShowInventoryEntry} feature
 * @param {ScanAcquisition} acquisition
 * @returns {ShowKnowledgeSection}
 */
export function showKnowledge(feature, acquisition) {
  const file = feature.featureFile;
  // The working-tree text the scan read, resolved exactly as /qa-next resolves it from disk.
  const categoriesFile = acquisition.files.find(f => f.rel === `train/${CATEGORIES_TRAIN_KEY}.md`);
  const effective = effectiveCategoriesFromText(categoriesFile && 'text' in categoriesFile ? categoriesFile.text ?? null : null);
  const coverage = file ? parseCoverage(file.text) : null;
  // The list and its count come from the same predicate, so they cannot disagree.
  const deferred = file ? parseDeferred(file.text) : [];
  const parked = file ? parkedQuestions(file) : [];
  return {
    deferred,
    parked,
    boundaries: file?.boundaries ?? [],
    waivers: (file?.rules ?? []).filter(r => r.waiver !== null).map(r => ({ key: r.key, reason: /** @type {string} */ (r.waiver), elaboration: r.elaboration })),
    coverage: coverage && { ...coverage, problems: coverage.problems.map(({ line, ...problem }) => ({ ...problem, ...(line == null ? {} : { line }) })) }, coverage_due: file ? coverageDue(file, effective) : null, deferred_count: deferred.length, parked_count: parked.length,
  };
}
