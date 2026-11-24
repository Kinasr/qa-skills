// @ts-check
// The shared test-code edit guards: the one place `/qa-codefix` and `/qa-codegen` ask whether an
// edited test tree is still the tree they are allowed to ship. A caller hands the pinned and edited
// content of every path it touched; the guards answer with refusal facts, never with a repaired
// tree.
//
// Two guards:
//   scope      every path is under `module_paths` (minus `.qa/`) and outside the deny list
//              (universal VCS/knowledge/env/auth/snapshot/image rules and non-adapter build
//              files, plus stack- and runner-owned protected files from `stacks/descriptors.mjs`
//              and `runners/descriptors.mjs`), and its realpath does not escape that scope
//              through a symlink;
//   identity   every test function a file held still holds its `(file, class, name)`, its
//              `automationKeys`, `trackerKeys`, `keyPrefixes` and `parameterised` flag, read
//              through the code index (lib/code-index.mjs).
//
// The guard module never names a supported stack's or runner's files or declaration syntax:
// those live in `stacks/descriptors.mjs` and `runners/descriptors.mjs`, while universal and
// cross-ecosystem repository policy lives here.
import { realpathSync } from "node:fs";
import { posix, relative, sep } from "node:path";
import { indexSource } from "./code-index.mjs";
import { isContained, isSafeRelativePath, resolveRealPath, within } from "./paths.mjs";
import { RUNNER_PROTECTED_FILES } from "./runners/descriptors.mjs";
import { STACK_PROTECTED_FILES } from "./stacks/descriptors.mjs";

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
 * }} GuardInput
 */

/**
 * A refused edit, as the caller's adapter turns it into its own refusal.
 * @typedef {RefusalFact & {
 *   path?: string,
 *   outside?: string,
 *   via?: string,
 *   detail?: string,
 *   kind?: string,
 *   denied?: string,
 *   fn?: string,
 *   what?: string,
 * }} GuardRefusal
 */

/**
 * @typedef {{
 *   ok: boolean,
 *   refusals: GuardRefusal[],
 *   files: string[],
 * }} GuardResult
 */

// Directories no edit may enter, wherever they sit under a module path.
const DENY_DIRS = new Set([".git", ".qa", ".auth", "__snapshots__", "snapshots", "snapshot"]);

// Non-adapter build systems and unrelated app-framework manifests.
const UNIVERSAL_DENY_NAMES = ["build.xml", "ivy.xml", "build.sbt", "angular.json"];

// Universal environment, auth, unrelated test/app config, snapshot, and image patterns.
const UNIVERSAL_DENY_BASENAMES = [
  /^\.env.*/,
  /auth.*\.json$/,
  /^\.mocharc.*/,
  /^(?:vitest|jest|cypress|karma|ava|mocha|next|nuxt|svelte)\.config\.[^.]+$/,
  /\.snap$/,
  /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?|avif)$/,
];

// Compose universal policy with all registered stack and runner protected files.
const PROTECTED_FILES = [...STACK_PROTECTED_FILES, ...RUNNER_PROTECTED_FILES];
const DENY_NAMES = new Set([
  ...UNIVERSAL_DENY_NAMES,
  ...PROTECTED_FILES.flatMap((entry) => entry.names).map((name) => name.toLowerCase()),
]);
const DENY_BASENAMES = [
  ...UNIVERSAL_DENY_BASENAMES,
  ...PROTECTED_FILES.flatMap((entry) => entry.basenames),
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
    if (path === null || !roots.some((root) => within(path, root))) {
      refusals.push({ code: "out_of_scope", path: String(edit.path), outside: "module_paths" });
      continue;
    }
    const real = resolveRealPath(repo, path);
    if ("error" in real) {
      refusals.push({ code: "realpath_escape", path, detail: real.error });
      continue;
    }
    const repoReal = realpathSync(repo);
    const insideRepo = isContained(repoReal, real.real);
    const rootReals = roots.flatMap((root) => {
      const resolved = resolveRealPath(repo, root);
      return "error" in resolved ? [] : [resolved.real];
    });
    if (!insideRepo || !rootReals.some((root) => isContained(root, real.real))) {
      refusals.push({ code: "realpath_escape", path, outside: "module_paths", via: "symlink" });
      continue;
    }
    const realRel = relative(repoReal, real.real).split(sep).join("/");
    const denied = denyReason(path) ?? (realRel ? denyReason(realRel) : null);
    if (denied) refusals.push({ code: "denied_path", path, ...denied });
  }
  return refusals;
}

/**
 * The identity guard: each test function that existed still exists with the same keys, Key
 * prefixes, enclosing package and class tracker keys, with no duplicate `(class,
 * name)` collisions. New functions are allowed (code gen adds them).
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
  /** @param {readonly import("./code-index.mjs").IndexedFunction[]} list */
  const groupByKey = (list) => {
    /** @type {Map<string, import("./code-index.mjs").IndexedFunction[]>} */
    const groups = new Map();
    for (const f of list) {
      const key = `${f.class}\0${f.name}`;
      const entries = groups.get(key);
      if (entries) entries.push(f);
      else groups.set(key, [f]);
    }
    return groups;
  };
  for (const edit of edits) {
    const before = indexSource(edit.before ?? "", edit.path, annotationMap, adapter, patterns);
    const after = indexSource(edit.after ?? "", edit.path, annotationMap, adapter, patterns);
    if (before.functions.length > 0 && before.package !== after.package) {
      refusals.push({ code: "identity_changed", path: edit.path, fn: edit.path, what: "package" });
    }
    const afterClasses = new Map(after.classes.map((c) => [c.path, c]));
    for (const wasClass of before.classes) {
      const isClass = afterClasses.get(wasClass.path);
      if ((wasClass.trackerKeys.length > 0 && (!isClass || !sameKeys(wasClass.trackerKeys, isClass.trackerKeys)))
        || (isClass && wasClass.trackerKeys.length === 0 && isClass.trackerKeys.length > 0)) {
        refusals.push({ code: "identity_changed", path: edit.path, fn: wasClass.path, what: "trackerKeys" });
      }
    }
    const beforeGroups = groupByKey(before.functions);
    const afterGroups = groupByKey(after.functions);
    /** @type {Set<string>} */
    const seenDuplicates = new Set();
    for (const was of before.functions) {
      const key = `${was.class}\0${was.name}`;
      const isList = afterGroups.get(key) ?? [];
      if (isList.length === 0) {
        refusals.push({ code: "identity_changed", path: edit.path, fn: was.name, what: "name" });
        continue;
      }
      if (isList.length > 1) {
        if (!seenDuplicates.has(key)) {
          seenDuplicates.add(key);
          refusals.push({ code: "identity_changed", path: edit.path, fn: was.name, what: "duplicate" });
        }
        continue;
      }
      const is = isList[0];
      for (const field of /** @type {const} */ (["automationKeys", "trackerKeys"])) {
        if (!sameKeys(was[field], is[field])) refusals.push({ code: "identity_changed", path: edit.path, fn: was.name, what: field });
      }
      if (was.parameterised !== is.parameterised) refusals.push({ code: "identity_changed", path: edit.path, fn: was.name, what: "parameterised" });
      if (!sameList(prefixesOf(before, was), prefixesOf(after, is))) refusals.push({ code: "identity_changed", path: edit.path, fn: was.name, what: "keyPrefixes" });
    }
    for (const [key, isList] of afterGroups) {
      if (isList.length > 1 && !beforeGroups.has(key) && !seenDuplicates.has(key)) {
        seenDuplicates.add(key);
        refusals.push({ code: "identity_changed", path: edit.path, fn: isList[0].name, what: "duplicate" });
      }
    }
  }
  return refusals;
}

/**
 * Every guard, over the touched paths: scope and identity.
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
  if (usable.length && !input.adapter) refusals.push({ code: "no_adapter" });
  if (input.adapter) {
    refusals.push(...identityRefusals({ ...input, edits: usable }));
  }
  return { ok: refusals.length === 0, refusals, files: usable.map((edit) => edit.path) };
}

// A repository-relative POSIX path, or null when it is absolute or climbs out of the repository.
/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizePath(value) {
  if (!isSafeRelativePath(String(value))) return null;
  const path = posix.normalize(String(value).replace(/\\/g, "/")).replace(/\/+$/, "");
  // `isSafeRelativePath` already refused every `..` segment and absolute or drive path.
  if (!path || path === ".") return null;
  return path;
}

/**
 * The deny-list match for a repo-relative path, or null.
 * @param {string} path
 * @returns {{ kind: "directory" | "file" | "pattern", denied: string } | null}
 */
export function denyReason(path) {
  const parts = path.split("/");
  const name = /** @type {string} */ (parts.pop()).toLowerCase();
  for (const part of parts) {
    const dir = part.toLowerCase();
    if (DENY_DIRS.has(dir)) return { kind: "directory", denied: part };
  }
  if (DENY_DIRS.has(name)) return { kind: "directory", denied: name };
  if (DENY_NAMES.has(name) || name.endsWith(".lock")) return { kind: "file", denied: name };
  for (const pattern of DENY_BASENAMES) if (pattern.test(name)) return { kind: "pattern", denied: name };
  return null;
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
