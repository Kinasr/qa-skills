// @ts-check
// Stored Scenario/Case reader. Scenario and Case bodies are mounted only when opened.
import { showProvenanceText } from './card-page-client.mjs';
/**
 * @param {unknown} request a ShowSectionRequest at the browser boundary
 * @returns {void}
 */
export function showScenariosView(request) {
  const slot = /** @type {import('./show-dom.d.mts').ShowSectionRequest} */ (request);
  if (slot.phase !== 'feature') return;
  const { parent, feature, ctx } = slot;
  /** @type {Map<string, import('./page.d.mts').ShowLazyMount>} */
  const caseMounts = new Map();
  const scenarios = ctx.lazy(parent, 'Test Scenarios', body => {
    for (const scenario of Object.values(feature.scenarios.rows)) {
      const group = ctx.node('section', undefined, body);
      ctx.node('h3', `${scenario.key}: ${scenario.title}`, group);
      showScenarioProvenance(group, scenario.data, ctx);
      showScenarioReferences(group, scenario.data, ctx);
      for (const entry of Object.values(scenario.cases)) {
        const anchor = ctx.node('section', undefined, group);
        anchor.id = `${feature.key}-${entry.key}`;
        const review = feature.state.cases[entry.key]?.review;
        caseMounts.set(`${scenario.key}/${entry.key}`, ctx.lazy(anchor, `${entry.key}: ${entry.title}`, content => {
          showScenarioCase(content, feature, entry, review, ctx);
        }));
        // `ctx.lazy` builds the details with its summary as the first child.
        showScenarioSummary(anchor.children[0].children[0], feature, entry, review, ctx);
      }
    }
  });
  // Registered before the path is opened, so navigation and search can build it on demand.
  for (const scenario of Object.values(feature.scenarios.rows)) {
    for (const key of Object.keys(scenario.cases)) {
      ctx.registerCase(feature.key, scenario.key, key, () => {
        scenarios.open();
        caseMounts.get(`${scenario.key}/${key}`)?.open();
      });
    }
  }
}

/** @param {unknown} value @returns {string[]} */
function showScenarioList(value) {
  return value == null ? [] : (Array.isArray(value) ? value : [value]).map(String);
}

/**
 * @param {string[]} values
 * @param {readonly string[]} retired
 * @returns {string}
 */
function showScenarioLabels(values, retired) {
  return values.map(value => retired.includes(value) ? `${value} (retired)` : value).join(', ');
}

/**
 * @param {Element} summary
 * @param {import('./page.d.mts').ShowFeature} feature
 * @param {import('./page.d.mts').ShowCaseRow} entry
 * @param {import('./page.d.mts').ShowReview | undefined} review
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {void}
 */
function showScenarioSummary(summary, feature, entry, review, ctx) {
  ctx.node('span', ` · Test level: ${entry.data.level ?? 'none'}`, summary);
  const tags = showScenarioList(entry.data.tags);
  if (tags.length) ctx.node('span', ` · Tags: ${showScenarioLabels(tags, ctx.model.labels.retiredTags)}`, summary);
  for (const field of ctx.model.labels.customFields) {
    const values = showScenarioList(entry.data[field.name]);
    if (values.length) ctx.node('span', ` · ${field.name}: ${showScenarioLabels(values, field.retired)}`, summary);
  }
  if (review) ctx.node('span', ` · Review: ${review.status}${review.overdue ? ' · overdue' : ''}`, summary);
  ctx.caseAnnotations(summary, feature.key, entry.key);
}

/**
 * A case section's own bold label is shown as a plain label, then the rest of the text. The
 * model keeps the raw text (search reads it); only its leading label is split here.
 * @param {HTMLElement} content
 * @param {import('./page.d.mts').ShowCaseSection} section
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {void}
 */
function showCaseSection(content, section, ctx) {
  const match = /^\*\*([^*]+)\*\*[ \t]*/.exec(section.text);
  if (!match) {
    ctx.node('div', section.text, content).className = 'knowledge-prose';
    return;
  }
  const label = ctx.node('p', match[1], content);
  label.className = 'case-section-label';
  const text = section.text.slice(match[0].length).replace(/^\r?\n/, '');
  if (text) ctx.node('div', text, content).className = 'knowledge-prose';
}

/**
 * @param {HTMLElement} content
 * @param {import('./page.d.mts').ShowFeature} feature
 * @param {import('./page.d.mts').ShowCaseRow} entry
 * @param {import('./page.d.mts').ShowReview | undefined} review
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {void}
 */
function showScenarioCase(content, feature, entry, review, ctx) {
  for (const section of entry.sections) showCaseSection(content, section, ctx);
  const roles = showScenarioList(entry.data.roles);
  if (roles.length) ctx.node('p', `Roles: ${roles.join(', ')}`, content);
  showScenarioKeys(content, 'Covers', showScenarioList(entry.data.covers), feature.key, ctx);
  showScenarioKeys(content, 'Relies on', showScenarioList(entry.data.relies_on), feature.key, ctx);
  if (entry.data.automatable !== undefined) ctx.node('p', `automatable: ${String(entry.data.automatable)}`, content);
  const automates = showScenarioList(entry.data.automates);
  if (automates.length) ctx.node('p', `automates: ${automates.join(', ')}`, content);
  showScenarioReferences(content, entry.data, ctx);
  showScenarioProvenance(content, entry.data, ctx);
  ctx.node('p', `Review stamp: ${review?.stamp == null ? 'none' : showProvenanceText(review.stamp)}`, content);
  ctx.node('p', `Review deadline: ${review?.deadline ?? 'none'}`, content);
}

/**
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {string[]} keys
 * @param {string} feature
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {void}
 */
function showScenarioKeys(parent, label, keys, feature, ctx) {
  if (!keys.length) return;
  const line = ctx.node('p', `${label}: `, parent);
  keys.forEach((key, index) => {
    if (index) ctx.node('span', ', ', line);
    ctx.keyed(line, key, feature);
  });
}

/**
 * @param {Element} parent
 * @param {Record<string, unknown>} data
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {void}
 */
function showScenarioReferences(parent, data, ctx) {
  const values = showScenarioList(data.sources);
  if (!values.length) return;
  const line = ctx.node('p', 'References: ', parent);
  values.forEach((source, index) => {
    if (index) ctx.node('span', ' · ', line);
    ctx.reference(line, source);
  });
}

/**
 * @param {Element} parent
 * @param {Record<string, unknown>} data
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {void}
 */
function showScenarioProvenance(parent, data, ctx) {
  ctx.node('p', `Provenance: ${showProvenanceText(data.generated ?? null)}`, parent);
}
