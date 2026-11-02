// @ts-check
// The full Bug Card: field answers, screenshots, discards and the apply grammar.
import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { validateEdits } from "./decisions.mjs";
import { edit } from "./knowledge-file.mjs";
import { readTrackerReference } from "./keys.mjs";
import { object } from "./refusal.mjs";
import { digests } from "./pin-digest.mjs";
/** @import { PublishContext, PublishCardItem, PublisherResult, PublishSkippedItem } from "./publish.mjs" */
/** @import { CardRefusal, CardWrite } from "./card-run.mjs" */
/** @import { LoadedBug } from "./bug.mjs" */
/** @import { TrackerLinkedIssue } from "./sync-tracker.mjs" */

/**
 * One create field fetched from paged createmeta, and its resolved write value.
 * @typedef {{ id: string, name: string, schema: Record<string, unknown>, value: unknown }} BugField
 */
/**
 * One field on the bug create screen, as the Card needs it.
 * @typedef {{ id: string, name: string, schema: Record<string, unknown>, allowed_values?: unknown[] }} BugFieldSpec
 */
/**
 * Tracker metadata for the bug create screen, attachment support and available link types.
 * @typedef {{ means?: string, issue_types: Array<{ id: string, name: string, fields: Array<{ id: string, name: string, required?: boolean, schema: Record<string, unknown>, allowedValues?: unknown[], hasDefaultValue?: boolean }> }>, attachment: { enabled: boolean, uploadLimit: number }, issue_link_types: Array<{ id: string, name: string, inward: string, outward: string }> }} BugMetadata
 */
/** @typedef {{ type: string, direction: "outward" | "inward", case: string | {after: number} }} BugLink */
/** @typedef {{ path: string, name: string, bytes: number }} BugAttachment */
/** @typedef {{ path: string, name: string, reason: string }} DroppedAttachment */
/** @typedef {{ key: string, issue_type?: string | null, status?: string | null, status_category?: string | null, summary?: string | null, mark?: string | null, not_found?: boolean }} TrackerBugItem */
/** @typedef {{ key: string, issue_type?: string | null, status?: string | null, status_category?: string | null, summary?: string | null, links: Array<{ link_type: string, direction: "outward" | "inward" }>, open: boolean, local?: boolean, unlinked?: boolean, missing?: boolean }} BugHit */
/** @typedef {{ run: string, automation: string, keys: string[], text: string }} BugGroup */

/**
 * The tracker payload parsed once, or null.
 * @param {PublishContext} ctx
 * @returns {Record<string, unknown> | null}
 */
function payloadOf(ctx) {
  try {
    const payload = JSON.parse(/** @type {string} */ (ctx.payload));
    return object(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * @param {PublishContext} ctx
 * @returns {BugMetadata | null}
 */
export function bugMetadata(ctx) {
  const payload = payloadOf(ctx);
  return object(payload?.bug_metadata) ? /** @type {BugMetadata} */ (payload?.bug_metadata) : null;
}

/**
 * Every Bug the mark search found by a draft's `bg_` Key.
 * @param {PublishContext} ctx
 * @returns {TrackerBugItem[]}
 */
function markedBugs(ctx) {
  return /** @type {TrackerBugItem[]} */ (Array.isArray(payloadOf(ctx)?.marked_bugs) ? payloadOf(ctx)?.marked_bugs : []);
}

/**
 * The fetched statuses of local published bugs, by Tracker key.
 * @param {PublishContext} ctx
 * @returns {Map<string, TrackerBugItem>}
 */
function bugStatuses(ctx) {
  const list = Array.isArray(payloadOf(ctx)?.bug_statuses) ? /** @type {TrackerBugItem[]} */ (payloadOf(ctx)?.bug_statuses) : [];
  return new Map(list.filter((bug) => typeof bug?.key === "string").map((bug) => [bug.key, bug]));
}

/**
 * An item is open unless Jira's status category says it is done. An uncategorised status counts as
 * open, so a closed bug is never hidden by a server that reports no category.
 * @param {{ status_category?: string | null, not_found?: boolean }} item
 * @returns {boolean}
 */
const openItem = (item) => item.not_found !== true && String(item.status_category ?? "").toLowerCase() !== "done";

/**
 * The issues linked to a fetched case.
 * @param {PublishContext} ctx
 * @param {string | null | undefined} trackerKey
 * @returns {TrackerLinkedIssue[]}
 */
function linkedIssuesOf(ctx, trackerKey) {
  if (!trackerKey || !ctx.tracker.ok) return [];
  const item = ctx.tracker.cases.get(trackerKey) ?? ctx.tracker.markedCases.get(trackerKey) ?? ctx.tracker.scenarios.get(trackerKey) ?? ctx.tracker.markedScenarios.get(trackerKey);
  const issues = item?.linked_issues;
  return Array.isArray(issues) ? /** @type {TrackerLinkedIssue[]} */ (issues) : [];
}

/**
 * The local published bugs, by Tracker key.
 * @param {PublishContext} ctx
 * @returns {Map<string, import("./bug.mjs").LoadedBug>}
 */
function publishedByTracker(ctx) {
  return new Map((ctx.allBugs ?? ctx.bugs).filter((bug) => bug.file.data.status === "published" && typeof bug.file.data.tracker === "string").map((bug) => [/** @type {string} */ (bug.file.data.tracker), bug]));
}

/**
 * The other bug files for a case: any status, any Run, excluding the bug itself.
 * @param {PublishContext} ctx
 * @param {import("./bug.mjs").LoadedBug} bug
 * @returns {Array<{ key: string, status: string, run: string | null, tracker: string | null }>}
 */
function otherBugs(ctx, bug) {
  const key = String(bug.file.data.key);
  const caseKey = String(bug.file.data.case);
  return (ctx.allBugs ?? ctx.bugs).filter((other) => other.file.data.key !== key && other.file.data.case === caseKey).map((other) => ({
    key: String(other.file.data.key),
    status: String(other.file.data.status ?? "draft"),
    run: typeof other.file.data.run === "string" ? other.file.data.run : null,
    tracker: typeof other.file.data.tracker === "string" ? other.file.data.tracker : null,
  }));
}

/**
 * The bug-type linked issues for a case, plus local published bugs that are not linked to it.
 * A linked issue that is a draft's own mark is its recovery, never a duplicate hit.
 * @param {PublishContext} ctx
 * @param {string} caseKey
 * @param {string | null | undefined} trackerKey
 * @returns {BugHit[]}
 */
function caseHits(ctx, caseKey, trackerKey) {
  const config = ctx.config.bug_publish;
  if (!config) return [];
  const marks = new Set(markedBugs(ctx).map((bug) => bug.key));
  const local = publishedByTracker(ctx);
  const linked = linkedIssuesOf(ctx, trackerKey);
  const linkedKeys = new Set(linked.map((issue) => issue.key));
  /** @type {BugHit[]} */
  const hits = [];
  for (const issue of linked) {
    if (issue.issue_type !== config.issue_type || marks.has(issue.key)) continue;
    hits.push({
      key: issue.key, issue_type: issue.issue_type ?? null, status: issue.status ?? null, status_category: issue.status_category ?? null,
      summary: issue.summary ?? null, links: Array.isArray(issue.links) ? issue.links : [], open: openItem(issue), ...(local.has(issue.key) && { local: true }),
    });
  }
  for (const [key, fetched] of bugStatuses(ctx)) {
    if (linkedKeys.has(key)) continue;
    const bug = local.get(key);
    if (!bug || bug.file.data.case !== caseKey) continue;
    hits.push({
      key, issue_type: fetched.issue_type ?? null, status: fetched.status ?? null, status_category: fetched.status_category ?? null,
      summary: fetched.summary ?? null, links: [], open: openItem(fetched), local: true, unlinked: true, ...(fetched.not_found && { missing: true }),
    });
  }
  return [...new Map(hits.map((hit) => [hit.key, hit])).values()];
}

/**
 * The group a bug shares with another bug of the same Run and Automation, if any. It states the
 * fact only; the engineer judges whether the causes are one.
 * @param {PublishContext} ctx
 * @param {import("./bug.mjs").LoadedBug} bug
 * @returns {BugGroup | null}
 */
function groupOf(ctx, bug) {
  const run = typeof bug.file.data.run === "string" ? bug.file.data.run : null;
  const automations = Array.isArray(bug.file.data.automations) ? /** @type {string[]} */ (bug.file.data.automations) : [];
  if (run === null || automations.length === 0) return null;
  const drafts = [...ctx.bugs, ...(ctx.olderBugs ?? [])].filter((other) => other.file.data.status === "draft" && other.file.data.run === run);
  for (const automation of automations) {
    const keys = drafts.filter((other) => Array.isArray(other.file.data.automations) && other.file.data.automations.includes(automation)).map((other) => String(other.file.data.key));
    if (keys.length < 2) continue;
    return { run, automation, keys, text: `failed together with Automation \`${automation}\` in Run \`${run}\`` };
  }
  return null;
}

/**
 * The mark search's hit for one draft, with `markedHit`'s checks.
 * @param {PublishContext} ctx
 * @param {string} key
 * @returns {{ hit?: TrackerBugItem, refusal?: { reason: string, [key: string]: unknown } }}
 */
function bugMarkHit(ctx, key) {
  const hits = markedBugs(ctx).filter((bug) => bug.mark === key);
  if (hits.length > 1) return { refusal: { reason: "multiple_mark_hits", hits: hits.map((bug) => bug.key) } };
  const hit = hits[0];
  if (!hit) return {};
  const expected = ctx.config.bug_publish?.issue_type;
  if (hit.issue_type !== expected) return { refusal: { reason: "mark_wrong_kind", tracker_key: hit.key, issue_type: hit.issue_type ?? null, expected: expected ?? null } };
  const claim = ctx.index.tracker.resolve(hit.key);
  if (claim.status !== "absent") {
    const current = claim.status === "unique" ? /** @type {{ entry?: { kind: string, key: string } }} */ (claim).entry : undefined;
    return { refusal: { reason: "mark_linked_elsewhere", tracker_key: hit.key, claim: claim.status, ...(current && { current: `${current.kind}:${current.key}` }) } };
  }
  return { hit };
}

/**
 * The decisions `publish apply` reads from the Reply, including the Bug grammar.
 * @typedef {{
 *   input: Record<string, unknown>,
 *   take: number[],
 *   drop: number[],
 *   discard: number[],
 *   edits: Record<string, Record<string, unknown>>,
 *   fields: Record<string, Record<string, unknown>>,
 *   attach: Record<string, string[]>,
 *   confirmed: number[],
 *   confirm: number[],
 *   name: Record<string, string>,
 *   merge: Record<string, string>,
 *   errors: Array<{ code: string, item?: number | string, field?: string, reason?: string, [key: string]: unknown }>,
 * }} PublishDecisions
 */

/**
 * The tracker's upload means: `acli` cannot attach, everything else can.
 * @param {{ via?: unknown } | null | undefined} access
 * @returns {string | null}
 */
function meansOf(access) {
  return typeof access?.via === "string" && (access.via === "acli" || access.via.endsWith(":acli")) ? "acli" : null;
}

/**
 * @param {PublishContext} ctx
 * @returns {Set<string>}
 */
function retiredCases(ctx) {
  const keys = new Set();
  for (const declarations of ctx.index.features.values()) {
    for (const { file } of declarations) {
      for (const token of Array.isArray(file.data.retired) ? file.data.retired : []) {
        if (typeof token === "string") keys.add(readTrackerReference(token) ?? token);
      }
    }
  }
  return keys;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
const scalar = (value) => ["string", "number", "boolean"].includes(typeof value) || object(value);

/**
 * Whether a value fits a create field's schema and allowed values.
 * @param {{ schema?: Record<string, unknown>, allowedValues?: unknown[] }} field
 * @param {unknown} value
 * @returns {boolean}
 */
export function bugValueFits(field, value) {
  const schema = field.schema ?? {};
  const type = schema.type;
  const array = type === "array";
  if (array) {
    if (!Array.isArray(value)) return false;
    const items = schema.items;
    const itemType = typeof items === "string" ? items : object(items) ? items.type : undefined;
    const fitsItem = (/** @type {unknown} */ item) => object(item) ? true
      : itemType === "string" ? typeof item === "string"
        : itemType === "number" ? typeof item === "number" || (typeof item === "string" && item.trim() !== "" && Number.isFinite(Number(item)))
          : scalar(item);
    if (!value.every(fitsItem)) return false;
  } else if (type === "string") {
    if (typeof value !== "string") return false;
  } else if (type === "number") {
    if (!(typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))))) return false;
  } else if (!scalar(value)) return false;
  if (!Array.isArray(field.allowedValues) || field.allowedValues.length === 0) return true;
  return (array ? /** @type {unknown[]} */ (value) : [value]).every((item) => field.allowedValues?.some((allowed) => allowedMatches(allowed, item)));
}

/**
 * @param {unknown} allowed
 * @param {unknown} value
 * @returns {boolean}
 */
function allowedMatches(allowed, value) {
  if (object(allowed)) {
    const candidates = [allowed.id, allowed.value, allowed.name].filter((entry) => entry !== undefined).map(String);
    if (object(value)) return [value.id, value.value, value.name].some((entry) => entry !== undefined && candidates.includes(String(entry)));
    return candidates.includes(String(value));
  }
  return String(allowed) === String(value);
}

/**
 * The allowed values a Card answer may use, normalised to display values.
 * @param {{ allowedValues?: unknown[] }} field
 * @returns {unknown[] | undefined}
 */
function allowedValues(field) {
  if (!Array.isArray(field.allowedValues)) return undefined;
  return field.allowedValues.map((allowed) => object(allowed) ? allowed.value ?? allowed.name ?? allowed.id : allowed);
}

/**
 * Resolve `bug_fields` defaults against createmeta, refusing before the Card.
 * @param {Array<{ field: string, value: unknown }>} entries
 * @param {Array<{ id: string, name: string, schema: Record<string, unknown>, allowedValues?: unknown[] }>} fields
 * @returns {{ values: Map<string, BugField>, refused: CardRefusal[] }}
 */
function defaultFields(entries, fields) {
  /** @type {Map<string, BugField>} */
  const values = new Map();
  for (const entry of entries) {
    const matches = fields.filter((field) => field.id === entry.field || field.name === entry.field);
    if (matches.length === 0) return { values, refused: [{ code: "bug_field_unknown", field: entry.field }] };
    if (matches.length > 1) return { values, refused: [{ code: "bug_field_ambiguous", field: entry.field }] };
    const field = matches[0];
    if (!bugValueFits(field, entry.value)) return { values, refused: [{ code: "bug_field_invalid", field: entry.field }] };
    values.set(field.id, { id: field.id, name: field.name, schema: field.schema, value: entry.value });
  }
  return { values, refused: [] };
}

/**
 * The draft body without its `# <key>: <summary>` line.
 * @param {LoadedBug} bug
 * @returns {string}
 */
function bodyOf(bug) {
  const text = bug.file.text;
  const heading = text.indexOf("# ");
  const start = heading < 0 ? 0 : text.indexOf("\n", heading);
  return (start < 0 ? "" : text.slice(start + 1)).trim();
}

/**
 * Split the body into Description/Steps/Expected/Actual/Evidence and Environment. The Environment
 * section folds into the description when the create screen has no environment field.
 * @param {string} body
 * @param {boolean} hasEnvironment
 * @returns {{ description: string, environment: string }}
 */
function bodyFields(body, hasEnvironment) {
  const at = body.indexOf("**Environment.**");
  if (at < 0) return { description: body, environment: "" };
  const description = body.slice(0, at).trim();
  const environment = body.slice(at + "**Environment.**".length).trim();
  return hasEnvironment ? { description, environment } : { description: `${description}\n\n**Environment.**\n${environment}`.trim(), environment: "" };
}

/**
 * The screenshots offered for a Bug, each dropped one with its reason.
 * @param {PublishContext} ctx
 * @param {string} key
 * @param {BugMetadata} metadata
 * @param {Record<string, unknown> | null} access
 * @returns {{ attachments: BugAttachment[], dropped: DroppedAttachment[] }}
 */
function screenshots(ctx, key, metadata, access) {
  /** @type {BugAttachment[]} */
  const attachments = [];
  /** @type {DroppedAttachment[]} */
  const dropped = [];
  const paths = ctx.execute_run ? /** @type {string[]} */ (ctx.followUps?.screenshots?.[key] ?? []) : [];
  const runDir = ctx.execute_run ?? ctx.dir;
  for (const path of paths) {
    const name = basename(path);
    const abs = resolve(path);
    const rel = relative(runDir, abs);
    const outside = isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`);
    const size = existsSync(abs) ? statSync(abs).size : null;
    const reason = metadata.attachment?.enabled === false ? "attachments disabled"
      : meansOf(access) === "acli" || metadata.means === "acli" ? "acli"
        : !existsSync(abs) ? "missing"
          : outside ? "outside the Run dir"
            : size !== null && metadata.attachment?.uploadLimit !== undefined && size > metadata.attachment.uploadLimit ? "over uploadLimit"
              : null;
    if (reason) dropped.push({ path, name, reason });
    else attachments.push({ path, name, bytes: /** @type {number} */ (size) });
  }
  return { attachments, dropped };
}

/**
 * Build the Bug items for the Card, skipping what cannot be linked and refusing bad metadata.
 * @param {PublishContext} ctx
 * @param {{ cases?: PublishCardItem[], skipped?: PublishSkippedItem[] }} [options]
 * @returns {{ items: PublishCardItem[], skipped: PublishSkippedItem[], refused: CardRefusal[] }}
 */
export function bugCandidates(ctx, { cases = [], skipped = [] } = {}) {
  /** @type {PublishCardItem[]} */
  const items = [];
  /** @type {PublishSkippedItem[]} */
  const skippedBugs = [];
  const drafts = [...ctx.bugs, ...(ctx.olderBugs ?? [])];
  if (!drafts.length) return { items, skipped: skippedBugs, refused: [] };
  const metadata = bugMetadata(ctx);
  const config = ctx.config.bug_publish;
  const marked = new Set(markedBugs(ctx).map((bug) => bug.mark));
  if (!config) {
    for (const bug of drafts) {
      const key = String(bug.file.data.key);
      skippedBugs.push({ key, label: key, reason: "bug_publishing_not_configured", remedy: "/qa-init" });
    }
    return { items, skipped: skippedBugs, refused: [] };
  }
  if (!metadata || !Array.isArray(metadata.issue_types)) return { items, skipped: skippedBugs, refused: [{ code: "bug_type_unknown", field: "bug_type" }] };
  const type = metadata.issue_types.find((candidate) => candidate.name === config?.issue_type);
  if (!type || !Array.isArray(type.fields)) return { items, skipped: skippedBugs, refused: [{ code: "bug_type_unknown", field: "bug_type" }] };
  if (!object(metadata.attachment)) return { items, skipped: skippedBugs, refused: [{ code: "bug_card_incomplete", field: "attachment" }] };
  if (!Array.isArray(metadata.issue_link_types)) return { items, skipped: skippedBugs, refused: [{ code: "bug_link_type_unknown", field: "bug_link_type" }] };
  if (!metadata.issue_link_types.some((link) => link.name === config?.link_type)) return { items, skipped: skippedBugs, refused: [{ code: "bug_link_type_unknown", field: "bug_link_type" }] };
  const defaults = defaultFields(config?.fields ?? [], type.fields);
  if (defaults.refused.length) return { items, skipped: skippedBugs, refused: defaults.refused };
  const retired = retiredCases(ctx);
  const current = digests(/** @type {import("./knowledge-file.mjs").ParsedFile[]} */ (ctx.files));
  const access = /** @type {Record<string, unknown> | null} */ (ctx.access ?? null);
  const caseItems = new Map(cases.filter((item) => ["create_case", "recover_case", "update_case"].includes(item.code)).map((item) => [item.key, item]));
  const caseSkips = new Map(skipped.filter((skip) => typeof skip.key === "string").map((skip) => [skip.key, skip]));
  const screen = type.fields;
  const markerOnScreen = [ctx.mapping.marker_field, "labels"].every((id) => screen.some((field) => field.id === id || field.name === id));
  const seen = new Set();
  for (const bug of drafts) {
    const key = String(bug.file.data.key);
    if (seen.has(key)) continue;
    seen.add(key);
    const older = (ctx.olderBugs ?? []).includes(bug);
    const caseKey = String(bug.file.data.case);
    const label = `${key}: ${bug.file.h1?.text.replace(/^bg_[^:]+:\s*/, "") ?? key}`;
    const declarations = ctx.index.cases.get(caseKey) ?? [];
    if (declarations.length === 0 || retired.has(caseKey)) {
      skippedBugs.push({ key, label, reason: "case_retired", case: caseKey, remedy: "discard or re-draft" });
      continue;
    }
    const caseSkip = caseSkips.get(caseKey);
    if (caseSkip && !ctx.execute_run) {
      skippedBugs.push({ key, label, reason: "case_skipped_on_card", subject: caseKey, remedy: caseSkip.remedy, case_reason: caseSkip.reason });
      continue;
    }
    const trackerKey = ctx.index.tracker.current("case", caseKey);
    const sameCard = trackerKey ? null : caseItems.get(caseKey);
    if (!trackerKey && !sameCard) {
      skippedBugs.push({ key, label, reason: "case_without_tracker_key", case: caseKey, remedy: `/qa-publish ${String(bug.file.data.feature)}` });
      continue;
    }
    if (trackerKey && ctx.tracker.ok) {
      const fetched = ctx.tracker.requests.cases.get(trackerKey);
      if (fetched === undefined || fetched === null) {
        skippedBugs.push({ key, label, reason: "tracker_case_vanished", tracker: trackerKey, remedy: "/qa-sync" });
        continue;
      }
      if (fetched !== trackerKey) {
        skippedBugs.push({ key, label, reason: "tracker_key_moved", tracker: trackerKey, current: fetched, remedy: "/qa-sync" });
        continue;
      }
    }
    const body = bodyOf(bug);
    const summary = bug.file.h1?.text.replace(/^bg_[^:]+:\s*/, "") ?? key;
    const hitsLink = trackerKey ?? (sameCard?.code === "recover_case" ? sameCard.tracker_key : null);
    const hits = caseHits(ctx, caseKey, hitsLink);
    const openHits = hits.filter((hit) => hit.open);
    const others = otherBugs(ctx, bug);
    const group = groupOf(ctx, bug);
    const stale = bug.file.data.case_digest !== current.review(caseKey);
    const shared = {
      key, label, feature: String(bug.file.data.feature), file: bug.rel, route: bug.file.data.route,
      case: caseKey, case_title: declarations[0]?.entry.summary, body,
      stale, redacted: bug.file.data.redacted === true,
      ...(others.length && { other_bugs: others }), ...(group && { group }),
      hits, open_hits: openHits, needs: [], edits: [],
    };
    const mark = bugMarkHit(ctx, key);
    if (mark.refusal) {
      skippedBugs.push({ key, label, ...mark.refusal });
      continue;
    }
    if (mark.hit) {
      items.push({
        ...shared, n: cases.length + items.length + 1, code: "recover_bug", tracker_key: mark.hit.key,
        in_tracker: true, recovered: true, unverified: "link and attachments not verified",
      });
      continue;
    }
    if (older) {
      items.push({ ...shared, n: cases.length + items.length + 1, code: "older_draft", takeable: false, in_tracker: false });
      continue;
    }
    if (!markerOnScreen) {
      skippedBugs.push({ key, label, reason: "marker_not_on_bug_screen", field: ctx.mapping.marker_field });
      continue;
    }
    const hasEnvironment = screen.some((field) => field.id === "environment" || field.name === "environment");
    const { description, environment } = bodyFields(body, hasEnvironment);
    /** @type {Map<string, BugField>} */
    const values = new Map(defaults.values);
    for (const [name, value] of /** @type {Array<[string, string]>} */ ([["summary", summary], ["description", description], ["environment", environment]])) {
      if (name === "environment" && !hasEnvironment) continue;
      const field = screen.find((candidate) => candidate.id === name || candidate.name === name);
      if (!field) return { items, skipped: skippedBugs, refused: [{ code: "bug_card_incomplete", key, field: name }] };
      values.set(field.id, { id: field.id, name: field.name, schema: field.schema, value: name === "environment" && !environment ? null : value });
    }
    /** @type {BugField[]} */
    const fields = [...values.values()];
    /** @type {BugFieldSpec[]} */
    const answerable = screen.filter((field) => ![ctx.mapping.marker_field, "labels", "issuetype", "project", "status"].includes(field.id)).map((field) => ({
      id: field.id, name: field.name, schema: field.schema, ...(allowedValues(field) && { allowed_values: allowedValues(field) }),
    }));
    const owned = new Set([ctx.mapping.marker_field, "labels", "issuetype", "project", "status", "summary", "description", "environment"]);
    const missing = screen.filter((field) => field.required === true && field.hasDefaultValue !== true && !owned.has(field.id) && !values.has(field.id));
    const screenshot = screenshots(ctx, key, metadata, access);
    const link = sameCard ? (sameCard.code === "create_case" ? { after: Number(sameCard.n) } : /** @type {string} */ (sameCard.tracker_key))
      : /** @type {string} */ (trackerKey);
    items.push({
      ...shared, n: cases.length + items.length + 1, code: "create_bug", ...(typeof link === "string" && { tracker_key: link }),
      bug_fields: fields, bug_answer_fields: answerable,
      bug_required: missing.map((field) => ({ id: field.id, name: field.name, ...(allowedValues(field) && { allowed_values: allowedValues(field) }) })),
      issue_type: /** @type {string} */ (config?.issue_type),
      marker: { label: ctx.mapping.marker_label, field: ctx.mapping.marker_field, value: key },
      bug_link: { type: /** @type {string} */ (config?.link_type), direction: /** @type {"outward" | "inward"} */ (config?.direction), case: link },
      attachments: screenshot.attachments, attachments_dropped: screenshot.dropped,
      ...(ctx.execute_run ? {} : { attachments_note: "Screenshots are offered only with `--run`." }),
      needs: missing.map((field) => field.id), edits: answerable.map((field) => field.id),
      in_tracker: marked.has(key),
      ...(sameCard && sameCard.code === "create_case" ? { requires: [Number(sameCard.n)] } : {}),
    });
  }
  return { items, skipped: skippedBugs, refused: [] };
}

/**
 * The answers that apply to one Bug: `"all"` first, then its own number.
 * @param {PublishCardItem} item
 * @param {Record<string, Record<string, unknown>>} answers
 * @returns {Record<string, unknown>}
 */
export function bugAnswers(item, answers) {
  return { ...(answers.all ?? {}), ...(answers[String(item.n)] ?? {}) };
}

/**
 * The create fields a Bug's Publisher write carries, defaults plus the engineer's answers.
 * @param {PublishCardItem} item
 * @param {Record<string, Record<string, unknown>>} answers
 * @returns {BugField[]}
 */
export function bugFieldsFor(item, answers) {
  const fields = [.../** @type {BugField[]} */ (item.bug_fields ?? [])];
  const answerable = /** @type {BugFieldSpec[]} */ (item.bug_answer_fields ?? []);
  for (const [name, value] of Object.entries(bugAnswers(item, answers))) {
    const spec = answerable.find((field) => field.id === name || field.name === name);
    if (!spec) continue;
    const at = fields.findIndex((field) => field.id === spec.id);
    const written = { id: spec.id, name: spec.name, schema: spec.schema, value };
    if (at >= 0) fields[at] = written;
    else fields.push(written);
  }
  return fields;
}

/**
 * The required fields a taken Bug still needs answered.
 * @param {PublishCardItem} item
 * @param {Record<string, Record<string, unknown>>} answers
 * @returns {Array<{ id: string, name: string, allowed_values?: unknown[] }>}
 */
export function bugMissing(item, answers) {
  const answered = new Set(bugFieldsFor(item, answers).map((field) => field.id));
  return /** @type {Array<{ id: string, name: string, allowed_values?: unknown[] }>} */ (item.bug_required ?? []).filter((field) => !answered.has(field.id));
}

/**
 * The screenshots the engineer ticked for one Bug.
 * @param {PublishCardItem} item
 * @param {Record<string, string[]>} attach
 * @returns {BugAttachment[]}
 */
export function bugAttachmentsFor(item, attach) {
  const names = attach[String(item.n)] ?? [];
  return /** @type {BugAttachment[]} */ (item.attachments ?? []).filter((attachment) => names.includes(attachment.name));
}

/**
 * The state that makes a taken Bug need an explicit confirm.
 * @param {PublishCardItem} item
 * @returns {boolean}
 */
export function bugNeedsConfirm(item) {
  return item.code === "create_bug" && (item.stale === true || (/** @type {BugHit[]} */ (item.open_hits ?? []).length > 0));
}

/**
 * Validate the Reply grammar for Publish, before any Card answer is reported.
 * @param {Record<string, unknown>} input
 * @param {PublishCardItem[]} items
 * @returns {PublishDecisions}
 */
export function publishDecisions(input, items) {
  /** @type {PublishDecisions} */
  const base = { input, take: [], drop: [], discard: [], edits: {}, fields: {}, attach: {}, confirmed: [], confirm: [], name: {}, merge: {}, errors: [] };
  if (!object(input) || Object.keys(input).some((key) => !["take", "drop", "edits", "confirm", "confirmed", "discard", "fields", "attach", "name", "merge"].includes(key))) {
    return { ...base, errors: [{ code: "invalid_decisions" }] };
  }
  const numberList = (/** @type {unknown} */ value) => Array.isArray(value) && value.every((n) => Number.isSafeInteger(n));
  if ((input.take !== undefined && input.take !== "all" && !numberList(input.take)) || (input.drop !== undefined && !numberList(input.drop)) ||
    (input.discard !== undefined && !numberList(input.discard)) || (input.confirmed !== undefined && !numberList(input.confirmed)) ||
    (input.fields !== undefined && !object(input.fields)) || (input.attach !== undefined && !object(input.attach)) ||
    (input.edits !== undefined && !object(input.edits)) || (input.confirm !== undefined && !numberList(input.confirm))) {
    return { ...base, errors: [{ code: "invalid_decisions" }] };
  }
  const drop = /** @type {number[]} */ (input.drop ?? []);
  const discard = /** @type {number[]} */ (input.discard ?? []);
  const take = /** @type {number[]} */ (input.take === "all" ? items.filter((item) => item.takeable !== false && !drop.includes(/** @type {number} */ (item.n)) && !discard.includes(/** @type {number} */ (item.n))).map((item) => item.n) : input.take ?? []);
  const confirmed = /** @type {number[]} */ (input.confirmed ?? []);
  const edits = /** @type {Record<string, Record<string, unknown>>} */ (input.edits ?? {});
  const fields = /** @type {Record<string, Record<string, unknown>>} */ (input.fields ?? {});
  const attach = /** @type {Record<string, string[]>} */ (input.attach ?? {});
  const decisions = { ...base, take, drop, discard, edits, fields, attach, confirmed, confirm: /** @type {number[]} */ (input.confirm ?? []), name: /** @type {Record<string, string>} */ (input.name ?? {}), merge: /** @type {Record<string, string>} */ (input.merge ?? {}) };
  const known = new Map(items.map((item) => [item.n, item]));
  const errors = decisions.errors;
  for (const n of [...take, ...drop, ...discard, ...confirmed]) {
    if (!known.has(n)) errors.push({ code: "unknown_item", item: n });
  }
  for (const n of new Set([...take, ...drop, ...discard])) if ([take, drop, discard].filter((list) => list.includes(n)).length > 1) errors.push({ code: "answer_conflict", item: n });
  for (const list of [take, drop, discard, confirmed]) {
    for (const n of new Set(list)) if (list.filter((value) => value === n).length > 1) errors.push({ code: "duplicate_decision", item: n });
  }
  for (const n of discard) {
    const item = known.get(n);
    if (!item) continue;
    if (!["create_bug", "recover_bug", "older_draft"].includes(item.code)) errors.push({ code: "edit_field", item: n, field: "discard" });
    if (item.in_tracker === true) errors.push({ code: "draft_in_tracker", item: n, key: item.key });
  }
  for (const n of take) {
    const item = known.get(n);
    if (item?.code === "older_draft") errors.push({ code: "edit_field", item: n, field: "take" });
  }
  const blocked = new Set([...drop, ...discard]);
  for (const [key, answer] of Object.entries(fields)) {
    if (key === "all") {
      for (const item of items.filter((candidate) => take.includes(/** @type {number} */ (candidate.n)) && !blocked.has(/** @type {number} */ (candidate.n)))) {
        if (item.code !== "create_bug") continue;
        checkAnswer(item, answer, errors);
      }
      continue;
    }
    const n = Number(key);
    const item = known.get(n);
    if (!/^[1-9]\d*$/.test(key) || !item) { errors.push({ code: "unknown_item", item: key }); continue; }
    if (blocked.has(n)) { errors.push({ code: "edit_dropped", item: n }); continue; }
    if (item.code !== "create_bug") { errors.push({ code: "edit_field", item: n, field: "fields" }); continue; }
    checkAnswer(item, answer, errors);
  }
  for (const [key, names] of Object.entries(attach)) {
    const n = Number(key);
    const item = known.get(n);
    if (!/^[1-9]\d*$/.test(key) || !item) { errors.push({ code: "unknown_item", item: key }); continue; }
    if (blocked.has(n)) { errors.push({ code: "edit_dropped", item: n }); continue; }
    if (item.code !== "create_bug") { errors.push({ code: "edit_field", item: n, field: "attach" }); continue; }
    if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) { errors.push({ code: "bad_value", item: n, field: "attach" }); continue; }
    const offered = /** @type {BugAttachment[]} */ (item.attachments ?? []).map((attachment) => attachment.name);
    if (!names.every((name) => offered.includes(name))) errors.push({ code: "bug_field_invalid", item: n, field: "attachment", allowed_values: offered });
  }
  if (input.take === "all" && !errors.length) {
    /** @type {Map<string, number[]>} */
    const byCase = new Map();
    for (const item of items.filter((candidate) => ["create_bug", "recover_bug"].includes(candidate.code) && take.includes(/** @type {number} */ (candidate.n)))) {
      const key = String(item.case);
      byCase.set(key, [...(byCase.get(key) ?? []), /** @type {number} */ (item.n)]);
    }
    for (const [key, numbers] of byCase) if (numbers.length > 1) errors.push({ code: "ambiguous_case_drafts", case: key, items: numbers });
  }
  // The legacy `edits` grammar still answers label questions.
  errors.push(...validateEdits(items, take, drop, edits, { confirm: [], badValue: (/** @type {PublishCardItem} */ item, /** @type {string} */ field, /** @type {unknown} */ value) =>
    !(["bind", "roles"].includes(field) ? Array.isArray(value) && value.every((key) => typeof key === "string") : field === "keep" ? Number.isSafeInteger(value) : typeof value === "string") }));
  return decisions;
}

/**
 * @param {PublishCardItem} item
 * @param {Record<string, unknown>} answer
 * @param {Array<{ code: string, item?: number | string, field?: string, reason?: string, [key: string]: unknown }>} errors
 * @returns {void}
 */
function checkAnswer(item, answer, errors) {
  if (!object(answer)) { errors.push({ code: "bad_value", item: /** @type {number} */ (item.n), field: "fields" }); return; }
  const answerable = /** @type {BugFieldSpec[]} */ (item.bug_answer_fields ?? []);
  for (const [name, value] of Object.entries(answer)) {
    const spec = answerable.find((field) => field.id === name || field.name === name);
    if (!spec) { errors.push({ code: "edit_field", item: /** @type {number} */ (item.n), field: name }); continue; }
    if (!bugValueFits({ schema: spec.schema, allowedValues: spec.allowed_values }, value)) errors.push({ code: "bug_field_invalid", item: /** @type {number} */ (item.n), field: name, allowed_values: spec.allowed_values });
  }
}

/**
 * Whole bug files, including untracked drafts, are the unit the engineer accepted on the Card.
 * @param {PublishContext} ctx
 * @param {PublishCardItem[]} items
 * @param {PublisherResult[]} results
 * @param {string | null} at
 * @returns {CardWrite[]}
 */
export function publishedBugs(ctx, items, results, at) {
  return items.filter((item) => item.code === "create_bug" || item.code === "recover_bug").map((item) => {
    const bug = /** @type {LoadedBug} */ (ctx.bugs.find((bug) => bug.rel === item.file) ?? (ctx.olderBugs ?? []).find((bug) => bug.rel === item.file));
    const result = /** @type {PublisherResult | undefined} */ (results.find((result) => result.n === item.n));
    const tracker = item.code === "recover_bug" ? item.tracker_key : result?.tracker_key;
    const updated = edit(bug.file, [{ set: { status: "published", tracker, published_at: at } }]);
    return { path: ctx.repoPath(bug.rel), text: updated.text };
  });
}

/**
 * The tracker may have created a bug even when linking failed: retain that identity.
 * @param {PublisherResult} result
 * @param {PublishCardItem} item
 * @param {BugAttachment[]} [expected]
 * @param {string | null} [caseKey]
 * @returns {boolean}
 */
export function bugResultMatches(result, item, expected = /** @type {BugAttachment[]} */ (item.attachments ?? []), caseKey = typeof item.bug_link?.case === "string" ? item.bug_link.case : null) {
  return Array.isArray(result.linked) && result.linked.every((key) => key === caseKey) && new Set(result.linked).size === result.linked.length &&
    Array.isArray(result.attached) && result.attached.every((name) => expected.some((file) => file.name === name)) && new Set(result.attached).size === result.attached.length;
}
