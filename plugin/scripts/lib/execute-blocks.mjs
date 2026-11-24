// @ts-check
// The case blocks a Run's evidence settles into: one per started case, each holding the Automation
// results the Run reported for it and, when a Tester ran, the Execution's scrubbed fields and prose.
// `execute ingest` writes them to the Execution record, and `execute follow-ups` reads them again to
// build the work list, so both work from the same settled evidence.
//
// Four sources, each with its own authority (the fourth, below, only for what `execute next` and `record` decided):
//   <run>/execute.json                       the plan, written before dispatch: the Run's fields,
//                                            `skipped`, and per Execution its Key, digest, Roles, cap
//                                            and (when Blocked before dispatch) its reason
//   <run>/executions/<id>/guard.json         actions used, `at_login`, the sticky `stopped`, the trace
//   <run>/executions/<id>/tester.report.md   the Tester's result and prose (lib/execution-report.mjs)
//   <run>/dispatch.json                      (lib/execute-state.mjs `dispatchMarks`) an Execution Blocked
//                                            `unreachable` by `next`, or whose retries were spent with no report,
//                                            or whose Tester was dispatched and returned with no report
// `guard.stopped` overrides the report: the result is Blocked with that reason, `**Expected.**` goes,
// `**Seen.**` moves to `**Evidence.**` when that is empty, and `**Why.**` is written from the stop. A
// report holding an `unmet` precondition is Blocked `precondition` whatever result it claims, keeping
// its trace and Evidence. No report from an Execution that acted, or a report that does not match the contract, is Blocked
// `guard.stopped ?? "step"` with `reached: 0` and the trace kept; a missing report's Why carries the
// Tester's recorded reply, or says the reason is unknown. A Tester dispatched that returned with no
// report and no guarded call is Blocked `step` too, its Why naming a possible guard-hook failure. A report whose only fault is malformed
// `interpretations` lines is still usable: those lines are left out, the block shows
// `interpretations_dropped`, and the drop is named in the problems `execute ingest` reports. An
// Execution whose Tester never started (no calls, no stop, no report, no returned dispatch) was not run: it gets no block, so its
// previous result stays the latest, and `execute ingest` names a case that never ran at any level
// in the record's `not_run`. Nothing here refuses a whole Run for one Execution's report.
//
// A secret never reaches a block. Every text field of an Execution is cut of URL queries and
// fragments and redacted (`redactCredentials`), setting `redacted: true` when that changed anything;
// its Run dir path becomes `<run>`, as Automation diagnostics already write it; and it is clamped to
// its cap at a word boundary.
//
// A traced call whose guard-log entry carries element evidence has it written, scrubbed again, in one
// folded `json` block right after that Execution's **Trace.** (lib/evidence-record.mjs
// `evidenceBlockLines`), keyed by the call's Trace number. No such call, no block.
import { realpathSync } from "node:fs";
import { readAutomation } from "./execute-automation.mjs";
import { executionDecision, notRunAutomation } from "./execute-chain.mjs";
import { scrubRecordText, stripUrlQueries } from "./credentials.mjs";
import { checkedReport } from "./execution-report.mjs";
import { dispatchMarks } from "./execute-state.mjs";
import { GUARD_STOPS, executionDir, readGuard } from "./execution-guard.mjs";
import { evidenceBlockLines, isExecutionEvidence } from "./evidence-record.mjs";
import { AUTOMATION_DIAGNOSTIC_CAP, AUTOMATION_DIAGNOSTICS_MAX, oneLine } from "./schema.mjs";
import { CREDENTIAL_VARIANTS } from "./tester-request.mjs";
import { maskCredentialText } from "./header-credential.mjs";

/**
 * @import { ExecuteBlocked, ExecuteExecution, ExecutePlan } from "./execute-plan.mjs"
 * @import { ExecutionEvidence, ExecutionGuard, ExecutionGuardStop } from "./execution-guard.mjs"
 * @import { DispatchMark } from "./execute-state.mjs"
 * @import { CheckedReportResult } from "./execute-dispatch.mjs"
 * @import { AutomationResult } from "./test-runner.mjs"
 */

/**
 * Text scrubber with hit tracking for credential redaction.
 * @typedef {{
 *   hit: boolean,
 *   text: (text: unknown) => string,
 *   line: (text: unknown, cap?: number) => string,
 * }} Scrubber
 */

/**
 * Raw settled values for one Execution before redaction and block building.
 * @typedef {{
 *   result: "passed" | "failed" | "blocked",
 *   reason?: string,
 *   reached: number,
 *   why?: string,
 *   expected?: string,
 *   seen?: string,
 *   evidence?: string,
 *   used: number,
 *   guard: ExecutionGuard | null,
 *   access: string[],
 *   created?: string[],
 *   preconditions?: Array<{ text: string, status: string, how?: string }>,
 *   interpretations?: string[],
 *   interpretations_dropped?: number,
 *   unreported?: boolean,
 * }} RawExecution
 */

/**
 * Result of settling one Execution during ingest.
 * @typedef {{
 *   raw: RawExecution,
 *   notRun?: never,
 *   problems?: string[],
 * } | {
 *   raw?: never,
 *   notRun: true,
 *   problems?: never,
 * }} SettleResult
 */

/**
 * An Execution record block ready for markdown writing.
 * @typedef {{
 *   key: string,
 *   summary: string,
 *   data: Record<string, unknown> & { result?: string, reason?: string, at_login?: boolean },
 *   prose: string[],
 *   feature: string,
 *   atLogin: boolean,
 *   created: number,
 *   redacted: boolean,
 * }} ExecutionBlock
 */

/**
 * What one settled Run contributes: one block per started case, the wholly unstarted cases, any
 * reports that did not match the contract or had interpretation lines dropped, and one entry per
 * Execution that acted without a valid report (used > 0 and its report missing or off-contract).
 * @typedef {{
 *   blocks: ExecutionBlock[],
 *   notRun: Array<{ key: string, summary: string }>,
 *   problems: Array<{ execution: string, problems: string[] }>,
 *   unreported: Array<{ key: string }>,
 * }} SettledRun
 */

const CAPS = { route: 200, seen: 600, why: 300, evidence: 1000, interpretation: 200, created: 200, precondition: 300 };
const MAX_INTERPRETATIONS = 5;
// A report that saw a precondition fail is Blocked `precondition` whatever result it claims.
const UNMET_WHY = "A precondition was not met, so the case never started.";
/** @type {Record<ExecutionGuardStop, (cap: number) => string>} */
const STOP_WHY = {
  "action-cap": (cap) => `The action cap of ${cap} was spent before the Execution finished.`,
  "off-target": () => "The browser left the target origin, so the Execution was stopped.",
  "no-access": () => "The app sent the browser to a sign-in page on another origin, so the account had no access.",
  "connection-lost": () => "The browser or the application was lost, so the Execution was stopped.",
};

// `iso` as the local date-time with its UTC offset, the form a record's `executed_at` takes.
/**
 * @param {string} iso
 * @returns {string}
 */
export function localIso(iso) {
  const d = new Date(iso);
  /** @param {number} n */
  const pad = (n) => String(n).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const hhmm = `${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offset < 0 ? "-" : "+"}${hhmm}`;
}

// The spellings a Run dir may be written in: as the Run names it, as `realpath` resolves it, and the
// other side of the `/var` and `/tmp` symlinks macOS puts under `/private`, so either spelling is
// caught. Longest first, so the fuller path is replaced before its own tail.
/**
 * @param {string} runDir
 * @returns {string[]}
 */
function runDirMarkers(runDir) {
  const markers = new Set([runDir.replace(/\/+$/, "")]);
  try { markers.add(realpathSync(runDir)); } catch { /* a Run dir not on disk keeps the spelling it was given */ }
  for (const path of [...markers]) {
    if (path.startsWith("/private/")) markers.add(path.slice("/private".length));
    else if (path.startsWith("/var/") || path.startsWith("/tmp/")) markers.add(`/private${path}`);
  }
  return [...markers].filter(Boolean).sort((a, b) => b.length - a.length);
}

// One Execution's text, cut of URL queries and redacted, with its Run dir path marked `<run>`.
// `hit` says whether a credential was found.
/**
 * @param {readonly string[]} [values]
 * @param {string} [runDir]
 * @returns {Scrubber}
 */
export function scrubber(values = [], runDir = undefined) {
  const markers = runDir === undefined ? [] : runDirMarkers(runDir);
  const scrub = /** @type {Scrubber} */ ({ hit: false });
  scrub.text = (text) => {
    const masked = maskCredentialText(String(text), values);
    if (masked !== String(text)) scrub.hit = true;
    const stripped = stripUrlQueries(masked);
    const swept = scrubRecordText(stripped);
    if (swept !== stripped) scrub.hit = true;
    return markers.reduce((out, marker) => out.replaceAll(marker, "<run>"), swept);
  };
  // A YAML string: one line, each backslash shown as `/`, clamped.
  scrub.line = (text, cap = Infinity) => clamp(oneLine(scrub.text(text)).replaceAll("\\", "/"), cap);
  return scrub;
}

// Cut to `cap` at the last word boundary that fits, marking the cut `…`; a single word longer than
// the cap has no boundary, so it is cut to fit.
/**
 * @param {string} text
 * @param {number} cap
 * @returns {string}
 */
const clamp = (text, cap) => {
  if (text.length <= cap) return text;
  const head = text.slice(0, Math.max(0, cap - 1));
  const boundary = head.search(/\s+\S*$/);
  return `${(boundary > 0 ? head.slice(0, boundary) : head).trimEnd()}…`;
};

// Prose that stays inside its Execution: a line that would read as a heading, a fence, a conflict
// marker or a bold label is escaped. Clamped after escaping, since that is what `check-file` counts.
/**
 * @param {string} text
 * @param {number} cap
 * @returns {string[]}
 */
function proseLines(text, cap) {
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n").map((l) => {
    const escaped = l.replace(/\s+$/, "").replace(/^(#|<{7}|>{7}|\|{7}|`{3,}|~{3,}|<\/?details\b)/i, "\\$1");
    return /^\*\*[^*]+\.\*\*(?:\s|$)/.test(escaped) ? `\\${escaped}` : escaped;
  });
  return clamp(lines.join("\n"), cap).split("\n");
}

// The trace: one numbered code span per logged call, at most `used`. Typed text is already masked in
// the log; URLs lose their queries, a `request` its whole query string, and no item names an option
// the trace never carries.
/**
 * @param {ExecutionGuard | null} guard
 * @param {number} used
 * @param {Scrubber} scrub
 * @returns {string[]}
 */
function traceOf(guard, used, scrub) {
  if (!(used > 0)) return [];
  const span = (/** @type {string} */ text) => scrub.line(text).replaceAll("`", "'").replace(/--(?=(?:query|header|json|auth)\b)/g, "- -");
  const items = (guard?.log ?? []).slice(0, used).map((e) => {
    const args = Array.isArray(e.args) ? e.args.map((a) => scrub.text(a)).map((a) => (/^\/|^[a-z][a-z0-9+.-]*:\/\//i.test(a) ? a.replace(/[?#].*$/, "") : a)) : [];
    const status = ["ok", "error", "refused"].includes(e.status) ? e.status : "error";
    const role = span(typeof e.role === "string" && e.role ? e.role : "-");
    let call;
    if (typeof e.cmd !== "string" || !/^[a-z-]+$/.test(e.cmd)) call = "do unknown";
    else if (e.cmd === "request" && /^[A-Z]+$/.test(args[0] ?? "") && /^\S+$/.test((args[1] ?? "").split(/[?#]/)[0])) call = `request ${args[0]} ${/** @type {string} */ (args[1]).split(/[?#]/)[0]}`;
    else call = `do ${[e.cmd, ...args].join(" ")}`;
    const auth = e.cmd === "request" && e.auth && CREDENTIAL_VARIANTS.includes(e.auth) ? ` auth: ${e.auth}` : "";
    const rejected = e.cmd === "request" && e.auth_rejected === true ? " auth_rejected" : "";
    const expect = e.expect && typeof e.expect === "object" && typeof e.expect.text === "string" && typeof e.expect.seen === "boolean" ? e.expect : null;
    const expectArg = expect ? ` --expect="${span(expect.text).replaceAll('"', "'")}"` : "";
    const expectSeen = expect ? `, ${expect.seen ? "seen" : "not seen"}` : "";
    return span(`${role} ${call}`) + expectArg + ` → ${status}${auth}${rejected}${expectSeen}`;
  });
  return items.length ? items : [`${span(guard?.sessions?.[0]?.role ?? "-")} do unknown → unlogged`];
}

// Admitted route operations are recorded in guard sequence, with the same scrubbing and cap as
// other short record strings.
/**
 * @param {ExecutionGuard | null} guard
 * @param {Scrubber} scrub
 * @returns {string[]}
 */
function routesOf(guard, scrub) {
  return (guard?.log ?? []).filter((entry) => entry.status === "ok" && entry.route)
    .slice().sort((a, b) => a.n - b.n).map((entry) => {
      const route = /** @type {NonNullable<typeof entry.route>} */ (entry.route);
      const pattern = route.pattern === undefined ? "all" : scrub.line(route.pattern).split(/[?#]/)[0];
      return scrub.line(route.unroute ? `unroute ${pattern}` : `${pattern} → ${route.status ?? 200}`, CAPS.route);
    });
}

// The element evidence of the traced calls, keyed by the Trace number each shows. Every string goes
// through the record's scrub again; a call whose evidence is not the guard's closed shape, or an
// attribute name the scrub would change, is left out.
/**
 * @param {ExecutionGuard | null} guard
 * @param {number} used
 * @param {Scrubber} scrub
 * @returns {Record<string, ExecutionEvidence>}
 */
function evidenceOf(guard, used, scrub) {
  /** @type {(value: unknown) => unknown} */
  const swept = (value) => {
    if (typeof value === "string") return scrub.text(value);
    if (Array.isArray(value)) return value.map(swept);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).filter(([k]) => scrub.text(k) === k).map(([k, v]) => [k, swept(v)]));
    }
    return value;
  };
  /** @type {Record<string, ExecutionEvidence>} */
  const byTrace = {};
  (guard?.log ?? []).slice(0, used).forEach((entry, at) => {
    const evidence = entry.evidence === undefined ? undefined : swept(entry.evidence);
    if (isExecutionEvidence(evidence)) byTrace[String(at + 1)] = evidence;
  });
  return byTrace;
}

// What one Execution contributes, before redaction: `{raw}` with its result and prose, or
// `{notRun: true}`. `guard` and `used` are the guard's, `report` the validated report.
/**
 * @param {ExecuteExecution} ex
 * @param {string} runDir
 * @param {DispatchMark | undefined} mark
 * @returns {SettleResult}
 */
function settle(ex, runDir, mark) {
  const before = ex.blocked ?? mark?.blocked;
  if (before) {
    return { raw: { result: "blocked", reason: before.reason, reached: 0, why: before.why ?? "Blocked before dispatch.", used: 0, guard: null, access: ex.access } };
  }
  const execDir = executionDir(runDir, ex.id);
  const guard = readGuard(execDir);
  const used = Number.isSafeInteger(guard?.used) && /** @type {ExecutionGuard} */ (guard).used > 0 ? Math.min(/** @type {ExecutionGuard} */ (guard).used, ex.cap) : 0;
  const stopped = GUARD_STOPS.includes(/** @type {ExecutionGuardStop} */ (guard?.stopped)) ? /** @type {ExecutionGuardStop} */ (/** @type {ExecutionGuard} */ (guard).stopped) : null;
  const access = guard ? [...new Set((guard.sessions ?? []).map((s) => s.acc).filter(Boolean))] : ex.access;
  const base = { used, guard, access: /** @type {string[]} */ (access) };

  const checked = /** @type {CheckedReportResult & { report?: Record<string, unknown> }} */ (checkedReport(execDir, ex, { stopped, used }));
  // The one place that answers "did this Execution act without a valid report?": it acted (`used >
  // 0`) and its report is missing or off-contract. One that never acted, or only stopped or spent
  // its retries, is not one, so no unlisted data is claimed for it.
  const unreported = used > 0 && (checked.missing === true || checked.ok === false);
  /**
   * @param {string} why
   * @param {string[]} [problems]
   * @returns {SettleResult}
   */
  const blocked = (why, problems) => ({ raw: { ...base, result: "blocked", reason: stopped ?? "step", reached: 0, why, ...(unreported && { unreported: true }) }, ...(problems && { problems }) });
  /** @param {Array<{ line?: number, message: string }>} list */
  const reportProblems = (list) => list.map((p) => `${ex.id} report${p.line === undefined ? "" : ` line ${p.line}`}: ${p.message}`);
  // A Tester that acted, stopped, spent its retries or returned without a report left a Run that ran;
  // one that never started was not run. One that returned having made no guarded call, with no stop
  // and no spent retries, may have met a guard hook that failed before it logged anything.
  if (checked.missing) {
    const reply = mark?.reply;
    const said = typeof reply === "string" && reply.trim() ? ` Its reply: ${reply}` : "";
    const silent = used === 0 && !stopped && !mark?.spent && mark?.returned;
    const why = silent ? `The Tester returned without a report and made no guarded call, which can mean the guard hook failed.${said}`
      : said ? `The Tester wrote no report.${said}` : "The Tester wrote no report. The reason is unknown.";
    return used > 0 || stopped || mark?.spent || mark?.returned ? blocked(why) : { notRun: true };
  }
  if (!checked.ok) return blocked("The Tester's report did not match the contract.", reportProblems(checked.problems));
  const report = /** @type {Record<string, unknown> & { why?: string, expected?: string, seen?: string, evidence?: string, preconditions?: Array<{ status?: string }> }} */ (checked.report);
  // Dropped interpretation lines never change the result; they are counted on the block and named as
  // problems so `execute ingest` reports them too.
  const dropped = checked.dropped ?? [];
  const problems = dropped.length ? reportProblems(dropped) : undefined;
  const droppedRaw = dropped.length ? { interpretations_dropped: dropped.length } : {};
  // `checked` means the precondition was seen to hold, so an `unmet` one settles the Execution
  // Blocked `precondition` whatever result the report claims. A guard stop still wins; Expected goes,
  // and Seen becomes Evidence when the report has none.
  if (!stopped && (report.preconditions ?? []).some((p) => p.status === "unmet")) {
    const { expected, seen, ...unmetKept } = report;
    return /** @type {SettleResult} */ ({ raw: { ...base, ...unmetKept, result: "blocked", reason: "precondition", reached: 0, why: report.why ?? UNMET_WHY, evidence: report.evidence ?? seen, ...droppedRaw }, ...(problems && { problems }) });
  }
  if (!stopped) return /** @type {SettleResult} */ ({ raw: { ...base, ...report, why: report.why, ...droppedRaw }, ...(problems && { problems }) });
  const { expected, seen, ...kept } = report;
  return /** @type {SettleResult} */ ({ raw: { ...base, ...kept, result: "blocked", reason: stopped, why: STOP_WHY[stopped](ex.cap), evidence: report.evidence ?? seen, ...droppedRaw }, ...(problems && { problems }) });
}

// The case block's `automation:` entries: what the Run's Automations reported for this case,
// scrubbed and clamped. The record never points at the transient runner output, so the run dir in
// a diagnostic becomes `<run>`.
/**
 * @param {AutomationResult[]} entries
 * @param {Scrubber} scrub
 * @returns {Array<Record<string, unknown>>}
 */
function automationOf(entries, scrub) {
  return entries.map((entry) => {
    const diagnostics = entry.diagnostics
      .map((text) => scrub.line(text, AUTOMATION_DIAGNOSTIC_CAP))
      .filter(Boolean).slice(0, AUTOMATION_DIAGNOSTICS_MAX);
    return {
      id: entry.id, stack: entry.stack, selector: scrub.line(entry.selector),
      result: entry.result, ...(entry.reason && { reason: entry.reason }),
      attempts: entry.attempts.map((attempt) => (attempt.result === "blocked" ? `blocked:${attempt.reason ?? "runner-error"}` : attempt.result)),
      ...(diagnostics.length && { diagnostics }),
      ...(entry.target === "own" && { target: "own" }),
    };
  });
}

// A block with Automation evidence and no Execution result: the case never reached a Tester (yet),
// so the Execution fields stay out of it.
/**
 * @param {ExecuteExecution} ex
 * @param {AutomationResult[]} evidence
 * @param {string} runDir
 * @param {string[]} [skipped]
 * @param {readonly string[]} [values]
 * @returns {ExecutionBlock}
 */
function automationBlock(ex, evidence, runDir, skipped = [], values = []) {
  const scrub = scrubber(values, runDir);
  const summary = oneLine(scrub.text(ex.summary));
  const data = {
    ...(ex.tracker && { tracker: scrub.line(ex.tracker) }), feature: ex.feature, level: ex.level, ...(ex.bound_levels && { bound_levels: ex.bound_levels }),
    ...(ex.selected_levels && { selected_levels: ex.selected_levels }), ...(ex.omitted_levels && { omitted_levels: ex.omitted_levels }), digest: ex.digest,
    ...(ex.dirty && { dirty: true }), review: ex.review, ...(ex.stale && { stale: true }),
    automation: automationOf(evidence, scrub), ...(skipped.length && { execution_skipped: skipped }), ...(scrub.hit && { redacted: true }),
  };
  return { key: ex.key, summary, data, prose: [], feature: ex.feature, atLogin: false, created: 0, redacted: scrub.hit };
}

// The record's block for one Execution: `{data, prose}` (the YAML fields beyond `key`, and the prose
// lines, labelled), with every text field redacted and clamped. A case block that also holds
// Automation evidence carries its `automation:` entries in the same scrubbed data.
/**
 * @param {ExecuteExecution} ex
 * @param {RawExecution} raw
 * @param {AutomationResult[]} evidence
 * @param {string} runDir
 * @param {readonly string[]} values
 * @returns {ExecutionBlock}
 */
function blockOf(ex, raw, evidence, runDir, values) {
  const scrub = scrubber(values, runDir);
  const summary = oneLine(scrub.text(ex.summary));
  const used = raw.reason === "action-cap" ? ex.cap : raw.used;
  const trace = traceOf(raw.guard, used, scrub);
  /** @type {string[]} */
  const prose = [];
  const add = (/** @type {string} */ label, /** @type {unknown} */ text, cap = Infinity) => {
    if (typeof text === "string" && text.trim()) prose.push(`**${label}.**`, ...proseLines(scrub.text(text), cap), "");
  };
  if (raw.result === "failed") {
    add("Expected", raw.expected);
    add("Seen", raw.seen, CAPS.seen);
  }
  if (raw.result === "blocked") add("Why", raw.why, CAPS.why);
  add("Evidence", raw.evidence, CAPS.evidence);
  if (trace.length) prose.push("**Trace.**", ...trace.map((t, i) => `${i + 1}. \`${t}\``), "", ...evidenceBlockLines(evidenceOf(raw.guard, used, scrub)));
  const routes = routesOf(raw.guard, scrub);
  const created = (raw.created ?? []).map((c) => scrub.line(c, CAPS.created));
  const preconditions = (raw.preconditions ?? []).map((p) => ({ text: scrub.line(p.text, CAPS.precondition), status: p.status, ...(p.how && { how: scrub.line(p.how, CAPS.precondition) }) }));
  const interpretations = (raw.interpretations ?? []).slice(0, MAX_INTERPRETATIONS).map((i) => scrub.line(i, CAPS.interpretation));
  const data = {
    ...(ex.tracker && { tracker: scrub.line(ex.tracker) }), feature: ex.feature, level: ex.level, ...(ex.bound_levels && { bound_levels: ex.bound_levels }),
    ...(ex.selected_levels && { selected_levels: ex.selected_levels }), ...(ex.omitted_levels && { omitted_levels: ex.omitted_levels }),
    result: raw.result, ...(raw.reason && { reason: raw.reason }),
    digest: ex.digest, ...(ex.dirty && { dirty: true }), review: ex.review, ...(ex.stale && { stale: true }),
    roles: ex.roles.map((r) => scrub.line(r)), access: raw.access, reached: raw.reached, actions: { used, cap: ex.cap },
    ...(evidence.length && { automation: automationOf(evidence, scrub) }),
    ...(raw.guard?.at_login?.length && { at_login: true }), ...(scrub.hit && { redacted: true }),
    ...(routes.length && { routes }), ...(created.length && { created }), ...(preconditions.length && { preconditions }),
    ...(interpretations.length && { interpretations }),
    ...((raw.interpretations_dropped ?? 0) > 0 && { interpretations_dropped: raw.interpretations_dropped }),
  };
  return { key: ex.key, summary, data, prose, feature: ex.feature, atLogin: data.at_login === true, created: created.length, redacted: scrub.hit };
}

// Every started case's block, the wholly unstarted cases, and any report that did not match the
// contract. It only reads the run dir: `execute ingest` sweeps the sessions first, `execute
// follow-ups` calls this after ingest without sweeping.
/**
 * @param {ExecutePlan} plan
 * @param {string} runDir
 * @param {readonly string[]} [values]
 * @returns {SettledRun}
 */
export function buildBlocks(plan, runDir, values = []) {
  /** @type {ExecutionBlock[]} */
  const blocks = [];
  /** @type {Array<{ key: string, summary: string }>} */
  const notRun = [];
  /** @type {Array<{ execution: string, problems: string[] }>} */
  const problems = [];
  /** @type {Array<{ key: string }>} */
  const unreported = [];
  const marks = dispatchMarks(runDir);
  const automation = readAutomation(runDir);
  const automationById = new Map(automation.map((entry) => [entry.id, entry]));
  const selectionById = new Map((plan.automation?.selections ?? []).map((selection) => [selection.id, selection]));
  for (const ex of plan.executions) {
    const ran = (ex.automations ?? []).flatMap((id) => {
      const found = automationById.get(id);
      return found ? [found] : [];
    });
    const settled = settle(ex, runDir, marks.get(ex.id));
    const decision = executionDecision(ex, automationById);
    if (settled.problems) problems.push({ execution: ex.id, problems: settled.problems });
    if (settled.raw?.unreported) unreported.push({ key: ex.key });
    // A case where nothing started gets no block, so its earlier results stand; the record names
    // it in `not_run`. One that has Automation evidence or an Execution is kept, because something
    // ran.
    const started = ran.length > 0 || !settled.notRun;
    if (!started) {
      notRun.push({ key: ex.key, summary: oneLine(ex.summary) });
      continue;
    }
    // A due Automation the Run never invoked is Blocked `not-run`, but only inside a block that has
    // other started evidence: an unstarted case never inserts an entry of its own.
    const missing = (ex.automations ?? []).filter((id) => !automationById.has(id))
      .map((id) => notRunAutomation(selectionById.get(id), id));
    const evidence = [...ran, ...missing];
    const planSkipped = ex.execution_skipped ?? [];
    const executionSkipped = settled.notRun ? [...planSkipped, ...(!planSkipped.length && decision.follow ? ["not-run"] : [])] : [];
    blocks.push(settled.notRun ? automationBlock(ex, evidence, runDir, executionSkipped, values) : blockOf(ex, settled.raw, evidence, runDir, values));
  }
  // The record shows what this Run actually executed: a bound level with no block stays omitted,
  // whether the filter narrowed it or the Run never reached it.
  /** @type {Map<string, Set<string>>} */
  const executed = new Map();
  for (const block of blocks) {
    if (typeof block.data.level !== "string") continue;
    if (!executed.has(block.key)) executed.set(block.key, new Set());
    (/** @type {Set<string>} */ (executed.get(block.key))).add(block.data.level);
  }
  for (const block of blocks) {
    if (!Array.isArray(block.data.bound_levels) || typeof block.data.level !== "string") continue;
    const levels = executed.get(block.key) ?? new Set();
    block.data.omitted_levels = (/** @type {string[]} */ (block.data.bound_levels)).filter((level) => !levels.has(level));
  }
  return { blocks, notRun, problems, unreported };
}
