// @ts-check
// Design output data and refusals for the model to word.
import { refusalsFor } from "./refusal.mjs";
import { DEFAULT_CONCURRENCY } from "./delegates.mjs";
import { glossaryOf, labelOf, keyLabel } from "./labels.mjs";
import { table } from "./markdown.mjs";

/** @import { Override, Repeat } from "./design-duplicates.mjs" */

// What each step takes, for `bad_arguments`.
/** @type {Record<string, string>} */
const ARGUMENTS = {
  state: "one Feature key and at most one scenario key",
  agree: "one scope, `feature` or a scenario key",
  plan: "one Feature key and at most one scenario key",
  split: "exactly one Feature key",
  report: "no argument, only the run directory",
};

// One factual line for each refusal code.
/** @type {Record<string, string>} */
export const REFUSALS = {
  unknown_action: "The /qa-design step is missing or does not exist; the steps are state, agree, split, override, plan and report.",
  dir_and_out: "--dir and --out both name the run directory; --out is only --dir's old name.",
  bad_arguments: "The step was given the wrong arguments.",
  expand_and_regenerate: "A run takes --expand or --regenerate, not both.",
  no_feature: "The knowledge layer holds no such Feature, so there is nothing to design from.",
  no_rules: "The Feature has no Rules, so there is nothing to design from.",
  no_scenario: "The Feature has no such scenario file.",
  no_split: "The canonical agreement is read from standard input, and none was given.",
  split_not_json: "The canonical agreement is not JSON; nothing was written.",
  no_override: "The engineer's reasons are read from standard input, and none was given.",
  bad_override: "The engineer's reasons are a JSON object of a stored case's Key to a non-blank reason; nothing was written.",
  mint_failed: "No free key could be minted for the new scenario files; nothing was written.",
};

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
// refuses a file the same way, in the same words.
/** @type {Record<string, SkippedFact>} */
export const SKIPPED = {
  populated: () => "already holds Test Cases: a bare run fills empty scenario files only; `--expand` adds to one, `--regenerate` redoes one",
  not_populated: ({ mode }) => `has no Test Cases to ${mode}: a bare run fills an empty scenario file`,
  nothing_replaceable: () => "has no unreviewed case without a Tracker key: `--regenerate` never touches a reviewed or tracker-linked case",
  waived_only: () => "has no uncovered Rule without a Waiver: `--expand` has nothing left to cover",
  fails_check: () => "cannot be designed: its file does not pass its check",
  unaddressable: () => "cannot be designed: its key is declared by more than one scenario file",
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
  no_level: "A Test Case must name its own level.",
  unagreed_level: "A Test Case is at a level outside the scenario's agreement.",
  unknown_level: "A Test Case is at a level the project does not list.",
  bad_steps: "A Test Case's steps could not be read.",
  empty_steps: "A Test Case has no steps.",
  bad_preconditions: "A Test Case's preconditions could not be read.",
  bad_automatable: "A Test Case does not say whether it can be automated.",
  empty_expected: "A Test Case has no Expected-result paragraph.",
  bad_proposed_rule: "A proposed Rule could not be read.",
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

// A refusal's fact: its code, its one line and the data it carries.
export const { fact, refuse } = refusalsFor(REFUSALS, (code, data) => ({ ...(code === "bad_arguments" && { takes: ARGUMENTS[/** @type {string} */ (data.action)] }), ...data }));

// A glossary entry as the reports carry it.
/**
 * @typedef {object} GlossaryEntry
 * @property {string} term
 * @property {string} explanation
 */

/**
 * The question `design state` asks when empty scenario files need agreed levels: each file by label, and
 * the one level worth suggesting, which is only one the data may give.
 * @typedef {object} LevelQuestion
 * @property {{ scenario: string, label: string }[]} files
 * @property {string | null} suggested
 * @property {GlossaryEntry[]} glossary
 */

// A scenario file and `/qa-design`'s own piece of the glossary.
const LEVEL = { term: "Level", explanation: "the layer a Test Case exercises; agree the wanted levels for each scenario, then name one on every case" };

/**
 * The question `design state` asks when empty scenario files need agreed levels.
 * @param {string[]} files
 * @param {string[]} levels
 * @param {(key: string) => string | undefined} summaryOf
 * @returns {LevelQuestion}
 */
export function levelQuestion(files, levels, summaryOf) {
  return {
    files: files.map((scenario) => ({ scenario, label: keyLabel(scenario, summaryOf(scenario)) })),
    suggested: levels.length === 1 ? levels[0] : null,
    glossary: [LEVEL],
  };
}

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
 * @property {{ key: string, summary: string }[]} replaced
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
 * @property {{ code: string, scenario: string, level: string, file: string }[]} missing_levels
 * @property {{ scenario: string, file: string, status: string, reason: string, problems?: string[] }[]} skipped
 * @property {number} cases_written
 * @property {ReportProposed[]} proposed_rules
 * @property {string} handoff
 * @property {{ scenario: string, file: string, needs_level: boolean }[]} still_empty
 * @property {string | null} rerun
 * @property {{ scenario: string, command: string }[]} reruns
 * @property {RunHealth | null} run_health
 * @property {{ paths: string[], commit: string | null }} changeset
 * @property {DeclaredCoverage} [declared_coverage] - present only when the Run recorded an agreement
 * @property {ReportHandoffs} [handoffs] - present only when the Run recorded an agreement
 */

/**
 * One scenario file's line in the closing report.
 * @typedef {object} ReportScenarioLine
 * @property {string} scenario
 * @property {string} label
 * @property {string} file
 * @property {"written" | "not_written" | "failed" | "awaiting_rules"} status
 * @property {number} [cases_written] - a written file's count, 0 for a failed or awaiting one
 * @property {number | null} [cases] - a written file's keys, by label
 * @property {string[] | null} [replaced] - the labels of a written file's replaced cases
 * @property {string[] | null} [not_automatable] - a written file's non-automatable cases
 * @property {{ code: string, line: string } | null} [reason] - one factual line
 * @property {Repeat[]} [duplicates] - a file's proposed cases that repeat a stored case or an earlier proposal and were refused: the whole file when none was written, else only those cases
 * @property {Array<Omit<Override, "summary"> & { key: string }>} [overridden] - a written file's cases that overrode a repeat, with the engineer's reasons
 * @property {Array<{ key: string, label: string, field: string, value: string, code: string, line: string }>} [lost_labels] - a regenerate's replaced cases' labels that no regenerated case took, by the replaced Key
 * @property {Array<{ key: string, label: string, field: string, value: unknown, code: string, line: string }>} [dropped_labels] - the labels a written file's cases lost because they were not the project's, never a reason a case was rejected
 * @property {string | null} [kind] - a failed unit's kind
 * @property {number | null} [attempts] - a failed unit's attempt count
 * @property {{ code: string, line: string }[] | null} [problems]
 * @property {{ statement: string, why?: string }[]} [proposals] - an awaiting unit's proposed Rules
 */
/**
 * The Run's changeset, as `design report` carries it.
 * @typedef {object} DesignChangeset
 * @property {string[]} paths
 * @property {string | null} commit
 */
/**
 * `design-json`'s output contract: the closing report as data, that `design report`
 * returns as its `json`.
 * @typedef {object} DesignReportJson
 * @property {true} ok
 * @property {string} feature
 * @property {string} design_mode
 * @property {boolean} dispatched
 * @property {string[] | null} delegates
 * @property {number} cases_written
 * @property {ReportScenarioLine[]} scenarios
 * @property {{ code: string, scenario: string, level: string, file: string }[]} missing_levels
 * @property {string | null} written_markdown
 * @property {{ scenario: string, key: string, label: string }[]} not_automatable
 * @property {{ scenario: string, label: string, file: string, status: string, reason: { code: string, line: string } }[]} skipped
 * @property {{ scenario: string, label: string, file: string, needs_level: boolean }[]} still_empty
 * @property {string | null} rerun
 * @property {{ scenario: string, label: string, command: string }[]} reruns
 * @property {ReportProposed[]} proposed_rules
 * @property {string} handoff
 * @property {{ run: string, calls: number, announcements: string[], retried: { scenario: string | null, label: string, attempts: number }[], notes: { code: string, line: string, allowed?: number }[] } | null} run_health
 * @property {DesignChangeset} changeset
 * @property {DeclaredCoverage} [declared_coverage] - the agreed obligations, when an agreement was recorded
 * @property {ReportHandoffs} [handoffs] - the agreement's hand-offs and awaiting units' proposals, when one was recorded
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

  const scenarios = m.scenarios.map((s) => {
    if (s.status === "written") {
      for (const key of s.cases) rows.push([scenario(s.scenario), s.file, labelOf(summaryOf, key)]);
      return { ...where(s), status: s.status, cases_written: s.cases_written, replaced: s.replaced.map((c) => keyLabel(c.key, c.summary)), ...(s.overridden?.length && { overridden: s.overridden }), ...(s.duplicates?.length && { duplicates: s.duplicates }), ...(s.lost_labels?.length && { lost_labels: s.lost_labels.map((d) => ({ key: d.key, label: labelOf(summaryOf, d.key), field: d.field, value: d.value, ...withLine(d.code, LOST_LABELS[d.code]) })) }), ...(s.dropped_labels?.length && { dropped_labels: s.dropped_labels.map((d) => ({ key: d.key, label: labelOf(summaryOf, d.key), field: d.field, value: d.value, ...withLine(d.code, DROPPED_LABELS[d.code]) })) }) };
    }
    // A proposal-only unit wrote nothing: its Rules go to /qa-deep-dive, never a design retry.
    if (s.status === "awaiting_rules") return { ...where(s), status: s.status, cases_written: 0, proposals: s.proposals };
    if (s.status === "not_written") return { ...where(s), status: s.status, reason: withLine(s.reason, NOT_WRITTEN[s.reason]), ...(s.duplicates && { duplicates: s.duplicates }) };
    if (["quota", "other", "timeout", "refused"].includes(s.kind)) term("Delegate");
    for (const p of s.problems) if (p === "unknown_role") term("Role"); else if (p === "empty_expected") term("Expected-result paragraph");
    return { ...where(s), status: s.status, reason: withLine(s.kind, FAILED[s.kind]), attempts: s.attempts, problems: [...new Set(s.problems)].map((p) => withLine(p, PROBLEMS[p])) };
  });

  const h = m.run_health;
  if (h) {
    term("Run");
    if (h.announcements.length) term("Fallback");
  }
  /** @type {DesignReportJson} */
  return {
    ok: true,
    feature: labelOf(summaryOf, m.feature),
    design_mode: m.mode,
    dispatched: m.dispatched,
    delegates: m.delegate ?? null,
    cases_written: m.cases_written,
    scenarios,
    missing_levels: m.missing_levels,
    written_markdown: table(["Scenario", "File", "Test Case written"], rows),
    // The cases the Delegate proposed `automatable: false` for, for the engineer to confirm in Review.
    not_automatable: m.scenarios.flatMap((s) => (s.status === "written" ? s.not_automatable.map((key) => ({ scenario: s.scenario, key, label: labelOf(summaryOf, key) })) : [])),
    skipped: (m.dispatched ? [] : m.skipped).map((s) => ({ ...where(s), status: s.status, reason: withLine(s.reason, SKIPPED[s.reason]({ ...s, feature: m.feature, mode: m.mode })) })),
    still_empty: m.still_empty.map((s) => ({ ...where(s), needs_level: s.needs_level })),
    rerun: m.rerun,
    reruns: m.reruns.map((c) => ({ scenario: c.scenario, label: scenario(c.scenario), command: c.command })),
    proposed_rules: m.proposed_rules.map((p) => ({ scenario: p.scenario, label: scenario(p.scenario), statement: p.statement, ...(p.why && { why: p.why }) })),
    handoff: m.handoff,
    run_health: h && { run: h.run, calls: h.calls, announcements: h.announcements, retried: h.retried.map((x) => ({ scenario: x.scenario, label: scenario(/** @type {string} */ (x.scenario)), attempts: x.attempts })), notes: h.notes.map((n) => ({ code: n.code, ...NOTES[n.code] })) },
    changeset: m.changeset,
    ...(m.declared_coverage === undefined ? {} : { declared_coverage: m.declared_coverage }),
    ...(m.handoffs === undefined ? {} : { handoffs: m.handoffs }),
    glossary: glossaryOf(terms),
  };
}
