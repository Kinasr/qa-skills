// @ts-check
// The shape of an Access note's fields (ADR-0015, ADR-0019), which `check-file` refuses a note
// outside of and `scout` reads a login from. Pure, and importing nothing but the dialect: it is apart
// from lib/access.mjs, which reads `train/access.md` through lib/training.mjs, so that `check-file`
// (reached from lib/knowledge-file.mjs, which lib/training.mjs loads files through) never imports back
// into the readers of the working tree.
import { isMap } from "./dialect.mjs";

/** @type {RegExp} */
export const PASSWORD_VIA = /^(env:[A-Z_][A-Z0-9_]*|file:\S+)$/;

/**
 * An Access note shape.
 * @typedef {{
 *   identifiers?: { user?: unknown, [key: string]: unknown } | unknown,
 *   via?: unknown,
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
