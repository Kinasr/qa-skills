// @ts-check
// The code index (ADR-0005, ADR-0022): Automation key → the function that carries it, built by a
// source scan of `module_paths` on every run and never stored. The stack is read through its
// adapter (lib/stack.mjs), so nothing here knows a language or a framework.
//
// The scan binds to Key-carrier roles, not names: `annotation_map` says which carriers hold the
// Automation key on a function (`automation_key`), the tracker key on a function
// (`tracker_key_fn`) and the tracker key on a class (`tracker_key_class`), several names per role.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { carrierNames, filesUnder } from "./code-source.mjs";
import { PATTERN, prefixFits } from "./keys.mjs";

/**
 * @import { StackAdapter } from "./stack.mjs"
 * @import { MintRecipe } from "./keys.mjs"
 */

/**
 * A Key carrier fact with its file line.
 * @typedef {{
 *   key: string,
 *   line: number,
 * }} CodeKey
 */

/**
 * A class in the code index.
 * @typedef {{
 *   file: string,
 *   line: number,
 *   name: string,
 *   path: string,
 *   trackerKeys: CodeKey[],
 *   keyPrefixes: CodeKey[],
 *   disabled: boolean,
 * }} IndexedClass
 */

/**
 * A test function in the code index.
 * @typedef {{
 *   file: string,
 *   line: number,
 *   name: string,
 *   class: string,
 *   package: string,
 *   classes: IndexedClass[],
 *   automationKeys: CodeKey[],
 *   trackerKeys: CodeKey[],
 *   parameterised: boolean,
 *   disabled: boolean,
 * }} IndexedFunction
 */

/**
 * A file header's Key prefix entries.
 * @typedef {{
 *   file: string,
 *   keyPrefixes: CodeKey[],
 * }} IndexedHeader
 */

/**
 * The code index over every existing module path.
 * @typedef {{
 *   files: number,
 *   functions: IndexedFunction[],
 *   classes: IndexedClass[],
 *   headers?: IndexedHeader[],
 * }} CodeIndex
 */

/**
 * @typedef {{ test: (s: string) => boolean }} PatternMatcher
 */

/**
 * @typedef {Record<string, RegExp | PatternMatcher | null | undefined> & {
 *   automation_key: RegExp | PatternMatcher,
 *   tracker_key_fn: RegExp | PatternMatcher | null | undefined,
 *   tracker_key_class: RegExp | PatternMatcher | null | undefined,
 *   automation_key_prefix: PatternMatcher | null,
 * }} KeyPatterns
 */

/**
 * Internal adapter shape used for uniform traversal across stack implementations.
 * @typedef {{
 *   extensions: readonly string[],
 *   fileKeyPrefix?: boolean,
 *   sep: string,
 *   parse: (text: string, file: string) => {
 *     package?: string | null,
 *     classes: readonly { line: number, name: string, path: string, carriers: unknown, [key: string]: unknown }[],
 *     functions: readonly { line: number, name: string, classPath: string, carriers: unknown, [key: string]: unknown }[],
 *     header?: { keyPrefixes: CodeKey[], [key: string]: unknown } | null,
 *   },
 *   keys: (carriers: unknown, names: readonly string[], pattern: RegExp | PatternMatcher | null) => readonly CodeKey[],
 *   isTest: (fn: unknown) => boolean,
 *   parameterised: (fn: unknown) => boolean,
 *   disabled: (node: unknown) => boolean,
 * }} CodeIndexAdapter
 */

// The code index over every existing module path (a missing one is `scan-integrity`'s error):
//   files      number of source files read
//   functions  [{file, line, name, class, package, classes, automationKeys, trackerKeys, parameterised, disabled}]
//   classes    [{file, line, name, path, trackerKeys, keyPrefixes, disabled}]
// `file` is relative to the repository. `package` is the file's package declaration (empty when it
// has none), so a JVM runner can select `<pkg>.<Class>.<method>`. `automationKeys` and
// `trackerKeys` are `[{key, line}]`
// (the carrier's line), as are `keyPrefixes`, the values of the `automation_key_prefix` carrier
// (ADR-0013); `classes` is the function's enclosing classes, outermost first. A function is
// `disabled` when it or an enclosing class is. Only tests are listed (each one an Automation, keyed
// or not): functions the adapter calls a test, or that carry a mapped role's key.
//
// `adapter` is the stack's (lib/stack.mjs), and `patterns` each role's key test (`keyPatterns`): a
// free-text carrier holds a key only as a token that passes it (ADR-0022). For an adapter whose
// files carry a Key prefix in a header (`fileKeyPrefix`, ADR-0022), the index also lists
//   headers    [{file, keyPrefixes}]   every file read, with its header's Key prefixes
/**
 * @param {string} repo
 * @param {readonly string[]} modulePaths
 * @param {Record<string, readonly string[]> | null | undefined} annotationMap
 * @param {StackAdapter} adapter
 * @param {KeyPatterns} patterns
 * @returns {CodeIndex}
 */
export function buildCodeIndex(repo, modulePaths, annotationMap, adapter, patterns) {
  /** @type {CodeIndex} */
  const index = { files: 0, functions: [], classes: [], ...(adapter.fileKeyPrefix && { headers: [] }) };
  for (const file of filesUnder(repo, modulePaths, (name) => adapter.extensions.some((x) => name.endsWith(x)))) {
    let text;
    try {
      text = readFileSync(join(repo, file), "utf8");
    } catch {
      continue;
    }
    index.files++;
    const source = indexSource(text, file, annotationMap, adapter, patterns);
    index.classes.push(...source.classes);
    index.functions.push(...source.functions);
    if (index.headers) index.headers.push(source.header ?? { file, keyPrefixes: [] });
  }
  return index;
}

/**
 * One file's index, from its text: the same classes, test functions and header that
 * `buildCodeIndex` reads from disk, for a caller holding a file's content rather than a repository
 * (the edit guards compare the exported functions of two states of one file).
 * @param {string} text
 * @param {string} file
 * @param {Record<string, readonly string[]> | null | undefined} annotationMap
 * @param {StackAdapter} adapter
 * @param {KeyPatterns} patterns
 * @returns {{
 *   file: string,
 *   package: string,
 *   classes: IndexedClass[],
 *   functions: IndexedFunction[],
 *   header: IndexedHeader | null,
 * }}
 */
export function indexSource(text, file, annotationMap, adapter, patterns) {
  const names = (/** @type {string} */ role) => carrierNames(annotationMap, role);
  const read = (/** @type {unknown} */ carriers, /** @type {string} */ role) => /** @type {CodeKey[]} */ ((/** @type {CodeIndexAdapter} */ (adapter)).keys(carriers, names(role), patterns[role] ?? null));
  const parsed = (/** @type {CodeIndexAdapter} */ (adapter)).parse(text, file);
  const pkg = typeof parsed.package === "string" ? parsed.package : "";
  /** @type {Map<string, IndexedClass>} */
  const byPath = new Map();
  /** @type {IndexedClass[]} */
  const classes = [];
  for (const c of parsed.classes) {
    const cls = { file, line: c.line, name: c.name, path: c.path, trackerKeys: read(c.carriers, "tracker_key_class"), keyPrefixes: read(c.carriers, "automation_key_prefix"), disabled: (/** @type {CodeIndexAdapter} */ (adapter)).disabled(c) };
    byPath.set(c.path, cls);
    classes.push(cls);
  }
  /** @type {IndexedFunction[]} */
  const functions = [];
  for (const f of parsed.functions) {
    const automationKeys = read(f.carriers, "automation_key");
    const trackerKeys = read(f.carriers, "tracker_key_fn");
    if (!(/** @type {CodeIndexAdapter} */ (adapter)).isTest(f) && !automationKeys.length && !trackerKeys.length) continue;
    const chain = f.classPath ? f.classPath.split(adapter.sep) : [];
    const enclosing = /** @type {IndexedClass[]} */ (chain.map((_, i) => byPath.get(chain.slice(0, i + 1).join(adapter.sep))).filter(Boolean));
    functions.push({
      file,
      line: f.line,
      name: f.name,
      class: f.classPath,
      package: pkg,
      classes: enclosing,
      automationKeys,
      trackerKeys,
      parameterised: (/** @type {CodeIndexAdapter} */ (adapter)).parameterised(f),
      disabled: (/** @type {CodeIndexAdapter} */ (adapter)).disabled(f) || enclosing.some((c) => c.disabled),
    });
  }
  const header = adapter.fileKeyPrefix ? { file, keyPrefixes: /** @type {{ keyPrefixes: CodeKey[] }} */ (parsed.header).keyPrefixes } : null;
  return { file, package: pkg, classes, functions, header };
}

// Each role's key test, from `project.md` (`projectConfig`): the Automation key's
// (`automation_key_pattern`, the recipe's shape, or `aut_`), the tracker's for both tracker-key
// roles, and the Key-prefix recipe's for `automation_key_prefix` (null without one, as the
// tracker's is without a tracker).
/**
 * @param {{
 *   autRecipe?: MintRecipe | null,
 *   autPattern?: RegExp | PatternMatcher | null,
 *   trackerPattern?: RegExp | PatternMatcher | null,
 *   [key: string]: unknown,
 * }} config
 * @returns {KeyPatterns}
 */
export function keyPatterns(config) {
  const recipe = config.autRecipe;
  return {
    automation_key: config.autPattern ?? PATTERN.aut,
    tracker_key_fn: config.trackerPattern,
    tracker_key_class: config.trackerPattern,
    automation_key_prefix: recipe ? { test: (s) => prefixFits(s, recipe) } : null,
  };
}

// Every Automation-key-shaped token (`token`, a global RegExp) in any file under the module paths:
// a textual sweep for `mint`, so a key is taken wherever it is written, whatever the stack and
// whether or not it parses.
/**
 * @param {string} repo
 * @param {readonly string[]} modulePaths
 * @param {RegExp} token
 * @returns {Set<string>}
 */
export function automationKeysInCode(repo, modulePaths, token) {
  /** @type {Set<string>} */
  const taken = new Set();
  for (const file of filesUnder(repo, modulePaths, () => true)) {
    let text;
    try {
      text = readFileSync(join(repo, file), "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(token)) taken.add(m[0]);
  }
  return taken;
}
