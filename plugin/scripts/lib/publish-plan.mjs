// @ts-check
// Publish records `tracker:` and Mirrored values only; Keys, filenames and code never change (ADR-0027).
import { featureFile } from "./qa-index.mjs";
import { oneLine } from "./schema.mjs";
import { Plan } from "./sync-plan.mjs";
import { confirmedLabelCopies } from "./publish-labels.mjs";
import { writtenMirror } from "./case-fields.mjs";

/** @import { PublishCardItem, PublishContext, PublisherResult } from "./publish.mjs" */
/** @import { PlanRendered } from "./sync-plan.mjs" */
/** @import { LabelCopies } from "./publish-labels.mjs" */
/** @import { TrackerCaseItem } from "./sync-tracker.mjs" */

// Publish writes no code, so its Plan carries no Key carrier.
const NO_CARRIER = { name: null, names: [], home: null };

/**
 * @param {PublishContext} ctx
 * @param {PublishCardItem[]} items
 * @param {PublisherResult[]} results
 * @param {string | null} at
 * @returns {PlanRendered}
 */
export function publishedPlan(ctx, items, results, at) {
  const mappings = new Map(results.filter((r) => r.tracker_key !== undefined).map((r) => [r.key, /** @type {string} */ (r.tracker_key)]));
  const plan = new Plan(ctx, NO_CARRIER);
  const repairs = new Map();
  /** @type {Map<string, Record<string, unknown>>} */
  const mirrors = new Map();
  /** @type {Map<string, LabelCopies>} */
  const labelMaps = new Map();
  for (const item of items) {
    /** @type {LabelCopies} */
    const copies = ["recover_case", "local_copy_case"].includes(item.code) ? { mirror: item.code === "local_copy_case" ? item.mirror : undefined, mirror_fields: item.mirror_fields, mirror_field_targets: item.mirror_field_targets } : confirmedLabelCopies(item.labels ?? [], results.find((r) => r.n === item.n)?.labels ?? []);
    const before = /** @type {LabelCopies | undefined} */ (ctx.index.cases.get(item.key)?.[0].entry.data);
    const merged = labelMaps.get(item.key) ?? {};
    for (const name of /** @type {const} */ (["mirror_fields", "mirror_field_targets"])) {
      if (copies[name] !== undefined) {
        const values = { ...before?.[name], ...merged[name], ...copies[name] };
        // The two maps have distinct value types, so assign each through its own branch.
        if (name === "mirror_fields") merged.mirror_fields = values;
        else merged.mirror_field_targets = /** @type {Record<string, string>} */ (values);
        plan.set({ file: item.file, key: item.key }, name, values);
      }
    }
    labelMaps.set(item.key, merged);
    if (item.code === "local_copy_case") {
      const prior = mirrors.get(item.key) ?? /** @type {Record<string, unknown>} */ (ctx.index.cases.get(item.key)?.[0].entry.data.mirror ?? {});
      const mirror = { ...prior, ...copies.mirror };
      mirrors.set(item.key, mirror);
      plan.set({ file: item.file, key: item.key }, "mirror", mirror);
      continue;
    }
    if (["remark", "retire"].includes(item.code)) {
      if (!repairs.has(item.file)) repairs.set(item.file, new Set());
      repairs.get(item.file).add(item.repair_index);
      continue;
    }
    if (item.code === "recover_suite") {
      const feature = featureFile(ctx.index, /** @type {string} */ (item.feature));
      plan.set({ file: item.file }, "mirror", { ...feature.data.mirror, suite: item.tracker_key, at });
      continue;
    }
    if (item.code.startsWith("recover_")) {
      const where = item.code === "recover_case" ? { file: item.file, key: item.key } : { file: item.file };
      plan.set(where, "tracker", item.tracker_key);
      plan.set(where, "mirror", item.mirror);
      continue;
    }
    const fields = { ...item.fields, scenario: mappings.get(/** @type {string} */ (item.scenario)) ?? /** @type {Record<string, unknown>} */ (item.fields).scenario };
    if (item.code === "update_case") {
      const before = mirrors.get(item.key) ?? /** @type {Record<string, unknown>} */ ((/** @type {Array<{ entry: { data: { mirror?: Record<string, unknown> } } }>} */ (ctx.index.cases.get(item.key)))[0].entry.data.mirror);
      const fetched = /** @type {TrackerCaseItem} */ (/** @type {Extract<PublishContext["tracker"], { ok: true }>} */ (ctx.tracker).cases.get(/** @type {string} */ (item.tracker_key)));
      const mirror = { status: fetched.status, auto_status: fetched.auto_status, ...before, ...writtenMirror(fields), ...copies.mirror, at };
      mirrors.set(item.key, mirror);
      plan.set({ file: item.file, key: item.key }, "mirror", mirror);
      continue;
    }
    const to = mappings.get(item.key);
    if (item.code === "create_suite") {
      const feature = featureFile(ctx.index, /** @type {string} */ (item.feature));
      plan.set({ file: item.file }, "mirror", { ...feature.data.mirror, suite: to, at });
    } else if (item.code === "create_scenario") {
      plan.set({ file: item.file }, "tracker", to);
      plan.set({ file: item.file }, "mirror", { suite: mappings.get(/** @type {string} */ (item.suite)) ?? item.suite, summary: typeof (/** @type {Record<string, unknown>} */ (item.fields)).summary === "string" ? oneLine(/** @type {string} */ ((/** @type {Record<string, unknown>} */ (item.fields)).summary)) : null, at });
    } else {
      plan.set({ file: item.file, key: item.key }, "tracker", to);
      plan.set({ file: item.file, key: item.key }, "mirror", { status: (/** @type {Record<string, unknown>} */ (item.fields)).status, auto_status: null, ...writtenMirror(fields), ...copies.mirror, at });
    }
  }
  for (const [file, completed] of repairs) {
    const pending = (/** @type {unknown[]} */ (/** @type {{ data: { repairs?: unknown[] } }} */ (ctx.files.find((f) => f.rel === file)).data.repairs)).filter((_r, i) => !completed.has(i));
    plan.set({ file }, "repairs", pending.length ? pending : undefined);
  }
  return plan.render();
}
