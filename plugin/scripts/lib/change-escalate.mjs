// @ts-check
// `impact escalate --dir <run-dir> --case <key>`: records that `/qa-ask` sent a case to the judge.
// `/qa-ask` never writes, so the engineer runs this command from the route it prints; the entry
// lands in the run dir's `change.json` (lib/change-data.mjs), which `impact plan --dir` reads and
// which puts the case's Feature in the plan even when nothing in it changed.
//   {"feature", "case", "rules": [<local Rule keys the case covers>], "by": "ask", "at": "<date>"}
// Merged by (Feature, case) and written whole; every other key of the file stays as it was.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHANGE_FILE } from "./change-data.mjs";
import { loadQaTree } from "./git-tree.mjs";
import { buildIndex } from "./qa-index.mjs";
import { newRunDir, readRunFile } from "./run-dir.mjs";

/**
 * @typedef {{ ok: true, dir: string, file: string, escalated: { feature: string, case: string, rules: string[] } }
 *   | { ok: false, refusal: "unknown_case" } | { ok: false, refusal: "run_dir", reason: string }} Escalation
 */

// Records the escalation of `key` in `dir`, or says why not. Nothing is made or written on a refusal.
/**
 * @param {{ root: string, dir: string, key: string, at?: string }} input
 * @returns {Escalation}
 */
export function escalate({ root, dir, key, at = new Date().toISOString().slice(0, 10) }) {
  const index = buildIndex(loadQaTree(root, undefined));
  const decl = index.cases.get(key)?.[0];
  const feature = decl?.feature;
  if (!decl || typeof feature !== "string") return { ok: false, refusal: "unknown_case" };

  const run = /** @type {import("./run-dir.mjs").NewRunDirResult} */ (newRunDir(dir, "qa-impact-"));
  if (run.error) return { ok: false, refusal: "run_dir", reason: run.error };
  const read = readRunFile(dir, CHANGE_FILE, { by: ["deep-dive", "impact escalate"], restart: "impact plan" });
  if (read.error) return { ok: false, refusal: "run_dir", reason: read.error };
  const existing = read.value ?? {};
  if (typeof existing !== "object" || Array.isArray(existing)) {
    return { ok: false, refusal: "run_dir", reason: `${join(dir, CHANGE_FILE)} is not the JSON object deep-dive wrote: start a new run with impact plan` };
  }
  const data = /** @type {Record<string, unknown>} */ (existing);
  const rules = Array.isArray(decl.entry.data.covers) ? decl.entry.data.covers.filter((k) => typeof k === "string") : [];
  const entry = { feature, case: key, rules, by: "ask", at };
  const kept = (Array.isArray(data.escalated) ? data.escalated : []).filter((e) => !(e?.feature === feature && e?.case === key));
  const made = /** @type {() => string} */ (run.make)();
  writeFileSync(join(made, CHANGE_FILE), `${JSON.stringify({ v: 1, ...data, escalated: [...kept, entry] }, null, 2)}\n`);
  return { ok: true, dir: made, file: join(made, CHANGE_FILE), escalated: { feature, case: key, rules } };
}
