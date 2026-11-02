// @ts-check
// The settle engine, shared by `/qa-impact` and `/qa-design`: the walk and triage below, and the
// action tables `impact` and `design` both run. The Card page (settle-page.mjs), proposals and links
// (settle-propose.mjs), and checkpoint 2 with the Rule fix (settle-checkpoint.mjs) are split out.
// The triage walk of `/qa-design`'s settlement (and `--review`). The engineer settles each
// case the walk visits in one exchange over two independent things: the finding (dismiss / fix /
// keep open) and the review (accept / leave / reject / retire). The skill asks; this module shows and writes.
//
//   layOut    (from `impact persist`) which cases the walk visits, saved as `walk.json` in the
//             run directory: every case with a finding this run raised and left open, every
//             carried open Stale of the Features judged, every case of the Feature the run names
//             with an open finding (stored, or the Scan's Divergence/Outcome gap), and with
//             `--review` the unreviewed and Review overdue cases. Never those extra cases by
//             default.
//   walk      each of those cases as the working tree now holds it: its open findings (stored,
//             and the scan-only Divergences and Outcome gaps `scan` reports on it), its review,
//             what the exchange offers, and whether this Run has settled it. The next case to
//             settle, and, once none is left, the changeset and the merge rules.
//   triage    settles one case: writes it at once, every file through `check-file` first. A walk
//             aborted halfway leaves every case settled so far on disk.
//
// What a disposition writes:
//   dismiss    a `dismissed: {by, at, commit, reason?, ticket?}` block on the finding. A scan-only
//              finding is stored for it, `{kind, at_commit: <target>, evidence: <scan message>}`:
//              `scan` withdraws a dismissed Divergence only while its `evidence` is the result's
//              `message` word for word, so the message is copied verbatim.
//   keep_open  nothing, but an `at_commit` that does not resolve is rewritten to the run's target
//              (dismiss does the same).
//   fix        the engineer has changed the knowledge first; the CLI checks that it did (the case,
//              a Rule it rests on or the other case it names differs from HEAD's, or `scan` no
//              longer reports the scan-only finding), then removes the finding. A fix leaves the
//              case unreviewed, so it also removes any `review` stamp.
//   accept     `review: {by: human:<name>, at, commit}`, never with a fix, and clears a passed
//              `review_by` in that edit. The name is the engineer's, given to the skill.
//   reject     only for a case with no effective Tracker key (ADR-0006, ADR-0027): the case entry
//              is removed, and its Key and every former Tracker key it held (`tracker:…`) are
//              recorded under the Feature's `retired:`, since a Retired key is never reused.
//   retire     only for a case with an effective Tracker key (ADR-0027, ADR-0043): the case entry
//              is removed, its Key, its former Tracker keys and its current Tracker key are
//              recorded under the Feature's `retired:`, and a `{kind: retire, tracker}` repair is
//              queued on the Feature for `/qa-publish`, which alone writes the tracker. A pending
//              `remark` repair naming the case goes with it. The settled answer reports the
//              Automation keys the case named and those no remaining case names.
// A Dismissal and a Review stamp pin HEAD, the commit whose knowledge the engineer read, and are
// refused while that knowledge has uncommitted edits: a pin must name a commit holding the text it
// attests (the rule `--persist` itself follows), or the next scan would void it at once.
//
// A Divergence on a scenario's H1 (its summary against `mirror.summary`) is shown but cannot be
// settled here: scenario frontmatter has no `finding` list, so a Dismissal has nowhere to live.
// It is fixed by editing the H1 or refreshing the mirror (`/qa-sync`), or left reported.
import { ANY_SCHEMA_VERSION, LEVEL_ON_CASE_SCHEMA_VERSION } from "./schema.mjs";
import { levelMigrationFiles, recordedLevelMappings } from "./migration-plan.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { keyLabel, summaries, terms } from "./labels.mjs";
import { commitLine, writeAll } from "./changeset.mjs";
import { isMap } from "./dialect.mjs";
import { findingData } from "./finding-data.mjs";
import { loadQaAt, repositoryOf, resolveRef } from "./git-tree.mjs";
import { resolveCommits } from "./git.mjs";
import { written } from "./impact-persist.mjs";
import { backfillChangeset } from "./pin-digest.mjs";
import { caseData, decisionsOf, featureData, refusalOf, KIND, MERGE_ORDER, mergeRules, findingLabel, refuse } from "./impact-json.mjs";
import { trackerReference } from "./keys.mjs";
import { relianceOf } from "./reliance.mjs";
import { isQualifiedRuleRef, parseRuleRef, resolveRuleRef, ruleRefsIn } from "./rule-ref.mjs";
import { checkFile, edit, parse } from "./knowledge-file.mjs";
import { object } from "./refusal.mjs";
import { buildIndex, loadWorkingTree, rootConfig } from "./qa-index.mjs";
import { openPlan, readRunFile } from "./run-dir.mjs";
import { localDate, scan } from "./scan.mjs";
import { IMPACT_TRAIN_KEY } from "./schema.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { causeRefs, isOpenFinding, isStaleObligation, isStoredFinding, restsOn } from "./stored-findings.mjs";
import { claimProjection } from "./stripped.mjs";
import { retiredWith, tombstonesOf } from "./tombstones.mjs";
import { trainFor } from "./training.mjs";
import { checkpoint, ruleFix } from "./settle-checkpoint.mjs";
import { page, pageReply } from "./settle-page.mjs";
import { link, proposalLines, proposalView, propose } from "./settle-propose.mjs";
/** @import { RunFileResult } from "./run-dir.mjs" */

/** @import {CaseFinding, DecisionFinding, ImpactCaseData, ImpactChangeset, RawCase, Summaries, Terms} from "./impact-json.mjs" */
/** @import {ImpactPlan, SettledFindings, WrittenFindings} from "./impact.mjs" */
/** @import {CommandAction, CommandResult, OptionSpec} from "./cli.mjs" */
/** @import {RefusalResult} from "./refusal.mjs" */

/**
 * A case the walk visits, as `walk.json` holds it.
 * @typedef {object} WalkCase
 * @property {string} feature
 * @property {string | null} scenario
 * @property {string} file
 * @property {string} key
 * @property {string[]} why
 * @property {boolean} [feature_finding] - the item is a Feature's own findings, not a Test Case's
 */

/**
 * `walk.json`, the walk as `impact persist` lays it out and `design walk` reads it back.
 * @typedef {object} WalkLaid
 * @property {number} v
 * @property {string | null} target
 * @property {WalkCase[]} cases
 * @property {{ paths: string[], merge: string[] }} persisted
 * @property {WalkCheckpointFeature[]} checkpoint - the Features whose Watermark waits for checkpoint 2
 */

/**
 * A Feature whose Watermark advances at checkpoint 2, once the walk is settled and committed.
 * @typedef {object} WalkCheckpointFeature
 * @property {string} feature
 * @property {string | null} file
 * @property {string | null} from
 */

/**
 * A case the Run has settled, as `triage.json` holds it.
 * @typedef {object} WalkSettledCase
 * @property {{ id: string, kind: string, finding: string }[]} finding
 * @property {string} [review]
 * @property {string} at
 */

/**
 * `triage.json`, the Run's own record of what it settled and wrote.
 * @typedef {object} WalkState
 * @property {string | null} run
 * @property {string | null} log
 * @property {Record<string, WalkSettledCase>} settled
 * @property {string[]} written
 * @property {string[]} merge
 * @property {{ commit: string, at: string }} [checkpoint] - checkpoint 2, once reached
 * @property {Record<string, string>} [rule_fixes] - the Rules fixed on the walk (`<feature>/<rule>`) with their text then ("" once retired)
 * @property {WalkCase[]} [reopened] - the cases a Rule fix put back on the walk
 */

/**
 * A finding the walk shows of a case, as `walk.seen.json` holds it.
 * @typedef {object} WalkFinding
 * @property {string} id
 * @property {string} source
 * @property {string} kind
 * @property {number} [index]
 * @property {string} [code]
 * @property {string | null} [at_commit]
 * @property {boolean} [at_commit_resolves]
 * @property {string | null} [evidence]
 * @property {string} [rests_on]
 * @property {string[]} [causes] - the Rules a Stale names as its cause
 * @property {string[]} [affects] - the Rules of its Feature the Stale reaches
 * @property {string} [rule] - the Rule a Feature-level Overreach is about (ADR-0039)
 * @property {WalkScanResult} [result]
 */

/**
 * `walk.seen.json`, what the walk showed of each case's findings.
 * @typedef {Record<string, WalkFinding[]>} WalkSeen
 */

/**
 * `walk.by.json`, the name this Run's stamps carry.
 * @typedef {{ by: string }} WalkBy
 */

/**
 * A finding the walk numbered, as `walk.shown.json` holds it.
 * @typedef {object} WalkShownFinding
 * @property {string} id
 * @property {string} source
 * @property {string} kind
 */

/**
 * `walk.shown.json`, the case the next decisions answer. No case waits once the walk is done.
 * @typedef {{ case: string, findings: WalkShownFinding[], reject: boolean, retire: boolean } | { case: null }} WalkShown
 */

/**
 * Every walk state file, as the walk reads it back.
 * @typedef {WalkLaid | WalkState | WalkSeen | WalkBy | WalkShown} WalkFileValue
 */

/**
 * The case the walk shows, as the working tree holds it now.
 * @typedef {object} WalkViewCase
 * @property {string} key
 * @property {string} feature
 * @property {string | null} scenario
 * @property {string} file
 * @property {string[]} why
 * @property {string} summary
 * @property {WalkReview} review
 * @property {WalkFinding[]} findings
 * @property {boolean} reject
 * @property {boolean} retire
 * @property {WalkSettledCase | null} settled
 * @property {boolean} [feature_finding] - the item is a Feature's own findings (ADR-0039)
 * @property {false} [gone]
 */

/**
 * A case the walk visits that the knowledge layer no longer holds.
 * @typedef {object} WalkViewGone
 * @property {string} key
 * @property {string} feature
 * @property {string | null} scenario
 * @property {string} file
 * @property {string[]} why
 * @property {true} gone
 * @property {WalkSettledCase | null} settled
 * @property {WalkFinding[]} [findings]
 * @property {WalkReview} [review]
 * @property {boolean} [reject]
 * @property {boolean} [retire]
 */

/**
 * A case the walk shows, as it stands now or as it has gone.
 * @typedef {WalkViewGone | WalkViewCase} WalkView
 */

/**
 * The Review of a case, as the walk shows it.
 * @typedef {object} WalkReview
 * @property {string} status
 * @property {string | null} [by]
 * @property {string | null} [at]
 * @property {string} [why]
 */

/**
 * A refusal the walk words: its code and the data it carries.
 * @typedef {{ code: string, key?: string, kind?: string | null, rests?: Array<{ key: string, file: string }> } & Record<string, unknown>} WalkRefusal
 */

/**
 * A decision on one finding of the walk's case.
 * @typedef {object} WalkDecision
 * @property {WalkFinding} f
 * @property {DecisionFinding} g
 * @property {boolean} reported
 */

/**
 * A tracker repair queued on a Feature's `repairs:` for `/qa-publish`.
 * @typedef {{ kind: string, tracker?: string, key?: string }} WalkRepair
 */

/**
 * What retiring a keyed case recorded: the Retired keys, the queued repair and the Automation
 * consequences (the keys the case named, and those no remaining case names).
 * @typedef {{ retired: string[], repair: WalkRepair, automation: { keys: string[], unlinked: string[] } }} WalkRetirement
 */

/**
 * The decisions on the case the walk showed, as the triage reads them.
 * @typedef {object} WalkInput
 * @property {string} case
 * @property {string | undefined} review
 * @property {string} by
 * @property {DecisionFinding[]} findings
 */

/**
 * A case the persisted run raised a finding on, as the run records it for the walk.
 * @typedef {object} WalkRaised
 * @property {string} feature
 * @property {string} scenario
 * @property {string} file
 * @property {string} key
 * @property {Array<{ kind: string, at_commit: string | null, carried: boolean, origin: "judged" | "mechanical" | null }>} findings
 */

/**
 * A finding the walk decided on, as the decision writes it.
 * @typedef {object} WalkStamp
 * @property {string} by
 * @property {string} at
 * @property {string | null} commit
 * @property {string} [reason]
 * @property {string} [ticket]
 */

/**
 * A Dismissal of a finding, as `.qa/` holds it.
 * @typedef {object} WalkDismissal
 * @property {string} by
 * @property {string} at
 * @property {string | null} [commit]
 * @property {string} [reason]
 * @property {string} [ticket]
 */

/**
 * A Review stamp, as `.qa/` holds it.
 * @typedef {object} WalkReviewData
 * @property {string} by
 * @property {string} at
 * @property {string | null} [commit]
 */

/**
 * A stored finding of a Test Case, as `.qa/` holds it.
 * @typedef {object} WalkFindingData
 * @property {string} kind
 * @property {string | null} [at_commit]
 * @property {string} [at_digest]
 * @property {string | null} [evidence]
 * @property {string} [rests_on]
 * @property {string} [rule] - the Rule a Feature-level Overreach is about (ADR-0039)
 * @property {string[]} [causes]
 * @property {string[]} [affects]
 * @property {WalkDismissal} [dismissed]
 * @property {WalkStamp} [holds] - the engineer's statement that the case holds after the Stale's cause
 */

/**
 * A `.qa/` file's YAML data, as the walk reads it.
 * @typedef {object} WalkData
 * @property {number} [schema_version]
 * @property {string} [key]
 * @property {WalkFindingData[]} [finding]
 * @property {WalkReviewData} [review]
 * @property {string[]} [covers]
 * @property {string[]} [retired]
 * @property {Array<{ kind: string, tracker?: string, key?: string }>} [repairs]
 * @property {string[]} [automates]
 * @property {string} [watermark]
 */

/**
 * A Test Case's entry, as the walk reads it.
 * @typedef {object} WalkEntry
 * @property {string} key
 * @property {string} summary
 * @property {WalkData} data
 * @property {number | null} blockLine
 */

/**
 * A Feature's Rule, as the walk reads it.
 * @typedef {object} WalkRule
 * @property {string} key
 * @property {string} statement
 * @property {number} line
 * @property {number} end
 */

/**
 * A `.qa/` file, as the walk reads it (lib/knowledge-file.mjs `parse`).
 * @typedef {object} WalkFile
 * @property {string} rel
 * @property {string} text
 * @property {string | null} [type]
 * @property {unknown} [unreadable]
 * @property {WalkData} data
 * @property {WalkEntry[]} cases
 * @property {WalkRule[]} rules
 * @property {{ line: number, key: string | null, text: string } | null} [h1]
 */

/**
 * A Test Case as the Key index holds it.
 * @typedef {object} WalkCaseDecl
 * @property {string} feature
 * @property {string | null} scenario
 * @property {WalkFile} file
 * @property {number} line
 * @property {WalkEntry} entry
 */

/**
 * A Feature as the Key index holds it.
 * @typedef {object} WalkFeatureDecl
 * @property {WalkFile} file
 * @property {number} line
 */

/**
 * A Test Scenario as the Key index holds it.
 * @typedef {object} WalkScenarioDecl
 * @property {WalkFile} file
 * @property {number} line
 * @property {string | null} feature
 */

/**
 * A train file as the Key index holds it.
 * @typedef {object} WalkTrainDecl
 * @property {WalkFile} file
 * @property {number} line
 */

/**
 * The Tracker keys the index resolves, as the walk reads them.
 * @typedef {object} WalkTracker
 * @property {(kind: string, key: string) => string | null} current
 */

/**
 * The Key index of `.qa/`, as the walk reads it (lib/qa-index.mjs `buildIndex`).
 * `featureOf` is declared as a method, so the index `buildIndex` builds (which takes the full parsed
 * file) is comparable to this projection.
 * @typedef {{
 *   cases: Map<string, WalkCaseDecl[]>,
 *   features: Map<string, WalkFeatureDecl[]>,
 *   scenarios: Map<string, WalkScenarioDecl[]>,
 *   train: Map<string, WalkTrainDecl[]>,
 *   featureOf(file: WalkFile): string | null,
 *   tracker: WalkTracker,
 * }} WalkIndex

/**
 * A Scan result, as the walk reads it.
 * @typedef {object} WalkScanResult
 * @property {string} kind
 * @property {string} code
 * @property {string} [key]
 * @property {string} [file]
 * @property {string} message
 * @property {number} [line]
 */

/**
 * A Review stamp's freshness, as the scan reports it.
 * @typedef {object} WalkReviewFact
 * @property {string} key
 * @property {string} status
 * @property {string} [why]
 */

/**
 * The scan's facts, as the walk reads them (lib/scan.mjs `scan`).
 * @typedef {object} WalkScan
 * @property {WalkScanResult[]} results
 * @property {{ reviews: WalkReviewFact[], persist: { clean: boolean, reason?: string, changed: Array<{ file: string, change: string }> } }} history
 */

/**
 * `.qa/` as the working tree holds it now, with what the walk shows of it.
 * @typedef {object} WalkNow
 * @property {WalkFile[]} files
 * @property {WalkIndex} index
 * @property {WalkScan} scan
 * @property {Map<string, WalkReviewFact>} reviews
 */

/**
 * The knowledge the walk reads by Key: each case's entry, and each Feature's Rules.
 * @typedef {object} WalkKnowledge
 * @property {Map<string, string>} cases
 * @property {(feature: string, k: string) => string | null} rule
 * @property {(feature: string, k: string) => string | null} boundary
 * @property {import("./migration-plan.mjs").LevelMigrationError[]} errors Files a historical version
 *   the level rewrite could not migrate, read as they were.
 */

/**
 * A file of `.qa/` with its Bookkeeping stripped, as the walk reads it.
 * @typedef {{ text: string, cases: Map<string, string>, rules: Map<string, string>, boundaries: Map<string, string> }} WalkStripped
 */

/**
 * A command's training, as `trainFor` gives it.
 * @typedef {object} WalkTrain
 * @property {boolean} exists
 * @property {string | null} text
 * @property {Array<{ key: string, kind: string, statement: string }>} entries
 */

/**
 * Where `.qa/` sits in its repository, as the walk reads it.
 * @typedef {{ top: string, prefix: string }} WalkRepo
 */

/**
 * The result of an edit, as the walk reads it (lib/knowledge-file.mjs `edit`).
 * @typedef {{ ok: boolean, unreadable?: boolean, text: string, message?: string }} WalkEdit
 */

/**
 * A change `edit` makes, as the walk makes it.
 * @typedef {{ at?: string, set?: Record<string, unknown>, remove?: string }} WalkChange
 */

/**
 * A Divergence the walk shows beside its case, as the scan reports it.
 * @typedef {{ scenario: string, kind: string } & Record<string, unknown>} WalkDivergence
 */

/**
 * The page state a Card page reads: the walk's cases, the glossary and the summaries.
 * @typedef {object} PageState
 * @property {Array<WalkViewGone | PageStateCase>} cases
 * @property {Array<{ term: string, explanation: string }>} terms
 * @property {PageStateSummaries} summaries
 * @property {never} [refused]
 */

/**
 * A case the page offers, as the walk's page state holds it.
 * @typedef {object} PageStateCase
 * @property {string} key
 * @property {WalkSettledCase | null} settled
 * @property {PageStateItem} item
 * @property {string} fingerprint
 * @property {false} [gone]
 */

/**
 * The case the page shows, each field a label or a fact.
 * @typedef {object} PageStateItem
 * @property {string} key
 * @property {string} label
 * @property {string} feature
 * @property {string | null} scenario
 * @property {string} file
 * @property {string[]} [proposal] - design's proposal for the case, one line each (never an answer)
 * @property {Array<{ code: string, line: string }>} why
 * @property {PageStateReviewState} review_state
 * @property {CaseFinding[]} facts
 * @property {PageStateTexts} texts
 * @property {PageStateQuestions} questions
 * @property {string[]} constraints
 */

/**
 * The Review a case carries, as the page shows it.
 * @typedef {object} PageStateReviewState
 * @property {string} status
 * @property {string | null} [by]
 * @property {string} [at]
 * @property {{ code: string, line: string }} [because]
 * @property {WalkReviewData | null} stamp
 */

/**
 * The knowledge texts a case shows, as the page shows them.
 * @typedef {object} PageStateTexts
 * @property {string | undefined} case
 * @property {Array<{ feature: string, key: string, text: string | null }>} rules
 */

/**
 * The answers a case offers, as the page shows them.
 * @typedef {object} PageStateQuestions
 * @property {{ choices: string[] }} findings
 * @property {{ choices: string[] }} review
 */

/**
 * The summaries of `.qa/`'s keys, as the page shows them.
 * @typedef {object} PageStateSummaries
 * @property {Record<string, string | undefined>} features
 * @property {Record<string, string | undefined>} scenarios
 * @property {Record<string, string | undefined>} cases
 * @property {Record<string, Record<string, string>>} rules
 */

/**
 * What `design walk` prints: the next case to settle, or, once none is left, the changeset and the
 * merge rules for what the run wrote.
 * @typedef {object} WalkOut
 * @property {boolean} ok
 * @property {boolean} done
 * @property {WalkTrain} train
 * @property {{ settled: number, total: number }} progress
 * @property {ImpactCaseData | null} case
 * @property {WalkDivergence[]} scenario_divergences
 * @property {{ paths: string[], commit: string | null }} [changeset]
 * @property {Array<{ rule: string, text: string }>} [merge_rules]
 */

/**
 * The Run's plan and walk, its triage state, what the walk has shown, and the name its stamps
 * carry, or the refusal that stopped it.
 * @typedef {{ refused: RefusalResult, plan?: never, laid?: never, state?: never, seen?: never, by?: never, shown?: never }
 *   | { refused?: never, plan: ImpactPlan, laid: WalkLaid, state: WalkState, seen: WalkSeen, by: string | null, shown: WalkShown | null }} WalkLoaded
 */

/**
 * What the walk settles: a Test Case's findings, or a Feature's own findings (ADR-0039).
 * @typedef {object} WalkTarget
 * @property {string} feature - the Feature the findings belong to
 * @property {string} file - the `.qa/` path the findings sit in
 * @property {string} key - the Test Case key, or the Feature key
 * @property {boolean} feature_finding
 * @property {WalkFindingData[]} list - the stored findings
 * @property {WalkFinding[]} offered - the open findings, as the walk numbers them
 * @property {(f: WalkFinding) => Array<[string, string]>} rests - what a finding rests on
 * @property {string} summary - the Test Case's summary, or the Feature's heading
 * @property {string} text - the working tree's text of the file the findings sit in
 * @property {WalkCaseDecl | null} case_decl - the Test Case's declaration; null for a Feature
 */

/**
 * What `decide` found: the case as it stands now, or the refusal that stopped it.
 * @typedef {{ refused: WalkRefusal, now?: WalkNow }
 *   | { refused?: never, now: WalkNow, target: WalkTarget, list: WalkFindingData[], resolved: Map<string | null, string | null>, offered: WalkFinding[], decisions: WalkDecision[], fixes: WalkDecision[], repo: WalkRepo, head: string, fixed: string[] }} WalkDecisionOut
 */

const WALK = "walk.json";
export const STATE = "triage.json";
const SEEN = "walk.seen.json";
const BY = "walk.by.json";
const SHOWN = "walk.shown.json";
// The action that writes each of the walk's run-dir files.
/** @type {Record<string, string>} */
const WRITTEN_BY = { [WALK]: "impact persist", [STATE]: "design triage", [SEEN]: "design walk", [BY]: "design walk", [SHOWN]: "design walk" };

// The rules among `keys`, in one fixed order (lib/impact-json.mjs).
/**
 * @param {readonly (string | boolean)[]} keys
 * @returns {string[]}
 */
const ordered = (keys) => MERGE_ORDER.filter((k) => keys.includes(k));

/** @type {Record<string, string>} */
const SCAN_ONLY = { divergence: "Divergence", outcome_gap: "OutcomeGap" };
// The name a stamp carries: the engineer's own, `human:<name>`, one token the dialect holds as is.
const HUMAN = /^human:[^\s"\\]+$/;
// A case's `finding` list as written, and which of its `at_commit` pins resolve.
/**
 * @param {WalkEntry} entry
 * @returns {WalkFindingData[]}
 */
export const findingsOf = (entry) => (Array.isArray(entry.data.finding) ? entry.data.finding : []);
// A Feature file's own `finding` list (ADR-0039): the findings about its Rules.
/**
 * @param {WalkFile} file
 * @returns {WalkFindingData[]}
 */
const featureFindingsOf = (file) => (Array.isArray(file.data.finding) ? file.data.finding : []);
/**
 * @param {string} root
 * @param {WalkFindingData[]} list
 * @returns {Map<string | null, string | null>}
 */
const pinsResolved = (root, list) => /** @type {Map<string | null, string | null>} */ (resolveCommits(root, list.filter(isMap).map((x) => written(x.at_commit)).filter(Boolean)).resolved);

// The cases the walk visits, before `impact persist` writes (it needs to know whether any is left
// to settle: with none, the Watermark has no fix to wait for). `settled` is what the run raised.
/**
 * @param {ImpactPlan} plan
 * @param {SettledFindings} settled
 * @returns {WalkCase[]}
 */
export function walkCases(plan, settled) {
  const root = plan.root;
  // The working tree with the Scan the gate (`settleScope`) reads, so both count the same open
  // findings: the stored ones and the Scan's Divergences and Outcome gaps.
  const now = current(root);
  const files = now.files;
  const index = now.index;
  /** @type {Map<string | null, string | null>} */
  const noPins = new Map();
  /** @type {WalkCase[]} */
  const cases = [];
  /**
   * @param {string} key
   * @param {string} why
   */
  const visit = (key, why) => {
    const decl = index.cases.get(key)?.[0];
    if (!decl) return;
    let c = cases.find((x) => x.key === key);
    if (!c) cases.push((c = { feature: decl.feature, scenario: decl.scenario, file: decl.file.rel, key, why: [] }));
    if (!c.why.includes(why)) c.why.push(why);
  };
  // A Feature's own findings (ADR-0039): the walk visits the Feature, not a Test Case of it.
  /**
   * @param {string} feature
   * @param {string} why
   */
  const visitFeature = (feature, why) => {
    const decl = index.features.get(feature)?.[0];
    if (!decl) return;
    let c = cases.find((x) => x.key === feature && x.feature_finding);
    if (!c) cases.push((c = { feature, scenario: null, file: decl.file.rel, key: feature, why: [], feature_finding: true }));
    if (!c.why.includes(why)) c.why.push(why);
  };
  for (const w of /** @type {WalkRaised[]} */ (settled.walk)) for (const f of w.findings) visit(w.key, f.carried ? "carried" : f.kind === "Overreach" ? (f.origin === "judged" ? "judged_overreach" : "overreach") : "verdict");
  // The Feature-level Overreach the judge raised (ADR-0039): the Feature's own findings, which the
  // walk settles like any other finding.
  for (const f of settled.features) {
    if (!f.changed) continue;
    if (f.after.some((x) => isMap(x) && isOpenFinding(x) && isStoredFinding(x))) visitFeature(f.feature, "feature_overreach");
  }

  /**
   * @param {string} slug
   * @returns {WalkEntry[]}
   */
  const ofFeature = (slug) => files.filter((f) => !f.unreadable && f.type === "scenario" && index.featureOf(f) === slug).flatMap((f) => f.cases);
  for (const f of plan.scope.features) {
    // Only the Feature the run names is walked for open findings, whatever its class: the Scan's
    // Divergences and Outcome gaps are open findings too, and the gate counts them beside the stored
    // ones. An unnamed run never pulls a zero-diff Feature in.
    if (plan.feature !== f.feature) continue;
    for (const c of ofFeature(f.feature)) {
      const decl = index.cases.get(c.key)?.[0];
      if (decl && openFindings(now, decl, noPins).length) visit(c.key, "open_findings");
    }
    const own = index.features.get(f.feature)?.[0];
    if (own && openFeatureFindings(featureFindingsOf(own.file), noPins).length) visitFeature(f.feature, "open_findings");
  }
  // A Stale the Scan stored on an earlier run and nobody has settled is still open, so it is still
  // on the walk (ADR-0043).
  // A case this run raised on is already there. One this run reopened (a re-armed Dismissal) shows in
  // what the run left on the case; any other, in the working tree.
  /** @param {unknown[]} list */
  const storedOpen = (list) => list.some((x) => isOpenFinding(x) && isStaleObligation(x));
  for (const c of settled.cases) if (storedOpen(c.after) && !cases.some((v) => v.key === c.key)) visit(c.key, "carried");
  for (const f of plan.scope.features) for (const c of ofFeature(f.feature)) if (storedOpen(findingsOf(c)) && !cases.some((v) => v.key === c.key)) visit(c.key, "carried");
  if (plan.review) {
    const slugs = plan.review.feature ? [plan.review.feature] : plan.feature ? [plan.feature] : plan.scope.features.map((f) => f.feature);
    const reasons = reviewReasons(scan(root, {}));
    for (const slug of slugs) for (const c of ofFeature(slug)) for (const why of reasons(c.key)) visit(c.key, why);
  }
  return cases;
}

// Why a case asks for Review work: `unreviewed` while it has no fresh Review, `review_overdue` while
// its `review_by` has passed, even when that Review is fresh. The one rule `--review` follows in the
// walk and in `design state`.
/**
 * @param {{ history: { reviews: ReadonlyArray<{ key: string, status: string }> }, results: ReadonlyArray<{ kind: string, key?: unknown }> }} facts
 * @returns {(key: string) => Array<"unreviewed" | "review_overdue">}
 */
function reviewReasons(facts) {
  const fresh = new Set(facts.history.reviews.filter((r) => r.status === "fresh").map((r) => r.key));
  const overdue = new Set(facts.results.filter((r) => r.kind === "review_overdue").map((r) => r.key));
  return (key) => [...(fresh.has(key) ? [] : /** @type {const} */ (["unreviewed"])), ...(overdue.has(key) ? /** @type {const} */ (["review_overdue"]) : [])];
}

/**
 * What `design state` reports of the settle phase for one Feature: the open-finding gate (every open
 * finding the walk would offer, by kind, with the cases and the Feature itself that carry them) and,
 * with `review`, the cases `--review` adds.
 * @typedef {object} SettleScope
 * @property {{ open: boolean, total: number, by_kind: Record<string, number>, features: Array<{ feature: string, total: number, by_kind: Record<string, number>, cases: string[] }> }} open_findings
 * @property {{ feature: string, cases: Array<{ key: string, scenario: string | null, file: string, why: string[] }> }} [review]
 */

/**
 * The settle phase of one Feature, read from the working tree: the findings the walk would offer
 * (stored open ones, the Scan's Divergences and Outcome gaps, and the Feature's own findings), and
 * with `review` the unreviewed and Review overdue cases.
 * @param {string} root
 * @param {string} slug
 * @param {{ review?: boolean }} [options]
 * @returns {SettleScope}
 */
export function settleScope(root, slug, { review = false } = {}) {
  const now = current(root);
  const noPins = new Map();
  /** @type {Record<string, number>} */
  const byKind = {};
  /** @type {string[]} */
  const carriers = [];
  /** @param {WalkFinding[]} found @param {string} key */
  const tally = (found, key) => {
    if (!found.length) return;
    carriers.push(key);
    for (const f of found) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  };
  const ofFeature = now.files.filter((f) => !f.unreadable && f.type === "scenario" && now.index.featureOf(f) === slug).flatMap((f) => f.cases);
  for (const c of ofFeature) {
    const decl = now.index.cases.get(c.key)?.[0];
    if (decl) tally(openFindings(now, decl, noPins), c.key);
  }
  const own = now.index.features.get(slug)?.[0];
  if (own) tally(openFeatureFindings(featureFindingsOf(own.file), noPins), slug);
  const total = Object.values(byKind).reduce((n, v) => n + v, 0);
  /** @type {SettleScope} */
  const out = { open_findings: { open: total > 0, total, by_kind: byKind, features: total > 0 ? [{ feature: slug, total, by_kind: byKind, cases: carriers }] : [] } };
  if (review) {
    const reasons = reviewReasons(now.scan);
    out.review = {
      feature: slug,
      cases: ofFeature.flatMap((c) => {
        const why = reasons(c.key);
        const decl = now.index.cases.get(c.key)?.[0];
        return why.length && decl ? [{ key: c.key, scenario: decl.scenario, file: decl.file.rel, why }] : [];
      }),
    };
  }
  return out;
}

// Called by `impact persist` once it has written: saves which cases the walk visits, the Features
// whose Watermark waits for checkpoint 2, and what the persisted run wrote (its changeset, and the
// merge rules that govern it) for the walk's closing.
/**
 * @param {string} dir
 * @param {ImpactPlan} plan
 * @param {SettledFindings} settled
 * @param {WrittenFindings} persisted
 * @param {ImpactChangeset} changeset
 * @param {WalkCase[]} [cases] - `walkCases`, when the caller already has them
 * @returns {WalkLaid}
 */
export function layOut(dir, plan, settled, persisted, changeset, cases = walkCases(plan, settled)) {
  /** @type {WalkLaid} */
  const laid = {
    v: 1,
    target: plan.target.commit,
    cases,
    checkpoint: persisted.features
      .filter((f) => /** @type {{ reason?: string }} */ (f.watermark).reason === "awaiting_checkpoint")
      .map((f) => ({ feature: f.feature, file: /** @type {import("./impact-persist.mjs").WatermarkItem[]} */ (settled.watermarks).find((w) => w.feature === f.feature)?.file ?? null, from: f.watermark.from ?? null })),
    persisted: {
      paths: changeset.paths,
      merge: ordered([persisted.features.some((f) => f.watermark.advanced) && "watermark", (settled.cases.some((c) => c.changed) || settled.features.some((f) => f.changed)) && "findings"]),
    },
  };
  writeFileSync(join(dir, WALK), `${JSON.stringify(laid, null, 2)}\n`);
  return laid;
}

// A run-dir file of the walk: `{value}`, null when absent unless `missing` says otherwise, or
// `{error}`.
/**
 * @param {string} dir
 * @param {string} name
 * @param {string} [missing]
 * @returns {RunFileResult<WalkFileValue>}
 */
const readWalkFile = (dir, name, missing) => readRunFile(dir, name, { by: WRITTEN_BY[name], restart: "impact plan", missing });

// The run's plan and walk, its triage state, what the walk has shown, and the name its stamps carry,
// or `{refused}`.
/**
 * @param {string} dir
 * @param {ImpactPlan} plan
 * @returns {WalkLoaded}
 */
export function load(dir, plan) {
  if (plan.persist !== true) return { refused: refuse("not_persisted") };
  /** @type {Record<string, WalkFileValue | null | undefined>} */
  const files = {};
  for (const [name, missing] of /** @type {Array<[string, string | undefined]>} */ ([[WALK, `no walk in ${dir}: run \`impact persist --dir ${dir}\` first`], [STATE], [SEEN], [BY], [SHOWN]])) {
    const read = readWalkFile(dir, name, missing);
    if (read.error) return { refused: refuse("run_dir", { reason: read.error }) };
    files[name] = read.value;
  }
  const by = /** @type {WalkBy | undefined} */ (files[BY])?.by ?? null;
  if (by !== null && !HUMAN.test(by)) return { refused: refuse("run_dir", { reason: `${join(dir, BY)} is not the JSON \`design walk\` wrote: start a new run with \`impact plan\`` }) };
  const state = /** @type {WalkState} */ (files[STATE] ?? { run: null, log: null, settled: {}, written: [], merge: [] });
  const laid = /** @type {WalkLaid} */ (files[WALK]);
  return {
    plan,
    // A case a Rule fix reopened is on the walk again, wherever it was first raised.
    laid: state.reopened?.length ? { ...laid, cases: [...laid.cases, ...state.reopened.filter((c) => !laid.cases.some((x) => x.key === c.key && x.feature_finding === c.feature_finding))] } : laid,
    state,
    seen: /** @type {WalkSeen} */ (files[SEEN] ?? {}),
    by,
    shown: /** @type {WalkShown | null} */ (files[SHOWN]),
  };
}

// `.qa/` as the working tree holds it now, with what the walk shows of it.
/**
 * @param {string} root
 * @returns {WalkNow}
 */
export function current(root) {
  const files = /** @type {WalkFile[]} */ (loadWorkingTree(root));
  const index = /** @type {WalkIndex} */ (buildIndex(files));
  const s = scan(root, {});
  return { files, index, scan: s, reviews: new Map(s.history.reviews.map((r) => [r.key, r])) };
}

// A finding's id in the walk, from what it says (and, for a stored one, where it sits in the list,
// so two identical findings stay two), so it survives other cases being settled in between.
/**
 * @param {{ source: string, index?: number, kind: string, code?: string, at_commit?: string | null, evidence?: string | null }} f
 * @returns {string}
 */
const idOf = (f) => `f${createHash("sha1").update(JSON.stringify([f.source, f.index ?? null, f.kind, f.code ?? null, f.at_commit ?? null, f.evidence ?? null])).digest("hex").slice(0, 8)}`;

// The open findings on one case: its stored open findings, then what `scan` reports on it that is
// never stored until dismissed (Divergences, Outcome gaps). The one predicate the settle gate
// (`settleScope`) and the walk (`walkCases`, `view`, `targetOf`) count, so what one reports the
// other settles.
/**
 * @param {WalkNow} now
 * @param {WalkCaseDecl} decl
 * @param {Map<string | null, string | null>} resolved
 * @returns {WalkFinding[]}
 */
export function openFindings(now, decl, resolved) {
  /** @type {WalkFinding[]} */
  const out = [];
  findingsOf(decl.entry).forEach((x, index) => {
    if (!isOpenFinding(x)) return;
    const { rule, boundary } = restsOn(x);
    const rest = boundary ?? rule;
    const causes = causeRefs({ causes: x.causes });
    const affects = causeRefs({ affects: x.affects });
    const f = { source: "stored", index, kind: /** @type {string} */ (written(x.kind)), at_commit: written(x.at_commit), at_commit_resolves: resolved.get(written(x.at_commit)) != null, evidence: written(x.evidence), ...(rest !== null ? { rests_on: rest } : {}), ...(causes.length ? { causes } : {}), ...(affects.length ? { affects } : {}) };
    out.push({ id: idOf(f), ...f });
  });
  for (const r of now.scan.results) {
    if (!(r.kind in SCAN_ONLY) || r.key !== decl.entry.key || r.file !== decl.file.rel) continue;
    const f = { source: "scan", kind: SCAN_ONLY[r.kind], code: r.code, evidence: r.message };
    // What the walk shows of it: the Scan result in words; `evidence` stays the Scan's own message,
    // which a Dismissal of it stores word for word.
    out.push({ id: idOf(f), ...f, result: r });
  }
  return out;
}

// The open findings of a Feature's own findings (ADR-0039): an Overreach the judge raised on one of
// its Rules, with the Rule as its subject.
/**
 * @param {WalkFindingData[]} list
 * @param {Map<string | null, string | null>} resolved
 * @returns {WalkFinding[]}
 */
function openFeatureFindings(list, resolved) {
  /** @type {WalkFinding[]} */
  const out = [];
  list.forEach((x, index) => {
    if (!isOpenFinding(x)) return;
    const { rule, boundary } = restsOn(x);
    const rest = boundary ?? rule;
    const f = { source: "stored", index, kind: /** @type {string} */ (written(x.kind)), at_commit: written(x.at_commit), at_commit_resolves: resolved.get(written(x.at_commit)) != null, evidence: written(x.evidence), ...(rest !== null ? { rests_on: rest } : {}), ...(typeof x.rule === "string" ? { rule: x.rule } : {}) };
    out.push({ id: idOf(f), ...f });
  });
  return out;
}

// The strings in a list field, or none.
/**
 * @param {unknown} v
 * @returns {string[]}
 */
export const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

// Whether a case may be rejected: no current Tracker key resolves to it (lib/tracker-resolver.mjs).
/**
 * @param {WalkNow} now
 * @param {string} key
 * @returns {boolean}
 */
const rejectable = (now, key) => now.index.tracker.current("case", key) === null;

/**
 * @param {WalkNow} now
 * @param {WalkCase} e
 * @param {WalkSettledCase | null} settled
 * @param {string} root
 * @returns {WalkView}
 */
export function view(now, e, settled, root) {
  if (e.feature_finding) return featureView(now, e, settled, root);
  const decl = now.index.cases.get(e.key)?.[0];
  if (!decl) return { ...e, gone: true, settled };
  const findings = openFindings(now, decl, pinsResolved(root, findingsOf(decl.entry)));
  const r = now.reviews.get(e.key);
  const review = r ? { status: r.status, by: written(decl.entry.data.review?.by), at: written(decl.entry.data.review?.at), ...(r.why && { why: r.why }) } : { status: "none" };
  return {
    ...e,
    file: decl.file.rel,
    summary: decl.entry.summary,
    review,
    findings,
    // `reject` is open only while the case has no effective Tracker key.
    reject: rejectable(now, e.key),
    // `retire` is the other half: open while the case has one.
    retire: !rejectable(now, e.key),
    settled,
  };
}

// A Feature's own findings (ADR-0039), as the working tree holds them now: the Overreach the judge
// raised on one of its Rules. A Feature has no Review and is never rejected.
/**
 * @param {WalkNow} now
 * @param {WalkCase} e
 * @param {WalkSettledCase | null} settled
 * @param {string} root
 * @returns {WalkView}
 */
function featureView(now, e, settled, root) {
  const decl = now.index.features.get(e.feature)?.[0];
  if (!decl) return { ...e, gone: true, settled };
  const list = featureFindingsOf(decl.file);
  return {
    ...e,
    file: decl.file.rel,
    summary: decl.file.h1?.text ?? "",
    review: { status: "none" },
    findings: openFeatureFindings(list, pinsResolved(root, list)),
    reject: false,
    retire: false,
    settled,
  };
}

// Read-only view for a Card page and its freshness check. It uses the walk's own scope,
// findings and wording without selecting a case or changing what triage last saw.
/**
 * @param {string} dir
 * @param {ImpactPlan} plan
 * @returns {{ refused: RefusalResult } | PageState }
 */
export function pageState(dir, plan) {
  const loaded = load(dir, plan);
  if (loaded.refused) return loaded;
  const now = current(plan.root);
  /** @type {Summaries} */
  const s = summaries(now.index);
  /** @type {Terms} */
  const t = terms();
  const text = knowledge(now.files);
  const cases = loaded.laid.cases.map((e) => {
    const c = view(now, e, loaded.state.settled[e.key] ?? null, plan.root);
    if (c.gone) return c;
    // A Feature's own findings (ADR-0039): the Rule it is about and the Boundary it crosses.
    if (c.feature_finding) {
      /** @type {Array<[string, string | null]>} */
      const rules = [];
      for (const f of c.findings) {
        if (f.rule !== undefined) rules.push([f.rule, text.rule(c.feature, f.rule)]);
        if (f.rests_on !== undefined) rules.push([f.rests_on, text.boundary(c.feature, f.rests_on)]);
      }
      const data = featureData(/** @type {RawCase} */ (c), s, t);
      return {
        key: c.key, settled: c.settled,
        item: { key: c.key, label: data.label, feature: c.feature, scenario: null, file: c.file,
          why: data.why, review_state: { status: "none", stamp: null },
          facts: data.findings.map((f, i) => ({ id: c.findings[i].id, ...f })),
          texts: { case: undefined, rules: rules.map(([key, text]) => ({ feature: c.feature, key, text })) },
          questions: { findings: { choices: ["dismiss", "keep", "fix"] }, review: { choices: data.choices.review } },
          constraints: [],
        },
        fingerprint: createHash("sha256").update(JSON.stringify([rules])).digest("hex"),
      };
    }
    const decl = /** @type {WalkCaseDecl[]} */ (now.index.cases.get(c.key))[0];
    const rules = /** @type {Array<[string, string | null]>} */ ((decl.entry.data.covers ?? []).map((key) => [key, text.rule(c.feature, key)]));
    for (const ref of reliesOn(decl)) if (!rules.some(([key]) => key === ref)) rules.push([ref, text.rule(c.feature, ref)]);
    for (const ref of new Set(c.findings.flatMap((f) => ruleRefsIn(String(f.evidence ?? ""))))) {
      if (isQualifiedRuleRef(ref)) rules.push([ref, text.rule(c.feature, ref)]);
    }
    const data = caseData(/** @type {RawCase} */ (c), s, t);
    const proposal = proposalLines(proposalView(dir, now, c.key));
    return {
      key: c.key, settled: c.settled,
      item: { key: c.key, label: data.label, feature: c.feature, scenario: c.scenario, file: c.file,
        ...(proposal.length && { proposal }),
        why: data.why, review_state: { ...data.review, stamp: decl.entry.data.review ?? null },
        facts: data.findings.map((f, i) => ({ id: c.findings[i].id, ...f })),
        texts: { case: text.cases.get(c.key), rules: rules.map(([key, text]) => ({ feature: parseRuleRef(key)?.feature ?? c.feature, key, text })) },
        questions: { findings: { choices: c.findings.some((f) => f.kind === "Stale") ? ["dismiss", "keep", "fix", "holds"] : ["dismiss", "keep", "fix"] }, review: { choices: data.choices.review } },
        constraints: ["reject_stands_alone", "retire_stands_alone"],
      },
      fingerprint: createHash("sha256").update(JSON.stringify([text.cases.get(c.key), rules])).digest("hex"),
    };
  });
  return { cases, terms: t.pieces(), summaries: {
    features: Object.fromEntries([...now.index.features.keys()].map((key) => [key, s.feature(key)])),
    scenarios: Object.fromEntries([...now.index.scenarios.keys()].map((key) => [key, s.scenario(key)])),
    cases: Object.fromEntries([...now.index.cases.keys()].map((key) => [key, s.testCase(key)])),
    rules: Object.fromEntries([...now.index.features].map(([key, decls]) => [key, Object.fromEntries(decls[0].file.rules.map((r) => [r.key, r.statement]))])),
  } };
}

// `design walk --dir [--by human:<name>] [--case <key>]`. The name is given once, on the first walk of the Run,
// and kept in the run dir for every triage; another engineer starts a Run of their own.
/**
 * @param {string} dir
 * @param {ImpactPlan} plan
 * @param {unknown} given
 * @param {unknown} key
 * @returns {CommandResult}
 */
export function walk(dir, plan, given, key) {
  const loaded = load(dir, plan);
  if (loaded.refused) return loaded.refused;
  const { laid, state, seen } = loaded;
  if (key !== undefined && !laid.cases.some((c) => c.key === key)) return refuse("case_not_in_walk", { key });
  if (key !== undefined && state.settled[/** @type {string} */ (key)]) return refuse("already_settled", { key });
  if (given !== undefined) {
    if (!HUMAN.test(/** @type {string} */ (given))) return refuse("not_human", { given });
    if (loaded.by !== null && loaded.by !== given) return refuse("name_differs", { stored: loaded.by });
  }
  const root = plan.root;
  const now = current(root);
  const cases = laid.cases.map((e) => view(now, e, state.settled[e.key] ?? null, root));
  const next = /** @type {WalkViewCase | null} */ (cases.find((c) => !c.settled && !c.gone && (key === undefined || c.key === key)) ?? null);
  if (key !== undefined && !next) return refuse("case_gone", { key });
  if (given !== undefined && loaded.by === null) writeFileSync(join(dir, BY), `${JSON.stringify(/** @type {WalkBy} */ ({ by: /** @type {string} */ (given) }), null, 2)}\n`);

  // What the walk showed of each case's findings, so a triage can still name a scan-only finding
  // its fix has made `scan` stop reporting.
  for (const c of cases) if (c.findings) seen[c.key] = [...(seen[c.key] ?? []).filter((f) => !(/** @type {WalkFinding[]} */ (c.findings)).some((g) => g.id === f.id)), ...c.findings];
  writeFileSync(join(dir, SEEN), `${JSON.stringify(seen, null, 2)}\n`);

  /** @type {Map<string, string>} */
  const scenarios = new Map();
  for (const c of cases) if (!c.gone && c.scenario) scenarios.set(c.scenario, c.file);
  /** @type {Summaries} */
  const s = summaries(now.index);
  const scenarioDivergences = /** @type {WalkDivergence[]} */ (now.scan.results.filter((r) => r.kind === "divergence" && scenarios.get(/** @type {string} */ (r.key)) === r.file).map((r) => ({ scenario: keyLabel(/** @type {string} */ (r.key), s.scenario(/** @type {string} */ (r.key))), ...findingData(r, s) })));

  // The case the next decisions answer, its findings in the order they are numbered.
  /** @type {WalkShown} */
  const shown = next ? { case: next.key, findings: next.findings.map(({ id, source, kind }) => ({ id, source, kind })), reject: next.reject, retire: next.retire } : { case: null };
  writeFileSync(join(dir, SHOWN), `${JSON.stringify(shown, null, 2)}\n`);
  /** @type {Terms} */
  const t = terms();
  if (scenarioDivergences.length) t.add("Divergence", "Dismissal", "Mirrored value");
  /** @type {WalkOut} */
  const out = { ok: true, done: !next, train: /** @type {WalkTrain} */ (trainFor(now.index, IMPACT_TRAIN_KEY)), progress: { settled: cases.filter((c) => c.settled).length, total: cases.length }, case: next && (next.feature_finding ? featureData(/** @type {RawCase} */ (next), s, t) : caseData(/** @type {RawCase} */ (next), s, t)), scenario_divergences: scenarioDivergences };
  if (!next) {
    const end = closing(plan, laid, state);
    for (const r of end.merge_rules) t.add(r.rule === "watermark" ? "Watermark" : r.rule === "findings" ? "Finding" : "Review");
    Object.assign(out, end);
  }
  // Design's proposal for the case, beside its choices: data, never an answer.
  const proposal = next && !next.feature_finding ? proposalView(dir, now, next.key) : null;
  if (out.case && proposal) out.case = /** @type {ImpactCaseData} */ ({ ...out.case, proposal });
  return { exit: 0, json: { ...out, glossary: t.pieces() } };
}

// Once nothing is left to settle: everything the persisted run and its walk wrote, and the merge
// rules for it.
/**
 * @param {ImpactPlan} plan
 * @param {WalkLaid} laid
 * @param {WalkState} state
 * @returns {{ changeset: { paths: string[], commit: string | null }, merge_rules: Array<{ rule: string, text: string }> }}
 */
export function closing(plan, laid, state) {
  const paths = [...new Set([...laid.persisted.paths, ...state.written])].sort();
  const scope = plan.feature ? `qa(${plan.feature})` : "qa";
  const message = `${scope}: /qa-design at ${/** @type {string} */ (plan.target.commit).slice(0, 12)}`;
  return {
    changeset: paths.length ? { paths, commit: commitLine(paths, message) } : { paths: [], commit: null },
    merge_rules: mergeRules(ordered([...laid.persisted.merge, ...state.merge])),
  };
}

// `design triage --dir [--case <key>]`: the case the walk showed, checked against the expected key
// when given, and settled by the JSON decisions `text`
// (lib/impact-json.mjs `decisionsOf`), validated against the case's numbered findings, then checked
// against `.qa/` (`decide`), rendered (`rewrite`), and every file passes `check-file` before any is
// written. Every refusal writes nothing.
/**
 * @param {string} dir
 * @param {ImpactPlan} plan
 * @param {string} text
 * @param {unknown} expected
 * @returns {CommandResult}
 */
export function triage(dir, plan, text, expected) {
  const loaded = load(dir, plan);
  if (loaded.refused) return loaded.refused;
  const root = plan.root;
  const summary = () => /** @type {Summaries} */ (summaries(buildIndex(loadWorkingTree(root))));
  // A refusal as a code and one factual line, with a label for the case or the keys it names.
  /**
   * @param {WalkRefusal[]} refusals
   * @param {Summaries} [s]
   * @returns {CommandResult}
   */
  const refused = (refusals, s = summary()) => ({
    exit: 1,
    json: { ok: false, refusals: refusals.map(({ rests, ...r }) => refusalOf({ ...r, ...(r.key && { label: keyLabel(r.key, s.testCase(r.key)) }), ...(rests && { rests: rests.map((x) => ({ ...x, label: findingLabel(x.key, s) })) }), ...(r.kind && { term: KIND[r.kind] }) })) },
  });
  const { state, shown, by } = loaded;
  if (by === null) return refused([{ code: "no_name" }]);
  if (!shown?.case) return refused([{ code: "no_case" }]);
  const key = shown.case;
  if (expected !== undefined && expected !== key) return refused([{ code: "case_mismatch", expected, shown: key }]);
  if (state.settled[key]) return refused([{ code: "already_settled", key }]);
  const read = decisionsOf(text, shown);
  if (read.errors.length) return refused(/** @type {WalkRefusal[]} */ (read.errors));
  const input = { case: key, review: read.review, by, findings: /** @type {DecisionFinding[]} */ (read.findings) };

  const d = decide(plan, loaded, input);
  if (d.refused) return refused([d.refused], d.now ? /** @type {Summaries} */ (summaries(d.now.index)) : summary());
  /** @type {Summaries} */
  const s = summaries(d.now.index);
  const r = rewrite(plan, input, d);
  if (r.refused) return refused([r.refused], s);
  /** @type {Array<{ file: string, line: number | undefined, message: string }>} */
  const errors = [];
  const config = rootConfig(root);
  for (const [rel, t] of r.edits) {
    const checked = /** @type {{ errors: Array<{ line?: number, message: string }> }} */ (checkFile(parse(rel, t), config));
    errors.push(...checked.errors.map((x) => ({ file: `${d.repo.prefix}${rel}`, line: x.line, message: x.message })));
  }
  if (errors.length) return refused([{ code: "check_file", errors }], s);
  // Every file or none: a failure partway leaves `.qa/` as it was (and, as ever, throws).
  const written = /** @type {{ error?: string }} */ (writeAll(root, backfillChangeset(root, root, { writes: [...r.edits].map(([path, text]) => ({ path, text })) })));
  if (written.error) throw new Error(`design triage: ${written.error}`);

  // Then the Run's own record of what it settled and wrote.
  /**
   * @param {string} rel
   * @returns {string}
   */
  const repoPath = (rel) => `${d.repo.prefix}${rel}`;
  const paths = [...r.edits.keys()].map(repoPath).sort();
  state.settled[key] = { finding: d.decisions.map((x) => ({ id: x.f.id, kind: x.f.kind, finding: x.g.finding })), review: input.review, at: new Date().toISOString() };
  state.written = [...new Set([...state.written, ...paths, ...d.fixed.map(repoPath)])].sort();
  state.merge = [...new Set([...state.merge, ...r.merge])];
  writeFileSync(join(dir, STATE), `${JSON.stringify(state, null, 2)}\n`);

  /** @type {Terms} */
  const t = terms();
  t.add("Finding", ...d.decisions.map((x) => KIND[x.f.kind]), ...(input.review === "accept" ? ["Review"] : input.review === "reject" || input.review === "retire" ? ["Retired key"] : []), ...(d.decisions.some((x) => x.g.answer === "dismiss") ? ["Dismissal"] : []));
  const settled = { key, label: keyLabel(key, d.target.summary), findings: d.decisions.map((x) => ({ n: x.g.n, kind: KIND[x.f.kind], answer: x.g.answer })), review: input.review, by, written: paths, merge_rules: mergeRules(ordered(r.merge)), ...(r.retirement && { retirement: r.retirement }) };
  if (r.retirement) t.add("Automation", "Tracker key");
  return { exit: 0, json: { ok: true, settled, glossary: t.pieces() } };
}

// Whether the decision can be written as given: `{refused: {code, ...data}, now?}`, or what
// `rewrite` needs. Each finding the walk numbered has one answer; a
// Dismissal and a Review stamp pin HEAD, which must hold what they attest; a fix must have changed
// something the finding rests on.
/**
 * @param {ImpactPlan} plan
 * @param {{ seen: WalkSeen, laid: WalkLaid }} loaded
 * @param {WalkInput} input
 * @returns {WalkDecisionOut}
 */
function decide(plan, loaded, input) {
  const key = input.case;
  const root = plan.root;
  const now = current(root);
  /**
   * @param {string} code
   * @param {Partial<WalkRefusal>} [data]
   * @returns {{ refused: WalkRefusal, now: WalkNow }}
   */
  const no = (code, data = {}) => ({ refused: { code, ...data }, now });
  const item = loaded.laid.cases.find((c) => c.key === key);
  const target = item ? targetOf(now, item, root) : null;
  if (!target) return { refused: { code: "case_gone", key } };
  const here = target;
  if (input.review === "reject" && !target.feature_finding && !rejectable(now, key)) return no("reject_keyed");
  if (input.review === "retire" && !target.feature_finding && rejectable(now, key)) return no("retire_unkeyed");
  const list = target.list;
  const resolved = pinsResolved(root, list);
  const offered = target.offered;
  const seen = loaded.seen[key] ?? [];

  // Each numbered finding as it stands now: still offered, or a scan-only one the walk showed and
  // `scan` has stopped reporting. One that is neither, or an offered one the walk never numbered,
  // means the case changed since the walk showed it.
  /** @type {WalkDecision[]} */
  const decisions = [];
  for (const g of input.findings) {
    const f = offered.find((x) => x.id === g.id) ?? seen.find((x) => x.id === g.id && x.source === "scan");
    if (!f) return no("case_changed", { key });
    decisions.push({ f, g, reported: offered.some((x) => x.id === f.id) });
  }
  if (input.review !== "reject" && input.review !== "retire" && offered.some((f) => !decisions.some((x) => x.f.id === f.id))) return no("case_changed", { key });
  const fixes = decisions.filter((x) => x.g.finding === "fix");
  // A scan-only finding the walk showed but `scan` no longer reports is settled only as fixed.
  for (const x of decisions) if (!x.reported && x.g.finding !== "fix") return no("no_longer_reported", { n: x.g.n, kind: x.f.kind });

  // What HEAD holds, to pin to and to tell a fix from no change.
  const repo = repositoryOf(root);
  const head = repo && resolveRef(repo.top, "HEAD");
  if (!head) return no("no_head");
  const headFiles = /** @type {WalkFile[]} */ (loadQaAt(repo, head));
  const project = now.files.find((f) => f.type === "project")?.data;
  const atHead = knowledge(headFiles, project);
  const atNow = knowledge(now.files, project);
  // A version the level rewrite cannot migrate would differ from the migrated tree in level alone.
  const unmigrated = [...atHead.errors, ...atNow.errors];
  if (unmigrated.length) return no("level_rewrite_failed", { errors: unmigrated });
  const feature = target.feature;
  /**
   * @param {[string, string]} rest
   * @returns {string | undefined}
   */
  const fileOf = ([k, what]) => (what === "case" ? now.index.cases.get(k)?.[0]?.file.rel : now.index.features.get(what === "rule" ? parseRuleRef(k)?.feature ?? feature : feature)?.[0]?.file.rel);
  /**
   * @param {Array<[string, string]>} rests
   * @returns {Array<{ key: string, file: string }>}
   */
  const placed = (rests) => rests.map((x) => ({ key: x[0], file: `${repo.prefix}${fileOf(x)}` }));
  /**
   * @param {WalkFinding} f
   * @returns {Array<[string, string]>}
   */
  const movedOf = (f) => movedFrom(atHead, f);
  /**
   * What a finding rests on that differs now from `base`.
   * @param {WalkKnowledge} base
   * @param {WalkFinding} f
   * @returns {Array<[string, string]>}
   */
  function movedFrom(base, f) {
    return here.rests(f).filter(([k, what]) => (what === "rule" ? base.rule(feature, k) !== atNow.rule(feature, k) : what === "boundary" ? base.boundary(feature, k) !== atNow.boundary(feature, k) : base.cases.get(k) !== atNow.cases.get(k)));
  }
  // A fix is judged against the text the finding was raised on: its pin, when it resolves, else HEAD.
  // A fix the engineer has already committed differs from the pin though not from HEAD.
  /** @type {Map<string, WalkKnowledge>} */
  const atPin = new Map();
  /**
   * @param {WalkFinding} f
   * @returns {{ moved: Array<[string, string]>, errors: import("./migration-plan.mjs").LevelMigrationError[] }}
   */
  const movedSincePin = (f) => {
    const pin = f.source === "stored" ? resolved.get(/** @type {string | null} */ (f.at_commit ?? null)) : null;
    if (!pin || pin === head) return { moved: movedOf(f), errors: [] };
    if (!atPin.has(pin)) atPin.set(pin, knowledge(/** @type {WalkFile[]} */ (loadQaAt(repo, pin)), project));
    const base = /** @type {WalkKnowledge} */ (atPin.get(pin));
    return { moved: base.errors.length ? [] : movedFrom(base, f), errors: base.errors };
  };
  if (input.review === "accept" && atHead.cases.get(key) !== atNow.cases.get(key)) return no("uncommitted_review", { key });
  // The files each fix changed, for the walk's changeset.
  /** @type {Set<string>} */
  const fixed = new Set();
  const headText = new Map(headFiles.map((f) => [f.rel, f.text]));
  for (const x of decisions) {
    const moved = movedOf(x.f);
    if (x.g.finding === "dismiss" && moved.length) return no("uncommitted_dismissal", { n: x.g.n, rests: placed(moved) });
    if (x.g.finding === "holds" && moved.length) return no("uncommitted_holds", { n: x.g.n, rests: placed(moved) });
    if (x.g.finding !== "fix") continue;
    const sincePin = x.f.source === "stored" ? movedSincePin(x.f) : null;
    if (sincePin?.errors.length) return no("level_rewrite_failed", { errors: sincePin.errors });
    if (sincePin && !sincePin.moved.length) return no("not_fixed", { n: x.g.n, kind: x.f.kind, rests: placed(target.rests(x.f)) });
    if (x.f.source === "scan" && x.reported) return no("not_fixed_scan", { n: x.g.n, kind: x.f.kind, rests: placed(target.rests(x.f)) });
    for (const rel of moved.map(fileOf)) if (rel) fixed.add(rel);
    if (headText.get(target.file) !== target.text) fixed.add(target.file);
  }
  return { now, target, list, resolved, offered, decisions, fixes, repo: /** @type {WalkRepo} */ (repo), head, fixed: [...fixed] };
}

// What the walk settles, as the working tree holds it now: a Test Case's findings, or a Feature's
// own findings (ADR-0039).
/**
 * @param {WalkNow} now
 * @param {WalkCase} e
 * @param {string} root
 * @returns {WalkTarget | null}
 */
function targetOf(now, e, root) {
  if (e.feature_finding) {
    const decl = now.index.features.get(e.feature)?.[0];
    if (!decl) return null;
    const list = featureFindingsOf(decl.file);
    return {
      feature: e.feature, file: decl.file.rel, key: e.key, feature_finding: true, list,
      summary: decl.file.h1?.text ?? "", text: decl.file.text, case_decl: null,
      offered: openFeatureFindings(list, pinsResolved(root, list)),
      rests: (f) => featureRestsOn(f),
    };
  }
  const decl = now.index.cases.get(e.key)?.[0];
  if (!decl) return null;
  const list = findingsOf(decl.entry);
  return {
    feature: decl.feature, file: decl.file.rel, key: e.key, feature_finding: false, list,
    summary: decl.entry.summary, text: decl.file.text, case_decl: decl,
    offered: openFindings(now, decl, pinsResolved(root, list)),
    rests: (f) => caseRestsOn(decl, f, now),
  };
}

// What a Feature-level finding rests on, as `[key, "rule" | "boundary"]`: the Rule it is about and
// the Boundary it crosses (ADR-0039).
/**
 * @param {WalkFinding} f
 * @returns {Array<[string, string]>}
 */
function featureRestsOn(f) {
  /** @type {Array<[string, string]>} */
  const out = [];
  if (f.rule !== undefined) out.push([f.rule, "rule"]);
  if (f.rests_on !== undefined) out.push([f.rests_on, "boundary"]);
  return out;
}

// The decision as file edits (`.qa/` rel → text) and the merge rules they bring in, or
// `{refused}`.
/**
 * @param {ImpactPlan} plan
 * @param {WalkInput} input
 * @param {{ now: WalkNow, target: WalkTarget, list: WalkFindingData[], resolved: Map<string | null, string | null>, decisions: WalkDecision[], fixes: WalkDecision[], head: string }} decided
 * @returns {{ edits: Map<string, string>, merge: string[], retirement?: WalkRetirement, refused?: never } | { refused: WalkRefusal, edits?: never, merge?: never, retirement?: never }}
 */
function rewrite(plan, input, { now, target, list, resolved, decisions, fixes, head }) {
  const root = plan.root;
  const T = plan.target.commit;
  const today = localDate();
  /**
   * @param {DecisionFinding} g
   * @returns {WalkStamp}
   */
  const stamp = (g) => ({ by: input.by, at: today, commit: head, ...(g.reason !== undefined && { reason: g.reason }), ...(g.ticket !== undefined && { ticket: g.ticket }) });
  // A pin moved to T drops the digest of its old commit; the write backfills T's.
  /**
   * @param {WalkFindingData} x
   * @returns {WalkFindingData}
   */
  const repin = (x) => {
    if (resolved.get(written(x.at_commit))) return x;
    const { at_digest: _, ...rest } = x;
    return { ...rest, at_commit: T };
  };
  const after = [...list];
  /** @type {Set<number>} */
  const drop = new Set();
  for (const { f, g } of decisions) {
    if (f.source === "stored") {
      const x = after[/** @type {number} */ (f.index)];
      // A mechanical Stale the engineer fixed stays on the case, closed, until checkpoint 2 prunes it:
      // dropped now, the same change at the same baseline would owe the case a new one when a resumed
      // run plans again. A judge's Stale (no structured cause) has nothing to be re-raised from.
      if (g.finding === "fix" && isStaleObligation(x)) after[/** @type {number} */ (f.index)] = withHolds(repin(x), { by: input.by, at: today, commit: head });
      else if (g.finding === "fix") drop.add(/** @type {number} */ (f.index));
      else if (g.finding === "keep_open") after[/** @type {number} */ (f.index)] = repin(x);
      else if (g.finding === "holds") after[/** @type {number} */ (f.index)] = withHolds(repin(x), { by: input.by, at: today, commit: head });
      else after[/** @type {number} */ (f.index)] = withDismissal(repin(x), stamp(g));
    } else if (g.finding === "dismiss") {
      // A stored Dismissal of the same result (re-armed) is renewed rather than doubled.
      const i = after.findIndex((x) => isMap(x) && isMap(x.dismissed) && x.kind === f.kind && (f.kind === "OutcomeGap" || x.evidence === f.evidence));
      if (i === -1) after.push({ kind: f.kind, at_commit: T, evidence: f.evidence, dismissed: stamp(g) });
      else after[i] = withDismissal(repin(after[i]), stamp(g));
    }
  }
  const findings = after.filter((_, i) => !drop.has(i));
  /** @type {Map<string, string>} */
  const edits = new Map();
  /** @type {string[]} */
  const merge = [];
  const rel = target.file;
  const text = readFileSync(join(root, rel), "utf8");
  // A Feature's own findings (ADR-0039): the Dismissal is written on the finding in the Feature
  // file's `finding` list. A Feature has no Review and is never rejected.
  if (target.feature_finding) {
    const changed = !isDeepStrictEqual(findings, list);
    if (changed) edits.set(rel, textWith(rel, text, [{ set: { finding: findings } }]));
    if (changed) merge.push("findings");
    return { edits, merge };
  }
  const decl = target.case_decl;
  if (!decl) return { refused: { code: "case_gone", key: target.key } };
  if (input.review === "reject" || input.review === "retire") {
    edits.set(rel, textWith(rel, text, [{ remove: decl.entry.key }]));
    const featureFile = now.index.features.get(decl.feature)?.[0]?.file;
    if (!featureFile) return { refused: { code: "no_feature_file", key: decl.entry.key } };
    const tombstones = tombstonesOf(decl.entry.key, decl.entry.data);
    // A retired case keeps its current Tracker key retired too, and the tracker repair waits on the
    // Feature for `/qa-publish`: nothing here writes the tracker (ADR-0027).
    const tracker = input.review === "retire" ? now.index.tracker.current("case", decl.entry.key) : null;
    if (tracker) tombstones.push(trackerReference(tracker));
    /** @type {Record<string, unknown>} */
    const set = { retired: retiredWith(featureFile.data.retired, tombstones) };
    /** @type {WalkRepair | undefined} */
    const repair = tracker ? { kind: "retire", tracker } : undefined;
    if (repair) {
      const pending = /** @type {WalkRepair[]} */ (Array.isArray(featureFile.data.repairs) ? featureFile.data.repairs : []);
      const kept = pending.filter((x) => !(x.kind === "remark" && x.key === decl.entry.key));
      set.repairs = kept.some((x) => x.kind === "retire" && x.tracker === tracker) ? kept : [...kept, repair];
    }
    edits.set(featureFile.rel, textWith(featureFile.rel, readFileSync(join(root, featureFile.rel), "utf8"), [{ set }]));
    if (!repair) return { edits, merge };
    // The Automation consequences: the keys the case named, and those no remaining case names.
    const named = strings(decl.entry.data.automates);
    const others = new Set([...now.index.cases].filter(([k]) => k !== decl.entry.key).flatMap(([, ds]) => ds.flatMap((d) => strings(d.entry.data.automates))));
    return { edits, merge, retirement: { retired: tombstones, repair, automation: { keys: named, unlinked: named.filter((k) => !others.has(k)) } } };
  }
  if (!decl.entry.blockLine) return { refused: { code: "no_block", key: decl.entry.key } };
  const changed = !isDeepStrictEqual(findings, list);
  const review = input.review === "accept" ? { set: { by: input.by, at: today, commit: head } } : fixes.length && isMap(decl.entry.data.review) ? { set: null } : null;
  const overdue = input.review === "accept" && now.scan.results.some((r) => r.kind === "review_overdue" && r.key === decl.entry.key && r.file === rel);
  const set = { ...(changed && { finding: findings }), ...(review && { review: review.set ?? undefined }), ...(overdue && { review_by: undefined }) };
  if (changed || review) edits.set(rel, textWith(rel, text, [{ at: decl.entry.key, set }]));
  if (changed) merge.push("findings");
  if (review) merge.push("review");
  return { edits, merge };
}

// The file at `rel` with `changes` made (lib/knowledge-file.mjs `edit`), as its new text. A file
// `edit` cannot read is kept as it is, for its check to refuse. Any other refusal is a fault in the
// framework: every value the walk writes is its own, or a decision value `decisionsOf` has
// already held to one line with no `"` or backslash.
/**
 * @param {string} rel
 * @param {string} text
 * @param {WalkChange[]} changes
 * @returns {string}
 */
export function textWith(rel, text, changes) {
  const r = /** @type {WalkEdit} */ (edit(parse(rel, text), changes));
  if (r.ok || r.unreadable) return r.text;
  throw new Error(`design triage: ${r.message}`);
}

// A finding with its Dismissal, keys in the schema's order.
/**
 * @param {WalkFindingData} x
 * @param {WalkStamp} dismissed
 * @returns {WalkFindingData}
 */
function withDismissal(x, dismissed) {
  const { dismissed: _, ...rest } = x;
  return { ...rest, dismissed };
}

// A Stale with the engineer's `holds` stamp: the case is still right after the change, so the cause
// is closed. The entry stays, so a rescan of the same change finds it stored.
/**
 * @param {WalkFindingData} x
 * @param {WalkStamp} holds
 * @returns {WalkFindingData}
 */
function withHolds(x, holds) {
  const { dismissed: _, holds: __, ...rest } = x;
  return { ...rest, holds };
}

// Stripped knowledge by Key: each case's entry, and each Feature's Rules and Boundaries.
/**
 * @param {WalkFile[]} files
 * @param {Record<string, unknown>} [project]
 * @returns {WalkKnowledge}
 */
export function knowledge(files, project) {
  const source = files.find((f) => f.type === "project")?.data;
  /** @type {import("./migration-plan.mjs").LevelMigrationError[]} */
  let errors = [];
  if (project && typeof project.schema_version === "number" && project.schema_version >= LEVEL_ON_CASE_SCHEMA_VERSION && (source?.schema_version ?? 1) < LEVEL_ON_CASE_SCHEMA_VERSION) {
    ({ files, errors } = levelMigrationFiles(/** @type {import("./knowledge-file.mjs").ParsedFile[]} */ (files), recordedLevelMappings(project)));
  }
  /** @type {Map<string, string>} */
  const cases = new Map();
  /** @type {Map<string, Map<string, string>>} */
  const rules = new Map();
  /** @type {Map<string, Map<string, string>>} */
  const boundaries = new Map();
  for (const f of files) {
    if (f.unreadable) continue;
    const s = /** @type {WalkStripped} */ (claimProjection(f));
    if (f.type === "scenario") for (const [k, t] of s.cases) if (!cases.has(k)) cases.set(k, t);
    if (f.type === "feature" && typeof f.data.key === "string") {
      if (!rules.has(f.data.key)) rules.set(f.data.key, s.rules);
      if (!boundaries.has(f.data.key)) boundaries.set(f.data.key, s.boundaries);
    }
  }
  const index = buildIndex(files);
  return { cases, rule: (feature, k) => {
    const ref = parseRuleRef(k);
    if (ref === null) return rules.get(feature)?.get(k) ?? null;
    const resolved = resolveRuleRef(index, /** @type {import("./knowledge-file.mjs").ParsedFile[]} */ (files), ref);
    return resolved.status === "live" ? rules.get(resolved.feature)?.get(resolved.rule) ?? null : null;
  }, boundary: (feature, k) => boundaries.get(feature)?.get(k) ?? null, errors };
}

// The Rules a case's setup relies on, as written (local keys or `<feature>/<rule>`).
/**
 * @param {WalkCaseDecl} decl
 * @returns {string[]}
 */
export const reliesOn = (decl) => relianceOf(/** @type {import("./knowledge-file.mjs").CaseEntry} */ (/** @type {unknown} */ (decl.entry)), decl.feature).refs.map((r) => r.text);

// What a finding rests on, as `[key, "case" | "rule" | "boundary"]` (exported so a test can hold it
// equal to the Dismissal rule list of `scan` and the pin digest): its case; for a judged or
// Divergence finding also the Rules its evidence names, its case covers and its setup relies on (as
// `scan`'s Dismissal re-arm reads them), and any other case its evidence names. An Outcome gap rests on its case
// alone. An Overreach rests on the Rule or the Boundary it crosses.
/**
 * @param {WalkCaseDecl} decl
 * @param {WalkFinding} f
 * @param {WalkNow} now
 * @returns {Array<[string, string]>}
 */
export function caseRestsOn(decl, f, now) {
  const out = /** @type {Array<[string, string]>} */ ([[decl.entry.key, "case"]]);
  if (f.kind === "OutcomeGap") return out;
  const evidence = String(f.evidence ?? "");
  const covers = Array.isArray(decl.entry.data.covers) ? decl.entry.data.covers.filter((k) => typeof k === "string") : [];
  for (const r of new Set([...ruleRefsIn(evidence), ...covers, ...reliesOn(decl), ...causeRefs(f)])) out.push([r, "rule"]);
  const { boundary } = restsOn(f);
  if (f.rests_on !== undefined) out.push([f.rests_on, boundary !== null ? "boundary" : "rule"]);
  for (const k of now.index.cases.keys()) {
    if (k !== decl.entry.key && new RegExp(`(?<![0-9A-Za-z_-])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9A-Za-z_-])`).test(evidence)) out.push([k, "case"]);
  }
  return out;
}

// ---- The actions ----

// The plan a settle action reads: the run dir `impact plan` made, which holds the walk `impact
// persist` laid out. `/qa-design` settles the same run dir, so both commands open it alike.
/**
 * @param {string} action
 * @param {string[]} args
 * @param {string | undefined} dir
 * @returns {({ dir: string, plan: ImpactPlan, refused?: never }) | ({ refused: RefusalResult, dir?: never, plan?: never })}
 */
export function readSettlePlan(action, args, dir) {
  if (args.length) return { refused: refuse("bad_arguments", { action }) };
  const opened = openPlan("impact", action, args, dir);
  return opened.error ? { refused: refuse("run_dir", { reason: opened.error }) } : /** @type {{ dir: string, plan: ImpactPlan }} */ (opened);
}

/** @type {OptionSpec} */
const RUN_DIR = { dir: "value" };

// The walk, triage, page and page-reply actions, the same on every command that settles (`impact`,
// `design`): each opens its run dir through `readSettlePlan` and calls the engine above.
/** @type {Record<string, CommandAction>} */
export const SETTLE_ACTIONS = {
  // The triage walk: where it stands, and the next case to settle. `by` is the name the walk's
  // stamps carry, given once and kept in the run dir.
  walk: {
    options: { dir: "value", by: "value", case: "value" },
    usage: "--dir <run-dir> [--by human:<name>] [--case <key>]",
    run(args, { by, case: key, ...options }) {
      const { dir, plan, refused } = readSettlePlan("walk", args, options.dir);
      return refused ?? walk(dir, plan, by, key);
    },
  },

  // One case settled: the engineer's decisions are JSON on stdin.
  triage: {
    options: { ...RUN_DIR, stdin: "flag", case: "value" },
    usage: "--dir <run-dir> --stdin [--case <key>]",
    run(args, { stdin, case: expected, ...options }) {
      const { dir, plan, refused } = readSettlePlan("triage", args, options.dir);
      if (refused) return refused;
      const newer = refuseUnreadSchema(plan.root, ANY_SCHEMA_VERSION);
      if (newer) return newer;
      if (!stdin) return refuse("needs_stdin");
      return triage(dir, plan, stdin(), expected);
    },
  },
  // Checkpoint 2: the Watermark advances once the walk is settled and committed.
  checkpoint: {
    options: RUN_DIR,
    usage: "--dir <run-dir>",
    run(args, options) {
      const { dir, plan, refused } = readSettlePlan("checkpoint", args, options.dir);
      if (refused) return refused;
      const newer = refuseUnreadSchema(plan.root, ANY_SCHEMA_VERSION);
      return newer ?? checkpoint(dir, plan);
    },
  },
  // A Rule fix on the walk: the Rule-edit transition, then the settled causes resting on it reopened.
  "rule-fix": {
    options: { ...RUN_DIR, stdin: "flag" },
    usage: "<feature> --dir <run-dir> --stdin",
    run(args, { stdin, ...options }) {
      const opened = openPlan("impact", "rule-fix", [], options.dir);
      if (opened.error) return refuse("run_dir", { reason: opened.error });
      const plan = /** @type {ImpactPlan} */ (opened.plan);
      const newer = refuseUnreadSchema(plan.root, ANY_SCHEMA_VERSION);
      if (newer) return newer;
      if (!stdin) return refuse("needs_stdin");
      return ruleFix(/** @type {string} */ (opened.dir), plan, args, stdin());
    },
  },
  page: {
    options: { ...RUN_DIR, stdin: "flag" },
    usage: "--dir <run-dir> [--stdin]",
    run(args, { stdin, ...options }) {
      const { dir, plan, refused } = readSettlePlan("page", args, options.dir);
      return refused ?? page(dir, plan, stdin?.());
    },
  },
  "page-reply": {
    options: { ...RUN_DIR, stdin: "flag" },
    usage: "--dir <run-dir> --stdin",
    run(args, { stdin, ...options }) {
      const { dir, plan, refused } = readSettlePlan("page-reply", args, options.dir);
      if (refused) return refused;
      if (!stdin) return refuse("needs_stdin");
      return pageReply(dir, plan, stdin());
    },
  },
};

// The actions only `/qa-design` takes: design's proposals, and the links the engineer confirms.
/** @type {Record<string, CommandAction>} */
export const DESIGN_SETTLE_ACTIONS = {
  propose: {
    options: { ...RUN_DIR, stdin: "flag" },
    usage: "--dir <run-dir> --stdin",
    run(args, { stdin, ...options }) {
      const { dir, plan, refused } = readSettlePlan("propose", args, options.dir);
      if (refused) return refused;
      if (!stdin) return refuse("needs_stdin");
      return propose(dir, plan, stdin());
    },
  },
  link: {
    options: { ...RUN_DIR, stdin: "flag", case: "value" },
    usage: "--dir <run-dir> --case <key> --stdin",
    run(args, { stdin, case: key, ...options }) {
      const { dir, plan, refused } = readSettlePlan("link", args, options.dir);
      if (refused) return refused;
      const newer = refuseUnreadSchema(plan.root, ANY_SCHEMA_VERSION);
      if (newer) return newer;
      if (!stdin) return refuse("needs_stdin");
      return link(dir, plan, key, stdin());
    },
  },
};
