// @ts-check
// The Automation run's rules: a stack adapter reports one ordered-attempt list per
// instance, and this module turns that map into one Automation result. It knows no tool, so the
// Gradle and Maven adapters reuse it unchanged.
//
// The rules, computed from the per-instance map:
//   - an attempt fails when any instance failed at it;
//   - Failed when every attempt failed (one variant that always fails is not Flaky);
//   - Flaky only when one instance both failed and passed at some point;
//   - a Blocked attempt with no pass/fail mix makes the result Blocked;
//   - a runner-level reason (`runner-error`, `no-result`) Blocks the whole Automation.
import { scrubPageText } from "./credentials.mjs";
import { AUTOMATION_DIAGNOSTIC_CAP, AUTOMATION_DIAGNOSTICS_MAX } from "./schema.mjs";

/**
 * @typedef {"no-command" | "runner-error" | "no-result" | "skipped" | "not-run"} AutomationBlockedReason
 */

/**
 * One attempt at an instance: passed, failed, or Blocked with the reason.
 * @typedef {{
 *   result: "passed" | "failed" | "blocked",
 *   reason?: AutomationBlockedReason,
 * }} AutomationAttempt
 */

/**
 * What a tool's parser reports for one requested Automation, before the attempt rules:
 * `instances` maps each instance id to its ordered attempts.
 * @typedef {{
 *   instances: Record<string, AutomationAttempt[]>,
 *   reason?: AutomationBlockedReason,
 *   diagnostics: string[],
 * }} RunnerResult
 */

/**
 * The test the CLI asks the runner to run, from the code index.
 * @typedef {{
 *   id: string,
 *   stack: string,
 *   file: string,
 *   line: number,
 *   titles: string[],
 *   literal: boolean,
 *   tagged: boolean,
 *   package?: string,
 * }} AutomationSelection
 */

/**
 * One Automation result, as the record's `automation:` entry holds it.
 * @typedef {{
 *   id: string,
 *   stack: string,
 *   selector: string,
 *   result: "passed" | "failed" | "flaky" | "blocked",
 *   reason?: AutomationBlockedReason,
 *   attempts: AutomationAttempt[],
 *   diagnostics: string[],
 *   target?: "own",
 * }} AutomationResult
 */

// Redacted before it is cut: a credential spanning the cut would otherwise reach the record, where
// `check-file` refuses it. One line, with each backslash shown as `/`.
/**
 * @param {unknown} text
 * @returns {string}
 */
function diagnostic(text) {
  const swept = scrubPageText(text).split("\n").join(" ");
  const safe = swept.replaceAll("\\", "/").replace(/[\r\n]+/g, " ").trim();
  return safe.length > AUTOMATION_DIAGNOSTIC_CAP ? `${safe.slice(0, AUTOMATION_DIAGNOSTIC_CAP - 1).trimEnd()}…` : safe;
}

/**
 * The ordered attempts of the Automation, one per attempt number, plus what the result rules need
 * to know. An instance that reported no attempt at that number (an unstarted project of an
 * interrupted run) contributes nothing to it.
 * @param {Record<string, AutomationAttempt[]>} instances
 * @returns {{ attempts: AutomationAttempt[], mixed: boolean, blocked: AutomationAttempt | undefined, everyFailed: boolean }}
 */
export function attemptRules(instances) {
  const lists = Object.values(instances);
  const count = Math.max(0, ...lists.map((attempts) => attempts.length));
  /** @type {AutomationAttempt[]} */
  const attempts = [];
  for (let i = 0; i < count; i++) {
    const at = lists.flatMap((list) => (i < list.length ? [list[i]] : []));
    if (!at.length) continue;
    if (at.some((attempt) => attempt.result === "failed")) attempts.push({ result: "failed" });
    else {
      const blocked = at.find((attempt) => attempt.result === "blocked");
      if (blocked) attempts.push({ result: "blocked", reason: blocked.reason ?? "runner-error" });
      else attempts.push({ result: "passed" });
    }
  }
  const mixed = lists.some((list) => list.some((a) => a.result === "passed") && list.some((a) => a.result === "failed"));
  return {
    attempts,
    mixed,
    blocked: attempts.find((attempt) => attempt.result === "blocked"),
    everyFailed: attempts.length > 0 && attempts.every((attempt) => attempt.result === "failed"),
  };
}

/**
 * One Automation's result: its ordered attempts, the result, its Blocked reason, and redacted,
 * bounded diagnostics that name the failing instances.
 * @param {AutomationSelection} selection
 * @param {RunnerResult} parsed
 * @param {string} selector
 * @param {boolean} ownTarget
 * @returns {AutomationResult}
 */
export function automationResult(selection, parsed, selector, ownTarget) {
  const instances = Object.entries(parsed.instances);
  const { attempts, mixed, blocked, everyFailed } = attemptRules(parsed.instances);
  const runnerReason = parsed.reason ?? (instances.length ? undefined : "no-result");
  /** @type {AutomationResult["result"]} */
  let result;
  /** @type {AutomationBlockedReason | undefined} */
  let reason;
  if (runnerReason) {
    result = "blocked";
    reason = runnerReason;
    attempts.length = 0;
    attempts.push({ result: "blocked", reason: runnerReason });
  } else if (everyFailed) result = "failed";
  else if (mixed) result = "flaky";
  else if (blocked) {
    result = "blocked";
    reason = blocked.reason;
  } else result = "passed";
  const details = [
    ...instances.filter(([, list]) => list.some((attempt) => attempt.result === "failed")).map(([id]) => `Failing instance: ${id}`),
    ...parsed.diagnostics,
  ];
  return {
    id: selection.id,
    stack: selection.stack,
    selector,
    result,
    ...(reason && { reason }),
    attempts,
    diagnostics: details.map(diagnostic).filter(Boolean).slice(0, AUTOMATION_DIAGNOSTICS_MAX),
    ...(ownTarget && { target: "own" }),
  };
}
