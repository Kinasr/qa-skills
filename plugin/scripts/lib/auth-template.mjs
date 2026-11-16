// @ts-check
// The Auth template (ADR-0060): `.qa/auth.example`, written by the CLI from the Access notes. Each
// `auth:KEY` any note names is listed once, sorted, its value blank, with a comment line per note that
// uses it. Pure: it reads notes, never a file, so `check` and the writer produce the same text.
import { isMap } from "./dialect.mjs";

/** @type {RegExp} */
export const AUTH_KEY = /^[A-Z_][A-Z0-9_]*$/;

// The `via`-family fields of an Access note that may name an Auth-file key, and what each holds.
/** @type {Record<string, string>} */
const FIELDS = { via: "password", header_via: "header credential", expired_via: "expired header credential" };

/** @typedef {{ key: string, data: Record<string, unknown> }} AuthNote */

/**
 * The key an `auth:` source names, or null when the source is another kind or the key's shape is wrong.
 * @param {unknown} source
 * @returns {string | null}
 */
export function authKeyOf(source) {
  if (typeof source !== "string" || !source.startsWith("auth:")) return null;
  const key = source.slice("auth:".length);
  return AUTH_KEY.test(key) ? key : null;
}

/**
 * Every Auth-file key the notes name, sorted.
 * @param {readonly AuthNote[]} notes
 * @returns {string[]}
 */
export const authKeysNeeded = (notes) => [...new Set(notes.flatMap((n) => Object.keys(FIELDS).map((f) => authKeyOf(n.data[f])).filter((k) => k !== null)))].sort();

/** @param {unknown} text @returns {string} */
const oneLine = (text) => String(text).replace(/\s+/g, " ").trim();

/**
 * The template's text, or null when no note names an `auth:` key.
 * @param {readonly AuthNote[]} notes
 * @returns {string | null}
 */
export function authTemplate(notes) {
  const keys = authKeysNeeded(notes);
  if (!keys.length) return null;
  const blocks = keys.map((key) => {
    const uses = [...notes].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).flatMap((n) => Object.entries(FIELDS)
      .filter(([field]) => authKeyOf(n.data[field]) === key)
      .map(([field, what]) => {
        const ids = isMap(n.data.identifiers) ? n.data.identifiers : {};
        const who = [typeof n.data.role === "string" && n.data.role ? `Role ${oneLine(n.data.role)}` : "no Role", ...(typeof ids.user === "string" && ids.user ? [`user ${oneLine(ids.user)}`] : [])].join(", ");
        const from = typeof n.data.credential_from === "string" && n.data.credential_from.trim() ? `; from: ${oneLine(n.data.credential_from)}` : "";
        return `# ${n.key} (${who}): ${what}${from}`;
      }));
    return [...uses, `${key}=`].join("\n");
  });
  return `${[
    "# Auth template: written by the CLI from train/access.md. Do not edit it by hand.",
    "# Copy this file to `.qa/auth` in the main checkout and fill in each value. `.qa/auth` is git-ignored.",
    "# Lines are KEY=value, read literally: no quotes, and an empty value counts as missing.",
    "",
    blocks.join("\n\n"),
  ].join("\n")}\n`;
}

/**
 * The keys of a template that carry a value, by name only.
 * @param {string} text
 * @returns {string[]}
 */
export function templateKeysWithValue(text) {
  return text.split(/\r?\n/).flatMap((line) => {
    const m = /^([A-Z_][A-Z0-9_]*)=(.+)$/.exec(line);
    return m ? [m[1]] : [];
  });
}
