// @ts-check
// The Affected Rules fact: every Rule changed since a Feature's Watermark, plus every Rule
// downstream of one through Dependencies, however many edges away. The walk unions the target's
// and the baseline's edges and reports what every simple path from the changed Rule would, so a
// diamond reports both dependents, an edge removed after the Watermark is still followed, and a
// retired Upstream Rule does not hide its dependents (ADR-0043). The paths are not all walked:
// layered diamonds have exponentially many, so `simple-paths.mjs` finds a bounded sample of them,
// whether more exist, and which sides they run over, in time that grows with the graph. A Rule that
// another Feature's case relies on, with no Dependency to carry it, is Affected for the relying
// Feature when it changed since that Feature's own Watermark.
/** @import { CaseEntry, ParsedFile, ParsedRule } from "./knowledge-file.mjs" */
/** @import { KeyIndex } from "./qa-index.mjs" */
/** @import { DependencyIndex, RuleRef } from "./rule-ref.mjs" */
/** @import { RuleEditKind } from "./rule-diff.mjs" */
/** @import { PathEdge, PathFacts } from "./simple-paths.mjs" */
import { relianceOf } from "./reliance.mjs";
import { changedRuleKeys, ruleEdit, rulesChangedAcross } from "./rule-diff.mjs";
import { dependencyIndex, formatRuleRef } from "./rule-ref.mjs";
import { simplePathFacts } from "./simple-paths.mjs";

/**
 * A read-only view of `.qa/` at one state, as the history pass holds it: its files, index, and the
 * stripped Rule and Boundary maps per Feature.
 * @typedef {{
 *   files: readonly ParsedFile[],
 *   index: KeyIndex,
 *   rules: (slug: string | null) => Map<string, string>,
 *   boundaries: (slug: string | null) => Map<string, string>,
 * }} AffectedSnapshot
 */

/**
 * One changed Rule that reaches a Feature, and how.
 * @typedef {{
 *   ref: RuleRef,
 *   key: string,
 *   edit: "added" | "edited" | "removed",
 *   kinds: RuleEditKind[],
 * }} ChangedRule
 */

/**
 * One incoming path from a changed Rule to an Affected Rule of the Feature.
 * @typedef {{
 *   ref: string,
 *   local: boolean,
 *   edit: "added" | "edited" | "removed",
 *   kinds: RuleEditKind[],
 *   edges: "target" | "baseline" | "both" | "none",
 *   paths: string[][],
 *   truncated: boolean,
 * }} AffectedCause
 */

/**
 * One Rule of the Feature the change reaches.
 * @typedef {{
 *   rule: string,
 *   ref: string,
 *   changed: boolean,
 *   causes: AffectedCause[],
 * }} AffectedRule
 */

/**
 * A Feature's Affected Rules, as `history.features[].affected_rules`.
 * @typedef {{
 *   baseline: string | null,
 *   widen: string[],
 *   new_rules: string[],
 *   rules: AffectedRule[],
 * }} AffectedRulesFacts
 */

const MAX_PATHS = 16;

/**
 * @param {RuleRef} ref
 * @returns {string}
 */
const keyOf = (ref) => formatRuleRef(ref);

/**
 * @param {Pick<AffectedSnapshot, "index">} snapshot
 * @param {RuleRef} ref
 * @returns {ParsedRule | null}
 */
function entryOf(snapshot, ref) {
  const decl = snapshot.index.rules.get(ref.feature)?.get(ref.rule)?.[0];
  return decl?.file.rules.find((rule) => rule.key === ref.rule) ?? null;
}

// The statement a Rule has in `index`: the one text a forecast is given against, and the one the
// settlement compares it with. `null` when the Rule is not there.
/**
 * @param {KeyIndex} index
 * @param {string} feature
 * @param {string} rule
 * @returns {string | null}
 */
export function statementOf(index, feature, rule) {
  return entryOf({ index }, { feature, rule })?.statement ?? null;
}

// The Rules of `feature` whose edit since its Watermark touched the statement: the edits whose
// widening only the engineer can say, since no link reaches a case the new statement now claims
// (ADR-0043). An edit of the elaboration, Waiver or Dependency alone is reached through the links.
/**
 * @param {AffectedRulesFacts} facts
 * @param {string} feature
 * @returns {string[]} Rule keys, in the facts' order
 */
export function statementEdits(facts, feature) {
  return facts.rules
    .filter((r) => r.ref === `${feature}/${r.rule}` && r.changed && r.causes.some((c) => c.ref === r.ref && c.edit === "edited" && c.kinds.includes("statement")))
    .map((r) => r.rule);
}

/**
 * Every Rule whose stripped entry differs between the two states, with the kind of change.
 * @param {AffectedSnapshot} then
 * @param {AffectedSnapshot} now
 * @returns {ChangedRule[]}
 */
function changedRules(then, now) {
  return rulesChangedAcross(then, now)
    .map(({ before, after, ...ref }) => {
      if (before === undefined) return { ref, key: ref.rule, edit: /** @type {const} */ ("added"), kinds: [] };
      if (after === undefined) return { ref, key: ref.rule, edit: /** @type {const} */ ("removed"), kinds: [] };
      const was = entryOf(then, ref);
      const is = entryOf(now, ref);
      const edit = was && is ? ruleEdit(was, is, before, after) : null;
      return { ref, key: ref.rule, edit: /** @type {const} */ ("edited"), kinds: edit?.kinds ?? [] };
    })
    .sort((a, b) => keyOf(a.ref).localeCompare(keyOf(b.ref)));
}

/**
 * A Rule's direct dependents in either index, keyed by ref so an edge present in both is visited
 * once. `target` says the target still has the edge; only a target-missing edge is baseline-only.
 * @param {RuleRef} ref
 * @param {DependencyIndex} target
 * @param {DependencyIndex} baseline
 * @returns {Array<{ ref: RuleRef, side: "target" | "baseline" }>}
 */
function dependentsOf(ref, target, baseline) {
  /** @type {Map<string, { ref: RuleRef, side: "target" | "baseline" }>} */
  const edges = new Map();
  for (const dependent of target.dependentsOf(ref.feature, ref.rule)) edges.set(keyOf(dependent), { ref: dependent, side: "target" });
  for (const dependent of baseline.dependentsOf(ref.feature, ref.rule)) {
    const key = keyOf(dependent);
    if (!edges.has(key)) edges.set(key, { ref: dependent, side: "baseline" });
  }
  return [...edges.values()].sort((a, b) => keyOf(a.ref).localeCompare(keyOf(b.ref)));
}

// The Rules of other Features that `feature`'s cases rely on, at either state, by qualified key.
/**
 * @param {AffectedSnapshot[]} snapshots
 * @param {string} feature
 * @returns {Map<string, RuleRef>}
 */
function reliedOn(snapshots, feature) {
  /** @type {Map<string, RuleRef>} */
  const out = new Map();
  for (const snapshot of snapshots) {
    for (const decls of snapshot.index.cases.values()) {
      for (const decl of decls) {
        if ((decl.feature ?? snapshot.index.featureOf(decl.file)) !== feature) continue;
        for (const { ref } of relianceOf(/** @type {CaseEntry} */ (decl.entry), feature).refs) {
          if (ref.feature !== feature) out.set(keyOf(ref), ref);
        }
      }
    }
  }
  return out;
}

/**
 * The Affected Rules of `feature`: the changed Rules that reach it, and every Rule downstream of
 * one over the union of the target and baseline edges.
 * @param {{
 *   then: AffectedSnapshot | null,
 *   now: AffectedSnapshot,
 *   feature: string,
 *   baseline: string | null,
 *   target: DependencyIndex,
 * }} args
 * @returns {AffectedRulesFacts}
 */
export function affectedRules({ then, now, feature, baseline, target }) {
  if (baseline === null || then === null) return { baseline: null, widen: ["first_assessment"], new_rules: [], rules: [] };
  const base = dependencyIndex(then.index, then.files);
  const changed = changedRules(then, now);
  /** @type {Map<string, { ref: RuleRef, changed: boolean, causes: Map<string, AffectedCause> }>} */
  const affected = new Map();

  // A changed Rule's cause on an Affected Rule: the facts of the paths from one to the other.
  /**
   * @param {ChangedRule} root
   * @param {RuleRef} node
   * @param {PathFacts} facts
   * @returns {void}
   */
  const record = (root, node, facts) => {
    const key = keyOf(node);
    let rule = affected.get(key);
    if (!rule) {
      rule = { ref: node, changed: false, causes: new Map() };
      affected.set(key, rule);
    }
    const rootKey = keyOf(root.ref);
    if (rootKey === key) rule.changed = true;
    // A root reaches a Rule once: through the walk if the Rule is the Feature's, through Reliance if
    // it is another Feature's.
    rule.causes.set(rootKey, { ref: rootKey, local: root.ref.feature === feature, edit: root.edit, kinds: root.kinds, edges: facts.edges, paths: facts.paths, truncated: facts.truncated });
  };

  // The Rules by qualified key, and each one's dependents, which the walk asks for once.
  /** @type {Map<string, RuleRef>} */
  const refs = new Map();
  /** @type {Map<string, PathEdge[]>} */
  const successors = new Map();
  /**
   * @param {string} key
   * @returns {PathEdge[]}
   */
  const dependentsByKey = (key) => {
    let edges = successors.get(key);
    if (!edges) {
      edges = dependentsOf(/** @type {RuleRef} */ (refs.get(key)), target, base).map(({ ref, side }) => {
        refs.set(keyOf(ref), ref);
        return { to: keyOf(ref), side };
      });
      successors.set(key, edges);
    }
    return edges;
  };

  for (const root of changed) {
    const rootKey = keyOf(root.ref);
    refs.set(rootKey, root.ref);
    const reached = simplePathFacts({
      root: rootKey,
      wanted: (key) => /** @type {RuleRef} */ (refs.get(key)).feature === feature,
      successors: dependentsByKey,
      limit: MAX_PATHS,
    });
    for (const [key, facts] of reached) record(root, /** @type {RuleRef} */ (refs.get(key)), facts);
  }

  // Reliance carries no edge a walk follows: a changed Rule that a case of this Feature relies on is
  // Affected for it directly, whether or not a Dependency of the Feature also reaches that Rule: the
  // Dependency walk reaches Rules, never the case that relies on one.
  const relied = reliedOn([then, now], feature);
  for (const root of changed) {
    const key = keyOf(root.ref);
    if (relied.has(key)) record(root, root.ref, { paths: [[key]], truncated: false, edges: "none" });
  }

  const rules = [...affected.values()]
    .sort((a, b) => keyOf(a.ref).localeCompare(keyOf(b.ref)))
    .map((rule) => ({
      rule: rule.ref.rule,
      ref: keyOf(rule.ref),
      changed: rule.changed,
      causes: [...rule.causes.values()]
        .map((cause) => ({ ...cause, paths: [...cause.paths].sort((a, b) => a.join("\0").localeCompare(b.join("\0"))) }))
        .sort((a, b) => a.ref.localeCompare(b.ref)),
    }));

  const ownBefore = then.rules(feature);
  const ownAfter = now.rules(feature);
  const newRules = [...ownAfter.keys()].filter((rule) => !ownBefore.has(rule)).sort();
  /** @type {string[]} */
  const widen = [];
  if (changedRuleKeys(then.boundaries(feature), now.boundaries(feature)).length) widen.push("boundary_changed");
  if (newRules.length) widen.push("new_rule");
  return { baseline, widen, new_rules: newRules, rules };
}
