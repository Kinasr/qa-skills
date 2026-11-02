// @ts-check
// Attach (ADR-0027): recording an existing tracker case or scenario as the `tracker:` of an
// unlinked entry of the same kind. The Key never changes and nothing else is written.
//
// A candidate is proposed by the CLI or named by the engineer:
//   - `strong`: the entry and the tracker item share an Automation. A scenario shares one through
//     its cases: an Automation of one of its cases names a tracker case under the tracker scenario.
//   - `weak`: the two summaries are similar. A pair with neither kind of evidence is never proposed.
//   - `named`: the engineer named the key in a Reply (`name`). The key is persisted in the run
//     (`attach.json`), `sync scope` then lists it so the tracker scout fetches it, and it is vetted
//     against the fetched item before the next Card is sealed.
//
// A candidate is accepted only when the item has the entry's kind, a mark compatible with the
// entry (none, the entry's Key, or a legacy Key it formerly held), and no other claim on its
// tracker key, requested or current: not a live `tracker:`, an alias or a tombstone.
//
// Correcting a wrong link is its own Card item, offered only for a named key on an entry that
// already has a `tracker:`: the wrong key goes to the Feature's `retired:` as `tracker:…`, never to
// `tracker_formerly:`, because it never named this entry, and the new key is attached.
//
// A Suite Attach (ADR-0029) records an existing tracker Test Suite as the `mirror.suite` of a
// Feature that has a Suite key and records none. Its candidates come from the payload's `suites`:
// `strong` when the Suite is unmarked and a child Scenario is linked to one of the Feature's,
// `weak` when its summary resembles the Feature's title, or `named` by the engineer under the
// Feature's slug. The mark decides ownership: another live Feature's Suite key refuses it
// (`attach_owned`); a Suite another Feature only names in `mirror.suite` may be shared. Accepting
// it writes `mirror.suite` and `mirror.at` and queues a remark to the Feature's own Suite key in its
// `repairs:`, which `/qa-publish` carries out. A live `su_` mark no Feature holds is retired in
// `project.md`'s `retired_features` in the same write. An Unlanded Suite's Attach
// (lib/sync-unlanded.mjs) makes the same write for a Suite from the payload's `marked_suites`.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMap } from "./dialect.mjs";
import { PATTERN, trackerReference } from "./keys.mjs";
import { featureFile } from "./qa-index.mjs";
import { object } from "./refusal.mjs";
import { sameSummary } from "./schema.mjs";
import { automationsNaming, hasMark, kindOfType } from "./sync-tracker.mjs";

/**
 * The attach.json contract shape kept in the run dir.
 * @typedef {{
 *   named: Record<string, string>,
 * }} AttachFileRecord
 */

/**
 * @typedef {{
 *   kind: "case" | "scenario",
 *   key: string,
 *   feature: string,
 *   file: string,
 *   summary: string | undefined,
 *   data: Record<string, unknown>,
 *   automates: string[],
 *   ref: { file: string, key?: string },
 * }} AttachEntry
 */

/**
 * @typedef {{
 *   kind: "suite",
 *   key: string,
 *   feature: string,
 *   file: string,
 *   summary: string | undefined,
 *   data: { suite_key?: string, mirror?: { suite?: string }, repairs?: Array<{ tracker?: string, [key: string]: unknown }>, [key: string]: unknown },
 *   suiteKey: string | null,
 *   recorded: string | null,
 * }} SuiteAttachEntry
 */

/**
 * @typedef {{
 *   tracker: string,
 *   strength: "strong" | "weak" | "named",
 *   evidence: {
 *     automations?: string[],
 *     summary?: string | undefined,
 *     tracker_summary?: unknown,
 *     named?: string,
 *     scenarios?: string[],
 *   },
 *   shared_with?: string[],
 *   retires?: string | null,
 * }} AttachCandidate
 */

/**
 * @typedef {{
 *   code: string,
 *   kind?: "case" | "scenario" | "suite",
 *   key: string,
 *   feature: string,
 *   file: string,
 *   summary?: string,
 *   candidates: AttachCandidate[],
 *   tracker: string | null,
 *   needs: string[],
 *   edits: string[],
 *   message: string,
 *   wrong?: unknown,
 *   n?: number | string,
 *   [key: string]: unknown,
 * }} AttachCardItem
 */

/**
 * @typedef {{
 *   code: string,
 *   entry?: string,
 *   tracker?: string,
 *   status?: string,
 *   mark?: string,
 *   owner?: string,
 *   kind?: string,
 *   issue_type?: unknown,
 *   current?: string,
 *   reason?: string,
 *   message?: string,
 *   field?: string,
 *   [key: string]: unknown,
 * }} AttachRefusalProblem
 */

/**
 * @typedef {{
 *   current: string,
 *   item: Record<string, unknown> & { key: string, mark?: string, issue_type?: unknown },
 *   problem?: never,
 * } | {
 *   problem: AttachRefusalProblem,
 *   current?: never,
 *   item?: never,
 * }} VetResult
 */

/**
 * @typedef {{
 *   current: string,
 *   item: Record<string, unknown> & { mark?: string, issue_type?: unknown },
 *   retires: string | null,
 *   shared_with: string[],
 *   problem?: never,
 * } | {
 *   problem: AttachRefusalProblem,
 *   current?: never,
 *   item?: never,
 *   retires?: never,
 *   shared_with?: never,
 * }} VetSuiteResult
 */

/**
 * @typedef {{
 *   attachEntries?: AttachEntry[],
 *   suiteEntries?: SuiteAttachEntry[],
 *   attachItems?: AttachCardItem[],
 *   feature?: string,
 *   named?: Record<string, string>,
 *   dir: string,
 *   config: {
 *     trackerPattern?: RegExp,
 *     [key: string]: unknown,
 *   },
 *   files: Array<{
 *     type: string,
 *     rel: string,
 *     data: Record<string, unknown>,
 *     [key: string]: unknown,
 *   }>,
 *   index: {
 *     cases: Map<string, Array<{ feature: string, file: { rel: string }, entry: { summary: string, data: Record<string, unknown> } }>>,
 *     scenarios: Map<string, Array<{ feature: string, file: { rel: string, h1?: { text: string }, data: Record<string, unknown>, cases: Array<{ data: Record<string, unknown> }> } }>>,
 *     features: Map<string, Array<{ feature?: string, file: { rel: string, h1?: { text: string }, data: Record<string, unknown> & { mirror?: { suite?: string } }, dir?: string } }>>,
 *     suites: Map<string, Array<{ feature: string }>>,
 *     project?: { rel: string, data: { tracker?: { suite_type?: string, [key: string]: unknown }, retired_features?: string[], [key: string]: unknown } },
 *     tracker: {
 *       current(kind: string, key: string): string | null,
 *       resolve(key: string): { status: string },
 *     },
 *     [key: string]: unknown,
 *   },
 *   tracker: {
 *     ok: boolean,
 *     at?: string,
 *     cases: Map<string, Record<string, unknown> & { key: string, mark?: string, scenario?: string }>,
 *     scenarios: Map<string, Record<string, unknown> & { key: string, mark?: string }>,
 *     markedCases: Map<string, Record<string, unknown> & { key: string, mark?: string, scenario?: string }>,
 *     markedScenarios: Map<string, Record<string, unknown> & { key: string, mark?: string }>,
 *     suites?: Map<string, Record<string, unknown> & { key: string, mark?: string }>,
 *     markedSuites?: Map<string, Record<string, unknown> & { key: string, mark?: string }>,
 *     suitesNotFound?: Set<string>,
 *     requests: {
 *       cases: Map<string, string | null>,
 *       scenarios: Map<string, string | null>,
 *     },
 *     [key: string]: unknown,
 *   },
 *   scan: {
 *     results: Array<{
 *       kind: string,
 *       code: string,
 *       key?: string,
 *       automation?: string,
 *       annotation?: unknown,
 *       [key: string]: unknown,
 *     }>,
 *   },
 *   [key: string]: unknown,
 * }} SyncAttachContext
 */

/**
 * @typedef {{
 *   claim(key: string, n?: unknown): { code: string, [key: string]: unknown } | null,
 *   set(ref: { file: string, key?: string }, field: string, value: unknown): void,
 *   retire(file: string, ref: string): void,
 *   frontmatter: Map<string, Map<string, unknown>>,
 *   [key: string]: unknown,
 * }} SyncAttachPlan
 */

/**
 * @typedef {{
 *   key: "attach",
 *   title: "Attach",
 *   codes: string[],
 *   tracker: true,
 *   only: (ctx: SyncAttachContext) => boolean,
 *   items: (ctx: SyncAttachContext) => AttachCardItem[],
 *   apply: (ctx: SyncAttachContext, item: AttachCardItem, plan: SyncAttachPlan) => { code: string, [key: string]: unknown } | null,
 * }} AttachSection
 */

export const ATTACH_FILE = "attach.json";

/** @param {unknown} v */
const stringsIn = (v) => (Array.isArray(v) ? v.filter((k) => typeof k === "string") : []);
/** @param {string | null | undefined} s */
const wordsOf = (s) => new Set((s ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

// Two summaries are similar when they read the same, or share at least two words and 60% of
// their combined vocabulary.
/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function similar(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (sameSummary(a, b)) return true;
  const left = wordsOf(a);
  const right = wordsOf(b);
  const shared = [...left].filter((w) => right.has(w)).length;
  return shared >= 2 && shared / new Set([...left, ...right]).size >= 0.6;
}

// The keys the engineer named, `{entry Key: tracker key}`, as the run's `attach.json` kept them
// (`recorded` is its parsed text, or null): `{}` when there are none, null when the file is not
// that shape.
/**
 * @param {AttachFileRecord | null} recorded
 * @returns {Record<string, string> | null}
 */
export function namedFrom(recorded) {
  if (recorded === null) return {};
  const value = recorded.named;
  return object(value) && Object.values(value).every((v) => typeof v === "string") ? value : null;
}

// Every case and scenario of the Feature in scope that is declared once, in Key order.
/**
 * @param {SyncAttachContext} ctx
 * @returns {AttachEntry[]}
 */
function entriesOf(ctx) {
  if (ctx.attachEntries) return ctx.attachEntries;
  /** @type {AttachEntry[]} */
  const out = [];
  const inScope = (/** @type {{ feature: string }} */ d) => !ctx.feature || d.feature === ctx.feature;
  for (const [key, declarations] of ctx.index.cases) {
    if (declarations.length !== 1 || !inScope(declarations[0])) continue;
    const d = declarations[0];
    out.push({ kind: "case", key, feature: d.feature, file: d.file.rel, summary: d.entry.summary, data: d.entry.data, automates: stringsIn(d.entry.data.automates), ref: { file: d.file.rel, key } });
  }
  for (const [key, declarations] of ctx.index.scenarios) {
    if (declarations.length !== 1 || !inScope(declarations[0])) continue;
    const d = declarations[0];
    out.push({ kind: "scenario", key, feature: d.feature, file: d.file.rel, summary: d.file.h1?.text, data: d.file.data, automates: [...new Set(d.file.cases.flatMap((c) => stringsIn(c.data.automates)))], ref: { file: d.file.rel } });
  }
  return (ctx.attachEntries = out.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)));
}

/** @param {AttachEntry} e */
const linked = (e) => typeof e.data.tracker === "string";
// Below the minted schema, a legacy tracker-shaped Key still links the entry and prevents Attach or correction.
/** @param {SyncAttachContext} ctx @param {AttachEntry} e */
const unlinked = (ctx, e) => !linked(e) && ctx.index.tracker.current(e.kind, e.key) === null;
/** @param {SyncAttachContext} ctx @param {string} key */
const entryNamed = (ctx, key) => entriesOf(ctx).find((e) => e.key === key);

// The tracker item `key` names for entry `e`, vetted: `{current, item}` or `{problem}`, a refusal
// fact. `key` may be a key the tracker redirected: the item is the current one, and every request
// that resolved to it must be unowned too.
/**
 * @param {SyncAttachContext} ctx
 * @param {AttachEntry} e
 * @param {string} key
 * @returns {VetResult}
 */
function vet(ctx, e, key) {
  const T = ctx.tracker;
  const lists = e.kind === "case" ? [T.cases, T.markedCases] : [T.scenarios, T.markedScenarios];
  const others = e.kind === "case" ? [T.scenarios, T.markedScenarios] : [T.cases, T.markedCases];
  const requests = (e.kind === "case" ? T.requests.cases : T.requests.scenarios);
  const current = requests.has(key) ? requests.get(key) : lists.some((m) => m.has(key)) ? key : undefined;
  if (current === undefined) return { problem: { code: "attach_not_fetched", entry: e.key, tracker: key } };
  if (current === null) return { problem: { code: "attach_not_found", entry: e.key, tracker: key } };
  const item = lists.map((m) => m.get(current)).find(Boolean);
  if (!item) return { problem: { code: "attach_not_fetched", entry: e.key, tracker: key } };
  const typed = kindOfType(ctx, /** @type {string | null | undefined} */ (item.issue_type));
  if ((typed && typed !== e.kind) || others.some((m) => m.has(current))) return { problem: { code: "attach_kind", entry: e.key, tracker: current, kind: e.kind, issue_type: item.issue_type ?? null } };
  const asked = [current, ...[...requests].filter(([, c]) => c === current).map(([r]) => r)];
  for (const k of new Set(asked)) {
    const found = ctx.index.tracker.resolve(k);
    if (found.status !== "absent") return { problem: { code: "attach_owned", entry: e.key, tracker: k, status: found.status } };
  }
  if (hasMark(item)) {
    const mark = item.mark.trim();
    if (mark !== e.key && !stringsIn(e.data.formerly).includes(mark)) return { problem: { code: "attach_mark", entry: e.key, tracker: current, mark } };
  }
  return { current, item };
}

// Evidence for pairing entry `e` with tracker item `item`, or null.
/**
 * @param {SyncAttachContext} ctx
 * @param {AttachEntry} e
 * @param {Record<string, unknown> & { key: string }} item
 * @returns {{ strength: "strong", evidence: { automations: string[] } } | { strength: "weak", evidence: { summary?: string, tracker_summary: unknown } } | null}
 */
function evidenceFor(ctx, e, item) {
  const named = e.kind === "case"
    ? automationsNaming(ctx, item.key)
    : [...ctx.tracker.cases.values(), ...ctx.tracker.markedCases.values()].filter((tc) => tc.scenario === item.key).flatMap((tc) => automationsNaming(ctx, tc.key));
  const shared = [...new Set(named.filter((a) => e.automates.includes(a)))];
  if (shared.length) return { strength: "strong", evidence: { automations: shared } };
  if (similar(e.summary, item.summary)) return { strength: "weak", evidence: { summary: e.summary, tracker_summary: item.summary } };
  return null;
}

// The candidates for entry `e`, in order (strong, weak, named), and the named key's problem if any.
/**
 * @param {SyncAttachContext} ctx
 * @param {AttachEntry} e
 * @returns {{ list: AttachCandidate[], refused: AttachRefusalProblem | null }}
 */
function candidatesFor(ctx, e) {
  const T = ctx.tracker;
  const pool = e.kind === "case" ? [...T.cases.values(), ...T.markedCases.values()] : [...T.scenarios.values(), ...T.markedScenarios.values()];
  /** @type {Map<string, AttachCandidate>} */
  const found = new Map();
  for (const item of pool) {
    if (found.has(item.key) || vet(ctx, e, item.key).problem) continue;
    const proof = evidenceFor(ctx, e, item);
    if (proof) found.set(item.key, { tracker: item.key, ...proof });
  }
  /** @type {AttachRefusalProblem | null} */
  let refused = null;
  const asked = ctx.named?.[e.key];
  if (asked !== undefined) {
    const v = vet(ctx, e, asked);
    if (v.problem) refused = v.problem;
    else found.set(v.current, { tracker: v.current, strength: "named", evidence: { ...found.get(v.current)?.evidence, named: asked } });
  }
  /** @type {Record<"strong" | "weak" | "named", number>} */
  const rank = { strong: 0, weak: 1, named: 2 };
  const list = [...found.values()].sort((a, b) => rank[a.strength] - rank[b.strength] || a.tracker.localeCompare(b.tracker, "en", { numeric: true }));
  return { list, refused };
}

// ---- Suite Attach ---------------------------------------------------------------------------

// Feature `feature` as a Suite Attach entry, or null unless it is declared once.
/**
 * @param {SyncAttachContext} ctx
 * @param {string} feature
 * @returns {SuiteAttachEntry | null}
 */
function suiteEntry(ctx, feature) {
  const declarations = ctx.index.features.get(feature);
  if (declarations?.length !== 1) return null;
  const f = /** @type {{ rel: string, h1?: { text: string }, data: { suite_key?: string, mirror?: { suite?: string } } }} */ (declarations[0].file);
  return { kind: "suite", key: feature, feature, file: f.rel, summary: f.h1?.text, data: f.data, suiteKey: PATTERN.suite.test(/** @type {string} */ (f.data.suite_key ?? "")) ? /** @type {string} */ (f.data.suite_key) : null, recorded: typeof f.data.mirror?.suite === "string" ? f.data.mirror.suite : null };
}

// Every Feature in scope, declared once, as a Suite Attach entry.
/**
 * @param {SyncAttachContext} ctx
 * @returns {SuiteAttachEntry[]}
 */
function suiteEntriesOf(ctx) {
  if (ctx.suiteEntries) return ctx.suiteEntries;
  const out = /** @type {SuiteAttachEntry[]} */ ([...ctx.index.features.keys()].filter((F) => !ctx.feature || F === ctx.feature).map((F) => suiteEntry(ctx, F)).filter(Boolean));
  return (ctx.suiteEntries = out.sort((a, b) => a.key.localeCompare(b.key)));
}
/** @param {SyncAttachContext} ctx @param {string} key */
const suiteEntryNamed = (ctx, key) => suiteEntriesOf(ctx).find((e) => e.key === key);
// A Feature a Suite may be attached to: it has a Suite key to remark with and records no Suite.
/** @param {SuiteAttachEntry} e */
const attachable = (e) => e.suiteKey !== null && e.recorded === null;

// The Features of the whole project a Suite may be attached to, in order.
/**
 * @param {SyncAttachContext} ctx
 * @returns {string[]}
 */
export const attachableFeatures = (ctx) => /** @type {SuiteAttachEntry[]} */ ([...ctx.index.features.keys()].map((F) => suiteEntry(ctx, F)).filter((e) => e && attachable(e))).map((e) => e.key).sort();

// The tracker keys of Feature `e`'s linked Scenarios, as the tracker now holds them.
/**
 * @param {SyncAttachContext} ctx
 * @param {SuiteAttachEntry} e
 * @returns {string[]}
 */
function linkedScenarios(ctx, e) {
  /** @type {string[]} */
  const out = [];
  for (const [key, declarations] of ctx.index.scenarios) {
    if (declarations.length !== 1 || declarations[0].feature !== e.feature) continue;
    const tracker = ctx.index.tracker.current("scenario", key);
    if (tracker) out.push(ctx.tracker.requests?.scenarios.get(tracker) ?? tracker);
  }
  return out;
}

// Whether issue type `issueType` is a Test Suite's: the configured `suite_type`, else any type that
// is not a case's or a scenario's.
/**
 * @param {SyncAttachContext} ctx
 * @param {string | null | undefined} issueType
 * @returns {boolean}
 */
export function isSuiteType(ctx, issueType) {
  const suiteType = ctx.index.project?.data.tracker?.suite_type;
  return typeof suiteType === "string" ? issueType === suiteType : !kindOfType(ctx, issueType);
}

// Suite keys retired anywhere: `project.md`'s `retired_features` and every Feature's `retired:`.
/**
 * @param {SyncAttachContext} ctx
 * @returns {Set<string>}
 */
export const retiredKeys = (ctx) => new Set(ctx.files.flatMap((f) => f.type === "project" ? stringsIn(f.data.retired_features) : f.type === "feature" ? stringsIn(f.data.retired) : []));

// The tracker Suite `key` names for Feature `e`, vetted: `{current, item, retires, shared_with}` or
// `{problem}`. `retires` is the foreign live Suite key the Suite is marked with, or null.
/**
 * @param {SyncAttachContext} ctx
 * @param {SuiteAttachEntry} e
 * @param {string} key
 * @returns {VetSuiteResult}
 */
function vetSuite(ctx, e, key) {
  const T = ctx.tracker;
  if (T.suitesNotFound?.has(key)) return { problem: { code: "attach_not_found", entry: e.key, tracker: key } };
  const item = T.suites?.get(key) ?? T.markedSuites?.get(key);
  if (!item) return { problem: { code: "attach_not_fetched", entry: e.key, tracker: key } };
  if (!isSuiteType(ctx, /** @type {string | null | undefined} */ (item.issue_type)) || [T.cases, T.scenarios, T.markedCases, T.markedScenarios].some((m) => m.has(key))) return { problem: { code: "attach_kind", entry: e.key, tracker: key, kind: "suite", issue_type: item.issue_type ?? null } };
  const found = ctx.index.tracker.resolve(key);
  if (found.status !== "absent") return { problem: { code: "attach_owned", entry: e.key, tracker: key, status: found.status } };
  /** @type {string | null} */
  let retires = null;
  if (hasMark(item)) {
    const mark = item.mark.trim();
    if (mark !== e.suiteKey) {
      if (!PATTERN.suite.test(mark)) return { problem: { code: "attach_mark", entry: e.key, tracker: key, mark } };
      const owner = ctx.index.suites.get(mark)?.[0]?.feature;
      if (owner) return { problem: { code: "attach_owned", entry: e.key, tracker: key, mark, owner } };
      if (!retiredKeys(ctx).has(mark)) retires = mark;
    }
  }
  const shared_with = [...ctx.index.features].filter(([F, ds]) => F !== e.feature && ds.some((d) => d.file.data.mirror?.suite === key)).map(([F]) => F).sort();
  return { current: key, item, retires, shared_with };
}

// The candidate record for a vetted Suite.
/**
 * @param {VetSuiteResult & { current: string, shared_with: string[] }} v
 * @param {"strong" | "weak" | "named"} strength
 * @param {Record<string, unknown>} evidence
 * @returns {AttachCandidate}
 */
const suiteCandidate = (v, strength, evidence) => ({ tracker: v.current, strength, evidence, ...(v.shared_with.length && { shared_with: v.shared_with }), ...(v.retires && { retires: v.retires }) });

// The candidates for Feature `e`, in order (strong, weak, named), and the named key's problem if any.
/**
 * @param {SyncAttachContext} ctx
 * @param {SuiteAttachEntry} e
 * @returns {{ list: AttachCandidate[], refused: AttachRefusalProblem | null }}
 */
function suiteCandidatesFor(ctx, e) {
  /** @type {Map<string, AttachCandidate>} */
  const found = new Map();
  const linked = new Set(linkedScenarios(ctx, e));
  const children = [...ctx.tracker.scenarios.values(), ...ctx.tracker.markedScenarios.values()];
  for (const item of ctx.tracker.suites?.values() ?? []) {
    const v = vetSuite(ctx, e, item.key);
    if (v.problem || found.has(item.key)) continue;
    const scenarios = [...new Set(children.filter((ts) => ts.suite === item.key && linked.has(/** @type {string} */ (ts.key))).map((ts) => ts.key))].sort(byKey);
    // A Suite marked with the Feature's own Suite key is as good as unmarked.
    if (scenarios.length && (!hasMark(item) || item.mark.trim() === e.suiteKey)) found.set(item.key, suiteCandidate(v, "strong", { scenarios }));
    else if (similar(e.summary, item.summary)) found.set(item.key, suiteCandidate(v, "weak", { summary: e.summary, tracker_summary: item.summary }));
  }
  /** @type {AttachRefusalProblem | null} */
  let refused = null;
  const asked = ctx.named?.[e.key];
  if (asked !== undefined) {
    const v = e.recorded !== null ? { problem: { code: "attach_suite_recorded", entry: e.key, tracker: asked, current: e.recorded } } : vetSuite(ctx, e, asked);
    if (v.problem) refused = v.problem;
    else found.set(v.current, suiteCandidate(/** @type {VetSuiteResult & { current: string, shared_with: string[] }} */ (v), "named", { ...found.get(v.current)?.evidence, named: asked }));
  }
  /** @type {Record<"strong" | "weak" | "named", number>} */
  const rank = { strong: 0, weak: 1, named: 2 };
  return { list: [...found.values()].sort((a, b) => rank[a.strength] - rank[b.strength] || byKey(a.tracker, b.tracker)), refused };
}
/** @param {string} a @param {string} b */
const byKey = (a, b) => a.localeCompare(b, "en", { numeric: true });

/**
 * @param {SyncAttachContext} ctx
 * @returns {AttachCardItem[]}
 */
function suiteItems(ctx) {
  /** @type {AttachCardItem[]} */
  const items = [];
  for (const e of suiteEntriesOf(ctx)) {
    if (!attachable(e)) continue;
    const { list } = suiteCandidatesFor(ctx, e);
    if (!list.length) continue;
    const named = list.find((c) => c.strength === "named");
    const chosen = named ?? (list.length === 1 ? list[0] : null);
    items.push({ code: "attach_suite", kind: "suite", key: e.key, feature: e.feature, file: e.file, summary: e.summary, candidates: list, tracker: chosen?.tracker ?? null, needs: chosen ? [] : ["tracker"], edits: ["tracker"],
      message: `attach an existing tracker Test Suite to \`${e.key}\` as its \`mirror.suite\`, and queue its remark to \`${e.suiteKey}\` for \`/qa-publish\`` });
  }
  return items;
}

/**
 * @param {SyncAttachContext} ctx
 * @param {AttachCardItem} item
 * @param {SyncAttachPlan} plan
 * @returns {{ code: string, [key: string]: unknown } | null}
 */
function applySuite(ctx, item, plan) {
  const e = suiteEntryNamed(ctx, item.key);
  if (!e) return { code: "no_entry", key: item.key };
  if (!item.tracker) return { code: "needs_edit", message: `choose the tracker Test Suite to attach to \`${item.key}\` (edit item ${item.n} with \`tracker\`)` };
  if (!item.candidates.some((c) => c.tracker === item.tracker)) return { code: "attach_not_candidate", entry: item.key, tracker: item.tracker, message: `\`${item.tracker}\` is not one of the Card's candidates: name it in the Reply so it is fetched first` };
  return writeSuiteAttach(ctx, e, item.tracker, plan, item.n);
}

// Attaching tracker Suite `tracker` to Feature entry `e` in `plan`, for Card item `n`: null, or the
// refusal fact.
/**
 * @param {SyncAttachContext} ctx
 * @param {SuiteAttachEntry} e
 * @param {string} tracker
 * @param {SyncAttachPlan} plan
 * @param {unknown} n
 * @returns {{ code: string, [key: string]: unknown } | null}
 */
function writeSuiteAttach(ctx, e, tracker, plan, n) {
  if (e.suiteKey === null) return { code: "attach_suite_key_missing", entry: e.key };
  if (e.recorded !== null) return { code: "attach_suite_recorded", entry: e.key, tracker, current: e.recorded };
  const v = vetSuite(ctx, e, tracker);
  if (v.problem) return v.problem;
  // A Suite may be shared, but two Features remarking it in one run would contend for its mark.
  const clash = plan.claim(`suite:${v.current}`, n);
  if (clash) return clash;
  const { at: _at, ...kept } = isMap(e.data.mirror) ? /** @type {Record<string, unknown>} */ (e.data.mirror) : {};
  plan.set({ file: e.file }, "mirror", { ...kept, suite: v.current, at: ctx.tracker.at });
  if (v.item.mark?.trim() !== e.suiteKey) {
    const pending = /** @type {Array<{ tracker?: string, [key: string]: unknown }>} */ (plan.frontmatter.get(e.file)?.get("repairs") ?? e.data.repairs ?? []);
    const remark = { kind: "remark", tracker: v.current, key: e.suiteKey };
    plan.set({ file: e.file }, "repairs", [...pending.filter((r) => r.tracker !== v.current), remark]);
  }
  if (v.retires) {
    const project = /** @type {{ rel: string, data: { retired_features?: string[], [key: string]: unknown } }} */ (ctx.index.project);
    const retired = /** @type {string[]} */ (plan.frontmatter.get(project.rel)?.get("retired_features") ?? stringsIn(project.data.retired_features));
    plan.set({ file: project.rel }, "retired_features", [...new Set([...retired, v.retires])]);
  }
  return null;
}

// An Unlanded Suite's Attach (lib/sync-unlanded.mjs): tracker Suite `tracker` attached to Feature
// `feature`, anywhere in the project, as a Card's Suite Attach would.
/**
 * @param {SyncAttachContext} ctx
 * @param {string} feature
 * @param {string} tracker
 * @param {SyncAttachPlan} plan
 * @param {unknown} n
 * @returns {{ code: string, [key: string]: unknown } | null}
 */
export function attachUnlandedSuite(ctx, feature, tracker, plan, n) {
  const e = suiteEntry(ctx, feature);
  return e ? writeSuiteAttach(ctx, e, tracker, plan, n) : { code: "needs_edit", field: "feature" };
}

// What `sync scope` names for a Suite Attach: the Suites the engineer named (`suite_items`), and,
// for each attachable Feature, the linked Scenarios whose Suite to fetch and the title a Suite's
// summary may resemble (`suite_search`).
/**
 * @param {SyncAttachContext} ctx
 * @returns {{ suite_items: string[], suite_search: Array<{ feature: string, summary: string | null, scenarios: string[] }> }}
 */
export function suiteScope(ctx) {
  const entries = suiteEntriesOf(ctx);
  const items = Object.entries(ctx.named ?? {}).filter(([entry]) => entries.some((e) => e.key === entry && attachable(e))).map(([, key]) => key);
  const search = entries.filter(attachable).map((e) => ({ feature: e.key, summary: e.summary ?? null, scenarios: linkedScenarios(ctx, e).sort(byKey) })).filter((s) => s.summary || s.scenarios.length);
  return { suite_items: [...new Set(items)].sort(byKey), suite_search: search };
}

/** @type {AttachSection} */
export const attach = {
  key: "attach",
  title: "Attach",
  codes: ["attach_tracker", "correct_tracker", "attach_suite"],
  tracker: true,
  only: (ctx) => attach.items(ctx).length > 0,
  items(ctx) {
    if (ctx.attachItems) return ctx.attachItems;
    /** @type {AttachCardItem[]} */
    const items = [];
    for (const e of entriesOf(ctx)) {
      const where = { kind: e.kind, key: e.key, feature: e.feature, file: e.file, summary: e.summary };
      const { list } = candidatesFor(ctx, e);
      if (linked(e)) {
        const asked = list.find((c) => c.strength === "named");
        if (!asked) continue;
        items.push({ code: "correct_tracker", ...where, wrong: e.data.tracker, tracker: asked.tracker, candidates: [asked], needs: [], edits: [],
          message: `\`${e.key}\` is linked to \`${e.data.tracker}\` in error: retire \`${trackerReference(/** @type {string} */ (e.data.tracker))}\` in \`${e.feature}\` and attach \`${asked.tracker}\`` });
        continue;
      }
      if (!unlinked(ctx, e) || !list.length) continue;
      const named = list.find((c) => c.strength === "named");
      const chosen = named ?? (list.length === 1 ? list[0] : null);
      items.push({ code: "attach_tracker", ...where, candidates: list, tracker: chosen?.tracker ?? null, needs: chosen ? [] : ["tracker"], edits: ["tracker"],
        message: `attach an existing tracker ${e.kind} to \`${e.key}\` as its \`tracker:\`: the Key stays` });
    }
    return (ctx.attachItems = [...items, ...suiteItems(ctx)]);
  },
  apply(ctx, item, plan) {
    if (item.code === "attach_suite") return applySuite(ctx, item, plan);
    const e = entryNamed(ctx, item.key);
    if (!e) return { code: "no_entry", key: item.key };
    if (item.code === "attach_tracker" && !item.tracker) return { code: "needs_edit", message: `choose the tracker ${item.kind} to attach to \`${item.key}\` (edit item ${item.n} with \`tracker\`)` };
    if (!item.candidates.some((c) => c.tracker === item.tracker)) return { code: "attach_not_candidate", entry: item.key, tracker: item.tracker, message: `\`${item.tracker}\` is not one of the Card's candidates: name it in the Reply so it is fetched first` };
    const v = vet(ctx, e, /** @type {string} */ (item.tracker));
    if (v.problem) return v.problem;
    const clash = plan.claim(v.current, item.n);
    if (clash) return clash;
    if (item.code === "correct_tracker") plan.retire(featureFile(ctx.index, e.feature).rel, trackerReference(/** @type {string} */ (e.data.tracker)));
    plan.set(e.ref, "tracker", v.current);
    return null;
  },
};

// The named keys the Card could not use, for its notes: the fetched item was not found, belongs to
// the other kind, carries another mark, or is already owned.
/**
 * @param {SyncAttachContext} ctx
 * @returns {Array<AttachRefusalProblem & { code: "attach_named_refused", entry: string, tracker: string, reason?: string, message: string }>}
 */
export function attachNotes(ctx) {
  if (!ctx.tracker.ok) return [];
  /** @type {Array<AttachRefusalProblem & { code: "attach_named_refused", entry: string, tracker: string, reason?: string, message: string }>} */
  const notes = [];
  for (const e of entriesOf(ctx)) {
    const asked = ctx.named?.[e.key];
    if (asked === undefined) continue;
    const { refused } = candidatesFor(ctx, e);
    if (refused) notes.push({ ...refused, code: "attach_named_refused", entry: e.key, tracker: asked, reason: refused.code, message: `\`${asked}\` cannot be attached to \`${e.key}\` (${refused.code})` });
  }
  for (const e of suiteEntriesOf(ctx)) {
    const asked = ctx.named?.[e.key];
    if (asked === undefined || e.suiteKey === null) continue;
    const { refused } = suiteCandidatesFor(ctx, e);
    if (refused) notes.push({ ...refused, code: "attach_named_refused", entry: e.key, tracker: asked, reason: refused.code, message: `\`${asked}\` cannot be attached to \`${e.key}\` as its Test Suite (${refused.code})` });
  }
  return notes;
}

// A Reply naming keys: `named` is `{entry Key: tracker key}`. Nothing is attached by the Reply itself:
// each key is checked against `.qa/` alone, kept in the run for `sync scope` to list, and the Card
// is built again once the scout has fetched it. `{refused}`, always.
/**
 * @param {SyncAttachContext} ctx
 * @param {Record<string, string>} named
 * @returns {{ problems?: AttachRefusalProblem[], named?: Array<{ entry: string, tracker: string, fetched: boolean }> }}
 */
export function nameKeys(ctx, named) {
  /** @type {AttachRefusalProblem[]} */
  const problems = [];
  for (const [key, tracker] of Object.entries(named)) {
    const e = entryNamed(ctx, key);
    const suite = e ? null : suiteEntryNamed(ctx, key);
    const owned = () => ctx.index.tracker.resolve(tracker).status;
    if (!e && !suite) problems.push({ code: "attach_unknown_entry", entry: key });
    else if (suite?.suiteKey === null) problems.push({ code: "attach_suite_key_missing", entry: key });
    else if (!ctx.config.trackerPattern?.test(tracker)) problems.push({ code: "attach_bad_key", entry: key, tracker });
    else if (suite && suite.recorded !== null) problems.push({ code: "attach_suite_recorded", entry: key, tracker, current: suite.recorded });
    else if (owned() !== "absent") problems.push({ code: "attach_owned", entry: key, tracker, status: owned() });
  }
  if (problems.length) return { problems };
  const path = join(ctx.dir, ATTACH_FILE);
  const kept = { ...ctx.named, ...named };
  writeFileSync(path, `${JSON.stringify(/** @type {AttachFileRecord} */ ({ named: kept }), null, 2)}\n`);
  ctx.named = kept;
  const fetched = (/** @type {string} */ entry, /** @type {string} */ tracker) => ctx.tracker.ok && (entryNamed(ctx, entry) ? vet(ctx, /** @type {AttachEntry} */ (entryNamed(ctx, entry)), tracker) : vetSuite(ctx, /** @type {SuiteAttachEntry} */ (suiteEntryNamed(ctx, entry)), tracker)).problem?.code !== "attach_not_fetched";
  return { named: Object.entries(named).map(([entry, tracker]) => ({ entry, tracker, fetched: fetched(entry, tracker) })) };
}
