// @ts-check
// A read-only snapshot outside the repository, replaced at one private path per root.
import { renderCardPage } from "./card-page.mjs";
import { resolveRef } from "./git-tree.mjs";
import { isUncommitted } from "./git.mjs";
import { writeSnapshot } from "./snapshot-writer.mjs";

/** @import {NextLegendEntry, NextPageModel} from "./page.d.mts" */
/** @import {NextProjection} from "./next.mjs" */

/**
 * The Next steps page, written at one private path per repository root: `{path}`, or the error
 * that stopped it.
 * @param {NextProjection} view
 * @param {import("./page.d.mts").InboxSummaries} summaries
 * @param {NextLegendEntry[]} legend
 * @returns {{ path: string } | { error: string }}
 */
export function nextPage(view, summaries, legend) {
  const { root, feature, features, next_steps, start_here } = view;
  const { training, ...global } = view.global;
  /** @type {NextPageModel} */
  const model = { layout: "next", stamp: {
    generated_at: new Date().toISOString(), head: resolveRef(root, "HEAD"), dirty: isUncommitted(root, "."),
    root, refresh: `/qa-next${feature ? ` ${feature}` : ""} --page`,
  }, global: feature ? global : view.global, features, next_steps, start_here, summaries, legend };
  return writeSnapshot({ root, page: "next", html: renderCardPage(model) });
}
