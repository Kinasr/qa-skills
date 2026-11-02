// @ts-check
// Tracker carriers resolve by role, separately from live Keys (ADR-0027).
import { isTrackerKey, PATTERN, readTrackerReference } from "./keys.mjs";
import { projectConfig } from "./knowledge-file.mjs";
import { MINTED_KEYS_SCHEMA_VERSION } from "./schema.mjs";

/** @import { ParsedEntry, ParsedFile } from "./knowledge-file.mjs" */

/**
 * @typedef {{
 *   file: ParsedFile,
 *   line: number,
 *   feature?: string,
 *   scenario?: string | null,
 *   entry?: ParsedEntry,
 *   [key: string]: unknown,
 * }} TrackerIndexDeclaration
 */

/**
 * @typedef {{
 *   project?: ParsedFile | null,
 *   cases: Map<string, TrackerIndexDeclaration[]>,
 *   scenarios: Map<string, TrackerIndexDeclaration[]>,
 *   features: Map<string, TrackerIndexDeclaration[]>,
 *   bugs?: Map<string, TrackerIndexDeclaration[]>,
 *   [key: string]: unknown,
 * }} TrackerIndex
 */

/**
 * @typedef {{
 *   kind: string,
 *   key: string,
 *   file: ParsedFile,
 *   line: number,
 *   feature?: string,
 *   scenario?: string | null,
 *   entry?: ParsedEntry,
 * }} TrackerEntry
 */

/**
 * @typedef {{
 *   entry: TrackerEntry,
 *   field: string,
 *   file: ParsedFile,
 *   line: number,
 *   feature?: string,
 * }} TrackerClaim
 */

/**
 * @typedef {{
 *   status: "absent",
 *   entry?: never,
 *   entries?: never,
 * } | {
 *   status: "ambiguous",
 *   entries: TrackerEntry[],
 *   entry?: never,
 * } | {
 *   status: "retired",
 *   entry?: never,
 *   entries?: never,
 * } | {
 *   status: "unique",
 *   entry: TrackerEntry,
 *   entries?: never,
 * }} TrackerResolveResult
 */

/**
 * @typedef {{
 *   claims: Map<string, TrackerClaim[]>,
 *   resolve: (key: string) => TrackerResolveResult,
 *   current: (kind: string, key: string) => string | null,
 * }} TrackerResolver
 */

// Built once with the .qa/ index. `resolve(trackerKey)` returns `unique(entry)`, `absent`,
// `retired`, or `ambiguous(entries)`, discriminated by `status`. Each entry has `kind` and a Key;
// an ambiguous result may include a `retired` entry. `claims` retains every field and location
// for Integrity errors. `current(kind, key)` takes a live Key in the case or scenario role and
// returns its unambiguous current Tracker key, or null. Historical `formerly` is never a link.
/**
 * @param {TrackerIndex} index
 * @returns {TrackerResolver}
 */
export function buildTrackerResolver(index) {
  const { schemaVersion, trackerPattern } = projectConfig(index.project);
  const legacy = schemaVersion !== null && schemaVersion < MINTED_KEYS_SCHEMA_VERSION;
  const legacyKey = (/** @type {string} */ key) => legacy && !PATTERN.case.test(key) && !PATTERN.scenario.test(key) &&
    !PATTERN.provisional.test(key) && isTrackerKey(key, trackerPattern);
  const currentKey = (/** @type {Record<string, unknown>} */ data, /** @type {string} */ key) => data.tracker === undefined && legacyKey(key)
    ? key : typeof data.tracker === "string" ? data.tracker : null;
  const stringsIn = (/** @type {unknown} */ v) => Array.isArray(v) ? /** @type {string[]} */ (v.filter((k) => typeof k === "string")) : [];
  /** @type {Map<string, TrackerClaim[]>} */
  const claims = new Map();
  const add = (/** @type {string | null | undefined} */ key, /** @type {TrackerClaim} */ claim) => {
    if (typeof key !== "string") return;
    if (!claims.has(key)) claims.set(key, []);
    /** @type {TrackerClaim[]} */ (claims.get(key)).push(claim);
  };
  for (const [kind, map] of /** @type {Array<[string, Map<string, TrackerIndexDeclaration[]>]>} */ ([["case", index.cases], ["scenario", index.scenarios]])) {
    for (const [key, declarations] of map) {
      for (const d of declarations) {
        const entry = { ...d, key, kind };
        const data = kind === "case" ? /** @type {ParsedEntry} */ (d.entry).data : d.file.data;
        const lines = kind === "case" ? /** @type {ParsedEntry} */ (d.entry).keyLines : d.file.keyLines;
        const claim = (/** @type {string} */ field) => ({ entry, field, file: d.file, line: lines[field] ?? d.line, feature: d.feature });
        add(currentKey(data, key), claim(data.tracker === undefined ? "key" : "tracker"));
        for (const alias of stringsIn(data.tracker_formerly)) add(alias, claim("tracker_formerly"));
      }
    }
  }
  // A published Bug draft claims its Tracker key as a bug. A draft claims none: the tracker key is
  // resolved at publish, and `bg_` marks are never Tracker aliases.
  for (const [key, declarations] of index.bugs ?? []) {
    for (const d of declarations) {
      const data = d.file.data;
      if (data.status !== "published" || typeof data.tracker !== "string") continue;
      const entry = { ...d, key, kind: "bug" };
      add(data.tracker, { entry, field: "tracker", file: d.file, line: d.file.keyLines.tracker ?? d.line, feature: d.feature });
    }
  }
  for (const declarations of index.features.values()) {
    for (const d of declarations) {
      for (const retired of stringsIn(d.file.data.retired)) {
        const key = readTrackerReference(retired);
        if (key === null) continue;
        /** @type {TrackerEntry} */
        const entry = { kind: "retired", key, file: d.file, line: d.file.keyLines.retired ?? d.line, feature: /** @type {string | undefined} */ (d.file.data.key) };
        add(key, { ...entry, entry, field: "retired" });
      }
    }
  }
  const resolve = (/** @type {string} */ key) => {
    const found = claims.get(key) ?? [];
    if (!found.length) return /** @type {TrackerResolveResult} */ ({ status: "absent" });
    if (found.length > 1) return /** @type {TrackerResolveResult} */ ({ status: "ambiguous", entries: found.map((c) => c.entry) });
    if (found[0].field === "retired") return /** @type {TrackerResolveResult} */ ({ status: "retired" });
    return /** @type {TrackerResolveResult} */ ({ status: "unique", entry: found[0].entry });
  };
  // Fetch the current tracker item only; aliases remain code bindings.
  const current = (/** @type {string} */ kind, /** @type {string} */ key) => {
    const declarations = (kind === "case" ? index.cases : index.scenarios).get(key) ?? [];
    if (declarations.length !== 1) return null;
    const d = declarations[0];
    const data = kind === "case" ? /** @type {ParsedEntry} */ (d.entry).data : d.file.data;
    const tracker = currentKey(data, key);
    const r = resolve(/** @type {string} */ (tracker));
    return r.status === "unique" && r.entry.kind === kind && r.entry.key === key ? tracker : null;
  };
  return { claims, resolve, current };
}
