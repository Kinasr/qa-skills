// @ts-check
// Deferred functionality is unkeyed prose, validated by deep-dive check and surfaced by next.
import { listOf } from "./dialect.mjs";
import { parse } from "./knowledge-file.mjs";
import { referenceShapeError } from "./references.mjs";

/** @import { CheckProblem } from "./check-file.mjs" */
/** @import { ParsedFile } from "./knowledge-file.mjs" */

/**
 * One whole functionality left for a later deep dive. `line` is 1-based in the Feature file.
 * @typedef {{ functionality: string, reason: string, reference: string, place: string | null, line: number }} DeferredFunctionality
 */

/**
 * Parse every Deferred section in one place. Malformed lines are reported, never made into items.
 * The verb phrase is prose: syntax checks require text, leaving its meaning to the engineer.
 * @param {string} text
 * @returns {{ items: DeferredFunctionality[], problems: CheckProblem[] }}
 */
function deferredSection(text) {
  const file = parse("feature.md", text);
  const sections = file.sections.filter((s) => s.level === 2 && s.title === "Deferred");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  /** @type {DeferredFunctionality[]} */
  const items = [];
  /** @type {CheckProblem[]} */
  const problems = [];
  for (const [index, section] of sections.entries()) {
    if (index > 0) problems.push({ code: "deferred_duplicate", line: section.line, message: "a Feature has at most one `## Deferred` section" });
    // An item may wrap: an indented line continues the item above it.
    /** @type {{ line: number, text: string }[]} */
    const entries = [];
    for (let i = section.line; i < section.end; i++) {
      const raw = lines[i];
      if (!raw.trim()) continue;
      const last = entries[entries.length - 1];
      if (/^\s/.test(raw) && last) last.text += ` ${raw.trim()}`;
      else entries.push({ line: i + 1, text: raw });
    }
    const nonempty = entries.length !== 0;
    for (const { line, text: raw } of entries) {
      const match = /^-\s+\*\*(.+?)\*\*:\s*(.+?)\.\s+From:\s+(\S+?)(?:,\s+(.*))?\s*$/.exec(raw);
      if (!match || !match[1].trim() || !match[2].trim() || (match[4] !== undefined && !match[4].trim())) {
        problems.push({ code: "deferred_line", line, message: "a Deferred item is `- **<functionality as a verb phrase>**: <reason>. From: <reference uri>[, <place>]`, with non-empty fields" });
        continue;
      }
      items.push({ functionality: match[1].trim(), reason: match[2].trim(), reference: match[3], place: match[4]?.trim() ?? null, line });
    }
    if (!nonempty) problems.push({ code: "deferred_empty", line: section.line, message: "omit `## Deferred` when it has no items" });
  }
  return { items, problems };
}

/**
 * The Feature's Deferred items in file order; absent sections return an empty list.
 * @param {string} text
 * @returns {DeferredFunctionality[]}
 */
export function parseDeferred(text) {
  return deferredSection(text).items;
}

/**
 * Syntax-only errors in a draft's Deferred section, including Reference shape and sources.
 * Overlap with Rules, Boundaries or other Features is the engineer's to reconcile.
 * @param {ParsedFile} feature
 * @param {{ trackerPattern?: RegExp | null }} options
 * @returns {CheckProblem[]}
 */
export function deferredProblems(feature, options) {
  const { items, problems } = deferredSection(feature.text);
  const sources = new Set(listOf(feature.data?.sources));
  for (const item of items) {
    const error = referenceShapeError(item.reference, options);
    if (error) problems.push({ code: "deferred_reference", line: item.line, message: error });
    if (!sources.has(item.reference)) problems.push({ code: "deferred_source", line: item.line, message: `Deferred Reference \`${item.reference}\` is not listed in the Feature's \`sources\`` });
  }
  return problems;
}
