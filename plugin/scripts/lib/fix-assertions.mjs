// @ts-check
// Semantic guard over the assertion descriptions owned by each stack. A matcher or dynamic
// expected expression cannot change, its actual value cannot become the expected one (a check of a
// value against itself), and a new literal needs a quoted, route-allowed source.
/** @import { StackAdapter } from './stack.mjs' */
/** @import { GuardEdit } from './edit-guard.mjs' */
/** @import { RefusalFact } from './refusal.mjs' */
/** @typedef {{ matcher: string, expected: string, literals: string[], constant: boolean, same: boolean }} AssertionContract */
/** @param {{ adapter: StackAdapter | null, edits: GuardEdit[], sources: string[], summary: string, reduced: boolean }} input @returns {RefusalFact[]} */
export function checkFixAssertions({ adapter, edits, sources, summary, reduced }) {
  /** @type {RefusalFact[]} */
  const refusals = [];
  if (!adapter) return refusals; // checkEdits reports no_adapter.
  for (const edit of edits) {
    const before = adapter.guard.contracts(edit.before ?? '');
    const after = adapter.guard.contracts(edit.after ?? '');
    for (const [i, was] of before.entries()) {
      // A removed duplicate may be consolidated, but its outcome contract must still survive.
      if (reduced && after.some(now => now.matcher === was.matcher && now.expected === was.expected && JSON.stringify(now.literals) === JSON.stringify(was.literals) && !now.constant && (!now.same || was.same))) continue;
      const now = after[i];
      // Only an edit that makes a check tautological is refused; one that already was is left alone.
      if (!now || now.matcher !== was.matcher || now.constant || (now.same && !was.same) || now.expected !== was.expected) {
        refusals.push({ code: 'assertion_changed', path: edit.path, message: 'Preserve the assertion matcher, dynamic expected expression and final outcome check.' });
        continue;
      }
      for (const value of now.literals.filter((value, n) => value !== was.literals[n])) {
        if (!value || !summary.includes(value) || !sources.some(source => source.includes(value) && summary.includes(source.trim()))) refusals.push({ code: 'literal_source', path: edit.path, message: 'Quote the pinned Expected-result paragraph or the route-allowed Passed Execution evidence in the summary.' });
      }
    }
  }
  return refusals;
}
