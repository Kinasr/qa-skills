// @ts-check
// Checkpoint 2 and the Rule fix of the settle engine (settle-walk.mjs), split out of it. `design
// checkpoint` advances the Watermark once every case of the walk is settled and committed; `design
// rule-fix` reopens the causes resting on a Rule the walk showed to be wrong (ADR-0043). Both read the
// walk's run dir through the core's `load` and `current`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { terms } from "./labels.mjs";
import { writeAll } from "./changeset.mjs";
import { isMap } from "./dialect.mjs";
import { isStrictAncestor, loadQaAt, repositoryOf, resolveRef } from "./git-tree.mjs";
import { written } from "./impact-persist.mjs";
import { backfillChangeset } from "./pin-digest.mjs";
import { refuse } from "./impact-json.mjs";
import { parseForecast, reconcile, snapshotOf } from "./rule-edit.mjs";
import { editedSincePersist, reopenable, ruleFixRefuse } from "./rule-fix.mjs";
import { checkFile, edit, parse } from "./knowledge-file.mjs";
import { buildIndex, loadWorkingTree, rootConfig } from "./qa-index.mjs";
import { STATE, closing, current, findingsOf, load, textWith, view } from "./settle-walk.mjs";
import { unknown } from "./settle-page.mjs";
/** @import { WalkCase, WalkFile, WalkFindingData, WalkLaid, WalkState } from "./settle-walk.mjs" */
/** @import { CommandResult } from "./cli.mjs" */
/** @import { Terms } from "./impact-json.mjs" */
/** @import { ImpactPlan } from "./impact.mjs" */

// `design checkpoint --dir`: checkpoint 2 (ADR-0043). Once every case of the walk is settled and the
// case fixes and any new cases are committed, the Watermark of each Feature the persisted run judged
// advances to HEAD, the commit holding the fixed text the Reviews pin too, and a Stale the engineer
// closed with `holds` is pruned since the Watermark has reached it. A Stale still open keeps its own
// baseline and target. A walk stopped before this writes no Watermark, and settling can resume.
/**
 * @param {string} dir
 * @param {ImpactPlan} plan
 * @returns {CommandResult}
 */
export function checkpoint(dir, plan) {
  const loaded = load(dir, plan);
  if (loaded.refused) return loaded.refused;
  const { laid, state } = loaded;
  const root = plan.root;
  const now = current(root);
  const remaining = laid.cases.filter((e) => !state.settled[e.key] && !view(now, e, null, root).gone);
  if (remaining.length) return refuse("walk_unfinished", { remaining: remaining.length });
  const persistCheck = now.scan.history.persist;
  if (!persistCheck.clean) return refuse("persist_refused", { reason: persistCheck.reason ?? "dirty", changed: persistCheck.changed }, 1);
  const repo = repositoryOf(root);
  const head = repo && resolveRef(repo.top, "HEAD");
  if (!repo || !head) return refuse("no_head");
  // The Watermark pins HEAD, the commit holding the fixed text; a run judged at an explicit
  // `--target` certifies nothing past it.
  const to = plan.target.ref !== null ? /** @type {string} */ (plan.target.commit) : head;
  const unchecked = uncheckedRuleEdits(plan, laid, state, repo, now.files);
  if (unchecked.length) return ruleFixRefuse("rules_edited_since_persist", { rules: unchecked }, 1);

  /** @type {Map<string, string>} */
  const edits = new Map();
  /** @type {Array<{ feature: string, from: string | null, to: string }>} */
  const advanced = [];
  let pruned = 0;
  for (const c of laid.checkpoint ?? []) {
    const decl = now.index.features.get(c.feature)?.[0];
    if (!decl) continue;
    if (decl.file.data.watermark !== to) {
      edits.set(decl.file.rel, textWith(decl.file.rel, readFileSync(join(root, decl.file.rel), "utf8"), [{ set: { watermark: to, watermark_digest: undefined } }]));
      advanced.push({ feature: c.feature, from: c.from, to });
    }
    // The Stale the engineer closed with `holds` is done once the Watermark has reached it.
    for (const file of now.files) {
      if (file.unreadable || file.type !== "scenario" || now.index.featureOf(file) !== c.feature) continue;
      let text = edits.get(file.rel) ?? readFileSync(join(root, file.rel), "utf8");
      for (const entry of file.cases) {
        const list = findingsOf(entry);
        const reached = (/** @type {WalkFindingData} */ x) => isMap(x) && x.kind === "Stale" && isMap(x.holds) && stampReached(repo.top, written(x.at_commit), to);
        if (!list.some(reached)) continue;
        pruned += list.filter(reached).length;
        text = textWith(file.rel, text, [{ at: entry.key, set: { finding: list.filter((x) => !reached(x)) } }]);
      }
      if (text !== readFileSync(join(root, file.rel), "utf8")) edits.set(file.rel, text);
    }
  }
  /** @type {Array<{ file: string, line: number | undefined, message: string }>} */
  const errors = [];
  const config = rootConfig(root);
  for (const [rel, t] of edits) {
    const checked = /** @type {{ errors: Array<{ line?: number, message: string }> }} */ (checkFile(parse(rel, t), config));
    errors.push(...checked.errors.map((x) => ({ file: `${repo.prefix}${rel}`, line: x.line, message: x.message })));
  }
  if (errors.length) return refuse("check_file", { errors });
  if (edits.size) {
    const written = /** @type {{ error?: string }} */ (writeAll(root, backfillChangeset(root, root, { writes: [...edits].map(([path, text]) => ({ path, text })) })));
    if (written.error) throw new Error(`design checkpoint: ${written.error}`);
  }
  state.written = [...new Set([...state.written, ...[...edits.keys()].map((rel) => `${repo.prefix}${rel}`)])].sort();
  state.merge = [...new Set([...state.merge, ...(advanced.length ? ["watermark"] : []), ...(pruned ? ["findings"] : [])])];
  state.checkpoint = { commit: to, at: new Date().toISOString() };
  writeFileSync(join(dir, STATE), `${JSON.stringify(state, null, 2)}\n`);
  /** @type {Terms} */
  const t = terms();
  const end = closing(plan, laid, state);
  for (const r of end.merge_rules) t.add(r.rule === "watermark" ? "Watermark" : r.rule === "findings" ? "Finding" : "Review");
  t.add("Watermark");
  return { exit: 0, json: { ok: true, checkpoint: { commit: to, watermarks: advanced, pruned }, ...end, glossary: t.pieces() } };
}

// The Rules reaching a Feature this run holds a Watermark for that were edited and committed after
// `persist` judged it, and that no Rule fix on this walk rechecked (a Rule fix records the text it
// reopened the causes for). Checkpoint 2 certifies HEAD, so an edit it did not see would be certified
// unchecked. A run judged at an explicit `--target` certifies nothing past it.
/**
 * @param {ImpactPlan} plan
 * @param {WalkLaid} laid
 * @param {WalkState} state
 * @param {{ top: string }} repo
 * @param {readonly WalkFile[]} files the working tree, which checkpoint 2 has found equal to HEAD
 * @returns {string[]}
 */
function uncheckedRuleEdits(plan, laid, state, repo, files) {
  if (plan.target.ref !== null || !plan.target.commit) return [];
  const commit = plan.target.commit;
  const thenFiles = loadQaAt(/** @type {Parameters<typeof loadQaAt>[0]} */ (repo), commit);
  if (!thenFiles) return [];
  const then = snapshotOf(/** @type {Parameters<typeof snapshotOf>[0]} */ (thenFiles));
  const now = snapshotOf(/** @type {Parameters<typeof snapshotOf>[0]} */ (files));
  const refs = new Set((laid.checkpoint ?? []).flatMap((c) => editedSincePersist(then, now, c.feature, commit)));
  return [...refs].filter((ref) => {
    const at = ref.indexOf("/");
    return state.rule_fixes?.[ref] !== (now.rules(ref.slice(0, at)).get(ref.slice(at + 1)) ?? "");
  });
}

// `design rule-fix <feature> --dir --stdin` (ADR-0043): a Rule the walk shows to be wrong is fixed
// through deep-dive's Rule-edit transition. The engineer has edited the Rule in the working tree and
// confirmed the forecast; `reconcile` answers the Boundary check and the downstream walk, and every
// closed mechanical Stale cause resting on a fixed Rule is opened again (its `holds` or Dismissal
// removed) and put back on the walk. Unrelated settlements stay closed. The text of each fixed Rule
// is recorded, so checkpoint 2 can tell this edit from one nobody rechecked. Every file passes
// `check-file` before any is written; a refusal writes nothing.
/**
 * @param {string} dir
 * @param {ImpactPlan} plan
 * @param {string[]} args
 * @param {string} stdin the forecast, as `deep-dive reconcile` reads it
 * @returns {CommandResult}
 */
export function ruleFix(dir, plan, args, stdin) {
  if (args.length !== 1) return ruleFixRefuse("rule_fix_arguments");
  const feature = args[0];
  const loaded = load(dir, plan);
  if (loaded.refused) return loaded.refused;
  const { state } = loaded;
  const root = plan.root;
  const forecast = parseForecast(stdin);
  const files = /** @type {WalkFile[]} */ (loadWorkingTree(root));
  const index = buildIndex(files);
  const ctx = { root, files: /** @type {import("./knowledge-file.mjs").ParsedFile[]} */ (files), index };
  if (!index.features.get(feature)?.[0]) return ruleFixRefuse("no_feature", { feature }, 1);

  // Read first, record the widened Rules only once the edit is known: a refusal writes nothing.
  const probe = reconcile(ctx, feature, { ...forecast, widened: [] }, undefined);
  const found = /** @type {{ ok: boolean, errors?: Array<{ code: string, message: string }>, edited: Array<{ rule: string }>, added: string[], retired: Array<{ key: string }> }} */ (/** @type {unknown} */ (probe.json));
  if (!found.ok) return { exit: 1, json: { ok: false, refusals: (found.errors ?? []).map(({ code, message, ...rest }) => ({ code, line: message, ...rest })) } };
  if (!found.edited.length && !found.added.length && !found.retired.length) return ruleFixRefuse("no_rule_edit", { feature }, 1);
  const done = forecast.widened.length ? reconcile(ctx, feature, forecast, dir) : probe;
  const out = /** @type {Record<string, unknown> & { ok: boolean }} */ (done.json);
  if (!out.ok) return done;

  const fixed = new Set([...found.edited.map((e) => e.rule), ...found.retired.map((r) => r.key)].map((rule) => `${feature}/${rule}`));
  const reopen = reopenable(/** @type {import("./knowledge-file.mjs").ParsedFile[]} */ (files), (f) => index.featureOf(f), fixed);
  const repo = repositoryOf(root);
  const prefix = repo?.prefix ?? "";

  /** @type {Map<string, string>} */
  const edits = new Map();
  for (const rel of new Set(reopen.map((r) => r.file))) {
    let text = readFileSync(join(root, rel), "utf8");
    const file = files.find((f) => !f.unreadable && f.rel === rel);
    if (!file || file.unreadable) continue;
    for (const entry of file.cases) {
      const mine = reopen.filter((r) => r.file === rel && r.case === entry.key);
      if (!mine.length) continue;
      const list = findingsOf(entry).map((x, i) => {
        if (!mine.some((r) => r.index === i)) return x;
        const { holds: _, dismissed: __, ...rest } = x;
        return rest;
      });
      text = textWith(rel, text, [{ at: entry.key, set: { finding: list } }]);
    }
    edits.set(rel, text);
  }
  /** @type {Array<{ file: string, line: number | undefined, message: string }>} */
  const errors = [];
  const config = rootConfig(root);
  for (const [rel, t] of edits) {
    const checked = /** @type {{ errors: Array<{ line?: number, message: string }> }} */ (checkFile(parse(rel, t), config));
    errors.push(...checked.errors.map((x) => ({ file: `${prefix}${rel}`, line: x.line, message: x.message })));
  }
  if (errors.length) return refuse("check_file", { errors });
  if (edits.size) {
    const written = /** @type {{ error?: string }} */ (writeAll(root, backfillChangeset(root, root, { writes: [...edits].map(([path, text]) => ({ path, text })) })));
    if (written.error) throw new Error(`rule-fix: ${written.error}`);
  }

  // The Run's own record: the cases are unsettled again, the text of each fixed Rule is what
  // checkpoint 2 will find committed, and the Rule's own file is part of what the Run changed.
  const texts = snapshotOf(/** @type {Parameters<typeof snapshotOf>[0]} */ (/** @type {unknown} */ (files))).rules(feature);
  const reopened = [...new Set(reopen.map((r) => r.case))];
  for (const key of reopened) delete state.settled[key];
  state.reopened = [...(state.reopened ?? []).filter((c) => !reopened.includes(c.key)), ...reopened.flatMap((key) => {
    const decl = index.cases.get(key)?.[0];
    return decl ? [/** @type {WalkCase} */ ({ feature: decl.feature, scenario: decl.scenario, file: decl.file.rel, key, why: ["rule_fixed"] })] : [];
  })];
  state.rule_fixes = { ...state.rule_fixes, ...Object.fromEntries([...fixed].map((ref) => [ref, texts.get(ref.slice(feature.length + 1)) ?? ""])) };
  const featureFile = index.features.get(feature)?.[0]?.file.rel;
  state.written = [...new Set([...state.written, ...[...edits.keys()].map((rel) => `${prefix}${rel}`), ...(featureFile ? [`${prefix}${featureFile}`] : [])])].sort();
  if (reopen.length) state.merge = [...new Set([...state.merge, "findings"])];
  writeFileSync(join(dir, STATE), `${JSON.stringify(state, null, 2)}\n`);

  const { action: _a, next_step: _n, ...facts } = out;
  /** @type {Terms} */
  const t = terms();
  t.add("Finding");
  return { exit: 0, json: { ...facts, action: "rule-fix", reopened: reopen.map(({ case: key, feature: f, was, rules }) => ({ case: key, feature: f, was, rules })), resume: { action: "walk", dir }, glossary: t.pieces() } };
}

// Whether the commit a stamp pins is HEAD or an ancestor of it: the Watermark at HEAD has reached it.
/**
 * @param {string} top
 * @param {string | null} commit
 * @param {string} head
 * @returns {boolean}
 */
function stampReached(top, commit, head) {
  const full = commit && resolveRef(top, commit);
  return Boolean(full) && (full === head || isStrictAncestor(top, /** @type {string} */ (full), head));
}
