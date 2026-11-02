// @ts-check
// The Card page of the settle engine (settle-walk.mjs), split out of it: `design page` renders the
// unsettled cases as one self-contained page and `design page-reply` settles the Reply it returns
// (ADR-0030).
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { summaries, terms } from "./labels.mjs";
import { decisionsOf, DISMISSAL_VALIDATION, refusalOf, refuse } from "./impact-json.mjs";
import { renderCardPage } from "./card-page.mjs";
import { object, refusalsFor } from "./refusal.mjs";
import { newRunId, readRunFile } from "./run-dir.mjs";
import { pageState } from "./settle-walk.mjs";
/** @import { PageStateCase, PageStateQuestions, PageStateReviewState } from "./settle-walk.mjs" */

// ---- The Card page ----
/** @import {InboxPageModel, PageLimits, ReplyItem, ReplyPayload} from "./page.d.mts" */
/** @import { CommandResult } from "./cli.mjs" */
/** @import { CaseFinding } from "./impact-json.mjs" */
/** @import { ImpactPlan } from "./impact.mjs" */
/** @import { RunFileResult } from "./run-dir.mjs" */

/**
 * `card-pages.json`, the Run's record of the pages it rendered and the Replies they answered.
 * @typedef {object} PageRecord
 * @property {string} run
 * @property {PageRecordPage[]} pages
 * @property {PageRecordReply[]} replies
 */

/**
 * A page the Run rendered, and the cases it offered.
 * @typedef {object} PageRecordPage
 * @property {string} page
 * @property {string[]} keys
 */

/**
 * A Reply the Run took, and the cases it answered.
 * @typedef {object} PageRecordReply
 * @property {string} page
 * @property {string[]} answered
 */

/**
 * `card-page.<digest>.json`, the immutable snapshot of one rendered page.
 * @typedef {object} PageSnapshot
 * @property {string} run
 * @property {string} page
 * @property {PageSnapshotCase[]} cases
 */

/**
 * A case the page offered, as the snapshot holds it: the finding ids it showed, the choices it
 * offered, its Review state, and a fingerprint of the knowledge shown.
 * @typedef {object} PageSnapshotCase
 * @property {string} key
 * @property {string[]} finding_ids
 * @property {PageStateQuestions} choices
 * @property {PageStateReviewState} review_state
 * @property {string} fingerprint
 */

/**
 * The explanations the engineer gave for the page's cases, as the agent's JSON holds them: the
 * page's case keys and plain text of at most `EXPLANATION_LIMIT` characters each.
 * @typedef {Record<string, string>} PageExplanations
 */

/** @type {number} */
export const EXPLANATION_LIMIT = 280;
/** @type {Record<string, string>} */
export const PAGE_REFUSALS = {
  page_explanations: `Explanations must be an items object of page case keys and plain text of at most ${EXPLANATION_LIMIT} characters each.`,
  no_unsettled_cases: "No unsettled case is available for a Card page.",
  reply_fence: "The Reply must contain exactly one fenced JSON block and no surrounding text.",
  reply_json: "The Reply does not hold a parseable JSON object.",
  reply_run: "The Reply names a different or unknown Run.",
  reply_page: "This Run never rendered the page named by the Reply.",
  reply_count: "The Reply count does not match its items.",
  reply_duplicate: "The Reply names a case more than once.",
  reply_field: "The Reply contains an unknown field.",
  reply_case: "The Reply names a case this page did not offer.",
  reply_shape: "The Reply has an unsupported version or malformed fields.",
};
const { refuse: pageRefuse } = refusalsFor(PAGE_REFUSALS);

/**
 * @param {unknown} value
 * @param {string[]} fields
 * @returns {boolean}
 */
export const unknown = (value, fields) => object(value) && Object.keys(value).some((key) => !fields.includes(key));

/**
 * @template {PageRecord | PageSnapshot} T
 * @param {string} dir
 * @param {string} name
 * @returns {RunFileResult<T>}
 */
const readPageFile = (dir, name) => readRunFile(dir, name, { by: "design page", restart: "impact plan" });

/**
 * The Card page of the walk: the cases it offers, the explanations the engineer gave for them,
 * and the snapshot the Reply is checked against.
 * @param {string} dir
 * @param {ImpactPlan} plan
 * @param {string | undefined} input
 * @returns {CommandResult}
 */
export function page(dir, plan, input) {
  /** @type {PageExplanations} */
  let explanations = {};
  if (input !== undefined) {
    let given;
    try { given = JSON.parse(input); } catch { return pageRefuse("page_explanations"); }
    if (!object(given) || unknown(given, ["items"]) || !object(given.items)) return pageRefuse("page_explanations");
    // The text of each explanation is held to the limit below, before any of it reaches the page.
    explanations = /** @type {PageExplanations} */ (given.items);
  }
  const state = pageState(dir, plan);
  if (state.refused) return state.refused;
  const runFile = join(dir, "card-pages.json");
  /** @type {RunFileResult<PageRecord>} */
  const saved = readPageFile(dir, "card-pages.json");
  if (saved.error) return pageRefuse("run_dir", { reason: saved.error });
  /** @type {PageRecord} */
  const record = saved.value ?? { run: newRunId(), pages: [], replies: [] };
  const answered = new Set(record.replies.flatMap((r) => r.answered));
  const cases = /** @type {PageStateCase[]} */ (state.cases.filter((c) => !c.settled && !c.gone && !answered.has(c.key)));
  if (!cases.length) return pageRefuse("no_unsettled_cases");
  if (Object.entries(explanations).some(([key, text]) => !cases.some((c) => c.key === key) || typeof text !== "string" || text.length > EXPLANATION_LIMIT)) return pageRefuse("page_explanations");
  /** @type {PageSnapshotCase[]} */
  const snapshots = cases.map((c) => ({ key: c.key, finding_ids: c.item.facts.map((f) => /** @type {string} */ (f.id)), choices: c.item.questions, review_state: c.item.review_state, fingerprint: c.fingerprint }));
  const digest = createHash("sha256").update(JSON.stringify([record.run, snapshots])).digest("hex");
  // The page contract is the shape the client reads; the walk's page state carries it (its
  // glossary pieces, its summaries and its items) without a cast. The walk types a finding's id
  // as optional though the page state always writes it, so the items keep a cast.
  /** @type {InboxPageModel} */
  const model = { card_page: 1, command: "impact", layout: "inbox", run: record.run, page: digest, terms: state.terms, summaries: state.summaries, items: /** @type {InboxPageModel["items"]} */ (cases.map((c) => ({ ...c.item, ...(Object.hasOwn(explanations, c.key) && { explanation: explanations[c.key] }) }))), validation: DISMISSAL_VALIDATION, limits: { warn: 30000, max: 40000 } };
  const html = renderCardPage(model);
  const snapshotPath = join(dir, `card-page.${digest}.json`);
  if (!existsSync(snapshotPath)) writeFileSync(snapshotPath, `${JSON.stringify(/** @type {PageSnapshot} */ ({ run: record.run, page: digest, cases: snapshots }), null, 2)}\n`, { flag: "wx" });
  // The latest page to offer a case is the only one that may answer it.
  record.pages = [...(record.pages ?? []).filter((p) => p.page !== digest), { page: digest, keys: cases.map((c) => c.key) }];
  writeFileSync(runFile, `${JSON.stringify(record, null, 2)}\n`);
  const path = join(dir, "card-page.html");
  writeFileSync(path, html);
  return { exit: 0, json: { ok: true, path, page: digest, cases: cases.length, size_limit: /** @type {PageLimits} */ (model.limits).max } };
}

/**
 * The Reply to a Card page: the fenced JSON block the engineer pasted, checked against the
 * snapshot of the page it answers.
 * @param {string} dir
 * @param {ImpactPlan} plan
 * @param {string} text
 * @returns {CommandResult}
 */
export function pageReply(dir, plan, text) {
  const block = /^\s*```json\r?\n([\s\S]*?)\r?\n```\s*$/.exec(text);
  if (!block || /^\s*```/m.test(block[1])) return pageRefuse("reply_fence");
  /** @type {ReplyPayload} */
  let input;
  try { input = JSON.parse(block[1]); } catch { return pageRefuse("reply_json"); }
  if (!object(input)) return pageRefuse("reply_json");
  if (!Array.isArray(input.items) || !Number.isSafeInteger(input.count) || input.count !== input.items.length) return pageRefuse("reply_count");
  if (input.card_page !== 1 || (input.comment !== undefined && typeof input.comment !== "string")
    || input.items.some((c) => !object(c) || typeof c.key !== "string" || (c.comment !== undefined && typeof c.comment !== "string"))) return pageRefuse("reply_shape");
  if (unknown(input, ["card_page", "run", "page", "count", "items", "comment"]) || input.items.some((c) =>
    unknown(c, ["key", "findings", "review", "comment"]) || (object(c?.findings) && Object.values(c.findings).some((f) => unknown(f, ["answer", "reason", "ticket", "fix", "target"]))))) return pageRefuse("reply_field");
  if (new Set(input.items.map((c) => c?.key)).size !== input.items.length) return pageRefuse("reply_duplicate");
  const runFile = join(dir, "card-pages.json");
  /** @type {RunFileResult<PageRecord>} */
  const saved = readPageFile(dir, "card-pages.json");
  if (saved.error) return pageRefuse("run_dir", { reason: saved.error });
  const record = saved.value;
  if (!record || input.run !== record.run) return pageRefuse("reply_run");
  if (typeof input.page !== "string" || !/^[0-9a-f]{64}$/.test(input.page)) return pageRefuse("reply_page");
  /** @type {RunFileResult<PageSnapshot>} */
  const read = readPageFile(dir, `card-page.${input.page}.json`);
  if (read.error) return pageRefuse("run_dir", { reason: read.error });
  const snapshot = read.value;
  if (!snapshot || snapshot.run !== record.run || snapshot.page !== input.page) return pageRefuse("reply_page");
  if (input.items.some((c) => !snapshot.cases.some((s) => s.key === c?.key))) return pageRefuse("reply_case");
  const state = pageState(dir, plan);
  if (state.refused) return state.refused;
  const items = snapshot.cases.filter((c) => input.items.some((i) => i.key === c.key)).map((c) => {
    const { key, ...given } = input.items.find((i) => i.key === c.key) ?? /** @type {ReplyItem} */ ({ key: c.key });
    const current = state.cases.find((i) => i.key === c.key);
    const out = { key: c.key, ...(given.comment !== undefined && { comment: given.comment }) };
    if (current?.settled) return { ...out, status: "settled" };
    if (!current || (record.pages && record.pages.findLast((p) => p.keys.includes(c.key))?.page !== input.page)
      || current.gone || current.fingerprint !== c.fingerprint
      || !isDeepStrictEqual(current.item.facts.map((f) => f.id), c.finding_ids)
      || !isDeepStrictEqual(current.item.questions, c.choices)
      || !isDeepStrictEqual(current.item.review_state, c.review_state)) return { ...out, status: "changed" };
    // The given answers under the display numbers the walk shows, beside the finding ids they were keyed by.
    const numbered = () => ({
      ...(object(given.findings) && { findings: Object.entries(given.findings).flatMap(([id, value]) => {
        const n = current.item.facts.find((f) => f.id === id)?.n;
        return n === undefined || !object(value) ? [] : [{ n, ...value }];
      }) }),
      ...(given.review !== undefined && { review: given.review }),
    });
    /** @param {Array<{ code: string, [key: string]: unknown }>} errors */
    const invalid = (errors) => ({ ...out, status: "invalid", answers: given, answers_by_n: numbered(), refusals: errors.map(refusalOf) });
    if (given.findings !== undefined && !object(given.findings)) return invalid([{ code: "invalid_decisions" }]);
    if (Object.values(given.findings ?? {}).some((f) => !object(f))) return invalid([{ code: "invalid_decisions" }]);
    /** @type {Array<{ code: string, [key: string]: unknown }>} */
    const fixErrors = [];
    for (const [id, value] of Object.entries(given.findings ?? {})) {
      if (value.answer !== "fix") {
        for (const field of /** @type {const} */ (["fix", "target"])) if (value[field] !== undefined) fixErrors.push({ code: "field_not_allowed", field });
        continue;
      }
      if (!current.item.facts.some((f) => f.id === id)) fixErrors.push({ code: "unknown_item", item: id });
      if (typeof value.fix !== "string") fixErrors.push({ code: "bad_value", field: "fix" });
      if (value.target !== undefined && value.target !== "case" && !current.item.texts.rules.some((r) => r.key === value.target)) fixErrors.push({ code: "bad_value", field: "target" });
    }
    if (fixErrors.length) return invalid(fixErrors);
    const answers = Object.fromEntries(Object.entries(given.findings ?? {}).filter(([, v]) => v.answer !== "fix" || /** @type {string} */ (v.fix).trim()));
    if (given.findings !== undefined) given.findings = answers;
    /** @type {Array<{ n: number, fix?: string, target?: string }>} */
    const fixes = [];
    const decisions = { findings: Object.entries(answers).map(([id, { fix, target, ...value }]) => {
      const n = current.item.facts.find((f) => f.id === id)?.n ?? 0;
      if (value.answer === "fix") fixes.push({ n, fix, ...(target !== undefined && { target }) });
      return { n, ...value };
    }), ...(given.review !== undefined && { review: given.review }) };
    const errors = decisionsOf(JSON.stringify(decisions), { findings: /** @type {Array<{ id: string }>} */ (current.item.facts), reject: c.choices.review.choices.includes("reject"), retire: c.choices.review.choices.includes("retire") }).errors.filter((e) => e.code !== "unaddressed");
    for (const value of Object.values(given.findings ?? {})) if (!c.choices.findings.choices.includes(value.answer) && !errors.some((e) => e.code === "bad_answer")) errors.push({ code: "bad_answer" });
    if (given.review !== undefined && !c.choices.review.choices.includes(given.review) && !errors.length) errors.push({ code: "bad_review" });
    if (errors.length) return invalid(errors);
    const answered = Object.keys(given.findings ?? {});
    if (!answered.length && given.review === undefined) return { ...out, status: "open" };
    const missing = { findings: given.review === "reject" || given.review === "retire" ? [] : c.finding_ids.filter((id) => !answered.includes(id)), review: given.review === undefined };
    if (missing.findings.length || missing.review) {
      const missingN = missing.findings.map((id) => /** @type {CaseFinding} */ (current.item.facts.find((f) => f.id === id)).n);
      return { ...out, status: "partial", answers: given, answers_by_n: { findings: [], ...numbered() }, missing, missing_n: missingN };
    }
    return { ...out, status: "ready", decisions, ...(fixes.length && { fixes }) };
  });
  // Re-reading the same Reply (the per-case freshness check) records it once.
  const answered = input.items.filter((c) => Object.values(c.findings ?? {}).some((v) => v?.answer !== "fix" || typeof v.fix !== "string" || v.fix.trim()) || c.review !== undefined).map((c) => c.key);
  if (!record.replies.some((r) => r.page === input.page && isDeepStrictEqual([...r.answered].sort(), [...answered].sort()))) {
    record.replies.push({ page: input.page, answered });
    writeFileSync(runFile, `${JSON.stringify(record, null, 2)}\n`);
  }
  return { exit: 0, json: { ok: true, items, ...(input.comment !== undefined && { comment: input.comment }) } };
}
