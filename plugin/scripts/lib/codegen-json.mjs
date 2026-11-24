// @ts-check
// Every `/qa-codegen` command's ordered, labelled report sections (ADR-0071). A command declares
// its reading order beside the builder that emits it, and only the fields the skill gates on,
// passes on or runs stay outside `sections`; everything the engineer reads is one of them.
import { buildSections } from "./report-sections.mjs";

/**
 * @import { ReportSection, SectionSpec } from "./report-sections.mjs"
 */

/**
 * One item of `codegen plan`'s cases section: the case, level and choice the engineer confirms.
 * @typedef {object} PlanCaseItem
 * @property {string} id
 * @property {string} case
 * @property {string} summary
 * @property {string} level
 * @property {string} scenario
 * @property {{ level: string, approach: string, reason: string, practice?: string }} [choice]
 * @property {unknown[]} [prior_results]
 */

/**
 * @typedef {{ key: string, reasons: string[] }} PlanSkipItem
 * @typedef {{ key: string, levels: string[] }} PlanUnsupportedItem
 * @typedef {{ scenario: string, prefix: string | null, proposal: true }} PlanPrefixItem
 * @typedef {{ code: string, message: string }} PlanWarningItem
 */

/** @type {readonly SectionSpec[]} */
export const PLAN_SECTION_ORDER = [
  { id: "confirm", label: "Plan to confirm" },
  { id: "cases", label: "Cases to generate" },
  { id: "skipped", label: "Skipped cases" },
  { id: "unsupported", label: "Unsupported automation levels" },
  { id: "prefixes", label: "Key prefixes to confirm" },
  { id: "warnings", label: "Training warnings" },
  { id: "reviews", label: "Reviews to settle first" },
];

/**
 * `codegen plan`'s sections: the confirm header (counts, stack, target, mode, run dir) and, in
 * order, its cases, skipped cases, unsupported levels, proposed Key prefixes, Training warnings and
 * the Reviews it waits on. A binding-pending skip names `/qa-sync`; the confirm names `start`.
 * @param {{
 *   header: string,
 *   start: string,
 *   items: readonly PlanCaseItem[],
 *   skipped: readonly PlanSkipItem[],
 *   unsupported: readonly PlanUnsupportedItem[],
 *   prefixes: readonly PlanPrefixItem[],
 *   warnings: readonly PlanWarningItem[],
 *   reviews?: readonly string[],
 * }} input
 * @returns {ReportSection[]}
 */
export function planSections({ header, start, items, skipped, unsupported, prefixes, warnings, reviews = [] }) {
  return buildSections(PLAN_SECTION_ORDER, [
    { id: "confirm", markdown: header, next: start },
    { id: "cases", items },
    { id: "skipped", items: skipped, next: skipped.some((entry) => entry.reasons.includes("binding-pending")) ? "/qa-sync" : null },
    { id: "unsupported", items: unsupported },
    { id: "prefixes", items: prefixes },
    { id: "warnings", items: warnings },
    ...reviewsSectionInputs(reviews),
  ]);
}

/**
 * The Reviews a plan waits on, as the last section in reading order. `withReviews` appends it once
 * the plan's own JSON has been built.
 * @param {readonly string[]} reviews
 * @returns {ReportSection[]}
 */
export function reviewsSections(reviews) {
  return buildSections(PLAN_SECTION_ORDER, reviewsSectionInputs(reviews));
}

/**
 * @param {readonly string[]} reviews
 * @returns {Array<{ id: string, items: readonly string[], next?: string | null }>}
 */
function reviewsSectionInputs(reviews) {
  return [{ id: "reviews", items: reviews, next: reviews.length ? reviews.join(", ") : null }];
}

/** @type {readonly SectionSpec[]} */
export const START_SECTION_ORDER = [{ id: "item", label: "Item to write" }];

/**
 * `codegen start`'s one section: the item to write and, as its next step, the verify command that
 * proves it. `resumed` marks an item an interrupted turn rolled back and retried.
 * @param {{ id: string, case: string, summary: string, level: string, scenario: string }} item
 * @param {boolean} resumed
 * @returns {ReportSection[]}
 */
export function startSections(item, resumed) {
  return buildSections(START_SECTION_ORDER, [
    { id: "item", items: [{ id: item.id, case: item.case, summary: item.summary, level: item.level, scenario: item.scenario, ...(resumed && { resumed: true }) }], next: `codegen verify --item ${item.id} --hypothesis "<one line>"` },
  ]);
}

/** @type {readonly SectionSpec[]} */
export const VERIFY_SECTION_ORDER = [{ id: "verify", label: "Verify result" }];

/**
 * `codegen verify`'s one section: the repetitions that ran, whether they passed, and — on a
 * failure — the repetition that failed, its reason and the runner's diagnostics.
 * @param {{ passed: boolean, passes: number, repeats: number, failed_at?: number, reason?: string, diagnostics?: readonly string[], selector?: string, tracker?: string }} result
 * @returns {ReportSection[]}
 */
export function verifySections({ passed, passes, repeats, failed_at, reason, diagnostics, selector, tracker }) {
  return buildSections(VERIFY_SECTION_ORDER, [
    {
      id: "verify",
      items: [{
        passed,
        passes,
        repeats,
        ...(failed_at !== undefined && { failed_at }),
        ...(reason !== undefined && { reason }),
        ...(diagnostics !== undefined && { diagnostics: [...diagnostics] }),
        ...(selector !== undefined && { selector }),
        ...(tracker !== undefined && { tracker }),
      }],
    },
  ]);
}

/** @type {readonly SectionSpec[]} */
export const DONE_SECTION_ORDER = [{ id: "done", label: "Item done" }];

/**
 * `codegen done`'s one section: the item it bound, to which Automation key (or Tracker key on a
 * project whose own tool mints), and the Expected-to-line mapping it stored.
 * @param {{ id: string, case: string, key?: string, tracker?: string }} item
 * @param {Record<string, string[]>} expects
 * @returns {ReportSection[]}
 */
export function doneSections(item, expects) {
  const binding = item.key !== undefined ? { key: item.key } : item.tracker !== undefined ? { tracker: item.tracker } : {};
  return buildSections(DONE_SECTION_ORDER, [
    { id: "done", items: [{ id: item.id, case: item.case, ...binding, expects }] },
  ]);
}

/** @type {readonly SectionSpec[]} */
export const REGRESS_SECTION_ORDER = [{ id: "regress", label: "Regression check" }];

/**
 * `codegen regress`'s one section: how many Automations and support dependents it checked, and the
 * items it rolled back. A failing check is `ok: false`, outside the section.
 * @param {{ checked: number, rolled_back: readonly string[] }} result
 * @returns {ReportSection[]}
 */
export function regressSections({ checked, rolled_back }) {
  return buildSections(REGRESS_SECTION_ORDER, [{ id: "regress", items: [{ checked, rolled_back: [...rolled_back] }] }]);
}

/** @type {readonly SectionSpec[]} */
export const FAIL_SECTION_ORDER = [{ id: "failed", label: "Item failed" }];

/**
 * `codegen fail`'s one section: the item, its closed failure reason, and the Convention key when
 * the item could not meet it. The scrubbed draft's path stays outside, as the close names it.
 * @param {{ id: string, case: string, failure?: { reason: string, cnv?: string } }} item
 * @returns {ReportSection[]}
 */
export function failSections(item) {
  const failure = item.failure ?? { reason: "" };
  return buildSections(FAIL_SECTION_ORDER, [
    { id: "failed", items: [{ id: item.id, case: item.case, reason: failure.reason, ...(failure.cnv !== undefined && { cnv: failure.cnv }) }] },
  ]);
}

/** @type {readonly SectionSpec[]} */
export const PREPARE_SECTION_ORDER = [{ id: "prepared", label: "Pull request prepared" }];

/**
 * `codegen pr-prepare`'s one section: the branch, its commit and base, the PR title and the body
 * file. The push and create argv stay outside, because the skill runs exactly those.
 * @param {{ noop?: boolean, mode?: unknown, branch?: unknown, commit?: unknown, base?: unknown, repo?: unknown, title?: unknown, body?: unknown }} json
 * @returns {ReportSection[]}
 */
export function prepareSections(json) {
  return buildSections(PREPARE_SECTION_ORDER, [
    {
      id: "prepared",
      items: [{
        noop: json.noop === true,
        ...(json.mode !== undefined && { mode: json.mode }),
        ...(json.branch !== undefined && { branch: json.branch }),
        ...(json.commit !== undefined && { commit: json.commit }),
        ...(json.base !== undefined && { base: json.base }),
        ...(json.repo !== undefined && { repo: json.repo }),
        ...(json.title !== undefined && { title: json.title }),
        ...(json.body !== undefined && { body: json.body }),
      }],
    },
  ]);
}

/** @type {readonly SectionSpec[]} */
export const RECORD_SECTION_ORDER = [{ id: "record", label: "Pull request record" }];

/**
 * `codegen pr-record`'s one section: the scrubbed outcome of the push and PR commands the skill ran.
 * @param {string} text
 * @returns {ReportSection[]}
 */
export function recordSections(text) {
  return buildSections(RECORD_SECTION_ORDER, [{ id: "record", markdown: text }]);
}
