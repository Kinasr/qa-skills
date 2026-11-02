// @ts-check
// Init output data and refusals for the model to word.
import { validateEdits } from "./decisions.mjs";
import { refusalsFor, object, parseDecisions } from "./refusal.mjs";
import { glossaryOf } from "./labels.mjs";
import { MINTING } from "./init-minting.mjs";
import { line } from "./render.mjs";

/**
 * The evidence a value came from: what was read in the repository or the tracker, what was asked,
 * what was defaulted, picked or edited.
 * @typedef {{
 *   file?: string,
 *   tracker?: string,
 *   count?: number,
 *   sample?: string,
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
 * The first-run card, as `init` prints it.
 * @typedef {object} InitCardData
 * @property {{ items: number, questions: number }} counts
 * @property {readonly InitItem[]} items
 * @property {readonly InitStack[]} stacks
 * @property {"inherit"} fallback
 * @property {readonly { path: string, frontmatter: string }[]} files
 * @property {readonly InitNote[]} notes
 * @property {InitFields} fields
 * @property {readonly InitGlossary[]} glossary
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
 */

/**
 * The maintenance card, as `init` prints it.
 * @typedef {object} InitMaintenanceData
 * @property {{ items: number, disagree: number }} counts
 * @property {readonly InitCheckError[]} check
 * @property {readonly InitMaintenanceItem[]} items
 * @property {readonly InitNote[]} notes
 * @property {InitFields} fields
 * @property {readonly InitGlossary[]} glossary
 */

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
 * An unread key annotation, as the report shows it.
 * @typedef {{ role: string, place: string, key: string, name: string }} InitUnread
 */

// Stable refusal codes carry facts; the model supplies the explanation and the next step.
/** @type {Record<string, string>} */
export const REFUSALS = {
  // A call that cannot be made.
  bad_arguments: "The action takes no positional argument.",
  no_proposal: "The proposal is read from stdin: pass --stdin.",
  proposal_not_json: "The proposal on stdin is not JSON.",
  needs_dir: "The action needs the run dir `init card` printed.",
  apply_needs_stdin: "Apply needs JSON decisions on stdin: pass --stdin.",
  no_card: "No Card is kept in the run dir.",
  card_changed: "The proposal's evidence, `.qa/` or the date changed since the Card was shown.",
  write_failed: "The write failed and was rolled back.",
  unknown_action: "The init step does not exist.",
  state_arguments: "`init state` takes options only.",
  // A proposal that cannot become a Card, and a Card that cannot be written.
  shape: "The proposal is not in the shape the Card reads.",
  unknown_field: "The proposal names a setting the Card does not have.",
  missing: "A required setting has no value.",
  no_evidence: "A setting's evidence is missing or unfit.",
  roles_from_code: "Roles come from the tracker or the engineer, never from test code.",
  tracker_partial: "A tracker needs provider, project and key shape, or none.",
  stack_evidence: "A test stack lacks its language, framework, count or sample.",
  guidance_unquoted: "A guidance quote is not a line of the named file.",
  module_path_outside_stack: "Module paths must be test roots of the chosen stack.",
  stack_not_chosen: "Several test stacks are listed and none is chosen.",
  not_smoke_tested: "A Tier model label has no passing smoke test in the run dir.",
  check_file: "`.qa/project.md` would not pass its check.",
  project_unreadable: "`.qa/project.md` cannot be edited in place.",
  unwritable: "A detected value cannot be written in `.qa/project.md`.",
  // The JSON decisions.
  edit_dropped: "A dropped item also has an answer.",
  edit_field: "The item does not accept that answer.",
  not_droppable: "The item cannot be dropped.",
  unaddressed: "The decisions leave items open.",
  needs_edit: "An accepted item's question is unanswered.",
  no_such_stack: "The answer names no test stack of the Card.",
  no_such_option: "The answer names no option of who mints Automation keys.",
  minting_unsettled: "The option was not settled in the interview.",
  nothing_to_adopt: "The item has no detected value to adopt.",
  label_removed: "A Tag or Custom-field value is retired, never removed, renamed or reused: move it to the retired list instead.",
  // `init smoke`.
  smoke_arguments: "`init smoke` takes options only.",
  smoke_no_model: "`init smoke` needs --model <label>.",
  smoke_not_label: "The model is not a label: a label is not empty and holds no space.",
  smoke_fallback: "`inherit` is never smoke-tested.",
  smoke_needs_dir: "Judging a reply needs the run dir the smoke test started in.",
  smoke_not_started: "No smoke test of the model was started in the run dir.",
  // `init add-role`.
  role_names: "`init add-role` takes one or more Role names.",
  blank_role: "A Role name is not blank.",
  no_project: "`.qa/project.md` does not exist.",
  add_role_check_file: "`.qa/project.md` would not pass its check.",
  role_unwritable: "A Role name cannot be written in `.qa/project.md`.",
  add_role_write_failed: "The write failed and was rolled back.",
};

export const { fact, refuse, refusalOf } = refusalsFor(REFUSALS);

// What a note says, with the glossary term it uses.
/** @type {Record<string, InitNoteText>} */
export const NOTES = {
  automation_key_overlap: { line: "The Automation-key pattern matches a documented `tc_`/`ts_`/`su_` witness sample. A pattern matching none of the samples is not proven disjoint." },
  no_tracker: { line: "There is no tracker, so no Test Scenario or Test Case carries a Tracker key.", term: "Tracker key" },
  tracker_key_without_tracker: { line: "A tracker-key annotation is named, but there is no tracker, so no tracker key can match its values." },
  no_playwright_cli: { line: "`playwright-cli` is not on the PATH, so `/qa-execute` cannot run Test Cases in the application and `/qa-deep-dive`'s `observe:` input cannot look at it until it is installed (`npm install -g @playwright/cli@latest`). Nothing on this card needs it." },
  old_playwright_cli: { line: "`playwright-cli` is older than 0.1.22, or its version could not be read, so `/qa-execute` will refuse to run until it is upgraded (`npm install -g @playwright/cli@latest`). Nothing on this card needs it." },
  label_repeats_category: { line: "A Custom-field value repeats a Coverage category key. A team category is never a Coverage category: Coverage still derives from Rules and `covers`, so pick a different value if the two could be confused.", term: "Custom field" },
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

// The first-run card: every setting with the evidence it came from, the test stack, who mints keys,
// and the file it would write.
/**
 * @param {{
 *   items: readonly InitCardItem[],
 *   stacks: readonly InitStackRow[],
 *   files: readonly { path: string, text: string }[],
 *   notes: readonly { code: string, overlaps?: string[] }[],
 * }} card
 * @param {(field: string) => string} fieldLabelOf
 * @returns {InitCardData}
 */
export function firstCardData({ items, stacks, files, notes }, fieldLabelOf) {
  const terms = new Set(["Tier", "Fallback"]);
  const shown = items.map((i) => {
    const out = { n: i.n, kind: i.kind, label: i.label, needs: i.needs, edits: i.edits, drop: i.drop };
    if (i.kind === "field") {
      if (i.label === "Roles") terms.add("Role");
      if (i.label.includes("Tags")) terms.add("Tag");
      if (i.label === "Custom fields") terms.add("Custom field");
      if (i.label.includes("Key prefix")) terms.add("Key prefix");
      Object.assign(out, { type: i.type, value: i.value, evidence: i.evidence, ...(i.default !== undefined && { default: i.default }), ...(i.smokePassed && { smoke_passed: true }) });
    } else if (i.kind === "stack") {
      Object.assign(out, { chosen: i.chosen === null ? null : stacks[i.chosen].root, by: i.by });
    } else {
      if (i.options.includes(3)) terms.add("Key prefix");
      Object.assign(out, { choice: i.choice, options: MINTING.map((o) => ({ k: o.k, label: o.label, settled: i.options.includes(o.k) })), given: Object.entries(i.given).map(([f, g]) => ({ label: fieldLabelOf(f), ...g })) });
    }
    return /** @type {InitCardData["items"][number]} */ (out);
  });
  return {
    counts: { items: items.length, questions: items.filter((i) => i.question).length },
    items: shown,
    stacks: stacks.map(({ chosen, ...s }) => s),
    fallback: "inherit",
    files: files.map(({ path, text }) => ({ path, frontmatter: text.slice(0, text.indexOf("\n---\n", 4) + 4) })),
    notes: notesOf(notes, terms),
    fields: FIELDS,
    glossary: glossaryOf(terms),
  };
}

// The maintenance card: every setting as `project.md` holds it, with fresh detection beside it where it disagrees.
/**
 * @param {{
 *   items: readonly InitMaintenanceSource[],
 *   check: readonly InitCheckError[],
 *   notes: readonly { code: string, overlaps?: string[] }[],
 * }} card
 * @returns {InitMaintenanceData}
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
    return {
      n: i.n,
      label: i.label,
      type: i.type,
      current: i.current ?? null,
      ...(i.adopt && { detected: i.detected, evidence: i.evidence, adopt: true }),
      edits: i.edits,
      drop: i.drop,
      ...(i.effect && { effect: i.effect }),
    };
  });
  if (items.some((i) => i.effect && i.effect.errors + i.effect.unread > 0)) terms.add("Integrity error");
  return { counts: { items: items.length, disagree: items.filter((i) => i.adopt).length }, check, items: shown, notes: notesOf(notes, terms), fields: FIELDS, glossary: glossaryOf(terms) };
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
  const parsed = /** @type {{ errors?: InitDecisionError[], input: Record<string, unknown> }} */ (parseDecisions(text));
  if (parsed.errors) return /** @type {{ errors: InitDecisionError[] }} */ (parsed);
  const { input } = parsed;
  const allowed = [lead, "drop", "edits", ...(maintenance ? ["confirm"] : [])];
  /**
   * @param {string} k
   * @returns {boolean}
   */
  const listed = (k) => input[k] === undefined || Array.isArray(input[k]) || (k === "take" && input.take === "all");
  if (!object(input) || Object.keys(input).some((k) => !allowed.includes(k)) || !allowed.filter((k) => k !== "edits").every(listed) || (input.edits !== undefined && !object(input.edits))) return { errors: [{ code: "invalid_decisions" }] };
  const drop = /** @type {number[]} */ (input.drop ?? []);
  const take = /** @type {number[]} */ (input.take === "all" ? items.filter((i) => !drop.includes(i.n)).map((i) => i.n) : input[lead] ?? []);
  const edits = /** @type {Record<string, Record<string, unknown>>} */ (input.edits ?? {});
  const confirm = /** @type {number[]} */ (input.confirm ?? []);
  // `decisions.mjs` is not adopted yet, so its `confirm` is inferred as `never[]`; the numbers the
  // decisions confirm are cast to it at this call, and nothing else of it is changed.
  const errors = validateEdits(items, take, drop, edits, { confirm: /** @type {never[]} */ (confirm), maintenance, unknownFirst: true, badValue: (/** @type {InitCardItem} */ item, /** @type {string} */ field, /** @type {unknown} */ value) => badValue(TYPES[field](item), value) });
  return { input, take, drop, edits, confirm, errors };
}
