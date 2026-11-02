// @ts-check
// Element evidence in the Execution record: ingest writes an Execution's evidence as one folded block
// right after its **Trace.** list (`evidenceBlockLines`), a `json` fence keyed by the Trace numbers
// of the calls that carry it. `check-file` recognises the block by `EVIDENCE_SUMMARY` and checks each
// value with `isExecutionEvidence`. Pure, so `check-file` can reach it without reaching a module that
// reads `.qa/` (lib/element-evidence.mjs captures the evidence).
/**
 * @import { ExecutionEvidence, ExecutionExcerptNode } from "./execution-guard.mjs"
 */
import { isMap } from "./dialect.mjs";

/**
 * The line that opens an Execution's folded Element evidence block in its record.
 * @type {"<details><summary>Element evidence</summary>"}
 */
export const EVIDENCE_SUMMARY = "<details><summary>Element evidence</summary>";

/**
 * The folded Element evidence block for one Execution, one Trace number per JSON line, or no lines
 * when no traced call carries evidence.
 * @param {Record<string, ExecutionEvidence>} byTrace
 * @returns {string[]}
 */
export function evidenceBlockLines(byTrace) {
  const keys = Object.keys(byTrace);
  if (!keys.length) return [];
  const entries = keys.map((key, at) => `  ${JSON.stringify(key)}: ${JSON.stringify(byTrace[key])}${at < keys.length - 1 ? "," : ""}`);
  return [EVIDENCE_SUMMARY, "", "```json", "{", ...entries, "}", "```", "", "</details>", ""];
}

/**
 * Absent, or a non-empty object of `true` flags drawn from `names`.
 * @param {unknown} value
 * @param {readonly string[]} names
 * @returns {boolean}
 */
const truncationFlags = (value, names) =>
  value === undefined || (isMap(value) && Object.keys(value).length > 0 && Object.entries(value).every(([name, flag]) => names.includes(name) && flag === true));

/**
 * @param {unknown} value
 * @returns {value is ExecutionExcerptNode}
 */
const isExcerptNode = (value) =>
  isMap(value) && Object.keys(value).every((k) => k === "tag" || k === "attributes") &&
  typeof value.tag === "string" && value.tag !== "" &&
  isMap(value.attributes) && Object.values(value.attributes).every((v) => typeof v === "string");

/**
 * Whether `value` is the closed evidence shape the guard log carries: `{target: "none"}` alone, or
 * the ARIA path, locator and excerpt (each possibly `unavailable`) with their truncation markers.
 * @param {unknown} value
 * @returns {value is ExecutionEvidence}
 */
export function isExecutionEvidence(value) {
  if (!isMap(value)) return false;
  if ("target" in value) return Object.keys(value).length === 1 && value.target === "none";
  if (!Object.keys(value).every((k) => ["aria", "locator", "excerpt", "truncated"].includes(k))) return false;
  if (typeof value.aria !== "string" || typeof value.locator !== "string") return false;
  if (!truncationFlags(value.truncated, ["aria", "locator", "excerpt"])) return false;
  const excerpt = value.excerpt;
  if (excerpt === "unavailable") return true;
  return isMap(excerpt) && Object.keys(excerpt).every((k) => ["element", "ancestors", "boundary", "truncated"].includes(k)) &&
    isExcerptNode(excerpt.element) && Array.isArray(excerpt.ancestors) && excerpt.ancestors.every(isExcerptNode) &&
    (excerpt.boundary === undefined || ["iframe", "shadow", "unknown"].includes(/** @type {string} */ (excerpt.boundary))) &&
    truncationFlags(excerpt.truncated, ["ancestors", "attributes", "classes", "values", "bytes"]);
}
