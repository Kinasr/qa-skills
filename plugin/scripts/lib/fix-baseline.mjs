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
/** @import { CommandContext } from './cli.mjs' */
/** @import { ExecutePlan, ExecuteExecution } from './execute.mjs' */
/** @import { FollowUps } from './follow-ups.mjs' */
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
  const slug = targets[0]?.slice(7) ?? Object.keys(config.targets ?? {})[0];
  if (targets.length > 1 || !slug || !config.targets?.[slug]) refuse('unknown_target');
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
  const pinned = { confirmed: true, run: newRunId(), target: { slug, origin: /** @type {Record<string, string>} */ (config.targets)[slug] }, created_at: new Date().toISOString(), playwright_cli: 'unused-standalone-fix', commit, tester: { tier: 'none', label: 'none' }, concurrency_cap: 1, executions, skipped: [], automation: { repo, runner: config.test_runner, selections } };
  writeFileSync(join(dir, 'execute.json'), JSON.stringify(pinned));
  followUpActions['follow-ups'].run([], { ...ctx, dir });
  // execute follow-ups is still the sole creator; baseline only fills its fix-owned state.
  const state = /** @type {FollowUps} */ (JSON.parse(readFileSync(join(dir, 'follow-ups.json'), 'utf8')));
  state.fix = { items: {}, standalone: true };
  const passes_now = [];
  for (const selection of selections) {
    const proof = proveSelection({ selection, runner: /** @type {import('./knowledge-file.mjs').TestRunner} */ (config.test_runner), repo, dir: join(dir, 'baseline', selection.id), origin: pinned.target.origin, env: ctx.env, retries: 0 }, 1);
    if (proof.passed && !ctx.flaky) { passes_now.push(selection.id); continue; }
    state.items.push({ id: `fix_${selection.id}`, kind: 'fix', automation: selection.id, file: selection.file, cases: executions.filter(ex => ex.automations?.includes(selection.id)).map(ex => ex.key), route: ctx.flaky ? 'flaky' : 'standalone', state: 'pending', diagnostics: proof.diagnostics });
  }
  return { dir, state, pinned, passes_now };
}
