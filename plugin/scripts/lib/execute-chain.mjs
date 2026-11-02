// @ts-check
// The chain from a case's Automations to the Tester's Execution: an aggregate Automation result
// (Failed > Blocked > Flaky > Passed) decides whether an Execution follows. A case with no
// Automation follows straight to an Execution; only a Failed aggregate sends an automated case
// there. `execute next` uses this to decide what to start, and `execute ingest` uses it to explain
// an Execution that was due but never started.
import { displaySelector } from "./runners/index.mjs";
/** @import { AutomationResult, AutomationSelection } from "./test-runner.mjs" */
/** @import { ExecuteExecution } from "./execute.mjs" */

// Worst first.
/** @type {readonly ["failed", "blocked", "flaky", "passed"]} */
export const AUTOMATION_WORST = ["failed", "blocked", "flaky", "passed"];

/**
 * Whether `value` is one of the four Automation results.
 * @param {string} value
 * @returns {value is "failed" | "blocked" | "flaky" | "passed"}
 */
function isAutomationResult(value) {
  return /** @type {readonly string[]} */ (AUTOMATION_WORST).includes(value);
}

/**
 * The worst of a list of Automation result words (Failed > Blocked > Flaky > Passed), or undefined
 * when none is a result.
 * @param {readonly string[]} results
 * @returns {"passed" | "failed" | "flaky" | "blocked" | undefined}
 */
export function worstAutomationResult(results) {
  /** @type {"passed" | "failed" | "flaky" | "blocked" | undefined} */
  let worst;
  for (const result of results) {
    if (!isAutomationResult(result)) continue;
    if (worst === undefined || AUTOMATION_WORST.indexOf(result) < AUTOMATION_WORST.indexOf(worst)) worst = result;
  }
  return worst;
}

/**
 * The worst result of a case's Automation results, or undefined when none ran.
 * @param {ReadonlyArray<Pick<AutomationResult, "result">>} entries
 * @returns {"passed" | "failed" | "flaky" | "blocked" | undefined}
 */
export function aggregateAutomation(entries) {
  return worstAutomationResult(entries.map((entry) => entry.result));
}

/**
 * Whether a Tester Execution follows this case, and why not: `{follow, aggregate, missing}`.
 * `missing` names the case's Automations with no result yet (a due but unstarted Automation),
 * which Block the chain instead of sending the case to an Execution.
 * @param {Pick<ExecuteExecution, "automations">} ex
 * @param {ReadonlyMap<string, AutomationResult>} results
 * @returns {{ follow: boolean, aggregate?: "passed" | "failed" | "flaky" | "blocked", missing: string[] }}
 */
export function executionDecision(ex, results) {
  const due = ex.automations ?? [];
  if (!due.length) return { follow: true, missing: [] };
  const entries = due.flatMap((id) => {
    const found = results.get(id);
    return found ? [found] : [];
  });
  const missing = due.filter((id) => !results.has(id));
  const aggregate = aggregateAutomation(entries);
  return { follow: missing.length === 0 && aggregate === "failed", ...(aggregate && { aggregate }), missing };
}

/**
 * The Automation entry a case block records for an Automation that was due but never invoked. It
 * is Blocked `not-run`; ingest writes it only into a block with other started evidence.
 * @param {AutomationSelection | undefined} selection
 * @param {string} id
 * @returns {AutomationResult}
 */
export function notRunAutomation(selection, id) {
  return {
    id,
    stack: selection?.stack ?? ".",
    selector: selection ? displaySelector(selection) : id,
    result: "blocked",
    reason: "not-run",
    attempts: [{ result: "blocked", reason: "not-run" }],
    diagnostics: [],
  };
}
