// @ts-check
// The handoff Run payload (ADR-0043): `handoff.json` in the change's run dir, written when the quick
// path stops because the confirmed scope passed its threshold, and read by `deep-dive resume` so the
// main path continues from it. Run data, never knowledge: it lives beside `change.json` and is
// written whole.
//   {"v": 1,
//    "references": ["tracker:DEMO-1"],                          the original References, as URIs
//    "edits": [{"feature": "loans", "rule": "rule_4hbz", "band": "changes"}],
//                                                               the confirmed Rule edits; `band` is the
//                                                               forecast band, "downstream" for another
//                                                               Feature, null when outside the forecast
//    "open_questions": ["..."],                                 what the engineer left unsettled
//    "written": ["features/loans/loans.md"]}                    knowledge already written, uncommitted
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readQaAt, repositoryOf, resolveRef } from "./git-tree.mjs";
import { readWorkingTree } from "./qa-index.mjs";
import { readRunFile } from "./run-dir.mjs";

/** @type {string} */
export const HANDOFF_FILE = "handoff.json";

/**
 * @typedef {{
 *   v: 1,
 *   references: string[],
 *   edits: Array<{ feature: string, rule: string, band: string | null }>,
 *   open_questions: string[],
 *   written: string[],
 * }} Handoff
 */

/** @param {unknown} x @returns {x is string[]} */
const strings = (x) => Array.isArray(x) && x.every((s) => typeof s === "string");

// Whether a parsed value is the handoff payload.
/**
 * @param {unknown} value
 * @returns {value is Handoff}
 */
function isHandoff(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const h = /** @type {Record<string, unknown>} */ (value);
  return h.v === 1
    && strings(h.references)
    && strings(h.open_questions)
    && strings(h.written)
    && Array.isArray(h.edits)
    && h.edits.every((e) => e !== null && typeof e === "object" && typeof e.feature === "string" && typeof e.rule === "string" && (e.band === null || typeof e.band === "string"));
}

// Writes the payload whole and returns its path.
/**
 * @param {string} dir
 * @param {Handoff} handoff
 * @returns {string}
 */
export function writeHandoff(dir, handoff) {
  const path = join(dir, HANDOFF_FILE);
  writeFileSync(path, `${JSON.stringify(handoff, null, 2)}\n`);
  return path;
}

// Removes a handoff the run no longer warrants (the scope came back under the threshold).
/**
 * @param {string} dir
 * @returns {void}
 */
export function clearHandoff(dir) {
  const path = join(dir, HANDOFF_FILE);
  if (existsSync(path)) unlinkSync(path);
}

// The run dir's handoff: `{handoff}`, `{handoff: null}` when there is none, or `{error}` for a file
// that is not the payload.
/**
 * @param {string} dir
 * @returns {{ handoff: Handoff | null, error?: undefined } | { error: string, handoff?: undefined }}
 */
export function readHandoff(dir) {
  const read = readRunFile(dir, HANDOFF_FILE, { by: "impact quick-check", restart: "impact quick" });
  if (read.error) return { error: read.error };
  if (read.value === null) return { handoff: null };
  if (!isHandoff(read.value)) return { error: `${join(dir, HANDOFF_FILE)} is not the handoff impact quick-check wrote: start a new run with \`impact quick\`` };
  return { handoff: read.value };
}

// The knowledge files whose text differs from HEAD (or that HEAD lacks): what is already written
// and not yet committed, as repository-relative paths. Empty outside a repository.
/**
 * @param {string} root the `.qa/` directory
 * @returns {string[]}
 */
export function uncommittedKnowledge(root) {
  const repo = repositoryOf(root);
  const head = repo ? resolveRef(root, "HEAD") : null;
  if (!repo || !head) return [];
  const then = readQaAt(repo, head);
  /** @type {string[]} */
  const out = [];
  for (const [rel, text] of readWorkingTree(root)) {
    if (typeof text === "string" && then.get(rel) !== text) out.push(`${repo.prefix}${rel}`);
  }
  return out.sort();
}
