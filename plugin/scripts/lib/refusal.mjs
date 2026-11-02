// @ts-check
// Refusal facts and JSON-object validation shared by the commands.

/** @type {Record<string, string>} */
export const COMMON = {
  run_dir: "The run directory cannot be used.",
  unknown_option: "The option is not one this step takes.",
  option_needs_value: "The option has no value.",
  no_qa_dir: "The knowledge directory does not exist.",
  not_feature_key: "The value is not a Feature key: lower-case letters and digits joined by single hyphens.",
  invalid_decisions: "The decisions are not a JSON object of the allowed keys.",
  unknown_item: "The decision names an item absent from what was shown.",
  duplicate_decision: "An item is answered more than once.",
  bad_value: "The answer has the wrong JSON type or an unwritable value.",
  confirmation_not_pending: "The confirmation does not match one pending in this run directory."
};

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
 * @typedef {{
 *   code: string,
 *   line?: string,
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

// Each command supplies only its own facts; shared codes always use the common line.
/**
 * @param {Record<string, string>} [lines]
 * @param {(code: string, data: Record<string, unknown>) => Record<string, unknown>} [details]
 * @returns {Refusals}
 */
export function refusalsFor(lines = {}, details = (code, data) => data) {
  /**
   * @param {string} code
   * @param {Record<string, unknown> & { message?: string, line?: number | string }} [param1]
   * @returns {RefusalFact}
   */
  const fact = (code, { message, line: at_line, ...data } = {}) => ({
    code, line: COMMON[code] ?? lines[code],
    ...details(code, data), ...(at_line !== undefined && { at_line }),
    ...(["run_dir", "annotation"].includes(code) && message && { reason: message }),
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

export const { fact, refuse } = refusalsFor();
