// @ts-check
// Ordered, labelled report sections shared across commands (ADR-0071).
// Every command declares its reading order and pre-written labels as `SectionSpec[]`, passes its
// section inputs to `buildSections`, and emits only non-empty sections in that order.

/**
 * One declared section slot: its stable `id` and pre-written `label` for the model to word.
 * @typedef {{ readonly id: string, readonly label: string }} SectionSpec
 */

/**
 * Section input carrying a pre-rendered Markdown block or table.
 * @typedef {{ readonly id: string, readonly markdown: string | null, readonly next?: string | null }} MarkdownSectionInput
 */

/**
 * Section input carrying structured data items.
 * @typedef {{ readonly id: string, readonly items: readonly unknown[], readonly next?: string | null }} ItemsSectionInput
 */

/**
 * Section input before label resolution and empty-section filtering.
 * @typedef {MarkdownSectionInput | ItemsSectionInput} SectionInput
 */

/**
 * Emitted Markdown section with its pre-written label and optional handoff command.
 * @typedef {{ id: string, markdown: string, label: string, next?: string }} ReportMarkdownSection
 */

/**
 * Emitted item-list section with its pre-written label and optional handoff command.
 * @typedef {{ id: string, items: unknown[], label: string, next?: string }} ReportItemsSection
 */

/**
 * One ordered, labelled section in a command's JSON output.
 * @typedef {ReportMarkdownSection | ReportItemsSection} ReportSection
 */

/**
 * Filter empty section inputs, attach each section's pre-written label from `order`, and emit
 * non-empty sections in `order`.
 * @param {readonly SectionSpec[]} order
 * @param {readonly SectionInput[]} inputs
 * @returns {ReportSection[]}
 */
export function buildSections(order, inputs) {
  /** @type {Map<string, string>} */
  const labels = new Map();
  for (const spec of order) {
    if (labels.has(spec.id)) throw new Error(`duplicate section id in order: ${spec.id}`);
    if (typeof spec.label !== "string" || spec.label.trim().length === 0) {
      throw new Error(`empty section label for: ${spec.id}`);
    }
    labels.set(spec.id, spec.label);
  }
  /** @type {Set<string>} */
  const seenInputs = new Set();
  /** @type {Map<string, ReportSection>} */
  const byId = new Map();
  for (const input of inputs) {
    const label = labels.get(input.id);
    if (label === undefined) throw new Error(`unknown section id: ${input.id}`);
    if (seenInputs.has(input.id)) throw new Error(`duplicate section input: ${input.id}`);
    seenInputs.add(input.id);
    const isMarkdown = "markdown" in input;
    const hasBody = isMarkdown
      ? typeof input.markdown === "string" && input.markdown.trim().length > 0
      : input.items.length > 0;
    if (!hasBody) continue;
    const next = typeof input.next === "string" && input.next.trim().length > 0 ? input.next : undefined;
    byId.set(
      input.id,
      isMarkdown
        ? { id: input.id, markdown: /** @type {string} */ (input.markdown), label, ...(next ? { next } : {}) }
        : { id: input.id, items: [...input.items], label, ...(next ? { next } : {}) },
    );
  }
  return order.flatMap((s) => {
    const entry = byId.get(s.id);
    return entry ? [entry] : [];
  });
}

/**
 * Items of the named section from a report, or empty when absent or Markdown-only.
 * @param {{ sections: readonly ReportSection[] }} report
 * @param {string} id
 * @returns {unknown[]}
 */
export function sectionItems(report, id) {
  const found = report.sections.find((s) => s.id === id);
  return found && "items" in found ? found.items : [];
}
