// @ts-check
// Run data the judge's selection reads (ADR-0043): `change.json` in a run dir, which the caller
// names with `--dir`. It carries what no link can say by itself:
//   widened    Rules the engineer confirmed as widened during the forecast (never inferred);
//   forecast   the engineer's confirmed forecast of each Rule whose statement was edited since the
//              Watermark, widened or not, with the statement it was given against, so the settlement
//              can tell a forecast edit from one nobody forecast;
//   escalated  cases `/qa-ask` sent to the judge.
// `{"v": 2, "widened": [{"feature", "rule", "by", "at"}], "forecast": [{"feature", "rule", "widened",
// "statement", "by", "at"}], "escalated": [{"feature", "case", "rules", "by", "at"}]}`.
// `v` 2 is the shape that records every forecast. A file of `v` 1, or none, holds `widened` Rules
// only, and each still means what it meant: the engineer widened that Rule. A file that is not JSON
// is a usage error (`readRunFile`); a key or an entry this reader does not know is a note and never a
// refusal, so a later writer's data never stops a run.
import { readRunFile } from "./run-dir.mjs";

/**
 * What the selection takes from Run data.
 * @typedef {{
 *   v: number,
 *   widened: Array<{ feature: string, rule: string }>,
 *   forecast: Array<{ feature: string, rule: string, widened: boolean, statement: string }>,
 *   escalated: Array<{ feature: string, case: string }>,
 *   notes: Array<{ code: "change_data_unknown", key: string, reason: string }>,
 * }} ChangeData
 */

/** @type {string} */
export const CHANGE_FILE = "change.json";

// The first `v` that records every forecast under `forecast`.
/** @type {number} */
export const FORECAST_SHAPE = 2;

/** @returns {ChangeData} */
const empty = () => ({ v: 0, widened: [], forecast: [], escalated: [], notes: [] });

/** @param {unknown} x */
const isMap = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

// Reads one parsed `change.json` value.
/**
 * @param {unknown} value
 * @returns {ChangeData}
 */
export function changeData(value) {
  const out = empty();
  if (value === null || value === undefined) return out;
  if (!isMap(value)) {
    out.notes.push({ code: "change_data_unknown", key: "(file)", reason: "not_an_object" });
    return out;
  }
  const data = /** @type {Record<string, unknown>} */ (value);
  for (const key of Object.keys(data)) {
    if (!["v", "widened", "forecast", "escalated"].includes(key)) out.notes.push({ code: "change_data_unknown", key, reason: "unknown_key" });
  }
  if (typeof data.v === "number") out.v = data.v;
  /**
   * @param {"widened" | "forecast" | "escalated"} key
   * @param {(entry: Record<string, unknown>) => boolean} take adds the entry, or says it is not one
   */
  const entries = (key, take) => {
    const list = data[key];
    if (list === undefined) return;
    if (!Array.isArray(list)) {
      out.notes.push({ code: "change_data_unknown", key, reason: "not_a_list" });
      return;
    }
    for (const x of list) if (!(isMap(x) && take(/** @type {Record<string, unknown>} */ (x)))) out.notes.push({ code: "change_data_unknown", key, reason: "bad_entry" });
  };
  entries("widened", (e) => {
    if (typeof e.feature !== "string" || typeof e.rule !== "string") return false;
    out.widened.push({ feature: e.feature, rule: e.rule });
    return true;
  });
  entries("forecast", (e) => {
    if (typeof e.feature !== "string" || typeof e.rule !== "string" || typeof e.widened !== "boolean" || typeof e.statement !== "string") return false;
    out.forecast.push({ feature: e.feature, rule: e.rule, widened: e.widened, statement: e.statement });
    return true;
  });
  entries("escalated", (e) => {
    if (typeof e.feature !== "string" || typeof e.case !== "string") return false;
    out.escalated.push({ feature: e.feature, case: e.case });
    return true;
  });
  return out;
}

// Whether the forecast the run dir holds covers a Rule whose statement was edited: an entry names the
// Rule at the statement it has now, so an edit made after the forecast is not covered. A file of the
// old shape (`v` below 2) has no such entry, and its widened Rule is covered as it always was.
/**
 * @param {ChangeData | null | undefined} change
 * @param {string} feature
 * @param {string} rule
 * @param {string | null} statement the Rule's statement now, null when it has none
 * @returns {boolean}
 */
export function forecastCovers(change, feature, rule, statement) {
  if (!change) return false;
  if (change.forecast.some((e) => e.feature === feature && e.rule === rule && e.statement === statement)) return true;
  return change.v < FORECAST_SHAPE && change.widened.some((w) => w.feature === feature && w.rule === rule);
}

// The run dir's `change.json`: `{data}` (empty when the file is absent), or the usage error.
/**
 * @param {string} dir
 * @returns {{ data: ChangeData, error?: undefined } | { error: string, data?: undefined }}
 */
export function readChange(dir) {
  const read = readRunFile(dir, CHANGE_FILE, { by: ["deep-dive", "impact escalate"], restart: "impact plan" });
  return read.error ? { error: read.error } : { data: changeData(read.value) };
}
