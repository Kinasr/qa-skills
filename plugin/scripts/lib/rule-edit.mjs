// @ts-check
// The Rule-edit transition of `/qa-deep-dive` on an existing Feature (ADR-0043): after the Rules are
// edited and before the commit checkpoint, `reconcile` compares the Feature file in the working tree
// with the one HEAD committed and answers four questions from the Rule edits themselves:
//   - which Rules were edited outside the Impact forecast band the engineer confirmed (the forecast
//     is conversation-time, so it arrives on stdin; only the answer for an edited statement is kept);
//   - which Boundaries each edited or added Rule has to be compared with (the comparison is the
//     agent's to quote; the CLI pairs them so none is skipped);
//   - which Rules downstream of the edits rest on them, over every Dependency path, with the Feature
//     to run next (the Affected Rules walk of `affected-rules.mjs`);
//   - which Rules the engineer confirmed as widened, and the forecast the engineer confirmed for each
//     Rule whose statement was edited since the Watermark (committed or not), recorded as Run data in
//     the run dir's `change.json`, which `impact plan --dir` reads (`change-data.mjs`) and whose
//     settlement refuses a statement edit with none (`forecast-guard.mjs`).
// It writes nothing but that one file, and only once every check that can refuse the call has passed.
/** @import { ParsedFile, ParsedRule } from "./knowledge-file.mjs" */
/** @import { AffectedSnapshot } from "./affected-rules.mjs" */
/** @import { RuleEdit } from "./rule-diff.mjs" */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { affectedRules, statementEdits, statementOf as statementIn } from "./affected-rules.mjs";
import { CHANGE_FILE, FORECAST_SHAPE } from "./change-data.mjs";
import { UsageError } from "./cli.mjs";
import { loadQaAt, repositoryOf, resolveRef } from "./git-tree.mjs";
import { buildIndex } from "./qa-index.mjs";
import { ruleEdit, rulesChangedAcross, ruleTexts } from "./rule-diff.mjs";
import { dependencyEnds, dependencyIndex } from "./rule-ref.mjs";
import { newRunDir, readRunFile } from "./run-dir.mjs";
import { scan } from "./scan.mjs";
import { strip } from "./stripped.mjs";

const BANDS = /** @type {const} */ (["changes", "may_change", "unaffected"]);

/**
 * The confirmed forecast as the skill pipes it: local Rule keys per band, plus the Rules the
 * engineer confirmed as widened and who confirmed them.
 * @typedef {{
 *   changes: string[],
 *   may_change: string[],
 *   unaffected: string[],
 *   widened: string[],
 *   by: string | null,
 * }} Forecast
 */

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {string[]}
 */
function keyList(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((k) => typeof k === "string")) throw new UsageError(`deep-dive reconcile: \`${name}\` is a list of Rule keys`);
  return [...new Set(/** @type {string[]} */ (value))];
}

// One piped forecast, read; a shape that is not the forecast is a usage error.
/**
 * @param {string} text
 * @returns {Forecast}
 */
export function parseForecast(text) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UsageError("deep-dive reconcile reads the confirmed forecast as JSON from --stdin: {\"changes\": [...], \"may_change\": [...], \"unaffected\": [...]}");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new UsageError("deep-dive reconcile: the forecast is a JSON object");
  const data = /** @type {Record<string, unknown>} */ (value);
  for (const key of Object.keys(data)) {
    if (![...BANDS, "widened", "by"].includes(key)) throw new UsageError(`deep-dive reconcile: unknown forecast key \`${key}\` (only ${[...BANDS, "widened", "by"].join(", ")})`);
  }
  if (data.by !== undefined && (typeof data.by !== "string" || data.by.trim() === "")) throw new UsageError("deep-dive reconcile: `by` names the engineer who confirmed the widened Rules, such as human:librarian");
  return {
    changes: keyList(data.changes, "changes"),
    may_change: keyList(data.may_change, "may_change"),
    unaffected: keyList(data.unaffected, "unaffected"),
    widened: keyList(data.widened, "widened"),
    by: typeof data.by === "string" ? data.by : null,
  };
}

// `.qa/` as one set of parsed files: the Key index and each Feature's stripped Rules and Boundaries,
// as the Affected Rules walk reads a state.
/**
 * @param {readonly ParsedFile[]} files
 * @returns {AffectedSnapshot}
 */
export function snapshotOf(files) {
  const index = buildIndex(files);
  /** @type {Map<string, Map<string, string>>} */
  const rules = new Map();
  /** @type {Map<string, Map<string, string>>} */
  const boundaries = new Map();
  for (const file of files) {
    if ("unreadable" in file && file.unreadable) continue;
    if (file.type !== "feature" || typeof file.data.key !== "string" || rules.has(file.data.key)) continue;
    const stripped = strip(file);
    rules.set(file.data.key, stripped.rules);
    boundaries.set(file.data.key, stripped.boundaries);
  }
  return {
    files,
    index,
    rules: (slug) => rules.get(/** @type {string} */ (slug)) ?? new Map(),
    boundaries: (slug) => boundaries.get(/** @type {string} */ (slug)) ?? new Map(),
  };
}

// The Feature's Rules edited, added and retired between the committed file and the working tree.
/**
 * @param {ParsedFile | null} before
 * @param {ParsedFile} after
 * @returns {{ edited: RuleEdit[], added: string[], retired: Array<{ key: string, statement: string }> }}
 */
function ruleDiff(before, after) {
  const was = before ? ruleTexts(before) : new Map();
  const now = ruleTexts(after);
  const slug = String(after.data.key ?? "");
  const one = (/** @type {Map<string, string>} */ rules) => ({ index: { rules: new Map([[slug, null]]) }, rules: () => rules });
  /** @type {Map<string, ParsedRule>} */
  const wasRules = new Map((before?.rules ?? []).map((r) => [r.key, r]));
  const nowRules = new Map(after.rules.map((r) => [r.key, r]));
  /** @type {RuleEdit[]} */
  const edited = [];
  /** @type {string[]} */
  const added = [];
  /** @type {Array<{ key: string, statement: string }>} */
  const retired = [];
  for (const { rule: key } of rulesChangedAcross(one(was), one(now))) {
    const prior = wasRules.get(key);
    const current = nowRules.get(key);
    if (prior && current) {
      const edit = ruleEdit(prior, current, was.get(key) ?? "", now.get(key) ?? "");
      if (edit) edited.push(edit);
    } else if (current) added.push(key);
    else if (prior) retired.push({ key, statement: prior.statement });
  }
  const order = (/** @type {string} */ k) => after.rules.findIndex((r) => r.key === k);
  edited.sort((a, b) => order(a.key) - order(b.key));
  added.sort((a, b) => order(a) - order(b));
  return { edited, added, retired };
}

/**
 * @typedef {{
 *   ref: string,
 *   feature: string,
 *   rule: string,
 *   statement: string,
 *   via: string[],
 *   same_feature: boolean,
 * }} DownstreamRule
 */

// The Rules that rest on the edited Rules of `key`, over every Dependency path: the Affected Rules
// of each Feature whose causes are rooted in `key` and that are not edited themselves. Nearest first.
/**
 * @param {{ files: readonly ParsedFile[] }} ctx
 * @param {string} key
 * @param {readonly ParsedFile[]} thenFiles
 * @param {string} head
 * @returns {DownstreamRule[]}
 */
function downstreamOf(ctx, key, thenFiles, head) {
  const then = snapshotOf(thenFiles);
  const now = snapshotOf(ctx.files);
  const target = dependencyIndex(now.index, now.files);
  /** @type {Array<DownstreamRule & { hops: number }>} */
  const out = [];
  for (const slug of [...now.index.rules.keys()].sort()) {
    const facts = affectedRules({ then, now, feature: slug, baseline: head, target });
    for (const affected of facts.rules) {
      if (affected.changed) continue;
      const rooted = affected.causes.filter((cause) => cause.ref.startsWith(`${key}/`));
      if (rooted.length === 0) continue;
      const [end] = dependencyEnds(now.index, now.files, [{ feature: slug, rule: affected.rule }]);
      if (!end) continue;
      out.push({
        ref: end.ref,
        feature: slug,
        rule: affected.rule,
        statement: end.statement,
        via: rooted.map((cause) => cause.ref),
        same_feature: slug === key,
        hops: Math.min(...rooted.flatMap((cause) => cause.paths.map((p) => p.length - 1)), Infinity),
      });
    }
  }
  return out.sort((a, b) => a.hops - b.hops || a.ref.localeCompare(b.ref)).map(({ hops, ...rest }) => rest);
}

// The downstream Features in the order to run them: nearest first, each with its Rules, and the
// first as the one to run next.
/**
 * @param {string} key
 * @param {readonly DownstreamRule[]} downstream
 */
function nextFeatures(key, downstream) {
  /** @type {Map<string, string[]>} */
  const byFeature = new Map();
  for (const d of downstream) {
    if (d.same_feature) continue;
    byFeature.set(d.feature, [...(byFeature.get(d.feature) ?? []), d.ref]);
  }
  const features = [...byFeature].map(([feature, rules]) => ({ feature, rules }));
  const first = features[0];
  const next = first
    ? {
        feature: first.feature,
        command: `/qa-deep-dive ${first.feature}`,
        rules: first.rules,
        summary: `${first.rules.length} downstream Rule${first.rules.length === 1 ? "" : "s"} in ${first.feature} ${first.rules.length === 1 ? "rests" : "rest"} on the edited Rules of ${key}`,
      }
    : null;
  return { downstream_features: features, next_feature: next };
}

// The run dir's `change.json` with the widened Rules and the forecast entries merged in by (Feature,
// Rule) and written whole; every other key it holds stays as it was. A Rule the forecast covers takes
// the engineer's answer of this call, so an earlier answer on it, widened or not, is replaced; any
// other widened Rule is kept. A corrupt file is the usage error `readRunFile` names.
/**
 * @typedef {{ feature: string, rule: string, by: string | null, at: string }} Confirmed
 */
/**
 * @param {string} dir
 * @param {Array<Confirmed & { by: string }>} widened
 * @param {Array<Confirmed & { widened: boolean, statement: string }>} forecast
 * @returns {string}
 */
function recordForecast(dir, widened, forecast) {
  const read = readRunFile(dir, CHANGE_FILE, { by: ["deep-dive", "impact escalate"], restart: "impact plan" });
  if (read.error) throw new UsageError(read.error);
  const existing = read.value ?? {};
  if (typeof existing !== "object" || Array.isArray(existing)) throw new UsageError(`${join(dir, CHANGE_FILE)} is not the JSON object deep-dive wrote: start a new run with impact plan`);
  const data = /** @type {Record<string, unknown>} */ (existing);
  /**
   * @param {unknown} list
   * @param {readonly Confirmed[]} replaced
   * @returns {unknown[]}
   */
  const kept = (list, replaced) => (Array.isArray(list) ? list : []).filter((e) => !replaced.some((r) => e?.feature === r.feature && e?.rule === r.rule));
  const v = typeof data.v === "number" ? Math.max(data.v, FORECAST_SHAPE) : FORECAST_SHAPE;
  const out = { ...data, v, widened: [...kept(data.widened, [...widened, ...forecast]), ...widened], forecast: [...kept(data.forecast, forecast), ...forecast] };
  const path = join(dir, CHANGE_FILE);
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  return path;
}

// The Rules of `key` the forecast confirms whose statement was edited since the Feature's Watermark:
// those the Scan's Affected Rules name (`statementEdits`), so an edit already committed counts, which
// is what lets a lost run dir be confirmed again after the commit. A Rule is confirmed when the
// forecast puts it under Changes or May change, or widens it; one left Unaffected or unnamed is the
// `outside_band` edit still to settle. Asked only when there is a run dir to record in.
/**
 * @param {{ root: string }} ctx
 * @param {string} key
 * @param {Forecast} forecast
 * @param {boolean} recording whether `--dir` names a run dir
 * @returns {string[]}
 */
function statementEditsConfirmed(ctx, key, forecast, recording) {
  if (!recording) return [];
  const confirmed = new Set([...forecast.changes, ...forecast.may_change, ...forecast.widened]);
  return scan(ctx.root, { feature: key })
    .history.features.filter((f) => f.feature === key)
    .flatMap((f) => statementEdits(f.affected_rules, key))
    .filter((rule) => confirmed.has(rule));
}

/**
 * The `reconcile` action.
 * @param {{ root: string, files: readonly ParsedFile[], index: import("./qa-index.mjs").KeyIndex }} ctx
 * @param {string} key
 * @param {Forecast} forecast
 * @param {string | undefined} dir the run dir `--dir` names
 * @returns {{ json: Record<string, unknown>, exit: number }}
 */
export function reconcile(ctx, key, forecast, dir) {
  if (forecast.widened.length > 0) {
    if (dir === undefined) throw new UsageError("deep-dive reconcile records widened Rules in a run dir: pass --dir <run-dir>");
    if (forecast.by === null) throw new UsageError("deep-dive reconcile: name the engineer who confirmed the widened Rules in `by`, such as human:librarian");
  }
  const made = dir !== undefined ? newRunDir(dir, "qa-impact-") : null;
  if (made?.error) throw new UsageError(made.error);

  const after = ctx.index.features.get(key)?.[0]?.file ?? null;
  if (!after) return { json: { action: "reconcile", ok: false, feature: key, errors: [{ code: "no_feature", message: `no Feature \`${key}\`: reconcile follows Rule edits to an existing Feature` }] }, exit: 1 };

  const repo = repositoryOf(ctx.root);
  const head = repo ? resolveRef(ctx.root, "HEAD") : null;
  const thenFiles = repo && head ? loadQaAt(repo, head) : null;
  const before = /** @type {ParsedFile | null} */ (thenFiles?.find((f) => !("unreadable" in f && f.unreadable) && f.type === "feature" && f.data.key === key) ?? null);
  const diff = ruleDiff(before, after);

  const known = new Set([...(before?.rules ?? []).map((r) => r.key), ...after.rules.map((r) => r.key)]);
  const live = new Set(after.rules.map((r) => r.key));
  /** @type {Array<{ code: string, rule: string, message: string }>} */
  const errors = [];
  for (const band of BANDS) {
    for (const rule of forecast[band]) if (!known.has(rule)) errors.push({ code: "unknown_rule", rule, message: `\`${rule}\` in \`${band}\` is no Rule of ${key}` });
  }
  for (const rule of forecast.widened) if (!live.has(rule)) errors.push({ code: "unknown_rule", rule, message: `\`${rule}\` in \`widened\` is no live Rule of ${key}` });
  if (errors.length > 0) return { json: { action: "reconcile", ok: false, feature: key, errors }, exit: 1 };

  /** @param {string} rule @returns {"changes" | "may_change" | "unaffected" | null} */
  const bandOf = (rule) => BANDS.find((band) => forecast[band].includes(rule)) ?? null;
  const edited = diff.edited.map((edit) => ({ rule: edit.key, band: bandOf(edit.key), kinds: edit.kinds, changes: edit.changes }));
  const outside = edited.filter((e) => e.band === null || e.band === "unaffected");
  const touched = new Set([...edited.map((e) => e.rule), ...diff.added, ...diff.retired.map((r) => r.key)]);
  const boundaries = (after.boundaries ?? []).map((b) => ({ key: b.key, statement: b.statement, owner: b.owner ?? null }));
  const statementOf = new Map(after.rules.map((r) => [r.key, r.statement]));
  const boundaryCheck = boundaries.length === 0
    ? []
    : after.rules.filter((r) => edited.some((e) => e.rule === r.key) || diff.added.includes(r.key)).map((r) => ({ rule: r.key, statement: statementOf.get(r.key), boundaries }));
  const downstream = thenFiles && head ? downstreamOf({ files: /** @type {readonly ParsedFile[]} */ (ctx.files) }, key, /** @type {readonly ParsedFile[]} */ (thenFiles), head) : [];

  const at = new Date().toISOString().slice(0, 10);
  const widened = forecast.widened.map((rule) => ({ feature: key, rule, by: /** @type {string} */ (forecast.by), at }));
  const confirmed = statementEditsConfirmed(ctx, key, forecast, made !== null).map((rule) => ({
    feature: key,
    rule,
    widened: forecast.widened.includes(rule),
    // A Rule `statementEdits` names is in the working tree, so it has a statement.
    statement: /** @type {string} */ (statementIn(ctx.index, key, rule)),
    by: forecast.by,
    at,
  }));
  let changeFile = null;
  if (made?.make && (widened.length > 0 || confirmed.length > 0)) changeFile = recordForecast(made.make(), widened, confirmed);

  return {
    json: {
      action: "reconcile",
      ok: true,
      feature: key,
      edited,
      outside_band: outside,
      unedited_changes: forecast.changes.filter((rule) => !touched.has(rule)),
      added: diff.added,
      retired: diff.retired,
      boundary_check: boundaryCheck,
      downstream,
      ...nextFeatures(key, downstream),
      widened,
      forecast: confirmed,
      change_file: changeFile,
      next_step: `/qa-design ${key}`,
    },
    exit: 0,
  };
}
