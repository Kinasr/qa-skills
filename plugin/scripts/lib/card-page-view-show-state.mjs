// @ts-check
// Findings, impact and gap badges. Annotations arrive through the Rule and case hooks; the Feature
// phase carries the impact check and any Finding that sits on no Rule or case.

/** @type {Record<string, string>} */
const FINDING_LABELS = {
  stale: 'Stale', conflict: 'Conflict', overreach: 'Overreach', outcome_gap: 'Outcome gap', divergence: 'Divergence',
};
/** @type {Record<string, string>} */
const FLAG_LABELS = { uncovered: 'Uncovered', waived: 'Waived', uncited: 'Uncited', unclassified: 'Unclassified' };

/**
 * @param {string} key
 * @returns {string}
 */
const labelOf = (key) => FINDING_LABELS[key] ?? FLAG_LABELS[key] ?? key;

/**
 * @param {unknown} value
 * @returns {string}
 */
const shown = (value) => (Array.isArray(value) ? value.join(', ') : String(value));

/**
 * One text-only badge. Nothing from the knowledge layer is parsed as markup.
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @param {Element} parent
 * @param {string} text
 * @param {string} className
 * @returns {HTMLElement}
 */
function badge(ctx, parent, text, className) {
  const element = ctx.node('span', text, parent);
  element.className = `show-badge ${className}`;
  return element;
}

/**
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @param {Element} parent
 * @param {import('./page.d.mts').ShowAnnotations} annotations
 * @returns {void}
 */
function showAnnotations(ctx, parent, annotations) {
  for (const finding of annotations.findings) {
    const element = badge(ctx, parent, ` · ${labelOf(finding.kind)}`, 'show-finding');
    if (finding.message) element.title = finding.message;
  }
  for (const [field, value] of Object.entries(annotations.mirrored)) {
    badge(ctx, parent, ` · Mirrored ${field}: ${shown(value)}`, 'show-mirrored');
  }
  for (const flag of annotations.flags) badge(ctx, parent, ` · ${labelOf(flag)}`, 'show-flag');
}

/**
 * A Finding that names no Rule and no case is the Feature's own; one that names either is already
 * badged where it belongs.
 * @param {import('./page.d.mts').ShowFeature} feature
 * @param {import('./page.d.mts').ShowFinding} finding
 * @returns {boolean}
 */
function isFeatureFinding(feature, finding) {
  const key = typeof finding.key === 'string' ? finding.key : '';
  const rule = typeof finding.rests_on === 'string' ? finding.rests_on : '';
  if (rule !== '' && Object.hasOwn(feature.state.rules, rule)) return false;
  if (key !== '' && Object.hasOwn(feature.state.rules, key)) return false;
  if (key !== '' && Object.hasOwn(feature.state.cases, key)) return false;
  return true;
}

/**
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @param {Element} parent
 * @param {import('./page.d.mts').ShowFeature} feature
 * @returns {void}
 */
function showFeatureState(ctx, parent, feature) {
  if (feature.state.impact_due) {
    const line = ctx.node('p', undefined, parent);
    badge(ctx, line, 'Impact check due', 'show-impact');
  }
  const findings = feature.state.findings.filter(finding => isFeatureFinding(feature, finding));
  if (findings.length) {
    const line = ctx.node('p', 'Open Findings: ', parent);
    for (const finding of findings) {
      const element = badge(ctx, line, labelOf(finding.kind), 'show-finding');
      if (finding.message) element.title = finding.message;
    }
  }
}

/**
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @param {Element} parent
 * @returns {void}
 */
function showPageState(ctx, parent) {
  const due = Object.values(ctx.model.features).filter(feature => feature.state.impact_due).map(feature => feature.key);
  if (due.length) ctx.node('p', `Impact check due: ${due.join(', ')}`, parent);
}

/**
 * @param {unknown} request a ShowSectionRequest at the browser boundary
 * @returns {void}
 */
export function showStateView(request) {
  const slot = /** @type {import('./show-dom.d.mts').ShowSectionRequest} */ (request);
  if (slot.phase === 'annotation') {
    showAnnotations(slot.ctx, slot.parent, slot.annotations);
    return;
  }
  if (slot.phase === 'feature') {
    showFeatureState(slot.ctx, slot.parent, slot.feature);
    return;
  }
  if (slot.phase === 'page') showPageState(slot.ctx, slot.parent);
}
