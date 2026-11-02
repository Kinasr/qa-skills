// @ts-check
// Merge choices stay in the run until the engineer has seen and accepted the whole result.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { object } from "./refusal.mjs";
import { PATTERN } from "./keys.mjs";
import { duplicateMerges, Plan } from "./sync-plan.mjs";

/**
 * A pair of duplicate items undergoing merge.
 * @typedef {{
 *   cases?: string[],
 *   scenarios?: string[],
 *   survivor: string | null,
 *   tracker_disposition: "keep" | "retire" | null,
 * }} MergePair
 */

/**
 * The merge.json contract shape kept in the run dir.
 * @typedef {{
 *   pairs: MergePair[],
 * }} MergeFileRecord
 */

/**
 * @typedef {{
 *   index: {
 *     cases: Map<string, Array<{ feature: string }>>,
 *     scenarios: Map<string, Array<{ feature: string }>>,
 *     [key: string]: unknown,
 *   },
 *   merges?: MergePair[],
 *   feature?: string,
 *   dir: string,
 *   [key: string]: unknown,
 * }} SyncMergeContext
 */

/**
 * @typedef {{
 *   ok?: boolean,
 *   error?: { code: string, [key: string]: unknown },
 *   result?: unknown,
 *   repairs?: unknown,
 *   retired?: unknown,
 *   review?: unknown,
 *   case_merges?: unknown[],
 *   dependencies?: unknown,
 * }} MergeProposedResult
 */

/**
 * @typedef {{
 *   mergeScenario(arg: { survivor: string | null, loser?: string, trackerDisposition: "keep" | "retire" | null }): MergeProposedResult,
 *   mergeCase(arg: { survivor: string | null, loser?: string, trackerDisposition: "keep" | "retire" | null }): MergeProposedResult,
 * }} SyncMergePlan
 */

/**
 * @typedef {{
 *   code: string,
 *   scenarios?: string[],
 *   cases?: string[],
 *   survivor: string | null,
 *   loser: string | null | undefined,
 *   tracker_disposition: "keep" | "retire" | null,
 *   feature?: string,
 *   needs: string[],
 *   edits: string[],
 *   result?: unknown,
 *   repairs?: unknown,
 *   retired?: unknown,
 *   review?: unknown,
 *   case_merges?: unknown[],
 *   dependencies?: unknown,
 *   problem?: { code: string, [key: string]: unknown },
 *   [key: string]: unknown,
 * }} MergeCardItem
 */

/**
 * @typedef {{
 *   key: "merge",
 *   title: "Merge",
 *   codes: string[],
 *   only: (ctx: SyncMergeContext) => boolean,
 *   items: (ctx: SyncMergeContext) => MergeCardItem[],
 *   apply: (_ctx: SyncMergeContext, item: MergeCardItem, plan: SyncMergePlan) => { code: string, [key: string]: unknown } | null,
 * }} MergeSection
 */

/**
 * @typedef {{
 *   items: Array<{ section: string, n: number | string, [key: string]: unknown }>,
 *   [key: string]: unknown,
 * }} MergeCard
 */

/**
 * @typedef {{
 *   merge: Record<string, string>,
 *   edits: Record<string | number, Record<string, unknown>>,
 *   [key: string]: unknown,
 * }} MergeReply
 */

/**
 * @typedef {{
 *   selected?: MergePair[],
 *   problems?: Array<{ code: string, [key: string]: unknown }>,
 * }} SelectMergesResult
 */

/** @type {"merge.json"} */
export const MERGE_FILE = "merge.json";

/** @param {{ scenarios?: string[], cases?: string[], [key: string]: unknown }} pair */
const keysOf = (pair) => /** @type {string[]} */ (pair.scenarios ?? pair.cases);

/** @param {{ scenarios?: unknown }} pair */
const kindOf = (pair) => pair.scenarios ? "scenario" : "case";

/**
 * @param {SyncMergeContext} ctx
 * @param {{ scenarios?: unknown }} pair
 */
const indexOf = (ctx, pair) => ctx.index[pair.scenarios ? "scenarios" : "cases"];

/** @param {string[]} keys */
const pairId = (keys) => [...keys].sort().join(":");

/**
 * @param {SyncMergePlan} plan
 * @param {MergePair} pair
 */
const propose = (plan, pair) => plan[pair.scenarios ? "mergeScenario" : "mergeCase"]({
  survivor: pair.survivor, loser: keysOf(pair).find((k) => k !== pair.survivor), trackerDisposition: pair.tracker_disposition,
});

/**
 * Read and validate merge choices recorded in merge.json.
 * @param {MergeFileRecord | null} recorded
 * @returns {MergePair[] | null}
 */
export function mergesFrom(recorded) {
  if (recorded === null) return [];
  const pairs = recorded.pairs;
  return Array.isArray(pairs) && pairs.every((p) => object(p) && Boolean(p.cases) !== Boolean(p.scenarios)
    && Array.isArray(keysOf(p)) && keysOf(p).length === 2 && keysOf(p).every((k) => typeof k === "string")
    && keysOf(p).includes(/** @type {string} */ (p.survivor))
    && (p.tracker_disposition === null || ["keep", "retire"].includes(/** @type {string} */ (p.tracker_disposition)))) ? pairs : null;
}

/** @type {MergeSection} */
export const merge = {
  key: "merge", title: "Merge", codes: ["merge_case", "merge_scenario"],
  only: (ctx) => merge.items(ctx).length > 0,
  items(ctx) {
    const pairs = new Map((ctx.merges ?? []).map((p) => [pairId(keysOf(p)), p]));
    for (const kind of ["case", "scenario"]) {
      for (const p of duplicateMerges(ctx.index, ctx.feature, kind)) {
        if (!pairs.has(pairId(keysOf(p)))) pairs.set(pairId(keysOf(p)), /** @type {MergePair} */ (p));
      }
    }
    return [...pairs.values()].map((p) => {
      const survivor = p.survivor;
      const loser = keysOf(p).find((key) => key !== survivor);
      const proposed = survivor ? propose(new Plan(ctx, {}), p) : null;
      const result = proposed?.ok ? proposed : null;
      const needs = !survivor ? ["survivor"] : proposed?.error?.code === "merge_disposition" ? ["tracker_disposition"] : [];
      return { code: `merge_${kindOf(p)}`, [p.scenarios ? "scenarios" : "cases"]: keysOf(p), survivor, loser: survivor ? loser : null,
        tracker_disposition: p.tracker_disposition, feature: indexOf(ctx, p).get(keysOf(p)[0])?.[0].feature,
        needs, edits: ["survivor", "tracker_disposition"],
        ...(result && { result: result.result, repairs: result.repairs, retired: result.retired, review: result.review, ...(result.case_merges && { case_merges: result.case_merges, dependencies: result.dependencies }) }),
        ...(proposed?.error && { problem: proposed.error }),
      };
    });
  },
  apply(_ctx, item, plan) {
    if (!item.result) return item.problem ?? { code: "needs_edit", fields: item.needs };
    const result = propose(plan, item);
    return result.error ?? null;
  },
};

// A choice always rebuilds the Card. It cannot apply other answers in the same Reply.
/**
 * @param {SyncMergeContext} ctx
 * @param {MergeCard} card
 * @param {MergeReply} reply
 * @returns {SelectMergesResult | null}
 */
export function selectMerges(ctx, card, reply) {
  /** @type {MergePair[]} */
  const selected = [];
  for (const [loser, survivor] of Object.entries(reply.merge)) selected.push({ [PATTERN.scenario.test(survivor) ? "scenarios" : "cases"]: [survivor, loser].sort(), survivor, tracker_disposition: null });
  for (const item of card.items.filter((i) => i.section === "merge")) {
    const edits = reply.edits[item.n];
    if (!edits || !Object.keys(edits).length) continue;
    // The merged item and the reply's edits for it: a merge pair whose survivor the edit names.
    const choice = /** @type {MergePair & { survivor: string }} */ (/** @type {unknown} */ ({ ...item, ...edits }));
    if (!keysOf(choice).includes(choice.survivor)) return { problems: [{ code: "merge_survivor", [choice.scenarios ? "scenarios" : "cases"]: keysOf(choice), survivor: choice.survivor }] };
    selected.push({ [choice.scenarios ? "scenarios" : "cases"]: keysOf(choice), survivor: choice.survivor, tracker_disposition: choice.tracker_disposition });
  }
  if (!selected.length) return null;
  const choices = new Map();
  for (const p of selected) {
    const previous = choices.get(pairId(keysOf(p)));
    if (previous && previous.survivor !== p.survivor) return { problems: [{ code: "merge_survivor", [p.scenarios ? "scenarios" : "cases"]: keysOf(p) }] };
    choices.set(pairId(keysOf(p)), p);
  }
  const problems = [];
  for (const p of selected) {
    const loser = keysOf(p).find((k) => k !== p.survivor);
    const r = propose(new Plan(ctx, {}), p);
    if (r.error && r.error.code !== "merge_disposition") problems.push(r.error);
    else if (ctx.feature && indexOf(ctx, p).get(/** @type {string} */ (p.survivor))?.[0].feature !== ctx.feature) problems.push({ code: "merge_out_of_scope", survivor: p.survivor, loser });
    if (p.tracker_disposition !== null && !["keep", "retire"].includes(/** @type {string} */ (p.tracker_disposition))) problems.push({ code: "merge_disposition", survivor: p.survivor, loser });
  }
  if (problems.length) return { problems };
  const pairs = new Map((ctx.merges ?? []).map((p) => [pairId(keysOf(p)), p]));
  for (const p of selected) pairs.set(pairId(keysOf(p)), p);
  writeFileSync(join(ctx.dir, MERGE_FILE), `${JSON.stringify(/** @type {MergeFileRecord} */ ({ pairs: [...pairs.values()] }), null, 2)}\n`);
  return { selected };
}
