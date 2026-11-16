// @ts-check
// A Feature's Proposed Rules (ADR-0067): numbered, unkeyed items under `## Proposed Rules`, each a
// one-line statement with optional `Why:` and `Scenario:` fields. They claim nothing, so the
// coverage digest, the impact projection and every brief leave them out.
import { parse } from "./knowledge-file.mjs";
import { isOpenQuestionsSection } from "./parked-questions.mjs";

/** @import { CheckProblem } from "./check-file.mjs" */

/** @type {"Proposed Rules"} */
export const PROPOSED_RULES_SECTION = "Proposed Rules";
const FIELDS = /** @type {const} */ (["Why", "Scenario"]);

/**
 * One kept Proposed Rule. `line` is 1-based in the Feature file.
 * @typedef {{ statement: string, why: string | null, scenario: string | null, line: number }} ProposedRule
 */

/**
 * A Proposed Rule to append: the statement as the engineer kept it, and its optional fields.
 * @typedef {{ statement: string, why?: string | null, scenario?: string | null }} NewProposedRule
 */

/**
 * @typedef {{ level: number, title: string, line: number, end: number }} Section
 */

/**
 * Whether a section is a Feature's `## Proposed Rules`.
 * @param {{ level: number, title: string }} section
 * @returns {boolean}
 */
export function isProposedRulesSection(section) {
  return section.level === 2 && section.title === PROPOSED_RULES_SECTION;
}

/**
 * The sections a parsed file holds with the Proposed Rules title.
 * @param {{ sections: readonly Section[] }} file
 * @returns {Section[]}
 */
export function proposedRulesSections(file) {
  return file.sections.filter(isProposedRulesSection);
}

/**
 * A statement as a Proposed Rule holds it: surrounding and repeated whitespace collapsed.
 * @param {string} statement
 * @returns {string}
 */
export function normalizeStatement(statement) {
  return statement.trim().replace(/\s+/g, " ");
}

/**
 * Every Proposed Rules section's items and the problems in them. A malformed line is reported,
 * never made into an item.
 * @param {string} text
 * @returns {{ items: ProposedRule[], problems: CheckProblem[] }}
 */
function readProposedRules(text) {
  const file = parse("feature.md", text);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  /** @type {(ProposedRule & { seen: Set<string> })[]} */
  const items = [];
  /** @type {CheckProblem[]} */
  const problems = [];
  for (const [index, section] of proposedRulesSections(file).entries()) {
    if (index > 0) problems.push({ code: "proposed_rules_duplicate", line: section.line, message: "a Feature has at most one `## Proposed Rules` section" });
    /** @type {(ProposedRule & { seen: Set<string> }) | null} */
    let item = null;
    let count = 0;
    const before = problems.length;
    for (let i = section.line; i < section.end; i++) {
      const raw = lines[i];
      if (!raw.trim()) continue;
      const line = i + 1;
      const start = /^\d+\.\s+(\S.*?)\s*$/.exec(raw);
      if (start) {
        count++;
        item = { statement: start[1], why: null, scenario: null, line, seen: new Set() };
        items.push(item);
        continue;
      }
      if (/^\s/.test(raw) && item) {
        const field = /^\s+(\w+):\s*(\S.*?)\s*$/.exec(raw);
        const name = /** @type {"Why" | "Scenario" | undefined} */ (field && FIELDS.find((f) => f === field[1]));
        if (!field || !name || item.seen.has(name)) {
          problems.push({ code: "proposed_rule_field", line, message: "a Proposed Rule's statement is one line, followed only by one `Why: <text>` and one `Scenario: <scenario key>` line, indented under it" });
          continue;
        }
        item.seen.add(name);
        if (name === "Why") item.why = field[2];
        else item.scenario = field[2];
        continue;
      }
      problems.push({ code: "proposed_rule_line", line, message: "a Proposed Rule is a numbered item `<n>. <statement>`, its fields indented under it" });
    }
    if (count === 0 && problems.length === before) {
      problems.push({ code: "proposed_rules_empty", line: section.line, message: "omit `## Proposed Rules` when it has no items" });
    }
  }
  return { items: items.map(({ seen, ...rest }) => rest), problems };
}

/**
 * The Feature's Proposed Rules in file order; an absent section returns an empty list.
 * @param {string} text
 * @returns {ProposedRule[]}
 */
export function parseProposedRules(text) {
  return readProposedRules(text).items;
}

/**
 * Shape-only problems in a Feature's Proposed Rules. Whether `Scenario:` names a live scenario is
 * left to the reader (ADR-0057).
 * @param {{ text: string }} feature
 * @returns {CheckProblem[]}
 */
export function proposedRulesProblems(feature) {
  return readProposedRules(feature.text).problems;
}

/**
 * Whether two statements are the same Proposed Rule: equal once surrounding and repeated
 * whitespace is collapsed.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameStatement(a, b) {
  return normalizeStatement(a) === normalizeStatement(b);
}

/**
 * `text` with `rules` appended as the last items of `## Proposed Rules`, numbered on from the last
 * one. A Feature without the section gets one before `## Open questions`, or at the end. The file's
 * line endings are kept.
 * @param {string} text
 * @param {NewProposedRule[]} rules
 * @returns {string}
 */
export function appendProposedRules(text, rules) {
  if (rules.length === 0) return text;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const file = parse("feature.md", text);
  const existing = parseProposedRules(text);
  const block = rules.flatMap((r, i) => [
    ...(i > 0 ? [""] : []),
    `${existing.length + i + 1}. ${normalizeStatement(r.statement)}`,
    ...(r.why ? [`   Why: ${normalizeStatement(r.why)}`] : []),
    ...(r.scenario ? [`   Scenario: ${r.scenario.trim()}`] : []),
  ]);
  const section = proposedRulesSections(file)[0];
  if (section) {
    let last = section.end;
    while (last > section.line && !lines[last - 1].trim()) last--;
    lines.splice(last, 0, "", ...block);
  } else {
    const questions = file.sections.find(isOpenQuestionsSection);
    if (questions) lines.splice(questions.line - 1, 0, `## ${PROPOSED_RULES_SECTION}`, "", ...block, "");
    else {
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      lines.push("", `## ${PROPOSED_RULES_SECTION}`, "", ...block, "");
    }
  }
  return lines.join(eol);
}
