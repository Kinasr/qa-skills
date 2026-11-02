// @ts-check
// The Playwright adapter (its behaviour is pinned by the merged runner spike): renders the selection the way Playwright
// reads it, writes the run's own JSON report outside the project's config, and turns the report
// into per-instance attempts. It is one registry entry (`runners/index.mjs`), reached through the
// same options the Gradle and Maven adapters will take.
//
// Deviations the spike forced, all pinned by tests:
//   - `--test-list` splits on `›` with no escape, so a literal title holding `›` (or padding) uses
//     the end-bounded `--grep` for a tag carrier, never an ambiguous list line;
//   - the JSON report has no `repeatIndex`, so an instance id takes its occurrence index from the
//     report order within its `spec.id` and `projectId`;
//   - an unmatched `--grep` exits 1 with `No tests found` and an unmatched list line exits 0 with
//     zero suites: both are `no-result`, never a runner error.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
/**
 * @import { AutomationAttempt, AutomationBlockedReason, AutomationSelection, RunnerResult } from "../test-runner.mjs"
 * @import { TestRunner } from "../knowledge-file.mjs"
 */

/**
 * One entry of a report's `tests`: one project's (and one repetition's) run of a spec.
 * @typedef {{
 *   expectedStatus: string,
 *   projectId: string,
 *   status: string,
 *   results: Array<{ status: string, retry?: number, error?: { message?: string }, errors?: { message?: string }[] }>,
 * }} PwTest
 */

/**
 * A spec: the declaration, identified by its file and line, with one `tests` entry per instance.
 * @typedef {{
 *   id: string,
 *   title: string,
 *   file: string,
 *   line: number,
 *   tests: PwTest[],
 *   tags?: string[],
 * }} PwSpec
 */

/**
 * A suite in the report's tree.
 * @typedef {{
 *   title: string,
 *   suites?: PwSuite[],
 *   specs?: PwSpec[],
 * }} PwSuite
 */

/**
 * The JSON reporter's file.
 * @typedef {{ suites: PwSuite[], errors?: { message?: string }[] }} PwReport
 */

/**
 * How the selection is rendered, before `runPlaywright` turns it into argv: a `--test-list` line, a
 * `--grep` pattern, or a `<file>:<line>` location.
 * @typedef {{ kind: "list" | "grep" | "line", selector: string }} PwSelection
 */

/**
 * One invocation's options: what to run, where, against which origin, and with how many retries.
 * @typedef {{
 *   selection: AutomationSelection,
 *   runner: TestRunner,
 *   repo: string,
 *   dir: string,
 *   origin: string,
 *   env: Record<string, string | undefined>,
 *   retries: number,
 *   repeats?: number,
 * }} RunOptions
 */

/** @param {string} text @returns {string} */
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @param {string} version @param {number} minor @returns {boolean} */
const atLeast = (version, minor) => {
  const [major, part] = version.split(".").map(Number);
  return major > 1 || (major === 1 && part >= minor);
};

// The version probe is per launcher and working directory: one extra process per Run, not per Automation.
/** @type {Map<string, string>} */
const versions = new Map();

/**
 * @param {string[]} launcher
 * @param {string} cwd
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
function playwrightVersion(launcher, cwd, env) {
  const key = `${launcher.join("\0")}\0${cwd}`;
  const known = versions.get(key);
  if (known) return known;
  const probe = spawnSync(launcher[0], [...launcher.slice(1), "--version"], { cwd, env, encoding: "utf8", shell: false });
  const version = probe.status === 0 ? /\b(\d+\.\d+\.\d+)\b/.exec(probe.stdout ?? "")?.[1] ?? "0.0.0" : "0.0.0";
  versions.set(key, version);
  return version;
}

// A literal title line is faithful only when every component is a plain, trimmed title: the list
// parser trims each part and splits `›` (and `>`) everywhere, with no escape. Anything else needs
// the grep or location fallback, never an ambiguous line.
/** @param {AutomationSelection} selection @returns {boolean} */
const listable = (selection) =>
  selection.literal && selection.titles.length > 0 &&
  selection.titles.every((title) => title.length > 0 && title.trim() === title && !title.includes("›"));

/**
 * The selection as Playwright reads it.
 * @param {AutomationSelection} selection
 * @param {string} version
 * @param {string} file The spec's path, relative to Playwright's root directory.
 * @returns {PwSelection}
 */
export function playwrightSelection(selection, version, file) {
  if (listable(selection) && atLeast(version, 56)) return { kind: "list", selector: [file, ...selection.titles].join(" › ") };
  if (selection.tagged) return { kind: "grep", selector: `@(${escapeRegex(selection.id)})(\\s|$)` };
  return { kind: "line", selector: `${file}:${selection.line}` };
}

// A report is usable when its suites and every spec and result have the shape the reporter writes.
/** @param {unknown} report @returns {report is PwReport} */
function usable(report) {
  /** @param {PwSuite} suite @returns {boolean} */
  const goodSuite = (suite) => typeof suite === "object" && suite !== null &&
    (suite.suites === undefined || (Array.isArray(suite.suites) && suite.suites.every(goodSuite))) &&
    (suite.specs === undefined || (Array.isArray(suite.specs) && suite.specs.every((spec) => spec && typeof spec.id === "string" &&
      typeof spec.file === "string" && Number.isInteger(spec.line) && Array.isArray(spec.tests) && spec.tests.every((test) =>
        test && typeof test.projectId === "string" && typeof test.expectedStatus === "string" && Array.isArray(test.results) &&
        test.results.every((result) => result && typeof result.status === "string")))));
  const pw = /** @type {PwReport} */ (report);
  return report !== null && typeof report === "object" && Array.isArray(pw.suites) && pw.suites.every(goodSuite) &&
    (pw.errors === undefined || (Array.isArray(pw.errors) && pw.errors.every((error) => error && typeof error.message === "string")));
}

// The runner's own errors that mean "nothing matched", which is no-result rather than a crash.
/** @param {{ message?: string }[]} errors @returns {boolean} */
const noMatch = (errors) => errors.every((error) => /\bNo tests found\b/i.test(error.message ?? ""));

/**
 * The report's instances for one requested Automation, before the attempt rules: `spec.id`,
 * `projectId` and the occurrence index identify an instance, since the reporter carries no
 * `repeatIndex`.
 * @param {unknown} report
 * @param {AutomationSelection} selection
 * @param {string} cwd Playwright's root directory.
 * @param {string} repo The repository the plan's `file` is relative to.
 * @returns {RunnerResult}
 */
export function parseReport(report, selection, cwd, repo) {
  /** @type {RunnerResult} */
  const parsed = { instances: {}, diagnostics: [] };
  if (!usable(report)) return { instances: {}, reason: "runner-error", diagnostics: ["The runner report is not a Playwright JSON report"] };
  const file = relative(cwd, join(repo, selection.file)).split(sep).join("/");
  /** @type {Map<string, number>} */
  const occurrences = new Map();
  /** @param {AutomationBlockedReason} reason */
  const block = (reason) => {
    parsed.reason = reason;
  };
  /** @param {PwSuite[]} suites @returns {void} */
  const walk = (suites) => {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        if (resolve(cwd, spec.file) !== resolve(cwd, file) || spec.line !== selection.line) continue;
        for (const test of spec.tests) {
          const base = `${spec.id}:${test.projectId}`;
          const occurrence = occurrences.get(base) ?? 0;
          occurrences.set(base, occurrence + 1);
          const id = `${base}:${occurrence}`;
          /** @type {AutomationAttempt[]} */
          const attempts = [];
          for (const result of test.results) {
            if (result.status === "interrupted") {
              block("runner-error");
              attempts.push({ result: "blocked", reason: "runner-error" });
            } else if (result.status === "skipped") attempts.push({ result: "blocked", reason: "skipped" });
            else if (["passed", "failed", "timedOut"].includes(result.status)) {
              const passed = result.status !== "timedOut" && result.status === test.expectedStatus;
              attempts.push({ result: passed ? "passed" : "failed" });
            } else {
              block("runner-error");
              attempts.push({ result: "blocked", reason: "runner-error" });
            }
            for (const error of [result.error, ...(result.errors ?? [])]) {
              if (error?.message) parsed.diagnostics.push(`${id}: ${error.message}`);
            }
          }
          // An unstarted project of an interrupted run has no results: it never reported an attempt.
          if (!attempts.length) attempts.push({ result: "blocked", reason: "runner-error" });
          parsed.instances[id] = attempts;
        }
      }
      walk(suite.suites ?? []);
    }
  };
  walk(report.suites);
  if (!Object.keys(parsed.instances).length) {
    const errors = report.errors ?? [];
    parsed.reason = errors.length && !noMatch(errors) ? "runner-error" : "no-result";
    parsed.diagnostics.push(...errors.map((error) => error.message ?? (parsed.reason === "runner-error" ? "Root suite error" : "No tests found")));
  }
  return parsed;
}

/**
 * Run one Automation through the project's Playwright and read its report.
 * @param {RunOptions} options
 * @returns {{ parsed: RunnerResult, selector: string }}
 */
export function runPlaywright({ selection, runner, repo, dir, origin, env, retries, repeats }) {
  const cwd = join(repo, runner.dir);
  const launcher = runner.launcher ?? ["npx", "playwright", "test"];
  const inherited = { ...env, ...Object.fromEntries(runner.target_env.map((name) => [name, origin])) };
  const version = playwrightVersion(launcher, cwd, inherited);
  const file = relative(cwd, join(repo, selection.file)).split(sep).join("/");
  const rendered = playwrightSelection(selection, version, file);
  /** @type {string[]} */
  let filter;
  if (rendered.kind === "list") {
    const list = join(dir, "test-list.txt");
    writeFileSync(list, `${rendered.selector}\n`);
    filter = ["--test-list", list];
  } else if (rendered.kind === "grep") filter = ["--grep", rendered.selector];
  else filter = [rendered.selector];
  const reporter = atLeast(version, 63) ? "--add-reporter=json" : "--reporter=json";
  const args = [
    ...launcher.slice(1), ...(runner.args ?? []), ...filter, reporter, "--output", join(dir, "artifacts"), `--retries=${retries}`, ...(repeats ? [`--repeat-each=${repeats}`, "--max-failures=1", "--workers=1"] : []),
  ];
  const reportPath = join(dir, "report.json");
  const child = spawnSync(launcher[0], args, { cwd, env: { ...inherited, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath }, encoding: "utf8", shell: false });
  /** @type {RunnerResult} */
  let parsed;
  try {
    parsed = parseReport(JSON.parse(readFileSync(reportPath, "utf8")), selection, cwd, repo);
  } catch {
    parsed = { instances: {}, reason: "runner-error", diagnostics: ["Missing or unreadable runner report"] };
  }
  // A usable report survives exit 1 (test failures); a signal, a start error or an interruption blocks the run.
  if (child.signal || child.error || child.status === 130) parsed.reason = "runner-error";
  parsed.diagnostics.push(...[child.stdout ?? "", child.stderr ?? ""].map((text) => text.trim()).filter(Boolean));
  // The record names the tag it ran. The end-bounded pattern is argv-only: the record keeps the
  // plain tag, and an ambiguous record selector would be worse than a narrower one.
  return { parsed, selector: rendered.kind === "grep" ? `@${selection.id}` : rendered.selector };
}
