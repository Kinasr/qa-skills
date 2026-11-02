// @ts-check
// One `/qa-design` Feature as its design units see it: its Rules, its scenario
// files and which of them a fill targets, and the brief of one design unit, with every input inlined
// (ADR-0010). It reads `project.md`, the train file, the Feature file and its sibling scenario
// files, and nothing outside `.qa/`: `/qa-design` never performs external intake. The train file's
// Conventions go into every unit's brief whole: no routing, so they are one cacheable
// prefix. Its Practices never do (ADR-0015): they are the orchestrator's.
//
// Modes: `fill` fills an empty scenario file; `expand` adds cases to a populated one, keeping
// every case it has; `regenerate` replaces a populated file's unreviewed, unlinked cases and
// keeps the rest (reviewed, or holding a tracker key). The unit's `mode`, the cases it keeps and the
// keys it replaces are in its brief JSON, and the reply contract and the writer both read them.
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { agreementBlock } from "./design-agreement-brief.mjs";
import { designBrief } from "./design-prompt.mjs";
import { SKIPPED } from "./design-json.mjs";
import { checkFile, projectConfig } from "./knowledge-file.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { DESIGN_TRAIN_KEY } from "./schema.mjs";
import { strip } from "./stripped.mjs";
import { conventionsText } from "./training.mjs";
import { dependencyIndex, formatRuleRef, resolveRuleRef } from "./rule-ref.mjs";
/** @import { LabelDefinitions } from "./case-labels.mjs" */
/** @import { CaseEntry, ParsedFile as QaFile } from "./knowledge-file.mjs" */
/** @import { CaseDecl, KeyDecl, KeyIndex, ScenarioDecl } from "./qa-index.mjs" */
/** @import { AgreementBriefPosition } from "./design-agreement-brief.mjs" */
/** @import { Agreement } from "./design-agreement.mjs" */


/**
 * The mode of a design run: a bare run is a `fill`.
 * @typedef {"fill" | "expand" | "regenerate"} DesignMode
 */

/**
 * One frontmatter key's declaration line: the line the index cites for a Key.
 * @typedef {number} KeyLine
 */

/**
 * One `### rule_<key>: <statement>` entry of a Feature file.
 * @typedef {object} RuleEntry
 * @property {string} key
 * @property {string} statement
 * @property {number} line
 * @property {number} [end]
 */

/**
 * `project.md`'s configuration (lib/knowledge-file.mjs `projectConfig`), as design reads it: the
 * project's Roles, Levels, Tags and Custom fields.
 * @typedef {object} QaConfig
 * @property {Set<string>} roles
 * @property {Set<string>} levels
 * @property {LabelDefinitions} labels
 */

/**
 * One of `edit`'s refusals (lib/knowledge-file.mjs `edit`).
 * @typedef {object} EditError
 * @property {"unreadable" | "no_entry" | "ambiguous" | "no_block" | "render"} code
 * @property {string} [at] - the Key the refusal is about
 * @property {string} [field]
 * @property {number} [line]
 * @property {string} message
 */
/**
 * lib/knowledge-file.mjs `edit`'s outcome: on success the new text and its parse, on a refusal
 * the input's text and file, each refusal in `errors`, and their messages joined in `message`
 * (`unreadable: true` when the file's own parse refused first).
 * @typedef {{ ok: true, text: string, file: QaFile, errors: EditError[] } | { ok: false, unreadable?: boolean, text: string, file: QaFile, errors: EditError[], message: string }} EditResult
 */

/**
 * A `check-file` result (lib/check-file.mjs), as the writers read it.
 * @typedef {object} CheckFileResult
 * @property {string | null} type
 * @property {boolean} ok
 * @property {{ code: string, message: string, line?: number }[]} errors
 * @property {{ code: string, message: string, line?: number }[]} warnings
 */

/**
 * A file's entries, text stripped for Bookkeeping (lib/stripped.mjs `strip`): the canonical text of
 * each Test Case and Rule, by Key.
 * @typedef {object} Stripped
 * @property {string} text
 * @property {Map<string, string>} cases
 * @property {Map<string, string>} rules
 */

/**
 * A scenario file's state in a Feature: a `fill` targets an `empty` file, an expand or a
 * regenerate a `populated` one, and an `excluded` file is addressed by no run at all.
 * @typedef {{
 *   scenario: string | null,
 *   file: string,
 *   summary: string | null,
 *   levels: string[],
 *   cases: number,
 *   replaceable: number,
 *   status: "empty" | "populated",
 *   reason?: undefined,
 *   problems?: undefined,
 * } | {
 *   scenario: string | null,
 *   file: string,
 *   summary: string | null,
 *   levels: string[],
 *   cases: number,
 *   replaceable: number,
 *   status: "excluded",
 *   reason: "fails_check" | "unaddressable",
 *   problems: string[],
 * }} ScenarioState
 */

/**
 * A Feature's `slug` names in `.qa/` (lib/design-unit.mjs `loadFeature`): the Feature file with
 * its Rules, the project's Roles and Levels, and the state of every scenario file it owns.
 * @typedef {object} FeatureContext
 * @property {string} root - the Feature's `.qa/` directory, resolved
 * @property {QaFile[]} files
 * @property {KeyIndex} index
 * @property {string[]} roles
 * @property {string[]} levels
 * @property {LabelDefinitions} labels
 * @property {QaFile | null} feature
 * @property {{ key: string, statement: string, waiver: string | null }[]} rules
 * @property {import("./rule-ref.mjs").DependencyIndex} dependencies
 * @property {ScenarioState[]} scenarios
 */

/**
 * A case an expand's or a regenerate's brief keeps: its Key with the summary its heading carries.
 * @typedef {{ key: string, summary: string }} KeptCase
 */

/**
 * The brief of one design unit: the contract `design` serialises to the Run dir's
 * `<key>.brief.json`, `check-reply design` reads it with `--brief`, and `design-write` fills with
 * it. `kept` and `replace` name the cases the mode keeps and replaces; `wanted_levels` records the agreed
 * levels, and every case names its own.
 * @typedef {object} DesignBrief
 * @property {true} ok
 * @property {"design"} unit
 * @property {DesignMode} mode
 * @property {string} feature - the Feature's key
 * @property {string} scenario - the unit's scenario key
 * @property {string} file - the scenario file, relative to `.qa/`
 * @property {string} path - the scenario file, absolute
 * @property {string} root - the `.qa/` directory, resolved
 * @property {string} digest - the SHA-256 of the file text the brief was built from
 * @property {string[]} wanted_levels
 * @property {string[]} rules
 * @property {string[]} waived_rules
 * @property {string[]} relies_targets - the qualified Upstream Rules a Reliance may name
 * @property {string[]} roles
 * @property {string[]} levels
 * @property {LabelDefinitions} labels - the project's Tags and Custom fields
 * @property {number} cases_total
 * @property {KeptCase[]} kept
 * @property {string[]} replace
 * @property {Record<string, string>} [overrides] - the engineer's reasons that a repeat of a stored
 *   case is a distinct pass, by that case's Key (`design override`); absent when none was stated
 * @property {number} brief_bytes
 * @property {string} brief
 */

/** @type {readonly DesignMode[]} */
export const MODES = ["fill", "expand", "regenerate"];

/**
 * The mode the command-line flags name.
 * @param {{ expand?: boolean, regenerate?: boolean }} [flags={}]
 * @returns {{ mode: DesignMode, error?: never } | { error: string, mode?: never }}
 */
export function designMode({ expand, regenerate } = {}) {
  if (expand && regenerate) return { error: "a design run takes --expand or --regenerate, not both" };
  return { mode: expand ? "expand" : regenerate ? "regenerate" : "fill" };
}

/**
 * Whether `--regenerate` may replace a case: only while it has no Review and no effective Tracker
 * key (lib/tracker-resolver.mjs). A reviewed case
 * carries a person's trust, and a linked one a claim about the tracker (ADR-0006), so neither is
 * ever touched.
 * @param {CaseEntry} c
 * @param {KeyIndex} index
 * @returns {boolean}
 */
export const replaceable = (c, index) => !Object.hasOwn(c.data, "review") && index.tracker.current("case", c.key) === null;

/**
 * The SHA-256 of a text, in hex: what keeps a write to the bytes its brief was built from.
 * @param {string} text
 * @returns {string}
 */
export const digest = (text) => createHash("sha256").update(text).digest("hex");

/**
 * A Feature `slug` names in the `.qa/` tree at `root`: `{feature}` with its file, its Rules and
 * every scenario file it owns, or `{feature: null}` when no Feature file declares it.
 * @param {string} root
 * @param {string} slug
 * @param {{ files: QaFile[], index: KeyIndex } | null} [snapshot]
 * @returns {FeatureContext}
 */
export function loadFeature(root, slug, snapshot = null) {
  /** @type {QaFile[]} */
  const files = snapshot?.files ?? /** @type {QaFile[]} */ (loadWorkingTree(root));
  // The index is trusted past `buildIndex` (lib/qa-index.mjs is unchecked): cast through `unknown`,
  // since the inferred shape does not name the features it mutates afterwards.
  /** @type {KeyIndex} */
  const index = snapshot?.index ?? buildIndex(files);
  const dependencies = dependencyIndex(index, files);
  const cfg = /** @type {QaConfig} */ (projectConfig(index.project));
  const featureFile = index.features.get(slug)?.[0]?.file ?? null;
  const scenarios = files
    .filter((f) => !f.unreadable && f.type === "scenario" && index.featureOf(f) === slug)
    .map((f) => scenarioState(root, index, f));
  return {
    root: resolve(root),
    files,
    index,
    roles: [...cfg.roles],
    levels: [...cfg.levels],
    labels: cfg.labels,
    feature: featureFile,
    rules: featureFile ? featureFile.rules.map((r) => ({ key: r.key, statement: r.statement, waiver: r.waiver })) : [],
    dependencies,
    scenarios,
  };
}

/**
 * One scenario file: `empty` (a fill's target), `populated`, or `excluded` with why, since a file
 * that fails `check-file` cannot be written to and one whose key is not its own cannot be addressed.
 * A numeric `key` is the file's key as the index stores it (lib/qa-index.mjs, `String(key)`).
 * @param {string} root
 * @param {KeyIndex} index
 * @param {QaFile} f
 * @returns {ScenarioState}
 */
function scenarioState(root, index, f) {
  const key = typeof f.data.key === "string" || typeof f.data.key === "number" ? String(f.data.key) : null;
  const out = {
    scenario: key,
    file: f.rel,
    summary: f.h1?.key === key ? /** @type {{ line: number, key: string, text: string }} */ (f.h1).text : null,
    levels: [...new Set(f.cases.map((c) => c.data.level).filter((level) => typeof level === "string"))],
    cases: f.cases.length,
    replaceable: f.cases.filter((c) => replaceable(c, index)).length,
  };
  const checked = /** @type {CheckFileResult} */ (checkFile(f, projectConfig(index.project)));
  if (!checked.ok) return { ...out, status: "excluded", reason: "fails_check", problems: checked.errors.map((e) => (e.line ? `line ${e.line}: ${e.message}` : e.message)) };
  if (key === null || index.scenarios.get(key)?.[0]?.file !== f) {
    return { ...out, status: "excluded", reason: "unaddressable", problems: [`\`${key}\` is declared by more than one scenario file`] };
  }
  return { ...out, status: f.cases.length === 0 ? "empty" : "populated" };
}

/**
 * The brief of one design unit, and what `check-reply design` and the writer need from it. Returns
 * `{json}`, or `{error}` for a usage error.
 *   kept         the cases the file keeps, `{key, summary}`: none on a fill, all on an expand, the
 *                reviewed and tracker-keyed ones on a regenerate
 *   replace      the keys a regenerate replaces; empty otherwise
 *   cases_total  the cases the file held when the brief was built
 * @param {string} key
 * @param {{ root: string, mode?: DesignMode, context?: FeatureContext | null, agreement?: Agreement | null, agreementBrief?: AgreementBriefPosition }} options
 * @returns {{ json: DesignBrief } | { error: string }}
 */
export function designUnit(key, { root, mode = "fill", context = null, agreement = null, agreementBrief = "off" }) {
  if (!MODES.includes(mode)) return { error: `design units take a mode: ${MODES.join(", ")}` };
  /** @type {QaFile[]} */
  const files = context?.files ?? /** @type {QaFile[]} */ (loadWorkingTree(root));
  /** @type {KeyIndex} */
  const index = context?.index ?? buildIndex(files);
  const decl = index.scenarios.get(key)?.[0];
  if (!decl) return { error: `no scenario \`${key}\` in ${root}` };
  if (decl.feature === null) return { error: `scenario \`${key}\` belongs to no Feature` };
  const feature = decl.feature;
  const ctx = context ?? loadFeature(root, feature, { files, index });
  return designUnitInFeature(key, root, mode, feature, decl, ctx, agreement, agreementBrief);
}

/**
 * Builds one design unit from a Feature context already loaded for this command.
 * @param {string} key
 * @param {string} root
 * @param {DesignMode} mode
 * @param {string} feature
 * @param {ScenarioDecl} decl
 * @param {FeatureContext} ctx
 * @param {Agreement | null} agreement
 * @param {AgreementBriefPosition} agreementBrief
 * @returns {{ json: DesignBrief } | { error: string }}
 */
function designUnitInFeature(key, root, mode, feature, decl, ctx, agreement, agreementBrief) {
  if (!ctx.feature) return { error: `scenario \`${key}\`'s Feature \`${feature}\` has no Feature file` };
  if (ctx.rules.length === 0) return { error: `Feature \`${feature}\` has no Rules: run \`/qa-deep-dive ${feature}\` first` };
  if (agreement !== null && agreement.feature !== feature) {
    return { error: `the agreement is for \`${agreement.feature}\`, not the scenario's Feature \`${feature}\`` };
  }
  /** @type {ScenarioState} */
  const state = /** @type {ScenarioState} */ (ctx.scenarios.find((s) => s.scenario === key && s.file === decl.file.rel));
  if (state.status === "excluded") return { error: `scenario \`${key}\` cannot be designed: ${state.problems.join("; ")}` };
  const refusal = modeRefusal(mode, state);
  if (refusal) return { error: `scenario \`${key}\` ${SKIPPED[refusal]({ mode })}` };

  const cases = decl.file.cases;
  const kept = mode === "regenerate" ? cases.filter((c) => !replaceable(c, ctx.index)) : cases;
  const entries = /** @type {Stripped} */ (strip(decl.file)).cases;
  const upstreamRules = ctx.rules.flatMap((rule) => {
    const upstream = ctx.dependencies.upstreamOf(feature, rule.key).map((ref) => {
      const resolved = resolveRuleRef(ctx.index, ctx.files, ref);
      if (resolved.status !== "live") return null;
      const source = resolved.entry;
      const lines = resolved.file.text.replace(/\r\n/g, "\n").split("\n");
      return {
        ref: formatRuleRef(ref),
        statement: source.statement,
        elaboration: lines.slice(source.fieldsEnd ?? source.line, source.end).join("\n").trim(),
      };
    }).filter((item) => item !== null);
    return upstream.length ? [{ rule: rule.key, upstream }] : [];
  });
  const reliesTargets = [...new Set(upstreamRules.flatMap(({ upstream }) => upstream.map((item) => item.ref)))];
  // lib/design-prompt.mjs is unchecked and infers its arguments' shape; cast the brief's inputs to
  // that inferred shape rather than transcribe it here.
  const agreementText = agreement === null ? null : agreementBlock(ctx, agreement, key, agreementBrief);
  const text = designBrief(/** @type {Parameters<typeof designBrief>[0]} */ ({
    slug: decl.feature,
    feature: featureBody(ctx.feature),
    roles: ctx.roles,
    levels: ctx.levels,
    labels: ctx.labels,
    conventions: conventionsText(ctx.index, DESIGN_TRAIN_KEY),
    upstreamRules,
    scenarios: ctx.scenarios.filter((s) => s.scenario !== null).map((s) => ({ key: s.scenario, summary: s.summary ?? "" })),
    scenario: { key, summary: state.summary ?? "", levels: agreement?.scenarios[key]?.levels ?? ctx.levels, mode, kept: kept.map((c) => /** @type {string} */ (entries.get(c.key))) },
    agreement: agreementText,
  }));
  /** @type {DesignBrief} */
  return {
    json: {
      ok: true,
      unit: "design",
      mode,
      feature,
      scenario: key,
      file: decl.file.rel,
      path: join(ctx.root, decl.file.rel),
      root: ctx.root,
      digest: digest(decl.file.text),
      wanted_levels: agreement?.scenarios[key]?.levels ?? ctx.levels,
      rules: ctx.rules.map((r) => r.key),
      waived_rules: ctx.rules.filter((r) => r.waiver).map((r) => r.key),
      relies_targets: reliesTargets,
      roles: ctx.roles,
      levels: ctx.levels,
      labels: ctx.labels,
      cases_total: cases.length,
      kept: kept.map((c) => ({ key: c.key, summary: c.summary })),
      replace: mode === "regenerate" ? cases.filter((c) => replaceable(c, ctx.index)).map((c) => c.key) : [],
      brief_bytes: Buffer.byteLength(text),
      brief: text,
    },
  };
}

/**
 * Why a scenario file in `state` is no unit of `mode`, as a code, or null when it is one:
 *   populated          a fill targets empty files only
 *   not_populated      an expand or a regenerate needs a file that has Test Cases
 *   nothing_replaceable   a regenerate needs an unreviewed case with no effective Tracker key
 * @param {DesignMode} mode
 * @param {{ status: "empty" | "populated" | "excluded", replaceable: number }} state
 * @returns {"populated" | "not_populated" | "nothing_replaceable" | null}
 */
export function modeRefusal(mode, state) {
  if (mode === "fill") return state.status === "empty" ? null : "populated";
  if (state.status !== "populated") return "not_populated";
  if (mode === "regenerate" && state.replaceable === 0) return "nothing_replaceable";
  return null;
}

/**
 * The Feature file (parsed) as a design unit reads it: the body without its frontmatter, which is
 * provenance and Bookkeeping, and without `## Open questions`, which is never a basis for a case.
 * @param {QaFile} file
 * @returns {string}
 */
function featureBody(file) {
  const lines = file.text.replace(/\r\n/g, "\n").split("\n");
  const start = file.frontmatter?.end ?? 0;
  const cut = file.sections.filter((s) => s.level === 2 && s.title === "Open questions");
  const kept = lines.filter((_, i) => i >= start && !cut.some((s) => i + 1 >= s.line && i + 1 <= s.end));
  return `${kept.join("\n").trim()}\n`;
}
