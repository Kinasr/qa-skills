// @ts-check
// Byte-offset edits to one text, the write side every stack adapter shares (lib/stack.mjs).

/**
 * An edit at a byte offset within a text: `del` characters at offset `at` replaced by `ins`.
 * @typedef {{
 *   at: number,
 *   del: number,
 *   ins: string,
 * }} SpliceEdit
 */

// `text` with each edit `{at, del, ins}` applied: `del` characters at offset `at` of the original
// text replaced by `ins`. Edits at one offset land in the order given. Overlapping edits throw: an
// adapter that makes one has two writes it has not reconciled.
/**
 * @param {string} text
 * @param {readonly SpliceEdit[]} edits
 * @returns {string}
 */
export function splice(text, edits) {
  const order = edits.map((e, i) => ({ ...e, i })).sort((a, b) => a.at - b.at || a.i - b.i);
  let out = "";
  let pos = 0;
  for (const e of order) {
    if (e.at < pos) throw new Error(`overlapping edits at offset ${e.at}`);
    out += text.slice(pos, e.at) + e.ins;
    pos = e.at + e.del;
  }
  return out + text.slice(pos);
}
