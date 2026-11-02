// @ts-check
// The Gradle adapter: select one Kotlin/JUnit test by `<pkg>.<Class>.<method>` in its module's task
// path, move prior XML aside, and re-invoke only while the Automation has not passed, with
// `--rerun`, within 1 + `automation_retries` invocations. It is one registry entry
// (`runners/index.mjs`), using the same options and result shape as Playwright.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  copyFreshReport, gradleSelector, jvmModule, jvmTarget, lastAttemptPassed, mergeRunnerResult,
  movePriorReport, readFreshReport, reportDirectory, runnerEnvironment, runnerOutput,
} from "./junit.mjs";
/** @import { AutomationSelection, RunnerResult } from "../test-runner.mjs" */
/** @import { TestRunner } from "../knowledge-file.mjs" */

/**
 * One invocation's options, the same shape every adapter takes.
 * @typedef {{
 *   selection: AutomationSelection,
 *   runner: TestRunner,
 *   repo: string,
 *   dir: string,
 *   origin: string,
 *   env: Record<string, string | undefined>,
 *   retries: number,
 *   fresh?: boolean,
 * }} RunOptions
 */

/** The Gradle task run when `test_runner.task` is absent. @type {string} */
export const GRADLE_DEFAULT_TASK = "test";

/**
 * Run one Automation through the project's Gradle and read its report.
 * @param {RunOptions} options
 * @returns {{ parsed: RunnerResult, selector: string }}
 */
export function runGradle({ selection, runner, repo, dir, origin, env, retries, fresh }) {
  const runnerDir = runner.dir ?? ".";
  const cwd = join(repo, runnerDir);
  const launcher = runner.launcher ?? [existsSync(join(cwd, "gradlew")) ? "./gradlew" : "gradle"];
  const task = runner.task ?? GRADLE_DEFAULT_TASK;
  const module = jvmModule(repo, runnerDir, selection.file, ["build.gradle", "build.gradle.kts"]);
  const taskPath = module === "." ? task : `:${module.split("/").join(":")}:${task}`;
  const selected = gradleSelector(selection);
  const report = join(reportDirectory(cwd, module, ["build", "test-results", task]), `TEST-${jvmTarget(selection).fqcn}.xml`);
  const priorDir = join(dir, "prior", module === "." ? "" : module);
  const outDir = join(dir, module === "." ? "" : module);
  const inherited = runnerEnvironment(env, origin, runner.target_env);
  /** @type {RunnerResult} */
  const parsed = { instances: {}, diagnostics: [] };
  for (let attempt = 0; attempt <= retries; attempt++) {
    movePriorReport(report, priorDir);
    const args = [
      ...launcher.slice(1), taskPath, ...(fresh || attempt > 0 ? ["--rerun"] : []), "--tests", selected, ...(runner.args ?? []),
    ];
    const child = spawnSync(launcher[0], args, { cwd, env: inherited, encoding: "utf8", shell: false });
    parsed.diagnostics.push(...runnerOutput(child.stdout, child.stderr));
    if (child.signal || child.error) {
      parsed.reason = "runner-error";
      if (child.error?.message) parsed.diagnostics.push(child.error.message);
      break;
    }
    if (!copyFreshReport(report, outDir)) {
      parsed.reason = "runner-error";
      parsed.diagnostics.push(`No fresh JUnit XML report for ${selection.id}: the prior report, if any, was moved aside.`);
      break;
    }
    mergeRunnerResult(parsed, readFreshReport(report, module));
    if (parsed.reason || lastAttemptPassed(parsed)) break;
  }
  if (!Object.keys(parsed.instances).length && !parsed.reason) parsed.reason = "no-result";
  return { parsed, selector: `${taskPath} --tests ${selected}` };
}
