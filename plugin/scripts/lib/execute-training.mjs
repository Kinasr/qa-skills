// @ts-check
// Operating knowledge for /qa-execute. The reader takes a parsed train file, like
// accessNotes; relational checks are shared by scan and the train draft gate.
import { realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { shownKey } from "./credentials.mjs";
import { isFixtureName } from "./keys.mjs";
import { EXECUTE_TRAIN_KEY, TRAIN_ENTRIES } from "./schema.mjs";

/**
 * A train file entry parsed from markdown.
 * @typedef {{
 *   key: string,
 *   statement: string,
 *   line: number,
 *   prose: Array<{ text: string, [key: string]: unknown }>,
 *   data: Record<string, unknown>,
 *   keyLines: Record<string, number>,
 *   blockLine: number,
 *   [key: string]: unknown,
 * }} ParsedTrainEntry
 */

/**
 * A train file parsed by knowledge-file.
 * @typedef {{
 *   type?: unknown,
 *   data: {
 *     key?: unknown,
 *     setup_role?: string,
 *     automation_retries?: number,
 *     [key: string]: unknown,
 *   },
 *   keyLines: Record<string, number>,
 *   [list: string]: unknown,
 * }} ParsedTrainFile
 */

/**
 * An execute training entry.
 * @typedef {{
 *   kind: string,
 *   key: string,
 *   heading: string,
 *   line: number,
 *   prose: string,
 *   features?: string[],
 *   file?: string,
 *   format: string,
 *   bytes?: number,
 *   content?: string,
 *   create?: string,
 *   phrase?: string,
 *   method?: string,
 *   path?: string,
 *   query?: string[],
 *   body?: unknown,
 *   required?: Record<string, unknown>,
 *   tag_field?: string,
 *   disposable?: boolean,
 *   [key: string]: unknown,
 * }} ExecuteTrainingEntry
 */

/**
 * An integrity error reported on a train file.
 * @typedef {{
 *   code: string,
 *   field: string,
 *   line: number,
 *   message: string,
 * }} IntegrityError
 */

/**
 * @param {ParsedTrainFile | null | undefined} file
 * @returns {{ setup_role?: string, automation_retries: number, entries: ExecuteTrainingEntry[] }}
 */
export function executeTraining(file) {
  const raw = file?.type === "train" && file.data.key === EXECUTE_TRAIN_KEY ? file.data.automation_retries : undefined;
  const retries = Number.isInteger(raw) ? /** @type {number} */ (raw) : 2;
  if (file?.type !== "train" || file.data.key !== EXECUTE_TRAIN_KEY) return { automation_retries: retries, entries: [] };
  const entries = TRAIN_ENTRIES.filter((kind) => ["prc_", "rcp_", "act_", "upl_"].includes(kind.prefix))
    .flatMap(({ prefix, list }) => (/** @type {ParsedTrainEntry[]} */ (file[list])).map((e) => (/** @type {ExecuteTrainingEntry} */ ({
      ...e.data, kind: prefix.slice(0, -1), key: e.key, heading: e.statement, line: e.line,
      prose: e.prose.map((p) => p.text).join("\n").trim(),
    })))).sort((a, b) => a.line - b.line);
  return { automation_retries: retries, ...(file.data.setup_role !== undefined && { setup_role: file.data.setup_role }), entries };
}

// A committed upload must resolve to a real file inside .qa/fixtures/, including through links.
/**
 * @param {string} root
 * @param {string} name
 * @returns {boolean}
 */
export function fixtureExists(root, name) {
  if (!isFixtureName(name)) return false;
  try {
    const directory = join(realpathSync(root), "fixtures");
    const path = realpathSync(join(directory, name));
    return path.startsWith(directory + sep) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {ParsedTrainFile | null | undefined} file
 * @param {{ root: string, roles: ReadonlySet<string> | Set<string>, features: ReadonlySet<string> | Set<string> }} options
 * @returns {IntegrityError[]}
 */
export function executeIntegrity(file, { root, roles, features }) {
  if (file?.type !== "train" || file.data.key !== EXECUTE_TRAIN_KEY) return [];
  /** @type {IntegrityError[]} */
  const errors = [];
  const report = (/** @type {string} */ code, /** @type {string} */ field, /** @type {number} */ line, /** @type {string} */ message) => errors.push({ code, field, line, message });
  const role = file.data.setup_role;
  if (typeof role === "string" && role.trim() && !roles.has(role)) {
    report("unknown_role", "setup_role", file.keyLines.setup_role, "`setup_role` is not in `project.roles`");
  }
  for (const { list } of TRAIN_ENTRIES) for (const e of /** @type {ParsedTrainEntry[]} */ (file[list])) {
    const at = (/** @type {string} */ key) => e.keyLines[key] ?? e.blockLine;
    if (Array.isArray(e.data.features)) for (const feature of e.data.features) {
      if (typeof feature === "string" && !features.has(feature)) report("unresolved_feature", `${shownKey(e.key)}.features`, at("features"), "`features` names no live Feature");
    }
    if (list === "uploads" && isFixtureName(/** @type {string} */ (e.data.file)) && !fixtureExists(root, /** @type {string} */ (e.data.file))) {
      report("missing_fixture", `${shownKey(e.key)}.file`, at("file"), "upload `file` is not an existing file under `.qa/fixtures/`");
    }
  }
  return errors;
}

// A weak hint for the skill's gate, never a verdict. Valid input values in required/content are
// operating knowledge; only the statement, prose and operating instructions are inspected.
const OUTCOME = /\b(?:returns?|responds?(?: with)?|status(?: code)?(?: is|:)?)\s+[1-5][0-9]{2}\b|\b(?:can['’]t|cannot|must not|may not|is (?:denied|rejected)|is not allowed to)\b/i;

/**
 * @param {ParsedTrainFile | null | undefined} file
 * @returns {IntegrityError[]}
 */
export function executeOutcomeClaims(file) {
  return executeTraining(file).entries.filter((e) => OUTCOME.test([e.heading, e.prose, e.create, e.phrase].filter((v) => typeof v === "string").join("\n")))
    .map((e) => ({ code: "outcome_claims", field: /** @type {string} */ (shownKey(e.key)), line: e.line, message: "possible outcome claim: settle it at the gate and route a proposed Rule to `/qa-deep-dive <feature-key>`" }));
}
