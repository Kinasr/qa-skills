// @ts-check
// Stack capabilities belong to codegen Training. Paths, rather than case bindings, identify an
// Automation's Test level; an unmatched or ambiguous path never supplies coverage for a level.
import { isMap } from "./dialect.mjs";

/**
 * @typedef {"api" | "mocked-ui" | "full-ui"} CodegenApproachName
 * @typedef {{ approach: CodegenApproachName, level: string, path: string }} CodegenApproach
 * @typedef {{ field: string, message: string }} ApproachError
 */

/** @type {readonly CodegenApproachName[]} */
export const CODEGEN_APPROACH_NAMES = ["api", "mocked-ui", "full-ui"];

/** @param {unknown} path @returns {boolean} */
function safePattern(path) {
  return typeof path === "string" && /^[A-Za-z0-9_.*?/-]+$/.test(path) &&
    !path.startsWith("/") && path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && (!part.includes("**") || part === "**"));
}

/**
 * Validate a declaration without trusting a parsed YAML value or echoing it in an error.
 * @param {unknown} value
 * @param {ReadonlySet<string>} levels
 * @returns {ApproachError[]}
 */
export function codegenApproachErrors(value, levels) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [{ field: "approaches", message: "`approaches` is a list of approach, level and path entries" }];
  /** @type {ApproachError[]} */
  const errors = [];
  const seen = new Set();
  for (const [i, entry] of value.entries()) {
    const field = `approaches.${i}`;
    if (!isMap(entry) || Object.keys(entry).some((key) => !["approach", "level", "path"].includes(key)) ||
      typeof entry.approach !== "string" || !CODEGEN_APPROACH_NAMES.includes(/** @type {CodegenApproachName} */ (entry.approach)) || typeof entry.level !== "string" || !levels.has(entry.level) || !safePattern(entry.path)) {
      errors.push({ field, message: "an approach names api, mocked-ui or full-ui, a project Test level and a repository-relative path pattern (*, ** and ? only; ** occupies a whole segment)" });
      continue;
    }
    if (seen.has(entry.approach)) errors.push({ field, message: "declare each approach only once" });
    seen.add(entry.approach);
  }
  return errors;
}

/**
 * Read the declared capabilities; invalid Training supplies none until repaired by qa-train.
 * @param {{ data: Record<string, unknown> } | null} train
 * @param {ReadonlySet<string>} levels
 * @returns {CodegenApproach[]}
 */
export function codegenApproaches(train, levels) {
  const value = train?.data.approaches;
  if (codegenApproachErrors(value, levels).length) return [];
  return /** @type {CodegenApproach[]} */ (value ?? []);
}

/** @param {string} pattern @returns {RegExp} */
function pathPattern(pattern) {
  const parts = pattern.split("/");
  return new RegExp(`^${parts.map((part, i) => {
    if (part === "**") return i === parts.length - 1 ? ".*" : "(?:[^/]+/)*";
    const segment = part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*").replaceAll("?", "[^/]");
    return segment + (i === parts.length - 1 ? "" : "/");
  }).join("")}$`);
}

/**
 * Resolve a repository-relative Automation path. Multiple matching approaches may serve the same
 * Test level; matches at different levels are ambiguous and return null, as does no match.
 * @param {string} file
 * @param {readonly CodegenApproach[]} approaches
 * @returns {string | null}
 */
export function automationLevel(file, approaches) {
  const levels = new Set(approaches.filter((entry) => pathPattern(entry.path).test(file)).map((entry) => entry.level));
  return levels.size === 1 ? [...levels][0] : null;
}
