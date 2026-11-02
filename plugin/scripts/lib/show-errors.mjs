// @ts-check
// Error presentation slot. Placement is by path, including unreadable files.
/** @import {ShowErrorsSection} from './page.d.mts' */
/** @import {ShowInventoryEntry} from './show-acquisition.mjs' */
/** @import {ScanAcquisition} from './scan.mjs' */
/**
 * @param {ShowInventoryEntry | null} feature null selects project/train errors
 * @param {ScanAcquisition} acquisition
 * @returns {ShowErrorsSection}
 */
export function showErrors(feature, { allResults }) {
  const paths = new Set(feature?.files.map(f => f.rel) ?? []);
  return { rows: allResults.filter(r => r.kind === 'integrity_error' && (feature ? paths.has(r.file ?? '') : !r.file?.startsWith('features/'))) };
}
