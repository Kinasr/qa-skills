// @ts-check
// Knowledge page acquisition and the Feature/Rules tracer. Section producers own later slices.
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
import { showScenarios } from './show-scenarios.mjs';
import { showKnowledge } from './show-knowledge.mjs';
import { showErrors } from './show-errors.mjs';
import { showLinks } from './show-links.mjs';
import { immutableShow } from './card-page-client.mjs';
/** @import {ShowFeature, ShowPageModel} from './page.d.mts' */
/**
 * @typedef {{ok: boolean, knowledge_page: {path: string} | null, migration: import('./migration-status.mjs').MigrationStatus, schema: ShowPageModel['schema'], refusal: {code: string, message: string} | null}} ShowCommandOutput
 */
/** @import {CommandDefinition} from './cli.mjs' */

/** @type {CommandDefinition} */
export const command = {
  options: { root: 'value' },
  usage: '[<feature-key>] --root <qa-dir>',
  run(args, { root }) {
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
      const json = { ok: false, knowledge_page: null, migration, schema, refusal: { code: 'schema_newer', message: 'Update qa-skills to read this schema.' } };
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
    const page = writeSnapshot({ root: qaRoot, page: 'show', key, html: renderCardPage(immutableShow(model)) });
    /** @type {ShowCommandOutput} */
    const json = { ok: !('error' in page), knowledge_page: 'path' in page ? page : null, migration, schema, refusal: 'error' in page ? { code: 'snapshot_write', message: page.error } : null };
    return { exit: 'error' in page ? 1 : 0, json };
  },
};
