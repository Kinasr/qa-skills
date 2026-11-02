// @ts-check
// The one structural Rule diff: the Scan's history and `deep-dive check` ask the same question of
// the same text, so a statement, elaboration, Waiver and Dependency edit each count as a change on
// both sides. The Scan compares a Rule's whole stripped entry (`stripped.mjs`); `ruleEdit` names
// which part of it moved, for reporting.
/** @import { ParsedFile, ParsedRule } from "./knowledge-file.mjs" */
/** @import { RuleRef } from "./rule-ref.mjs" */
import { formatRuleRef, readDependsOn } from "./rule-ref.mjs";
import { strip } from "./stripped.mjs";

/**
 * One kind of structural Rule edit. `kinds` is never empty: a text change that matches no parsed
 * part is reported as `elaboration`.
 * @typedef {"statement" | "elaboration" | "waiver" | "depends_on"} RuleEditKind
 */

/**
 * An edited Rule, classified: the statement as `from`/`to` (unchanged when only another part moved),
 * the kinds that moved, and the before/after value of each.
 * @typedef {{
 *   key: string,
 *   kinds: RuleEditKind[],
 *   from: string,
 *   to: string,
 *   changes: {
 *     statement?: { from: string, to: string },
 *     elaboration?: { from: string, to: string },
 *     waiver?: { from: string | null, to: string | null },
 *     depends_on?: { from: string[], to: string[] },
 *   },
 * }} RuleEdit
 */

/**
 * The Rules of one parsed file, by key: the stripped entry text the Scan compares.
 * @param {ParsedFile} file
 * @returns {Map<string, string>}
 */
export function ruleTexts(file) {
  return strip(file).rules;
}

// The predicate every comparison asks: a Rule changed iff its stripped entry text differs. A
// missing side (an added or removed Rule) counts as changed against any text, `undefined` included.
/**
 * @param {string | undefined} before
 * @param {string | undefined} after
 * @returns {boolean}
 */
export function ruleChanged(before, after) {
  return before !== after;
}

// The keys whose Rule text changed between two states: added, removed or rewritten.
/**
 * @param {ReadonlyMap<string, string>} before
 * @param {ReadonlyMap<string, string>} after
 * @returns {string[]}
 */
export function changedRuleKeys(before, after) {
  return [...new Set([...after.keys(), ...before.keys()])].filter((key) => ruleChanged(before.get(key), after.get(key)));
}

/**
 * A Rule that differs between two states, with its stripped entry text on each side (`undefined`
 * where the Rule is absent: added has no `before`, removed has no `after`).
 * @typedef {RuleRef & { before: string | undefined, after: string | undefined }} ChangedRuleRef
 */

/**
 * One state of `.qa/` as the Rule diff reads it: the Features it declares Rules for, and each
 * Feature's stripped Rules.
 * @typedef {{
 *   index: { rules: ReadonlyMap<string, unknown> },
 *   rules: (slug: string) => ReadonlyMap<string, string>,
 * }} RuleSnapshot
 */

// Rules changed across two snapshots, in every Feature either declares: the one place that walks
// both states and asks `ruleChanged`. Sorted by Feature, then Rule key.
/**
 * @param {RuleSnapshot} then
 * @param {RuleSnapshot} now
 * @returns {ChangedRuleRef[]}
 */
export function rulesChangedAcross(then, now) {
  const features = [...new Set([...then.index.rules.keys(), ...now.index.rules.keys()])].sort();
  return features.flatMap((feature) => {
    const before = then.rules(feature);
    const after = now.rules(feature);
    return changedRuleKeys(before, after)
      .sort()
      .map((rule) => ({ feature, rule, before: before.get(rule), after: after.get(rule) }));
  });
}

// The elaboration of one stripped Rule entry: its lines after the heading and the field block at
// the head of its body, trimmed. Field lines are only skipped in the contiguous block `readFields`
// recognises, so prose that begins with the same words stays elaboration.
/**
 * @param {string} text
 * @returns {string}
 */
function elaborationOf(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let at = 1;
  while (at < lines.length && !lines[at].trim()) at++;
  while (at < lines.length && /^(?:Waived|Depends on):\s*/.test(lines[at])) at++;
  return lines.slice(at).join("\n").trim();
}

/**
 * @param {ParsedRule} rule
 * @param {string} text
 */
function parts(rule, text) {
  return {
    statement: rule.statement,
    elaboration: elaborationOf(text),
    waiver: rule.waiver,
    depends_on: (readDependsOn(rule)?.refs ?? []).map(formatRuleRef),
  };
}

/**
 * @param {readonly string[]} a
 * @param {readonly string[]} b
 */
const sameRefs = (a, b) => a.length === b.length && a.every((ref, i) => ref === b[i]);

// Classify one edited Rule for reporting; null when the two entry texts agree.
/**
 * @param {ParsedRule} before
 * @param {ParsedRule} after
 * @param {string} textBefore
 * @param {string} textAfter
 * @returns {RuleEdit | null}
 */
export function ruleEdit(before, after, textBefore, textAfter) {
  if (!ruleChanged(textBefore, textAfter)) return null;
  const was = parts(before, textBefore);
  const now = parts(after, textAfter);
  /** @type {RuleEditKind[]} */
  const kinds = [];
  /** @type {RuleEdit["changes"]} */
  const changes = {};
  if (was.statement !== now.statement) {
    kinds.push("statement");
    changes.statement = { from: was.statement, to: now.statement };
  }
  if (was.elaboration !== now.elaboration) {
    kinds.push("elaboration");
    changes.elaboration = { from: was.elaboration, to: now.elaboration };
  }
  if (was.waiver !== now.waiver) {
    kinds.push("waiver");
    changes.waiver = { from: was.waiver, to: now.waiver };
  }
  if (!sameRefs(was.depends_on, now.depends_on)) {
    kinds.push("depends_on");
    changes.depends_on = { from: was.depends_on, to: now.depends_on };
  }
  // A text change outside the four parsed parts (spacing inside a field line, for example) is still
  // a change, and is reported against the part that holds the field block.
  if (kinds.length === 0) {
    kinds.push("elaboration");
    changes.elaboration = { from: was.elaboration, to: now.elaboration };
  }
  return { key: after.key, kinds, from: before.statement, to: after.statement, changes };
}
