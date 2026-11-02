// @ts-check
// Shared filtering for a Convention's refs; the caller supplies its own resolution boundary.
/**
 * @param {readonly string[]} refs
 * @param {(ref: string) => boolean} resolves
 * @returns {string[]}
 */
export function liveRefs(refs, resolves) {
  return refs.filter(resolves);
}
