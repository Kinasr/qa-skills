// @ts-check
// `mint`: framework keys from a CSPRNG (ADR-0004, ADR-0027). Lowercase Crockford base32;
// `tc_`, `ts_`, `su_` and `bg_` 8 chars, `aut_` 6, `rule_` and `boundary_` 4. Each key is unique against every key
// of its kind already written anywhere in `.qa/` (live, `formerly:` or `retired:`, since a Retired
// key is never reused) and against the rest of its batch. `rule_` and `boundary_` keys are unique within their
// Feature's directory only. `aut_` keys
// are also unique against the code: every `aut_` token under `project.md`'s `module_paths`.
// A Feature's retired `new_X` reserves both `tc_X` and `ts_X`, since its kind is unknown.
//
// With `project.md`'s `automation_key_mint` recipe (ADR-0013), `aut` keys are minted in the
// project's shape instead, under the Key `prefix` the caller names, and are unique against every
// token of that shape in `.qa/` and the code: two prefixes may be the same, the keys never.
/** @import { CommandDefinition } from "./cli.mjs" */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { orThrow, UsageError } from "./cli.mjs";
import { automationKeysInCode } from "./code-index.mjs";
import { parse } from "./knowledge-file.mjs";
import { ALPHABET, MINTED, mintedToken, PATTERN, prefixFits, prefixRule, provisionalKeys, recipeKey, recipeToken } from "./keys.mjs";
import { rootConfig } from "./qa-index.mjs";

const MAX_COLLISIONS = 1000;

/**
 * What a mint takes: how many keys, the `.qa/` directory, and what the kind may take of it.
 * @typedef {object} MintOptions
 * @property {number} [count]
 * @property {string} root
 * @property {string} [feature]
 * @property {string} [prefix]
 * @property {string} [seed]
 * @property {string[]} [reserved]
 */

/**
 * The keys a mint drew: the kind, the keys, the collisions they took, and the Feature or the
 * prefix they were drawn for.
 * @typedef {{
 *   kind?: string,
 *   keys: string[],
 *   collisions?: number,
 *   feature?: string,
 *   prefix?: string,
 *   error?: undefined,
 * }} MintedKeys
 */

/**
 * A mint that drew nothing: what went wrong, and which kind of it.
 * @typedef {{
 *   error: string,
 *   reason: "usage" | "recipe" | "exhausted",
 *   keys?: undefined,
 * }} MintFailure
 */

/**
 * What a mint gives: the keys it drew, or the failure that stopped it (the failure carries an
 * `error`, the success carries the keys).
 * @typedef {MintedKeys | MintFailure} MintOutcome
 */

/**
 * Result of minting keys: either the drawn keys or a failure.
 * @typedef {MintOutcome} MintResult
 */

// `seed`, when set, replaces the CSPRNG with a deterministic stream so a test can force a
// collision. Nothing but a test sets it.
// `reserved` also excludes pending tombstones that a writer has prepared but not yet written.
/**
 * @param {string} kind
 * @param {MintOptions} options
 * @returns {MintOutcome}
 */
export function mint(kind, { count = 1, root, feature, prefix, seed, reserved = [] }) {
  const spec = MINTED[/** @type {keyof typeof MINTED} */ (kind)];
  if (!spec) return { error: `unknown kind \`${kind}\`; mint tc, ts, su, aut, rule, boundary or bg`, reason: "usage" };
  if ((kind === "rule" || kind === "boundary") && !feature) return { error: `mint ${kind} needs --feature <key>: ${kind === "rule" ? "Rule" : "Boundary"} keys are unique per Feature`, reason: "usage" };
  if (feature !== undefined && !PATTERN.slug.test(feature)) return { error: `--feature \`${feature}\` is not a Feature key`, reason: "usage" };
  const project = rootConfig(root);
  // An unusable recipe mints nothing, as `/qa-sync` mints nothing under it
  // (lib/knowledge-file.mjs).
  if (kind === "aut" && project.autMintProblem) return { error: project.autMintProblem, reason: "recipe" };
  const recipe = kind === "aut" ? project.autRecipe : null;
  if (recipe && prefix === undefined) return { error: "mint aut needs --prefix <P>: `project.md` sets `automation_key_mint`, so every key starts with its class's Key prefix", reason: "recipe" };
  if (recipe && !prefixFits(prefix, recipe)) return { error: `--prefix \`${prefix}\` does not fit \`automation_key_mint\`: ${prefixRule(recipe)}`, reason: "recipe" };
  if (!recipe && prefix !== undefined) return { error: "--prefix is for `mint aut` with `project.md`'s `automation_key_mint`, which is not set", reason: "recipe" };

  const scope = kind === "rule" || kind === "boundary" ? join(root, "features", /** @type {string} */ (feature)) : root;
  const token = recipe ? recipeToken(recipe) : mintedToken(spec);
  const reserveProvisional = kind === "tc" || kind === "ts";
  const taken = keysIn(scope, token, reserveProvisional);
  for (const key of reserved) {
    taken.add(key);
    if (reserveProvisional) for (const permanent of provisionalKeys(key)) taken.add(permanent);
  }
  if (kind === "aut") for (const k of automationKeysInCode(dirname(resolve(root)), project.modulePaths, token)) taken.add(k);
  const length = recipe ? recipe.length : spec.length;
  /** @type {(random: string) => string} */
  const shape = recipe ? (random) => recipeKey(recipe, /** @type {string} */ (prefix), random) : (random) => spec.prefix + random;
  /** @type {(size: number) => Buffer} */
  const draw = seed === undefined ? randomBytes : seededBytes(seed);
  /** @type {string[]} */
  const keys = [];
  let collisions = 0;
  while (keys.length < count) {
    const key = shape(drawKey(length, draw));
    if (taken.has(key)) {
      if (++collisions > MAX_COLLISIONS) return { error: `gave up after ${MAX_COLLISIONS} collisions`, reason: "exhausted" };
      continue;
    }
    taken.add(key);
    keys.push(key);
  }
  /** @type {MintedKeys} */
  const out = { kind, keys, collisions };
  if (feature) out.feature = feature;
  if (recipe) out.prefix = prefix;
  return out;
}

// `length` lowercase Crockford characters from `draw` (the CSPRNG by default). 256 is a multiple of
// 32, so `byte & 31` picks each character uniformly. The Run id (lib/run-dir.mjs) is drawn the same
// way.
/**
 * @param {number} length
 * @param {(size: number) => Buffer} [draw]
 * @returns {string}
 */
export function drawKey(length, draw = randomBytes) {
  return [...draw(length)].map((b) => ALPHABET[b & 31]).join("");
}

// Every `token` (a global RegExp) in any markdown file under `dir`. A textual sweep, so a key is
// taken wherever it is written and an unparseable file cannot hide one.
// For a Case or Scenario mint, also reserve the Feature's legacy Provisional tombstones.
/**
 * @param {string} dir
 * @param {RegExp} token
 * @param {boolean} reserveProvisional
 * @returns {Set<string>}
 */
function keysIn(dir, token, reserveProvisional) {
  /** @type {Set<string>} */
  const taken = new Set();
  if (!existsSync(dir)) return taken;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const text = readFileSync(join(entry.parentPath, entry.name), "utf8");
    for (const m of text.matchAll(token)) taken.add(m[0]);
    if (reserveProvisional) {
      const file = parse(entry.name, text);
      if (file.type === "feature" && Array.isArray(file.data.retired)) {
        for (const key of file.data.retired) {
          for (const reserved of provisionalKeys(key)) taken.add(reserved);
        }
      }
    }
  }
  return taken;
}

// SHA-256 in counter mode over `seed`: a reproducible byte stream.
/**
 * @param {string} seed
 * @returns {(n: number) => Buffer}
 */
function seededBytes(seed) {
  let counter = 0;
  let pool = Buffer.alloc(0);
  return (n) => {
    while (pool.length < n) {
      pool = Buffer.concat([pool, createHash("sha256").update(`${seed}:${counter++}`).digest()]);
    }
    const out = pool.subarray(0, n);
    pool = pool.subarray(n);
    return out;
  };
}

// The command line's `mint <tc|ts|su|aut|rule|boundary>` (scripts/scan.mjs). A trailing `_` on the kind is
// dropped, so `tc_` is `tc`.
/** @type {CommandDefinition} */
export const command = {
  options: { count: "value", root: "qa-dir?", feature: "value", prefix: "value" },
  usage: "<tc|ts|su|aut|rule|boundary|bg> [--count <n>] [--root <qa-dir>] [--feature <key>] [--prefix <P>]",
  run(args, { count: given, root, feature, prefix, seed }) {
    if (args.length !== 1) throw new UsageError("mint takes exactly one kind: tc, ts, su, aut, rule, boundary or bg");
    const kind = args[0].replace(/_$/, "");
    const count = given === undefined ? 1 : Number(given);
    if (!Number.isInteger(count) || count < 1) throw new UsageError("--count must be an integer ≥ 1");
    const result = orThrow(mint(kind, { count, root: /** @type {string} */ (root), feature: /** @type {string | undefined} */ (feature), prefix: /** @type {string | undefined} */ (prefix), seed }));
    return { exit: 0, json: result };
  },
};
