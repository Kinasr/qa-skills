// @ts-check
// Scenario/Case projection slot. Raw fields are retained without re-parsing; the canonical
// binding enumeration is projected beside them for filtering and labels.
import { caseLevels } from './case-fields.mjs';
/** @import {ShowScenariosSection} from './page.d.mts' */
/** @import {ShowInventoryEntry} from './show-acquisition.mjs' */
/** @import {ScanAcquisition} from './scan.mjs' */
/**
 * @param {ShowInventoryEntry} feature
 * @param {ScanAcquisition} acquisition
 * @returns {ShowScenariosSection}
 */
export function showScenarios(feature, acquisition) {
  const { schemaVersion } = acquisition.config;
  return { rows: Object.fromEntries(feature.files.filter(/** @returns {file is import('./knowledge-file.mjs').ParsedFile} */ (file) => !file.unreadable && file.type === 'scenario').map(file => {
    // A Scenario whose frontmatter cannot name its key is still shown, under its path.
    const key = typeof file.data.key === 'string' ? file.data.key : file.rel;
    return [key, {
    key, title: file.h1?.text ?? key, file: file.rel, data: file.data,
    cases: Object.fromEntries(file.cases.map(entry => [entry.key, { key: entry.key, title: entry.summary, line: entry.line, levels: caseLevels(entry.data, file.data, schemaVersion), data: entry.data, sections: entry.sections }])),
  }]; })) };
}
