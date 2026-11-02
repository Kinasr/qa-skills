// @ts-check
// The words for a stack no adapter reads (lib/stack.mjs `wordsOf`): what `/qa-init` says of a
// stack it cannot read yet, and what a text says where no adapter is at hand. Each is the general
// word an adapter's own `words` replaces.

/**
 * Vocabulary describing test code concepts when no adapter is available or as a fallback.
 * @typedef {{
 *   source: string,
 *   testSuite: string,
 *   carrier: string,
 *   carriers: string,
 *   aCarrier: string,
 *   keyCarrier: string,
 *   keyCarrierTitle: string,
 * }} AdapterWords
 */

/** @type {AdapterWords} */
export const NO_ADAPTER_WORDS = {
  source: "test source",
  testSuite: "test suite",
  carrier: "annotation",
  carriers: "annotations",
  aCarrier: "an annotation",
  keyCarrier: "key annotation",
  keyCarrierTitle: "Automation-key annotation",
};
