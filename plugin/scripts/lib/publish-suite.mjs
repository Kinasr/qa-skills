// @ts-check
// A Suite mark owns its Feature; mirror.suite remains a shareable tracker reference (ADR-0028).
/**
 * @import { TrackerState } from "./sync-tracker.mjs"
 */
import { PATTERN, trackerReference } from "./keys.mjs";
import { keyLabel } from "./labels.mjs";
import { SUITE_KEYS_SCHEMA_VERSION } from "./schema.mjs";

/**
 * @param {unknown} v
 * @returns {string[]}
 */
const strings = (v) => Array.isArray(v) ? v.filter((/** @type {unknown} */ k) => typeof k === "string") : [];

/**
 * A recovered suite card item.
 * @typedef {{
 *   code: string,
 *   key: string,
 *   feature: string,
 *   file: string,
 *   label: string,
 *   tracker_key: string,
 *   mirror: Record<string, unknown>,
 *   needs: string[],
 *   edits: string[],
 *   [key: string]: unknown,
 * }} PublishSuiteCardItem
 */

/**
 * A candidate skipped item.
 * @typedef {{
 *   key: string,
 *   feature?: string,
 *   file?: string,
 *   label?: string,
 *   reason?: string,
 *   [key: string]: unknown,
 * }} PublishSkippedCandidate
 */

/**
 * Summary helper for publish suite.
 * @typedef {{
 *   feature: (key: string) => string | undefined,
 *   scenario: (key: string) => string | undefined,
 *   [key: string]: unknown,
 * }} PublishSuiteSummary
 */

/**
 * Context for publish suite candidates.
 * @typedef {{
 *   files: Array<{ type?: string, data: Record<string, unknown> }>,
 *   index: {
 *     features: Map<string, Array<{ file: { rel: string, data: Record<string, unknown> } }>>,
 *     suites: Map<string, unknown[]>,
 *     scenarios: Map<string, Array<{ feature: string, file: { data: Record<string, unknown> } }>>,
 *     tracker: {
 *       resolve: (token: string) => { status: string },
 *       current: (kind: string, key: string) => string | null,
 *     },
 *   },
 *   feature?: string | null,
 *   config: {
 *     trackerPattern?: RegExp,
 *     schemaVersion?: number,
 *   },
 *   tracker: TrackerState,
 *   mapping: {
 *     suite_type: string,
 *   },
 *   [key: string]: unknown,
 * }} PublishSuiteContext
 */

/**
 * @param {PublishSuiteContext} ctx
 * @param {PublishSuiteSummary} summary
 * @param {PublishSkippedCandidate[]} skipped
 * @returns {{ suites: Map<string, PublishSuiteCardItem>, refused: Set<string> }}
 */
export function suiteCandidates(ctx, summary, skipped) {
  /** @type {Map<string, PublishSuiteCardItem>} */
  const suites = new Map();
  /** @type {Set<string>} */
  const refused = new Set();
  const tombstones = new Set(ctx.files.flatMap((f) => f.type === "project" ? strings(f.data.retired_features) : f.type === "feature" ? strings(f.data.retired) : []));
  for (const [feature, declarations] of ctx.index.features) {
    if (ctx.feature && feature !== ctx.feature) continue;
    const file = declarations[0].file;
    const key = file.data.suite_key;
    const label = keyLabel(feature, summary.feature(feature));
    const reject = (/** @type {string} */ reason, /** @type {Record<string, unknown>} */ data = {}) => { refused.add(feature); skipped.push({ key: feature, feature, file: file.rel, label, reason, ...data }); };
    if ((/** @type {Record<string, unknown>} */ (file.data.mirror))?.suite !== undefined && (/** @type {Record<string, unknown>} */ (file.data.mirror)).suite !== null &&
        (typeof (/** @type {Record<string, unknown>} */ (file.data.mirror)).suite !== "string" || !ctx.config.trackerPattern?.test(/** @type {string} */ ((/** @type {Record<string, unknown>} */ (file.data.mirror)).suite)))) {
      reject("suite_link_invalid", { field: "mirror.suite" }); continue;
    }
    if (key === undefined) {
      if ((/** @type {number} */ (ctx.config.schemaVersion)) >= SUITE_KEYS_SCHEMA_VERSION) reject("suite_key_missing", { remedy: "migrate-keys" });
      continue;
    }
    if (typeof key !== "string" || !PATTERN.suite.test(key)) { reject("suite_key_invalid", { remedy: "migrate-keys" }); continue; }
    if ((/** @type {unknown[]} */ (ctx.index.suites.get(key))).length > 1) { reject("duplicate_suite_key", { suite_key: key }); continue; }
    if (tombstones.has(key)) { reject("retired_key_live", { suite_key: key }); continue; }
    if (!ctx.tracker.ok) continue;
    const hits = [...new Map([...ctx.tracker.markedSuites, ...ctx.tracker.markedCases, ...ctx.tracker.markedScenarios].filter(([, item]) => item.mark === key)).values()];
    if (hits.length > 1) { reject("multiple_mark_hits", { hits: hits.map((h) => h.key) }); continue; }
    const hit = hits[0];
    if (!hit) continue;
    if (hit.issue_type !== ctx.mapping.suite_type) { reject("mark_wrong_kind", { tracker_key: hit.key, issue_type: hit.issue_type, expected: ctx.mapping.suite_type }); continue; }
    const current = (/** @type {Record<string, unknown>} */ (file.data.mirror))?.suite;
    if (current && current !== hit.key) { reject("mark_linked_elsewhere", { tracker_key: hit.key, current }); continue; }
    if (tombstones.has(trackerReference(hit.key)) || ctx.index.tracker.resolve(hit.key).status === "retired") { reject("mark_retired", { tracker_key: hit.key }); continue; }
    const parents = [...ctx.index.scenarios.values()].flat().filter((d) => d.feature === feature).flatMap((d) => {
      const tracker = /** @type {string} */ (ctx.index.tracker.current("scenario", /** @type {string} */ (d.file.data.key)));
      const fetched = (/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).scenarios.get((/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).requests.scenarios.get(tracker) ?? tracker);
      const marks = [d.file.data.key, ...strings(d.file.data.formerly).filter((k) => PATTERN.provisional.test(k))];
      const marked = [...(/** @type {Extract<TrackerState, { ok: true }>} */ (ctx.tracker)).markedScenarios.values()].filter((s) => marks.includes(/** @type {string} */ (s.mark)));
      return [(/** @type {Record<string, unknown>} */ (d.file.data.mirror))?.suite, fetched?.suite, ...marked.map((s) => s.suite)].filter((s) => typeof s === "string");
    });
    if (parents.some((s) => s !== hit.key)) { reject("mark_parent_mismatch", { tracker_key: hit.key, parents: [...new Set(parents)] }); continue; }
    if (current === hit.key) continue;
    suites.set(feature, { code: "recover_suite", key: feature, feature, file: file.rel, label,
      tracker_key: hit.key, mirror: { .../** @type {Record<string, unknown>} */ (file.data.mirror), suite: hit.key, at: ctx.tracker.at }, needs: [], edits: [] });
  }
  return { suites, refused };
}
