// @ts-check
// The blank-slate half of Coverage categories: the floor's one home, the `train/categories.md`
// entry format, and the whole-file validation and write-path change checks. It reads no `.qa/`
// file and never touches a repository, so `check-file` can validate a categories file without
// reaching the knowledge-file cycle. `categories.mjs` adds the frontmatter reader and the resolver.
/** @import { CheckProblem } from "./check-file.mjs" */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./dialect.mjs";
import { keyedHeading, splitFile } from "./markdown.mjs";
import { CATEGORIES_TRAIN_KEY } from "./schema.mjs";

// The shared floor reference, one directory above this module's `lib/`.
const REFERENCE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "references", "coverage-categories.md");

/**
 * One category of the floor, as the reference states it.
 * @typedef {{ key: string, name: string, meaning: string }} FloorCategory
 */

/**
 * One team extension, from `train/categories.md`.
 * @typedef {{ key: string, name: string, meaning: string, after: string }} CategoryExtension
 */

/**
 * One category entry as its file parses it, with the fields validation reads and where they sit.
 * @typedef {{
 *   key: string,
 *   name: string,
 *   meaning: string,
 *   after: string,
 *   line: number,
 *   blockLine: number | null,
 * }} ParsedCategory
 */

/**
 * A parsed `train/categories.md`: its entries, its retired keys, the file's own errors, and enough
 * frontmatter to tell whether it is a categories train file at all.
 * @typedef {{
 *   entries: ParsedCategory[],
 *   retired: string[],
 *   frontmatterLine: number,
 *   retiredLine: number | null,
 *   errors: CheckProblem[],
 *   type: string | null,
 *   key: unknown,
 * }} ParsedCategories
 */

/**
 * The frontmatter facts a caller read from a categories file: `knowledge-file`'s parse, or
 * `check-file`'s already parsed file.
 * @typedef {{
 *   type: string | null,
 *   key: unknown,
 *   frontmatterLine: number,
 *   retiredLine: number | null,
 *   retired: unknown,
 *   problems: { code?: string, line?: number, message: string }[],
 * }} CategoryMeta
 */

// The floor, read from its one home. `FLOOR_KEYS` is derived, never typed twice.
/** @type {readonly FloorCategory[]} */
export const FLOOR = parseFloor(readFileSync(REFERENCE, "utf8"));
/** @type {readonly string[]} */
export const FLOOR_KEYS = Object.freeze(FLOOR.map((c) => c.key));

// A category key is a kebab-case slug; the floor's keys are the pattern's first examples.
const KEY = /^[a-z][a-z0-9-]*$/;
// The only keys a category's `yaml` block may hold.
const BLOCK_KEYS = ["meaning", "after", "sources", "added", "key", "name"];

/**
 * The table rows of the floor reference, in walk order: the `#`, `Key`, `Category` and `Meaning`
 * columns, with the key's backticks removed.
 * @param {string} text
 * @returns {FloorCategory[]}
 */
function parseFloor(text) {
  /** @type {FloorCategory[]} */
  const floor = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const row = line.match(/^\|(.*)\|$/);
    if (!row) continue;
    const cells = row[1].split("|").map((c) => c.trim());
    if (cells.length < 4 || !/^\d+$/.test(cells[0])) continue;
    floor.push({ key: cells[1].replace(/`/g, "").trim(), name: cells[2], meaning: cells[3] });
  }
  return floor;
}

/**
 * A categories file's entries, retired list and its own structural errors, from text and the
 * frontmatter facts its caller read. Structural field rules (required meaning and anchor, anchors
 * that resolve, uniqueness) are `validateCategories`'s job.
 * @param {string} text
 * @param {CategoryMeta} meta
 * @returns {ParsedCategories}
 */
export function parseCategoryDraft(text, meta) {
  /** @type {CheckProblem[]} */
  const errors = meta.problems.map((p) => ({ code: p.code ?? "dialect", line: p.line, message: p.message }));
  const { entries, errors: entryErrors } = parseEntries(text);
  errors.push(...entryErrors);
  /** @type {string[]} */
  const retired = [];
  if (meta.retired !== undefined) {
    if (!Array.isArray(meta.retired)) {
      errors.push({ code: "invalid", field: "retired", line: meta.retiredLine, message: "`retired` is a list of category keys" });
    } else {
      meta.retired.forEach((value) => {
        if (typeof value === "string") retired.push(value);
        else errors.push({ code: "invalid", field: "retired", line: meta.retiredLine, message: "`retired` is a list of category keys" });
      });
    }
  }
  return {
    entries,
    retired,
    frontmatterLine: meta.frontmatterLine,
    retiredLine: meta.retiredLine,
    errors,
    type: meta.type,
    key: meta.key,
  };
}

/**
 * A categories file's `### <key>: <name>` entries, with the first `yaml` fence after each heading
 * as its block (the same shape a train file's `cnv_`/`prc_` entries keep).
 * @param {string} text
 * @returns {{ entries: ParsedCategory[], errors: CheckProblem[] }}
 */
function parseEntries(text) {
  const { elements } = splitFile(text);
  /** @type {ParsedCategory[]} */
  const entries = [];
  /** @type {CheckProblem[]} */
  const errors = [];
  /** @type {{ key: string, name: string, line: number, blockLine: number | null, block: string | null, firstLine: number } | null} */
  let current = null;
  const flush = () => {
    if (!current) return;
    if (current.block === null) {
      errors.push({ code: "required", field: current.key, line: current.line, message: `category \`${current.key}\` has no \`yaml\` block with its \`meaning\` and \`after:\` anchor` });
      entries.push({ key: current.key, name: current.name, meaning: "", after: "", line: current.line, blockLine: null });
      current = null;
      return;
    }
    const block = parseYaml(current.block, current.firstLine);
    errors.push(...block.errors.map((e) => ({ code: e.code ?? "dialect", line: e.line, message: e.message })));
    const data = block.data;
    for (const key of Object.keys(data)) {
      if (BLOCK_KEYS.includes(key)) continue;
      errors.push({ code: "unknown_key", field: key, line: block.keyLines[key], message: `category \`${current.key}\`'s block names an unknown key \`${key}\`` });
    }
    const meaning = typeof data.meaning === "string" ? data.meaning.trim() : "";
    const after = typeof data.after === "string" ? data.after.trim() : "";
    const blockKey = data.key;
    const blockName = data.name;
    if (typeof blockKey === "string" && blockKey !== current.key) {
      errors.push({ code: "heading", field: current.key, line: current.blockLine, message: `category \`${current.key}\`'s block repeats a different key, \`${blockKey}\`` });
    }
    if (typeof blockName === "string" && blockName !== current.name) {
      errors.push({ code: "heading", field: current.key, line: current.blockLine, message: `category \`${current.key}\`'s block repeats a different name, \`${blockName}\`` });
    }
    entries.push({ key: current.key, name: current.name, meaning, after, line: current.line, blockLine: current.blockLine });
  };
  for (const element of elements) {
    if (element.kind === "heading") {
      if (element.level <= 3) flush();
      if (element.level !== 3) continue;
      const heading = keyedHeading(element.text);
      if (!heading) {
        errors.push({ code: "heading", field: element.text, line: element.line, message: "a category heading is `### <key>: <name>`" });
        continue;
      }
      current = { key: heading.key, name: heading.text, line: element.line, blockLine: null, block: null, firstLine: 1 };
      continue;
    }
    if (current !== null && current.block === null && element.lang === "yaml") {
      current.blockLine = element.line;
      current.block = element.text;
      current.firstLine = element.firstLine;
    }
  }
  flush();
  return { entries, errors };
}

/**
 * Every structural rule a categories file must keep, as errors carrying the entry's key (or
 * `retired`) in `field`.
 * @param {ParsedCategories} parsed
 * @returns {CheckProblem[]}
 */
export function validateCategories(parsed) {
  const errors = [...parsed.errors];
  if (parsed.type !== "train") {
    errors.push({ code: "required", field: "type", line: parsed.frontmatterLine, message: "a categories file's frontmatter has `type: train`" });
  }
  if (parsed.key !== CATEGORIES_TRAIN_KEY) {
    errors.push({ code: "invalid", field: "key", line: parsed.frontmatterLine, message: `a categories file's key is \`${CATEGORIES_TRAIN_KEY}\`` });
  }
  const floorKeys = new Set(FLOOR_KEYS);
  const retired = new Set();
  for (const key of parsed.retired) {
    if (retired.has(key)) {
      errors.push({ code: "duplicate", field: "retired", line: parsed.retiredLine, message: `\`retired\` names \`${key}\` twice` });
      continue;
    }
    retired.add(key);
    if (floorKeys.has(key)) {
      errors.push({ code: "invalid", field: "retired", line: parsed.retiredLine, message: `\`${key}\` is a floor category: no entry removes, renames or reorders the floor` });
    }
  }
  const seen = new Map();
  parsed.entries.forEach((entry, index) => {
    if (!KEY.test(entry.key)) {
      errors.push({ code: "pattern", field: entry.key, line: entry.line, message: `category key \`${entry.key}\` is a kebab-case slug, such as \`accessibility\`` });
    }
    if (seen.has(entry.key)) {
      errors.push({ code: "duplicate", field: entry.key, line: entry.line, message: `category key \`${entry.key}\` is declared more than once` });
      return;
    }
    seen.set(entry.key, index);
    if (floorKeys.has(entry.key)) {
      errors.push({ code: "duplicate", field: entry.key, line: entry.line, message: `\`${entry.key}\` is already a floor category: no entry replaces, renames or reorders it` });
    }
    if (retired.has(entry.key)) {
      errors.push({ code: "invalid", field: entry.key, line: entry.line, message: `\`${entry.key}\` is retired and is never reused` });
    }
    if (entry.name === "") {
      errors.push({ code: "required", field: entry.key, line: entry.line, message: `category \`${entry.key}\` has no name` });
    }
    if (entry.meaning === "") {
      errors.push({ code: "required", field: entry.key, line: entry.blockLine, message: `category \`${entry.key}\` has no \`meaning\`` });
    }
    if (entry.after === "") {
      errors.push({ code: "required", field: entry.key, line: entry.blockLine, message: `category \`${entry.key}\` has no \`after:\` anchor` });
      return;
    }
    const anchor = FLOOR_KEYS.includes(entry.after) ? "floor" : seen.has(entry.after) && /** @type {number} */ (seen.get(entry.after)) < index ? "extension" : null;
    if (anchor === null) {
      errors.push({ code: "dangling_anchor", field: entry.key, line: entry.blockLine, message: `category \`${entry.key}\` is placed after \`${entry.after}\`, which is neither a floor category nor an earlier extension` });
    }
  });
  return errors;
}

/**
 * What a draft changed against the file it replaces: the keys it added, the entries whose meaning,
 * name or anchor it edited, and the keys it removed.
 * @typedef {{
 *   added: string[],
 *   edited: { key: string, from: string, to: string }[],
 *   removed: string[],
 * }} CategoryChanges
 */

/**
 * The keys a draft added, edited (its meaning, name or anchor changed) and removed, against the
 * file it replaces.
 * @param {ParsedCategory[]} before
 * @param {ParsedCategory[]} draft
 * @returns {CategoryChanges}
 */
export function changesOf(before, draft) {
  const was = new Map(before.map((entry) => [entry.key, entry]));
  const now = new Map(draft.map((entry) => [entry.key, entry]));
  const signature = (/** @type {ParsedCategory} */ entry) => JSON.stringify([entry.name, entry.meaning, entry.after]);
  return {
    added: [...now.keys()].filter((key) => !was.has(key)),
    edited: [...now.values()]
      .filter((entry) => was.has(entry.key) && signature(/** @type {ParsedCategory} */ (was.get(entry.key))) !== signature(entry))
      .map((entry) => ({ key: entry.key, from: /** @type {ParsedCategory} */ (was.get(entry.key)).meaning, to: entry.meaning })),
    removed: [...was.keys()].filter((key) => !now.has(key)),
  };
}

/**
 * The changes a draft may not make to a file already written: a category's name and meaning are
 * immutable, a removed entry's key must join `retired:`, and an entry may not lose the anchor it
 * points at. A removal cascades only when the dependent is removed too; until then, the dependent
 * is named so the engineer can retire it first.
 * @param {ParsedCategory[]} before The entries on disk.
 * @param {ParsedCategories} draft The parsed draft.
 * @returns {{ errors: CheckProblem[], dependents: Set<string> }}
 */
export function writePathErrors(before, draft) {
  const was = new Map(before.map((entry) => [entry.key, entry]));
  const now = new Map(draft.entries.map((entry) => [entry.key, entry]));
  const removed = new Set([...was.keys()].filter((key) => !now.has(key)));
  const retired = new Set(draft.retired);
  /** @type {CheckProblem[]} */
  const errors = [];
  /** @type {Set<string>} */
  const dependents = new Set();
  for (const entry of draft.entries) {
    const prior = was.get(entry.key);
    if (prior && (prior.name !== entry.name || prior.meaning !== entry.meaning)) {
      errors.push({ code: "invalid", field: entry.key, line: entry.line, message: `category \`${entry.key}\`'s name and meaning are immutable: retire it and add a new category instead` });
    }
  }
  for (const key of removed) {
    if (!retired.has(key)) {
      errors.push({ code: "invalid", field: key, line: was.get(key)?.line ?? null, message: `removing category \`${key}\` retires it: add \`${key}\` to \`retired:\`` });
    }
  }
  for (const entry of draft.entries) {
    if (removed.has(entry.after)) {
      dependents.add(entry.key);
      errors.push({ code: "invalid", field: entry.key, line: entry.blockLine, message: `category \`${entry.key}\` is anchored to \`${entry.after}\`, which this draft removes: remove or retire \`${entry.key}\` first` });
    }
  }
  return { errors, dependents };
}
