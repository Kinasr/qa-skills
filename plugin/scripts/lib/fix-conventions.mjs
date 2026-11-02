// @ts-check
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { liveRefs } from './codegen-refs.mjs';
/** @import { TrainFile } from './training.mjs' */
/** @import { ParsedEntry } from './knowledge-file.mjs' */
/** @param {TrainFile | null} train @param {string} repo @param {string[]} roots @returns {string} */
export function fixConventions(train, repo, roots) {
  if (!train) return '(none)';
  const resolves = (/** @type {string} */ ref) => {
    try {
      const real = realpathSync(resolve(repo, ref));
      return roots.some(root => {
        const path = relative(realpathSync(resolve(repo, root)), real);
        return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
      });
    } catch { return false; }
  };
  const lines = train.text.replace(/\r\n/g, '\n').split('\n');
  const entries = /** @type {ParsedEntry[]} */ (train.conventions ?? []);
  if (!entries.length) return '(none)';
  return entries.map(entry => {
    const chunk = lines.slice(entry.line - 1, entry.end);
    if (entry.keyLines.refs !== undefined) {
      const at = entry.keyLines.refs - entry.line;
      let end = at + 1;
      while (end < chunk.length && /^\s+-\s/.test(chunk[end])) end++;
      chunk.splice(at, end - at, `refs: ${JSON.stringify(liveRefs(/** @type {string[]} */ (entry.data.refs), resolves))}`);
    }
    return chunk.join('\n');
  }).join('\n\n');
}
