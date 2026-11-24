// @ts-check
// Every `/qa-codefix` command's ordered, labelled report sections (ADR-0071). A command declares
// its reading order beside the builder that emits it, and only the fields the skill gates on,
// passes on or runs stay outside `sections`; everything the engineer reads is one of them.
import { buildSections } from "./report-sections.mjs";

/**
 * @import { ReportSection, SectionSpec } from "./report-sections.mjs"
 */

/** @type {readonly SectionSpec[]} */
export const PLAN_SECTION_ORDER = [
  { id: "mode", label: "PR mode" },
  { id: "fixes", label: "Fixes to repair" },
  { id: "passing", label: "Automations passing now" },
];

/**
 * `codefix plan`'s sections: the PR-mode line, the fix items in work order and, for a standalone
 * request, the Automations its baseline found passing.
 * @param {{ confirm: string, items: readonly unknown[], passes_now: readonly string[] }} input
 * @returns {ReportSection[]}
 */
export function planSections({ confirm, items, passes_now }) {
  return buildSections(PLAN_SECTION_ORDER, [
    { id: "mode", markdown: confirm },
    { id: "fixes", items },
    { id: "passing", items: passes_now },
  ]);
}

/** @type {readonly SectionSpec[]} */
export const START_SECTION_ORDER = [
  { id: "item", label: "Fix item" },
  { id: "brief", label: "Repair brief" },
  { id: "sources", label: "Literal sources" },
  { id: "handoff", label: "Hand-off sources" },
];

/**
 * `codefix start`'s sections: the item, the scrubbed brief to work from, the values its literals
 * may change to, and the sources a hand-off may quote.
 * @param {{ item: unknown, brief: string, literal_sources: readonly string[], handoff_sources: readonly string[] }} input
 * @returns {ReportSection[]}
 */
export function startSections({ item, brief, literal_sources, handoff_sources }) {
  return buildSections(START_SECTION_ORDER, [
    { id: "item", items: [item] },
    { id: "brief", markdown: brief },
    { id: "sources", items: literal_sources },
    { id: "handoff", items: handoff_sources },
  ]);
}

/** @type {readonly SectionSpec[]} */
export const VERIFY_SECTION_ORDER = [{ id: "verify", label: "Verify result" }];

/**
 * `codefix verify`'s one section: the item, whether its run passed, the attempt it spent and the
 * run's diagnostics. `passed` also stays outside as the gate the skill branches on.
 * @param {{ id: string, passed: boolean, attempts: number, cap: number, diagnostics?: readonly string[] }} result
 * @returns {ReportSection[]}
 */
export function verifySections({ id, passed, attempts, cap, diagnostics = [] }) {
  return buildSections(VERIFY_SECTION_ORDER, [
    { id: "verify", items: [{ id, passed, attempts, cap, diagnostics: [...diagnostics] }] },
  ]);
}

/** @type {readonly SectionSpec[]} */
export const DONE_SECTION_ORDER = [{ id: "done", label: "Item done" }];

/**
 * `codefix done`'s one section: the item it closed, its summary and, for an item an earlier fix
 * repaired, what closed it.
 * @param {{ id: string, automation: string, file: string, state: string, summary?: string, outcome?: string }} item
 * @returns {ReportSection[]}
 */
export function doneSections({ id, automation, file, state, summary, outcome }) {
  return buildSections(DONE_SECTION_ORDER, [
    { id: "done", items: [{ id, automation, file, state, ...(summary !== undefined && { summary }), ...(outcome !== undefined && { outcome }) }] },
  ]);
}

/** @type {readonly SectionSpec[]} */
export const FAIL_SECTION_ORDER = [{ id: "failed", label: "Item failed" }];

/**
 * `codefix fail`'s one section: the item, its closed reason and the next step it recommends.
 * @param {{ id: string, automation: string, file: string, state: string, reason?: string, next?: string }} item
 * @returns {ReportSection[]}
 */
export function failSections({ id, automation, file, state, reason, next }) {
  return buildSections(FAIL_SECTION_ORDER, [
    { id: "failed", items: [{ id, automation, file, state, ...(reason !== undefined && { reason }), ...(next !== undefined && { next }) }] },
  ]);
}

/** @type {readonly SectionSpec[]} */
export const HANDOFF_SECTION_ORDER = [{ id: "handoff", label: "Hand-off" }];

/**
 * `codefix handoff`'s one section: the item, the cases it covered and the scrubbed cause, with the
 * command that takes the cause next.
 * @param {{ id: string, cases: readonly string[], cause: string, next: string }} input
 * @returns {ReportSection[]}
 */
export function handoffSections({ id, cases, cause, next }) {
  return buildSections(HANDOFF_SECTION_ORDER, [
    { id: "handoff", items: [{ id, cases: [...cases], cause }], next },
  ]);
}

/** @type {readonly SectionSpec[]} */
export const REGRESS_SECTION_ORDER = [{ id: "regress", label: "Regression check" }];

/**
 * `codefix regress`'s one section: how many Automations it checked and the items it rolled back. A
 * failing check is `ok: false`, outside the section.
 * @param {{ checked: number, rolled_back: readonly string[] }} result
 * @returns {ReportSection[]}
 */
export function regressSections({ checked, rolled_back }) {
  return buildSections(REGRESS_SECTION_ORDER, [{ id: "regress", items: [{ checked, rolled_back: [...rolled_back] }] }]);
}

/** @type {readonly SectionSpec[]} */
export const PREPARE_SECTION_ORDER = [{ id: "prepared", label: "Pull request prepared" }];

/**
 * `codefix pr-prepare`'s one section: the branch, its commit and base, the PR title and the body
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
 * `codefix pr-record`'s one section: the scrubbed outcome of the push and PR commands the skill ran.
 * @param {string} text
 * @returns {ReportSection[]}
 */
export function recordSections(text) {
  return buildSections(RECORD_SECTION_ORDER, [{ id: "record", markdown: text }]);
}
