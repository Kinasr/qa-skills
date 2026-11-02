// @ts-check
// Impact output data and refusals for the model to word.
import { refusalsFor, object, parseDecisions } from "./refusal.mjs";
import { table as markdownTable } from "./markdown.mjs";
import { terms, labelOf, keyLabel } from "./labels.mjs";
import { findingData } from "./finding-data.mjs";
import { PATTERN } from "./keys.mjs";
import { wordsOf } from "./stack.mjs";

/** @import {RefusalFact, RefusalResult, Refusals} from "./refusal.mjs" */

/**
 * The summaries of `.qa/`'s keys, as `labels.mjs` gives them: a key's label, or nothing when the
 * layer does not hold the key.
 * @typedef {object} Summaries
 * @property {(key: string) => string | undefined} testCase
 * @property {(key: string) => string | undefined} scenario
 * @property {(key: string) => string | undefined} feature
 * @property {(key: string) => string | undefined} rule
 * @property {(key: string) => string | undefined} boundary
 */

/**
 * The glossary the report fills: the terms it names, and what each of them means.
 * @typedef {object} Terms
 * @property {(...terms: string[]) => void} add
 * @property {() => Array<{ term: string, explanation: string }>} pieces
 */

/**
 * A Feature of the run's scope, as the report shows it.
 * @typedef {object} ImpactScopeFeature
 * @property {string} feature
 * @property {boolean} judged
 * @property {{ code: string, line: string }} [why]
 * @property {Array<Record<string, unknown>>} [problems]
 * @property {boolean} [first_judgement]
 * @property {string | null} [watermark]
 */

/**
 * A scenario file the run left out, and why.
 * @typedef {object} ImpactScopeExcluded
 * @property {string} file
 * @property {{ code: string, line: string }} reason
 * @property {Array<Record<string, unknown>>} problems
 */

/**
 * The run's scope: the Features it judged, the files it left out, and the table of both.
 * @typedef {object} ImpactScope
 * @property {ImpactScopeFeature[]} features
 * @property {string | null} markdown
 * @property {ImpactScopeExcluded[]} excluded
 */

/**
 * The run's judgements: how many, and the table of them.
 * @typedef {object} ImpactJudgements
 * @property {number} count
 * @property {string | null} markdown
 */

/**
 * The Overreaches the judge raised: how many, and the table of them.
 * @typedef {object} ImpactOverreaches
 * @property {number} count
 * @property {string | null} markdown
 */

/**
 * The open Stales the run carried forward.
 * @typedef {object} ImpactCarried
 * @property {number} count
 * @property {string | null} markdown
 */

/**
 * The findings a person dismissed, and how many of them still hold.
 * @typedef {object} ImpactDismissed
 * @property {number} held
 * @property {number} rearmed
 * @property {number} total
 */

/**
 * The mechanical Scans' counts.
 * @typedef {object} ImpactScanCounts
 * @property {number} divergences
 * @property {number} integrity_errors
 * @property {number} outcome_gaps
 * @property {number} overreaches
 * @property {number} review_overdue
 * @property {number} link_proposals
 */

/**
 * The oldest mirrored value of the run.
 * @typedef {object} ImpactOldestMirror
 * @property {string} feature
 * @property {string} at
 * @property {number} age_days
 * @property {string} case
 * @property {string} file
 */

/**
 * A Scan finding, as the report shows it.
 * @typedef {Record<string, unknown> & { kind: string }} ImpactScanItem
 */

/**
 * The mechanical Scans: their counts, their findings and the oldest mirrored values.
 * @typedef {object} ImpactScans
 * @property {ImpactScanCounts} counts
 * @property {ImpactScanItem[]} items
 * @property {ImpactOldestMirror[]} oldest_mirror
 */

/**
 * A unit that got no usable reply.
 * @typedef {object} ImpactFailedUnit
 * @property {string} scenario
 * @property {string} file
 * @property {{ code: string, line: string, problems?: string[] }} reason
 */

/**
 * A unit the Delegate was retried for.
 * @typedef {object} ImpactDispatchRetried
 * @property {string} scenario
 * @property {number} attempts
 */

/**
 * A Delegate whose breaker tripped.
 * @typedef {object} ImpactDispatchBreakerTrip
 * @property {string} delegate
 * @property {string} because
 */

/**
 * A unit that moved to the Fallback.
 * @typedef {object} ImpactDispatchFallback
 * @property {string} from
 * @property {string} to
 * @property {string} because
 */

/**
 * The Run's dispatch, as the report shows it.
 * @typedef {object} ImpactHealthDispatch
 * @property {string} run
 * @property {number} calls
 * @property {string[]} announcements
 * @property {ImpactDispatchRetried[]} retried
 * @property {ImpactDispatchBreakerTrip[]} breaker_trips
 * @property {ImpactDispatchFallback[]} fallbacks
 * @property {{ code: string, line: string } | null} stopped
 */

/**
 * A Feature's part of the run's health, as the report shows it.
 * @typedef {object} ImpactHealthFeature
 * @property {string} feature
 * @property {{ judged: number, present: number }} files
 * @property {{ judged: number, present: number }} cases
 * @property {boolean} complete
 * @property {GatheredWatermark | null} [watermark]
 */

/**
 * The run's health: what it judged, what it could not, and what it dispatched.
 * @typedef {object} ImpactRunHealth
 * @property {{ judged: number, present: number }} files
 * @property {{ judged: number, present: number }} cases
 * @property {ImpactHealthFeature[]} [features]
 * @property {ImpactHealthDispatch | null} dispatch
 * @property {{ count: number, markdown: string | null, items: ImpactFailedUnit[] }} failed_units
 * @property {number} unknown_keys
 * @property {string | null} rerun
 * @property {Array<{ code: string, line: string }>} notes
 */

/**
 * A Feature's Watermark, as the report shows it.
 * @typedef {object} ImpactWatermarkEntry
 * @property {string} feature
 * @property {boolean} advanced
 * @property {string | null} [to]
 * @property {string | null} [stays]
 * @property {{ code: string, line: string }} [why]
 * @property {Array<{ file: string, line: number | string | null }>} blocked
 */

/**
 * A case the working tree does not hold, so its finding could not be written.
 * @typedef {object} ImpactMissingCase
 * @property {string} case
 * @property {string} scenario
 */

/**
 * A merge rule, and the text that governs it.
 * @typedef {object} ImpactMergeRule
 * @property {string} rule
 * @property {string} text
 */

/**
 * The files the run wrote, and the commit they would go in.
 * @typedef {object} ImpactChangeset
 * @property {string[]} paths
 * @property {string | null} commit
 */

/**
 * A glossary term, and what it means.
 * @typedef {object} ImpactGlossaryEntry
 * @property {string} term
 * @property {string} explanation
 */

/**
 * The impact output contract: the report of `impact report` and `impact persist`, as
 * the model words it. `impact-json` writes it; `impact` and `settle-walk` read it.
 * @typedef {object} ImpactReport
 * @property {{ ref: string | null, commit: string | null }} target
 * @property {string[] | null} delegates
 * @property {ImpactScope} scope
 * @property {ImpactJudgements} judgements
 * @property {ImpactOverreaches} overreaches
 * @property {ImpactCarried} carried
 * @property {ImpactDismissed} dismissed
 * @property {ImpactScans} scans
 * @property {ImpactRunHealth} run_health
 * @property {ImpactWatermarkEntry[]} [watermarks]
 * @property {ImpactMissingCase[]} [missing]
 * @property {ImpactMergeRule[]} merge_rules
 * @property {ImpactChangeset} changeset
 * @property {ImpactGlossaryEntry[]} glossary
 */

/**
 * The report of the run as `impact` gathers it, before `reportData` shapes it.
 * @typedef {object} ImpactReportGathered
 * @property {string | null} [feature]
 * @property {{ ref: string | null, commit: string | null }} target
 * @property {{ ran: string[] } | null} [delegate]
 * @property {{ features: GatheredScopeFeature[] }} scope
 * @property {GatheredJudgement[]} judgements
 * @property {GatheredOverreach[]} overreaches
 * @property {GatheredCarried[]} carried
 * @property {ImpactDismissed} dismissed
 * @property {GatheredScans} scans
 * @property {GatheredHealth} run_health
 * @property {GatheredPersisted} [persisted]
 * @property {unknown} [walk]
 * @property {unknown[]} [walk_cases]
 * @property {string[]} merge_rules
 * @property {ImpactChangeset} changeset
 * @property {ImpactReport} [report]
 */

/**
 * A scenario file of a judged Feature, as the run gathered it.
 * @typedef {object} GatheredScopeScenario
 * @property {string | null} scenario
 * @property {string} file
 * @property {string} status
 * @property {number} cases
 * @property {string} [reason]
 * @property {Array<Record<string, unknown>>} [problems]
 */

/**
 * A Feature of the run's scope, as the run gathered it.
 * @typedef {object} GatheredScopeFeature
 * @property {string} feature
 * @property {boolean} judged
 * @property {string} [file]
 * @property {string} [class]
 * @property {string} [why]
 * @property {Array<Record<string, unknown>>} [problems]
 * @property {GatheredScopeScenario[]} [scenarios]
 * @property {boolean} [first_judgement]
 * @property {string | null} [watermark]
 * @property {string} [reason]
 * @property {string[]} [rules] - the candidate Rules of the Feature-level judge unit (ADR-0039)
 */

/**
 * A judgement of the run, as the run gathered it.
 * @typedef {object} GatheredJudgement
 * @property {string} feature
 * @property {string} scenario
 * @property {string} key
 * @property {string} file
 * @property {"Conflict" | "Current"} verdict
 * @property {string[]} rules
 * @property {string} why
 * @property {string} [quote_case]
 * @property {string} [quote_other]
 */

/**
 * An Overreach the judge raised, as the run gathered it: the subject (a Test Case, or a Rule in a
 * Feature-level unit), the Boundary it crosses, the two quotes and what crosses.
 * @typedef {object} GatheredOverreach
 * @property {string} feature
 * @property {string | null} scenario
 * @property {string} file
 * @property {string} subject
 * @property {string} boundary
 * @property {string} subject_quote
 * @property {string} boundary_quote
 * @property {string} crossing
 */

/**
 * An open Stale the run carried forward.
 * @typedef {object} GatheredCarried
 * @property {string} key
 * @property {string} file
 * @property {string | null} at_commit
 * @property {boolean | null} [at_commit_resolves]
 * @property {string} because
 * @property {string | null} evidence
 */

/**
 * The oldest mirrored value of a Feature, as the run gathered it.
 * @typedef {object} GatheredOldestMirror
 * @property {string} feature
 * @property {string} at
 * @property {number} age_days
 * @property {string} key
 * @property {string} file
 */

/**
 * The mechanical Scans, as the run gathered them.
 * @typedef {object} GatheredScans
 * @property {Array<Record<string, unknown>>} divergences
 * @property {Array<Record<string, unknown>>} integrity_errors
 * @property {Array<Record<string, unknown>>} outcome_gaps
 * @property {Array<Record<string, unknown>>} overreaches
 * @property {Array<Record<string, unknown>>} review_overdue
 * @property {number} link_proposals
 * @property {GatheredOldestMirror[]} oldest_mirror
 */

/**
 * A unit that got no usable reply, as the run gathered it.
 * @typedef {object} GatheredFailedUnit
 * @property {string} feature
 * @property {string | null} scenario
 * @property {string} file
 * @property {string} [kind]
 * @property {string | null} [reason]
 * @property {number} [attempts]
 * @property {Array<{ code: string, key?: string }>} problems
 */

/**
 * The Run's dispatch, as the run gathered it.
 * @typedef {object} GatheredDispatch
 * @property {string} run
 * @property {number} calls
 * @property {string[]} announcements
 * @property {Array<{ scenario: string | null, attempts: number }>} retried
 * @property {Array<{ delegate: string, reason: string }>} breaker_trips
 * @property {Array<{ from: string, to: string, reason: string }>} fallbacks
 * @property {string | null} stopped
 */

/**
 * A Feature's part of the run's health, as the run gathered it.
 * @typedef {object} GatheredHealthFeature
 * @property {string} feature
 * @property {{ judged: number, present: number }} files
 * @property {{ judged: number, present: number }} cases
 * @property {boolean} complete
 * @property {GatheredWatermark | null} [watermark]
 */

/**
 * The run's health, as the run gathered it.
 * @typedef {object} GatheredHealth
 * @property {{ judged: number, present: number }} files
 * @property {{ judged: number, present: number }} cases
 * @property {GatheredHealthFeature[]} features
 * @property {GatheredDispatch | null} dispatch
 * @property {GatheredFailedUnit[]} failed_units
 * @property {Record<string, number>} [failed_by_kind]
 * @property {number} unknown_keys
 * @property {string | null} rerun
 * @property {RunNote[]} notes
 */

/**
 * A Feature's Watermark, as the run gathered it.
 * @typedef {object} GatheredWatermark
 * @property {boolean} advanced
 * @property {string | null} [to]
 * @property {string | null} [from]
 * @property {string | null} [reason]
 */

/**
 * A Feature the run wrote, as the run gathered it.
 * @typedef {object} GatheredPersistedFeature
 * @property {string} feature
 * @property {GatheredWatermark} watermark
 * @property {Array<{ file: string, line?: number | string | null }>} blocked
 */

/**
 * What the run wrote, as the run gathered it.
 * @typedef {object} GatheredPersisted
 * @property {string | null} target
 * @property {GatheredPersistedFeature[]} features
 * @property {Array<Record<string, unknown>>} cases
 * @property {Array<{ key: string, scenario: string }>} missing
 */

/**
 * A problem of a reply, as the report's lines read it: its code, and the case it is about.
 * @typedef {object} ProblemFact
 * @property {string} code
 * @property {string} [key]
 */

/**
 * A failed unit, as the report's lines read it: how many attempts it took.
 * @typedef {object} FailedUnit
 * @property {number} attempts
 */

/**
 * A note the run left: what it could not do, or what it raised.
 * @typedef {object} RunNote
 * @property {string} code
 * @property {string | null} [language]
 * @property {string | null} [framework]
 * @property {string} [message]
 * @property {string} [fix]
 * @property {string} [version]
 * @property {string} [scenario]
 * @property {string} [key]
 * @property {string} [reason]
 * @property {string} [feature]
 */

/**
 * A finding of the walk's case.
 * @typedef {object} CaseFinding
 * @property {number} n
 * @property {string} source
 * @property {string} kind
 * @property {string | null} [found_at]
 * @property {boolean | null} [found_at_resolves]
 * @property {string} [code]
 * @property {string} [line]
 * @property {string} [id]
 * @property {string} [place]
 * @property {Record<string, string>} [labels]
 * @property {string} [label]
 * @property {number | string} [at_line]
 */

/**
 * The Review of the walk's case.
 * @typedef {object} CaseReview
 * @property {string} status
 * @property {string | null} [by]
 * @property {string} [at]
 * @property {{ code: string, line: string }} [because]
 */

/**
 * The answers the walk's case offers.
 * @typedef {object} CaseChoices
 * @property {string[]} finding
 * @property {string[]} review
 */

/**
 * The walk's case, each field a label or a fact, as the model words it.
 * @typedef {object} ImpactCaseData
 * @property {string} key
 * @property {string} label
 * @property {string} file
 * @property {string | null} scenario
 * @property {string} feature
 * @property {Array<{ code: string, line: string }>} why
 * @property {CaseFinding[]} findings
 * @property {CaseReview} review
 * @property {CaseChoices} choices
 */

/**
 * A finding as the walk state holds it.
 * @typedef {object} RawFinding
 * @property {string} source
 * @property {string} kind
 * @property {string | null} at_commit
 * @property {boolean | null} [at_commit_resolves]
 * @property {string | null} evidence
 * @property {Record<string, unknown>} [result]
 */

/**
 * The Review as the walk state holds it.
 * @typedef {object} RawReview
 * @property {string} status
 * @property {string | null} [by]
 * @property {string} [at]
 * @property {string} [why]
 */

/**
 * The walk's case as the walk state holds it.
 * @typedef {object} RawCase
 * @property {string} key
 * @property {string} [summary]
 * @property {string} file
 * @property {string} scenario
 * @property {string} feature
 * @property {string[]} why
 * @property {RawFinding[]} findings
 * @property {RawReview} review
 * @property {boolean} [reject]
 * @property {boolean} [retire]
 */

/**
 * A decision on one finding of the walk's case.
 * @typedef {object} DecisionFinding
 * @property {number} n
 * @property {string} answer
 * @property {string} finding
 * @property {string} id
 * @property {string} [reason]
 * @property {string} [ticket]
 */

/**
 * The decisions on stdin, as the walk reads them.
 * @typedef {object} DecisionsResult
 * @property {Array<{ code: string, [key: string]: unknown }>} errors
 * @property {string} [review]
 * @property {DecisionFinding[]} [findings]
 */

/**
 * @param {readonly string[]} headers
 * @param {readonly (readonly unknown[])[]} rows
 * @returns {string | null}
 */
const table = (headers, rows) => markdownTable(headers, rows, { empty: "" });

/**
 * @param {number} n
 * @param {string} one
 * @returns {string}
 */
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

// A key a finding or verdict names: a Rule with its statement, a Test Case with its summary.
/**
 * @param {string} key
 * @param {Summaries} s
 * @returns {string}
 */
export const findingLabel = (key, s) => (PATTERN.rule.test(key) ? `Rule ${labelOf(s, key)}` : labelOf(s, key));

/**
 * @param {Record<string, string | ((...args: FailedUnit[]) => string)>} lines
 * @param {string} code
 * @param {...FailedUnit} args
 * @returns {{ code: string, line: string }}
 */
const reason = (lines, code, ...args) => ({ code, line: typeof lines[code] === "function" ? /** @type {(...args: FailedUnit[]) => string} */ (lines[code])(...args) : /** @type {string} */ (lines[code]) });

// What a finding kind is called: its glossary term.
/** @type {Record<string, string>} */
export const KIND = { Conflict: "Conflict", Stale: "Stale", Divergence: "Divergence", OutcomeGap: "Outcome gap", Overreach: "Overreach" };

// A stored finding's evidence, with each key it names shown with its summary.
const KEY_TOKEN = /(?<![0-9A-Za-z_/-])[0-9A-Za-z][0-9A-Za-z_-]*(?:\/[0-9A-Za-z][0-9A-Za-z_-]*)?(?![0-9A-Za-z_/-])/g;

/**
 * @param {string | null} evidence
 * @param {Summaries} s
 * @returns {string}
 */
export function evidenceText(evidence, s) {
  if (evidence === null) return "it records no evidence";
  return evidence.replace(KEY_TOKEN, (k) => (PATTERN.rule.test(k) && s.rule(k) !== undefined ? findingLabel(k, s) : s.testCase(k) !== undefined ? labelOf(s, k) : k));
}

/** @type {Record<string, string>} */
const NOT_JUDGED = {
  no_scenarios: "it has no scenario files",
  all_empty: "every scenario file is empty",
  unchanged: "no knowledge changed since its Watermark",
  walk_only: "no knowledge changed since its Watermark; it has open findings, which the triage walk shows, but nothing to judge",
  unresolvable_watermark: "its Watermark does not resolve; it is skipped, never moved to a new baseline",
  unparseable_feature: "its Feature file cannot be read",
};
// Why a judged Feature is a first judgement although it has a Watermark (ADR-0033).
/** @type {Record<string, string>} */
const FIRST_JUDGEMENT = {
  watermark_reanchor_failed: "its Watermark's commit is gone and no commit on this branch holds the knowledge it recorded, so every case is judged",
};
/** @type {Record<string, string>} */
const EXCLUDED = { unparseable: "its file cannot be read", no_key: "the scenario file declares no key", key_twice: "its key is declared by more than one scenario file" };
/** @type {Record<string, (p: ProblemFact, s: Summaries) => string>} */
const PROBLEMS = {
  no_json_block: () => "held no block of Verdicts",
  truncated: () => "was cut off",
  unparseable: () => "held a block of Verdicts that could not be read",
  bad_shape: () => "held a block that is not a list of Verdicts",
  malformed_entry: () => "held a Verdict that is not a whole entry",
  duplicate_key: (p, s) => `gave ${labelOf(s, p.key)} more than one Verdict`,
  bad_verdict: (p, s) => `gave ${labelOf(s, p.key)} a Verdict that is not Conflict or Current`,
  conflict_without_quotes: (p, s) => `called ${labelOf(s, p.key)} a Conflict without quoting both sides`,
  // The Upstream Rules the judge quoted as a side (ADR-0040): a Rule this unit does not carry, a
  // quote that is not its current text, or its Watermark-time text, which is never a side.
  unknown_upstream_rule: (p, s) => `named a Rule that is not an Upstream Rule of this unit, on ${labelOf(s, p.key)}`,
  upstream_quote_not_verbatim: (p, s) => `quoted an Upstream Rule not word for word, on ${labelOf(s, p.key)}`,
  quote_from_history: (p, s) => `quoted an Upstream Rule's Watermark-time text, which is never a side, on ${labelOf(s, p.key)}`,
  // A Conflict's own sides: the case's words, a local Rule the Feature states, the other side's words.
  case_quote_not_verbatim: (p, s) => `quoted ${labelOf(s, p.key)}'s own words not word for word in a Conflict`,
  unknown_conflict_rule: (p, s) => `named a Rule the Feature does not state, on ${labelOf(s, p.key)}`,
  other_quote_not_verbatim: (p, s) => `quoted the other side of a Conflict not word for word, on ${labelOf(s, p.key)}`,
  missing_key: (p, s) => `gave ${labelOf(s, p.key)} no Verdict`,
  // The Overreaches the judge reported (ADR-0039): an entry that names a subject it was not sent,
  // a Boundary the Feature does not state, a quote that is not word for word, or a pair twice.
  unknown_case: (p, s) => `named ${labelOf(s, p.key)}, which is not a Test Case of this unit`,
  unknown_rule: (p, s) => `named ${labelOf(s, p.key)}, which is not a Rule of this unit`,
  unknown_boundary: (p, s) => `named a Boundary the Feature does not state, on ${labelOf(s, p.key)}`,
  malformed_overreach: (p, s) => `held an Overreach that is not a whole entry, on ${labelOf(s, p.key)}`,
  overreach_without_quotes: (p, s) => `held an Overreach on ${labelOf(s, p.key)} without quoting both sides`,
  quote_not_verbatim: (p, s) => `quoted ${labelOf(s, p.key)}'s own words not word for word`,
  boundary_quote_not_verbatim: (p, s) => `quoted the Boundary not word for word, on ${labelOf(s, p.key)}`,
  duplicate_overreach: (p, s) => `named the same crossing twice, on ${labelOf(s, p.key)}`,
};
/** @type {Record<string, string | ((...args: FailedUnit[]) => string)>} */
const FAILED = {
  no_reply: "no reply was saved",
  no_brief: "its brief is missing, so its reply cannot be read",
  unusable_reply: "its reply cannot be used",
  unusable: (f) => `no usable reply after ${plural(f.attempts, "attempt")}`,
  not_dispatched: "never sent: dispatch did not reach it",
  in_flight: "still running when this report was made",
  quota: (f) => `no usable reply after ${plural(f.attempts, "attempt")}: the Delegate's allowance was spent`,
  other: (f) => `no usable reply after ${plural(f.attempts, "attempt")}: the Delegate failed`,
  timeout: (f) => `no usable reply after ${plural(f.attempts, "attempt")}: the Delegate timed out`,
  refused: (f) => `no usable reply after ${plural(f.attempts, "attempt")}: the harness refused the Delegate`,
};
/** @type {Record<string, string>} */
const TRIPPED = { quota: "a spent allowance", consecutive_failed_retries: "three failed retries in a row", refused: "a refusal by the harness" };
/** @type {Record<string, string>} */
const STOPPED = { fallback_tripped: "the Fallback's breaker tripped: the units without a usable reply stay unjudged" };
/** @type {Record<string, string>} */
const HELD = {
  incomplete: "not every non-empty scenario file got a usable reply",
  write_blocked: "a write would not pass its check, so nothing of this Feature was written",
  feature_file_gone: "its Feature file is not in the working tree",
  missing_cases: "a judged Test Case is not in the working tree to hold its finding",
  no_judge_unit: "it has no judge unit, so nothing was judged to advance its Watermark",
  awaiting_checkpoint: "its Watermark advances at checkpoint 2, once every case of the walk is settled and the case fixes and any new cases are committed",
};
/** @type {Record<string, string>} */
const BECAUSE = { no_usable_reply: "its file got no usable reply", not_cleared: "this run did not see what caused it" };
/** @type {Record<string, string>} */
export const VOID = { entry_changed: "the case changed after it", commit_unresolvable: "the commit it is pinned to does not resolve" };
/** @type {Record<string, string>} */
export const WHY = {
  verdict: "a Conflict Verdict from this run, or a Stale the Scan owes this case",
  overreach: "an Overreach the Scan raised on this case",
  judged_overreach: "an Overreach the judge raised on this case",
  feature_overreach: "an Overreach the judge raised on a Rule of this Feature",
  carried: "an open Stale carried forward from an earlier run",
  open_findings: "an open finding on a Feature named with nothing changed to judge",
  unreviewed: "no Review yet (`--review` asks for the unreviewed cases)",
  review_overdue: "Review overdue: its `review_by` date has passed",
};
/** @type {Record<string, string>} */
const NO_MINTING = {
  both: "it sets both a recipe for minting Automation keys and an Automation key shape, which the recipe implies",
  malformed: "its recipe for minting Automation keys cannot be read",
  no_prefix_annotation: "its recipe needs the name of the class annotation that carries the Key prefix",
};
/** @type {Record<string, (n: RunNote, s: Summaries, adapter: unknown) => string>} */
const NOTES = {
  no_scanner: (n) => (n.language === null && n.framework === null ? "The project names no stack, so no code scanner fits it and the code was not scanned." : `The project's stack (\`${n.language}\`, \`${n.framework}\`) has no code scanner, so the code was not scanned.`),
  adapter_unavailable: (n) => `The code was not scanned: ${n.message}. ${/** @type {string} */ (n.fix)[0].toUpperCase()}${/** @type {string} */ (n.fix).slice(1)}.`,
  adapter_version: (n) => `The code was read with ${n.version}, the repository's own.`,
  no_code: (n, s, adapter) => `No ${wordsOf(adapter).source} was found in the project's test code paths, so the code was not scanned.`,
  no_minting: (n) => `No Automation key can be minted until \`project.md\` is fixed: ${NO_MINTING[/** @type {string} */ (n.reason)]}. /qa-init fixes it.`,
  changed_cases_degraded: (n, s) => `The changed Test Cases of ${labelOf(s, n.scenario)} were too large to give the judge in full, so it had the change's summary only.`,
  concurrency_cap_invalid: () => "`project.md` sets no valid limit on parallel calls, so the default was allowed.",
  change_data_unknown: (n) => `The run's \`change.json\` holds ${n.reason === "unknown_key" ? `a key this command does not read (\`${n.key}\`)` : `an entry under \`${n.key}\` it cannot read (${n.reason})`}, so that part was ignored.`,
  escalated_not_judged: (n, s) => `${labelOf(s, n.key)} was escalated to the judge, but its Feature cannot be judged in this run (${n.reason}), so no judge reads it.`,
  conflict_side_unknown: (n, s) => `The Conflict on ${labelOf(s, n.key)} names no Rule, and no one other Test Case of its file holds the other side word for word: it is written on that case alone.`,
};

/**
 * @typedef {Omit<ImpactReport, "merge_rules" | "changeset" | "glossary">} ImpactReportDraft
 */

// The merge rules, where the files they govern were written. Exact procedural text: copied intact.
/** @type {Record<string, string>} */
const MERGE_RULES = {
  watermark: "a conflicted Watermark line resolves to `git merge-base <ours> <theirs>`, and only to that, so neither branch's open Stale is lost",
  findings: "a conflicted list of Findings takes the union of both sides, never dropping a Dismissal",
  review: "a conflicted Review takes either side",
};
/** @type {string[]} */
export const MERGE_ORDER = Object.keys(MERGE_RULES);

/**
 * @param {readonly string[]} keys
 * @returns {Array<{ rule: string, text: string }>}
 */
export const mergeRules = (keys) => MERGE_ORDER.filter((k) => keys.includes(k)).map((rule) => ({ rule, text: MERGE_RULES[rule] }));

// The report of `impact report` and `impact persist`. `m` is what `report` in lib/impact.mjs gathers,
// `s` gives `.qa/`'s summaries, `adapter` is the stack's (lib/stack.mjs), or null.
/**
 * @param {ImpactReportGathered} report
 * @param {Summaries} summaryOf
 * @param {unknown} [adapter]
 * @returns {ImpactReport}
 */
export function reportData(report, summaryOf, adapter = null) {
  const glossary = terms();
  /** @type {(key: string) => string} */
  const feature = (key) => labelOf(summaryOf, key);
  /** @type {(key: string) => string} */
  const scenario = (key) => labelOf(summaryOf, key);
  /** @type {(key: string) => string} */
  const testCase = (key) => labelOf(summaryOf, key);

  /** @type {Array<readonly unknown[]>} */
  const files = [];
  /** @type {ImpactScopeExcluded[]} */
  const excluded = [];
  const features = report.scope.features.map((featureEntry) => {
    const out = { feature: feature(featureEntry.feature), judged: featureEntry.judged };
    if (!featureEntry.judged) {
      if (featureEntry.why === "unresolvable_watermark" || featureEntry.why === "unchanged" || featureEntry.why === "walk_only") glossary.add("Watermark");
      return { ...out, why: reason(NOT_JUDGED, /** @type {string} */ (featureEntry.why)), ...(featureEntry.problems?.length && { problems: featureEntry.problems.map((problem) => findingData(problem, summaryOf)) }) };
    }
    glossary.add("Watermark");
    for (const scenarioEntry of /** @type {GatheredScopeScenario[]} */ (featureEntry.scenarios)) {
      files.push([out.feature, scenarioEntry.scenario ? scenario(scenarioEntry.scenario) : "", scenarioEntry.file, scenarioEntry.status === "excluded" ? `excluded: ${EXCLUDED[/** @type {string} */ (scenarioEntry.reason)]}` : scenarioEntry.status === "empty" ? "empty, judged without a call" : scenarioEntry.status === "unselected" ? "no case selected, judged without a call" : "judged", scenarioEntry.cases]);
      if (scenarioEntry.status === "excluded") excluded.push({ file: scenarioEntry.file, reason: reason(EXCLUDED, /** @type {string} */ (scenarioEntry.reason)), problems: /** @type {Array<Record<string, unknown>>} */ (scenarioEntry.problems).map((problem) => findingData(problem, summaryOf)) });
    }
    // The Feature-level judge unit (ADR-0039): the Feature's Rules judged against its Boundaries.
    if (featureEntry.rules) files.push([out.feature, "", featureEntry.file ?? "", "judged: Rules against Boundaries", 0]);
    return { ...out, first_judgement: featureEntry.first_judgement, watermark: featureEntry.watermark, ...(featureEntry.reason && { why: reason(FIRST_JUDGEMENT, featureEntry.reason) }), ...(featureEntry.rules && { rules: featureEntry.rules }) };
  });

  glossary.add("Verdict");
  const judgements = { count: report.judgements.length, markdown: table(["Case", "File", "Verdict", "Rules", "Why", "The case says", "The other side says"], report.judgements.map((judgement) => [testCase(judgement.key), `\`${judgement.file}\``, judgement.verdict, judgement.rules.map((key) => findingLabel(key, summaryOf)), judgement.why, judgement.quote_case, judgement.quote_other])) };
  for (const judgement of report.judgements) glossary.add(judgement.verdict);

  // The Overreaches the judge raised (ADR-0039): a Test Case that checks behaviour a Boundary
  // hands elsewhere, or a Rule that states it. They are Findings of their own, beside the verdicts.
  if (report.overreaches.length) glossary.add("Overreach");
  const overreaches = { count: report.overreaches.length, markdown: table(["Subject", "File", "Boundary", "The subject says", "The Boundary says", "What crosses"], report.overreaches.map((overreach) => [findingLabel(overreach.subject, summaryOf), `\`${overreach.file}\``, labelOf(summaryOf, overreach.boundary), overreach.subject_quote, overreach.boundary_quote, overreach.crossing])) };

  if (report.carried.length) glossary.add("Stale");
  const carried = { count: report.carried.length, markdown: table(["Case", "File", "Carried from", "Why", "Evidence"], report.carried.map((carriedFinding) => [testCase(carriedFinding.key), `\`${carriedFinding.file}\``, `${carriedFinding.at_commit === null ? "no recorded commit" : `\`${carriedFinding.at_commit.slice(0, 12)}\``}${carriedFinding.at_commit_resolves === false ? " (does not resolve)" : ""}`, BECAUSE[carriedFinding.because], evidenceText(carriedFinding.evidence, summaryOf)])) };

  glossary.add("Dismissal", "Scan");
  const scanResults = report.scans;
  /** @type {ImpactScanItem[]} */
  const scanItems = [];
  /** @type {(kind: string, findings: Array<Record<string, unknown>>) => void} */
  const add = (kind, findings) => findings.forEach((entry) => scanItems.push({ ...findingData(entry, summaryOf), kind }));
  add("Divergence", scanResults.divergences);
  add("Integrity error", scanResults.integrity_errors);
  add("Outcome gap", scanResults.outcome_gaps);
  add("Overreach", scanResults.overreaches);
  add("Review overdue", scanResults.review_overdue);
  for (const entry of scanItems) glossary.add(entry.kind);
  if (scanResults.oldest_mirror.length) glossary.add("Mirrored value");
  const scans = {
    counts: { divergences: scanResults.divergences.length, integrity_errors: scanResults.integrity_errors.length, outcome_gaps: scanResults.outcome_gaps.length, overreaches: scanResults.overreaches.length, review_overdue: scanResults.review_overdue.length, link_proposals: scanResults.link_proposals },
    items: scanItems,
    oldest_mirror: scanResults.oldest_mirror.map((mirror) => ({ feature: feature(mirror.feature), at: mirror.at, age_days: mirror.age_days, case: labelOf(summaryOf, mirror.key), file: mirror.file })),
  };

  const health = report.run_health;
  const dispatch = health.dispatch;
  if (report.delegate || dispatch) glossary.add("Delegate");
  if (dispatch) { glossary.add("Run"); if (dispatch.announcements.length || dispatch.fallbacks.length || dispatch.breaker_trips.length) glossary.add("Fallback"); }
  const failed = health.failed_units.map((failedUnit) => {
    const code = failedUnit.kind ?? (failedUnit.reason === "unusable" ? "unusable_reply" : failedUnit.reason);
    const problems = [...new Set(failedUnit.problems.map((problem) => PROBLEMS[problem.code](problem, summaryOf)))];
    return { scenario: failedUnit.scenario ? scenario(failedUnit.scenario) : "", file: failedUnit.file, reason: { ...reason(FAILED, /** @type {string} */ (code), /** @type {FailedUnit} */ (failedUnit)), ...(problems.length && { problems }) } };
  });
  const run_health = {
    files: health.files, cases: health.cases,
    ...(health.features.length > 1 && { features: health.features.map((featureEntry) => ({ ...featureEntry, feature: feature(featureEntry.feature) })) }),
    dispatch: dispatch && { run: dispatch.run, calls: dispatch.calls, announcements: dispatch.announcements, retried: dispatch.retried.map((entry) => ({ scenario: entry.scenario ? scenario(entry.scenario) : "", attempts: entry.attempts })), breaker_trips: dispatch.breaker_trips.map((entry) => ({ delegate: entry.delegate, because: TRIPPED[entry.reason] })), fallbacks: dispatch.fallbacks.map((entry) => ({ from: entry.from, to: entry.to, because: TRIPPED[entry.reason] })), stopped: dispatch.stopped ? { code: dispatch.stopped, line: STOPPED[dispatch.stopped] } : null },
    failed_units: { count: failed.length, markdown: table(["Scenario", "File", "Why"], failed.map((failedUnit) => [failedUnit.scenario, `\`${failedUnit.file}\``, [failedUnit.reason.line, ...(failedUnit.reason.problems ?? []).map((problem) => `its reply ${problem}`)].join("; ")])), items: failed },
    unknown_keys: health.unknown_keys,
    rerun: health.rerun,
    notes: health.notes.map((note) => { if (note.code === "conflict_side_unknown") glossary.add("Conflict"); return { code: note.code, line: NOTES[note.code](note, summaryOf, adapter) }; }),
  };
  /** @type {ImpactReportDraft} */
  const out = {
    target: report.target,
    delegates: report.delegate?.ran ?? null,
    scope: { features, markdown: table(["Feature", "Scenario", "File", "Status", "Test Cases"], files), excluded },
    judgements, overreaches, carried, dismissed: report.dismissed, scans, run_health,
  };
  if (report.persisted) {
    glossary.add("Watermark");
    out.watermarks = report.persisted.features.map((featureEntry) => ({ feature: feature(featureEntry.feature), ...(featureEntry.watermark.advanced ? { advanced: true, to: featureEntry.watermark.to } : { advanced: false, ...(featureEntry.watermark.from && { stays: featureEntry.watermark.from }), why: reason(HELD, /** @type {string} */ (featureEntry.watermark.reason)) }), blocked: featureEntry.blocked.map((error) => ({ file: error.file, line: error.line ?? null })) }));
    out.missing = report.persisted.missing.map((entry) => ({ case: testCase(entry.key), scenario: scenario(entry.scenario) }));
  }
  if (report.merge_rules.length) for (const rule of report.merge_rules) glossary.add(rule === "watermark" ? "Watermark" : rule === "findings" ? "Finding" : "Review");
  return { ...out, merge_rules: mergeRules(report.merge_rules), changeset: report.changeset, glossary: glossary.pieces() };
}

// The walk's case, each field a label or a fact. It offers answers and suggests none.
/** @type {string[]} */
export const FINDING_ANSWERS = ["dismiss", "keep", "fix", "holds"];
/** @type {string[]} */
export const REVIEW_ANSWERS = ["accept", "leave", "reject", "retire"];
/**
 * @param {string | null} commit
 * @returns {string | null}
 */
const pin = (commit) => (commit === null ? null : commit.slice(0, 12));

/**
 * @param {RawCase} c
 * @param {Summaries} s
 * @param {Terms} t
 * @returns {ImpactCaseData}
 */
export function caseData(c, s, t) {
  t.add("Finding", "Review");
  if (c.why.includes("review_overdue")) t.add("Review overdue");
  const findings = c.findings.map((f, i) => {
    t.add(KIND[f.kind]);
    if (f.source === "scan") t.add("Scan");
    return { n: i + 1, source: f.source, ...(f.source === "stored" ? { found_at: pin(f.at_commit), found_at_resolves: f.at_commit_resolves } : {}), ...(f.source === "stored" ? { code: f.kind, line: evidenceText(f.evidence, s) } : findingData(/** @type {Record<string, unknown>} */ (f.result), s)), kind: KIND[f.kind] };
  });
  const v = c.review;
  if (c.reject) t.add("Reject", "Tracker key");
  if (c.retire) t.add("Retired key", "Tracker key", "Automation");
  return {
    key: c.key,
    label: keyLabel(c.key, c.summary),
    file: c.file,
    scenario: labelOf(s, c.scenario),
    feature: labelOf(s, c.feature),
    why: c.why.map((code) => ({ code, line: WHY[code] })),
    findings,
    review: v.status === "none" ? { status: "none" } : v.status === "void" ? { status: "void", by: null, because: { code: /** @type {string} */ (v.why), line: VOID[/** @type {string} */ (v.why)] } } : { status: v.status, by: v.by, at: /** @type {string} */ (v.at) },
    choices: { finding: c.findings.length ? FINDING_ANSWERS.filter((a) => a !== "holds" || c.findings.some((f) => f.kind === "Stale")) : [], review: REVIEW_ANSWERS.filter((a) => (a !== "reject" || c.reject) && (a !== "retire" || c.retire)) },
  };
}

// The walk's Feature-level findings (ADR-0039): the Overreach the judge raised on one of the
// Feature's Rules. A Feature has no Review of its own, so it offers only "leave" for one.
/**
 * @param {RawCase} c
 * @param {Summaries} s
 * @param {Terms} t
 * @returns {ImpactCaseData}
 */
export function featureData(c, s, t) {
  t.add("Finding", "Overreach");
  const findings = c.findings.map((f, i) => {
    t.add(KIND[f.kind]);
    return { n: i + 1, source: f.source, found_at: pin(f.at_commit), found_at_resolves: f.at_commit_resolves, code: f.kind, line: evidenceText(f.evidence, s), kind: KIND[f.kind] };
  });
  return {
    key: c.key,
    label: keyLabel(c.key, s.feature(c.feature)),
    file: c.file,
    scenario: null,
    feature: labelOf(s, c.feature),
    why: c.why.map((code) => ({ code, line: WHY[code] })),
    findings,
    review: { status: "none" },
    choices: { finding: c.findings.length ? FINDING_ANSWERS.filter((a) => a !== "holds") : [], review: ["leave"] },
  };
}

// ---------------------------------------------------------------------------------------------
// Refusals: a code and one factual line; the model explains it and says what to do next.
/** @type {Record<string, string>} */
export const REFUSALS = {
  unknown_action: "The step is missing or does not exist: the steps are plan, quick, quick-check, report, persist and escalate.",
  dir_and_out: "`--dir` and `--out` both name the run directory; give `--dir` alone.",
  bad_arguments: "The step takes other arguments: `plan` and `entry` at most one Feature key, every other step only the run directory (`escalate` also `--case`, `quick-check` also a Feature key and `--stdin`).",
  persist_retired: "`/qa-impact --persist` is retired: the quick path takes a change end to end, and `/qa-design` settles the findings already on disk.",
  review_retired: "`/qa-impact --review` is retired: `/qa-design <feature-key> --review` walks the unreviewed and Review overdue cases.",
  target_retired: "`/qa-impact --target` is retired: the judge reads the committed knowledge at HEAD, so commit, then settle with `/qa-design`.",
  read_only_retired: "A read-only `/qa-impact` report is retired: `/qa-next` says what is due, and `/qa-impact <feature-key>` takes a change to a Feature.",
  quick_input: "`quick-check` reads {forecast, references, open_questions?} on stdin: the confirmed forecast, the Reference URIs the change came from, and the questions still open.",
  needs_case: "`escalate` records the case `/qa-ask` sent to the judge: give it `--case <key>`.",
  unknown_case: "The knowledge layer holds no Test Case with that key.",
  bad_cap: "`--cap` takes a whole number of bytes, 0 or more.",
  target_outside_git: "`--target` names a commit, so `.qa/` must be inside a git repository.",
  target_unknown: "`--target` names no commit.",
  no_feature: "The knowledge layer holds no such Feature.",
  review_needs_persist: "`--review` adds unreviewed and Review overdue Test Cases to the triage walk, which only a persisted run has.",
  review_unknown: "`--review` names a Feature the knowledge layer does not hold.",
  not_persisted: "This run was planned without `--persist`, so it writes nothing and has no triage walk.",
  persist_refused: "`--persist` needs the committed knowledge it pins to: `.qa/` holds uncommitted knowledge, the repository has no commits, or `.qa/` is outside git.",
  forecast_missing: "`--persist` needs the engineer's confirmed forecast of each Rule whose statement changed since the Watermark, and the run dir holds none for the statement these Rules have now: confirm it again through `deep-dive reconcile` or `impact quick-check` with the same `--dir`, then plan again.",
  not_human: "The name for the stamps is not a person's name as a stamp carries it: `human:<name>`, with no space, double quote or backslash.",
  name_differs: "This Run's stamps carry another name, given when its walk began.",
  needs_stdin: "This step needs its Reply or JSON decisions on stdin.",
  bad_answer: "A finding's answer is not dismiss, keep, fix or holds.",
  holds_not_stale: "Holds settles a Stale: it says the case is still right after the change that made it Stale.",
  field_not_allowed: "Only a dismiss takes a reason or a ticket.",
  bad_review: "The review answer is not accept, leave, reject or retire.",
  reject_keyed: "Reject is offered only for a case with no Tracker key; a case with one is retired.",
  retire_unkeyed: "Retire is offered only for a case with a Tracker key; a case without one is rejected.",
  retire_with_finding: "Retire removes the case with its findings, so no finding is answered with it.",
  reject_with_finding: "Reject removes the case with its findings, so no finding is answered with it.",
  unaddressed: "The decisions leave findings or the review open.",
  no_name: "No name is stored for this Run's stamps.",
  no_case: "No case is waiting for a decision.",
  case_not_in_walk: "The case is not in this Run's walk.",
  case_mismatch: "The shown case is not the case the decisions were meant for.",
  already_settled: "The case is already settled in this Run.",
  case_gone: "The case is no longer in the knowledge layer.",
  walk_unfinished: "The walk still has cases to settle, so checkpoint 2 has not been reached.",
  case_changed: "The case's findings changed since the walk showed them.",
  uncommitted_holds: "What the Stale rests on has uncommitted changes, so a holds pinned to HEAD would name text that is not in history.",
  uncommitted_review: "The case has uncommitted changes, and a Review is pinned to HEAD.",
  uncommitted_dismissal: "What the finding rests on has uncommitted changes, so a Dismissal pinned to HEAD would lapse at once.",
  level_rewrite_failed: "A version of the knowledge layer could not be read at the current schema, so whether the finding changed cannot be judged.",
  not_fixed: "The finding is answered fix, but nothing it rests on differs from HEAD.",
  not_fixed_scan: "The finding is answered fix, but the Scan still reports it.",
  no_longer_reported: "The Scan no longer reports the finding: the edit fixed it, so it can be answered fix only.",
  no_head: "The repository has no commit to pin a stamp to.",
  check_file: "The write would not pass its check, so nothing was written.",
  no_block: "The case has no block of fields to hold its findings or its review.",
  no_feature_file: "The Feature file is not in the knowledge layer to keep the Retired key.",
};
export const { fact, refuse, refusalOf } = refusalsFor(REFUSALS);

// ---------------------------------------------------------------------------------------------
// The decisions on one walk case, JSON on stdin:
//   {"findings": [{"n": 1, "answer": "dismiss", "reason": "...", "ticket": "DEMO-1"}], "review": "leave"}
// `shown` is the case the walk showed: `{findings: [{id}], reject, retire}`. Every finding and the
// review need an answer, except that `reject` and `retire` stand alone. Nothing is ever taken as a default.
const TICKET = /^[A-Za-z0-9][A-Za-z0-9._#/-]*$/;
const REASON = /^(?![\s\S]*["\\\r\n\u2028\u2029])(?=[\s\S]*\S)[\s\S]+$/;
/** @type {{ readonly reason: { readonly pattern: string }, readonly ticket: { readonly pattern: string } }} */
export const DISMISSAL_VALIDATION = { reason: { pattern: REASON.source }, ticket: { pattern: TICKET.source } };

/**
 * @param {string} text
 * @param {{ findings: Array<{ id: string, kind?: string }>, reject?: boolean, retire?: boolean }} shown
 * @returns {DecisionsResult}
 */
export function decisionsOf(text, shown) {
  const parsed = /** @type {{ input: Record<string, unknown>, errors?: never } | { input?: never, errors: Array<{ code: string }> }} */ (parseDecisions(text));
  if (parsed.errors) return parsed;
  const { input } = parsed;
  if (!object(input) || Object.keys(input).some((k) => !["findings", "review"].includes(k)) || (input.findings !== undefined && !Array.isArray(input.findings)) || (input.review !== undefined && typeof input.review !== "string")
    || (input.findings ?? []).some((g) => !object(g) || Object.keys(g).some((k) => !["n", "answer", "reason", "ticket"].includes(k)))) return { errors: [{ code: "invalid_decisions" }] };
  /** @type {Array<{ code: string, [key: string]: unknown }>} */
  const errors = [];
  /** @type {Map<number, { n: number, answer: string, reason?: string, ticket?: string }>} */
  const answered = new Map();
  for (const g of input.findings ?? []) {
    const n = g.n;
    if (!Number.isSafeInteger(n) || n < 1 || n > shown.findings.length) { errors.push({ code: "unknown_item", item: n }); continue; }
    if (answered.has(n)) { errors.push({ code: "duplicate_decision", item: n }); continue; }
    if (!FINDING_ANSWERS.includes(g.answer)) errors.push({ code: "bad_answer", item: n });
    else if (g.answer === "holds" && /** @type {{ kind?: string }} */ (shown.findings[n - 1]).kind !== "Stale") errors.push({ code: "holds_not_stale", item: n });
    for (const field of ["reason", "ticket"]) {
      if (g[field] === undefined) continue;
      const v = g[field];
      if (g.answer !== "dismiss") errors.push({ code: "field_not_allowed", item: n, field });
      else if (typeof v !== "string" || !(field === "ticket" ? TICKET : REASON).test(v)) errors.push({ code: "bad_value", item: n, field });
    }
    answered.set(n, g);
  }
  const review = input.review;
  if (review !== undefined && !REVIEW_ANSWERS.includes(review)) errors.push({ code: "bad_review" });
  else if (review === "reject") {
    if (!shown.reject) errors.push({ code: "reject_keyed" });
    else if (answered.size) errors.push({ code: "reject_with_finding", items: [...answered.keys()] });
  } else if (review === "retire") {
    if (!shown.retire) errors.push({ code: "retire_unkeyed" });
    else if (answered.size) errors.push({ code: "retire_with_finding", items: [...answered.keys()] });
  } else {
    const open = shown.findings.map((_, i) => i + 1).filter((n) => !answered.has(n));
    if (open.length || review === undefined) errors.push({ code: "unaddressed", findings: open, review: review === undefined });
  }
  if (errors.length) return { errors };
  const findings = [...answered].map(([n, g]) => ({ n, answer: g.answer, finding: g.answer === "keep" ? "keep_open" : g.answer, id: shown.findings[n - 1].id, ...(g.reason !== undefined && { reason: g.reason.trim() }), ...(g.ticket !== undefined && { ticket: g.ticket }) }));
  return { errors, review, findings };
}

