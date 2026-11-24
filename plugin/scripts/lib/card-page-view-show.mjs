// @ts-check
// Show (Knowledge page) browser view: page header, per-Feature lazy disclosures, Rules table,
// shared filters/search, Reference/Rule links, and lazy Scenario -> Case tree.
import { immutableShow, showFilterState, showKeyLookup, showMatches, showProvenanceText } from './card-page-client.mjs';

/** @typedef {import('./page.d.mts').ShowPageModel} ShowPageModel */
/** @typedef {import('./page.d.mts').ShowFeature} ShowFeature */
/**
 * @typedef {{
 *   navigation: import('./page.d.mts').ShowNavigation,
 *   filters: import('./page.d.mts').ShowFilterState,
 *   filterChanged: () => void,
 * }} ShowController
 */

/**
 * Mount the Knowledge page DOM into `base` and return its navigation and filter controller.
 * @param {ShowPageModel} model
 * @param {unknown} doc
 * @param {unknown} base
 * @returns {ShowController}
 */
export function mountShow(model, doc, base) {
  const { app, header, node } = /** @type {{ app: HTMLElement, header: HTMLElement, node: (<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: Element) => HTMLElementTagNameMap[K]) }} */ (base);
  immutableShow(model);
  const lookup = showKeyLookup(model);
  const filters = showFilterState();
  let keyTooltipId = 0;
  /** @type {Map<string, () => void>} */
  const featureOpeners = new Map();
  /** @type {Map<string, () => void>} */
  const rulesOpeners = new Map();
  /** @type {Map<string, () => void>} */
  const scenariosOpeners = new Map();
  /** @type {Map<string, () => void>} */
  const caseOpeners = new Map();
  /** @type {Array<() => void>} */
  const filterBindings = [];
  let filterChanged = () => {};

  /** @type {import('./page.d.mts').ShowNavigation} */
  const navigation = {
    openFeature(feature) { featureOpeners.get(feature)?.(); },
    openRules(feature) { featureOpeners.get(feature)?.(); rulesOpeners.get(feature)?.(); },
    openScenarios(feature) { featureOpeners.get(feature)?.(); scenariosOpeners.get(feature)?.(); },
    openCase(feature, scenario, key) { featureOpeners.get(feature)?.(); caseOpeners.get(`${feature}/${scenario}/${key}`)?.(); },
    selectCases(feature, keys) { filters.cases.selectedFeature = feature; filters.cases.selected = [...keys]; featureOpeners.get(feature)?.(); filterChanged(); },
  };

  /**
   * @param {Element} parent
   * @param {string} title
   * @param {(parent: HTMLElement) => void} build
   * @returns {import('./page.d.mts').ShowLazyMount}
   */
  const lazy = (parent, title, build) => {
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
  };

  /**
   * @param {Element} parent
   * @param {string} text
   * @param {string} feature
   * @returns {void}
   */
  const keyed = (parent, text, feature) => {
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
  };

  /**
   * @param {Element} parent
   * @param {readonly import('./page.d.mts').ShowFinding[]} rows
   * @returns {void}
   */
  const renderShowErrors = (parent, rows) => {
    if (!rows.length) return;
    const group = node('section', undefined, parent);
    node('h3', 'Integrity errors', group);
    for (const error of rows) {
      const card = node('section', undefined, group);
      node('p', `${error.file ?? 'Unknown path'}${error.line == null ? '' : `:${error.line}`} · ${error.code}`, card);
      node('p', error.message, card);
    }
  };

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
   * @param {Element} parent
   * @param {string} text
   * @param {string} className
   * @returns {HTMLElement}
   */
  const badge = (parent, text, className) => {
    const element = node('span', text, parent);
    element.className = `show-badge ${className}`;
    return element;
  };

  /**
   * @param {Element} parent
   * @param {import('./page.d.mts').ShowAnnotations} annotations
   * @returns {void}
   */
  const renderShowAnnotations = (parent, annotations) => {
    for (const finding of annotations.findings) {
      const element = badge(parent, ` · ${labelOf(finding.kind)}`, 'show-finding');
      if (finding.message) element.title = finding.message;
    }
    for (const [field, value] of Object.entries(annotations.mirrored)) {
      badge(parent, ` · Mirrored ${field}: ${shown(value)}`, 'show-mirrored');
    }
    for (const flag of annotations.flags) badge(parent, ` · ${labelOf(flag)}`, 'show-flag');
  };

  /**
   * A Finding that names no Rule and no case is the Feature's own; one that names either is already
   * badged where it belongs.
   * @param {ShowFeature} feature
   * @param {import('./page.d.mts').ShowFinding} finding
   * @returns {boolean}
   */
  const isFeatureFinding = (feature, finding) => {
    const key = typeof finding.key === 'string' ? finding.key : '';
    const rule = typeof finding.rests_on === 'string' ? finding.rests_on : '';
    if (rule !== '' && Object.hasOwn(feature.state.rules, rule)) return false;
    if (key !== '' && Object.hasOwn(feature.state.rules, key)) return false;
    if (key !== '' && Object.hasOwn(feature.state.cases, key)) return false;
    return true;
  };

  /**
   * @param {Element} parent
   * @param {ShowFeature} feature
   * @returns {void}
   */
  const renderShowFeatureState = (parent, feature) => {
    if (feature.state.impact_due) {
      const line = node('p', undefined, parent);
      badge(line, 'Impact check due', 'show-impact');
    }
    const findings = feature.state.findings.filter(finding => isFeatureFinding(feature, finding));
    if (findings.length) {
      const line = node('p', 'Open Findings: ', parent);
      for (const finding of findings) {
        const element = badge(line, labelOf(finding.kind), 'show-finding');
        if (finding.message) element.title = finding.message;
      }
    }
  };

  /**
   * @param {Element} parent
   * @returns {void}
   */
  const renderShowPageState = (parent) => {
    const due = Object.values(model.features).filter(feature => feature.state.impact_due).map(feature => feature.key);
    if (due.length) node('p', `Impact check due: ${due.join(', ')}`, parent);
  };

  /**
   * The only external schemes that may become a link. A fragment is an internal anchor and needs no
   * URL parsing; everything else, including an obfuscated `javascript:` or a malformed URL, is text.
   * @param {string} reference
   * @returns {string | null}
   */
  const showLinkTarget = (reference) => {
    if (reference.startsWith('#')) return reference;
    try {
      // Constructed by reflection: page-safety checks reject the CSS link-function pattern in HTML.
      const parsed = /** @type {URL} */ (Reflect.construct(URL, [reference]));
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? reference : null;
    } catch {
      return null;
    }
  };

  /**
   * @param {Element} parent
   * @param {string} reference
   * @returns {void}
   */
  const renderShowReference = (parent, reference) => {
    const href = showLinkTarget(reference);
    if (href === null) {
      node('span', reference, parent);
      return;
    }
    const link = node('a', reference, parent);
    link.setAttribute('href', href);
  };

  /**
   * @param {string} feature
   * @param {string} key
   * @returns {string | null}
   */
  const showLinkScenario = (feature, key) => {
    const section = model.features[feature];
    if (!section) return null;
    for (const scenario of Object.values(section.scenarios.rows)) {
      if (Object.hasOwn(scenario.cases, key)) return scenario.key;
    }
    return null;
  };

  /**
   * A destination links only when its Feature is on the page. A case link opens that case's lazy
   * path first; a Rule link opens its Feature and Rules, and the fragment carries the reader to the
   * Rule.
   * @param {Element} parent
   * @param {import('./page.d.mts').ShowRuleLink} destination
   * @param {'case' | 'rule'} kind
   * @returns {void}
   */
  const renderShowLinkDestination = (parent, destination, kind) => {
    const label = `${destination.feature}/${destination.key}`;
    const present = Object.hasOwn(model.features, destination.feature);
    const line = node('p', undefined, parent);
    if (!present) {
      node('span', label, line);
    } else {
      const link = node('a', label, line);
      link.setAttribute('href', `#${destination.feature}-${destination.key}`);
      link.addEventListener('click', () => {
        if (kind === 'case') {
          const scenario = showLinkScenario(destination.feature, destination.key);
          if (scenario !== null) navigation.openCase(destination.feature, scenario, destination.key);
        } else {
          navigation.openRules(destination.feature);
        }
      });
    }
    node('span', destination.summary ? `: ${destination.summary}` : '', line);
  };

  /**
   * @param {Element} parent
   * @param {string} label
   * @param {readonly import('./page.d.mts').ShowRuleLink[]} destinations
   * @param {'case' | 'rule'} kind
   * @returns {void}
   */
  const renderShowLinkList = (parent, label, destinations, kind) => {
    const heading = node('p', `${label} ${destinations.length}`, parent);
    heading.className = 'muted';
    for (const destination of destinations) renderShowLinkDestination(parent, destination, kind);
  };

  /**
   * @param {Element} parent
   * @param {ShowFeature} feature
   * @param {string} key
   * @returns {void}
   */
  const renderShowRuleLinks = (parent, feature, key) => {
    const links = feature.links.rules[key];
    if (!links) return;
    const cell = node('td', undefined, parent);
    renderShowLinkList(cell, 'Relied on by', links.relied_on_by, 'case');
    renderShowLinkList(cell, 'Depends on', links.dependencies, 'rule');
    renderShowLinkList(cell, 'Dependents', links.dependents, 'rule');
  };

  /**
   * The covering count the Rules table already renders becomes the filter control: clicking it
   * selects this Rule's direct covering cases through the one shared selection operation.
   * @param {Element} parent
   * @param {ShowFeature} feature
   * @param {string} key
   * @returns {void}
   */
  const renderShowRuleCoverCount = (parent, feature, key) => {
    const links = feature.links.rules[key];
    if (!links || links.covers.length === 0) return;
    const text = `Covered by ${links.covers.length}`;
    const count = /** @type {HTMLElement | undefined} */ (Array.from(parent.children).find(child => child.textContent === text));
    if (!count) return;
    count.setAttribute('role', 'button');
    count.tabIndex = 0;
    count.setAttribute('aria-label', `Show cases covering ${key}`);
    const select = () => navigation.selectCases(feature.key, links.covers);
    count.addEventListener('click', select);
    count.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      select();
    });
  };

  /**
   * @param {Element} parent
   * @returns {void}
   */
  const renderShowLegend = (parent) => {
    const labels = model.labels;
    if (labels.levels.length || Object.keys(labels.tags).length || labels.retiredTags.length || labels.customFields.length) {
      lazy(parent, 'Legend', body => {
        if (labels.levels.length) node('p', `Test levels: ${labels.levels.join(', ')}`, body);
        for (const [tag, meaning] of Object.entries(labels.tags)) node('p', `Tag ${tag}: ${meaning}`, body);
        if (labels.retiredTags.length) node('p', `Retired Tags: ${labels.retiredTags.join(', ')}`, body);
        for (const field of labels.customFields) {
          node('p', `${field.name}: ${field.description} · ${field.multiple ? 'several values' : 'one value'} · ${field.required ? 'required' : 'optional'}`, body);
          node('p', `Allowed values: ${field.values.join(', ')}${field.retired.length ? ` · Retired values: ${field.retired.join(', ')}` : ''}`, body);
        }
      });
    }
  };

  /**
   * @param {Element} parent
   * @param {ShowFeature} feature
   * @returns {void}
   */
  const renderShowKnowledge = (parent, feature) => {
    const knowledge = feature.knowledge;
    lazy(parent, 'Coverage', body => {
      node('p', `Deferred functionality: ${knowledge.deferred_count}`, body);
      if (knowledge.coverage_due) node('p', `Coverage due: ${knowledge.coverage_due.detail}`, body);
      if (!knowledge.coverage) node('p', 'No Coverage recorded.', body);
      for (const line of knowledge.coverage?.lines ?? []) {
        const row = node('p', `${line.key}: ${line.disposition}`, body);
        if (line.rules.length) keyed(row, ` by ${line.rules.join(', ')}`, feature.key);
        if (line.reason !== null) node('span', `: ${line.reason}`, row);
        for (const item of line.na) node('span', `; n/a for ${item.functionality}: ${item.reason}`, row);
      }
      for (const problem of knowledge.coverage?.problems ?? []) node('p', `${problem.code}: ${problem.message}`, body);
    });

    if (knowledge.deferred.length) lazy(parent, 'Deferred functionality', body => {
      for (const item of knowledge.deferred) {
        const row = node('p', `${item.functionality}: ${item.reason}. From: `, body);
        renderShowReference(row, item.reference);
        if (item.place !== null) node('span', `, ${item.place}`, row);
      }
    });
    if (knowledge.proposed.length) lazy(parent, 'Proposed Rules', body => {
      for (const item of knowledge.proposed) {
        node('p', item.statement, body);
        if (item.why !== null) node('p', `Why: ${item.why}`, body).className = 'knowledge-prose';
        if (item.scenario !== null) keyed(node('p', 'Scenario: ', body), item.scenario, feature.key);
      }
    });
    if (knowledge.parked.length) lazy(parent, 'Parked questions', body => {
      for (const question of knowledge.parked) node('p', question.text, body);
    });
    if (knowledge.boundaries.length || knowledge.waivers.length) lazy(parent, 'Boundaries and Waivers', body => {
      for (const boundary of knowledge.boundaries) {
        node('p', `${boundary.key}: ${boundary.statement} · Owner: ${boundary.owner ?? 'none'}`, body);
        node('p', boundary.elaboration, body).className = 'knowledge-prose';
      }
      for (const waiver of knowledge.waivers) {
        const row = node('p', 'Waiver: ', body);
        keyed(row, waiver.key, feature.key);
        node('span', `: ${waiver.reason}`, row);
        node('p', waiver.elaboration, body).className = 'knowledge-prose';
      }
    });
  };

  /**
   * @param {Element} root
   * @returns {HTMLElement[]}
   */
  const filterDescendants = (root) => Array.from(root.children).flatMap(child => [/** @type {HTMLElement} */ (child), ...filterDescendants(child)]);

  /**
   * The Feature sections, indexed by DOM id once. Every filter change reads this map instead of
   * walking the whole document once per Feature.
   * @returns {Map<string, HTMLElement>}
   */
  const filterSections = () => {
    /** @type {Map<string, HTMLElement>} */
    const sections = new Map();
    for (const element of filterDescendants(app)) if (element.id?.startsWith('feature-')) sections.set(element.id, element);
    return sections;
  };

  /**
   * Apply Rule and Case visibility predicates to a Feature's built DOM elements.
   * @param {HTMLElement} section
   * @param {ShowFeature} feature
   * @param {(key: string) => boolean} isRuleHidden
   * @param {(key: string) => boolean} isCaseHidden
   * @returns {void}
   */
  const applyFeatureVisibility = (section, feature, isRuleHidden, isCaseHidden) => {
    /** @type {Map<string, HTMLElement>} */
    const elements = new Map();
    for (const element of filterDescendants(section)) if (element.id) elements.set(element.id, element);
    for (const rule of Object.values(feature.rules.rows)) {
      const row = elements.get(`${feature.key}-${rule.key}`);
      if (row) row.hidden = isRuleHidden(rule.key);
    }
    /** @type {Map<HTMLElement, boolean>} */
    const groups = new Map();
    for (const scenario of Object.values(feature.scenarios.rows)) {
      for (const entry of Object.values(scenario.cases)) {
        const anchor = elements.get(`${feature.key}-${entry.key}`);
        if (!anchor) continue;
        const hidden = isCaseHidden(entry.key);
        anchor.hidden = hidden;
        if (anchor.parentElement) groups.set(anchor.parentElement, (groups.get(anchor.parentElement) ?? false) || !hidden);
      }
    }
    for (const [group, anyVisible] of groups) group.hidden = !anyVisible;
  };

  /**
   * Hide or restore visibility for a Feature's built Rules and cases without building unopened sections.
   * @param {HTMLElement} section
   * @param {ShowFeature} feature
   * @param {boolean} hidden
   * @returns {void}
   */
  const setFeatureHidden = (section, feature, hidden) => applyFeatureVisibility(section, feature, () => hidden, () => hidden);

  /**
   * The case selection a Rule count click installs, said in words so it is never invisible.
   * @returns {string}
   */
  const filterSelectionText = () => {
    const { selected, selectedFeature } = filters.cases;
    if (selected === null) return '';
    const feature = selectedFeature === null ? undefined : model.features[selectedFeature];
    const rule = feature && Object.keys(feature.links.rules).find(key => {
      const covers = feature.links.rules[key]?.covers ?? [];
      return covers.length === selected.length && covers.every(entry => selected.includes(entry));
    });
    const noun = `${selected.length} Test Case${selected.length === 1 ? '' : 's'}`;
    return `Selection: ${noun}${rule ? ` covering ${rule}` : ''}${selectedFeature === null ? '' : ` in ${selectedFeature}`}.`;
  };

  /**
   * @param {HTMLElement} status
   * @returns {() => void}
   */
  const createFilterApply = (status) => {
    /** @type {Map<string, HTMLElement> | null} */
    let sections = null;
    return () => {
      sections ??= filterSections();
      let shownCount = 0;
      let total = 0;
      let active = false;
      for (const feature of Object.values(model.features)) {
        const section = sections.get(`feature-${feature.key}`);
        if (!section) continue;
        total += 1;
        const match = showMatches(feature, filters);
        const featureActive = Boolean(match.query || match.rules.active || match.cases.active);
        active ||= featureActive;
        if (!match.visible) {
          section.hidden = true;
          setFeatureHidden(section, feature, true);
          continue;
        }
        shownCount += 1;
        section.hidden = false;
        if (!featureActive) {
          setFeatureHidden(section, feature, false);
          continue;
        }
        navigation.openFeature(feature.key);
        const ruleKeys = new Set(match.rules.keys);
        const caseKeys = new Set(match.cases.keys);
        const rulesActive = Boolean(match.query || match.rules.active);
        const casesActive = Boolean(match.query || match.cases.active);
        if (rulesActive && ruleKeys.size) navigation.openRules(feature.key);
        if (casesActive && caseKeys.size) navigation.openScenarios(feature.key);
        // Search reveals the body that matched; filters only narrow the case tree.
        if (match.query) for (const scenario of Object.values(feature.scenarios.rows)) {
          for (const key of Object.keys(scenario.cases)) if (caseKeys.has(key)) navigation.openCase(feature.key, scenario.key, key);
        }
        applyFeatureVisibility(section, feature, (key) => rulesActive && !ruleKeys.has(key), (key) => casesActive && !caseKeys.has(key));
      }
      for (const sync of filterBindings) sync();
      const selected = filterSelectionText();
      status.textContent = [selected, active ? `Showing ${shownCount} of ${total} Features.` : ''].filter(Boolean).join(' ');
    };
  };

  /**
   * @param {Element} parent
   * @param {string} label
   * @param {() => boolean} read
   * @param {(checked: boolean) => void} changed
   * @returns {HTMLInputElement}
   */
  const filterCheckbox = (parent, label, read, changed) => {
    const wrapper = node('label', undefined, parent);
    const input = node('input', undefined, wrapper);
    input.type = 'checkbox';
    input.checked = read();
    input.setAttribute('aria-label', label);
    node('span', ` ${label}`, wrapper);
    filterBindings.push(() => { input.checked = read(); });
    input.addEventListener('change', () => { changed(input.checked); filterChanged(); });
    return input;
  };

  /**
   * @param {Element} parent
   * @param {string} label
   * @param {ReadonlyArray<{value: string, label: string}>} options
   * @param {() => string} read
   * @param {(value: string) => void} changed
   * @returns {HTMLSelectElement}
   */
  const filterSelect = (parent, label, options, read, changed) => {
    const wrapper = node('label', undefined, parent);
    node('span', `${label}: `, wrapper);
    const select = node('select', undefined, wrapper);
    select.setAttribute('aria-label', label);
    for (const option of options) {
      const element = node('option', option.label, select);
      element.value = option.value;
    }
    select.value = read();
    filterBindings.push(() => { select.value = read(); });
    select.addEventListener('change', () => { changed(select.value); filterChanged(); });
    return select;
  };

  /**
   * @param {Element} parent
   * @param {string} title
   * @returns {HTMLFieldSetElement}
   */
  const filterBar = (parent, title) => {
    const bar = node('fieldset', undefined, parent);
    node('legend', title, bar);
    return bar;
  };

  /**
   * @param {Element} parent
   * @returns {void}
   */
  const renderShowFeatureFilters = (parent) => {
    const ruleBar = filterBar(parent, 'Rule filters');
    filterCheckbox(ruleBar, 'Uncovered', () => filters.rules.uncovered, value => { filters.rules.uncovered = value; });
    filterCheckbox(ruleBar, 'Waived', () => filters.rules.waived, value => { filters.rules.waived = value; });
    filterCheckbox(ruleBar, 'Has Findings', () => filters.rules.findings, value => { filters.rules.findings = value; });

    const caseBar = filterBar(parent, 'Case filters');
    const labels = model.labels;
    if (labels.levels.length) {
      filterSelect(caseBar, 'Test level', [{ value: '', label: 'All Test levels' }, ...labels.levels.map(level => ({ value: level, label: level }))],
        () => filters.cases.level, value => { filters.cases.level = value; });
    }
    const tags = [...new Set([...Object.keys(labels.tags), ...labels.retiredTags])];
    if (tags.length) {
      filterSelect(caseBar, 'Tag', [{ value: '', label: 'All Tags' }, ...tags.map(tag => ({ value: tag, label: labels.tags[tag] ? `${tag}: ${labels.tags[tag]}` : `${tag} (retired)` }))],
        () => filters.cases.tag, value => { filters.cases.tag = value; });
    }
    for (const field of labels.customFields) {
      const values = [...new Set([...field.values, ...field.retired])];
      filterSelect(caseBar, `Custom field ${field.name}`, [{ value: '', label: 'All' }, ...values.map(value => ({ value, label: field.retired.includes(value) ? `${value} (retired)` : value }))],
        () => filters.cases.custom[field.name] ?? '', value => {
          if (value) filters.cases.custom[field.name] = value;
          else delete filters.cases.custom[field.name];
        });
    }
    filterSelect(caseBar, 'Review status', [
      { value: '', label: 'All Review statuses' },
      { value: 'fresh', label: 'Fresh' },
      { value: 'void', label: 'Void' },
      { value: 'unreviewed', label: 'Unreviewed' },
      { value: 'overdue', label: 'Overdue' },
    ], () => filters.cases.review, value => { filters.cases.review = value; });
    filterSelect(caseBar, 'Open Findings', [
      { value: '', label: 'All open Findings' },
      { value: 'any', label: 'Any open Finding' },
      { value: 'stale', label: 'Stale' },
      { value: 'conflict', label: 'Conflict' },
      { value: 'overreach', label: 'Overreach' },
      { value: 'outcome_gap', label: 'Outcome gap' },
      { value: 'divergence', label: 'Divergence' },
    ], () => filters.cases.finding, value => { filters.cases.finding = value; });
    filterCheckbox(caseBar, 'Uncited', () => filters.cases.uncited, value => { filters.cases.uncited = value; });
  };

  /**
   * @param {Element} parent
   * @returns {void}
   */
  const renderShowPageFilters = (parent) => {
    const searchLabel = node('label', undefined, parent);
    node('span', 'Search: ', searchLabel);
    const search = node('input', undefined, searchLabel);
    search.type = 'search';
    search.value = filters.query;
    search.setAttribute('aria-label', 'Search Rules and Test Cases');
    const status = node('p', '', parent);
    status.setAttribute('role', 'status');
    const clear = node('button', 'Clear selection', parent);
    clear.type = 'button';
    clear.setAttribute('aria-label', 'Clear selection');
    clear.hidden = filters.cases.selected === null;
    clear.addEventListener('click', () => {
      filters.cases.selected = null;
      filters.cases.selectedFeature = null;
      filterChanged();
    });
    // A Rule count click calls navigation.selectCases, which updates the same state and calls this.
    filterChanged = createFilterApply(status);
    filterBindings.push(() => {
      search.value = filters.query;
      clear.hidden = filters.cases.selected === null;
    });
    const searchChanged = () => { filters.query = search.value; filterChanged(); };
    search.addEventListener('input', searchChanged);
    search.addEventListener('change', searchChanged);
  };

  /**
   * @param {Element} parent
   * @param {readonly ShowFeature[]} features
   * @returns {void}
   */
  const renderShowSummary = (parent, features) => {
    const scroll = node('div', undefined, parent);
    scroll.className = 'table-scroll';
    const table = node('table', undefined, scroll);
    node('caption', 'Feature summary', table).className = 'muted';
    const headings = node('tr', undefined, node('thead', undefined, table));
    for (const title of ['Feature', 'Rules', 'Cases', 'Uncovered Rules', 'Parked questions', 'Deferred functionality', 'Open Findings']) node('th', title, headings);
    const body = node('tbody', undefined, table);
    for (const feature of features) {
      const row = node('tr', undefined, body);
      const name = node('td', undefined, row);
      const link = node('a', feature.header.title, name);
      link.setAttribute('href', `#feature-${feature.key}`);
      link.addEventListener('click', () => navigation.openFeature(feature.key));
      for (const [field, count] of /** @type {const} */ ([
        ['rules', feature.summary.rules],
        ['cases', feature.summary.cases],
        ['uncovered', feature.summary.uncovered],
        ['parked', feature.summary.parked],
        ['deferred', feature.summary.deferred],
        ['findings', feature.summary.findings],
      ])) {
        const cell = node('td', String(count), row);
        cell.setAttribute('data-count', field);
      }
    }
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
      keyed(node('th', undefined, row), rule.key, feature.key);
      node('td', rule.statement, row);
      node('td', rule.elaboration, row);
      node('td', `Covered by ${rule.direct_covers}`, row);
      const annotations = node('td', undefined, row);
      if (feature.state.rules[rule.key]) renderShowAnnotations(annotations, feature.state.rules[rule.key]);
      renderShowRuleCoverCount(row, feature, rule.key);
      renderShowRuleLinks(row, feature, rule.key);
    }
  };

  /** @param {unknown} value @returns {string[]} */
  const showScenarioList = (value) => value == null ? [] : (Array.isArray(value) ? value : [value]).map(String);

  /**
   * @param {string[]} values
   * @param {readonly string[]} retired
   * @returns {string}
   */
  const showScenarioLabels = (values, retired) => values.map(value => retired.includes(value) ? `${value} (retired)` : value).join(', ');

  /**
   * @param {Element} summary
   * @param {ShowFeature} feature
   * @param {import('./page.d.mts').ShowCaseRow} entry
   * @param {import('./page.d.mts').ShowReview | undefined} review
   * @returns {void}
   */
  const showScenarioSummary = (summary, feature, entry, review) => {
    node('span', ` · Test level: ${entry.levels.length ? entry.levels.join(', ') : 'Layer-free'}`, summary);
    const tags = showScenarioList(entry.data.tags);
    if (tags.length) node('span', ` · Tags: ${showScenarioLabels(tags, model.labels.retiredTags)}`, summary);
    for (const field of model.labels.customFields) {
      const values = showScenarioList(entry.data[field.name]);
      if (values.length) node('span', ` · ${field.name}: ${showScenarioLabels(values, field.retired)}`, summary);
    }
    if (review) node('span', ` · Review: ${review.status}${review.overdue ? ' · overdue' : ''}`, summary);
    const annotations = model.features[feature.key]?.state.cases[entry.key]?.annotations;
    if (annotations) renderShowAnnotations(summary, annotations);
  };

  /**
   * A case section's own bold label is shown as a plain label, then the rest of the text. The
   * model keeps the raw text (search reads it); only its leading label is split here.
   * @param {HTMLElement} content
   * @param {import('./page.d.mts').ShowCaseSection} section
   * @returns {void}
   */
  const showCaseSection = (content, section) => {
    const match = /^\*\*([^*]+)\*\*[ \t]*/.exec(section.text);
    if (!match) {
      node('div', section.text, content).className = 'knowledge-prose';
      return;
    }
    const label = node('p', match[1], content);
    label.className = 'case-section-label';
    const text = section.text.slice(match[0].length).replace(/^\r?\n/, '');
    if (text) node('div', text, content).className = 'knowledge-prose';
  };

  /**
   * @param {HTMLElement} parent
   * @param {string} label
   * @param {string[]} keys
   * @param {string} feature
   * @returns {void}
   */
  const showScenarioKeys = (parent, label, keys, feature) => {
    if (!keys.length) return;
    const line = node('p', `${label}: `, parent);
    keys.forEach((key, index) => {
      if (index) node('span', ', ', line);
      keyed(line, key, feature);
    });
  };

  /**
   * @param {Element} parent
   * @param {Record<string, unknown>} data
   * @returns {void}
   */
  const showScenarioReferences = (parent, data) => {
    const values = showScenarioList(data.sources);
    if (!values.length) return;
    const line = node('p', 'References: ', parent);
    values.forEach((source, index) => {
      if (index) node('span', ' · ', line);
      renderShowReference(line, source);
    });
  };

  /**
   * @param {Element} parent
   * @param {Record<string, unknown>} data
   * @returns {void}
   */
  const showScenarioProvenance = (parent, data) => {
    node('p', `Provenance: ${showProvenanceText(data.generated ?? null)}`, parent);
  };

  /**
   * @param {HTMLElement} content
   * @param {ShowFeature} feature
   * @param {import('./page.d.mts').ShowCaseRow} entry
   * @param {import('./page.d.mts').ShowReview | undefined} review
   * @returns {void}
   */
  const showScenarioCase = (content, feature, entry, review) => {
    for (const section of entry.sections) showCaseSection(content, section);
    const roles = showScenarioList(entry.data.roles);
    if (roles.length) node('p', `Roles: ${roles.join(', ')}`, content);
    showScenarioKeys(content, 'Covers', showScenarioList(entry.data.covers), feature.key);
    showScenarioKeys(content, 'Relies on', showScenarioList(entry.data.relies_on), feature.key);
    if (entry.data.automatable !== undefined) node('p', `automatable: ${String(entry.data.automatable)}`, content);
    const automates = showScenarioList(entry.data.automates);
    if (automates.length) node('p', `automates: ${automates.join(', ')}`, content);
    showScenarioReferences(content, entry.data);
    showScenarioProvenance(content, entry.data);
    node('p', `Review stamp: ${review?.stamp == null ? 'none' : showProvenanceText(review.stamp)}`, content);
    node('p', `Review deadline: ${review?.deadline ?? 'none'}`, content);
  };

  /**
   * @param {Element} parent
   * @param {ShowFeature} feature
   * @returns {void}
   */
  const renderShowScenarios = (parent, feature) => {
    /** @type {Map<string, import('./page.d.mts').ShowLazyMount>} */
    const caseMounts = new Map();
    const scenarios = lazy(parent, 'Test Scenarios', body => {
      for (const scenario of Object.values(feature.scenarios.rows)) {
        const group = node('section', undefined, body);
        node('h3', `${scenario.key}: ${scenario.title}`, group);
        showScenarioProvenance(group, scenario.data);
        showScenarioReferences(group, scenario.data);
        for (const entry of Object.values(scenario.cases)) {
          const anchor = node('section', undefined, group);
          anchor.id = `${feature.key}-${entry.key}`;
          const review = feature.state.cases[entry.key]?.review;
          caseMounts.set(`${scenario.key}/${entry.key}`, lazy(anchor, `${entry.key}: ${entry.title}`, content => {
            showScenarioCase(content, feature, entry, review);
          }));
          // `lazy` builds the details with its summary as the first child.
          showScenarioSummary(anchor.children[0].children[0], feature, entry, review);
        }
      }
    });
    scenariosOpeners.set(feature.key, scenarios.open);
    // Registered before the path is opened, so navigation and search can build it on demand.
    for (const scenario of Object.values(feature.scenarios.rows)) {
      for (const key of Object.keys(scenario.cases)) {
        caseOpeners.set(`${feature.key}/${scenario.key}/${key}`, () => {
          scenarios.open();
          caseMounts.get(`${scenario.key}/${key}`)?.open();
        });
      }
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
  renderShowErrors(headerStack, model.errors.rows);
  renderShowPageState(headerStack);
  renderShowLegend(headerStack);
  renderShowPageFilters(headerStack);
  if (model.scope === null) renderShowSummary(headerStack, Object.values(model.features));

  for (const feature of Object.values(model.features)) {
    // Every Feature is a disclosure. Its contents, and its Rules table, are built only when it is
    // opened; the selected Feature opens at mount so `/qa-show <feature-key>` reads whole.
    const section = node('section', undefined, app);
    section.id = `feature-${feature.key}`;
    const mount = lazy(section, feature.header.title, detail => {
      node('p', feature.header.intro, detail).className = 'knowledge-prose';
      const refs = node('p', 'References: ', detail);
      feature.header.references.forEach((reference, index) => {
        if (index) node('span', ' · ', refs);
        renderShowReference(refs, String(reference));
      });
      node('p', `Provenance: ${showProvenanceText(feature.header.provenance)}`, detail);
      renderShowErrors(detail, feature.errors.rows);
      renderShowFeatureState(detail, feature);
      renderShowKnowledge(detail, feature);
      const rulesMount = lazy(detail, 'Rules', parent => showRules(parent, feature));
      rulesOpeners.set(feature.key, rulesMount.open);
      renderShowFeatureFilters(detail);
      renderShowScenarios(detail, feature);
    });
    featureOpeners.set(feature.key, mount.open);
    if (model.scope === feature.key) mount.open();
  }

  return {
    navigation,
    filters,
    filterChanged: () => filterChanged(),
  };
}
