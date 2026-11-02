// @ts-check
// Who mints Automation keys, the one choice the first-run card shows for the settings the interview
// settles together: the one vocabulary `init.mjs` builds the card's item from and an answer `minting`
// is read against.
//
// Each option `k` names the settings it writes. The first names the option: the option is settled
// in the interview when the proposal gives that setting; the rest go with it (the recipe's class
// annotation carrying the Key prefix). Option 1, the framework's `aut_` keys, writes none, so it is
// always settled: it is the default.

/**
 * An Automation key minting option.
 * @typedef {{
 *   k: number,
 *   label: string,
 *   fields: readonly string[],
 * }} MintingOption
 */

/** @type {readonly MintingOption[]} */
export const MINTING = [
  { k: 1, label: "the framework mints `aut_` keys", fields: [] },
  { k: 2, label: "the project's own tool mints them, each matching the pattern given", fields: ["automation_key_pattern"] },
  { k: 3, label: "the framework mints them in the project's own shape, from the recipe given", fields: ["automation_key_mint", "annotation_map.automation_key_prefix"] },
];

// Every setting some option writes, in the options' order.
/** @type {readonly string[]} */
export const MINTING_FIELDS = MINTING.flatMap((o) => o.fields);

// The options settled by the settings `given` (a setting's name → its row): each option whose
// naming setting is given, the default always.
/**
 * @param {Record<string, unknown>} given
 * @returns {number[]}
 */
export const settledOptions = (given) => MINTING.filter((o) => o.fields.length === 0 || Object.hasOwn(given, o.fields[0])).map((o) => o.k);

// The option a proposal gives: the last settled one (a proposal settles at most one besides the
// default; both is a check the project file refuses).
/**
 * @param {Record<string, unknown>} given
 * @returns {number | undefined}
 */
export const givenOption = (given) => settledOptions(given).at(-1);
