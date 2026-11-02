// @ts-check
// Link repair on Rule retire and merge (ADR-0043). A Rule that leaves names a `covers` entry, a
// Reliance entry or a Dependency in other places, across every Feature; a link left naming it
// dangles. `retiredLinks` lists every link that names a retiring Rule, read from the working tree
// except for the drafted Feature, whose own Dependencies are read from the draft (it is what will be
// written). A merge is a retire of the absorbed Rule, so it lists the same links.
//
// A link is identified `<rule>:<kind>:<owner>` (kind `covers`, `relies_on` or `depends_on`; owner the
// case Key, or `<feature>/<rule>` for a Dependency). It is resolved when the engineer has repaired it
// (the working tree no longer names the Rule there) or confirmed it (`--confirm <id>,...`).
/** @import { ParsedFile } from "./knowledge-file.mjs" */
/** @import { KeyIndex } from "./qa-index.mjs" */
import { relative, join, sep } from "node:path";
import { casesCoveringRule } from "./rule-coverage.mjs";
import { reverseReliance } from "./reliance.mjs";
import { dependencyIndex, formatRuleRef, parseDependsField, readDependsOn } from "./rule-ref.mjs";

/**
 * One link that names a retiring Rule.
 * @typedef {{
 *   id: string,
 *   kind: "covers" | "relies_on" | "depends_on",
 *   feature: string,
 *   owner: string,
 *   file: string,
 *   line: number | null,
 *   resolution: "unrepaired" | "confirmed",
 * }} RuleLink
 */

// The repository-relative path of a `.qa/` file, as the other deep-dive listings show it.
/**
 * @param {{ root: string, repo: string }} ctx
 * @param {string} rel
 * @returns {string}
 */
const repoPath = (ctx, rel) => relative(ctx.repo, join(ctx.root, rel)).split(sep).join("/");

/**
 * Every link that names `rule` of `feature`, across Features, `rule` being retired or merged away.
 * @param {{ root: string, repo: string, index: KeyIndex, files: readonly ParsedFile[] }} ctx
 * @param {string} feature
 * @param {string} rule
 * @param {ParsedFile} draft the drafted Feature file, which replaces the one on disk for its own Rules
 * @param {ReadonlySet<string>} confirmed link ids the engineer confirmed
 * @returns {RuleLink[]}
 */
export function retiredLinks(ctx, feature, rule, draft, confirmed) {
  /** @type {RuleLink[]} */
  const links = [];
  /**
   * @param {RuleLink["kind"]} kind
   * @param {string} owner
   * @param {string} ownerFeature
   * @param {string} rel
   * @param {number | null | undefined} line
   */
  const add = (kind, owner, ownerFeature, rel, line) => {
    const id = `${rule}:${kind}:${owner}`;
    links.push({ id, kind, feature: ownerFeature, owner, file: repoPath(ctx, rel), line: line ?? null, resolution: confirmed.has(id) ? "confirmed" : "unrepaired" });
  };

  for (const c of casesCoveringRule(ctx.index, feature, rule)) add("covers", c.entry.key, feature, c.file.rel, c.line);

  for (const use of reverseReliance(ctx.index).get(formatRuleRef({ feature, rule })) ?? []) {
    add("relies_on", use.case, use.feature, use.file.rel, use.line);
  }

  // Dependencies: other Features from the tree; the drafted Feature's own Rules from the draft.
  const dependents = dependencyIndex(ctx.index, ctx.files).dependentsOf(feature, rule);
  for (const d of dependents) {
    if (d.feature === feature) continue;
    const file = ctx.index.rules.get(d.feature)?.get(d.rule)?.[0]?.file;
    const entry = file?.rules.find((r) => r.key === d.rule);
    const field = entry?.fields.find((f) => f.name === "Depends on");
    add("depends_on", formatRuleRef(d), d.feature, file?.rel ?? "", field ? parseDependsField(field).line : null);
  }
  for (const own of draft.rules) {
    const depends = readDependsOn(own);
    if (depends?.refs.some((r) => r.feature === feature && r.rule === rule)) {
      add("depends_on", formatRuleRef({ feature, rule: own.key }), feature, draft.rel, depends.line);
    }
  }
  return links;
}
