// @ts-check
// Coverage categories: the ten-category floor and the effective list the deep dive and design
// walk. The floor's one home is `plugin/skills/references/coverage-categories.md`; a team extends
// it in `train/categories.md`, which holds category entries (`### <key>: <name>`, then `meaning`
// and `after:` in the entry's `yaml` block) and a `retired:` list. The resolver inserts each
// extension directly after its anchor, extensions sharing an anchor keeping their file order.
//
// `train check categories` validates a drafted file; every later mode calls `effectiveCategories`
// for the same resolved list. The blank-slate parse, validation and change checks live in
// `category-file.mjs`, so `check-file` can use them without reaching the knowledge-file cycle.
/** @import { CheckProblem } from "./check-file.mjs" */
/** @import { CategoryChanges, CategoryExtension, FloorCategory, ParsedCategories } from "./category-file.mjs" */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { changesOf, FLOOR, FLOOR_KEYS, parseCategoryDraft, validateCategories, writePathErrors } from "./category-file.mjs";
import { parse } from "./knowledge-file.mjs";
import { CATEGORIES_TRAIN_KEY } from "./schema.mjs";

/** The train target shared by the deep dive and design, and the floor's derived keys. */
export { CATEGORIES_TRAIN_KEY, FLOOR_KEYS };

/**
 * One category of the effective walk order: a floor entry carries `floor: true`, an extension
 * `floor: false` and the `after` anchor it was inserted behind.
 * @typedef {{
 *   key: string,
 *   name: string,
 *   meaning: string,
 *   floor: boolean,
 *   after?: string,
 * }} EffectiveCategory
 */

/**
 * The resolver's answer: the effective walk order and the keys never to reuse.
 * @typedef {{ categories: EffectiveCategory[], retired: string[] }} EffectiveCategories
 */

/**
 * The effective walk order: every floor category in its reference order, each extension inserted
 * directly after its anchor, extensions sharing an anchor in their file order. A retired key, a
 * key that repeats the floor, or a repeat of an earlier extension is never inserted: the floor is
 * never shortened or overridden. An extension whose anchor is unknown (or that forms a cycle) is
 * appended at the end in file order, so no extension silently disappears; `check` refuses such a
 * file before it is written.
 * @param {readonly FloorCategory[]} floor
 * @param {readonly CategoryExtension[]} extensions
 * @param {readonly string[]} retired
 * @returns {EffectiveCategories}
 */
export function resolveCategories(floor, extensions, retired) {
  const retiredKeys = [...new Set(retired)];
  const retiredSet = new Set(retiredKeys);
  const floorKeys = new Set(floor.map((c) => c.key));
  /** @type {Map<string, CategoryExtension>} */
  const byKey = new Map();
  /** @type {CategoryExtension[]} */
  const live = [];
  for (const extension of extensions) {
    if (retiredSet.has(extension.key) || floorKeys.has(extension.key) || byKey.has(extension.key)) continue;
    byKey.set(extension.key, extension);
    live.push(extension);
  }
  /** @type {Map<string, CategoryExtension[]>} */
  const children = new Map();
  for (const extension of live) {
    const siblings = children.get(extension.after) ?? [];
    siblings.push(extension);
    children.set(extension.after, siblings);
  }
  /** @type {EffectiveCategory[]} */
  const categories = [];
  const seen = new Set();
  /**
   * @param {FloorCategory | CategoryExtension} category
   * @param {boolean} isFloor
   * @returns {void}
   */
  const visit = (category, isFloor) => {
    if (seen.has(category.key)) return;
    seen.add(category.key);
    categories.push(isFloor
      ? { key: category.key, name: category.name, meaning: category.meaning, floor: true }
      : { key: category.key, name: category.name, meaning: category.meaning, floor: false, after: /** @type {CategoryExtension} */ (category).after });
    for (const child of children.get(category.key) ?? []) visit(child, false);
  };
  for (const category of floor) visit(category, true);
  for (const extension of live) if (!seen.has(extension.key)) visit(extension, false);
  return { categories, retired: retiredKeys };
}

/**
 * The effective list in the `.qa/` directory `qaDir`: the floor, extended by
 * `train/categories.md` when it exists. The resolver reads only the file's entries and retired
 * keys; whether the file is valid is `train check categories`'s question.
 * @param {string} qaDir The `.qa/` directory.
 * @returns {EffectiveCategories}
 */
export function effectiveCategories(qaDir) {
  const path = join(qaDir, "train", `${CATEGORIES_TRAIN_KEY}.md`);
  return effectiveCategoriesFromText(existsSync(path) ? readFileSync(path, "utf8") : null);
}

/**
 * The same list from the text of `train/categories.md` already read, or null when it is absent.
 * @param {string | null} text
 * @returns {EffectiveCategories}
 */
export function effectiveCategoriesFromText(text) {
  if (text === null) return resolveCategories(FLOOR, [], []);
  const parsed = parseCategories(text);
  return resolveCategories(FLOOR, parsed.entries, parsed.retired);
}

/**
 * A drafted `train/categories.md`, checked against the floor and itself: its frontmatter is a
 * categories train file, every key is unique across the floor and the extensions, every anchor is
 * a floor key or an earlier extension, no retired key is reused, and no entry retires or replaces
 * a floor category. Against a `baseline`, the write-path gate also refuses a changed name or
 * meaning, a removed entry whose key is not in `retired:`, and a removal another live entry is
 * anchored to. A valid draft also resolves its `effective` list. `categories` lists the entries
 * added, edited and removed against `baseline`, when one is given.
 * @param {string} text The draft.
 * @param {string | null} [baseline] The file on disk before this draft, if any.
 * @returns {{
 *   ok: boolean,
 *   errors: CheckProblem[],
 *   warnings: CheckProblem[],
 *   categories: CategoryChanges,
 *   effective?: EffectiveCategories,
 * }}
 */
export function checkCategoriesDraft(text, baseline = null) {
  const before = baseline === null ? null : parseCategories(baseline);
  const draft = parseCategories(text);
  const changes = changesOf(before?.entries ?? [], draft.entries);
  const removal = before === null ? { errors: [], dependents: new Set() } : writePathErrors(before.entries, draft);
  // The write path's own dependent-removal message replaces the generic dangling-anchor one.
  const errors = validateCategories(draft).filter((error) =>
    !(error.field !== undefined && removal.dependents.has(error.field) && error.code === "dangling_anchor"));
  errors.push(...removal.errors);
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings: [],
    categories: changes,
    ...(ok ? { effective: resolveCategories(FLOOR, draft.entries, draft.retired) } : {}),
  };
}

/**
 * A categories file parsed from text: its `knowledge-file` frontmatter and the blank-slate entry
 * parse.
 * @param {string} text
 * @returns {ParsedCategories}
 */
function parseCategories(text) {
  const file = parse(`train/${CATEGORIES_TRAIN_KEY}.md`, text);
  return parseCategoryDraft(text, {
    type: file.type,
    key: file.data.key,
    frontmatterLine: file.frontmatterLine,
    retiredLine: file.keyLines.retired ?? null,
    retired: file.data.retired,
    problems: file.problems,
  });
}
