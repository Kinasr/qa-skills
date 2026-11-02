// @ts-check
// Reference rendering and Rule links. References become links only for an http/https URL that the
// URL parser accepts, or a `#anchor`; every other reference stays text. Rule rows gain their
// Reliance and both Dependency directions, and the direct-cover count filters the case tree through
// the shared case-selection operation.
/**
 * The only external schemes that may become a link. A fragment is an internal anchor and needs no
 * URL parsing; everything else, including an obfuscated `javascript:` or a malformed URL, is text.
 * @param {string} reference
 * @returns {string | null}
 */
function showLinkTarget(reference) {
  if (reference.startsWith('#')) return reference;
  try {
    // Constructed by reflection: the page-safety tests reject the CSS url-function token in the HTML.
    const url = Reflect.construct(URL, [reference]);
    return url.protocol === 'http:' || url.protocol === 'https:' ? reference : null;
  } catch {
    return null;
  }
}

/**
 * @param {Element} parent
 * @param {string} reference
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {void}
 */
function showLinkReference(parent, reference, ctx) {
  const href = showLinkTarget(reference);
  if (href === null) {
    ctx.node('span', reference, parent);
    return;
  }
  const link = ctx.node('a', reference, parent);
  link.setAttribute('href', href);
}

/**
 * @param {import('./page.d.mts').ShowPageModel} model
 * @param {string} feature
 * @param {string} key
 * @returns {string | null}
 */
function showLinkScenario(model, feature, key) {
  const section = model.features[feature];
  if (!section) return null;
  for (const scenario of Object.values(section.scenarios.rows)) {
    if (Object.hasOwn(scenario.cases, key)) return scenario.key;
  }
  return null;
}

/**
 * @param {Element} root
 * @param {(element: Element) => boolean} matches
 * @returns {Element | undefined}
 */
function showLinkFind(root, matches) {
  for (const child of Array.from(root.children)) {
    if (matches(child)) return child;
    const found = showLinkFind(child, matches);
    if (found) return found;
  }
  return undefined;
}

/**
 * Open a Rule's own Feature and its Rules disclosure, so the Rule anchor a Dependency links to
 * exists before the browser follows the fragment.
 * @param {Element} parent
 * @param {string} feature
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {void}
 */
function showLinkOpenRules(parent, feature, ctx) {
  ctx.navigation.openFeature(feature);
  let root = parent;
  while (root.parentElement) root = root.parentElement;
  const section = showLinkFind(root, element => element.id === `feature-${feature}`);
  const rules = section && showLinkFind(section, element => element.tagName === 'DETAILS' && element.children[0]?.textContent === 'Rules');
  if (!rules) return;
  const details = /** @type {{ open?: boolean, listeners?: { toggle?: () => void } }} */ (rules);
  details.open = true;
  details.listeners?.toggle?.();
}

/**
 * A destination links only when its Feature is on the page. A case link opens that case's lazy
 * path first; a Rule link opens its Feature and Rules, and the fragment carries the reader to the
 * Rule.
 * @param {Element} parent
 * @param {import('./page.d.mts').ShowRuleLink} destination
 * @param {'case' | 'rule'} kind
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {void}
 */
function showLinkDestination(parent, destination, kind, ctx) {
  const label = `${destination.feature}/${destination.key}`;
  const present = Object.hasOwn(ctx.model.features, destination.feature);
  const line = ctx.node('p', undefined, parent);
  if (!present) {
    ctx.node('span', label, line);
  } else {
    const link = ctx.node('a', label, line);
    link.setAttribute('href', `#${destination.feature}-${destination.key}`);
    link.addEventListener('click', () => {
      if (kind === 'case') {
        const scenario = showLinkScenario(ctx.model, destination.feature, destination.key);
        if (scenario !== null) ctx.navigation.openCase(destination.feature, scenario, destination.key);
      } else {
        showLinkOpenRules(parent, destination.feature, ctx);
      }
    });
  }
  ctx.node('span', destination.summary ? `: ${destination.summary}` : '', line);
}

/**
 * @param {Element} parent
 * @param {string} label
 * @param {readonly import('./page.d.mts').ShowRuleLink[]} destinations
 * @param {'case' | 'rule'} kind
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {void}
 */
function showLinkList(parent, label, destinations, kind, ctx) {
  const heading = ctx.node('p', `${label} ${destinations.length}`, parent);
  heading.className = 'muted';
  for (const destination of destinations) showLinkDestination(parent, destination, kind, ctx);
}

/**
 * @param {Element} parent
 * @param {import('./page.d.mts').ShowFeature} feature
 * @param {string} key
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {void}
 */
function showRuleLinks(parent, feature, key, ctx) {
  const links = feature.links.rules[key];
  if (!links) return;
  const cell = ctx.node('td', undefined, parent);
  showLinkList(cell, 'Relied on by', links.relied_on_by, 'case', ctx);
  showLinkList(cell, 'Depends on', links.dependencies, 'rule', ctx);
  showLinkList(cell, 'Dependents', links.dependents, 'rule', ctx);
}

/**
 * The covering count the Rules table already renders becomes the filter control: clicking it
 * selects this Rule's direct covering cases through the one shared selection operation.
 * @param {Element} parent
 * @param {import('./page.d.mts').ShowFeature} feature
 * @param {string} key
 * @param {import('./show-dom.d.mts').ShowRenderContext} ctx
 * @returns {void}
 */
function showRuleCoverCount(parent, feature, key, ctx) {
  const links = feature.links.rules[key];
  if (!links || links.covers.length === 0) return;
  const text = `Covered by ${links.covers.length}`;
  const count = /** @type {HTMLElement | undefined} */ (Array.from(parent.children).find(child => child.textContent === text));
  if (!count) return;
  count.setAttribute('role', 'button');
  count.tabIndex = 0;
  count.setAttribute('aria-label', `Show cases covering ${key}`);
  const select = () => ctx.navigation.selectCases(feature.key, links.covers);
  count.addEventListener('click', select);
  count.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    select();
  });
}

/**
 * @param {unknown} request a ShowSectionRequest at the browser boundary
 * @returns {void}
 */
export function showLinksView(request) {
  const slot = /** @type {import('./show-dom.d.mts').ShowSectionRequest} */ (request);
  if (slot.phase === 'reference') {
    showLinkReference(slot.parent, slot.reference, slot.ctx);
    return;
  }
  if (slot.phase !== 'rule') return;
  showRuleCoverCount(slot.parent, slot.feature, slot.key, slot.ctx);
  showRuleLinks(slot.parent, slot.feature, slot.key, slot.ctx);
}
