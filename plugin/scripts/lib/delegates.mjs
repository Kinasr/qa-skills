// @ts-check
// Delegate resolution (ADR-0020, ADR-0021): which model
// a Run dispatches to, the Fallback behind it, and the concurrency cap. A Delegate runs on a model
// label, bound by its agent's Tier (lib/tiers.mjs) and read from the working tree's
// `.qa/project.md`. Never writes.
import { FALLBACK } from "./keys.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { tierFor } from "./tiers.mjs";

/**
 * A note made during delegate resolution or concurrency calculation.
 * @typedef {{
 *   code: string,
 *   message: string,
 * }} DelegateNote
 */

/**
 * Successful result of resolving delegates for a command.
 * @typedef {{
 *   chosen: { label: string, tier: string },
 *   fallback: string,
 *   concurrency_cap: number,
 *   notes: DelegateNote[],
 *   error?: never,
 * }} DelegateResolutionSuccess
 */

/**
 * Error result of resolving delegates for an invalid command.
 * @typedef {{
 *   error: string,
 *   chosen?: never,
 *   fallback?: never,
 *   concurrency_cap?: never,
 *   notes?: never,
 * }} DelegateResolutionError
 */

/**
 * Result of resolving delegates for a command.
 * @typedef {DelegateResolutionSuccess | DelegateResolutionError} DelegateResolutionResult
 */

// The commands that delegate, each with the agent its units run as.
/** @type {Record<string, string>} */
export const AGENTS = { impact: "impact judge", design: "design fill" };

// The plugin agent each command's units run as: the plugin manifest names `qa-skills`, so a plugin
// agent is addressed as `qa-skills:<name>`. One mapping, so every attempt and Fallback of a Run
// keeps the same scoped agent.
/** @type {Record<string, string>} */
export const AGENT_TYPES = { impact: "qa-skills:qa-judge", design: "qa-skills:qa-filler" };

/** @type {string[]} */
export const COMMANDS = Object.keys(AGENTS);

// Used when `project.md`'s `concurrency_cap` is missing or invalid (an Integrity error of its own).
/** @type {number} */
export const DEFAULT_CONCURRENCY = 4;

// `{chosen: {label, tier}, fallback, concurrency_cap, notes}`, or `{error}` for a usage error.
/**
 * @param {string | undefined} root
 * @param {{ cmd: unknown }} options
 * @returns {DelegateResolutionResult}
 */
export function resolveDelegates(root, { cmd }) {
  if (!COMMANDS.includes(/** @type {string} */ (cmd))) return { error: `--cmd must be one of ${COMMANDS.join(", ")} (got \`${cmd ?? ""}\`)` };
  const { project } = buildIndex(loadWorkingTree(root));
  const { tier, label } = tierFor(project, AGENTS[/** @type {string} */ (cmd)]);
  /** @type {DelegateNote[]} */
  const notes = [];
  return { chosen: { label, tier }, fallback: FALLBACK, concurrency_cap: concurrencyCap(project, notes), notes };
}

// The `concurrency_cap` of `project`, else the default; a missing or invalid one adds a note.
/**
 * @param {{ data?: { concurrency_cap?: unknown } } | null | undefined} project
 * @param {DelegateNote[]} [notes]
 * @returns {number}
 */
export function concurrencyCap(project, notes = []) {
  const cap = project?.data?.concurrency_cap;
  if (Number.isInteger(cap) && /** @type {number} */ (cap) >= 1) return /** @type {number} */ (cap);
  notes.push({ code: "concurrency_cap_invalid", message: `\`project.md\` has no valid \`concurrency_cap\`; using ${DEFAULT_CONCURRENCY}` });
  return DEFAULT_CONCURRENCY;
}
