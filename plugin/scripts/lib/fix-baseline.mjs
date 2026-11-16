// @ts-check
// Standalone repair pins the same Run envelope, without browser dispatch or an Execution record.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError, orThrow } from './cli.mjs';
import { loadWorkingTree, buildIndex } from './qa-index.mjs';
import { projectConfig, checkFile } from './knowledge-file.mjs';
import { repositoryOf } from './git-tree.mjs';
import { headCommit } from './pr-git.mjs';
import { fixSelections } from './fix-regress.mjs';
import { newRunDir, newRunId } from './run-dir.mjs';
import { followUpActions } from './follow-ups.mjs';
import { proveSelection } from './test-proof.mjs';
import { claimProjection } from './stripped.mjs';
import { digestOf } from './pin-digest.mjs';
import { testRunnerMatchesStack } from './stacks/descriptors.mjs';
import { trainFile } from './training.mjs';
import { CODEGEN_TRAIN_KEY } from './schema.mjs';
import { automationLevel, codegenApproaches } from './codegen-approaches.mjs';
import { caseLevels } from './case-fields.mjs';
import { LEVEL_TARGET_REFUSALS, hasUnmappedSplit, levelTargetRefusalLine, resolveLevelTargets, spansMultipleTargets, unmappedLevelsData } from './level-target.mjs';
import { refusalsFor } from './refusal.mjs';
/** @import { CommandContext } from './cli.mjs' */
/** @import { ExecutePlan, ExecuteExecution } from './execute.mjs' */
/** @import { FollowUps } from './follow-ups.mjs' */
/** @import { TargetSpec } from './level-target.mjs' */
/** @import { AutomationSelection } from './test-runner.mjs' */

const FIX_REFUSALS = refusalsFor(LEVEL_TARGET_REFUSALS, (code, data) => {
  const line = levelTargetRefusalLine(code, data);
  return line !== null ? { ...data, line } : data;
});
/** @param {string[]} args @param {CommandContext} ctx @returns {{ dir: string, state: FollowUps, pinned: ExecutePlan, passes_now: string[] }} */
export function baselineFix(args, ctx) {
  const files = loadWorkingTree(ctx.root);
  const index = buildIndex(files);
  const config = projectConfig(index.project);
  const refuse = (/** @type {string} */ code) => { throw new UsageError(code, { code }); };
  if (!index.project || checkFile(index.project, config).errors.length) refuse('invalid_project');
  if (!config.test_runner || !testRunnerMatchesStack(config.test_runner.tool, config.stack)) refuse('no_test_runner');
  const repo = repositoryOf(ctx.root)?.top;
  const commit = repo && headCommit(repo);
  if (!repo || !commit) throw new UsageError('Standalone fix needs a committed repository.');
  const targets = args.filter(arg => arg.startsWith('target:'));
  if (targets.length > 1) refuse('unknown_target');
  const explicitTarget = targets[0]?.slice(7);
  if (explicitTarget !== undefined && (!explicitTarget || !config.targets?.[explicitTarget])) refuse('unknown_target');
  if (!Object.keys(config.targets ?? {}).length) refuse('unknown_target');
  const keys = args.filter(arg => !arg.startsWith('target:'));
  if (!keys.length) refuse('no_scope');
  const all = fixSelections(repo, config);
  const ids = new Set();
  for (const key of keys) {
    const decl = index.cases.get(key)?.[0];
    if (decl) for (const id of /** @type {string[]} */ (decl.entry.data.automates ?? [])) ids.add(id);
    else if (all.some(selection => selection.id === key)) ids.add(key);
    else refuse('unknown_key');
  }
  const selections = all.filter(selection => ids.has(selection.id));
  if (!selections.length) refuse('no_automations');
  for (const id of ids) if (all.filter(selection => selection.id === id).length !== 1) refuse('integrity_error');
  const approaches = codegenApproaches(trainFile(index, CODEGEN_TRAIN_KEY), config.levels);
  /** @param {string} id @returns {string[]} */
  const caseLevelsFor = (id) => [...index.cases.values()].flatMap(declarations => {
    const decl = declarations[0];
    const automates = /** @type {string[]} */ (decl.entry.data.automates ?? []);
    return automates.includes(id) ? caseLevels(decl.entry.data, decl.file.data, config.schemaVersion) : [];
  });
  /** @param {AutomationSelection} selection @returns {string[]} */
  const levelsFor = (selection) => {
    const byApproach = automationLevel(selection.file, approaches);
    return byApproach ? [byApproach] : [...new Set(caseLevelsFor(selection.id))];
  };
  const targetResolution = resolveLevelTargets({
    targets: /** @type {Record<string, string>} */ (config.targets),
    levelTargets: config.level_targets,
    levels: [...new Set(selections.flatMap(levelsFor))],
    explicitTarget,
  });
  if (hasUnmappedSplit(targetResolution, /** @type {Record<string, string>} */ (config.targets))) {
    const refusal = FIX_REFUSALS.stop('unmapped_levels', unmappedLevelsData(targetResolution, /** @type {Record<string, string>} */ (config.targets), config.level_targets));
    throw new UsageError('unmapped_levels', { code: 'unmapped_levels', refusal });
  }
  if (spansMultipleTargets(targetResolution)) {
    /** @param {AutomationSelection} selection @returns {Set<string>} */
    const targetSlugsFor = (selection) => {
      const selectionLevels = levelsFor(selection);
      if (!selectionLevels.length) return new Set([targetResolution.defaultTarget.slug]);
      return new Set(selectionLevels.flatMap((level) => {
        const mapped = targetResolution.byLevel.get(level)?.target.slug;
        return mapped ? [mapped] : [];
      }));
    };
    const commands = targetResolution.groups.map(({ target, levels }) => {
      const groupSelections = selections.filter(s => targetSlugsFor(s).has(target.slug));
      const needsExplicit = groupSelections.some(s => targetSlugsFor(s).size > 1);
      return {
        target: target.slug,
        origin: target.origin,
        levels,
        command: `/qa-codefix ${groupSelections.map(s => s.id).join(' ')}${needsExplicit ? ` target:${target.slug}` : ''}`,
      };
    });
    const refusal = FIX_REFUSALS.stop('spanning_targets', { targets: targetResolution.groups.map(g => g.target.slug), commands });
    throw new UsageError('spanning_targets', { code: 'spanning_targets', refusal });
  }
  const target = /** @type {TargetSpec} */ (targetResolution.singleTarget);
  /** @type {ExecuteExecution[]} */
  const executions = [...index.cases.entries()].flatMap(([key, declarations]) => {
    const decl = declarations[0];
    const automations = /** @type {string[]} */ (decl.entry.data.automates ?? []);
    if (!automations.some(id => ids.has(id))) return [];
    const text = claimProjection(decl.file).cases.get(key) ?? '';
    return [{ id: `ex_${key}`, key, summary: decl.entry.summary ?? key, feature: decl.feature ?? '', text, level: String(decl.entry.data.level ?? ''), mode: 'manual', digest: digestOf(['case', text]), dirty: false, review: 'none', stale: false, roles: [], access: [], sessions: [], cap: 1, automations }];
  });
  const dir = orThrow(newRunDir(undefined, 'qa-codefix-')).make();
  /** @type {ExecutePlan} */
  const pinned = { confirmed: true, run: newRunId(), target: { slug: target.slug, origin: target.origin }, created_at: new Date().toISOString(), playwright_cli: 'unused-standalone-fix', commit, tester: { tier: 'none', label: 'none' }, concurrency_cap: 1, executions, skipped: [], automation: { repo, runner: config.test_runner, selections } };
  writeFileSync(join(dir, 'execute.json'), JSON.stringify(pinned));
  followUpActions['follow-ups'].run([], { ...ctx, dir });
  // execute follow-ups is still the sole creator; baseline only fills its fix-owned state.
  const state = /** @type {FollowUps} */ (JSON.parse(readFileSync(join(dir, 'follow-ups.json'), 'utf8')));
  state.fix = { items: {}, standalone: true };
  const passes_now = [];
  for (const selection of selections) {
    const proof = proveSelection({ selection, root: /** @type {string} */ (ctx.root), runner: /** @type {import('./knowledge-file.mjs').TestRunner} */ (config.test_runner), repo, dir: join(dir, 'baseline', selection.id), origin: pinned.target.origin, env: ctx.env, retries: 0 }, 1);
    if (proof.passed && !ctx.flaky) { passes_now.push(selection.id); continue; }
    state.items.push({ id: `fix_${selection.id}`, kind: 'fix', automation: selection.id, file: selection.file, cases: executions.filter(ex => ex.automations?.includes(selection.id)).map(ex => ex.key), route: ctx.flaky ? 'flaky' : 'standalone', state: 'pending', diagnostics: proof.diagnostics });
  }
  return { dir, state, pinned, passes_now };
}
