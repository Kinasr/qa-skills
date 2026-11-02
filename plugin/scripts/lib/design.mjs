// @ts-check
// `design`: the deterministic half of `/qa-design`. The skill agrees the
// Test Scenario split with the engineer (Phase 1) and dispatches the fill (Phase 2) through the
// shared delegation layer; every read, key, file and summary comes from here.
//
//   state <feature> [<scenario>] [--expand | --regenerate] [--review]
//                             halts on a Feature with no Rules; else its Rules, the project's roles
//                             and levels, design's training, whether Phase 1 runs, the empty
//                             scenario files needing agreed levels, with the question that asks for each,
//                             its Coverage: the actual view, whether assessed, and what is due, and
//                             the open-finding gate (every open finding by kind and Feature) that a
//                             bare run settles first; `--review` adds the unreviewed and Review
//                             overdue cases
//   agree <scope> --stdin     the agreement bound: the proposed agreement canonicalised with its
//                             computed basis, the planned and actual coverage views, its refusals
//                             and a scoped run's reported Feature gaps. Writes nothing
//   split <feature> --stdin   Phase 1's write: records the canonical agreement `design agree` made
//                             in a run directory, minting every `new:N` scenario. It writes the
//                             agreed scenario files, empty, each with its H1 and a minted
//                             `ts_` Key; the wanted levels stay in the agreement. All or nothing
//   plan <feature> [<scenario>] [--expand | --regenerate] [--dir <run-dir>]
//                             Phase 2's plan: one design unit per targeted scenario file, its brief
//                             and the units for `delegate start` written to the run directory. The
//                             agreement in `--dir`, when there is one, gives each unit its action and
//                             obligations, and its stale basis refuses the plan.
//   report                    the closing summary: what each unit wrote, the proposed Rules handed
//                             to /qa-deep-dive, what is still empty, Run health, the changeset and,
//                             when the Run recorded an agreement, declared coverage and hand-offs
//
// What each prints (ADR-0024): data for the model to word (lib/design-json.mjs). A refusal is
// `{ok: false, refusals: [{code, line, ...}]}`, a code with one factual line.
//   state    {ok, phase1, no_targets, rules, roles, levels, train, needs_level, coverage}: `train` is
//            `train/design.md` as lib/training.mjs returns it; `no_targets` is true when a flagged
//            run has no scenario files to target; `level_question` is present only when
//            `needs_level` names files; `coverage` is the actual view, whether the Feature has a
//            `## Coverage` section, what `/qa-next`'s predicate finds due, and the deep dive next;
//            `open_findings` is the settle gate: `{open, total, by_kind, features: [{feature, total,
//            by_kind, cases}]}`; `review` (only with `--review`) is `{feature, cases: [{key, scenario,
//            file, why}]}`, `why` naming `unreviewed` and/or `review_overdue`
//   agree    {ok, agreement, views, refusals, gaps} (lib/design-agreement.mjs)
//   split    {ok, dir, agreement}: `agreement` is the recorded `agreement.json`
//   plan     {ok, dir, units}: `units` is how many files are dispatched
//   report   {ok, feature, mode, scenarios, written_markdown, not_automatable, skipped, still_empty,
//             declared_coverage?, handoffs?, ...}

// The mode picks the targets: a bare run fills the empty files, `--expand`
// adds cases to the populated ones, and `--regenerate` redoes the files holding an unreviewed case
// with no effective Tracker key, replacing only those cases. A `<scenario>` scopes the run to that one
// file, and Phase 1 never runs for it. When `--dir` names a run directory that holds the agreement
// `design split` recorded (lib/design-agreement.mjs), its scope must match the invocation, only the
// scenarios it names are units (one it leaves out is skipped `not_agreed`), and each entry's action
// decides its unit's mode: a bare or expand run also fills a confirmed new scenario, and a regenerate
// run also expands a populated target whose gap work an expand can carry. A stale basis, an action
// the run does not run, or a file that cannot take its agreed action refuses the plan before any
// write.
//
// Phase 2's cases are written as each unit's reply comes back usable (lib/design-write.mjs, run by
// the design contract). Rules never enter here: the Feature file and `project.md` stay `/qa-deep-dive`'s.
// The settle phase (lib/settle-walk.mjs) writes findings, Reviews and retirements into case files and a
// Feature's own `finding` list, never a Rule.
//
// The run directory, per unit `<key>`:
//   agreement.json      the canonical agreement, the contract every later design step reads
//   split.json          the scenario files `split` wrote, when it wrote any
//   overrides.json      the engineer's reasons a stored case may be repeated (`design override`), when stated
//   plan.json           the plan: its units, and the files it skipped with why
//   dispatch.spec.json  the units, as `delegate start` takes them (lib/delegation.mjs)
//   <key>.brief.json    `brief design <key>`'s JSON, which `check-reply design --brief` takes
//   <key>.brief.md      the brief text alone, which the Delegate is given
//   <key>.reply.md      the usable reply the delegation layer left (else the last one it got)
//   <key>.written.json  what the write of its usable reply did; absent = nothing was written
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { keyLabel, summaries } from "./labels.mjs";
import { commitLine } from "./changeset.mjs";
import { checkReply } from "./check-reply.mjs";
import { readDispatch } from "./delegation.mjs";
import { refuse, levelQuestion, reportData } from "./design-json.mjs";
import { agreementBasis, checkAgreement, coverageViews, isNewScenarioKey, readAgreement, staleAgreement } from "./design-agreement.mjs";
import { agreementBriefPosition } from "./design-agreement-brief.mjs";
import { designMode, designUnit, loadFeature, modeRefusal } from "./design-unit.mjs";
import { coverageDue, parseCoverage } from "./coverage.mjs";
import { effectiveCategories } from "./categories.mjs";
import { listOf } from "./dialect.mjs";
import { table } from "./markdown.mjs";
import { PATTERN } from "./keys.mjs";
import { checkFile, edit, parse } from "./knowledge-file.mjs";
import { mint } from "./mint.mjs";
import { backfill } from "./pin-digest.mjs";
import { rootConfig } from "./qa-index.mjs";
import { newRunDir, openPlan } from "./run-dir.mjs";
import { localDate } from "./scan.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { DESIGN_TRAIN_KEY, LEVEL_ON_CASE_SCHEMA_VERSION } from "./schema.mjs";
import { DESIGN_SETTLE_ACTIONS, SETTLE_ACTIONS, settleScope } from "./settle-walk.mjs";
import { linkScope } from "./settle-propose.mjs";
import { trainFor } from "./training.mjs";

/** Contract types this module owns and consumes from where they are owned. */
/** @import { CheckFileResult, DesignBrief, DesignMode, EditResult, FeatureContext, ScenarioState } from "./design-unit.mjs"; */
/** @import { CaseEntry, ParsedFile as QaFile } from "./knowledge-file.mjs"; */
/** @import { MintedKeys } from "./mint.mjs"; */
/** @import { DesignProposedRule, DesignResult } from "./design-contract.mjs"; */
/** @import { Agreement, AgreementProposedRule, AgreementResult, AgreementScenario, CoverageView } from "./design-agreement.mjs"; */
/** @import { CoverageDue } from "./coverage.mjs"; */
/** @import { WrittenRecord } from "./design-write.mjs"; */
/** @import { DeclaredCoverage, DeclaredOutcome, DesignReportJson, LevelQuestion, ReportHandoffs, ReportProposed, ReportScenario, RunHealth } from "./design-json.mjs"; */
/** @import { DispatchSpec } from "./dispatch.mjs"; */
/** @import { CommandContext, CommandDefinition, CommandResult, OptionKind } from "./cli.mjs"; */
/** @import { OpenPlanResult } from "./run-dir.mjs"; */
/** @import { RefusalResult } from "./refusal.mjs"; */

/** A design run's scope once the command line's flags are read: its Feature, its one `<scenario>` when given, and the mode. */
/** @typedef {{ slug: string, scenario: string | null, mode: DesignMode }} RunScope */

/** What one unit's outcome says about the obligations it owed: a written unit delivered some, a failed one nothing, an awaiting one needs Rules first, and a deferred one was never attempted. */
/** @typedef {"written" | "failed" | "awaiting" | "deferred"} UnitOutcome */

/**
 * The Coverage a `design state` run starts from (ADR-0041): the actual view derived from each Test
 * Case's `covers`, its compact Markdown, whether the Feature has a `## Coverage` section, what
 * `/qa-next`'s due predicate finds, and the deep dive that settles it. Planned views stay with
 * `design agree`.
 * @typedef {object} StateCoverage
 * @property {CoverageView} views
 * @property {string} markdown
 * @property {boolean} assessed
 * @property {CoverageDue | null} due
 * @property {string | null} next_step
 */

/**
 * The split contract (`split.json` in the run dir, when Phase 1 wrote a scenario file): the Feature
 * it names, and every scenario file it wrote, with its new entry and the file as the repository sees
 * it. `agreement.json` is the contract every later design step reads.
 * @typedef {object} SplitRecord
 * @property {string} feature
 * @property {{ scenario: string, summary: string | null, levels: string[], created: boolean, file: string }[]} written
 */

/**
 * The plan contract (`plan.json` in the run dir): the run it made, one unit per targeted scenario
 * file, and the files it skipped with why. `design report` reads it through `openPlan`.
 * @typedef {object} DesignPlan
 * @property {string} root - the `.qa/` directory, resolved
 * @property {string} dir - the run directory, absolute
 * @property {string} feature - the run's Feature key
 * @property {DesignMode} mode
 * @property {string | null} scenario
 * @property {number} rules_in
 * @property {PlanUnit[]} units
 * @property {PlanSkip[]} skipped
 */
/**
 * One unit of the plan (`writeUnit`): the paths of its serialised brief and reply, the cases a
 * regenerate replaces, with the summaries their headings carry, and the action and obligations the
 * agreement gave it (empty without one).
 * @typedef {object} PlanUnit
 * @property {string} feature
 * @property {string} scenario
 * @property {string} file - the scenario file, as the repository under test sees it
 * @property {string[]} wanted_levels
 * @property {DesignMode} action
 * @property {string[]} obligations
 * @property {number} cases_total
 * @property {{ key: string, summary: string }[]} replace
 * @property {number} brief_bytes
 * @property {string} brief - the `<key>.brief.md` path
 * @property {string} brief_json - the `<key>.brief.json` path
 * @property {string} reply - the `<key>.reply.md` path
 * @property {string} written - the `<key>.written.json` path
 */
/**
 * A scenario file the plan skipped, with why it is no unit of the mode.
 * @typedef {object} PlanSkip
 * @property {string} scenario
 * @property {string} file
 * @property {ScenarioState["status"]} status
 * @property {string} reason
 * @property {string[]} [problems]
 */

/**
 * lib/training.mjs `trainFor` (unchecked), as `design state` names its source: the whole training
 * file's text, with its entries in file order, each keyed.
 * @typedef {{ exists: false, text: null, entries: never[] } | { exists: true, text: string, entries: { key: string, kind: string, statement: string }[] }} TrainModule
 */

/** One unit the dispatch gave up on, with its last attempt's kind (lib/delegation.mjs `dispatchSummary`). */
/** @typedef {{ unit: string, feature: string | null, scenario: string | null, attempts: number, kind: string, problems?: string[] }} DispatchFailed */
/**
 * The Run's dispatch as `design report` reads it (lib/delegation.mjs `readDispatch`, unchecked, so
 * this names the only fields the report reads of the dispatch summary it saved).
 * @typedef {object} DispatchReadback
 * @property {string} run
 * @property {string[]} delegates
 * @property {number} calls
 * @property {string[]} announcements
 * @property {RunHealth["retried"]} retried
 * @property {RunHealth["notes"]} notes
 * @property {DispatchFailed[]} failed
 */

// The actor a scenario file Phase 1 writes is generated by: the split the engineer agreed, written
// by this script, as `/qa-sync` writes `script:qa-sync`.
const SPLIT_ACTOR = "script:qa-design";

// `--expand` and `--regenerate`, the modes besides a bare run's (lib/design-unit.mjs `designMode`).
/** @type {Record<string, OptionKind>} */
const MODE_FLAGS = { expand: "flag", regenerate: "flag" };

// The command line's `design <action>` (scripts/scan.mjs): each returns `{json, exit}`.
/** @type {CommandDefinition["actions"]} */
const ACTIONS = {
  state: {
    options: { root: "qa-dir", ...MODE_FLAGS, review: "flag" },
    usage: "<feature> [<scenario>] [--expand | --regenerate] [--review] [--root <qa-dir>]",
    /**
     * `design state`: the Feature's Rules, the project's roles and levels, design's
     * training, whether Phase 1 runs, and the empty scenario files needing agreed levels. cli.mjs resolves
     * the options before run: `root` is the `.qa/` directory the run takes.
     * @param {string[]} args
     * @param {CommandContext & { root: string, expand?: boolean, regenerate?: boolean, review?: boolean }} ctx
     * @returns {CommandResult}
     */
    run(args, { root, review, ...flags }) {
    const f = scope(args, "state", flags);
    if (f.refusal) return f.refusal;
    const ctx = loadFeature(root, f.slug);
    const halt = halted(ctx, f.slug);
    if (halt) return halt;
    const inScope = scoped(ctx, f);
    if (inScope.refusal) return inScope.refusal;
    const needsLevel = f.mode === "fill" ? inScope.filter((s) => s.status === "empty").map((s) => /** @type {string} */ (s.scenario)) : [];
    return {
      exit: 0,
      json: {
        ok: true,
        // Phase 1 runs only for a bare run over the whole Feature before any scenario file exists: a
        // single <scenario-key>, --expand and --regenerate all work on files that exist.
        phase1: ctx.scenarios.length === 0 && f.mode === "fill" && f.scenario === null,
        // A flagged run on a Feature with no scenario file has nothing to target: state recommends a
        // bare run instead of proposing an agreement or a plan.
        no_targets: ctx.scenarios.length === 0 && f.mode !== "fill",
        rules: ctx.rules,
        roles: ctx.roles,
        levels: ctx.levels,
        train: /** @type {TrainModule} */ (trainFor(ctx.index, DESIGN_TRAIN_KEY)),
        needs_level: needsLevel,
        ...(needsLevel.length && { level_question: levelQuestion(needsLevel, ctx.levels, summaries(ctx.index).scenario) }),
        coverage: coverageState(ctx, f.slug),
        ...settleScope(root, f.slug, { review }),
        ...linkScope(root, f.slug),
      },
    };
    },
  },

  agree: {
    options: { root: "qa-dir", stdin: "flag" },
    usage: "<scope> --stdin [--root <qa-dir>]",
    /**
     * `design agree`: the agreement bound. Reads the proposed agreement from `--stdin`, canonicalises
     * it with its computed basis, and returns the planned and actual coverage views, refusals and a
     * scoped run's reported Feature gaps. Nothing is written, in any outcome.
     * @param {string[]} args
     * @param {CommandContext & { root: string }} ctx
     * @returns {CommandResult}
     */
    run(args, { root, stdin }) {
      if (args.length !== 1) return refuse("bad_arguments", { action: "agree" });
      const scope = args[0];
      const read = readProposal(stdin, {
        missing: () => agreementRefused("agreement_not_json", "`design agree` reads the proposed agreement from --stdin, and none was given"),
        notJson: () => agreementRefused("agreement_not_json", "the proposed agreement is not JSON"),
        notObject: () => agreementRefused("agreement_not_json", "the proposed agreement must be a JSON object"),
      });
      if (read.refusal) return read.refusal;
      const proposal = read.proposal;
      const feature = proposal.feature;
      if (typeof feature !== "string" || !PATTERN.slug.test(feature)) return agreementRefused("agreement_feature", "the proposed agreement names no Feature key");
      if (proposal.scope !== scope) return agreementRefused("scope_mismatch", `the proposed agreement's scope is ${JSON.stringify(proposal.scope)}, not ${JSON.stringify(scope)}`);
      const ctx = loadFeature(root, feature);
      if (!ctx.feature) return agreementRefused("agreement_no_feature", `the knowledge layer holds no Feature \`${feature}\``);
      /** @type {AgreementResult} */
      const result = checkAgreement(ctx, proposal);
      return { exit: result.ok ? 0 : 1, json: result };
    },
  },

  split: {
    options: { root: "qa-dir", stdin: "flag", dir: "value", out: "dir-alias" },
    usage: "<feature> --stdin [--dir <run-dir>] [--root <qa-dir>]",
    /**
     * `design split`: records the canonical agreement `design agree` produced in a new run
     * directory. It refuses a stale basis before any write, mints every `new:N` scenario, writes the
     * new scenario files without a scenario-level field, recomputes the
     * basis over the written tree and writes `agreement.json`. A populated entry is assignment-only.
     * @param {string[]} args
     * @param {CommandContext & { root: string }} ctx
     * @returns {CommandResult}
     */
    run(args, { root, stdin, dir, seed }) {
      const newer = refuseUnreadSchema(root, LEVEL_ON_CASE_SCHEMA_VERSION);
      if (newer) return newer;
      const f = feature(args, "split");
      if (f.refusal) return f.refusal;
      const read = readProposal(stdin, {
        missing: () => refuse("no_split"),
        notJson: () => refuse("split_not_json"),
        notObject: () => agreementRefused("bad_proposal", "the agreement must be a JSON object"),
      });
      if (read.refusal) return read.refusal;
      const proposal = read.proposal;
      if (typeof proposal.feature !== "string" || !PATTERN.slug.test(proposal.feature)) {
        return agreementRefused("agreement_feature", "the agreement names no Feature key");
      }
      if (proposal.feature !== f.slug) {
        return agreementRefused("agreement_feature", `the agreement is for \`${proposal.feature}\`, not \`${f.slug}\``);
      }
      if (typeof proposal.scope !== "string" || !proposal.scope) {
        return agreementRefused("bad_proposal", "the agreement names no scope");
      }
      if (typeof proposal.basis !== "string" || !proposal.basis) {
        return agreementRefused("bad_proposal", "the agreement carries no basis: run `design agree` first");
      }
      const ctx = loadFeature(root, f.slug);
      const halt = halted(ctx, f.slug);
      if (halt) return halt;
      // The basis is the pre-write gate: a stale agreement must not even make its run directory.
      const stale = staleAgreement(ctx, /** @type {Agreement} */ (proposal));
      if (stale) return agreementRefused(stale.code, stale.message);
      /** @type {AgreementResult} */
      const checked = checkAgreement(ctx, proposal);
      if (!checked.ok || checked.agreement === null) return { exit: 1, json: checked };
      const canonical = checked.agreement;

      const fresh = Object.keys(canonical.scenarios).filter(isNewScenarioKey);
      const keys = fresh.length ? mint("ts", { count: fresh.length, root, seed }) : { keys: [] };
      if (keys.error) return refuse("mint_failed");
      /** @type {Map<string, string>} */
      const minted = new Map(fresh.map((key, index) => [key, /** @type {MintedKeys} */ (keys).keys[index]]));
      const run = newRunDir(dir, "qa-design-");
      if (run.error) return refuse("run_dir", { reason: run.error });
      const at = localDate();
      const config = rootConfig(ctx.root);
      /** @type {{ rel: string, text: string, entry: { scenario: string, summary: string | null, levels: string[], created: boolean } }[]} */
      const files = [];
      for (const [key, entry] of Object.entries(canonical.scenarios)) {
        if (isNewScenarioKey(key)) {
          const scenario = /** @type {string} */ (minted.get(key));
          const summary = /** @type {string} */ (entry.summary);
          const levels = entry.levels;
          const rel = `${/** @type {QaFile} */ (ctx.feature).dir}/${scenario}-${fileSlug(summary)}.md`;
          const r = scenarioFile(rel, { key: scenario, feature: f.slug, summary, at });
          // Every value in a scenario file comes from the project's own validated settings, so no
          // split can make one unwritable: a failure below is a fault in the framework, not a refusal.
          if (!r.ok) throw new Error(`design split: the new scenario file for ${scenario} cannot be built: ${r.message}`);
          files.push({ rel, text: r.text, entry: { scenario, summary, levels, created: true } });
          continue;
        }
      }
      for (const x of files) {
        const checkedFile = /** @type {CheckFileResult} */ (checkFile(/** @type {QaFile} */ (parse(x.rel, x.text)), config));
        if (!checkedFile.ok) throw new Error(`design split: ${x.rel} would not pass its check: ${checkedFile.errors.map((err) => err.message).join("; ")}`);
      }

      const made = (/** @type {{ make: () => string }} */ (run)).make();
      for (const x of files) writeFileSync(join(ctx.root, x.rel), backfill(ctx.root, x.rel, x.text));

      const written = files.map((x) => ({ ...x.entry, file: repoPath(ctx.root, x.rel) }));
      const agreement = remapAgreement(canonical, minted);
      agreement.basis = agreementBasis(loadFeature(root, f.slug), agreement.feature, agreement.scope);
      writeFileSync(join(made, "agreement.json"), `${JSON.stringify(/** @type {Agreement} */ (agreement), null, 2)}\n`);
      // `design report` still reads the files Phase 1 wrote from `split.json`; a run that wrote none
      // leaves only `agreement.json`.
      if (written.length) writeFileSync(join(made, "split.json"), `${JSON.stringify(/** @type {SplitRecord} */ ({ feature: f.slug, written }), null, 2)}\n`);
      return { exit: 0, json: { ok: true, dir: made, agreement: join(made, "agreement.json") } };
    },
  },

  override: {
    options: { stdin: "flag", dir: "value", out: "dir-alias" },
    usage: "--stdin [--dir <run-dir>]",
    /**
     * `design override`: the engineer's reason that a proposal repeating a stored case is a
     * distinct pass. Reads `{"<Key of the stored case>": "<reason>"}` and records it in the
     * run dir's `overrides.json` (making the dir, or adding to the one `--dir` names), so the next
     * `design plan --dir` carries it into each unit's brief and the writer lets a proposal that
     * repeats that case through, recorded as the engineer's.
     * @param {string[]} args
     * @param {CommandContext} ctx
     * @returns {CommandResult}
     */
    run(args, { stdin, dir: named }) {
      if (args.length !== 0) return refuse("bad_arguments", { action: "override" });
      const read = readProposal(stdin, { missing: () => refuse("no_override"), notJson: () => refuse("bad_override"), notObject: () => refuse("bad_override") });
      if (read.refusal) return read.refusal;
      const reasons = Object.entries(read.proposal);
      if (reasons.length === 0 || reasons.some(([key, reason]) => !PATTERN.case.test(key) || typeof reason !== "string" || reason.trim() === "")) return refuse("bad_override");
      const run = newRunDir(named, "qa-design-");
      if (run.error) return refuse("run_dir", { reason: run.error });
      const made = (/** @type {{ make: () => string }} */ (run)).make();
      const held = readOverrides(made);
      if (held.error) return refuse("run_dir", { reason: held.error });
      const overrides = { ...held.overrides, ...Object.fromEntries(reasons.map(([key, reason]) => [key, /** @type {string} */ (reason).replace(/\s+/g, " ").trim()])) };
      writeFileSync(join(made, OVERRIDES), `${JSON.stringify({ v: 1, overrides }, null, 2)}\n`);
      return { exit: 0, json: { ok: true, dir: made, overrides } };
    },
  },

  plan: {
    options: { root: "qa-dir", dir: "value", out: "dir-alias", ...MODE_FLAGS },
    usage: "<feature> [<scenario>] [--expand | --regenerate] [--dir <run-dir>] [--root <qa-dir>]",
    /**
     * `design plan` (Phase 2): one design unit per targeted scenario file, its brief and the units for
     * `delegate start` written to the run directory. When `--dir` holds the agreement `design split`
     * recorded, each unit's action and obligations come from its entry, and a stale basis refuses
     * the plan before anything is written.
     * @param {string[]} args
     * @param {CommandContext & { root: string, expand?: boolean, regenerate?: boolean }} ctx
     * @returns {CommandResult}
     */
    run(args, { root, dir: named, env, ...flags }) {
    const f = scope(args, "plan", flags);
    if (f.refusal) return f.refusal;
    const run = newRunDir(named, "qa-design-");
    if (run.error) return refuse("run_dir", { reason: run.error });
    const ctx = loadFeature(root, f.slug);
    const halt = halted(ctx, f.slug);
    if (halt) return halt;
    const inScope = scoped(ctx, f);
    if (inScope.refusal) return inScope.refusal;
    // The agreement is a pre-write gate too: a corrupt or stale one refuses before the run dir is made.
    const agreed = runAgreement(named);
    if (agreed.refusal) return agreed.refusal;
    const agreement = agreed.agreement;
    if (agreement !== null && agreement.feature !== f.slug) {
      return agreementRefused("agreement_feature", `the run's agreement is for \`${agreement.feature}\`, not \`${f.slug}\``);
    }
    if (agreement !== null) {
      const expectedScope = f.scenario ?? "feature";
      if (agreement.scope !== expectedScope) {
        return agreementRefused("agreement_scope", `the run's agreement is for scope ${JSON.stringify(agreement.scope)}, not ${JSON.stringify(expectedScope)}: run \`design agree ${expectedScope}\` again`, { scope: agreement.scope, expected: expectedScope });
      }
      const stale = staleAgreement(ctx, agreement);
      if (stale) return agreementRefused(stale.code, stale.message);
      const refusedTarget = agreementTargetsRefused(inScope, agreement, f.mode);
      if (refusedTarget) return refusedTarget;
    }
    // Every refusal is above: the run dir is made only now, so a refused plan leaves none.
    const dir = (/** @type {{ make: () => string }} */ (run)).make();
    /** @type {PlanUnit[]} */
    const units = [];
    /** @type {PlanSkip[]} */
    const skipped = [];
    const onlyUncoveredRulesAreWaived = f.mode === "expand" && uncoveredRulesAreWaived(ctx);
    const stated = readOverrides(dir);
    if (stated.error) return refuse("run_dir", { reason: stated.error });
    for (const s of inScope) {
      const entry = agreement !== null && s.scenario !== null ? agreement.scenarios[s.scenario] : undefined;
      // With an agreement, the run touches only the scenarios it names; one it leaves out keeps its
      // cases and is reported, never silently regenerated.
      if (agreement !== null && s.scenario !== null && entry === undefined) {
        skipped.push({ scenario: s.scenario, file: repoPath(ctx.root, s.file), status: s.status, reason: "not_agreed", ...(s.problems && { problems: s.problems }) });
        continue;
      }
      const target = planTarget(s, f.mode, entry, onlyUncoveredRulesAreWaived);
      if (target.reason !== undefined) {
        skipped.push({ scenario: /** @type {string} */ (s.scenario), file: repoPath(ctx.root, s.file), status: s.status, reason: target.reason, ...(s.problems && { problems: s.problems }) });
        continue;
      }
      // A target is a file `designUnit` accepts: it is in scope, has Rules, is not excluded and suits
      // its action. The action is the mode's, unless the agreement names another one for this run.
      units.push(writeUnit(
        dir,
        ctx,
        /** @type {{ json: DesignBrief }} */ (designUnit(/** @type {string} */ (s.scenario), { root, mode: target.action, context: ctx, agreement, agreementBrief: agreementBriefPosition(env) })).json,
        target.action,
        entry?.obligations ?? [],
        stated.overrides,
      ));
    }
    /** @type {DesignPlan} */
    const plan = { root, dir, feature: f.slug, mode: f.mode, scenario: f.scenario, rules_in: ctx.rules.length, units, skipped };
    writeFileSync(join(dir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
    writeFileSync(join(dir, "dispatch.spec.json"), `${JSON.stringify(dispatchSpec(plan), null, 2)}\n`);
    return { exit: 0, json: { ok: true, dir, units: units.length } };
    },
  },

  report: {
    options: { dir: "value" },
    usage: "--dir <run-dir>",
    /**
     * `design report`: the closing summary from the run directory (`--dir`), as
     * lib/design-json.mjs `reportData` words it.
     * @param {string[]} args
     * @param {{ dir?: string }} ctx
     * @returns {CommandResult}
     */
    run(args, { dir: named }) {
      if (args.length !== 0) return refuse("bad_arguments", { action: "report" });
      // The run dir's `plan.json`, read under the plan contract (lib/run-dir.mjs `openPlan`).
      /** @type {OpenPlanResult<DesignPlan>} */
      const { dir, plan, error } = openPlan("design", "report", args, named);
      if (error) return refuse("run_dir", { reason: error });
      const intended = runAgreement(/** @type {string} */ (dir));
      if (intended.refusal) return intended.refusal;
      return {
        exit: 0,
        json: report(
          /** @type {string} */ (dir),
          /** @type {DesignPlan} */ (plan),
          /** @type {DispatchReadback | null} */ (readDispatch(/** @type {string} */ (dir))),
          intended.agreement ?? null,
        ),
      };
    },
  },

  // The walk, triage, Card page and page-reply: the settle engine (lib/settle-walk.mjs) that
  // `/qa-impact` runs too, over the run dir `impact plan` and `impact persist` made.
  ...SETTLE_ACTIONS,
  ...DESIGN_SETTLE_ACTIONS,
};

// Every refusal is `design`'s own, its usage errors included.
/**
 * The command line's `design` (scripts/scan.mjs): its `refuse` words every usage error the registry
 * raises with one of the run's own refusal codes, the error's detail included.
 * @type {CommandDefinition}
 */
export const command = { actions: ACTIONS, refuse: (e) => refuse(/** @type {string} */ (e.detail.code), e.detail) };

// A proposal `design agree` or `design split` cannot even read: exit 1, one `{code, message}`
// refusal and no write. `data` adds the detail a plan's agreement refusal names.
/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 * @returns {CommandResult}
 */
const agreementRefused = (code, message, data = {}) => ({ exit: 1, json: { ok: false, refusals: [{ code, message, ...data }] } });

// A proposed agreement read from `--stdin`, shared by `design agree` and `design split`: each mode
// supplies its own refusal messages, so their codes stay as they were.
/**
 * @param {(() => string) | null | undefined} stdin
 * @param {{ missing: () => CommandResult, notJson: () => CommandResult, notObject: () => CommandResult }} refusals
 * @returns {{ proposal: Record<string, unknown>, refusal?: undefined } | { refusal: CommandResult, proposal?: undefined }}
 */
function readProposal(stdin, refusals) {
  if (!stdin) return { refusal: refusals.missing() };
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(stdin());
  } catch {
    return { refusal: refusals.notJson() };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { refusal: refusals.notObject() };
  return { proposal: /** @type {Record<string, unknown>} */ (parsed) };
}

// The agreement with every `new:N` scenario key replaced by the `ts_` Key split minted. Only the
// structural scenario slots change: the `scenarios` keys, `retained`'s scenario lists and `scope`.
/**
 * @param {Agreement} agreement
 * @param {Map<string, string>} minted
 * @returns {Agreement}
 */
function remapAgreement(agreement, minted) {
  /** @type {Agreement["scenarios"]} */
  const scenarios = {};
  for (const [key, entry] of Object.entries(agreement.scenarios)) scenarios[minted.get(key) ?? key] = entry;
  /** @type {Record<string, string[]>} */
  const retained = {};
  for (const [rule, keys] of Object.entries(agreement.retained)) retained[rule] = keys.map((key) => minted.get(key) ?? key);
  return { ...agreement, scope: minted.get(agreement.scope) ?? agreement.scope, scenarios, retained };
}

// The one `<feature>` argument, a Feature key: `{slug}`, or `{refusal}`.
/**
 * @param {string[]} args
 * @param {string} action
 * @returns {{ refusal?: undefined, slug: string } | { refusal: RefusalResult, slug?: undefined }}
 */
function feature(args, action) {
  if (args.length !== 1) return { refusal: refuse("bad_arguments", { action }) };
  if (!PATTERN.slug.test(args[0])) return { refusal: refuse("not_feature_key", { given: args[0] }) };
  return { slug: args[0] };
}

// A Feature with no Rules halts the command before anything is written: raw requirements never
// slide into generation. The handoff is the refusal's `next`: /qa-deep-dive.
/**
 * @param {FeatureContext} ctx
 * @param {string} slug
 * @returns {import("./cli.mjs").CommandResult | null}
 */
function halted(ctx, slug) {
  if (!ctx.feature) return refuse("no_feature", { slug, next: `/qa-deep-dive ${slug}` }, 1);
  if (!ctx.rules.length) return refuse("no_rules", { slug, feature: keyLabel(slug, summaries(ctx.index).feature(slug)), next: `/qa-deep-dive ${slug}` }, 1);
  return null;
}

// The Coverage standing `design state` reports: the actual view derived from `covers`, its compact
// Markdown, whether the Feature has a `## Coverage` section, the trigger `/qa-next`'s predicate
// found, and the deep dive that settles a legacy or due Feature. A legacy Feature keeps the actual
// view but says its category coverage was never assessed.
/**
 * @param {FeatureContext} ctx
 * @param {string} slug
 * @returns {StateCoverage}
 */
function coverageState(ctx, slug) {
  const views = coverageViews(ctx, slug, null);
  const featureFile = ctx.feature;
  const assessed = featureFile !== null && parseCoverage(featureFile.text ?? "") !== null;
  const due = featureFile === null ? null : coverageDue(featureFile, effectiveCategories(ctx.root));
  return {
    views: views.actual,
    markdown: assessed ? views.markdown : `Category coverage not assessed: the Feature has no \`## Coverage\` section.\n\n${views.markdown}`,
    assessed,
    due,
    next_step: due === null ? null : `/qa-deep-dive ${slug}`,
  };
}

// `<feature-key> [<scenario-key>]` and the mode the flags name: `{slug, scenario, mode}`, or
// `{refusal}`.
/**
 * @param {string[]} args
 * @param {string} action
 * @param {{ expand?: boolean, regenerate?: boolean }} flags
 * @returns {{ slug: string, scenario: string | null, mode: DesignMode, refusal?: undefined } | { refusal: RefusalResult, slug?: undefined, scenario?: undefined, mode?: undefined }}
 */
function scope(args, action, flags) {
  if (args.length < 1 || args.length > 2) return { refusal: refuse("bad_arguments", { action }) };
  if (!PATTERN.slug.test(args[0])) return { refusal: refuse("not_feature_key", { given: args[0] }) };
  const m = designMode(flags);
  if (m.error) return { refusal: refuse("expand_and_regenerate") };
  return { slug: args[0], scenario: args[1] ?? null, mode: /** @type {DesignMode} */ (m.mode) };
}

// The Feature's scenario files a run is scoped to: all of them, or the one `<scenario-key>` names.
// A list of them, or `{refusal}`.
/**
 * @param {FeatureContext} ctx
 * @param {{ slug: string, scenario: string | null }} scope
 * @returns {ScenarioState[] & { refusal?: RefusalResult }}
 */
function scoped(ctx, { slug, scenario }) {
  if (scenario === null) return ctx.scenarios;
  const s = ctx.scenarios.filter((x) => x.scenario === scenario);
  return /** @type {ScenarioState[] & { refusal?: RefusalResult }} */ (s.length ? s : { refusal: refuse("no_scenario", { scenario, feature: keyLabel(slug, summaries(ctx.index).feature(slug)) }) });
}

// The actions an agreement may give a scenario in a run of `mode`: a bare or expand run fills and
// expands, while only a regenerate run regenerates. An entry naming another action is not this
// run's, so the mode keeps its own target.
/** @type {Record<DesignMode, readonly DesignMode[]>} */
const AGREED_ACTIONS = {
  fill: ["fill", "expand"],
  expand: ["fill", "expand"],
  regenerate: ["fill", "expand", "regenerate"],
};

// One scenario file as this run targets it, with the action it is a unit of. A bare run fills the
// empty files; the wanted levels are recorded in the agreement
// (`split` with `{key, levels}`). `--expand` targets populated files, and `--regenerate` those holding
// a case it may replace. An agreement entry's action replaces the mode's, so an expand run fills a
// confirmed new scenario and a regenerate run expands a target with gap work; `agreementTargetsRefused`
// has already refused every entry whose action or file does not fit. `{reason}` instead when the file
// is no unit.
/**
 * @param {ScenarioState} s
 * @param {DesignMode} mode
 * @param {AgreementScenario | undefined} entry
 * @param {boolean} onlyUncoveredRulesAreWaived
 * @returns {{ action: DesignMode, reason?: undefined } | { action?: undefined, reason: string }}
 */
function planTarget(s, mode, entry, onlyUncoveredRulesAreWaived) {
  const action = entry?.action ?? mode;
  if (s.status === "excluded") return { reason: s.reason };
  // An agreed expand with assigned Rules is work the run promised: it never drops to the waived-only
  // skip, which keeps today's expand targets for a run with nothing to cover.
  const agreedWork = entry?.action === "expand" && entry.rules.length > 0;
  if (action === "expand" && onlyUncoveredRulesAreWaived && !agreedWork) return { reason: "waived_only" };
  const refusal = modeRefusal(action, s);
  if (refusal !== null) return { reason: refusal };
  return { action };
}

// The first agreement entry this run cannot honour, or null when every entry for an in-scope scenario
// fits it. An entry's action must be one the run's mode allows, and its file must take that action;
// either mismatch refuses the whole plan, because the agreement promised work there and a skip would
// drop it silently. A scenario no entry names is skipped as `not_agreed`: with an agreement, only the
// scenarios it names are units.
/**
 * @param {ScenarioState[]} scenarios
 * @param {Agreement} agreement
 * @param {DesignMode} mode
 * @returns {CommandResult | null}
 */
function agreementTargetsRefused(scenarios, agreement, mode) {
  for (const s of scenarios) {
    if (s.scenario === null) continue;
    const entry = agreement.scenarios[s.scenario];
    if (entry === undefined) continue;
    const data = { scenario: s.scenario, action: entry.action, mode };
    if (!/** @type {readonly string[]} */ (AGREED_ACTIONS[mode]).includes(entry.action)) {
      return agreementRefused("agreement_mode", `the agreement gives \`${s.scenario}\` the action \`${entry.action}\`, which a \`${mode}\` run does not run: run \`design agree\` again`, data);
    }
    const reason = modeRefusal(entry.action, s);
    if (reason !== null) {
      return agreementRefused("agreement_target", `the agreement gives \`${s.scenario}\` the action \`${entry.action}\`, which its file cannot take: run \`design agree\` again`, { ...data, reason });
    }
  }
  return null;
}

// The agreement `design plan` and `design report` read from a run directory, or null when it holds
// none (the legacy call path). A corrupt file is a refusal naming the run to restart, never an
// empty agreement.
/**
 * @param {string | undefined} named
 * @returns {{ agreement: Agreement | null, refusal?: undefined } | { agreement?: undefined, refusal: CommandResult }}
 */
function runAgreement(named) {
  if (named === undefined) return { agreement: null };
  const dir = resolve(named);
  if (!existsSync(join(dir, "agreement.json"))) return { agreement: null };
  try {
    return { agreement: readAgreement(dir) };
  } catch (e) {
    return { refusal: agreementRefused("bad_agreement", e instanceof Error ? e.message : String(e)) };
  }
}

// A Feature with only Waived coverage gaps has nothing for `--expand` to cover. Keep the existing
// expand targets when every Rule is already covered, since those runs can add useful permutations.
/**
 * @param {FeatureContext} ctx
 * @returns {boolean}
 */
function uncoveredRulesAreWaived(ctx) {
  const covered = new Set(ctx.files
    .filter((file) => !file.unreadable && file.type === "scenario" && ctx.index.featureOf(file) === ctx.feature?.data.key)
    .flatMap((file) => file.cases.flatMap((entry) => listOf(entry.data.covers))));
  const uncovered = ctx.rules.filter((rule) => !covered.has(rule.key));
  return uncovered.length > 0 && uncovered.every((rule) => Boolean(rule.waiver));
}

// A path under `.qa/` as the repository under test sees it.
/**
 * @param {string} root
 * @param {string} rel
 * @returns {string}
 */
function repoPath(root, rel) {
  return relative(dirname(root), join(root, rel)).split(sep).join("/");
}

// A filename slug from a summary; the filename carries the Key for humans only.
/**
 * @param {string} summary
 * @returns {string}
 */
function fileSlug(summary) {
  const s = summary.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (s.length > 60 ? s.slice(0, 60).replace(/-[^-]*$/, "") : s) || "scenario";
}

// A new, empty scenario file at `rel`: the H1, no case entry (lib/knowledge-file.mjs
// `edit`'s result).
/**
 * @param {string} rel
 * @param {{ key: string, feature: string, summary: string, at: string }} file
 * @returns {EditResult}
 */
function scenarioFile(rel, { key, feature, summary, at }) {
  return /** @type {EditResult} */ (edit(parse(rel, ""), [{ set: { type: "scenario", key, feature, generated: { by: SPLIT_ACTOR, at } } }, { append: `# ${key}: ${summary}` }]));
}


// One design unit's files in the run directory, and its entry in the plan, with the action its mode
// gave it and the agreement's obligations (empty without an agreement).
/**
 * @param {string} dir
 * @param {FeatureContext} ctx
 * @param {DesignBrief} json
 * @param {DesignMode} action
 * @param {string[]} obligations
 * @param {Record<string, string>} [overrides] - the engineer's reasons (`design override`), carried into the brief
 * @returns {PlanUnit}
 */
function writeUnit(dir, ctx, json, action, obligations, overrides = {}) {
  const name = json.scenario.replace(/[^A-Za-z0-9_.-]/g, "_");
  const briefJson = join(dir, `${name}.brief.json`);
  const briefText = join(dir, `${name}.brief.md`);
  // The engineer's reasons ride in the brief: the writer reads them from its JSON, and the Delegate
  // reads them in its text, so it can propose the case they excuse.
  const stated = Object.entries(overrides);
  if (stated.length) {
    const text = `${json.brief}\n## The engineer's reasons\n\nThe engineer states why each of these stored cases may be repeated by a distinct pass. Propose that pass when its reason applies; it is written as it stands.\n\n${stated.map(([key, reason]) => `- \`${key}\`: ${reason}`).join("\n")}\n`;
    json = { ...json, brief: text, brief_bytes: Buffer.byteLength(text), overrides };
  }
  // `<key>.brief.json`, `check-reply design --brief`'s input, under the brief contract.
  writeFileSync(briefJson, `${JSON.stringify(/** @type {DesignBrief} */ ({ mode: "brief", .../** @type {Partial<DesignBrief>} */ (json) }), null, 2)}\n`);
  writeFileSync(briefText, json.brief);
  // The unit's file is the brief's own scenario file, which `designUnit` built the brief from.
  const cases = /** @type {QaFile} */ (ctx.files.find((f) => f.rel === json.file)).cases;
  return {
    feature: json.feature,
    scenario: json.scenario,
    file: repoPath(ctx.root, json.file),
    wanted_levels: json.wanted_levels,
    action,
    obligations,
    cases_total: json.cases_total,
    // The cases a regenerate replaces, with their summaries: the report names them after they are gone.
    replace: json.replace.map((key) => ({ key, summary: /** @type {CaseEntry} */ (cases.find((c) => c.key === key)).summary })),
    brief_bytes: json.brief_bytes,
    brief: briefText,
    brief_json: briefJson,
    reply: join(dir, `${name}.reply.md`),
    written: join(dir, `${name}.written.json`),
  };
}

// The units as the delegation layer takes them: each design unit's brief, where its reply goes, and
// the design contract it is checked against, which writes its usable reply to `written`.
/**
 * @param {DesignPlan} plan
 * @returns {DispatchSpec}
 */
function dispatchSpec(plan) {
  return {
    v: 1,
    cmd: "design",
    root: resolve(plan.root),
    feature: plan.feature,
    target: null,
    units: plan.units.map((u) => ({ id: u.scenario, feature: u.feature, scenario: u.scenario, brief: u.brief, reply: u.reply, contract: { kind: "design", brief_json: u.brief_json, written: u.written } })),
  };
}

// The engineer's reasons the run dir holds (`design override`): by the Key of the stored case each
// excuses a repeat of. `{overrides}` (empty when none), or `{error}` for a file that is not that.
const OVERRIDES = "overrides.json";
/**
 * @param {string} dir
 * @returns {{ overrides: Record<string, string>, error?: undefined } | { error: string, overrides?: undefined }}
 */
function readOverrides(dir) {
  const path = join(dir, OVERRIDES);
  if (!existsSync(path)) return { overrides: {} };
  try {
    const held = JSON.parse(readFileSync(path, "utf8"));
    const overrides = held?.overrides;
    if (overrides !== null && typeof overrides === "object" && !Array.isArray(overrides) && Object.values(overrides).every((reason) => typeof reason === "string")) return { overrides };
  } catch {
    // Falls through to the error below.
  }
  return { error: `${path} is not the engineer's reasons \`design override\` writes: remove it, or start a fresh run dir` };
}

// A JSON file a Run dir holds, `null` when it cannot be read; each read names its contract.
/**
 * @param {string} path
 * @returns {unknown}
 */
const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

// The closing summary as data (lib/design-json.mjs `reportData`).
/**
 * @param {string} dir
 * @param {DesignPlan} plan
 * @param {DispatchReadback | null} dispatch
 * @param {Agreement | null} agreement
 * @returns {DesignReportJson}
 */
function report(dir, plan, dispatch, agreement) {
  const failures = new Map((dispatch?.failed ?? []).map((f) => [f.unit, f]));
  /** @type {ReportProposed[]} */
  const proposed = [];
  /** @type {AgreementProposedRule[]} */
  const awaitingProposals = [];
  /** @type {Map<string, UnitOutcome>} */
  const outcomes = new Map();
  // A plan unit's own action (lib/design-unit.mjs `designMode`), which an agreement may mix inside
  // one run. A legacy plan records none, so its reruns keep the run's mode.
  /** @type {Map<string, DesignMode>} */
  const actions = new Map(plan.units.map((u) => [u.scenario, /** @type {DesignMode | undefined} */ (u.action) ?? plan.mode]));
  /** @type {ReportScenario[]} */
  const scenarios = plan.units.map((u) => {
    const w = /** @type {WrittenRecord | null} */ (readJson(u.written));
    const entry = { scenario: u.scenario, file: u.file };
    // A usable reply names its proposed Rules (design-contract.mjs), handed on whether or not its
    // cases were written.
    const brief = /** @type {DesignBrief | null} */ (readJson(u.brief_json));
    const reply = existsSync(u.reply) ? readFileSync(u.reply, "utf8") : null;
    const checked = brief && reply !== null ? /** @type {DesignResult} */ (checkReply("design", reply, brief)) : null;
    for (const p of checked?.usable ? /** @type {DesignProposedRule[]} */ (checked.proposed_rules) : []) proposed.push({ scenario: u.scenario, ...p });
    // A proposal-only reply writes nothing and is a hand-off to the deep dive, never a design retry.
    if (w?.outcome === "awaiting_rules") {
      outcomes.set(u.scenario, "awaiting");
      for (const p of w.proposals ?? []) awaitingProposals.push(p);
      return { ...entry, status: "awaiting_rules", cases_written: 0, proposals: w.proposals ?? [] };
    }
    if (w?.written) {
      outcomes.set(u.scenario, "written");
      return { ...entry, status: "written", cases_written: w.cases_written, cases: w.keys, not_automatable: w.not_automatable ?? [], replaced: w.replaced ? u.replace : [], ...(w.overridden && { overridden: w.overridden }), ...(w.duplicates && { duplicates: w.duplicates }), ...(w.dropped_labels && { dropped_labels: w.dropped_labels }), ...(w.lost_labels && { lost_labels: w.lost_labels }) };
    }
    // A record that wrote nothing names its reason and its problems (lib/design-write.mjs `refused`).
    if (w) {
      outcomes.set(u.scenario, "failed");
      return { ...entry, status: "not_written", cases_written: 0, reason: /** @type {"io" | "missing" | "changed" | "duplicate"} */ (w.reason), problems: /** @type {string[]} */ (w.problems), ...(w.duplicates && { duplicates: w.duplicates }) };
    }
    const f = failures.get(u.scenario);
    const kind = f?.kind ?? "not_dispatched";
    // A unit the dispatch never attempted and one still out are deferred to a later run; one that
    // attempted and delivered nothing failed.
    outcomes.set(u.scenario, kind === "not_dispatched" || kind === "in_flight" ? "deferred" : "failed");
    return { ...entry, status: "failed", cases_written: 0, kind, attempts: f?.attempts ?? 0, problems: f?.problems ?? [] };
  });

  const ctx = loadFeature(plan.root, plan.feature);
  // An awaiting unit is not "still empty": its file waits on /qa-deep-dive, not on another fill.
  const stillEmpty = ctx.scenarios.filter((s) => s.status === "empty" && outcomes.get(/** @type {string} */ (s.scenario)) !== "awaiting").map((s) => ({ scenario: /** @type {string} */ (s.scenario), file: repoPath(ctx.root, s.file), needs_level: !agreement?.scenarios[/** @type {string} */ (s.scenario)]?.levels.length }));
  const changed = scenarios.filter((s) => s.status === "written" && (s.cases_written > 0 || s.replaced.length));
  const knowledge = [...new Set([
    ...(agreement !== null ? agreementPaths(ctx, plan, agreement, scenarios) : (/** @type {SplitRecord | null} */ (readJson(join(dir, "split.json")))?.written ?? []).map((w) => w.file)),
    ...changed.map((s) => s.file),
  ])];
  const paths = knowledge;
  const mode = plan.mode;
  const flags = mode === "fill" ? [] : [`--${mode}`];
  // A bare re-run fills only what is still empty. An expand or regenerate re-run is not
  // idempotent (a second expand adds again, a second regenerate redoes this run's cases), so it
  // is offered per file whose unit wrote nothing, never over the whole Feature. Each rerun takes
  // its own unit's action, never the run's: a fill unit in an expand run needs no flag. An
  // awaiting unit is re-offered its prerequisite instead: /qa-deep-dive, never a design rerun.
  const reruns = scenarios.flatMap((s) => {
    if (s.status === "awaiting_rules") return [{ scenario: s.scenario, command: `/qa-deep-dive ${plan.feature}` }];
    if (s.status === "written") return [];
    const action = actions.get(s.scenario) ?? mode;
    if (mode === "fill" && action === "fill") return [];
    const actionFlags = action === "fill" ? [] : [`--${action}`];
    return [{ scenario: s.scenario, command: ["/qa-design", plan.feature, s.scenario, ...actionFlags].join(" ") }];
  });
  return reportData(
    {
      feature: plan.feature,
      mode,
      dispatched: plan.units.length > 0,
      delegate: dispatch?.delegates,
      scenarios,
      missing_levels: agreement === null ? [] : Object.entries(agreement.scenarios).flatMap(([scenario, entry]) => {
        const state = ctx.scenarios.find((s) => s.scenario === scenario);
        return entry.levels.filter((level) => !state?.levels.includes(level)).map((level) => ({ code: "agreed_level_without_cases", scenario, level, file: state ? repoPath(ctx.root, state.file) : "" }));
      }),
      skipped: plan.skipped,
      cases_written: scenarios.reduce((n, s) => n + s.cases_written, 0),
      proposed_rules: proposed,
      handoff: `/qa-deep-dive ${plan.feature}`,
      still_empty: stillEmpty,
      rerun: mode === "fill" && stillEmpty.length ? ["/qa-design", plan.feature, ...flags].join(" ") : null,
      reruns,
      run_health: dispatch && { run: dispatch.run, calls: dispatch.calls, announcements: dispatch.announcements, retried: dispatch.retried, notes: dispatch.notes },
      changeset: {
        paths,
        commit: paths.length ? commitLine(paths, `qa(${plan.feature}): /qa-design${mode === "fill" ? "" : ` --${mode}`}`) : null,
      },
      ...(agreement === null ? {} : {
        declared_coverage: declaredCoverage(ctx, plan, agreement, outcomes),
        handoffs: reportHandoffs(agreement, awaitingProposals),
      }),
    },
    summaries(ctx.index),
  );
}

// The scenario files the agreement's in-scope entries account for: the ones split wrote (an empty
// target, including a new file, that no write filled) and the ones a unit changed. A populated
// target the run left alone is never in the changeset.
/**
 * @param {FeatureContext} ctx
 * @param {DesignPlan} plan
 * @param {Agreement} agreement
 * @param {ReportScenario[]} scenarios
 * @returns {string[]}
 */
function agreementPaths(ctx, plan, agreement, scenarios) {
  /** @type {string[]} */
  const out = [];
  for (const key of Object.keys(agreement.scenarios)) {
    if (plan.scenario !== null && key !== plan.scenario) continue;
    const state = ctx.scenarios.find((s) => s.scenario === key);
    const unit = plan.units.find((u) => u.scenario === key);
    if (state === undefined || unit === undefined) continue;
    const wrote = scenarios.some((s) => s.scenario === key && s.status === "written" && (s.cases_written > 0 || s.replaced.length));
    if (wrote || unit.cases_total === 0) out.push(repoPath(ctx.root, state.file));
  }
  return out;
}

// The execution bound (ADR-0042): every in-scope obligation with whether a case in that scenario's
// file now names its Rule. A scoped run checks only its own scenario, and a kept case elsewhere is
// never evidence for this scenario's obligation.
/**
 * @param {FeatureContext} ctx
 * @param {DesignPlan} plan
 * @param {Agreement} agreement
 * @param {Map<string, UnitOutcome>} outcomes
 * @returns {DeclaredCoverage}
 */
function declaredCoverage(ctx, plan, agreement, outcomes) {
  const scenarios = Object.entries(agreement.scenarios)
    .filter(([key]) => plan.scenario === null || key === plan.scenario)
    .map(([scenario, entry]) => {
      const covered = scenarioCoveredRules(ctx, scenario);
      return {
        scenario,
        action: entry.action,
        obligations: (entry.obligations ?? []).map((rule) => ({ rule, outcome: declaredOutcome(rule, covered, outcomes.get(scenario)) })),
      };
    });
  return { label: "declared coverage", scenarios, markdown: declaredMarkdown(scenarios) };
}

// One obligation's outcome: evidence first, then why the unit left none.
/**
 * @param {string} rule
 * @param {Set<string>} covered
 * @param {UnitOutcome | undefined} outcome
 * @returns {DeclaredOutcome}
 */
function declaredOutcome(rule, covered, outcome) {
  if (covered.has(rule)) return "covered";
  if (outcome === undefined || outcome === "deferred") return "deferred";
  if (outcome === "awaiting") return "awaiting";
  if (outcome === "written") return "omitted";
  return "failed";
}

// Every Rule a stored case in one scenario's file names.
/**
 * @param {FeatureContext} ctx
 * @param {string} scenario
 * @returns {Set<string>}
 */
function scenarioCoveredRules(ctx, scenario) {
  const state = ctx.scenarios.find((s) => s.scenario === scenario);
  const file = state === undefined ? undefined : ctx.files.find((f) => f.rel === state.file);
  /** @type {Set<string>} */
  const covered = new Set();
  for (const entry of file?.cases ?? []) for (const rule of listOf(entry.data.covers)) covered.add(rule);
  return covered;
}

// The per-scenario declared-coverage table the CLI renders (ADR-0024).
/**
 * @param {{ scenario: string, action: string, obligations: { rule: string, outcome: DeclaredOutcome }[] }[]} scenarios
 * @returns {string | null}
 */
function declaredMarkdown(scenarios) {
  const rows = scenarios.flatMap((s) => (s.obligations.length
    ? s.obligations.map((o) => [s.scenario, s.action, o.rule, o.outcome])
    : [[s.scenario, s.action, null, null]]));
  return table(["Scenario", "Action", "Rule", "Outcome"], rows);
}

// The agreement's pre-dispatch hand-offs plus each awaiting unit's proposals.
/**
 * @param {Agreement} agreement
 * @param {AgreementProposedRule[]} awaiting
 * @returns {ReportHandoffs}
 */
function reportHandoffs(agreement, awaiting) {
  const proposed = [...agreement.handoffs.proposed_rules, ...awaiting].map((p) => ({ statement: p.statement, ...(p.why === undefined ? {} : { why: p.why }) }));
  return { proposed_rules: proposed, coverage_corrections: [...agreement.handoffs.coverage_corrections] };
}
