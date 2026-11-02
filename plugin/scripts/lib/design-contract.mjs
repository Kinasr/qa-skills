// @ts-check
// The Delegate's design contract (`check-reply design`): the last fenced `json` block
// holds `{cases: [{summary, covers, roles, level, automatable, preconditions?, steps, expected}], proposed_rules: [...]}`, and
// the reply is usable iff it parses and every case has
//   - a one-line, non-empty `summary` (it becomes the case's heading);
//   - non-empty `covers`, each key a Rule of the Feature;
//   - `roles` ⊆ `project.roles`;
//   - `level` ∈ `project.stack.levels` and the scenario's agreed levels, required on every case;
//   - a boolean `automatable`, the Delegate's proposal, in every mode;
//   - `steps`, a non-empty list of non-empty strings;
//   - a non-empty `expected`.
// A fill or a regenerate must return at least one case unless the reply proposes Rules instead; an
// expand may return none. A reply with zero cases, at least one valid proposed Rule and no other
// problem is the terminal outcome `awaiting_rules`: the Delegate found no Rule to write a case from,
// and its proposals go to `/qa-deep-dive`. Every other zero-case reply keeps its problems.
// A case may add `override_reason`, a string: the reason it is a distinct pass although it repeats
// a stored case or a sibling proposal. The contract only reads it; the writer shows it to the
// engineer as a proposal and does not let the case through on it (lib/design-duplicates.mjs).
// `proposed_rules` entries are a statement, or `{statement, why?}`; an absent list is empty. Fields
// the contract does not name (a key, `sources`) are dropped and listed: the orchestrator writes
// those. Every problem is reported, and there is no partial acceptance.
//
// The normalised design result (`cases`, `proposed_rules`) is this module's contract:
// `check-reply` returns it, and `design`, `design-write` and `contracts` read it. Its typedef is
// the owner; the serialised value a Run dir writer carries is a `DesignResult` value.

// A summary is one line (lib/dialect.mjs `LINE_BREAK`): none is allowed in it.
import { LINE_BREAK } from "./dialect.mjs";
import { stepActor, stripListMarker } from "./case-fields.mjs";
import { fillerLabels, labelKeys } from "./case-labels.mjs";
import { isRuleRef, parseRuleRef } from "./rule-ref.mjs";

// The brief of one design unit, as this contract reads it: a local input projection typed at
// check-reply's acceptance boundary, after the gates there (CODING_STANDARDS: trusted read
// boundary). Only the fields the contract consults are named; S-delegation retypes this to the
// design brief contract.
/**
 * @typedef {object} DesignBriefProjection
 * @property {"fill" | "expand" | "regenerate"} mode - the unit's mode
 * @property {string} [feature] - the Feature's key
 * @property {string} [scenario] - the unit's scenario key
 * @property {string[]} [wanted_levels] - the levels agreed for this scenario
 * @property {string[]} rules - the Feature's Rule keys
 * @property {string[]} waived_rules - Rule keys whose Waiver forbids coverage
 * @property {string[]} [relies_targets] - the qualified Upstream Rules a Reliance may name
 * @property {string[]} roles - `project.roles`
 * @property {string[]} levels - `project.stack.levels`
 * @property {import("./case-labels.mjs").LabelDefinitions} [labels] - the project's Tags and Custom
 *   fields; absent, a reply's labels are not read
 */

// One Test Case of a reply's `cases` list, with every field the contract names; a field the
// contract does not name is dropped and listed.
/**
 * @typedef {object} DesignReplyCase
 * @property {string} [summary]
 * @property {string[]} covers
 * @property {string[]} [relies_on]
 * @property {string} [override_reason]
 * @property {string[]} roles
 * @property {string} [level]
 * @property {boolean} automatable
 * @property {string | string[]} [preconditions]
 * @property {string[]} [steps]
 * @property {string} [expected]
 * @property {string[]} [tags] - Tags, each one the project declares with a meaning
 */

// One `proposed_rules` entry of a reply: a statement, or `{statement, why?}`.
/**
 * @typedef {object} DesignReplyProposed
 * @property {string} [statement]
 * @property {string} [why]
 */

/**
 * @typedef {object} DesignReply
 * @property {DesignReplyCase[]} cases
 * @property {(string | DesignReplyProposed)[]} [proposed_rules]
 */

// A contract problem: a code, one factual line, and the case's index when it is a case's problem.
/**
 * @typedef {object} DesignProblem
 * @property {string} code
 * @property {number} [case]
 * @property {string} message
 */

// One normalised Test Case, as a usable reply's `cases` travel on to the writer: a one-line
// `summary`, the Rule keys it covers, the step-actor Roles, the Level, whether the case is
// automatable, the optional Preconditions and Steps, and the Expected-result paragraph.
/**
 * @typedef {object} DesignCase
 * @property {string} summary
 * @property {string[]} covers
 * @property {string[]} [relies_on]
 * @property {string} [override_reason] - why the case is a distinct pass, when it repeats another: a
 *   proposal for the engineer (lib/design-duplicates.mjs); only a non-blank reason is kept
 * @property {string[]} roles
 * @property {string} level
 * @property {boolean} automatable
 * @property {string[]} [preconditions]
 * @property {string[]} [steps]
 * @property {string} expected
 * @property {string[]} [tags] - the Tags the reply assigned that the project lets a filler assign
 * @property {Record<string, string | string[]>} [custom] - the values of each Custom field the reply assigned
 */

/**
 * The case under normalisation (`expected`, `preconditions` and `steps` fill in last; a reply that
 * names none keeps them off).
 * @typedef {Omit<DesignCase, "expected" | "preconditions" | "steps"> & {expected?: string, preconditions?: string[], steps?: string[]}} DesignCaseDraft
 */

// One proposed Rule: a statement, and `why` when the reply gave one.
/**
 * @typedef {object} DesignProposedRule
 * @property {string} statement
 * @property {string} [why]
 */

// A label of a reply's case that was dropped: the case by its place in the reply (from 1), the
// field it was for, the value, and why.
/**
 * @typedef {import("./case-labels.mjs").DroppedLabel & { case: number }} DroppedCaseLabel
 */

// The normalised design result, and the contract's whole output: the reply problems and the
// accepted `cases` and `proposed_rules` are present only when the reply is usable.
/**
 * @typedef {object} DesignResult
 * @property {"design"} contract
 * @property {boolean} usable
 * @property {DesignProblem[]} problems
 * @property {string | null} feature
 * @property {string | null} scenario
 * @property {"fill" | "expand" | "regenerate"} mode
 * @property {"awaiting_rules" | null} outcome - the terminal proposal-only outcome, null otherwise
 * @property {number} rules_in
 * @property {number | null} cases_returned
 * @property {number | null} proposed_rules_count
 * @property {string[]} dropped_fields
 * @property {DroppedCaseLabel[]} dropped_labels - the labels of a usable reply dropped, never a
 *   reason to reject it
 * @property {DesignCase[] | null} cases
 * @property {DesignProposedRule[] | null} proposed_rules
 */

// `unit` is the JSON `brief design` printed (a {@link DesignBriefProjection}); `reply` the Delegate's
// reply bytes, trusted at this boundary and checked here; `lastJsonBlock` is check-reply's reader.
// Returns the normalised design result, a {@link DesignResult} value.
/**
 * @param {string} reply
 * @param {DesignBriefProjection} unit
 * @param {(reply: string) => import("./check-reply.mjs").LastJsonBlockResult} lastJsonBlock
 * @returns {DesignResult}
 */
export function design(reply, unit, lastJsonBlock) {
  const rules = new Set(unit.rules);
  const waivedRules = new Set(unit.waived_rules);
  const reliesTargets = new Set(unit.relies_targets ?? []);
  const roles = new Set(unit.roles);
  const levels = new Set(unit.levels);
  const labels = unit.labels ?? null;
  const labelKey = new Set(labels === null ? [] : labelKeys(labels));
  /**
   * @param {DesignProblem[]} problems
   * @param {{cases?: (DesignCase | null)[], proposed?: (DesignProposedRule | null)[], dropped?: string[], droppedLabels?: DroppedCaseLabel[]}} [parsed]
   * @returns {DesignResult}
   */
  const result = (problems, parsed = {}) => {
    const usable = problems.length === 0;
    return {
      contract: "design",
      usable,
      problems,
      feature: unit.feature ?? null,
      scenario: unit.scenario ?? null,
      mode: unit.mode,
      outcome: usable && parsed.cases?.length === 0 && (parsed.proposed?.length ?? 0) > 0 ? "awaiting_rules" : null,
      rules_in: unit.rules.length,
      cases_returned: parsed.cases?.length ?? null,
      proposed_rules_count: parsed.proposed?.length ?? null,
      dropped_fields: parsed.dropped ?? [],
      dropped_labels: parsed.droppedLabels ?? [],
      cases: usable ? /** @type {DesignCase[]} */ (parsed.cases) : null,
      proposed_rules: usable ? /** @type {DesignProposedRule[]} */ (parsed.proposed) : null,
    };
  };

  const found = lastJsonBlock(reply);
  if (found.problem) return result([found.problem]);
  // The reply JSON, typed as the shape the contract accepts at this boundary: the runtime checks
  // below enforce it, and the type is the trusted read, not a validation (CODING_STANDARDS).
  /** @type {DesignReply} */
  let data;
  try {
    data = JSON.parse(/** @type {string} */ (found.text));
  } catch (e) {
    return result([{ code: "unparseable", message: `the last \`json\` block does not parse: ${/** @type {Error} */ (e).message}` }]);
  }
  if (!isObject(data) || !Array.isArray(data.cases) || !(data.proposed_rules === undefined || Array.isArray(data.proposed_rules))) {
    return result([{ code: "bad_shape", message: "the last `json` block is not an object with a `cases` list and a `proposed_rules` list" }]);
  }

  /** @type {DesignProblem[]} */
  const problems = [];
  /** @type {Set<string>} */
  const dropped = new Set();
  /** @type {DroppedCaseLabel[]} */
  const droppedLabels = [];
  const cases = data.cases.map((c, i) => {
    /**
     * @param {string} code
     * @param {string} message
     */
    const bad = (code, message) => problems.push({ code, case: i, message: `case ${i + 1}: ${message}` });
    if (!isObject(c)) {
      bad("malformed_case", `not an object: ${JSON.stringify(c)}`);
      return null;
    }
    for (const k of Object.keys(c)) if (!FIELDS.includes(k) && !labelKey.has(k)) dropped.add(k);
    if (!text(c.summary) || LINE_BREAK.test(c.summary)) bad("bad_summary", "`summary` must be one non-empty line");
    if (!Array.isArray(c.covers) || c.covers.length === 0) bad("empty_covers", "`covers` must name at least one Rule");
    else for (const r of c.covers) {
      if (waivedRules.has(r)) bad("covers_waived_rule", `\`covers\` names ${JSON.stringify(r)}, a Waived Rule`);
      else if (!rules.has(r)) bad("unknown_rule", `\`covers\` names ${JSON.stringify(r)}, which is no Rule of the Feature`);
    }
    // Reliance names the Rules the setup rests on. It is optional, never satisfies `covers`, and
    // either names a local Rule or a qualified Upstream Rule the brief carries.
    /** @type {string[]} */
    const normalizedReliance = [];
    if (c.relies_on !== undefined) {
      if (!Array.isArray(c.relies_on)) bad("bad_relies_on", "`relies_on` must be a list of Rule references");
      else for (const r of c.relies_on) {
        if (typeof r !== "string" || !r.trim()) {
          bad("bad_relies_on", `\`relies_on\` entry ${JSON.stringify(r)} is not a Rule reference`);
          continue;
        }
        const text = r.trim();
        const ref = parseRuleRef(text);
        if (ref) {
          if (ref.feature === unit.feature) bad("bad_relies_on", `\`relies_on\` names ${JSON.stringify(text)} in its own Feature; write the local Rule key`);
          else if (unit.relies_targets !== undefined && !reliesTargets.has(text)) bad("unknown_reliance", `\`relies_on\` names ${JSON.stringify(text)}, which is no Upstream Rule in this brief`);
          else normalizedReliance.push(text);
        } else if (isRuleRef(text)) {
          if (!rules.has(text)) bad("unknown_reliance", `\`relies_on\` names ${JSON.stringify(text)}, which is no Rule of the Feature`);
          else normalizedReliance.push(text);
        } else bad("bad_relies_on", `\`relies_on\` entry ${JSON.stringify(text)} is not a Rule reference`);
      }
    }
    // An override reason states why a case that repeats another is a distinct pass. It is optional
    // and a blank one is none; the writer weighs it only when the case is a duplicate.
    /** @type {string | undefined} */
    let overrideReason;
    if (c.override_reason !== undefined && c.override_reason !== null) {
      if (typeof c.override_reason !== "string") bad("bad_override_reason", "`override_reason` must be a string stating why the case is a distinct pass");
      else if (text(c.override_reason)) overrideReason = c.override_reason.replace(/\s+/g, " ").trim();
    }
    if (!Array.isArray(c.roles)) bad("bad_roles", "`roles` must be a list, empty when no role matters");
    else {
      for (const r of c.roles) if (!roles.has(r)) bad("unknown_role", `role ${JSON.stringify(r)} is not in \`project.roles\``);
      if (new Set(c.roles).size !== c.roles.length) bad("duplicate_role", "`roles` must list each step actor only once");
    }
    const level = c.level;
    if (level === null || level === undefined) bad("no_level", "every Test Case names its own `level`");
    else if (!levels.has(level)) bad("unknown_level", `level ${JSON.stringify(level)} is not in \`project.stack.levels\``);
    else if (unit.wanted_levels && !unit.wanted_levels.includes(level)) bad("unagreed_level", `level ${JSON.stringify(level)} is not one of the agreed levels`);
    if (typeof c.automatable !== "boolean") bad("bad_automatable", "`automatable` must be `true` or `false`");
    const preconditions = typeof c.preconditions === "string" ? (text(c.preconditions) ? [c.preconditions] : []) : c.preconditions;
    /** @type {string[] | undefined} */
    let normalizedPreconditions;
    if (preconditions !== undefined) {
      if (!(Array.isArray(preconditions) && preconditions.every(text))) bad("bad_preconditions", "`preconditions` must be a string or a list of non-empty strings");
      else {
        normalizedPreconditions = preconditions.map(stripListMarker);
        for (const item of normalizedPreconditions) {
          const actor = stepActor(item, { precondition: true });
          if (actor !== null && !roles.has(actor)) bad("unknown_actor", `precondition actor ${JSON.stringify(actor)} is not in \`project.roles\``);
        }
      }
    }
    const steps = c.steps;
    if (steps === undefined || steps === null || (Array.isArray(steps) && !steps.length)) bad("empty_steps", "`steps` must contain at least one step");
    else if (!(Array.isArray(steps) && steps.every(text))) bad("bad_steps", "`steps` must be a list of non-empty strings");
    /** @type {string[] | undefined} */
    let normalizedSteps;
    if (Array.isArray(steps) && steps.every(text)) {
      normalizedSteps = steps.map(stripListMarker);
      if (Array.isArray(c.roles) && new Set(c.roles).size === c.roles.length && c.roles.every((r) => roles.has(r))) {
        const actors = new Set();
        normalizedSteps = normalizedSteps.map((step) => {
          const actor = stepActor(step);
          if (c.roles.length >= 2) {
            if (!c.roles.includes(/** @type {string} */ (actor))) bad("unknown_actor", "each step must open with `As <Role>, ` naming one of `roles`");
            else actors.add(actor);
          } else if (c.roles.length === 1 && actor) {
            if (actor !== c.roles[0]) bad("unknown_actor", `step actor ${JSON.stringify(actor)} is not in \`roles\``);
            else return step.slice(step.indexOf(",") + 1).trimStart();
          } else if (c.roles.length === 0 && roles.has(/** @type {string} */ (actor))) bad("unknown_actor", `step actor ${JSON.stringify(actor)} is not in \`roles\``);
          return step;
        });
        if (c.roles.length >= 2 && c.roles.some((r) => !actors.has(r))) bad("unused_role", "`roles` must contain only Roles that act in a step");
      }
    }
    if (!text(c.expected)) bad("empty_expected", "`expected` must be a non-empty Expected-result paragraph");
    /** @type {DesignCaseDraft} */
    const out = { summary: String(c.summary ?? "").trim(), covers: c.covers, roles: c.roles, level: /** @type {string} */ (level), automatable: c.automatable };
    if (normalizedReliance.length) out.relies_on = [...new Set(normalizedReliance)];
    if (overrideReason !== undefined) out.override_reason = overrideReason;
    if (normalizedPreconditions?.length) out.preconditions = normalizedPreconditions;
    if (normalizedSteps?.length) out.steps = normalizedSteps;
    out.expected = String(c.expected ?? "").trim();
    if (labels !== null) {
      // Labels are checked apart from the claim: a bad one is dropped and reported.
      const read = fillerLabels(/** @type {Record<string, unknown>} */ (c), labels);
      droppedLabels.push(...read.dropped.map((d) => ({ case: i + 1, ...d })));
      if (read.labels.tags.length) out.tags = read.labels.tags;
      if (Object.keys(read.labels.values).length) out.custom = read.labels.values;
    }
    return /** @type {DesignCase} */ (out);
  });
  // A proposal-only reply (zero cases, at least one valid proposed Rule, and no other problem) is the
  // terminal `awaiting_rules` outcome: the proposals go to /qa-deep-dive and no case is written. Any
  // other zero-case reply keeps today's problems: an expand may find nothing missing, and a fill or a
  // regenerate that returns nothing fills or regenerates nothing.
  /** @type {DesignProblem[]} */
  const proposedProblems = [];
  const proposed = (data.proposed_rules ?? []).map((p, i) => {
    if (text(p)) return { statement: p.trim() };
    if (isObject(p) && text(p.statement)) return { statement: p.statement.trim(), ...(text(p.why) ? { why: p.why.trim() } : {}) };
    proposedProblems.push({ code: "bad_proposed_rule", message: `proposed Rule ${i + 1} is neither a statement nor \`{statement, why}\`: ${JSON.stringify(p)}` });
    return null;
  });
  const proposalOnly = cases.length === 0 && problems.length === 0 && proposedProblems.length === 0 && proposed.length > 0;
  if (!proposalOnly && unit.mode !== "expand" && cases.length === 0) problems.push({ code: "no_cases", message: `the reply returns no Test Case, so it ${unit.mode === "fill" ? "fills" : "regenerates"} nothing` });
  problems.push(...proposedProblems);
  return result(problems, { cases, proposed, dropped: [...dropped], droppedLabels });
}

/** @type {string[]} */
const FIELDS = ["summary", "covers", "relies_on", "override_reason", "roles", "level", "automatable", "preconditions", "steps", "expected"];

/**
 * A non-array object: every case and proposed Rule the reply reads is one after this check.
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * One non-empty trimmed string: what a summary, a preconditions item, a step and an expected
 * paragraph must be.
 * @param {unknown} v
 * @returns {v is string}
 */
const text = (v) => typeof v === "string" && v.trim() !== "";
