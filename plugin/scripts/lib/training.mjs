// @ts-check
// A command's own training, as its state call returns it (ADR-0015): the one place
// that reads `train/<key>.md` for a command that consumes it. `/qa-design` and `/qa-impact` call it
// for their file; deep-dive, sync and init call it the same way for theirs.
//
//   trainFor(source, key)        {exists, text, entries}: the whole file's text (a command reads its
//                                training wholesale, so no Practice is skipped by a routing guess)
//                                and its entries in file order, each {key, kind, statement}, a key
//                                in a token format shown as `shownKey` shows it. With no
//                                such file: {exists: false, text: null, entries: []}.
//   trainFile(source, key)       the parsed train file itself (lib/knowledge-file.mjs `parse`), or
//                                null: for a reader that needs the entries' data, as access.mjs
//                                does.
//   conventionsText(source, key) only the `cnv_` entries' text, joined; null when there are none.
//                                What a Delegate's brief carries: Practices stay with the
//                                orchestrator (ADR-0015).
//   practicesText(source, key)   only the `prc_` entries' text, joined; null when there are none.
//                                What a Scout's brief carries of its command's training (ADR-0017).
//
// `source` is a Key index (lib/qa-index.mjs `buildIndex`) of the working tree, or the path of the
// `.qa/` directory, which is loaded here. A command that judges `.qa/` as it was at a commit passes
// the path: its training is always the working tree's.
/** @import { ParsedEntry } from "./knowledge-file.mjs" */
import { shownKey } from "./credentials.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { TRAIN_ENTRIES } from "./schema.mjs";

/**
 * A train file, as the training reads it: its text, the frontmatter values the entries and the
 * commands read, the line each key is declared on, and the entries it holds, by list.
 * @typedef {{
 *   type?: unknown,
 *   data: Record<string, unknown> & { setup_role?: string },
 *   keyLines: Record<string, number>,
 *   text: string,
 *   [list: string]: unknown,
 * }} TrainFile
 */

/**
 * One entry of a train file, as a command's training reads it: its key, its kind, and the text of
 * its heading.
 * @typedef {{
 *   key: string,
 *   kind: string,
 *   statement: string,
 * }} TrainEntry
 */

/**
 * A command's training: the whole file's text, and its entries in file order.
 * @typedef {{
 *   exists: false,
 *   text: null,
 *   entries: TrainEntry[],
 * } | {
 *   exists: true,
 *   text: string,
 *   entries: TrainEntry[],
 * }} TrainState
 */

/** @type {TrainState} */
const NONE = { exists: false, text: null, entries: [] };

/**
 * @param {string | Record<string, unknown>} source
 * @param {string} key
 * @returns {TrainFile | null}
 */
export const trainFile = (source, key) => {
  const index = typeof source === "string" ? buildIndex(loadWorkingTree(source)) : source;
  const declared = /** @type {Map<string, readonly { file: TrainFile }[]>} */ (index.train).get(key) ?? [];
  // A target's own file wins over a legacy one (`LEGACY_TRAIN_KEYS`); scan warns that the legacy one is shadowed.
  return (declared.find(({ file }) => file.data.key === key) ?? declared[0])?.file ?? null;
};

// Every entry of a train file with its kind, in file order.
/**
 * @param {TrainFile} file
 * @returns {Array<ParsedEntry & { kind: string }>}
 */
const entriesOf = (file) =>
  TRAIN_ENTRIES.flatMap(({ kind, list }) => /** @type {ParsedEntry[]} */ (file[list]).map((e) => ({ ...e, kind }))).sort((a, b) => a.line - b.line);

/**
 * @param {string | Record<string, unknown>} source
 * @param {string} key
 * @returns {TrainState}
 */
export function trainFor(source, key) {
  const file = trainFile(source, key);
  if (!file) return { ...NONE };
  return { exists: true, text: file.text, entries: entriesOf(file).map(({ key, kind, statement }) => ({ key: /** @type {string} */ (shownKey(key)), kind, statement: /** @type {string} */ (statement) })) };
}

/**
 * @param {string | Record<string, unknown>} source
 * @param {string} key
 * @returns {string | null}
 */
export const conventionsText = (source, key) => entriesText(source, key, "convention");

/**
 * @param {string | Record<string, unknown>} source
 * @param {string} key
 * @returns {string | null}
 */
export const practicesText = (source, key) => entriesText(source, key, "practice");

/**
 * @param {string | Record<string, unknown>} source
 * @param {string} key
 * @param {"convention" | "practice"} kind
 * @returns {string | null}
 */
function entriesText(source, key, kind) {
  const file = trainFile(source, key);
  if (!file) return null;
  const lines = file.text.replace(/\r\n/g, "\n").split("\n");
  const own = entriesOf(file).filter((e) => e.kind === kind);
  return own.length ? own.map((e) => lines.slice(e.line - 1, e.end).join("\n").replace(/\s+$/, "")).join("\n\n") : null;
}
