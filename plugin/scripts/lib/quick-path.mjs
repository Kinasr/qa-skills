// @ts-check
// The quick path of `/qa-impact` (ADR-0043): a small change taken end to end in one conversation,
// by composing the transitions deep-dive and design also call. This module owns only what is the
// quick path's own:
//   - the run dir. One per change, named here (`impact quick`) and printed, so deep-dive's `--dir`,
//     `impact plan --dir` and the settle walk reuse it. Design's own run (its agreement, plan and
//     unit briefs) takes the `design/` dir inside it, since both commands keep a `plan.json`.
//   - the threshold. After the engineer confirmed the Rule edits and the downstream walk ran
//     (`reconcile`, the deep-dive Rule-edit transition, called as it is), the scope is the confirmed
//     Rules of every Feature plus the Stale cases those edits owe (the Scan's `stale_obligations`
//     over the working tree). More than the limit (10, or a Practice in `train/impact.md` that
//     reads "Quick path threshold: <n>") hands the change to deep-dive.
//   - the handoff Run payload (lib/change-handoff.mjs), which `deep-dive resume` reads.
// Everything after the threshold (checkpoint 1, the Scan store, selection, the judge, design's
// Delegate fill, the settle walk, checkpoint 2) is the shared CLI the skill calls, unchanged.
/** @import { CommandResult } from "./cli.mjs" */
/** @import { ParsedFile } from "./knowledge-file.mjs" */
import { join, resolve } from "node:path";
import { clearHandoff, readHandoff, uncommittedKnowledge, writeHandoff } from "./change-handoff.mjs";
import { refuse } from "./impact-json.mjs";
import { loadQaAt, repositoryOf, resolveRef } from "./git-tree.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { parseForecast, reconcile, snapshotOf } from "./rule-edit.mjs";
import { rulesChangedAcross } from "./rule-diff.mjs";
import { formatRuleRef } from "./rule-ref.mjs";
import { newRunDir, openRunDir } from "./run-dir.mjs";
import { scan } from "./scan.mjs";
import { refuseSuiteSchema } from "./schema-guard.mjs";
import { IMPACT_TRAIN_KEY } from "./schema.mjs";
import { trainFor } from "./training.mjs";

/** @type {number} */
export const DEFAULT_THRESHOLD = 10;

// A Practice reads "Quick path threshold: 4 Rules plus Stale cases": the number after the words.
const PRACTICE = /quick[ -]path threshold\D{0,40}?(\d+)/i;

// The limit in force: the last Practice of `train/impact.md` that sets one, else the default.
/**
 * @param {string} root
 * @returns {{ limit: number, source: string }}
 */
export function thresholdOf(root) {
  let found = { limit: DEFAULT_THRESHOLD, source: "default" };
  for (const entry of trainFor(root, IMPACT_TRAIN_KEY).entries) {
    const m = entry.kind === "practice" ? PRACTICE.exec(entry.statement) : null;
    if (m) found = { limit: Number(m[1]), source: `practice:${entry.key}` };
  }
  return found;
}

// `impact quick [--dir <run-dir>]`: names the change's run dir (making it, or reusing the one an
// escalation or an earlier call already named) and says which threshold is in force.
/**
 * @param {{ root: string, dir: string | undefined }} input
 * @returns {CommandResult}
 */
export function openQuick({ root, dir: named }) {
  const run = /** @type {import("./run-dir.mjs").NewRunDirResult} */ (newRunDir(named, "qa-impact-"));
  if (run.error) return refuse("run_dir", { reason: run.error });
  const threshold = thresholdOf(root);
  const dir = /** @type {() => string} */ (run.make)();
  const held = readHandoff(dir);
  return {
    exit: 0,
    json: {
      ok: true,
      dir,
      design_dir: join(dir, "design"),
      resumed: run.exists,
      threshold: { limit: threshold.limit, source: threshold.source },
      handoff: held.handoff ?? null,
      train: trainFor(root, IMPACT_TRAIN_KEY),
    },
  };
}

/**
 * The piped input: the confirmed forecast, the References the change came from, and the questions
 * still open.
 * @typedef {{ forecast: string, references: string[], openQuestions: string[] }} QuickInput
 */

// `{forecast, references, open_questions?}`, read; a message when the input is not that.
/**
 * @param {string} text
 * @returns {QuickInput | string}
 */
function parseInput(text) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return "stdin is not JSON";
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "stdin is not a JSON object";
  const data = /** @type {Record<string, unknown>} */ (value);
  for (const key of Object.keys(data)) if (!["forecast", "references", "open_questions"].includes(key)) return `unknown key \`${key}\``;
  const list = (/** @type {unknown} */ x) => Array.isArray(x) && x.every((s) => typeof s === "string");
  if (data.forecast === null || typeof data.forecast !== "object" || Array.isArray(data.forecast)) return "`forecast` is the confirmed forecast: {changes, may_change, unaffected}";
  if (!list(data.references)) return "`references` is the list of Reference URIs the change came from";
  if (data.open_questions !== undefined && !list(data.open_questions)) return "`open_questions` is a list of strings";
  return { forecast: JSON.stringify(data.forecast), references: /** @type {string[]} */ (data.references), openQuestions: /** @type {string[]} */ (data.open_questions ?? []) };
}

// The Rules the working tree changed against HEAD, in every Feature: the confirmed Rules the
// threshold counts (added, edited and retired alike, by the one predicate the Scan uses).
/**
 * @param {string} root
 * @param {readonly import("./knowledge-file.mjs").ParsedFile[]} files the working tree
 * @returns {import("./rule-ref.mjs").RuleRef[]}
 */
function changedRules(root, files) {
  const repo = repositoryOf(root);
  const head = repo ? resolveRef(root, "HEAD") : null;
  if (!repo || !head) return [];
  const then = snapshotOf(/** @type {readonly import("./knowledge-file.mjs").ParsedFile[]} */ (loadQaAt(repo, head)));
  const now = snapshotOf(files);
  return rulesChangedAcross(then, now).map(({ feature, rule }) => ({ feature, rule }));
}

// `impact quick-check <feature> --dir <run-dir> --stdin`: the Rule-edit transition (deep-dive's
// `reconcile`, called as it is), then the threshold over everything the working tree changed. Over
// the limit, the handoff payload is written to the run dir.
/**
 * @param {{ root: string, dir: string | undefined, feature: string, stdin: string }} input
 * @returns {CommandResult}
 */
export function checkQuick({ root, dir: named, feature, stdin }) {
  const open = openRunDir(named, { cmd: "impact", action: "quick-check", from: "impact quick" });
  if (open.error) return refuse("run_dir", { reason: open.error });
  const dir = /** @type {string} */ (open.dir);
  const input = parseInput(stdin);
  if (typeof input === "string") return refuse("quick_input", { reason: input });
  const guard = refuseSuiteSchema(root);
  if (guard) return guard;

  const files = /** @type {readonly ParsedFile[]} */ (loadWorkingTree(root));
  const edit = reconcile({ root: resolve(root), files, index: buildIndex(files) }, feature, parseForecast(input.forecast), dir);
  if (!edit.json.ok) return { exit: edit.exit, json: { ...edit.json, action: "quick-check", dir } };

  const bands = /** @type {Record<string, string[]>} */ (JSON.parse(input.forecast));
  const bandOf = (/** @type {string} */ rule) => ["changes", "may_change", "unaffected"].find((b) => bands[b]?.includes(rule)) ?? null;
  const edits = changedRules(root, files)
    .map((e) => ({ feature: e.feature, rule: e.rule, band: e.feature === feature ? bandOf(e.rule) : "downstream" }))
    .sort((a, b) => Number(b.feature === feature) - Number(a.feature === feature));
  // The cases this change owes a Stale: an obligation counts when one of the edited Rules is its
  // cause and the case does not already store it, so an earlier change's Stale or one already
  // stored does not push this change over the limit.
  const edited = new Set(edits.map(({ feature: f, rule }) => formatRuleRef({ feature: f, rule })));
  const stale = new Set(
    scan(root, {})
      .history.stale_obligations.filter((o) => !o.stored && o.causes.some((cause) => edited.has(cause.includes("/") ? cause : `${o.feature}/${cause}`)))
      .map((o) => o.key),
  );
  const { limit, source } = thresholdOf(root);
  const total = edits.length + stale.size;
  const over = total > limit;
  const threshold = { limit, source, rules: edits.length, stale_cases: stale.size, total, over };

  /** @type {string | null} */
  let handoff = null;
  if (over) {
    handoff = writeHandoff(dir, { v: 1, references: input.references, edits, open_questions: input.openQuestions, written: uncommittedKnowledge(root) });
  } else {
    clearHandoff(dir);
  }
  const features = new Set(edits.map((e) => e.feature));
  const plan = `impact plan${features.size === 1 ? ` ${feature}` : ""} --persist --dir ${dir}`;
  return {
    exit: 0,
    json: {
      ...edit.json,
      action: "quick-check",
      dir,
      threshold,
      handoff,
      next_step: over ? `/qa-deep-dive ${feature} --dir ${dir}` : `commit the Rule edits (checkpoint 1), then \`${plan}\``,
    },
  };
}
