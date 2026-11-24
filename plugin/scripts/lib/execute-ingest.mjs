// @ts-check
// `execute ingest --dir <run-dir> [--root <qa-dir>]`: the end of a Run. It turns the plan, each Execution's guard log and each Tester's
// report into one Execution record under `.qa/executions/<date>-<run-id>.md`, written once, and
// emits ordered, labelled `sections` for the skill to word.
//
// The evidence settles into blocks in `execute-blocks.mjs`; this module sweeps the Run's login
// state and sessions, writes those blocks as the record, and builds sections: the counts header, one
// chain line per case that didn't plainly pass, the groups (each capped at 20 lines), the leftover
// `created` labels per case and Role, the warning for Executions that acted without a valid report,
// and the follow-ups footer. The footer's counts come from `workList`, the same function `execute
// follow-ups` uses, so the promise and the work can't disagree.
//
// A secret never reaches the record. Read the Run's private masking values, mask decoded fields
// before query stripping and caps, and scrub tester.report.md on disk too. Only after writing the record
// clear the kept replies, sweep auth/ and close the sessions (`execute close`). Recognised credential patterns still use the existing redaction.
//
// Refusals, each writing nothing: `no_run` (no readable plan), `not_confirmed`, `record_exists` (the
// record is written once, `wx`), `execution_invalid` (the record would fail `check-file`).
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { noArguments, orThrow } from "./cli.mjs";
import { checkExecution, edit, parse } from "./knowledge-file.mjs";
import { buildBlocks, localIso } from "./execute-blocks.mjs";
import { readPlan } from "./execute-plan.mjs";
import { clearReplies } from "./execute-state.mjs";
import { resumeCommand, workList } from "./follow-ups.mjs";
import { openActions } from "./execute-open.mjs";
import { resultHint } from "./execution-results.mjs";
import { AUTH_DIR } from "./execute-auth.mjs";
import { REPORT_FILE, executionDir } from "./execution-guard.mjs";
import { refusalsWithoutLines } from "./refusal.mjs";
import { writeQa } from "./qa-write.mjs";
import { LOGIN_STATE_FILE } from "./scout-login.mjs";
import { LEVEL_ON_CASE_SCHEMA_VERSION, oneLine } from "./schema.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { openRunDir } from "./run-dir.mjs";
import { readCredentialValues } from "./used-credentials.mjs";
import { maskCredentialText, maskCredentialValue } from "./header-credential.mjs";
import { quote } from "./render.mjs";
import { buildSections } from "./report-sections.mjs";

/**
 * @import { CommandAction, CommandContext, CommandResult } from "./cli.mjs"
 * @import { ExecuteExcluded, ExecutePlan, ExecuteSelection, ExecuteSkipped } from "./execute-plan.mjs"
 * @import { ExecutionBlock } from "./execute-blocks.mjs"
 * @import { WorkBlock, WorkList } from "./follow-ups.mjs"
 * @import { ReportSection, SectionSpec } from "./report-sections.mjs"
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
 *   excluded?: ExecuteExcluded[],
 *   not_run?: string[],
 *   selection?: ExecuteSelection,
 * }} ExecutionRecordFront
 */

const { stop } = refusalsWithoutLines();

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

// After writing the scrubbed record and reports, delete auth/ and close every session of the Run.
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
 * @param {string[]} notRun
 * @param {string} rel
 * @param {readonly string[]} values
 * @returns {{ text: string, file: Record<string, unknown>, errors?: undefined } | { errors: Array<{ code: string, field?: string, line?: number, message: string }>, text?: undefined, file?: undefined }}
 */
function recordText(plan, blocks, notRun, rel, values) {
  const executed = blocks.some((block) => block.data.result !== undefined);
  /** @type {ExecutionRecordFront} */
  const front = {
    type: "execution", run: plan.run, executed_at: localIso(plan.created_at), target: plan.target.slug, url: plan.target.origin,
    commit: plan.commit, ...(executed && { playwright_cli: plan.playwright_cli }), ...(plan.skipped.length && { skipped: plan.skipped }),
    ...(plan.excluded?.length && { excluded: plan.excluded }), ...(notRun.length && { not_run: notRun }),
    ...(plan.selection !== undefined && { selection: plan.selection }),
  };
  const skeleton = (/** @type {ExecutionBlock} */ b) => ["### ", b.key, ": ", b.summary, "\n\n```yaml\nkey: ", b.key, "\n```\n\n", b.prose.join("\n").trimEnd(), "\n"].join("");
  const header = edit(parse(rel, ""), [{ set: maskCredentialValue(front, values) }]);
  if (!header.ok) return { errors: header.errors };
  const entries = [];
  for (const b of blocks) {
    const first = edit(header.file, [{ append: skeleton(b) }]);
    if (!first.ok) return { errors: first.errors };
    const second = edit(first.file, [{ at: b.key, set: maskCredentialValue(b.data, values) }]);
    if (!second.ok) return { errors: second.errors };
    entries.push(second.text.split("\n").slice(second.file.executions[0].line - 1).join("\n").trimEnd());
  }
  const text = `${header.text.trimEnd()}\n\n${entries.join("\n\n")}\n`;
  return { text, file: parse(rel, text) };
}

// The `execution_skipped` reasons of a case block that are not `not-run`: `manual`, `no-steps` and
// `no-expected`, none of which a Tester Execution followed.
/**
 * @param {ExecutionBlock} block
 * @returns {string[]}
 */
function designSkips(block) {
  const skipped = block.data.execution_skipped;
  return Array.isArray(skipped) ? /** @type {string[]} */ (skipped).filter((reason) => reason !== "not-run") : [];
}

// Whether a skipped case is one `/qa-design` can complete (an incomplete case), rather than one no
// Tester can perform (`manual`).
/**
 * @param {ExecutionBlock} block
 * @returns {boolean}
 */
function incomplete(block) {
  return designSkips(block).some((reason) => reason === "no-steps" || reason === "no-expected");
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
  if (incomplete(block)) tokens.push("/qa-design");
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

/** @type {readonly SectionSpec[]} */
export const INGEST_SECTION_ORDER = [
  { id: "summary", label: "Summary" },
  { id: "unguarded", label: "Unguarded Run" },
  { id: "failed", label: "Failed" },
  { id: "fix_coming", label: "Fix coming" },
  { id: "fix_suppressed", label: "Passed Execution, fix suppressed" },
  { id: "unresolved", label: "Unresolved Automations" },
  { id: "blocked", label: "Blocked" },
  { id: "skipped", label: "Skipped" },
  { id: "not_run", label: "Not run" },
  { id: "warnings", label: "Warnings" },
  { id: "record", label: "Record" },
  { id: "created", label: "Created entities left in the app" },
  { id: "report_problems", label: "Report problems" },
  { id: "follow_ups", label: "Follow-ups" },
];

/**
 * @param {ExecutePlan} plan
 * @param {ExecutionBlock[]} blocks
 * @param {Array<{ key: string, summary: string }>} notRun
 * @param {string | null} record
 * @param {WorkList} work
 * @param {string} dir
 * @param {{ count: number, keys: string[] }} unreported
 * @param {Array<{ execution: string, problems: string[] }>} problems
 * @returns {ReportSection[]}
 */
function ingestSections(plan, blocks, notRun, record, work, dir, unreported, problems) {
  const count = (/** @type {string} */ result) => blocks.filter((b) => b.data.result === result).length;
  const [passed, failed, blocked] = ["passed", "failed", "blocked"].map(count);
  const automations = automationCounts(blocks);
  const executed = blocks.filter((b) => b.data.result !== undefined).length;
  const created = blocks.reduce((n, b) => n + b.created, 0);
  // One line per case block that left entities, from the block's own scrubbed labels: `<Key>
  // (<Roles>): <label>; <label>…`, the Roles `-` when the case has none.
  const leftovers = blocks.filter((b) => b.created > 0).map((b) => {
    const roles = /** @type {string[]} */ (b.data.roles ?? []);
    const labels = /** @type {string[]} */ (b.data.created ?? []);
    return `  ${b.key} (${roles.length ? roles.join(", ") : "-"}): ${labels.join("; ")}`;
  });
  const skippedBlocks = blocks.filter((b) => designSkips(b).length);
  const notRunBlocks = blocks.filter((b) => Array.isArray(b.data.execution_skipped) && (/** @type {string[]} */ (b.data.execution_skipped)).includes("not-run"));
  const byKey = (/** @type {string} */ key) => blocks.find((b) => b.key === key);
  const line = (/** @type {{ key: string, summary: string }} */ b) => `  ${b.key}: ${b.summary}`;
  const chainOf = (/** @type {ExecutionBlock} */ b) => chainLine(b, work);
  const fixed = [...new Set(work.items.flatMap((item) => (item.kind === "fix" ? item.cases : [])))];
  const suppressed = [...new Set(work.suppressed.flatMap((entry) => entry.cases))];
  const unresolved = work.unresolved.map((entry) => `  ${entry.automation}: ${entry.result}${entry.reason ? `: ${entry.reason}` : ""}; ${entry.cases.map((c) => `${c.key} ${c.state}`).join(", ")}`);
  const stopped = notRun.length > 0 || notRunBlocks.length > 0;
  const header = `Automations: ${automations.total} (${automations.passed} passed, ${automations.failed} failed, ${automations.flaky} flaky, ${automations.blocked} blocked); Executions: ${executed} (${passed} passed, ${failed} failed, ${blocked} blocked, ${skippedBlocks.length} execution-skipped); ${plan.skipped.length} skipped, ${notRun.length} not run.`;
  const caseOutcomes = `Case outcomes: ${["passed", "failed", "blocked", "incomplete"].map((result) => `${[...work.outcomes.values()].filter((o) => o.result === result).length} ${result}`).join(", ")}.`;
  const skippedLines = [
    ...plan.skipped.map((s) => `  ${s.key} (${s.reasons.join(", ")})`),
    ...skippedBlocks.map((b) => `  ${b.key}: ${b.summary} (${designSkips(b).join(", ")})${incomplete(b) ? "; complete the case with \`/qa-design\`" : ""}`),
  ];
  const warningItems = [
    ...blocks.filter((b) => b.data.result === "passed" && b.atLogin).map((b) => `${b.key} passed but met a sign-in page (at_login); check the Access note's login is current.`),
    ...(unreported.count ? [`${unreported.count} Execution${unreported.count === 1 ? "" : "s"} acted without a valid report; anything ${unreported.count === 1 ? "it" : "they"} created is unlisted: ${unreported.keys.join(", ")}.`] : []),
  ];

  return buildSections(INGEST_SECTION_ORDER, [
    { id: "summary", markdown: `${header}\n${caseOutcomes}` },
    { id: "unguarded", markdown: plan.unguarded?.acknowledged ? "Acknowledged on the pre-run Card; no verified Tester guard held it." : null },
    { id: "failed", markdown: group(`Failed (${failed}):`, blocks.filter((b) => b.data.result === "failed").map(chainOf), record).join("\n") },
    { id: "fix_coming", markdown: group(`Fix coming (${fixed.length}):`, fixed.flatMap((key) => byKey(key) ? [chainOf(/** @type {ExecutionBlock} */ (byKey(key)))] : []), record).join("\n") },
    { id: "fix_suppressed", markdown: group(`Passed Execution, fix suppressed (${suppressed.length}):`, suppressed.flatMap((key) => byKey(key) ? [chainOf(/** @type {ExecutionBlock} */ (byKey(key)))] : []), record).join("\n") },
    { id: "unresolved", markdown: group(`Unresolved Automations (${work.unresolved.length}):`, unresolved, record).join("\n") },
    { id: "blocked", markdown: group(`Blocked (${blocked}):`, blocks.filter((b) => b.data.result === "blocked").map(chainOf), record).join("\n") },
    { id: "skipped", markdown: group(`Skipped (${skippedLines.length}):`, skippedLines, record).join("\n") },
    { id: "not_run", markdown: group(`Not run (${notRun.length + notRunBlocks.length}), the Run ended before they started, so their previous result stays the latest:`, [...notRun.map(line), ...notRunBlocks.map(line)], record).join("\n") },
    { id: "warnings", items: warningItems },
    { id: "record", markdown: record ? `${record} (written, uncommitted).` : "No record written: no Execution ran and none was Blocked before dispatch." },
    { id: "created", markdown: group(`Created entities left in the app (${created}, tagged \`qa-${plan.run}\` where free-text fields allowed):`, leftovers, record).join("\n") },
    { id: "report_problems", items: problems },
    {
      id: "follow_ups",
      markdown: `${work.counts.fix} fix, ${work.counts.bug} bug.${stopped ? " The Run stopped: follow-ups do not start." : ""}`,
      next: stopped ? resumeCommand({ items: work.items }, dir) : null,
    },
  ]);
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
  if (!plan) return stop("no_run", { next: "execute plan" });
  if (!plan.confirmed) return stop("not_confirmed", { run: plan.run });

  const values = readCredentialValues(opened.dir);
  if (values === null) return stop("credential_values_unreadable");
  const { blocks, notRun, problems, unreported: unreportedExecutions } = buildBlocks(plan, opened.dir, values);
  // Read every report before changing any, and retain auth if scrubbing fails.
  const scrubReports = () => {
    const reports = [];
    for (const { id } of plan.executions) {
      const path = join(executionDir(opened.dir, id), REPORT_FILE);
      if (existsSync(path)) {
        const text = readFileSync(path, "utf8");
        // The report contains prose and YAML double-quoted strings. Match the dialect's escaped
        // spelling too, so a quote or backslash in a decoded value cannot survive on disk.
        const masked = maskCredentialText(text, [...values, ...values.map((value) => quote(value).slice(1, -1))]);
        if (masked !== text) reports.push({ path, masked });
      }
    }
    for (const { path, masked } of reports) writeFileSync(path, masked);
  };
  const work = workList(plan, /** @type {import("./follow-ups.mjs").WorkBlock[]} */ (/** @type {unknown} */ (blocks)));
  // One entry per Execution that acted without a valid report; the summary counts those and names
  // each case once, in plan order.
  const unreported = { count: unreportedExecutions.length, keys: [...new Set(unreportedExecutions.map((entry) => entry.key))] };
  /** @type {Record<string, number>} */
  const counts = { passed: 0, failed: 0, blocked: 0, skipped: plan.skipped.length, not_run: notRun.length };
  for (const b of blocks) if (b.data.result) counts[b.data.result] += 1;

  let record = null;
  if (blocks.length) {
    // The record names a case that never started only when nothing of it ran: one of its levels
    // starting is enough for it to have a block, and a block is never paired with `not_run`.
    const started = new Set(blocks.map((b) => b.key));
    const unstarted = [...new Set(notRun.map((entry) => entry.key))].filter((key) => !started.has(key));
    const rel = `executions/${localIso(plan.created_at).slice(0, 10)}-${plan.run}.md`;
    const written = recordText(plan, blocks, unstarted, rel, values);
    const invalid = written.errors ?? (/** @type {Array<{ code: string, field?: string, line?: number, message: string }>} */ (checkExecution(written.file).errors));
    if (invalid.length) return stop("execution_invalid", { errors: invalid.map(({ code, field, line, message }) => ({ code, field, line, message })) });
    const qa = resolve(/** @type {string} */ (root));
    const path = join(qa, rel);
    if (existsSync(path)) return stop("record_exists", { record: relative(dirname(qa), path).split(sep).join("/") });
    scrubReports();
    const tx = writeQa({
      root: qa,
      minSchema: LEVEL_ON_CASE_SCHEMA_VERSION,
      writes: [{ path: rel, text: /** @type {string} */ (written.text), absent: true }],
    });
    if (!tx.ok) {
      if (tx.kind === "schema") return tx.refusal;
      if (tx.kind === "check") {
        return stop("execution_invalid", {
          errors: tx.errors.map(({ code, field, line, message }) => ({ code, field, line, message })),
        });
      }
      if (tx.kind === "write" && tx.code === "EEXIST") {
        return stop("record_exists", { record: relative(dirname(qa), path).split(sep).join("/") });
      }
      throw new Error(`execute ingest: ${tx.error ?? "failed"}`);
    }
    record = relative(dirname(qa), path).split(sep).join("/");
  }
  if (!blocks.length) scrubReports();
  clearReplies(opened.dir);
  sweep(opened.dir, plan, env);
  /** @type {ReportSection[]} */
  const sections = ingestSections(plan, blocks, notRun, record, work, opened.dir, unreported, problems);
  return { exit: 0, json: maskCredentialValue({ action: "ingest", ok: true, run: plan.run, record, counts, sections }, values) };
}

/** @type {Record<string, CommandAction>} */
export const ingestActions = {
  ingest: { options: { dir: "value", root: "qa-dir" }, usage: "--dir <run-dir> [--root <qa-dir>]", run: ingest },
};
