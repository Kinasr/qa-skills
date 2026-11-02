// @ts-check
// The all-Features view: one summary row per Feature. A row jumps to its Feature and opens it,
// while the Feature itself stays collapsed until then. Counts are read from the section producers.
/**
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @param {Element} parent
 * @param {readonly import('./page.d.mts').ShowFeature[]} features
 * @returns {void}
 */
function showSummary(ctx, parent, features) {
  const scroll = ctx.node('div', undefined, parent);
  scroll.className = 'table-scroll';
  const table = ctx.node('table', undefined, scroll);
  ctx.node('caption', 'Feature summary', table).className = 'muted';
  const headings = ctx.node('tr', undefined, ctx.node('thead', undefined, table));
  for (const title of ['Feature', 'Rules', 'Cases', 'Uncovered Rules', 'Parked questions', 'Deferred functionality', 'Open Findings']) ctx.node('th', title, headings);
  const body = ctx.node('tbody', undefined, table);
  for (const feature of features) {
    const row = ctx.node('tr', undefined, body);
    const name = ctx.node('td', undefined, row);
    const link = ctx.node('a', feature.header.title, name);
    link.setAttribute('href', `#feature-${feature.key}`);
    link.addEventListener('click', () => ctx.navigation.openFeature(feature.key));
    for (const [field, count] of /** @type {const} */ ([
      ['rules', feature.summary.rules],
      ['cases', feature.summary.cases],
      ['uncovered', feature.summary.uncovered],
      ['parked', feature.summary.parked],
      ['deferred', feature.summary.deferred],
      ['findings', feature.summary.findings],
    ])) {
      const cell = ctx.node('td', String(count), row);
      cell.setAttribute('data-count', field);
    }
  }
}

/**
 * @param {unknown} request a ShowSectionRequest at the browser boundary
 * @returns {void}
 */
export function showOverviewView(request) {
  const slot = /** @type {import('./show-dom.d.mts').ShowSectionRequest} */ (request);
  if (slot.phase !== 'page' || slot.ctx.model.scope !== null) return;
  showSummary(slot.ctx, slot.parent, Object.values(slot.ctx.model.features));
}
