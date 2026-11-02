// @ts-check
// The latest Execution result of each live case, read from every Execution record in the
// working tree, committed or not. `/qa-next` shows these as information and `train evidence
// execute` mines them, so both read through `latestExecutionResults`.
//
// A block's key resolves to a live case by its exact key, else through a case's `formerly:`. A key
// a Feature retired (a Merge loser, a deleted case) and a key nothing holds are ignored, and so is
// a record that fails `checkExecution`. The latest block of a case has the greatest
// (Date.parse(executed_at), file, exact key, line); a case a Run skipped keeps its previous block.
// A result is out of date when its `digest` differs from the case's current working-tree digest
// (pin-digest's `review`), so a text edit, a Key rewrite and an uncommitted case all show up.
/**
 * @import { ParsedEntry, ParsedFile } from "./knowledge-file.mjs"
 * @import { KeyIndex, CaseDecl } from "./qa-index.mjs"
 * @import { PinDigests } from "./pin-digest.mjs"
 */
import { checkExecution } from "./check-file.mjs";
import { digests } from "./pin-digest.mjs";

/**
 * Live case key → its latest result:
 * @typedef {{
 *   key: string,
 *   feature: string | null | undefined,
 *   summary: string | undefined,
 *   result: unknown,
 *   reason?: unknown,
 *   executed_at: string,
 *   date: string,
 *   target: unknown,
 *   digest: unknown,
 *   out_of_date: boolean,
 *   at_login?: true,
 *   interpretations?: unknown,
 *   preconditions?: unknown,
 *   why: string | null,
 *   file: string,
 *   line: number,
 * }} ExecutionResult
 */

// What the engineer can do about a result `{result, reason?}` of `feature`, as prose: never a route,
// never a Next step. `/qa-next` and the end-of-Run summary of `execute ingest` both word it
// here; null where nothing helps.
/**
 * @param {{ result?: string | null, reason?: string | null }} result
 * @param {string} feature
 * @returns {string | null}
 */
export function resultHint(result, feature) {
  if (result.result === "failed" || result.reason === "step") return `observe it with \`/qa-deep-dive ${feature} observe:<url> "<what to look at>"\``;
  return (/** @type {Record<string, string>} */ ({
    "no-access": "set up the Role's login with `/qa-train access`",
    precondition: "teach the setup with `/qa-train execute`",
    "ambiguous-actor": "name the Role in each step (`/qa-design`)",
  }))[/** @type {string} */ (result.reason)] ?? null;
}

/**
 * @param {unknown} v
 * @returns {string[]}
 */
const strings = (v) => (Array.isArray(v) ? v.filter((k) => typeof k === "string") : []);

// The text of the Execution's `**Why.**` prose, blank lines dropped; null when it has none.
/**
 * @param {ParsedEntry} entry
 * @returns {string | null}
 */
function whyOf(entry) {
  const lines = [];
  let inWhy = false;
  for (const { text } of entry.prose) {
    const label = /^\*\*([^*]+)\.\*\*\s*(.*)$/.exec(text);
    if (label) {
      inWhy = label[1] === "Why";
      if (inWhy && label[2]) lines.push(label[2]);
    } else if (inWhy && text.trim()) lines.push(text.trim());
  }
  return lines.length ? lines.join("\n") : null;
}

// Greatest first by a tuple of numbers and strings.
/**
 * @param {readonly (number | string)[]} a
 * @param {readonly (number | string)[]} b
 * @returns {boolean}
 */
function later(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// Live case key → its latest block matching `accept`, with the rank used to pick it.
/**
 * @param {readonly (ParsedFile & { unreadable?: unknown })[]} files
 * @param {KeyIndex} index
 * @param {(data: Record<string, unknown>) => boolean} accept
 * @returns {Map<string, { rank: (number | string)[], file: ParsedFile, entry: ParsedEntry }>}
 */
function latestBlocks(files, index, accept) {
  const retired = new Set(files.flatMap((f) => f.type === "feature" && !f.unreadable ? strings(f.data.retired) : []));
  const former = new Map();
  for (const [key, declarations] of index.cases) {
    for (const old of strings(declarations[0].entry.data.formerly)) {
      if (!former.has(old)) former.set(old, new Set());
      former.get(old).add(key);
    }
  }
  /** @param {string} key */
  const resolve = (key) => {
    if (index.cases.has(key)) return { key, exact: 1 };
    if (retired.has(key)) return null;
    const successors = former.get(key);
    return successors?.size === 1 ? { key: [...successors][0], exact: 0 } : null;
  };

  /** @type {Map<string, { rank: (number | string)[], file: ParsedFile, entry: ParsedEntry }>} */
  const latest = new Map();
  for (const file of files) {
    if (file.unreadable || file.type !== "execution" || !checkExecution(file).ok) continue;
    const at = Date.parse(/** @type {string} */ (file.data.executed_at));
    for (const entry of file.executions) {
      if (!accept(entry.data)) continue;
      const found = resolve(entry.key);
      if (!found) continue;
      const rank = [at, file.rel, found.exact, entry.line];
      const before = latest.get(found.key);
      if (before && !later(rank, before.rank)) continue;
      latest.set(found.key, { rank, file, entry });
    }
  }
  return latest;
}

// Live case key → its latest result, in case-index order:
//   {key, feature, summary, result, reason?, executed_at, date, target, digest, out_of_date,
//    at_login?, interpretations?, preconditions?, why, file, line}
// `file` is the record's path under `.qa/`; `why` is null unless the result is Blocked.
/**
 * @param {readonly (ParsedFile & { unreadable?: unknown })[]} files
 * @param {KeyIndex} index
 * @returns {Map<string, ExecutionResult>}
 */
export function latestExecutionResults(files, index) {
  const latest = latestBlocks(files, index, (data) => data.result !== undefined);
  const current = latest.size ? digests(files) : null;
  /** @type {Map<string, ExecutionResult>} */
  const results = new Map();
  for (const key of index.cases.keys()) {
    const hit = latest.get(key);
    if (!hit) continue;
    const { file, entry } = hit;
    const d = entry.data;
    results.set(key, {
      key, feature: (/** @type {CaseDecl[]} */ (index.cases.get(key)))[0].feature, summary: (/** @type {CaseDecl[]} */ (index.cases.get(key)))[0].entry.summary,
      result: d.result, ...(typeof d.reason === "string" && { reason: d.reason }),
      executed_at: /** @type {string} */ (file.data.executed_at), date: (/** @type {string} */ (file.data.executed_at)).slice(0, 10), target: file.data.target,
      digest: d.digest, out_of_date: d.digest !== /** @type {PinDigests} */ (current).review(key),
      ...(d.at_login === true && { at_login: /** @type {true} */ (true) }),
      ...(Array.isArray(d.interpretations) && { interpretations: d.interpretations }),
      ...(Array.isArray(d.preconditions) && { preconditions: d.preconditions }),
      why: d.result === "blocked" ? whyOf(entry) : null,
      file: file.rel, line: entry.line,
    });
  }
  return results;
}

/**
 * Live case key → its latest Automation results, selected independently of the Execution results
 * so a passing Automation never stands in for a manual pass, or the other way round.
 * @typedef {{
 *   key: string,
 *   feature: string | null | undefined,
 *   summary: string | undefined,
 *   automation: Array<Record<string, unknown>>,
 *   executed_at: string,
 *   date: string,
 *   target: unknown,
 *   out_of_date: boolean,
 *   file: string,
 *   line: number,
 * }} AutomationResults
 */

/**
 * @param {readonly (ParsedFile & { unreadable?: unknown })[]} files
 * @param {KeyIndex} index
 * @returns {Map<string, AutomationResults>}
 */
export function latestAutomationResults(files, index) {
  const latest = latestBlocks(files, index, (data) => Array.isArray(data.automation) && data.automation.length > 0);
  const current = latest.size ? digests(files) : null;
  /** @type {Map<string, AutomationResults>} */
  const results = new Map();
  for (const key of index.cases.keys()) {
    const hit = latest.get(key);
    if (!hit) continue;
    const { file, entry } = hit;
    const declarations = /** @type {CaseDecl[]} */ (index.cases.get(key));
    results.set(key, {
      key, feature: declarations[0].feature, summary: declarations[0].entry.summary,
      automation: /** @type {Array<Record<string, unknown>>} */ (entry.data.automation),
      executed_at: /** @type {string} */ (file.data.executed_at), date: (/** @type {string} */ (file.data.executed_at)).slice(0, 10), target: file.data.target,
      out_of_date: entry.data.digest !== /** @type {PinDigests} */ (current).review(key),
      file: file.rel, line: entry.line,
    });
  }
  return results;
}
