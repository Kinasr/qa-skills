// @ts-check
// The `.qa/` YAML dialect.
//
// A value is one of:
//   (a) a scalar: unquoted token, double-quoted string, boolean, number or `null`;
//   (b) an inline list of scalars;
//   (c) a block or flow map whose values are (a) or (b);
//   (d) a block list of scalars;
//   (e) a block list of maps whose values are (a), (b) or (c).
// Inside double quotes `,` `:` `#` are literal, and `\"` and `\\` are the only escapes. Block
// scalars, anchors and aliases, tags, comments, unquoted colons in values, the key `__proto__` and
// any deeper nesting are outside it.
//
// parseYaml never throws: it returns what it could read plus a list of `{code, line, message}` errors, so
// a file outside the dialect is reported rather than crashing the caller.

/**
 * An error produced during YAML dialect parsing.
 * @typedef {{
 *   code: string,
 *   line: number,
 *   message: string,
 * }} YamlError
 */

/**
 * Result of parsing a YAML dialect text into a map and errors.
 * @typedef {{
 *   data: Record<string, unknown>,
 *   errors: YamlError[],
 *   keyLines: Record<string, number>,
 * }} YamlParseResult
 */

/**
 * Internal parsing state.
 * @typedef {{
 *   lines: Array<{ line: number, indent: number, body: string }>,
 *   i: number,
 *   errors: YamlError[],
 *   keyLines: Record<string, number>,
 * }} ParseState
 */

/**
 * Nesting level constraints.
 * @typedef {{
 *   map: "FLAT" | null,
 *   blockList: boolean,
 * }} NestingLevel
 */

// What a value may be, by where it sits. TOP is a document's own entries; ITEM is the entries of a
// map that is a block-list item; FLAT is the entries of any other map.
/** @type {NestingLevel} */
const TOP = { map: "FLAT", blockList: true };
/** @type {NestingLevel} */
const ITEM = { map: "FLAT", blockList: false };
/** @type {NestingLevel} */
const FLAT = { map: null, blockList: false };
/** @type {Record<string, NestingLevel>} */
const LEVEL = { TOP, ITEM, FLAT };

const KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// What ends a line: the four JavaScript line terminators, which a scenario file's heading pattern
// (`# <key>: <summary>`) does not match across. A value that sits on one line, a summary or a JSON decision's
// `reason`, holds none.
export const LINE_BREAK = /[\r\n\u2028\u2029]/;

// Whether `s` is a legal key: a letter or underscore, then letters, digits, `_` and `-`.
/**
 * @param {string} s
 * @returns {boolean}
 */
export const isKey = (s) => KEY.test(s);

// A parsed map (block or flow), as opposed to a list or a scalar.
/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
export const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// String entries of a list field; malformed or absent values contribute none.
/**
 * @param {unknown} v
 * @returns {string[]}
 */
export const listOf = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/**
 * @param {string} text
 * @param {number} [firstLine]
 * @returns {YamlParseResult}
 */
export function parseYaml(text, firstLine = 1) {
  /** @type {YamlError[]} */
  const errors = [];
  /** @type {Array<{ line: number, indent: number, body: string }>} */
  const lines = [];
  text.split("\n").forEach((raw, i) => {
    const line = firstLine + i;
    if (!raw.trim()) return;
    const indent = (/** @type {RegExpMatchArray} */ (raw.match(/^ */)))[0].length;
    const body = raw.slice(indent).replace(/\s+$/, "");
    if (body.startsWith("\t")) return errors.push({ code: "dialect", line, message: "tab in indentation" });
    if (body.startsWith("#")) return errors.push({ code: "dialect", line, message: "comments are outside the dialect" });
    lines.push({ line, indent, body });
  });
  /** @type {ParseState} */
  const state = { lines, i: 0, errors, keyLines: {} };
  const data = parseBlockMap(state, 0, TOP);
  for (; state.i < lines.length; state.i++) {
    errors.push({ code: "dialect", line: lines[state.i].line, message: "unexpected indentation" });
  }
  // keyLines: the line each top-level key is declared on, for error reports.
  return { data, errors, keyLines: state.keyLines };
}

/**
 * @param {ParseState} state
 * @param {number} line
 * @param {string} message
 * @param {string} [code]
 */
function err(state, line, message, code = "dialect") {
  state.errors.push({ code, line, message });
}

// Entries `key: value` at exactly `indent`, until a line at a shallower indent.
/**
 * @param {ParseState} state
 * @param {number} indent
 * @param {NestingLevel} level
 * @param {{ line: number, text: string }} [firstEntry]
 * @returns {Record<string, unknown>}
 */
function parseBlockMap(state, indent, level, firstEntry) {
  /** @type {Record<string, unknown>} */
  const map = {};
  const seen = new Set();
  /**
   * @param {number} line
   * @param {string} text
   */
  const entry = (line, text) => {
    const m = text.match(/^([^\s:"'{}[\],#]+):(?:\s+(.*))?$/);
    if (!m || !KEY.test(m[1])) return err(state, line, `not a \`key: value\` line: ${text}`);
    const key = m[1];
    if (key === "__proto__") return err(state, line, "the key `__proto__` is outside the dialect");
    if (seen.has(key)) err(state, line, `key \`${key}\` declared twice`, "duplicate");
    seen.add(key);
    if (level === TOP) state.keyLines[key] ??= line;
    const rest = (m[2] ?? "").trim();
    map[key] = rest ? parseInline(state, line, rest, LEVEL[/** @type {string} */ (level.map)]) : parseChildBlock(state, line, indent, level, key);
  };
  if (firstEntry) entry(firstEntry.line, firstEntry.text);
  while (state.i < state.lines.length) {
    const l = state.lines[state.i];
    if (l.indent < indent) break;
    if (l.indent > indent) {
      err(state, l.line, "unexpected indentation");
      state.i++;
      continue;
    }
    state.i++;
    entry(l.line, l.body);
  }
  return map;
}

// The block under a `key:` with nothing after the colon.
/**
 * @param {ParseState} state
 * @param {number} line
 * @param {number} indent
 * @param {NestingLevel} level
 * @param {string} key
 * @returns {unknown}
 */
function parseChildBlock(state, line, indent, level, key) {
  const next = state.lines[state.i];
  if (!next || next.indent <= indent) {
    err(state, line, `\`${key}\` has no value; write \`null\` for no value`);
    return null;
  }
  if (next.body === "-" || next.body.startsWith("- ")) {
    if (!level.blockList) {
      err(state, next.line, "a block list nested this deep is outside the dialect");
      skipDeeper(state, indent);
      return null;
    }
    return parseBlockList(state, next.indent);
  }
  if (!level.map) {
    err(state, next.line, "a map nested this deep is outside the dialect");
    skipDeeper(state, indent);
    return null;
  }
  return parseBlockMap(state, next.indent, LEVEL[/** @type {string} */ (level.map)]);
}

/**
 * @param {ParseState} state
 * @param {number} indent
 */
function skipDeeper(state, indent) {
  while (state.i < state.lines.length && state.lines[state.i].indent > indent) state.i++;
}

// Items `- ...` at exactly `indent`: all scalars, or all maps.
/**
 * @param {ParseState} state
 * @param {number} indent
 * @returns {unknown[]}
 */
function parseBlockList(state, indent) {
  /** @type {unknown[]} */
  const list = [];
  let kind = null;
  while (state.i < state.lines.length) {
    const l = state.lines[state.i];
    if (l.indent < indent) break;
    if (l.indent > indent || !(l.body === "-" || l.body.startsWith("- "))) {
      err(state, l.line, l.indent > indent ? "unexpected indentation" : "expected a `- ` list item");
      state.i++;
      continue;
    }
    state.i++;
    const text = l.body.slice(1).trim();
    let item, itemKind;
    if (!text) {
      err(state, l.line, "empty list item");
      continue;
    } else if (text.startsWith("{")) {
      item = parseInline(state, l.line, text, ITEM);
      itemKind = "map";
    } else if (text.startsWith("[")) {
      err(state, l.line, "a list inside a list is outside the dialect");
      continue;
    } else if (/^[^\s:"'{}[\],#]+:(\s|$)/.test(text)) {
      // A block map as the item: its keys line up one column past the dash.
      item = parseBlockMap(state, indent + (l.body.length - l.body.slice(1).trimStart().length), ITEM, {
        line: l.line,
        text,
      });
      itemKind = "map";
    } else {
      item = parseScalar(state, l.line, text, "block");
      itemKind = "scalar";
    }
    if (kind && kind !== itemKind) err(state, l.line, "a block list mixes scalars and maps");
    kind ??= itemKind;
    list.push(item);
  }
  return list;
}

// A value written on one line: a flow map, an inline list, or a scalar. `mapLevel` is what a flow
// map's own values may be here, or null where no map may sit.
/**
 * @param {ParseState} state
 * @param {number} line
 * @param {string} text
 * @param {NestingLevel} mapLevel
 * @returns {unknown}
 */
function parseInline(state, line, text, mapLevel) {
  const cur = { text, pos: 0 };
  let value;
  if (text.startsWith("{")) {
    if (!mapLevel) {
      err(state, line, "a map nested this deep is outside the dialect");
      return null;
    }
    value = flowMap(state, line, cur, mapLevel);
  } else if (text.startsWith("[")) {
    value = flowList(state, line, cur);
  } else {
    return parseScalar(state, line, text, "block");
  }
  if (value === undefined) return null;
  if (cur.text.slice(cur.pos).trim()) err(state, line, `unexpected text after the value: ${cur.text.slice(cur.pos)}`);
  return value;
}

/**
 * @param {{ text: string, pos: number }} cur
 */
function skipWs(cur) {
  while (cur.pos < cur.text.length && /\s/.test(cur.text[cur.pos])) cur.pos++;
}

/**
 * @param {ParseState} state
 * @param {number} line
 * @param {{ text: string, pos: number }} cur
 * @param {NestingLevel} level
 * @returns {Record<string, unknown> | undefined}
 */
function flowMap(state, line, cur, level) {
  /** @type {Record<string, unknown>} */
  const map = {};
  cur.pos++; // {
  skipWs(cur);
  if (cur.text[cur.pos] === "}") {
    cur.pos++;
    return map;
  }
  for (;;) {
    skipWs(cur);
    const km = cur.text.slice(cur.pos).match(/^([^\s:"'{}[\],#]+):(\s+|(?=[,}]))/);
    if (!km || !KEY.test(km[1])) {
      err(state, line, "a flow map entry is not `key: value`");
      return undefined;
    }
    const key = km[1];
    cur.pos += km[0].length;
    if (key === "__proto__") {
      err(state, line, "the key `__proto__` is outside the dialect");
      return undefined;
    }
    if (Object.hasOwn(map, key)) err(state, line, `key \`${key}\` declared twice`, "duplicate");
    const c = cur.text[cur.pos];
    if (c === "{") {
      if (!level.map) {
        err(state, line, "a map nested this deep is outside the dialect");
        return undefined;
      }
      map[key] = flowMap(state, line, cur, LEVEL[level.map]);
    } else if (c === "[") {
      map[key] = flowList(state, line, cur);
    } else {
      map[key] = flowScalar(state, line, cur, "}");
    }
    if (map[key] === undefined) return undefined;
    skipWs(cur);
    const d = cur.text[cur.pos++];
    if (d === "}") return map;
    if (d !== ",") {
      err(state, line, "a flow map is not closed with `}`");
      return undefined;
    }
  }
}

/**
 * @param {ParseState} state
 * @param {number} line
 * @param {{ text: string, pos: number }} cur
 * @returns {unknown[] | undefined}
 */
function flowList(state, line, cur) {
  /** @type {unknown[]} */
  const list = [];
  cur.pos++; // [
  skipWs(cur);
  if (cur.text[cur.pos] === "]") {
    cur.pos++;
    return list;
  }
  for (;;) {
    skipWs(cur);
    const c = cur.text[cur.pos];
    if (c === "[" || c === "{") {
      err(state, line, "an inline list holds scalars only");
      return undefined;
    }
    const v = flowScalar(state, line, cur, "]");
    if (v === undefined) return undefined;
    list.push(v);
    skipWs(cur);
    const d = cur.text[cur.pos++];
    if (d === "]") return list;
    if (d !== ",") {
      err(state, line, "an inline list is not closed with `]`");
      return undefined;
    }
  }
}

// A scalar inside `{…}` or `[…]`: runs to the next `,` or closing bracket outside quotes.
/**
 * @param {ParseState} state
 * @param {number} line
 * @param {{ text: string, pos: number }} cur
 * @param {string} close
 * @returns {unknown}
 */
function flowScalar(state, line, cur, close) {
  skipWs(cur);
  if (cur.text[cur.pos] === '"') {
    const q = readQuoted(state, line, cur);
    return q;
  }
  const start = cur.pos;
  while (cur.pos < cur.text.length && !",]}".includes(cur.text[cur.pos])) {
    if ("[{".includes(cur.text[cur.pos])) {
      err(state, line, "a nested collection is outside the dialect here");
      return undefined;
    }
    cur.pos++;
  }
  if (cur.pos >= cur.text.length) {
    err(state, line, `an inline collection is not closed with \`${close}\``);
    return undefined;
  }
  return parseScalar(state, line, cur.text.slice(start, cur.pos).trim(), "flow");
}

// A double-quoted scalar starting at cur.pos. `\"` and `\\` are the only escapes.
/**
 * @param {ParseState} state
 * @param {number} line
 * @param {{ text: string, pos: number }} cur
 * @returns {string | undefined}
 */
function readQuoted(state, line, cur) {
  let out = "";
  for (let p = cur.pos + 1; p < cur.text.length; p++) {
    const ch = cur.text[p];
    if (ch === "\\") {
      const next = cur.text[p + 1];
      if (next !== '"' && next !== "\\") {
        err(state, line, "`\\\"` and `\\\\` are the only escapes the dialect recognises");
        return undefined;
      }
      out += next;
      p++;
    } else if (ch === '"') {
      cur.pos = p + 1;
      return out;
    } else {
      out += ch;
    }
  }
  err(state, line, "unterminated double-quoted scalar");
  return undefined;
}

// One scalar's full text (already trimmed). `where` is "block" (after `key: ` or `- `) or "flow".
/**
 * @param {ParseState} state
 * @param {number} line
 * @param {string} text
 * @param {"block" | "flow"} where
 * @returns {unknown}
 */
function parseScalar(state, line, text, where) {
  if (text.startsWith('"')) {
    const cur = { text, pos: 0 };
    const v = readQuoted(state, line, cur);
    if (v === undefined) return null;
    if (cur.text.slice(cur.pos).trim()) err(state, line, `unexpected text after a quoted scalar: ${text}`);
    return v;
  }
  if (!text) {
    err(state, line, "empty scalar; write `null` or `\"\"`");
    return null;
  }
  const bad = scalarProblem(text, where);
  if (bad) {
    err(state, line, `${bad}: ${text}`);
    return null;
  }
  if (text === "null") return null;
  if (text === "true" || text === "false") return text === "true";
  // A number only if it round-trips: `0123456` or a 40-digit commit id stays the token it was
  // written as, rather than losing a leading zero or its precision.
  if (/^-?\d+(\.\d+)?$/.test(text) && String(Number(text)) === text) return Number(text);
  return text;
}

/**
 * @param {string} text
 * @param {"block" | "flow"} where
 * @returns {string | null}
 */
function scalarProblem(text, where) {
  if (/^[|>]/.test(text)) return "block scalars are outside the dialect";
  if (/^[&*]/.test(text)) return "anchors and aliases are outside the dialect";
  if (/^!/.test(text)) return "tags are outside the dialect";
  if (/^'/.test(text)) return "single-quoted scalars are outside the dialect; use double quotes";
  if (/^[%@`?]/.test(text) || /^- /.test(text)) return "a reserved indicator starts an unquoted scalar";
  if (/(^|\s)#/.test(text)) return "comments are outside the dialect";
  if (/:(\s|$)/.test(text)) return "an unquoted colon in a value is outside the dialect; quote it";
  if (where === "flow" && /"/.test(text)) return "a stray double quote in an unquoted scalar";
  if (where === "block" && /^[\]}]/.test(text)) return "an unopened bracket starts a scalar";
  return null;
}
