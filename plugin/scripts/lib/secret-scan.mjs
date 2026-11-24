// @ts-check
// The credential and sensitive-literal scan shared by code gen and code fix (ADR-0057, Enforced):
// nothing the CLI commits or pushes may add a credential, so both callers scan the same added
// lines with the same two checks.
import { credentialIn } from "./credentials.mjs";
import { hasSensitiveLiteralValue } from "./sensitive-literals.mjs";

/**
 * One edited path as the scan sees it: its content before the item (`null` when new) and after it
 * (`null` when deleted).
 * @typedef {{
 *   path: string,
 *   before: string | null,
 *   after: string | null,
 * }} ScannedEdit
 */

// The cell budget of the line diff over an edit's changed span; past it, the whole span counts as
// added, which can only refuse more.
const DIFF_BUDGET = 4_000_000;

/**
 * The line numbers (1-based) an edit added: a new file adds every line; an edited file adds the
 * lines of its changed span that a longest-common-subsequence diff does not keep from before, so
 * an unchanged line between two edits is not added.
 * @param {string | null} before
 * @param {string} after
 * @returns {Set<number>}
 */
function addedLines(before, after) {
  const a = after.split("\n");
  if (before === null) return new Set(a.map((_, i) => i + 1));
  const b = before.split("\n");
  let prefix = 0;
  while (prefix < b.length && prefix < a.length && b[prefix] === a[prefix]) prefix++;
  let suffix = 0;
  while (suffix < b.length - prefix && suffix < a.length - prefix && b[b.length - 1 - suffix] === a[a.length - 1 - suffix]) suffix++;
  const old = b.slice(prefix, b.length - suffix);
  const now = a.slice(prefix, a.length - suffix);
  /** @type {Set<number>} */
  const out = new Set();
  if ((old.length + 1) * (now.length + 1) > DIFF_BUDGET) {
    for (let i = 0; i < now.length; i++) out.add(prefix + i + 1);
    return out;
  }
  // lcs[i][j]: the longest common subsequence of old[i..] and now[j..].
  const lcs = Array.from({ length: old.length + 1 }, () => new Uint32Array(now.length + 1));
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = now.length - 1; j >= 0; j--) {
      lcs[i][j] = old[i] === now[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (j < now.length) {
    if (i < old.length && old[i] === now[j]) {
      i++;
      j++;
    } else if (i < old.length && lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++;
    } else {
      out.add(prefix + j + 1);
      j++;
    }
  }
  return out;
}

/**
 * The first line an edit added that looks like a credential or a sensitive literal, or null.
 * @param {readonly ScannedEdit[]} edits
 * @returns {{ path: string, at_line: number } | null}
 */
export function addedCredential(edits) {
  for (const edit of edits) {
    if (edit.after === null) continue;
    const lines = edit.after.split("\n");
    for (const line of addedLines(edit.before, edit.after)) {
      const text = lines[line - 1] ?? "";
      if (credentialIn(text) || hasSensitiveLiteralValue(text)) return { path: edit.path, at_line: line };
    }
  }
  return null;
}
