// @ts-check
// Sync builds a sealed Card and applies validated JSON decisions in one uncommitted write.
/**
 * @import { CardAdapter, CardApplyOut, CardChangeset, CardRefusal, CardRefused, CardShown } from "./card-run.mjs"
 * @import { CommandContext, CommandResult, OptionSpec, UsageError } from "./cli.mjs"
 * @import { AttachFileRecord, SyncAttachContext } from "./sync-attach.mjs"
 * @import { MergeCard, MergeFileRecord, MergePair, MergeReply } from "./sync-merge.mjs"
 * @import { SyncCard, SyncCardContext, SyncCardData, SyncCardItem, SyncCardItemOut, SyncNote, SyncTrackerData } from "./sync-json.mjs"
 * @import { SyncTrackerContext } from "./sync-tracker.mjs"
 * @import { RefusalFact } from "./refusal.mjs"
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { keyLabel, summaries } from "./labels.mjs";
import { cardRun } from "./card-run.mjs";
import { changedPaths } from "./changeset.mjs";
import { cardData, decisionsOf, fact, refusalOf, refuse } from "./sync-json.mjs";
import { PATTERN } from "./keys.mjs";
import { projectConfig } from "./knowledge-file.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { table } from "./markdown.mjs";
import { cascade } from "./sync-plan.mjs";
import { newRunDir, openRunDir, readRunFile } from "./run-dir.mjs";
import { scan } from "./scan.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { ANY_SCHEMA_VERSION, SYNC_TRAIN_KEY } from "./schema.mjs";
import { resolveAdapter } from "./stack.mjs";
import { annotation, code, declaration, prefixes } from "./sync-code.mjs";
import { ATTACH_FILE, attach, attachNotes, nameKeys, namedFrom, suiteScope } from "./sync-attach.mjs";
import { Plan } from "./sync-plan.mjs";
import { MERGE_FILE, merge, mergesFrom, selectMerges } from "./sync-merge.mjs";
import { intake, readTracker, refresh, trackerAccess, trackerDivergences, trackerScope } from "./sync-tracker.mjs";
import { trainFor } from "./training.mjs";
import { unlanded, unlandedReports, unlandedScope } from "./sync-unlanded.mjs";
/** @import { RunFileResult } from "./run-dir.mjs" */

/**
 * The command context of a sync action: `--root` is a `qa-dir` option, so always resolved.
 * @typedef {CommandContext & { root: string }} SyncCommandContext
 */

/**
 * Sync's `run.json`: the Feature the run is scoped to, null when none.
 * @typedef {{ feature: string | null }} SyncRunRecord
 */

/**
 * A run dir `runDir` opened or made, or the refusal that stopped it.
 * @typedef {{ dir: string, create: true, make: () => string, error?: never }
 *   | { dir: string, create: false, make?: undefined, error?: never }
 *   | { error: string, dir?: never, create?: never, make?: never }} SyncRunDir
 */

/**
 * The keys an Attach names, or the reason their file is not what `sync apply` wrote.
 * @typedef {{ named: Record<string, string>, error?: never } | { error: string, named?: never }} SyncNamed
 */

/**
 * The Merge pairs the run keeps, or the reason their file is not what `sync apply` wrote.
 * @typedef {{ pairs: MergePair[], error?: never } | { error: string, pairs?: never }} SyncMerges
 */

/**
 * A new run dir `newRunDir` may make, or the refusal that stopped it.
 * @typedef {{ dir: string | null, exists: boolean, make: () => string, error?: never }
 *   | { error: string, dir?: never, exists?: never, make?: never }} SyncNewRunDir
 */

/**
 * An existing run dir `openRunDir` found, or the refusal that stopped it.
 * @typedef {{ dir: string, error?: never } | { error: string, dir?: never }} SyncOpenRunDir
 */

/**
 * What a Plan's `render` returns, as `applyCard` reads it.
 * @typedef {{ ok: false, errors: Array<{ code: string, [key: string]: unknown }> }
 *   | { ok: true, warnings: Array<{ code: string, [key: string]: unknown }>,
 *       changeset: { writes: Array<{ path: string, text: string, absent?: boolean }>, deletes?: string[] } }} SyncRendered
 */

/**
 * The data a sync apply hands back: the items it left open or applied.
 * @typedef {{ open?: number[], applied?: number[], dropped?: number[], [key: string]: unknown }} SyncApplyData
 */

/**
 * The scan a context loads lazily: the run health the card notes.
 * @typedef {{ run_health: SyncNote[], [key: string]: unknown }} SyncScan
 */

/**
 * The stack adapter a sync context resolves.
 * @typedef {{
 *   extensions: string[],
 *   carrierText: (annotation: unknown, prefix: string) => string,
 *   headerText: (prefix: string) => string,
 *   [key: string]: unknown,
 * }} SyncStackAdapter
 */

/**
 * The context a sync action loads: the scan index, the tracker, the run dir and the settings.
 * @typedef {SyncTrackerContext & {
 *   repo: string,
 *   dir: string,
 *   named: Record<string, string>,
 *   payload: string | null,
 *   requireMarks: boolean,
 *   merges: MergePair[],
 *   unlanded: Record<string, unknown>,
 *   tracker: SyncTrackerData,
 *   config: SyncTrackerContext["config"] & { modulePaths: string[], autRecipe?: unknown, annotationMap?: unknown },
 *   stack: { adapter?: SyncStackAdapter },
 *   repoPath: (rel: string) => string,
 *   scan: SyncScan,
 *   _scan?: SyncScan,
 * }} SyncContext
 */

/**
 * The Plan a sync section records its changes on, as `sync` reads it.
 * @typedef {{
 *   minted: Array<{ key: string, function: { name: string, file: string, line: number }, bind: string[] }>,
 *   intaken: Array<Record<string, unknown>>,
 *   unlandedNotes?: Array<{ code: string, key: string, [key: string]: unknown }>,
 *   render: () => SyncRendered,
 * }} SyncPlan
 */

/**
 * What a section of the sync card is, as `buildCard` reads it.
 * @typedef {{
 *   key: string,
 *   title: string | ((ctx: SyncContext) => string),
 *   codes: string[],
 *   tracker?: boolean,
 *   only?: (ctx: SyncContext) => boolean,
 *   items: (ctx: SyncContext) => SyncCardItem[],
 *   info?: (ctx: SyncContext) => Record<string, unknown>,
 *   apply: (ctx: SyncContext, item: SyncCardItem, plan: SyncPlan) => { code: string, [key: string]: unknown } | null,
 * }} SyncSection
 */

/**
 * The seal a Card is built from: what it was shown against.
 * @typedef {{
 *   items: SyncCardItem[],
 *   unlanded: Record<string, unknown>,
 *   payload: string | null,
 *   files: Array<[string, string]>,
 *   source: Array<[string, string]>,
 * }} SyncSeal
 */

/**
 * The decisions `sync apply` hands its Card: the validated JSON, with every field `decisionsOf` fills.
 * @typedef {{
 *   take: number[],
 *   drop: number[],
 *   edits: Record<string | number, Record<string, unknown>>,
 *   name: Record<string, string>,
 *   merge: Record<string, string>,
 *   confirm?: number[],
 *   [key: string]: unknown,
 * }} SyncApplyDecisions
 */

/**
 * The context a sync action's `run` is called with: `withRun` resolves the rest itself.
 * @typedef {Partial<CommandContext>} SyncActionContext
 */

/**
 * A sync action, as the command line reads it.
 * @typedef {{
 *   usage: string,
 *   run: (args: string[], options: SyncActionContext) => CommandResult,
 * }} SyncAction
 */

/**
 * The sync command: its actions are always present, so a caller can name one.
 * @typedef {{
 *   options: OptionSpec,
 *   actions: Record<string, SyncAction>,
 *   refuse: (e: UsageError) => CommandResult,
 * }} SyncCommand
 */

// Each section module types its own context and card items (lib/sync-*.mjs), narrower than the
// generic `SyncSection` the card reads them through, so the list is bridged through `unknown` once.
const SECTIONS = /** @type {SyncSection[]} */ (/** @type {unknown} */ ([declaration, refresh, attach, intake, unlanded, prefixes, code, merge]));

/**
 * @param {string} action
 * @param {string[]} args
 * @param {SyncCommandContext} param3
 * @param {(ctx: SyncContext, line?: string) => CommandResult} act
 * @returns {CommandResult}
 */
function withRun(action, args, { root, stdin, seed, dir }, act) {
  if (action === "apply" && args.length) return refuse("apply_takes_no_feature");
  if (args.length > 1) return refuse("too_many_features", { action });
  const [named] = args;
  if (named !== undefined && !PATTERN.slug.test(named)) return refuse("not_feature_key", { given: named });
  let line;
  if (action === "apply") {
    const newer = refuseUnreadSchema(root, ANY_SCHEMA_VERSION);
    if (newer) return newer;
    if (!stdin) return refuse("apply_needs_stdin");
    line = stdin();
  }
  const run = runDir(action, dir);
  if (run.error) return refuse("run_dir", { reason: run.error });
  /** @type {RunFileResult<SyncRunRecord>} */
  const recorded = run.create ? { value: null } : readRunFile(/** @type {string} */ (run.dir), RUN_FILE, SYNC_RUN);
  if (recorded.error) return refuse("run_dir", { reason: recorded.error });
  const scopedTo = recorded.value;
  if (scopedTo && named !== undefined && scopedTo.feature !== named) {
    const { feature: summary } = summaries(buildIndex(loadWorkingTree(root)));
    return refuse("run_scoped_elsewhere", { dir: run.dir, scoped: scopedTo.feature, named, label: summary(named) });
  }
  const feature = named ?? scopedTo?.feature ?? undefined;
  /** @type {SyncNamed} */
  const kept = run.create ? { named: {} } : namedIn(/** @type {string} */ (run.dir));
  if (kept.error) return refuse("run_dir", { reason: kept.error });
  const ctx = load(root, feature, seed, run.create ? null : readPayload(/** @type {string} */ (run.dir)), { named: kept.named });
  if (feature !== undefined && !ctx.index.features.has(feature)) return refuse("no_feature", { slug: feature, root });
  // A new run dir is made only once the Feature is known good, so a refused one leaves none.
  ctx.dir = run.create ? run.make() : /** @type {string} */ (run.dir);
  const merges = mergesIn(ctx.dir);
  if (merges.error) return refuse("run_dir", { reason: merges.error });
  ctx.merges = /** @type {MergePair[]} */ (merges.pairs);
  if (!scopedTo && action !== "apply") writeFileSync(join(ctx.dir, RUN_FILE), `${JSON.stringify(/** @type {SyncRunRecord} */ ({ feature: feature ?? null }))}\n`);
  return act(ctx, line);
}

const PAYLOAD_FILE = "tracker.json";
const RUN_FILE = "run.json";

/** @param {string} dir @returns {boolean} */
export const isSyncRunDir = (dir) => existsSync(join(dir, RUN_FILE));

/**
 * @param {string} action
 * @param {string | undefined} dir
 * @returns {SyncRunDir}
 */
function runDir(action, dir) {
  if (action === "scope") {
    /** @type {SyncNewRunDir} */
    const run = newRunDir(dir, "qa-sync-");
    return run.error ? run : /** @type {SyncRunDir} */ ({ dir: /** @type {string} */ (run.dir), create: !run.exists, make: run.make });
  }
  /** @type {SyncOpenRunDir} */
  const run = openRunDir(dir, { cmd: "sync", action, from: "sync scope" });
  return run.error ? run : /** @type {SyncRunDir} */ ({ dir: /** @type {string} */ (run.dir), create: false });
}

const SYNC_RUN = { by: "sync", restart: "sync scope" };

// The keys the engineer named for an Attach, which the run dir keeps: `{named}` or `{error}`.
/**
 * @param {string} dir
 * @returns {SyncNamed}
 */
function namedIn(dir) {
  /** @type {RunFileResult<AttachFileRecord>} */
  const kept = readRunFile(dir, ATTACH_FILE, SYNC_RUN);
  if (kept.error) return kept;
  const named = namedFrom(/** @type {AttachFileRecord | null} */ (kept.value));
  return named ? { named } : { error: `${join(dir, ATTACH_FILE)} is not the JSON \`sync apply\` wrote: start a new run with \`sync scope\`` };
}

/**
 * @param {string} dir
 * @returns {SyncMerges}
 */
function mergesIn(dir) {
  /** @type {RunFileResult<MergeFileRecord>} */
  const kept = readRunFile(dir, MERGE_FILE, SYNC_RUN);
  if (kept.error) return kept;
  const pairs = mergesFrom(/** @type {MergeFileRecord | null} */ (kept.value));
  return pairs ? { pairs } : { error: `${join(dir, MERGE_FILE)} is not the JSON sync apply wrote: start a new run with sync scope` };
}

/**
 * @param {string} dir
 * @returns {string | null}
 */
function readPayload(dir) {
  const path = join(dir, PAYLOAD_FILE);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

const OPTIONS = /** @type {OptionSpec} */ ({ root: "qa-dir", stdin: "flag", dir: "value" });

/** @type {Record<string, SyncAction>} */
const ACTIONS = {
  scope: {
    usage: "[<feature>] [--dir <run-dir>] [--root <qa-dir>]",
    run: (args, options) => withRun("scope", args, /** @type {SyncCommandContext} */ (options), (ctx) => {
      const { tracker, prose, fields, label_destinations, scenarios, suites, cases, mark_field } = trackerScope(ctx);
      const payload_file = tracker ? join(ctx.dir, PAYLOAD_FILE) : null;
      return { json: { dir: ctx.dir, payload_file, tracker, fields, label_destinations, mark_field, scenarios, suites, cases, ...(tracker && suiteScope(/** @type {SyncAttachContext} */ (ctx))), marked_cases: ctx.unlanded.query, marked_scenarios: ctx.unlanded.scenario_query, marked_suites: ctx.unlanded.suite_query, fetch_prose: fetchProse(ctx, prose), access: trackerAccess(ctx), train: trainFor(ctx.index, SYNC_TRAIN_KEY) }, exit: 0 };
    }),
  },

  card: {
    usage: "[<feature>] --dir <run-dir> [--root <qa-dir>]",
    run: (args, options) => withRun("card", args, /** @type {SyncCommandContext} */ (options), (ctx) => {
      const shown = /** @type {CardShown<SyncCardData>} */ (/** @type {(ctx: SyncContext, dir: string) => CardShown<SyncCardData> | CardRefused} */ (lifecycle.card)(ctx, ctx.dir));
      const fetch_prose = fetchProse(ctx, trackerScope(ctx).prose);
      return { json: { dir: ctx.dir, fetch_prose, ...(!fetch_prose.length && { card: shown.card }) }, exit: shown.exit };
    }),
  },

  apply: {
    usage: "--dir <run-dir> --stdin [--root <qa-dir>]",
    run: (args, options) => withRun("apply", args, /** @type {SyncCommandContext} */ (options), (ctx, line) => {
      const { exit, ...json } = lifecycle.apply(ctx, ctx.dir, /** @type {string} */ (line));
      if (exit === 2) return { exit, json: { ok: false, refusals: /** @type {{ refusals: CardRefusal[] }} */ (json).refusals } };
      return { exit, json: { dir: ctx.dir, confirm: false, rebuild: false, .../** @type {Record<string, unknown>} */ (json) } };

    }),
  },
};

/** @type {SyncCommand} */
export const command = { options: OPTIONS, actions: ACTIONS, refuse: (e) => refuse(/** @type {string} */ (e.detail.code), e.detail) };

/**
 * @param {SyncContext} ctx
 * @param {readonly string[] | null | undefined} prose
 * @returns {string[]}
 */
function fetchProse(ctx, prose) {
  const marked = ctx.tracker.ok ? (/** @type {Array<{ key: string, intake_needs?: string[] }>} */ (unlanded.items(ctx))).filter((i) => i.intake_needs?.includes("prose")).map((i) => i.key) : [];
  return [...new Set([...(prose ?? []), ...marked])];
}

/**
 * @param {string} root
 * @param {string | undefined} feature
 * @param {string | undefined} seed
 * @param {string | null} trackerText
 * @param {{ requireMarks?: boolean, named?: Record<string, string> }} [param5]
 * @returns {SyncContext}
 */
function load(root, feature, seed, trackerText, { requireMarks = true, named = {} } = {}) {
  const files = loadWorkingTree(root);
  const index = buildIndex(files);
  const abs = resolve(root);
  const repo = dirname(abs);
  const config = projectConfig(index.project);
  const ctx = /** @type {SyncContext} */ (/** @type {unknown} */ ({
    root: abs,
    repo,
    feature,
    seed,
    files,
    index,
    config,
    // The stack adapter for this run (lib/stack.mjs `resolveAdapter`), resolved once here.
    stack: resolveAdapter(config.stack, repo),
    // Loaded lazily, so a usage error costs no scan.
    get scan() {
      return (/** @type {SyncContext} */ (this)._scan ??= /** @type {SyncScan} */ (scan(root, /** @type {Parameters<typeof scan>[1]} */ ({ feature }))));
    },
    /** @param {string} rel */
    repoPath: (rel) => relative(repo, resolve(abs, rel)).split(sep).join("/"),
  }));
  ctx.named = named; // the tracker keys the engineer named for an Attach (lib/sync-attach.mjs)
  ctx.payload = trackerText ?? null;
  ctx.unlanded = unlandedScope(ctx);
  ctx.requireMarks = requireMarks;
  ctx.tracker = /** @type {SyncTrackerData} */ (readTracker(ctx, trackerText));
  return ctx;
}

/**
 * @param {SyncContext} ctx
 * @returns {{ card: SyncCard, seal: SyncSeal }}
 */
function buildCard(ctx) {
  /** @type {SyncCardItem[]} */
  const items = [];
  /** @type {SyncCard["sections"]} */
  const sections = [];
  /** @type {Map<SyncCardItem, number>} */
  const numberOf = new Map();
  for (const s of SECTIONS) {
    if ((s.tracker && !ctx.tracker.ok) || (s.only && !s.only(ctx))) continue;
    const list = s.items(ctx);
    /** @type {number[]} */
    const numbers = [];
    for (const item of list) {
      if (!s.codes.includes(item.code)) throw new Error(`section \`${s.key}\` made an item with code \`${item.code}\`, which its \`codes\` does not list`);
      const n = items.length + 1;
      numberOf.set(item, n);
      items.push({ n, section: s.key, ...item });
      numbers.push(n);
    }
    sections.push({ key: s.key, title: typeof s.title === "function" ? s.title(ctx) : s.title, items: numbers, ...s.info?.(ctx) });
  }
  for (const item of items) if (item.requires) item.requires = item.requires.map((r) => numberOf.get(/** @type {SyncCardItem} */ (r)));
  /** @type {SyncNote[]} */
  const notes = [...ctx.scan.run_health, ...(ctx.tracker.note ? [/** @type {SyncNote} */ (ctx.tracker.note)] : []), ...(ctx.unlanded.note ? [/** @type {SyncNote} */ (ctx.unlanded.note)] : []), ...attachNotes(/** @type {SyncAttachContext} */ (ctx)), ...code.notes(ctx)];
  /** @type {SyncCard["divergences"]} */
  const divergences = [...trackerDivergences(ctx), ...unlandedReports(ctx), ...items.filter((i) => ["unlanded_suite", "unlanded_case"].includes(i.code)).map(({ code, key, summary }) => ({ code, ...(code === "unlanded_suite" && { kind: /** @type {const} */ ("suite") }), key, summary }))];
  return { card: { sections, items, divergences, notes }, seal: { items, unlanded: ctx.unlanded, payload: ctx.payload, files: ctx.files.map((f) => /** @type {[string, string]} */ ([f.rel, f.text])), source: sourceSeal(ctx) } };
}

/**
 * @param {string} root
 * @param {{ dir: string, feature: string | undefined, seed: string | undefined }} param1
 * @returns {SyncCard}
 */
export function cardOf(root, { dir, feature, seed }) {
  const ctx = load(root, feature, seed, readPayload(dir), { named: /** @type {Record<string, string>} */ (namedIn(dir).named) });
  ctx.merges = /** @type {MergePair[]} */ (mergesIn(dir).pairs);
  return buildCard(ctx).card;
}

/**
 * @param {SyncContext} ctx
 * @returns {Array<[string, string]>}
 */
function sourceSeal(ctx) {
  /** @type {Map<string, string>} */
  const files = new Map();
  /** @param {string} rel */
  const walk = (rel) => {
    const at = join(ctx.repo, rel);
    if (!existsSync(at)) return;
    for (const e of readdirSync(at, { withFileTypes: true })) {
      const path = join(rel, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.isFile() && ctx.stack.adapter?.extensions.some((ext) => path.endsWith(ext))) files.set(path, readFileSync(join(ctx.repo, path), "utf8"));
    }
  };
  for (const rel of ctx.config.modulePaths) walk(rel);
  return [...files].sort(([a], [b]) => a.localeCompare(b));
}

// Publish reads the payload before it carries marks, so it does not require them yet.
/**
 * @param {string} root
 * @param {string | undefined} feature
 * @param {string | undefined} seed
 * @param {string | null} trackerText
 * @returns {SyncContext}
 */
export const loadSyncContext = (root, feature, seed, trackerText) => load(root, feature, seed, trackerText, { requireMarks: false });
export { sourceSeal };

const lifecycle = cardRun(/** @type {CardAdapter<SyncContext, unknown, SyncCard, SyncApplyData>} */ ({
  kind: "sync", keepData: true, run: SYNC_RUN, fact,
  build: buildCard,
  data: cardData,
  decisions: (ctx, card, input) => { const decisions = decisionsOf(JSON.stringify(input), card.items); return { ...decisions, errors: decisions.errors.map(refusalOf) }; },
  apply: applyCard,
}));

/**
 * @param {SyncContext} ctx
 * @param {SyncCard} card
 * @param {SyncApplyDecisions} reply
 * @returns {CardApplyOut<SyncApplyData>}
 */
function applyCard(ctx, card, reply) {
  const selected = selectMerges(ctx, /** @type {MergeCard} */ (card), reply);
  if (selected?.problems) return { refused: selected.problems.map((p) => fact(p.code, p)) };
  if (selected) return { refused: [fact("merge_selected", { selected: selected.selected })], rebuild: true };
  // Keys the Reply names are kept in the run and fetched before any Card item can take them.
  if (Object.keys(reply.name).length) {
    const named = nameKeys(/** @type {SyncAttachContext} */ (ctx), reply.name);
    if (named.problems) return { refused: named.problems.map((p) => fact(p.code, p)) };
    return { refused: [fact("attach_named", { named: named.named })], rebuild: true };
  }
  const cascaded = /** @type {Array<{ n: number, [key: string]: unknown }>} */ (cascade(reply.drop, card.items));
  const dropped = new Set([...reply.drop, ...cascaded.map((c) => c.n)]);
  const open = card.items.filter((i) => !dropped.has(/** @type {number} */ (i.n)) && !reply.take.includes(/** @type {number} */ (i.n))).map((i) => /** @type {number} */ (i.n));
  if (open.length) return { refused: [fact("unaddressed", { items: open })], data: { open } };
  const plan = /** @type {SyncPlan} */ (new Plan(ctx, annotation(ctx)));
  /** @type {RefusalFact[]} */
  const errors = [];
  /** @type {number[]} */
  const cross_feature = [];
  /** @type {number[]} */
  const applied = [];
  for (const item of card.items) {
    if (dropped.has(/** @type {number} */ (item.n))) continue;
    const edited = { ...item, ...(reply.edits[/** @type {number} */ (item.n)] ?? {}) };
    const problem = /** @type {SyncSection} */ (SECTIONS.find((s) => s.key === item.section)).apply(ctx, edited, plan);
    if (problem) errors.push(refusalOf({ ...problem, item: item.n }));
    else applied.push(/** @type {number} */ (item.n));
    if (reply.edits[/** @type {number} */ (item.n)]?.bind && spansFeatures(ctx, edited)) cross_feature.push(/** @type {number} */ (item.n));
  }
  if (errors.length) return { refused: errors, rebuild: errors.some((e) => e.code === "prose_not_fetched") };
  if (cascaded.length) {
    const drop = [...dropped].sort((a, b) => a - b);
    const removed = Object.keys(reply.edits).map(Number).filter((n) => dropped.has(n));
    const decisions = { take: reply.take.filter((n) => !dropped.has(n)), drop, edits: Object.fromEntries(Object.entries(reply.edits).filter(([n]) => !dropped.has(Number(n)))) };
    const shown = cardData(/** @type {SyncCardContext} */ (ctx), card);
    return { confirm: { cascade: cascaded.map((c) => ({ ...c, label: /** @type {SyncCardItemOut} */ (shown.items.find((i) => i.n === c.n)).label })), removed, decisions: { ...decisions, confirm: cascaded.map((item) => item.n) } } };
  }
  const rendered = plan.render();
  if (!rendered.ok) return { refused: rendered.errors.map(refusalOf) };
  const paths = changedPaths(/** @type {{ writes: Array<{ path: string, text: string, absent?: boolean }>, deletes?: never[] }} */ (rendered.changeset));
  const shown = cardData(/** @type {SyncCardContext} */ (ctx), card);
  const labels = { ...shown.labels };
  const summary = summaries(ctx.index);
  for (const key of [...plan.minted.flatMap((m) => m.bind), ...Object.values(reply.edits).flatMap((e) => /** @type {string[] | undefined} */ (e.bind) ?? [])]) labels[key] ??= keyLabel(key, summary.testCase(key));
  for (const m of plan.minted) labels[m.key] = keyLabel(m.key, m.function.name);
  const scope = ctx.feature ? `qa(${ctx.feature})` : "qa";
  return { changeset: /** @type {CardChangeset} */ (rendered.changeset), message: `${scope}: /qa-sync`, data: { applied, dropped: reply.drop }, report: (commit) => ({
    labels,
    minted_markdown: table(["Automation key", "Automation", "Test Cases to link"], plan.minted.map((m) => [labels[m.key], `\`${m.function.name}\` (\`${m.function.file}:${m.function.line}\`)`, m.bind.map((k) => labels[k])])),
    minted: plan.minted.map((m) => ({ ...m, label: labels[m.key], unclaimed: !m.bind.length })), cross_feature,
    warnings: rendered.warnings.map(refusalOf), files: paths,
    notes: (plan.unlandedNotes ?? []).map((note) => ({ ...note, label: labels[note.key] })),
    intaken: plan.intaken,
    markdown: paths.map((p) => `- \`${p}\``).join("\n"),
    commit,
  }) };
}

/**
 * @param {SyncContext} ctx
 * @param {SyncCardItem} item
 * @returns {boolean}
 */
function spansFeatures(ctx, item) {
  const features = new Set(/** @type {string[]} */ (item.bind).map((k) => ctx.index.cases.get(k)?.[0].feature));
  if (item.feature) features.add(item.feature);
  return features.size > 1;
}
