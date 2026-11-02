// @ts-check
// The qualified Rule reference, and the Dependency index built from it: one resolver for
// `<feature>/<rule>` and one reverse view of the Dependencies a tree records, so every command
// answers "which Rules depend on this?" the same way. Nothing reverse is stored: `dependencyIndex`
// reads the tree's `Depends on:` fields and inverts them in memory, once per command run.
//
//   parseRuleRef(text)              → {feature, rule} | null   (null = malformed)
//   formatRuleRef({feature, rule})  → "<feature>/<rule>"
//   isQualifiedRuleRef(text)        → is it a qualified reference?
//   isRuleRef(text)                 → is it a local Rule key or a qualified reference?
//   readDependsOn(rule)             → {refs, line, malformed} | null
//   parseDependsField(field)        → {refs, line, malformed}
//   resolveRuleRef(index, files, ref) → live | retired | unresolved
//   dependencyIndex(index, files)   → upstreamOf / dependentsOf / upstreamClosure
//   dependencyEnds(index, files, refs) → the live ends of the Dependencies refs names
//
// A Dependency is knowledge: the dependent Rule owns the edge, the Upstream Rule records nothing.
/** @import { ParsedFile, ParsedRule, RuleField, UnreadableFile } from "./knowledge-file.mjs" */
/** @import { KeyDecl, KeyIndex } from "./qa-index.mjs" */
import { PATTERN } from "./keys.mjs";

/**
 * One qualified Rule reference: the Feature key that holds the Rule, and the Rule's key there.
 * @typedef {{
 *   feature: string,
 *   rule: string,
 * }} RuleRef
 */

/**
 * A Rule's `Depends on:` field, read: its live references, the line it sits on, and the texts that
 * are not references at all.
 * @typedef {{
 *   refs: RuleRef[],
 *   line: number,
 *   malformed: string[],
 * }} DependsOn
 */

/**
 * What a reference resolves to in the Feature it names. A retired target is retired, never
 * unresolved; a reference never resolves in another Feature. A live reference carries the Rule it
 * names, so every caller reads the same entry instead of looking it up again.
 * @typedef {{
 *   status: "live",
 *   feature: string,
 *   rule: string,
 *   file: ParsedFile,
 *   decl: KeyDecl,
 *   entry: ParsedRule,
 * } | {
 *   status: "retired",
 *   reason: "rule" | "feature",
 * } | {
 *   status: "unresolved",
 *   reason: "feature" | "rule",
 * }} ResolvedRuleRef
 */

/**
 * The files and the project one (index, files) pair resolves against: read once per pair, so a
 * reference costs a lookup and not a walk of the tree.
 * @typedef {{
 *   readable: ParsedFile[],
 *   project: ParsedFile | null,
 * }} RuleScope
 */

/**
 * The reverse Dependency index, built once from a tree: a Rule's live Upstream Rules, the Rules
 * that name it, and every Upstream Rule a Feature reaches transitively.
 * @typedef {{
 *   upstreamOf: (feature: string, rule: string) => RuleRef[],
 *   dependentsOf: (feature: string, rule: string) => RuleRef[],
 *   upstreamClosure: (feature: string) => Array<{ upstream: RuleRef, via: RuleRef[] }>,
 * }} DependencyIndex
 */

/**
 * One end of a Rule's Dependency: the qualified reference, the Feature and Rule keys it names,
 * and that Rule's statement. A Rule's Upstream Rules are the ends of `depends_on`; its dependents
 * are the ends of `dependents`.
 * @typedef {{
 *   ref: string,
 *   feature: string,
 *   rule: string,
 *   statement: string,
 * }} DependencyEnd
 */

// `<feature_key>/<rule_key>`: exactly one `/`, a kebab-case Feature slug before it and a Rule key
// after it. A Rule key keeps its `rule_` prefix, as in `covers`.
/**
 * @param {string} text
 * @returns {RuleRef | null}
 */
export function parseRuleRef(text) {
  const at = text.indexOf("/");
  if (at <= 0 || at !== text.lastIndexOf("/")) return null;
  const feature = text.slice(0, at);
  const rule = text.slice(at + 1);
  return PATTERN.slug.test(feature) && PATTERN.rule.test(rule) ? { feature, rule } : null;
}

/**
 * @param {RuleRef} ref
 * @returns {string}
 */
export function formatRuleRef(ref) {
  return `${ref.feature}/${ref.rule}`;
}

// Is this text a qualified Rule reference? The one question every caller asks of a reference, asked
// once, so no caller re-derives it from a slash or a pattern of its own.
/**
 * @param {string} text
 * @returns {boolean}
 */
export function isQualifiedRuleRef(text) {
  return parseRuleRef(text) !== null;
}

// Is this text a Rule reference of either kind: a local `rule_` key, or a qualified reference?
/**
 * @param {string} text
 * @returns {boolean}
 */
export function isRuleRef(text) {
  return PATTERN.rule.test(text) || isQualifiedRuleRef(text);
}

// Rule references in Finding evidence stay qualified; a qualified token never also names a local Rule.
/**
 * @param {string} text
 * @returns {string[]}
 */
export function ruleRefsIn(text) {
  return (text.match(/[0-9A-Za-z][0-9A-Za-z_/-]*/g) ?? []).filter((key) => isRuleRef(key));
}

// A Rule's `Depends on:` field is the first one in its field block; the others are the Scan's
// `repeated_dependency_field` error, and no second field supplies a Dependency.
/**
 * @param {ParsedRule} rule
 * @returns {DependsOn | null}
 */
export function readDependsOn(rule) {
  const field = rule.fields.find((f) => f.name === "Depends on");
  return field ? parseDependsField(field) : null;
}

// One `Depends on:` field, read: its live references, the line it sits on, and the texts that are
// not references at all. Every reader of the field reads it here, so the Scan and the resolver
// never disagree about what a field names.
/**
 * @param {RuleField} field
 * @returns {DependsOn}
 */
export function parseDependsField(field) {
  return parseDependsValue(field.value, field.line);
}

// One `Depends on:` value: comma-separated references, each trimmed. An empty value names nothing;
// any other text that is no reference is kept in `malformed`.
/**
 * @param {string} value
 * @param {number} line
 * @returns {DependsOn}
 */
function parseDependsValue(value, line) {
  /** @type {RuleRef[]} */
  const refs = [];
  /** @type {string[]} */
  const malformed = [];
  if (!value) return { refs, line, malformed };
  for (const part of value.split(",")) {
    const text = part.trim();
    const ref = parseRuleRef(text);
    if (ref) refs.push(ref);
    else malformed.push(text);
  }
  return { refs, line, malformed };
}

// Every string in a frontmatter list, in order.
/**
 * @param {unknown} value
 * @returns {string[]}
 */
const strings = (value) => (Array.isArray(value) ? /** @type {string[]} */ (value.filter((v) => typeof v === "string")) : []);

// The scope of one (index, files) pair, read once and kept: the readable files and the project
// they hold. A tree is walked many times (the Dependency index resolves every reference of every
// Rule), so the files are not filtered again for each one.
/** @type {WeakMap<KeyIndex, WeakMap<readonly (ParsedFile | UnreadableFile)[], RuleScope>>} */
const scopes = new WeakMap();

/**
 * @param {ParsedFile | UnreadableFile} file
 * @returns {file is ParsedFile}
 */
const isReadable = (file) => !file.unreadable;

/**
 * @param {KeyIndex} index
 * @param {readonly (ParsedFile | UnreadableFile)[]} files
 * @returns {RuleScope}
 */
function scopeOf(index, files) {
  let byFiles = scopes.get(index);
  if (!byFiles) scopes.set(index, (byFiles = new WeakMap()));
  const cached = byFiles.get(files);
  if (cached) return cached;
  const readable = files.filter(isReadable);
  const scope = { readable, project: index.project ?? readable.find((f) => f.type === "project") ?? null };
  byFiles.set(files, scope);
  return scope;
}

// A reference resolved only in the Feature it names. A retired Feature is retired even when its file
// is gone; a retired Rule is retired even when a stale heading still declares it.
/**
 * @param {KeyIndex} index
 * @param {readonly (ParsedFile | UnreadableFile)[]} files
 * @param {RuleRef} ref
 * @returns {ResolvedRuleRef}
 */
export function resolveRuleRef(index, files, ref) {
  const { readable, project } = scopeOf(index, files);
  if (strings(project?.data.retired_features).includes(ref.feature)) return { status: "retired", reason: "feature" };
  const featureFile = index.features.get(ref.feature)?.[0]?.file ?? readable.find((f) => f.type === "feature" && f.data.key === ref.feature) ?? null;
  if (!featureFile) return { status: "unresolved", reason: "feature" };
  const retired = strings(featureFile.data.retired).includes(ref.rule);
  if (retired) return { status: "retired", reason: "rule" };
  const decl = index.rules.get(ref.feature)?.get(ref.rule)?.[0];
  if (!decl) return { status: "unresolved", reason: "rule" };
  const entry = decl.file.rules.find((r) => r.key === ref.rule);
  if (!entry) return { status: "unresolved", reason: "rule" };
  return { status: "live", feature: ref.feature, rule: ref.rule, file: decl.file, decl, entry };
}

// The reverse Dependency index over `index`: each Rule's direct live Upstream Rules, the Rules that
// name it, and a Feature's transitive Upstream Rules with the dependent Rules that lead to each. The
// closure starts from every Rule of the Feature, skips what it has seen, and seeds the starting
// Feature's own Rules, so a cycle ends the walk instead of naming the Feature as its own upstream.
/**
 * @param {KeyIndex} index
 * @param {readonly (ParsedFile | UnreadableFile)[]} files
 * @returns {DependencyIndex}
 */
export function dependencyIndex(index, files) {
  /** @type {Map<string, RuleRef[]>} */
  const upstream = new Map();
  /** @type {Map<string, RuleRef[]>} */
  const dependents = new Map();
  /** @type {Map<string, RuleRef[]>} */
  const owned = new Map();
  for (const [feature, rules] of index.rules) {
    /** @type {RuleRef[]} */
    const mine = [];
    for (const [rule, decls] of rules) {
      const owner = { feature, rule };
      mine.push(owner);
      const entry = decls[0]?.file.rules.find((r) => r.key === rule);
      const depends = entry ? readDependsOn(entry) : null;
      if (!depends) continue;
      /** @type {RuleRef[]} */
      const live = [];
      for (const ref of depends.refs) {
        if (resolveRuleRef(index, files, ref).status !== "live") continue;
        live.push(ref);
        const key = formatRuleRef(ref);
        if (!dependents.has(key)) dependents.set(key, []);
        /** @type {RuleRef[]} */ (dependents.get(key)).push(owner);
      }
      if (live.length) upstream.set(formatRuleRef(owner), live);
    }
    owned.set(feature, mine);
  }
  /**
   * @param {string} feature
   * @param {string} rule
   * @returns {RuleRef[]}
   */
  const upstreamOf = (feature, rule) => upstream.get(formatRuleRef({ feature, rule })) ?? [];
  /**
   * @param {string} feature
   * @param {string} rule
   * @returns {RuleRef[]}
   */
  const dependentsOf = (feature, rule) => dependents.get(formatRuleRef({ feature, rule })) ?? [];
  /**
   * @param {string} feature
   * @returns {Array<{ upstream: RuleRef, via: RuleRef[] }>}
   */
  const upstreamClosure = (feature) => {
    /** @type {Array<{ upstream: RuleRef, via: RuleRef[] }>} */
    const out = [];
    /** @type {Set<string>} */
    const seen = new Set();
    const roots = owned.get(feature) ?? [];
    for (const root of roots) seen.add(formatRuleRef(root));
    /**
     * @param {RuleRef} from
     * @param {RuleRef[]} via
     * @returns {void}
     */
    const visit = (from, via) => {
      for (const ref of upstreamOf(from.feature, from.rule)) {
        const key = formatRuleRef(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ upstream: ref, via });
        visit(ref, [...via, ref]);
      }
    };
    for (const root of roots) visit(root, [root]);
    return out;
  };
  return { upstreamOf, dependentsOf, upstreamClosure };
}

// The live ends of the Dependencies `refs` names: each reference resolved in the Feature it names
// and the Rule's statement read. A reference that no longer resolves is dropped, as the Dependency
// index drops the edge it stood for.
/**
 * @param {KeyIndex} index
 * @param {readonly (ParsedFile | UnreadableFile)[]} files
 * @param {readonly RuleRef[]} refs
 * @returns {DependencyEnd[]}
 */
export function dependencyEnds(index, files, refs) {
  return refs.flatMap((ref) => {
    const resolved = resolveRuleRef(index, files, ref);
    if (resolved.status !== "live") return [];
    return [{ ref: formatRuleRef(ref), feature: ref.feature, rule: ref.rule, statement: resolved.entry.statement }];
  });
}
