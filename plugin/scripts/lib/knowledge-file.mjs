// @ts-check
// The knowledge-file module: the one reading and the one in-place editing of every `.qa/`
// file: the knowledge files proper (a Feature's file and its scenario files) and `project.md`, the
// train files and the Observations too. Everything here works on text alone and never touches the
// disk: `qa-index.mjs` reads the working tree, `git-tree.mjs` a revision, and both hand their files
// to `parseTree`.
//
//   parse(rel, text)           → a parsed `.qa/` file
//   edit(file, changes)        → {ok, text, file, errors, unreadable?, message?}
//   checkFile(file, config)    → {type, ok, errors, warnings}   (lib/check-file.mjs)
//   projectConfig(project, o)  → Config
//   parseTree(entries)         → parsed `.qa/` files
//   RULE_FIELDS                → the field names a Rule's body may open with
//
// Parsing never throws: what could not be read is kept on the file as `problems`, so a scan pass
// can report it and carry on.
/**
 * @import { LabelDefinitions } from "./case-labels.mjs"
 * @import { CaseSectionKind } from "./case-sections.mjs"
 * @import { MintRecipe } from "./keys.mjs"
 * @import { MarkdownElement, MarkdownFenceElement, MarkdownHeadingElement } from "./markdown.mjs"
 * @import { TrainEntryDescriptor } from "./schema.mjs"
 */
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { labelDefinitions } from "./case-labels.mjs";
import { caseSectionRanges } from "./case-sections.mjs";
import { isMap, parseYaml } from "./dialect.mjs";
import { automationKeyPattern, compileKeyPattern, parseMintRecipe } from "./keys.mjs";
import { keyedHeading, splitFile } from "./markdown.mjs";
import { block, line, role, token } from "./render.mjs";
import { GRADLE_DEFAULT_TASK } from "./runners/gradle.mjs";
import { FIELD_RENDER, isSchemaVersion, KNOWN, TRAIN_ENTRIES, trainEntry } from "./schema.mjs";

export { checkFile, checkExecution } from "./check-file.mjs";

// The field names a Rule's body may open with, in no required order: ADR-0039's `Waived:` and the
// fields that sit beside it. A field line is `<name>: <value>`, the value trimmed.
/** @type {readonly ["Waived", "Depends on"]} */
export const RULE_FIELDS = ["Waived", "Depends on"];

/**
 * One fenced code block.
 * @typedef {{
 *   lang?: string,
 *   line: number,
 *   end: number,
 * }} ParsedFence
 */

/**
 * A problem recorded during parsing.
 * @typedef {{
 *   code: string,
 *   line?: number,
 *   message: string,
 * }} ParsedProblem
 */

/**
 * One section heading.
 * @typedef {{
 *   level: number,
 *   title: string,
 *   line: number,
 *   end: number,
 * }} ParsedSection
 */

/**
 * One field line of a Rule's body: the field it carries, its value and the line it sits on.
 * @typedef {{
 *   name: (typeof RULE_FIELDS)[number],
 *   value: string,
 *   line: number,
 * }} RuleField
 */

/**
 * One rule entry of a Feature file.
 * @typedef {{
 *   key: string,
 *   statement: string,
 *   line: number,
 *   end: number,
 *   fields: RuleField[],
 *   fieldsEnd: number | null,
 *   waiver: string | null,
 *   waiverLine: number | null,
 *   elaboration: string,
 * }} ParsedRule
 */

/**
 * One Boundary entry of a Feature file (ADR-0039).
 * @typedef {{
 *   key: string,
 *   statement: string,
 *   owner: string | null,
 *   line: number,
 *   end: number,
 *   elaboration: string,
 * }} ParsedBoundary
 */

/**
 * One entry headed `### <key>: <text>` (a case, execution, or train entry).
 * @typedef {{
 *   key: string,
 *   summary?: string,
 *   statement?: string,
 *   line: number,
 *   end: number,
 *   data: Record<string, unknown>,
 *   keyLines: Record<string, number>,
 *   blockLine: number | null,
 *   blockEnd: number | null,
 *   prose: Array<{ line: number, text: string }>,
 *   sections: Array<{kind: CaseSectionKind, line: number, end: number, text: string}>,
 * }} ParsedEntry
 */

/**
 * A Test Case entry: a ParsedEntry with its heading's summary.
 * @typedef {ParsedEntry & { summary: string }} CaseEntry
 */

/**
 * One `.qa/` file, parsed as far as it goes.
 * @typedef {{
 *   rel: string,
 *   name: string,
 *   dir: string,
 *   text: string,
 *   eol: "\r\n" | "\n",
 *   type: string | null,
 *   data: Record<string, unknown>,
 *   keyLines: Record<string, number>,
 *   frontmatter: { line: number, end: number } | null,
 *   frontmatterLine: number,
 *   h1: { line: number, key: string | null, text: string } | null,
 *   intro: string,
 *   sections: ParsedSection[],
 *   fences: ParsedFence[],
 *   problems: ParsedProblem[],
 *   cases: CaseEntry[],
 *   executions: ParsedEntry[],
 *   rules: ParsedRule[],
 *   boundaries: ParsedBoundary[],
 *   conventions?: ParsedEntry[],
 *   practices?: ParsedEntry[],
 *   access_notes?: ParsedEntry[],
 *   recipes?: ParsedEntry[],
 *   actions?: ParsedEntry[],
 *   uploads?: ParsedEntry[],
 *   unreadable?: undefined,
 *   [key: string]: unknown,
 * }} ParsedFile
 */

/**
 * A file whose text could not be read.
 * @typedef {{
 *   rel: string,
 *   unreadable: string,
 *   name?: never,
 *   dir?: never,
 *   text?: never,
 *   eol?: never,
 *   type?: never,
 *   data?: never,
 *   keyLines?: never,
 *   frontmatter?: never,
 *   frontmatterLine?: never,
 *   h1?: never,
 *   sections?: never,
 *   fences?: never,
 *   problems?: never,
 *   cases?: never,
 *   rules?: never,
 *   boundaries?: never,
 *   executions?: never,
 *   conventions?: never,
 *   practices?: never,
 *   access_notes?: never,
 *   recipes?: never,
 *   actions?: never,
 *   uploads?: never,
 *   [key: string]: unknown,
 * }} UnreadableFile
 */

/**
 * A `.qa/` file as parsed: either a parsed file or an unreadable record.
 * @typedef {ParsedFile | UnreadableFile} QaFile
 */

/**
 * A file that can be edited by `edit`.
 * @typedef {{
 *   rel?: string,
 *   text: string,
 *   eol?: string,
 *   type?: string | null,
 *   problems: ParsedProblem[],
 *   frontmatter: { line: number, end: number } | null | unknown,
 *   cases?: Array<{ key: string, line: number, end?: number, blockLine?: number | null, blockEnd?: number | null, [key: string]: unknown }>,
 *   executions?: Array<{ key: string, line: number, end?: number, blockLine?: number | null, blockEnd?: number | null, [key: string]: unknown }>,
 *   rules?: Array<{ key: string, line: number, end?: number, [key: string]: unknown }>,
 *   boundaries?: Array<{ key: string, line: number, end?: number, [key: string]: unknown }>,
 *   [key: string]: unknown,
 * }} EditableFile
 */

/**
 * A single change to apply in `edit`.
 * @typedef {{
 *   at?: string,
 *   set?: Record<string, unknown>,
 *   remove?: string,
 *   append?: string,
 * }} EditChange
 */

/**
 * One refusal from `edit`.
 * @typedef {{
 *   code: string,
 *   line?: number,
 *   at?: string,
 *   field?: string,
 *   message: string,
 * }} EditError
 */

/**
 * Result of in-place editing of a .qa file.
 * @typedef {{
 *   ok: true,
 *   text: string,
 *   file: ParsedFile,
 *   errors: EditError[],
 *   unreadable?: false,
 *   message?: never,
 * } | {
 *   ok: false,
 *   unreadable: boolean,
 *   text: string,
 *   file: ParsedFile,
 *   errors: EditError[],
 *   message: string,
 * }} EditResult
 */

/**
 * Built-in runner parameters. Launcher defaults depend on wrappers on disk and are resolved by
 * the runner, not the text parser. Optional arrays remain absent when not declared.
 * @typedef {{ tool: "playwright" | "gradle" | "maven", dir: string, launcher?: string[], task?: string, args?: string[], target_env: string[] }} TestRunner
 */

/**
 * The code-host CLI owns its login; project.md stores only the selected tool.
 * @typedef {{ tool: "gh" | "glab" }} CodeHost
 */

/**
 * The configured bug destination and create-field defaults, without inferred defaults.
 * @typedef {{ issue_type: string, link_type: string, direction: "outward" | "inward", fields: Array<{field: string, value: unknown}> }} BugPublishConfig
 */

/**
 * Project configuration parsed from `project.md`.
 * @typedef {{
 *   pathInsideRepo?: (path: string) => boolean,
 *   schemaVersion: number,
 *   roles: Set<string>,
 *   labels: LabelDefinitions,
 *   levels: Set<string>,
 *   trackerPattern: RegExp | null,
 *   autPattern: RegExp | null,
 *   autExternal: boolean,
 *   autRecipe: MintRecipe | null,
 *   autMints: boolean,
 *   autMintReason?: string,
 *   autMintProblem?: string,
 *   tiers: Record<string, string>,
 *   targets?: Record<string, string>,
 *   execute_levels: Record<string, string>,
 *   allowedHosts: string[] | null,
 *   modulePaths: string[],
 *   stack: { language: string, framework: string, root: string } | null,
 *   test_runner?: TestRunner,
 *   code_host?: CodeHost,
 *   bug_publish?: BugPublishConfig,
 *   annotationMap: Record<string, string[]>,
 *   [key: string]: unknown,
 * }} ProjectConfig
 */

// One `.qa/` file, parsed as far as it goes. `rel` is its POSIX path relative to the `.qa/` root.
//   eol          the file's line ending, `\r\n` or `\n`, which an edit keeps
//   frontmatter  `{line, end}`: its opening and closing `---` lines; null when there is none
//   frontmatterLine  the first line inside it (1 with none), cited for a key that is missing
//   data, keyLines   its frontmatter values and the line each top-level key is declared on
//   h1           `{line, key, text}`, or null
//   intro        a Feature's prose between its H1 and the next heading, trimmed
//   sections     every heading `{level, title, line, end}`, `end` the line before the next heading
//                of its level or above, or the file's last line
//   fences       every fenced block `{lang, line, end}`, `end` its closing fence line
//   problems     what the schema cannot read, `{code, line, message}`: a git conflict marker, an
//                unclosed frontmatter or fence, a YAML error in the frontmatter or an entry's block
//   rules        a Feature's `### rule_<key>: <statement>` entries `{key, statement, line, end,
//                fields, fieldsEnd, waiver, waiverLine, elaboration}`: its field block, Waiver,
//                and the remaining text
//   boundaries   a Feature's `### boundary_<key>: <statement>` entries, with owner and elaboration
//   cases        a scenario's Test Cases (see `parseEntry`), `summary` their heading text
//   executions   an Execution record's entries (same shape as `cases`, with result fields)
//   conventions, practices, access_notes   a train file's entries, `statement` their heading text
/**
 * @param {string} rel
 * @param {string} text
 * @returns {ParsedFile}
 */
export function parse(rel, text) {
  const doc = splitFile(text);
  /** @type {ParsedFile} */
  const file = {
    rel,
    name: posix.basename(rel),
    dir: posix.dirname(rel),
    text,
    eol: /\r\n/.test(text) ? "\r\n" : "\n",
    type: null,
    data: {},
    keyLines: {},
    frontmatter: null,
    frontmatterLine: 1,
    h1: null,
    intro: "",
    sections: [],
    fences: [],
    problems: doc.errors.map((e) => ({ code: e.code ?? "dialect", line: e.line, message: e.message })),
    cases: [],
    executions: [],
    rules: [],
    boundaries: [],
    ...Object.fromEntries(TRAIN_ENTRIES.map((e) => [e.list, []])),
  };
  if (!doc.frontmatter) return file;
  const fm = parseYaml(doc.frontmatter.text, doc.frontmatter.firstLine);
  file.problems.push(...fm.errors);
  file.data = fm.data;
  file.keyLines = fm.keyLines;
  file.frontmatter = { line: doc.frontmatter.firstLine - 1, end: doc.frontmatter.endLine };
  file.frontmatterLine = doc.frontmatter.firstLine;
  file.type = typeof fm.data.type === "string" ? fm.data.type : null;

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const { elements } = doc;
  elements.forEach((e, i) => {
    if (e.kind === "fence") file.fences.push({ lang: e.lang, line: e.line, end: e.endLine });
    else file.sections.push({ level: e.level, title: e.text, line: e.line, end: sectionEnd(elements, i, e.level, lines) });
  });
  const h1 = elements.find((e) => e.kind === "heading" && e.level === 1);
  if (h1) file.h1 = { line: h1.line, ...(keyedHeading(h1.text) ?? { key: null, text: h1.text }) };
  if (file.type === "feature" && h1) {
    const next = elements.find((e) => e.kind === "heading" && e.line > h1.line);
    file.intro = lines.slice(h1.line, next ? next.line - 1 : lines.length).join("\n").trim();
  }

  elements.forEach((e, i) => {
    if (e.kind !== "heading") return;
    const h = keyedHeading(e.text);
    if (file.type === "feature" && e.level === 3 && h && e.text.startsWith("rule_")) {
      const end = sectionEnd(elements, i, 3, lines);
      const fields = readFields(lines, e.line, end);
      file.rules.push({ key: h.key, statement: h.text, line: e.line, end, ...fields, elaboration: lines.slice(fields.fieldsEnd ?? e.line, end).join("\n").trim() });
    } else if (file.type === "feature" && e.level === 3 && h && e.text.startsWith("boundary_")) {
      const end = sectionEnd(elements, i, 3, lines);
      const first = lines.findIndex((line, index) => index >= e.line && index < end && line.trim());
      const owner = first === -1 ? null : /^Owner:\s*(.*)$/.exec(lines[first]);
      file.boundaries.push({ key: h.key, statement: h.text, owner: owner ? owner[1].trim() : null, line: e.line, end, elaboration: lines.slice(owner ? first + 1 : e.line, end).join("\n").trim() });
    } else if (file.type === "scenario" && e.level === 3 && h) {
      file.cases.push(parseEntry(file, h, /** @type {MarkdownHeadingElement} */ (e), elements, i, lines));
    } else if (file.type === "execution" && e.level === 3 && h) {
      file.executions.push(parseEntry(file, h, /** @type {MarkdownHeadingElement} */ (e), elements, i, lines));
    } else if (file.type === "train" && e.level === 3 && h && trainEntry(h.key)) {
      // A train entry reads like a case entry: heading, `yaml` block, prose. Its heading prefix
      // names its kind, and so the list it is kept in.
      const { summary, ...entry } = parseEntry(file, h, /** @type {MarkdownHeadingElement} */ (e), elements, i, lines);
      /** @type {ParsedEntry[]} */ (file[/** @type {TrainEntryDescriptor} */ (trainEntry(h.key)).list]).push({ ...entry, statement: summary });
    }
  });
  return file;
}

// Whether a file's frontmatter could be read: no parse problem sits on one of its lines. An
// unreadable file's frontmatter could not be read either. This is the one answer to that question,
// used by the Knowledge page's Feature inventory.
/**
 * @param {QaFile} file
 * @returns {boolean}
 */
export function frontmatterReadable(file) {
  if (file.unreadable !== undefined) return false;
  const frontmatter = file.frontmatter;
  return !(frontmatter && file.problems.some((problem) => problem.line !== undefined && problem.line <= frontmatter.end));
}

// The last line of the section headed by element `i`: the line before the next heading of `level`
// or above, or the file's last line.
/**
 * @param {MarkdownElement[]} elements
 * @param {number} i
 * @param {number} level
 * @param {string[]} lines
 * @returns {number}
 */
function sectionEnd(elements, i, level, lines) {
  const next = elements.findIndex((x, j) => j > i && x.kind === "heading" && x.level <= level);
  return next === -1 ? lines.length : elements[next].line - 1;
}

// The pattern each field name is read by: a field line is `<name>: <value>`.
const RULE_FIELD = new Map(RULE_FIELDS.map((name) => [name, new RegExp(`^${name}:\\s*(.*)$`)]));
// A Rule's field block: the contiguous run of field lines at the head of the Rule's body, from its
// first non-blank line. The block ends at the first line that is blank or is not a field line; the
// lines after it are the Rule's elaboration. Every field line is kept, in order and repeats
// included, and the first `Waived:` field is the Rule's Waiver (ADR-0039): its reason says why the
// Rule is left without a Test Case, never what the system must do.
/**
 * @param {string[]} lines
 * @param {number} from the Rule's heading line
 * @param {number} to the Rule's last line
 * @returns {{ fields: RuleField[], fieldsEnd: number | null, waiver: string | null, waiverLine: number | null }}
 */
function readFields(lines, from, to) {
  /** @type {RuleField[]} */
  const fields = [];
  let l = from + 1;
  while (l <= to && !lines[l - 1].trim()) l++;
  for (; l <= to; l++) {
    const field = fieldOf(lines[l - 1]);
    if (!field) break;
    fields.push({ ...field, line: l });
  }
  const waiver = fields.find((f) => f.name === "Waived");
  return {
    fields,
    fieldsEnd: fields.length ? fields[fields.length - 1].line : null,
    waiver: waiver ? waiver.value : null,
    waiverLine: waiver ? waiver.line : null,
  };
}

// The field a line carries, if it is one: its name and its trimmed value.
/**
 * @param {string} text
 * @returns {{ name: (typeof RULE_FIELDS)[number], value: string } | null}
 */
function fieldOf(text) {
  for (const [name, pattern] of RULE_FIELD) {
    const m = pattern.exec(text);
    if (m) return { name, value: m[1].trim() };
  }
  return null;
}

// An entry headed `### <key>: <text>`: its heading, the `yaml` block right after it, and the prose
// that follows up to the next heading of level 3 or above. `prose` holds `{line, text}` for every
// line outside a fence, so a label inside an example block is never read as a label. `end` is the
// entry's last line; `blockLine` and `blockEnd` are the block's opening and closing fence lines.
// `sections` partition the body after that block at unfenced bold labels: each has a kind, inclusive
// line range and trimmed raw text, including its label and any fenced blocks. Unknown labels are
// kept as `other`; unlabelled leading text is `lead`.
// The block's YAML errors join the file's `problems`.
/**
 * @param {ParsedFile} file
 * @param {{ key: string, text: string }} heading
 * @param {MarkdownHeadingElement} e
 * @param {MarkdownElement[]} elements
 * @param {number} i
 * @param {string[]} lines
 * @returns {CaseEntry}
 */
function parseEntry(file, heading, e, elements, i, lines) {
  const end = sectionEnd(elements, i, 3, lines);
  const block = elements[i + 1]?.kind === "fence" && /** @type {MarkdownFenceElement} */ (elements[i + 1]).lang === "yaml" ? /** @type {MarkdownFenceElement} */ (elements[i + 1]) : null;
  /** @type {CaseEntry} */
  const c = { key: heading.key, summary: heading.text, line: e.line, end, data: {}, keyLines: {}, blockLine: null, blockEnd: null, prose: [], sections: [] };
  if (block) {
    const y = parseYaml(block.text, block.firstLine);
    file.problems.push(...y.errors);
    c.data = y.data;
    c.keyLines = y.keyLines;
    c.blockLine = block.line;
    c.blockEnd = block.endLine;
  }
  const fenced = new Set();
  for (const f of elements) {
    if (f.kind === "fence" && f.line > e.line && f.line <= end) for (let l = f.line; l <= f.endLine; l++) fenced.add(l);
  }
  for (let l = e.line + 1; l <= end; l++) if (!fenced.has(l)) c.prose.push({ line: l, text: lines[l - 1] });
  const from = c.blockEnd ?? e.line;
  const body = lines.slice(from, end).map((text, i) => ({ text, labelEligible: !fenced.has(from + i + 1) }));
  c.sections = caseSectionRanges(body).map(({ kind, start, end: stop }) => ({ kind, line: from + start + 1, end: from + stop, text: body.slice(start, stop).map((line) => line.text).join("\n").trim() })).filter((section) => section.text);
  return c;
}

// `file` (from `parse`) with `changes` made, as `{ok, text, file, errors}`. Every change addresses
// the input file, by Key, never by line, and they are listed in any order:
//   {at?, set: {field: value}}  set fields of the frontmatter (`at` omitted or "frontmatter") or of
//                               the block of the entry `at` names (a case, a Rule, a train entry);
//                               `undefined`, `[]` and `{}` remove a field: no empty collection is
//                               written
//   {remove: Key}               drop that entry: its heading, block and prose
//   {append: text}              add an entry's text at the end, after one blank line
// A value is written as lib/schema.mjs's FIELD_RENDER says for its scope and field, and read back:
// one the dialect cannot hold is refused. A new field goes in the schema's order (KNOWN). Every
// other byte stays as it was, line endings included. An empty file takes frontmatter `set`s, so a
// new file is built here too.
//
// Atomic, and it never throws: if any change is refused, `ok` is false, `text` and `file` are the
// input's, `errors` lists every refusal `{code, at?, field?, line?, message}`, and `message` joins
// their messages with `; `:
//   unreadable  the file has problems (`parse`'s `problems`, one error each) or no frontmatter
//   no_entry    no entry declares the Key        ambiguous  more than one does
//   no_block    the entry has no `yaml` block    render     the dialect cannot hold the value
// An unreadable file is refused before any change is read, so its errors are all `unreadable`, and
// the result says `unreadable: true`: a writer that leaves such a file as it is, for its check to
// report, needs nothing else. On success, `file` is the new text parsed.
/**
 * @param {EditableFile} file
 * @param {readonly EditChange[]} changes
 * @returns {EditResult}
 */
export function edit(file, changes) {
  /** @type {EditError[]} */
  const errors = [];
  const refused = (unreadable = false) => ({ ok: /** @type {const} */ (false), unreadable, text: file.text, file: /** @type {ParsedFile} */ (file), errors, message: errors.map((e) => e.message).join("; ") });
  const blank = file.text.trim() === "";
  if (file.problems.length) {
    for (const p of file.problems) errors.push({ code: "unreadable", line: p.line, message: p.message });
    return refused(true);
  }
  if (!file.frontmatter && !blank) {
    errors.push({ code: "unreadable", message: "the file has no frontmatter to edit" });
    return refused(true);
  }

  const entries = [.../** @type {Array<{ key: string, line: number, end?: number, blockLine?: number | null, blockEnd?: number | null, [key: string]: unknown }>} */ (file.cases), ...(/** @type {Array<{ key: string, line: number, end?: number, blockLine?: number | null, blockEnd?: number | null, [key: string]: unknown }>} */ (file.executions)), .../** @type {Array<{ key: string, line: number, end?: number, [key: string]: unknown }>} */ (file.rules), .../** @type {Array<{ key: string, line: number, end?: number, [key: string]: unknown }>} */ (file.boundaries), ...TRAIN_ENTRIES.flatMap(({ list }) => /** @type {Array<{ key: string, line: number, end?: number, blockLine?: number | null, blockEnd?: number | null, [key: string]: unknown }>} */ (file[list]))];
  /** @param {{ key: string, line: number, end?: number, blockLine?: number | null, blockEnd?: number | null, [key: string]: unknown }} e */
  const scopeOf = (e) => (/** @type {Array<{ key: string, line: number, end?: number, blockLine?: number | null, blockEnd?: number | null, [key: string]: unknown }>} */ (file.cases)).includes(e) ? "case" : (/** @type {Array<{ key: string, line: number, end?: number, blockLine?: number | null, blockEnd?: number | null, [key: string]: unknown }>} */ (file.executions)).includes(e) ? "execution_case" : null;
  /**
   * @param {string} key
   * @returns {{ key: string, line: number, end?: number, blockLine?: number | null, blockEnd?: number | null, [key: string]: unknown } | null}
   */
  const find = (key) => {
    const hits = entries.filter((e) => e.key === key);
    if (hits.length === 1) return hits[0];
    errors.push(hits.length
      ? { code: "ambiguous", at: key, message: `\`${key}\` is declared ${hits.length} times in ${file.rel}` }
      : { code: "no_entry", at: key, message: `no entry \`${key}\` in ${file.rel}` });
    return null;
  };
  /** @type {Array<[string, string | null]>} */
  const front = [];
  /** @type {Map<{ key: string, line: number, end?: number, blockLine?: number | null, blockEnd?: number | null, [key: string]: unknown }, Array<[string, string | null]>>} */
  const blocks = new Map(); // entry → [[field, rendered line or null]]
  /** @type {Set<{ key: string, line: number, end?: number, blockLine?: number | null, blockEnd?: number | null, [key: string]: unknown }>} */
  const removed = new Set();
  /** @type {string[]} */
  const appends = [];
  const type = /** @type {{ set: { type: string } } | undefined} */ (changes.find((c) => c.set && (c.at ?? "frontmatter") === "frontmatter" && typeof c.set.type === "string"))?.set.type ?? file.type;
  for (const change of changes) {
    if (change.append !== undefined) appends.push(change.append);
    else if (change.remove !== undefined) {
      const e = find(change.remove);
      if (e) removed.add(e);
    } else if ((change.at ?? "frontmatter") === "frontmatter") {
      for (const [field, value] of Object.entries(/** @type {Record<string, unknown>} */ (change.set))) front.push([field, renderField(type, field, value, undefined, errors)]);
    } else {
      const e = find(/** @type {string} */ (change.at));
      if (!e) continue;
      if (!e.blockLine) {
        errors.push({ code: "no_block", at: e.key, message: `\`${e.key}\` has no \`yaml\` block to edit` });
        continue;
      }
      const scope = scopeOf(e);
      if (!blocks.has(e)) blocks.set(e, []);
      for (const [field, value] of Object.entries(/** @type {Record<string, unknown>} */ (change.set))) /** @type {Array<[string, string | null]>} */ (blocks.get(e)).push([field, renderField(scope, field, value, e.key, errors)]);
    }
  }
  if (errors.length) return refused();

  const eol = blank ? "\n" : /** @type {string} */ (file.eol);
  let lines = file.text.split(/\r?\n/);
  // Bottom-up, so every line the input file gave still holds.
  /** @type {Array<{ line: number, e: { key: string, line: number, end?: number, blockLine?: number | null, blockEnd?: number | null, [key: string]: unknown }, sets?: Array<[string, string | null]> }>} */
  const regions = [...[...blocks].filter(([e]) => !removed.has(e)).map(([e, sets]) => ({ line: /** @type {number} */ (e.blockLine), e, sets })), ...[...removed].map((e) => ({ line: e.line, e }))];
  for (const { e, sets } of regions.sort((a, b) => b.line - a.line)) {
    if (sets) lines.splice(/** @type {number} */ (e.blockLine), /** @type {number} */ (e.blockEnd) - 1 - /** @type {number} */ (e.blockLine), ...setKeys(lines.slice(/** @type {number} */ (e.blockLine), /** @type {number} */ (e.blockEnd) - 1), sets, KNOWN[/** @type {string} */ (scopeOf(e))] ?? []));
    else lines.splice(e.line - 1, /** @type {number} */ (e.end) - e.line + 1);
  }
  if (front.length) {
    if (!file.frontmatter) lines = ["---", "---", ...lines];
    const end = lines.indexOf("---", 1);
    lines.splice(1, end - 1, ...setKeys(lines.slice(1, end), front, KNOWN[/** @type {string} */ (type)] ?? []));
  }
  let text = lines.join(eol);
  if (removed.size) text = `${text.replace(/(\r?\n)*$/, "")}${eol}`;
  if (appends.length) {
    const body = appends.map((a) => a.replace(/\r?\n+$/, "").split(/\r?\n/).join(eol));
    text = `${text.replace(/(\r?\n)+$/, "")}${eol}${eol}${body.join(eol + eol)}${eol}`;
  }
  return { ok: true, text, file: parse(/** @type {string} */ (file.rel), text), errors };
}

// `field: value` as lines of one YAML block, or null to remove it; a refusal joins `errors`.
/**
 * @param {string | null | undefined} scope
 * @param {string} field
 * @param {unknown} value
 * @param {string | undefined} at
 * @param {EditError[]} errors
 * @returns {string | null}
 */
function renderField(scope, field, value, at, errors) {
  const rule = { ...FIELD_RENDER["*"][field], ...FIELD_RENDER[/** @type {string} */ (scope)]?.[field] };
  if (value === undefined || (!rule.keepEmpty && Array.isArray(value) && value.length === 0) || (isMap(value) && Object.keys(/** @type {object} */ (value)).length === 0)) return null;
  const options = { strings: rule.quoted ?? [], item: rule.item === "role" ? role : token };
  const refuse = () => {
    errors.push({ code: "render", ...(at !== undefined && { at }), field, message: `\`${field}\` cannot be written in the YAML dialect: ${JSON.stringify(value)}` });
    return null;
  };
  try {
    return (rule.blockList ? block(field, /** @type {unknown[]} */ (value), options) : line(field, value, options)).text ?? refuse();
  } catch {
    return refuse();
  }
}

// The lines of one YAML block (a case block or a frontmatter, without its fences) with `sets`
// (`[field, text or null]`) made: a field's line and any continuation lines replaced, or a new one
// put before the first present field `order` places after it, else at the end; null removes it.
/**
 * @param {string[]} lines
 * @param {Array<[string, string | null]>} sets
 * @param {readonly string[]} order
 * @returns {string[]}
 */
function setKeys(lines, sets, order) {
  let out = lines;
  for (const [field, text] of sets) {
    const { keyLines } = parseYaml(out.join("\n"), 1);
    const at = keyLines[field];
    const add = text === null ? [] : text.split("\n");
    if (at) {
      let end = at;
      while (end < out.length && /^\s+\S/.test(out[end])) end++;
      out = [...out.slice(0, at - 1), ...add, ...out.slice(end)];
      continue;
    }
    if (text === null) continue;
    const after = /** @type {number[]} */ (order.slice(order.indexOf(field) + 1).map((k) => keyLines[k]).filter(Boolean));
    let to = after.length ? Math.min(...after) - 1 : out.length;
    if (!after.length) while (to > 0 && !out[to - 1].trim()) to--;
    out = [...out.slice(0, to), ...add, ...out.slice(to)];
  }
  return out;
}

// `project.md`'s configuration: the one reading of it. `project` is the parsed `project.md`, or
// null when there is none (a case key can then only be a minted one). Read defensively: a missing or
// malformed field is empty, so the relational checks still run and the project file's own problems
// are reported once, by its own check.
/**
 * The parsed `project.md` a config reads, or null when there is none.
 * @typedef {{ data?: Record<string, unknown> } | null | undefined} ProjectSource
 */

/**
 * @param {ProjectSource} [project]
 * @returns {ProjectConfig}
 */
export function projectConfig(project) {
  const d = project?.data ?? {};
  const tracker = isMap(d.tracker) ? d.tracker : {};
  /** @param {unknown} v */
  const list = (v) => (Array.isArray(v) ? /** @type {string[]} */ (v.filter((x) => typeof x === "string")) : []);
  return {
    // The `project.md` schema the file declares: 1 when it declares none, and null when what
    // it declares is no `schema_version` (check-file's `invalid`).
    schemaVersion: /** @type {number} */ (d.schema_version === undefined ? 1 : isSchemaVersion(d.schema_version) ? d.schema_version : null),
    roles: new Set(list(d.roles)),
    labels: labelDefinitions(d),
    levels: new Set(list(isMap(d.stack) ? d.stack.levels : undefined)),
    trackerPattern: isMap(d.tracker) ? compileKeyPattern(d.tracker.key_pattern) : null,
    // The Automation-key test, and whether the project's own tool mints its keys (so `/qa-sync`
    // mints none).
    autPattern: automationKeyPattern(d.automation_key_pattern, d.automation_key_mint),
    autExternal: d.automation_key_pattern !== undefined,
    // The `automation_key_mint` recipe the framework mints from (ADR-0013), when the project sets
    // it and not the pattern too. `autMints` is whether `/qa-sync` mints at all: not for a project
    // whose own tool does, nor while its recipe is unusable (check-file's `invalid`), which
    // `autMintProblem` says why.
    ...recipeConfig(d),
    tiers: isMap(d.tiers) ? /** @type {Record<string, string>} */ (d.tiers) : {},
    targets: isMap(d.targets) ? /** @type {Record<string, string>} */ (d.targets) : undefined,
    execute_levels: /** @type {Record<string, string>} */ (isMap(d.execute_levels) ? d.execute_levels : undefined),
    // The hosts `observe:` may look at, lower-cased: null when `scout.allowed_hosts` is absent,
    // no restriction; `[]` when `observe:` is off, as it is while the value is not a list.
    allowedHosts: isMap(d.scout) && d.scout.allowed_hosts !== undefined ? list(d.scout.allowed_hosts).map((h) => h.toLowerCase()) : null,
    modulePaths: list(d.module_paths),
    test_runner: isMap(d.test_runner) ? /** @type {TestRunner} */ ({ ...d.test_runner, dir: d.test_runner.dir ?? ".", ...(d.test_runner.tool === "gradle" && { task: d.test_runner.task ?? GRADLE_DEFAULT_TASK }) }) : undefined,
    code_host: isMap(d.code_host) ? /** @type {CodeHost} */ (d.code_host) : undefined,
    bug_publish: hasBugPublishTracker(project) ? /** @type {BugPublishConfig} */ ({ issue_type: tracker.bug_type, link_type: tracker.bug_link_type, direction: tracker.bug_link_direction, fields: d.bug_fields ?? [] }) : undefined,
    stack: isMap(d.stack) ? /** @type {{ language: string, framework: string, root: string }} */ ({ language: d.stack.language, framework: d.stack.framework, root: d.stack.root ?? "." }) : null,
    annotationMap: isMap(d.annotation_map) ? /** @type {Record<string, string[]>} */ (d.annotation_map) : {},
  };
}

/**
 * Whether the whole bug-publishing group is configured. Shared by Publish and the Run summary.
 * @param {ProjectSource} [project]
 * @returns {boolean}
 */
export function hasBugPublishTracker(project) {
  const tracker = project?.data?.tracker;
  return isMap(tracker) && [tracker.bug_type, tracker.bug_link_type].every((v) => typeof v === "string" && v.trim().length > 0) &&
    (tracker.bug_link_direction === "outward" || tracker.bug_link_direction === "inward");
}

/**
 * @param {Record<string, unknown>} d
 * @returns {{
 *   autRecipe: MintRecipe | null,
 *   autMints: boolean,
 *   autMintReason?: string,
 *   autMintProblem?: string,
 * }}
 */
function recipeConfig(d) {
  if (d.automation_key_mint === undefined) return { autRecipe: null, autMints: d.automation_key_pattern === undefined };
  // `autMintReason` names why, for text rendered from it: `both` (the pattern is set too),
  // `malformed` (the recipe does not parse), `no_prefix_annotation` (no class annotation for it).
  /**
   * @param {string} why
   * @param {string} reason
   * @returns {{ autRecipe: null, autMints: false, autMintReason: string, autMintProblem: string }}
   */
  const unusable = (why, reason) => ({ autRecipe: null, autMints: false, autMintReason: reason, autMintProblem: `${why}: no Automation key is minted until \`project.md\` is fixed` });
  if (d.automation_key_pattern !== undefined) return unusable("`project.md` sets both `automation_key_mint` and `automation_key_pattern`", "both");
  const { recipe, error } = parseMintRecipe(d.automation_key_mint);
  if (error) return unusable(error, "malformed");
  if (!isMap(d.annotation_map) || !Array.isArray(d.annotation_map.automation_key_prefix) || !d.annotation_map.automation_key_prefix.length) {
    return unusable("`automation_key_mint` needs `annotation_map.automation_key_prefix`, the class annotation carrying the Key prefix", "no_prefix_annotation");
  }
  return { autRecipe: /** @type {MintRecipe} */ (recipe), autMints: true };
}

/**
 * What `parseTree` reads: the `[rel, text]` pairs of a tree read, as any of its readers iterates
 * them (an array, a Map, or a generator). Written structurally because `Iterable`'s own type
 * carries `any` in its signature.
 * @typedef {{
 *   [Symbol.iterator](): { next(...args: [] | [unknown]): IteratorResult<readonly [string, string | { unreadable: string }], void> },
 * }} TreeSource
 */

// Parsed files from `[rel, text]` pairs, in their order: the one cross-file seam. A working tree
// (`qa-index.mjs` `readWorkingTree`) and a revision (`git-tree.mjs` `readQaAt`) both fill it. An
// entry whose text could not be read is `[rel, {unreadable: message}]`, and stays
// `{rel, unreadable}`.
/**
 * @param {TreeSource} entries
 * @returns {Array<ParsedFile | UnreadableFile>}
 */
export function parseTree(entries) {
  return [...entries].map(([rel, text]) => (typeof text === "string" ? parse(rel, text) : { rel, unreadable: text.unreadable }));
}
