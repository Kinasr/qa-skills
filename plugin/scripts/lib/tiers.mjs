// @ts-check
// Tiers (ADR-0021): the engineer maps a model label to each Tier in `project.md`'s `tiers`; the
// framework, never the project, binds every agent to a Tier. An unpicked Tier, or one set to
// `inherit`, runs on the session's own model.
import { FALLBACK, isModelLabel } from "./keys.mjs";
import { projectConfig } from "./knowledge-file.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";

// Each agent's Tier. The one table: no skill states a Tier, and `project.md` cannot override it.
/** @type {Record<string, string>} */
export const BINDING = {
  "impact judge": "deep",
  "design fill": "standard",
  "ui scout": "standard",
  "tracker scout": "light",
  publisher: "light",
  tester: "standard",
};

// The Tier `agent` is bound to and the model label it runs on: `{tier, label}`, `label` being
// `project`'s `tiers.<tier>`, else the Fallback `inherit`. A malformed value is check-file's to
// report, and is passed over here.
/**
 * @param {import("./knowledge-file.mjs").ProjectSource} project - the parsed `project.md`, or null when there is none
 * @param {string} agent
 * @returns {{ tier: string, label: string }}
 */
export function tierFor(project, agent) {
  const tier = BINDING[agent];
  const picked = projectConfig(project).tiers[tier];
  return { tier, label: isModelLabel(picked) ? picked : FALLBACK };
}

// `tierFor` for the working tree at `root`.
/**
 * @param {string} root
 * @param {string} agent
 * @returns {{ tier: string, label: string }}
 */
export const tierOf = (root, agent) => tierFor(buildIndex(loadWorkingTree(root)).project, agent);

// The model a subagent is spawned with for `label`: none for the Fallback `inherit`, which runs on
// the session's own model, else the label as given (ADR-0020).
/**
 * @param {string | null} label
 * @returns {string | null}
 */
export const subagentModel = (label) => (label === FALLBACK ? null : label);
