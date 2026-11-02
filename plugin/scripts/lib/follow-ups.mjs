// @ts-check
// The follow-up work list of a completed Run, `<run>/follow-ups.json`, and the summary of what its
// follow-ups did.
//
// `execute follow-ups --dir <run-dir>` is the only creator of the file. It reads the frozen plan and
// the ingested record, builds one item per Automation that needs a fix and one per case that needs a
// bug, and on its first call takes the dirty-tree snapshot. Every later call returns the file as it
// stands, so a crash or a stop resumes exactly where it was. Only the CLI changes an item's `state`.
//
// Routing (the follow-ups decision):
//   - a Flaky Automation is fix-routed whatever its cases show;
//   - a Failed Automation is fix-routed only when every case it covers passed its Execution;
//   - when one covered case failed its Execution there is no fix (the app bug takes precedence) and
//     that case gets a bug item;
//   - when a covered case is blocked, skipped or not run, and none failed, the Automation is
//     unresolved: no fix and no bug.
// A case whose Execution failed gets a bug item, whether or not it has Automations.
//
// The resume order is fixed: `/qa-codefix --run <dir>` while fix work remains, otherwise
// `/qa-bug --run <dir>`. Fix work remains while a fix item is `pending` or `in-progress`, or one is
// `done` without a recorded PR in PR or branch mode.
//
// `execute summary --dir <run-dir>` is read-only and untruncated: it reports what the follow-ups did,
// where the fixes are, the drafts awaiting publish and what still needs resuming. It prints nothing
// (its `text` is null) when the work list is empty.
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { noArguments, orThrow } from "./cli.mjs";
import { scrubRecordText } from "./credentials.mjs";
import { worstAutomationResult } from "./execute-chain.mjs";
import { uncommittedUnder } from "./git.mjs";
import { hasBugPublishTracker, parse } from "./knowledge-file.mjs";
import { repositoryOf } from "./git-tree.mjs";
import { openRunDir } from "./run-dir.mjs";
import { plannedRun } from "./execute-open.mjs";
import { readPlan } from "./execute-blocks.mjs";
import { refusalsFor } from "./refusal.mjs";
import { loadWorkingTree } from "./qa-index.mjs";

/**
 * @import { CommandAction, CommandContext, CommandResult } from "./cli.mjs"
 * @import { ParsedFile, ParsedEntry } from "./knowledge-file.mjs"
 * @import { ExecutePlan } from "./execute.mjs"
 */

/**
 * One Automation that needs a code fix.
 * @typedef {{
 *   id: string,
 *   kind: "fix",
 *   automation: string,
 *   file: string,
 *   cases: string[],
 *   route: "execution-passed" | "flaky" | "standalone",
 *   state: "pending" | "in-progress" | "done" | "handed-off" | "failed",
 *   summary?: string,
 *   assertions_reduced?: string,
 *   reason?: string,
 *   detail?: string,
 *   hypothesis?: string,
 *   diagnostics?: string[],
 *   next?: string,
 *   app_cause?: string,
 * }} FixItem
 */

/**
 * One case that needs a Bug draft.
 * @typedef {{
 *   id: string,
 *   kind: "bug",
 *   case: string,
 *   automations: string[],
 *   route: "execution-failed" | "no-automation-failed" | "fix-handoff",
 *   state: "pending" | "done" | "failed",
 *   app_cause?: string,
 *   draft?: string,
 *   summary?: string,
 *   reason?: string,
 *   stale?: boolean,
 * }} BugItem
 */

/**
 * A Fix's item states, in the order one moves through them.
 * @typedef {FixItem["state"]} FixState
 */

/**
 * A Bug item's states.
 * @typedef {BugItem["state"]} BugState
 */

/**
 * One Automation that could not be routed: no fix and no bug.
 * @typedef {{
 *   automation: string,
 *   result: string,
 *   reason?: string,
 *   cases: Array<{ key: string, state: string }>,
 * }} Unresolved
 */

/**
 * A failed Automation whose app bug (on a covered case) suppressed its fix.
 * @typedef {{
 *   automation: string,
 *   failed: string[],
 *   cases: string[],
 * }} Suppressed
 */

/**
 * The work a Run's outcome earns. `items` holds fixes then bugs; `unresolved` and `suppressed` are
 * what the ingest text explains and no follow-up works.
 * @typedef {{
 *   items: Array<FixItem | BugItem>,
 *   unresolved: Unresolved[],
 *   suppressed: Suppressed[],
 *   counts: { fix: number, bug: number },
 * }} WorkList
 */

/**
 * `<run>/follow-ups.json`, written once by `execute follow-ups` and changed only by the CLI.
 * @typedef {{
 *   run: string,
 *   commit: string,
 *   target: { slug: string, origin: string },
 *   record: string | null,
 *   created_at: string,
 *   dirty: string[],
 *   items: Array<FixItem | BugItem>,
 *   unresolved: Unresolved[],
 *   suppressed: Suppressed[],
 *   screenshots?: Record<string, string[]>,
 *   fix?: import("./fix.mjs").FixSession,
 *   regress?: { checked: number, rolled_back: string[] },
 *   pr?: import("./pr.mjs").PrState,
 * }} FollowUps
 */

/**
 * What `execute summary` returns beside its text: the drafts this Run wrote, and whether the
 * publish question is asked.
 * @typedef {{
 *   drafts: number,
 *   keys: string[],
 *   ask: boolean,
 *   reason?: "none-drafted" | "bug_publishing_not_configured",
 * }} PublishOffer
 */

const { stop } = refusalsFor({
  no_run: "The run dir holds no plan `execute plan` wrote; there is no work list to build.",
  not_confirmed: "The Run was never confirmed; nothing ran.",
  state_unreadable: "`follow-ups.json` in the run dir is not a shape `execute follow-ups` wrote; start a new Run.",
  no_follow_ups: "The Run has no `follow-ups.json`; run `execute follow-ups --dir <run-dir>` first.",
});

/**
 * @param {unknown} value
 * @returns {string[]}
 */
const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);

/**
 * A block of the ingested record, as the work list reads it.
 * @typedef {{
 *   key: string,
 *   summary: string,
 *   data: Record<string, unknown> & {
 *     result?: string,
 *     reason?: string,
 *     automation?: Array<{ id?: string, result?: string, reason?: string, attempts?: string[] }>,
 *     execution_skipped?: string[],
 *   },
 * }} WorkBlock
 */

/**
 * How a case's chain ended: its Execution's result, the reason an Execution did not follow, or
 * `not-run` when nothing started.
 * @param {WorkBlock | undefined} block
 * @returns {string}
 */
function executionState(block) {
  if (!block) return "not-run";
  if (block.data.result) return block.data.result;
  const skipped = strings(block.data.execution_skipped);
  if (skipped.includes("not-run")) return "not-run";
  if (skipped.length) return "skipped";
  return "none";
}

/**
 * The follow-up work a Run's outcome earns.
 * @param {Pick<ExecutePlan, "executions"> & { automation?: { selections?: Array<{ id: string, file?: string }> } }} plan
 * @param {WorkBlock[]} blocks
 * @returns {WorkList}
 */
export function workList(plan, blocks) {
  const byKey = new Map(blocks.map((block) => [block.key, block]));
  const selections = new Map((plan.automation?.selections ?? []).map((selection) => [selection.id, selection]));
  const stateOf = (/** @type {string} */ key) => executionState(byKey.get(key));
  /** @type {Array<{ id: string, cases: string[], results: string[] }>} */
  const automations = [];
  /** @type {Map<string, { id: string, cases: string[], results: string[] }>} */
  const byAutomation = new Map();
  for (const ex of plan.executions) {
    for (const id of ex.automations ?? []) {
      if (!byAutomation.has(id)) {
        const found = { id, cases: /** @type {string[]} */ ([]), results: /** @type {string[]} */ ([]) };
        byAutomation.set(id, found);
        automations.push(found);
      }
      const automation = /** @type {{ id: string, cases: string[], results: string[] }} */ (byAutomation.get(id));
      if (!automation.cases.includes(ex.key)) automation.cases.push(ex.key);
      const entry = (byKey.get(ex.key)?.data.automation ?? []).find((e) => e.id === id);
      if (typeof entry?.result === "string") automation.results.push(entry.result);
    }
  }

  /** @type {Array<FixItem | BugItem>} */
  const items = [];
  /** @type {Unresolved[]} */
  const unresolved = [];
  /** @type {Suppressed[]} */
  const suppressed = [];
  /**
   * @param {{ id: string, cases: string[] }} automation
   * @param {FixItem["route"]} route
   * @returns {FixItem}
   */
  const fixOf = (automation, route) => ({
    id: `fix_${automation.id}`, kind: "fix", automation: automation.id,
    file: selections.get(automation.id)?.file ?? "",
    cases: [...automation.cases], route, state: "pending",
  });
  for (const automation of automations) {
    const result = worstAutomationResult(automation.results);
    const cases = automation.cases.map((key) => ({ key, state: stateOf(key) }));
    if (result === undefined) {
      // Nothing recorded a result: a case left out of the record never started. The Automation was
      // due and never ran, so it is unresolved, with no fix and no bug.
      if (cases.every((c) => c.state === "not-run")) unresolved.push({ automation: automation.id, result: "not-run", cases });
    } else if (result === "flaky") {
      items.push(fixOf(automation, "flaky"));
    } else if (result === "failed") {
      if (cases.every((c) => c.state === "passed")) items.push(fixOf(automation, "execution-passed"));
      else if (cases.some((c) => c.state === "failed")) {
        suppressed.push({ automation: automation.id, failed: cases.filter((c) => c.state === "failed").map((c) => c.key), cases: cases.filter((c) => c.state === "passed").map((c) => c.key) });
      } else unresolved.push({ automation: automation.id, result, cases });
    } else if (result === "blocked") {
      const reason = (byKey.get(automation.cases[0])?.data.automation ?? []).find((e) => e.id === automation.id)?.reason;
      unresolved.push({ automation: automation.id, result, ...(typeof reason === "string" && { reason }), cases });
    }
  }
  for (const ex of plan.executions) {
    if (stateOf(ex.key) !== "failed") continue;
    const automationsOfCase = ex.automations ?? [];
    items.push({
      id: `bug_${ex.key}`, kind: "bug", case: ex.key, automations: [...automationsOfCase],
      route: automationsOfCase.length ? "execution-failed" : "no-automation-failed", state: "pending",
    });
  }
  return {
    items, unresolved, suppressed,
    counts: { fix: items.filter((i) => i.kind === "fix").length, bug: items.filter((i) => i.kind === "bug").length },
  };
}

/**
 * Whether fix work remains, the predicate that orders the resume command and that `/qa-bug --run`
 * refuses `fix_items_pending` on.
 * @param {Pick<FollowUps, "items" | "pr">} state
 * @returns {boolean}
 */
export function fixWorkRemains(state) {
  const fixes = state.items.filter((item) => item.kind === "fix");
  if (fixes.some((item) => item.state === "pending" || item.state === "in-progress")) return true;
  const mode = state.pr?.mode?.kind;
  return (mode === "pr" || mode === "branch") && fixes.some((item) => item.state === "done" && !state.pr?.record);
}

/**
 * The one resume command: `/qa-codefix --run <dir>` while fix work remains, otherwise `/qa-bug --run
 * <dir>`.
 * @param {Pick<FollowUps, "items" | "pr">} state
 * @param {string} dir
 * @returns {string}
 */
export function resumeCommand(state, dir) {
  return `${fixWorkRemains(state) ? "/qa-codefix" : "/qa-bug"} --run ${dir}`;
}

/**
 * A fix hands off its covered cases to bug report. The item becomes `handed-off` with the app cause;
 * each covered case's bug item carries the cause, and one is created (`route: fix-handoff`) where
 * the case had none.
 * @param {FollowUps} state
 * @param {string} id
 * @param {string} cause
 * @returns {FollowUps}
 */
export function handOff(state, id, cause) {
  const item = state.items.find((candidate) => candidate.kind === "fix" && candidate.id === id);
  if (!item || item.kind !== "fix") return state;
  const items = state.items.map((candidate) => (candidate === item ? { ...candidate, state: /** @type {const} */ ("handed-off"), app_cause: cause } : candidate));
  for (const key of item.cases) {
    const existing = items.find((candidate) => candidate.kind === "bug" && candidate.case === key);
    if (existing) {
      const at = items.indexOf(existing);
      items[at] = { ...existing, app_cause: cause };
    } else {
      items.push({ id: `bug_${key}`, kind: "bug", case: key, automations: [item.automation], route: "fix-handoff", app_cause: cause, state: "pending" });
    }
  }
  return { ...state, items };
}

/**
 * The working-tree paths that were dirty when the work list was made, so a failed fix never touches
 * a file the engineer already had dirty. Renames contribute their new path only.
 * @param {string} repo the repository top level
 * @returns {string[]}
 */
export function dirtyPaths(repo) {
  return uncommittedUnder(repo).paths ?? [];
}

/**
 * The path of the Run's ingested record, as `.qa/executions/<date>-<run>.md`, or null when ingest
 * wrote none.
 * @param {string} root the `.qa/` root
 * @param {string} run
 * @returns {string | null}
 */
function recordPath(root, run) {
  const dir = join(root, "executions");
  if (!existsSync(dir)) return null;
  const found = readdirSync(dir).filter((name) => name.endsWith(`-${run}.md`)).sort().at(-1);
  return found ? relative(dirname(root), join(dir, found)).split(sep).join("/") : null;
}

/**
 * The record's blocks, or none when there is no readable record.
 * @param {string} root
 * @param {string} rel
 * @returns {WorkBlock[]}
 */
function recordBlocks(root, rel) {
  const path = join(dirname(root), rel);
  if (!existsSync(path)) return [];
  try {
    const file = parse(rel.replace(/^\.[^/]+\//, ""), readFileSync(path, "utf8"));
    if (file.type !== "execution") return [];
    return file.executions.map((entry) => ({ key: entry.key, summary: entry.summary ?? "", data: /** @type {WorkBlock["data"]} */ (entry.data) }));
  } catch {
    return [];
  }
}

/**
 * `<run>/follow-ups.json` as it stands: `{state: null}` when the file is absent, `{invalid: true}`
 * when it is not JSON or not the shape this command writes.
 * @param {string} runDir
 * @returns {{ state: FollowUps | null, invalid?: false } | { state?: undefined, invalid: true }}
 */
function readState(runDir) {
  const path = join(runDir, "follow-ups.json");
  if (!existsSync(path)) return { state: null };
  try {
    const state = /** @type {FollowUps} */ (JSON.parse(readFileSync(path, "utf8")));
    if (typeof state?.run !== "string" || !Array.isArray(state.items)) return { invalid: true };
    return { state };
  } catch {
    return { invalid: true };
  }
}

/**
 * @param {string} runDir
 * @param {FollowUps} state
 * @returns {void}
 */
function writeState(runDir, state) {
  const path = join(runDir, "follow-ups.json");
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temp, path);
}

/**
 * Whether bug publishing is configured: `tracker.bug_type`, `bug_link_type` and
 * `bug_link_direction` all set.
 * @param {string} root
 * @returns {boolean}
 */
function bugConfigured(root) {
  const project = loadWorkingTree(root).find((file) => file.rel === "project.md");
  return hasBugPublishTracker(project);
}

/**
 * `execute follow-ups --dir <run-dir> [--root <qa-dir>]`: build the work list, or return it as it
 * stands.
 * @param {string[]} args
 * @param {CommandContext} context
 * @returns {CommandResult}
 */
function followUps(args, { dir, root }) {
  noArguments("execute follow-ups", args, "--dir <run-dir>");
  const opened = orThrow(openRunDir(dir, { cmd: "execute", action: "follow-ups", from: "execute plan" }));
  const plan = readPlan(opened.dir);
  if (!plan) return stop("no_run");
  if (!plan.confirmed) return stop("not_confirmed", { run: plan.run });
  const read = readState(opened.dir);
  if (read.invalid) return stop("state_unreadable", { dir: opened.dir });
  if (read.state) return followUpResult(opened.dir, read.state, false);

  const record = recordPath(/** @type {string} */ (root), plan.run);
  const work = workList(plan, record ? recordBlocks(/** @type {string} */ (root), record) : []);
  const repo = plan.automation?.repo ?? repositoryOf(root)?.top;
  /** @type {FollowUps} */
  const state = {
    run: plan.run, commit: plan.commit, target: { slug: plan.target.slug, origin: plan.target.origin },
    record, created_at: new Date().toISOString(), dirty: repo ? dirtyPaths(repo) : [],
    items: work.items, unresolved: work.unresolved, suppressed: work.suppressed,
  };
  writeState(opened.dir, state);
  return followUpResult(opened.dir, state, true);
}

/**
 * The `execute follow-ups` JSON and text.
 * @param {string} dir
 * @param {FollowUps} state
 * @param {boolean} created
 * @returns {CommandResult}
 */
function followUpResult(dir, state, created) {
  const counts = {
    fix: state.items.filter((item) => item.kind === "fix").length,
    bug: state.items.filter((item) => item.kind === "bug").length,
  };
  const lines = state.items.map((item) => `  ${item.id}: ${item.kind} (${item.route})`);
  const resume = resumeCommand(state, dir);
  return {
    exit: 0,
    json: {
      action: "follow-ups", ok: true, dir, created, run: state.run,
      items: state.items, unresolved: state.unresolved, suppressed: state.suppressed, dirty: state.dirty,
      counts, resume, text: [`Follow-ups for Run ${state.run}: ${counts.fix} fix, ${counts.bug} bug.`, ...lines, `Resume with \`${resume}\`.`].join("\n"),
    },
  };
}

/** One line, scrubbed the way ingest scrubs, never truncated. @param {unknown} value @returns {string} */
function scrubbed(value) {
  return scrubRecordText(value).split("\n").join(" ");
}

/**
 * The publish offer for a Run's drafts: only a `done` bug item holds a draft's Key.
 * @param {FollowUps} state
 * @param {boolean} configured
 * @returns {PublishOffer}
 */
function publishOffer(state, configured) {
  const drafts = /** @type {BugItem[]} */ (state.items.filter((item) => item.kind === "bug" && item.state === "done" && typeof item.draft === "string"));
  const keys = drafts.map((item) => /** @type {string} */ (item.draft));
  if (drafts.length === 0) return { drafts: 0, keys, ask: false, reason: "none-drafted" };
  return configured ? { drafts: drafts.length, keys, ask: true } : { drafts: drafts.length, keys, ask: false, reason: "bug_publishing_not_configured" };
}

/**
 * Why a mode's fixes are not where they were asked to be, in the engineer's words.
 * @param {string | undefined} reason
 * @returns {string}
 */
function modeReason(reason) {
  return /** @type {Record<string, string>} */ ({
    "not-requested": "no PR was asked for",
    dirty: "the test tree was dirty",
    "no-identity": "git has no committer identity",
    no_code_host: "`code_host` is not set",
    no_tool: "`gh` or `glab` is not installed",
    no_origin: "`origin` names no repository",
    no_base: "no base branch could be resolved",
    base_diverged: "the base moved since the pinned commit",
  })[reason ?? ""] ?? reason ?? "no reason recorded";
}

/**
 * The follow-up summary, read-only and untruncated: what the fixes did, where they are, the
 * drafts awaiting publish, and what still needs resuming. `text` is null for an empty work list.
 * @param {FollowUps} state
 * @param {{ dir: string, configured: boolean }} options
 * @returns {{ text: string | null, publish: PublishOffer }}
 */
export function summaryText(state, { dir, configured }) {
  const publish = publishOffer(state, configured);
  if (state.items.length === 0) return { text: null, publish };
  const fixes = /** @type {FixItem[]} */ (state.items.filter((item) => item.kind === "fix"));
  const bugs = /** @type {BugItem[]} */ (state.items.filter((item) => item.kind === "bug"));
  const keyOf = (/** @type {string} */ caseKey) => bugs.find((item) => item.case === caseKey && item.draft)?.draft ?? "(bug pending)";
  const done = fixes.filter((item) => item.state === "done");
  const failed = fixes.filter((item) => item.state === "failed");
  const handed = fixes.filter((item) => item.state === "handed-off");
  const pending = state.items.filter((item) => item.state === "pending" || item.state === "in-progress");
  /** @type {string[]} */
  const lines = [`Follow-ups for Run ${state.run} on ${state.target.slug}: ${fixes.length} fix, ${bugs.length} bug.`];
  if (done.length) {
    lines.push(`Fixes done (${done.length}):`, ...done.map((item) => [
      `  ${item.automation}: ${item.cases.join(", ") || "(no cases)"} (${item.route}${item.route === "flaky" ? ", flaky" : ""})`,
      item.summary ? ` — ${scrubbed(item.summary)}` : "",
      item.assertions_reduced ? `; assertions reduced: ${scrubbed(item.assertions_reduced)}` : "",
    ].join("")));
  }
  if (failed.length) {
    lines.push(`Fixes failed (${failed.length}):`, ...failed.map((item) => [
      `  ${item.automation}: ${item.reason ?? "failed"}`,
      item.detail ? `: ${scrubbed(item.detail)}` : "",
      item.hypothesis ? `; hypothesis: ${scrubbed(item.hypothesis)}` : "",
      item.diagnostics?.length ? `; diagnostics: ${item.diagnostics.map(scrubbed).join(" ")}` : "",
      item.next ? `; next: ${scrubbed(item.next)}` : "",
    ].join("")));
  }
  if (handed.length) {
    lines.push(`Fixes handed off (${handed.length}):`, ...handed.map((item) => `  ${item.automation}: ${scrubbed(item.app_cause ?? "handed off")}; ${item.cases.map((key) => `${key}: ${keyOf(key)}`).join(", ")}`));
  }
  if (state.regress) {
    const rolled = state.regress.rolled_back;
    lines.push(`Fix regress: ${state.regress.checked} Automation${state.regress.checked === 1 ? "" : "s"} checked${rolled.length ? `, ${rolled.length} rolled back (${rolled.join(", ")})` : ", none rolled back"}.`);
  }
  if (done.length) {
    const mode = state.pr?.mode?.kind;
    const record = state.pr?.record;
    const branch = state.pr?.branch ?? "the fix branch";
    if (record?.url) lines.push(`Code changes: PR ${record.url} (${branch}${state.pr?.mode?.base ? ` → ${state.pr.mode.base}` : ""}, ${state.pr?.items?.length ?? done.length} commit${(state.pr?.items?.length ?? done.length) === 1 ? "" : "s"}).`);
    else if (record?.pushed) lines.push(`Code changes: branch ${branch} pushed, no PR (${scrubbed(record.error ?? "no reason recorded")}).`);
    else if (record?.error) lines.push(`Code changes: branch ${branch} only (push failed: ${scrubbed(record.error)}); push it by hand with \`git push origin ${branch}\`.`);
    else if (mode === "branch") lines.push(`Code changes: branch ${branch} only (${modeReason(state.pr?.mode?.reason)}); push it by hand with \`git push origin ${branch}\`.`);
    else if (mode === "working-tree") lines.push(`Code changes: working tree only (${modeReason(state.pr?.mode?.reason)}), so the fixes are uncommitted in your checkout.`);
    else lines.push("Code changes: fixes prepared, not packaged; run `codefix pr-prepare` and `codefix pr-record`.");
  }
  const drafts = bugs.filter((item) => item.state === "done" && item.draft);
  if (drafts.length) lines.push(`Bug drafts (${drafts.length}):`, ...drafts.map((item) => `  ${item.draft}: ${item.case}: ${scrubbed(item.summary ?? "a draft")} (${item.route})${item.stale ? "; stale" : ""}`));
  const failedBugs = bugs.filter((item) => item.state === "failed");
  if (failedBugs.length) lines.push(`Failed bug items (${failedBugs.length}):`, ...failedBugs.map((item) => `  ${item.case}: ${scrubbed(item.reason ?? "failed")}`));
  if (pending.length) lines.push(`Pending (${pending.length}): ${pending.map((item) => item.id).join(", ")}. Resume with \`${resumeCommand(state, dir)}\`.`);
  if (fixWorkRemains(state) && fixes.some((item) => item.state === "done" || item.state === "in-progress")) {
    lines.push(`The working tree holds this Run's fix edits; finish with \`/qa-codefix --run ${dir}\` to restore HEAD.`);
  }
  if (state.record) lines.push(`${drafts.length ? "The drafts and the record are" : "The record is"} written, uncommitted${drafts.length ? "" : ` at \`${state.record}\``}.`);
  if (publish.ask) lines.push(`Publish the ${publish.drafts} drafted bug${publish.drafts === 1 ? "" : "s"}? Answer yes (\`/qa-publish --run ${dir}\`), no (they stay drafts), or name Keys to discard (\`bug discard <bg_key…>\`).`);
  else if (publish.reason === "bug_publishing_not_configured") lines.push(`Publishing bugs is not configured, so the ${publish.drafts} draft${publish.drafts === 1 ? "" : "s"} stay in \`.qa/bugs\`; set \`tracker.bug_type\`, \`bug_link_type\` and \`bug_link_direction\` with \`/qa-init\`.`);
  return { text: lines.join("\n"), publish };
}

/**
 * `execute summary --dir <run-dir> [--root <qa-dir>]`: read-only over the work list.
 * @param {string[]} args
 * @param {CommandContext} context
 * @returns {CommandResult}
 */
function summary(args, { dir, root }) {
  noArguments("execute summary", args, "--dir <run-dir>");
  const opened = orThrow(openRunDir(dir, { cmd: "execute", action: "summary", from: ["execute follow-ups", "execute ingest"] }));
  const read = readState(opened.dir);
  if (read.invalid) return stop("state_unreadable", { dir: opened.dir });
  if (!read.state) return stop("no_follow_ups", { dir: opened.dir });
  const { text, publish } = summaryText(read.state, { dir: opened.dir, configured: bugConfigured(/** @type {string} */ (root)) });
  const counts = {
    fix: read.state.items.filter((item) => item.kind === "fix").length,
    bug: read.state.items.filter((item) => item.kind === "bug").length,
  };
  return { exit: 0, json: { action: "summary", ok: true, run: read.state.run, counts, items: read.state.items.length, text, publish } };
}

/** @type {Record<string, CommandAction>} */
export const followUpActions = {
  "follow-ups": { options: { dir: "value", root: "qa-dir" }, usage: "--dir <run-dir> [--root <qa-dir>]", run: followUps },
  summary: { options: { dir: "value", root: "qa-dir" }, usage: "--dir <run-dir> [--root <qa-dir>]", run: summary },
};
