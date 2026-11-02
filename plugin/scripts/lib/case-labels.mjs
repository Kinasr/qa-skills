// @ts-check
// Project labels classify cases without changing their claims. Retired values remain readable
// on existing cases.
import { isKey, isMap } from "./dialect.mjs";
import { KNOWN } from "./schema.mjs";

/**
 * @typedef {{ name: string, description: string, values: string[], retired: string[], multiple: boolean, required: boolean, tracker_field?: string }} CustomField
 * @typedef {{ tags: Record<string, string>, retiredTags: string[], customFields: CustomField[] }} LabelDefinitions
 * @typedef {{ code: string, field: string, message: string }} LabelProblem
 */

// The keys a filler's case reply names for its own content: no Custom field may take one.
const REPLY_KEYS = ["summary", "preconditions", "steps", "expected", "override_reason"];

/**
 * @param {Record<string, unknown>} data
 * @returns {LabelDefinitions}
 */
export function labelDefinitions(data) {
  const fields = Array.isArray(data.custom_fields) ? data.custom_fields.filter(isMap) : [];
  return {
    tags: /** @type {Record<string, string>} */ (isMap(data.tags) ? data.tags : {}),
    retiredTags: strings(data.retired_tags),
    customFields: fields.map((f) => ({ name: String(f.name), description: String(f.description ?? ""), values: strings(f.values), retired: strings(f.retired), multiple: f.multiple === true, required: f.required === true, ...(typeof f.tracker_field === "string" && { tracker_field: f.tracker_field }) })),
  };
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
const strings = (value) => Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
/**
 * Whether a Tag name is declared in the project, active or retired.
 * @param {LabelDefinitions} definitions
 * @param {string} tag
 * @returns {boolean}
 */
export const isDeclaredTag = (definitions, tag) => Object.hasOwn(definitions.tags, tag) || definitions.retiredTags.includes(tag);
/**
 * Whether a label value is empty: unset, null, blank or an empty list.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isAbsent = (value) => value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);

/**
 * Whether `v` is a list of strings with none repeated.
 * @param {unknown} v
 * @returns {v is string[]}
 */
export const isDistinctStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === "string") && new Set(v).size === v.length;

/**
 * @param {Record<string, unknown>} data
 * @param {readonly CustomField[]} fields
 * @returns {boolean}
 */
export const isUnclassified = (data, fields) => fields.some((f) => f.required && isAbsent(Object.hasOwn(data, f.name) ? data[f.name] : undefined));

/**
 * @param {Record<string, unknown>} data
 * @returns {LabelProblem[]}
 */
export function labelDefinitionProblems(data) {
  /** @type {LabelProblem[]} */
  const problems = [];
  const bad = (/** @type {string} */ field, /** @type {string} */ message) => problems.push({ code: "invalid", field, message });
  /** @type {(v: unknown) => v is string} */
  const oneLine = (v) => typeof v === "string" && !/[\n\r\p{Zl}\p{Zp}]/u.test(v);
  /** @type {(v: unknown) => v is string[]} */
  const list = (v) => isDistinctStrings(v) && v.every((x) => oneLine(x) && x.trim() !== "");
  if (data.tags !== undefined) {
    if (!isMap(data.tags)) bad("tags", "`tags` must map each Tag to its optional one-line meaning");
    else for (const [tag, meaning] of Object.entries(data.tags)) if (!isKey(tag) || !oneLine(meaning)) bad("tags", "a Tag needs a name and a one-line meaning (which may be empty)");
  }
  if (data.role_meaning !== undefined && (!oneLine(data.role_meaning) || !data.role_meaning.trim())) bad("role_meaning", "`role_meaning` must describe what the Role list means on one line");
  if (data.retired_tags !== undefined && !list(data.retired_tags)) bad("retired_tags", "`retired_tags` must be a list of distinct names");
  const tags = data.tags;
  if (isMap(tags) && strings(data.retired_tags).some((t) => Object.hasOwn(tags, t))) bad("retired_tags", "a retired Tag cannot be reused as an active Tag");
  if (data.custom_fields === undefined) return problems;
  if (!Array.isArray(data.custom_fields)) { bad("custom_fields", "`custom_fields` must be a block list of field definitions"); return problems; }
  const names = new Set();
  for (const f of data.custom_fields) {
    if (!isMap(f)) { bad("custom_fields", "each Custom field must be a flat map"); continue; }
    const field = `custom_fields.${f.name}`;
    if (typeof f.name !== "string" || !isKey(f.name) || [...KNOWN.case, ...KNOWN.project, ...REPLY_KEYS, "__proto__", "constructor", "prototype"].includes(f.name) || names.has(f.name)) bad(field, "a Custom-field name must be distinct and cannot be a built-in key");
    names.add(f.name);
    if (!oneLine(f.description) || !f.description.trim()) bad(field, "a Custom field needs a non-empty one-line description");
    if (!list(f.values) || !f.values.length) bad(field, "a Custom field needs a non-empty list of distinct allowed values");
    if (f.retired !== undefined && !list(f.retired)) bad(field, "retired values must be a list of distinct names");
    if (strings(f.retired).some((v) => strings(f.values).includes(v))) bad(field, "a retired Custom-field value cannot be reused");
    for (const k of ["multiple", "required"]) if (f[k] !== undefined && typeof f[k] !== "boolean") bad(field, `\`${k}\` must be true or false`);
    if (f.tracker_field !== undefined && (!oneLine(f.tracker_field) || !f.tracker_field.trim())) bad(field, "`tracker_field` must name a tracker field on one line");
    for (const k of Object.keys(f)) if (!["name", "description", "values", "retired", "multiple", "required", "tracker_field"].includes(k)) bad(field, `unknown Custom-field definition key \`${k}\``);
  }
  return problems;
}

/**
 * @param {Record<string, unknown>} data
 * @param {LabelDefinitions} definitions
 * @returns {LabelProblem[]}
 */
export function caseLabelProblems(data, definitions) {
  /** @type {LabelProblem[]} */
  const problems = [];
  const bad = (/** @type {string} */ code, /** @type {string} */ field, /** @type {string} */ message) => problems.push({ code, field, message });
  if (data.tags !== undefined && data.tags !== null) {
    if (!isDistinctStrings(data.tags)) bad("shape", "tags", "`tags` must be a list of distinct Tag names");
    else for (const tag of /** @type {string[]} */ (data.tags)) if (!isDeclaredTag(definitions, tag)) bad("unknown_tag", "tags", `Tag \`${tag}\` is not declared in the project`);
  }
  for (const f of definitions.customFields) {
    const value = Object.hasOwn(data, f.name) ? data[f.name] : undefined;
    if (isAbsent(value)) continue;
    if (f.multiple ? !isDistinctStrings(value) : typeof value !== "string") { bad("shape", f.name, `\`${f.name}\` must hold ${f.multiple ? "a list of distinct values" : "one value"}`); continue; }
    for (const v of f.multiple ? /** @type {string[]} */ (value) : [value]) if (![...f.values, ...f.retired].includes(/** @type {string} */ (v))) bad("unknown_custom_field_value", f.name, `value \`${v}\` is not declared for \`${f.name}\``);
  }
  return problems;
}

/**
 * @typedef {{ tags: string[], values: Record<string, string | string[]> }} CaseLabels
 * @typedef {{ field: string, value: unknown, code: "label_shape" | "label_unknown" | "label_retired" | "label_unmeant" }} DroppedLabel
 */

/**
 * The keys of a filler's case reply that name labels: `tags` and each Custom field.
 * @param {LabelDefinitions} definitions
 * @returns {string[]}
 */
export const labelKeys = (definitions) => ["tags", ...definitions.customFields.map((f) => f.name)];

/**
 * The labels a filler's case reply may assign, apart from its claim: only Tags that have a
 * meaning and the active values of each Custom field. A label that is not one is dropped with
 * the code saying why, never a reason to reject the reply.
 * @param {Record<string, unknown>} reply
 * @param {LabelDefinitions} definitions
 * @returns {{ labels: CaseLabels, dropped: DroppedLabel[] }}
 */
export function fillerLabels(reply, definitions) {
  /** @type {DroppedLabel[]} */
  const dropped = [];
  const drop = (/** @type {string} */ field, /** @type {unknown} */ value, /** @type {DroppedLabel["code"]} */ code) => dropped.push({ field, value, code });
  /** @type {CaseLabels} */
  const labels = { tags: [], values: {} };
  if (!isAbsent(reply.tags)) {
    if (!isDistinctStrings(reply.tags)) drop("tags", reply.tags, "label_shape");
    else for (const tag of /** @type {string[]} */ (reply.tags)) {
      if (!Object.hasOwn(definitions.tags, tag)) drop("tags", tag, definitions.retiredTags.includes(tag) ? "label_retired" : "label_unknown");
      else if (!definitions.tags[tag].trim()) drop("tags", tag, "label_unmeant");
      else labels.tags.push(tag);
    }
  }
  for (const f of definitions.customFields) {
    const value = Object.hasOwn(reply, f.name) ? reply[f.name] : undefined;
    if (isAbsent(value)) continue;
    if (f.multiple ? !isDistinctStrings(value) : typeof value !== "string") { drop(f.name, value, "label_shape"); continue; }
    const kept = /** @type {string[]} */ (f.multiple ? value : [value]).filter((v) => {
      if (f.values.includes(v)) return true;
      drop(f.name, v, f.retired.includes(v) ? "label_retired" : "label_unknown");
      return false;
    });
    if (kept.length) labels.values[f.name] = f.multiple ? kept : kept[0];
  }
  return { labels, dropped };
}

/**
 * A case's labels as its stored block holds them: its Tags and the values of each Custom field.
 * @param {Record<string, unknown>} data
 * @param {LabelDefinitions} definitions
 * @returns {CaseLabels}
 */
export function storedLabels(data, definitions) {
  /** @type {CaseLabels} */
  const labels = { tags: strings(data.tags), values: {} };
  for (const f of definitions.customFields) {
    const value = Object.hasOwn(data, f.name) ? data[f.name] : undefined;
    if (!isAbsent(value)) labels.values[f.name] = /** @type {string | string[]} */ (value);
  }
  return labels;
}

/**
 * The labels of a regenerated case: those the engineer set on the case it replaces survive, and the
 * filler's add to them without removing one. A single-valued field keeps the engineer's value.
 * @param {CaseLabels} kept
 * @param {CaseLabels} filled
 * @param {LabelDefinitions} definitions
 * @returns {CaseLabels}
 */
export function mergeLabels(kept, filled, definitions) {
  /** @type {CaseLabels} */
  const out = { tags: [...new Set([...kept.tags, ...filled.tags])], values: { ...filled.values } };
  for (const f of definitions.customFields) {
    const had = kept.values[f.name];
    if (had === undefined) continue;
    out.values[f.name] = f.multiple ? [...new Set([...(/** @type {string[]} */ (had)), ...strings(filled.values[f.name])])] : had;
  }
  return out;
}

/**
 * A label a regenerate could not give to a regenerated case, by the Key of the replaced case that
 * held it: `label_unmatched` when no regenerated case covers the same Rules, `label_retired` when
 * the Tag or value has been retired since.
 * @typedef {{ key: string, field: string, value: string, code: "label_unmatched" | "label_retired" }} LostLabel
 */

/**
 * Each label of a case as a `{field, value}` pair: `tags` for a Tag, the field's name for a value.
 * @param {CaseLabels} labels
 * @returns {Array<{ field: string, value: string }>}
 */
export const labelEntries = (labels) => [
  ...labels.tags.map((value) => ({ field: "tags", value })),
  ...Object.entries(labels.values).flatMap(([field, value]) => (Array.isArray(value) ? value : [value]).map((v) => ({ field, value: v }))),
];

/**
 * A case's labels split into those the project still lets a case take and those it has retired.
 * @param {CaseLabels} labels
 * @param {LabelDefinitions} definitions
 * @returns {{ active: CaseLabels, retired: Array<{ field: string, value: string }> }}
 */
export function withoutRetired(labels, definitions) {
  /** @type {CaseLabels} */
  const active = { tags: labels.tags.filter((t) => Object.hasOwn(definitions.tags, t)), values: {} };
  for (const f of definitions.customFields) {
    const had = labels.values[f.name];
    if (had === undefined) continue;
    const kept = (Array.isArray(had) ? had : [had]).filter((v) => f.values.includes(v));
    if (kept.length) active.values[f.name] = f.multiple ? kept : kept[0];
  }
  const live = new Set(labelEntries(active).map(({ field, value }) => `${field}\n${value}`));
  return { active, retired: labelEntries(labels).filter(({ field, value }) => !live.has(`${field}\n${value}`)) };
}

/**
 * For each regenerated case, the replaced case that covered the same Rules (the first such case not
 * yet taken, in order) with its labels, or null when none did; and the replaced cases no regenerated
 * case took.
 * @param {ReadonlyArray<{ key: string, covers: readonly string[], labels: CaseLabels }>} replaced
 * @param {ReadonlyArray<{ covers: readonly string[] }>} proposals
 * @returns {{ lent: Array<{ key: string, labels: CaseLabels } | null>, unmatched: Array<{ key: string, labels: CaseLabels }> }}
 */
export function carriedLabels(replaced, proposals) {
  const same = (/** @type {readonly string[]} */ covers) => [...covers].sort().join("\n");
  /** @type {Map<string, Array<{ key: string, labels: CaseLabels }>>} */
  const pool = new Map();
  for (const { key, covers, labels } of replaced) pool.set(same(covers), [...(pool.get(same(covers)) ?? []), { key, labels }]);
  const lent = proposals.map((p) => pool.get(same(p.covers))?.shift() ?? null);
  return { lent, unmatched: [...pool.values()].flat() };
}
