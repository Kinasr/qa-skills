// @ts-check
// The judge prompt: instructions and output contract.
// Keep the prompt project-neutral; target-project knowledge arrives in the inlined files.
// See docs/adr/0025-qa-skills-carries-no-target-project-data.md.
// Both input files are inlined; the Delegate returns text and writes nothing.
// See docs/adr/0010-a-delegate-returns-text-the-orchestrator-writes.md.

/** @import {UpstreamRule} from "./brief.mjs" */

/**
 * Change information for later judgements.
 * @typedef {{
 *   sentence: string,
 *   diff: string | null,
 *   cases: string,
 * }} JudgeChangeInfo
 */

/**
 * One Boundary of the Feature, as the brief gives it: its key, its statement and its owner.
 * @typedef {{
 *   key: string,
 *   statement: string,
 *   owner: string | null,
 * }} JudgeBoundary
 */

/**
 * Options for generating the judge brief.
 * @typedef {{
 *   first: boolean,
 *   nRules: number,
 *   featurePath: string,
 *   scenarioPath: string,
 *   featureText: string,
 *   scenarioText: string,
 *   file: string,
 *   total?: number,
 *   keys: readonly string[],
 *   boundaries: readonly JudgeBoundary[],
 *   upstream?: readonly UpstreamRule[],
 *   change?: JudgeChangeInfo | null,
 *   context?: string,
 *   contextLeft?: number,
 *   testSuite: string,
 * }} JudgeBriefOptions
 */

/**
 * One scenario file of the context section: the path the judge is told it sits at, and the cases of
 * it that collide with a case under judgement, each with its Key and the text the judge sees.
 * @typedef {{
 *   path: string,
 *   cases: readonly { key: string, text: string }[],
 * }} JudgeContextFile
 */

/**
 * One candidate Rule of the Feature-level judge unit, as the brief gives it: its key and its full
 * text, the heading and the elaboration, as the judge reads it.
 * @typedef {{
 *   key: string,
 *   text: string,
 * }} JudgeRule
 */

/**
 * Options for generating the Feature-level judge brief.
 * @typedef {{
 *   featurePath: string,
 *   boundaries: readonly JudgeBoundary[],
 *   rules: readonly JudgeRule[],
 *   testSuite: string,
 * }} FeatureBriefOptions
 */

// `first`: a first judgement (no Watermark). `nRules`: the Feature's Rule count. `featurePath`,
// `scenarioPath`: the two files as the judge is told to find them. `featureText`,
// `scenarioText`: their contents, inlined. `file`: the scenario file's name, echoed in the reply.
// `keys`: every case key sent; `total`: the cases the file holds, more than `keys` when the change
// selected only some. `boundaries`: the Feature's Boundaries in full.
// `change` (later judgements): `{sentence, diff, cases}`, where `cases` is the inlined changed-case
// text, or "" when there is none or the cap dropped it. `context`: the rendered context section
// (`contextSection`), or "" when there is none or the cap dropped it; `contextLeft`: how many
// context cases the cap dropped, which the brief then says. `testSuite`: the stack's name for the
// test code (lib/stack.mjs `wordsOf`), which the judge must not read.
/**
 * @param {JudgeBriefOptions} options
 * @returns {string}
 */
export function judgeBrief({ first, nRules, featurePath, scenarioPath, featureText, scenarioText, file, keys, total = keys.length, boundaries, upstream = [], change, context = "", contextLeft = 0, testSuite }) {
  const CHANGE = first
    ? `=== FIRST JUDGEMENT ===

This Feature has no Watermark: it has never been judged. There is no change and no diff. Judge
every case against the Feature file as it stands.

`
    : `=== THE CHANGE ===

${/** @type {JudgeChangeInfo} */ (change).sentence} Here is the diff:

\`\`\`diff
${/** @type {JudgeChangeInfo} */ (change).diff}
\`\`\`

${/** @type {JudgeChangeInfo} */ (change).cases}`;
  // The Verdict is Conflict or Current: the Scan, not the judge, says which cases the
  // change makes Stale.
  const CONTEXT_SIDE = context ? ",\n  or the case and a case in the context section contradict each other" : "";
  const VERDICTS = `Return exactly one verdict per case, from \`Conflict\` or \`Current\`.

- **Conflict**: the case and a Rule contradict each other, or the case and another case in this
  same file contradict each other${CONTEXT_SIDE}. A Conflict requires **a quote from each side**. If you cannot
  quote both sides, it is not a Conflict.
- **Current**: no behavioural finding. The case is fine. A case with little or no content that no
  Rule contradicts is Current. A case can be Current and still cross a Boundary: the verdict is
  one thing, the crossing is another.

`;
  const partial = total > keys.length;
  const SELECTED = partial
    ? `The change selected ${keys.length} of this file's ${total} cases, and the Test Scenario file below shows only
those. The other cases are not shown and not judged.

`
    : "";
  const FILES = `${SELECTED}${inlined("THE FEATURE FILE", featurePath, featureText)}${inlined("THE TEST SCENARIO FILE", scenarioPath, scenarioText)}${context || contextLeftOut(contextLeft)}`;
  const CONTEXT_CONTRACT = `A context case is read, never judged: return no entry for a context case. To name one as
the other side of a Conflict, put its Key in \`rules\` and quote it word for word in
\`quote_other\`. The Conflict is recorded on the case you judge, never on the context case.

`;
  return `You are a change-impact judge for a QA knowledge layer. You are NOT a coding agent.
Change **nothing**. Write **no files**. Run **no commands** except reading the two files named
below. Your entire output is one report.

=== WHAT YOU ARE JUDGING ===

A Feature file holds narrative prose plus Rules, each written as \`### rule_<key>: <statement>\`.
Rules are the stated intent for the feature. Test Scenario files hold Test Cases, each written as
\`### <KEY>: <summary>\` followed by a \`yaml\` block and prose (Preconditions / Steps / Expected
result). A case's \`covers:\` field names the Rules it is believed to exercise.

A Feature file may also hold **Boundaries**, each written as \`### boundary_<key>: <statement>\`
with an \`Owner:\` line naming the Feature that owns that behaviour, or \`none\`.

**\`covers:\` is content, not a filter.** A case with \`covers: []\` is judged exactly like any
other. Judge every case against **all** the Rules in the Feature, not just the ones it names.

**A case's summary heading is a claim**, read literally, exactly like its prose. A case whose only
content is its heading is judged on its heading. Ignore the \`mirror:\` field entirely: it is a
copy of the tracker, never a side of a Conflict.

Read exactly these two files, both inlined in full below:

1. \`${featurePath}\`: the Feature file (${nRules} Rules), ${first ? "as it stands." : "as it stands\n   after the change."}
2. \`${scenarioPath}\`: the one Test Scenario file you are judging.

Do not read any other file. Do not read the ${testSuite}. Do not read the tracker.

${FILES}${upstreamSection(upstream)}${boundariesSection(boundaries)}${CHANGE}=== THE VERDICTS ===

${VERDICTS}=== SCOPE: THE ONE THING THAT MATTERS MOST ===

Each Rule states its own subject. A Rule governs a case **only if the Rule's stated subject
covers the case's subject**. A Rule stated for every subtype governs every subtype.
A scope mismatch is Current, not a Conflict.

Raising a Conflict that turns out to be a scope mismatch buries the real findings. But do not
over-correct: if a case genuinely contradicts a Rule that genuinely governs it, say Conflict and
quote both sides. Silence is also a failure.

=== OUTPUT CONTRACT ===

Your final message must contain exactly one fenced \`json\` block and nothing else of substance.
The block is a single JSON object:

\`\`\`json
{
  "file": "${file}",
  "verdicts": [
    {"key": "DEMO-1", "verdict": "Current", "rules": [], "why": ""},
    {"key": "DEMO-2", "verdict": "Conflict", "rules": ["rule_abcd"],
     "why": "one sentence",
     "quote_case": "verbatim from the case",
     "quote_other": "verbatim from the Rule or the other case"}
  ],
  "overreaches": [
    {"case": "DEMO-1", "boundary": "boundary_abcd",
     "case_quote": "verbatim from the case",
     "boundary_quote": "verbatim from the Boundary statement",
     "crossing": "one sentence: what crosses"}
  ]
}
\`\`\`

You must return **one entry for every case key ${partial ? "listed here" : "in the file"}, and no others**. ${partial ? "This brief sends" : "This file contains"}
exactly ${keys.length} cases, and these are their keys:

${keys.join(", ")}

Returning fewer than ${keys.length} entries, or inventing a key not on that list, is a protocol
failure. \`why\` may be empty for Current. Quotes must be verbatim; do not paraphrase.

${context ? CONTEXT_CONTRACT : ""}\`overreaches\` is a list beside the verdicts: one entry per case that crosses a Boundary, and an
empty list when no case crosses one. Each entry names the case and the Boundary, quotes both word
for word, and says what crosses.
`;
}

// The context section: the cases of the Feature's other scenario files that collide with a case
// under judgement, each file's cases in a fence no line of them can close. They are read, never
// judged: the section says so and lists their Keys, so a Conflict can name one. "" when there is
// none. Exported so the brief can measure it against the cap before it is placed.
/**
 * @param {readonly JudgeContextFile[]} files
 * @returns {string}
 */
export function contextSection(files) {
  if (files.length === 0) return "";
  const keys = files.flatMap((f) => f.cases.map((c) => c.key));
  return `=== COLLIDING CASES OF OTHER FILES (CONTEXT ONLY) ===

Each case below sits in another Test Scenario file of this Feature and shares a governing Rule
with a case you are judging. They are context only: read them, and return no verdict for them.
Each is judged in the unit of its own file. The context cases are: ${keys.join(", ")}.

${files.map((f) => `\`${f.path}\`:\n\n${fenced(f.cases.map((c) => c.text).join("\n\n"), "markdown")}`).join("\n")}
`;
}

// What the brief says when the cap left the context out: how many cases, and what that costs the
// judge. "" when none were left out.
/**
 * @param {number} left
 * @returns {string}
 */
function contextLeftOut(left) {
  if (left === 0) return "";
  return `=== COLLIDING CASES OF OTHER FILES (LEFT OUT) ===

${left === 1 ? "A case" : `${left} cases`} of other Test Scenario files ${left === 1 ? "shares" : "share"} a governing Rule with a case you are judging, and
${left === 1 ? "was" : "were"} left out of this brief by its size cap. A Conflict between a case of this file and a case
of another file cannot be established here.

`;
}

// Current Upstream Rules are knowledge supplied with the two local files, qualified by Feature.
/**
 * @param {readonly UpstreamRule[]} rules
 * @returns {string}
 */
function upstreamSection(rules) {
  if (rules.length === 0) return "";
  return `## Upstream Rules

Judge every case against these current Upstream Rules too, including cases with \`covers: []\`.
Use qualified references in \`rules\` for Upstream Rules; local Rules stay unqualified.
History explains the change; quote only current text as a side of a Conflict.

${rules.map((rule) => `### ${rule.ref}\n\nVia: ${rule.via.join(", ")}\n\nCurrent:\n\n${fenced(rule.text, "markdown")}${rule.history === null ? "" : `\nHistory (at the Watermark, not a side of a Conflict):\n\n${fenced(rule.history || "(Rule not present at the Watermark.)", "markdown")}`}`).join("\n")}
`;
}

// The Feature's Boundaries in full, and what crossing one means: the behaviour a case checks, never
// a mention of it in passing.
/**
 * @param {readonly JudgeBoundary[]} boundaries
 * @returns {string}
 */
function boundariesSection(boundaries) {
  return `=== THE BOUNDARIES ===

${boundariesList(boundaries, "case")}

A Test Case that **checks** the behaviour a Boundary hands elsewhere **crosses** that Boundary.
Say so in \`overreaches\`, quoting the case and the Boundary word for word.

Only the behaviour a case checks counts. A case that merely mentions that behaviour, for example in
its setup or in a step that only arranges the state, does not cross the Boundary.

`;
}

// The change sentence when only the Feature file changed.
/**
 * @param {string} name
 * @returns {string}
 */
export function featureOnlySentence(name) {
  return `Since the Watermark, exactly one file changed: the Feature file \`${name}\`. No Test Scenario
file changed.`;
}

// The Feature-level judge brief: the Feature's Boundaries and the candidate Rules, and the reply
// the judge returns. The Feature-level unit is the first `/qa-impact` unit that is not a Test
// Scenario file: it judges the Feature's Rules against the Feature's Boundaries.
/**
 * @param {FeatureBriefOptions} options
 * @returns {string}
 */
export function featureBrief({ featurePath, boundaries, rules, testSuite }) {
  return `You are a change-impact judge for a QA knowledge layer. You are NOT a coding agent.
Change **nothing**. Write **no files**. Run **no commands**. Your entire output is one report.

=== WHAT YOU ARE JUDGING ===

A Feature holds Rules, each written as \`### rule_<key>: <statement>\`, and may hold
**Boundaries**, each written as \`### boundary_<key>: <statement>\` with an \`Owner:\` line naming
the Feature that owns that behaviour, or \`none\`.

You are judging the Rules below against the Boundaries below: a Rule that states behaviour a
Boundary hands elsewhere crosses that Boundary.

Everything you need is inlined below. Do not read any other file. Do not read the ${testSuite}. Do
not read the tracker.

=== THE BOUNDARIES ===

${boundariesList(boundaries, "Rule")}

=== THE CANDIDATE RULES ===

${rules.map((rule) => rule.text).join("\n\n")}

A Rule that **states** the behaviour a Boundary hands elsewhere **crosses** that Boundary. Say so
in \`overreaches\`, quoting the Rule and the Boundary word for word.

Only the behaviour a Rule states counts. A Rule that merely mentions that behaviour, for example in
its elaboration, does not cross the Boundary.

=== OUTPUT CONTRACT ===

Your final message must contain exactly one fenced \`json\` block and nothing else of substance.
The block is a single JSON object:

\`\`\`json
{
  "overreaches": [
    {"rule": "rule_abcd", "boundary": "boundary_abcd",
     "rule_quote": "verbatim from the Rule",
     "boundary_quote": "verbatim from the Boundary statement",
     "crossing": "one sentence: what crosses"}
  ]
}
\`\`\`

\`overreaches\` is a list: one entry per Rule that crosses a Boundary, and an empty list when no
Rule crosses one. Each entry names the Rule and the Boundary, quotes both word for word, and says
what crosses.

You must name only these Rules, and no others:

${rules.map((rule) => rule.key).join(", ")}
`;
}

// The Feature's Boundaries in full: what each one names and who owns it.
/**
 * @param {readonly JudgeBoundary[]} boundaries
 * @param {"case" | "Rule"} who
 * @returns {string}
 */
function boundariesList(boundaries, who) {
  if (boundaries.length === 0) {
    return `This Feature states no Boundary, so no ${who} crosses one.`;
  }
  return `These are the Feature's Boundaries. Each names a piece of behaviour this Feature does not own:
another Feature owns it, or \`none\` does.

${boundaries.map((b) => `- \`${b.key}\`: ${b.statement} (Owner: ${b.owner === null ? "none given" : b.owner})`).join("\n")}`;
}

// One inlined file: a labelled section holding its text in a fence no line of it can close.
/**
 * @param {string} label
 * @param {string} path
 * @param {string} text
 * @returns {string}
 */
function inlined(label, path, text) {
  return `=== ${label}: \`${path}\` ===\n\n${fenced(text, "markdown")}\n`;
}

// `text` in a fence one longer than the longest fence-like run of backticks at a line start.
/**
 * @param {string} text
 * @param {string} lang
 * @returns {string}
 */
export function fenced(text, lang) {
  const runs = text.match(/^ {0,3}`{3,}/gm) ?? [];
  const n = Math.max(3, ...runs.map((r) => r.trim().length)) + 1;
  const fence = "`".repeat(n);
  return `${fence}${lang}\n${text.replace(/\s+$/, "")}\n${fence}\n`;
}
