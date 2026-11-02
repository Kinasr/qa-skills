// @ts-check
// Writing values in the `.qa/` YAML dialect (lib/dialect.mjs): for lib/knowledge-file.mjs's `edit`,
// and for the writers that build a whole new entry or file. Every rendered line is parsed back and
// compared with the value it was meant to hold, so a value the dialect cannot express (a line break
// inside a quoted string, say) is refused instead of written as something else.
import { isDeepStrictEqual } from "node:util";
import { isMap, parseYaml } from "./dialect.mjs";

const RESERVED = /^(true|false|null|-?\d+(\.\d+)?)$/;

/**
 * @param {string} s
 * @returns {string}
 */
export const quote = (s) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

// A string as an unquoted token when it reads back as itself, else double-quoted. An inner colon
// is legal unquoted (`tracker:DEMO-1`, `script:qa-sync`); `line` confirms each read-back.
/**
 * @param {string} s
 * @returns {string}
 */
export function token(s) {
  return /^[A-Za-z0-9_.-]([A-Za-z0-9_.:-]*[A-Za-z0-9_.-])?$/.test(s) && !RESERVED.test(s) ? s : quote(s);
}

// A role name: a token only when it is one word (e.g. `[Librarian, "Branch Manager"]`).
/**
 * @param {string} s
 * @returns {string}
 */
export const role = (s) => (/^[A-Za-z0-9_]+$/.test(s) && !RESERVED.test(s) ? s : quote(s));

/**
 * Options for inline and line rendering.
 * @typedef {{
 *   strings?: readonly string[],
 *   item?: (s: string) => string,
 * }} RenderOptions
 */

/**
 * Result of line rendering.
 * @typedef {{
 *   text: string,
 *   error?: never,
 * } | {
 *   text?: never,
 *   error: string,
 * }} RenderLineResult
 */

// Any value the dialect holds on one line. `strings` names the map fields whose strings are always
// quoted (the Mirrored prose-like values), `lists` how a list's items are written.
/**
 * @param {unknown} v
 * @param {RenderOptions} [options]
 * @returns {string}
 */
export function inline(v, { strings = [], item = token } = {}) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") return token(v);
  if (Array.isArray(v)) return `[${v.map((x) => (typeof x === "string" ? item(x) : inline(x))).join(", ")}]`;
  if (isMap(v)) {
    /** @param {[string, unknown]} param0 */
    const entry = ([k, x]) => `${k}: ${typeof x === "string" && strings.includes(k) ? quote(x) : inline(x, { item: k === "roles" ? role : token })}`;
    return `{${Object.entries(v).map(entry).join(", ")}}`;
  }
  throw new Error(`cannot write ${typeof v} in the dialect`);
}

// `field: value` as one line, or an error message when it would not read back as `value`.
/**
 * @param {string} field
 * @param {unknown} value
 * @param {RenderOptions} [options]
 * @returns {RenderLineResult}
 */
export function line(field, value, options) {
  const text = `${field}: ${inline(value, options)}`;
  const back = parseYaml(text);
  if (back.errors.length || !isDeepStrictEqual(back.data[field], value)) {
    return { error: `\`${field}\` cannot be written in the YAML dialect: ${JSON.stringify(value)}` };
  }
  return { text };
}

// `field` and a list of maps as a block list, one map per line, or an error message when it would
// not read back as `value`.
/**
 * @param {string} field
 * @param {readonly unknown[]} value
 * @param {RenderOptions} [options]
 * @returns {RenderLineResult}
 */
export function block(field, value, options) {
  const error = { error: `\`${field}\` cannot be written in the YAML dialect: ${JSON.stringify(value)}` };
  try {
    const text = [`${field}:`, ...value.map((x) => `  - ${inline(x, options)}`)].join("\n");
    const back = parseYaml(text);
    return back.errors.length || !isDeepStrictEqual(back.data[field], value) ? error : { text };
  } catch {
    return error;
  }
}
