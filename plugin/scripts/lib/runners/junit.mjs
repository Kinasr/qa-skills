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
import { isContained } from "../paths.mjs";
import { attemptRules } from "../test-runner.mjs";
/** @import { AutomationAttempt, AutomationSelection, RunnerResult } from "../test-runner.mjs" */
/** @import { TestRunner } from "../knowledge-file.mjs" */

/**
 * A testcase element: its attributes and the elements inside it.
 * @typedef {{ name: string, classname: string, children: { kind: string, message: string }[] }} JUnitCase
 */

/**
 * The class and method a selector names. `classPath` is the binary class chain (`Outer$Inner`), as
 * both tools select a nested class; `outer` is the top-level class's fully qualified name.
 * @typedef {{ pkg: string, classPath: string, method: string, fqcn: string, outer: string }} JvmTarget
 */

const XML_ENTITIES = /** @type {const} */ ({
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&apos;": "'",
});

/**
 * Decode standard XML named and numeric character references in a single pass.
 * @param {string} text
 * @returns {string}
 */
function decodeXmlEntities(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (entity) => {
    if (Object.hasOwn(XML_ENTITIES, entity)) return XML_ENTITIES[/** @type {keyof typeof XML_ENTITIES} */ (entity)];
    const code = entity.startsWith("&#x") ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/**
 * Find the closing `>` index of an XML tag starting at `openIndex`, ignoring `>` inside quotes.
 * @param {string} xml
 * @param {number} openIndex
 * @returns {number}
 */
function findTagEnd(xml, openIndex) {
  /** @type {string | null} */
  let quote = null;
  for (let i = openIndex + 1; i < xml.length; i++) {
    const ch = xml[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === "\"" || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/**
 * Remove named XML elements (self-closing or paired) using quote-aware tag boundaries.
 * @param {string} xml
 * @param {readonly string[]} tags
 * @returns {string}
 */
function stripElements(xml, tags) {
  const pattern = new RegExp(`<(?:${tags.join("|")})(?=\\s|\\/?\\>)`, "g");
  let out = "";
  let cursor = 0;
  let match;
  while ((match = pattern.exec(xml))) {
    if (match.index < cursor) continue;
    const tagName = match[0].slice(1);
    const tagEnd = findTagEnd(xml, match.index);
    if (tagEnd === -1) break;
    out += xml.slice(cursor, match.index);
    if (xml[tagEnd - 1] === "/") {
      cursor = tagEnd + 1;
    } else {
      const closeRe = new RegExp(`<\\/${tagName}\\s*>`, "g");
      closeRe.lastIndex = tagEnd + 1;
      const closeMatch = closeRe.exec(xml);
      cursor = closeMatch ? closeMatch.index + closeMatch[0].length : tagEnd + 1;
    }
    pattern.lastIndex = cursor;
  }
  return out + xml.slice(cursor);
}

/**
 * Decode an XML attribute value cleanly, avoiding `-name` false matches.
 * @param {string} text
 * @param {string} name
 * @returns {string}
 */
function attribute(text, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(text);
  return match ? decodeXmlEntities(match[1] ?? match[2] ?? "") : "";
}

/**
 * The testcase elements of a report, or null when the XML is not the shape Surefire or Gradle
 * writes. Deliberately small: it reads attributes and direct children, never a namespace.
 * @param {string} text
 * @returns {JUnitCase[] | null}
 */
export function junitCases(text) {
  const stripped = text.trim()
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const suiteStart = /<testsuite(?=\s|\/?>)/.exec(stripped);
  if (!suiteStart) return null;
  const suiteEnd = findTagEnd(stripped, suiteStart.index);
  if (suiteEnd === -1) return null;
  const suiteClosed = stripped[suiteEnd - 1] === "/"
    ? stripped.slice(suiteEnd + 1).trim() === ""
    : /<\/testsuite\s*>\s*$/.test(stripped);
  if (!suiteClosed) return null;
  const body = stripElements(stripped, ["system-out", "system-err"]);
  /** @type {JUnitCase[]} */
  const cases = [];
  const start = /<testcase(?=\s|\/?>)/g;
  let match;
  while ((match = start.exec(body))) {
    const tagEnd = findTagEnd(body, match.index);
    if (tagEnd === -1) return null;
    const raw = body.slice(match.index + "<testcase".length, tagEnd);
    const selfClosing = /\/\s*$/.test(raw);
    const attrs = raw.replace(/\/\s*$/, "");
    let inside = "";
    let end = tagEnd + 1;
    if (!selfClosing) {
      const closeRe = /<\/testcase\s*>/g;
      closeRe.lastIndex = end;
      const closeMatch = closeRe.exec(body);
      if (!closeMatch) return null;
      inside = body.slice(end, closeMatch.index);
      end = closeMatch.index + closeMatch[0].length;
    }
    start.lastIndex = end;
    /** @type {{ kind: string, message: string }[]} */
    const children = [];
    const child = /<(failure|error|flakyFailure|flakyError|rerunFailure|rerunError|skipped)(?=\s|\/?>)/g;
    let part;
    while ((part = child.exec(inside))) {
      const childEnd = findTagEnd(inside, part.index);
      if (childEnd === -1) return null;
      const childAttrs = inside.slice(part.index + 1 + part[1].length, childEnd).replace(/\/\s*$/, "");
      child.lastIndex = childEnd + 1;
      children.push({ kind: part[1], message: attribute(childAttrs, "message") });
    }
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
 * `<module>:<classname>#<testcase name>`; the whole name is kept. Surefire names a class-level
 * setup failure (`@BeforeAll`) `""`, so an empty name with a classname is still an instance.
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
    if (!testcase.name && !testcase.classname) continue;
    const baseId = `${module}:${testcase.classname}#${testcase.name}`;
    let id = baseId;
    if (Object.hasOwn(parsed.instances, id)) {
      let n = 2;
      while (Object.hasOwn(parsed.instances, `${baseId}#${n}`)) n++;
      id = `${baseId}#${n}`;
    }
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
  const classes = titles.slice(0, -1);
  const pkg = selection.package ?? "";
  const qualified = (/** @type {string} */ name) => [pkg, name].filter(Boolean).join(".");
  const classPath = classes.join("$");
  return { pkg, classPath, method, fqcn: qualified(classPath), outer: qualified(classes[0] ?? "") };
}

/**
 * The selection as Gradle's `--tests` takes it: `<pkg>.<Outer$Inner>.<method>`.
 * @param {AutomationSelection} selection
 * @returns {string}
 */
export function gradleSelector(selection) {
  const { fqcn, method } = jvmTarget(selection);
  return fqcn ? `${fqcn}.${method}` : method;
}

/**
 * The selection as Maven's `-Dtest` takes it: `<pkg>.<Outer$Inner>#<method>`.
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
  while (isContained(root, dir, { strict: true })) {
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
