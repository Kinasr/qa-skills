// @ts-check
// Owned case fields shared by Publish and Ask; prose Mirrors hold lines.
import { LEVEL_ON_CASE_SCHEMA_VERSION, MIRROR_PROSE, sameSummary } from "./schema.mjs";
import { caseSectionRanges } from "./case-sections.mjs";

/** @type {readonly string[]} */
export const PROSE_FIELDS = MIRROR_PROSE;

/**
 * @param {string} text
 * @returns {string}
 */
export const stripListMarker = (text) => text.trim().replace(/^([-*+]|\d+[.)])\s+/, "");

// A case's level: the one its block names, or, on a project still below the level-on-case schema,
// the one its Scenario carries, which every case without its own inherits until the project migrates.
/**
 * @param {Record<string, unknown>} entryData
 * @param {Record<string, unknown>} fileData
 * @param {number | null | undefined} schemaVersion
 * @returns {unknown}
 */
export const caseLevel = (entryData, fileData, schemaVersion) => entryData.level ?? (typeof schemaVersion === "number" && schemaVersion < LEVEL_ON_CASE_SCHEMA_VERSION ? fileData.level : undefined);

// Steps require the actor prefix's trailing space; preconditions recognise any named prefix.
/**
 * @param {string} text
 * @param {{ precondition?: boolean }} [options]
 * @returns {string | null}
 */
export function stepActor(text, { precondition = false } = {}) {
  const prefix = precondition ? /^As ([^,]+),/ : /^As ([^,]+), /;
  return prefix.exec(stripListMarker(text))?.[1] ?? null;
}

/**
 * A parsed case entry's relevant fields.
 * @typedef {{
 *   summary: string,
 *   prose?: Array<{ text: string, [key: string]: unknown }>,
 *   data: {
 *     roles?: string[],
 *     level?: string,
 *     [key: string]: unknown,
 *   },
 *   [key: string]: unknown,
 * }} CaseFieldEntry
 */

/**
 * The extracted owned case fields.
 * @typedef {{
 *   summary: string,
 *   preconditions: string | null,
 *   steps: string | null,
 *   expected: string | null,
 *   roles: string[],
 *   level?: string,
 *   scenario?: string,
 *   [key: string]: unknown,
 * }} CaseFields
 */

/**
 * @param {CaseFieldEntry} entry
 * @param {string} [scenario]
 * @returns {CaseFields}
 */
export function caseFields(entry, scenario) {
  /** @type {Record<string, string | null>} */
  const prose = { preconditions: null, steps: null, expected: null };
  const lines = /** @type {Array<{ text: string }>} */ (entry.prose).map(({ text }) => ({ text, labelEligible: true }));
  for (const { kind, start, end, labelEnd } of caseSectionRanges(lines)) {
    if (kind === "lead" || kind === "other") continue;
    const first = lines[start].text.slice(labelEnd);
    prose[kind] = [first, ...lines.slice(start + 1, end).map(({ text }) => text)].join("\n");
  }
  return /** @type {CaseFields} */ ({ summary: entry.summary, ...Object.fromEntries(Object.entries(prose).map(([key, value]) => [key, value?.trim() || null])), roles: entry.data.roles ?? [], level: entry.data.level, scenario });
}

// Lists are the units a Tester follows and counts; legacy unlisted prose uses non-empty lines.
/**
 * @param {string | null | undefined} value
 * @returns {string[]}
 */
function proseItems(value) {
  const lines = (value ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  /** @type {string[]} */
  const items = [];
  for (const line of lines) {
    if (/^([-*+]|\d+[.)])\s+/.test(line)) items.push(stripListMarker(line));
    else if (items.length) items[items.length - 1] += ` ${line}`;
  }
  return items.length ? items : lines;
}

/**
 * @param {CaseFieldEntry} entry
 * @returns {string[]}
 */
export const casePreconditions = (entry) => proseItems(caseFields(entry).preconditions);

/**
 * @param {CaseFieldEntry} entry
 * @returns {string[]}
 */
export const caseSteps = (entry) => proseItems(caseFields(entry).steps);

/**
 * @param {string} field
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function sameOwned(field, a, b) {
  if (PROSE_FIELDS.includes(field)) {
    const text = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.join("\n") : /** @type {string | null | undefined} */ (v))?.replace(/\r\n?/g, "\n").trim() || null;
    return text(a) === text(b);
  }
  if (field === "roles") return JSON.stringify([...(/** @type {unknown[]} */ (a ?? []))].sort()) === JSON.stringify([...(/** @type {unknown[]} */ (b ?? []))].sort());
  if (field === "summary" && typeof a === "string" && typeof b === "string") return sameSummary(a, b);
  return (a ?? null) === (b ?? null);
}

/**
 * @param {Record<string, unknown>} fields
 * @param {unknown} [mirror]
 * @returns {boolean}
 */
export function sameOwnedFields(fields, mirror) {
  return Object.entries(fields).every(([field, value]) => sameOwned(field, value, (/** @type {Record<string, unknown> | null | undefined} */ (mirror))?.[field]));
}

/**
 * @param {Record<string, unknown>} fields
 * @returns {Record<string, unknown>}
 */
export function writtenMirror(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "status").map(([key, value]) => [key,
    PROSE_FIELDS.includes(key) && typeof value === "string" ? value.split("\n") : value,
  ]));
}
