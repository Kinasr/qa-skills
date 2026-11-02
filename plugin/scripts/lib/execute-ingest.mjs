// @ts-check
// `execute ingest --dir <run-dir> [--root <qa-dir>]`: the end of a Run. It turns the plan, each Execution's guard log and each Tester's
// report into one Execution record under `.qa/executions/<date>-<run-id>.md`, written once, and
// prints the CLI-written summary the skill relays verbatim.
//
// The evidence settles into blocks in `execute-blocks.mjs`; this module sweeps the Run's login
// state and sessions, writes those blocks as the record, and words the text: the counts header, one
// chain line per case that didn't plainly pass, the groups (each capped at 20 lines) and the
// follow-ups footer. The footer's counts come from `workList`, the same function `execute
// follow-ups` uses, so the promise and the work can't disagree.
//
// A secret never reaches the record. Login state files in the run dir go first, the sessions are
// closed (`execute close`), then every text field of an Execution is cut of URL queries and
// fragments and redacted (`redactCredentials`), setting `redacted: true` when that changed anything,
// and clamped to its cap.
//
// Refusals, each writing nothing: `no_run` (no readable plan), `not_confirmed`, `record_exists` (the
// record is written once, `wx`), `execution_invalid` (the record would fail `check-file`).
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { noArguments, orThrow } from "./cli.mjs";
import { checkExecution, edit, parse } from "./knowledge-file.mjs";
import { buildBlocks, localIso, readPlan } from "./execute-blocks.mjs";
import { resumeCommand, workList } from "./follow-ups.mjs";
import { openActions } from "./execute-open.mjs";
import { resultHint } from "./execution-results.mjs";
import { AUTH_DIR } from "./execute-auth.mjs";
import { executionDir } from "./execution-guard.mjs";
import { refusalsFor } from "./refusal.mjs";
import { LOGIN_STATE_FILE } from "./scout-login.mjs";
import { LEVEL_ON_CASE_SCHEMA_VERSION, oneLine } from "./schema.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { openRunDir } from "./run-dir.mjs";

/**
 * @import { CommandAction, CommandContext, CommandResult } from "./cli.mjs"
 * @import { ExecutePlan, ExecuteSelection, ExecuteSkipped } from "./execute.mjs"
 * @import { ExecutionBlock } from "./execute-blocks.mjs"
 * @import { WorkBlock, WorkList } from "./follow-ups.mjs"
 */

/**
 * Front matter written into the Execution record from the frozen plan.
 * @typedef {{
 *   type: "execution",
 *   run: string,
 *   executed_at: string,
 *   target: string,
 *   url: string,
 *   commit: string,
 *   playwright_cli?: string,
 *   skipped?: ExecuteSkipped[],
 *   selection?: ExecuteSelection,
 * }} ExecutionRecordFront
 */

const { stop } = refusalsFor({
  no_run: "The run dir holds no plan `execute plan` wrote; there is nothing to ingest.",
  not_confirmed: "The Run was never confirmed; nothing ran.",
  record_exists: "This Run's record is already written and is never rewritten.",
  execution_invalid: "The record the Run would write fails `check-file`; nothing was written.",
});

// Each summary group lists at most this many lines, then says how many more the record holds.
const GROUP_CAP = 20;

/**
 * An Automation entry as the record holds it.
 * @typedef {{
 *   id?: string,
 *   result?: string,
 *   reason?: string,
 *   attempts?: unknown[],
 * }} RecordedAutomation
 */

// Before anything is read: the CLI-login state files hold live cookies, so they go first; then every
// session of the Run is closed, the login ones included.
/**
 * @param {string} runDir
 * @param {ExecutePlan} plan
 * @param {Record<string, string | undefined>} env
 * @returns {void}
 */
function sweep(runDir, plan, env) {
  rmSync(join(runDir, AUTH_DIR), { recursive: true, force: true });
  for (const { id } of plan.executions) rmSync(join(executionDir(runDir, id), LOGIN_STATE_FILE), { force: true });
  for (const { id } of plan.executions) openActions.close.run([], { dir: runDir, execution: id, env });
}

// The distinct Automations the Run ran: one shared by several cases appears in each case block but
// counts once, as the spec's summary requires.
/**
 * @param {ExecutionBlock[]} blocks
 * @returns {{ total: number, passed: number, failed: number, flaky: number, blocked: number }}
 */
function automationCounts(blocks) {
  /** @type {Map<string, string>} */
  const byId = new Map();
  for (const block of blocks) {
    for (const entry of /** @type {Array<{ id: string, result: string }>} */ (block.data.automation ?? [])) byId.set(entry.id, entry.result);
  }
  /** @type {{ total: number, passed: number, failed: number, flaky: number, blocked: number }} */
  const counts = { total: 0, passed: 0, failed: 0, flaky: 0, blocked: 0 };
  for (const result of byId.values()) {
    counts.total += 1;
    if (["passed", "failed", "flaky", "blocked"].includes(result)) counts[/** @type {"passed"|"failed"|"flaky"|"blocked"} */ (result)] += 1;
  }
  return counts;
}

// The record's text, or `{errors}` when it cannot be written in the dialect.
/**
 * @param {ExecutePlan} plan
 * @param {ExecutionBlock[]} blocks
 * @param {string} rel
 * @returns {{ text: string, file: Record<string, unknown>, errors?: undefined } | { errors: Array<{ code: string, field?: string, line?: number, message: string }>, text?: undefined, file?: undefined }}
 */
function recordText(plan, blocks, rel) {
  const executed = blocks.some((block) => block.data.result !== undefined);
  /** @type {ExecutionRecordFront} */
  const front = {
    type: "execution", run: plan.run, executed_at: localIso(plan.created_at), target: plan.target.slug, url: plan.target.origin,
    commit: plan.commit, ...(executed && { playwright_cli: plan.playwright_cli }), ...(plan.skipped.length && { skipped: plan.skipped }),
    ...(plan.selection !== undefined && { selection: plan.selection }),
  };
  const skeleton = (/** @type {ExecutionBlock} */ b) => ["### ", b.key, ": ", b.summary, "\n\n```yaml\nkey: ", b.key, "\n```\n\n", b.prose.join("\n").trimEnd(), "\n"].join("");
  const first = edit(parse(rel, ""), [{ set: front }, ...blocks.map((b) => ({ append: skeleton(b) }))]);
  if (!first.ok) return { errors: first.errors };
  const second = edit(first.file, blocks.map((b) => ({ at: b.key, set: b.data })));
  return second.ok ? { text: second.text, file: second.file } : { errors: second.errors };
}

// The `execution_skipped` reasons of a case block that are not `not-run`: `no-steps` and
// `no-expected`, which a Tester could not run.
/**
 * @param {ExecutionBlock} block
 * @returns {string[]}
 */
function designSkips(block) {
  const skipped = block.data.execution_skipped;
  return Array.isArray(skipped) ? /** @type {string[]} */ (skipped).filter((reason) => reason !== "not-run") : [];
}

/**
 * @param {unknown[]} attempts
 * @returns {string}
 */
function compactAttempts(attempts) {
  return attempts.map((attempt) => {
    const value = String(attempt);
    if (value === "passed") return "P";
    if (value === "failed") return "F";
    return value.startsWith("blocked:") ? `B:${value.slice("blocked:".length)}` : value;
  }).join(",");
}

/**
 * @param {RecordedAutomation} entry
 * @returns {string}
 */
function automationPart(entry) {
  const attempts = Array.isArray(entry.attempts) ? compactAttempts(entry.attempts) : "";
  return `${entry.id} ${entry.result}${entry.reason ? `: ${entry.reason}` : ""} (${attempts})`;
}

// What one case's chain next does, from the work list: the bug it earns, the fixes that cover it,
// why a fix is suppressed, an unresolved Automation, and the design step a skipped case needs.
/**
 * @param {ExecutionBlock} block
 * @param {WorkList} work
 * @returns {string[]}
 */
function nextTokens(block, work) {
  /** @type {string[]} */
  const tokens = [];
  if (work.items.some((item) => item.kind === "bug" && item.case === block.key)) tokens.push("bug");
  for (const fix of work.items) {
    if (fix.kind === "fix" && fix.cases.includes(block.key)) tokens.push(`fix ${fix.automation}${fix.route === "flaky" ? " (flaky)" : ""}`);
  }
  if (!tokens.length) {
    const suppressed = work.suppressed.find((entry) => entry.cases.includes(block.key));
    if (suppressed) tokens.push(`no fix: ${suppressed.automation} covered case ${suppressed.failed.join(", ")} failed`);
    else if (work.unresolved.some((entry) => entry.cases.some((c) => c.key === block.key))) tokens.push("unresolved");
  }
  if (designSkips(block).length) tokens.push("/qa-design");
  return tokens;
}

// One case's chain line: each Automation with its result and compact attempts, the Execution's
// result (or why it did not follow), and what the work list will do next.
/**
 * @param {ExecutionBlock} block
 * @param {WorkList} work
 * @returns {string}
 */
function chainLine(block, work) {
  const automations = /** @type {RecordedAutomation[]} */ (block.data.automation ?? (/** @type {unknown[]} */ ([])));
  const parts = automations.map(automationPart);
  let execution;
  if (block.data.result) {
    const hint = resultHint(block.data, block.feature);
    execution = `${block.data.result}${block.data.reason ? `: ${block.data.reason}` : ""}${hint ? `; ${hint}` : ""}`;
  } else {
    const skipped = Array.isArray(block.data.execution_skipped) ? /** @type {string[]} */ (block.data.execution_skipped) : [];
    execution = skipped.length ? `skipped: ${skipped.join(", ")}` : "none";
  }
  const next = nextTokens(block, work);
  return `  ${block.key}: ${block.summary}: ${parts.length ? parts.join(", ") : "-"} → Execution ${execution}${next.length ? ` → ${next.join(" + ")}` : ""}`;
}

// A summary group: its header and lines, capped, saying where the rest are.
/**
 * @param {string} title
 * @param {string[]} lines
 * @param {string | null} record
 * @returns {string[]}
 */
function group(title, lines, record) {
  if (!lines.length) return [];
  const shown = lines.slice(0, GROUP_CAP);
  return [title, ...shown, ...(lines.length > GROUP_CAP ? [`  and ${lines.length - GROUP_CAP} more${record ? `: see \`${record}\`` : ""}`] : [])];
}

/**
 * @param {ExecutePlan} plan
 * @param {ExecutionBlock[]} blocks
 * @param {Array<{ key: string, summary: string }>} notRun
 * @param {string | null} record
 * @param {WorkList} work
 * @param {string} dir
 * @returns {string}
 */
function summaryText(plan, blocks, notRun, record, work, dir) {
  const count = (/** @type {string} */ result) => blocks.filter((b) => b.data.result === result).length;
  const [passed, failed, blocked] = ["passed", "failed", "blocked"].map(count);
  const automations = automationCounts(blocks);
  const executed = blocks.filter((b) => b.data.result !== undefined).length;
  const created = blocks.reduce((n, b) => n + b.created, 0);
  const skippedBlocks = blocks.filter((b) => designSkips(b).length);
  const notRunBlocks = blocks.filter((b) => Array.isArray(b.data.execution_skipped) && (/** @type {string[]} */ (b.data.execution_skipped)).includes("not-run"));
  const byKey = (/** @type {string} */ key) => blocks.find((b) => b.key === key);
  const line = (/** @type {{ key: string, summary: string }} */ b) => `  ${b.key}: ${b.summary}`;
  const chainOf = (/** @type {ExecutionBlock} */ b) => chainLine(b, work);
  const fixed = [...new Set(work.items.flatMap((item) => (item.kind === "fix" ? item.cases : [])))];
  const suppressed = [...new Set(work.suppressed.flatMap((entry) => entry.cases))];
  const unresolved = work.unresolved.map((entry) => `  ${entry.automation}: ${entry.result}${entry.reason ? `: ${entry.reason}` : ""}; ${entry.cases.map((c) => `${c.key} ${c.state}`).join(", ")}`);
  const stopped = notRun.length > 0 || notRunBlocks.length > 0;
  const header = [
    `Automations: ${automations.total} (${automations.passed} passed, ${automations.failed} failed, ${automations.flaky} flaky, ${automations.blocked} blocked); Executions: ${executed} (${passed} passed, ${failed} failed, ${blocked} blocked, ${skippedBlocks.length} execution-skipped); ${plan.skipped.length} skipped, ${notRun.length} not run.`,
  ];
  const skippedLines = [
    ...plan.skipped.map((s) => `  ${s.key} (${s.reasons.join(", ")})`),
    ...skippedBlocks.map((b) => `  ${b.key}: ${b.summary} (${designSkips(b).join(", ")}); complete the case with \`/qa-design\``),
  ];
  return [
    ...header,
    ...group(`Failed (${failed}):`, blocks.filter((b) => b.data.result === "failed").map(chainOf), record),
    ...group(`Fix coming (${fixed.length}):`, fixed.flatMap((key) => byKey(key) ? [chainOf(/** @type {ExecutionBlock} */ (byKey(key)))] : []), record),
    ...group(`Passed Execution, fix suppressed (${suppressed.length}):`, suppressed.flatMap((key) => byKey(key) ? [chainOf(/** @type {ExecutionBlock} */ (byKey(key)))] : []), record),
    ...group(`Unresolved Automations (${work.unresolved.length}):`, unresolved, record),
    ...group(`Blocked (${blocked}):`, blocks.filter((b) => b.data.result === "blocked").map(chainOf), record),
    ...group(`Skipped (${skippedLines.length}):`, skippedLines, record),
    ...group(`Not run (${notRun.length + notRunBlocks.length}), the Run ended before they started, so their previous result stays the latest:`, [...notRun.map(line), ...notRunBlocks.map(line)], record),
    ...blocks.filter((b) => b.data.result === "passed" && b.atLogin).map((b) => `Warning: ${b.key} passed but met a sign-in page (at_login); check the Access note's login is current.`),
    record ? `Record: ${record} (written, uncommitted).` : "No record written: no Execution ran and none was Blocked before dispatch.",
    ...(created ? [`${created} created ${created === 1 ? "entity was" : "entities were"} left in the app (tagged \`qa-${plan.run}\` where free-text fields allowed).`] : []),
    `Follow-ups: ${work.counts.fix} fix, ${work.counts.bug} bug.`,
    ...(stopped ? [`The Run stopped: follow-ups do not start. Resume with \`${resumeCommand({ items: work.items }, dir)}\`.`] : []),
  ].join("\n");
}

/**
 * @param {string[]} args
 * @param {CommandContext} context
 * @returns {CommandResult}
 */
function ingest(args, { dir, root, env }) {
  noArguments("execute ingest", args, "--dir <run-dir> and --root <qa-dir>");
  const schema = refuseUnreadSchema(/** @type {string} */ (root), LEVEL_ON_CASE_SCHEMA_VERSION);
  if (schema) return schema;
  const opened = orThrow(openRunDir(dir, { cmd: "execute", action: "ingest", from: "execute plan" }));
  const plan = readPlan(opened.dir);
  if (!plan) return stop("no_run");
  if (!plan.confirmed) return stop("not_confirmed", { run: plan.run });

  sweep(opened.dir, plan, env);
  const { blocks, notRun, problems } = buildBlocks(plan, opened.dir);
  const work = workList(plan, /** @type {import("./follow-ups.mjs").WorkBlock[]} */ (/** @type {unknown} */ (blocks)));
  /** @type {Record<string, number>} */
  const counts = { passed: 0, failed: 0, blocked: 0, skipped: plan.skipped.length, not_run: notRun.length };
  for (const b of blocks) if (b.data.result) counts[b.data.result] += 1;
  const automations = automationCounts(blocks);

  let record = null;
  if (blocks.length) {
    const rel = `executions/${localIso(plan.created_at).slice(0, 10)}-${plan.run}.md`;
    const written = recordText(plan, blocks, rel);
    const invalid = written.errors ?? (/** @type {Array<{ code: string, field?: string, line?: number, message: string }>} */ (checkExecution(written.file).errors));
    if (invalid.length) return stop("execution_invalid", { errors: invalid.map(({ code, field, line, message }) => ({ code, field, line, message })) });
    const qa = resolve(/** @type {string} */ (root));
    const path = join(qa, rel);
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, /** @type {string} */ (written.text), { flag: "wx" });
    } catch (e) {
      if (/** @type {{ code?: string }} */ (e).code === "EEXIST") return stop("record_exists", { record: relative(dirname(qa), path).split(sep).join("/") });
      throw e;
    }
    record = relative(dirname(qa), path).split(sep).join("/");
  }
  const text = summaryText(plan, blocks, notRun, record, work, opened.dir);
  return { exit: 0, json: { action: "ingest", ok: true, run: plan.run, record, counts, automations, created: blocks.reduce((n, b) => n + b.created, 0), not_run: notRun.map((n) => n.key), ...(problems.length && { report_problems: problems }), text } };
}

/** @type {Record<string, CommandAction>} */
export const ingestActions = {
  ingest: { options: { dir: "value", root: "qa-dir" }, usage: "--dir <run-dir> [--root <qa-dir>]", run: ingest },
};
