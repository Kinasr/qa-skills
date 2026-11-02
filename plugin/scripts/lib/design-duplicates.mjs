// @ts-check
// Design refuses a duplicate (ADR-0043). A proposed case duplicates another when both claim the
// same pass: the same covered Rules, the same setup, the same exercised path (steps, Role and
// level) and the same expected outcome. Varying any one of the six makes it a different pass.
// The other case is a stored one of the Feature, or a proposal that came earlier in the run (a
// sibling Delegate's, already written by the time this one is, or an earlier case of the same
// reply). `design-write` asks before it mints a Key or writes a line, so a refusal leaves no case,
// no tombstone and no Finding. Only the engineer's stated reason lets a repeat through, for the
// stored case a refusal cited (`design override`): a proposal that repeats that case is written, and
// the writer records what it overrode and the engineer's reason. A Delegate's own `override_reason`
// is a proposal, never an override: the repeat stays refused and the reason rides on the refusal
// (`proposed_reason`) for the engineer to adopt. A repeat of an earlier case of the same reply has
// no stored Key to excuse, so it stays refused whatever the proposal says.
//
// Wording is not a dimension: a summary, the `automatable` flag and Reliance are left out, and the
// texts compared ignore case, spacing, list markers, Markdown emphasis and closing punctuation.
// Setup and Roles are sets (their order is no pass); steps are a sequence.
import { casePreconditions, caseFields, caseSteps, stepActor, stripListMarker } from "./case-fields.mjs";
import { listOf } from "./dialect.mjs";

/** @import { CaseEntry, ParsedFile as QaFile } from "./knowledge-file.mjs" */
/** @import { KeyIndex } from "./qa-index.mjs" */
/** @import { DesignCase } from "./design-contract.mjs" */

/**
 * The pass a case claims, each dimension normalised for comparison.
 * @typedef {object} Pass
 * @property {string[]} covers - the covered Rules, sorted
 * @property {string[]} setup - the preconditions, sorted
 * @property {string[]} steps - the exercised steps, in order
 * @property {string[]} roles - the Roles that act, sorted
 * @property {string | null} level
 * @property {string} expected
 */

/**
 * A stored case of the Feature, with the pass it claims.
 * @typedef {object} StoredCase
 * @property {string} key
 * @property {Pass} pass
 */

/**
 * One proposed case that repeats another: `case` is its 1-based place in the reply. `of` is the
 * stored case's Key, or null when the other is an earlier case of the same reply, `with_case`.
 * `proposed_reason` is the Delegate's own `override_reason` on a repeat of a stored case: a proposal
 * the engineer may adopt, never a reason that lets the repeat through.
 * @typedef {object} Repeat
 * @property {number} case
 * @property {string} summary
 * @property {string | null} of
 * @property {number} [with_case]
 * @property {string} [proposed_reason]
 */

/**
 * A repeat of a stored case let through by the engineer's stated reason.
 * @typedef {Repeat & { reason: string, by: "engineer" }} Override
 */

/**
 * @param {string} value
 * @returns {string}
 */
const norm = (value) => value.normalize("NFKC").toLowerCase().replace(/[`*]/g, "").replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/, "").trim();

/**
 * @param {readonly string[]} values
 * @returns {string[]}
 */
const sorted = (values) => [...new Set(values)].sort();

// A single Role's steps carry no `As <Role>, ` prefix when the contract writes them, and a person
// may have written it; a case with several Roles keeps every prefix, on both sides.
/**
 * @param {readonly string[]} steps
 * @param {readonly string[]} roles
 * @returns {string[]}
 */
function stepsOf(steps, roles) {
  return steps.map((step) => {
    const plain = stripListMarker(step);
    const actor = stepActor(plain);
    return norm(roles.length === 1 && actor === roles[0] ? plain.slice(plain.indexOf(",") + 1) : plain);
  });
}

/**
 * The pass a Delegate's proposed case claims.
 * @param {DesignCase} c
 * @returns {Pass}
 */
export function proposedPass(c) {
  return {
    covers: sorted(c.covers),
    setup: sorted((c.preconditions ?? []).map(norm).filter(Boolean)),
    steps: stepsOf(c.steps ?? [], c.roles),
    roles: sorted(c.roles),
    level: c.level,
    expected: norm(c.expected),
  };
}

/**
 * The pass a stored case claims, including its own level.
 * @param {CaseEntry} entry
 * @returns {Pass}
 */
export function storedPass(entry) {
  const roles = listOf(entry.data.roles);
  return {
    covers: sorted(listOf(entry.data.covers)),
    setup: sorted(casePreconditions(entry).map(norm).filter(Boolean)),
    steps: stepsOf(caseSteps(entry), roles),
    roles: sorted(roles),
    level: typeof entry.data.level === "string" ? entry.data.level : null,
    expected: norm(caseFields(entry).expected ?? ""),
  };
}

/**
 * @param {Pass} pass
 * @returns {string}
 */
export const passKey = ({ covers, setup, steps, roles, level, expected }) => JSON.stringify([covers, setup, steps, roles, level, expected]);

/**
 * Every case of the Feature `feature` that is stored in the `.qa/` tree as it stands, except the
 * cases in `skip` (the ones a regenerate replaces, which its proposals legitimately rewrite).
 * @param {readonly QaFile[]} files
 * @param {KeyIndex} index
 * @param {string} feature
 * @param {ReadonlySet<string>} skip
 * @returns {StoredCase[]}
 */
export function storedCases(files, index, feature, skip) {
  return files.flatMap((file) => {
    if (file.unreadable || file.type !== "scenario" || index.featureOf(file) !== feature) return [];
    return file.cases.filter((c) => !skip.has(c.key)).map((c) => ({ key: c.key, pass: storedPass(c) }));
  });
}

/**
 * Which of a reply's proposed cases repeat a stored case or an earlier case of the reply: the
 * `refused`, and the ones the engineer's reason lets through, `overridden` (`engineer`, by the Key of
 * the stored case it repeats). A proposal's own `override_reason` never lets one through: it rides on
 * the refused repeat of a stored case as `proposed_reason`. A repeat of an earlier case of the reply
 * is always refused. A case that repeats is cited against a stored case first, else the earliest
 * proposal with its pass.
 * @param {readonly DesignCase[]} proposals
 * @param {readonly StoredCase[]} stored
 * @param {Readonly<Record<string, string>>} [engineer] - the engineer's reasons, by the Key of the case each excuses a repeat of
 * @returns {{ refused: Repeat[], overridden: Override[] }}
 */
export function repeats(proposals, stored, engineer = {}) {
  /** @type {Map<string, string>} */
  const storedBy = new Map();
  for (const s of stored) if (!storedBy.has(passKey(s.pass))) storedBy.set(passKey(s.pass), s.key);
  /** @type {Map<string, number>} */
  const earlier = new Map();
  /** @type {Repeat[]} */
  const refused = [];
  /** @type {Override[]} */
  const overridden = [];
  proposals.forEach((c, i) => {
    const key = passKey(proposedPass(c));
    const of = storedBy.get(key) ?? null;
    const first = earlier.get(key);
    if (!earlier.has(key)) earlier.set(key, i + 1);
    if (of === null && first === undefined) return;
    /** @type {Repeat} */
    const repeat = { case: i + 1, summary: c.summary, of, ...(of === null && { with_case: first }) };
    const stated = of !== null && Object.hasOwn(engineer, of) ? engineer[of] : null;
    if (stated) overridden.push({ ...repeat, reason: stated, by: "engineer" });
    else refused.push(of !== null && c.override_reason ? { ...repeat, proposed_reason: c.override_reason } : repeat);
  });
  return { refused, overridden };
}

/**
 * The refusal's own line for one repeat: what it repeats, and the way out. A stored case's repeat is
 * let through only by the engineer's reason; a same-reply repeat has to differ on a dimension.
 * @param {Repeat} r
 * @returns {string}
 */
export const refusalLine = (r) => `case ${r.case} repeats ${r.of === null ? `case ${r.with_case} of the same reply` : r.of} on its covered Rules, setup, steps, Roles, level and expected result; ${r.of === null ? "it has to differ on a dimension of the pass, or be dropped" : "only the engineer's stated reason lets a repeat of a stored case through"}`;
