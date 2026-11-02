// @ts-check
// `impact`: the deterministic half of change impact's judge step, which `/qa-impact` and
// `/qa-design` both run (read-only unless `--persist`). The skill dispatches each judge unit and saves its reply. `plan` and `report` read
// `.qa/` and never write knowledge; what they write goes to the run directory, in the OS temp dir
// by default. Only `persist` writes knowledge.
//
//   plan [<feature>]   runs `scan` before any dispatch and lays out the run: the Features in scope
//                      with their candidate class, one judge unit per non-empty, parseable scenario
//                      file of each judged Feature (its brief written to the run directory), the
//                      empty and excluded files, and the mechanical Scans. Writes `plan.json`,
//                      each unit's brief and the units for the delegation layer to the run dir.
//   report             reads the plan back, checks each unit's reply with `check-reply judge`, and
//                      assembles the four printed sections, Scope, Judgements, Scans and Run
//                      health (with the Run's dispatch, when units were dispatched), then the
//                      changeset, as the data the skill words (lib/impact-json.mjs). Judgements
//                      also list the open Stales the run carries and count the dismissed findings.
//   persist            a plan made with `--persist`, which refuses a `.qa/` holding
//                      uncommitted knowledge and pins the run to a commit (`--target`'s, else
//                      HEAD's): checks that again, then writes what the report settles case by
//                      case (lib/impact-persist.mjs) and advances each complete Feature's
//                      Watermark, before any triage walk begins. Prints the report, with the
//                      Watermarks under Run health, the knowledge files in the changeset, and
//                      `walk`, where the triage walk begins. It lays the walk out.
//   entry, quick,      `/qa-impact`'s quick path around the judge step (lib/impact-entry.mjs,
//   quick-check,       lib/quick-path.mjs, lib/change-escalate.mjs).
//   escalate
//
// The triage walk that follows a persist is `design walk` and `design triage`, whichever command
// settles (lib/settle-walk.mjs).
//
// The run directory, per unit `<key>`:
//   plan.json           the plan, as printed
//   dispatch.spec.json  the units, as `delegate start` takes them (lib/delegation.mjs)
//   <key>.brief.json    `brief judge <key>`'s JSON, which `check-reply judge --brief` takes
//   <key>.brief.md      the brief text alone, byte for byte, which the Delegate is given
//   <key>.reply.md      the usable reply the delegation layer left (else the last one it got);
//                       absent = no reply
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { brief } from "./brief.mjs";
import { readChange } from "./change-data.mjs";
import { enter } from "./impact-entry.mjs";
import { unforecastRules } from "./forecast-guard.mjs";
import { checkQuick, openQuick } from "./quick-path.mjs";
import { escalate } from "./change-escalate.mjs";
import { isJudged, selectCases } from "./selection.mjs";
import { summaries } from "./labels.mjs";
import { commitLine } from "./changeset.mjs";
import { checkReply } from "./check-reply.mjs";
import { featureUnitId } from "./dispatch.mjs";
import { readDispatch } from "./delegation.mjs";
import { loadQaTree, repositoryOf, resolveRef } from "./git-tree.mjs";
import { settleFindings, writeFindings } from "./impact-persist.mjs";
import { refuse, reportData } from "./impact-json.mjs";
import { layOut, walkCases } from "./settle-walk.mjs";
import { PATTERN } from "./keys.mjs";
import { projectConfig } from "./knowledge-file.mjs";
import { buildIndex } from "./qa-index.mjs";
import { newRunDir, openPlan } from "./run-dir.mjs";
import { scan } from "./scan.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { ANY_SCHEMA_VERSION, IMPACT_TRAIN_KEY } from "./schema.mjs";
import { resolveAdapter } from "./stack.mjs";
import { trainFor } from "./training.mjs";
/** @import { OpenPlanResult } from "./run-dir.mjs" */

/** @import {CommandAction, CommandDefinition, CommandContext, CommandResult, OptionSpec} from "./cli.mjs" */
/** @import {DispatchSpec} from "./dispatch.mjs" */
/** @import {JudgeBoundary} from "./judge-prompt.mjs" */
/** @import {JudgeOverreach, JudgeProblem, JudgeResult, JudgeVerdict} from "./check-reply.mjs" */
/** @import {RefusalResult} from "./refusal.mjs" */
/** @import {GatheredCarried, GatheredJudgement, GatheredOverreach, GatheredPersistedFeature, GatheredWatermark, ImpactDismissed, ImpactReport, ImpactReportGathered, RunNote} from "./impact-json.mjs" */
/** @import { QaFile } from "./knowledge-file.mjs" */
/** @import { ScanOutput } from "./scan.mjs" */
/** @import { KeyIndex } from "./qa-index.mjs" */
/** @import { SettledFeature } from "./impact-persist.mjs" */

/**
 * The changed Test Cases a judge unit was given, as the brief's JSON carries them.
 * @typedef {object} ChangedCaseFacts
 * @property {string[]} keys
 * @property {boolean} included
 * @property {boolean} degraded
 * @property {number} bytes
 * @property {number} cap
 */

/**
 * The colliding Test Cases of other scenario files a judge unit was given as read-only context, as
 * the brief's JSON carries them: `dropped` when the cap left them out (the changed cases and the
 * context share it, and the context goes first), with `bytes` the context section's size.
 * @typedef {object} ContextCaseFacts
 * @property {string[]} keys
 * @property {boolean} included
 * @property {boolean} dropped
 * @property {number} bytes
 * @property {number} cap
 */

/**
 * The judge brief contract (`<key>.brief.json`): what `brief judge` prints, with the
 * `mode` the run writes it under. `impact` writes it and reads it back; `contracts` and
 * `check-reply` read it.
 * @typedef {object} JudgeBrief
 * @property {"brief"} mode
 * @property {true} ok
 * @property {"judge"} unit
 * @property {"scenario" | "feature"} kind - what the unit judges: a scenario file's cases, or a
 *   Feature's Rules against its Boundaries (ADR-0039)
 * @property {string} feature
 * @property {string | null} scenario - the scenario key; null for a Feature-level unit
 * @property {string} file
 * @property {{ ref: string | null, commit: string | null }} target
 * @property {string} class
 * @property {boolean} first_judgement
 * @property {string | null} watermark
 * @property {string[]} keys
 * @property {string[]} rules_in_full
 * @property {JudgeBoundary[]} boundaries
 * @property {Record<string, string>} [case_text] - each case's text, as the judge sees it
 * @property {Record<string, string>} [context_text] - each context case's text, as the judge sees
 *   it: a colliding case of another scenario file, a side a Conflict may name and never a case judged
 * @property {Record<string, string>} [rule_text] - each Rule the unit shows, as the judge sees it
 * @property {import("./brief.mjs").UpstreamRule[]} [upstream_rules] - current Upstream Rules and history
 * @property {ChangedCaseFacts} [changed_cases]
 * @property {ContextCaseFacts} [context_cases]
 * @property {string} [message]
 * @property {number} brief_bytes
 * @property {string} brief
 */

/**
 * The judge brief as `brief judge` prints it, without the `mode` the run writes it under.
 * @typedef {Omit<JudgeBrief, "mode">} JudgeBriefJson
 */

/**
 * One judge unit of the run, as the plan lays it out.
 * @typedef {object} ImpactPlanUnit
 * @property {"scenario" | "feature"} kind - what the unit judges: a scenario file's Test Cases, or
 *   a Feature's Rules against its Boundaries (ADR-0039)
 * @property {string} feature
 * @property {string | null} scenario - the scenario key; null for a Feature-level unit
 * @property {string} file
 * @property {number} cases
 * @property {string[]} [rules] - the candidate Rules of a Feature-level unit
 * @property {boolean} first_judgement
 * @property {number} brief_bytes
 * @property {string} brief
 * @property {string} brief_json
 * @property {string} reply
 */

/**
 * A scenario file of a judged Feature, as the plan lays it out.
 * @typedef {object} ScenarioEntry
 * @property {string | null} scenario
 * @property {string} file
 * @property {number} cases
 * @property {string} status - `unit`, `empty`, `unselected` (a scenario file no case of which the change selects) or `excluded`
 * @property {string[]} [selected] - the case keys of a `unit` the change selects
 * @property {string} [reason]
 * @property {Array<Record<string, unknown>>} [problems]
 */

/**
 * A Feature of the run's scope, as the plan lays it out.
 * @typedef {object} ImpactPlanFeature
 * @property {string} feature
 * @property {string} file
 * @property {string} class
 * @property {boolean} judged
 * @property {string | null} watermark
 * @property {string} [reason]
 * @property {string} [why]
 * @property {Array<Record<string, unknown>>} [problems]
 * @property {boolean} [first_judgement]
 * @property {ScenarioEntry[]} [scenarios]
 * @property {string[]} [rules] - the candidate Rules of the Feature-level judge unit (ADR-0039)
 */

/**
 * The Features of the run's scope.
 * @typedef {object} ImpactPlanScope
 * @property {ImpactPlanFeature[]} features
 */

/**
 * The oldest mirrored value of a Feature, as the scan gathers it.
 * @typedef {object} OldestMirrorEntry
 * @property {string} at
 * @property {string} key
 * @property {string} file
 * @property {number} line
 */

/**
 * The mechanical Scans, as the plan lays them out.
 * @typedef {object} ImpactPlanScans
 * @property {Array<Record<string, unknown>>} integrity_errors
 * @property {Array<Record<string, unknown>>} divergences
 * @property {Array<Record<string, unknown>>} outcome_gaps
 * @property {Array<Record<string, unknown>>} overreaches
 * @property {Array<Record<string, unknown>>} review_overdue
 * @property {Array<{ feature: string, at: string, key: string, file: string, line: number, age_days: number }>} oldest_mirror
 * @property {number} link_proposals
 */

/**
 * The plan contract (`plan.json`): what the run lays out. `impact` writes it and reads
 * it back; `settle-walk` reads it.
 * @typedef {object} ImpactPlan
 * @property {string} root
 * @property {string} dir
 * @property {string | null} feature
 * @property {{ ref: string | null, commit: string | null }} target
 * @property {boolean} persist
 * @property {{ feature: string | null } | null} review
 * @property {ImpactPlanScope} scope
 * @property {ImpactPlanUnit[]} units
 * @property {ImpactPlanScans} scans
 * @property {RunNote[]} run_health
 */

/**
 * A judge's verdict of one case, as the run reads it.
 * @typedef {object} Outcome
 * @property {ImpactPlanUnit} unit
 * @property {boolean} usable
 * @property {string | null} reason
 * @property {JudgeProblem[]} problems
 * @property {JudgeResult} [checked]
 */

/**
 * A Feature's part of the run's health, as the plan counts it.
 * @typedef {object} PerFeatureEntry
 * @property {string} feature
 * @property {{ judged: number, present: number }} files
 * @property {{ judged: number, present: number }} cases
 * @property {boolean} complete
 * @property {GatheredWatermark | null} [watermark]
 */

/**
 * A Feature's history facts, as the scan gathers them.
 * @typedef {object} ScanFeatureHistory
 * @property {string} feature
 * @property {string} file
 * @property {string} class
 * @property {string | null} watermark
 * @property {string} [reason]
 * @property {string} [diff]
 * @property {string[]} [rules_changed]
 * @property {string[]} [cases_changed]
 * @property {OldestMirrorEntry | null} [oldest_mirror]
 */

/**
 * `brief judge`, as the run calls it: the unit's brief, or the error that stopped it.
 * @typedef {(action: [string, ...string[]], options: { root: string, target?: { ref: string | null, commit: string | null } | null, cap?: number, change?: import("./change-data.mjs").ChangeData | null }) => { json: JudgeBriefJson, error?: string }} BriefFn
 */

/**
 * The Run's dispatch, as the report reads it.
 * @typedef {object} DispatchSummary
 * @property {string} run
 * @property {string[]} delegates
 * @property {number} calls
 * @property {string[]} announcements
 * @property {Array<{ unit: string, feature: string, scenario: string, attempts: number }>} retried
 * @property {Array<{ unit: string, feature: string, scenario: string, attempts: number, kind: string }>} failed
 * @property {Record<string, unknown>} failed_by_kind
 * @property {Array<{ delegate: string, reason: string }>} breaker_trips
 * @property {Array<{ from: string, to: string, reason: string }>} fallbacks
 * @property {string | null} stopped
 * @property {RunNote[]} notes
 */

/**
 * A case the run settled.
 * @typedef {object} SettledCase
 * @property {string} feature
 * @property {string} scenario
 * @property {string} file
 * @property {string} key
 * @property {string} verdict
 * @property {unknown[]} before
 * @property {unknown[]} after
 * @property {boolean} changed
 */

/**
 * What the run settled, as the report reads it.
 * @typedef {object} SettledFindings
 * @property {string} root
 * @property {string | null} target
 * @property {{ project: unknown }} index
 * @property {PersistCheck} persistCheck
 * @property {SettledCase[]} cases
 * @property {SettledFeature[]} features
 * @property {GatheredCarried[]} carried
 * @property {Array<{ feature: string, scenario: string, key: string }>} missing
 * @property {ImpactDismissed} dismissed
 * @property {unknown[]} walk
 * @property {unknown[]} watermarks
 * @property {RunNote[]} notes
 */

/**
 * What the run wrote, as the report reads it.
 * @typedef {object} WrittenFindings
 * @property {GatheredPersistedFeature[]} features
 * @property {string[]} paths
 */

/**
 * The knowledge the run pins its writes to, as the scan checks it.
 * @typedef {object} PersistCheck
 * @property {boolean} clean
 * @property {string | null} head
 * @property {string} [reason]
 * @property {unknown[]} changed
 */

/**
 * The options `impact plan` takes, as the command line resolves them.
 * @typedef {object} PlanOptions
 * @property {string} root
 * @property {{ ref: string | null, commit: string | null } | null} [target]
 * @property {string} [dir]
 * @property {string} [cap]
 * @property {boolean} [persist]
 * @property {string | boolean | null} [review]
 */

/**
 * A run dir the plan may make, as the plan reads it.
 * @typedef {{ dir: string | null, exists: boolean, make(): string, error?: string }} NewRun
 */

/**
 * The report of the run, or the refusal that stopped it.
 * @typedef {(ImpactReportGathered & { report: ImpactReport, refused?: never }) | { refused: PersistCheck, report?: never }} ImpactReportOut
 */

// Integrity error codes that mean the file could not be read as the schema needs: such a file is
// excluded from judging, so broken YAML never burns a call.
const UNPARSEABLE = ["dialect", "conflict_marker", "unreadable", "type"];

// The command line's `impact <action>` (scripts/scan.mjs): each returns `{json, exit}`. `target`,
// when given, is `{ref, commit}`.
//
// What each prints (ADR-0024): data for the model to word, never prose for the engineer. A refusal
// is `{ok: false, refusals: [{code, line, ...}]}` (lib/impact-json.mjs).
//   plan     {ok, dir, units, train}: `units` is how many judge units there are to dispatch;
//            `train` is `train/impact.md` (lib/training.mjs), the working tree's whatever commit
//            the run judges. The command reads it; the judge never does (ADR-0007)
//   report   {ok, report}: labelled data and Markdown tables (`reportData`)
//   persist  {ok, report, walk, card_page?}: the same, with the Watermarks, the walk's case count
//            and an optional Card page offer
// What a later call reads back is in the run dir: `plan.json` and the walk's files.
/** @type {OptionSpec} */
const RUN_DIR = { dir: "value" };
const CARD_PAGE_OFFER_THRESHOLD = 5;

/** @type {Record<string, CommandAction>} */
const ACTIONS = {
  plan: {
    options: { root: "qa-dir", target: "commit", cap: "value", dir: "value", out: "dir-alias", persist: "flag", review: "optional" },
    usage: "[<feature>] [--target <ref>] [--persist [--review [<feature>]]] [--cap <bytes>] [--dir <run-dir>] [--root <qa-dir>]",
    run: /** @type {CommandAction["run"]} */ (makePlan),
  },
  report: {
    options: RUN_DIR,
    usage: "--dir <run-dir>",
    run(args, options) {
      const { dir, plan, refused } = readPlan("report", args, options.dir);
      if (refused) return refused;
      return { exit: 0, json: { ok: true, report: report(plan, /** @type {DispatchSummary | null} */ (readDispatch(dir)), { dir }).report } };
    },
  },

  // The persisted run: the report, with the derived findings written and the Watermarks
  // advanced, before any triage walk begins. Refused, writing nothing, when `.qa/`'s stripped
  // knowledge no longer equals HEAD's.
  persist: {
    options: RUN_DIR,
    usage: "--dir <run-dir>",
    run(args, options) {
      const { dir, plan, refused } = readPlan("persist", args, options.dir);
      if (refused) return refused;
      const newer = refuseUnreadSchema(plan.root, ANY_SCHEMA_VERSION);
      if (newer) return newer;
      if (plan.persist !== true) return refuse("not_persisted");
      const out = report(plan, /** @type {DispatchSummary | null} */ (readDispatch(dir)), { persist: true, dir });
      if (out.refused) return persistRefused(out.refused);
      const cases = /** @type {unknown[]} */ (out.walk_cases).length;
      return { exit: 0, json: { ok: true, report: out.report, walk: { cases }, ...(cases >= CARD_PAGE_OFFER_THRESHOLD && { card_page: { offer: true, cases } }) } };
    },
  },

  // `/qa-ask` never writes, so the engineer runs this from the route it prints: the case is
  // recorded in the run dir's Run data, where `plan --dir` finds it and judges it.
  escalate: {
    options: { dir: "value", case: "value", root: "qa-dir" },
    usage: "--dir <run-dir> --case <key> [--root <qa-dir>]",
    run(args, { dir, case: key, root }) {
      if (args.length) return refuse("bad_arguments", { action: "escalate" });
      if (dir === undefined) return refuse("run_dir", { reason: "escalate takes --dir <run-dir>: the run dir `impact plan --dir` will read" });
      if (typeof key !== "string") return refuse("needs_case");
      const out = escalate({ root: /** @type {string} */ (root), dir, key });
      if (out.ok) return { exit: 0, json: { ok: true, dir: out.dir, file: out.file, escalated: out.escalated } };
      return out.refusal === "run_dir" ? refuse("run_dir", { reason: out.reason }) : refuse("unknown_case", { key });
    },
  },

  // The front door of `/qa-impact` (lib/impact-entry.mjs): the quick path, or the answer an old
  // invocation (`--persist`, `--review`, `--target`, read-only) gets.
  entry: {
    options: { root: "qa-dir", persist: "flag", review: "optional", target: "value" },
    usage: "[<feature> [<ref>...]] [--persist] [--review [<feature>]] [--target <ref>] [--root <qa-dir>]",
    run: (args, { root, persist, review, target }) => enter({ root: /** @type {string} */ (root), args, persist: persist === true, review: /** @type {string | boolean | undefined} */ (review), target: /** @type {string | undefined} */ (/** @type {unknown} */ (target)) }),
  },

  // The quick path (lib/quick-path.mjs): the change's run dir, named once; then the Rule-edit
  // transition with the threshold counted over it.
  quick: {
    options: { dir: "value", root: "qa-dir" },
    usage: "[--dir <run-dir>] [--root <qa-dir>]",
    run(args, { dir, root }) {
      if (args.length) return refuse("bad_arguments", { action: "quick" });
      return openQuick({ root: /** @type {string} */ (root), dir });
    },
  },
  "quick-check": {
    options: { dir: "value", root: "qa-dir", stdin: "flag" },
    usage: "<feature> --dir <run-dir> --stdin [--root <qa-dir>]",
    run(args, { dir, root, stdin }) {
      if (args.length !== 1) return refuse("bad_arguments", { action: "quick-check" });
      if (!PATTERN.slug.test(args[0])) return refuse("not_feature_key", { given: args[0] });
      if (!stdin) return refuse("needs_stdin");
      return checkQuick({ root: /** @type {string} */ (root), dir, feature: args[0], stdin: stdin() });
    },
  },

};

// Every refusal is `impact`'s own (lib/impact-json.mjs), its usage errors included.
/** @type {CommandDefinition} */
export const command = { actions: ACTIONS, refuse: (e) => refuse(/** @type {string} */ (e.detail.code), e.detail) };

// The run's plan: `scan` first, then one judge unit per non-empty scenario file.
/**
 * @param {string[]} args
 * @param {PlanOptions} options
 * @returns {CommandResult}
 */
function makePlan(args, { root, target, dir: named, cap: givenCap, persist = false, review = null }) {
  if (args[0] !== undefined && !PATTERN.slug.test(args[0])) return refuse("not_feature_key", { given: args[0] });
  const cap = givenCap === undefined ? undefined : Number(givenCap);
  if (cap !== undefined && !(Number.isInteger(cap) && cap >= 0)) return refuse("bad_cap");
  if (typeof review === "string" && !PATTERN.slug.test(review)) return refuse("not_feature_key", { given: review });
  if (args.length > 1) return refuse("bad_arguments", { action: "plan" });
  const [feature] = args;
  const run = /** @type {NewRun} */ (newRunDir(named, "qa-impact-"));
  if (run.error) return refuse("run_dir", { reason: run.error });
  // `--review [<feature>]` adds unreviewed and overdue cases to the walk, which only a persisted
  // run takes: `true` for the Features in scope, else the one Feature it names.
  if (review !== null && !persist) return refuse("review_needs_persist");
  // A persisted run pins what it writes to a commit: `--target`'s, else HEAD's, whose knowledge
  // the stripped-dirty check below makes the working tree's.
  if (persist && !target) {
    const repo = repositoryOf(root);
    const head = repo && resolveRef(repo.top, "HEAD");
    if (!head) return refuse("persist_refused", { reason: repo ? "no_commits" : "not_a_repository", changed: [] }, 1);
    target = { ref: null, commit: head };
  }
  const s = scan(root, { feature, target });
  if (feature !== undefined && !s.history.features.some((f) => f.feature === feature)) return refuse("no_feature", { slug: feature, root });
  if (typeof review === "string" && !s.history.features.some((f) => f.feature === review) && !scan(root, { target }).history.features.some((f) => f.feature === review)) {
    return refuse("review_unknown", { slug: review, root });
  }
  if (persist && !s.history.persist.clean) return persistRefused(s.history.persist);
  // Run data the caller seeded in the run dir (lib/change-data.mjs): the Rules the engineer widened,
  // the forecast the engineer confirmed for each edited statement and the cases `/qa-ask` escalated.
  // A file that is not JSON refuses the plan, like any run file.
  /** @type {import("./change-data.mjs").ChangeData | null} */
  let change = null;
  if (run.exists) {
    const read = readChange(/** @type {string} */ (run.dir));
    if (read.error) return refuse("run_dir", { reason: read.error });
    change = read.data ?? null;
  }
  const files = loadQaTree(root, target?.commit);
  const index = buildIndex(files);
  // The settlement takes a Rule whose statement changed since the Watermark only with the forecast
  // the engineer confirmed for it in this run dir (lib/forecast-guard.mjs). The Watermark follows a
  // persisted run, so a fresh or lost run dir must not narrow the selection and let it advance.
  if (persist) {
    const rules = unforecastRules({ root, features: s.history.features, index, change });
    if (rules.length) return refuse("forecast_missing", { rules }, 1);
  }
  // Every refusal is above: the run dir is made only now, so a refused plan leaves none.
  const dir = run.make();
  const health = /** @type {RunNote[]} */ ([...s.run_health, ...(change?.notes ?? [])]);

  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const broken = new Map();
  for (const r of s.results) {
    if (r.kind === "integrity_error" && UNPARSEABLE.includes(/** @type {string} */ (r.code)) && r.file) {
      if (!broken.has(/** @type {string} */ (r.file))) broken.set(/** @type {string} */ (r.file), []);
      /** @type {Array<Record<string, unknown>>} */ (broken.get(/** @type {string} */ (r.file))).push(r);
    }
  }

  /** @type {ImpactPlanUnit[]} */
  const units = [];
  const features = s.history.features.map((h) => {
    /** @type {ImpactPlanFeature} */
    const entry = { feature: h.feature, file: h.file, class: h.class, judged: false, watermark: h.watermark, ...(h.reason && { reason: h.reason }) };
    // The Feature-level judge unit (ADR-0039): the Feature's Rules judged against its Boundaries. It
    // is planned for a Feature that has Boundaries and at least one candidate Rule, whatever its
    // scenario files are.
    const level = featureLevelUnit(h, { dir, root, target, cap, index });
    if (level) {
      entry.judged = true;
      entry.rules = level.rules;
    }
    // A Feature `/qa-ask` escalated a case in is judged though nothing in it changed.
    if (!isJudged(h, change)) {
      if (level) units.push(level);
      return level ? { ...entry, scenarios: [] } : { ...entry, why: h.class };
    }
    if (broken.has(h.file)) return { ...entry, why: "unparseable_feature", problems: broken.get(h.file) };
    entry.judged = true;
    entry.first_judgement = h.class === "first_judgement";
    // The judge reads only the cases the change selects (ADR-0043): a scenario file none of whose
    // cases is selected is no unit.
    const selection = selectCases({ files, index, facts: h, obligations: s.history.stale_obligations, change });
    entry.scenarios = scenarioFiles(files, index, h.feature, broken).map((sc) => {
      if (sc.status !== "unit") return sc;
      const cases = index.scenarios.get(/** @type {string} */ (sc.scenario))?.[0]?.file.cases ?? [];
      if (!cases.some((c) => selection.keys.has(c.key))) return { ...sc, status: "unselected" };
      const b = /** @type {{ json: JudgeBriefJson, error?: string }} */ (/** @type {BriefFn} */ (brief)(["judge", /** @type {string} */ (sc.scenario)], { root, target, cap, change }));
      // A unit is a non-empty, addressable scenario file of a judged Feature, which `brief judge`
      // always takes: an error here is a fault in the framework.
      if (b.error) throw new Error(`impact plan: no brief for ${sc.scenario}: ${b.error}`);
      const unit = writeUnit(dir, h.feature, sc, /** @type {JudgeBriefJson} */ (b.json));
      units.push(unit);
      if (b.json.changed_cases?.degraded) health.push({ code: "changed_cases_degraded", feature: h.feature, scenario: unit.scenario ?? undefined });
      return { ...sc, selected: b.json.keys };
    });
    if (level) units.push(level);
    return entry;
  });

  // A case `/qa-ask` escalated in a Feature this run cannot judge (an unchanged Feature is judged, so
  // this is a class with no cases to read, an unparseable file or a Feature the plan does not hold) reaches no judge: say so.
  const judgedFeatures = new Set(features.filter((f) => f.judged).map((f) => f.feature));
  for (const e of change?.escalated ?? []) {
    if (!judgedFeatures.has(e.feature)) health.push({ code: "escalated_not_judged", feature: e.feature, key: e.case, reason: s.history.features.find((f) => f.feature === e.feature)?.class ?? "unknown_feature" });
  }

  /** @type {ImpactPlan} */
  const plan = {
    root,
    dir,
    feature: feature ?? null,
    target: { ref: target?.ref ?? null, commit: target?.commit ?? null },
    persist,
    review: review === null ? null : { feature: typeof review === "string" ? review : null },
    scope: { features },
    units,
    scans: scans(s),
    run_health: health,
  };
  writeFileSync(join(dir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  writeFileSync(join(dir, "dispatch.spec.json"), `${JSON.stringify(/** @type {DispatchSpec} */ (dispatchSpec(plan)), null, 2)}\n`);
  return { exit: 0, json: { ok: true, dir, units: units.length, train: trainFor(root, IMPACT_TRAIN_KEY) } };
}

// The run dir and its plan, for an action that takes no argument: `{dir, plan}`, or `{refused}`.
/**
 * @param {string} action
 * @param {readonly string[]} args
 * @param {string | undefined} dir
 * @returns {({ dir: string, plan: ImpactPlan, refused?: never }) | ({ refused: RefusalResult, dir?: never, plan?: never })}
 */
function readPlan(action, args, dir) {
  if (args.length) return { refused: refuse("bad_arguments", { action }) };
  /** @type {OpenPlanResult<ImpactPlan>} */
  const opened = openPlan("impact", action, args, dir);
  return opened.error ? { refused: refuse("run_dir", { reason: opened.error }) } : /** @type {{ dir: string, plan: ImpactPlan, refused?: never }} */ (opened);
}

// `--persist` refused: every pin a persisted run writes must name a commit holding the
// knowledge it attests, so `.qa/`'s Bookkeeping-stripped content must equal HEAD's (the delegation
// log excluded). `plan` refuses before anything is dispatched; `persist` checks again before it
// writes, since the knowledge may have moved while the units ran. `check` is `scan`'s
// `history.persist`: its `reason` names a repository with no HEAD, and is absent when `.qa/` is dirty.
/** @param {PersistCheck} check */
const persistRefused = (check) => refuse("persist_refused", { reason: check.reason ?? "dirty", changed: check.changed }, 1);

// Every scenario file of a judged Feature, as its `.qa/` holds it: the parsed scenario files the
// Feature owns, plus any unparseable file in its directory, which cannot say what it is. Each is
// `empty`, `excluded` (with why) or, when it is to be dispatched, `unit`.
/**
 * @param {QaFile[]} files
 * @param {KeyIndex} index
 * @param {string} slug
 * @param {Map<string, Array<Record<string, unknown>>>} broken
 * @returns {ScenarioEntry[]}
 */
function scenarioFiles(files, index, slug, broken) {
  const featureDir = index.features.get(slug)?.[0]?.file.dir;
  /** @type {ScenarioEntry[]} */
  const out = [];
  for (const f of files) {
    const inDir = posix.dirname(f.rel) === featureDir;
    const mine = f.unreadable ? inDir : f.type === "scenario" && index.featureOf(f) === slug;
    // A file in the Feature's directory too broken to say it is a scenario.
    const stray = !f.unreadable && broken.has(f.rel) && inDir && f.type !== "feature" && f.type !== "scenario";
    if (!mine && !stray) continue;
    const key = typeof f.data?.key === "string" ? f.data.key : null;
    const entry = { scenario: key, file: f.rel, cases: f.cases?.length ?? 0 };
    /** @type {(reason: string, problems?: Array<Record<string, unknown>>) => number} */
    const excluded = (reason, problems = []) => out.push({ ...entry, status: "excluded", reason, problems });
    if (broken.has(f.rel)) excluded("unparseable", broken.get(f.rel));
    else if (key === null) excluded("no_key");
    else if (index.scenarios.get(key)?.[0]?.file !== f) excluded("key_twice");
    else out.push({ ...entry, status: entry.cases === 0 ? "empty" : "unit" });
  }
  return out;
}

// One judge unit's files in the run directory, and its entry in the plan.
/**
 * @param {string} dir
 * @param {string} feature
 * @param {ScenarioEntry} entry
 * @param {JudgeBriefJson} json
 * @returns {ImpactPlanUnit}
 */
function writeUnit(dir, feature, entry, json) {
  const name = /** @type {string} */ (entry.scenario).replace(/[^A-Za-z0-9_.-]/g, "_");
  const briefJson = join(dir, `${name}.brief.json`);
  const briefText = join(dir, `${name}.brief.md`);
  writeFileSync(briefJson, `${JSON.stringify(/** @type {JudgeBrief} */ ({ mode: "brief", ...json }), null, 2)}\n`);
  writeFileSync(briefText, json.brief);
  return {
    kind: "scenario",
    feature,
    scenario: /** @type {string} */ (entry.scenario),
    file: entry.file,
    cases: entry.cases,
    first_judgement: json.first_judgement,
    brief_bytes: json.brief_bytes,
    brief: briefText,
    brief_json: briefJson,
    reply: join(dir, `${name}.reply.md`),
  };
}

// The Feature-level judge unit of a Feature (ADR-0039): the Feature's Rules judged against its
// Boundaries. It is planned for a Feature that has Boundaries and at least one candidate Rule, so
// a brief that names no candidate Rule is no unit.
/**
 * @param {{ feature: string }} h
 * @param {{ dir: string, root: string, target: { ref: string | null, commit: string | null } | null | undefined, cap: number | undefined, index: KeyIndex }} options
 * @returns {ImpactPlanUnit | null}
 */
function featureLevelUnit(h, { dir, root, target, cap, index }) {
  // A Feature with no Boundary has no Feature-level unit: its Rules cross nothing.
  const file = index.features.get(h.feature)?.[0]?.file;
  if (!file || file.boundaries.length === 0) return null;
  const b = /** @type {{ json: JudgeBriefJson, error?: string }} */ (/** @type {BriefFn} */ (brief)(["feature", h.feature], { root, target, cap }));
  if (b.error) return null;
  const json = /** @type {JudgeBriefJson} */ (b.json);
  if (json.keys.length === 0) return null;
  const name = featureUnitId(h.feature).replace(/[^A-Za-z0-9_.-]/g, "_");
  const briefJson = join(dir, `${name}.brief.json`);
  const briefText = join(dir, `${name}.brief.md`);
  writeFileSync(briefJson, `${JSON.stringify(/** @type {JudgeBrief} */ ({ mode: "brief", ...json }), null, 2)}\n`);
  writeFileSync(briefText, json.brief);
  return {
    kind: "feature",
    feature: h.feature,
    scenario: null,
    file: json.file,
    cases: 0,
    rules: json.keys,
    first_judgement: json.first_judgement,
    brief_bytes: json.brief_bytes,
    brief: briefText,
    brief_json: briefJson,
    reply: join(dir, `${name}.reply.md`),
  };
}

// A unit's identity in the run: its scenario key, or the Feature-level unit's own name.
const unitKey = (/** @type {ImpactPlanUnit} */ unit) => unit.scenario ?? featureUnitId(unit.feature);

// The units as the delegation layer takes them (`delegate start`, lib/delegation.mjs): each judge
// unit's brief, where its reply goes, and the judge contract it is checked against. Which Delegate
// runs them, and how many at once, is the delegation layer's to decide.
/**
 * @param {ImpactPlan} plan
 * @returns {DispatchSpec}
 */
function dispatchSpec(plan) {
  return {
    v: 1,
    cmd: "impact",
    root: resolve(plan.root),
    feature: plan.feature,
    target: plan.target.commit,
    units: plan.units.map((u) => ({ id: unitKey(u), feature: u.feature, scenario: u.scenario, brief: u.brief, reply: u.reply, contract: { kind: "judge", brief_json: u.brief_json } })),
  };
}

// The mechanical Scans: results as `scan` reported them, never judged.
/**
 * @param {ScanOutput} s
 * @returns {ImpactPlanScans}
 */
function scans(s) {
  /** @type {(kind: string) => Array<Record<string, unknown>>} */
  const of = (kind) => s.results.filter((r) => r.kind === kind);
  return {
    integrity_errors: of("integrity_error"),
    divergences: of("divergence"),
    outcome_gaps: of("outcome_gap"),
    overreaches: of("overreach"),
    review_overdue: of("review_overdue"),
    oldest_mirror: s.history.features.filter((f) => f.oldest_mirror).map((f) => ({ feature: f.feature, .../** @type {OldestMirrorEntry} */ (f.oldest_mirror), age_days: ageDays(/** @type {OldestMirrorEntry} */ (f.oldest_mirror).at) })),
    link_proposals: of("binding_proposal").length,
  };
}

/**
 * @param {string} iso
 * @returns {number}
 */
function ageDays(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  return Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) / 86400000);
}

// The four sections, from the plan, each unit's saved reply and, when units were dispatched, the
// Run's dispatch (lib/delegation.mjs), then the changeset.
/**
 * @param {ImpactPlan} plan
 * @param {DispatchSummary | null} dispatch
 * @param {{ persist?: boolean, dir: string }} options
 * @returns {ImpactReportOut}
 */
function report(plan, dispatch, { persist = false, dir }) {
  /** @type {Map<string, Outcome>} */
  const outcomes = new Map();
  for (const u of plan.units) {
    let reply = null;
    try {
      if (existsSync(u.reply) && statSync(u.reply).isFile()) reply = readFileSync(u.reply, "utf8");
    } catch {
      reply = null;
    }
    if (reply === null) {
      outcomes.set(unitKey(u), { unit: u, usable: false, reason: "no_reply", problems: [] });
      continue;
    }
    /** @type {JudgeBrief | null} */
    let unit = null;
    try {
      unit = /** @type {JudgeBrief} */ (JSON.parse(readFileSync(u.brief_json, "utf8")));
    } catch {
      unit = null;
    }
    const checked = /** @type {(JudgeResult & { error?: string }) | null} */ (unit && checkReply("judge", reply, unit));
    if (!checked || checked.error) {
      outcomes.set(unitKey(u), { unit: u, usable: false, reason: "no_brief", problems: [] });
      continue;
    }
    outcomes.set(unitKey(u), { unit: u, usable: checked.usable, reason: checked.usable ? null : "unusable", problems: checked.problems, checked });
  }

  /** @type {GatheredJudgement[]} */
  const judgements = [];
  /** @type {GatheredOverreach[]} */
  const overreaches = [];
  for (const o of outcomes.values()) {
    if (!o.usable) continue;
    for (const v of /** @type {JudgeVerdict[]} */ (/** @type {JudgeResult} */ (o.checked).verdicts)) {
      if (v.verdict === "Current") continue;
      judgements.push({ feature: o.unit.feature, scenario: o.unit.scenario ?? "", file: o.unit.file, ...v });
    }
    // The Overreaches the judge raised (ADR-0039): a list beside the verdicts.
    for (const x of /** @type {JudgeOverreach[]} */ (/** @type {JudgeResult} */ (o.checked).overreaches)) {
      overreaches.push({ feature: o.unit.feature, scenario: o.unit.scenario, file: o.unit.file, ...x });
    }
  }

  /** @type {PerFeatureEntry[]} */
  const perFeature = [];
  for (const f of plan.scope.features) {
    if (!f.judged) continue;
    const files = { judged: 0, present: /** @type {ScenarioEntry[]} */ (f.scenarios).length };
    const cases = { judged: 0, present: 0 };
    // A Feature is complete once every selected case was judged: a file with no selected case has
    // nothing to judge, and a unit's `present` is the cases it was sent.
    for (const sc of /** @type {ScenarioEntry[]} */ (f.scenarios)) {
      cases.present += sc.status === "unit" ? (sc.selected?.length ?? sc.cases) : sc.status === "unselected" ? 0 : sc.cases;
      if (sc.status === "empty" || sc.status === "unselected") files.judged++;
      const o = sc.status === "unit" ? outcomes.get(/** @type {string} */ (sc.scenario)) : null;
      if (o?.usable) {
        files.judged++;
        cases.judged += /** @type {JudgeResult} */ (o.checked).cases_evaluated;
      }
    }
    // The Feature-level unit (ADR-0039) is a judge unit of its Feature: the Feature is complete
    // only once it was judged too.
    const level = f.rules ? outcomes.get(featureUnitId(f.feature)) : null;
    perFeature.push({ feature: f.feature, files, cases, complete: files.judged === files.present && (!f.rules || level?.usable === true) });
  }
  /** @type {(k: "files" | "cases", part: "judged" | "present") => number} */
  const sum = (k, part) => perFeature.reduce((n, f) => n + f[k][part], 0);
  // With a dispatch, each failed unit also says how it failed (its last attempt's kind) and after
  // how many attempts.
  const dispatched = new Map((dispatch?.failed ?? []).map((f) => [f.unit, f]));
  const failed = [...outcomes.values()].filter((o) => !o.usable).map((o) => {
    const f = { feature: o.unit.feature, scenario: o.unit.scenario, file: o.unit.file, reason: o.reason, problems: o.problems };
    const d = dispatched.get(unitKey(o.unit));
    if (dispatch) Object.assign(f, { kind: d?.kind ?? (o.reason === "unusable" ? "unusable" : "not_dispatched"), attempts: d?.attempts ?? 0 });
    return f;
  });
  const unknownKeys = [...outcomes.values()].reduce((n, o) => n + (o.checked?.unknown_keys ?? 0), 0);

  // The exact command that re-judges what this Run left unjudged: the same arguments, which
  // re-judge every file of each incomplete Feature (there is no per-file resumption).
  const incomplete = perFeature.some((f) => !f.complete);
  const rerun = incomplete
    ? ["/qa-design", plan.feature].filter(Boolean).join(" ")
    : null;

  // What the run leaves on each case (lib/impact-persist.mjs); a persisted run writes it.
  const settled = /** @type {SettledFindings} */ (settleFindings(plan, outcomes, new Set(perFeature.filter((f) => f.complete).map((f) => f.feature)), { persist }));
  /** @type {WrittenFindings | null} */
  let persisted = null;
  /** @type {import("./settle-walk.mjs").WalkCase[]} */
  let visits = [];
  if (persist) {
    if (!settled.persistCheck.clean) return { refused: settled.persistCheck };
    // The Watermark waits for checkpoint 2 on every run: the walk's end, with its fixes and any new
    // cases committed, so a walk with no case to settle still certifies them.
    visits = walkCases(plan, settled);
    persisted = /** @type {WrittenFindings} */ (writeFindings(settled));
    for (const f of perFeature) f.watermark = persisted.features.find((x) => x.feature === f.feature)?.watermark ?? null;
  }
  const paths = persisted?.paths ?? [];
  const scope = plan.feature ? `qa(${plan.feature})` : "qa";
  const message = persisted && `${scope}: /qa-design at ${/** @type {string} */ (plan.target.commit).slice(0, 12)}`;
  const changeset = paths.length ? { paths, commit: commitLine(paths, message) } : { paths: [], commit: null };

  /** @type {ImpactReportGathered} */
  const out = {
    feature: plan.feature,
    target: plan.target,
    delegate: dispatch ? { ran: dispatch.delegates } : null,
    scope: plan.scope,
    judgements,
    overreaches,
    carried: settled.carried,
    dismissed: settled.dismissed,
    scans: plan.scans,
    run_health: {
      files: { judged: sum("files", "judged"), present: sum("files", "present") },
      cases: { judged: sum("cases", "judged"), present: sum("cases", "present") },
      features: perFeature,
      failed_units: failed,
      failed_by_kind: /** @type {Record<string, number>} */ (dispatch?.failed_by_kind ?? {}),
      unknown_keys: unknownKeys,
      dispatch: dispatch
        ? { run: dispatch.run, calls: dispatch.calls, announcements: dispatch.announcements, retried: dispatch.retried, breaker_trips: dispatch.breaker_trips, fallbacks: dispatch.fallbacks, stopped: dispatch.stopped }
        : null,
      rerun,
      notes: [...plan.run_health, ...(dispatch?.notes ?? []), ...settled.notes],
    },
    changeset,
    merge_rules: [],
  };
  if (persisted) {
    out.persisted = {
      target: plan.target.commit,
      features: persisted.features,
      cases: settled.cases.filter((c) => c.changed).map(({ feature, scenario, file, key, verdict, after }) => ({ feature, scenario, file, key, verdict, finding: after })),
      missing: settled.missing,
    };
    // Where the triage walk begins: every case with a finding this run raised and left open,
    // and every carried open Stale of the Features judged. `layOut` adds the named Feature's open
    // findings (the Scan's Divergences and Outcome gaps included) and, with `--review`, unreviewed
    // and overdue cases, and saves it for `design walk`.
    out.walk = settled.walk;
    const laid = layOut(dir, plan, settled, persisted, changeset, visits);
    // Every case the walk visits (`design walk` shows them), and the merge rules for what was written.
    out.walk_cases = laid.cases;
    out.merge_rules = laid.persisted.merge;
  }
  // The stack adapter of this report (lib/stack.mjs), for its words only.
  const { adapter } = resolveAdapter(projectConfig(/** @type {import("./knowledge-file.mjs").ProjectSource} */ (settled.index.project)).stack, dirname(resolve(plan.root)));
  out.report = reportData(out, summaries(settled.index), adapter);
  return /** @type {ImpactReportOut} */ (out);
}
