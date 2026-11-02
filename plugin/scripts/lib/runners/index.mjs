// @ts-check
// The built-in test runners, by `test_runner.tool`. Each adapter takes the same options and
// returns `{parsed, selector}`, where `parsed` is one ordered-attempt list per instance. Adding a
// tool is one entry here plus its module: `gradle` and `maven` join it without reshaping the
// seam execute, `codefix verify` and `codegen verify` share.
import { runGradle } from "./gradle.mjs";
import { runMaven } from "./maven.mjs";
import { runPlaywright } from "./playwright.mjs";
/**
 * @import { AutomationSelection, RunnerResult } from "../test-runner.mjs"
 * @import { TestRunner } from "../knowledge-file.mjs"
 */

/**
 * One invocation's options.
 * @typedef {{
 *   selection: AutomationSelection,
 *   runner: TestRunner,
 *   repo: string,
 *   dir: string,
 *   origin: string,
 *   env: Record<string, string | undefined>,
 *   retries: number,
 *   repeats?: number,
 *   fresh?: boolean,
 * }} RunnerOptions
 */

/**
 * A built-in adapter.
 * @typedef {{
 *   run: (options: RunnerOptions) => { parsed: RunnerResult, selector: string },
 * }} RunnerAdapter
 */

/** @type {Record<string, RunnerAdapter>} */
export const RUNNERS = {
  playwright: { run: runPlaywright },
  gradle: { run: runGradle },
  maven: { run: runMaven },
};

/**
 * The selection as the record shows it when no runner was invoked.
 * @param {AutomationSelection} selection
 * @returns {string}
 */
export function displaySelector(selection) {
  if (selection.tagged) return `@${selection.id}`;
  if (selection.literal) return [selection.file, ...selection.titles].join(" › ");
  return `${selection.file}:${selection.line}`;
}

/**
 * Run one Automation through its tool's adapter.
 * @param {RunnerOptions} options
 * @returns {{ parsed: RunnerResult, selector: string }}
 */
export function runSelection(options) {
  const adapter = RUNNERS[options.runner.tool];
  if (!adapter) {
    return {
      parsed: { instances: {}, reason: "runner-error", diagnostics: [`No built-in test runner for \`${options.runner.tool}\``] },
      selector: displaySelector(options.selection),
    };
  }
  return adapter.run(options);
}
