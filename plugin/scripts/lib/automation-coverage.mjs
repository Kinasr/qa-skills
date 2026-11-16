// @ts-check
// Automation gaps are about a case's supported bindings. Unsupported levels stay separate from
// both missing and covered levels; a Layer-free case needs any bound Automation.
import { caseLevels } from "./case-fields.mjs";
import { automationLevel, codegenApproaches } from "./codegen-approaches.mjs";

/** @import { ProjectConfig } from "./knowledge-file.mjs" */
/**
 * @typedef {{ data: Record<string, unknown> } | null} ApproachTraining
 * @typedef {{ gap: boolean, bound: string[], supported: string[], covered: string[], missing: string[], unsupported: string[] }} AutomationCoverage
 */

/**
 * Training with no approaches retains executable-level capabilities for Layer-free and single-level
 * cases. Coverage cannot attribute legacy Automations to a multi-level binding.
 * @param {ApproachTraining} train
 * @param {ProjectConfig} config
 * @returns {string[]}
 */
export function supportedCodegenLevels(train, config) {
  if (train?.data.approaches === undefined) return Object.keys(config.execute_levels ?? {});
  return [...new Set(codegenApproaches(train, config.levels).map((entry) => entry.level))].sort();
}

/**
 * Project a case's Automation gap using the same path mapping as scan and execute.
 * @param {Record<string, unknown>} entry
 * @param {Record<string, unknown>} file
 * @param {ProjectConfig} config
 * @param {ApproachTraining} train
 * @param {ReadonlyMap<string, { file: string }>} automations
 * @returns {AutomationCoverage}
 */
export function automationCoverage(entry, file, config, train, automations) {
  const legacy = train?.data.approaches === undefined;
  const bound = caseLevels(entry, file, config.schemaVersion);
  const available = supportedCodegenLevels(train, config);
  const unattributed = legacy && bound.length > 1;
  const supported = unattributed ? [] : bound.filter((level) => available.includes(level));
  const unsupported = unattributed ? bound : legacy ? [] : bound.filter((level) => !available.includes(level));
  const keys = /** @type {string[]} */ (Array.isArray(entry.automates) ? entry.automates.filter((key) => typeof key === "string") : []);
  const approaches = codegenApproaches(train, config.levels);
  const levels = new Set(keys.map((key) => automations.get(key)).filter((aut) => aut !== undefined).map((aut) => automationLevel(aut.file, approaches)));
  const covered = supported.filter((level) => levels.has(level) || (legacy && keys.length > 0));
  const missing = supported.filter((level) => !covered.includes(level));
  return { gap: entry.automatable !== false && !unattributed && (legacy || !bound.length ? keys.length === 0 : missing.length > 0), bound, supported, covered, missing, unsupported };
}
