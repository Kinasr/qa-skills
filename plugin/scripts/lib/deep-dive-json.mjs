// @ts-check
// Ordered, labelled report sections for `/qa-deep-dive` commands (ADR-0071).
/** @import { ReportSection, SectionSpec } from "./report-sections.mjs" */
import { buildSections } from "./report-sections.mjs";

/** @type {readonly SectionSpec[]} */
export const REFS_SECTION_ORDER = [
  { id: "references", label: "References" },
];

/** @type {readonly string[]} */
export const REFS_ALLOWED_OUTSIDE = ["mode", "migration", "action", "ok", "access", "train"];

/**
 * Builds the `deep-dive refs` JSON response with resolved references inside `sections`.
 * @param {{ ok: boolean, references: readonly unknown[], access: Record<string, unknown>, train: unknown }} data
 * @returns {{ action: "refs", ok: boolean, access: Record<string, unknown>, train: unknown, sections: ReportSection[] }}
 */
export function buildRefsJson({ ok, references, access, train }) {
  /** @type {ReportSection[]} */
  const sections = buildSections(REFS_SECTION_ORDER, [
    { id: "references", items: references },
  ]);
  return { action: "refs", ok, access, train, sections };
}

/** @type {readonly SectionSpec[]} */
export const FEATURE_SECTION_ORDER = [
  { id: "rules", label: "Rules" },
  { id: "boundaries", label: "Boundaries" },
  { id: "retired", label: "Retired Keys" },
  { id: "sources", label: "Sources" },
  { id: "scenarios", label: "Scenario Files" },
  { id: "cases", label: "Case Index" },
  { id: "roles", label: "Project Roles" },
  { id: "categories", label: "Coverage Categories" },
  { id: "coverage", label: "Coverage" },
  { id: "deferred", label: "Deferred Functionality" },
  { id: "proposed_rules", label: "Proposed Rules" },
  { id: "open_questions", label: "Open Questions" },
  { id: "other_rules", label: "Other Features' Live Rules" },
];

/** @type {readonly string[]} */
export const FEATURE_ALLOWED_OUTSIDE = [
  "mode", "migration", "action", "ok", "feature", "status", "suite_key", "file", "path", "next_step", "train",
];

/**
 * Builds the `deep-dive feature` JSON response with knowledge and inventory data inside `sections`.
 * @param {{
 *   feature: string,
 *   status: "existing" | "new",
 *   suite_key: unknown,
 *   file: string,
 *   path: string,
 *   next_step: string,
 *   train: unknown,
 *   rules: readonly unknown[],
 *   boundaries?: readonly unknown[],
 *   retired: readonly unknown[],
 *   sources: readonly unknown[],
 *   scenario_files: readonly unknown[],
 *   caseIndex: readonly unknown[],
 *   roles: readonly unknown[],
 *   categories: readonly unknown[],
 *   coverage: readonly unknown[] | null,
 *   deferred_count: number,
 *   deferred_functionality: readonly unknown[],
 *   proposed_rules: readonly unknown[],
 *   openQuestions: readonly unknown[],
 *   other_rules: readonly unknown[],
 * }} data
 * @returns {{
 *   action: "feature",
 *   ok: true,
 *   feature: string,
 *   status: "existing" | "new",
 *   suite_key: unknown,
 *   file: string,
 *   path: string,
 *   next_step: string,
 *   train: unknown,
 *   sections: ReportSection[],
 * }}
 */
export function buildFeatureJson(data) {
  /** @type {ReportSection[]} */
  const sections = buildSections(FEATURE_SECTION_ORDER, [
    { id: "rules", items: data.rules },
    { id: "boundaries", items: data.boundaries ?? [] },
    { id: "retired", items: data.retired },
    { id: "sources", items: data.sources },
    { id: "scenarios", items: data.scenario_files },
    { id: "cases", items: data.caseIndex },
    { id: "roles", items: data.roles },
    { id: "categories", items: data.categories },
    { id: "coverage", items: data.coverage === null ? [] : [{ lines: data.coverage, deferred_count: data.deferred_count }] },
    { id: "deferred", items: data.deferred_functionality },
    { id: "proposed_rules", items: data.proposed_rules },
    { id: "open_questions", items: data.openQuestions },
    { id: "other_rules", items: data.other_rules },
  ]);
  return {
    action: "feature",
    ok: true,
    feature: data.feature,
    status: data.status,
    suite_key: data.suite_key,
    file: data.file,
    path: data.path,
    next_step: data.next_step,
    train: data.train,
    sections,
  };
}

/** @type {readonly SectionSpec[]} */
export const ROLES_SECTION_ORDER = [
  { id: "known", label: "Known Roles" },
  { id: "missing", label: "Missing Roles" },
];

/** @type {readonly string[]} */
export const ROLES_ALLOWED_OUTSIDE = ["mode", "migration", "action", "ok"];

/**
 * Builds the `deep-dive roles` JSON response with known and missing roles inside `sections`.
 * @param {{ known: readonly string[], missing: readonly { role: string, command: string }[] }} data
 * @returns {{ action: "roles", ok: true, sections: ReportSection[] }}
 */
export function buildRolesJson({ known, missing }) {
  /** @type {ReportSection[]} */
  const sections = buildSections(ROLES_SECTION_ORDER, [
    { id: "known", items: known },
    { id: "missing", items: missing },
  ]);
  return { action: "roles", ok: true, sections };
}

/** @type {readonly SectionSpec[]} */
export const AMEND_SECTION_ORDER = [
  { id: "rules", label: "Rules in Play" },
  { id: "cases", label: "Linked Test Cases" },
  { id: "boundaries", label: "Boundaries" },
  { id: "omitted", label: "Omitted From Amendment" },
];

/** @type {readonly string[]} */
export const AMEND_ALLOWED_OUTSIDE = ["mode", "migration", "action", "ok", "feature", "next_step"];

/**
 * Builds the `deep-dive amend` JSON response with bounded amendment items inside `sections`.
 * @param {{
 *   feature: string,
 *   rules: readonly unknown[],
 *   cases: readonly unknown[],
 *   boundaries?: readonly unknown[],
 *   omitted: { rules: number, cases: number },
 *   next_step: string,
 * }} data
 * @returns {{ action: "amend", ok: true, feature: string, next_step: string, sections: ReportSection[] }}
 */
export function buildAmendJson({ feature, rules, cases, boundaries = [], omitted, next_step }) {
  /** @type {ReportSection[]} */
  const sections = buildSections(AMEND_SECTION_ORDER, [
    { id: "rules", items: rules },
    { id: "cases", items: cases },
    { id: "boundaries", items: boundaries },
    { id: "omitted", items: omitted.rules > 0 || omitted.cases > 0 ? [omitted] : [] },
  ]);
  return { action: "amend", ok: true, feature, next_step, sections };
}

/** @type {readonly SectionSpec[]} */
export const RECONCILE_SECTION_ORDER = [
  { id: "edited", label: "Edited Rules" },
  { id: "outside_band", label: "Edited Outside Forecast" },
  { id: "unedited_changes", label: "Forecast Changes Not Edited" },
  { id: "added", label: "Added Rules" },
  { id: "retired", label: "Retired Rules" },
  { id: "boundary_check", label: "Boundary Check" },
  { id: "downstream", label: "Downstream Rules" },
  { id: "downstream_features", label: "Downstream Features" },
  { id: "next_feature", label: "Next Downstream Feature" },
  { id: "widened", label: "Widened Rules" },
  { id: "forecast", label: "Recorded Forecast" },
];

/** @type {readonly string[]} */
export const RECONCILE_ALLOWED_OUTSIDE = ["mode", "migration", "action", "ok", "feature", "change_file", "next_step"];

/**
 * Builds the `deep-dive reconcile` JSON response with reconciliation outcomes inside `sections`.
 * @param {{
 *   feature: string,
 *   edited: readonly unknown[],
 *   outside_band: readonly unknown[],
 *   unedited_changes: readonly unknown[],
 *   added: readonly unknown[],
 *   retired: readonly unknown[],
 *   boundary_check: readonly unknown[],
 *   downstream: readonly unknown[],
 *   downstream_features: readonly unknown[],
 *   next_feature: { command: string } | null,
 *   widened: readonly unknown[],
 *   forecast: readonly unknown[],
 *   change_file: string | null,
 *   next_step: string,
 * }} data
 * @returns {{
 *   action: "reconcile",
 *   ok: true,
 *   feature: string,
 *   change_file: string | null,
 *   next_step: string,
 *   sections: ReportSection[],
 * }}
 */
export function buildReconcileJson(data) {
  /** @type {ReportSection[]} */
  const sections = buildSections(RECONCILE_SECTION_ORDER, [
    { id: "edited", items: data.edited },
    { id: "outside_band", items: data.outside_band },
    { id: "unedited_changes", items: data.unedited_changes },
    { id: "added", items: data.added },
    { id: "retired", items: data.retired },
    { id: "boundary_check", items: data.boundary_check },
    { id: "downstream", items: data.downstream },
    { id: "downstream_features", items: data.downstream_features },
    { id: "next_feature", items: data.next_feature ? [data.next_feature] : [], next: data.next_feature?.command ?? null },
    { id: "widened", items: data.widened },
    { id: "forecast", items: data.forecast },
  ]);
  return {
    action: "reconcile",
    ok: true,
    feature: data.feature,
    change_file: data.change_file,
    next_step: data.next_step,
    sections,
  };
}

/** @type {readonly SectionSpec[]} */
export const RESUME_SECTION_ORDER = [
  { id: "references", label: "Handoff References" },
  { id: "edits", label: "Confirmed Rule Edits" },
  { id: "open_questions", label: "Open Questions" },
  { id: "design_questions", label: "Design Questions" },
  { id: "written", label: "Written Files" },
  { id: "uncommitted", label: "Uncommitted Files" },
];

/** @type {readonly string[]} */
export const RESUME_ALLOWED_OUTSIDE = ["mode", "migration", "action", "ok", "dir", "feature", "next_step"];

/**
 * Builds the `deep-dive resume` JSON response with handoff and question state inside `sections`.
 * @param {{
 *   dir: string | undefined,
 *   feature: string | null,
 *   references: readonly unknown[],
 *   edits: readonly unknown[],
 *   open_questions: readonly unknown[],
 *   design_questions?: readonly unknown[],
 *   written: readonly unknown[],
 *   uncommitted: readonly unknown[],
 *   next_step: string,
 * }} data
 * @returns {{
 *   action: "resume",
 *   ok: true,
 *   dir: string | undefined,
 *   feature: string | null,
 *   next_step: string,
 *   sections: ReportSection[],
 * }}
 */
export function buildResumeJson(data) {
  /** @type {ReportSection[]} */
  const sections = buildSections(RESUME_SECTION_ORDER, [
    { id: "references", items: data.references },
    { id: "edits", items: data.edits },
    { id: "open_questions", items: data.open_questions },
    { id: "design_questions", items: data.design_questions ?? [] },
    { id: "written", items: data.written },
    { id: "uncommitted", items: data.uncommitted },
  ]);
  return {
    action: "resume",
    ok: true,
    dir: data.dir,
    feature: data.feature,
    next_step: data.next_step,
    sections,
  };
}

/** @type {readonly SectionSpec[]} */
export const CHECK_SECTION_ORDER = [
  { id: "errors", label: "Check Errors" },
  { id: "warnings", label: "Check Warnings" },
  { id: "proposed_rules_left", label: "Unsettled Proposed Rules" },
  { id: "rules_added", label: "Rules Added" },
  { id: "rules_edited", label: "Rules Edited" },
  { id: "rules_retired", label: "Rules Retired" },
  { id: "sources_added", label: "Sources Added" },
];

/** @type {readonly string[]} */
export const CHECK_ALLOWED_OUTSIDE = [
  "mode", "migration", "action", "ok", "feature", "status", "file", "path", "coverage_digest", "changeset", "commit", "next_step",
];

/**
 * Builds the `deep-dive check` JSON response with validation and change summaries inside `sections`.
 * @param {{
 *   ok: boolean,
 *   feature: string,
 *   status: "existing" | "new" | "invalid",
 *   file?: string,
 *   path?: string,
 *   coverage_digest: string,
 *   errors?: readonly unknown[],
 *   warnings?: readonly unknown[],
 *   proposed_rules_left?: readonly unknown[],
 *   rules?: { added: readonly unknown[], edited: readonly unknown[], retired: readonly unknown[] },
 *   sources_added?: readonly unknown[],
 *   changeset?: readonly string[],
 *   commit?: string,
 *   next_step?: string,
 * }} data
 * @returns {{
 *   action: "check",
 *   ok: boolean,
 *   feature: string,
 *   status: "existing" | "new" | "invalid",
 *   file?: string,
 *   path?: string,
 *   coverage_digest: string,
 *   sections: ReportSection[],
 *   changeset?: readonly string[],
 *   commit?: string,
 *   next_step?: string,
 * }}
 */
export function buildCheckJson(data) {
  /** @type {ReportSection[]} */
  const sections = buildSections(CHECK_SECTION_ORDER, [
    { id: "errors", items: data.errors ?? [] },
    { id: "warnings", items: data.warnings ?? [] },
    { id: "proposed_rules_left", items: data.proposed_rules_left ?? [] },
    { id: "rules_added", items: data.rules?.added ?? [] },
    { id: "rules_edited", items: data.rules?.edited ?? [] },
    { id: "rules_retired", items: data.rules?.retired ?? [] },
    { id: "sources_added", items: data.sources_added ?? [] },
  ]);
  return {
    action: "check",
    ok: data.ok,
    feature: data.feature,
    status: data.status,
    ...(data.file !== undefined ? { file: data.file } : {}),
    ...(data.path !== undefined ? { path: data.path } : {}),
    coverage_digest: data.coverage_digest,
    sections,
    ...(data.ok ? { changeset: data.changeset, commit: data.commit, next_step: data.next_step } : {}),
  };
}
