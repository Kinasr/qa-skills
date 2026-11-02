// @ts-check
// Rebuild surviving item commits from the pinned commit; fix and codegen share this operation.
import { itemCommit } from './pr-git.mjs';
/** @import { PrState } from './pr.mjs' */
/** @import { AutomationSelection } from './test-runner.mjs' */
/** @param {PrState} state @param {string} excluded @returns {void} */
export function rebuildPrChain(state, excluded) {
  state.items = state.items.filter(item => item.id !== excluded);
  let parent = state.options.commit;
  for (const item of state.items) {
    item.commit = itemCommit(state.options.repo, parent, item.changes, item.message);
    parent = item.commit;
  }
}

/**
 * The shared rollback loop: check the caller's selection set, and while it fails, hand back the
 * caller's last completed item so it can restore that item and rebuild the surviving chain, then
 * check again. `active` lets a caller skip Automations it has already rolled back; `refresh` rereads
 * the code index so a restored file is checked as it now is.
 * @param {{
 *   selections: AutomationSelection[],
 *   active: (selections: AutomationSelection[]) => AutomationSelection[],
 *   refresh: () => AutomationSelection[],
 *   passes: (selection: AutomationSelection, cycle: number) => boolean,
 *   lastCompleted: () => string | null,
 *   rollback: (id: string) => void,
 *   rolled: string[],
 *   onChecked: (checked: number, rolled: string[]) => void,
 *   save: () => void,
 * }} input
 * @returns {{ ok: boolean, checked: number, rolled: string[] }}
 */
export function rollbackUntilPassing({ selections, active, refresh, passes, lastCompleted, rollback, rolled, onChecked, save }) {
  let cycle = 0;
  while (true) {
    const checking = active(selections);
    let ok = true;
    const current = refresh();
    for (const wanted of checking) {
      const selection = current.find(candidate => candidate.id === wanted.id || (candidate.file === wanted.file && JSON.stringify(candidate.titles) === JSON.stringify(wanted.titles))) ?? wanted;
      if (!passes(selection, cycle)) { ok = false; break; }
    }
    onChecked(checking.length, rolled);
    if (ok) return { ok: true, checked: checking.length, rolled };
    const id = lastCompleted();
    if (id === null) return { ok: false, checked: checking.length, rolled };
    rollback(id);
    rolled.push(id);
    cycle++;
    save();
  }
}
