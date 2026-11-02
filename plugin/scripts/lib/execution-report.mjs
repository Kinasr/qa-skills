// @ts-check
// The Tester's report grammar (with the directional `reached` rule): one parser for `execute record` and `execute ingest`, so a report either matches the contract
// for both or for neither.
//
//   ```yaml
//   result: passed | failed | blocked
//   reason: <one the Tester may report>   only on blocked
//   reached: <n>                          the last step started; 0 = setup
//   created: ["<label>", …]               optional
//   preconditions:                        optional; one item per precondition of the case
//     - text: …
//       status: established | checked | unmet | skipped
//       how: …                            optional
//   interpretations:                      optional
//     - "<setup | step N | expected>: <what the text left open> → <what I did>"
//   ```
//   then labelled prose: **Expected.** and **Seen.** (failed), **Why.** (blocked), optional **Evidence.**
//
// `validateReport(text, execution)` -> `{ok: true, report}` or `{ok: false, problems}`. `execution` is the
// plan's entry; its pinned `text` bounds `reached` by the case's steps and the preconditions by its own.
// A problem is `{line, message}`, the line a 1-based line of the report and the message fixed words: what
// the Tester wrote is never echoed back (it may hold a secret). Lengths are not checked: ingest clamps
// them. `report` holds the YAML fields as written (an empty `interpretations` stays `[]`, for ingest to
// drop) and the prose as `expected`, `seen`, `why`, `evidence`.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TESTER_REASONS } from "./check-file.mjs";
import { GUARD_ONLY_STOPS } from "./execution-guard.mjs";
import { caseSteps, casePreconditions } from "./case-fields.mjs";
import { isMap, parseYaml } from "./dialect.mjs";
import { parse } from "./knowledge-file.mjs";

/** @import { ExecuteExecution } from "./execute.mjs" */
/** @import { CaseFieldEntry } from "./case-fields.mjs" */
/** @import { ExecutionGuardStop } from "./execution-guard.mjs" */

/**
 * A problem reported during validation of an Execution report.
 * @typedef {{
 *   line?: number,
 *   message: string,
 * }} ReportProblem
 */

/**
 * Precondition entry in an Execution report.
 * @typedef {{
 *   text: string,
 *   status: "established" | "checked" | "unmet" | "skipped",
 *   how?: string,
 * }} ReportPrecondition
 */

/**
 * Validated Execution report fields and prose sections.
 * @typedef {{
 *   result: "passed" | "failed" | "blocked",
 *   reason?: string,
 *   reached: number,
 *   created?: string[],
 *   preconditions?: ReportPrecondition[],
 *   interpretations?: string[],
 *   expected?: string,
 *   seen?: string,
 *   why?: string,
 *   evidence?: string,
 *   [key: string]: unknown,
 * }} ExecutionReport
 */

/**
 * Result of validating an Execution report against the case.
 * @typedef {{
 *   ok: true,
 *   report: ExecutionReport,
 *   problems?: never,
 * } | {
 *   ok: false,
 *   problems: ReportProblem[],
 *   report?: never,
 * }} ValidateReportResult
 */

/**
 * Outcome of reading and checking an Execution report file.
 * @typedef {{
 *   missing: true,
 *   ok?: never,
 *   problems?: never,
 *   report?: never,
 * } | {
 *   missing?: never,
 *   ok: false,
 *   problems: ReportProblem[],
 *   report?: never,
 * } | {
 *   missing?: never,
 *   ok: true,
 *   problems?: never,
 *   report: ExecutionReport,
 * }} CheckedReportResult
 */

const FIELDS = ["result", "reason", "reached", "created", "preconditions", "interpretations"];
const RESULTS = ["passed", "failed", "blocked"];
const STATUSES = ["established", "checked", "unmet", "skipped"];
const INTERPRETATION = /^(?:setup|step [1-9]\d*|expected): .+ → .+$/;
const LABELS = ["Expected", "Seen", "Why", "Evidence"];
const REQUIRED = { passed: [], failed: ["Expected", "Seen"], blocked: ["Why"] };
const nonEmpty = (/** @type {unknown} */ v) => typeof v === "string" && v.trim() !== "";

// The steps and preconditions of the pinned case text, or null when it does not read as an entry.
/**
 * @param {unknown} text
 * @returns {{ steps: number, preconditions: number } | null}
 */
function caseCounts(text) {
  if (typeof text !== "string") return null;
  const entry = parse("case.md", `---\ntype: scenario\n---\n\n${text}`).cases[0];
  return entry ? { steps: caseSteps(/** @type {CaseFieldEntry} */ (entry)).length, preconditions: casePreconditions(/** @type {CaseFieldEntry} */ (entry)).length } : null;
}

/**
 * @param {unknown} text
 * @param {ExecuteExecution | { text?: string } | null | undefined} [execution]
 * @returns {ValidateReportResult}
 */
export function validateReport(text, execution) {
  /** @type {ReportProblem[]} */
  const problems = [];
  const bad = (/** @type {number} */ line, /** @type {string} */ message) => problems.push({ line, message });
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const open = lines.findIndex((l) => l.trim() !== "");
  if (open < 0 || lines[open].trim() !== "```yaml") return { ok: false, problems: [{ line: Math.max(open, 0) + 1, message: "the report opens with a `yaml` block" }] };
  const close = lines.findIndex((l, i) => i > open && l.trim() === "```");
  if (close < 0) return { ok: false, problems: [{ line: open + 1, message: "the `yaml` block is never closed" }] };

  const yaml = parseYaml(lines.slice(open + 1, close).join("\n"), open + 2);
  for (const e of yaml.errors) bad(e.line, "the `yaml` block is outside the report grammar");
  const d = yaml.data;
  const at = (/** @type {string} */ key) => yaml.keyLines[key] ?? open + 2;
  for (const key of Object.keys(d)) if (!FIELDS.includes(key)) bad(at(key), "the `yaml` block holds a field the report does not have");
  const counts = caseCounts(execution?.text);

  if (!RESULTS.includes(/** @type {string} */ (d.result))) bad(at("result"), "`result` is passed, failed or blocked");
  if (d.result === "blocked" && !TESTER_REASONS.includes(/** @type {string} */ (d.reason))) bad(at("reason"), "a blocked report names a reason the Tester may report");
  if (d.result !== "blocked" && d.reason !== undefined) bad(at("reason"), "`reason` belongs to a blocked report only");
  if (!Number.isSafeInteger(d.reached) || /** @type {number} */ (d.reached) < 0) bad(at("reached"), "`reached` is the last step started, an integer from 0");
  else if (d.reason === "precondition" && d.reached !== 0) bad(at("reached"), "this reason is reached 0, in setup");
  else if ((d.result === "passed" || d.result === "failed" || d.reason === "ambiguous-actor") && /** @type {number} */ (d.reached) < 1) bad(at("reached"), "this result has started a step: `reached` is at least 1");
  else if (counts && /** @type {number} */ (d.reached) > counts.steps) bad(at("reached"), "`reached` is past the case's last step");

  if (d.created !== undefined && !(Array.isArray(d.created) && d.created.every(nonEmpty))) bad(at("created"), "`created` is a list of labels");
  if (d.interpretations !== undefined && !(Array.isArray(d.interpretations) && d.interpretations.every((s) => typeof s === "string" && INTERPRETATION.test(s)))) {
    bad(at("interpretations"), "an interpretation is `<setup | step N | expected>: <what the text left open> → <what I did>`");
  }
  if (d.preconditions !== undefined) checkPreconditions(d.preconditions, counts, at("preconditions"), bad);

  const prose = readProse(lines, close + 1, bad);
  if (RESULTS.includes(/** @type {string} */ (d.result))) {
    const allowed = [...REQUIRED[/** @type {keyof typeof REQUIRED} */ (d.result)], "Evidence"];
    let last = -1;
    for (const label of prose.labels) {
      if (!allowed.includes(label.name)) bad(label.line, "this label does not belong to this result");
      else if (LABELS.indexOf(label.name) < last) bad(label.line, "labels come in the order Expected, Seen, Why, Evidence");
      last = Math.max(last, LABELS.indexOf(label.name));
    }
    for (const name of REQUIRED[/** @type {keyof typeof REQUIRED} */ (d.result)]) if (!prose.sections.get(name)?.trim()) bad(close + 1, `the ${d.result} report needs a non-empty **${name}.**`);
  }
  if (problems.length) return { ok: false, problems };

  /** @type {Record<string, unknown>} */
  const report = {};
  for (const key of FIELDS) if (d[key] !== undefined) report[key] = d[key];
  for (const name of LABELS) if (prose.sections.has(name)) report[name.toLowerCase()] = (/** @type {string} */ (prose.sections.get(name))).trim();
  return { ok: true, report: /** @type {ExecutionReport} */ (report) };
}

const MAX_REPORT_BYTES = 262144;

// The report of the Execution whose dir is `execDir`, read and checked once for `execute record` and
// `execute ingest` alike: `{missing: true}` when the Tester wrote none, else `validateReport`'s answer
// (a problem's `line` is left out when it is the file's). `stopped` is the guard's sticky stop: any
// reason in `GUARD_ONLY_STOPS` that the guard never set is off-contract.
// `used` is the guard's action count: a Passed or Failed report from a Tester that took no action, with
// nothing stopping it, claims a result it never observed, so it is off-contract too.
/**
 * @param {string} execDir
 * @param {ExecuteExecution | { text?: string } | null | undefined} execution
 * @param {{ stopped?: string | null, used?: number }} options
 * @returns {CheckedReportResult}
 */
export function checkedReport(execDir, execution, { stopped, used }) {
  const file = join(execDir, "report.md");
  if (!existsSync(file)) return { missing: true };
  if (statSync(file).size > MAX_REPORT_BYTES) return { ok: false, problems: [{ message: `larger than ${MAX_REPORT_BYTES} bytes` }] };
  const checked = validateReport(readFileSync(file, "utf8"), execution);
  if (checked.ok && GUARD_ONLY_STOPS.includes(/** @type {ExecutionGuardStop} */ (checked.report.reason)) && checked.report.reason !== stopped) {
    return { ok: false, problems: [{ message: "a Blocked reason only the guard sets" }] };
  }
  if (checked.ok && ["passed", "failed"].includes(checked.report.result) && !stopped && !(/** @type {number} */ (used) >= 1)) {
    return { ok: false, problems: [{ message: "a Passed or Failed report needs at least one counted action" }] };
  }
  return checked;
}

/**
 * @param {unknown} list
 * @param {{ steps: number, preconditions: number } | null} counts
 * @param {number} line
 * @param {(line: number, message: string) => void} bad
 * @returns {void}
 */
function checkPreconditions(list, counts, line, bad) {
  if (!Array.isArray(list)) return bad(line, "`preconditions` is a list");
  if (counts && list.length !== counts.preconditions) bad(line, "`preconditions` has one item per precondition of the case");
  let unmet = false;
  for (const p of list) {
    const ok = isMap(p) && Object.keys(p).every((k) => ["text", "status", "how"].includes(k)) && nonEmpty(p.text) && STATUSES.includes(/** @type {string} */ (p.status)) && (p.how === undefined || nonEmpty(p.how));
    if (!ok) return bad(line, "a precondition is `text`, `status` (established, checked, unmet or skipped) and an optional `how`");
    if (unmet && p.status !== "skipped") return bad(line, "every precondition after the first unmet one is skipped");
    if (p.status === "unmet") unmet = true;
  }
}

// The labelled prose after the block: `{labels: [{name, line}], sections: Map<name, text>}`. A heading, a
// fence, an unknown or repeated label and text before the first label are problems.
/**
 * @param {string[]} lines
 * @param {number} from
 * @param {(line: number, message: string) => void} bad
 * @returns {{ labels: Array<{ name: string, line: number }>, sections: Map<string, string> }}
 */
function readProse(lines, from, bad) {
  const labels = [];
  const sections = new Map();
  let current = null;
  for (let i = from; i < lines.length; i++) {
    const text = lines[i];
    if (/^\s*(?:```|~~~)/.test(text) || /^#{1,6}(?:\s|$)/.test(text)) {
      bad(i + 1, "the report has no headings or fences after its `yaml` block");
      continue;
    }
    const label = /^\*\*([A-Za-z]+)\.\*\*(?:\s+(.*))?$/.exec(text);
    if (label) {
      const name = label[1];
      if (!LABELS.includes(name) || sections.has(name)) bad(i + 1, "a label is Expected, Seen, Why or Evidence, once each");
      labels.push({ name, line: i + 1 });
      current = name;
      if (!sections.has(name)) sections.set(name, label[2] ?? "");
    } else if (/^\*\*[^*]+\.\*\*/.test(text)) {
      bad(i + 1, "a label is Expected, Seen, Why or Evidence, once each");
    } else if (current) sections.set(current, `${sections.get(current)}\n${text}`);
    else if (text.trim() !== "") bad(i + 1, "prose opens with a label");
  }
  return { labels, sections };
}

/**
 * @param {string} yaml
 * @param {string} prose
 * @returns {string}
 */
const BLOCK = (yaml, prose) => `\`\`\`yaml\n${yaml}\n\`\`\`\n\n${prose}\n`;

// One valid report per result, printed in the brief (and kept valid by a test).
/** @type {Record<"passed" | "failed" | "blocked", string>} */
export const REPORT_EXAMPLES = {
  passed: BLOCK([
    "result: passed", "reached: 3", 'created: ["Member qa-k4m8x2pw", "Loan qa-k4m8x2pw"]',
    "preconditions:", "  - text: A Member exists", "    status: established", "    how: created in the UI", "  - text: A Book is on the shelf", "    status: checked",
    "interpretations:", '  - "step 2: the text did not say which Book → I borrowed the first one listed"',
  ].join("\n"), "**Evidence.** After Save the Loans list showed the new Loan for the Member."),
  failed: BLOCK(["result: failed", "reached: 3", 'created: ["Member qa-k4m8x2pw"]'].join("\n"),
    "**Expected.** The Loan is created.\n\n**Seen.** Save showed \"No copy available\" and the Loans list stayed empty."),
  blocked: BLOCK([
    "result: blocked", "reason: precondition", "reached: 0",
    "preconditions:", "  - text: A Member exists", "    status: unmet", "    how: the new-Member form rejected every input", "  - text: A Book is on the shelf", "    status: skipped",
  ].join("\n"), "**Why.** No Member could be created, so the case never started."),
};
