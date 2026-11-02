// @ts-check
// The `## Coverage` section of a Feature file (ADR-0041): one line per effective Coverage category,
// in walk order, recording what the deep dive considered. Coverage claims no behaviour, so it is
// Feature knowledge but never a Rule or a Test Case:
//
//   - <key>: covered by rule_a, rule_b[; n/a for <functionality>: <reason>]
//   - <key>: n/a: <reason>
//   - <key>: awaiting
//
// An `awaiting` line needs an open Parked question tagged `[<key>]`; a tag on any other category is
// refused. `covered` counts Rules that apply, whether or not a case covers them (a Waived Rule is
// still covered by Rules); `awaiting` outranks `covered`, which outranks `n/a`.
//
//   parseCoverage(text)                  the section, or null when the Feature has none
//   coverageProblems(feature, effective) the deep-dive check's validation of a drafted Feature
//   coverageDue(featureFile, effective)   the first trigger that makes Coverage due, or null
//   coverageDigest(text)                 the Bookkeeping digest of the Rules, Boundaries, Deferred,
//                                        Open questions and `sources`, with Coverage and narrative left out
/**
 * @import { CheckProblem } from "./check-file.mjs"
 * @import { EffectiveCategories } from "./categories.mjs"
 * @import { ParsedFile } from "./knowledge-file.mjs"
 */
import { listOf } from "./dialect.mjs";
import { parse } from "./knowledge-file.mjs";
import { parkedQuestions } from "./parked-questions.mjs";
import { digestOf } from "./pin-digest.mjs";
import { strip } from "./stripped.mjs";

/**
 * One category's disposition in the walk.
 * @typedef {"covered" | "n/a" | "awaiting"} CoverageDisposition
 */

/**
 * Why one functionality is not covered on a line whose category is otherwise covered.
 * @typedef {{ functionality: string, reason: string }} CoverageNa
 */

/**
 * One `## Coverage` line.
 * @typedef {{
 *   key: string,
 *   disposition: CoverageDisposition,
 *   rules: string[],
 *   na: CoverageNa[],
 *   reason: string | null,
 *   line: number,
 * }} CoverageLine
 */

/**
 * The parsed section: its heading line, its lines and the lines it could not read.
 * @typedef {{
 *   line: number,
 *   lines: CoverageLine[],
 *   problems: CheckProblem[],
 * }} CoverageSection
 */

/**
 * Options for validating a drafted Feature's Coverage.
 * @typedef {{
 *   current?: ParsedFile | null,
 * }} CoverageOptions
 */

/**
 * Why a Feature's Coverage is due, in the order one Feature reports them.
 * @typedef {"missing_section" | "missing_category" | "unknown_category" | "retired_category"
 *   | "retired_rule" | "withdrawn_boundary" | "untagged_awaiting" | "digest_mismatch"} CoverageDueTrigger
 */

/**
 * A Feature's Coverage is due: the first trigger, and a detail naming the problems and any other
 * trigger that also holds.
 * @typedef {{ trigger: CoverageDueTrigger, detail: string }} CoverageDue
 */

const ITEM = /^-\s+([^:\s]+):\s*(.*)$/;
const RULE_TOKEN = /\brule_[a-z0-9]+\b/g;
const BOUNDARY_TOKEN = /\bboundary_[a-z0-9]+\b/g;
const TAG = /^\[([a-z][a-z0-9-]*)\](?!\()/;

/**
 * The Feature text's `## Coverage` section, or null when it has none. A line that is not one of the
 * three dispositions is reported in `problems` and left out of `lines`, so the validator can refuse
 * it without inventing a disposition.
 * @param {string} text
 * @returns {CoverageSection | null}
 */
export function parseCoverage(text) {
  const file = parse("feature.md", text);
  const section = file.sections.find((s) => s.level === 2 && s.title === "Coverage");
  if (!section) return null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  /** @type {CoverageLine[]} */
  const parsed = [];
  /** @type {CheckProblem[]} */
  const problems = [];
  for (let i = section.line; i < section.end; i++) {
    const raw = lines[i];
    const line = i + 1;
    if (!raw.trim()) continue;
    const item = ITEM.exec(raw);
    if (!item) {
      problems.push({ code: "coverage_line", line, message: "a Coverage line is `- <key>: covered by <rules>`, `- <key>: n/a: <reason>` or `- <key>: awaiting`" });
      continue;
    }
    const key = item[1];
    const rest = item[2].trim();
    if (rest === "awaiting") {
      parsed.push({ key, disposition: "awaiting", rules: [], na: [], reason: null, line });
      continue;
    }
    const na = /^n\/a:\s*(.*)$/.exec(rest);
    if (na) {
      parsed.push({ key, disposition: "n/a", rules: [], na: [], reason: na[1].trim(), line });
      continue;
    }
    const covered = /^covered by\s+(.*)$/.exec(rest);
    if (!covered) {
      problems.push({ code: "coverage_line", line, message: `Coverage line for \`${key}\` states \`covered by <rules>\`, \`n/a: <reason>\` or \`awaiting\`` });
      continue;
    }
    const [head, ...clauses] = covered[1].split(";");
    const rules = head.split(",").map((rule) => rule.trim()).filter(Boolean);
    if (rules.length === 0) problems.push({ code: "coverage_line", line, message: `a covered line for \`${key}\` names at least one Rule` });
    /** @type {CoverageNa[]} */
    const clauseLines = [];
    for (const clause of clauses) {
      const values = /^n\/a for\s+(.+?):\s*(.+)$/.exec(clause.trim());
      if (values) clauseLines.push({ functionality: values[1].trim(), reason: values[2].trim() });
      else problems.push({ code: "coverage_line", line, message: `an n/a clause is \`n/a for <functionality>: <reason>\`: ${clause.trim()}` });
    }
    parsed.push({ key, disposition: "covered", rules, na: clauseLines, reason: null, line });
  }
  return { line: section.line, lines: parsed, problems };
}

/**
 * Every problem a drafted Feature's `## Coverage` has, as `check-file`-shaped errors: a line the
 * parser could not read, a key that is unknown or retired, a line repeated or out of walk order, a
 * missing effective category, a Rule or Boundary reference that no longer resolves, a tag on a
 * category that is not awaiting, an `awaiting` line with no tagged Parked question, and an `n/a`
 * with no reason. `opts.current` is the Feature this draft replaces: when it has a section and the
 * draft does not, the draft is refused, while a legacy Feature with no section stays valid.
 * @param {ParsedFile} feature The drafted Feature.
 * @param {EffectiveCategories} effective The effective category list and its retired keys.
 * @param {CoverageOptions} [opts]
 * @returns {CheckProblem[]}
 */
export function coverageProblems(feature, effective, { current = null } = {}) {
  const section = parseCoverage(feature.text ?? "");
  if (section === null) {
    if (current !== null && parseCoverage(current.text ?? "") !== null) {
      return [{ code: "coverage_dropped", line: current.frontmatterLine ?? 1, message: "the Feature has a `## Coverage` section; a re-run keeps it" }];
    }
    return [];
  }

  /** @type {CheckProblem[]} */
  const errors = [...section.problems];
  const effectiveKeys = effective.categories.map((category) => category.key);
  const known = new Set(effectiveKeys);
  const retiredCategories = new Set(effective.retired);
  const retired = new Set(listOf(feature.data?.retired));
  const rules = new Set((feature.rules ?? []).map((rule) => rule.key).filter((key) => !retired.has(key)));
  const boundaries = new Set((feature.boundaries ?? []).map((boundary) => boundary.key).filter((key) => !retired.has(key)));

  /** @type {Map<string, CoverageLine>} */
  const first = new Map();
  for (const line of section.lines) {
    if (retiredCategories.has(line.key)) {
      errors.push({ code: "coverage_retired_category", field: line.key, line: line.line, message: `Coverage names \`${line.key}\`, a retired category: a retired key is never reused` });
      continue;
    }
    if (!known.has(line.key)) {
      errors.push({ code: "coverage_unknown_category", field: line.key, line: line.line, message: `Coverage names \`${line.key}\`, which is not in the effective category list` });
      continue;
    }
    if (first.has(line.key)) {
      errors.push({ code: "coverage_duplicate", field: line.key, line: line.line, message: `Coverage names \`${line.key}\` more than once; each category gets one line` });
      continue;
    }
    first.set(line.key, line);
    if (line.disposition === "n/a" && line.reason === "") {
      errors.push({ code: "coverage_reason", field: line.key, line: line.line, message: `\`${line.key}\` is n/a, so it says why` });
    }
  }

  let order = -1;
  for (const line of section.lines) {
    const index = effectiveKeys.indexOf(line.key);
    if (index === -1 || first.get(line.key) !== line) continue;
    if (index < order) {
      errors.push({ code: "coverage_order", field: line.key, line: line.line, message: `Coverage lines follow the effective walk order; \`${line.key}\` is out of place` });
    } else order = index;
  }

  for (const key of effectiveKeys) {
    if (!first.has(key)) errors.push({ code: "coverage_missing", field: key, line: section.line, message: `Coverage has no line for \`${key}\`; each effective category gets one` });
  }

  for (const line of section.lines) {
    const text = [line.rules.join(", "), line.reason ?? "", ...line.na.flatMap((na) => [na.functionality, na.reason])].join(" ");
    /** @type {Set<string>} */
    const named = new Set([...line.rules, ...tokens(text, RULE_TOKEN)]);
    for (const rule of named) {
      if (!rules.has(rule)) errors.push({ code: "coverage_rule", field: rule, line: line.line, message: `Coverage names \`${rule}\`, which is not a live Rule of this Feature` });
    }
    for (const boundary of tokens(text, BOUNDARY_TOKEN)) {
      if (!boundaries.has(boundary)) errors.push({ code: "coverage_boundary", field: boundary, line: line.line, message: `Coverage names \`${boundary}\`, which is not a live Boundary of this Feature` });
    }
  }

  const awaiting = new Set(section.lines.filter((line) => line.disposition === "awaiting").map((line) => line.key));
  const questions = parkedQuestions(feature);
  const tagged = new Set();
  for (const question of questions) {
    const tag = TAG.exec(question.text);
    if (!tag) continue;
    tagged.add(tag[1]);
    if (!awaiting.has(tag[1])) {
      errors.push({ code: "coverage_tag", field: tag[1], line: question.line, message: `\`[${tag[1]}]\` tags a Parked question, but \`${tag[1]}\` is not awaiting` });
    }
  }
  for (const key of awaiting) {
    if (!tagged.has(key)) errors.push({ code: "coverage_awaiting", field: key, line: first.get(key)?.line ?? section.line, message: `\`${key}\` is awaiting, so an open Parked question is tagged \`[${key}]\`` });
  }

  return errors.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/** @type {CoverageDueTrigger[]} */
const DUE_TRIGGERS = [
  "missing_section", "missing_category", "unknown_category", "retired_category",
  "retired_rule", "withdrawn_boundary", "untagged_awaiting", "digest_mismatch",
];

/**
 * Why a Feature's `## Coverage` is due, or null when it is complete and current: the section
 * exists, every effective category has one live line whose references resolve and whose awaiting
 * lines have a tagged open Parked question, and `coverage_digest` matches the knowledge it covers.
 * `coverageProblems` supplies the section's problems and `coverageDigest` the current digest, so
 * the predicate re-validates nothing. When several triggers hold, `trigger` is the first in
 * `DUE_TRIGGERS` order and `detail` names the others too.
 * @param {ParsedFile} featureFile The Feature.
 * @param {EffectiveCategories} effective The effective category list and its retired keys.
 * @param {CoverageOptions} [opts]
 * @returns {CoverageDue | null}
 */
export function coverageDue(featureFile, effective, opts = {}) {
  /** @type {Map<CoverageDueTrigger, string[]>} */
  const found = new Map();
  /** @param {CoverageDueTrigger} trigger @param {string} message */
  const add = (trigger, message) => {
    const messages = found.get(trigger) ?? [];
    messages.push(message);
    found.set(trigger, messages);
  };

  const text = featureFile.text ?? "";
  const section = parseCoverage(text);
  if (section === null) add("missing_section", "the Feature has no `## Coverage` section");

  /** @type {Record<string, CoverageDueTrigger>} */
  const fromProblem = {
    coverage_dropped: "missing_section",
    coverage_missing: "missing_category",
    coverage_unknown_category: "unknown_category",
    coverage_retired_category: "retired_category",
    coverage_rule: "retired_rule",
    coverage_boundary: "withdrawn_boundary",
    coverage_awaiting: "untagged_awaiting",
  };
  for (const problem of coverageProblems(featureFile, effective, opts)) {
    const trigger = fromProblem[problem.code];
    // A malformed, duplicate or out-of-order line, a tag on a category that is not awaiting, and
    // an n/a with no reason belong to the deep-dive check: none is one of the due triggers.
    if (trigger) add(trigger, problem.message);
  }

  if (section !== null) {
    const stored = featureFile.data?.coverage_digest;
    if (stored !== coverageDigest(text)) {
      add("digest_mismatch", "`coverage_digest` does not match the Feature's Rules, Boundaries, Deferred, Open questions and sources");
    }
  }

  const triggers = DUE_TRIGGERS.filter((trigger) => found.has(trigger));
  if (triggers.length === 0) return null;
  const [trigger, ...others] = triggers;
  const detail = `${trigger}: ${(found.get(trigger) ?? []).join("; ")}${others.length ? `; also ${others.join(", ")}` : ""}`;
  return { trigger, detail };
}

/**
 * Every match of a global key pattern in `text`.
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {string[]}
 */
function tokens(text, pattern) {
  return [...text.matchAll(new RegExp(pattern.source, "g"))].map((match) => match[0]);
}

/**
 * The Bookkeeping digest of the knowledge Coverage records (ADR-0041, ADR-0044): its stripped
 * Rules and Boundaries, Deferred, Open questions and `sources`, never narrative or `## Coverage`.
 * A Rule, Boundary, Deferred, Open question or source edit changes it; a Coverage-only or narrative
 * edit does not. Absent Deferred contributes nothing, preserving existing digests byte for byte.
 * @param {string} text The Feature file's text.
 * @returns {string}
 */
export function coverageDigest(text) {
  const file = parse("feature.md", text);
  const stripped = strip(file);
  const deferred = sectionBody(file, "Deferred");
  /** @param {Map<string, string>} entries */
  const sorted = (entries) => [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));
  return digestOf([
    "coverage",
    ["rules", ...sorted(stripped.rules)],
    ["boundaries", ...sorted(stripped.boundaries)],
    ...(deferred === null ? [] : [["deferred", deferred]]),
    ["open-questions", openQuestions(file)],
    ["sources", listOf(file.data?.sources)],
  ]);
}

/**
 * The body of a Feature's `## Open questions` section without its heading, trailing whitespace and
 * surrounding blank lines; null when it has none. Trimming the blank lines keeps the digest steady
 * when a `## Coverage` section is inserted after it.
 * @param {ParsedFile} file
 * @returns {string | null}
 */
function openQuestions(file) {
  return sectionBody(file, "Open questions");
}

/**
 * A section's trimmed body, or null when absent or empty.
 * @param {ParsedFile} file
 * @param {string} title
 * @returns {string | null}
 */
function sectionBody(file, title) {
  const section = file.sections?.find((s) => s.level === 2 && s.title === title);
  if (!section) return null;
  const lines = (file.text ?? "").replace(/\r\n/g, "\n").split("\n");
  const body = lines.slice(section.line, section.end).map((line) => line.replace(/\s+$/, ""));
  while (body.length !== 0 && body[body.length - 1] === "") body.pop();
  while (body.length !== 0 && body[0] === "") body.shift();
  return body.length === 0 ? null : body.join("\n");
}
