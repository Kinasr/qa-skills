// @ts-check
// The Maven adapter: run the `test` phase, select one Kotlin/JUnit test by
// `-Dtest=<pkg>.<Class>#<method>` in its module with `-pl`, always ignore test failures so the
// report survives, and ask Surefire for the configured reruns. It is one registry entry
// (`runners/index.mjs`), using the same options and result shape as Playwright and Gradle.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { defaultBatchLauncher, spawnBatchWrapper } from "../platform.mjs";
import {
  copyFreshReport, jvmModule, jvmTarget, mavenSelector, movePriorReport,
  readFreshReport, reportDirectory, runnerEnvironment, runnerOutput,
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

/**
 * Run one Automation through the project's Maven and read its report.
 * @param {RunOptions} options
 * @returns {{ parsed: RunnerResult, selector: string }}
 */
export function runMaven({ selection, runner, repo, dir, origin, env, retries, context }) {
  const runnerDir = runner.dir ?? ".";
  const cwd = join(repo, runnerDir);
  const launcher = runner.launcher ?? [defaultBatchLauncher("maven", cwd, context)];
  const module = jvmModule(repo, runnerDir, selection.file, ["pom.xml"]);
  const selected = mavenSelector(selection);
  // Surefire writes a nested class's testcases into its top-level class's report.
  const report = join(reportDirectory(cwd, module, ["target", "surefire-reports"]), `TEST-${jvmTarget(selection).outer}.xml`);
  const inherited = runnerEnvironment(env, origin, runner.target_env);
  // A bare `mvn` has no goal and exits 1, but an engineer may already name the phase.
  const phase = [...launcher.slice(1), ...(runner.args ?? [])].includes("test") ? [] : ["test"];
  const extra = module === "." ? [] : ["-pl", module];
  // Only the tokens `project.md` configures name a key; `-pl`'s module directory and the selector
  // name the Automation instead, and the fixed flags come from this adapter.
  const spawn = spawnBatchWrapper({
    file: launcher[0],
    args: [
      ...launcher.slice(1),
      ...phase,
      ...extra,
      `-Dtest=${selected}`,
      "-Dmaven.test.failure.ignore=true",
      `-Dsurefire.rerunFailingTestsCount=${retries}`,
      ...(runner.args ?? []),
    ],
    options: { cwd, env: inherited, encoding: /** @type {const} */ ("utf8"), shell: false },
    cwd,
    ...(runner.launcher ? { source: "test_runner.launcher" } : {}),
    tokens: [
      ...launcher.slice(1).map((value) => ({ value, source: "test_runner.launcher" })),
      ...phase.map((value) => ({ value })),
      ...extra.map((value) => ({ value })),
      { value: `-Dtest=${selected}` },
      { value: "-Dmaven.test.failure.ignore=true" },
      { value: `-Dsurefire.rerunFailingTestsCount=${retries}` },
      ...(runner.args ?? []).map((value) => ({ value, source: "test_runner.args" })),
    ],
    automation: selection.id,
  }, context);
  if (spawn.refusal) {
    return { parsed: { instances: {}, reason: "runner-error", diagnostics: [spawn.refusal.message] }, selector: `-Dtest=${selected}` };
  }
  movePriorReport(report, join(dir, "prior", module === "." ? "" : module));
  const child = spawnSync(spawn.file, spawn.args, spawn.options);
  /** @type {RunnerResult} */
  let parsed;
  if (!copyFreshReport(report, join(dir, module === "." ? "" : module))) {
    parsed = {
      instances: {},
      reason: "runner-error",
      diagnostics: [`No fresh JUnit XML report for ${selection.id}: the prior report, if any, was moved aside.`, ...runnerOutput(child.stdout, child.stderr)],
    };
  } else {
    parsed = readFreshReport(report, module);
    parsed.diagnostics.push(...runnerOutput(child.stdout, child.stderr));
  }
  if (child.signal || child.error) {
    parsed.reason = "runner-error";
    if (child.error?.message) parsed.diagnostics.push(child.error.message);
  }
  if (!Object.keys(parsed.instances).length && !parsed.reason) parsed.reason = "no-result";
  return { parsed, selector: `-Dtest=${selected}` };
}
