// @ts-check
// Rule and case filter bars, plus the text search. Matching is neutral model logic; this view
// only applies the result to the mounted page and opens the paths that match.
import { showMatches } from './card-page-client.mjs';

/** @type {WeakMap<import('./show-dom.d.mts').ShowRenderContext, Array<() => void>>} */
const showFilterBindings = new WeakMap();

/**
 * One shared filter state is read by every Feature's bar. Each built control registers a sync so a
 * change in any bar updates the rest, and a bar built later initialises from the same state.
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @param {() => void} sync
 * @returns {void}
 */
function showFilterRegister(ctx, sync) {
  const bindings = showFilterBindings.get(ctx) ?? [];
  bindings.push(sync);
  showFilterBindings.set(ctx, bindings);
}

/**
 * @param {Element} root
 * @returns {HTMLElement[]}
 */
function showFilterDescendants(root) {
  return Array.from(root.children).flatMap(child => [/** @type {HTMLElement} */ (child), ...showFilterDescendants(child)]);
}

/**
 * The Feature sections, indexed by DOM id once. Every filter change reads this map instead of
 * walking the whole document once per Feature.
 * @param {Element} app
 * @returns {Map<string, HTMLElement>}
 */
function showFilterSections(app) {
  /** @type {Map<string, HTMLElement>} */
  const sections = new Map();
  for (const element of showFilterDescendants(app)) if (element.id?.startsWith('feature-')) sections.set(element.id, element);
  return sections;
}

/**
 * @param {Element} root
 * @param {string} title
 * @returns {HTMLElement | undefined}
 */
function showFilterDetails(root, title) {
  return showFilterDescendants(root).find(element => element.tagName === 'DETAILS' && element.children[0]?.textContent === title);
}

/**
 * The harness records listeners but does not deliver a native toggle after `open` changes; the
 * browser delivers the event itself, so the explicit call is only a no-op there.
 * @param {HTMLElement} details
 * @returns {void}
 */
function showFilterOpen(details) {
  const target = /** @type {{open?: boolean, listeners?: {toggle?: () => void}}} */ (details);
  target.open = true;
  target.listeners?.toggle?.();
}

/**
 * Hide everything a filter has already built when its Feature no longer matches.
 * @param {HTMLElement} section
 * @param {import('./page.d.mts').ShowFeature} feature
 * @returns {void}
 */
function showFilterHide(section, feature) {
  const elements = new Map();
  for (const element of showFilterDescendants(section)) if (element.id) elements.set(element.id, element);
  for (const rule of Object.values(feature.rules.rows)) {
    const row = elements.get(`${feature.key}-${rule.key}`);
    if (row) row.hidden = true;
  }
  const groups = new Set();
  for (const scenario of Object.values(feature.scenarios.rows)) {
    for (const entry of Object.values(scenario.cases)) {
      const anchor = elements.get(`${feature.key}-${entry.key}`);
      if (!anchor) continue;
      anchor.hidden = true;
      if (anchor.parentElement) groups.add(anchor.parentElement);
    }
  }
  for (const group of groups) /** @type {HTMLElement} */ (group).hidden = true;
}

/**
 * Clear the visibility a filter applied, without building a section that was never opened.
 * @param {HTMLElement} section
 * @param {import('./page.d.mts').ShowFeature} feature
 * @returns {void}
 */
function showFilterClear(section, feature) {
  const elements = new Map();
  for (const element of showFilterDescendants(section)) if (element.id) elements.set(element.id, element);
  for (const rule of Object.values(feature.rules.rows)) {
    const row = elements.get(`${feature.key}-${rule.key}`);
    if (row) row.hidden = false;
  }
  const groups = new Set();
  for (const scenario of Object.values(feature.scenarios.rows)) {
    for (const entry of Object.values(scenario.cases)) {
      const anchor = elements.get(`${feature.key}-${entry.key}`);
      if (!anchor) continue;
      anchor.hidden = false;
      if (anchor.parentElement) groups.add(anchor.parentElement);
    }
  }
  for (const group of groups) /** @type {HTMLElement} */ (group).hidden = false;
}

/**
 * The case selection a Rule count click installs, said in words so it is never invisible.
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {string}
 */
function showFilterSelectionText(ctx) {
  const { selected, selectedFeature } = ctx.filters.cases;
  if (selected === null) return '';
  const feature = selectedFeature === null ? undefined : ctx.model.features[selectedFeature];
  const rule = feature && Object.keys(feature.links.rules).find(key => {
    const covers = feature.links.rules[key]?.covers ?? [];
    return covers.length === selected.length && covers.every(entry => selected.includes(entry));
  });
  const noun = `${selected.length} Test Case${selected.length === 1 ? '' : 's'}`;
  return `Selection: ${noun}${rule ? ` covering ${rule}` : ''}${selectedFeature === null ? '' : ` in ${selectedFeature}`}.`;
}

/**
 * The filter operation works on the whole page, wherever the header blocks sit.
 * @param {Element} parent
 * @returns {Element}
 */
function showFilterRoot(parent) {
  let root = parent;
  while (root.parentElement) root = root.parentElement;
  return root;
}

/**
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @param {Element} app
 * @param {HTMLElement} status
 * @returns {() => void}
 */
function showFilterApply(ctx, app, status) {
  /** @type {Map<string, HTMLElement> | null} */
  let sections = null;
  return () => {
    sections ??= showFilterSections(app);
    let shown = 0;
    let total = 0;
    let active = false;
    for (const feature of Object.values(ctx.model.features)) {
      const section = sections.get(`feature-${feature.key}`);
      if (!section) continue;
      total += 1;
      const match = showMatches(feature, ctx.filters);
      const featureActive = Boolean(match.query || match.rules.active || match.cases.active);
      active ||= featureActive;
      if (!match.visible) {
        section.hidden = true;
        showFilterHide(section, feature);
        continue;
      }
      shown += 1;
      section.hidden = false;
      if (!featureActive) {
        showFilterClear(section, feature);
        continue;
      }
      ctx.navigation.openFeature(feature.key);
      const ruleKeys = new Set(match.rules.keys);
      const caseKeys = new Set(match.cases.keys);
      const rulesActive = Boolean(match.query || match.rules.active);
      const casesActive = Boolean(match.query || match.cases.active);
      if (rulesActive && ruleKeys.size) {
        const rules = showFilterDetails(section, 'Rules');
        if (rules) showFilterOpen(rules);
      }
      if (casesActive && caseKeys.size) {
        const scenarios = showFilterDetails(section, 'Test Scenarios');
        if (scenarios) showFilterOpen(scenarios);
      }
      // Search reveals the body that matched; filters only narrow the case tree.
      if (match.query) for (const scenario of Object.values(feature.scenarios.rows)) {
        for (const key of Object.keys(scenario.cases)) if (caseKeys.has(key)) ctx.navigation.openCase(feature.key, scenario.key, key);
      }
      const elements = new Map();
      for (const element of showFilterDescendants(section)) if (element.id) elements.set(element.id, element);
      for (const rule of Object.values(feature.rules.rows)) {
        const row = elements.get(`${feature.key}-${rule.key}`);
        if (row) row.hidden = rulesActive && !ruleKeys.has(rule.key);
      }
      /** @type {Map<Element, boolean>} */
      const groups = new Map();
      for (const scenario of Object.values(feature.scenarios.rows)) {
        for (const entry of Object.values(scenario.cases)) {
          const anchor = elements.get(`${feature.key}-${entry.key}`);
          if (!anchor) continue;
          const visible = !casesActive || caseKeys.has(entry.key);
          anchor.hidden = !visible;
          if (anchor.parentElement) groups.set(anchor.parentElement, (groups.get(anchor.parentElement) ?? false) || visible);
        }
      }
      for (const [group, visible] of groups) /** @type {HTMLElement} */ (group).hidden = !visible;
    }
    for (const sync of showFilterBindings.get(ctx) ?? []) sync();
    const selected = showFilterSelectionText(ctx);
    status.textContent = [selected, active ? `Showing ${shown} of ${total} Features.` : ''].filter(Boolean).join(' ');
  };
}

/**
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {() => boolean} read
 * @param {(checked: boolean) => void} changed
 * @returns {HTMLInputElement}
 */
function showFilterCheckbox(ctx, parent, label, read, changed) {
  const wrapper = ctx.node('label', undefined, parent);
  const input = ctx.node('input', undefined, wrapper);
  input.type = 'checkbox';
  input.checked = read();
  input.setAttribute('aria-label', label);
  ctx.node('span', ` ${label}`, wrapper);
  showFilterRegister(ctx, () => { input.checked = read(); });
  input.addEventListener('change', () => { changed(input.checked); ctx.filterChanged(); });
  return input;
}

/**
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {ReadonlyArray<{value: string, label: string}>} options
 * @param {() => string} read
 * @param {(value: string) => void} changed
 * @returns {HTMLSelectElement}
 */
function showFilterSelect(ctx, parent, label, options, read, changed) {
  const wrapper = ctx.node('label', undefined, parent);
  ctx.node('span', `${label}: `, wrapper);
  const select = ctx.node('select', undefined, wrapper);
  select.setAttribute('aria-label', label);
  for (const option of options) {
    const element = ctx.node('option', option.label, select);
    element.value = option.value;
  }
  select.value = read();
  showFilterRegister(ctx, () => { select.value = read(); });
  select.addEventListener('change', () => { changed(select.value); ctx.filterChanged(); });
  return select;
}

/**
 * The composition places each bar after the Rules table and before the case tree, in the order
 * the Knowledge page specifies.
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @param {HTMLElement} parent
 * @param {string} title
 * @returns {HTMLFieldSetElement}
 */
function showFilterBar(ctx, parent, title) {
  const bar = ctx.node('fieldset', undefined, parent);
  ctx.node('legend', title, bar);
  return bar;
}

/**
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @param {HTMLElement} parent
 * @returns {void}
 */
function showFilterFeature(ctx, parent) {
  const ruleBar = showFilterBar(ctx, parent, 'Rule filters');
  showFilterCheckbox(ctx, ruleBar, 'Uncovered', () => ctx.filters.rules.uncovered, value => { ctx.filters.rules.uncovered = value; });
  showFilterCheckbox(ctx, ruleBar, 'Waived', () => ctx.filters.rules.waived, value => { ctx.filters.rules.waived = value; });
  showFilterCheckbox(ctx, ruleBar, 'Has Findings', () => ctx.filters.rules.findings, value => { ctx.filters.rules.findings = value; });

  const caseBar = showFilterBar(ctx, parent, 'Case filters');
  const labels = ctx.model.labels;
  if (labels.levels.length) {
    showFilterSelect(ctx, caseBar, 'Test level', [{ value: '', label: 'All Test levels' }, ...labels.levels.map(level => ({ value: level, label: level }))],
      () => ctx.filters.cases.level, value => { ctx.filters.cases.level = value; });
  }
  const tags = [...new Set([...Object.keys(labels.tags), ...labels.retiredTags])];
  if (tags.length) {
    showFilterSelect(ctx, caseBar, 'Tag', [{ value: '', label: 'All Tags' }, ...tags.map(tag => ({ value: tag, label: labels.tags[tag] ? `${tag}: ${labels.tags[tag]}` : `${tag} (retired)` }))],
      () => ctx.filters.cases.tag, value => { ctx.filters.cases.tag = value; });
  }
  for (const field of labels.customFields) {
    const values = [...new Set([...field.values, ...field.retired])];
    showFilterSelect(ctx, caseBar, `Custom field ${field.name}`, [{ value: '', label: 'All' }, ...values.map(value => ({ value, label: field.retired.includes(value) ? `${value} (retired)` : value }))],
      () => ctx.filters.cases.custom[field.name] ?? '', value => {
        if (value) ctx.filters.cases.custom[field.name] = value;
        else delete ctx.filters.cases.custom[field.name];
      });
  }
  showFilterSelect(ctx, caseBar, 'Review status', [
    { value: '', label: 'All Review statuses' },
    { value: 'fresh', label: 'Fresh' },
    { value: 'void', label: 'Void' },
    { value: 'unreviewed', label: 'Unreviewed' },
    { value: 'overdue', label: 'Overdue' },
  ], () => ctx.filters.cases.review, value => { ctx.filters.cases.review = value; });
  showFilterSelect(ctx, caseBar, 'Open Findings', [
    { value: '', label: 'All open Findings' },
    { value: 'any', label: 'Any open Finding' },
    { value: 'stale', label: 'Stale' },
    { value: 'conflict', label: 'Conflict' },
    { value: 'overreach', label: 'Overreach' },
    { value: 'outcome_gap', label: 'Outcome gap' },
    { value: 'divergence', label: 'Divergence' },
  ], () => ctx.filters.cases.finding, value => { ctx.filters.cases.finding = value; });
  showFilterCheckbox(ctx, caseBar, 'Uncited', () => ctx.filters.cases.uncited, value => { ctx.filters.cases.uncited = value; });
}

/**
 * @param {unknown} request a ShowSectionRequest at the browser boundary
 * @returns {void}
 */
export function showFiltersView(request) {
  const slot = /** @type {import('./show-dom.d.mts').ShowSectionRequest} */ (request);
  if (slot.phase === 'page') {
    const { parent, ctx } = slot;
    const app = showFilterRoot(parent);
    const searchLabel = ctx.node('label', undefined, parent);
    ctx.node('span', 'Search: ', searchLabel);
    const search = ctx.node('input', undefined, searchLabel);
    search.type = 'search';
    search.value = ctx.filters.query;
    search.setAttribute('aria-label', 'Search Rules and Test Cases');
    const status = ctx.node('p', '', parent);
    status.setAttribute('role', 'status');
    const clear = ctx.node('button', 'Clear selection', parent);
    clear.type = 'button';
    clear.setAttribute('aria-label', 'Clear selection');
    clear.hidden = ctx.filters.cases.selected === null;
    clear.addEventListener('click', () => {
      ctx.filters.cases.selected = null;
      ctx.filters.cases.selectedFeature = null;
      ctx.filterChanged();
    });
    // A Rule count click calls navigation.selectCases, which updates the same state and calls this.
    ctx.filterChanged = showFilterApply(ctx, app, status);
    showFilterRegister(ctx, () => {
      search.value = ctx.filters.query;
      clear.hidden = ctx.filters.cases.selected === null;
    });
    const searchChanged = () => { ctx.filters.query = search.value; ctx.filterChanged(); };
    search.addEventListener('input', searchChanged);
    search.addEventListener('change', searchChanged);
    return;
  }
  if (slot.phase !== 'feature') return;
  showFilterFeature(slot.ctx, slot.parent);
}
