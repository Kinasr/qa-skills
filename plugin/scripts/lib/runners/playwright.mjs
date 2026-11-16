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
//
// Paths are Playwright's, not the working directory's: a `--test-list` line and a report's
// `spec.file` are relative to `config.rootDir`, which is the config's top-level `testDir` when one
// is set. A list selection therefore asks Playwright for its root first, and the parser reads the
// root from the report it is given.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { spawnNodeCli } from "../platform.mjs";
import { PLAYWRIGHT_RUNNER_LAUNCHER } from "../platform-runner.mjs";
/**
 * @import { AutomationAttempt, AutomationBlockedReason, AutomationSelection, RunnerResult } from "../test-runner.mjs"
 * @import { TestRunner } from "../knowledge-file.mjs"
 * @import { PlatformRefusal } from "../platform.mjs"
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
 * @typedef {{
 *   config?: { rootDir?: string },
 *   suites: PwSuite[],
 *   errors?: { message?: string }[],
 * }} PwReport
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
 *   platform?: NodeJS.Platform,
 * }} RunOptions
 */

/**
 * The launcher this platform starts, before the adapter appends its own arguments.
 * @typedef {{ file: string, args: string[] }} Launch
 */

/**
 * A launcher the platform module refuses to start.
 * @typedef {{ refusal: PlatformRefusal }} LaunchRefusal
 */

/** @param {string} text @returns {string} */
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Playwright derives its root from its own working directory, which the OS reports with symlinks
// resolved, while the repository path can keep them: compare both through the same real path.
/** @param {string} path @returns {string} */
function canonical(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * A spec's path relative to a base, in the posix form Playwright's list lines and reports use.
 * @param {string} base
 * @param {string} repo
 * @param {string} file The spec's repository-relative path.
 * @returns {string}
 */
const posixRelative = (base, repo, file) => relative(canonical(base), join(canonical(repo), file)).split(sep).join("/");

/** @param {string} version @param {number} minor @returns {boolean} */
const atLeast = (version, minor) => {
  const [major, part] = version.split(".").map(Number);
  return major > 1 || (major === 1 && part >= minor);
};

// The version probe is per launcher and working directory: one extra process per Run, not per Automation.
/** @type {Map<string, string>} */
const versions = new Map();

// Playwright writes its config only inside a JSON report, so the root is asked for with an empty
// `--list` run: one extra process per Run, not per Automation, and only for a `--test-list` line.
/** @type {Map<string, string | undefined>} */
const roots = new Map();

// The probe's single list line names a file no project holds, so the list run only loads the config.
const ROOT_PROBE_LINE = "qa-skills-root-probe.spec.ts";

/**
 * The launcher this platform starts: unchanged on POSIX, and on win32 the project's
 * `@playwright/test` through Node, a configured `.exe` directly, or a typed refusal for a `.cmd`
 * (see `platform-runner.mjs`). One resolution per Run serves all three spawns.
 * @param {readonly string[]} launcher
 * @param {string} cwd
 * @param {NodeJS.Platform} platform
 * @returns {Launch | LaunchRefusal}
 */
function runnerLaunch(launcher, cwd, platform) {
  const resolved = spawnNodeCli(
    { kind: "playwright-runner", file: launcher[0], args: launcher.slice(1), options: {}, cwd },
    { platform },
  );
  return resolved.refusal ? { refusal: resolved.refusal } : { file: resolved.file, args: resolved.args };
}

/**
 * The selector the record shows for a rendered selection.
 * @param {PwSelection} rendered
 * @param {AutomationSelection} selection
 * @returns {string}
 */
const selectorOf = (rendered, selection) => (rendered.kind === "grep" ? `@${selection.id}` : rendered.selector);

/**
 * @param {Launch} launch
 * @param {string} cwd
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
function playwrightVersion(launch, cwd, env) {
  const key = `${[launch.file, ...launch.args].join("\0")}\0${cwd}`;
  const known = versions.get(key);
  if (known) return known;
  const probe = spawnSync(launch.file, [...launch.args, "--version"], { cwd, env, encoding: "utf8", shell: false });
  const version = probe.status === 0 ? /\b(\d+\.\d+\.\d+)\b/.exec(probe.stdout ?? "")?.[1] ?? "0.0.0" : "0.0.0";
  versions.set(key, version);
  return version;
}

/**
 * Playwright's root directory, the base its `--test-list` lines and report paths are relative to.
 * @param {Launch} launch
 * @param {string[]} args The runner's own extra arguments, so a `--config` override is honoured.
 * @param {string} cwd
 * @param {Record<string, string | undefined>} env
 * @returns {string | undefined} The root, or undefined when the probe cannot read one.
 */
function playwrightRoot(launch, args, cwd, env) {
  const key = `${[launch.file, ...launch.args].join("\0")}\0${args.join("\0")}\0${cwd}`;
  if (roots.has(key)) return roots.get(key);
  const dir = mkdtempSync(join(tmpdir(), "qa-skills-playwright-root-"));
  try {
    const list = join(dir, "test-list.txt");
    writeFileSync(list, `${ROOT_PROBE_LINE}\n`);
    const report = join(dir, "report.json");
    spawnSync(launch.file, [...launch.args, ...args, "--list", "--test-list", list, "--reporter=json"], {
      cwd, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: report }, encoding: "utf8", shell: false,
    });
    const root = /** @type {PwReport | undefined} */ (JSON.parse(readFileSync(report, "utf8")))?.config?.rootDir;
    roots.set(key, typeof root === "string" && root.length ? root : undefined);
  } catch {
    roots.set(key, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return roots.get(key);
}

// A literal title line is faithful only when every component is a plain, trimmed title: the list
// parser trims each part and splits `›` (and `>`) everywhere, with no escape. Anything else needs
// the grep or location fallback, never an ambiguous line.
/** @param {AutomationSelection} selection @returns {boolean} */
const listable = (selection) =>
  selection.literal && selection.titles.length > 0 &&
  selection.titles.every((title) => title.length > 0 && title.trim() === title && !title.includes("›"));

// Whether the selection becomes a `--test-list` line, and so needs Playwright's root before the run.
/** @param {AutomationSelection} selection @param {string} version @returns {boolean} */
const selectionsList = (selection, version) => listable(selection) && atLeast(version, 56);

/**
 * The selection as Playwright reads it.
 * @param {AutomationSelection} selection
 * @param {string} version
 * @param {string} file The spec's path, relative to Playwright's root directory.
 * @returns {PwSelection}
 */
export function playwrightSelection(selection, version, file) {
  if (selectionsList(selection, version)) return { kind: "list", selector: [file, ...selection.titles].join(" › ") };
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
 * @param {string} cwd The working directory, the root only when the report names none.
 * @param {string} repo The repository the plan's `file` is relative to.
 * @returns {RunnerResult}
 */
export function parseReport(report, selection, cwd, repo) {
  /** @type {RunnerResult} */
  const parsed = { instances: {}, diagnostics: [] };
  if (!usable(report)) return { instances: {}, reason: "runner-error", diagnostics: ["The runner report is not a Playwright JSON report"] };
  const named = report.config?.rootDir;
  const root = typeof named === "string" && named.length ? named : cwd;
  const file = posixRelative(root, repo, selection.file);
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
        if (resolve(root, spec.file) !== resolve(root, file) || spec.line !== selection.line) continue;
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
export function runPlaywright({ selection, runner, repo, dir, origin, env, retries, repeats, platform = process.platform }) {
  const cwd = join(repo, runner.dir);
  const launcher = runner.launcher ?? PLAYWRIGHT_RUNNER_LAUNCHER;
  const launch = runnerLaunch(launcher, cwd, platform);
  // A launcher the platform module refuses never starts a process: the Automation is Blocked
  // `runner-error` with the refusal as its diagnostic, as any other launcher problem is.
  if ("refusal" in launch) {
    const file = posixRelative(cwd, repo, selection.file);
    return {
      parsed: { instances: {}, reason: "runner-error", diagnostics: [launch.refusal.message] },
      selector: selectorOf(playwrightSelection(selection, "0.0.0", file), selection),
    };
  }
  const inherited = { ...env, ...Object.fromEntries(runner.target_env.map((name) => [name, origin])) };
  const version = playwrightVersion(launch, cwd, inherited);
  const args = runner.args ?? [];
  // Only a `--test-list` line is rendered from Playwright's root; the location fallback stays
  // relative to the working directory, where Playwright matches it against absolute paths.
  const probed = selectionsList(selection, version) ? playwrightRoot(launch, args, cwd, inherited) : undefined;
  const rendered = playwrightSelection(selection, version, posixRelative(probed ?? cwd, repo, selection.file));
  /** @type {string[]} */
  let filter;
  if (rendered.kind === "list") {
    const list = join(dir, "test-list.txt");
    writeFileSync(list, `${rendered.selector}\n`);
    filter = ["--test-list", list];
  } else if (rendered.kind === "grep") filter = ["--grep", rendered.selector];
  else filter = [rendered.selector];
  const reporter = atLeast(version, 63) ? "--add-reporter=json" : "--reporter=json";
  const argv = [
    ...launch.args, ...args, ...filter, reporter, "--output", join(dir, "artifacts"), `--retries=${retries}`, ...(repeats ? [`--repeat-each=${repeats}`, "--max-failures=1", "--workers=1"] : []),
  ];
  const reportPath = join(dir, "report.json");
  const child = spawnSync(launch.file, argv, { cwd, env: { ...inherited, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath }, encoding: "utf8", shell: false });
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
  return { parsed, selector: selectorOf(rendered, selection) };
}
