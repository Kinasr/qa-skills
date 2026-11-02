// @ts-check
// `check-reply`: whether one Delegate reply is usable against the brief the orchestrator built.
// A Delegate returns text and the orchestrator
// writes (ADR-0010), so this is the gate between the two. Two contracts: judge, below, and
// design, in lib/design-contract.mjs.
//
// Judge contract (`/qa-impact`): the last fenced `json` block parses to
// `{file, verdicts: [{key, verdict, rules, why, quote_case?, quote_other?}],
//   overreaches: [{case, boundary, case_quote, boundary_quote, crossing}]}`, and the reply is
// usable iff
//   - every case key sent appears exactly once;
//   - every verdict is Conflict | Current (a Stale is the Scan's, never a verdict: ADR-0043);
//   - every Conflict carries both quotes, non-empty;
//   - a qualified Rule side names an Upstream Rule sent, quoting its current text, never history;
//   - a Conflict's `quote_case` is verbatim in its case, every local Rule it names is the
//     Feature's, and its `quote_other` is verbatim in a side it names (or another case of the
//     unit), and is never an Upstream Rule's Watermark-time text. A side it names may be a context
//     case, a colliding case of another scenario file the brief carries read-only (`context_text`):
//     it is a side only when named, and never has a verdict of its own (an unknown key, below);
//   - every Overreach names a case sent and a Boundary of the Feature, quotes both word for word,
//     and names no pair twice.
// Extra keys are dropped and counted. There is no partial acceptance: an unusable reply yields no
// verdicts at all. Every problem is reported, not just the first. `file` and `why`
// decide nothing: the unit, not the reply, says which file was judged, and an accepted verdict's
// `rules` and `why` are normalised (a list of local or qualified Rule references, a string) for
// the writer.
//
// The normalised judge result (`verdicts`, `overreaches`) is this module's contract:
// `impact`, `contracts` and `impact-persist` read it, and each verdict a writer carries is a
// `JudgeVerdict` value.

import { readFileSync } from "node:fs";
import { orThrow, UsageError } from "./cli.mjs";
import { design } from "./design-contract.mjs";
import { isQualifiedRuleRef, isRuleRef } from "./rule-ref.mjs";
import { holdsQuote } from "./schema.mjs";

/** @import {DesignBriefProjection, DesignResult} from "./design-contract.mjs" */
/** @import {JudgeBrief} from "./impact.mjs" */
/** @import {DesignBrief} from "./design-unit.mjs" */
/** @import {UpstreamRule} from "./brief.mjs" */

const VERDICTS = ["Conflict", "Current"];

// The subject a judge unit judges, and the fields its Overreach entries name: a Test Case in a
// scenario unit, a Rule in the Feature-level one.
/** @type {Record<"case" | "rule", {key: string, quote: string}>} */
const SUBJECT = { case: { key: "case", quote: "case_quote" }, rule: { key: "rule", quote: "rule_quote" } };

// The brief of one judge unit, as this contract reads it: a local input projection typed at the
// acceptance boundary, after the gates below (CODING_STANDARDS: trusted read boundary). Only the
// fields the contract consults are named; S-delegation retypes this to the judge brief contract.
/**
 * @typedef {object} JudgeBriefProjection
 * @property {boolean} first_judgement - true on a first judgement, where nothing has changed yet
 * @property {string[]} keys - the case keys sent for judgement
 * @property {string} [feature] - the Feature's key
 * @property {string} [scenario] - the unit's scenario key
 * @property {"scenario" | "feature"} [kind] - what the unit judges; a Feature-level unit judges Rules
 * @property {readonly {key: string, statement: string}[]} [boundaries] - the Feature's Boundaries
 * @property {Record<string, string>} [case_text] - each case's text, as the judge sees it
 * @property {Record<string, string>} [context_text] - each context case's text, as the judge sees it
 * @property {Record<string, string>} [rule_text] - each Rule the unit shows, as the judge sees it
 * @property {UpstreamRule[]} [upstream_rules] - current text and separately labelled history
 */

// The brief both contracts first accept, before either branch's gates: every field the gates read
// is `unknown` until its check approves it, so each branch's cast names what was checked.
/**
 * @typedef {object} BriefUnit
 * @property {unknown} [unit] - `design` or `judge` in the JSON `brief` printed
 * @property {unknown} [first_judgement] - judge brief
 * @property {unknown} [keys] - judge brief
 * @property {unknown} [kind] - judge brief
 * @property {unknown} [mode] - design brief
 * @property {unknown} [level] - design brief
 * @property {unknown} [rules] - design brief
 * @property {unknown} [roles] - design brief
 * @property {unknown} [levels] - design brief
 * @property {unknown} [feature] - either brief
 * @property {unknown} [scenario] - either brief
 * @property {unknown} [boundaries] - judge brief
 * @property {unknown} [case_text] - judge brief
 * @property {unknown} [context_text] - judge brief
 * @property {unknown} [rule_text] - judge brief
 * @property {unknown} [upstream_rules] - judge brief
 */

// A contract problem: a code, one factual line, and the case key when it is a verdict's problem.
/**
 * @typedef {object} JudgeProblem
 * @property {string} code
 * @property {string} [key]
 * @property {string} message
 */

// One verdict of a reply, as the judge contract reads it: `rules`, `why` and the quotes are
// accepted as given, checked only where the contract gates them.
/**
 * @typedef {object} JudgeReplyEntry
 * @property {string} key
 * @property {"Conflict" | "Current"} verdict
 * @property {string[]} [rules]
 * @property {string} [why]
 * @property {string} [quote_case]
 * @property {string} [quote_other]
 */

/**
 * @typedef {object} JudgeReply
 * @property {string} [file]
 * @property {JudgeReplyEntry[]} verdicts
 * @property {unknown} [overreaches]
 */

/**
 * The Feature-level unit's reply: an `overreaches` list and no verdict at all (ADR-0039).
 * @typedef {object} JudgeFeatureReply
 * @property {string} [file]
 * @property {unknown} [overreaches]
 */

// One accepted verdict, as the normalised judge result carries it: a list of Rule keys, a `why`
// string, and the two quotes a Conflict made.
/**
 * @typedef {object} JudgeVerdict
 * @property {string} key
 * @property {"Conflict" | "Current"} verdict
 * @property {string[]} rules
 * @property {string} why
 * @property {string} [quote_case]
 * @property {string} [quote_other]
 */

// One Overreach the judge reported, as the contract normalises it: the subject it is about (a
// Test Case in a scenario unit, a Rule in the Feature-level one), the Boundary it crosses, a quote
// from each side, and what crosses.
/**
 * @typedef {object} JudgeOverreach
 * @property {string} subject
 * @property {string} boundary
 * @property {string} subject_quote
 * @property {string} boundary_quote
 * @property {string} crossing
 */

// What the reply's Overreach entries may name: the kind of subject, the keys sent, their texts,
// and the Feature's Boundaries.
/**
 * @typedef {object} OverreachScope
 * @property {"case" | "rule"} subject - what the unit judges
 * @property {readonly string[]} keys - the subjects sent for judgement
 * @property {Readonly<Record<string, string>>} texts - each subject's text, as the judge sees it
 * @property {readonly {key: string, statement: string}[]} boundaries - the Feature's Boundaries
 */

/**
 * @typedef {object} JudgeResult
 * @property {"judge"} contract
 * @property {boolean} usable
 * @property {JudgeProblem[]} problems
 * @property {string | null} feature
 * @property {string | null} scenario
 * @property {boolean} first_judgement
 * @property {string | null} file
 * @property {number} cases_total
 * @property {number} cases_evaluated
 * @property {number} unknown_keys
 * @property {string[]} unknown
 * @property {{conflict: number} | null} findings
 * @property {JudgeVerdict[] | null} verdicts
 * @property {JudgeOverreach[] | null} overreaches
 */

// The check-reply call's usage error: the brief is stale, no brief, or no contract at all.
/**
 * @typedef {object} CheckReplyError
 * @property {string} error
 */

/**
 * @typedef {JudgeResult | DesignResult | CheckReplyError} CheckReplyResult
 */

/**
 * A result a writer can consume, after `orThrow` has thrown the usage error away.
 * @typedef {Exclude<CheckReplyResult, CheckReplyError>} AcceptedResult
 */

// What the reply's reader finds: the contents of the last fenced `json` block, or a problem with
// the reply itself. One of the two, never both; flattened so a reader's own checks stay untouched.
/**
 * @typedef {object} LastJsonBlockResult
 * @property {string} [text] - the contents of the last fenced `json` block, when the reply has one and it is closed
 * @property {boolean} [closed] - whether the block was closed
 * @property {{code: string, message: string}} [problem] - set when the reply has no `json` block, or its last one is never closed
 */

// `contract` is judge or design; `reply` the Delegate's reply bytes, trusted at the boundary
// (`lastJsonBlock` finds them, the contract checks them); `unit` the JSON `brief` printed for this
// unit. Returns the normalised result, or `{error}` for a usage error.
/**
 * @param {string | undefined} contract
 * @param {string} reply
 * @param {BriefUnit} unit
 * @returns {CheckReplyResult}
 */
export function checkReply(contract, reply, unit) {
  if (contract === "design") {
    if (unit?.unit !== "design" || !Array.isArray(unit.rules) || !Array.isArray(unit.roles) || !Array.isArray(unit.levels)) {
      return { error: "--brief must be the JSON `brief design` printed for this unit" };
    }
    return design(reply, /** @type {DesignBriefProjection} */ (unit), lastJsonBlock);
  }
  if (contract !== "judge") return { error: `check-reply takes a contract: judge, design (got \`${contract ?? ""}\`)` };
  if (unit?.unit !== "judge" || !Array.isArray(unit.keys) || typeof unit.first_judgement !== "boolean") {
    return { error: "--brief must be the JSON `brief judge` printed for this unit" };
  }
  return judge(reply, /** @type {JudgeBriefProjection} */ (unit));
}

/**
 * @param {string} reply
 * @param {JudgeBriefProjection} unit
 * @returns {JudgeResult}
 */
function judge(reply, unit) {
  // The Feature-level unit (ADR-0039) judges Rules, not cases: it returns no verdict at all, only
  // the Overreaches its Rules raise.
  if (unit.kind === "feature") return judgeFeature(reply, unit);
  const sent = unit.keys;
  /**
   * @param {JudgeProblem[]} problems
   * @param {{file?: string | null, unknown?: string[], verdicts?: JudgeVerdict[], overreaches?: JudgeOverreach[]}} [parsed]
   * @returns {JudgeResult}
   */
  const result = (problems, parsed = {}) => {
    const usable = problems.length === 0;
    return {
      contract: "judge",
      usable,
      problems,
      feature: unit.feature ?? null,
      scenario: unit.scenario ?? null,
      first_judgement: unit.first_judgement,
      file: parsed.file ?? null,
      cases_total: sent.length,
      cases_evaluated: usable ? sent.length : 0,
      unknown_keys: parsed.unknown?.length ?? 0,
      unknown: parsed.unknown ?? [],
      findings: usable ? { conflict: count(/** @type {JudgeVerdict[]} */ (parsed.verdicts), "Conflict") } : null,
      verdicts: usable ? /** @type {JudgeVerdict[]} */ (parsed.verdicts) : null,
      overreaches: usable ? /** @type {JudgeOverreach[]} */ (parsed.overreaches) : null,
    };
  };

  const found = lastJsonBlock(reply);
  if (found.problem) return result([found.problem]);
  // The reply JSON, typed as the shape the contract accepts at this boundary: the runtime checks
  // below enforce it, and the type is the trusted read, not a validation (CODING_STANDARDS).
  /** @type {JudgeReply} */
  let data;
  try {
    data = JSON.parse(/** @type {string} */ (found.text));
  } catch (e) {
    return result([{ code: "unparseable", message: `the last \`json\` block does not parse: ${/** @type {Error} */ (e).message}` }]);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.verdicts)) {
    return result([{ code: "bad_shape", message: "the last `json` block is not an object with a `verdicts` list" }]);
  }

  /** @type {JudgeProblem[]} */
  const problems = [];
  const wanted = new Set(sent);
  const seen = new Map();
  const unknown = [];
  for (const v of data.verdicts) {
    if (v === null || typeof v !== "object" || Array.isArray(v) || typeof v.key !== "string") {
      problems.push({ code: "malformed_entry", message: `a verdict is not an object with a string \`key\`: ${JSON.stringify(v)}` });
      continue;
    }
    if (!wanted.has(v.key)) {
      unknown.push(v.key);
      continue;
    }
    if (seen.has(v.key)) {
      if (seen.get(v.key) === 1) problems.push({ code: "duplicate_key", key: v.key, message: `\`${v.key}\` has more than one verdict` });
      seen.set(v.key, seen.get(v.key) + 1);
    } else {
      seen.set(v.key, 1);
    }
    if (!VERDICTS.includes(v.verdict)) {
      problems.push({ code: "bad_verdict", key: v.key, message: `\`${v.key}\`'s verdict ${JSON.stringify(v.verdict)} is not one of ${VERDICTS.join(", ")}` });
    } else if (v.verdict === "Conflict" && !(quoted(v.quote_case) && quoted(v.quote_other))) {
      problems.push({ code: "conflict_without_quotes", key: v.key, message: `\`${v.key}\` is a Conflict without both \`quote_case\` and \`quote_other\`, non-empty` });
    } else if (v.verdict === "Conflict") {
      const quote = /** @type {string} */ (v.quote_other);
      // The quote may not be an Upstream Rule's history: history explains a change, and is never a
      // side of a Conflict.
      const history = (unit.upstream_rules ?? []).find((r) => r.history !== null && holdsQuote(r.history, quote));
      const fromHistory = history !== undefined && !currentTexts(unit).some((text) => holdsQuote(text, quote));
      if (history && fromHistory) {
        problems.push({ code: "quote_from_history", key: v.key, message: `the Conflict's \`quote_other\` is the Watermark-time text of \`${history.ref}\`, and history is never a side of a Conflict` });
      }
      problems.push(...conflictSideProblems(v, quote, unit, fromHistory));
    }
  }
  for (const key of sent) if (!seen.has(key)) problems.push({ code: "missing_key", key, message: `\`${key}\` has no verdict` });

  // The Overreaches (ADR-0039): a list beside the verdicts, so a case can have both.
  const over = overreachProblems(data.overreaches, {
    subject: "case",
    keys: sent,
    texts: unit.case_text ?? {},
    boundaries: unit.boundaries ?? [],
  });
  problems.push(...over.problems);

  if (problems.length) return result(problems, { unknown });
  const byKey = new Map(data.verdicts.filter((v) => wanted.has(v.key)).map((v) => [v.key, v]));
  return result([], { file: typeof data.file === "string" ? data.file : null, unknown, verdicts: sent.map((key) => entry(/** @type {JudgeReplyEntry} */ (byKey.get(key)))), overreaches: over.overreaches });
}

// The texts the judge was sent, as the sides a Conflict may quote: the Feature's Rules, the
// scenario's cases, the context cases, and the current text of every Upstream Rule. An Upstream
// Rule's history is none of them: it explains a change, and is never a side of a Conflict.
/**
 * @param {JudgeBriefProjection} unit
 * @returns {string[]}
 */
function currentTexts(unit) {
  return [
    ...Object.values(unit.rule_text ?? {}),
    ...Object.values(unit.case_text ?? {}),
    ...Object.values(unit.context_text ?? {}),
    ...(unit.upstream_rules ?? []).map((r) => r.text),
  ];
}

// The sides a Conflict names, and its two quotes. `quote_case` is verbatim in the case judged.
// A qualified reference names an Upstream Rule, whose current text is a side; a local Rule names
// one of the Feature's own Rules, which the unit must carry; a case key names another case of the
// unit, or a context case of another file. `quote_other` is verbatim in a side it names, or in
// another case of the unit (the writer infers a case-against-case Conflict from the quote:
// lib/impact-persist.mjs `otherCases`); a context case is a side only when named, since the writer
// reads no side of another file from a quote. A Conflict naming no side may quote any current text
// the unit carries but the case's own and the context's. Verbatim ignores how whitespace wraps,
// since a quote may join a wrapped line.
/**
 * @param {JudgeReplyEntry} v
 * @param {string} quote
 * @param {JudgeBriefProjection} unit
 * @param {boolean} fromHistory - `quote_other` is history, already refused as such: only an Upstream side is still held to it
 * @returns {JudgeProblem[]}
 */
function conflictSideProblems(v, quote, unit, fromHistory) {
  /** @type {JudgeProblem[]} */
  const problems = [];
  const cases = unit.case_text ?? {};
  const own = Object.hasOwn(cases, v.key) ? cases[v.key] : undefined;
  if (unit.case_text && !(typeof own === "string" && holdsQuote(own, /** @type {string} */ (v.quote_case)))) {
    problems.push({ code: "case_quote_not_verbatim", key: v.key, message: `the Conflict's \`quote_case\` is not verbatim in \`${v.key}\`` });
  }
  const sides = Array.isArray(v.rules) ? v.rules.filter((r) => typeof r === "string") : [];
  const qualified = sides.filter(isQualifiedRuleRef);
  /** @type {string[]} */
  const texts = [];
  for (const ref of qualified) {
    const upstream = (unit.upstream_rules ?? []).find((r) => r.ref === ref);
    if (!upstream) problems.push({ code: "unknown_upstream_rule", key: v.key, message: `\`${ref}\` is not an Upstream Rule of this unit` });
    else texts.push(upstream.text);
  }
  for (const ref of sides.filter((r) => isRuleRef(r) && !isQualifiedRuleRef(r))) {
    const text = unit.rule_text && Object.hasOwn(unit.rule_text, ref) ? unit.rule_text[ref] : undefined;
    if (typeof text === "string") texts.push(text);
    else if (unit.rule_text) problems.push({ code: "unknown_conflict_rule", key: v.key, message: `\`${ref}\` is not a Rule of this Feature` });
  }
  const others = Object.entries(cases).filter(([key]) => key !== v.key).map(([, text]) => text);
  for (const ref of sides) if (ref !== v.key && Object.hasOwn(cases, ref)) texts.push(cases[ref]);
  const context = unit.context_text ?? {};
  for (const ref of sides) if (Object.hasOwn(context, ref)) texts.push(context[ref]);
  if (qualified.length && texts.length === qualified.length && sides.length === qualified.length) {
    // Every side named is an Upstream Rule: the quote is held to their current text alone.
    if (!texts.some((text) => holdsQuote(text, quote))) {
      problems.push({ code: "upstream_quote_not_verbatim", key: v.key, message: `the Conflict's \`quote_other\` is not verbatim in the current text of ${qualified.map((ref) => `\`${ref}\``).join(", ")}` });
    }
    return problems;
  }
  if (fromHistory) return problems;
  const pool = texts.length ? [...texts, ...others] : [...Object.values(unit.rule_text ?? {}), ...others, ...(unit.upstream_rules ?? []).map((r) => r.text)];
  if (!pool.some((text) => holdsQuote(text, quote))) {
    problems.push({ code: "other_quote_not_verbatim", key: v.key, message: `the Conflict's \`quote_other\` is not verbatim in ${texts.length ? "a side it names or another case of this unit" : "any Rule or other case this unit carries"}` });
  }
  return problems;
}

// The Feature-level unit's reply (ADR-0039): an `overreaches` list and no verdict at all. Each
// entry names a Rule the judge was sent and a Boundary of the Feature, quotes both word for word,
// and says what crosses. Every problem is reported, not just the first.
/**
 * @param {string} reply
 * @param {JudgeBriefProjection} unit
 * @returns {JudgeResult}
 */
function judgeFeature(reply, unit) {
  const sent = unit.keys;
  /**
   * @param {JudgeProblem[]} problems
   * @param {{file?: string | null, overreaches?: JudgeOverreach[]}} [parsed]
   * @returns {JudgeResult}
   */
  const result = (problems, parsed = {}) => {
    const usable = problems.length === 0;
    return {
      contract: "judge",
      usable,
      problems,
      feature: unit.feature ?? null,
      scenario: null,
      first_judgement: unit.first_judgement,
      file: parsed.file ?? null,
      cases_total: 0,
      cases_evaluated: 0,
      unknown_keys: 0,
      unknown: [],
      findings: usable ? { conflict: 0 } : null,
      verdicts: usable ? [] : null,
      overreaches: usable ? parsed.overreaches ?? [] : null,
    };
  };

  const found = lastJsonBlock(reply);
  if (found.problem) return result([found.problem]);
  /** @type {JudgeFeatureReply} */
  let data;
  try {
    data = JSON.parse(/** @type {string} */ (found.text));
  } catch (e) {
    return result([{ code: "unparseable", message: `the last \`json\` block does not parse: ${/** @type {Error} */ (e).message}` }]);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return result([{ code: "bad_shape", message: "the last `json` block is not an object" }]);
  }

  const over = overreachProblems(data.overreaches, {
    subject: "rule",
    keys: sent,
    texts: unit.rule_text ?? {},
    boundaries: unit.boundaries ?? [],
  });
  if (over.problems.length) return result(over.problems);
  return result([], { file: typeof data.file === "string" ? data.file : null, overreaches: over.overreaches });
}

// The reply's `overreaches` list: every problem with it, and the entries it holds. An entry names
// the subject it is about and the Boundary it crosses, quotes both word for word, and says what
// crosses. Every problem is reported, not just the first.
/**
 * @param {unknown} list
 * @param {OverreachScope} scope
 * @returns {{problems: JudgeProblem[], overreaches: JudgeOverreach[]}}
 */
export function overreachProblems(list, scope) {
  /** @type {JudgeProblem[]} */
  const problems = [];
  /** @type {JudgeOverreach[]} */
  const overreaches = [];
  if (list === undefined) return { problems, overreaches };
  if (!Array.isArray(list)) return { problems: [{ code: "bad_shape", message: "the last `json` block's `overreaches` is not a list" }], overreaches };
  const field = SUBJECT[scope.subject];
  const sent = new Set(scope.keys);
  const boundaries = new Map(scope.boundaries.map((b) => [b.key, b.statement]));
  const pairs = new Set();
  for (const x of list) {
    if (x === null || typeof x !== "object" || Array.isArray(x)) {
      problems.push({ code: "malformed_overreach", message: `an Overreach is not an object: ${JSON.stringify(x)}` });
      continue;
    }
    const entry = /** @type {Record<string, unknown>} */ (x);
    const subject = entry[field.key];
    const boundary = entry.boundary;
    const quote = entry[field.quote];
    const boundaryQuote = entry.boundary_quote;
    const crossing = entry.crossing;
    if (typeof subject !== "string" || typeof boundary !== "string" || typeof quote !== "string" || typeof boundaryQuote !== "string" || typeof crossing !== "string") {
      problems.push({ code: "malformed_overreach", message: `an Overreach is not an entry with \`${field.key}\`, \`boundary\`, \`${field.quote}\`, \`boundary_quote\` and \`crossing\`: ${JSON.stringify(x)}` });
      continue;
    }
    if (!sent.has(subject)) problems.push({ code: `unknown_${scope.subject}`, key: subject, message: `\`${subject}\` is not a ${scope.subject} of this unit` });
    if (!boundaries.has(boundary)) problems.push({ code: "unknown_boundary", key: subject, message: `\`${boundary}\` is not a Boundary of this Feature` });
    if (!quoted(quote) || !quoted(boundaryQuote)) {
      problems.push({ code: "overreach_without_quotes", key: subject, message: `the Overreach on \`${subject}\` has no \`${field.quote}\` or no \`boundary_quote\`, non-empty` });
    } else {
      if (sent.has(subject)) {
        const text = scope.texts[subject];
        if (typeof text !== "string") problems.push({ code: "quote_not_verbatim", key: subject, message: `the brief holds no text of \`${subject}\` to quote` });
        else if (!text.includes(quote)) problems.push({ code: "quote_not_verbatim", key: subject, message: `the Overreach's \`${field.quote}\` is not verbatim in \`${subject}\`` });
      }
      const statement = boundaries.get(boundary);
      if (statement !== undefined && !statement.includes(boundaryQuote)) problems.push({ code: "boundary_quote_not_verbatim", key: subject, message: `the Overreach's \`boundary_quote\` is not verbatim in \`${boundary}\`` });
    }
    if (!quoted(crossing)) problems.push({ code: "malformed_overreach", key: subject, message: `the Overreach on \`${subject}\` says nothing about what crosses` });
    const pair = `${subject}\0${boundary}`;
    if (pairs.has(pair)) problems.push({ code: "duplicate_overreach", key: subject, message: `\`${subject}\` crosses \`${boundary}\` more than once` });
    pairs.add(pair);
    overreaches.push({ subject, boundary, subject_quote: quote, boundary_quote: boundaryQuote, crossing });
  }
  return { problems, overreaches };
}

/**
 * A non-empty trimmed string: what a quote must be.
 * @param {unknown} q
 * @returns {q is string}
 */
const quoted = (q) => typeof q === "string" && q.trim() !== "";

/**
 * @param {JudgeVerdict[]} verdicts
 * @param {"Conflict"} kind
 * @returns {number}
 */
const count = (verdicts, kind) => verdicts.filter((v) => v.verdict === kind).length;

// One accepted verdict, in the contract's shape.
/**
 * @param {JudgeReplyEntry} v
 * @returns {JudgeVerdict}
 */
function entry(v) {
  const rules = Array.isArray(v.rules) ? v.rules.filter((r) => typeof r === "string") : [];
  /** @type {JudgeVerdict} */
  const out = { key: v.key, verdict: v.verdict, rules, why: typeof v.why === "string" ? v.why : "" };
  if (v.quote_case !== undefined) out.quote_case = v.quote_case;
  if (v.quote_other !== undefined) out.quote_other = v.quote_other;
  return out;
}

// The contents of the reply's last fenced `json` block. A block opened and never closed is a
// truncated reply, even when a complete block precedes it. Not `markdown.mjs`'s `splitFile`: a
// reply is not a `.qa/` file, so a leading `---` is not frontmatter, and a model may indent a fence.
/**
 * @param {string} reply
 * @returns {LastJsonBlockResult}
 */
export function lastJsonBlock(reply) {
  const lines = reply.replace(/\r\n/g, "\n").split("\n");
  /** @type {{text: string, closed: boolean} | null} */
  let last = null;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`~]*)\s*$/);
    if (!open) continue;
    const fence = open[1];
    const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    if (open[2].toLowerCase() === "json") last = { text: lines.slice(i + 1, j).join("\n"), closed: j < lines.length };
    i = j;
  }
  if (!last) return { problem: { code: "no_json_block", message: "the reply has no fenced `json` block" } };
  if (!last.closed) return { problem: { code: "truncated", message: "the last `json` block is never closed: the reply was cut off" } };
  return { text: last.text };
}

// The command line's `check-reply <judge|design> <reply-path | --stdin> --brief <brief-json>`
// (scripts/scan.mjs). Exit 0 if the reply is usable, 1 if not.
/**
 * The options the command line resolves for one call: `brief`, the `--brief <brief-json>` path
 * when given, and `stdin`, the reply's reader when `--stdin` was given, else null.
 * @typedef {object} CheckReplyContext
 * @property {string} [brief]
 * @property {(() => string) | null} stdin
 */

/**
 * @typedef {object} CheckReplyCommand
 * @property {{brief: "value", stdin: "flag"}} options
 * @property {string} usage
 * @property {(args: string[], ctx: CheckReplyContext) => {exit: number, json: AcceptedResult}} run
 */

/**
 * @type {CheckReplyCommand}
 */
export const command = {
  options: { brief: "value", stdin: "flag" },
  usage: "<judge|design> <reply-path | --stdin> --brief <brief-json>",
  run([contract, ...rest], { brief, stdin }) {
    if (stdin ? rest.length !== 0 : rest.length !== 1) throw new UsageError("check-reply takes a contract and exactly one <reply-path>, or --stdin");
    if (brief === undefined) throw new UsageError("check-reply needs --brief <brief-json>, the JSON `brief` printed for this unit");
    /**
     * Reads a path the command line names; being unable to read is a usage error.
     * @param {string} path
     * @param {string} what
     * @returns {string}
     */
    const read = (path, what) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        throw new UsageError(`cannot read ${what} ${path}`);
      }
    };
    const text = read(brief, "the brief");
    /**
     * The brief JSON, typed as the contract `brief` printed it (`JudgeBrief` or `DesignBrief`),
     * trusted past the parse and checked by `checkReply`'s gates (CODING_STANDARDS: trusted read
     * boundary).
     * @type {JudgeBrief | DesignBrief}
     */
    let unit;
    try {
      unit = JSON.parse(text);
    } catch {
      throw new UsageError(`${brief} is not the JSON \`brief\` printed`);
    }
    const result = orThrow(checkReply(contract, stdin ? stdin() : read(rest[0], "the reply"), unit));
    return { exit: result.usable ? 0 : 1, json: result };
  },
};
