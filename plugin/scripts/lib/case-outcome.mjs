// @ts-check
import { worstAutomationResult } from "./execute-chain.mjs";
/**
 * The identity of the claim whose evidence one Run produced at one Application target.
 * @typedef {{ key: string, run: string, target: string, digest: string }} CaseOutcomeIdentity
 *
 * One level's settled evidence. A Tester's result takes precedence over its Automations.
 * Failed Automations await a Tester; they alone do not establish an application failure.
 * @typedef {CaseOutcomeIdentity & {
 *   level?: string,
 *   result?: string,
 *   automation?: ReadonlyArray<{ result?: string }>,
 * }} CaseOutcomeEvidence
 *
 * A Case outcome is derived, never stored independently of its evidence.
 * @typedef {{ result: 'failed' | 'blocked' | 'passed' | 'incomplete', failing_levels: string[], omitted_levels: string[] }} CaseOutcome
 */

/**
 * One level's settled result: a Tester's result, else its Automations' worst, with a Failed
 * Automation awaiting its Tester and Flaky counting as Passed.
 * @param {CaseOutcomeEvidence} entry
 * @returns {string | undefined}
 */
function levelResult(entry) {
  if (entry.result !== undefined) return entry.result;
  const automation = worstAutomationResult((entry.automation ?? []).flatMap((a) => a.result ? [a.result] : []));
  if (automation === undefined || automation === 'failed') return undefined;
  return automation === 'flaky' ? 'passed' : automation;
}

/**
 * Project one claim's Case outcome without mixing Runs, Application targets or claim digests.
 * `boundLevels` is the binding pinned when the Run was planned; [] denotes a Layer-free case.
 * @param {CaseOutcomeIdentity} identity
 * @param {readonly string[]} boundLevels
 * @param {readonly CaseOutcomeEvidence[]} evidence
 * @returns {CaseOutcome}
 */
export function caseOutcome(identity, boundLevels, evidence) {
  const matching = evidence.filter((entry) => entry.key === identity.key && entry.run === identity.run &&
    entry.target === identity.target && entry.digest === identity.digest)
    .map((entry) => ({ ...entry, result: levelResult(entry) }));
  const failing_levels = [...new Set(matching.filter((entry) => entry.result === 'failed').flatMap((entry) => entry.level ? [entry.level] : []))];
  const omitted_levels = boundLevels.filter((level) => !matching.some((entry) => entry.level === level && entry.result));
  const result = matching.some((entry) => entry.result === 'failed') ? 'failed'
    : matching.some((entry) => entry.result === 'blocked') ? 'blocked'
    : omitted_levels.length || !matching.some((entry) => entry.result) ? 'incomplete' : 'passed';
  return { result, failing_levels, omitted_levels };
}
