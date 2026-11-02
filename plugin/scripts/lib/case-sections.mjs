// @ts-check
// Partition case prose at unfenced bold labels. Unknown labels end an owned section too.
/**
 * @typedef {"lead" | "preconditions" | "steps" | "expected" | "other"} CaseSectionKind
 * @param {Array<{text: string, labelEligible: boolean}>} lines
 * @returns {Array<{kind: CaseSectionKind, start: number, end: number, labelEnd: number}>} Zero-based, end exclusive;
 *   `labelEnd` is the length of the section's leading bold label (and the spaces after it) on its
 *   first line, so a reader can strip the label without parsing it again.
 */
export function caseSectionRanges(lines) {
  /** @type {Array<{kind: CaseSectionKind, start: number, end: number, labelEnd: number}>} */
  const ranges = [];
  /** @type {CaseSectionKind} */
  let kind = "lead";
  let start = 0;
  let labelEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].labelEligible || !/^\*\*[^*]+\*\*/.test(lines[i].text)) continue;
    if (i > start) ranges.push({ kind, start, end: i, labelEnd });
    const label = /^\*\*(Preconditions|Steps|Expected result)\.\*\*/i.exec(lines[i].text);
    kind = label ? /** @type {CaseSectionKind} */ ({ preconditions: "preconditions", steps: "steps", "expected result": "expected" }[label[1].toLowerCase()]) : "other";
    start = i;
    labelEnd = /^\*\*[^*]+\*\*[ \t]*/.exec(lines[i].text)?.[0].length ?? 0;
  }
  if (start < lines.length) ranges.push({ kind, start, end: lines.length, labelEnd });
  return ranges;
}
