// @ts-check
// Selection ids and editable fields checked against the items actually shown.
import { object } from "./refusal.mjs";

/**
 * An item subject to selection or editing in a card.
 * @typedef {{
 *   n?: number | string,
 *   edits?: readonly string[],
 *   [key: string]: unknown,
 * }} DecisionItem
 */

/**
 * An error produced during decisions validation.
 * @typedef {{
 *   code: string,
 *   item?: number | string,
 *   field?: string,
 *   reason?: string,
 * }} DecisionError
 */

/**
 * Options for validateEdits.
 * @template {DecisionItem} [T=DecisionItem]
 * @typedef {{
 *   confirm?: readonly number[],
 *   maintenance?: boolean,
 *   unknownFirst?: boolean,
 *   badValue: (item: T, field: string, value: unknown) => unknown,
 * }} ValidateEditsOptions
 */

/**
 * @template {DecisionItem} [T=DecisionItem]
 * @param {readonly T[]} items
 * @param {number[]} take
 * @param {readonly number[]} drop
 * @param {Record<string, unknown>} edits
 * @param {ValidateEditsOptions<T>} options
 * @returns {DecisionError[]}
 */
export function validateEdits(items, take, drop, edits, { confirm = [], maintenance = false, unknownFirst = false, badValue }) {
  /** @type {DecisionError[]} */
  const errors = [];
  const known = new Map(items.map((item) => [item.n, item]));
  const selected = [...take, ...drop];
  const unknown = (/** @type {unknown} */ n) => !Number.isSafeInteger(n) || !known.has(/** @type {number} */ (n));
  const duplicate = (/** @type {unknown} */ n) => selected.filter((value) => value === n).length > 1;
  if (unknownFirst) for (const n of [...selected, ...confirm]) if (unknown(n)) errors.push({ code: "unknown_item", item: n });
  for (const n of selected) {
    if (unknown(n)) { if (!unknownFirst) errors.push({ code: "unknown_item", item: n }); }
    else if (duplicate(n)) errors.push({ code: "duplicate_decision", item: n });
  }
  if (!unknownFirst) for (const n of confirm) if (unknown(n)) errors.push({ code: "unknown_item", item: n });
  for (const [key, fields] of Object.entries(edits)) {
    const n = Number(key), item = known.get(n);
    if (!/^[1-9]\d*$/.test(key) || !item) { errors.push({ code: "unknown_item", item: key }); continue; }
    if (drop.includes(n)) errors.push({ code: "edit_dropped", item: n });
    if (maintenance && take.includes(n)) errors.push({ code: "duplicate_decision", item: n });
    if (!object(fields)) { errors.push({ code: "bad_value", item: n }); continue; }
    for (const [field, value] of Object.entries(/** @type {Record<string, unknown>} */ (fields))) {
      if (!item.edits?.includes(field)) { errors.push({ code: "edit_field", item: n, field }); continue; }
      const problem = badValue(item, field, value);
      if (problem) errors.push({ code: "bad_value", item: n, field, ...(typeof problem === "string" && { reason: problem }) });
    }
    if (!maintenance && !take.includes(n) && !drop.includes(n)) take.push(n);
  }
  return errors;
}
