// @ts-check
// The shape of an Access note's fields (ADR-0015, ADR-0019), which `check-file` refuses a note
// outside of and `scout` reads a login from. Pure, and importing nothing but the dialect: it is apart
// from lib/access.mjs, which reads `train/access.md` through lib/training.mjs, so that `check-file`
// (reached from lib/knowledge-file.mjs, which lib/training.mjs loads files through) never imports back
// into the readers of the working tree.
import { posix } from "node:path";
import { isMap } from "./dialect.mjs";

/** @type {RegExp} */
export const PASSWORD_VIA = /^(env:[A-Z_][A-Z0-9_]*|auth:[A-Z_][A-Z0-9_]*|file:\S+)$/;

/**
 * Whether `value` is a clean repo-relative POSIX path without leading slashes, drive prefixes,
 * home tildes, backslashes, or `.` / `..` traversal segments.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isRepoRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.trim() !== value) return false;
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || /^[A-Za-z]:/.test(value)) return false;
  if (value === "~" || value.startsWith("~/")) return false;
  if (value.split("/").some((segment) => segment === "." || segment === "..")) return false;
  const normalized = posix.normalize(value);
  return normalized !== "." && normalized !== "..";
}

/** @type {RegExp} */
export const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** @type {RegExp} */
export const HEADER_VIA = /^(env|auth):[A-Z_][A-Z0-9_]*$/;

// The `via` of a note that logs in as nobody: an app test account tagged with a Role, whose session
// opens with no login (ADR-0063).
/** @type {string} */
export const NO_LOGIN_VIA = "none";

/** @param {AccessNote | null | undefined} note @returns {boolean} */
export const isNoLogin = (note) => note?.via === NO_LOGIN_VIA;

/** @param {unknown} name @returns {name is string} */
export const isCredentialHeaderName = (name) => typeof name === "string" && HEADER_TOKEN.test(name) && !["cookie", "host", "proxy-authorization"].includes(name.toLowerCase());

/** @param {unknown} source @returns {source is string} */
export const isHeaderCredentialSource = (source) => typeof source === "string" && HEADER_VIA.test(source);

/** @param {unknown} scheme @returns {boolean} */
export const isHeaderCredentialScheme = (scheme) => scheme === undefined || (typeof scheme === "string" && HEADER_TOKEN.test(scheme));

/**
 * `name` is the env variable or Auth-file key; `source` says which (ADR-0060).
 * @typedef {{ header: string, scheme?: string, name: string, source: "env" | "auth" }} HeaderCredential
 */

/**
 * Non-secret metadata only. The credential itself is resolved inside the CLI.
 * @param {AccessNote | null | undefined} note
 * @returns {HeaderCredential | null}
 */
export function headerCredential(note) {
  const ids = isMap(note?.identifiers) ? note.identifiers : {};
  if (!isHeaderCredentialSource(note?.header_via) || !isCredentialHeaderName(ids.header)) return null;
  if (!isHeaderCredentialScheme(ids.scheme)) return null;
  return { header: ids.header, ...(typeof ids.scheme === "string" && { scheme: ids.scheme }), ...credentialSource(note.header_via) };
}

// The name a `env:NAME` or `auth:KEY` source holds, and which of the two it is.
/**
 * @param {string} via
 * @returns {{ name: string, source: "env" | "auth" }}
 */
export const credentialSource = (via) => via.startsWith("auth:") ? { name: via.slice("auth:".length), source: "auth" } : { name: via.slice("env:".length), source: "env" };

/** @param {AccessNote | null | undefined} note @returns {boolean} */
export const isHeaderOnly = (note) => note?.header_via !== undefined && note.via === undefined;

/**
 * An Access note shape.
 * @typedef {{
 *   identifiers?: { user?: unknown, [key: string]: unknown } | unknown,
 *   via?: unknown,
 *   expired_via?: unknown,
 *   [key: string]: unknown,
 * }} AccessNote
 */

// A CLI login (ADR-0019): a note for the app under test that names `identifiers.user` and a
// `via` holding a password, an environment variable or a file. `cliLoginUser(note)` is that user, or
// null for any other note; `check-file` and `scout brief ui` both decide with it.
/**
 * @param {AccessNote | null | undefined} note
 * @returns {string | null}
 */
export function cliLoginUser(note) {
  const user = isMap(note?.identifiers) ? note.identifiers.user : undefined;
  return typeof user === "string" && user && typeof (/** @type {AccessNote} */ (note)).via === "string" && PASSWORD_VIA.test(/** @type {string} */ ((/** @type {AccessNote} */ (note)).via)) ? user : null;
}

// A `match` prefix's shape (`check-file` refuses any other): `tracker:` (all of the tracker) or
// `tracker:DEMO-` (one project), or an http(s) URL prefix with at least its host. Never `file:` or
// `code:`, which are local and need no login.
const MATCH_PREFIX = /^(tracker:\S*|url:https?:\/\/[^\s/]\S*)$/;
/**
 * @param {unknown} m
 * @returns {boolean}
 */
export const isMatchPrefix = (m) => typeof m === "string" && MATCH_PREFIX.test(m);

/**
 * A sign-in URL as `origin + path`, the form a route's login check compares: an absolute http(s)
 * URL with no credentials, resolved against `base` when given; else null.
 * @param {unknown} value
 * @param {string} [base]
 * @returns {string | null}
 */
export function signInUrl(value, base) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = base === undefined ? new URL(value) : new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}
