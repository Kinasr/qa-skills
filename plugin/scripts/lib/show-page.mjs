// @ts-check
// Knowledge page acquisition, the Feature/Rules tracer, and the three small section producers
// only this page calls.
import { existsSync, statSync } from 'node:fs';
import { UsageError, requireOption } from './cli.mjs';
import { PATTERN } from './keys.mjs';
import { acquireScan } from './scan.mjs';
import { migrationStatus } from './migration-status.mjs';
import { SCHEMA_VERSION } from './schema.mjs';
import { renderCardPage } from './card-page.mjs';
import { writeSnapshot } from './snapshot-writer.mjs';
import { resolveRef } from './git-tree.mjs';
import { isUncommitted } from './git.mjs';
import { labelDefinitions } from './case-labels.mjs';
import { showInventory } from './show-acquisition.mjs';
import { showState } from './show-state.mjs';
import { caseLevels } from './case-fields.mjs';
import { parseDeferred } from './deferred.mjs';
import { parkedQuestions } from './parked-questions.mjs';
import { parseProposedRules } from './proposed-rules.mjs';
import { parseCoverage, coverageDue } from './coverage.mjs';
import { CATEGORIES_TRAIN_KEY, effectiveCategoriesFromText } from './categories.mjs';
import { showLinks } from './show-links.mjs';
import { immutableShow } from './card-page-client.mjs';
import { platformRefusalFacts } from './platform.mjs';
import { refusalsWithoutLines } from './refusal.mjs';
import { buildSections } from './report-sections.mjs';
/** @import { RefusalFact } from './refusal.mjs' */
/** @import { ReportSection, SectionSpec } from './report-sections.mjs' */
/** @import {ShowErrorsSection, ShowFeature, ShowKnowledgeSection, ShowPageModel, ShowScenariosSection} from './page.d.mts' */
/** @import {ShowInventoryEntry} from './show-acquisition.mjs' */
/** @import {ScanAcquisition} from './scan.mjs' */
/** @import {PrivacyContext} from './platform-privacy.mjs' */
/** @type {readonly SectionSpec[]} */
export const SECTION_ORDER = [
  { id: 'schema', label: 'Schema compatibility' },
];
const { fact } = refusalsWithoutLines();
/**
 * @typedef {{ok: boolean, knowledge_page: {path: string} | null, migration: import('./migration-status.mjs').MigrationStatus, refusals?: RefusalFact[], sections: ReportSection[]}} ShowCommandOutput
 */
/** @import {CommandDefinition} from './cli.mjs' */

// Error presentation slot. Placement is by path, including unreadable files.
/**
 * @param {ShowInventoryEntry | null} feature null selects project/train errors
 * @param {ScanAcquisition} acquisition
 * @returns {ShowErrorsSection}
 */
function showErrors(feature, { allResults }) {
  const paths = new Set(feature?.files.map(f => f.rel) ?? []);
  return { rows: allResults.filter(r => r.kind === 'integrity_error' && (feature ? paths.has(r.file ?? '') : !r.file?.startsWith('features/'))) };
}

// Scenario/Case projection slot. Raw fields are retained without re-parsing; the canonical
// binding enumeration is projected beside them for filtering and labels.
/**
 * @param {ShowInventoryEntry} feature
 * @param {ScanAcquisition} acquisition
 * @returns {ShowScenariosSection}
 */
function showScenarios(feature, acquisition) {
  const { schemaVersion } = acquisition.config;
  return { rows: Object.fromEntries(feature.files.filter(/** @returns {file is import('./knowledge-file.mjs').ParsedFile} */ (file) => !file.unreadable && file.type === 'scenario').map(file => {
    // A Scenario whose frontmatter cannot name its key is still shown, under its path.
    const key = typeof file.data.key === 'string' ? file.data.key : file.rel;
    return [key, {
    key, title: file.h1?.text ?? key, file: file.rel, data: file.data,
    cases: Object.fromEntries(file.cases.map(entry => [entry.key, { key: entry.key, title: entry.summary, line: entry.line, levels: caseLevels(entry.data, file.data, schemaVersion), data: entry.data, sections: entry.sections }])),
  }]; })) };
}

// Coverage, prose sections and legend slot, backed by existing domain predicates.
/**
 * @param {ShowInventoryEntry} feature
 * @param {ScanAcquisition} acquisition
 * @returns {ShowKnowledgeSection}
 */
function showKnowledge(feature, acquisition) {
  const file = feature.featureFile;
  // The working-tree text the scan read, resolved exactly as /qa-next resolves it from disk.
  const categoriesFile = acquisition.files.find(f => f.rel === `train/${CATEGORIES_TRAIN_KEY}.md`);
  const effective = effectiveCategoriesFromText(categoriesFile && 'text' in categoriesFile ? categoriesFile.text ?? null : null);
  const coverage = file ? parseCoverage(file.text) : null;
  // The list and its count come from the same predicate, so they cannot disagree.
  const deferred = file ? parseDeferred(file.text) : [];
  const parked = file ? parkedQuestions(file) : [];
  return {
    deferred,
    parked,
    proposed: file ? parseProposedRules(file.text) : [],
    boundaries: file?.boundaries ?? [],
    waivers: (file?.rules ?? []).filter(r => r.waiver !== null).map(r => ({ key: r.key, reason: /** @type {string} */ (r.waiver), elaboration: r.elaboration })),
    coverage: coverage && { ...coverage, problems: coverage.problems.map(({ line, ...problem }) => ({ ...problem, ...(line == null ? {} : { line }) })) }, coverage_due: file ? coverageDue(file, effective) : null, deferred_count: deferred.length, parked_count: parked.length,
  };
}

/** @type {CommandDefinition} */
export const command = {
  options: { root: 'qa-dir' },
  usage: '[<feature-key>] [--root <qa-dir>]',
  run(args, { root, env, platformContext }) {
    requireOption('show', root, '--root', 'the .qa/ directory');
    const qaRoot = /** @type {string} */ (root);
    if (!existsSync(qaRoot) || !statSync(qaRoot).isDirectory()) throw new UsageError(`no \`.qa/\` directory at ${qaRoot}`);
    if (args.length > 1) throw new UsageError('show takes at most one <feature-key>');
    const [key] = args;
    if (key !== undefined && !PATTERN.slug.test(key)) throw new UsageError(`\`${key}\` is not a Feature key`);
    const acquisition = acquireScan(qaRoot, { feature: key });
    const { files, index, config, facts } = acquisition;
    const migration = migrationStatus(files);
    const version = config.schemaVersion;
    const schema = { code: facts.results.some(r => r.code === 'schema_newer') ? 'schema_newer' : version === null ? 'schema_invalid' : 'current', version, supported: SCHEMA_VERSION };
    if (schema.code === 'schema_newer') {
      /** @type {ShowCommandOutput} */
      const json = { ok: false, knowledge_page: null, migration, refusals: [fact('schema_newer', { version, supported: SCHEMA_VERSION, file: 'project.md' })], sections: buildSections(SECTION_ORDER, []) };
      return { exit: 1, json };
    }
    const inventory = showInventory(qaRoot, acquisition);
    if (key && !Object.hasOwn(inventory, key)) throw new UsageError(`no Feature \`${key}\` in ${qaRoot}`);
    /** @type {Record<string, ShowFeature>} */
    const features = {};
    for (const feature of Object.keys(inventory).sort().filter(feature => !key || feature === key)) {
      const entry = inventory[feature];
      const file = entry.featureFile;
      const scenarios = showScenarios(entry, acquisition);
      const knowledge = showKnowledge(entry, acquisition);
      const state = showState(entry, acquisition);
      // The link section's own cover lists are the one `casesCoveringRule` pass; the count reads them.
      const links = showLinks(entry, acquisition);
      const rules = { rows: Object.fromEntries((file?.rules ?? []).map(rule => [rule.key, { key: rule.key, statement: rule.statement, elaboration: rule.elaboration, direct_covers: links.rules[rule.key]?.covers.length ?? 0 }])) };
      features[feature] = {
        key: feature,
        scenarios, knowledge, errors: showErrors(entry, acquisition), state, links,
        // Counts are projected from the section producers; only an open Finding count is the
        // state producer's own list length, never a second predicate.
        summary: {
          rules: Object.keys(rules.rows).length,
          cases: Object.values(scenarios.rows).reduce((count, scenario) => count + Object.keys(scenario.cases).length, 0),
          uncovered: Object.values(state.rules).filter(a => a.flags.includes('uncovered')).length,
          parked: knowledge.parked_count,
          deferred: knowledge.deferred_count,
          findings: state.findings.length,
        },
        header: { title: file?.h1?.text ?? feature, intro: file?.intro ?? '', references: Array.isArray(file?.data.sources) ? file.data.sources : [], provenance: file?.data.generated ?? null },
        rules,
      };
    }
    /** @type {ShowPageModel} */
    const model = { layout: 'show', stamp: { generated_at: new Date().toISOString(), head: resolveRef(qaRoot, 'HEAD'), dirty: isUncommitted(qaRoot, '.'), root: qaRoot, refresh: `/qa-show${key ? ` ${key}` : ''}` }, migration, schema, features, labels: { ...labelDefinitions(index.project?.data ?? {}), levels: [...config.levels] }, errors: showErrors(null, acquisition), scope: key ?? null };
    const privacy = /** @type {PrivacyContext | undefined} */ (platformContext);
    const snapshotContext = privacy ? (privacy.env || !env ? privacy : { ...privacy, env }) : (env ? { env } : undefined);
    const page = writeSnapshot({ root: qaRoot, page: 'show', key, html: renderCardPage(immutableShow(model)), context: snapshotContext });
    if ('error' in page) {
      const pageRefusal = page.refusal;
      /** @type {ShowCommandOutput} */
      const json = {
        ok: false,
        knowledge_page: null,
        migration,
        refusals: [fact(
          pageRefusal?.code ?? 'snapshot_write',
          pageRefusal ? platformRefusalFacts(pageRefusal) : (page.facts ?? {}),
        )],
        sections: buildSections(SECTION_ORDER, []),
      };
      return { exit: 1, json };
    }
    /** @type {ShowCommandOutput} */
    const json = {
      ok: true,
      knowledge_page: page,
      migration,
      sections: buildSections(SECTION_ORDER, [
        { id: 'schema', items: schema.code === 'current' ? [] : [schema] },
      ]),
    };
    return { exit: 0, json };
  },
};
