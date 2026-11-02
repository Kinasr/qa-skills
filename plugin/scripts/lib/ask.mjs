// @ts-check
// The Rule catalogue is read from knowledge files, independently of Scan's public index.
/** @import { CommandContext, CommandDefinition, CommandResult } from "./cli.mjs" */
/** @import { CheckProblem } from "./check-file.mjs" */
/** @import { SummariesLookup } from "./labels.mjs" */
/** @import { MigrationStatus } from "./migration-status.mjs" */
/** @import { ParsedEntry, ParsedFile, ParsedRule, ProjectConfig, UnreadableFile } from "./knowledge-file.mjs" */
/** @import { KeyDecl, KeyIndex } from "./qa-index.mjs" */
/** @import { ParkedQuestion } from "./parked-questions.mjs" */
/** @import { RuleCoverageIndex } from "./rule-coverage.mjs" */
/** @import { DependencyEnd, DependencyIndex } from "./rule-ref.mjs" */
/** @import { FeatureClass, HistorySection } from "./scan-history.mjs" */
/** @import { ScanOutput } from "./scan.mjs" */
/** @import { HistoryDismissalsSource, StoredFinding } from "./stored-findings.mjs" */
import { basename, posix, resolve } from "node:path";
import { UsageError } from "./cli.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { checkFile, projectConfig } from "./knowledge-file.mjs";
import { keyLabel, summaries } from "./labels.mjs";
import { command as migrationStatus } from "./migration-status.mjs";
import { SCHEMA_VERSION } from "./schema.mjs";
import { casesCoveringRule } from "./rule-coverage.mjs";
import { dependencyEnds, dependencyIndex } from "./rule-ref.mjs";
import { command as scan } from "./scan.mjs";
import { takesEscalation } from "./selection.mjs";
import { storedCaseFindings } from "./stored-findings.mjs";
import { parkedQuestions } from "./parked-questions.mjs";
import { hasPublishTracker } from "./publish.mjs";

/**
 * A `.qa/` file the catalogue reads: the parsed file, or the one that could not be read, which
 * declares no type.
 * @typedef {ParsedFile | (UnreadableFile & { type?: null })} CatalogueFile
 */

/**
 * A problem the catalogue reports on a file: the check's own problem, or the catalogue's own
 * (`unreadable`, `frontmatter`).
 * @typedef {{
 *   code: string,
 *   field?: string,
 *   line?: number | null,
 *   message: string,
 * }} CatalogueProblem
 */

/**
 * A problem the catalogue reports globally: where it sits, the problems behind it, and what it
 * says.
 * @typedef {{
 *   code: string,
 *   file: string,
 *   line?: number | null,
 *   problems: CatalogueProblem[],
 *   message: string,
 *   [key: string]: unknown,
 * }} CatalogueError
 */

/**
 * The schema state the catalogue reports when the project declares the schema version this CLI
 * reads.
 * @typedef {{
 *   code: "current",
 *   version: number,
 *   supported: number,
 * }} CurrentSchema
 */

/**
 * The schema state the catalogue reports when the project declares a newer schema version: where
 * it says so, and what to do about it.
 * @typedef {{
 *   code: "schema_newer",
 *   version: number,
 *   supported: number,
 *   file: string,
 *   line: number,
 *   message: string,
 * }} NewerSchema
 */

/**
 * @typedef {CurrentSchema | NewerSchema} CatalogueSchema
 */

/**
 * A file's or a case's frontmatter values, as the catalogue reads the provenance from.
 * @typedef {{
 *   generated?: { by?: string, at?: string },
 *   sources?: string[],
 *   [key: string]: unknown,
 * }} CatalogueData
 */

/**
 * The provenance a file or a case declares: who generated it and when, and the sources it rests
 * on.
 * @typedef {{
 *   generated: { by?: string, at?: string } | null,
 *   sources: string[],
 * }} Provenance
 */

/**
 * A case the catalogue cites: the file it sits in, its entry, its Feature and its Scenario, and
 * the line it is declared on. The index declares a case's entry with the case, so the entry is
 * there.
 * @typedef {{
 *   file: ParsedFile,
 *   entry: ParsedEntry,
 *   feature?: string | null,
 *   scenario?: string | null,
 *   line: number,
 * }} CatalogueCase
 */

/**
 * A case the catalogue cites: its key, its label, where it sits, its Scenario and its trust.
 * @typedef {{
 *   key: string,
 *   label: string,
 *   summary?: string,
 *   file: string,
 *   line: number,
 *   scenario: { key: string | null | undefined, label: string },
 *   trust: CaseTrust,
 * }} CatalogueCaseEntry
 */

/**
 * A Review's freshness, as the scan's facts report it.
 * @typedef {"fresh" | "void"} ReviewFreshness
 */

/**
 * What the catalogue knows about one case: its provenance, the Review's freshness, the Review's
 * due date and the findings stored on it.
 * @typedef {{
 *   generated: { by?: string, at?: string } | null,
 *   sources: string[],
 *   review: ReviewFreshness | null,
 *   review_by: { date: string, overdue: boolean } | null,
 *   findings: StoredFinding[],
 * }} CaseTrust
 */

/**
 * A Feature the catalogue lists: its key, its label and its summary.
 * @typedef {{ key: string, label: string, summary: string | null }} CatalogueFeatureRef
 */

/**
 * The routes a Feature offers, one per situation the catalogue names.
 * @typedef {{
 *   parked_question: string[],
 *   gap: string[],
 *   possible_conflict: string[],
 *   unsettled_rules: string[],
 *   open_conflict: string[],
 * }} CatalogueRoutes
 */

/**
 * A Feature the catalogue lists: its key, its label, where it sits, its provenance, the cases
 * nearby it, its Parked questions, its state and its routes.
 * @typedef {{
 *   key: string,
 *   label: string,
 *   summary: string | null,
 *   file: string,
 *   line: number,
 *   trust: Provenance,
 *   nearby: CatalogueCaseEntry[],
 *   parked_questions: (ParkedQuestion & { file: string })[],
 *   state: { watermark: FeatureClass | null, clean: boolean, publish_tracker: boolean },
 *   routes: CatalogueRoutes,
 * }} CatalogueFeature
 */

/**
 * One Rule the catalogue lists: its key, its statement, where it sits, the Feature it belongs to,
 * its provenance and both Dependency directions beside the cases that cover it.
 * @typedef {{
 *   key: string,
 *   label: string,
 *   statement: string,
 *   file: string,
 *   line: number,
 *   feature: CatalogueFeatureRef,
 *   trust: Provenance,
 *   waiver: string | null,
 *   covered_by: CatalogueCaseEntry[],
 *   depends_on: DependencyEnd[],
 *   dependents: DependencyEnd[],
 * }} CatalogueRule
 */

/**
 * The catalogue's global state: the key migration preflight, the schema state, the problems that
 * stop the catalogue, and the route for a subject with no Feature.
 * @typedef {{
 *   migration: MigrationStatus,
 *   schema: CatalogueSchema,
 *   errors: CatalogueError[],
 *   routes: { no_feature: string[] },
 * }} CatalogueGlobal
 */

/**
 * The catalogue the command prints: the global state, the Features it lists and the Rules it
 * lists.
 * @typedef {{
 *   root: string,
 *   hint: string | null,
 *   global: CatalogueGlobal,
 *   features: CatalogueFeature[],
 *   rules: CatalogueRule[],
 * }} CatalogueOutput
 */

/**
 * The scan's facts, as the catalogue reads them: the scan's own output with the history section
 * it publishes.
 * @typedef {ScanOutput & { history: HistorySection }} CatalogueFacts
 */

/**
 * The context the catalogue's projections read: the Key index, the files it was built from, the
 * labels, the scan's facts, the citations it prints, and the state each Feature is in.
 * @typedef {{
 *   index: KeyIndex,
 *   files: readonly (ParsedFile | UnreadableFile)[],
 *   location: (file: { rel: string }) => string,
 *   watermarks: Map<string, FeatureClass>,
 *   clean: boolean,
 *   names: SummariesLookup,
 *   facts: CatalogueFacts,
 *   reviews: Map<string, ReviewFreshness>,
 *   overdue: Set<string>,
 *   publishTracker: boolean,
 *   dependencies: DependencyIndex,
 * }} CatalogueContext
 */

// Validate the fields the catalogue reads; absent provenance has its explicit null/[] shape.
/** @type {Set<string>} */
const CATALOGUE_FIELDS = new Set(["type", "key", "suite_key", "rule", "retired", "retired_features", "schema_version",
  "feature", "case", "covers", "generated", "sources", "review", "review_by", "finding"]);
/**
 * @param {CheckProblem} problem
 * @returns {boolean}
 */
const isAbsentProvenance = (problem) => problem.code === "required" && ["generated", "sources"].includes(/** @type {string} */ (problem.field));
/**
 * @param {CatalogueData} data
 * @param {CatalogueData} [fallback]
 * @returns {Provenance}
 */
const provenance = (data, fallback = {}) => ({
  generated: data.generated ?? fallback.generated ?? null,
  sources: data.sources ?? fallback.sources ?? [],
});
/**
 * @param {string} [key]
 * @param {string} [prerequisite]
 * @returns {string}
 */
const deepDiveRoute = (key = "[<new-key>]", prerequisite = "get a Reference") =>
  `${prerequisite}, then /qa-deep-dive ${key} <ref>...`;
/**
 * @param {CatalogueCase} c
 * @param {Set<unknown>} retired
 * @returns {boolean}
 */
const isLiveCase = (c, retired) => !retired.has(c.entry.key) && !retired.has(c.scenario);
/**
 * @param {CatalogueCase} a
 * @param {CatalogueCase} b
 * @returns {number}
 */
const byCaseKey = (a, b) => a.entry.key.localeCompare(b.entry.key);

/**
 * @param {CatalogueFile} file
 * @param {ProjectConfig} config
 * @param {string} root
 * @returns {CatalogueProblem[]}
 */
function fileProblems(file, config, root) {
  if (file.unreadable) return [{ code: "unreadable", line: 1,
    message: /** @type {string} */ (file.unreadable).replaceAll(resolve(root), basename(root)) }];
  if (/** @type {ParsedFile} */ (file).problems.length) return /** @type {ParsedFile} */ (file).problems;
  if (!(/** @type {ParsedFile} */ (file)).frontmatter) return [{ code: "frontmatter", line: 1, message: "The file has no frontmatter." }];
  return checkFile(/** @type {ParsedFile} */ (file), config).errors.filter((p) =>
    p.field?.split(".").some((field) => CATALOGUE_FIELDS.has(field)) && !isAbsentProvenance(p));
}

/**
 * @param {CatalogueFile[]} files
 * @param {string} root
 * @param {(file: { rel: string }) => string} location
 * @returns {{ readable: CatalogueFile[], errors: CatalogueError[] }}
 */
function catalogueErrors(files, root, location) {
  const config = projectConfig(files.find((file) => file.type === "project"));
  /** @type {CatalogueError[]} */
  const errors = [];
  const readable = files.filter((file) => {
    const problems = fileProblems(file, config, root);
    if (!problems.length) return true;
    errors.push({ code: "unreadable", file: location(file), line: problems[0].line,
      problems, message: problems.map((p) => p.message).join("; ") });
    return false;
  });
  return { readable, errors };
}

/**
 * @param {KeyIndex} index
 * @param {CatalogueError[]} errors
 * @param {string} root
 * @param {(file: { rel: string }) => string} location
 * @returns {CatalogueGlobal}
 */
function catalogueState(index, errors, root, location) {
  if (!index.project) errors.push({ code: "missing_project", file: location({ rel: "project.md" }), line: 1,
    problems: [], message: "No project.md declares a Project; the knowledge catalogue is incomplete." });
  const version = projectConfig(index.project).schemaVersion;
  /** @type {CatalogueSchema} */
  const schema = version > SCHEMA_VERSION ? {
    code: "schema_newer", version, supported: SCHEMA_VERSION,
    file: location(/** @type {ParsedFile} */ (index.project)), line: /** @type {ParsedFile} */ (index.project).keyLines.schema_version,
    message: `project.md declares schema_version: ${version}, newer than the ${SCHEMA_VERSION} this CLI reads; update qa-skills before using this catalogue.`,
  } : { code: "current", version, supported: SCHEMA_VERSION };
  if (schema.code === "schema_newer") errors.push({ ...schema, problems: [] });
  const migration = /** @type {MigrationStatus} */ (/** @type {CommandResult} */ (/** @type {NonNullable<CommandDefinition["run"]>} */ (migrationStatus.run)([], /** @type {CommandContext} */ ({ root }))).json);
  for (const declaration of migration.declarations) errors.push({
    code: "migration_pending", file: location({ rel: declaration.file }), line: declaration.line,
    problems: [], message: "Key migration is pending; run migrate-keys on the default branch.",
  });
  return { migration, schema, errors, routes: { no_feature: [deepDiveRoute()] } };
}

/**
 * @param {CatalogueCase} c
 * @param {CatalogueContext} context
 * @returns {CatalogueCaseEntry}
 */
function caseEntry({ file, entry, scenario, line }, { location, names, facts, reviews, overdue }) {
  return {
    key: entry.key, label: keyLabel(entry.key, entry.summary), summary: entry.summary,
    file: location(file), line,
    scenario: { key: scenario, label: keyLabel(/** @type {string | undefined} */ (scenario), names.scenario(/** @type {string | undefined} */ (scenario))) },
    trust: { ...provenance(/** @type {CatalogueData} */ (entry.data), /** @type {CatalogueData} */ (file.data)),
      review: reviews.get(entry.key) ?? null,
      review_by: entry.data.review_by ? { date: /** @type {string} */ (entry.data.review_by), overdue: overdue.has(entry.key) } : null,
      findings: storedCaseFindings(/** @type {HistoryDismissalsSource} */ (facts.history), file, entry).map((f) => ({ ...f, file: location({ rel: f.file }) })) },
  };
}

/**
 * @param {string} key
 * @param {FeatureClass | null} watermark
 * @param {boolean} clean
 * @param {boolean} publishTracker
 * @returns {CatalogueRoutes}
 */
function featureRoutes(key, watermark, clean, publishTracker) {
  const commit = clean ? [] : ["commit the knowledge"];
  // A recorded finding is settled by a bare `/qa-design` (ADR-0043).
  const settleRoute = [...commit, `/qa-design ${key}`];
  // A possible Conflict was not judged: `impact escalate` records the case in the run dir's Run
  // data, and the plan over the same dir judges it, whether or not anything in the Feature changed.
  const escalateRoute = [...commit, "impact escalate --dir <run-dir> --case <case-key>", `impact plan ${key} --persist --dir <run-dir>`];
  return {
    parked_question: [deepDiveRoute(key, "get the answer"), ...(publishTracker ? [`/qa-publish ${key}`] : [])],
    gap: [deepDiveRoute(key)],
    possible_conflict: takesEscalation(watermark) ? escalateRoute : [`edit the case, or ${deepDiveRoute(key)}`],
    unsettled_rules: [deepDiveRoute(key)],
    open_conflict: settleRoute,
  };
}

/**
 * @param {CatalogueFeatureRef} feature
 * @param {ParsedFile} file
 * @param {Provenance} trust
 * @param {ParsedRule[]} liveRules
 * @param {Set<unknown>} retired
 * @param {CatalogueContext} context
 * @returns {CatalogueFeature}
 */
function featureEntry(feature, file, trust, liveRules, retired, context) {
  const { index, location, watermarks, clean, publishTracker } = context;
  const watermark = watermarks.get(feature.key) ?? null;
  const ruleKeys = new Set(liveRules.map((r) => r.key));
  const nearby = /** @type {CatalogueCase[]} */ ([...index.cases.values()].map((d) => d[0]))
    .filter((c) => c.feature === feature.key && isLiveCase(c, retired))
    .filter((c) => !(/** @type {string[]} */ (c.entry.data.covers ?? [])).some((rule) => ruleKeys.has(rule)))
    .sort(byCaseKey).map((c) => caseEntry(c, context));
  return { ...feature, file: location(file), line: file.h1?.line ?? 1, trust, nearby,
    parked_questions: parkedQuestions(file).map((q) => ({ ...q, file: location(file) })),
    state: { watermark, clean, publish_tracker: publishTracker },
    routes: featureRoutes(feature.key, watermark, clean, publishTracker),
  };
}

/**
 * @param {ParsedRule} rule
 * @param {CatalogueFeatureRef} feature
 * @param {ParsedFile} file
 * @param {Provenance} trust
 * @param {Set<unknown>} retired
 * @param {CatalogueContext} context
 * @returns {CatalogueRule}
 */
function ruleEntry(rule, feature, file, trust, retired, context) {
  return { key: rule.key, label: keyLabel(rule.key, rule.statement), statement: rule.statement,
    file: context.location(file), line: rule.line, feature, trust,
    waiver: rule.waiver,
    covered_by: /** @type {CatalogueCase[]} */ (casesCoveringRule(/** @type {RuleCoverageIndex} */ (context.index), feature.key, rule.key))
      .filter((c) => isLiveCase(c, retired)).sort(byCaseKey).map((c) => caseEntry(c, context)),
    depends_on: dependencyEnds(context.index, context.files, context.dependencies.upstreamOf(feature.key, rule.key)),
    dependents: dependencyEnds(context.index, context.files, context.dependencies.dependentsOf(feature.key, rule.key)) };
}

/** @type {CommandDefinition} */
export const command = {
  options: { feature: "value", root: "qa-dir?" },
  usage: "[--feature <key>] [--root <qa-dir>]",
  /**
   * @param {string[]} args
   * @param {CommandContext} ctx
   * @returns {CommandResult}
   */
  run(args, { root, feature: hint = null }) {
    if (args.length) throw new UsageError("ask takes no positional argument; use --feature <key> for a starting hint");
    /**
     * @param {{rel: string}} file
     * @returns {string}
     */
    const location = (file) => posix.join(basename(/** @type {string} */ (root)), file.rel);
    const { readable, errors } = catalogueErrors(loadWorkingTree(root), /** @type {string} */ (root), location);
    const index = buildIndex(readable);
    const names = summaries(index);
    const facts = /** @type {CatalogueFacts} */ (/** @type {CommandResult} */ (/** @type {NonNullable<CommandDefinition["run"]>} */ (scan.run)([], /** @type {CommandContext} */ ({ root }))).json);
    const context = { index, files: readable, names, facts, location,
      watermarks: new Map(facts.history.features.map((f) => /** @type {[string, FeatureClass]} */ ([f.feature, f.class]))),
      clean: facts.history.persist.clean,
      reviews: new Map(facts.history.reviews.map((r) => /** @type {[string, ReviewFreshness]} */ ([r.key, r.status]))),
      overdue: new Set(facts.results.filter((r) => r.kind === "review_overdue").map((r) => /** @type {string} */ (r.key))),
      publishTracker: hasPublishTracker(index.project),
      dependencies: dependencyIndex(index, readable),
    };
    const global = catalogueState(index, errors, /** @type {string} */ (root), location);
    /** @type {CatalogueFeature[]} */
    const features = [];
    /** @type {CatalogueRule[]} */
    const rules = [];
    const retiredFeatures = new Set(/** @type {string[]} */ (index.project?.data.retired_features ?? []));
    /**
     * @param {string} a
     * @param {string} b
     * @returns {number}
     */
    const byFeature = (a, b) => Number(b === hint) - Number(a === hint) || a.localeCompare(b);
    for (const key of [...index.features.keys()].sort(byFeature)) {
      const file = /** @type {KeyDecl} */ (/** @type {KeyDecl[]} */ (index.features.get(key))[0]).file;
      if (retiredFeatures.has(key) || retiredFeatures.has(/** @type {string} */ (file.data.suite_key))) continue;
      const feature = { key, label: keyLabel(key, names.feature(key)), summary: names.feature(key) ?? null };
      const trust = provenance(/** @type {CatalogueData} */ (file.data));
      const retired = new Set(/** @type {unknown[]} */ (file.data.retired ?? []));
      const liveRules = [...file.rules].filter((rule) => !retired.has(rule.key)).sort((a, b) => a.key.localeCompare(b.key));
      features.push(featureEntry(feature, file, trust, liveRules, retired, context));
      rules.push(...liveRules.map((rule) => ruleEntry(rule, feature, file, trust, retired, context)));
    }
    return { exit: 0, json: /** @type {CatalogueOutput} */ ({ root, hint, global, features, rules }) };
  },
};
