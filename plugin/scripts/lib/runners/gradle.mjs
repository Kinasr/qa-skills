// @ts-check
// The Gradle adapter: select one Kotlin/JUnit test by `<pkg>.<Class>.<method>` in its module's task
// path, move prior XML aside, and re-invoke only while the Automation has not passed, within
// 1 + `automation_retries` invocations. Every invocation passes `--rerun`: with the build cache on,
// a task whose report was moved aside is restored `FROM-CACHE` without running, and that file
// would read as fresh. It is one registry entry (`runners/index.mjs`), using the same options and
// result shape as Playwright.
//
// The wrapper is spawned through `spawnBatchWrapper`, so on win32 `gradlew.bat` runs behind
// `cmd.exe`'s argument allow-list and a refused token is this Automation's runner refusal.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { defaultBatchLauncher, spawnBatchWrapper } from "../platform.mjs";
import {
  copyFreshReport, gradleSelector, jvmModule, jvmTarget, lastAttemptPassed, mergeRunnerResult,
  movePriorReport, readFreshReport, reportDirectory, runnerEnvironment, runnerOutput,
} from "./junit.mjs";
/** @import { PlatformContext } from "../platform.mjs" */
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
 *   context?: PlatformContext,
 * }} RunOptions
 */

/** The Gradle task run when `test_runner.task` is absent. @type {string} */
export const GRADLE_DEFAULT_TASK = "test";

/**
 * Run one Automation through the project's Gradle and read its report.
 * @param {RunOptions} options
 * @returns {{ parsed: RunnerResult, selector: string }}
 */
export function runGradle({ selection, runner, repo, dir, origin, env, retries, context }) {
  const runnerDir = runner.dir ?? ".";
  const cwd = join(repo, runnerDir);
  const launcher = runner.launcher ?? [defaultBatchLauncher("gradle", cwd, context)];
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
  const taskToken = module === "."
    ? { value: taskPath, source: "test_runner.task" }
    : { value: taskPath, parts: [{ value: `:${module.split("/").join(":")}:` }, { value: task, source: "test_runner.task" }] };
  // `--rerun` and the selector travel as their own tokens; only the ones `project.md` configures
  // name a key, and a module directory or the selector itself names the Automation instead.
  const spawn = spawnBatchWrapper({
    file: launcher[0],
    args: [...launcher.slice(1), taskPath, "--rerun", "--tests", selected, ...(runner.args ?? [])],
    options: { cwd, env: inherited, encoding: /** @type {const} */ ("utf8"), shell: false },
    cwd,
    ...(runner.launcher ? { source: "test_runner.launcher" } : {}),
    tokens: [
      ...launcher.slice(1).map((value) => ({ value, source: "test_runner.launcher" })),
      taskToken,
      { value: "--rerun" },
      { value: "--tests" },
      { value: selected },
      ...(runner.args ?? []).map((value) => ({ value, source: "test_runner.args" })),
    ],
    automation: selection.id,
  }, context);
  if (spawn.refusal) {
    parsed.reason = "runner-error";
    parsed.diagnostics.push(spawn.refusal.message);
    return { parsed, selector: `${taskPath} --rerun --tests ${selected}` };
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    movePriorReport(report, priorDir);
    const child = spawnSync(spawn.file, spawn.args, spawn.options);
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
  return { parsed, selector: `${taskPath} --rerun --tests ${selected}` };
}
