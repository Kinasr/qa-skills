// @ts-check
// Design output data and refusals for the model to word.
import { refusalsWithoutLines } from "./refusal.mjs";
import { DEFAULT_CONCURRENCY } from "./delegates.mjs";
import { glossaryOf, labelOf, keyLabel } from "./labels.mjs";
import { table } from "./markdown.mjs";
import { sameStatement } from "./proposed-rules.mjs";
import { buildSections } from "./report-sections.mjs";

/** @import { Override, Repeat } from "./design-duplicates.mjs" */
/** @import { PlanSkip, PlanSkipReason, StateCoverage, TrainModule } from "./design.mjs" */
/** @import { SectionSpec } from "./report-sections.mjs" */
/** @import { SettleScope } from "./settle-walk.mjs" */
/** @import { UncitedCase, UncoveredRule } from "./scan-links.mjs" */
/** @import { ProposedRule } from "./proposed-rules.mjs" */
/** @import { Agreement, AgreementGap, AgreementRefusal, CoverageViews } from "./design-agreement.mjs" */

// What each step takes, for `bad_arguments`.
/** @type {Record<string, string>} */
const ARGUMENTS = {
  state: "one Feature key and at most one scenario key",
  agree: "one scope, `feature` or a scenario key",
  plan: "one Feature key and at most one scenario key",
  split: "exactly one Feature key",
  report: "no argument, only the run directory",
  keep: "no argument, only the run directory and the kept items on standard input",
  unbind: "exactly one Test Case key and the run directory",
};

// The shape each stdin-taking step reads, for `bad_override`, `bad_keep` and `split_not_json`.
const SHAPES = {
  bad_override: "a JSON object of a stored case's Key to a non-blank reason",
  bad_keep: '{"keep": [{"item": <report item number>, "statement"?: "<the engineer\'s rewording>"}]}',
};

// Every refusal code this module can print, for the skills lint's "names no CLI data" check.
/** @type {readonly string[]} */
export const REFUSAL_CODES = [
  "unknown_action",
  "dir_and_out",
  "bad_arguments",
  "expand_and_regenerate",
  "no_feature",
  "no_rules",
  "no_scenario",
  "no_split",
  "split_not_json",
  "no_override",
  "bad_override",
  "unbind_not_written",
  "unbind_kept",
  "unbind_missing",
  "unbind_check",
  "unbind_history",
  "mint_failed",
  "no_keep",
  "bad_keep",
  "unknown_proposal",
  "keep_no_feature",
  "keep_check",
];

/**
 * Why a scenario file is no unit, as one factual line the code builds. The mode and the scenario
 * the line speaks about are the only fields a line reads.
 * @typedef {{ mode: string } & Record<string, unknown>} SkippedInput
 */
/**
 * A refusal's fact for a scenario file no unit of the run.
 * @typedef {(input: SkippedInput) => string} SkippedFact
 */

// Why a scenario file is no unit of the run, as the end of a sentence about it. `brief design`
// refuses a file the same way, in the same words. Keyed by the plan's reason union (lib/design.mjs
// `PLAN_SKIP_REASONS`), so a reason with no line here fails the type check.
/** @type {Record<PlanSkipReason, SkippedFact>} */
export const SKIPPED = {
  populated: () => "already holds Test Cases: a bare run fills empty scenario files only; `--expand` adds to one, `--regenerate` redoes one",
  not_populated: ({ mode }) => `has no Test Cases to ${mode}: a bare run fills an empty scenario file`,
  nothing_replaceable: () => "has no unreviewed case without a Tracker key: `--regenerate` never touches a reviewed or tracker-linked case",
  waived_only: () => "has no uncovered Rule without a Waiver: `--expand` has nothing left to cover",
  fails_check: () => "cannot be designed: its file does not pass its check",
  unaddressable: () => "cannot be designed: its key is declared by more than one scenario file",
  not_agreed: () => "keeps its Test Cases: the agreement did not name it",
};

// Why a unit's cases were not written.
/** @type {Record<string, string>} */
export const NOT_WRITTEN = {
  changed: "The file changed after its brief was built, so it was not written over.",
  missing: "The file no longer exists.",
  io: "The write failed and the file is as it was.",
  duplicate: "A proposed Test Case repeats a stored one or another proposal of the run, and the engineer has stated no reason that lets it through, so nothing was written.",
};

// What is wrong with a reply that cannot be used: one line for each code `check-reply design` gives.
/** @type {Record<string, string>} */
export const PROBLEMS = {
  no_json_block: "The reply held no block of Test Cases.",
  truncated: "The reply was cut off.",
  unparseable: "The reply's block of Test Cases could not be read.",
  bad_shape: "The reply's block is not a list of Test Cases and proposed Rules.",
  no_cases: "The reply held no Test Case.",
  malformed_case: "A Test Case is not a whole entry.",
  bad_summary: "A Test Case has no one-line summary.",
  empty_covers: "A Test Case covers no Rule.",
  unknown_rule: "A Test Case covers something that is no Rule of the Feature.",
  bad_relies_on: "A Test Case's Reliance links could not be read.",
  bad_override_reason: "A Test Case's reason for being a distinct pass could not be read.",
  unknown_reliance: "A Test Case rests on something that is no Rule its brief shows.",
  bad_roles: "A Test Case's Roles could not be read.",
  unknown_role: "A Test Case names a Role the project does not list.",
  duplicate_role: "A Test Case lists a step Role more than once.",
  unused_role: "A Test Case lists a Role that acts in no step.",
  unknown_actor: "A Test Case's actor prefix is missing or names an unexpected Role.",
  bad_level: "A Test Case has an invalid level binding.",
  binding_reason_required: "A bound Test Case has no binding reason.",
  unagreed_level: "A Test Case is at a level outside the scenario's agreement.",
  unknown_level: "A Test Case is at a level the project does not list.",
  bad_steps: "A Test Case's steps could not be read.",
  empty_steps: "A Test Case has no steps.",
  bad_preconditions: "A Test Case's preconditions could not be read.",
  bad_automatable: "A Test Case does not say whether it can be automated.",
  bad_manual: "A Test Case does not say whether a Tester can perform it.",
  empty_expected: "A Test Case has no Expected-result paragraph.",
  bad_proposed_rule: "A proposed Rule could not be read.",
  bad_check_gap: "A check gap could not be read: it names no one-line Test Case summary or states no need.",
  unknown_check_case: "A check gap names a Test Case the reply did not propose.",
};

// Why a label a reply assigned was dropped: a label is checked apart from the case's claim, so the
// case is written without it.
/** @type {Record<string, string>} */
export const DROPPED_LABELS = {
  label_shape: "The label was not in the shape its field takes.",
  label_unknown: "The project declares no such Tag or Custom-field value.",
  label_retired: "The Tag or Custom-field value is retired: existing cases keep it, new ones do not take it.",
  label_unmeant: "The Tag has no meaning, so a filler does not assign it.",
};

// Why a regenerate could not give a replaced case's label to a regenerated case.
/** @type {Record<string, string>} */
export const LOST_LABELS = {
  label_unmatched: "No regenerated case covers the same Rules as the replaced case, so its label went with it.",
  label_retired: "The Tag or Custom-field value is retired, so it is not given to a new case.",
};

// Why a unit came back with nothing usable, one line for each kind the dispatch records.
/** @type {Record<string, string>} */
export const FAILED = {
  unusable: "Every attempt came back unusable.",
  not_dispatched: "The unit was never sent: dispatch did not reach it.",
  in_flight: "The unit was still running when the report was made.",
  quota: "The Delegate's allowance was spent.",
  other: "The Delegate failed.",
  timeout: "The Delegate timed out.",
  refused: "The harness refused the Delegate.",
};

// What the delegation layer notes about the dispatch, by code.
/** @type {Record<string, { line: string, allowed: number }>} */
export const NOTES = {
  concurrency_cap_invalid: { line: "project.md sets no valid limit on parallel calls, so the default was allowed.", allowed: DEFAULT_CONCURRENCY },
};

// A refusal's fact: its code, the arguments or shape the step reads, and the data it carries.
export const { fact, refuse } = refusalsWithoutLines((code, data) => ({
  ...(code === "bad_arguments" && { takes: ARGUMENTS[/** @type {string} */ (data.action)] }),
  ...(SHAPES[/** @type {keyof typeof SHAPES} */ (code)] && { shape: SHAPES[/** @type {keyof typeof SHAPES} */ (code)] }),
  ...data,
}));

// A glossary entry as the reports carry it.
/**
 * @typedef {object} GlossaryEntry
 * @property {string} term
 * @property {string} explanation
 */

/**
 * A reason as data: its code with its one factual line.
 * @param {string} code
 * @param {string} line
 * @returns {{ code: string, line: string }}
 */
const withLine = (code, line) => ({ code, line });

/**
 * One scenario file's unit outcome, as a closed scenario-status union (see {@link DesignReportSource}).
 * @typedef {object} WrittenScenario
 * @property {string} scenario
 * @property {string} file
 * @property {"written"} status
 * @property {number} cases_written
 * @property {string[]} cases
 * @property {string[]} not_automatable
 * @property {string[]} not_manual
 * @property {{ key: string, summary: string }[]} replaced
 * @property {string} [retired_in] - the repo-relative Feature file the unit wrote `retired:` tombstones to
 * @property {Array<Omit<Override, "summary"> & { key: string }>} [overridden] - the written cases that
 *   repeat a stored case and the engineer stated why they are a distinct pass
 * @property {Repeat[]} [duplicates] - the reply's other proposals, refused for repeating a stored case or an earlier proposal
 * @property {Array<import("./case-labels.mjs").DroppedLabel & { key: string }>} [dropped_labels] - the labels dropped from the written cases
 * @property {import("./case-labels.mjs").LostLabel[]} [lost_labels] - the labels of the replaced cases no regenerated case took
 */
/**
 * @typedef {object} NotWrittenScenario
 * @property {string} scenario
 * @property {string} file
 * @property {"not_written"} status
 * @property {number} cases_written
 * @property {string} reason
 * @property {string[]} problems
 * @property {Repeat[]} [duplicates] - the proposed cases a `duplicate` refusal names, each with the
 *   Key it repeats
 */
/**
 * @typedef {object} FailedScenario
 * @property {string} scenario
 * @property {string} file
 * @property {"failed"} status
 * @property {number} cases_written
 * @property {string} kind
 * @property {number} attempts
 * @property {string[]} problems
 */
/**
 * A proposal-only unit: no case was written because the Delegate found the Rules insufficient. Its
 * proposals are handed to /qa-deep-dive, never retried as a design rerun.
 * @typedef {object} AwaitingScenario
 * @property {string} scenario
 * @property {string} file
 * @property {"awaiting_rules"} status
 * @property {number} cases_written
 * @property {{ statement: string, why?: string }[]} proposals
 */
/**
 * @typedef {WrittenScenario | NotWrittenScenario | FailedScenario | AwaitingScenario} ReportScenario
 */

/**
 * A proposed Rule, as design hands it to /qa-deep-dive ({@link DesignProposedRule} of lib/design-contract.mjs).
 * @typedef {{ scenario: string, statement: string, why?: string }} ReportProposed
 */

/**
 * One check gap as design hands it to `/qa-train design`: the case's Key when the Run wrote it, and
 * what checking its Expected result needs.
 * @typedef {{ scenario: string, key: string | null, case: string, needs: string }} ReportCheckGap
 */

/**
 * One agreed obligation's outcome after the Run: `covered` when a stored case names its Rule, and
 * otherwise why the run delivered no evidence. `omitted` is a unit that wrote other cases but not
 * this Rule (a regenerate's replaced-only coverage included); `awaiting` is a proposal-only unit;
 * `deferred` is a scenario this Run did not attempt; `failed` is a unit that did and delivered
 * nothing.
 * @typedef {"covered" | "failed" | "awaiting" | "deferred" | "omitted"} DeclaredOutcome
 */
/**
 * @typedef {object} DeclaredObligation
 * @property {string} rule
 * @property {DeclaredOutcome} outcome
 */
/**
 * One scenario's declared coverage: its agreed action and every obligation with its outcome.
 * @typedef {object} DeclaredScenario
 * @property {string} scenario
 * @property {string} action
 * @property {DeclaredObligation[]} obligations
 */
/**
 * The execution bound's declared coverage: the per-scenario data and the table the CLI renders
 * (ADR-0024).
 * @typedef {object} DeclaredCoverage
 * @property {"declared coverage"} label
 * @property {DeclaredScenario[]} scenarios
 * @property {string | null} markdown
 */
/**
 * One scenario attribution for a Proposed Rule in the report's `proposals` list.
 * @typedef {{ scenario: string | null, label?: string, why?: string }} ReportProposalSource
 */
/**
 * One numbered entry of the report's single list of Proposed Rules the engineer may keep
 * (ADR-0067): every Delegate's and every hand-off's, each statement once. `scenario` is null for a
 * proposal the agreement made; `scenarios` keeps every scenario's attribution; `kept` says the
 * Feature already holds the statement.
 * @typedef {object} ReportProposal
 * @property {number} item
 * @property {string} statement
 * @property {string} [why]
 * @property {string | null} scenario
 * @property {string} [label] - the scenario's label, in the report's JSON only
 * @property {ReportProposalSource[]} [scenarios]
 * @property {boolean} kept
 */
/**
 * One proposed Rule in the report's hand-offs: a pre-dispatch proposal from the agreement, or one
 * an `awaiting_rules` unit returned.
 * @typedef {object} ReportHandoffProposed
 * @property {string} statement
 * @property {string} [why]
 */
/**
 * The agreement's pre-dispatch hand-offs plus each awaiting unit's proposals.
 * @typedef {object} ReportHandoffs
 * @property {ReportHandoffProposed[]} proposed_rules
 * @property {string[]} coverage_corrections
 */

/**
 * The report's Run health, what one disseminated dispatch says. `retried` and `notes` are the
 * dispatch state's own fields (lib/delegation.mjs `readDispatch`), the only fields the report reads.
 * @typedef {object} RunHealth
 * @property {string} run
 * @property {number} calls
 * @property {string[]} announcements
 * @property {{ unit: string, feature: string | null, scenario: string | null, attempts: number }[]} retried
 * @property {{ code: string, [key: string]: unknown }[]} notes
 */

/**
 * What `design report` gathers for `reportData` (lib/design.mjs `report`): the Run's dispatch, its
 * scenario outcomes, still-empty files and the changeset.
 * @typedef {object} DesignReportSource
 * @property {string} feature
 * @property {string} mode
 * @property {boolean} dispatched
 * @property {string[] | undefined} delegate
 * @property {ReportScenario[]} scenarios
 * @property {ReportBinding[]} bindings
 * @property {{ code: string, scenario: string, key: string, file: string, missing_levels: string[] }[]} case_warnings
 * @property {{ code: string, scenario: string, level: string, file: string }[]} missing_levels
 * @property {PlanSkip[]} skipped
 * @property {number} cases_written
 * @property {import("./design-questions.mjs").RunQuestion[]} questions
 * @property {string | null} question_handoff
 * @property {ReportCheckGap[]} check_gaps
 * @property {string | null} check_handoff
 * @property {ReportProposal[]} proposals
 * @property {string | null} keep - the `design keep` command when any proposal is not yet kept
 * @property {string} handoff
 * @property {{ scenario: string, file: string, command: string }[]} still_empty
 * @property {string | null} rerun
 * @property {{ scenario: string, command: string }[]} reruns
 * @property {RunHealth | null} run_health
 * @property {{ paths: string[], commit: string | null }} changeset
 * @property {DeclaredCoverage} [declared_coverage] - present only when the Run recorded an agreement
 * @property {ReportHandoffs} [handoffs] - present only when the Run recorded an agreement
 */

/**
 * A binding this Run wrote, retaining its original levels and reason after an unbinding.
 * @typedef {{ key: string, scenario: string, file: string, level: import("./case-fields.mjs").CaseLevel, reason: string, unbound?: boolean }} ReportBinding
 */

/**
 * @typedef {"written" | "replaced" | "bindings" | "case_warnings" | "missing_levels" | "overridden" | "duplicates" | "dropped_labels" | "lost_labels" | "not_written" | "failed" | "awaiting_rules" | "skipped" | "still_empty" | "reruns" | "not_automatable" | "not_manual" | "questions" | "check_gaps" | "proposals" | "coverage_corrections" | "declared_coverage" | "run_health"} DesignReportSectionId
 */

/**
 * Ordered section registry: every report outcome belongs to one entry in reading order.
 * @type {readonly (SectionSpec & { readonly id: DesignReportSectionId })[]}
 */
export const SECTION_ORDER = [
  { id: "written", label: "Written Test Cases" },
  { id: "replaced", label: "Replaced Test Cases" },
  { id: "bindings", label: "Level bindings" },
  { id: "case_warnings", label: "Permission binding warnings" },
  { id: "missing_levels", label: "Agreed levels without cases" },
  { id: "overridden", label: "Overridden duplicate repeats" },
  { id: "duplicates", label: "Refused duplicate repeats" },
  { id: "dropped_labels", label: "Dropped labels" },
  { id: "lost_labels", label: "Lost labels" },
  { id: "not_written", label: "Units not written" },
  { id: "failed", label: "Failed units" },
  { id: "awaiting_rules", label: "Scenarios awaiting Rules" },
  { id: "skipped", label: "Skipped scenarios" },
  { id: "still_empty", label: "Still-empty scenarios" },
  { id: "reruns", label: "Re-run commands" },
  { id: "not_automatable", label: "Not automatable" },
  { id: "not_manual", label: "Not manual" },
  { id: "questions", label: "Ambiguous outcomes" },
  { id: "check_gaps", label: "Check gaps" },
  { id: "proposals", label: "Proposed Rules" },
  { id: "coverage_corrections", label: "Coverage corrections" },
  { id: "declared_coverage", label: "Declared coverage" },
  { id: "run_health", label: "Run health" },
];

/**
 * @typedef {{ scenario: string, label: string, file: string, case: string }} ReportReplacedItem
 * @typedef {{ code: string, scenario: string, key: string, file: string, missing_levels: string[] }} ReportCaseWarningItem
 * @typedef {{ code: string, scenario: string, level: string, file: string }} ReportMissingLevelItem
 * @typedef {Omit<Override, "summary"> & { scenario: string, label: string, file: string, key: string }} ReportOverriddenItem
 * @typedef {Repeat & { scenario: string, label: string, file: string, status: "written" | "not_written" }} ReportDuplicateItem
 * @typedef {{ scenario: string, scenario_label: string, key: string, label: string, field: string, value: unknown, code: string, line: string }} ReportLabelIssueItem
 * @typedef {{ scenario: string, label: string, file: string, reason: { code: string, line: string } }} ReportNotWrittenItem
 * @typedef {{ scenario: string, label: string, file: string, reason: { code: string, line: string }, attempts: number, problems: { code: string, line: string }[] }} ReportFailedItem
 * @typedef {{ scenario: string, label: string, file: string, proposals: { statement: string, why?: string }[] }} ReportAwaitingItem
 * @typedef {{ scenario: string, label: string, file: string, status: string, reason: { code: string, line: string } }} ReportSkippedItem
 * @typedef {{ scenario: string, label: string, file: string, command: string }} ReportStillEmptyItem
 * @typedef {{ scenario: string | null, label: string | null, command: string }} ReportRerunItem
 * @typedef {{ scenario: string, key: string, label: string }} ReportNotAutomatableItem
 * @typedef {{ scenario: string, key: string, label: string, automatable: boolean }} ReportNotManualItem
 * @typedef {import("./design-questions.mjs").RunQuestion} ReportQuestionItem
 * @typedef {ReportCheckGap & { label: string }} ReportCheckGapItem
 * @typedef {ReportProposal} ReportProposalItem
 * @typedef {{ correction: string }} ReportCoverageCorrectionItem
 * @typedef {{ run: string, calls: number, announcements: string[], retried: { scenario: string | null, label: string, attempts: number }[], notes: { code: string, line: string, allowed?: number }[] }} ReportRunHealthItem
 */

/**
 * One ordered, labelled section of `design report`. Each carries `items` or `markdown`, plus an
 * optional section-wide `next` command.
 * @typedef {(
 *   | { id: "written", label: string, markdown: string, next?: string }
 *   | { id: "replaced", label: string, items: ReportReplacedItem[], next?: string }
 *   | { id: "bindings", label: string, items: ReportBinding[], next?: string }
 *   | { id: "case_warnings", label: string, items: ReportCaseWarningItem[], next?: string }
 *   | { id: "missing_levels", label: string, items: ReportMissingLevelItem[], next?: string }
 *   | { id: "overridden", label: string, items: ReportOverriddenItem[], next?: string }
 *   | { id: "duplicates", label: string, items: ReportDuplicateItem[], next?: string }
 *   | { id: "dropped_labels", label: string, items: ReportLabelIssueItem[], next?: string }
 *   | { id: "lost_labels", label: string, items: ReportLabelIssueItem[], next?: string }
 *   | { id: "not_written", label: string, items: ReportNotWrittenItem[], next?: string }
 *   | { id: "failed", label: string, items: ReportFailedItem[], next?: string }
 *   | { id: "awaiting_rules", label: string, items: ReportAwaitingItem[], next?: string }
 *   | { id: "skipped", label: string, items: ReportSkippedItem[], next?: string }
 *   | { id: "still_empty", label: string, items: ReportStillEmptyItem[], next?: string }
 *   | { id: "reruns", label: string, items: ReportRerunItem[], next?: string }
 *   | { id: "not_automatable", label: string, items: ReportNotAutomatableItem[], next?: string }
 *   | { id: "not_manual", label: string, items: ReportNotManualItem[], next?: string }
 *   | { id: "questions", label: string, items: ReportQuestionItem[], next?: string }
 *   | { id: "check_gaps", label: string, items: ReportCheckGapItem[], next?: string }
 *   | { id: "proposals", label: string, items: ReportProposalItem[], next?: string }
 *   | { id: "coverage_corrections", label: string, items: ReportCoverageCorrectionItem[], next?: string }
 *   | { id: "declared_coverage", label: string, markdown: string, next?: string }
 *   | { id: "run_health", label: string, items: ReportRunHealthItem[], next?: string }
 * )} DesignReportSection
 */

/**
 * The Run's changeset, as `design report` carries it.
 * @typedef {object} DesignChangeset
 * @property {string[]} paths
 * @property {string | null} commit
 */
/**
 * `design-json`'s output contract: the closing report as data, that `design report`
 * returns as its `json`. Every report outcome lives in `sections`.
 * @typedef {object} DesignReportJson
 * @property {true} ok
 * @property {string} feature
 * @property {string} design_mode
 * @property {boolean} dispatched
 * @property {string[] | null} delegates
 * @property {number} cases_written
 * @property {DesignReportSection[]} sections
 * @property {string | null} keep - the `design keep` command when any proposal is not yet kept
 * @property {DesignChangeset} changeset
 * @property {GlossaryEntry[]} glossary
 */

// The closing report as data. `m` is what `report` in lib/design.mjs gathers; `summaryOf` gives
// `.qa/`'s summaries (lib/labels.mjs `summaries`).
/**
 * @param {DesignReportSource} m
 * @param {{ scenario(key: string): string | undefined, feature(key: string): string | undefined, testCase(key: string): string | undefined, rule(key: string): string | undefined, boundary(key: string): string | undefined }} summaryOf
 * @returns {DesignReportJson}
 */
export function reportData(m, summaryOf) {
  /** @type {Set<string>} */
  const terms = new Set();
  /**
   * @param {string} name
   * @returns {Set<string>}
   */
  const term = (name) => terms.add(name);
  /**
   * @param {string} key
   * @returns {string}
   */
  const scenario = (key) => labelOf(summaryOf, key);
  /**
   * @param {{ scenario: string, file: string }} s
   * @returns {{ scenario: string, label: string, file: string }}
   */
  const where = (s) => ({ scenario: s.scenario, label: scenario(s.scenario), file: s.file });
  /** @type {string[][]} */
  const rows = [];
  if (m.delegate) term("Delegate");

  /** @type {ReportReplacedItem[]} */
  const replaced = [];
  /** @type {ReportOverriddenItem[]} */
  const overridden = [];
  /** @type {ReportDuplicateItem[]} */
  const duplicates = [];
  /** @type {ReportLabelIssueItem[]} */
  const droppedLabels = [];
  /** @type {ReportLabelIssueItem[]} */
  const lostLabels = [];
  /** @type {ReportNotWrittenItem[]} */
  const notWritten = [];
  /** @type {ReportFailedItem[]} */
  const failed = [];
  /** @type {ReportAwaitingItem[]} */
  const awaitingRules = [];
  /** @type {ReportNotAutomatableItem[]} */
  const notAutomatable = [];
  /** @type {ReportNotManualItem[]} */
  const notManual = [];

  /**
   * @param {string} scenarioKey
   * @param {string} scenarioLabel
   * @param {{ key: string, field: string, value: unknown, code: string }} issue
   * @param {Record<string, string>} messages
   * @returns {ReportLabelIssueItem}
   */
  const labelIssue = (scenarioKey, scenarioLabel, issue, messages) => ({
    scenario: scenarioKey,
    scenario_label: scenarioLabel,
    key: issue.key,
    label: labelOf(summaryOf, issue.key),
    field: issue.field,
    value: issue.value,
    ...withLine(issue.code, messages[issue.code]),
  });

  for (const s of m.scenarios) {
    const loc = where(s);
    if (s.status === "written") {
      for (const key of s.cases) rows.push([loc.label, s.file, labelOf(summaryOf, key)]);
      for (const c of s.replaced) replaced.push({ ...loc, case: keyLabel(c.key, c.summary) });
      for (const o of s.overridden ?? []) overridden.push({ ...loc, ...o });
      for (const d of s.duplicates ?? []) duplicates.push({ ...loc, status: "written", ...d });
      for (const d of s.dropped_labels ?? []) droppedLabels.push(labelIssue(s.scenario, loc.label, d, DROPPED_LABELS));
      for (const d of s.lost_labels ?? []) lostLabels.push(labelIssue(s.scenario, loc.label, d, LOST_LABELS));
      for (const key of s.not_automatable) notAutomatable.push({ scenario: s.scenario, key, label: labelOf(summaryOf, key) });
      for (const key of s.not_manual) notManual.push({ scenario: s.scenario, key, label: labelOf(summaryOf, key), automatable: !s.not_automatable.includes(key) });
    } else if (s.status === "awaiting_rules") {
      // A proposal-only unit wrote nothing: its Rules go to /qa-deep-dive, never a design retry.
      awaitingRules.push({ ...loc, proposals: s.proposals });
    } else if (s.status === "not_written") {
      notWritten.push({ ...loc, reason: withLine(s.reason, NOT_WRITTEN[s.reason]) });
      for (const d of s.duplicates ?? []) duplicates.push({ ...loc, status: "not_written", ...d });
    } else {
      if (["quota", "other", "timeout", "refused"].includes(s.kind)) term("Delegate");
      for (const p of s.problems) if (p === "unknown_role") term("Role"); else if (p === "empty_expected") term("Expected-result paragraph");
      failed.push({ ...loc, reason: withLine(s.kind, FAILED[s.kind]), attempts: s.attempts, problems: [...new Set(s.problems)].map((p) => withLine(p, PROBLEMS[p])) });
    }
  }

  const h = m.run_health;
  if (h) {
    term("Run");
    if (h.announcements.length) term("Fallback");
  }

  const extraHandoffProposals = (m.handoffs?.proposed_rules ?? []).filter(
    (hp) => !m.proposals.some((p) => sameStatement(p.statement, hp.statement)),
  );
  /** @type {ReportProposal[]} */
  const proposalItems = [
    ...m.proposals.map((p) => ({
      ...p,
      ...(p.scenario !== null && { label: scenario(p.scenario) }),
      ...(p.scenarios && {
        scenarios: p.scenarios.map((a) => ({
          ...a,
          ...(a.scenario !== null && { label: scenario(a.scenario) }),
        })),
      }),
    })),
    ...extraHandoffProposals.map((hp, i) => ({
      item: m.proposals.length + i + 1,
      statement: hp.statement,
      ...(hp.why === undefined ? {} : { why: hp.why }),
      scenario: null,
      scenarios: [{ scenario: null, ...(hp.why === undefined ? {} : { why: hp.why }) }],
      kept: false,
    })),
  ];

  const stillEmptyItems = m.still_empty.map((s) => ({ ...where(s), command: s.command }));
  /** @type {ReportRerunItem[]} */
  const rerunItems = [
    ...(m.rerun && !stillEmptyItems.length ? [{ scenario: null, label: null, command: m.rerun }] : []),
    ...m.reruns.map((c) => ({ scenario: c.scenario, label: scenario(c.scenario), command: c.command })),
  ];

  const sections = /** @type {DesignReportSection[]} */ (buildSections(SECTION_ORDER, [
    { id: "written", markdown: table(["Scenario", "File", "Test Case written"], rows) },
    { id: "replaced", items: replaced },
    { id: "bindings", items: m.bindings },
    { id: "case_warnings", items: m.case_warnings },
    { id: "missing_levels", items: m.missing_levels },
    { id: "overridden", items: overridden },
    { id: "duplicates", items: duplicates },
    { id: "dropped_labels", items: droppedLabels },
    { id: "lost_labels", items: lostLabels },
    { id: "not_written", items: notWritten },
    { id: "failed", items: failed },
    { id: "awaiting_rules", items: awaitingRules, next: m.handoff },
    { id: "skipped", items: (m.dispatched ? [] : m.skipped).map((s) => ({ ...where(s), status: s.status, reason: withLine(s.reason, SKIPPED[s.reason]({ ...s, feature: m.feature, mode: m.mode })) })) },
    { id: "still_empty", items: stillEmptyItems, next: m.rerun },
    { id: "reruns", items: rerunItems },
    { id: "not_automatable", items: notAutomatable },
    { id: "not_manual", items: notManual },
    { id: "questions", items: m.questions, next: m.question_handoff },
    { id: "check_gaps", items: m.check_gaps.map((g) => ({ scenario: g.scenario, label: scenario(g.scenario), key: g.key, case: g.key === null ? g.case : keyLabel(g.key, g.case), needs: g.needs })), next: m.check_handoff },
    { id: "proposals", items: proposalItems, next: m.handoff },
    { id: "coverage_corrections", items: (m.handoffs?.coverage_corrections ?? []).map((correction) => ({ correction })), next: m.handoff },
    { id: "declared_coverage", markdown: m.declared_coverage?.markdown ?? null },
    { id: "run_health", items: h ? [{ run: h.run, calls: h.calls, announcements: h.announcements, retried: h.retried.map((x) => ({ scenario: x.scenario, label: scenario(/** @type {string} */ (x.scenario)), attempts: x.attempts })), notes: h.notes.map((n) => ({ code: n.code, ...NOTES[n.code] })) }] : [] },
  ]));

  /** @type {DesignReportJson} */
  return {
    ok: true,
    feature: labelOf(summaryOf, m.feature),
    design_mode: m.mode,
    dispatched: m.dispatched,
    delegates: m.delegate ?? null,
    cases_written: m.cases_written,
    sections,
    keep: m.keep,
    changeset: m.changeset,
    glossary: glossaryOf(terms),
  };
}

/**
 * What `design state` gathers for `stateData` (lib/design.mjs's state action): the run header and
 * the working inputs the skill acts on, the Coverage standing, and the settle and link scopes.
 * @typedef {object} DesignStateSource
 * @property {boolean} phase1
 * @property {boolean} no_targets
 * @property {{ key: string, statement: string, waiver: string | null }[]} rules
 * @property {string[]} roles
 * @property {string[]} levels
 * @property {TrainModule} train
 * @property {StateCoverage} coverage
 * @property {SettleScope["open_findings"]} open_findings
 * @property {UncitedCase[]} uncited_cases
 * @property {UncoveredRule[]} uncovered_rules
 * @property {ProposedRule[]} proposed_rules
 * @property {SettleScope["review"]} [review]
 */

/**
 * Ordered section registry for `design state`: every outcome the skill words for the engineer, in
 * reading order. The run header, its working inputs and its gates stay outside `sections`.
 * @type {readonly SectionSpec[]}
 */
export const STATE_SECTION_ORDER = [
  { id: "coverage", label: "Coverage" },
  { id: "coverage_due", label: "Coverage due" },
  { id: "open_findings", label: "Open findings" },
  { id: "uncited_cases", label: "Uncited Test Cases" },
  { id: "uncovered_rules", label: "Uncovered Rules" },
  { id: "proposed_rules", label: "Proposed Rules" },
  { id: "review_due", label: "Review due" },
];

/**
 * `design state`'s output contract: the gates and working inputs the skill acts on, and every
 * outcome it words as an ordered, labelled section.
 * @typedef {object} DesignStateJson
 * @property {true} ok
 * @property {boolean} phase1
 * @property {boolean} no_targets
 * @property {{ key: string, statement: string, waiver: string | null }[]} rules
 * @property {string[]} roles
 * @property {string[]} levels
 * @property {TrainModule} train
 * @property {import("./report-sections.mjs").ReportSection[]} sections
 */

// `design state` as data. An absent outcome has no section; the open-finding gate and the Review
// list each carry their whole record, so nothing the settle engine computed is lost.
/**
 * @param {DesignStateSource} m
 * @returns {DesignStateJson}
 */
export function stateData(m) {
  return {
    ok: true,
    phase1: m.phase1,
    no_targets: m.no_targets,
    rules: m.rules,
    roles: m.roles,
    levels: m.levels,
    train: m.train,
    sections: buildSections(STATE_SECTION_ORDER, [
      { id: "coverage", markdown: m.coverage.markdown },
      { id: "coverage_due", items: m.coverage.due === null ? [] : [m.coverage.due], next: m.coverage.next_step },
      { id: "open_findings", items: m.open_findings.open ? [m.open_findings] : [] },
      { id: "uncited_cases", items: m.uncited_cases },
      { id: "uncovered_rules", items: m.uncovered_rules },
      { id: "proposed_rules", items: m.proposed_rules },
      { id: "review_due", items: m.review === undefined ? [] : [m.review] },
    ]),
  };
}

/**
 * Ordered section registry for `design agree`: the coverage views the skill words and the Feature
 * gaps a scoped run reports, in reading order.
 * @type {readonly SectionSpec[]}
 */
export const AGREE_SECTION_ORDER = [
  { id: "views", label: "Coverage views" },
  { id: "gaps", label: "Feature gaps" },
];

/**
 * `design agree`'s output contract: the canonical agreement and its refusals stay outside, while
 * the coverage views and Feature gaps are labelled sections.
 * @typedef {object} DesignAgreeJson
 * @property {boolean} ok
 * @property {Agreement | null} agreement
 * @property {AgreementRefusal[]} refusals
 * @property {import("./report-sections.mjs").ReportSection[]} sections
 */

// `design agree` as data: the planned and actual views as the Markdown the engineer reads, and the
// Feature gaps a scoped run reports rather than refuses.
/**
 * @param {{ ok: boolean, agreement: Agreement | null, views: CoverageViews, refusals: AgreementRefusal[], gaps: AgreementGap[] }} result
 * @returns {DesignAgreeJson}
 */
export function agreeData(result) {
  return {
    ok: result.ok,
    agreement: result.agreement,
    refusals: result.refusals,
    sections: buildSections(AGREE_SECTION_ORDER, [
      { id: "views", markdown: result.views.markdown },
      { id: "gaps", items: result.gaps },
    ]),
  };
}
