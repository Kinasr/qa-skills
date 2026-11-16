// @ts-check
// Bookkeeping-stripped text: every
// comparison that asks whether knowledge changed reads a `.qa/` file with its Bookkeeping removed
// and its YAML serialised canonically, then diffs in-process.
//
// Bookkeeping is a closed list of keys per scope; everything else, unknown keys included, is knowledge. The
// keys are stripped wherever the schema puts YAML: a file's frontmatter and each Test Case's
// `yaml` block. Prose is knowledge and is kept verbatim. A YAML block outside the dialect is kept
// raw rather than half-stripped, so nothing it holds is lost from a comparison. Case and Scenario
// tracker fields and migration aliases are Bookkeeping; project tracker config and Feature slugs
// are knowledge (ADR-0027).
/** @import { CaseLevel } from "./case-fields.mjs" */
import { normalizeCaseLevel } from "./case-fields.mjs";
import { KNOWN } from "./schema.mjs";
import { isMap } from "./dialect.mjs";
import { quote } from "./render.mjs";
import { parse, RULE_FIELDS } from "./knowledge-file.mjs";
import { isProposedRulesSection } from "./proposed-rules.mjs";

/** @type {readonly string[]} */
export const BOOKKEEPING = ["watermark", "watermark_digest", "review_by", "finding", "review", "mirror"];
const IDENTITY_BOOKKEEPING = ["tracker", "tracker_formerly", "formerly"];
/**
 * @param {string} scope
 * @returns {readonly string[]}
 */
const bookkeeping = (scope) => (scope === "case" || scope === "scenario") ? [...BOOKKEEPING, ...IDENTITY_BOOKKEEPING, ...(scope === "case" ? ["mirror_fields", "mirror_field_targets"] : [])] : scope === "feature" ? [...BOOKKEEPING, "repairs", "suite_key", "coverage_digest"] : BOOKKEEPING;

/**
 * Entry in a parsed knowledge file.
 * @typedef {{
 *   key: string,
 *   line?: number,
 *   end?: number,
 *   blockLine?: number | null,
 *   blockEnd?: number | null,
 *   data?: Record<string, unknown>,
 *   keyLines?: Record<string, number | undefined>,
 *   [key: string]: unknown,
 * }} KnowledgeEntry
 */

/**
 * Parsed knowledge file shape expected by strip.
 * @typedef {{
 *   text?: string,
 *   rel?: string,
 *   type?: string | null,
 *   h1?: { key?: string | null, line?: number } | null,
 *   cases?: readonly KnowledgeEntry[],
 *   rules?: readonly KnowledgeEntry[],
 *   boundaries?: readonly KnowledgeEntry[],
 *   sections?: readonly { level: number, title: string, line: number, end: number }[],
 *   frontmatter?: { line: number, end: number } | null,
 *   data?: { type?: string, [key: string]: unknown },
 *   keyLines?: Record<string, number | undefined>,
 *   problems?: readonly { line?: number, [key: string]: unknown }[],
 *   [key: string]: unknown,
 * }} StrippableFile
 */

/**
 * Options for strip.
 * @typedef {{
 *   omit?: readonly string[],
 *   caseFields?: readonly string[],
 *   identity?: (scope: string, field: string, value: unknown) => unknown,
 * }} StripOptions
 */

/**
 * A stripper: `strip` for the neutral form, or `legacyStrip` for the schema 6 migration's
 * before/after check.
 * @typedef {(file: StrippableFile, options?: StripOptions) => Stripped} Stripper
 */

/**
 * One Rule or Boundary entry as the parser exposes it, for the neutral canonical form.
 * @typedef {{
 *   key: string,
 *   statement: string,
 *   fields?: readonly { name: string, value: string }[],
 *   owner?: string | null,
 *   elaboration?: string,
 * }} CanonicalEntry
 */

/**
 * A Rule's and Boundary's entry, either written form, rendered once for comparison (ADR-0061): the
 * key and statement, the field lines in `RULE_FIELDS` order (repeats kept in order), and the
 * elaboration with blank-line runs collapsed. No number, heading marker or indent belongs, so the
 * two forms holding the same content compare equal.
 * @param {CanonicalEntry} entry
 * @returns {string}
 */
export function canonicalRule(entry) {
  const fields = RULE_FIELDS.flatMap((name) => (entry.fields ?? []).filter((field) => field.name === name).map((field) => `${field.name}: ${field.value}`));
  return canonicalEntry(entry, fields);
}

/**
 * A Boundary's entry in the same neutral form (ADR-0061): its `Owner:` field sits where a Rule's
 * fields do.
 * @param {CanonicalEntry} entry
 * @returns {string}
 */
export function canonicalBoundary(entry) {
  return canonicalEntry(entry, entry.owner === null || entry.owner === undefined ? [] : [`Owner: ${entry.owner}`]);
}

/**
 * @param {CanonicalEntry} entry
 * @param {readonly string[]} fields
 * @returns {string}
 */
function canonicalEntry(entry, fields) {
  const lines = [`${entry.key}: ${entry.statement}`, ...fields];
  const body = elaborationLines(entry.elaboration ?? "");
  if (body.length) lines.push("", ...body);
  return lines.join("\n");
}

/**
 * An elaboration's lines with trailing whitespace removed, leading and trailing blank lines
 * dropped, and each run of blank lines collapsed to one.
 * @param {string} text
 * @returns {string[]}
 */
function elaborationLines(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  /** @type {string[]} */
  const out = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (out.length && out[out.length - 1] !== "") out.push("");
    } else out.push(line);
  }
  return out;
}

/**
 * Result of stripping a knowledge file for comparison.
 * @typedef {{
 *   text: string,
 *   cases: Map<string, string>,
 *   rules: Map<string, string>,
 *   boundaries: Map<string, string>,
 * }} Stripped
 */

// A file parsed by lib/knowledge-file.mjs's `parse`, stripped: its whole text, plus the stripped
// entry of every Test Case, Rule and Boundary it declares, by Key (the first declaration of a Key in the file
// wins; a second is an Integrity error elsewhere). An entry ends at its last non-blank line: the
// blank lines between entries belong to none.
//   { text, cases: Map<key, text>, rules: Map<key, text>, boundaries: Map<key, text> }
// `omit` names top-level YAML keys left out of the canonical form too, for a comparison that must
// ignore them (a Key rewrite's `formerly`); every other caller leaves it empty.
// `identity` optionally canonicalises typed YAML fields and declaration Keys for history. It
// never receives prose, sources inside prose, or arbitrary tokens in a heading's claim.
/**
 * @param {StrippableFile} file
 * @param {StripOptions} [options]
 * @returns {Stripped}
 */
export function strip(file, options = {}) {
  return stripEntries(file, options, false);
}

// `strip` as it read before the neutral Rule/Boundary form (ADR-0061): each entry keeps its raw
// written lines. Only the schema 6 migration reads it, to decide which pins were fresh before it
// re-pins them; every comparison uses `strip`.
/**
 * @param {StrippableFile} file
 * @param {StripOptions} [options]
 * @returns {Stripped}
 */
export function legacyStrip(file, options = {}) {
  return stripEntries(file, options, true);
}

/**
 * @param {StrippableFile} file
 * @param {StripOptions} options
 * @param {boolean} legacyEntries
 * @returns {Stripped}
 */
function stripEntries(file, { omit = [], caseFields, identity = (_scope, _field, v) => v } = {}, legacyEntries = false) {
  const lines = (/** @type {string} */ (file.text)).replace(/\r\n/g, "\n").split("\n");
  /** @type {Map<number, { to: number, lines: string[] }>} */
  const swaps = new Map(); // first line (1-based) → {to, lines}: a YAML range and its canonical form
  for (const { from, to, yaml, scope } of yamlRanges(file)) swaps.set(from, { to, lines: canonical(scope === "case" && caseFields ? Object.fromEntries(Object.entries(yaml.data).filter(([k]) => caseFields.includes(k))) : yaml.data, omit, scope, identity) });
  /**
   * @param {{ key?: string | null, line?: number } | null | undefined} entry
   * @param {string} scope
   */
  const heading = (entry, scope) => {
    if (!entry?.key) return;
    const key = identity(scope, "key", entry.key);
    const line = lines[(/** @type {{ line: number, key: string }} */ (entry)).line - 1];
    const prefix = line.match(/^#+\s+/)?.[0];
    if (prefix && line.startsWith(`${prefix}${entry.key}:`)) {
      swaps.set((/** @type {{ line: number }} */ (entry)).line, { to: (/** @type {{ line: number }} */ (entry)).line, lines: [`${prefix}${key}${line.slice(prefix.length + entry.key.length)}`] });
    }
  };
  if (file.type === "scenario") {
    heading(file.h1, "scenario");
    for (const c of (/** @type {readonly KnowledgeEntry[]} */ (file.cases))) heading(c, "case");
  }
  if (!legacyEntries) for (const e of (/** @type {readonly (CanonicalEntry & { line: number, end: number })[]} */ (file.rules ?? []))) {
    swaps.set(e.line, { to: e.end, lines: canonicalRule(e).split("\n") });
  }
  if (!legacyEntries) for (const e of (/** @type {readonly (CanonicalEntry & { line: number, end: number })[]} */ (file.boundaries ?? []))) {
    swaps.set(e.line, { to: e.end, lines: canonicalBoundary(e).split("\n") });
  }

  /**
   * @param {number} from
   * @param {number} to
   * @returns {string}
   */
  const render = (from, to) => {
    /** @type {string[]} */
    const out = [];
    for (let l = from; l <= to; ) {
      const s = swaps.get(l);
      if (s) {
        out.push(...s.lines);
        l = s.to + 1;
      } else {
        out.push(lines[l - 1]);
        l++;
      }
    }
    return out.join("\n");
  };
  /**
   * @param {readonly KnowledgeEntry[]} list
   * @returns {Map<string, string>}
   */
  const entries = (list) => {
    /** @type {Map<string, string>} */
    const map = new Map();
    for (const e of list) if (!map.has(e.key)) map.set(e.key, render(/** @type {number} */ (e.line), /** @type {number} */ (e.end)).replace(/\s+$/, ""));
    return map;
  };
  return { text: render(1, lines.length), cases: entries(/** @type {readonly KnowledgeEntry[]} */ (file.cases)), rules: entries(/** @type {readonly KnowledgeEntry[]} */ (file.rules)), boundaries: entries(/** @type {readonly KnowledgeEntry[]} */ (file.boundaries)) };
}

// A case's claim is its stripped entry less labels and links: Tags, `automates` (the Automation
// link, ADR-0005) and keys outside the case schema. Built-in fields keep exactly the same
// canonical representation and Bookkeeping rules as strip, including canonical case level bindings. Binding a case to an Automation is not a
// change to what it claims, so it never voids a Review.
/**
 * @param {StrippableFile} file
 * @param {StripOptions} [options]
 * @param {Stripper} [stripFn]
 * @returns {Stripped}
 */
export function claimProjection(file, options = {}, stripFn = strip) {
  return stripFn(file, { ...options, caseFields: KNOWN.case.filter((key) => key !== "tags" && key !== "automates") });
}

// A Feature's impact projection (ADR-0033 as amended): its stripped knowledge without the
// explicit exceptions `## Coverage`, `## Deferred`, `## Proposed Rules` (ADR-0067) and
// `coverage_digest`, so applicability, deferral and kept-proposal changes move no pin. `## Open questions` stays knowledge in the projection. Every other
// file projects as stripped text; a Feature without either section projects byte for byte as
// before, so existing pins still verify.
/**
 * @param {StrippableFile} file
 * @param {StripOptions} [options]
 * @param {Stripper} [stripFn]
 * @returns {Stripped}
 */
export function impactProjection(file, options = {}, stripFn = strip) {
  if (file.type !== "feature") return claimProjection(file, options, stripFn);
  const projected = { ...options, omit: [...(options.omit ?? []), "coverage_digest"] };
  const sections = file.sections?.filter((s) => s.level === 2 && (["Coverage", "Deferred"].includes(s.title) || isProposedRulesSection(s))) ?? [];
  if (!sections.length) return stripFn(file, projected);
  const lines = (file.text ?? "").replace(/\r\n/g, "\n").split("\n");
  // Section lines are 1-based: the heading is `line - 1` as an index and `end` is one past the
  // section's last line. Dropping the whole section leaves the blank line that preceded it, so a
  // Feature with either section projects exactly as the same Feature written without it.
  for (const section of [...sections].reverse()) lines.splice(section.line - 1, section.end - section.line + 1);
  return stripFn(parse(file.rel ?? "feature.md", lines.join("\n")), projected);
}

// The line numbers (1-based) that hold `file`'s Bookkeeping, for text shown rather than compared
// (a judge brief's inlined files): each Bookkeeping key's line and its continuation lines,
// up to the next key, less trailing blank lines. Every other line, knowledge and prose, is kept
// byte for byte, where `strip` canonicalises it. The YAML ranges are `strip`'s own, and a block
// outside the dialect is kept whole, as `strip` keeps it raw; such a file is an Integrity error
// that `/qa-impact` excludes from judging, so it never reaches a judge that way.
/**
 * @param {StrippableFile} file
 * @returns {Set<number>}
 */
export function bookkeepingLines(file) {
  const lines = (/** @type {string} */ (file.text)).replace(/\r\n/g, "\n").split("\n");
  /** @type {Set<number>} */
  const drop = new Set();
  for (const { from, to, yaml, scope } of yamlRanges(file)) {
    for (const key of bookkeeping(scope)) {
      const at = (/** @type {Record<string, number | undefined>} */ (yaml.keyLines))[key];
      if (at === undefined) continue;
      let end = at;
      for (let l = at + 1; l <= to && !/^\S/.test(lines[l - 1]); l++) if (lines[l - 1].trim()) end = l;
      for (let l = at; l <= end; l++) drop.add(l);
    }
  }
  return drop;
}

// `file`'s text less its Bookkeeping lines (`bookkeepingLines`); its line endings are kept.
/**
 * @param {StrippableFile} file
 * @returns {string}
 */
export function withoutBookkeeping(file) {
  const drop = bookkeepingLines(file);
  return (/** @type {string} */ (file.text)).split("\n").filter((_, i) => !drop.has(i + 1)).join("\n");
}

/**
 * @typedef {{
 *   from: number,
 *   to: number,
 *   yaml: { data: Record<string, unknown>, keyLines?: Record<string, number | undefined> },
 *   scope: string,
 * }} YamlRange
 */

// Where the schema puts YAML in `file`: the frontmatter and each Test Case's `yaml` block, each as
// `{from, to, yaml, scope}` (1-based, inclusive lines; `yaml` its parsed `{data, keyLines}`). A range the
// file's `problems` touch is outside the dialect and left out: nothing in it is stripped.
/**
 * @param {StrippableFile} file
 * @returns {YamlRange[]}
 */
function yamlRanges(file) {
  /** @type {YamlRange[]} */
  const ranges = [];
  /**
   * @param {number} from
   * @param {number} to
   * @param {{ data: Record<string, unknown>, keyLines?: Record<string, number | undefined> }} yaml
   * @param {string} scope
   */
  const add = (from, to, yaml, scope) => {
    if (to >= from && !(/** @type {readonly { line: number }[]} */ (file.problems)).some((p) => p.line >= from && p.line <= to)) ranges.push({ from, to, yaml, scope });
  };
  if (file.frontmatter) add(file.frontmatter.line + 1, file.frontmatter.end - 1, /** @type {{ data: Record<string, unknown>, keyLines?: Record<string, number | undefined> }} */ (file), (/** @type {{ type: string }} */ (file.data)).type);
  for (const c of (/** @type {readonly KnowledgeEntry[]} */ (file.cases))) if (c.blockLine !== null) add((/** @type {number} */ (c.blockLine)) + 1, (/** @type {number} */ (c.blockEnd)) - 1, /** @type {{ data: Record<string, unknown>, keyLines?: Record<string, number | undefined> }} */ (c), "case");
  return ranges;
}

// One `key: value` line per top-level knowledge key, in the file's order; a block list of maps
// keeps one item per line. Values render in one fixed flow style, so a knowledge value compares
// equal however it was written.
/**
 * @param {Record<string, unknown>} data
 * @param {readonly string[]} [omit]
 * @param {string} [scope]
 * @param {(scope: string, field: string, value: unknown) => unknown} [identity] always passed by `strip`
 * @returns {string[]}
 */
function canonical(data, omit = [], scope, identity) {
  /** @type {string[]} */
  const out = [];
  for (const [k, raw] of Object.entries(data)) {
    if (bookkeeping(/** @type {string} */ (scope)).includes(k) || omit.includes(k)) continue;
    const identified = /** @type {NonNullable<typeof identity>} */ (identity)(/** @type {string} */ (scope), k, raw);
    const v = scope === "case" && k === "level" ? normalizeCaseLevel(/** @type {CaseLevel} */ (identified)) : identified;
    if (Array.isArray(v) && v.some(isMap)) {
      out.push(`${k}:`);
      for (const item of v) out.push(`  - ${value(item)}`);
    } else {
      out.push(`${k}: ${value(v)}`);
    }
  }
  return out;
}

const PLAIN = /^[^\s"[\]{},#][^"[\]{},#]*$/;
const LITERAL = /^(?:true|false|null|~|[-+]?[0-9][0-9._eE+-]*)$/;

/**
 * @param {unknown} v
 * @returns {string}
 */
function value(v) {
  if (isMap(v)) return `{${Object.entries(v).map(([k, x]) => `${k}: ${value(x)}`).join(", ")}}`;
  if (Array.isArray(v)) return `[${v.map(value).join(", ")}]`;
  if (typeof v !== "string") return String(v);
  return PLAIN.test(v) && !/: |\s$/.test(v) && !LITERAL.test(v) ? v : quote(v);
}

// A unified diff of two texts (either may be null: the file is absent on that side), labelled with
// `path`, three lines of context. Line numbers count stripped lines. Empty when the texts agree.
/**
 * @param {string} path
 * @param {string | null | undefined} before
 * @param {string | null | undefined} after
 * @param {number} [context]
 * @returns {string}
 */
export function unifiedDiff(path, before, after, context = 3) {
  const a = toLines(before);
  const b = toLines(after);
  const ops = diffLines(a, b);
  const changes = ops.flatMap((o, i) => (o.op === " " ? [] : [i]));
  if (changes.length === 0) return "";

  // Merge each change's context window with its neighbours.
  /** @type {[number, number][]} */
  const windows = [];
  for (const i of changes) {
    const [s, e] = [Math.max(0, i - context), Math.min(ops.length - 1, i + context)];
    const last = windows.at(-1);
    if (last && s <= last[1] + 1) last[1] = e;
    else windows.push([s, e]);
  }
  const out = [`--- ${before === null ? "/dev/null" : `a/${path}`}`, `+++ ${after === null ? "/dev/null" : `b/${path}`}`];
  for (const [s, e] of windows) {
    const hunk = ops.slice(s, e + 1);
    const aCount = hunk.filter((o) => o.op !== "+").length;
    const bCount = hunk.filter((o) => o.op !== "-").length;
    /**
     * @param {number} n
     * @param {number} count
     * @returns {number}
     */
    const start = (n, count) => (count === 0 ? n : n + 1);
    out.push(`@@ -${start(ops[s].a, aCount)},${aCount} +${start(ops[s].b, bCount)},${bCount} @@`);
    for (const o of hunk) out.push(`${o.op}${o.line}`);
  }
  return `${out.join("\n")}\n`;
}

/**
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
function toLines(text) {
  if (text === null || text === undefined) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// A line diff: the common prefix and suffix, then a longest common subsequence over the middle.
// Each op carries `a`/`b`, the count of lines of each side before it, for hunk headers. A middle
// too large for the table degrades to one replacement, which is still a correct diff.
const MAX_CELLS = 16_000_000;

/**
 * @typedef {{
 *   op: string,
 *   line: string,
 *   a: number,
 *   b: number,
 * }} DiffOp
 */

/**
 * @param {readonly string[]} a
 * @param {readonly string[]} b
 * @returns {DiffOp[]}
 */
function diffLines(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);

  /** @type {[string, string][]} */
  const middle = [];
  const n = A.length;
  const m = B.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    for (const line of A) middle.push(["-", line]);
    for (const line of B) middle.push(["+", line]);
  } else {
    // lcs[i][j]: the LCS length of A[i..] and B[j..].
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = A[i] === B[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) {
        middle.push([" ", A[i++]]);
        j++;
      } else if (i < n && (j === m || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
        middle.push(["-", A[i++]]); // removals before additions, as git prints them
      } else {
        middle.push(["+", B[j++]]);
      }
    }
  }

  /** @type {DiffOp[]} */
  const ops = [];
  let ai = 0;
  let bi = 0;
  /**
   * @param {string} op
   * @param {string} line
   */
  const push = (op, line) => {
    ops.push({ op, line, a: ai, b: bi });
    if (op !== "+") ai++;
    if (op !== "-") bi++;
  };
  for (let k = 0; k < pre; k++) push(" ", a[k]);
  for (const [op, line] of middle) push(op, line);
  for (let k = a.length - suf; k < a.length; k++) push(" ", a[k]);
  return ops;
}
