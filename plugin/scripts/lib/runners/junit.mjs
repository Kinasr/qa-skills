// @ts-check
// The shared half of the JVM adapters (`runners/gradle.mjs`, `runners/maven.mjs`): find the test
// file's module, render its class#method selector, move prior `TEST-*.xml` aside before every
// invocation and treat only a re-created file as fresh, and turn JUnit XML into per-instance
// attempts. The attempt rules stay in lib/test-runner.mjs, unchanged.
//
// The JVM runner spike pinned the facts this module uses:
//   - Gradle names a testcase `flaky()`, Surefire names it `flaky`; the whole `name` is the
//     instance, never a name manufactured from the selector;
//   - `<flakyFailure>` is a failed attempt then the outer testcase's pass, and `<failure>` plus
//     `<rerunFailure>` is two failed attempts of the same testcase;
//   - a compile failure that recreates no XML after the prior was moved aside is no fresh report,
//     which is Blocked `runner-error`, never a stale pass.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { attemptRules } from "../test-runner.mjs";
/** @import { AutomationAttempt, AutomationSelection, RunnerResult } from "../test-runner.mjs" */
/** @import { TestRunner } from "../knowledge-file.mjs" */

/**
 * A testcase element: its attributes and the elements inside it.
 * @typedef {{ name: string, classname: string, children: { kind: string, message: string }[] }} JUnitCase
 */

/**
 * The class and method a selector names.
 * @typedef {{ pkg: string, classPath: string, method: string, fqcn: string }} JvmTarget
 */

/** @param {string} text @param {string} name @returns {string} */
function attribute(text, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(text);
  return match ? match[1] ?? match[2] ?? "" : "";
}

/**
 * The testcase elements of a report, or null when the XML is not the shape Surefire or Gradle
 * writes. Deliberately small: it reads attributes and direct children, never a namespace.
 * @param {string} text
 * @returns {JUnitCase[] | null}
 */
export function junitCases(text) {
  const body = text.trim();
  if (!/<testsuite\b/.test(body)) return null;
  if (!/<\/testsuite\s*>\s*$/.test(body) && !/<testsuite\b[^>]*\/>\s*$/.test(body)) return null;
  /** @type {JUnitCase[]} */
  const cases = [];
  const start = /<testcase\b([^>]*)>/g;
  let match;
  while ((match = start.exec(body))) {
    const raw = match[1];
    const selfClosing = /\/\s*$/.test(raw);
    const attrs = raw.replace(/\/\s*$/, "");
    let inside = "";
    let end = match.index + match[0].length;
    if (!selfClosing) {
      const close = body.indexOf("</testcase>", end);
      if (close === -1) return null;
      inside = body.slice(end, close);
      end = close + "</testcase>".length;
      start.lastIndex = end;
    }
    /** @type {{ kind: string, message: string }[]} */
    const children = [];
    const child = /<(failure|error|flakyFailure|flakyError|rerunFailure|rerunError|skipped)\b([^>]*)>/g;
    let part;
    while ((part = child.exec(inside))) children.push({ kind: part[1], message: attribute(part[2], "message") });
    cases.push({ name: attribute(attrs, "name"), classname: attribute(attrs, "classname"), children });
  }
  return cases;
}

/**
 * One testcase's ordered attempts: a flaky element is a fail then the testcase's pass, a failure
 * with reruns is all failed, and a skip is Blocked `skipped`.
 * @param {JUnitCase} testcase
 * @param {string} id
 * @param {string[]} diagnostics
 * @returns {AutomationAttempt[]}
 */
function attemptsOf(testcase, id, diagnostics) {
  /** @type {AutomationAttempt[]} */
  const attempts = [];
  let flaky = false;
  let skipped = false;
  for (const child of testcase.children) {
    if (child.kind === "skipped") skipped = true;
    else {
      if (child.kind === "flakyFailure" || child.kind === "flakyError") flaky = true;
      attempts.push({ result: "failed" });
      if (child.message) diagnostics.push(`${id}: ${child.message}`);
    }
  }
  if (skipped) return [{ result: "blocked", reason: "skipped" }];
  if (flaky) attempts.push({ result: "passed" });
  else if (!attempts.length) attempts.push({ result: "passed" });
  return attempts;
}

/**
 * The per-instance attempts of one JUnit XML report. A testcase's instance id is
 * `<module>:<classname>#<testcase name>`; the whole name is kept.
 * @param {string} text
 * @param {{ module: string }} options
 * @returns {RunnerResult}
 */
export function parseJUnitReport(text, { module }) {
  const cases = junitCases(text);
  if (!cases) return { instances: {}, reason: "runner-error", diagnostics: ["The JUnit XML report is not parseable"] };
  /** @type {RunnerResult} */
  const parsed = { instances: {}, diagnostics: [] };
  for (const testcase of cases) {
    if (!testcase.name) continue;
    const id = `${module}:${testcase.classname}#${testcase.name}`;
    parsed.instances[id] = attemptsOf(testcase, id, parsed.diagnostics);
  }
  return parsed;
}

/**
 * Append a later invocation's attempts to an earlier one's, per instance. The attempt rules read
 * the ordered list, so a re-invocation never replaces what the previous one reported.
 * @param {RunnerResult} into
 * @param {RunnerResult} from
 * @returns {RunnerResult}
 */
export function mergeRunnerResult(into, from) {
  for (const [id, attempts] of Object.entries(from.instances)) into.instances[id] = [...(into.instances[id] ?? []), ...attempts];
  into.diagnostics.push(...from.diagnostics);
  if (from.reason) into.reason = from.reason;
  return into;
}

/**
 * The package, class chain and method a selection names.
 * @param {AutomationSelection} selection
 * @returns {JvmTarget}
 */
export function jvmTarget(selection) {
  const titles = selection.titles ?? [];
  const method = titles.at(-1) ?? "";
  const classPath = titles.slice(0, -1).join(".");
  const pkg = selection.package ?? "";
  return { pkg, classPath, method, fqcn: [pkg, classPath].filter(Boolean).join(".") };
}

/**
 * The selection as Gradle's `--tests` takes it: `<pkg>.<Class>.<method>`.
 * @param {AutomationSelection} selection
 * @returns {string}
 */
export function gradleSelector(selection) {
  const { fqcn, method } = jvmTarget(selection);
  return fqcn ? `${fqcn}.${method}` : method;
}

/**
 * The selection as Maven's `-Dtest` takes it: `<pkg>.<Class>#<method>`.
 * @param {AutomationSelection} selection
 * @returns {string}
 */
export function mavenSelector(selection) {
  const { fqcn, method } = jvmTarget(selection);
  return fqcn ? `${fqcn}#${method}` : `#${method}`;
}

/**
 * The module a test file belongs to: the nearest build file's directory at or under the runner's
 * directory. `.` is the runner root, so Gradle gets a bare task and Maven no `-pl`.
 * @param {string} repo
 * @param {string} runnerDir
 * @param {string} file
 * @param {readonly string[]} buildNames
 * @returns {string}
 */
export function jvmModule(repo, runnerDir, file, buildNames) {
  const root = resolve(repo, runnerDir);
  let dir = dirname(join(repo, file));
  while (dir.startsWith(`${root}${sep}`)) {
    if (buildNames.some((name) => existsSync(join(dir, name)))) return relative(root, dir).split(sep).join("/") || ".";
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return ".";
}

/**
 * The report directory the tool writes into for a module.
 * @param {string} cwd
 * @param {string} module
 * @param {readonly string[]} parts the tool's report directory below the module root
 * @returns {string}
 */
export function reportDirectory(cwd, module, parts) {
  const base = module === "." ? cwd : join(cwd, module);
  return join(base, ...parts);
}

/**
 * Move any prior report for the selected class into the run's `prior/<module>/` directory, so only
 * a file that exists again after the invocation is fresh. Never mtime or a hash.
 * @param {string} report
 * @param {string} priorDir
 * @returns {boolean}
 */
export function movePriorReport(report, priorDir) {
  if (!existsSync(report) || !statSync(report).isFile()) return false;
  mkdirSync(priorDir, { recursive: true });
  const dest = join(priorDir, basename(report));
  rmSync(dest, { force: true });
  renameSync(report, dest);
  return true;
}

/**
 * Copy a re-created report into the invocation's own directory. A missing file is not fresh.
 * @param {string} report
 * @param {string} outDir
 * @returns {string | null}
 */
export function copyFreshReport(report, outDir) {
  if (!existsSync(report) || !statSync(report).isFile()) return null;
  mkdirSync(outDir, { recursive: true });
  const dest = join(outDir, basename(report));
  copyFileSync(report, dest);
  return dest;
}

/**
 * Read a fresh report, with a runner error rather than a throw when it is unreadable.
 * @param {string} report
 * @param {string} module
 * @returns {RunnerResult}
 */
export function readFreshReport(report, module) {
  try {
    return parseJUnitReport(readFileSync(report, "utf8"), { module });
  } catch {
    return { instances: {}, reason: "runner-error", diagnostics: ["Missing or unreadable JUnit XML report"] };
  }
}

/**
 * The environment the spawned JVM inherits, with every `target_env` name set to the Run's origin.
 * @param {Record<string, string | undefined>} env
 * @param {string} origin
 * @param {readonly string[]} names
 * @returns {Record<string, string | undefined>}
 */
export function runnerEnvironment(env, origin, names) {
  return { ...env, ...Object.fromEntries(names.map((name) => [name, origin])) };
}

/**
 * True when the latest attempt of every instance passed, so a Gradle re-invocation is unnecessary.
 * @param {RunnerResult} parsed
 * @returns {boolean}
 */
export function lastAttemptPassed(parsed) {
  const latest = attemptRules(parsed.instances).attempts.at(-1);
  return latest?.result === "passed";
}

/**
 * The runner's own output as bounded diagnostics, before lib/test-runner.mjs redacts them.
 * @param {string | null | undefined} stdout
 * @param {string | null | undefined} stderr
 * @returns {string[]}
 */
export function runnerOutput(stdout, stderr) {
  return [stdout ?? "", stderr ?? ""].map((text) => text.trim()).filter(Boolean);
}
