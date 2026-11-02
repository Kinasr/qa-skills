// @ts-check
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { buildCodeIndex, keyPatterns } from './code-index.mjs';
import { resolveAdapter } from './stack.mjs';
import { proveSelection } from './test-proof.mjs';
import { diffTrees, writeTreeFile } from './pr-git.mjs';
import { rebuildPrChain, rollbackUntilPassing } from './regress-chain.mjs';
/** @import { ProjectConfig } from './knowledge-file.mjs' */
/** @import { AutomationSelection } from './test-runner.mjs' */
/** @import { FollowUps, FixItem } from './follow-ups.mjs' */
/** @import { ExecutePlan } from './execute.mjs' */

/** @param {string} repo @param {ProjectConfig} config @returns {AutomationSelection[]} */
export function fixSelections(repo, config) {
  const adapter = resolveAdapter(config.stack, repo).adapter;
  if (!adapter) return [];
  return buildCodeIndex(repo, config.modulePaths, config.annotationMap, adapter, keyPatterns(config)).functions.map(fn => {
    const titles = [...fn.classes.map(cls => cls.name), fn.name];
    return { id: fn.automationKeys[0]?.key ?? `${fn.file}:${fn.line}`, stack: config.stack?.root ?? '.', file: fn.file, line: fn.line, titles, package: fn.package,
      literal: !fn.parameterised && titles.every(title => title.length > 0 && title.trim() === title && !/[›\r\n]|\$\{/.test(title)), tagged: fn.automationKeys.length > 0 && (config.annotationMap?.automation_key ?? []).includes('tag') };
  });
}

/**
 * Recheck after each reverse-order rollback. Each rollback removes only that item's delta and
 * rebuilds the surviving commits before another test process or branch preparation can see them.
 * @param {{ state: FollowUps, pinned: ExecutePlan, repo: string, dir: string, selections: AutomationSelection[], refresh: () => AutomationSelection[], env: Record<string, string | undefined>, save: () => void }} input
 * @returns {{ ok: boolean, checked: number, rolled_back: string[], text: string }}
 */
export function regressFix({ state, pinned, repo, dir, selections, refresh, env, save }) {
  const rolled = [...(state.regress?.rolled_back ?? [])];
  mkdirSync(join(dir, 'regress'), { recursive: true });
  const batch = mkdtempSync(join(dir, 'regress', 'check-'));
  const itemOf = (/** @type {string} */ id) => /** @type {FixItem | undefined} */ (state.items.find(item => item.id === id && item.kind === 'fix'));
  // A rolled-back item's Automation reverts to the state it was failing in, so rechecking it can
  // only roll back more. Skip it from now on (a resumed regress derives the same skips from the
  // item states), unless a surviving done item still claims that Automation.
  const active = (/** @type {AutomationSelection[]} */ wanted) => {
    if (!state.fix?.done?.length) return [];
    const surviving = new Set(state.fix.done.flatMap(id => { const item = itemOf(id); return item ? [item.automation] : []; }));
    return wanted.filter(selection => surviving.has(selection.id) ||
      !state.items.some(item => item.kind === 'fix' && item.state === 'failed' && item.reason === 'regressed' && item.automation === selection.id));
  };
  /** @param {AutomationSelection} selection @param {number} cycle */
  const passes = (selection, cycle) => {
    if (!pinned.automation?.runner) return false;
    const output = join(batch, String(cycle), selection.id.replace(/[^\w-]/g, '_'));
    mkdirSync(output, { recursive: true });
    return proveSelection({ selection, runner: pinned.automation.runner, repo, dir: output, origin: state.target.origin, env, retries: 0 }, 1).passed;
  };
  /** @param {string} id */
  const rollback = id => {
    const work = state.fix?.items[id];
    const item = itemOf(id);
    if (!item) return;
    if (work?.verified) for (const path of Object.keys(diffTrees(work.before, work.verified))) writeTreeFile(repo, path, work.before[path] ?? null);
    if (state.pr?.mode.kind !== 'working-tree' && state.pr) rebuildPrChain(state.pr, id);
    item.state = 'failed'; item.reason = 'regressed'; item.next = `Review ${item.file} and run /qa-execute again.`;
    if (work) { work.passed = false; delete work.verified; }
  };
  const result = rollbackUntilPassing({
    selections, active, refresh, passes,
    lastCompleted: () => state.fix?.done?.pop() ?? null,
    rollback, rolled,
    onChecked: (checked, list) => { state.regress = { checked, rolled_back: list }; },
    save,
  });
  return {
    ok: result.ok, checked: result.checked, rolled_back: result.rolled,
    text: `Fix regress: ${result.checked} checked, ${result.rolled.length} rolled back.`,
  };
}
