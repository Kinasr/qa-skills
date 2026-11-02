// @ts-check
// Proof differs from execute aggregation: every instance, in every repetition, must pass once.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runSelection } from './runners/index.mjs';
import { automationResult } from './test-runner.mjs';
/** @import { RunnerOptions } from './runners/index.mjs' */
/** @param {RunnerOptions} options @param {number} repeats @returns {{ passed: boolean, diagnostics: string[] }} */
export function proveSelection(options, repeats) {
  const playwright = options.runner.tool === 'playwright';
  const diagnostics = [];
  for (let n = 0; n < (playwright ? 1 : repeats); n++) {
    const dir = join(options.dir, String(n + 1));
    mkdirSync(dir, { recursive: true });
    const { parsed, selector } = runSelection({ ...options, dir, retries: 0, fresh: true, ...(playwright && repeats > 1 ? { repeats } : {}) });
    diagnostics.push(...automationResult(options.selection, parsed, selector, false).diagnostics);
    const entries = Object.entries(parsed.instances);
    if (parsed.reason || !entries.length || entries.some(([, list]) => list.length !== 1 || list[0].result !== 'passed')) return { passed: false, diagnostics };
    if (playwright && repeats > 1) {
      const counts = new Map();
      for (const [id] of entries) {
        const base = id.replace(/:\d+$/, '');
        counts.set(base, (counts.get(base) ?? 0) + 1);
      }
      if ([...counts.values()].some(count => count !== repeats)) return { passed: false, diagnostics };
    }
  }
  return { passed: true, diagnostics };
}
