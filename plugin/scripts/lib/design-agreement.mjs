// @ts-check
// `design agree`: the agreement bound of `/qa-design` (ADR-0042). It is read-only: it validates the
// agreement the orchestrator proposes, computes the coverage basis its brief depends on, and returns
// the canonical agreement with the planned and actual coverage views.
//
// The agreement is the one contract every later design step reads (lib/design.mjs `agree`):
//
//   {"v": 1, "feature": "<slug>", "scope": "feature" | "<scenario-key>",
//    "basis": "<agreement-input fingerprint>",
//    "scenarios": {"<key or new:N>": {"action": "fill" | "expand" | "regenerate",
//                                    "summary": "<for new>", "levels": ["<level>"],
//                                    "rules": ["rule_…"], "highlights": ["rule_…"],
//                                    "remarks": ["…"], "obligations": ["rule_…"]}},
//    "retained": {"rule_…": ["<scenario key>"]},
//    "handoffs": {"proposed_rules": [{"statement": "…", "why": "…"}],
//                 "coverage_corrections": ["…"]}}
//
// `basis` fingerprints its inputs: the Feature's full stripped knowledge (its
// `## Coverage` section included, unlike the impact projection), the targeted scenario files, the
// effective Coverage category list, the project levels, the project's Tags and Custom fields, and `train/design.md`'s Conventions. Any later edit to one of
// them makes the agreement stale.
//
// Completeness is scoped to `scope`. A whole-Feature agreement assigns every uncovered non-Waived
// Rule and every non-Waived Rule whose only coverage a regenerate replaces. A scoped agreement
// answers for its selected scenario's obligations whatever its action: the non-Waived Rules its kept
// cases cover today and the Rules the engineer assigns to it. The Feature's other gaps are reported
// in `gaps`, never refused.
/** @import { CaseEntry, ParsedFile as QaFile } from "./knowledge-file.mjs" */
/** @import { EffectiveCategory } from "./categories.mjs" */
/** @import { FeatureContext, ScenarioState } from "./design-unit.mjs" */
/** @import { CoverageLine, CoverageSection } from "./coverage.mjs" */
import { basename, dirname, join, resolve } from "node:path";
import { effectiveCategories } from "./categories.mjs";
import { UsageError } from "./cli.mjs";
import { parseCoverage } from "./coverage.mjs";
import { isMap, LINE_BREAK, listOf } from "./dialect.mjs";
import { modeRefusal, replaceable } from "./design-unit.mjs";
import { table } from "./markdown.mjs";
import { digestOf } from "./pin-digest.mjs";
import { readRunFile } from "./run-dir.mjs";
import { DESIGN_TRAIN_KEY } from "./schema.mjs";
import { strip } from "./stripped.mjs";
import { conventionsText } from "./training.mjs";

/**
 * One action an agreement gives a scenario file.
 * @typedef {"fill" | "expand" | "regenerate"} AgreementAction
 */

/**
 * One scenario's canonical agreement entry. `summary` is present only for a `new:N` entry;
 * `obligations` is the assigned Rules plus, for a regenerate or a scoped run's selected scenario, the
 * non-Waived Rules its kept cases cover, sorted.
 * @typedef {object} AgreementScenario
 * @property {AgreementAction} action
 * @property {string} [summary]
 * @property {string[]} levels
 * @property {string[]} rules
 * @property {string[]} highlights
 * @property {string[]} remarks
 * @property {string[]} obligations
 */

/**
 * One proposed Rule handed to `/qa-deep-dive`.
 * @typedef {object} AgreementProposedRule
 * @property {string} statement
 * @property {string} [why]
 */

/**
 * The canonical agreement, computed by `checkAgreement` and recorded by `design split`.
 * @typedef {object} Agreement
 * @property {1} v
 * @property {string} feature
 * @property {string} scope
 * @property {string} basis
 * @property {Record<string, AgreementScenario>} scenarios
 * @property {Record<string, string[]>} retained
 * @property {{ proposed_rules: AgreementProposedRule[], coverage_corrections: string[] }} handoffs
 */

/**
 * A recorded agreement whose basis no longer fingerprints the tree it was made over.
 * @typedef {object} StaleAgreement
 * @property {"stale_agreement"} code
 * @property {string} message
 */

/**
 * One scenario's coverage of one category: the Rules it covers or is assigned there, and whether
 * that leaves some of the category's Rules to another scenario.
 * @typedef {object} CoverageScenario
 * @property {string} scenario
 * @property {string[]} rules
 * @property {boolean} partial
 */

/**
 * The inverse direction: one category's coverage in one scenario.
 * @typedef {object} CoverageCategory
 * @property {string} category
 * @property {string[]} rules
 * @property {boolean} partial
 */

/**
 * One direction of a coverage view, plus every effective category's Coverage disposition.
 * @typedef {object} CoverageView
 * @property {Record<string, CoverageScenario[]>} byCategory
 * @property {Record<string, CoverageCategory[]>} byScenario
 * @property {Record<string, string>} dispositions
 */

/**
 * The planned and actual coverage views as data and compact Markdown (ADR-0024).
 * @typedef {object} CoverageViews
 * @property {CoverageView} actual
 * @property {CoverageView} [planned]
 * @property {string} markdown
 */

/**
 * One refusal the agreement itself raises. Unlike a usage refusal this carries the proposal's own
 * detail, so the model can show which Rule, scenario or action was wrong.
 * @typedef {object} AgreementRefusal
 * @property {string} code
 * @property {string} message
 * @property {string} [rule]
 * @property {string} [scenario]
 * @property {string} [action]
 * @property {string} [reason]
 * @property {boolean} [scope]
 * @property {boolean} [retained]
 */

/**
 * A Feature Rule the agreement leaves without case evidence, reported for a scoped run.
 * @typedef {object} AgreementGap
 * @property {string} rule
 * @property {string} statement
 * @property {"uncovered" | "regenerate"} reason
 */

/**
 * What `checkAgreement` returns, and what `design agree` prints.
 * @typedef {object} AgreementResult
 * @property {boolean} ok
 * @property {Agreement | null} agreement
 * @property {CoverageViews} views
 * @property {AgreementRefusal[]} refusals
 * @property {AgreementGap[]} gaps
 */

/**
 * One case's coverage, with whether a regenerate replaces it.
 * @typedef {object} CaseCoverage
 * @property {string} scenario
 * @property {boolean} replaced
 */

/**
 * One scenario file's Rules, keyed by the scenario's Key.
 * @typedef {object} ScenarioCoverage
 * @property {string} key
 * @property {QaFile} file
 * @property {Set<string>} covers
 */

/** @type {readonly AgreementAction[]} */
const ACTIONS = ["fill", "expand", "regenerate"];
const NEW_KEY = /^new:[1-9]\d*$/;
const NOT_ASSESSED = "not assessed";

/**
 * Whether a scenario key is a `new:N` placeholder for a file `design split` mints.
 * @param {string} key
 * @returns {boolean}
 */
export function isNewScenarioKey(key) {
  return NEW_KEY.test(key);
}

/**
 * The fingerprint of every input an agreement or its brief depends on: the Feature's full stripped
 * knowledge with `## Coverage` included, the targeted scenario files, the effective Coverage
 * category list, the project levels, the project's Tags and Custom fields, and `train/design.md`'s Conventions. Two agreements over the same inputs have
 * the same basis; an edit to any of them changes it.
 * @param {FeatureContext} ctx The Feature's design context.
 * @param {string} feature The Feature's slug.
 * @param {string} scope `"feature"` or the selected scenario's Key.
 * @returns {string}
 */
export function agreementBasis(ctx, feature, scope) {
  const featureFile = ctx.index.features.get(feature)?.[0]?.file ?? null;
  const scenarios = scenarioCoverage(ctx, feature)
    .filter((s) => scope === "feature" || s.key === scope)
    .map((s) => /** @type {[string, string]} */ ([s.key, strip(s.file).text]));
  return digestOf([
    "agreement",
    feature,
    ["feature", featureFile === null ? null : strip(featureFile).text],
    ["scenarios", ...scenarios],
    ["categories", effectiveCategories(ctx.root).categories],
    ["levels", ctx.levels],
    ["labels", ctx.labels],
    ["conventions", conventionsText(ctx.index, DESIGN_TRAIN_KEY)],
  ]);
}

/**
 * Why a recorded agreement no longer matches the tree, or null when its basis still does. The
 * comparison is a fresh `agreementBasis` over the same Feature and scope, so any edit to the
 * Feature's stripped knowledge, its targeted scenario files, the project levels, its Tags and Custom fields, the effective category list or
 * `train/design.md`'s Conventions makes it stale.
 * @param {FeatureContext} ctx The Feature's design context.
 * @param {Agreement} agreement The recorded agreement, read at its own boundary.
 * @returns {StaleAgreement | null}
 */
export function staleAgreement(ctx, agreement) {
  if (agreementBasis(ctx, agreement.feature, agreement.scope) === agreement.basis) return null;
  return {
    code: "stale_agreement",
    message: "the agreement's basis no longer matches the Feature, its scenario files, the Coverage categories or design's Conventions: run `design agree` again",
  };
}

/**
 * The agreement `design split` recorded in a run directory. A missing, corrupt or non-agreement
 * file is a usage error naming the run to start, never a silently empty agreement.
 * @param {string} dir The run directory.
 * @returns {Agreement}
 */
export function readAgreement(dir) {
  return readAgreementAt(dir, "agreement.json", join(dir, "agreement.json"), `no agreement in ${dir}: run \`design split\` first`);
}

/**
 * The agreement `--agreement <file>` names. A missing, corrupt or non-agreement file is a usage
 * error naming the run to start, never a silently empty agreement.
 * @param {string} file The agreement file, typically a run dir's `agreement.json`.
 * @returns {Agreement}
 */
export function readAgreementFile(file) {
  const path = resolve(file);
  return readAgreementAt(dirname(path), basename(path), path, `no agreement at ${path}: run \`design split\` first`);
}

/**
 * One agreement file's read, shared by the run-directory and `--agreement` forms: `where` is the
 * path the refusal names, and `missing` the message a run dir with no agreement raises.
 * @param {string} dir
 * @param {string} name
 * @param {string} where
 * @param {string} missing
 * @returns {Agreement}
 */
function readAgreementAt(dir, name, where, missing) {
  const read = readRunFile(dir, name, { by: "design split", restart: "design split", missing });
  if (read.error) throw new UsageError(read.error);
  if (!isAgreement(read.value)) {
    throw new UsageError(`${where} is not the agreement \`design split\` wrote: start a new run with \`design split\``);
  }
  return read.value;
}

/**
 * Whether a value is the agreement contract `design split` records.
 * @param {unknown} value
 * @returns {value is Agreement}
 */
function isAgreement(value) {
  if (!isMap(value)) return false;
  if (value.v !== 1) return false;
  if (typeof value.feature !== "string" || typeof value.scope !== "string" || typeof value.basis !== "string") return false;
  return isMap(value.scenarios) && isMap(value.retained) && isMap(value.handoffs);
}

/**
 * The canonical agreement and every problem with the proposed one. `views` always carries the
 * actual coverage view; `planned` is added when an agreement could be read. `gaps` names the
 * Feature's Rules the agreement leaves without case evidence, reported rather than refused when
 * `scope` is one scenario.
 * @param {FeatureContext} ctx The Feature's design context.
 * @param {unknown} proposal The proposed agreement, trusted at this boundary after the shape checks.
 * @returns {AgreementResult}
 */
export function checkAgreement(ctx, proposal) {
  /** @type {AgreementRefusal[]} */
  const refusals = [];
  /**
   * @param {string} code
   * @param {string} message
   * @param {Omit<AgreementRefusal, "code" | "message">} [data]
   * @returns {void}
   */
  const bad = (code, message, data = {}) => {
    refusals.push({ code, message, ...data });
  };

  if (!isMap(proposal)) {
    bad("bad_proposal", "the agreement must be a JSON object");
    return { ok: false, agreement: null, views: coverageViews(ctx, featureOf(ctx), null), refusals, gaps: [] };
  }
  const feature = typeof proposal.feature === "string" ? proposal.feature : "";
  const scope = typeof proposal.scope === "string" ? proposal.scope : "feature";
  if (proposal.v !== undefined && proposal.v !== 1) bad("bad_proposal", "the agreement's `v` must be 1");
  if (!feature) bad("bad_proposal", "the agreement names no `feature`");

  const rules = new Map(ctx.rules.map((rule) => [rule.key, rule]));
  const states = new Map(ctx.scenarios.filter((s) => s.scenario !== null).map((s) => [/** @type {string} */ (s.scenario), s]));
  const scenarioKeys = new Set(states.keys());
  const rawScenarios = proposal.scenarios;
  if (!isMap(rawScenarios)) bad("bad_proposal", "`scenarios` must be an object keyed by scenario Key or `new:N`");

  if (scope !== "feature" && !scenarioKeys.has(scope)) bad("unknown_scenario", `the agreement's scope \`${scope}\` is no scenario of the Feature`, { scenario: scope, scope: true });

  /** @type {{ key: string, state: ScenarioState | null, action: AgreementAction, canonical: AgreementScenario }[]} */
  const entries = [];
  for (const [key, raw] of Object.entries(isMap(rawScenarios) ? rawScenarios : {})) {
    const isNew = isNewScenarioKey(key);
    const state = states.get(key) ?? null;
    if (!isNew && state === null) {
      bad("unknown_scenario", `\`${key}\` is neither a scenario of the Feature nor a \`new:N\` entry`, { scenario: key });
      continue;
    }
    if (!isMap(raw)) {
      bad("bad_scenario", `the entry for \`${key}\` is not an object`, { scenario: key });
      continue;
    }
    const action = raw.action;
    if (!isAction(action)) {
      bad("bad_action", `\`${key}\` names no valid action: fill, expand or regenerate`, { scenario: key, action: typeof action === "string" ? action : String(action) });
      continue;
    }
    if (isNew && action !== "fill") bad("action_mismatch", `\`${key}\` is a new scenario, so its action is \`fill\``, { scenario: key, action, reason: "new_scenario_fill" });
    if (state !== null) {
      if (state.status === "excluded") bad("scenario_excluded", `\`${key}\` cannot be designed: ${(state.problems ?? []).join("; ")}`, { scenario: key });
      else {
        const reason = modeRefusal(action, state);
        if (reason !== null) bad("action_mismatch", `\`${key}\` cannot be ${action}: ${reason}`, { scenario: key, action, reason });
      }
    }

    const assigned = stringList(raw.rules, `rules`, key, "bad_rules", bad);
    const highlights = stringList(raw.highlights, `highlights`, key, "bad_highlights", bad);
    const remarks = stringList(raw.remarks, `remarks`, key, "bad_remarks", bad);
    for (const rule of [...assigned, ...highlights]) {
      if (!rules.has(rule)) bad("unknown_rule", `\`${key}\` names \`${rule}\`, which is no live Rule of the Feature`, { scenario: key, rule });
    }
    if (isNew) {
      if (typeof raw.summary !== "string" || !raw.summary.trim() || LINE_BREAK.test(raw.summary)) {
        bad("summary_required", `\`${key}\` is a new scenario, so it needs a one-line summary`, { scenario: key });
      }
    }
    const levels = stringList(raw.levels, "levels", key, "bad_levels", bad);
    if (!levels.length) bad("levels_required", `\`${key}\` needs a non-empty list of wanted levels`, { scenario: key });
    for (const level of levels) if (!ctx.levels.includes(level)) bad("unknown_level", `\`${key}\` names level \`${level}\`, which is not in \`project.stack.levels\``, { scenario: key });

    /** @type {AgreementScenario} */
    const canonical = {
      action,
      ...(isNew ? { summary: String(raw.summary ?? "").trim() } : {}),
      levels,
      rules: assigned,
      highlights,
      remarks,
      obligations: [],
    };
    entries.push({ key, state, action, canonical });
  }

  const retained = checkRetained(proposal.retained, rules, scenarioKeys, bad);
  const handoffs = checkHandoffs(proposal.handoffs, bad);

  const coverage = caseCoverage(ctx, feature, entries);
  /** @param {string} rule */
  const covers = (rule) => coverage.get(rule) ?? [];
  /** @param {string} rule */
  const actual = (rule) => covers(rule).length > 0;
  /** @param {string} rule */
  const survives = (rule) => covers(rule).some((c) => !c.replaced);
  const assigned = new Set(entries.flatMap((entry) => entry.canonical.rules.filter((rule) => rules.has(rule))));
  // A regenerate replaces the scenario's cases, so every non-Waived live Rule they cover is an
  // obligation of that entry, whether or not another scenario also covers it. A fill or an expand
  // keeps its cases, so its obligations are its assigned Rules alone.
  /** @type {Map<string, string[]>} */
  const coveredToday = new Map(scenarioCoverage(ctx, feature).map((scenario) => [
    scenario.key,
    [...scenario.covers].filter((rule) => rules.has(rule) && rules.get(rule)?.waiver === null).sort(),
  ]));

  /** @type {AgreementGap[]} */
  const gaps = [];
  for (const rule of ctx.rules) {
    if (rule.waiver !== null) continue;
    if (actual(rule.key) && survives(rule.key)) continue;
    if (assigned.has(rule.key)) continue;
    gaps.push({ rule: rule.key, statement: rule.statement, reason: actual(rule.key) ? "regenerate" : "uncovered" });
  }

  // A scoped selection is only measured when its action fits its file: an action mismatch is already
  // the refusal, and a scenario it cannot touch has no obligations to carry.
  const selected = entries.find((entry) => entry.key === scope);
  const selectedFits = selected !== undefined && selected.state !== null && selected.state.status !== "excluded" && modeRefusal(selected.action, selected.state) === null;

  if (scope === "feature") {
    for (const gap of gaps) bad("unassigned_rule", `\`${gap.rule}\` is left without coverage: ${gap.reason === "regenerate" ? "a regenerate replaces its only coverage" : "no case covers it"}`, { rule: gap.rule, reason: gap.reason });
  } else if (selectedFits && selected !== undefined) {
    for (const rule of coveredToday.get(scope) ?? []) {
      if (!selected.canonical.rules.includes(rule)) bad("unassigned_rule", `\`${rule}\` is covered today in \`${scope}\`, so the scoped agreement assigns it`, { rule, reason: selected.action === "regenerate" ? "regenerate" : "covered", scenario: scope });
    }
  }

  for (const entry of entries) {
    // A regenerate replaces the scenario's cases, so every non-Waived live Rule they cover is an
    // obligation of that entry. A scoped run's selected scenario owes the same, whatever its action:
    // its kept cases are the evidence the close measures. Any other fill or expand keeps its cases
    // and its obligations are its assigned Rules alone.
    const carried = entry.action === "regenerate" || (selectedFits && entry.key === scope) ? coveredToday.get(entry.key) ?? [] : [];
    entry.canonical.obligations = [...new Set([...entry.canonical.rules, ...carried])].sort();
  }

  /** @type {Record<string, AgreementScenario>} */
  const scenarios = {};
  for (const entry of entries) scenarios[entry.key] = entry.canonical;
  /** @type {Agreement} */
  const agreement = { v: 1, feature, scope, basis: agreementBasis(ctx, feature, scope), scenarios, retained, handoffs };
  const views = coverageViews(ctx, feature, agreement);
  return { ok: refusals.length === 0, agreement, views, refusals, gaps };
}

/**
 * The planned and actual coverage views. `actual` is derived from each Test Case's `covers`; when an
 * agreement is given, `planned` is derived from the cases the run does not replace, each entry's
 * assigned Rules and the `retained` map. Every effective category appears in both `byCategory` maps
 * (possibly with no scenario), and `dispositions` names each one's Coverage disposition, or
 * `not assessed` for a legacy Feature without the section.
 * @param {FeatureContext} ctx The Feature's design context.
 * @param {string} feature The Feature's slug.
 * @param {Agreement | null} agreement The canonical agreement, or null for the actual view alone.
 * @returns {CoverageViews}
 */
export function coverageViews(ctx, feature, agreement) {
  const effective = effectiveCategories(ctx.root);
  const featureFile = ctx.index.features.get(feature)?.[0]?.file ?? null;
  const section = featureFile === null ? null : parseCoverage(featureFile.text);
  const lines = byCategoryLine(section);
  /** @type {Map<string, string[]>} */
  const categoryRules = new Map();
  for (const category of effective.categories) categoryRules.set(category.key, lines.get(category.key)?.rules ?? []);
  /** @type {Map<string, string>} */
  const dispositions = new Map(effective.categories.map((category) => [category.key, lines.get(category.key)?.disposition ?? NOT_ASSESSED]));

  /** @type {Map<string, string[]>} */
  const actualRules = new Map();
  for (const scenario of scenarioCoverage(ctx, feature)) actualRules.set(scenario.key, [...scenario.covers]);
  const actual = buildView(effective.categories, categoryRules, actualRules, dispositions);

  /** @type {CoverageView | undefined} */
  let planned;
  if (agreement !== null) {
    const scenarios = scenarioCoverage(ctx, feature);
    // The planned view is the coverage the run is about to leave behind: every case it does not
    // replace, each entry's assigned Rules, and the Rules `retained` says a kept case elsewhere holds.
    /** @type {Map<string, string[]>} */
    const plannedRules = new Map(scenarios.map((scenario) => [scenario.key, []]));
    for (const scenario of scenarios) {
      const entry = agreement.scenarios[scenario.key];
      const replaces = entry?.action === "regenerate";
      const rules = plannedRules.get(scenario.key) ?? [];
      for (const c of scenario.file.cases) {
        if (replaces && replaceable(c, ctx.index)) continue;
        rules.push(...listOf(c.data.covers));
      }
    }
    for (const [scenario, entry] of Object.entries(agreement.scenarios)) {
      const rules = plannedRules.get(scenario) ?? [];
      rules.push(...entry.rules);
      plannedRules.set(scenario, rules);
    }
    for (const [rule, holders] of Object.entries(agreement.retained)) {
      for (const scenario of holders) {
        const rules = plannedRules.get(scenario) ?? [];
        rules.push(rule);
        plannedRules.set(scenario, rules);
      }
    }
    planned = buildView(effective.categories, categoryRules, plannedRules, dispositions);
  }

  return { actual, ...(planned === undefined ? {} : { planned }), markdown: viewsMarkdown(effective.categories, lines, actual, planned) };
}

/**
 * One direction and its inverse: a category's Rules per scenario, a scenario's categories, and every
 * category's disposition.
 * @param {EffectiveCategory[]} categories
 * @param {Map<string, string[]>} categoryRules
 * @param {Map<string, string[]>} scenarioRules
 * @param {Map<string, string>} dispositions
 * @returns {CoverageView}
 */
function buildView(categories, categoryRules, scenarioRules, dispositions) {
  /** @type {Record<string, CoverageScenario[]>} */
  const byCategory = {};
  /** @type {Record<string, CoverageCategory[]>} */
  const byScenario = {};
  for (const scenario of scenarioRules.keys()) byScenario[scenario] = [];
  for (const category of categories) {
    const rules = categoryRules.get(category.key) ?? [];
    const known = new Set(rules);
    /** @type {CoverageScenario[]} */
    const entries = [];
    for (const [scenario, assigned] of scenarioRules) {
      const hit = [...new Set(assigned.filter((rule) => known.has(rule)))].sort();
      if (hit.length === 0) continue;
      const partial = hit.length < rules.length;
      entries.push({ scenario, rules: hit, partial });
      byScenario[scenario].push({ category: category.key, rules: hit, partial });
    }
    byCategory[category.key] = entries;
  }
  return {
    byCategory,
    byScenario,
    dispositions: Object.fromEntries(categories.map((category) => [category.key, dispositions.get(category.key) ?? NOT_ASSESSED])),
  };
}

/**
 * The compact Markdown an engineer reads: every effective category with its Coverage disposition
 * and the actual and planned scenarios covering it, then the same by scenario.
 * @param {EffectiveCategory[]} categories
 * @param {Map<string, CoverageLine>} lines
 * @param {CoverageView} actual
 * @param {CoverageView | undefined} planned
 * @returns {string}
 */
function viewsMarkdown(categories, lines, actual, planned) {
  const plannedColumn = planned === undefined ? [] : ["Planned"];
  const categoryRows = categories.map((category) => [
    category.key,
    dispositionText(lines.get(category.key)),
    coveredText(actual.byCategory[category.key]),
    ...(planned === undefined ? [] : [coveredText(planned.byCategory[category.key])]),
  ]);
  const scenarios = [...new Set([...Object.keys(actual.byScenario), ...(planned === undefined ? [] : Object.keys(planned.byScenario))])].sort();
  const scenarioRows = scenarios.map((scenario) => [
    scenario,
    categoriesText(actual.byScenario[scenario]),
    ...(planned === undefined ? [] : [categoriesText(planned.byScenario[scenario])]),
  ]);
  return [
    table(["Category", "Coverage", "Actual", ...plannedColumn], categoryRows),
    table(["Scenario", "Actual categories", ...(planned === undefined ? [] : ["Planned categories"])], scenarioRows),
  ].filter((part) => part !== null).join("\n\n");
}

/**
 * One scenario's coverage in a category table cell; `—` when none.
 * @param {CoverageScenario[]} [entries]
 * @returns {string}
 */
function coveredText(entries = []) {
  if (entries.length === 0) return "—";
  return entries.map((entry) => `${entry.scenario}${entry.partial ? " (partial)" : ""}: ${entry.rules.join(", ")}`).join("; ");
}

/**
 * One scenario's category list in the inverse table.
 * @param {CoverageCategory[]} [entries]
 * @returns {string}
 */
function categoriesText(entries = []) {
  return entries.length === 0 ? "—" : entries.map((entry) => `${entry.category}${entry.partial ? " (partial)" : ""}`).join(", ");
}

/**
 * A Coverage line as its Markdown cell.
 * @param {CoverageLine | undefined} line
 * @returns {string}
 */
function dispositionText(line) {
  if (line === undefined) return NOT_ASSESSED;
  if (line.disposition === "awaiting") return "awaiting";
  if (line.disposition === "n/a") return `n/a: ${line.reason ?? ""}`;
  const na = line.na.map((item) => `n/a for ${item.functionality}: ${item.reason}`);
  return [`covered: ${line.rules.join(", ")}`, ...na].join("; ");
}

/**
 * The Feature's Coverage lines by category Key.
 * @param {CoverageSection | null} section
 * @returns {Map<string, CoverageLine>}
 */
function byCategoryLine(section) {
  /** @type {Map<string, CoverageLine>} */
  const lines = new Map();
  for (const line of section?.lines ?? []) if (!lines.has(line.key)) lines.set(line.key, line);
  return lines;
}

/**
 * Every Test Case's `covers`, with whether a `regenerate` entry in the agreement replaces that
 * case.
 * @param {FeatureContext} ctx
 * @param {string} feature
 * @param {{ key: string, action: AgreementAction, state: ScenarioState | null }[]} entries
 * @returns {Map<string, CaseCoverage[]>}
 */
function caseCoverage(ctx, feature, entries) {
  const selected = new Map(scenarioCoverage(ctx, feature).map((scenario) => [scenario.key, scenario.file]));
  const regenerated = new Set(entries.filter((entry) => entry.action === "regenerate" && entry.state !== null).map((entry) => entry.key));
  /** @type {Map<string, CaseCoverage[]>} */
  const coverage = new Map();
  for (const [scenario, file] of selected) {
    for (const entry of file.cases) {
      const replaced = regenerated.has(scenario) && replaceable(entry, ctx.index);
      for (const rule of listOf(entry.data.covers)) {
        const list = coverage.get(rule) ?? [];
        list.push({ scenario, replaced });
        coverage.set(rule, list);
      }
    }
  }
  return coverage;
}

/**
 * The Scenario Key, file and covered Rules of every scenario file of `feature`, in Key order.
 * @param {FeatureContext} ctx
 * @param {string} feature
 * @returns {ScenarioCoverage[]}
 */
function scenarioCoverage(ctx, feature) {
  /** @type {ScenarioCoverage[]} */
  const out = [];
  for (const file of ctx.files) {
    if (file.unreadable || file.type !== "scenario" || ctx.index.featureOf(file) !== feature) continue;
    const key = typeof file.data.key === "string" || typeof file.data.key === "number" ? String(file.data.key) : null;
    if (key === null) continue;
    /** @type {Set<string>} */
    const covers = new Set();
    for (const entry of file.cases) for (const rule of listOf(entry.data.covers)) covers.add(rule);
    out.push({ key, file, covers });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The Feature a context was loaded for, or `""` when it names none.
 * @param {FeatureContext} ctx
 * @returns {string}
 */
function featureOf(ctx) {
  return typeof ctx.feature?.data.key === "string" ? ctx.feature.data.key : "";
}

/**
 * The `retained` map, checked: each Rule is live and each scenario is one the Feature holds.
 * @param {unknown} raw
 * @param {Map<string, { key: string }>} rules
 * @param {Set<string>} scenarios
 * @param {(code: string, message: string, data?: Omit<AgreementRefusal, "code" | "message">) => void} bad
 * @returns {Record<string, string[]>}
 */
function checkRetained(raw, rules, scenarios, bad) {
  if (raw === undefined) return {};
  if (!isMap(raw)) {
    bad("bad_retained", "`retained` must map a Rule Key to the scenarios that keep it");
    return {};
  }
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const [rule, value] of Object.entries(raw)) {
    if (!rules.has(rule)) bad("unknown_rule", `\`retained\` names \`${rule}\`, which is no live Rule of the Feature`, { rule, retained: true });
    if (!Array.isArray(value) || !value.every((key) => typeof key === "string")) {
      bad("bad_retained", `\`retained\` for \`${rule}\` must list scenario Keys`, { rule, retained: true });
      continue;
    }
    const keys = [...new Set(value)];
    for (const key of keys) if (!scenarios.has(key)) bad("unknown_scenario", `\`retained\` names \`${key}\`, which is no scenario of the Feature`, { scenario: key, retained: true });
    out[rule] = keys;
  }
  return out;
}

/**
 * The hand-offs, normalised: proposed Rules are `{statement, why?}` and coverage corrections are
 * one-line strings. Nothing here is counted as a Rule of the Feature.
 * @param {unknown} raw
 * @param {(code: string, message: string, data?: Omit<AgreementRefusal, "code" | "message">) => void} bad
 * @returns {Agreement["handoffs"]}
 */
function checkHandoffs(raw, bad) {
  if (raw === undefined) return { proposed_rules: [], coverage_corrections: [] };
  if (!isMap(raw)) {
    bad("bad_handoffs", "`handoffs` must be an object with `proposed_rules` and `coverage_corrections`");
    return { proposed_rules: [], coverage_corrections: [] };
  }
  /** @type {AgreementProposedRule[]} */
  const proposed = [];
  if (raw.proposed_rules !== undefined) {
    if (!Array.isArray(raw.proposed_rules)) bad("bad_handoffs", "`proposed_rules` must be a list");
    else raw.proposed_rules.forEach((item, index) => {
      if (typeof item === "string" && item.trim()) proposed.push({ statement: item.trim() });
      else if (isMap(item) && typeof item.statement === "string" && item.statement.trim()) {
        proposed.push({ statement: item.statement.trim(), ...(typeof item.why === "string" && item.why.trim() ? { why: item.why.trim() } : {}) });
      } else bad("bad_handoffs", `proposed Rule ${index + 1} is neither a statement nor \`{statement, why}\``);
    });
  }
  let corrections = [];
  if (raw.coverage_corrections !== undefined) {
    if (!Array.isArray(raw.coverage_corrections) || !raw.coverage_corrections.every((item) => typeof item === "string" && item.trim() && !LINE_BREAK.test(item))) {
      bad("bad_handoffs", "`coverage_corrections` must be a list of one-line strings");
    } else corrections = raw.coverage_corrections.map((item) => item.trim());
  }
  return { proposed_rules: proposed, coverage_corrections: corrections };
}

/**
 * One entry's list field, or an empty list with a refusal. Duplicates are dropped, order is kept.
 * @param {unknown} value
 * @param {string} field
 * @param {string} scenario
 * @param {string} code
 * @param {(code: string, message: string, data?: Omit<AgreementRefusal, "code" | "message">) => void} bad
 * @returns {string[]}
 */
function stringList(value, field, scenario, code, bad) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim() !== "")) {
    bad(code, `\`${scenario}\`'s \`${field}\` must be a list of non-empty strings`, { scenario });
    return [];
  }
  return [...new Set(value.map((item) => item.trim()))];
}

/**
 * Whether a value is one of the design actions.
 * @param {unknown} value
 * @returns {value is AgreementAction}
 */
function isAction(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (ACTIONS).includes(value);
}
