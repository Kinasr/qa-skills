// @ts-check
// The shared test-code edit guards: the one place `/qa-codefix` and `/qa-codegen` ask whether an
// edited test tree is still the tree they are allowed to ship. A caller hands the pinned and edited
// content of every path it touched; the guards answer with refusal facts, never with a repaired
// tree.
//
// Four guards:
//   scope      every path is under `module_paths` (minus `.qa/`) and outside the fixed deny list
//              (runner and build config, lockfiles, `tsconfig*`, `.env*`, `.auth/`, `*auth*.json`,
//              snapshot dirs and images), and its realpath does not escape that scope through a
//              symlink;
//   identity   every test function a file held still holds its `(file, class, name)`, its
//              `automationKeys`, `trackerKeys`, `keyPrefixes` and `parameterised` flag, read
//              through the code index (lib/code-index.mjs);
//   tokens     a line the edit adds holds no disable, focus or assume token, and no sleep, retry or
//              timeout token, as the stack adapter names them;
//   assertions that the edited files did not lose assertions unless the caller gives a reason.
//
// The guard module never names a language, a framework, a file extension or a declaration syntax:
// the deny list is shared file policy, and the tokens and assertion counter are the adapter's.
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import { indexSource } from "./code-index.mjs";

/**
 * @import { KeyPatterns } from "./code-index.mjs"
 * @import { StackAdapter } from "./stack.mjs"
 * @import { RefusalFact } from "./refusal.mjs"
 */

/**
 * One path an edit touched: its content at the Run's pinned commit (`null` when it is new) and now
 * (`null` when the edit deletes it).
 * @typedef {{
 *   path: string,
 *   before: string | null,
 *   after: string | null,
 * }} GuardEdit
 */

/**
 * What a guard call is given: the repository, the project's module paths and code-index pattern,
 * the stack adapter, and the touched paths.
 * @typedef {{
 *   repo: string,
 *   modulePaths: readonly string[],
 *   annotationMap?: Record<string, readonly string[]> | null,
 *   adapter: StackAdapter | null,
 *   patterns: KeyPatterns,
 *   edits: readonly GuardEdit[],
 *   assertionsReduced?: string | false,
 * }} GuardInput
 */

/**
 * A refused edit, as the caller's adapter turns it into its own refusal.
 * @typedef {RefusalFact & {
 *   path?: string,
 *   what?: string,
 *   token?: string,
 *   net?: number,
 * }} GuardRefusal
 */

/**
 * @typedef {{
 *   before: number,
 *   after: number,
 *   net: number,
 * }} AssertionChange
 */

/**
 * @typedef {{
 *   ok: boolean,
 *   refusals: GuardRefusal[],
 *   assertions: AssertionChange,
 *   files: string[],
 * }} GuardResult
 */

// Directories no edit may enter, wherever they sit under a module path.
const DENY_DIRS = new Set([".git", ".qa", ".auth", "__snapshots__", "snapshots", "snapshot"]);

// Runner and build configuration, package manifests, and lockfiles: a fix may not change how the
// build or the runner behaves.
const DENY_NAMES = new Set([
  "package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  "bun.lock", "bun.lockb", "bunfig.toml",
  "pom.xml", "build.xml", "ivy.xml", "build.sbt",
  "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
  "gradle.properties", "gradle.lockfile", "gradlew", "gradlew.bat", "mvnw", "mvnw.cmd", "mvnwDebug",
  "angular.json", "turbo.json", "nx.json", "lerna.json", "workspace.json", "project.json",
]);

// A file name (lower-cased) the fixed deny list claims.
const DENY_BASENAMES = [
  /^tsconfig.*\.json$/,
  /^\.env.*/,
  /auth.*\.json$/,
  /^\.(?:mocharc|babelrc|swcrc|npmrc|yarnrc|pnpmrc|nvmrc).*/,
  /^(?:playwright|vitest|jest|cypress|karma|ava|mocha|webpack|vite|rollup|esbuild|tsup|next|nuxt|svelte|babel)\.config\.[^.]+$/,
  /\.snap$/,
  /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?|avif)$/,
];

/**
 * The scope guard: each touched path under `modulePaths` minus `.qa/`, outside the deny list, and
 * resolving (through any symlink) inside that scope.
 * @param {{ repo: string, modulePaths: readonly string[], edits: readonly GuardEdit[] }} input
 * @returns {GuardRefusal[]}
 */
export function scopeRefusals({ repo, modulePaths, edits }) {
  const roots = modulePaths.map(normalizePath).filter((p) => p !== null);
  /** @type {GuardRefusal[]} */
  const refusals = [];
  for (const edit of edits) {
    const path = normalizePath(edit.path);
    if (path === null || !roots.some((root) => under(path, root))) {
      refusals.push({ code: "out_of_scope", path: String(edit.path), message: "The path is outside `module_paths`." });
      continue;
    }
    const real = resolveReal(repo, path);
    if ("error" in real) {
      refusals.push({ code: "realpath_escape", path, message: `The path does not resolve inside the repository: ${real.error}.` });
      continue;
    }
    const repoReal = realpathSync(repo);
    const insideRepo = under(real.real, repoReal) || real.real === repoReal;
    const rootReals = roots.flatMap((root) => {
      const resolved = resolveReal(repo, root);
      return "error" in resolved ? [] : [resolved.real];
    });
    if (!insideRepo || !rootReals.some((root) => under(real.real, root) || real.real === root)) {
      refusals.push({ code: "realpath_escape", path, message: "The path resolves outside `module_paths` through a symlink." });
      continue;
    }
    const denied = denyReason(path);
    if (denied) refusals.push({ code: "denied_path", path, message: `The fixed deny list covers ${denied}.` });
  }
  return refusals;
}

/**
 * The identity guard: each test function that existed still exists with the same keys, Key
 * prefixes and parameterised flag. New functions are allowed (code gen adds them).
 * @param {{
 *   annotationMap?: Record<string, readonly string[]> | null,
 *   adapter: StackAdapter | null,
 *   patterns: KeyPatterns,
 *   edits: readonly GuardEdit[],
 * }} input
 * @returns {GuardRefusal[]}
 */
export function identityRefusals({ annotationMap, adapter, patterns, edits }) {
  if (!adapter) return [];
  /** @type {GuardRefusal[]} */
  const refusals = [];
  for (const edit of edits) {
    const before = indexSource(edit.before ?? "", edit.path, annotationMap, adapter, patterns);
    const after = indexSource(edit.after ?? "", edit.path, annotationMap, adapter, patterns);
    const now = new Map(after.functions.map((f) => [`${f.class}\0${f.name}`, f]));
    for (const was of before.functions) {
      const key = `${was.class}\0${was.name}`;
      const is = now.get(key);
      if (!is) {
        refusals.push({ code: "identity_changed", path: edit.path, what: "name", message: `The test function \`${was.name}\` is gone.` });
        continue;
      }
      for (const field of /** @type {const} */ (["automationKeys", "trackerKeys"])) {
        if (!sameKeys(was[field], is[field])) refusals.push({ code: "identity_changed", path: edit.path, what: field, message: `The test function \`${was.name}\` changed its ${field}.` });
      }
      if (was.parameterised !== is.parameterised) refusals.push({ code: "identity_changed", path: edit.path, what: "parameterised", message: `The test function \`${was.name}\` changed whether it is parameterised.` });
      if (!sameList(prefixesOf(before, was), prefixesOf(after, is))) refusals.push({ code: "identity_changed", path: edit.path, what: "keyPrefixes", message: `The test function \`${was.name}\` changed its Key prefix.` });
    }
  }
  return refusals;
}

/**
 * The token guard: a line the edit adds holds no never token of the stack.
 * @param {{ adapter: StackAdapter | null, edits: readonly GuardEdit[] }} input
 * @returns {GuardRefusal[]}
 */
export function tokenRefusals({ adapter, edits }) {
  const guard = adapter?.guard;
  if (!guard) return [];
  /** @type {GuardRefusal[]} */
  const refusals = [];
  for (const edit of edits) {
    const seen = new Set();
    for (const line of addedLines(edit.before ?? "", edit.after ?? "")) {
      if (isComment(line)) continue;
      for (const token of guard.never) {
        if (seen.has(token.id)) continue;
        const match = line.match(token.pattern);
        if (match) {
          seen.add(token.id);
          refusals.push({ code: "forbidden_token", path: edit.path, token: token.id, message: `The edit adds a ${token.id} token: \`${match[0].trim()}\`.` });
        }
      }
    }
  }
  return refusals;
}

/**
 * How many assertions the edited files held before and after.
 * @param {{ adapter: StackAdapter | null, edits: readonly GuardEdit[] }} input
 * @returns {AssertionChange}
 */
export function assertionChange({ adapter, edits }) {
  const count = adapter?.guard?.assertions;
  if (!count) return { before: 0, after: 0, net: 0 };
  const before = edits.reduce((n, edit) => n + (edit.before === null ? 0 : count(edit.before)), 0);
  const after = edits.reduce((n, edit) => n + (edit.after === null ? 0 : count(edit.after)), 0);
  return { before, after, net: after - before };
}

/**
 * Every guard, over the touched paths: scope, identity, tokens and assertion count.
 * @param {GuardInput} input
 * @returns {GuardResult}
 */
export function checkEdits(input) {
  const scope = scopeRefusals(input);
  /** @type {Set<string>} */
  const refusedAt = new Set(scope.flatMap((r) => (r.path === undefined ? [] : [r.path])));
  const usable = input.edits.filter((edit) => !refusedAt.has(edit.path));
  /** @type {GuardRefusal[]} */
  const refusals = [...scope];
  if (usable.length && !input.adapter) refusals.push({ code: "no_adapter", message: "The project's stack loaded no code adapter to read the edited tests with." });
  if (input.adapter) {
    refusals.push(...identityRefusals({ ...input, edits: usable }));
    refusals.push(...tokenRefusals({ ...input, edits: usable }));
  }
  const assertions = assertionChange({ adapter: input.adapter, edits: usable });
  if (assertions.net < 0 && !input.assertionsReduced) {
    refusals.push({ code: "assertions_reduced", net: assertions.net, message: `The edit removes ${-assertions.net} assertion(s) with no reason.` });
  }
  return { ok: refusals.length === 0, refusals, assertions, files: usable.map((edit) => edit.path) };
}

// A repository-relative POSIX path, or null when it is absolute or climbs out of the repository.
/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizePath(value) {
  const path = posix.normalize(String(value).replace(/\\/g, "/")).replace(/\/+$/, "");
  if (!path || path === "." || path === ".." || posix.isAbsolute(path) || path.startsWith("../")) return null;
  return path;
}

/** @param {string} path @param {string} root */
const under = (path, root) => root === "." || path === root || path.startsWith(`${root}/`);

/**
 * The real path of `rel`, resolving symlinks in every existing component and keeping the missing
 * tail. A dangling or unreadable symlink is an error: nothing behind it can be trusted.
 * @param {string} repo
 * @param {string} rel
 * @returns {{ real: string } | { error: string }}
 */
function resolveReal(repo, rel) {
  const abs = resolve(repo, rel);
  /** @type {string[]} */
  const tail = [];
  let probe = abs;
  for (;;) {
    try {
      return { real: join(realpathSync(probe), ...tail) };
    } catch (e) {
      const code = /** @type {NodeJS.ErrnoException} */ (e).code ?? "unresolvable";
      if (code !== "ENOENT") return { error: code };
      try {
        if (lstatSync(probe).isSymbolicLink()) return { error: "dangling_symlink" };
      } catch {
        // Not present either: keep walking to the deepest existing ancestor.
      }
      const parent = dirname(probe);
      if (parent === probe) return { error: "unresolvable" };
      tail.unshift(basename(probe));
      probe = parent;
    }
  }
}

/**
 * The deny-list reason for a repo-relative path, or null.
 * @param {string} path
 * @returns {string | null}
 */
function denyReason(path) {
  const parts = path.split("/");
  const name = /** @type {string} */ (parts.pop()).toLowerCase();
  for (const part of parts) {
    const dir = part.toLowerCase();
    if (DENY_DIRS.has(dir)) return `the \`${part}\` directory`;
  }
  if (DENY_DIRS.has(name)) return `the \`${name}\` directory`;
  if (DENY_NAMES.has(name) || name.endsWith(".lock")) return `\`${name}\``;
  for (const pattern of DENY_BASENAMES) if (pattern.test(name)) return `\`${name}\``;
  return null;
}

/**
 * The lines `after` adds over `before`, as a multiset difference: a line that already occurred in
 * `before` is not added again. A moved or modified line counts as added, which only makes the scan
 * stricter.
 * @param {string} before
 * @param {string} after
 * @returns {string[]}
 */
function addedLines(before, after) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const line of before.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
  /** @type {string[]} */
  const added = [];
  for (const line of after.split("\n")) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added.push(line);
  }
  return added;
}

/** @param {string} line */
function isComment(line) {
  const text = line.trim();
  return text === "" || text.startsWith("//") || text.startsWith("/*") || text.startsWith("*") || text.startsWith("#");
}

/**
 * The keys of an index entry, deduplicated and sorted, so line moves never change an identity.
 * @param {{ key: string }[]} keys
 * @returns {string[]}
 */
const keyNames = (keys) => [...new Set(keys.map((k) => k.key))].sort();

/**
 * @param {{ key: string }[]} a
 * @param {{ key: string }[]} b
 * @returns {boolean}
 */
const sameKeys = (a, b) => sameList(keyNames(a), keyNames(b));

/**
 * @param {readonly string[]} a
 * @param {readonly string[]} b
 * @returns {boolean}
 */
const sameList = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * The Key prefixes a test function inherits: those of its enclosing classes, else its file's
 * header (the adapter's fallback for a test no class gives a prefix).
 * @param {{ header: { keyPrefixes: { key: string }[] } | null }} index
 * @param {{ classes: { keyPrefixes: { key: string }[] }[] }} fn
 * @returns {string[]}
 */
function prefixesOf(index, fn) {
  const fromClasses = fn.classes.flatMap((c) => c.keyPrefixes.map((k) => k.key));
  const source = fromClasses.length ? fromClasses : (index.header?.keyPrefixes ?? []).map((k) => k.key);
  return [...new Set(source)].sort();
}
