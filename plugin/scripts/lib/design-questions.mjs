// @ts-check
// Run-owned ambiguity hand-off. Parked questions remain Feature prose owned by deep-dive.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { readRunFile } from './run-dir.mjs';
import { loadFeature } from './design-unit.mjs';
import { parkedQuestions } from './parked-questions.mjs';
import { strip } from './stripped.mjs';

/** @typedef {import('./design-contract.mjs').DesignQuestion & { scenario: string, basis: Record<string, string> }} RunQuestion */
/** @typedef {{ v: 1, feature: string, references: string[], questions: RunQuestion[] }} DesignQuestions */
/** @type {string} */
const FILE = 'design-questions.json';

/** @param {string} dir @param {DesignQuestions} data @returns {void} */
export function writeDesignQuestions(dir, data) {
  writeFileSync(join(dir, FILE), `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Run JSON is trusted at this read boundary, just as the plan and written records are.
 * @param {string} dir
 * @returns {{ data: DesignQuestions | null, error?: string }}
 */
export function readDesignQuestions(dir) {
  const read = readRunFile(dir, FILE, { by: 'design report', restart: 'design report' });
  return { data: /** @type {DesignQuestions | null} */ (read.value ?? null), ...(read.error && { error: read.error }) };
}

/** @param {RunQuestion} question @returns {string} */
export function questionText(question) {
  return `${question.text} (Rules: ${question.rules.join(', ')}; held case: ${question.held_case.summary})`;
}

/**
 * A changed Rule set is a cue for design to reconsider, never proof of an answer. A still-parked
 * question always waits; design must read the new Rules before supplying an Expected result.
 * @param {DesignQuestions} data
 * @param {string} root
 * @returns {Array<RunQuestion & { status: 'ready' | 'waiting', rerun: string | null }>}
 */
export function heldCases(data, root) {
  const ctx = loadFeature(root, data.feature);
  const current = ctx.feature ? Object.fromEntries(strip(ctx.feature).rules) : {};
  const parked = ctx.feature ? parkedQuestions(ctx.feature) : [];
  return data.questions.map(q => {
    const ready = ctx.feature !== null && claims(current) !== claims(q.basis)
      && !parked.some(p => p.text.includes(q.text));
    const scenario = ctx.scenarios.find(s => s.scenario === q.scenario);
    return { ...q, status: ready ? 'ready' : 'waiting', rerun: ready ? `/qa-design ${data.feature} ${q.scenario}${scenario?.cases ? ' --expand' : ''}` : null };
  });
}

/** @param {Record<string, string>} rules @returns {string} */
function claims(rules) {
  return JSON.stringify(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b)));
}
