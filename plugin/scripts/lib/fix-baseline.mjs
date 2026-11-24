// @ts-check
// Standalone repair pins the same Run envelope, without browser dispatch or an Execution record.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { orThrow } from './cli.mjs';
import { loadWorkingTree, buildIndex, buildScopeState, resolveScopeToken } from './qa-index.mjs';
import { projectConfig, checkFile } from './knowledge-file.mjs';
import { repositoryOf } from './git-tree.mjs';
import { headCommit } from './pr-git.mjs';
import { fixSelections } from './fix-regress.mjs';
import { newRunDir, newRunId, writeJsonAtomic } from './run-dir.mjs';
import { followUpActions } from './follow-ups.mjs';
import { proveSelection } from './test-proof.mjs';
import { claimProjection } from './stripped.mjs';
import { digestOf } from './pin-digest.mjs';
import { testRunnerMatchesStack } from './stacks/descriptors.mjs';
import { trainFile } from './training.mjs';
import { ANY_SCHEMA_VERSION, CODEGEN_TRAIN_KEY } from './schema.mjs';
import { refuseUnreadSchema } from './schema-guard.mjs';
import { automationLevel, codegenApproaches } from './codegen-approaches.mjs';
import { caseLevels } from './case-fields.mjs';
import { hasUnmappedSplit, resolveLevelTargets, spansMultipleTargets, unmappedLevelsData } from './level-target.mjs';
import { refusalsWithoutLines } from './refusal.mjs';
/** @import { CommandContext, CommandResult } from './cli.mjs' */
/** @import { ExecutePlan, ExecuteExecution } from './execute-plan.mjs' */
/** @import { FollowUps } from './follow-ups.mjs' */
/** @import { TargetSpec } from './level-target.mjs' */
/** @import { AutomationSelection } from './test-runner.mjs' */

const FIX_REFUSALS = refusalsWithoutLines();
/** @param {string[]} args @param {CommandContext} ctx @returns {{ ok: true, dir: string, state: FollowUps, pinned: ExecutePlan, passes_now: string[] } | { ok: false, refusal: CommandResult }} */
export function baselineFix(args, ctx) {
  const files = loadWorkingTree(ctx.root);
  const index = buildIndex(files);
  const config = projectConfig(index.project);
  /** @param {string} code @param {Record<string, unknown>} [detail] @returns {{ ok: false, refusal: CommandResult }} */
  const stop = (code, detail = {}) => ({ ok: false, refusal: FIX_REFUSALS.stop(code, detail) });
  if (!index.project) return stop('invalid_project');
  const root = /** @type {string} */ (ctx.root);
  const unread = refuseUnreadSchema(root, ANY_SCHEMA_VERSION);
  if (unread) return { ok: false, refusal: unread };
  if (checkFile(index.project, config).errors.length) return stop('invalid_project');
  if (!config.test_runner || !testRunnerMatchesStack(config.test_runner.tool, config.stack)) return stop('no_test_runner');
  const repo = repositoryOf(ctx.root)?.top;
  const commit = repo && headCommit(repo);
  if (!repo) return stop('not_a_repository');
  if (!commit) return stop('no_commits');
  const targets = args.filter(arg => arg.startsWith('target:'));
  if (targets.length > 1) return stop('unknown_target');
  const explicitTarget = targets[0]?.slice(7);
  if (explicitTarget !== undefined && (!explicitTarget || !config.targets?.[explicitTarget])) return stop('unknown_target');
  if (!Object.keys(config.targets ?? {}).length) return stop('unknown_target');
  const keys = args.filter(arg => !arg.startsWith('target:'));
  if (!keys.length) return stop('no_scope');
  const all = fixSelections(repo, config);
  const scopeState = buildScopeState(index);
  /** @type {Set<string>} */
  const ids = new Set();
  for (const key of keys) {
    const res = resolveScopeToken(key, index, scopeState);
    if (res.ok) {
      // fix-baseline resolves only pinned automations and intentionally discards `res.alias`.
      for (const decl of res.cases) {
        for (const id of /** @type {string[]} */ (decl.entry.data.automates ?? [])) ids.add(id);
      }
      continue;
    }
    if (res.code === 'unknown_key' && all.some(selection => selection.id === key)) {
      ids.add(key);
      continue;
    }
    return stop(res.code, { key: res.key, ...(res.feature !== undefined && { feature: res.feature }) });
  }
  const selections = all.filter(selection => ids.has(selection.id));
  if (!selections.length) return stop('no_automations');
  for (const id of ids) if (all.filter(selection => selection.id === id).length !== 1) return stop('integrity_error');
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
    return stop('unmapped_levels', unmappedLevelsData(targetResolution, /** @type {Record<string, string>} */ (config.targets), config.level_targets));
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
    return stop('spanning_targets', { targets: targetResolution.groups.map(g => g.target.slug), commands });
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
  writeJsonAtomic(join(dir, 'execute.json'), pinned);
  followUpActions['follow-ups'].run([], { ...ctx, dir });
  // execute follow-ups is still the sole creator; baseline only fills its fix-owned state.
  const state = /** @type {FollowUps} */ (JSON.parse(readFileSync(join(dir, 'follow-ups.json'), 'utf8')));
  state.fix = { items: {}, standalone: true };
  const passes_now = [];
  for (const selection of selections) {
    const proof = proveSelection({ selection, root, runner: /** @type {import('./knowledge-file.mjs').TestRunner} */ (config.test_runner), repo, dir: join(dir, 'baseline', selection.id), origin: pinned.target.origin, env: ctx.env, retries: 0 }, 1);
    if (proof.passed && !ctx.flaky) { passes_now.push(selection.id); continue; }
    state.items.push({ id: `fix_${selection.id}`, kind: 'fix', automation: selection.id, file: selection.file, cases: executions.filter(ex => ex.automations?.includes(selection.id)).map(ex => ex.key), route: ctx.flaky ? 'flaky' : 'standalone', state: 'pending', diagnostics: proof.diagnostics });
  }
  return { ok: true, dir, state, pinned, passes_now };
}
