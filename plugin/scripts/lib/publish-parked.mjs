// @ts-check
// Publish's Parked-questions comments (ADR-0026): one comment per tracker Reference of a
// Feature whose issue type is in `tracker.issue_types`, found again by its marker line and edited
// in place. Each one is a Card item (`code: "post_comment"`) and a fully specified Publisher write.
// Nothing here reads or writes `.qa/`, so a comment-only publish makes no commit.
import { object } from "./refusal.mjs";
import { parkedQuestions } from "./parked-questions.mjs";

/**
 * @typedef {{
 *   n: number,
 *   code: "post_comment",
 *   action: "create" | "edit",
 *   key: string,
 *   label: string,
 *   feature: string,
 *   story: string,
 *   issue_type: string,
 *   marker: string,
 *   body: string,
 *   comment_id: string | null,
 *   previous: string | null,
 *   questions: number,
 * }} ParkedCommentItem
 */

/**
 * @typedef {{
 *   key: string,
 *   label: string,
 *   feature: string,
 *   reason: string,
 *   issue_type?: string | null,
 * }} ParkedSkippedReference
 */

/**
 * @typedef {{
 *   action: "create_comment" | "edit_comment",
 *   n: number,
 *   key: string,
 *   comment_id: string | null,
 *   body: string,
 * }} PublisherCommentWrite
 */

/**
 * @typedef {{
 *   id?: string,
 *   body?: string,
 * }} StoryComment
 */

/**
 * @typedef {{
 *   key?: string,
 *   issue_type?: string,
 *   comments: readonly StoryComment[],
 * }} TrackerStory
 */

/**
 * @typedef {{
 *   text: string,
 *   sections: readonly { level: number, title: string, line: number, end: number }[],
 *   data: {
 *     sources?: unknown,
 *     [key: string]: unknown,
 *   },
 *   [key: string]: unknown,
 * }} FeatureFile
 */

/**
 * @typedef {{
 *   index: {
 *     features: ReadonlyMap<string, readonly { file: FeatureFile }[]>,
 *     [key: string]: unknown,
 *   },
 *   feature?: string,
 *   config: {
 *     trackerPattern: RegExp,
 *     [key: string]: unknown,
 *   },
 *   mapping: {
 *     issue_types?: readonly string[],
 *     [key: string]: unknown,
 *   },
 *   tracker: {
 *     stories?: {
 *       get(key: string): TrackerStory | undefined,
 *     },
 *     [key: string]: unknown,
 *   },
 *   [key: string]: unknown,
 * }} PublishContext
 */

// The fixed marker line that finds the Feature's comment again on a story, one per Feature.
/**
 * @param {string} feature
 * @returns {string}
 */
export const parkedMarker = (feature) => `[qa-skills] Parked questions: ${feature}`;

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
const byKey = (a, b) => a.localeCompare(b, "en", { numeric: true });
/**
 * @param {unknown} text
 * @returns {string}
 */
const normal = (text) => String(text ?? "").replace(/\r\n/g, "\n").trim();
/**
 * @param {unknown} text
 * @returns {string}
 */
const firstLine = (text) => normal(text).split("\n")[0].trim();

// The comment's body: the marker line, then the questions numbered, or the none-remain sentence.
/**
 * @param {string} marker
 * @param {readonly string[]} questions
 * @returns {string}
 */
export function parkedBody(marker, questions) {
  return questions.length
    ? `${marker}\n\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
    : `${marker}\n\nNo Parked questions remain.`;
}

// The Features in scope, as [slug, file] pairs, the same scope `publish scope` uses.
/**
 * @param {PublishContext} ctx
 * @returns {Array<{ slug: string, file: FeatureFile }>}
 */
function featuresOf(ctx) {
  return [...ctx.index.features].filter(([slug]) => !ctx.feature || slug === ctx.feature).map(([slug, decls]) => ({ slug, file: decls[0].file }));
}

// The tracker keys a Feature's `sources` name, in the order given.
/**
 * @param {unknown} sources
 * @param {RegExp} pattern
 * @returns {string[]}
 */
function trackerRefs(sources, pattern) {
  const keys = (Array.isArray(sources) ? sources : []).filter((s) => typeof s === "string" && s.startsWith("tracker:")).map((s) => s.slice(8)).filter((k) => pattern.test(k));
  return [...new Set(keys)];
}

// Every tracker Reference of the Features in scope: what `publish scope` names for the scout to fetch.
/**
 * @param {PublishContext} ctx
 * @returns {string[]}
 */
export function parkedStories(ctx) {
  return [...new Set(featuresOf(ctx).flatMap(({ file }) => trackerRefs(file.data.sources, ctx.config.trackerPattern)))].sort(byKey);
}

// The comment items, numbered from `start`, and the skipped References that would have had one.
// `ctx.tracker.stories` holds the payload's stories, each `{key, issue_type, comments: [{id, body}]}`.
/**
 * @param {PublishContext} ctx
 * @param {number} start
 * @returns {{ items: ParkedCommentItem[], skipped: ParkedSkippedReference[] }}
 */
export function parkedCandidates(ctx, start) {
  /** @type {ParkedCommentItem[]} */
  const items = [];
  /** @type {ParkedSkippedReference[]} */
  const skipped = [];
  const configured = Array.isArray(ctx.mapping.issue_types) ? ctx.mapping.issue_types : [];
  for (const { slug, file } of featuresOf(ctx)) {
    const questions = parkedQuestions(file).map((q) => q.text);
    const marker = parkedMarker(slug);
    for (const story of trackerRefs(file.data.sources, ctx.config.trackerPattern)) {
      const label = `Parked questions on ${story}`;
      const held = ctx.tracker.stories?.get(story);
      if (!held) {
        if (questions.length) skipped.push({ key: story, label, feature: slug, reason: "story_not_held" });
        continue;
      }
      const existing = held.comments.find((c) => firstLine(c.body) === marker) ?? null;
      if (!questions.length && !existing) continue;
      const body = parkedBody(marker, questions);
      if (existing && normal(existing.body) === normal(body)) continue;
      if (!configured.includes(/** @type {string} */ (held.issue_type))) {
        skipped.push({ key: story, label, feature: slug, reason: "issue_type_not_configured", issue_type: held.issue_type ?? null });
        continue;
      }
      items.push({ n: start + items.length + 1, code: "post_comment", action: existing ? "edit" : "create", key: `parked:${slug}:${story}`, label,
        feature: slug, story, issue_type: /** @type {string} */ (held.issue_type), marker, body, comment_id: existing?.id ?? null, previous: existing?.body ?? null, questions: questions.length });
    }
  }
  return { items, skipped };
}

// The Publisher's writes for the accepted comment items, in Card order.
/**
 * @param {readonly ParkedCommentItem[]} items
 * @returns {PublisherCommentWrite[]}
 */
export const parkedWrites = (items) => items.map((i) => ({ action: /** @type {"create_comment" | "edit_comment"} */ (i.action === "create" ? "create_comment" : "edit_comment"), n: i.n, key: i.story, comment_id: i.comment_id, body: i.body }));

// Whether a Publisher result answers comment item `item`: the id of the comment it posted, which for
// an edit is the comment it was given.
/**
 * @param {unknown} result
 * @param {ParkedCommentItem} item
 * @returns {boolean}
 */
export const parkedMatches = (result, item) => object(result) && (/** @type {Record<string, unknown>} */ (result)).error === undefined && (/** @type {Record<string, unknown>} */ (result)).kind === "comment" && (/** @type {Record<string, unknown>} */ (result)).n === item.n && (/** @type {Record<string, unknown>} */ (result)).key === item.story
  && typeof (/** @type {Record<string, unknown>} */ (result)).comment_id === "string" && (/** @type {Record<string, unknown>} */ (result)).comment_id !== "" && (item.comment_id === null || (/** @type {Record<string, unknown>} */ (result)).comment_id === item.comment_id);
