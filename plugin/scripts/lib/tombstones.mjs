// @ts-check
// What a Feature's `retired:` must record when a Test Case leaves `.qa/` for good (ADR-0027): its
// Key, bare, and each former Tracker key it held, typed as a Reference (`tracker:DEMO-31`). A
// Retired key is never reused and never resolves, so both go on record before anything new is
// minted. `Reject` and `--regenerate` share this.
import { trackerReference } from "./keys.mjs";

// The tombstones for the case `key` whose block holds `data`, in the order they are recorded.
/**
 * @param {string} key
 * @param {Record<string, unknown> | null | undefined} [data]
 * @returns {string[]}
 */
export function tombstonesOf(key, data) {
  const formerly = Array.isArray(data?.tracker_formerly) ? data.tracker_formerly.filter((k) => typeof k === "string") : [];
  return [key, ...formerly.map(trackerReference)];
}

// A Feature's `retired:` list with `added` appended, in order and without repeating an entry.
/**
 * @param {unknown} existing
 * @param {readonly string[]} added
 * @returns {string[]}
 */
export function retiredWith(existing, added) {
  const kept = Array.isArray(existing) ? /** @type {readonly unknown[]} */ (existing) : [];
  return /** @type {string[]} */ ([...new Set([...kept, ...added])]);
}
