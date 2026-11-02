// @ts-check
// `brief`: the self-contained brief for one delegated unit, with every input inlined (ADR-0010).
//
//   judge <scenario-key>   one non-empty scenario file of a Feature `scan` classes as judged
//                          (`first_judgement` or `candidate`), with the Feature's Change bundle
//   feature <feature-key>  one Feature's Rules against its Boundaries (ADR-0039): the Feature-level
//                          judge unit, which is planned for a Feature that has Boundaries and a
//                          candidate Rule
//   design <scenario-key>  one scenario file to fill (empty), expand or regenerate (populated), with
//                          its Feature (lib/design-unit.mjs)
//
// The Change bundle of `/qa-impact` (ADR-0007) is read from `scan`'s history
// facts, never re-derived:
//   - the post-change Feature file with every Rule as its heading, plus full prose only for the
//     Rules whose stripped block changed (`rules_changed`); on a first judgement, all in full;
//   - the stripped diff since the Watermark (none on a first judgement, and none when the Feature is
//     a candidate only because an Upstream Rule changed);
//   - every direct Upstream Rule in full, plus changed transitive Upstream Rules with their
//     Watermark-time text labelled as history;
//   - the full text of every case entry the diff touched (`cases_changed`), none on a first
//     judgement, and none at all past the cap: the unit then gets the plain bundle and the JSON
//     says so (`changed_cases.degraded`);
//   - the cases of the Feature's other scenario files that collide with a selected case (they share
//     a governing Rule), as read-only context a Conflict may name as its other side (ADR-0043). The
//     changed cases and the context share the cap, and the context is the first thing trimmed: the
//     brief then says so, and the JSON (`context_cases.dropped`).
import { basename, dirname, posix, resolve } from "node:path";
import { orThrow } from "./cli.mjs";
import { agreementBriefPosition } from "./design-agreement-brief.mjs";
import { readAgreementFile, staleAgreement } from "./design-agreement.mjs";
import { designMode, designUnit, loadFeature } from "./design-unit.mjs";
import { readFileSync } from "node:fs";
import { changeData } from "./change-data.mjs";
import { loadQaTree, repositoryOf } from "./git-tree.mjs";
import { contextSection, featureBrief, featureOnlySentence, fenced, judgeBrief } from "./judge-prompt.mjs";
import { projectConfig } from "./knowledge-file.mjs";
import { buildIndex } from "./qa-index.mjs";
import { relianceOf } from "./reliance.mjs";
import { dependencyIndex, formatRuleRef, resolveRuleRef } from "./rule-ref.mjs";
import { scan } from "./scan.mjs";
import { collides, governingOf, isJudged, selectCases } from "./selection.mjs";
import { resolveAdapter, wordsOf } from "./stack.mjs";
import { bookkeepingLines, withoutBookkeeping } from "./stripped.mjs";

/** @import {CommandDefinition} from "./cli.mjs" */
/** @import {ChangedCaseFacts, ContextCaseFacts, JudgeBriefJson} from "./impact.mjs" */
/** @import { DesignMode } from "./design-unit.mjs" */
/** @import { JudgeBoundary, JudgeContextFile, JudgeRule } from "./judge-prompt.mjs" */
/** @import { KeyIndex } from "./qa-index.mjs" */
/** @import { CaseEntry, ParsedFile as QaFile, UnreadableFile } from "./knowledge-file.mjs" */
/** @import { FeatureSummary } from "./scan-history.mjs" */
/** @import { RuleRef } from "./rule-ref.mjs" */
/** @import { ChangeData } from "./change-data.mjs" */
/** @import { DesignBrief } from "./design-unit.mjs" */
/** @import { Agreement, StaleAgreement } from "./design-agreement.mjs" */

/**
 * An Upstream Rule in the Change bundle: its current text, dependent Rules leading to it, and
 * optional Watermark-time history. Only `text` can supply a side of a Conflict.
 * @typedef {{ ref: string, via: string[], text: string, history: string | null }} UpstreamRule
 */

/**
 * What `brief` prints: the unit's JSON contract, a stale agreement's refusal, or the `{error}` of a
 * usage refusal.
 * @typedef {{ exit: number, json: JudgeBriefJson | DesignBrief | { ok: false, refusals: StaleAgreement[] } } | { error: string }} BriefResult
 */

/**
 * One `brief <unit> <scenario-key>` call's options, as the run and `/qa-impact`'s plan give them.
 * @typedef {object} BriefOptions
 * @property {string} root - an existing `.qa/` directory
 * @property {{ ref: string | null, commit: string | null } | null} [target] - as `scan` takes it
 * @property {number} [cap]
 * @property {ChangeData | null} [change] - the run's `change.json`, which the selection reads
 * @property {boolean} [expand]
 * @property {boolean} [regenerate]
 * @property {string} [agreement] - a run's `agreement.json`, which the design brief may carry
 * @property {import("./design-agreement-brief.mjs").AgreementBriefPosition} [agreementBrief] - the release switch
 */

/**
 * A `.qa/` file of the tree `brief judge` reads, as `changedCases` names it (lib/git-tree.mjs
 * `loadQaTree` is unchecked): a {@link QaFile} with its bare file name.
 * @typedef {QaFile & { name: string }} BriefFile
 */

/**
 * One scenario file of the index, as `judgeUnit` reads it: a {@link QaFile} with its bare file
 * name (lib/knowledge-file.mjs `parse` is unchecked).
 * @typedef {QaFile & { name: string }} ScenarioFile
 */

/**
 * The repository `root` reads in (lib/git-tree.mjs `repositoryOf` is unchecked): the files the
 * brief shows carry it as their prefix.
 * @typedef {{ top: string, prefix: string } | null} BriefRepository
 */

/**
 * One branch of the `mode` the command line flags name, for the ternaries below (`lib/design-unit
 * .mjs` `designMode` returns `{mode}` or `{error}`, and only a present `error` on both members
 * narrows there).
 * @typedef {{ mode: DesignMode, error?: undefined } | { mode?: never, error: string }} DesignModeResult
 */

/**
 * One `designUnit` call's outcome, as above, so the ternary reads `{json}` or `{error}`.
 * @typedef {{ json: DesignBrief, error?: undefined } | { json?: never, error: string }} DesignUnitResult
 */

// The changed-case component's cap, in UTF-8 bytes. Not measured: it was sized by eye against one
// of Import's larger scenario files (the largest is ~27 KB), so a bulk edit
// cannot make each bundle carry more changed cases than its own file.
/** @type {number} */
export const DEFAULT_CAP = 32768;

// One unit's brief: `[unit, ...args]` as the command line gives them (`command`, below; `/qa-impact`'s
// plan calls it too). Returns `{json, exit}`, or `{error}` for a usage error.
// `root` is an existing `.qa/` directory; `target`, when given, is `{ref, commit}`, as `scan` takes it.
/**
 * @param {[string, ...string[]]} action - `[unit, ...args]` as the command line gives them
 * @param {BriefOptions} options
 * @returns {BriefResult}
 */
export function brief([unit, ...args], { root, target = null, cap = DEFAULT_CAP, change = null, expand, regenerate, agreement, agreementBrief = "off" }) {
  if (unit === "design") {
    if (args.length !== 1) return { error: "brief design takes exactly one <scenario-key>" };
    if (target) return { error: "brief design reads the working tree: --target is for judge units" };
    /** @type {DesignModeResult} */
    const m = designMode({ expand, regenerate });
    if (m.error) return m;
    /** @type {Agreement | null} */
    let recorded = null;
    if (agreement !== undefined) {
      recorded = readAgreementFile(agreement);
      // The basis is the gate: a stale agreement must not shape a brief. `designUnit` checks that
      // the agreement names the scenario's Feature when it renders the block.
      const ctx = loadFeature(root, recorded.feature);
      if (!ctx.feature) return { error: `the agreement names no Feature \`${recorded.feature}\` in ${root}` };
      const stale = staleAgreement(ctx, recorded);
      if (stale) return { exit: 1, json: { ok: false, refusals: [stale] } };
    }
    /** @type {DesignUnitResult} */
    const d = designUnit(/** @type {string} */ (args[0]), { root, mode: m.mode, agreement: recorded, agreementBrief });
    return d.error ? d : { exit: 0, json: /** @type {DesignBrief} */ (d.json) };
  }
  if (unit === "feature") {
    if (args.length !== 1) return { error: "brief feature takes exactly one <feature-key>" };
    if (expand || regenerate) return { error: "--expand and --regenerate are for design units" };
    if (agreement !== undefined) return { error: "--agreement is for design units" };
    return featureUnit(/** @type {string} */ (args[0]), { root, target });
  }
  if (unit !== "judge") return { error: "brief takes a unit: judge, design" };
  if (expand || regenerate) return { error: "--expand and --regenerate are for design units" };
  if (agreement !== undefined) return { error: "--agreement is for design units" };
  if (args.length !== 1) return { error: "brief judge takes exactly one <scenario-key>" };
  if (!Number.isInteger(cap) || cap < 0) return { error: "--cap must be an integer ≥ 0" };
  return judgeUnit(/** @type {string} */ (args[0]), { root, target, cap, change });
}

// The judge unit's brief: the scenario file, its Feature and the Change bundle, as `brief`'s JSON
// reads.
/**
 * @param {string} key
 * @param {{ root: string, target: { ref: string | null, commit: string | null } | null, cap: number, change: ChangeData | null }} options
 * @returns {BriefResult}
 */
function judgeUnit(key, { root, target, cap, change: runData }) {
  /** @type {BriefRepository} */
  const repo = repositoryOf(root);
  /** @type {BriefFile[]} */
  const files = /** @type {BriefFile[]} */ (loadQaTree(root, target?.commit));
  // The index is trusted past `buildIndex` (lib/qa-index.mjs is unchecked), as `design-unit` reads it.
  /** @type {KeyIndex} */
  const index = buildIndex(files);
  const { adapter } = resolveAdapter(projectConfig(index.project).stack, dirname(resolve(root)));
  const decl = index.scenarios.get(key)?.[0];
  if (!decl) return { error: `no scenario \`${key}\` in ${root}` };
  const scenario = /** @type {ScenarioFile} */ (decl.file);
  const feature = decl.feature;
  const featureFile = feature === null ? null : index.features.get(feature)?.[0]?.file;
  if (!featureFile) return { error: `scenario \`${key}\` belongs to no Feature` };
  if (scenario.cases.length === 0) return { error: `scenario \`${key}\` is empty: an empty scenario file is never a judge unit` };

  // `scan`'s whole pass; the Change bundle reads its `history` facts. The Feature is a key (a scenario's
  // Feature is checked above) and the target, when given, is a resolved `{ref, commit}`.
  const scanned = scan(root, { feature: /** @type {string} */ (feature), target: /** @type {{ ref: string, commit: string } | null} */ (target) });
  const facts = scanned.history.features.find((f) => f.feature === feature);
  if (!facts || !isJudged(facts, runData)) {
    return { error: `Feature \`${feature}\` is \`${facts?.class ?? "unknown"}\`, not judged: only first_judgement and candidate Features, and a Feature \`/qa-ask\` escalated a case in, have judge units` };
  }
  const first = facts.class === "first_judgement";
  // Where the judge would find each file: repository-relative, as the measured briefs named them.
  /**
   * @param {string} rel
   */
  const shown = (rel) => (repo ? `${repo.prefix}${rel}` : posix.join(basename(resolve(root)), rel));
  // The judge reads only the cases the change selects (ADR-0043), each against every Rule that
  // governs it, unchanged Rules included.
  const selection = selectCases({ files, index, facts, obligations: scanned.history.stale_obligations, change: runData });
  const keys = [...new Set(scenario.cases.map((c) => c.key))].filter((k) => selection.keys.has(k));
  if (keys.length === 0) return { error: `scenario \`${key}\` has no selected case: only a scenario file with a case the change selects is a judge unit` };
  const chosen = scenario.cases.filter((c) => selection.keys.has(c.key));
  const governing = new Set(chosen.flatMap((c) => governingOf(c, /** @type {string} */ (feature))).filter((r) => r.startsWith(`${feature}/`)).map((r) => r.slice(/** @type {string} */ (feature).length + 1)));
  const touched = new Set([...(first ? featureFile.rules.map((r) => r.key) : facts.rules_changed), ...governing]);

  // The changed-case component is the same for every unit of the Feature, the judged file's own
  // cases included, so the cap degrades a run's units alike.
  /** @type {ChangedCaseFacts} */
  let changedCaseFacts = { keys: [], included: false, degraded: false, bytes: 0, cap };
  let change = null;
  if (!first) {
    const cases = changedCases(files, index, feature, new Set(facts.cases_changed));
    const bytes = Buffer.byteLength(cases);
    const degraded = bytes > cap;
    changedCaseFacts = { keys: facts.cases_changed, included: cases !== "" && !degraded, degraded, bytes, cap };
    // A candidate with no local diff is a downstream Feature whose Upstream Rule changed; an
    // `unchanged` Feature is judged only for the cases `/qa-ask` escalated.
    change = facts.class === "unchanged"
      ? { sentence: "No knowledge changed since the Watermark; `/qa-ask` sent the cases below for judgement against the Rules that govern them.", diff: "", cases: "" }
      : facts.diff === null
      ? { sentence: "No local knowledge changed since the Watermark; an Upstream Rule this Feature depends on changed.", diff: "", cases: "" }
      : { sentence: changeSentence(facts.diff, featureFile.rel), diff: facts.diff, cases: degraded ? "" : cases };
  }

  // The colliding cases of the Feature's other scenario files, as read-only context. They count
  // against the cap beside the changed cases, and are what is trimmed first: whole, so the judge
  // sees no case of another file, and the brief says so. The changed cases are trimmed only when
  // they alone exceed the cap, as before, and the context has gone by then.
  /** @type {JudgeContextFile[]} */
  const contextFiles = contextCases(files, index, /** @type {string} */ (feature), scenario, chosen, new Set(keys)).map((f) => ({ path: shown(f.rel), cases: f.cases }));
  const contextKeys = contextFiles.flatMap((f) => f.cases.map((c) => c.key));
  const contextBytes = Buffer.byteLength(contextSection(contextFiles));
  const contextDropped = contextKeys.length > 0 && changedCaseFacts.bytes + contextBytes > cap;
  /** @type {ContextCaseFacts} */
  const contextFacts = { keys: contextKeys, included: contextKeys.length > 0 && !contextDropped, dropped: contextDropped, bytes: contextBytes, cap };
  const kept = contextDropped ? [] : contextFiles;

  const upstream = withReliedOn(upstreamRules(files, index, root, facts), files, index, chosen, /** @type {string} */ (feature));
  const text = judgeBrief({
    first,
    nRules: featureFile.rules.length,
    featurePath: shown(featureFile.rel),
    scenarioPath: shown(scenario.rel),
    featureText: compress(featureFile, touched),
    scenarioText: selectedText(scenario, keys),
    file: scenario.name,
    total: scenario.cases.length,
    keys,
    boundaries: boundariesOf(featureFile),
    upstream,
    change,
    context: contextSection(kept),
    contextLeft: contextDropped ? contextKeys.length : 0,
    testSuite: wordsOf(adapter).testSuite,
  });
  const notes = [
    ...(changedCaseFacts.degraded ? [`the ${changedCaseFacts.keys.length} changed cases (${changedCaseFacts.bytes} bytes) exceed the ${cap}-byte cap: this unit gets the plain bundle, the diff without the changed cases in full`] : []),
    ...(contextDropped ? [`the ${contextKeys.length} context cases (${contextBytes} bytes) do not fit the ${cap}-byte cap: this unit gets no context, so it cannot see a Conflict with a case of another file`] : []),
  ];
  // The unit's contract JSON (`brief judge`'s), written under the run's `mode`.
  return {
    exit: 0,
    json: /** @type {JudgeBriefJson} */ ({
      ok: true,
      unit: "judge",
      feature: /** @type {string} */ (feature),
      scenario: key,
      file: scenario.rel,
      target: { ref: target?.ref ?? null, commit: target?.commit ?? null },
      class: facts.class,
      first_judgement: first,
      watermark: facts.watermark,
      keys,
      rules_in_full: featureFile.rules.map((r) => r.key).filter((k) => touched.has(k)),
      boundaries: boundariesOf(featureFile),
      upstream_rules: upstream,
      case_text: Object.fromEntries(chosen.map((c) => [c.key, caseTextOf(scenario, c)])),
      context_text: Object.fromEntries(kept.flatMap((f) => f.cases.map((c) => [c.key, c.text]))),
      rule_text: ruleTexts(featureFile, touched),
      changed_cases: changedCaseFacts,
      context_cases: contextFacts,
      ...(notes.length > 0 && { message: notes.join("; ") }),
      brief_bytes: Buffer.byteLength(text),
      brief: text,
    }),
  };
}

// The scenario file's text with every case it does not select cut out, Bookkeeping dropped: the
// judge is shown the selected cases only.
/**
 * @param {ScenarioFile} scenario
 * @param {readonly string[]} keys
 * @returns {string}
 */
function selectedText(scenario, keys) {
  if (scenario.cases.every((c) => keys.includes(c.key))) return withoutBookkeeping(scenario);
  const lines = textLines(scenario);
  for (const c of scenario.cases) if (!keys.includes(c.key)) for (let i = c.line - 1; i < c.end; i++) lines[i] = null;
  return lines.filter((x) => x !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}

// A Rule of another Feature that a selected case relies on is a governing Rule too, in full, as an
// Upstream Rule is, so a Conflict may quote it.
/**
 * @param {UpstreamRule[]} upstream
 * @param {BriefFile[]} files
 * @param {KeyIndex} index
 * @param {readonly CaseEntry[]} chosen
 * @param {string} feature
 * @returns {UpstreamRule[]}
 */
function withReliedOn(upstream, files, index, chosen, feature) {
  const out = [...upstream];
  for (const c of chosen) {
    for (const { ref, local } of relianceOf(c, feature).refs) {
      const name = formatRuleRef(ref);
      if (local || out.some((u) => u.ref === name)) continue;
      out.push({ ref: name, via: [`${c.key} relies_on`], text: resolvedRuleText(files, index, ref), history: null });
    }
  }
  return out;
}

// Direct Upstream Rules are always in full. Changed transitive ones join them with history read
// at this Feature's Watermark, never the upstream Feature's own Watermark.
/**
 * @param {BriefFile[]} files
 * @param {KeyIndex} index
 * @param {string} root
 * @param {FeatureSummary} facts
 * @returns {UpstreamRule[]}
 */
function upstreamRules(files, index, root, facts) {
  const feature = facts.feature;
  const deps = dependencyIndex(index, files);
  /** @type {Map<string, { ref: RuleRef, via: string[] }>} */
  const rules = new Map();
  for (const key of index.rules.get(feature)?.keys() ?? []) {
    for (const ref of deps.upstreamOf(feature, key)) {
      const name = formatRuleRef(ref);
      const via = formatRuleRef({ feature, rule: key });
      const existing = rules.get(name);
      if (existing) {
        existing.via.push(via);
        continue;
      }
      rules.set(name, { ref, via: [via] });
    }
  }
  const changed = new Set(facts.upstream_changed.map((r) => r.ref));
  for (const { upstream, via } of deps.upstreamClosure(feature)) {
    const name = formatRuleRef(upstream);
    if (changed.has(name) && !rules.has(name)) rules.set(name, { ref: upstream, via: via.map(formatRuleRef) });
  }
  const before = changed.size ? loadQaTree(root, facts.watermark) : [];
  /** @type {KeyIndex} */
  const beforeIndex = buildIndex(before);
  return [...rules].map(([name, { ref, via }]) => ({
    ref: name,
    via,
    text: resolvedRuleText(files, index, ref),
    history: changed.has(name) ? resolvedRuleText(before, beforeIndex, ref) : null,
  }));
}

// Full stripped Rule text at either tree; an Upstream Rule newly added since the Watermark had
// no text there, so its history is empty.
/**
 * @param {readonly (QaFile | UnreadableFile)[]} files
 * @param {KeyIndex} index
 * @param {RuleRef} ref
 * @returns {string}
 */
function resolvedRuleText(files, index, ref) {
  const resolved = resolveRuleRef(index, files, ref);
  if (resolved.status !== "live") return "";
  return ruleText(textLines(resolved.file), resolved.entry);
}

// The Feature's Boundaries in full (ADR-0039): the key, the statement and the owner. The judge
// reads them whole, so nothing of a Boundary is compressed away.
/**
 * @param {QaFile} file
 * @returns {JudgeBoundary[]}
 */
function boundariesOf(file) {
  return file.boundaries.map((b) => ({ key: b.key, statement: b.statement, owner: b.owner }));
}

// The Feature-level judge unit's brief (ADR-0039): the Feature's Boundaries and the candidate Rules
// it judges them against. The candidates are the Rules that changed since the Watermark, or every
// Rule when a Boundary changed or the Feature has no Watermark yet.
/**
 * @param {string} slug
 * @param {{ root: string, target: { ref: string | null, commit: string | null } | null }} options
 * @returns {BriefResult}
 */
function featureUnit(slug, { root, target }) {
  const repo = repositoryOf(root);
  const files = loadQaTree(root, target?.commit);
  const index = buildIndex(files);
  const featureFile = index.features.get(slug)?.[0]?.file;
  if (!featureFile) return { error: `no Feature \`${slug}\` in ${root}` };
  if (featureFile.boundaries.length === 0) return { error: `Feature \`${slug}\` states no Boundary, so it has no Feature-level unit` };
  const facts = scan(root, { feature: slug, target, featureLevel: true });
  const level = facts.feature_level?.features.find((f) => f.feature === slug);
  if (!level) return { error: `Feature \`${slug}\` has no Feature-level unit: its Watermark does not resolve` };
  const { adapter } = resolveAdapter(projectConfig(index.project).stack, dirname(resolve(root)));
  const lines = textLines(featureFile);
  /** @type {JudgeRule[]} */
  const rules = level.rules.map((key) => {
    const rule = featureFile.rules.find((r) => r.key === key);
    return { key, text: rule ? ruleText(lines, rule) : "" };
  });
  const shown = repo ? `${repo.prefix}${featureFile.rel}` : posix.join(basename(resolve(root)), featureFile.rel);
  const text = featureBrief({
    featurePath: shown,
    boundaries: boundariesOf(featureFile),
    rules,
    testSuite: wordsOf(adapter).testSuite,
  });
  const summary = facts.history.features.find((f) => f.feature === slug);
  return {
    exit: 0,
    json: /** @type {JudgeBriefJson} */ ({
      ok: true,
      unit: "judge",
      kind: "feature",
      feature: slug,
      scenario: null,
      file: featureFile.rel,
      target: { ref: target?.ref ?? null, commit: target?.commit ?? null },
      class: summary?.class ?? "first_judgement",
      // The Feature-level unit judges every Rule when the Feature has no Watermark yet.
      first_judgement: featureFile.data.watermark === undefined || featureFile.data.watermark === null,
      watermark: summary?.watermark ?? null,
      keys: level.rules,
      rules_in_full: level.rules,
      boundaries: boundariesOf(featureFile),
      rule_text: Object.fromEntries(rules.map((rule) => [rule.key, rule.text])),
      brief_bytes: Buffer.byteLength(text),
      brief: text,
    }),
  };
}

// One Rule's text, as the judge sees it: its heading and its elaboration, less its Bookkeeping.
/**
 * @param {(string | null)[]} lines
 * @param {{ line: number, end: number }} rule
 * @returns {string}
 */
function ruleText(lines, rule) {
  return lines.slice(rule.line - 1, rule.end).filter((x) => x !== null).join("\n").replace(/\s+$/, "");
}

// One Test Case's text, as the judge sees it: its heading, its block and its prose, less its
// Bookkeeping. The reply check quotes it back, so the text it compares is the text it was given.
/**
 * @param {QaFile} file
 * @param {CaseEntry} c
 * @returns {string}
 */
function caseTextOf(file, c) {
  return textLines(file).slice(c.line - 1, c.end).filter((x) => x !== null).join("\n").replace(/\s+$/, "");
}

// The cases of the Feature's other scenario files that collide with the cases `chosen` (ADR-0043):
// they share a governing Rule with one, which is what the selection adds a case for. Each is given
// as the judge sees a case. A case this unit already holds (`keys`) is not repeated, and a case
// shown twice is shown once. The unit's own file is the judge's to read in full, so it is left out.
/**
 * @param {BriefFile[]} files
 * @param {KeyIndex} index
 * @param {string} feature
 * @param {ScenarioFile} scenario - the unit's file
 * @param {readonly CaseEntry[]} chosen
 * @param {ReadonlySet<string>} keys
 * @returns {{ rel: string, cases: { key: string, text: string }[] }[]}
 */
function contextCases(files, index, feature, scenario, chosen, keys) {
  const claimed = new Set(chosen.flatMap((c) => governingOf(c, feature)));
  const seen = new Set(keys);
  /** @type {{ rel: string, cases: { key: string, text: string }[] }[]} */
  const out = [];
  for (const f of files) {
    if (f.unreadable || f.type !== "scenario" || index.featureOf(f) !== feature || f.rel === scenario.rel) continue;
    /** @type {{ key: string, text: string }[]} */
    const cases = [];
    for (const c of f.cases) {
      if (seen.has(c.key) || !collides(governingOf(c, feature), claimed)) continue;
      seen.add(c.key);
      cases.push({ key: c.key, text: caseTextOf(f, c) });
    }
    if (cases.length) out.push({ rel: f.rel, cases });
  }
  return out;
}

// Each Rule's text, as the judge sees it: its whole block where the bundle keeps it in full, its
// heading and field lines where the bundle compresses it. The reply check reads them, so a quote
// is compared with the text the judge was given.
/**
 * @param {QaFile} file
 * @param {Set<string>} full - the Rules the bundle keeps in full
 * @returns {Record<string, string>}
 */
function ruleTexts(file, full) {
  const lines = textLines(file);
  /** @type {Record<string, string>} */
  const out = {};
  for (const r of file.rules) {
    out[r.key] = full.has(r.key)
      ? ruleText(lines, r)
      : [lines[r.line - 1], ...r.fields.map((f) => lines[f.line - 1])].filter((x) => x !== null).join("\n");
  }
  return out;
}

// The Feature file with every Rule not in `full` cut to its heading line:
// one blank line after each heading, everything else in the file untouched but its Bookkeeping.
// A Rule's field block is not elaboration: it stays in the bundle, so the judge still sees every
// field the Rule carries even where the elaboration is dropped.
/**
 * @param {QaFile} file
 * @param {Set<string>} full
 * @returns {string}
 */
function compress(file, full) {
  const lines = textLines(file);
  const out = [];
  let l = 1;
  for (const r of [...file.rules].sort((a, b) => a.line - b.line)) {
    if (full.has(r.key)) continue;
    out.push(...lines.slice(l - 1, r.line - 1), lines[r.line - 1]);
    for (const field of r.fields) out.push(lines[field.line - 1]);
    out.push("");
    // A Rule's block always ends (lib/knowledge-file.mjs `sectionEnd`), so `end` is its last line.
    l = /** @type {number} */ (r.end) + 1;
  }
  out.push(...lines.slice(l - 1));
  return out.filter((x) => x !== null).join("\n");
}

// A file's lines (LF), each Bookkeeping line (lib/stripped.mjs) null, so line numbers still hold:
// a brief inlines no Bookkeeping, so no earlier finding anchors a verdict.
/**
 * @param {QaFile} file
 * @returns {(string | null)[]}
 */
function textLines(file) {
  const drop = bookkeepingLines(file);
  return file.text.replace(/\r\n/g, "\n").split("\n").map((x, i) => (drop.has(i + 1) ? null : x));
}

// The full text of each changed case, grouped by its scenario file, as it stands in the target.
/**
 * @param {BriefFile[]} files
 * @param {KeyIndex} index
 * @param {string | null} feature
 * @param {Set<string>} keys
 * @returns {string}
 */
function changedCases(files, index, feature, keys) {
  if (keys.size === 0) return "";
  const parts = [];
  for (const f of files) {
    if (f.unreadable || f.type !== "scenario" || index.featureOf(f) !== feature) continue;
    const lines = textLines(f);
    const entries = f.cases.filter((c) => keys.has(c.key)).map((c) => lines.slice(c.line - 1, c.end).filter((x) => x !== null).join("\n").replace(/\s+$/, ""));
    if (entries.length) parts.push(`\`${f.name}\`:\n\n${fenced(entries.join("\n\n"), "markdown")}`);
  }
  if (parts.length === 0) return "";
  return `=== THE CHANGED CASES ===

The diff touched these Test Cases. Each is given in full, as it stands after the change.

${parts.join("\n")}
`;
}

// What changed, in words. A change to the Feature file alone reads exactly as the measurements
// had it; any other shape names its files.
/**
 * @param {string} diff
 * @param {string} featureRel
 * @returns {string}
 */
function changeSentence(diff, featureRel) {
  const rels = diffFiles(diff);
  const featureChanged = rels.includes(featureRel);
  const others = rels.filter((r) => r !== featureRel).map((r) => posix.basename(r));
  if (featureChanged && others.length === 0) return featureOnlySentence(posix.basename(featureRel));
  const parts = [];
  if (featureChanged) parts.push(`the Feature file \`${posix.basename(featureRel)}\``);
  if (others.length) parts.push(`the Test Scenario file${others.length > 1 ? "s" : ""} ${others.map((n) => `\`${n}\``).join(", ")}`);
  const count = rels.length === 1 ? "exactly one file" : `${rels.length} files`;
  return `Since the Watermark, ${count} changed: ${parts.join(" and ")}.${featureChanged ? "" : " The Feature file did not change."}`;
}

// The files a `scan` diff covers, read by walking its hunks by their line counts, so no content
// line is mistaken for a file header. The diff is `stripped.mjs`'s `unifiedDiff`, which always
// writes both counts and never a `\ No newline` line; an omitted count reads as 1, as in git.
/**
 * @param {string} diff
 * @returns {string[]}
 */
function diffFiles(diff) {
  const rels = [];
  const lines = diff.split("\n");
  for (let i = 0; i < lines.length; ) {
    const from = lines[i].match(/^--- (?:a\/(.*)|\/dev\/null)$/);
    const to = lines[i + 1]?.match(/^\+\+\+ (?:b\/(.*)|\/dev\/null)$/);
    if (!from || !to) {
      i++;
      continue;
    }
    rels.push(/** @type {string} */ (to[1] ?? from[1]));
    i += 2;
    while (i < lines.length) {
      const h = lines[i].match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
      if (!h) break;
      let [a, b] = [Number(h[1] ?? 1), Number(h[2] ?? 1)];
      i++;
      while ((a > 0 || b > 0) && i < lines.length) {
        const op = lines[i++][0];
        if (op !== "+") a--;
        if (op !== "-") b--;
      }
    }
  }
  return rels;
}

// The command line's `brief <judge|design> <scenario-key>` (scripts/scan.mjs). Never writes.
/**
 * @type {CommandDefinition}
 */
export const command = {
  options: { root: "qa-dir", target: "commit", cap: "value", change: "value", expand: "flag", regenerate: "flag", agreement: "value" },
  usage: ["judge <scenario-key> [--target <ref>] [--cap <bytes>] [--change <change-json>] [--root <qa-dir>]", "feature <feature-key> [--target <ref>] [--root <qa-dir>]", "design <scenario-key> [--expand | --regenerate] [--agreement <file>] [--root <qa-dir>]"],
  run(args, { root, target, cap, change, expand, regenerate, agreement, env }) {
    // cli.mjs resolves the options before run: `root` is a `.qa/` directory, the two flags names are
    // booleans and `target` is the commit ref `scan` takes, or null.
    /** @type {ChangeData | null} */
    let runData = null;
    if (change !== undefined) {
      try {
        runData = changeData(JSON.parse(readFileSync(/** @type {string} */ (change), "utf8")));
      } catch {
        return orThrow({ error: `--change ${change} is not a readable change.json` });
      }
    }
    return orThrow(brief(/** @type {[string, ...string[]]} */ (args), {
      change: runData,
      root: /** @type {string} */ (root),
      target,
      cap: cap === undefined ? undefined : Number(cap),
      expand: /** @type {boolean} */ (expand),
      regenerate: /** @type {boolean} */ (regenerate),
      agreement: /** @type {string | undefined} */ (agreement),
      agreementBrief: agreementBriefPosition(env),
    }));
  },
};
