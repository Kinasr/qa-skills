// @ts-check
// Neutral first, section views next, composition entry last. Add each section
// here as ./card-page-view-<section>.mjs with one line; tests pin this order to the entry's native imports.
/** @type {readonly string[]} */
export const PAGE_MODULES = Object.freeze([
  "./card-page-client.mjs",
  "./card-page-view-show-scenarios.mjs",
  "./card-page-view-show-knowledge.mjs",
  "./card-page-view-show-errors.mjs",
  "./card-page-view-show-state.mjs",
  "./card-page-view-show-links.mjs",
  "./card-page-view-show-filters.mjs",
  "./card-page-view-show-overview.mjs",
  "./card-page-view-show.mjs",
  "./card-page-dom.mjs",
]);
