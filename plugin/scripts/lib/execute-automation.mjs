// @ts-check
// `execute automation --dir <run-dir> [--root <qa-dir>]`: runs every Automation due in the Run once,
// through the `test_runner` its stack declares, and writes one result per Automation to
// `<run>/automation.json`. `/qa-execute` calls it once after the confirm; `ingest` reads the file.
//
// Each invocation gets its own CLI-owned `<run>/automation/<n>/`, numbered across the Run, holding
// the tool's report, its artifacts and (for Playwright) the `--test-list` file. Nothing is written
// to the project's config, and the runner is spawned without a shell.
//
// A Run with no `test_runner` records every Automation Blocked `no-command`, so the summary can
// point at `/qa-init`. A finished Automation is never run twice, so a resumed call costs nothing.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noArguments } from "./cli.mjs";
import { plannedRun } from "./execute-open.mjs";
import { executeTraining } from "./execute-training.mjs";
import { displaySelector, runSelection } from "./runners/index.mjs";
import { automationResult } from "./test-runner.mjs";
import { EXECUTE_TRAIN_KEY } from "./schema.mjs";
import { trainFile } from "./training.mjs";
/** @import { AutomationSelection, AutomationResult, RunnerResult } from "./test-runner.mjs" */
/** @import { CommandAction, CommandContext, CommandResult } from "./cli.mjs" */
/** @import { AutoRun } from "./execute.mjs" */

/**
 * @typedef {{ automation: AutomationResult[] }} AutomationState
 */

// `/qa-train execute`'s `automation_retries` (default 2) is the number of extra attempts a failing
// Automation gets; the project's own retry config can add attempts the parser still counts.
/**
 * @param {string | undefined} root
 * @returns {number}
 */
function retriesOf(root) {
  return executeTraining(trainFile(/** @type {string} */ (root), EXECUTE_TRAIN_KEY)).automation_retries;
}

/**
 * @param {string} dir
 * @returns {AutomationResult[]}
 */
export function readAutomation(dir) {
  try {
    const state = /** @type {AutomationState} */ (JSON.parse(readFileSync(join(dir, "automation.json"), "utf8")));
    return Array.isArray(state.automation) ? state.automation : [];
  } catch {
    return [];
  }
}

// The next `<run>/automation/<n>/` never overwrites an earlier invocation's report.
/**
 * @param {string} runDir
 * @returns {number}
 */
function nextInvocation(runDir) {
  let last = 0;
  try {
    for (const name of readdirSync(join(runDir, "automation"))) if (/^[1-9]\d*$/.test(name)) last = Math.max(last, Number(name));
  } catch { /* no invocation yet */ }
  return last + 1;
}

/**
 * @param {AutomationResult[]} entries
 * @returns {string}
 */
function automationText(entries) {
  if (!entries.length) return "No Automations were due in this Run.";
  const count = (/** @type {string} */ result) => entries.filter((entry) => entry.result === result).length;
  /** @type {Array<[string, number]>} */
  const tallies = [["passed", count("passed")], ["failed", count("failed")], ["flaky", count("flaky")], ["blocked", count("blocked")]];
  const buckets = tallies.filter(([, n]) => n > 0).map(([name, n]) => `${n} ${name}`).join(", ");
  const lines = entries.map((entry) => `  ${entry.id}: ${entry.result}${entry.reason ? ` (${entry.reason})` : ""}`);
  const hint = entries.some((entry) => entry.reason === "no-command") ? ["Set `test_runner` in `project.md` with `/qa-init` so Automations can run."] : [];
  return [`Automations: ${entries.length} (${buckets})`, ...lines, ...hint].join("\n");
}

/**
 * @param {string[]} args
 * @param {CommandContext} context
 * @returns {CommandResult}
 */
function run(args, { dir, root, env }) {
  noArguments("execute automation", args, "--dir <run-dir>");
  const { pinned, runDir } = plannedRun(dir, "automation");
  if (!pinned.confirmed) {
    return { exit: 1, json: { ok: false, refusals: [{ code: "not_confirmed", line: "Confirm the Run before running Automations." }] } };
  }
  const retries = retriesOf(/** @type {string} */ (root));
  const plan = /** @type {AutoRun | undefined} */ (pinned.automation);
  /** @type {AutomationState} */
  const state = { automation: readAutomation(runDir) };
  let invocation = nextInvocation(runDir);
  for (const selection of plan?.selections ?? []) {
    if (state.automation.some((entry) => entry.id === selection.id)) continue;
    /** @type {{ parsed: RunnerResult, selector: string }} */
    let outcome;
    if (!plan?.runner) {
      outcome = {
        parsed: { instances: {}, reason: "no-command", diagnostics: ["Set `test_runner` in `project.md` with `/qa-init` so Automations can run."] },
        selector: displaySelector(selection),
      };
    } else {
      const output = join(runDir, "automation", String(invocation++));
      mkdirSync(output, { recursive: true });
      outcome = runSelection({ selection, runner: plan.runner, repo: plan.repo, dir: output, origin: pinned.target.origin, env, retries });
    }
    state.automation.push(automationResult(selection, outcome.parsed, outcome.selector, Boolean(plan?.runner && plan.runner.target_env.length === 0)));
    writeFileSync(join(runDir, "automation.json"), `${JSON.stringify(state, null, 2)}\n`);
  }
  return { exit: 0, json: { action: "automation", ok: true, automation: state.automation, text: automationText(state.automation) } };
}

/** @type {Record<string, CommandAction>} */
export const automationActions = {
  automation: { options: { dir: "value", root: "qa-dir" }, usage: "--dir <run-dir> [--root <qa-dir>]", run },
};
