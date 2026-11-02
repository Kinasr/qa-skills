// @ts-check
// Proposals and links of the settle engine (settle-walk.mjs), split out of it: `design propose`
// records design's proposed outcome and links per case, and `design link` writes the links the
// engineer confirmed (ADR-0043).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keyLabel, terms } from "./labels.mjs";
import { writeAll } from "./changeset.mjs";
import { isMap } from "./dialect.mjs";
import { repositoryOf } from "./git-tree.mjs";
import { written } from "./impact-persist.mjs";
import { backfillChangeset } from "./pin-digest.mjs";
import { refuse } from "./impact-json.mjs";
import { parseRuleRef, resolveRuleRef } from "./rule-ref.mjs";
import { checkFile, parse } from "./knowledge-file.mjs";
import { object, refusalsFor } from "./refusal.mjs";
import { rootConfig } from "./qa-index.mjs";
import { readRunFile } from "./run-dir.mjs";
import { scan } from "./scan.mjs";
import { isOpenFinding } from "./stored-findings.mjs";
import { STATE, current, findingsOf, load, reliesOn, strings, textWith } from "./settle-walk.mjs";
import { unknown } from "./settle-page.mjs";
/** @import { WalkCaseDecl, WalkNow } from "./settle-walk.mjs" */
/** @import { CommandResult } from "./cli.mjs" */
/** @import { Terms } from "./impact-json.mjs" */
/** @import { ImpactPlan } from "./impact.mjs" */
/** @import { RunFileResult } from "./run-dir.mjs" */

// ---- Proposals and links (ADR-0043) ----
// What design proposes on the walk is data shown beside the offered choices: an outcome (`keep`,
// `fix` or `retire`) for a case with an open Stale, and `covers` / `relies_on` links for any case it
// touches. `design propose` records them in the run dir's `proposals.json`; the walk and the Card page
// show them. Nothing here answers for the engineer: a proposal settles no finding and writes no
// case. The links reach a case only through `design link`, with the Rules the engineer confirmed.

/**
 * What design proposes for one case. `outcome` is for a case with an open Stale.
 * @typedef {object} Proposal
 * @property {"keep" | "fix" | "retire"} [outcome]
 * @property {string} [reason]
 * @property {string[]} [covers]
 * @property {string[]} [relies_on]
 */

/**
 * `proposals.json`, design's proposals by case key.
 * @typedef {{ v: number, items: Record<string, Proposal> }} Proposals
 */

/**
 * A proposal as the walk shows it: what design proposed, the links the case holds now, and whether
 * the engineer has confirmed the proposed links (the case holds exactly those).
 * @typedef {Proposal & { current: { covers: string[], relies_on: string[] }, confirmed?: boolean }} ProposalView
 */

const PROPOSALS = "proposals.json";
const OUTCOMES = ["keep", "fix", "retire"];
const PROPOSAL_FIELDS = ["outcome", "reason", "covers", "relies_on"];
/** @type {Record<string, string>} */
export const PROPOSE_REFUSALS = {
  proposal_json: "The proposals are not a JSON object `{v: 1, items: {<case key>: {outcome?, reason?, covers?, relies_on?}}}`.",
  proposal_field: "A proposal holds a field other than outcome, reason, covers and relies_on, or a value of the wrong type.",
  proposal_case: "A proposal names a case the knowledge layer does not hold.",
  proposal_outcome: "A proposed outcome is keep, fix or retire.",
  proposal_not_stale: "Only a case with an open Stale takes a proposed outcome.",
  proposal_link: "A proposed link names a Rule that is not live.",
  link_json: "The links are not a JSON object holding `covers` and/or `relies_on`, each a list of Rule references.",
  link_field: "The links hold a field other than covers and relies_on.",
  link_case: "The case is not one the knowledge layer holds.",
  link_rule: "A link names a Rule that is not live.",
};
const { refuse: proposeRefuse, stop: proposeStop } = refusalsFor(PROPOSE_REFUSALS);

/**
 * @param {unknown} v
 * @returns {v is string[]}
 */
const stringList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

// The Rule references among `refs` that are no live Rule: a local key is a Rule of the case's own
// Feature, a `<feature>/<rule>` one a Rule of the Feature it names.
/**
 * @param {WalkNow} now
 * @param {string} feature
 * @param {string[]} refs
 * @returns {string[]}
 */
function unresolvedRules(now, feature, refs) {
  return refs.filter((text) => resolveRuleRef(/** @type {import("./qa-index.mjs").KeyIndex} */ (/** @type {unknown} */ (now.index)), /** @type {import("./knowledge-file.mjs").ParsedFile[]} */ (now.files), parseRuleRef(text) ?? { feature, rule: text }).status !== "live");
}

// The links a case holds now.
/**
 * @param {WalkCaseDecl} decl
 * @returns {{ covers: string[], relies_on: string[] }}
 */
const linksOf = (decl) => ({ covers: strings(decl.entry.data.covers), relies_on: reliesOn(decl) });

/**
 * @param {WalkCaseDecl} decl
 * @returns {boolean}
 */
const staleOpen = (decl) => findingsOf(decl.entry).some((x) => isMap(x) && x.kind === "Stale" && isOpenFinding(x));

// The Run's proposals, or none while design has proposed nothing.
/**
 * @param {string} dir
 * @returns {Proposals}
 */
function proposalsOf(dir) {
  const read = /** @type {RunFileResult<Proposals>} */ (readRunFile(dir, PROPOSALS, { by: "design propose", restart: "impact plan" }));
  return read.error || !read.value || !object(read.value.items) ? { v: 1, items: {} } : read.value;
}

// `design propose --dir --stdin`: design's proposals, `{v: 1, items: {<case key>: {outcome?, reason?,
// covers?, relies_on?}}}`. Each case's entry replaces its earlier one; the rest are kept. Every item is
// held to the knowledge layer first, so a refusal writes nothing.
/**
 * @param {string} dir
 * @param {ImpactPlan} plan
 * @param {string} text
 * @returns {CommandResult}
 */
export function propose(dir, plan, text) {
  const loaded = load(dir, plan);
  if (loaded.refused) return loaded.refused;
  /** @type {unknown} */
  let given;
  try { given = JSON.parse(text); } catch { return proposeRefuse("proposal_json"); }
  if (!object(given) || given.v !== 1 || !object(given.items) || unknown(given, ["v", "items"])) return proposeRefuse("proposal_json");
  const now = current(plan.root);
  /** @type {Record<string, Proposal>} */
  const items = {};
  for (const [key, item] of Object.entries(given.items)) {
    if (!object(item) || unknown(item, PROPOSAL_FIELDS) || (item.reason !== undefined && typeof item.reason !== "string")) return proposeRefuse("proposal_field", { key });
    for (const field of /** @type {const} */ (["covers", "relies_on"])) if (item[field] !== undefined && !stringList(item[field])) return proposeRefuse("proposal_field", { key });
    const decl = now.index.cases.get(key)?.[0];
    if (!decl) return proposeStop("proposal_case", { key });
    if (item.outcome !== undefined) {
      if (typeof item.outcome !== "string" || !OUTCOMES.includes(item.outcome)) return proposeRefuse("proposal_outcome", { key });
      if (!staleOpen(decl)) return proposeStop("proposal_not_stale", { key });
    }
    const unresolved = unresolvedRules(now, decl.feature, [...strings(item.covers), ...strings(item.relies_on)]);
    if (unresolved.length) return proposeStop("proposal_link", { key, rules: unresolved });
    items[key] = /** @type {Proposal} */ (item);
  }
  const proposals = proposalsOf(dir);
  writeFileSync(join(dir, PROPOSALS), `${JSON.stringify({ v: 1, items: { ...proposals.items, ...items } }, null, 2)}\n`);
  return { exit: 0, json: { ok: true, proposed: Object.keys(items) } };
}

// What the walk shows of design's proposal for a case: the proposal beside the links the case holds
// now, and whether it holds the proposed links. An outcome is dropped once the case has no open Stale.
/**
 * @param {string} dir
 * @param {WalkNow} now
 * @param {string} key
 * @returns {ProposalView | null}
 */
export function proposalView(dir, now, key) {
  const decl = now.index.cases.get(key)?.[0];
  const item = proposalsOf(dir).items[key];
  if (!decl || !item) return null;
  const heldNow = linksOf(decl);
  const { outcome, ...rest } = item;
  const proposed = /** @type {Array<"covers" | "relies_on">} */ (["covers", "relies_on"]).filter((f) => item[f] !== undefined);
  const shown = outcome !== undefined && staleOpen(decl);
  if (!proposed.length && !shown) return null;
  const same = (/** @type {string[]} */ a, /** @type {string[]} */ b) => a.length === b.length && a.every((x) => b.includes(x));
  return { ...(shown && { outcome }), ...rest, current: heldNow, ...(proposed.length && { confirmed: proposed.every((f) => same(strings(item[f]), heldNow[f])) }) };
}

// The proposal as the Card page prints it, one line each beside the case's facts.
/**
 * @param {ProposalView | null} proposal
 * @returns {string[]}
 */
export function proposalLines(proposal) {
  if (!proposal) return [];
  const list = (/** @type {string[]} */ v) => (v.length ? v.join(", ") : "none");
  return [
    ...(proposal.outcome !== undefined ? [`Design proposes outcome: ${proposal.outcome}${proposal.reason ? ` (${proposal.reason})` : ""}. The answer is yours.`] : []),
    ...(proposal.covers !== undefined ? [`Design proposes covers: ${list(proposal.covers)} (now: ${list(proposal.current.covers)}).`] : []),
    ...(proposal.relies_on !== undefined ? [`Design proposes relies_on: ${list(proposal.relies_on)} (now: ${list(proposal.current.relies_on)}).`] : []),
  ];
}

// `design link --dir --case <key> --stdin`: the links the engineer confirmed for a case, `{covers?,
// relies_on?}`. A list given replaces the case's own; one left out stays. Every Rule must be live and
// the file must pass `check-file` before it is written; a refusal writes nothing. Any case may be
// linked, an Uncited one included: it needs no open finding, and the proposal is not consulted.
/**
 * @param {string} dir
 * @param {ImpactPlan} plan
 * @param {unknown} key
 * @param {string} text
 * @returns {CommandResult}
 */
export function link(dir, plan, key, text) {
  const loaded = load(dir, plan);
  if (loaded.refused) return loaded.refused;
  const root = plan.root;
  const now = current(root);
  const decl = typeof key === "string" ? now.index.cases.get(key)?.[0] : undefined;
  if (typeof key !== "string" || !decl) return proposeStop("link_case", { key });
  /** @type {unknown} */
  let given;
  try { given = JSON.parse(text); } catch { return proposeRefuse("link_json"); }
  if (!object(given) || !Object.keys(given).length) return proposeRefuse("link_json");
  if (unknown(given, ["covers", "relies_on"])) return proposeRefuse("link_field");
  for (const field of ["covers", "relies_on"]) if (given[field] !== undefined && !stringList(given[field])) return proposeRefuse("link_json");
  const unresolved = unresolvedRules(now, decl.feature, [...strings(given.covers), ...strings(given.relies_on)]);
  if (unresolved.length) return proposeStop("link_rule", { key, rules: unresolved });
  const repo = repositoryOf(root);
  if (!repo) return refuse("no_head");
  const rel = decl.file.rel;
  const set = { ...(given.covers !== undefined && { covers: given.covers }), ...(given.relies_on !== undefined && { relies_on: strings(given.relies_on).length ? given.relies_on : undefined }) };
  const edited = textWith(rel, readFileSync(join(root, rel), "utf8"), [{ at: key, set }]);
  const checked = /** @type {{ errors: Array<{ line?: number, message: string }> }} */ (checkFile(parse(rel, edited), rootConfig(root)));
  if (checked.errors.length) return refuse("check_file", { errors: checked.errors.map((x) => ({ file: `${repo.prefix}${rel}`, line: x.line, message: x.message })) });
  const wrote = /** @type {{ error?: string }} */ (writeAll(root, backfillChangeset(root, root, { writes: [{ path: rel, text: edited }] })));
  if (wrote.error) throw new Error(`design link: ${wrote.error}`);
  loaded.state.written = [...new Set([...loaded.state.written, `${repo.prefix}${rel}`])].sort();
  writeFileSync(join(dir, STATE), `${JSON.stringify(loaded.state, null, 2)}\n`);
  const after = current(root).index.cases.get(key)?.[0];
  /** @type {Terms} */
  const t = terms();
  t.add("Reliance");
  return { exit: 0, json: { ok: true, linked: { key, label: keyLabel(key, decl.entry.summary), ...(after ? linksOf(after) : {}), written: [`${repo.prefix}${rel}`] }, glossary: t.pieces() } };
}

/**
 * What `design state` reports of the links in one Feature: the Uncited cases (no `covers`, whatever
 * their Reliance holds) and the Uncovered Rules (no covering case, never a Waived Rule), as the Scan
 * reports them. Neither is a Finding, so neither is on the settle walk: the skill offers a linking
 * route for the first, and handles the second after Phase 1's agreement.
 * @param {string} root
 * @param {string} slug
 * @returns {{ uncited_cases: import("./scan-links.mjs").UncitedCase[], uncovered_rules: import("./scan-links.mjs").UncoveredRule[] }}
 */
export function linkScope(root, slug) {
  const { uncited_cases, uncovered_rules } = scan(root, { feature: slug });
  return { uncited_cases, uncovered_rules };
}
