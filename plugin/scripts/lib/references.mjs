// @ts-check
// References: the material a Feature's knowledge was derived from,
// stored in its `sources` as a URI anyone can re-resolve from a fresh clone.
//
//   tracker:<key>     a tracker issue; its key matches `tracker.key_pattern`
//   file:<path>       a committed file, repo-relative
//   code:<path>       a source file, repo-relative; file-scoped, never a directory
//   url:<http(s) URL>
//   human:<name>      what a person settled in conversation (an actor, not fetched)
//
// This module parses a reference and resolves what can be resolved locally. Tracker issues and URLs
// are the agent's to fetch; the CLI only checks their shape.
import { statSync } from "node:fs";
import { isAbsolute, join, posix } from "node:path";
import { isTracked } from "./git.mjs";

const KINDS = ["tracker", "file", "code", "url", "human"];

const HUMAN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Whether `uri` is a well-formed Reference, by shape alone: the check for a `sources` entry already
// written. Returns an error message, or null when it is well formed.
/**
 * @param {unknown} uri
 * @param {{ trackerPattern?: RegExp | null }} options
 * @returns {string | null}
 */
export function referenceShapeError(uri, { trackerPattern }) {
  if (typeof uri !== "string") return "a Reference is a string";
  const m = uri.match(/^([a-z]+):(.*)$/);
  if (!m || !KINDS.includes(m[1])) return `\`${uri}\` is not a Reference: use tracker:, file:, code:, url: or human:`;
  const [, kind, rest] = m;
  if (kind === "tracker") {
    if (!trackerPattern) return `\`${uri}\` names a tracker issue, but no tracker is configured in project.md`;
    if (!trackerPattern.test(rest)) return `\`${rest}\` does not match the tracker's key pattern`;
  }
  if (kind === "file" || kind === "code") return pathError(rest);
  if (kind === "url" && !isWebUrl(rest)) return `\`${rest}\` is not an http or https URL`;
  if (kind === "human" && !HUMAN.test(rest)) return "`human:` needs a name, such as `human:librarian`";
  return null;
}

/**
 * Resolved reference status.
 * @typedef {"resolved" | "pending" | "conversation" | "failed"} ReferenceStatus
 */

/**
 * Result of resolving a reference.
 * @typedef {{
 *   input: string,
 *   uri: string | null,
 *   kind: string | null,
 *   inferred: boolean,
 *   status: ReferenceStatus,
 *   error?: string,
 *   path?: string,
 *   warnings?: readonly string[],
 * }} ResolvedReference
 */

/**
 * Options for resolveReference.
 * @typedef {{
 *   repo: string,
 *   trackerPattern?: RegExp | null,
 *   modulePaths: readonly string[],
 * }} ResolveReferenceOptions
 */

// One reference as the engineer typed it, classified and, where the CLI can, resolved against the
// repository under test (`repo`). A bare input is inferred: a URL, a tracker key, or an existing
// path (`code:` under a `module_paths` root, else `file:`), and is marked `inferred`.
//
// `status` is `resolved` (a local file, read to completion), `pending` (well formed; the agent
// fetches it), `conversation` (`human:`, nothing to fetch) or `failed`, with `error` saying why.
/**
 * @param {string} input
 * @param {ResolveReferenceOptions} options
 * @returns {ResolvedReference}
 */
export function resolveReference(input, { repo, trackerPattern, modulePaths }) {
  /** @type {{ input: string, uri: string | null, kind: string | null, inferred: boolean }} */
  const out = { input, uri: null, kind: null, inferred: false };
  /**
   * @param {string} error
   * @returns {ResolvedReference}
   */
  const fail = (error) => ({ ...out, status: "failed", error });

  let uri = input;
  if (isWebUrl(input)) {
    uri = `url:${input}`;
    out.inferred = true;
  } else if (!/^[a-z]+:/.test(input)) {
    if (trackerPattern?.test(input)) uri = `tracker:${input}`;
    else if (isLocalFile(repo, input)) uri = `${underAny(input, modulePaths) ? "code" : "file"}:${posix.normalize(input)}`;
    else return fail(`\`${input}\` is not a Reference: no tracker key, URL or file in the repository matches it`);
    out.inferred = true;
  }
  out.uri = uri;
  const error = referenceShapeError(uri, { trackerPattern });
  const kind = uri.slice(0, uri.indexOf(":"));
  if (KINDS.includes(kind)) out.kind = kind;
  if (error) return fail(error);

  const rest = uri.slice(kind.length + 1);
  if (kind === "tracker" || kind === "url") return { ...out, status: "pending" };
  if (kind === "human") return { ...out, status: "conversation" };

  const path = posix.normalize(rest);
  let st;
  try {
    st = statSync(join(repo, path));
  } catch {
    return fail(`no such file in the repository: ${path}`);
  }
  if (!st.isFile()) return fail(`\`${path}\` is a directory; a ${kind}: Reference names one file`);
  /** @type {ResolvedReference} */
  const resolved = { ...out, status: "resolved", path };
  if (!isTracked(repo, path)) resolved.warnings = ["untracked"];
  return resolved;
}

// An http(s) URL, written without whitespace so it stays one token in `sources`.
/**
 * @param {string} s
 * @returns {boolean}
 */
function isWebUrl(s) {
  if (!/^https?:\/\/\S+$/.test(s)) return false;
  try {
    return ["http:", "https:"].includes(new URL(s).protocol);
  } catch {
    return false;
  }
}

// A repo-relative path that stays inside the repository.
/**
 * @param {string} p
 * @returns {string | null}
 */
function pathError(p) {
  if (!p) return "a file Reference needs a repo-relative path";
  if (isAbsolute(p) || p.startsWith("/")) return `\`${p}\` is absolute; a Reference path is repo-relative`;
  const n = posix.normalize(p);
  if (n === ".." || n.startsWith("../")) return `\`${p}\` leaves the repository`;
  return null;
}

/**
 * @param {string} repo
 * @param {string} p
 * @returns {boolean}
 */
function isLocalFile(repo, p) {
  if (pathError(p)) return false;
  try {
    return statSync(join(repo, p)).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} p
 * @param {readonly string[]} roots
 * @returns {boolean}
 */
function underAny(p, roots) {
  const n = posix.normalize(p);
  return roots.some((r) => {
    const root = posix.normalize(r).replace(/\/$/, "");
    return n === root || n.startsWith(`${root}/`);
  });
}
