// @ts-check
// Card data and compact Markdown for the parts whose size grows with the repository.
/**
 * @import { AttachCandidate } from "./sync-attach.mjs"
 * @import { DecisionError } from "./refusal.mjs"
 * @import { TrackerCaseItem, TrackerScenarioItem, TrackerState, TrackerSuiteItem } from "./sync-tracker.mjs"
 */
import { readDecisions, refusalsWithoutLines } from "./refusal.mjs";
import { table } from "./markdown.mjs";
import { glossaryOf, keyLabel, summaries } from "./labels.mjs";
import { prefixRule } from "./keys.mjs";
import { attachableFeatures } from "./sync-attach.mjs";
import { accessNoteNamed } from "./access.mjs";
import { buildSections } from "./report-sections.mjs";
/** @import { ReportSection, SectionInput, SectionSpec } from "./report-sections.mjs" */

/**
 * An Automation a card item names: the function a Key is bound to, or a choice among duplicates.
 * @typedef {{
 *   name: string,
 *   file: string,
 *   line: number,
 *   blame?: { commit: string, time: number },
 *   bind: string[],
 *   key_prefix?: { problem?: string, [key: string]: unknown } | null,
 *   [key: string]: unknown,
 * }} SyncAutomation
 */

/**
 * One item of the sync card as the sections build it, with every field a card-data branch reads.
 * @typedef {{
 *   n?: number | string,
 *   code: string,
 *   section?: string,
 *   key?: string | null,
 *   kind?: string,
 *   summary?: string | null,
 *   feature?: string | null,
 *   scenario?: string | null,
 *   file?: string | null,
 *   path?: string | null,
 *   annotation?: string | null,
 *   function?: SyncAutomation,
 *   functions?: SyncAutomation[],
 *   class?: { path: string, file: string } | null,
 *   requires?: unknown[],
 *   needs?: string[],
 *   edits?: string[],
 *   candidates?: AttachCandidate[] | string[],
 *   mark?: string | null,
 *   tracker?: string | null,
 *   current?: string | null,
 *   tracker_formerly?: string[],
 *   mirrors?: Array<{ kind: "case" | "scenario", file: string, line: number, key: string }>,
 *   at?: string,
 *   changes?: Record<string, { from: unknown, to: unknown }>,
 *   diverges?: string[],
 *   wrong?: unknown,
 *   scenarios?: string[],
 *   cases?: string[],
 *   survivor?: string | null,
 *   loser?: string | null,
 *   tracker_disposition?: "keep" | "retire" | null,
 *   result?: { text?: string | null, [key: string]: unknown } | null,
 *   problem?: unknown,
 *   automatable?: boolean,
 *   automates?: string[],
 *   unknown_roles?: string[],
 *   tracker_level?: string | string[] | null,
 *   offered_level?: import("./case-fields.mjs").CaseLevel,
 *   intake_needs?: string[],
 *   unlanded_suite?: string | null,
 *   creates_scenario?: { key: string, suite: string } | null,
 *   prefix?: string | null,
 *   key_prefix?: { prefix?: string, problem?: string, [key: string]: unknown } | null,
 *   bind?: string[],
 *   replace_in?: string[],
 *   automation?: string,
 *   parameterised?: boolean,
 *   cross_feature?: boolean,
 *   [key: string]: unknown,
 * }} SyncCardItem
 */

/**
 * One item as the card prints it: the same fields, with the labels and Markdown added.
 * @typedef {{
 *   n: number | string,
 *   code: string,
 *   label?: string | null,
 *   feature?: string | null,
 *   scenario?: string | null,
 *   requires?: unknown[],
 *   needs: string[],
 *   edits: string[],
 *   tracker?: string | null,
 *   current?: string | null,
 *   tracker_formerly?: string[],
 *   markdown?: string | null,
 *   count?: number,
 *   at?: string,
 *   wrong?: unknown,
 *   candidates?: AttachCandidate[],
 *   cases?: string[],
 *   scenarios?: string[],
 *   choices?: Array<{ key: string, label: string | null }>,
 *   survivor?: string | null,
 *   loser?: string | null,
 *   tracker_disposition?: "keep" | "retire" | null,
 *   automatable?: boolean,
 *   unknown_roles?: string[],
 *   tracker_level?: string | string[] | null,
 *   offered_level?: import("./case-fields.mjs").CaseLevel,
 *   automations?: string[],
 *   mark?: string | null,
 *   attach?: { needs: string[] },
 *   dismiss?: { needs: string[] },
 *   unlanded_suite?: string | null,
 *   intake?: Record<string, unknown>,
 *   procedure?: string,
 *   annotation?: string | null,
 *   automation?: string,
 *   unclaimed?: boolean,
 *   replaces?: { automation?: string, cases: Array<string | null> },
 *   automation_key?: string,
 *   key_prefix?: string,
 *   parameterised?: boolean,
 *   cross_feature?: boolean,
 *   [key: string]: unknown,
 * }} SyncCardItemOut
 */

/**
 * A section of the sync card.
 * @typedef {{
 *   key: string,
 *   title: string,
 *   items: number[],
 *   skipped?: Array<{ function?: SyncAutomation, functions?: SyncAutomation[], message: string, [key: string]: unknown }>,
 *   canceled?: boolean | number,
 *   canceled_keys?: string[],
 *   unsummarised_keys?: string[],
 *   [key: string]: unknown,
 * }} SyncCardSection
 */

/**
 * A note on the sync card.
 * @typedef {{
 *   access_note?: string,
 *   access?: unknown,
 *   [key: string]: unknown,
 * }} SyncNote
 */

/**
 * A divergence the sync card reports.
 * @typedef {{
 *   code: string,
 *   kind?: "case" | "scenario" | "suite",
 *   key?: string | null,
 *   message?: string,
 *   knowledge?: string | null,
 *   mirror?: string | null,
 *   [key: string]: unknown,
 * }} SyncDivergence
 */

/**
 * The card as the sync sections build it.
 * @typedef {{
 *   items: SyncCardItem[],
 *   sections: SyncCardSection[],
 *   notes: SyncNote[],
 *   divergences: SyncDivergence[],
 * }} SyncCard
 */

/**
 * Ordered section registry for `sync card`: every outcome the skill words for the engineer, in the
 * Card's reading order. The run header and the shared lookup maps stay outside `sections`.
 * @type {readonly SectionSpec[]}
 */
export const CARD_SECTION_ORDER = [
  { id: "counts", label: "Summary" },
  { id: "declaration", label: "Key carrier declaration" },
  { id: "refresh", label: "Mirror refresh" },
  { id: "attach", label: "Attach" },
  { id: "intake", label: "Tracker intake" },
  { id: "tracker_skipped", label: "Tracker cases not intaken" },
  { id: "unlanded", label: "Unlanded cases and Suites" },
  { id: "prefix", label: "Key prefixes" },
  { id: "code", label: "Code repairs" },
  { id: "skipped", label: "Skipped repairs" },
  { id: "merge", label: "Merge" },
  { id: "notes", label: "Notes" },
  { id: "divergences", label: "Divergences" },
];

/**
 * A tracker case or Scenario the Card leaves out of intake, with why.
 * @typedef {{ key: string, label: string | null, reason: "canceled" | "no summary" }} SyncNotIntaken
 */

/**
 * The sync card as `sync card` prints it: the run header and the shared lookup maps the items
 * reference stay outside its ordered, labelled sections.
 * @typedef {{
 *   feature?: string | null,
 *   sections: ReportSection[],
 *   choices: Record<string, string | string[]>,
 *   fields: Record<string, string>,
 *   labels: Record<string, string>,
 *   glossary: Array<{ term: string, explanation: string }>,
 * }} SyncCardData
 */

/**
 * Ordered section registry for `sync apply`'s report: the applied outcomes and, before a write,
 * the cascade the engineer confirms.
 * @type {readonly SectionSpec[]}
 */
export const APPLY_SECTION_ORDER = [
  { id: "minted", label: "Minted Automation keys" },
  { id: "cross_feature", label: "Cross-feature links" },
  { id: "intaken", label: "Tracker intake" },
  { id: "warnings", label: "Warnings" },
  { id: "files", label: "Files written" },
  { id: "notes", label: "Notes" },
  { id: "cascade", label: "Cascaded drops" },
  { id: "removed", label: "Removed answers" },
];

/**
 * The outcomes `sync apply`'s report carries, before they are labelled: absent ones get no section.
 * @typedef {{
 *   minted?: readonly unknown[],
 *   cross_feature?: readonly unknown[],
 *   intaken?: readonly unknown[],
 *   warnings?: readonly unknown[],
 *   files?: readonly string[],
 *   notes?: readonly unknown[],
 *   cascade?: readonly unknown[],
 *   removed?: readonly unknown[],
 * }} SyncApplySections
 */

/**
 * Build `sync apply`'s ordered, labelled report sections from the outcomes it has.
 * @param {SyncApplySections} outcomes
 * @returns {ReportSection[]}
 */
export function applySections(outcomes) {
  return buildSections(APPLY_SECTION_ORDER, [
    { id: "minted", items: outcomes.minted ?? [] },
    { id: "cross_feature", items: outcomes.cross_feature ?? [] },
    { id: "intaken", items: outcomes.intaken ?? [] },
    { id: "warnings", items: outcomes.warnings ?? [] },
    { id: "files", items: outcomes.files ?? [] },
    { id: "notes", items: outcomes.notes ?? [] },
    { id: "cascade", items: outcomes.cascade ?? [] },
    { id: "removed", items: outcomes.removed ?? [] },
  ]);
}

/**
 * The context `cardData` reads: the scan index, the tracker, the stack adapter and the project settings.
 * @typedef {{
 *   index: {
 *     features: Map<string, Array<{ file: { rel: string, h1?: { text?: string }, [key: string]: unknown }, [key: string]: unknown }>>,
 *     scenarios: Map<string, Array<{ file: { rel: string, h1?: { text?: string }, [key: string]: unknown }, [key: string]: unknown }>>,
 *     cases: Map<string, Array<{ entry: { summary?: string, [key: string]: unknown }, [key: string]: unknown }>>,
 *     [key: string]: unknown,
 *   },
 *   tracker: SyncTrackerData,
 *   config: { levels: Set<string>, roles: Set<string>, autRecipe?: unknown, [key: string]: unknown },
 *   feature?: string,
 *   stack: { adapter: { carrierText: (annotation: string | null | undefined, prefix: string) => string, headerText: (prefix: string) => string, [key: string]: unknown } },
 *   [key: string]: unknown,
 * }} SyncCardContext
 */

/**
 * The tracker state the card data reads: the loaded tracker, whose maps the sections use.
 * @typedef {Extract<TrackerState, { ok: true }> & { ok: boolean, note?: unknown }} SyncTrackerData
 */

/** @type {Record<string, string>} */
const FIELD_LABELS = { auto_status: "automation status", roles: "Roles", level: "level", bind: "Test Cases to link", keep: "Automation that keeps the key", feature: "Feature", prefix: "Key prefix", path: "file path", package: "package", resolution: "resolution", scenario: "Test Scenario", by: "person's name", reason: "reason", ticket: "ticket" };
/**
 * @param {SyncCardItem} item
 * @returns {string[]}
 */
export const openQuestions = (item) => (item.needs ?? []).filter((f) => (item.edits ?? []).includes(f));

/**
 * @param {SyncCardContext} ctx
 * @param {SyncCard} card
 * @returns {SyncCardData}
 */
export function cardData(ctx, card) {
  const summary = summaries(/** @type {Parameters<typeof summaries>[0]} */ (ctx.index));
  /** @type {Record<string, string>} */
  const labels = {};
  /** @type {Set<string>} */
  const terms = new Set();
  /** @param {string} name @returns {string} */
  const term = (name) => (terms.add(name), name);
  /**
   * @param {string | null | undefined} key
   * @param {"case" | "feature" | "suite" | "scenario"} [kind]
   * @param {string | undefined} [fallback]
   * @returns {string | null}
   */
  const label = (key, kind = "case", fallback) => {
    if (key === null || key === undefined) return null;
    const found = kind === "feature" ? summary.feature(key) : kind === "suite" ? ctx.tracker.markedSuites?.get(key)?.summary ?? ctx.tracker.suites?.get(key)?.summary : kind === "scenario" ? summary.scenario(key) ?? ctx.tracker.scenarios?.get(key)?.summary ?? ctx.tracker.markedScenarios?.get(key)?.summary : summary.testCase(key) ?? ctx.tracker.cases?.get(key)?.summary ?? ctx.tracker.markedCases?.get(key)?.summary;
    return (labels[key] = keyLabel(key, found || fallback || "summary unavailable"));
  };
  /** @param {SyncAutomation} f @returns {string} */
  const automation = (f) => `\`${f.name}\` (\`${f.file}:${f.line}\`)`;
  /** @type {Map<string, SyncCardItemOut[]>} */
  const itemsBySection = new Map();
  const items = card.items.map((item) => {
    const out = /** @type {SyncCardItemOut} */ ({ n: /** @type {number | string} */ (item.n), code: item.code });
    if (item.key) out.label = label(item.key, item.code === "unlanded_suite" ? "suite" : item.kind === "suite" ? "feature" : item.kind === "scenario" || item.code.endsWith("_scenario") ? "scenario" : "case", item.summary ?? item.functions?.map((f) => f.name).join(", ") ?? item.function?.name);
    else out.label = item.function ? automation(item.function) : item.class ? `\`${item.class.path}\` (\`${item.class.file}\`)` : item.path ?? item.file ?? item.annotation;
    if (item.feature) out.feature = label(item.feature, "feature");
    if (item.scenario) out.scenario = label(item.scenario, "scenario");
    if (item.requires?.length) out.requires = item.requires;
    out.needs = openQuestions(item);
    out.edits = item.edits ?? [];
    for (const f of out.edits) if (item[f] !== undefined) out[f] = item[f];
    if (item.section === "refresh") {
      if (item.code === "move_tracker") {
        term("Divergence"); term("Tracker key");
        out.tracker = item.tracker;
        out.current = item.current;
        out.tracker_formerly = item.tracker_formerly;
        out.markdown = table(["Field", "After"], [["tracker", item.current], ["tracker_formerly", item.tracker_formerly]]);
      } else if (item.code === "restamp_mirrors") { term("Mirror refresh"); term("Mirrored value"); out.count = /** @type {NonNullable<SyncCardItem["mirrors"]>} */ (item.mirrors).length; out.at = item.at; }
      else {
        term("Mirror refresh"); term("Mirrored value");
        out.markdown = table(["Mirrored value", "Before", "After", "Divergence"], Object.entries(/** @type {NonNullable<SyncCardItem["changes"]>} */ (item.changes)).map(([f, v]) => [FIELD_LABELS[f] ?? f, v.from, v.to, /** @type {NonNullable<SyncCardItem["diverges"]>} */ (item.diverges).includes(f) ? "yes" : ""]));
        if (/** @type {NonNullable<SyncCardItem["diverges"]>} */ (item.diverges).length) term("Divergence");
      }
    } else if (item.section === "attach") {
      term("Attach"); term("Tracker key");
      if (item.code === "correct_tracker") { term("Retired key"); out.wrong = item.wrong; }
      out.candidates = /** @type {AttachCandidate[]} */ (item.candidates);
      if (item.code === "attach_suite") { term("Suite key"); term("Mirrored value"); }
      /** @param {string} k @returns {string | null | undefined} */
      const trackerSummary = (k) => ctx.tracker.cases?.get(k)?.summary ?? ctx.tracker.markedCases?.get(k)?.summary ?? ctx.tracker.scenarios?.get(k)?.summary ?? ctx.tracker.markedScenarios?.get(k)?.summary ?? ctx.tracker.suites?.get(k)?.summary ?? "";
      /** @param {readonly string[]} keys @returns {string} */
      const quoted = (keys) => keys.map((k) => `\`${k}\``).join(", ");
      /** @param {AttachCandidate} c @returns {string} */
      const proof = (c) => c.strength === "named" ? "named by the engineer" : c.evidence.automations ? `shared Automation ${quoted(c.evidence.automations)}` : c.evidence.scenarios ? `linked Test Scenario ${quoted(c.evidence.scenarios)}` : "similar summary";
      /** @param {AttachCandidate} c @returns {string} */
      const evidence = (c) => [proof(c), ...(c.shared_with ? [`also the Test Suite of ${c.shared_with.map((F) => label(F, "feature")).join(", ")}`] : []), ...(c.retires ? [`retires its mark \`${c.retires}\``] : [])].join("; ");
      out.markdown = table(["Tracker key", "Tracker summary", "Strength", "Evidence"], /** @type {AttachCandidate[]} */ (item.candidates).map((c) => [`\`${c.tracker}\``, trackerSummary(c.tracker), c.strength, evidence(c)]));
    } else if (item.section === "merge") {
      term("Merge"); term("Retired key"); term("Review");
      out[item.scenarios ? "scenarios" : "cases"] = item.scenarios ?? item.cases;
      out.choices = /** @type {string[]} */ (item.scenarios ?? item.cases).map((key) => ({ key, label: label(key, item.scenarios ? "scenario" : "case") }));
      for (const f of ["survivor", "loser", "tracker_disposition", "result", "repairs", "retired", "review", "problem", "case_merges", "dependencies"]) if (item[f] !== undefined) out[f] = item[f];
      out.markdown = item.result?.text ?? null;
    } else if (item.section === "intake") {
      term("Tracker intake");
      if (item.code === "intake_case") {
        term("Role");
        out.automatable = item.automatable;
        if (/** @type {NonNullable<SyncCardItem["unknown_roles"]>} */ (item.unknown_roles).length) { out.unknown_roles = item.unknown_roles; term("Role"); }
        if (item.tracker_level) out.tracker_level = item.tracker_level;
        if (item.offered_level !== undefined) out.offered_level = item.offered_level;
        out.automations = item.automates;
      } else if (item.candidates) { out.candidates = /** @type {AttachCandidate[]} */ (item.candidates); out.markdown = /** @type {string[]} */ (item.candidates).map((k) => `- ${label(k, "feature")}`).join("\n"); }
    } else if (item.code === "unlanded_suite") {
      term("Unlanded Suite"); term("Divergence"); term("Attach"); term("Dismissal"); term("Retired key"); term("Suite key");
      out.mark = item.mark;
      out.attach = { needs: item.feature ? [] : ["feature"] };
      out.dismiss = { needs: ["by", ...(!item.feature ? ["feature"] : [])] };
    } else if (item.section === "unlanded") {
      term("Unlanded case"); term("Divergence"); term("Tracker intake"); term("Dismissal"); term("Retired key");
      if (item.unlanded_suite) { term("Unlanded Suite"); out.unlanded_suite = label(item.unlanded_suite, "suite"); }
      out.intake = { needs: item.intake_needs, automatable: item.automatable, unknown_roles: item.unknown_roles, ...(item.tracker_level && { tracker_level: item.tracker_level }), ...(item.offered_level !== undefined && { offered_level: item.offered_level }) };
      out.dismiss = { needs: ["by", ...(!item.feature ? ["feature"] : [])] };
      if (item.creates_scenario) out.intake.creates_scenario = { label: label(item.creates_scenario.key, "scenario"), suite: label(item.creates_scenario.suite, "suite") };
    } else if (item.section === "prefix") {
      term("Key prefix");
      out.procedure = item.class ? ctx.stack.adapter.carrierText(item.annotation, item.prefix ?? "<prefix>") : ctx.stack.adapter.headerText(item.prefix ?? "<prefix>");
    } else if (item.section === "declaration") {
      out.annotation = item.annotation;
      if (item.code === "declare_prefix_annotation") term("Key prefix");
    } else {
      if (item.function) out.automation = automation(item.function);
      if (["mint_and_bind", "rebind"].includes(item.code)) out.unclaimed = ![...(item.bind ?? []), ...(item.replace_in ?? [])].length;
      if (item.bind) out.markdown = item.bind.map((k) => `- ${label(k)}`).join("\n");
      if (item.replace_in) out.replaces = { automation: item.automation, cases: item.replace_in.map((k) => label(k)) };
      if (item.automation) out.automation_key = item.automation;
      if (item.key_prefix) { term("Key prefix"); out.key_prefix = item.key_prefix.prefix; }
      if (item.parameterised) out.parameterised = true;
      if (item.cross_feature) out.cross_feature = true;
      if (item.functions) out.markdown = table(["Choice", "Automation", "Key age", "Test Cases to link", "Key prefix problem"], item.functions.map((f, i) => [i + 1, automation(f), f.blame ? `${f.blame.commit.slice(0, 7)} ${new Date(f.blame.time * 1000).toISOString().slice(0, 10)}` : "uncommitted", f.bind.map((k) => label(k)), f.key_prefix?.problem ?? ""]));
      if (["mint_and_bind", "rebind"].includes(item.code)) term("Unkeyed test");
      if (item.code === "link_unclaimed" || item.bind?.length === 0) term("Unclaimed Automation");
    }
    const section = item.section ?? "";
    if (!itemsBySection.has(section)) itemsBySection.set(section, []);
    /** @type {SyncCardItemOut[]} */ (itemsBySection.get(section)).push(out);
    return out;
  });
  const notes = card.notes.map((n) => {
    const out = { ...n };
    const access = n.access_note ? accessNoteNamed(/** @type {Parameters<typeof accessNoteNamed>[0]} */ (ctx.index), n.access_note) : null;
    if (access) { term("Access note"); out.access = access; } else delete out.access_note;
    return out;
  });
  const divergences = card.divergences.map(({ message, ...d }) => {
    term("Divergence");
    if (d.code.startsWith("unlanded_")) { term(d.kind === "suite" ? "Unlanded Suite" : "Unlanded case"); term("Retired key"); }
    return { ...d, label: label(d.key, d.kind === "suite" ? "suite" : d.kind === "scenario" || d.code === "tracker_scenario_vanished" ? "scenario" : "case"), ...(d.knowledge && { knowledge: label(d.knowledge, "scenario"), mirror: label(d.mirror, "scenario") }) };
  });
  // Every skipped repair and every tracker case the intake leaves out is an outcome the skill
  // words, so each gets a section of its own; the intake section keeps only its items.
  /** @type {SyncNotIntaken[]} */
  const notIntaken = [];
  for (const s of card.sections) {
    for (const key of s.canceled_keys ?? []) notIntaken.push({ key, label: label(key, trackerKind(ctx, key)), reason: "canceled" });
    for (const key of s.unsummarised_keys ?? []) notIntaken.push({ key, label: label(key, trackerKind(ctx, key)), reason: "no summary" });
  }
  const skipped = card.sections.flatMap((s) => s.skipped ?? []);
  const cardCounts = { changes: items.length, questions: items.filter((i) => i.needs.length).length };
  /** @type {SectionInput[]} */
  const sectionInputs = CARD_SECTION_ORDER.map(({ id }) => ({
    id,
    items: id === "counts" ? (cardCounts.changes > 0 || cardCounts.questions > 0 ? [cardCounts] : [])
      : id === "notes" ? notes
      : id === "divergences" ? divergences
      : id === "tracker_skipped" ? notIntaken
      : id === "skipped" ? skipped
      : itemsBySection.get(id) ?? [],
  }));
  const unlanded = items.some((i) => ["unlanded_case", "unlanded_suite"].includes(i.code));
  if (unlanded) {
    for (const key of ctx.index.features.keys()) label(key, "feature");
    for (const key of ctx.index.scenarios.keys()) label(key, "scenario");
  }
  return {
    ...(ctx.feature && { feature: label(ctx.feature, "feature") }),
    sections: buildSections(CARD_SECTION_ORDER, sectionInputs),
    choices: {
      level: [...ctx.config.levels], roles: [...ctx.config.roles],
      ...(items.some((i) => i.code === "unlanded_case") && { resolution: ["intake", "retired_by_hand", "dismiss"] }),
      ...(items.some((i) => i.code === "unlanded_suite") && { suite_resolution: ["attach", "retired_by_hand", "dismiss"], attach_feature: attachableFeatures(/** @type {Parameters<typeof attachableFeatures>[0]} */ (/** @type {unknown} */ (ctx))) }),
      ...(unlanded && { feature: [...ctx.index.features.keys()], scenario: [...ctx.index.scenarios.keys()] }),
      ...(items.some((i) => i.edits.includes("prefix")) && { prefix: prefixRule(/** @type {Parameters<typeof prefixRule>[0]} */ (ctx.config.autRecipe)) }),
    },
    fields: Object.fromEntries([...new Set(items.flatMap((i) => i.edits))].map((f) => [f, FIELD_LABELS[f] ?? f])),
    labels, glossary: glossaryOf(terms),
  };
}

/**
 * Whether a tracker key names a Test Scenario rather than a Test Case.
 * @param {SyncCardContext} ctx
 * @param {string} key
 * @returns {"case" | "scenario"}
 */
const trackerKind = (ctx, key) => (ctx.tracker.scenarios?.has(key) || ctx.tracker.markedScenarios?.has(key) ? "scenario" : "case");

// A sync refusal carries no line: a code and the facts the model words. `/qa-sync` says how.
export const { fact, refuse, refusalOf } = refusalsWithoutLines();

/**
 * The decisions read from the agent's JSON, checked against the items the card showed.
 * @typedef {{
 *   input: Record<string, unknown>,
 *   take: number[],
 *   drop: number[],
 *   edits: Record<string, Record<string, unknown>>,
 *   confirm: number[],
 *   name: Record<string, string>,
 *   merge: Record<string, string>,
 *   errors: DecisionError[],
 * }} SyncDecisions
 */

/** The keys `sync apply` accepts: the lists of item ids, the string maps, and the per-item edits. */
const DECISIONS = { keys: ["take", "drop", "edits", "confirm", "name", "merge"], lists: ["take", "drop", "confirm"], maps: ["name", "merge"], drop: "drop", edits: "edits", confirm: "confirm", all: "take" };

/**
 * Whether an edited value has the JSON type its field takes.
 * @param {SyncCardItem} item
 * @param {string} field
 * @param {unknown} value
 * @returns {boolean}
 */
const badValue = (item, field, value) =>
  !( ["bind", "roles"].includes(field) ? Array.isArray(value) && value.every((key) => typeof key === "string") : field === "level" ? value === null || typeof value === "string" || (Array.isArray(value) && value.every((level) => typeof level === "string")) : field === "keep" ? Number.isSafeInteger(value) : typeof value === "string");

/**
 * @param {string} text
 * @param {SyncCardItem[]} items
 * @returns {SyncDecisions}
 */
export function decisionsOf(text, items) {
  const decisions = readDecisions(text, items, DECISIONS, badValue);
  return {
    ...decisions,
    name: /** @type {Record<string, string>} */ (decisions.input.name ?? {}),
    merge: /** @type {Record<string, string>} */ (decisions.input.merge ?? {}),
  };
}
