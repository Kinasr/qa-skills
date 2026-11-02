// @ts-check
// Key kinds and their patterns (ADR-0004).
import { isMap } from "./dialect.mjs";

// Lowercase Crockford base32: no i, l, o or u.
/** @type {string} */
export const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * @typedef {{
 *   prefix: string,
 *   length: number,
 * }} MintedKind
 */

/** @type {{ tc: MintedKind, ts: MintedKind, su: MintedKind, aut: MintedKind, rule: MintedKind, boundary: MintedKind, bg: MintedKind }} */
export const MINTED = {
  tc: { prefix: "tc_", length: 8 },
  ts: { prefix: "ts_", length: 8 },
  su: { prefix: "su_", length: 8 },
  aut: { prefix: "aut_", length: 6 },
  rule: { prefix: "rule_", length: 4 },
  boundary: { prefix: "boundary_", length: 4 },
  bg: { prefix: "bg_", length: 8 },
};

/**
 * @param {MintedKind} options
 * @returns {RegExp}
 */
const minted = ({ prefix, length }) => new RegExp(`^${prefix}[${ALPHABET}]{${length}}$`);

/**
 * Patterns for key types and slugs.
 * @type {{
 *   provisional: RegExp,
 *   case: RegExp,
 *   scenario: RegExp,
 *   suite: RegExp,
 *   aut: RegExp,
 *   rule: RegExp,
 *   boundary: RegExp,
 *   bug: RegExp,
 *   slug: RegExp,
 *   cnv: RegExp,
 *   prc: RegExp,
 *   acc: RegExp,
 *   rcp: RegExp,
 *   act: RegExp,
 *   upl: RegExp,
 * }}
 */
export const PATTERN = {
  provisional: minted({ prefix: "new_", length: 8 }),
  case: minted(MINTED.tc),
  scenario: minted(MINTED.ts),
  suite: minted(MINTED.su),
  aut: minted(MINTED.aut),
  rule: minted(MINTED.rule),
  boundary: minted(MINTED.boundary),
  bug: minted(MINTED.bg),
  slug: /^[a-z0-9]+(-[a-z0-9]+)*$/,
  cnv: /^cnv_[a-z0-9]+(-[a-z0-9]+)*$/,
  prc: /^prc_[a-z0-9]+(-[a-z0-9]+)*$/,
  acc: /^acc_[a-z0-9]+(-[a-z0-9]+)*$/,
  rcp: /^rcp_[a-z0-9]+(-[a-z0-9]+)*$/,
  act: /^act_[a-z0-9]+(-[a-z0-9]+)*$/,
  upl: /^upl_[a-z0-9]+(-[a-z0-9]+)*$/,
};

/**
 * @param {unknown} v
 * @returns {boolean}
 */
export const isFixtureName = (v) => typeof v === "string" && /^[A-Za-z0-9_.-]+$/.test(v) && v !== "." && v !== "..";

// A legacy Provisional tombstone reserves both permanent kinds: its kind is unknown.
/**
 * @param {unknown} key
 * @returns {string[]}
 */
export const provisionalKeys = (key) => typeof key === "string" && PATTERN.provisional.test(key)
  ? [`tc_${key.slice(4)}`, `ts_${key.slice(4)}`] : [];

// Legacy readers must not mistake a malformed minted Key for a permissive tracker key.
/**
 * @param {unknown} key
 * @param {readonly ("tc" | "ts" | "su" | "aut" | "rule" | "boundary" | "bg")[]} [kinds]
 * @returns {boolean}
 */
export const hasMintedPrefix = (key, kinds = ["tc", "ts", "su"]) => typeof key === "string" &&
  kinds.some((kind) => key.startsWith(MINTED[kind].prefix));

const TRACKER_PREFIX = "tracker:";
// Tracker References spell tombstones and sources alike; an empty key names unscoped Access.
/**
 * @param {string} key
 * @returns {string}
 */
export const trackerReference = (key) => TRACKER_PREFIX + key;
// Null means this is not a Tracker Reference; validation of the key belongs to its role.
/**
 * @param {unknown} value
 * @returns {string | null}
 */
export const readTrackerReference = (value) => typeof value === "string" && value.startsWith(TRACKER_PREFIX)
  ? value.slice(TRACKER_PREFIX.length) : null;

// The Rule keys a text names, in order: each a whole token (evidence names the Rules a finding rests
// on this way).
const RULE_KEY_TOKEN = new RegExp(`(?<![0-9A-Za-z_-])${MINTED.rule.prefix}[${ALPHABET}]{${MINTED.rule.length}}(?![0-9A-Za-z_-])`, "g");
/**
 * @param {string} text
 * @returns {string[]}
 */
export const ruleKeysIn = (text) => text.match(RULE_KEY_TOKEN) ?? [];

// The Tiers of `project.md`'s `tiers` map, each naming a model label (ADR-0021).
/** @type {readonly ["deep", "standard", "light"]} */
export const TIERS = ["deep", "standard", "light"];

// A model label: any non-empty string with no whitespace, passed to the subagent unchanged. The
// harness, not the CLI, judges whether it names a model (ADR-0020).
/**
 * @param {unknown} v
 * @returns {boolean}
 */
export const isModelLabel = (v) => typeof v === "string" && v !== "" && !/\s/.test(v);

// A bare hostname, as `scout.allowed_hosts` lists one: dot-separated labels of letters, digits
// and inner hyphens, so no scheme, port, path or `*`.
/**
 * @param {unknown} v
 * @returns {boolean}
 */
export const isHostname = (v) => typeof v === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(v);

// The Fallback: the session's own model, which every project has and an unpicked Tier runs on
// (ADR-0021).
/** @type {string} */
export const FALLBACK = "inherit";

// Legacy Case and Scenario Keys (the tracker's pattern, or `new_…`): the migration reads them,
// and validation accepts them below the minted schema. At that schema the tracker resolver also
// preserves tracker-shaped links. New live declarations use the kind-specific validators below.
// `trackerPattern` is a RegExp or null.
/**
 * @param {unknown} key
 * @param {RegExp | null | undefined} [trackerPattern]
 * @returns {boolean}
 */
export function isCaseKey(key, trackerPattern) {
  if (typeof key !== "string") return false;
  return PATTERN.provisional.test(key) || Boolean(trackerPattern && trackerPattern.test(key));
}

// ADR-0027: permanent live Keys have a different pattern for each kind.
/**
 * @param {unknown} key
 * @returns {boolean}
 */
export const isLiveCaseKey = (key) => typeof key === "string" && PATTERN.case.test(key);

/**
 * @param {unknown} key
 * @returns {boolean}
 */
export const isScenarioKey = (key) => typeof key === "string" && PATTERN.scenario.test(key);

// Tracker bindings and aliases are strings in the configured tracker namespace only.
/**
 * @param {unknown} key
 * @param {RegExp | null | undefined} [trackerPattern]
 * @returns {boolean}
 */
export const isTrackerKey = (key, trackerPattern) => typeof key === "string" && Boolean(trackerPattern?.test(key));

// Migration history keeps legacy Keys; its legality does not depend on the schema version.
/**
 * @param {unknown} key
 * @param {RegExp | null | undefined} [trackerPattern]
 * @returns {boolean}
 */
export const isFormerKey = (key, trackerPattern) => isCaseKey(key, trackerPattern);

// Typed Feature tombstones: framework Keys bare, Tracker keys as References. Retired legacy
// Provisional keys remain legal because their kind cannot be recovered.
/**
 * @param {unknown} key
 * @param {RegExp | null | undefined} [trackerPattern]
 * @returns {boolean}
 */
export function isRetiredKey(key, trackerPattern) {
  if (typeof key !== "string") return false;
  return isLiveCaseKey(key) || isScenarioKey(key) || PATTERN.suite.test(key) || PATTERN.rule.test(key) ||
    PATTERN.boundary.test(key) || PATTERN.provisional.test(key) || isTrackerKey(readTrackerReference(key), trackerPattern);
}

// Documented witnesses for arbitrary Automation regexes (ADR-0027, ADR-0028). All four kinds are tested with
// all-zero, mixed digit/letter, all-z, sequential-digit and mixed Crockford suffixes. A pattern
// missing these samples is not proven disjoint; recipes are checked structurally instead.
/** @type {readonly string[]} */
export const KEY_OVERLAP_WITNESSES = [MINTED.tc, MINTED.ts, MINTED.su, MINTED.bg].map((m) => m.prefix).flatMap((prefix) =>
  ["00000000", "0000000a", "zzzzzzzz", "01234567", "7k3qx9ab"].map((suffix) => prefix + suffix));

// The Automation-key test: `project.md`'s `automation_key_pattern` when it is set and compiles
// (a project whose own tool mints its keys, such as `LOAN-6QST`), else the shape its
// `automation_key_mint` recipe implies when that is well formed, else the framework's `aut_`.
/**
 * @param {unknown} source
 * @param {unknown} [mint]
 * @returns {RegExp}
 */
export function automationKeyPattern(source, mint) {
  if (source !== undefined) return compileKeyPattern(source) || PATTERN.aut;
  const { recipe } = mint === undefined ? {} : parseMintRecipe(mint);
  return recipe ? recipePattern(recipe) : PATTERN.aut;
}

// Compiles `tracker.key_pattern` whole-string anchored, or returns null if it does not compile.
/**
 * @param {unknown} source
 * @returns {RegExp | null}
 */
export function compileKeyPattern(source) {
  if (typeof source !== "string" || !source) return null;
  try {
    return new RegExp(`^(?:${source})$`);
  } catch {
    return null;
  }
}

// `project.md`'s `automation_key_mint` (ADR-0013): the recipe the framework mints a project's own
// Automation-key shape from, a Key prefix of A–Z letters, a separator, then Crockford base32.
//   {prefix_length: [min, max], separator: "" | "-" | "_", length, case: upper | lower}
/** @type {readonly string[]} */
export const SEPARATORS = ["", "-", "_"];
const RECIPE_FIELDS = ["prefix_length", "separator", "length", "case"];

/**
 * An Automation-key mint recipe shape.
 * @typedef {{
 *   min: number,
 *   max: number,
 *   separator: string,
 *   length: number,
 *   upper: boolean,
 * }} MintRecipe
 */

/**
 * Result of parseMintRecipe.
 * @typedef {{
 *   recipe: MintRecipe,
 *   error?: never,
 * } | {
 *   recipe?: never,
 *   error: string,
 * }} ParseMintRecipeResult
 */

// `{recipe}` for a well-formed recipe, else `{error}` saying what is wrong with it.
/**
 * @param {unknown} value
 * @returns {ParseMintRecipeResult}
 */
export function parseMintRecipe(value) {
  if (!isMap(value)) return { error: "`automation_key_mint` must be a map of `prefix_length`, `separator`, `length` and `case`" };
  const extra = Object.keys(value).filter((k) => !RECIPE_FIELDS.includes(k));
  if (extra.length) return { error: `\`automation_key_mint\` takes no \`${extra[0]}\`` };
  const missing = RECIPE_FIELDS.filter((k) => value[k] === undefined);
  if (missing.length) return { error: `\`automation_key_mint.${missing[0]}\` is required` };
  const { prefix_length: pl, separator, length } = value;
  /** @param {unknown} n */
  const positive = (n) => Number.isInteger(n) && /** @type {number} */ (n) >= 1;
  if (!Array.isArray(pl) || pl.length !== 2 || !pl.every(positive) || pl[0] > pl[1]) {
    return { error: "`automation_key_mint.prefix_length` must be `[min, max]`, integers with 1 ≤ min ≤ max" };
  }
  if (!SEPARATORS.includes(/** @type {string} */ (separator))) return { error: `\`automation_key_mint.separator\` must be one of ${SEPARATORS.map((s) => JSON.stringify(s)).join(", ")}` };
  if (!positive(length)) return { error: "`automation_key_mint.length` must be an integer ≥ 1" };
  if (value.case !== "upper" && value.case !== "lower") return { error: "`automation_key_mint.case` must be `upper` or `lower`" };
  // The only recipe that can produce tc_/ts_/su_ has two lowercase prefix letters, `_`, and
  // eight random characters. Check the whole prefix range, rather than a suggested prefix.
  if (value.case === "lower" && separator === "_" && length === 8 && pl[0] <= 2 && pl[1] >= 2) {
    return { error: "`automation_key_mint` can produce a `tc_`, `ts_` or `su_` Key; choose a disjoint recipe" };
  }
  return { recipe: { min: /** @type {number} */ (pl[0]), max: /** @type {number} */ (pl[1]), separator: /** @type {string} */ (separator), length: /** @type {number} */ (length), upper: value.case === "upper" } };
}

// The recipe's Key-prefix letters and random alphabet, in its case.
/**
 * @param {MintRecipe} r
 * @returns {{ letters: string, alphabet: string }}
 */
const recipeParts = (r) => ({ letters: r.upper ? "A-Z" : "a-z", alphabet: r.upper ? ALPHABET.toUpperCase() : ALPHABET });

/**
 * @param {MintRecipe} r
 * @returns {string}
 */
const recipeSource = (r) => {
  const { letters, alphabet } = recipeParts(r);
  return `[${letters}]{${r.min},${r.max}}${r.separator}[${alphabet}]{${r.length}}`;
};

// The whole-match Automation-key pattern a recipe implies.
/**
 * @param {MintRecipe} recipe
 * @returns {RegExp}
 */
export function recipePattern(recipe) {
  return new RegExp(`^${recipeSource(recipe)}$`);
}

// Every token of a key shape in a text, for `mint`'s uniqueness sweeps: of a framework kind
// (`MINTED`), or of a recipe's.
/**
 * @param {string} source
 * @returns {RegExp}
 */
const token = (source) => new RegExp(`(?<![0-9A-Za-z_])${source}(?![0-9A-Za-z_])`, "g");

/**
 * @param {MintedKind} options
 * @returns {RegExp}
 */
export const mintedToken = ({ prefix, length }) => token(`${prefix}[${ALPHABET}]{${length}}`);

/**
 * @param {MintRecipe} recipe
 * @returns {RegExp}
 */
export const recipeToken = (recipe) => token(recipeSource(recipe));

// What a Key prefix must be under the recipe, for a message: "3 to 6 uppercase letters".
/**
 * @param {MintRecipe} recipe
 * @returns {string}
 */
export function prefixRule(recipe) {
  return `${recipe.min} to ${recipe.max} ${recipe.upper ? "uppercase" : "lowercase"} letters`;
}

// Whether a Key prefix fits the recipe: its letters, in its case, within `prefix_length`.
/**
 * @param {unknown} prefix
 * @param {MintRecipe} recipe
 * @returns {boolean}
 */
export function prefixFits(prefix, recipe) {
  return typeof prefix === "string" && new RegExp(`^[${recipeParts(recipe).letters}]{${recipe.min},${recipe.max}}$`).test(prefix);
}

// A key of the recipe's shape: `prefix`, the separator, then `random` (lowercase Crockford).
/**
 * @param {MintRecipe} recipe
 * @param {string} prefix
 * @param {string} random
 * @returns {string}
 */
export function recipeKey(recipe, prefix, random) {
  return `${prefix}${recipe.separator}${recipe.upper ? random.toUpperCase() : random}`;
}

// The Key prefix `/qa-sync` proposes for a class: its name less a trailing `Test`, `Tests`
// or `Spec`, letters only, in the recipe's case, its first 4 clamped to `prefix_length`. When
// `taken` (a Set of prefixes other classes use) already holds it, the first letter and then the
// consonants of the whole name are tried instead (`LoginTest` → `LGNT`); a shared prefix is legal, so failing that it is kept. Null when
// the name has too few letters.
/**
 * @param {string} className
 * @param {MintRecipe} recipe
 * @param {ReadonlySet<string>} [taken]
 * @returns {string | null}
 */
export function suggestPrefix(className, recipe, taken = new Set()) {
  /** @param {string} name */
  const letters = (name) => {
    const l = name.replace(/[^A-Za-z]/g, "");
    return recipe.upper ? l.toUpperCase() : l.toLowerCase();
  };
  const stem = letters(className.replace(/(Tests?|Spec)$/, "") || className);
  const size = Math.min(recipe.max, Math.max(recipe.min, 4));
  const first = stem.slice(0, size);
  if (first.length < recipe.min) return null;
  if (!taken.has(first)) return first;
  const whole = letters(className);
  const consonants = whole[0] + whole.slice(1).replace(/[aeiouAEIOU]/g, "");
  const alt = consonants.slice(0, size);
  return alt.length >= recipe.min && !taken.has(alt) ? alt : first;
}
