// @ts-check
// Path ownership survives broken frontmatter. Cross-Feature lookups use this full acquisition.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PATTERN } from './keys.mjs';
import { frontmatterReadable } from './knowledge-file.mjs';
/** @import {ScanAcquisition} from './scan.mjs' */
/** @import {QaFile, ParsedFile} from './knowledge-file.mjs' */
/** @typedef {{key: string, files: QaFile[], featureFile: ParsedFile | null}} ShowInventoryEntry */
/**
 * @param {string} root
 * @param {ScanAcquisition} acquisition
 * @returns {Readonly<Record<string, ShowInventoryEntry>>}
 */
export function showInventory(root, { files }) {
  /** @type {Record<string, ShowInventoryEntry>} */
  const inventory = Object.create(null);
  // Empty Feature directories also exist, as for scan's command seam.
  try {
    for (const dir of readdirSync(join(root, 'features'), { withFileTypes: true })) {
      if (dir.isDirectory() && PATTERN.slug.test(dir.name)) inventory[dir.name] = { key: dir.name, files: [], featureFile: null };
    }
  } catch { /* A missing features/ directory is an empty inventory. */ }
  for (const file of files) {
    const key = file.rel.match(/^features\/([^/]+)\//)?.[1];
    if (!key || !PATTERN.slug.test(key)) continue;
    inventory[key] ??= { key, files: [], featureFile: null };
    inventory[key].files.push(file);
    if (file.type === 'feature' && frontmatterReadable(file) && !inventory[key].featureFile) inventory[key].featureFile = file;
  }
  return inventory;
}
