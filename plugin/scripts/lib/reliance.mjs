// @ts-check
// Reliance: the Rules a Test Case's setup rests on without covering them, local or
// `<feature>/<rule>`. One reader of the case field and one reverse view, so every command answers
// "which cases rest on this Rule?" the same way. Nothing reverse is stored: `reverseReliance` reads
// the tree's `relies_on` fields and inverts them in memory, once per command run.
//
//   relianceOf(entry, feature)  → {refs, malformed}
//   reverseReliance(index)      → Map<"<feature>/<rule>", RelianceUse[]>
//
// A local entry is a Rule of the case's own Feature; a qualified entry is a Rule of another one.
// Naming the case's own Feature in the qualified form is left to the Scan's Integrity check, which
// reports it: this reader still resolves it, with `local` true.
/** @import { CaseEntry, ParsedFile } from "./knowledge-file.mjs" */
/** @import { KeyIndex } from "./qa-index.mjs" */
/** @import { RuleRef } from "./rule-ref.mjs" */
import { PATTERN } from "./keys.mjs";
import { formatRuleRef, parseRuleRef } from "./rule-ref.mjs";

/**
 * One entry of a case's `relies_on`: the text it was written as, the Rule it names, and whether it
 * names a Rule of the case's own Feature.
 * @typedef {{
 *   text: string,
 *   ref: RuleRef,
 *   local: boolean,
 * }} RelianceRef
 */

/**
 * One case that rests on a Rule: the case's Feature and Key, the file holding it, and the line its
 * `relies_on` field sits on.
 * @typedef {{
 *   feature: string,
 *   case: string,
 *   file: ParsedFile,
 *   line: number,
 * }} RelianceUse
 */

// A case's Reliance, read: every entry it names, and the entries that are no Rule reference at all.
// An absent or non-list field names nothing; `check-file` reports the wrong shape.
/**
 * @param {CaseEntry} entry
 * @param {string} feature the case's own Feature key
 * @returns {{ refs: RelianceRef[], malformed: string[] }}
 */
export function relianceOf(entry, feature) {
  /** @type {RelianceRef[]} */
  const refs = [];
  /** @type {string[]} */
  const malformed = [];
  const raw = entry.data.relies_on;
  if (!Array.isArray(raw)) return { refs, malformed };
  for (const value of raw) {
    if (typeof value !== "string") {
      malformed.push(JSON.stringify(value));
      continue;
    }
    if (PATTERN.rule.test(value)) {
      refs.push({ text: value, ref: { feature, rule: value }, local: true });
      continue;
    }
    const ref = parseRuleRef(value);
    if (ref) refs.push({ text: value, ref, local: ref.feature === feature });
    else malformed.push(value);
  }
  return { refs, malformed };
}

// The reverse Reliance index over `index`: every Rule named by a case's `relies_on`, with each case
// that rests on it. A `relies_on` entry that is no Rule reference names nothing here; `check-file`
// and the Scan report it.
/**
 * @param {KeyIndex} index
 * @returns {Map<string, RelianceUse[]>}
 */
export function reverseReliance(index) {
  /** @type {Map<string, RelianceUse[]>} */
  const uses = new Map();
  for (const [key, decls] of index.cases) {
    for (const decl of decls) {
      const feature = decl.feature ?? index.featureOf(decl.file) ?? "";
      for (const { ref } of relianceOf(/** @type {CaseEntry} */ (decl.entry), feature).refs) {
        const target = formatRuleRef(ref);
        if (!uses.has(target)) uses.set(target, []);
        /** @type {RelianceUse[]} */ (uses.get(target)).push({
          feature,
          case: key,
          file: decl.file,
          line: decl.entry.keyLines.relies_on ?? decl.line,
        });
      }
    }
  }
  return uses;
}
