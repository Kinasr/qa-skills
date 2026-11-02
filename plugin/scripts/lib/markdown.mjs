// @ts-check
// Splits a `.qa/` markdown file into its frontmatter and the body elements the schema reads:
// ATX headings and fenced blocks, in order. Headings inside a fence are not headings. No markdown
// AST: every structured heading is one line-anchored regex.

/**
 * Frontmatter extracted from a Markdown file.
 * @typedef {{
 *   text: string,
 *   firstLine: number,
 *   endLine: number,
 * }} MarkdownFrontmatter
 */

/**
 * A fenced code block element.
 * @typedef {{
 *   kind: "fence",
 *   lang: string,
 *   line: number,
 *   text: string,
 *   firstLine: number,
 *   endLine: number,
 * }} MarkdownFenceElement
 */

/**
 * A heading element.
 * @typedef {{
 *   kind: "heading",
 *   level: number,
 *   text: string,
 *   line: number,
 * }} MarkdownHeadingElement
 */

/**
 * A parsed Markdown element: a fence or heading.
 * @typedef {MarkdownFenceElement | MarkdownHeadingElement} MarkdownElement
 */

/**
 * An error found while splitting a Markdown file.
 * @typedef {{
 *   code?: string,
 *   line: number,
 *   message: string,
 * }} MarkdownError
 */

/**
 * The split result of a Markdown file.
 * @typedef {{
 *   frontmatter: MarkdownFrontmatter | null,
 *   elements: MarkdownElement[],
 *   errors: MarkdownError[],
 * }} MarkdownSplitResult
 */

/**
 * @param {string} raw
 * @returns {MarkdownSplitResult}
 */
export function splitFile(raw) {
  const text = raw.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  /** @type {MarkdownError[]} */
  const errors = [];
  // A git conflict hunk left in the file, anywhere, fences included: the file is mid-merge and
  // nothing in it can be trusted to mean one thing.
  let inHunk = false;
  lines.forEach((l, i) => {
    if (/^<{7}(?: |$)/.test(l) || (!inHunk && /^(?:\|{7}|>{7})(?: |$)/.test(l))) {
      errors.push({ code: "conflict_marker", line: i + 1, message: "a git conflict marker: resolve the merge before anything reads this file" });
      inHunk = true;
    } else if (/^>{7}(?: |$)/.test(l)) {
      inHunk = false;
    }
  });
  /** @type {MarkdownFrontmatter | null} */
  let frontmatter = null;
  let start = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end === -1) {
      errors.push({ line: 1, message: "frontmatter is not closed with `---`" });
      return { frontmatter, elements: [], errors };
    }
    frontmatter = { text: lines.slice(1, end).join("\n"), firstLine: 2, endLine: end + 1 };
    start = end + 1;
  }
  /** @type {MarkdownElement[]} */
  const elements = [];
  for (let i = start; i < lines.length; i++) {
    const open = lines[i].match(/^(`{3,}|~{3,})\s*([^\s`~]*)/);
    if (open) {
      const fence = open[1];
      const close = new RegExp(`^${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) j++;
      if (j >= lines.length) errors.push({ line: i + 1, message: "a fenced block is not closed" });
      elements.push({
        kind: "fence",
        lang: open[2],
        line: i + 1,
        text: lines.slice(i + 1, j).join("\n"),
        firstLine: i + 2,
        endLine: Math.min(j + 1, lines.length), // the closing fence, or the last line if unclosed
      });
      i = j;
      continue;
    }
    const h = lines[i].match(/^(#{1,6})\s+(.*?)\s*$/);
    if (h) elements.push({ kind: "heading", level: h[1].length, text: h[2], line: i + 1 });
  }
  return { frontmatter, elements, errors };
}

// `<key>: <text>` as one heading's text, or null.
/**
 * @param {string} text
 * @returns {{ key: string, text: string } | null}
 */
export function keyedHeading(text) {
  const m = text.match(/^([^\s:]+): +(.*\S.*)$/);
  return m ? { key: m[1], text: m[2] } : null;
}

// Prose from outside the layer (a tracker's fields, a Delegate's reply) as lines that stay inside
// their case: a line that would read as a heading or a conflict marker is escaped, and so is every
// fence line when a fence is left open, since an open fence would swallow the rest of the file.
/**
 * @param {string} text
 * @returns {string[]}
 */
export function proseLines(text) {
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n").map((l) => l.replace(/\s+$/, "").replace(/^(#|<{7}|>{7}|\|{7})/, "\\$1"));
  const open = splitFile(lines.join("\n")).errors.some((e) => /fenced block is not closed/.test(e.message));
  return open ? lines.map((l) => l.replace(/^(`{3,}|~{3,})/, "\\$1")) : lines;
}

// Compact Markdown for bulky data; callers choose how absent values are displayed.
/**
 * @param {readonly string[]} headers
 * @param {readonly (readonly unknown[])[]} rows
 * @param {{ empty?: string }} [options]
 * @returns {string | null}
 */
export function table(headers, rows, { empty = "none" } = {}) {
  if (!rows.length) return null;
  const cell = (/** @type {unknown} */ v) => (v === null || v === undefined ? empty : Array.isArray(v) ? v.join(", ") || empty : String(v)).replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
  return [headers, headers.map(() => "---"), ...rows].map((row) => `| ${row.map(cell).join(" | ")} |`).join("\n");
}

// A compact enumeration for procedural briefs and tracker diagnostics.
/**
 * @param {readonly (string | number)[]} xs
 * @param {string} [joiner]
 * @returns {string}
 */
export function list(xs, joiner = "and") {
  return xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${joiner} ${xs.at(-1)}`;
}
