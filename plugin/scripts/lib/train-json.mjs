// @ts-check
// Ordered, labelled report sections for `/qa-train` commands (ADR-0071).
//
// `train evidence` reports the exemplar, the scenario changes and the test-code evidence, and
// `train check` reports a draft's validation and what it changes. Both keep only what the skill acts
// on mechanically outside `sections`: its envelope, the target file's state and the project header,
// the paths it writes, the changeset and commit it makes, and the Auth template it writes byte for
// byte.
/** @import { ReportSection, SectionSpec } from "./report-sections.mjs" */
import { buildSections } from "./report-sections.mjs";

/**
 * One entry listing's change from the file on disk to the draft.
 * @typedef {{ added: unknown[], edited: unknown[], removed: unknown[] }} Listing
 */

/** @type {readonly SectionSpec[]} */
export const EVIDENCE_SECTION_ORDER = [
  { id: "exemplar", label: "Exemplar Scenario" },
  { id: "changes", label: "Scenario Changes" },
  { id: "sample", label: "Test Code Sample" },
  { id: "corpus", label: "Corpus Summary" },
  { id: "gate", label: "Gate Signals" },
  { id: "upkeep", label: "Training Upkeep" },
  { id: "citation_context", label: "Citation Context" },
  { id: "ref_candidates", label: "Ref Candidates" },
  { id: "features", label: "Features" },
  { id: "execution_results", label: "Latest Execution Results" },
  { id: "automation_results", label: "Latest Automation Results" },
];

/**
 * What `train evidence` keeps at the top level: its envelope, the branch it took, the target file's
 * state (`train`) with the project's Roles, Levels, targets, level map and fixtures, and the
 * codegen stack and baseline commit. `reason` and `error` are the failure facts.
 * @type {readonly string[]}
 */
export const EVIDENCE_ALLOWED_OUTSIDE = [
  "mode", "migration", "action", "ok", "target", "source", "train", "roles", "levels", "targets",
  "execute_levels", "fixtures", "stack", "relearn", "commit", "base", "reason", "error",
];

/**
 * The evidence outcomes a branch carries, each as the section it is reported in. An absent outcome
 * has no section.
 * @typedef {object} EvidenceParts
 * @property {readonly unknown[]} [exemplar]
 * @property {readonly unknown[]} [changes]
 * @property {readonly unknown[]} [sample]
 * @property {readonly unknown[]} [corpus]
 * @property {readonly unknown[]} [gate]
 * @property {readonly unknown[]} [upkeep]
 * @property {readonly unknown[]} [citation_context]
 * @property {readonly unknown[]} [ref_candidates]
 * @property {readonly unknown[]} [features]
 * @property {readonly unknown[]} [execution_results]
 * @property {readonly unknown[]} [automation_results]
 */

/**
 * Builds `train evidence`'s ordered sections from one branch's parts.
 * @param {EvidenceParts} [parts]
 * @returns {ReportSection[]}
 */
export function buildEvidenceSections(parts = {}) {
  return buildSections(EVIDENCE_SECTION_ORDER, [
    { id: "exemplar", items: parts.exemplar ?? [] },
    { id: "changes", items: parts.changes ?? [] },
    { id: "sample", items: parts.sample ?? [] },
    { id: "corpus", items: parts.corpus ?? [] },
    { id: "gate", items: parts.gate ?? [] },
    { id: "upkeep", items: parts.upkeep ?? [] },
    { id: "citation_context", items: parts.citation_context ?? [] },
    { id: "ref_candidates", items: parts.ref_candidates ?? [] },
    { id: "features", items: parts.features ?? [] },
    { id: "execution_results", items: parts.execution_results ?? [] },
    { id: "automation_results", items: parts.automation_results ?? [] },
  ]);
}

/** @type {readonly SectionSpec[]} */
export const CHECK_SECTION_ORDER = [
  { id: "errors", label: "Check Errors" },
  { id: "warnings", label: "Check Warnings" },
  { id: "statability", label: "Statability Hits" },
  { id: "conventions", label: "Conventions" },
  { id: "practices", label: "Practices" },
  { id: "recipes", label: "Data Recipes" },
  { id: "actions", label: "API Actions" },
  { id: "uploads", label: "Upload Fixtures" },
  { id: "access_notes", label: "Access Notes" },
  { id: "categories", label: "Categories" },
  { id: "effective", label: "Effective Categories" },
  { id: "access_files", label: "Access Files To Ignore" },
];

/**
 * What `train check` keeps at the top level: its envelope, the target and the two paths the skill
 * writes to, the changeset and commit it makes when the draft passes, and the Auth template it
 * writes byte for byte.
 * @type {readonly string[]}
 */
export const CHECK_ALLOWED_OUTSIDE = [
  "mode", "migration", "action", "ok", "target", "file", "path", "changeset", "commit", "auth_template",
  "reason", "error",
];

/**
 * What one `train check` call reports: the validation findings, the Statability hits, each entry
 * kind's listing, the categories result and the access files to keep out of Git.
 * @typedef {object} CheckParts
 * @property {readonly unknown[]} [errors]
 * @property {readonly unknown[]} [warnings]
 * @property {readonly unknown[]} [statability]
 * @property {Listing} [conventions]
 * @property {Listing} [practices]
 * @property {Listing} [recipes]
 * @property {Listing} [actions]
 * @property {Listing} [uploads]
 * @property {Listing} [access_notes]
 * @property {Listing} [categories]
 * @property {{ categories: readonly unknown[], retired: readonly unknown[] }} [effective]
 * @property {readonly unknown[]} [access_files]
 */

/**
 * One entry kind's listing as a section item, or no item when the draft changes none of its
 * entries. A listing whose three lists are empty has nothing to report.
 * @param {Listing | undefined} listed
 * @returns {Listing[]}
 */
const listedItems = (listed) => (listed && listed.added.length + listed.edited.length + listed.removed.length > 0 ? [listed] : []);

/**
 * Builds `train check`'s ordered sections.
 * @param {CheckParts} [parts]
 * @returns {ReportSection[]}
 */
export function buildCheckSections(parts = {}) {
  return buildSections(CHECK_SECTION_ORDER, [
    { id: "errors", items: parts.errors ?? [] },
    { id: "warnings", items: parts.warnings ?? [] },
    { id: "statability", items: parts.statability ?? [] },
    { id: "conventions", items: listedItems(parts.conventions) },
    { id: "practices", items: listedItems(parts.practices) },
    { id: "recipes", items: listedItems(parts.recipes) },
    { id: "actions", items: listedItems(parts.actions) },
    { id: "uploads", items: listedItems(parts.uploads) },
    { id: "access_notes", items: listedItems(parts.access_notes) },
    { id: "categories", items: listedItems(parts.categories) },
    { id: "effective", items: parts.effective ? [parts.effective] : [] },
    { id: "access_files", items: parts.access_files ?? [] },
  ]);
}
