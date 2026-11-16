// @ts-check
// The Permissions drift rule `scan` reports and `design report` shows before Review (ADR-0056): a
// Test Case covering a Rule the Feature's covered `permissions` Coverage line names states a denial,
// so it binds every executable level. A Layer-free case drifts too when more than one level is
// executable: a Layer-free denial holds on any one layer, never on each of them.
import { caseLevels } from "./case-fields.mjs";
import { parseCoverage } from "./coverage.mjs";
import { LAYER_FREE_CASE_SCHEMA_VERSION } from "./schema.mjs";

/** @import { CaseEntry, ParsedFile, ProjectConfig } from "./knowledge-file.mjs" */

/**
 * The Rules the Feature's covered `permissions` Coverage line names. A Feature without the section,
 * or with the category n/a or awaiting, names none.
 * @param {ParsedFile | null | undefined} feature
 * @returns {Set<string>}
 */
export function permissionRulesOf(feature) {
  if (!feature) return new Set();
  const line = parseCoverage(feature.text)?.lines.find((candidate) => candidate.key === "permissions" && candidate.disposition === "covered");
  return new Set(line?.rules ?? []);
}

/**
 * The executable levels a Test Case covering a Permissions Rule is not bound to, in project order.
 * Empty when no warning applies: below the Layer-free schema, no Permissions Rule covered, no
 * executable level, a Layer-free case with one executable level, or a case bound to all of them.
 * @param {CaseEntry} c
 * @param {ParsedFile} scenario
 * @param {ReadonlySet<string>} permissionRules
 * @param {ProjectConfig} config
 * @returns {string[]}
 */
export function missingPermissionLevels(c, scenario, permissionRules, config) {
  if ((config.schemaVersion ?? 1) < LAYER_FREE_CASE_SCHEMA_VERSION || permissionRules.size === 0) return [];
  const covered = Array.isArray(c.data.covers) ? c.data.covers : [];
  if (!covered.some((rule) => typeof rule === "string" && permissionRules.has(rule))) return [];
  const executable = Object.keys(config.execute_levels ?? {});
  if (executable.length === 0) return [];
  const bound = new Set(caseLevels(c.data, scenario.data, config.schemaVersion));
  // One executable level makes a Layer-free denial's layer unambiguous: there is no second layer
  // its claim could omit, so it is not drift.
  if (bound.size === 0 && executable.length < 2) return [];
  return executable.filter((level) => !bound.has(level));
}
