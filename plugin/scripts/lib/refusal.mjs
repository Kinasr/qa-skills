// @ts-check
// Refusal facts and decisions validation shared by the commands.

// The codes every command can print. Its sentences are gone: each one is a code plus facts.
/** @type {readonly string[]} */
export const COMMON = [
  "run_dir",
  "unknown_option",
  "option_needs_value",
  "no_qa_dir",
  "not_feature_key",
  "invalid_decisions",
  "unknown_item",
  "duplicate_decision",
  "bad_value",
  "confirmation_not_pending",
];

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * @param {string} text
 * @returns {{ input: Record<string, unknown> } | { errors: Array<{ code: string }> }}
 */
export function parseDecisions(text) {
  try {
    const input = JSON.parse(text);
    if (object(input)) return { input };
  } catch {}
  return { errors: [{ code: "invalid_decisions" }] };
}

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

/**
 * The decisions JSON one command accepts: its top-level keys, which of those hold lists of item
 * ids, which hold maps of strings, and the keys holding the rejected ids, the per-item answers, the
 * confirmed ids and a whole-card acceptance. `all` names the list key that also takes `"all"`.
 * @typedef {{
 *   keys: readonly string[],
 *   lists: readonly string[],
 *   maps: readonly string[],
 *   drop: string,
 *   edits: string,
 *   confirm: string,
 *   all: string,
 *   allLiteral?: boolean,
 *   maintenance?: boolean,
 *   unknownFirst?: boolean,
 * }} DecisionsShape
 */

/**
 * The decisions read from the agent's JSON, checked against the items the card showed: the shape,
 * the ids, and each edited value. A command's own RefusalKit turns the errors into refusals. The
 * parsed decisions come back even alongside errors, as a command's own reading of them does.
 * @template {DecisionItem} [T=DecisionItem]
 * @param {string} text
 * @param {readonly T[]} items
 * @param {DecisionsShape} shape
 * @param {(item: T, field: string, value: unknown) => unknown} badValue Truthy when the value cannot be written.
 * @returns {{
 *   input: Record<string, unknown>,
 *   take: number[],
 *   drop: number[],
 *   edits: Record<string, Record<string, unknown>>,
 *   confirm: number[],
 *   errors: DecisionError[],
 * }}
 */
export function readDecisions(text, items, { keys, lists, maps, drop: dropKey, edits: editsKey, confirm: confirmKey, all, allLiteral = true, maintenance = false, unknownFirst = false }, badValue) {
  /** @type {{ input: Record<string, unknown>, errors?: never } | { input?: never, errors: DecisionError[] }} */
  const parsed = parseDecisions(text);
  if (parsed.errors) return { input: {}, take: [], drop: [], edits: {}, confirm: [], errors: parsed.errors };
  const { input } = parsed;
  const listed = (/** @type {string} */ key) => input[key] === undefined || Array.isArray(input[key]) || (allLiteral && key === all && input[key] === "all");
  if (Object.keys(input).some((key) => !keys.includes(key)) || !lists.every(listed) || (input[editsKey] !== undefined && !object(input[editsKey]))) return { input, take: [], drop: [], edits: {}, confirm: [], errors: [{ code: "invalid_decisions" }] };
  for (const key of maps) if (input[key] !== undefined && !(object(input[key]) && Object.values(input[key]).every((entry) => typeof entry === "string"))) return { input, take: [], drop: [], edits: {}, confirm: [], errors: [{ code: "bad_value", field: key }] };
  const drop = /** @type {number[]} */ (input[dropKey] ?? []);
  const take = /** @type {number[]} */ (allLiteral && input[all] === "all" ? items.filter((item) => !drop.includes(/** @type {number} */ (item.n))).map((item) => /** @type {number} */ (item.n)) : input[all] ?? []);
  const edits = /** @type {Record<string, Record<string, unknown>>} */ (input[editsKey] ?? {});
  const confirm = /** @type {number[]} */ (input[confirmKey] ?? []);
  const errors = validateEdits(items, take, drop, edits, { confirm, maintenance, unknownFirst, badValue });
  return { input, take, drop, edits, confirm, errors };
}

/**
 * @typedef {{
 *   code: string,
 *   reason?: string,
 *   at_line?: number | string,
 *   [key: string]: unknown,
 * }} RefusalFact
 */

/**
 * @typedef {{
 *   exit: number,
 *   json: {
 *     ok: false,
 *     refusals: RefusalFact[],
 *     [key: string]: unknown,
 *   },
 * }} RefusalResult
 */

/**
 * @typedef {{
 *   fact: (code: string, data?: Record<string, unknown> & { message?: string, line?: number | string }) => RefusalFact,
 *   refuse: (code: string, data?: Record<string, unknown> & { message?: string, line?: number | string }, exit?: number) => RefusalResult,
 *   stop: (code: string, data?: Record<string, unknown> & { message?: string, line?: number | string }) => RefusalResult,
 *   refusalOf: (item: { code: string, [key: string]: unknown }) => RefusalFact,
 * }} Refusals
 */

/**
 * @typedef {Refusals} RefusalKit
 */

/**
 * Builds a command's refusals from a code and its facts. There is one way: no sentence is looked
 * up and no `line` is written, so the skill words the refusal from the code and facts.
 * @param {(code: string, data: Record<string, unknown>) => Record<string, unknown>} [details]
 * @returns {Refusals}
 */
export function refusalsWithoutLines(details = (code, data) => data) {
  /**
   * @param {string} code
   * @param {Record<string, unknown> & { message?: string, line?: number | string }} [param1]
   * @returns {RefusalFact}
   */
  const fact = (code, { message: _message, line: at_line, ...data } = {}) => ({
    code,
    ...details(code, data),
    ...(at_line !== undefined && { at_line }),
  });
  /**
   * @param {string} code
   * @param {Record<string, unknown> & { message?: string, line?: number | string }} [data]
   * @param {number} [exit]
   * @returns {RefusalResult}
   */
  const refuse = (code, data = {}, exit = 2) => ({ exit, json: { ok: false, refusals: [fact(code, data)] } });
  // A refusal of a call that was well formed, which only the state of a Run turned down: exit 1.
  /**
   * @param {string} code
   * @param {Record<string, unknown> & { message?: string, line?: number | string }} [data]
   * @returns {RefusalResult}
   */
  const stop = (code, data = {}) => refuse(code, data, 1);
  return { fact, refuse, stop, refusalOf: ({ code, ...data }) => fact(code, data) };
}

export const { fact, refuse } = refusalsWithoutLines();
