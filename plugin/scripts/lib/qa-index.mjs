// @ts-check
// Reads the working tree's `.qa/` into parsed files (lib/knowledge-file.mjs, the filesystem adapter
// of its `parseTree`) and builds the Key index (ADR-0004): Key → the file and line that declares
// it. Nothing is stored; every scan rebuilds it.
/** @import { ParsedEntry, ParsedFile, ProjectConfig, UnreadableFile } from "./knowledge-file.mjs" */
/** @import { TrackerIndex, TrackerResolver } from "./tracker-resolver.mjs" */
import { existsSync, lstatSync, realpathSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parse, parseTree, projectConfig } from "./knowledge-file.mjs";
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

// Every `.md` file under `root`, relative and `/`-separated, in a stable order. Unreadable
// directories are skipped, not fatal.
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
    } catch {
      return;
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
  return { root: qa, rel: qaRel(qa, abs), config: { ...projectConfig(project), pathInsideRepo: (path) => pathInsideRepo(dirname(qa), path) } };
}

// The configuration a writer checks a file under before it lands: `root`'s own `project.md`.
/**
 * @param {string} root
 * @returns {ProjectConfig}
 */
export const rootConfig = (root) => projectConfig(projectAt(resolve(root)));

// `dir/project.md`, parsed, when it exists, reads and declares `type: project`; else null.
/**
 * @param {string} dir
 * @returns {ParsedFile | null}
 */
function projectAt(dir) {
  const path = join(dir, "project.md");
  if (!existsSync(path)) return null;
  try {
    const f = parse("project.md", readFileSync(path, "utf8"));
    return f.type === "project" ? f : null;
  } catch {
    return null;
  }
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
 * Resolve existing ancestors too, so a future child under an escaping symlink is refused.
 * @param {string} repo
 * @param {string} path
 * @returns {boolean}
 */
function pathInsideRepo(repo, path) {
  let ancestor = resolve(repo, path);
  try {
    while (true) {
      try { lstatSync(ancestor); break; }
      catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT" || dirname(ancestor) === ancestor) return false;
        ancestor = dirname(ancestor);
      }
    }
    const rel = relative(realpathSync(repo), realpathSync(ancestor));
    return rel !== ".." && !rel.startsWith(`..${sep}`);
  } catch { return false; } // A dangling symlink cannot certify containment.
}
