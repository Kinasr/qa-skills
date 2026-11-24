// @ts-check
// Reads the working tree's `.qa/` into parsed files (lib/knowledge-file.mjs, the filesystem adapter
// of its `parseTree`) and builds the Key index (ADR-0004): Key → the file and line that declares
// it. Nothing is stored; every scan rebuilds it.
/** @import { CaseEntry, ParsedEntry, ParsedFile, ProjectConfig, UnreadableFile } from "./knowledge-file.mjs" */
/** @import { TrackerIndex, TrackerResolver } from "./tracker-resolver.mjs" */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { listOf } from "./dialect.mjs";
import { readTrackerReference } from "./keys.mjs";
import { parse, parseTree, projectConfig } from "./knowledge-file.mjs";
import { resolvesInside } from "./paths.mjs";
import { canonicalTrainKey } from "./schema.mjs";
import { buildTrackerResolver } from "./tracker-resolver.mjs";

/**
 * One `[rel, text]` entry of a tree read, or `[rel, {unreadable: message}]` for a file that could
 * not be read.
 * @typedef {[string, string | { unreadable: string }]} TreeEntry
 */

/**
 * The entries of a tree read, as its reader iterates them. The shape is named here because the
 * generator's own type carries `any` in the signature of its `throw`.
 * @typedef {{
 *   next(...args: [] | [unknown]): IteratorResult<TreeEntry, void>,
 *   [Symbol.iterator](): { next(...args: [] | [unknown]): IteratorResult<TreeEntry, void> },
 * }} TreeEntries
 */

/**
 * A `.qa/` file the tree read returns, as the modules that read the tree hold it: the parsed file,
 * or the one that could not be read. Each reader keeps its own projection of a parsed file, so
 * this is the shape they all have.
 * @typedef {{
 *   rel: string,
 *   unreadable?: unknown,
 *   type?: string | null,
 *   data?: Record<string, unknown>,
 *   keyLines?: Record<string, number>,
 *   frontmatterLine?: number,
 *   dir?: string,
 *   rules?: readonly unknown[],
 *   cases?: readonly unknown[],
 * }} TreeFile
 */

/**
 * One declaration of a Key: the file that declares it, and the line it is declared on.
 * @typedef {{
 *   file: ParsedFile,
 *   line: number,
 * }} KeyDecl
 */

/**
 * One declaration of a Suite key: the file, the line, and the Feature it belongs to.
 * @typedef {{
 *   file: ParsedFile,
 *   line: number,
 *   feature?: string | null,
 * }} SuiteDecl
 */

/**
 * One declaration of a Scenario key: the file, the line, and the Feature it belongs to.
 * @typedef {{
 *   file: ParsedFile,
 *   line: number,
 *   feature: string | null,
 * }} ScenarioDecl
 */

/**
 * One declaration of a Case key: the file, the line, its Feature and its Scenario, and the entry.
 * @typedef {{
 *   file: ParsedFile,
 *   line: number,
 *   feature: string | null,
 *   scenario: string | null,
 *   entry: ParsedEntry,
 * }} CaseDecl
 */

/**
 * The Key index over parsed files. Each map is Key → every declaration of it, in file order, so a
 * Key declared twice is visible rather than silently overwritten. Rules are per Feature.
 *   features   slug → [{file, line}]
 *   suites     Suite key → [{file, line, feature}] (ownership, separate from tracker references)
 *   scenarios  key  → [{file, line, feature}]
 *   cases      key  → [{file, line, feature, scenario, entry}]
 *   rules      feature slug → (rule key → [{file, line}])
 *   boundaries feature slug → (Boundary key → [{file, line}])
 *   bugs       Bug draft key → [{file, line, feature}] (published ones claim a Tracker key)
 *   train      target → [{file, line}]  (a target, never a global Key)
 * `featureOf(file)` names the Feature a file belongs to: its own key, its `feature:`, or the
 * Feature whose directory holds it.
 * @typedef {{
 *   features: Map<string, KeyDecl[]>,
 *   suites: Map<string, SuiteDecl[]>,
 *   scenarios: Map<string, ScenarioDecl[]>,
 *   cases: Map<string, CaseDecl[]>,
 *   rules: Map<string, Map<string, KeyDecl[]>>,
 *   boundaries: Map<string, Map<string, KeyDecl[]>>,
 *   bugs: Map<string, BugDecl[]>,
 *   train: Map<string, KeyDecl[]>,
 *   project?: ParsedFile | null,
 *   featureOf: (file: ParsedFile) => string | null,
 *   tracker: TrackerResolver,
 * }} KeyIndex
 */

/**
 * One declaration of a Bug draft key: the file, the line, and the Feature it belongs to.
 * @typedef {{
 *   file: ParsedFile,
 *   line: number,
 *   feature?: string | null,
 * }} BugDecl
 */

/**
 * A `.qa/` file's frontmatter values, as the index holds them: the values the schema names, and
 * the Mirror map among them.
 * @typedef {{
 *   [key: string]: unknown,
 *   mirror?: { [key: string]: unknown },
 * }} FeatureData
 */

/**
 * The file a Feature is declared in, as the index holds it.
 * @typedef {{
 *   rel: string,
 *   dir?: string,
 *   data: FeatureData,
 *   [key: string]: unknown,
 * }} FeatureFile
 */

// `path` relative to the `.qa/` directory `root`, `/`-separated: a parsed file's `rel`.
/**
 * @param {string} root
 * @param {string} path
 * @returns {string}
 */
export const qaRel = (root, path) => relative(root, path).split(sep).join("/");

/**
 * Whether `err` represents a genuinely absent filesystem entry (`ENOENT` on both access and
 * `lstatSync`, so broken symlinks fail closed instead of looking missing).
 * @param {unknown} err
 * @param {string} path
 * @returns {boolean}
 */
function isMissingEntry(err, path) {
  if (/** @type {NodeJS.ErrnoException} */ (err).code !== "ENOENT") return false;
  try {
    lstatSync(path);
    return false;
  } catch (statErr) {
    return /** @type {NodeJS.ErrnoException} */ (statErr).code === "ENOENT";
  }
}

// Every `.md` file under `root`, relative and `/`-separated, in a stable order. Fails closed when
// `root` or any subdirectory cannot be read; returns `[]` only when `root` itself does not exist.
/**
 * @param {string} root
 * @returns {string[]}
 */
export function listQaFiles(root) {
  /** @type {string[]} */
  const out = [];
  /**
   * @param {string} dir
   * @returns {void}
   */
  const walk = (dir) => {
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (dir === root && isMissingEntry(e, dir)) return;
      throw e;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = qaRel(root, abs);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".md")) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

// Every file under `root` as `[rel, text]`, for `parseTree`. A file that cannot be read is
// `[rel, {unreadable: message}]`.
/**
 * @param {string} root
 * @returns {TreeEntries}
 */
export function* readWorkingTree(root) {
  for (const rel of listQaFiles(root)) {
    try {
      yield [rel, readFileSync(join(root, rel), "utf8")];
    } catch (e) {
      yield [rel, { unreadable: /** @type {Error} */ (e).message }];
    }
  }
}

// Every file under `root`, parsed. A file that cannot be read is `{rel, unreadable: message}`.
/**
 * @param {string | undefined} root
 * @returns {Array<ParsedFile | UnreadableFile>}
 */
export const loadWorkingTree = (root) => parseTree(readWorkingTree(/** @type {string} */ (root)));

// The first file declaring a Feature, or undefined when the index holds no such Feature.
/**
 * The file that declares the Feature `key` names, as the index holds it. The type says the file is
 * there: the readers of this call name a Feature the index holds.
 * @param {{ features: Map<string, readonly { file: { rel: string } }[]> }} index
 * @param {string} key
 * @returns {FeatureFile}
 */
export const featureFile = (index, key) => /** @type {FeatureFile} */ (index.features.get(key)?.[0]?.file);

// Where the file at `path` sits, for a check of it (the CLI's `check-file`, `/qa-init`): its `.qa/`
// `root` (`--root`, else the nearest directory named `.qa` above it, else its own directory), its
// `rel` there, and the `config` to check it under (lib/knowledge-file.mjs `projectConfig`): from
// the nearest `project.md` declaring `type: project`, in `root` alone when `root` was named, else
// at or above the file's directory.
/**
 * @param {string} path
 * @param {{ root?: string }} [options]
 * @returns {{ root: string, rel: string, config: ProjectConfig }}
 */
export function locate(path, { root } = {}) {
  const abs = resolve(path);
  let qa = root === undefined ? null : resolve(root);
  for (let dir = dirname(abs); qa === null && dirname(dir) !== dir; dir = dirname(dir)) if (basename(dir) === ".qa") qa = dir;
  qa ??= dirname(abs);
  /** @type {ParsedFile | null} */
  let project = null;
  for (let dir = root === undefined ? dirname(abs) : qa; ; dir = dirname(dir)) {
    project = projectAt(dir);
    if (project || root !== undefined || dirname(dir) === dir) break;
  }
  return { root: qa, rel: qaRel(qa, abs), config: { ...projectConfig(project), pathInsideRepo: (path) => resolvesInside(dirname(qa), path) } };
}

// The configuration a writer checks a file under before it lands: `root`'s own `project.md`.
/**
 * @param {string} root
 * @returns {ProjectConfig & { declaredSchemaVersion?: unknown }}
 */
export const rootConfig = (root) => {
  const qa = resolve(root);
  const project = projectAt(qa);
  const config = projectConfig(project);
  return {
    ...config,
    pathInsideRepo: (path) => resolvesInside(dirname(qa), path),
    ...(config.schemaVersion === null && { declaredSchemaVersion: project?.data?.schema_version }),
  };
};

// `dir/project.md`, parsed, when it exists and declares `type: project`; null when absent or not
// a project file. Non-`ENOENT` read errors (and broken symlinks) fail closed instead of defaulting.
/**
 * @param {string} dir
 * @returns {ParsedFile | null}
 */
function projectAt(dir) {
  const path = join(dir, "project.md");
  /** @type {string} */
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (isMissingEntry(e, path)) return null;
    throw e;
  }
  const f = parse("project.md", text);
  return f.type === "project" ? f : null;
}

// The Key index over parsed files. Each map is Key → every declaration of it, in file order, so a
// Key declared twice is visible rather than silently overwritten. Rules are per Feature.
//   features   slug → [{file, line}]
//   suites     Suite key → [{file, line, feature}] (ownership, separate from tracker references)
//   scenarios  key  → [{file, line, feature}]
//   cases      key  → [{file, line, feature, scenario, entry}]
//   rules      feature slug → (rule key → [{file, line}])
//   train      target → [{file, line}]  (a target, never a global Key)
// `featureOf(file)` names the Feature a file belongs to: its own key, its `feature:`, or the
// Feature whose directory holds it.
/**
 * @param {readonly TreeFile[]} files
 * @returns {KeyIndex}
 */
export function buildIndex(files) {
  /**
   * @template V
   * @param {Map<string, V[]>} map
   * @param {unknown} key
   * @param {V} v
   * @returns {void}
   */
  const push = (map, key, v) => {
    if (typeof key !== "string" && typeof key !== "number") return;
    const k = String(key);
    if (!map.has(k)) map.set(k, []);
    /** @type {V[]} */ (map.get(k)).push(v);
  };
  // The index, before `featureOf` and the tracker resolver are bound to it.
  const ix = /** @type {KeyIndex} */ ({ features: new Map(), suites: new Map(), scenarios: new Map(), cases: new Map(), rules: new Map(), boundaries: new Map(), bugs: new Map(), train: new Map(), project: null });
  /** @type {Map<string, string>} */
  const featureDirs = new Map();
  for (const f of /** @type {readonly ParsedFile[]} */ (files)) {
    if (f.unreadable) continue;
    /**
     * @param {string} k
     * @returns {number}
     */
    const at = (k) => f.keyLines[k] ?? f.frontmatterLine;
    if (f.type === "project") ix.project ??= f;
    if (f.type === "feature") {
      push(ix.features, f.data.key, { file: f, line: at("key") });
      push(ix.suites, f.data.suite_key, { file: f, line: at("suite_key"), feature: /** @type {string | null} */ (f.data.key) });
      if (typeof f.data.key === "string" && !featureDirs.has(f.dir)) featureDirs.set(f.dir, f.data.key);
    }
    if (f.type === "train") push(ix.train, canonicalTrainKey(f.data.key), { file: f, line: at("key") });
  }
  /**
   * @param {ParsedFile} f
   * @returns {string | null}
   */
  const featureOf = (f) => {
    if (f.type === "feature" && typeof f.data.key === "string") return f.data.key;
    if (f.type === "scenario" && typeof f.data.feature === "string") return f.data.feature;
    return featureDirs.get(f.dir) ?? null;
  };
  for (const f of /** @type {readonly ParsedFile[]} */ (files)) {
    if (f.unreadable) continue;
    if (f.type === "feature" && typeof f.data.key === "string") {
      if (!ix.rules.has(f.data.key)) ix.rules.set(f.data.key, new Map());
      for (const r of f.rules) push(/** @type {Map<string, KeyDecl[]>} */ (ix.rules.get(f.data.key)), r.key, { file: f, line: r.line });
      if (!ix.boundaries.has(f.data.key)) ix.boundaries.set(f.data.key, new Map());
      for (const b of f.boundaries) push(/** @type {Map<string, KeyDecl[]>} */ (ix.boundaries.get(f.data.key)), b.key, { file: f, line: b.line });
    }
    if (f.type === "scenario") {
      const feature = featureOf(f);
      push(ix.scenarios, f.data.key, { file: f, line: f.keyLines.key ?? f.frontmatterLine, feature });
      for (const c of f.cases) push(ix.cases, c.key, { file: f, line: c.line, feature, scenario: /** @type {string | null} */ (f.data.key ?? null), entry: c });
    }
    if (f.type === "bug") push(ix.bugs, f.data.key, { file: f, line: f.keyLines.key ?? f.frontmatterLine, feature: featureOf(f) });
  }
  // The tracker resolver reads the index's own declarations; its own declaration type says
  // `feature` is a string, where the index holds the Feature's key or null.
  ix.featureOf = featureOf;
  ix.tracker = buildTrackerResolver(/** @type {TrackerIndex} */ (ix));
  return ix;
}

/**
 * @typedef {{
 *   kind: string,
 *   key: string,
 *   feature?: string | null,
 *   scenario?: string | null,
 *   file: ParsedFile,
 *   entry?: ParsedEntry | null,
 *   line: number,
 * }} ScopeDeclaration
 */

/**
 * @typedef {{
 *   kind: "case",
 *   key: string,
 *   feature: string | null,
 *   scenario: string | null,
 *   file: ParsedFile,
 *   entry: CaseEntry,
 *   line: number,
 * }} ScopeCase
 */

/**
 * @typedef {{
 *   retired: Map<string, string>,
 *   declarations: ScopeDeclaration[],
 *   cases: ScopeCase[],
 *   casesFor: (d: { kind: string, key: string, feature?: string | null }) => ScopeCase[],
 *   liveFeature: (key: string) => boolean,
 * }} ScopeState
 */

/**
 * @typedef {{ ok: true, cases: ScopeCase[], alias?: string }
 *   | { ok: false, code: "ambiguous_key" | "retired_key" | "unknown_key", key: string, feature?: string }} ScopeResolveResult
 */

/**
 * @param {unknown} value
 * @returns {string[]}
 */
const strings = (value) => Array.isArray(value) ? /** @type {string[]} */ (value.filter((v) => typeof v === "string")) : [];

/**
 * Build the live scope index state (declarations, live cases, and retired-key index) from `index`.
 * @param {KeyIndex} index
 * @returns {ScopeState}
 */
export function buildScopeState(index) {
  const retired = new Map(strings(index.project?.data.retired_features).map((key) => [key, "retired_features"]));
  for (const [key, declarations] of index.features) {
    for (const { file } of declarations) {
      for (const token of strings(file.data.retired)) {
        retired.set(readTrackerReference(token) ?? token, key);
      }
    }
  }
  const liveFeature = (/** @type {string} */ key) => !retired.has(key);
  const live = (/** @type {ScopeDeclaration} */ d) => liveFeature(d.feature ?? d.key) && !retired.has(d.key) && (!d.scenario || !retired.has(d.scenario));
  /** @type {Array<[string, Map<string, ReadonlyArray<{ file: ParsedFile, line: number }>>]>} */
  const maps = [["feature", index.features], ["suite", index.suites], ["scenario", index.scenarios], ["case", index.cases]];
  /** @type {ScopeDeclaration[]} */
  const allDeclarations = [];
  for (const [kind, map] of maps) {
    for (const [key, entries] of map) {
      for (const { file, line } of entries) {
        const entry = kind === "case" ? (file.cases.find((c) => c.key === key && c.line === line) ?? file.cases.find((c) => c.key === key) ?? null) : null;
        const scenario = (kind === "scenario" || kind === "case") && typeof file.data.key === "string" ? file.data.key : null;
        allDeclarations.push({ kind, key, feature: index.featureOf(file), scenario, file, entry, line: entry?.line ?? line });
      }
    }
  }
  const declarations = allDeclarations.filter(live);
  const cases = /** @type {ScopeCase[]} */ (declarations.filter((d) => d.kind === "case" && d.entry != null));
  /**
   * @param {{ kind: string, key: string, feature?: string | null }} d
   * @returns {ScopeCase[]}
   */
  const casesFor = (d) => cases.filter((c) => d.kind === "case" ? c.key === d.key : d.kind === "scenario" ? c.scenario === d.key : c.feature === (d.feature ?? d.key));
  return { retired, declarations, cases, casesFor, liveFeature };
}

/**
 * Resolve a scope token (Feature, Suite, Scenario, Test Case, Tracker key, `mirror.suite`,
 * retired key, or `formerly` alias) against `index` and `state`.
 * @param {string} token
 * @param {KeyIndex} index
 * @param {ScopeState} state
 * @returns {ScopeResolveResult}
 */
export function resolveScopeToken(token, index, state) {
  /**
   * @param {ScopeDeclaration[]} found
   * @param {boolean} [former]
   * @returns {ScopeResolveResult | null}
   */
  const resolveMatches = (found, former = false) => {
    if (found.length > 1) return { ok: false, code: "ambiguous_key", key: token };
    if (!found.length) return null;
    return { ok: true, cases: state.casesFor(found[0]), ...(former && { alias: `${token} → ${found[0].key}` }) };
  };
  const direct = resolveMatches(state.declarations.filter((d) => d.key === token));
  if (direct) return direct;
  const tracker = index.tracker.resolve(token);
  if (tracker.status === "ambiguous") return { ok: false, code: "ambiguous_key", key: token };
  if (tracker.status === "retired") return { ok: false, code: "retired_key", key: token, feature: state.retired.get(token) ?? "retired_features" };
  if (tracker.status === "unique") {
    if (!tracker.entry.feature || state.retired.has(tracker.entry.key) || !state.liveFeature(tracker.entry.feature)) {
      return { ok: false, code: "retired_key", key: token, feature: state.retired.get(tracker.entry.key) ?? "retired_features" };
    }
    return { ok: true, cases: state.casesFor(tracker.entry) };
  }
  if (tracker.status === "absent") {
    const suite = resolveMatches(state.declarations.filter((d) => {
      const mirror = d.file.data.mirror;
      return d.kind === "feature" && typeof mirror === "object" && mirror !== null && /** @type {{ suite?: unknown }} */ (mirror).suite === token;
    }));
    if (suite) return suite;
  }
  const retiredFeature = state.retired.get(token);
  if (retiredFeature !== undefined) return { ok: false, code: "retired_key", key: token, feature: retiredFeature };
  const former = resolveMatches(state.declarations.filter((d) => d.kind !== "suite" && strings((d.entry ?? d.file).data.formerly).includes(token)), true);
  return former ?? { ok: false, code: "unknown_key", key: token };
}

/**
 * The index shape holding cases for rule coverage lookups.
 * @typedef {{
 *   cases: ReadonlyMap<string, CaseDecl[]>,
 *   [key: string]: unknown,
 * }} RuleCoverageIndex
 */

/**
 * Inverse `covers` lookup: every Test Case declaration in `feature` whose `covers` list names `rule`.
 * @param {RuleCoverageIndex} index
 * @param {string} feature
 * @param {string} rule
 * @returns {CaseDecl[]}
 */
export function casesCoveringRule(index, feature, rule) {
  return [...index.cases.values()].map((d) => d[0]).filter((d) => d.feature === feature)
    .filter((c) => listOf(c.entry.data.covers).includes(rule));
}
