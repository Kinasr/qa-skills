// @ts-check
/**
 * @param {unknown} request a ShowSectionRequest at the browser boundary
 * @returns {void}
 */
export function showErrorsView(request) {
  const slot = /** @type {import('./show-dom.d.mts').ShowSectionRequest} */ (request);
  if (slot.phase !== 'page' && slot.phase !== 'feature') return;
  const { parent, ctx } = slot;
  const rows = slot.phase === 'page' ? ctx.model.errors.rows : slot.feature.errors.rows;
  if (!rows.length) return;
  const group = ctx.node('section', undefined, parent);
  ctx.node('h3', 'Integrity errors', group);
  for (const error of rows) {
    const card = ctx.node('section', undefined, group);
    ctx.node('p', `${error.file ?? 'Unknown path'}${error.line == null ? '' : `:${error.line}`} · ${error.code}`, card);
    ctx.node('p', error.message, card);
  }
}
