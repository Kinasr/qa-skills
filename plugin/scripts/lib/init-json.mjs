// @ts-check
// Init output data and refusals for the model to word.
/**
 * @import { AgentPointer } from "./agent-pointer.mjs"
 * @import { SmokeOutcome, SmokeStarted } from "./init-smoke.mjs"
 * @import { ReportSection, SectionSpec } from "./report-sections.mjs"
 */
import { refusalsWithoutLines, object, readDecisions } from "./refusal.mjs";
import { glossaryOf } from "./labels.mjs";
import { MINTING } from "./init-minting.mjs";
import { line } from "./render.mjs";
import { buildSections } from "./report-sections.mjs";

/**
 * The evidence a value came from: what was read in the repository or the tracker, what was asked,
 * what was defaulted, picked or edited.
 * @typedef {{
 *   file?: string,
 *   tracker?: string,
 *   count?: number,
 *   sample?: string,
 *   hint?: string,
 *   asked?: true,
 *   default?: true,
 *   picked?: true,
 *   edited?: true,
 * }} InitEvidence
 */

/**
 * A setting of the first-run card as `init` builds it: its number, its label, the answers it takes
 * and why it may be dropped.
 * @typedef {object} InitFieldSource
 * @property {number} n
 * @property {"field"} kind
 * @property {string} label
 * @property {readonly string[]} edits
 * @property {readonly string[]} needs
 * @property {string} drop
 * @property {boolean} [question]
 * @property {string} type
 * @property {unknown} value
 * @property {InitEvidence | null} evidence
 * @property {unknown} [default]
 * @property {boolean} [smokePassed]
 */

/**
 * The test stack of the first-run card as `init` builds it: the one the card binds, and why.
 * @typedef {object} InitStackSource
 * @property {number} n
 * @property {"stack"} kind
 * @property {string} label
 * @property {readonly string[]} edits
 * @property {readonly string[]} needs
 * @property {string} drop
 * @property {boolean} [question]
 * @property {number | null} chosen
 * @property {string | null} by
 */

/**
 * Who mints Automation keys on the first-run card as `init` builds it: the option the interview
 * settled, the options there are, and what each setting was given.
 * @typedef {object} InitMintingSource
 * @property {number} n
 * @property {"minting"} kind
 * @property {string} label
 * @property {readonly string[]} edits
 * @property {readonly string[]} needs
 * @property {string} drop
 * @property {boolean} [question]
 * @property {number} [choice]
 * @property {readonly number[]} options
 * @property {Readonly<Record<string, { value: unknown, evidence: InitEvidence | null }>>} given
 */

/**
 * One item of the first-run card as `init` builds it.
 * @typedef {InitFieldSource | InitStackSource | InitMintingSource} InitCardItem
 */

/**
 * A test stack the card shows: what the repository holds.
 * @typedef {object} InitStack
 * @property {string} root
 * @property {string} [language]
 * @property {string} [framework]
 * @property {number} [count]
 * @property {string} [sample]
 * @property {string} [last_commit]
 * @property {readonly { file: string, line?: number, quote: string }[]} [guidance]
 */

/**
 * A test stack as `init` builds it, with the one the card binds marked.
 * @typedef {InitStack & { chosen: boolean }} InitStackRow
 */

/**
 * A note's line, and the glossary term it uses.
 * @typedef {{ line: string, term?: string }} InitNoteText
 */

/**
 * A note the card shows: its code and the line it says, and the values it is about when it has them.
 * @typedef {{ code: string, line: string, overlaps?: string[] }} InitNote
 */

/**
 * A glossary piece: a term the card uses and what it means.
 * @typedef {{ term: string, explanation: string }} InitGlossary
 */

/**
 * The answers the decisions may give, and what each one takes.
 * @typedef {{ value: string, stack: string, minting: string }} InitFields
 */

/**
 * A setting of the first-run card as the card shows it.
 * @typedef {object} InitFieldItem
 * @property {number} n
 * @property {"field"} kind
 * @property {string} label
 * @property {readonly string[]} needs
 * @property {readonly string[]} edits
 * @property {string} drop
 * @property {string} type
 * @property {unknown} value
 * @property {InitEvidence | null} evidence
 * @property {unknown} [default]
 * @property {true} [smoke_passed]
 */

/**
 * The test stack as the card shows it: the one the card binds, and why.
 * @typedef {object} InitStackItem
 * @property {number} n
 * @property {"stack"} kind
 * @property {string} label
 * @property {readonly string[]} needs
 * @property {readonly string[]} edits
 * @property {string} drop
 * @property {string | null} chosen
 * @property {string | null} by
 */

/**
 * Who mints Automation keys as the card shows it: the option, the options there are, and what each
 * setting was given.
 * @typedef {object} InitMintingItem
 * @property {number} n
 * @property {"minting"} kind
 * @property {string} label
 * @property {readonly string[]} needs
 * @property {readonly string[]} edits
 * @property {string} drop
 * @property {number} [choice]
 * @property {readonly { k: number, label: string, settled: boolean }[]} options
 * @property {readonly { label: string, value: unknown, evidence: InitEvidence | null }[]} given
 */

/**
 * One item of the first-run card.
 * @typedef {InitFieldItem | InitStackItem | InitMintingItem} InitItem
 */

/**
 * A Tier the engineer picked in the interview: no item number and no answer to give.
 * @typedef {object} InitPickedTier
 * @property {string} label
 * @property {unknown} value
 * @property {true} [smoke_passed]
 */

/**
 * The first-run or maintenance card JSON output (`init card`).
 * @typedef {object} InitCardJson
 * @property {ReportSection[]} sections
 * @property {readonly InitGlossary[]} glossary
 */

/**
 * The apply report JSON output (`init apply` on `ok: true`).
 * @typedef {object} InitApplyJson
 * @property {string | null} commit
 * @property {readonly InitGlossary[]} glossary
 * @property {ReportSection[]} sections
 */

/**
 * The confirmation JSON output (`init apply` on `confirm: true`).
 * @typedef {object} InitConfirmJson
 * @property {Record<string, unknown>} decisions
 * @property {readonly InitGlossary[]} glossary
 * @property {ReportSection[]} sections
 */

/**
 * A setting of the maintenance card as `init` builds it: what the file holds, and what detection
 * found beside it.
 * @typedef {object} InitMaintenanceSource
 * @property {number} n
 * @property {string} label
 * @property {readonly string[]} edits
 * @property {string} drop
 * @property {string} type
 * @property {unknown} [current]
 * @property {boolean} [adopt]
 * @property {unknown} [detected]
 * @property {InitEvidence | null} [evidence]
 * @property {{ errors: number, unread: number }} [effect]
 * @property {readonly string[]} [needs] What the Reply must answer (an edit, an adoption or a drop).
 */

/**
 * A check error of a file, as the maintenance card shows it.
 * @typedef {{ code: string, label?: string, at_line?: number, message: string }} InitCheckError
 */

/**
 * A setting of the maintenance card as the card shows it: what the file holds, what was detected
 * beside it, and what adopting it would cause.
 * @typedef {object} InitMaintenanceItem
 * @property {number} n
 * @property {string} label
 * @property {string} type
 * @property {unknown} current
 * @property {unknown} [detected]
 * @property {InitEvidence | null} [evidence]
 * @property {true} [adopt]
 * @property {readonly string[]} edits
 * @property {string} drop
 * @property {{ errors: number, unread: number }} [effect]
 * @property {readonly string[]} [needs]
 */

/**
 * An unread key annotation, as the report shows it.
 * @typedef {{ role: string, place: string, key: string, name: string }} InitUnread
 */

// Stable refusal codes carry facts; the model supplies the explanation and the next step.
export const { fact, refuse, refusalOf } = refusalsWithoutLines((code, data) => ({
  ...(code === "no_proposal" || code === "apply_needs_stdin" ? { input: "--input <path> | --stdin" } : {}),
  ...data,
}));

/**
 * Ordered section registry for `init state`.
 * @type {readonly SectionSpec[]}
 */
export const STATE_SECTION_ORDER = [
  { id: "agent_pointer", label: "Agent pointer" },
];

/**
 * Top-level keys allowed outside `sections` on `init state`.
 * @type {readonly string[]}
 */
export const STATE_ALLOWED_OUTSIDE = ["mode", "migration", "ok", "train", "access"];

/**
 * `init state` JSON output: working inputs (`train`, `access`) outside, and the Agent pointer inside `sections`.
 * @param {{ train: unknown, access: unknown, pointer: AgentPointer }} data
 * @returns {{ ok: true, train: unknown, access: unknown, sections: ReportSection[] }}
 */
export function stateData({ train, access, pointer }) {
  /** @type {ReportSection[]} */
  const sections = buildSections(STATE_SECTION_ORDER, [
    { id: "agent_pointer", items: [pointer] },
  ]);
  return { ok: true, train, access, sections };
}

/**
 * Ordered section registry for `init smoke`.
 * @type {readonly SectionSpec[]}
 */
export const SMOKE_SECTION_ORDER = [
  { id: "smoke_failure", label: "Smoke-test failure" },
];

/**
 * Top-level keys allowed outside `sections` on `init smoke`.
 * @type {readonly string[]}
 */
export const SMOKE_ALLOWED_OUTSIDE = ["mode", "migration", "ok", "dir", "model", "brief", "prompt", "reply"];

/**
 * `init smoke` start JSON output: handoff paths outside and empty `sections`.
 * @param {string} dir
 * @param {string} model
 * @param {SmokeStarted} started
 * @returns {{ ok: true, dir: string, model: string, brief: string, prompt: string, reply: string, sections: ReportSection[] }}
 */
export function smokeStartData(dir, model, started) {
  return { ok: true, dir, model, ...started, sections: buildSections(SMOKE_SECTION_ORDER, []) };
}

/**
 * `init smoke --reply` JSON output: failure details inside `sections` when `ok: false`.
 * @param {string} dir
 * @param {string} model
 * @param {SmokeOutcome} outcome
 * @returns {{ ok: boolean, dir: string, model: string, sections: ReportSection[] }}
 */
export function smokeResultData(dir, model, outcome) {
  /** @type {ReportSection[]} */
  const sections = buildSections(SMOKE_SECTION_ORDER, [
    {
      id: "smoke_failure",
      items: outcome.ok ? [] : [{ reason: outcome.reason, ...(outcome.excerpt !== undefined && { excerpt: outcome.excerpt }) }],
    },
  ]);
  return { ok: outcome.ok, dir, model, sections };
}

/**
 * Ordered section registry for `init add-role`.
 * @type {readonly SectionSpec[]}
 */
export const ADD_ROLE_SECTION_ORDER = [
  { id: "added", label: "Added roles" },
  { id: "already", label: "Already present" },
];

/**
 * Top-level keys allowed outside `sections` on `init add-role`.
 * @type {readonly string[]}
 */
export const ADD_ROLE_ALLOWED_OUTSIDE = ["mode", "migration", "ok", "path", "commit"];

/**
 * `init add-role` JSON output: path and commit command outside, and added/already roles inside `sections`.
 * @param {{ path: string, added: readonly string[], already: readonly string[], commit: string | null }} data
 * @returns {{ ok: true, path: string, commit: string | null, sections: ReportSection[] }}
 */
export function addRoleData({ path, added, already, commit }) {
  /** @type {ReportSection[]} */
  const sections = buildSections(ADD_ROLE_SECTION_ORDER, [
    { id: "added", items: added },
    { id: "already", items: already },
  ]);
  return { ok: true, path, commit, sections };
}

// What a note says, with the glossary term it uses.
/** @type {Record<string, InitNoteText>} */
export const NOTES = {
  automation_key_overlap: { line: "The Automation-key pattern matches a documented `tc_`/`ts_`/`su_` witness sample. A pattern matching none of the samples is not proven disjoint." },
  no_tracker: { line: "No tracker: nothing is published." },
  tracker_key_without_tracker: { line: "A tracker-key annotation is named, but there is no tracker, so no tracker key can match its values." },
  no_playwright_cli: { line: "`playwright-cli` is not on the PATH, so `/qa-execute` cannot run Test Cases in the application and `/qa-deep-dive`'s `observe:` input cannot look at it until it is installed (`npm install -g @playwright/cli@latest`). Nothing on this card needs it." },
  refused_playwright_cli: { line: "`playwright-cli` resolved on PATH was refused by Windows executable policy, so `/qa-execute` and `/qa-deep-dive`'s `observe:` input cannot run it until a supported `.exe` or `@playwright/cli` shim is installed. Nothing on this card needs it." },
  old_playwright_cli: { line: "`playwright-cli` is older than 0.1.22, or its version could not be read, so `/qa-execute` will refuse to run until it is upgraded (`npm install -g @playwright/cli@latest`). Nothing on this card needs it." },
  label_repeats_category: { line: "A Custom-field value repeats a Coverage category key. A team category is never a Coverage category: Coverage still derives from Rules and `covers`, so pick a different value if the two could be confused.", term: "Custom field" },
  target_env_multiple_origins: { line: "Every `test_runner.target_env` variable is set to the Run's one origin on every Run; on a project with Level targets (`level_targets`), list only the variables for that Run's origin so any other-origin variable keeps the test configuration's own default.", term: "Level target" },
  commit_before_persist: { line: "Commit `.qa/` before the first `/qa-design` settle, which refuses a `.qa/` holding uncommitted changes." },
};
/** @type {InitFields} */
const FIELDS = { value: "the value to write", stack: "the test stack, by its root", minting: "who mints Automation keys, by option number" };

/**
 * A note as a card or report shows it: its code and line, and the values it is about when it has them.
 * @param {{ code: string, overlaps?: string[] }} note
 * @returns {InitNote}
 */
export const noteOf = ({ code, overlaps }) => ({ code, line: NOTES[code].line, ...(overlaps && { overlaps }) });

/**
 * The notes a card shows, each with the line it says and the glossary term it uses.
 * @param {readonly { code: string, overlaps?: string[] }[]} notes
 * @param {Set<string>} terms
 * @returns {InitNote[]}
 */
const notesOf = (notes, terms) => notes.map((note) => {
  const { term } = NOTES[note.code];
  if (term) terms.add(term);
  return noteOf(note);
});

/**
 * A problem with the decisions, as a refusal fact.
 * @typedef {{ code: string, item?: number | string, field?: string, reason?: string }} InitDecisionError
 */

/**
 * The decisions read from the agent's JSON, checked against the items the card showed.
 * @typedef {object} InitDecisions
 * @property {Record<string, unknown>} input
 * @property {number[]} take
 * @property {number[]} drop
 * @property {Record<string, Record<string, unknown>>} edits
 * @property {number[]} confirm
 * @property {InitDecisionError[]} errors
 */

/**
 * Ordered section registry for `init card` (first run and maintenance).
 * @type {readonly SectionSpec[]}
 */
export const CARD_SECTION_ORDER = [
  { id: "counts", label: "Summary" },
  { id: "check", label: "Project check errors" },
  { id: "notes", label: "Notes" },
  { id: "items", label: "Card items" },
  { id: "picked_tiers", label: "Picked Tiers" },
  { id: "fallback", label: "Fallback" },
  { id: "stacks", label: "Test stacks" },
  { id: "files", label: "Files to write" },
  { id: "answer_fields", label: "Allowed answer fields" },
];

/**
 * Top-level keys allowed outside `sections` on `init card`.
 * @type {readonly string[]}
 */
export const CARD_ALLOWED_OUTSIDE = ["mode", "migration", "ok", "dir", "glossary"];

/**
 * Ordered section registry for `init apply` (`ok: true`).
 * @type {readonly SectionSpec[]}
 */
export const APPLY_SECTION_ORDER = [
  { id: "applied", label: "Applied items" },
  { id: "dropped", label: "Dropped items" },
  { id: "files", label: "Written files" },
  { id: "notes", label: "Notes" },
  { id: "snippet", label: "Automation-key declaration" },
  { id: "todo_errors", label: "Integrity errors introduced" },
  { id: "todo_unread", label: "Unread key annotations" },
  { id: "words", label: "Key annotation terms" },
];

/**
 * Top-level keys allowed outside `sections` on `init apply` (`ok: true`).
 * @type {readonly string[]}
 */
export const APPLY_ALLOWED_OUTSIDE = ["mode", "migration", "ok", "dir", "commit", "glossary"];

/**
 * Ordered section registry for `init apply` (`confirm: true`).
 * @type {readonly SectionSpec[]}
 */
export const CONFIRM_SECTION_ORDER = [
  { id: "changes", label: "Changes needing confirmation" },
  { id: "words", label: "Key annotation terms" },
];

/**
 * Top-level keys allowed outside `sections` on `init apply` (`confirm: true`).
 * @type {readonly string[]}
 */
export const CONFIRM_ALLOWED_OUTSIDE = ["mode", "migration", "ok", "confirm", "rebuild", "dir", "decisions", "glossary"];

/**
 * `init apply` report JSON output: `commit` and `glossary` outside, and outcomes inside `sections`.
 * @param {{
 *   applied: readonly number[],
 *   dropped: readonly number[],
 *   files: readonly string[],
 *   commit: string | null,
 *   notes?: readonly InitNote[],
 *   snippet: Record<string, unknown> | null,
 *   todo?: { errors: readonly unknown[], unread: readonly InitUnread[] },
 *   words?: unknown,
 *   glossary: readonly InitGlossary[],
 * }} data
 * @returns {InitApplyJson}
 */
export function applyReportData({ applied, dropped, files, commit, notes = [], snippet, todo, words, glossary }) {
  /** @type {ReportSection[]} */
  const sections = buildSections(APPLY_SECTION_ORDER, [
    { id: "applied", items: applied },
    { id: "dropped", items: dropped },
    { id: "files", items: files },
    { id: "notes", items: notes },
    { id: "snippet", items: snippet ? [snippet] : [] },
    { id: "todo_errors", items: todo?.errors ?? [] },
    { id: "todo_unread", items: todo?.unread ?? [] },
    { id: "words", items: words !== undefined ? [words] : [] },
  ]);
  return { commit, glossary, sections };
}

/**
 * `init apply` confirmation JSON output: `decisions` and `glossary` outside, and changes/terms inside `sections`.
 * @param {{
 *   changes: readonly unknown[],
 *   words: unknown,
 *   glossary: readonly InitGlossary[],
 *   decisions: Record<string, unknown>,
 * }} data
 * @returns {InitConfirmJson}
 */
export function confirmData({ changes, words, glossary, decisions }) {
  /** @type {ReportSection[]} */
  const sections = buildSections(CONFIRM_SECTION_ORDER, [
    { id: "changes", items: changes },
    { id: "words", items: words !== undefined ? [words] : [] },
  ]);
  return { decisions, glossary, sections };
}

// The first-run card: every setting with the evidence it came from, the test stack, who mints keys,
// and the file it would write.
/**
 * @param {{
 *   items: readonly InitCardItem[],
 *   picked_tiers: readonly InitPickedTier[],
 *   stacks: readonly InitStackRow[],
 *   files: readonly { path: string, text: string }[],
 *   notes: readonly { code: string, overlaps?: string[] }[],
 * }} card
 * @param {(field: string) => string} fieldLabelOf
 * @returns {InitCardJson}
 */
export function firstCardData({ items, picked_tiers, stacks, files, notes }, fieldLabelOf) {
  const terms = new Set(["Tier", "Fallback"]);
  const shown = items.map((i) => {
    const out = { n: i.n, kind: i.kind, label: i.label, needs: i.needs, edits: i.edits, drop: i.drop };
    if (i.kind === "field") {
      if (i.label === "Roles") terms.add("Role");
      if (i.label.includes("Tags")) terms.add("Tag");
      if (i.label === "Custom fields") terms.add("Custom field");
      if (i.label.includes("Key prefix")) terms.add("Key prefix");
      if (i.label.includes("Tracker key")) terms.add("Tracker key");
      if (i.label === "Targets") terms.add("Target");
      if (i.label === "Execution levels") terms.add("Execution mode");
      if (i.label === "Level targets") terms.add("Level target");
      Object.assign(out, { type: i.type, value: i.value, evidence: i.evidence, ...(i.default !== undefined && { default: i.default }), ...(i.smokePassed && { smoke_passed: true }) });
    } else if (i.kind === "stack") {
      Object.assign(out, { chosen: i.chosen === null ? null : stacks[i.chosen].root, by: i.by });
    } else {
      if (i.options.includes(3)) terms.add("Key prefix");
      Object.assign(out, { choice: i.choice, options: MINTING.map((o) => ({ k: o.k, label: o.label, settled: i.options.includes(o.k) })), given: Object.entries(i.given).map(([f, g]) => ({ label: fieldLabelOf(f), ...g })) });
    }
    return /** @type {InitItem} */ (out);
  });
  /** @type {ReportSection[]} */
  const sections = buildSections(CARD_SECTION_ORDER, [
    { id: "counts", items: [{ items: items.length, questions: items.filter((i) => i.question).length }] },
    { id: "notes", items: notesOf(notes, terms) },
    { id: "items", items: shown },
    { id: "picked_tiers", items: picked_tiers },
    { id: "fallback", items: ["inherit"] },
    { id: "stacks", items: stacks.map(({ chosen, ...s }) => s) },
    { id: "files", items: files.map(({ path, text }) => ({ path, frontmatter: text.slice(0, text.indexOf("\n---\n", 4) + 4) })) },
    { id: "answer_fields", items: [FIELDS] },
  ]);
  return { sections, glossary: glossaryOf(terms) };
}

// The maintenance card: every setting as `project.md` holds it, with fresh detection beside it where it disagrees.
/**
 * @param {{
 *   items: readonly InitMaintenanceSource[],
 *   check: readonly InitCheckError[],
 *   notes: readonly { code: string, overlaps?: string[] }[],
 * }} card
 * @returns {InitCardJson}
 */
export function maintenanceCardData({ items, check, notes }) {
  const terms = new Set();
  /** @type {readonly InitMaintenanceItem[]} */
  const shown = items.map((i) => {
    if (i.label === "Roles") terms.add("Role");
    if (i.label.includes("Tags")) terms.add("Tag");
    if (i.label === "Custom fields") terms.add("Custom field");
    if (i.label.includes("Key prefix")) terms.add("Key prefix");
    if (i.label.includes("Tier")) terms.add("Tier");
    if (i.label === "Targets") terms.add("Target");
    if (i.label === "Execution levels") terms.add("Execution mode");
    if (i.label === "Level targets") terms.add("Level target");
    return {
      n: i.n,
      label: i.label,
      type: i.type,
      current: i.current ?? null,
      ...(i.adopt && { detected: i.detected, evidence: i.evidence, adopt: true }),
      edits: i.edits,
      drop: i.drop,
      ...(i.effect && { effect: i.effect }),
      ...(i.needs && { needs: i.needs }),
    };
  });
  if (items.some((i) => i.effect && i.effect.errors + i.effect.unread > 0)) terms.add("Integrity error");
  /** @type {ReportSection[]} */
  const sections = buildSections(CARD_SECTION_ORDER, [
    { id: "counts", items: [{ items: items.length, disagree: items.filter((i) => i.adopt).length }] },
    { id: "check", items: check },
    { id: "notes", items: notesOf(notes, terms) },
    { id: "items", items: shown },
    { id: "answer_fields", items: [FIELDS] },
  ]);
  return { sections, glossary: glossaryOf(terms) };
}

/**
 * An unread key annotation, as the report shows it: where it is, and what it keys.
 * @param {{ role: string, file: string, line: number, key: string, name: string }} a
 * @returns {InitUnread}
 */
export const unreadData = (a) => ({ role: a.role, place: `${a.file}:${a.line}`, key: a.key, name: a.name });

// Why a value is not what its answer takes: `type`, `blank`, `line` or `backslash`; null when it is.
/**
 * @param {string | undefined} type
 * @param {unknown} v
 * @returns {"type" | "blank" | "line" | "backslash" | null}
 */
function badValue(type, v) {
  /**
   * @param {unknown} s
   * @returns {"type" | "blank" | "line" | "backslash" | null}
   */
  const text = (s) => (typeof s !== "string" ? "type" : !s.trim() ? "blank" : /[\n\r\p{Zl}\p{Zp}]/u.test(s) ? "line" : s.includes("\\") ? "backslash" : null);
  if (type === "list") return Array.isArray(v) ? v.map(text).find(Boolean) ?? null : "type";
  if (type === "map") return !object(v) ? "type" : line("value", v).error ? "line" : null;
  if (type === "records") return !Array.isArray(v) || !v.every(object) ? "type" : v.some((record) => line("value", record).error) ? "line" : null;
  return type === "integer" || type === "option" ? (Number.isSafeInteger(v) ? null : "type") : text(v);
}

/**
 * How each answer is read: a setting's own kind, a test stack as text, or an option number.
 * @type {Record<string, (item: InitCardItem) => string | undefined>}
 */
const TYPES = { value: (item) => /** @type {{ type?: string }} */ (item).type, stack: () => "text", minting: () => "option" };

// First-run decisions take or drop items; maintenance adopts or edits named items and confirms issued changes.
/**
 * @param {string} text
 * @param {readonly InitCardItem[]} items
 * @param {boolean} maintenance
 * @returns {InitDecisions | { errors: InitDecisionError[] }}
 */
export function decisionsOf(text, items, maintenance) {
  const lead = maintenance ? "adopt" : "take";
  const allowed = [lead, "drop", "edits", ...(maintenance ? ["confirm"] : [])];
  return readDecisions(text, items, {
    keys: allowed,
    lists: [lead, "drop", ...(maintenance ? ["confirm"] : [])],
    maps: [],
    drop: "drop",
    edits: "edits",
    confirm: "confirm",
    all: lead,
    allLiteral: !maintenance,
    maintenance,
    unknownFirst: true,
  }, (item, field, value) => badValue(TYPES[field](item), value));
}
