// @ts-check
// The one write of `/qa-sync`. Sections record what an accepted item
// changes; `render()` then renders every file, checks every one, and returns them as a Changeset
// (lib/changeset.mjs), which sync writes all or none. The plan writes nothing:
// a file the plan creates is `absent`, so a file that has appeared since is refused at write time as well. Every file is
// checked first:
//   - each `.qa/` file through `check-file` (ADR-0008), blocking on any error;
//   - each source file re-parsed by the stack's adapter (lib/stack.mjs), so a key that would land
//     on the wrong function (or on none) blocks the write instead of mis-binding.
// Automation keys are minted in one batch at write time (one per Key prefix, ADR-0013), so they are
// unique against `.qa/`, the code and each other (lib/mint.mjs). Nothing is staged or committed.
//
// The `.qa/` edits: a case's `automates`; any field of a case block or of a frontmatter
// (`mirror`, `formerly`, `tracker`); and Test Cases appended to a scenario file, new or existing. Every edit goes through
// lib/knowledge-file.mjs's `edit`, which refuses a value the dialect cannot hold.
/** @import { Changeset } from "./changeset.mjs" */
/** @import { EditChange, ParsedEntry, ParsedFile, ProjectConfig } from "./knowledge-file.mjs" */
/** @import { MintedKeys } from "./mint.mjs" */
/** @import { HistorySection } from "./scan-history.mjs" */
/** @import { ScanContext } from "./scan.mjs" */
/** @import { StrippableFile } from "./stripped.mjs" */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { changedPaths } from "./changeset.mjs";
import { checkFile, edit, parse } from "./knowledge-file.mjs";
import { mint } from "./mint.mjs";
import { PATTERN, trackerReference } from "./keys.mjs";
import { buildIndex, featureFile, rootConfig } from "./qa-index.mjs";
import { run as history } from "./scan-history.mjs";
import { claimProjection } from "./stripped.mjs";
import { retiredWith } from "./tombstones.mjs";

const MAX_RESERVE = 100;

/**
 * A finding a case carries: the dismissal that settles it and the case it was dismissed for.
 * @typedef {{
 *   dismissed?: unknown,
 *   dismissed_case?: string,
 *   [key: string]: unknown,
 * }} PlanFinding
 */

/**
 * A Test Case the plan reads: its key, its summary, the lines it sits on and its block's values.
 * @typedef {{
 *   key: string,
 *   summary: string,
 *   line: number,
 *   end: number,
 *   data: Record<string, unknown>,
 *   [key: string]: unknown,
 * }} PlanCase
 */

/**
 * A `.qa/` file the plan reads: its path, its kind, its text, its frontmatter values and its Test
 * Cases.
 * @typedef {{
 *   rel: string,
 *   type?: string | null,
 *   text: string,
 *   data: Record<string, unknown>,
 *   cases: PlanCase[],
 *   [key: string]: unknown,
 * }} PlanFile
 */

/**
 * A Case's declaration in the index the plan reads: the file it is declared in, the line, the
 * Feature it belongs to, the Scenario it sits under and the entry itself.
 * @typedef {{
 *   file: PlanFile,
 *   line: number,
 *   feature?: string | null,
 *   scenario?: string | null,
 *   entry: PlanCase,
 * }} PlanCaseDecl
 */

/**
 * A Scenario's declaration in the index the plan reads: the file it is declared in, the line and the
 * Feature it belongs to.
 * @typedef {{
 *   file: PlanFile,
 *   line: number,
 *   feature?: string | null,
 * }} PlanScenarioDecl
 */

/**
 * A Feature's declaration in the index the plan reads: the file it is declared in and the line.
 * @typedef {{
 *   file: PlanFile,
 *   line: number,
 * feature?: string | null,
 * }} PlanFeatureDecl
 */

/**
 * The Key index the plan reads: the declarations of the Cases, Scenarios and Features it changes.
 * @typedef {{
 *   cases: Map<string, PlanCaseDecl[]>,
 *   scenarios: Map<string, PlanScenarioDecl[]>,
 *   features: Map<string, PlanFeatureDecl[]>,
 * }} PlanIndex
 */

/**
 * A case's edits: the entry it edits, the keys added, the automations removed, the automations
 * replaced, the fields set, and whether the entry is deleted.
 * @typedef {{
 *   entry: PlanCase,
 *   add: string[],
 *   remove: Set<string>,
 *   replace: Map<string, string>,
 *   set: Map<string, unknown>,
 *   deleted?: boolean,
 * }} PlanCaseOps
 */

/**
 * A function the plan annotates or rekeys: the file it is in, the line, the class it belongs to and
 * its name.
 * @typedef {{
 *   file: string,
 *   line: number,
 *   class: string,
 *   name: string,
 * }} PlanFunction
 */

/**
 * A key to mint: the key itself (filled in by `render`), the item it is for, the function it binds
 * and the cases it binds.
 * @typedef {{
 *   key: string | null,
 *   item: number,
 *   function: PlanFunction,
 *   bind: string[],
 *   prefix?: string,
 * }} PlanKey
 */

/**
 * A Key prefix an item proposed: the class it is proposed for, or the file, and the prefix itself.
 * @typedef {{
 *   class?: { file: string, path: string },
 *   file?: string,
 *   prefix: string,
 *   proposed?: boolean,
 * }} PlanKeyPrefix
 */

/**
 * The code ops of one file: the functions annotated, the functions rekeyed, the classes that carry
 * a Key prefix, and the file's header prefix.
 * @typedef {{
 *   annotate: { fn: PlanFunction, handle: PlanKey }[],
 *   rekey: { kind: "function", fn: PlanFunction, from: string, handle: PlanKey }[],
 *   prefix: { cls: { file: string, path: string }, prefix: string }[],
 *   header: { prefix: string }[],
 * }} PlanCodeOps
 */

/**
 * The Key carrier the plan writes: the carrier's name, every name the key is read under, where the
 * carrier is declared, and the Key-prefix class carrier (lib/sync-code.mjs's `annotation`).
 * @typedef {{
 *   name?: string | null,
 *   names?: string[],
 *   home?: unknown,
 *   prefix?: { name?: string, home?: unknown },
 * }} PlanAnnotation
 */

/**
 * The stack adapter the plan renders code with: whether its carriers need a declaration, the
 * declaration itself, and its render.
 * @typedef {{
 *   needsDeclaration?: boolean,
 *   declaration?: { unimported: (name: string) => string, [key: string]: unknown },
 *   render: (text: string, ops: PlanCodeOps, annotation: PlanAnnotation, path: string) => { text: string, errors: { kind: string, message: string }[] },
 *   [key: string]: unknown,
 * }} PlanAdapter
 */

/**
 * A tracker item the plan reads: the mark it carries.
 * @typedef {{
 *   mark?: string,
 *   [key: string]: unknown,
 * }} PlanTrackerItem
 */

/**
 * The tracker state the plan reads: the cases and scenarios it holds, by tracker key, and the
 * marked ones.
 * @typedef {{
 *   cases?: Map<string, PlanTrackerItem>,
 *   scenarios?: Map<string, PlanTrackerItem>,
 *   markedCases?: Map<string, PlanTrackerItem>,
 *   markedScenarios?: Map<string, PlanTrackerItem>,
 * }} PlanTracker
 */

/**
 * A durable repair a Merge leaves: the kind of repair, the tracker key it is about and the Key it
 * settles on.
 * @typedef {{
 *   kind?: string,
 *   tracker?: string,
 *   key?: string | null,
 *   [key: string]: unknown,
 * }} PlanRepair
 */

/**
 * A declaration a Merge reads: the Feature it belongs to, the entry it holds and the file it is
 * declared in.
 * @typedef {{
 *   feature?: string | null,
 *   entry?: { data: Record<string, unknown>, [key: string]: unknown },
 *   file?: { data: Record<string, unknown>, [key: string]: unknown },
 *   [key: string]: unknown,
 * }} PlanMergeDecl
 */

/**
 * A pair of duplicate items a Merge proposes: the kind of items, the survivor (null until the
 * engineer chooses) and the disposition of a distinct tracker key.
 * @typedef {{
 *   cases?: string[],
 *   scenarios?: string[],
 *   survivor: string | null,
 *   tracker_disposition: "keep" | "retire" | null,
 *   [key: string]: unknown,
 * }} PlanMergePair
 */

/**
 * What a Merge proposes: the merged entry, the repairs it leaves and the retirements it makes, or
 * the error that stopped it.
 * @typedef {{
 *   ok: false,
 *   error: { code: string, survivor: string | null, loser: string | undefined, [key: string]: unknown },
 * } | {
 *   ok: true,
 *   result: {
 *     key: string,
 *     summary?: string,
 *     data?: Record<string, unknown>,
 *     text: string,
 *     cases?: { key: string, summary?: string, data: Record<string, unknown> }[],
 *   },
 *   repairs: PlanRepair[],
 *   retired: string[],
 *   review?: unknown,
 *   case_merges?: PlanMergePair[],
 *   dependencies?: { file: string, field: string, before: PlanRepair[], after: PlanRepair[] }[],
 * }} PlanMergeOutcome
 */

/**
 * The frontmatter values of a case or scenario a Merge reads: its tracker key, the keys it was
 * known under, and the fields a Merge carries over.
 * @typedef {{
 *   tracker?: string,
 *   tracker_formerly?: string[],
 *   formerly?: string[],
 *   automates?: unknown[],
 *   covers?: unknown[],
 *   relies_on?: unknown[],
 *   finding?: PlanFinding[],
 *   [key: string]: unknown,
 * }} PlanMergeData
 */

/**
 * The context the plan records its changes on: the `.qa/` root, the repository under test, the
 * parsed files, the Key index, the tracker state, the stack adapter, the project's settings and the
 * Feature the run is scoped to. Each caller keeps its own context (lib/sync.mjs's `SyncContext`,
 * lib/sync-merge.mjs's `SyncMergeContext`); this is what the plan reads of it.
 * @typedef {{
 *   root: string,
 *   repo: string,
 *   seed?: string,
 *   files: PlanFile[],
 *   index: PlanIndex,
 *   tracker?: PlanTracker,
 *   stack: { adapter?: PlanAdapter | null },
 *   config: ProjectConfig,
 *   feature?: string,
 *   repoPath: (rel: string) => string,
 * }} PlanContext
 */

/**
 * A problem the plan found: its code, what it is about and what it says.
 * @typedef {{
 *   code: string,
 *   message: string,
 *   [key: string]: unknown,
 * }} PlanError
 */

/**
 * The Changeset the plan renders: the files it writes and the ones it deletes (lib/changeset.mjs's
 * `Changeset`, whose every write carries its text).
 * @typedef {Changeset & { writes: { path: string, text: string, absent?: boolean }[] }} PlanChangeset
 */

/**
 * What the plan renders: the Changeset to write and the paths it touches, or the errors that
 * stopped it.
 * @typedef {{
 *   ok: false,
 *   errors: PlanError[],
 * } | {
 *   ok: true,
 *   warnings: PlanError[],
 *   changeset: PlanChangeset,
 *   paths: string[],
 * }} PlanRendered
 */

export class Plan {
  // `annotation` is `{name, names, home, prefix?}` (lib/sync-code.mjs): the Key carrier to write,
  // every name the key is read under, where the carrier is declared (null until something declares
  // it), and the Key-prefix class carrier's `{name, home}`.
  /**
   * @param {PlanContext | Record<string, unknown>} ctx
   * @param {PlanAnnotation} annotation
   */
  constructor(ctx, annotation) {
    this.ctx = /** @type {PlanContext} */ (ctx);
    this.annotation = annotation;
    this.adapter = /** @type {PlanContext} */ (ctx).stack.adapter;
    this.pendingKeys = /** @type {PlanKey[]} */ ([]); // keys to mint: {key: null, item, function, bind}
    this.code = /** @type {Map<string, PlanCodeOps>} */ (new Map()); // repo path → {annotate: [{fn, handle}], rekey: [{fn, from, handle}], prefix: [{cls, prefix}], header: [{prefix}]}
    this.prefixes = /** @type {Map<string, string>} */ (new Map()); // `file:path` of a class → the Key prefix written on it this run
    this.created = /** @type {Map<string, string>} */ (new Map()); // repo path → text
    this.qa = /** @type {Map<string, Map<number, PlanCaseOps>>} */ (new Map()); // `.qa/` path → Map case line → {entry, add: [], remove: Set, replace: Map, set: Map}
    this.frontmatter = /** @type {Map<string, Map<string, unknown>>} */ (new Map()); // `.qa/` path → Map field → value
    this.appends = /** @type {Map<string, string[]>} */ (new Map()); // `.qa/` path → [entry text]
    this.deletedQa = /** @type {Set<string>} */ (new Set()); // losing Scenario files, removed with their retirement
    this.mergedScenarios = /** @type {Set<string>} */ (new Set()); // both files of an accepted Scenario Merge
    this.createdQa = /** @type {Map<string, { text: string, item: number }>} */ (new Map()); // new `.qa/` path → {text, item}: item is the intake taking it in
    this.claimed = /** @type {Map<string, number>} */ (new Map()); // key an intake brings into `.qa/` → the item bringing it
    this.placed = /** @type {Map<string, string>} */ (new Map()); // tracker Scenario key → the `.qa/` path its file is written at this run
    this.intaken = /** @type {Array<{ kind: string, key: string, tracker: string, reused: boolean }>} */ ([]); // {kind, key, tracker, reused}: each Key an intake wrote, for the report
  }

  // Claims a key an item brings into `.qa/`: two accepted items may not bring the same one.
  /**
   * @param {string} key
   * @param {number} item
   * @returns {PlanError | null}
   */
  claim(key, item) {
    const other = this.claimed.get(key);
    if (other !== undefined) return { code: "key_collision", key, item, other, message: `item ${other} already brings \`${key}\` into \`.qa/\`: drop one of them` };
    this.claimed.set(key, item);
    return null;
  }

  // The permanent Key an intake writes (ADR-0027): `reuse`, the Key an Unlanded case's mark already
  // holds, else a fresh `tc_`/`ts_` that is unique against `.qa/` (lib/mint.mjs) and against every
  // Key another accepted item has claimed. `{key}` or `{error}`.
  /**
   * @param {string} kind
   * @param {string | undefined} reuse
   * @returns {{ key: string, error?: never } | { error: string, key?: never }}
   */
  permanentKey(kind, reuse) {
    if (reuse) return { key: reuse };
    for (let count = 1; count <= MAX_RESERVE; count++) {
      const r = mint(kind, { root: this.ctx.root, count, seed: this.ctx.seed });
      if (r.error) return { error: r.error };
      const key = /** @type {MintedKeys} */ (r).keys.find((k) => !this.claimed.has(k));
      if (key) return { key };
    }
    return { error: `could not reserve a ${kind}_ Key not already brought in by another item` };
  }

  // Sets a field of a case block (`ref` as for `caseOps`) or of a file's frontmatter (`{file}`).
  // `undefined` removes it.
  /**
   * @param {{ file?: string, key?: string }} ref
   * @param {string} field
   * @param {unknown} value
   * @returns {void}
   */
  set(ref, field, value) {
    if (ref.key === undefined) {
      if (!this.frontmatter.has(/** @type {string} */ (ref.file))) this.frontmatter.set(/** @type {string} */ (ref.file), new Map());
      /** @type {Map<string, unknown>} */ (this.frontmatter.get(/** @type {string} */ (ref.file))).set(field, value);
    } else {
      this.caseOps(ref).set.set(field, value);
    }
  }

  // Records `entry` (a bare Key, or `tracker:DEMO-31`) in the Feature file `rel`'s `retired:`,
  // after what it holds and what earlier items of this run added.
  /**
   * @param {string} rel
   * @param {string} entry
   * @returns {void}
   */
  retire(rel, entry) {
    const kept = this.frontmatter.get(rel)?.get("retired") ?? this.ctx.files.find((f) => f.rel === rel)?.data.retired;
    this.set({ file: rel }, "retired", retiredWith(kept, [entry]));
  }

  // Case Merge keeps the survivor's claim and permanent Key (ADR-0027). Rendering remains
  // network-free; the losing entry is removed in the same Changeset as its tombstone.
  // A distinct losing Tracker key needs `trackerDisposition: keep | retire`. Returns `{ok,
  // result, review, repairs, retired}` for the Card, or `{ok: false, error}` without staging it.
  /**
   * @param {{ survivor: string | null, loser?: string, trackerDisposition: "keep" | "retire" | null }} arg
   * @returns {PlanMergeOutcome}
   */
  mergeCase({ survivor, loser, trackerDisposition }) {
    if (survivor === loser || ![survivor, loser].every((key) => PATTERN.case.test(/** @type {string} */ (key)) && this.ctx.index.cases.get(/** @type {string} */ (key))?.length === 1)) {
      return { ok: false, error: { code: "merge_identity", survivor, loser } };
    }
    const s = /** @type {PlanCaseDecl[]} */ (this.ctx.index.cases.get(/** @type {string} */ (survivor)))[0];
    const l = /** @type {PlanCaseDecl[]} */ (this.ctx.index.cases.get(/** @type {string} */ (loser)))[0];
    if (s.feature !== l.feature) return { ok: false, error: { code: "merge_cross_feature", survivor, loser } };
    if ([s, l].some((d) => this.qa.get(d.file.rel)?.has(d.line) || this.mergedScenarios.has(d.file.rel))) return { ok: false, error: { code: "merge_pending_edit", survivor, loser } };
    const distinct = l.entry.data.tracker && l.entry.data.tracker !== s.entry.data.tracker;
    if (distinct && !["keep", "retire"].includes(/** @type {string} */ (trackerDisposition))) return { ok: false, error: { code: "merge_disposition", survivor, loser } };
    this.caseOps({ key: /** @type {string} */ (survivor) });
    for (const field of ["automates", "covers", "relies_on"]) {
      const union = [...new Set([...(/** @type {unknown[]} */ (s.entry.data[field]) ?? []), ...(/** @type {unknown[]} */ (l.entry.data[field]) ?? [])])];
      if (union.length) this.set({ key: /** @type {string} */ (survivor) }, field, union);
    }
    const { repairs, retired } = this.mergeTracker({ kind: "case", s: /** @type {PlanMergeData} */ (s.entry.data), l: /** @type {PlanMergeData} */ (l.entry.data),
      ref: { key: /** @type {string} */ (survivor) }, feature: s.feature, survivor, loser, trackerDisposition });
    const findings = [...(/** @type {PlanFinding[]} */ (s.entry.data.finding) ?? []), ...(/** @type {PlanFinding[]} */ (l.entry.data.finding) ?? [])];
    if (findings.length) this.set({ key: /** @type {string} */ (survivor) }, "finding", findings);
    this.caseOps({ key: /** @type {string} */ (loser) }).deleted = true;
    let out = renderQa(s.file.rel, s.file.text, { cases: /** @type {Map<number, PlanCaseOps>} */ (this.qa.get(s.file.rel)), appends: [] });
    let file = parse(s.file.rel, /** @type {string} */ (out.text));
    let entry = /** @type {ParsedEntry} */ (file.cases.find((c) => c.key === survivor));
    const original = historyOf(this.ctx, this.ctx.files).dismissals.filter((d) => d.key === loser);
    const sameClaim = claimProjection(/** @type {StrippableFile} */ (file)).cases.get(/** @type {string} */ (survivor)) === claimProjection(/** @type {StrippableFile} */ (l.file), {
      identity: (scope, field, value) => scope === "case" && field === "key" && value === loser ? survivor : value,
    }).cases.get(/** @type {string} */ (loser));
    let from = 0;
    const carried = (/** @type {PlanFinding[]} */ (l.entry.data.finding ?? [])).map((f) => {
      if (!f.dismissed) return f;
      const before = original[from++];
      if (before?.status === "holds" && sameClaim) return { ...f, dismissed_case: f.dismissed_case ?? loser };
      const { dismissed: _stamp, dismissed_case: _origin, ...open } = f;
      return open;
    });
    if (carried.length) {
      this.set({ key: /** @type {string} */ (survivor) }, "finding", [...(/** @type {PlanFinding[]} */ (s.entry.data.finding) ?? []), ...carried]);
      out = renderQa(s.file.rel, s.file.text, { cases: /** @type {Map<number, PlanCaseOps>} */ (this.qa.get(s.file.rel)), appends: [] });
      file = parse(s.file.rel, /** @type {string} */ (out.text));
      entry = /** @type {ParsedEntry} */ (file.cases.find((c) => c.key === survivor));
    }
    const files = this.ctx.files.map((f) => this.qa.has(f.rel) ? parse(f.rel,
      /** @type {string} */ (renderQa(f.rel, f.text, { cases: /** @type {Map<number, PlanCaseOps>} */ (this.qa.get(f.rel)), appends: [] }).text)) : f);
    const facts = historyOf(this.ctx, files);
    return { ok: true, result: { key: /** @type {string} */ (survivor), summary: entry.summary, data: entry.data,
      text: file.text.split(/\r?\n/).slice(entry.line - 1, entry.end).join("\n").trimEnd() },
      repairs, retired, review: facts.reviews.find((r) => r.key === survivor) ?? null };
  }

  // Case and Scenario Merges use the same tracker disposition, aliases and durable repairs.
  /**
   * @param {{
   *   kind: "case" | "scenario",
   *   s: PlanMergeData,
   *   l: PlanMergeData,
   *   ref: { file?: string, key?: string },
   *   feature: string | null | undefined,
   *   survivor: string | null,
   *   loser: string | undefined,
   *   trackerDisposition: "keep" | "retire" | null,
   * }} arg
   * @returns {{ repairs: PlanRepair[], retired: string[] }}
   */
  mergeTracker({ kind, s, l, ref, feature, survivor, loser, trackerDisposition }) {
    const distinct = l.tracker && l.tracker !== s.tracker;
    const tracker = s.tracker ?? (trackerDisposition === "keep" ? l.tracker : undefined);
    if (tracker !== s.tracker) this.set(ref, "tracker", tracker);
    for (const field of ["tracker_formerly", "formerly"]) {
      const union = [...new Set([...(/** @type {string[]} */ (s[field]) ?? []), ...(/** @type {string[]} */ (l[field]) ?? [])])];
      if (union.length) this.set(ref, field, union);
    }
    const aliases = [...new Set([...(s.tracker_formerly ?? []), ...(l.tracker_formerly ?? []),
      ...(distinct && trackerDisposition === "keep" ? [l.tracker] : [])])].filter((k) =>
      k !== tracker && !(distinct && trackerDisposition === "retire" && k === l.tracker));
    if (aliases.length || s.tracker_formerly || l.tracker_formerly) this.set(ref, "tracker_formerly", aliases);
    const home = featureFile(this.ctx.index, /** @type {string} */ (feature));
    this.retire(home.rel, /** @type {string} */ (loser));
    const pending = /** @type {PlanRepair[]} */ (this.frontmatter.get(home.rel)?.get("repairs") ?? home.data.repairs ?? []);
    /** @type {PlanRepair[]} */
    let repairs = pending.filter((r) => r.kind === "remark" && r.key === loser).map((r) => ({ ...r, key: survivor }));
    const trackers = [tracker, ...aliases].filter(Boolean);
    for (const tracker of trackers) {
      const item = this.ctx.tracker?.[kind === "case" ? "cases" : "scenarios"]?.get(/** @type {string} */ (tracker))
        ?? this.ctx.tracker?.[kind === "case" ? "markedCases" : "markedScenarios"]?.get(/** @type {string} */ (tracker));
      if (item?.mark && item.mark !== survivor) repairs.push({ kind: "remark", tracker, key: survivor });
    }
    const retired = [/** @type {string} */ (loser)];
    if (distinct && trackerDisposition === "retire") {
      retired.push(trackerReference(/** @type {string} */ (l.tracker)));
      this.retire(home.rel, retired[1]);
      repairs.push({ kind: "retire", tracker: l.tracker });
    }
    if (repairs.length) {
      repairs = [...new Map(repairs.map((r) => [/** @type {string} */ (r.tracker), r])).values()];
      this.set({ file: home.rel }, "repairs", [...new Map([...pending, ...repairs].map((r) => [/** @type {string} */ (r.tracker), r])).values()]);
    }
    return { repairs, retired };
  }

  // Scenario Merge moves children without changing their claims or human stamps.
  /**
   * @param {{ survivor: string | null, loser?: string, trackerDisposition: "keep" | "retire" | null }} arg
   * @returns {PlanMergeOutcome}
   */
  mergeScenario({ survivor, loser, trackerDisposition }) {
    if (survivor === loser || ![survivor, loser].every((key) => PATTERN.scenario.test(/** @type {string} */ (key)) && this.ctx.index.scenarios.get(/** @type {string} */ (key))?.length === 1)) {
      return { ok: false, error: { code: "merge_identity", survivor, loser } };
    }
    const s = /** @type {PlanScenarioDecl[]} */ (this.ctx.index.scenarios.get(/** @type {string} */ (survivor)))[0];
    const l = /** @type {PlanScenarioDecl[]} */ (this.ctx.index.scenarios.get(/** @type {string} */ (loser)))[0];
    if (s.feature !== l.feature) return { ok: false, error: { code: "merge_cross_feature", survivor, loser } };
    if ([s, l].some((d) => [this.qa, this.frontmatter, this.appends, this.createdQa, this.mergedScenarios].some((m) => m.has(d.file.rel)))) {
      return { ok: false, error: { code: "merge_pending_edit", survivor, loser } };
    }
    const conflict = [...s.file.cases, ...l.file.cases].find((c) => this.ctx.index.cases.get(c.key)?.length !== 1);
    if (conflict) return { ok: false, error: { code: "duplicate_key", key: conflict.key, survivor, loser } };
    const distinct = l.file.data.tracker && l.file.data.tracker !== s.file.data.tracker;
    if (distinct && !["keep", "retire"].includes(/** @type {string} */ (trackerDisposition))) return { ok: false, error: { code: "merge_disposition", survivor, loser } };
    const { repairs, retired } = this.mergeTracker({ kind: "scenario", s: s.file.data, l: l.file.data,
      ref: { file: s.file.rel }, feature: s.feature, survivor, loser, trackerDisposition });
    const dependencies = [];
    for (const f of this.ctx.files.filter((f) => f.type === "feature")) {
      const before = /** @type {PlanRepair[]} */ (this.frontmatter.get(f.rel)?.get("repairs") ?? f.data.repairs ?? []);
      if (!before.some((r) => r.kind === "remark" && r.key === loser)) continue;
      const after = before.map((r) => r.kind === "remark" && r.key === loser ? { ...r, key: survivor } : r);
      this.set({ file: f.rel }, "repairs", after);
      dependencies.push({ file: f.rel, field: "repairs", before, after });
    }
    for (const c of l.file.cases) this.append(s.file.rel,
      l.file.text.split(/\r?\n/).slice(c.line - 1, c.end).join("\n"));
    this.deletedQa.add(l.file.rel);
    this.mergedScenarios.add(s.file.rel);
    this.mergedScenarios.add(l.file.rel);
    const out = renderQa(s.file.rel, s.file.text, { cases: this.qa.get(s.file.rel) ?? new Map(),
      frontmatter: this.frontmatter.get(s.file.rel), appends: this.appends.get(s.file.rel) ?? [] });
    const file = parse(s.file.rel, /** @type {string} */ (out.text));
    return { ok: true, result: { key: /** @type {string} */ (survivor), summary: file.h1?.text, data: file.data,
      cases: file.cases.map((c) => ({ key: c.key, summary: c.summary, data: c.data })), text: file.text }, repairs, retired,
      case_merges: duplicateMerges(buildIndex([file]), s.feature, "case"), dependencies };
  }

  // Appends a Test Case entry to a scenario file, existing or created by `createQa`.
  /**
   * @param {string} rel
   * @param {string} text
   * @returns {void}
   */
  append(rel, text) {
    if (!this.appends.has(rel)) this.appends.set(rel, []);
    /** @type {string[]} */ (this.appends.get(rel)).push(text);
  }

  // `item` is the Tracker-intake item's number, kept so a collision with a file already there
  // (`exists` in `render()`) can name what asked for the new file.
  /**
   * @param {string} rel
   * @param {string} text
   * @param {number} item
   * @returns {void}
   */
  createQa(rel, text, item) {
    this.createdQa.set(rel, { text, item });
  }

  // A key to mint for `item`'s `fn`, which will be bound to the cases in `bind`. A handle: its
  // `key` is filled in by `render()`. `keyPrefix` is the scan's `key_prefix` under
  // `automation_key_mint`: a proposed one is whatever its item wrote on the class this run.
  /**
   * @param {{ n: number }} item
   * @param {PlanFunction} fn
   * @param {string[]} bind
   * @param {PlanKeyPrefix} [keyPrefix]
   * @returns {PlanKey}
   */
  key(item, fn, bind, keyPrefix) {
    /** @type {PlanKey} */
    const h = { key: null, item: item.n, function: pick(fn), bind: [...bind] };
    if (keyPrefix) h.prefix = keyPrefix.proposed ? this.prefixes.get(keyPrefix.class ? classId(keyPrefix.class) : /** @type {string} */ (keyPrefix.file)) : keyPrefix.prefix;
    this.pendingKeys.push(h);
    return h;
  }

  // Writes a Key prefix on a class, in its `automation_key_prefix` carrier.
  /**
   * @param {{ file: string, path: string }} cls
   * @param {string} prefix
   * @returns {void}
   */
  keyPrefix(cls, prefix) {
    this.prefixes.set(classId(cls), prefix);
    this.codeFile(cls.file).prefix.push({ cls, prefix });
  }

  // Writes a file's Key prefix in its header (ADR-0022), for a stack whose files carry one.
  /**
   * @param {string} file
   * @param {string} prefix
   * @returns {void}
   */
  fileKeyPrefix(file, prefix) {
    this.prefixes.set(file, prefix);
    this.codeFile(file).header.push({ prefix });
  }

  /**
   * @param {PlanFunction} fn
   * @param {PlanKey} handle
   * @returns {void}
   */
  annotate(fn, handle) {
    this.codeFile(fn.file).annotate.push({ fn, handle });
  }

  /**
   * @param {PlanFunction} fn
   * @param {string} from
   * @param {PlanKey} handle
   * @returns {void}
   */
  rekey(fn, from, handle) {
    this.codeFile(fn.file).rekey.push({ kind: "function", fn, from, handle });
  }

  // A new carrier declaration: its file, its text, where every write then finds it declared
  // (`home`), and which carrier it declares — `automation_key` (the default) or, with
  // `automation_key_mint` (ADR-0013), `automation_key_prefix`.
  /**
   * @param {string} path
   * @param {string} text
   * @param {unknown} home
   * @param {string} [role]
   * @returns {void}
   */
  declare(path, text, home, role = "automation_key") {
    this.created.set(path, text);
    if (role === "automation_key_prefix") this.annotation = { ...this.annotation, prefix: { ...this.annotation.prefix, home } };
    else this.annotation = { ...this.annotation, home };
  }

  /**
   * @param {{ file?: string, key?: string }} ref
   * @param {string} key
   * @returns {void}
   */
  bind(ref, key) {
    this.caseOps(ref).add.push(key);
  }

  /**
   * @param {{ file?: string, key?: string }} ref
   * @param {string} aut
   * @returns {void}
   */
  unbind(ref, aut) {
    this.caseOps(ref).remove.add(aut);
  }

  /**
   * @param {{ file?: string, key?: string }} ref
   * @param {string} from
   * @param {string} key
   * @returns {void}
   */
  replace(ref, from, key) {
    this.caseOps(ref).replace.set(from, key);
  }

  /**
   * @param {string} path
   * @returns {PlanCodeOps}
   */
  codeFile(path) {
    if (!this.code.has(path)) this.code.set(path, { annotate: [], rekey: [], prefix: [], header: [] });
    return /** @type {PlanCodeOps} */ (this.code.get(path));
  }

  // The case `ref` names: `{file, key}` (a `.qa/`-relative file) or `{key}` (its first declaration).
  /**
   * @param {{ file?: string, key?: string }} ref
   * @returns {PlanCaseOps}
   */
  caseOps(ref) {
    const decls = this.ctx.index.cases.get(/** @type {string} */ (ref.key)) ?? [];
    const d = decls.find((x) => ref.file === undefined || x.file.rel === ref.file);
    if (!d) throw new Error(`no case ${ref.key}${ref.file ? ` in ${ref.file}` : ""}`);
    if (!this.qa.has(d.file.rel)) this.qa.set(d.file.rel, new Map());
    const cases = /** @type {Map<number, PlanCaseOps>} */ (this.qa.get(d.file.rel));
    if (!cases.has(d.line)) cases.set(d.line, { entry: d.entry, add: [], remove: new Set(), replace: new Map(), set: new Map() });
    return /** @type {PlanCaseOps} */ (cases.get(d.line));
  }

  // Every key minted, once `render()` has run: `{key, item, function, bind}`.
  /**
   * @returns {PlanKey[]}
   */
  get minted() {
    return this.pendingKeys;
  }

  // Renders and checks every file: `{ok: true, warnings, changeset, paths}`, the Changeset to write and
  // the sorted paths it touches, or `{ok: false, errors}`. Nothing is written.
  /**
   * @returns {PlanRendered}
   */
  render() {
    /** @type {PlanError[]} */
    const errors = [];
    /** @type {PlanError[]} */
    const warnings = [];
    const batches = Map.groupBy(this.pendingKeys, (h) => h.prefix);
    for (const [prefix, handles] of batches) {
      const r = mint("aut", { count: handles.length, root: this.ctx.root, prefix, seed: this.ctx.seed });
      if (r.error) return { ok: false, errors: [{ code: "mint", prefix, reason: r.reason, items: handles.map((h) => h.item), message: r.error }] };
      handles.forEach((h, i) => (h.key = /** @type {MintedKeys} */ (r).keys[i]));
    }
    const outputs = new Map(this.created);

    /**
     * @param {string | null | undefined} name
     * @param {string} kind
     * @returns {PlanError}
     */
    const noDeclaration = (name, kind) => ({
      code: "no_declaration",
      annotation: name,
      kind,
      message: /** @type {{ unimported: (name: string) => string }} */ (/** @type {PlanAdapter} */ (this.adapter).declaration).unimported(/** @type {string} */ (name)),
    });
    const { name, home, prefix } = this.annotation;
    const ops = [...this.code.values()];
    if (this.adapter?.needsDeclaration) {
      if (ops.some((o) => o.annotate.length) && !home) warnings.push(noDeclaration(name, "automation_key"));
      if (ops.some((o) => o.prefix.length) && !/** @type {{ home: unknown }} */ (prefix).home) warnings.push(noDeclaration(/** @type {NonNullable<typeof prefix>} */ (prefix).name, "key_prefix"));
    }
    for (const [path, ops] of this.code) {
      const text = readFileSync(join(this.ctx.repo, path), "utf8");
      const out = /** @type {PlanAdapter} */ (this.adapter).render(text, ops, this.annotation, path);
      errors.push(...out.errors.map(({ kind, message }) => ({ code: "annotation", kind, file: path, message })));
      outputs.set(path, out.text);
    }

    const absent = new Set();
    const touched = new Set([...this.qa.keys(), ...this.frontmatter.keys(), ...this.appends.keys()]);
    /**
     * @param {string} rel
     * @param {PlanError[]} list
     */
    const fail = (rel, list) => errors.push(...list.map((e) => ({ ...e, file: this.ctx.repoPath(rel) })));
    for (const rel of [...touched].sort()) {
      if (this.deletedQa.has(rel)) continue;
      if (this.createdQa.has(rel)) continue;
      const text = readFileSync(join(this.ctx.root, rel), "utf8");
      const out = renderQa(rel, text, {
        cases: this.qa.get(rel) ?? new Map(),
        frontmatter: this.frontmatter.get(rel),
        appends: this.appends.get(rel) ?? [],
      });
      if (out.unreadable) {
        this.checkQa(rel, text, errors);
        continue;
      }
      fail(rel, out.errors);
      if (out.text === text) continue;
      this.checkQa(rel, /** @type {string} */ (out.text), errors);
      outputs.set(this.ctx.repoPath(rel), /** @type {string} */ (out.text));
    }
    for (const [rel, { text: head, item }] of this.createdQa) {
      if (existsSync(join(this.ctx.root, rel))) fail(rel, [{ code: "exists", item, message: `${this.ctx.repoPath(rel)} exists already` }]);
      const text = edit(parse(rel, head), (this.appends.get(rel) ?? []).map((a) => ({ append: a }))).text;
      this.checkQa(rel, text, errors);
      outputs.set(this.ctx.repoPath(rel), text);
      absent.add(this.ctx.repoPath(rel));
    }

    if (errors.length) return { ok: false, errors };
    const changeset = { writes: [...outputs].map(([path, text]) => ({ path, text, ...(absent.has(path) && { absent: true }) })), deletes: [...this.deletedQa].map((rel) => this.ctx.repoPath(rel)) };
    return { ok: true, warnings, changeset, paths: changedPaths(changeset) };
  }

  // Validation facts on a rendered file, before the Changeset is written.
  /**
   * @param {string} rel
   * @param {string} text
   * @param {PlanError[]} errors
   * @returns {void}
   */
  checkQa(rel, text, errors) {
    // The configuration `checkQa` reads, resolved once, on its first file.
    (/** @type {{ config?: ProjectConfig }} */ (this)).config ??= rootConfig(this.ctx.root);
    const checked = checkFile(parse(rel, text), /** @type {ProjectConfig} */ ((/** @type {{ config?: ProjectConfig }} */ (this)).config));
    for (const e of checked.errors) errors.push({ code: "check_file", file: this.ctx.repoPath(rel), line: e.line, finding: e.message, checkCode: e.code, message: `${e.code}: ${e.message}` });
  }
}

// Duplicate tracker bindings propose the same Merge choices for a Card and moved children.
/**
 * @param {{ cases: Map<string, PlanMergeDecl[]>, scenarios: Map<string, PlanMergeDecl[]> }} index
 * @param {string | null | undefined} feature
 * @param {string} kind
 * @returns {PlanMergePair[]}
 */
export function duplicateMerges(index, feature, kind) {
  const field = kind === "case" ? "cases" : "scenarios";
  const entries = [...index[field]].filter(([key, ds]) => PATTERN[/** @type {"case" | "scenario"} */ (kind)].test(key) && ds.length === 1)
    .map(([key, ds]) => ({ key, ...ds[0] })).filter((d) => !feature || d.feature === feature)
    .sort((a, b) => a.key.localeCompare(b.key));
  const data = (/** @type {PlanMergeDecl} */ d) => kind === "case" ? /** @type {{ data: Record<string, unknown> }} */ (d.entry).data : /** @type {{ data: Record<string, unknown> }} */ (d.file).data;
  /** @type {PlanMergePair[]} */
  const pairs = [];
  for (let i = 0; i < entries.length; i++) for (const b of entries.slice(i + 1)) {
    const a = entries[i];
    if (a.feature === b.feature && data(a).tracker && data(a).tracker === data(b).tracker) {
      pairs.push({ [field]: [a.key, b.key], survivor: null, tracker_disposition: null });
    }
  }
  return pairs;
}

// Compare a proposed file through the same history pass as Scan. No file or human stamp is written.
/**
 * @param {PlanContext} ctx
 * @param {Array<PlanFile | ParsedFile>} files
 * @returns {HistorySection}
 */
function historyOf(ctx, files) {
  /** @type {HistorySection | undefined} */
  let facts;
  history(/** @type {ScanContext} */ (/** @type {unknown} */ ({
    root: ctx.root, config: ctx.config, feature: ctx.feature, files,
    section: (/** @type {string} */ _name, /** @type {HistorySection} */ value) => { facts = value; }, emit() {}, suppress() {},
  })));
  return /** @type {HistorySection} */ (facts);
}


/**
 * @param {PlanFunction} fn
 * @returns {PlanFunction}
 */
const pick = (fn) => ({ file: fn.file, line: fn.line, class: fn.class, name: fn.name });
/**
 * @param {{ file: string, path: string }} cls
 * @returns {string}
 */
const classId = (cls) => `${cls.file}:${cls.path}`;

// One `.qa/` file with its edits: each touched case with its `automates` rewritten and its fields
// set, the frontmatter's fields and the appended entries, made by lib/knowledge-file.mjs's `edit`.
// Errors are `{code, message}`; `unreadable` when `edit`
// cannot read the file, which its check then reports.
/**
 * @param {string} rel
 * @param {string} text
 * @param {{
 *   cases: Map<number, PlanCaseOps>,
 *   frontmatter?: Map<string, unknown>,
 *   appends: string[],
 * }} edits
 * @returns {{ text: string, errors: PlanError[], unreadable?: never } | { unreadable: true, text?: never, errors?: never }}
 */
function renderQa(rel, text, { cases, frontmatter, appends }) {
  /** @type {EditChange[]} */
  const changes = [];
  for (const [, op] of cases) {
    if (op.deleted) { changes.push({ remove: op.entry.key }); continue; }
    const list = automatesAfter(op.entry, op);
    changes.push({ at: op.entry.key, set: { ...(list && { automates: list }), ...Object.fromEntries(op.set) } });
  }
  if (frontmatter?.size) changes.push({ set: Object.fromEntries(frontmatter) });
  for (const a of appends) changes.push({ append: a });
  const r = edit(parse(rel, text), changes);
  if (r.unreadable) return { unreadable: true };
  const errors = r.errors.map((e) =>
    e.code === "no_block"
      ? { code: "no_block", key: e.at, message: `\`${e.at}\` has no block to edit` }
      : { code: e.code, ...(e.field && { field: e.field }), ...(e.at && { key: e.at }), message: e.message },
  );
  return { text: r.text, errors };
}

// A case's `automates` after its edits, in its existing order and then additions, or null when
// they leave it as it was. An emptied list is removed (empty collections are omitted). A
// non-string entry is not an Automation key; it is kept as written for `scan` to report.
/**
 * @param {PlanCase} c
 * @param {PlanCaseOps} op
 * @returns {string[] | null}
 */
function automatesAfter(c, op) {
  if (!op.add.length && !op.remove.size && !op.replace.size) return null;
  const before = Array.isArray(c.data.automates) ? /** @type {unknown[]} */ (c.data.automates) : [];
  const keyOf = (/** @type {unknown} */ k) => (typeof k === "string" ? k : /** @type {{ key: string }} */ (k).key);
  /** @type {string[]} */
  const list = [];
  for (const k of before) {
    if (op.remove.has(/** @type {string} */ (k))) continue;
    const next = op.replace.has(/** @type {string} */ (k)) ? keyOf(op.replace.get(/** @type {string} */ (k))) : /** @type {string} */ (k);
    if (!list.includes(next)) list.push(next);
  }
  for (const k of op.add.map(keyOf)) if (!list.includes(k)) list.push(k);
  return JSON.stringify(list) === JSON.stringify(before) ? null : list;
}

// Dependants of dropped Card items, in Card order, including transitive requirements.
/**
 * @param {Array<number | string | undefined>} dropped
 * @param {{ n?: number | string, requires?: unknown[] }[]} items
 * @returns {{ n: number | string | undefined, needs: unknown }[]}
 */
export function cascade(dropped, items) {
  const out = new Set(dropped);
  const needs = new Map();
  for (let grew = true; grew; ) {
    grew = false;
    for (const item of items) {
      if (out.has(item.n) || needs.has(item.n)) continue;
      const r = item.requires ?? [];
      const m = r.find((x) => out.has(/** @type {number | string | undefined} */ (x))) ?? r.find((x) => needs.has(/** @type {number | string | undefined} */ (x)));
      if (m === undefined) continue;
      needs.set(item.n, m);
      grew = true;
    }
  }
  return items.filter((i) => needs.has(i.n)).map((i) => ({ n: i.n, needs: needs.get(i.n) }));
}
