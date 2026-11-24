// @ts-check
// Ordered, labelled sections for `/qa-publish` Card, Confirm and Record outputs (ADR-0071).
/** @import { ReportSection, SectionSpec } from "./report-sections.mjs" */
/** @import { PublishCardItem, PublishSkippedItem } from "./publish.mjs" */
import { buildSections, sectionItems } from "./report-sections.mjs";

/** @type {readonly SectionSpec[]} */
export const CARD_SECTION_ORDER = [
  { id: "counts", label: "Summary" },
  { id: "notices", label: "Notices" },
  { id: "suites", label: "Test Suites" },
  { id: "scenarios", label: "Test Scenarios" },
  { id: "cases", label: "Test Cases" },
  { id: "repairs", label: "Tracker Repairs" },
  { id: "bugs", label: "Bug Drafts" },
  { id: "parked_comments", label: "Parked-Questions Comments" },
  { id: "skipped", label: "Skipped Items" },
];

/** @type {readonly string[]} */
export const CARD_ALLOWED_OUTSIDE = ["glossary"];

/** @type {readonly SectionSpec[]} */
export const CONFIRM_SECTION_ORDER = [
  { id: "cascade", label: "Cascaded Drops" },
  { id: "removed", label: "Removed Edits" },
  { id: "divergences", label: "Divergences Needing Confirmation" },
  { id: "needs_edit", label: "Required Bug Fields" },
  { id: "confirm_items", label: "Bug Confirmations" },
];

/** @type {readonly string[]} */
export const CONFIRM_ALLOWED_OUTSIDE = ["mode", "migration", "ok", "confirm", "decisions"];

/** @type {readonly SectionSpec[]} */
export const RECORD_SECTION_ORDER = [
  { id: "applied", label: "Applied" },
  { id: "discarded", label: "Discarded Drafts" },
  { id: "manual", label: "Manual Remedies" },
  { id: "failed", label: "Failed" },
  { id: "rebuild", label: "Card Rebuild Required" },
  { id: "committed", label: "Committed" },
];

/** @type {readonly string[]} */
export const RECORD_ALLOWED_OUTSIDE = ["mode", "migration", "ok"];

/** @type {readonly string[]} */
const CARD_ITEM_SECTIONS = ["suites", "scenarios", "cases", "repairs", "bugs", "parked_comments"];

/**
 * Map a Card item's `code` to its section id in `CARD_SECTION_ORDER`.
 * @type {Record<string, string>}
 */
const ITEM_SECTION = {
  create_suite: "suites",
  recover_suite: "suites",
  create_scenario: "scenarios",
  recover_scenario: "scenarios",
  create_case: "cases",
  update_case: "cases",
  recover_case: "cases",
  local_copy_case: "cases",
  remark: "repairs",
  retire: "repairs",
  create_bug: "bugs",
  recover_bug: "bugs",
  older_draft: "bugs",
  post_comment: "parked_comments",
};

/**
 * Internal Card representation before shaping into ordered, labelled sections.
 * @typedef {{
 *   notices: string[],
 *   counts: { changes: number, questions: number },
 *   items: PublishCardItem[],
 *   skipped: PublishSkippedItem[],
 *   glossary: Array<{ term: string, explanation: string }>,
 * }} PublishCardInternal
 */

/**
 * Serialised `publish card` `card` object with ordered, labelled `sections`.
 * @typedef {{
 *   sections: ReportSection[],
 *   glossary: Array<{ term: string, explanation: string }>,
 * }} PublishCardJson
 */

/**
 * Build the `publish card` `card` JSON object from internal Card data.
 * @param {PublishCardInternal} card
 * @returns {PublishCardJson}
 */
export function buildPublishCardJson(card) {
  /** @type {Record<string, PublishCardItem[]>} */
  const buckets = Object.fromEntries(CARD_ITEM_SECTIONS.map((id) => [id, []]));
  for (const item of card.items) {
    const id = ITEM_SECTION[item.code];
    if (!id) throw new Error(`unknown publish card item code: ${item.code}`);
    buckets[id].push(item);
  }
  const sections = buildSections(CARD_SECTION_ORDER, [
    { id: "counts", items: card.counts.changes > 0 || card.counts.questions > 0 ? [card.counts] : [] },
    { id: "notices", items: card.notices },
    ...CARD_ITEM_SECTIONS.map((id) => ({ id, items: buckets[id] })),
    { id: "skipped", items: card.skipped },
  ]);
  return { sections, glossary: card.glossary };
}

/**
 * Extract all numbered Card items from a `PublishCardJson` in `n` order.
 * @param {PublishCardJson} card
 * @returns {PublishCardItem[]}
 */
export function publishCardItems(card) {
  const items = CARD_ITEM_SECTIONS.flatMap((id) => /** @type {PublishCardItem[]} */ (sectionItems(card, id)));
  return items.sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
}

/**
 * Input fields from `publish apply` when confirmation is required.
 * @typedef {{
 *   cascade?: unknown[],
 *   removed?: unknown[],
 *   divergences?: unknown[],
 *   needs_edit?: unknown[],
 *   confirm_items?: unknown[],
 *   decisions: Record<string, unknown>,
 * }} PublishConfirmInput
 */

/**
 * Serialised `publish apply` confirmation output with ordered, labelled `sections`.
 * @typedef {{
 *   ok: false,
 *   confirm: true,
 *   sections: ReportSection[],
 *   decisions: Record<string, unknown>,
 * }} PublishConfirmJson
 */

/**
 * Build the `publish apply` confirmation JSON object with ordered, labelled `sections`.
 * @param {PublishConfirmInput} input
 * @returns {PublishConfirmJson}
 */
export function buildPublishConfirmJson(input) {
  const sections = buildSections(CONFIRM_SECTION_ORDER, [
    { id: "cascade", items: input.cascade ?? [] },
    { id: "removed", items: input.removed ?? [] },
    { id: "divergences", items: input.divergences ?? [] },
    { id: "needs_edit", items: input.needs_edit ?? [] },
    { id: "confirm_items", items: input.confirm_items ?? [] },
  ]);
  return { ok: false, confirm: true, sections, decisions: input.decisions };
}

/**
 * Applied item summary for `publish record`.
 * @typedef {{
 *   n: number,
 *   code: string,
 *   key: string,
 *   label: string,
 *   tracker_key?: string,
 *   comment_id?: string | null,
 * }} PublishRecordAppliedItem
 */

/**
 * Discarded draft summary for `publish record`.
 * @typedef {{
 *   n: number,
 *   key: string,
 *   label: string,
 *   file?: string,
 * }} PublishRecordDiscardedItem
 */

/**
 * Manual remedy entry for a Bug published with an error.
 * @typedef {{
 *   n: number,
 *   key: string,
 *   label: string,
 *   error: string,
 *   remedy: string,
 * }} PublishRecordManualItem
 */

/**
 * Failed item entry for `publish record`.
 * @typedef {{
 *   n: number,
 *   key: string,
 *   label: string,
 *   error: string,
 *   rebuild?: boolean,
 *   requires?: number[],
 *   access?: unknown,
 * }} PublishRecordFailedItem
 */

/**
 * Internal `publish record` data before shaping into ordered, labelled sections.
 * @typedef {{
 *   applied_items?: PublishRecordAppliedItem[],
 *   discarded_items?: PublishRecordDiscardedItem[],
 *   manual?: PublishRecordManualItem[],
 *   failed?: PublishRecordFailedItem[],
 *   report?: { files: string[], commit: string | null },
 * }} PublishRecordInput
 */

/**
 * Serialised `publish record` output with ordered, labelled `sections`.
 * @typedef {{
 *   ok: true,
 *   sections: ReportSection[],
 * }} PublishRecordJson
 */

/**
 * Build the `publish record` JSON object with ordered, labelled `sections`.
 * @param {PublishRecordInput} input
 * @returns {PublishRecordJson}
 */
export function buildPublishRecordJson(input) {
  const failed = input.failed ?? [];
  const rebuildItems = failed
    .filter((item) => item.rebuild === true)
    .map((item) => ({ n: item.n, key: item.key, label: item.label }));
  const committed = input.report?.files?.length
    ? [{ commit: input.report.commit, files: input.report.files }]
    : [];
  const sections = buildSections(RECORD_SECTION_ORDER, [
    { id: "applied", items: input.applied_items ?? [] },
    { id: "discarded", items: input.discarded_items ?? [] },
    { id: "manual", items: input.manual ?? [] },
    { id: "failed", items: failed },
    { id: "rebuild", items: rebuildItems },
    { id: "committed", items: committed },
  ]);
  return { ok: true, sections };
}
