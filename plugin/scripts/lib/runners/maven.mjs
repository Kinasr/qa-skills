// @ts-check
// The Maven adapter: select one Kotlin/JUnit test by `-Dtest=<pkg>.<Class>#<method>` in its module
// with `-pl`, always ignore test failures so the report survives, and ask Surefire for the
// configured reruns. It is one registry entry (`runners/index.mjs`), using the same options and
// result shape as Playwright and Gradle.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  copyFreshReport, jvmModule, jvmTarget, mavenSelector, movePriorReport,
  readFreshReport, reportDirectory, runnerEnvironment, runnerOutput,
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
 * }} RunOptions
 */

/**
 * Run one Automation through the project's Maven and read its report.
 * @param {RunOptions} options
 * @returns {{ parsed: RunnerResult, selector: string }}
 */
export function runMaven({ selection, runner, repo, dir, origin, env, retries }) {
  const runnerDir = runner.dir ?? ".";
  const cwd = join(repo, runnerDir);
  const launcher = runner.launcher ?? [existsSync(join(cwd, "mvnw")) ? "./mvnw" : "mvn"];
  const module = jvmModule(repo, runnerDir, selection.file, ["pom.xml"]);
  const selected = mavenSelector(selection);
  const report = join(reportDirectory(cwd, module, ["target", "surefire-reports"]), `TEST-${jvmTarget(selection).fqcn}.xml`);
  const inherited = runnerEnvironment(env, origin, runner.target_env);
  movePriorReport(report, join(dir, "prior", module === "." ? "" : module));
  const args = [
    ...launcher.slice(1),
    ...(module === "." ? [] : ["-pl", module]),
    `-Dtest=${selected}`,
    "-Dmaven.test.failure.ignore=true",
    `-Dsurefire.rerunFailingTestsCount=${retries}`,
    ...(runner.args ?? []),
  ];
  const child = spawnSync(launcher[0], args, { cwd, env: inherited, encoding: "utf8", shell: false });
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
