// @ts-check
// Maintaining the project's labels (Tags, Custom fields and what the Roles mean): a Tag or a
// Custom-field value is retired, never removed, renamed or reused, and an edit to what one means
// is put to the engineer with the number of cases that carry it. What `/qa-init` warns of when a
// Custom-field value repeats a Coverage category key lives here too.
import { isAbsent, labelDefinitions } from "./case-labels.mjs";
import { effectiveCategories } from "./categories.mjs";

/**
 * The `project.md` keys that hold the labels, in the order the Card shows them.
 * @type {readonly string[]}
 */
export const LABEL_KEYS = ["role_meaning", "tags", "retired_tags", "custom_fields"];

/**
 * A Tag or Custom-field value that left the project's lists without being retired, or a retirement
 * that was undone.
 * @typedef {{ field: string, name: string }} LabelRemoval
 */

/**
 * A meaning that changed: of a Tag, of a Custom field's description, or of what the Role list
 * means. `field` is the `project.md` key the change is in.
 * @typedef {{ kind: "tag" | "field" | "roles", field: string, name: string }} MeaningEdit
 */

/**
 * The Tags and Custom-field values `before` held that `after` no longer lists as active or
 * retired: a label is retired, never removed, renamed or reused.
 * @param {Record<string, unknown>} before - `project.md`'s frontmatter data
 * @param {Record<string, unknown>} after
 * @returns {LabelRemoval[]}
 */
export function removedLabels(before, after) {
  const was = labelDefinitions(before);
  const now = labelDefinitions(after);
  /** @type {LabelRemoval[]} */
  const removed = [];
  for (const tag of Object.keys(was.tags)) if (!Object.hasOwn(now.tags, tag) && !now.retiredTags.includes(tag)) removed.push({ field: "tags", name: tag });
  for (const tag of was.retiredTags.filter((t) => !now.retiredTags.includes(t))) removed.push({ field: "retired_tags", name: tag });
  for (const f of was.customFields) {
    const next = now.customFields.find((g) => g.name === f.name);
    if (!next) { removed.push({ field: "custom_fields", name: f.name }); continue; }
    for (const v of f.values) if (!next.values.includes(v) && !next.retired.includes(v)) removed.push({ field: "custom_fields", name: `${f.name}.${v}` });
    for (const v of f.retired) if (!next.retired.includes(v)) removed.push({ field: "custom_fields", name: `${f.name}.${v}` });
  }
  return removed;
}

/**
 * The meanings `after` changes against `before`: a Tag's meaning, a Custom field's description, and
 * what the Role list means. Setting a meaning that was unset counts for a Tag, since a filler starts
 * assigning it; the first `role_meaning` does not, since nothing read it before.
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @returns {MeaningEdit[]}
 */
export function editedMeanings(before, after) {
  const was = labelDefinitions(before);
  const now = labelDefinitions(after);
  /** @type {MeaningEdit[]} */
  const edits = [];
  for (const [tag, meaning] of Object.entries(was.tags)) if (Object.hasOwn(now.tags, tag) && now.tags[tag] !== meaning) edits.push({ kind: "tag", field: "tags", name: tag });
  for (const f of was.customFields) if (now.customFields.some((g) => g.name === f.name && g.description !== f.description)) edits.push({ kind: "field", field: "custom_fields", name: f.name });
  if (typeof before.role_meaning === "string" && before.role_meaning !== after.role_meaning) edits.push({ kind: "roles", field: "role_meaning", name: "roles" });
  return edits;
}

/**
 * How many cases carry what an edited meaning is about: a Tag, any value of a Custom field, or any
 * Role.
 * @param {MeaningEdit} edit
 * @param {ReadonlyArray<Record<string, unknown>>} cases - each case's block data
 * @returns {number}
 */
export function casesCarrying(edit, cases) {
  const has = (/** @type {Record<string, unknown>} */ data) => {
    if (edit.kind === "tag") return Array.isArray(data.tags) && data.tags.includes(edit.name);
    if (edit.kind === "roles") return Array.isArray(data.roles) && data.roles.length > 0;
    const value = Object.hasOwn(data, edit.name) ? data[edit.name] : undefined;
    return !isAbsent(value);
  };
  return cases.filter(has).length;
}

/**
 * The Custom-field values (as `field: value`) that repeat a Coverage category key in the `.qa/`
 * directory `qaDir`. A team category is never a Coverage category, so init warns.
 * @param {string} qaDir
 * @param {Record<string, unknown>} data - `project.md`'s frontmatter data
 * @returns {string[]}
 */
export function categoryOverlaps(qaDir, data) {
  const keys = new Set(effectiveCategories(qaDir).categories.map((c) => c.key));
  return labelDefinitions(data).customFields.flatMap((f) => [...f.values, ...f.retired].filter((v) => keys.has(v)).map((v) => `${f.name}: ${v}`));
}
