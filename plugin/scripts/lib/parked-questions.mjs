// @ts-check
// The Feature's Parked questions: numbered items under `## Open questions`, with their source
// lines. Indented continuation lines join the item they follow, as Publish's comments require.

/**
 * A section in a parsed Markdown file.
 * @typedef {{
 *   level: number,
 *   title: string,
 *   line: number,
 *   end: number,
 * }} MarkdownSection
 */

/**
 * A parsed Markdown file with sections and raw text.
 * @typedef {{
 *   sections: readonly MarkdownSection[],
 *   text: string,
 * }} FeatureMarkdownFile
 */

/**
 * A parked question item.
 * @typedef {{
 *   text: string,
 *   line: number,
 * }} ParkedQuestion
 */

/**
 * @param {FeatureMarkdownFile} file
 * @returns {ParkedQuestion[]}
 */
export function parkedQuestions(file) {
  const section = file.sections.find((s) => s.level === 2 && s.title === "Open questions");
  if (!section) return [];
  const out = [];
  const lines = file.text.replace(/\r\n/g, "\n").split("\n");
  for (let i = section.line; i < section.end; i++) {
    const line = lines[i];
    const item = /^\s*\d+\.\s+(.*\S)\s*$/.exec(line);
    if (item) out.push({ text: item[1], line: i + 1 });
    else if (out.length && /^\s+\S/.test(line)) out[out.length - 1].text += ` ${line.trim()}`;
  }
  return out;
}
