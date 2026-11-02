// @ts-check
// The design unit's brief text: the instructions a Delegate fills one
// Test Scenario file with, and the reply contract `check-reply design` holds it to. Unlike the judge
// prompt (lib/judge-prompt.mjs) this text was not measured, so it may be edited freely.
//
// The parts run from what every unit of a Run shares to what is this unit's own, so the shared part
// is one prefix a model can cache (nothing of the unit's own, not even its level, comes before the
// Feature): the instructions and the output contract, the project's
// vocabulary, the Conventions, the Feature, the Feature's scenario list, and last the one
// scenario to fill.
import { fenced } from "./judge-prompt.mjs";

/**
 * @param {readonly string[]} xs
 * @returns {string}
 */
const list = (xs) => (xs.length ? xs.map((x) => `\`${x}\``).join(", ") : "(none)");

/**
 * A Test Scenario summary in the brief.
 * @typedef {{
 *   key: string,
 *   summary: string,
 * }} BriefScenarioSummary
 */

/**
 * Mode of the design brief task.
 * @typedef {"fill" | "expand" | "regenerate"} DesignPromptMode
 */

/**
 * The unit's own scenario details for the brief.
 * @typedef {{
 *   key: string,
 *   summary: string,
 *   levels?: readonly string[],
 *   mode?: DesignPromptMode,
 *   kept?: readonly string[],
 * }} BriefScenarioUnit
 */

/**
 * Inputs to designBrief.
 * @typedef {{
 *   slug: string,
 *   feature: string,
 *   roles: readonly string[],
 *   levels: readonly string[],
 *   labels?: import("./case-labels.mjs").LabelDefinitions | null,
 *   conventions?: string | null,
 *   upstreamRules: readonly BriefUpstreamRules[],
 *   scenarios: readonly BriefScenarioSummary[],
 *   scenario: BriefScenarioUnit,
 *   agreement?: string | null,
 * }} DesignBriefOptions
 */

/**
 * The direct Upstream Rules carried by one local Rule.
 * @typedef {{
 *   rule: string,
 *   upstream: readonly { ref: string, statement: string, elaboration: string }[],
 * }} BriefUpstreamRules
 */

// `feature` is the Feature file's body as the brief carries it; `scenarios` every scenario of the
// Feature as `{key, summary}`; `scenario` this unit's `{key, summary, levels}` (the agreed levels); `conventions` the text of the train file's Conventions, or null when there are none
// and none are declared. Never a Practice: the brief prefix is the same for every unit, and Practices are the
// orchestrator's.
/**
 * @param {DesignBriefOptions} options
 * @returns {string}
 */
export function designBrief({ slug, feature, roles, levels, labels = null, conventions = null, upstreamRules, scenarios, scenario, agreement = null }) {
  const { mode = "fill", kept = [] } = scenario; // see TASK below
  const vocabulary = labelVocabulary(labels);
  return `You are filling one Test Scenario of the Feature \`${slug}\` with Test Cases. Everything you need
is in this brief. Open no file, fetch nothing, run nothing and write nothing: your reply is text, and
the orchestrator that sent you writes the file.

=== WHAT A TEST CASE IS HERE ===

The Feature below states its behaviour as Rules, each headed \`### rule_<key>: <statement>\`. A Rule's
statement carries its whole claim; any prose under it only clarifies. The Rules are the only claims
there are: a Test Case exercises one or more of them and claims nothing they do not state, because a
claim no Rule states can never be judged when the Feature changes.

A Rule followed by \`Waived: <reason>\` is Waived. Do not cover it in a Test Case: its Waiver deliberately
leaves it without a case. The Feature shows each Waived Rule's reason; quote that reason when noting
that the Rule is not to be covered.

A carried claim needs its own local Rule. Use the Upstream Rules below as context; a case covers only
Rules of this Feature, and an Upstream Rule never supplies a missing local claim.

${TASK[mode]}

Size each case as one manual pass: the claims a manual tester checks from one setup in one run of
steps are one case, a check that builds on an earlier step's outcome included. The case covers each
of their Rules and states every outcome in its Expected result. It takes the level the whole pass
runs at, and is \`automatable: false\` when any of its checks is (see below): claims that differ in
level or automatability still make one manual pass. A new case starts only where the tester needs a
new setup or a new run. A Convention that sets granularity overrides this rule.

Each Test Case has:

- \`summary\`: one line stating the behaviour the case's manual pass checks.
- \`covers\`: the keys of the Rules it exercises; at least one, and only keys of the Rules below.
- \`relies_on\`: optional; the Rules its setup rests on but it does not cover, as local keys or an
  Upstream Rule from the list below. Omit when empty.
- \`override_reason\`: optional; the orchestrator refuses a case that repeats a stored case or another
  scenario's on its Rules, preconditions, steps, Roles, level and Expected result. When yours is a
  distinct pass that still repeats them, state why in one sentence: it is shown to the engineer as a
  proposal and does not on its own get the case written. Omit otherwise.
- \`roles\`: only Roles that act in a Step, each listed once, from the roles below; an empty list
  when no Role acts. A Role needed only for setup belongs on its precondition, not in this list.
- \`level\`: required on every case; one of the scenario's wanted levels at the end of this brief.
${vocabulary === "" ? "" : LABEL_FIELDS}- \`automatable\`: \`true\` or \`false\`, always given; see below.
- \`preconditions\`: optional; states needed before the steps, as a string or list of non-empty
  strings. Omit when empty.
- \`steps\`: required in every mode; a non-empty list of non-empty strings, in order.
- \`expected\`: the Expected-result paragraph: the outcome a tester observes. Never empty.

State behaviour at intent level: what a user does and what the system does in response. Never write
selectors, element ids, URLs, endpoint paths, request or response payload shapes, or code. The test
code owns how a case runs; the case states what it checks.

When a good case would need a behaviour no Rule states (a boundary, a message, a permission, an
error), do not write that case. Put the behaviour in \`proposed_rules\` instead, as one sentence the
engineer can take to /qa-deep-dive, with why the scenario needs it.

A case is \`automatable: false\` when checking its Expected result needs any of:

- human judgement: a visual or subjective check;
- physical hardware;
- an irreversible effect on a third party;
- an integration the project's automation cannot reach, as the Conventions name it. For example,
  under a Convention that the automation has no database access, a case whose Expected result needs
  a direct database read is \`automatable: false\`. Where no Convention speaks to an integration, it
  is reachable.

Every other case is \`automatable: true\`. The engineer confirms the value when they review the case.

Write no key, \`sources\`, \`review\` or any other field: the orchestrator adds them.

=== WRITING FOR A TESTER ===

Write one action by one actor per step, in order, at intent level. Use a UI control's label only
when the Feature gives that label; otherwise name its intent. Use the Feature's own terms as its
Rules define them; explain shorthand or a term from outside the Feature.

With two or more Roles, open every step with \`As <Role>, \` naming a Role in \`roles\` exactly,
and give every listed Role a step. With one Role, leave that prefix out; with no Roles, name no
project Role as an actor. A precondition may open \`As <Role>, \` when the Feature's Rules require
that specific Role to own the data, including a setup Role outside \`roles\`.

Each precondition states a state, never how to make it. A transition a covered Rule claims is a
Step, never a precondition: otherwise a product Defect could appear as Blocked setup.

When a covered Rule claims a target-observable effect, state what the case's Roles observe in the
Expected result: "succeeds", "is rejected", or a status only when that exact code is the claim.
Keep internal side effects to those the Rule claims. When the Rule claims only an off-target
effect, state that claim and add a \`proposed_rule\` in \`proposed_rules\` if its observable
confirmation is unstated.

Baseline inputs stay abstract (for example, "valid loan details"); the Tester fills them from
trained data recipes. State the triggering input at the Rule's level: an exact value for a stated
boundary, a field condition such as "an empty title", or a relation to a precondition entity such
as "the same code as the existing active loan". Use literals only when the Rule states them;
put an unstated boundary in \`proposed_rules\`.

=== YOUR REPLY ===

Think as you need to, then end your reply with exactly one fenced json block, and nothing after it:

${fenced(`{"cases": [{"summary": "...", "covers": ["rule_..."], "relies_on": ["rule_..."], "roles": ["..."], "level": "...", "automatable": true, "preconditions": ["..."], "steps": ["..."], "expected": "..."}],
 "proposed_rules": [{"statement": "...", "why": "..."}]}`, "json")}
\`proposed_rules\` is an empty list when there is nothing to propose.

=== THE PROJECT'S VOCABULARY ===

- Roles: ${list(roles)}
- Levels: ${list(levels)}${vocabulary}
${conventions === null ? "" : `
=== THE CONVENTIONS ===

The house style for Test Cases. Conventions govern a case's form (phrasing, granularity, which
permutations to write) and never add a claim: a Convention that implies behaviour no Rule states is a
proposed Rule, not a case.

${fenced(conventions, "markdown")}`}
=== THE FEATURE ===

${fenced(feature, "markdown")}
=== UPSTREAM RULES ===

${upstreamRules.length ? upstreamRules.map(({ rule, upstream }) => `### Local Rule \`${rule}\`\n\n${upstream.map(({ ref, statement, elaboration }) => `- \`${ref}\`: ${statement}${elaboration ? `\n${elaboration}` : ""}`).join("\n\n")}`).join("\n\n") : "(none)"}
=== THE FEATURE'S TEST SCENARIOS ===

${scenarios.map((s) => `- \`${s.key}\`: ${s.summary}`).join("\n")}
${agreement === null ? "" : `\n${agreement}`}
=== THE SCENARIO TO ${mode.toUpperCase()} ===

\`${scenario.key}\`: ${scenario.summary}. Every case names its own \`level\`, chosen from the wanted levels: ${(scenario.levels ?? levels).map((level) => `\`${level}\``).join(", ")}. ${mode === "fill" ? "It has no Test Cases yet." : HAS[mode](kept)}
`;
}

// How a case names its labels, shown only when the project declares some.
const LABEL_FIELDS = `- labels: optional; \`tags\` (a list) and each Custom field under its own name, assigned only from
  the project's labels below. A label says how the case is used, never what it claims: leave one out
  whenever you are unsure, and invent no value.
`;

// The labels a filler may assign, one bullet each: only Tags that have a meaning, and each Custom
// field with its description and its active values. Empty when there is none.
/**
 * @param {import("./case-labels.mjs").LabelDefinitions | null} labels
 * @returns {string}
 */
function labelVocabulary(labels) {
  if (labels === null) return "";
  const tags = Object.entries(labels.tags).filter(([, meaning]) => meaning.trim() !== "");
  const fields = labels.customFields.filter((f) => f.values.length > 0);
  const rows = [
    ...(tags.length ? [`- Tags (\`tags\`; assign only these): ${tags.map(([tag, meaning]) => `\`${tag}\` (${meaning})`).join("; ")}`] : []),
    ...fields.map((f) => `- Custom field \`${f.name}\` (${f.multiple ? "a list of values" : "one value"}): ${f.description}. Allowed: ${list(f.values)}`),
  ];
  return rows.length ? `\n${rows.join("\n")}` : "";
}

// What the unit is asked to write, by mode. `scenario` may also carry the unit's `mode`
// (lib/design-unit.mjs; `fill` when absent) and `kept`, the Bookkeeping-stripped text of each case
// the file keeps (none on a fill). The scope sentence is shared.
const SCOPE = `its
summary is its scope, and the Feature's other scenarios, listed below, hold the rest.`;
/** @type {Record<DesignPromptMode, string>} */
const TASK = {
  fill: `Write the Test Cases that belong in the scenario named at the end of this brief, and only those: ${SCOPE} Cover every Rule
that falls in this scenario's scope, with as many cases as its behaviour needs (for example one per
role, or per boundary, that a Rule states).`,
  expand: `The scenario named at the end of this brief already has Test Cases, shown there. Propose extra cases
for it, and only those: ${SCOPE} An extra case checks a permutation of a Rule in scope that no
existing case checks: a boundary the Rule states, or a role it names that no case plays. Never
restate an existing case, and return an empty \`cases\` list when nothing is missing.`,
  regenerate: `The scenario named at the end of this brief is being regenerated: its earlier generated cases are
discarded, and the cases shown there are kept. Write the Test Cases the scenario needs beside the kept
ones, and only those: ${SCOPE} Cover every Rule in scope that the kept cases leave
uncovered, with as many cases as its behaviour needs (for example one per role, or per boundary, that
a Rule states), and never restate a kept case.`,
};

// The closing sentence of an expand or regenerate brief, with the cases the file keeps.
/**
 * @param {readonly string[]} entries
 * @returns {string}
 */
const cases = (entries) => entries.map((e) => fenced(e, "markdown")).join("\n");
/** @type {Record<"expand" | "regenerate", (kept: readonly string[]) => string>} */
const HAS = {
  expand: (kept) => `It has these Test Cases:\n\n${cases(kept)}`,
  regenerate: (kept) => (kept.length ? `It keeps these Test Cases:\n\n${cases(kept)}` : "It keeps no Test Case."),
};
