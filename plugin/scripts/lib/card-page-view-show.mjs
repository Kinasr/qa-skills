// @ts-check
import { immutableShow, showFilterState, showKeyLookup, showProvenanceText } from './card-page-client.mjs';
/** @typedef {import('./page.d.mts').ShowPageModel} ShowPageModel */
/** @typedef {import('./page.d.mts').ShowFeature} ShowFeature */
/** @typedef {import('./show-dom.d.mts').ShowSectionView} ShowSectionView */
/**
 * @param {ShowPageModel} model
 * @param {unknown} doc
 * @param {unknown} base
 * @param {readonly ShowSectionView[]} sections
 * @param {number} [rulesAfter] - feature sections before the Rules table; later ones follow it
 * @returns {void}
 */
export function mountShow(model, doc, base, sections, rulesAfter = sections.length) {
  const { app, header, node } = /** @type {import('./show-dom.d.mts').ShowMountContext} */ (base);
  immutableShow(model);
  const lookup = showKeyLookup(model);
  const filters = showFilterState();
  let keyTooltipId = 0;
  /** @type {Map<string, () => void>} */
  const featureOpeners = new Map();
  /** @type {Map<string, () => void>} */
  const caseOpeners = new Map();
  /** @type {import('./show-dom.d.mts').ShowRenderContext} */
  const ctx = {
    model, node, filters,
    filterChanged() {},
    lazy(parent, title, build) {
      const detail = node('details', undefined, parent);
      node('summary', title, detail);
      let mounted = false;
      const mount = () => {
        if (mounted) return;
        mounted = true;
        build(detail);
      };
      const open = () => { detail.open = true; mount(); };
      detail.addEventListener('toggle', () => { if (detail.open) mount(); });
      return { open, mount };
    },
    keyed(parent, text, feature) {
      const item = lookup[feature];
      let end = 0;
      for (const match of item?.matcher ? text.matchAll(item.matcher) : []) {
        node('span', text.slice(end, match.index), parent);
        const key = node('span', match[0], parent);
        key.className = 'key';
        key.tabIndex = 0;
        const tooltip = node('span', item.labels[match[0]], key);
        tooltip.className = 'key-summary';
        tooltip.id = `show-key-${++keyTooltipId}`;
        tooltip.setAttribute('role', 'tooltip');
        key.setAttribute('aria-describedby', tooltip.id);
        end = /** @type {number} */ (match.index) + match[0].length;
      }
      node('span', text.slice(end), parent);
    },
    annotate(parent, annotations) { for (const section of sections) section({ phase: 'annotation', parent, annotations, ctx }); },
    reference(parent, reference) { for (const section of sections) section({ phase: 'reference', parent, reference, ctx }); },
    caseAnnotations(parent, feature, key) {
      const annotations = model.features[feature]?.state.cases[key]?.annotations;
      if (annotations) ctx.annotate(parent, annotations);
    },
    registerCase(feature, scenario, key, open) { caseOpeners.set(`${feature}/${scenario}/${key}`, open); },
    ruleLinks(parent, feature, key) { for (const section of sections) section({ phase: 'rule', parent, feature, key, ctx }); },
    navigation: {
      openFeature(feature) { featureOpeners.get(feature)?.(); },
      openCase(feature, scenario, key) { featureOpeners.get(feature)?.(); caseOpeners.get(`${feature}/${scenario}/${key}`)?.(); },
      selectCases(feature, keys) { filters.cases.selectedFeature = feature; filters.cases.selected = [...keys]; featureOpeners.get(feature)?.(); ctx.filterChanged(); },
    },
  };
  /**
   * The Rules table. Every row cell has a column heading; annotations and links are cells, not
   * loose spans beside them.
   * @param {Element} parent
   * @param {ShowFeature} feature
   * @returns {void}
   */
  const showRules = (parent, feature) => {
    const scroll = node('div', undefined, parent);
    scroll.className = 'table-scroll';
    const table = node('table', undefined, scroll);
    const headings = node('tr', undefined, node('thead', undefined, table));
    for (const text of ['Rule', 'Statement', 'Elaboration', 'Direct covers', 'Findings and flags', 'Reliance and dependencies']) node('th', text, headings);
    const body = node('tbody', undefined, table);
    for (const rule of Object.values(feature.rules.rows)) {
      const row = node('tr', undefined, body);
      row.id = `${feature.key}-${rule.key}`;
      ctx.keyed(node('th', undefined, row), rule.key, feature.key);
      node('td', rule.statement, row);
      node('td', rule.elaboration, row);
      node('td', `Covered by ${rule.direct_covers}`, row);
      const annotations = node('td', undefined, row);
      if (feature.state.rules[rule.key]) ctx.annotate(annotations, feature.state.rules[rule.key]);
      ctx.ruleLinks(row, feature, rule.key);
    }
  };
  const { stamp } = model;
  // The page blocks share one full-width stack, so they never sit beside each other in the header.
  const headerStack = node('div', undefined, header);
  headerStack.className = 'header-stack';
  node('p', `Generated: ${stamp.generated_at} · HEAD: ${stamp.head ?? 'none'} · ${stamp.dirty ? '.qa/ has uncommitted edits' : '.qa/ has no uncommitted edits'}`, headerStack);
  node('p', `Root: ${stamp.root}`, headerStack);
  node('p', `Refresh: ${stamp.refresh}`, headerStack);
  if (model.migration.pending) node('p', `Migration pending: ${model.migration.migrations.map(m => m.command).join(' then ')} · ${model.migration.count} declarations`, headerStack);
  for (const section of sections) section({ phase: 'page', parent: headerStack, ctx });
  for (const feature of Object.values(model.features)) {
    // Every Feature is a disclosure. Its contents, and its Rules table, are built only when it is
    // opened; the selected Feature opens at mount so `/qa-show <feature-key>` reads whole.
    const section = node('section', undefined, app);
    section.id = `feature-${feature.key}`;
    const mount = ctx.lazy(section, feature.header.title, detail => {
      node('p', feature.header.intro, detail).className = 'knowledge-prose';
      const refs = node('p', 'References: ', detail);
      feature.header.references.forEach((reference, index) => {
        if (index) node('span', ' · ', refs);
        ctx.reference(refs, String(reference));
      });
      node('p', `Provenance: ${showProvenanceText(feature.header.provenance)}`, detail);
      let rulesBuilt = false;
      const buildRules = () => {
        if (rulesBuilt) return;
        rulesBuilt = true;
        ctx.lazy(detail, 'Rules', parent => showRules(parent, feature));
      };
      sections.forEach((slot, index) => {
        if (index === rulesAfter) buildRules();
        slot({ phase: 'feature', parent: detail, feature, ctx });
      });
      if (rulesAfter >= sections.length) buildRules();
    });
    featureOpeners.set(feature.key, mount.open);
    if (model.scope === feature.key) mount.open();
  }
}
