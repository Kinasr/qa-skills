// @ts-check
// Zero-dependency page logic. This same module is imported by tests and inlined by the
// renderer; keep its top level independent of Node and browser globals.

/**
 * @typedef {import("./page.d.mts").CaseSelection} CaseSelection
 * @typedef {import("./page.d.mts").DismissalValidation} DismissalValidation
 * @typedef {import("./page.d.mts").FindingAnswer} FindingAnswer
 * @typedef {import("./page.d.mts").InboxFact} InboxFact
 * @typedef {import("./page.d.mts").InboxItem} InboxItem
 * @typedef {import("./page.d.mts").InboxPageModel} InboxPageModel
 * @typedef {import("./page.d.mts").PageLayout} PageLayout
 * @typedef {import("./page.d.mts").PageLimits} PageLimits
 * @typedef {import("./page.d.mts").PageModel} PageModel
 * @typedef {import("./page.d.mts").PreparedReply} PreparedReply
 * @typedef {import("./page.d.mts").ReplyItem} ReplyItem
 * @typedef {import("./page.d.mts").ReplyItemFinding} ReplyItemFinding
 * @typedef {import("./page.d.mts").ReplyPayload} ReplyPayload
 * @typedef {import("./page.d.mts").Selections} Selections
 * @typedef {import("./page.d.mts").ShowAnnotations} ShowAnnotations
 * @typedef {import("./page.d.mts").ShowCaseRow} ShowCaseRow
 * @typedef {import("./page.d.mts").ShowCaseState} ShowCaseState
 * @typedef {import("./page.d.mts").ShowFeature} ShowFeature
 * @typedef {import("./page.d.mts").ShowFilterState} ShowFilterState
 * @typedef {import("./page.d.mts").ShowRuleRow} ShowRuleRow
 */

// The review answers that remove the case and stand alone: reject (no Tracker key) and retire (a
// Tracker key held). Either clears the findings, which are answered with no one.
/**
 * @param {string | undefined} answer
 * @returns {boolean}
 */
export const removesCase = (answer) => answer === "reject" || answer === "retire";

/** @type {Record<string, PageLayout>} */
const layouts = {
  inbox: { title: "Card page", heading: (model) => `${model.command} · Card page` },
  show: { title: "Knowledge page", heading: () => "Knowledge page" },
  next: { title: "Next steps page", heading: () => "Next steps page" },
};

/**
 * @param {string} layout
 * @returns {PageLayout}
 */
export function cardPageLayout(layout) {
  if (!Object.hasOwn(layouts, layout)) throw new Error(`Unknown Card page layout: ${layout}`);
  return layouts[layout];
}

/**
 * @param {FindingAnswer | undefined} value
 * @returns {value is FindingAnswer & { answer: string }}
 */
const answeredFinding = (value) => /** @type {readonly (string | undefined)[]} */ (["dismiss", "keep", "holds"]).includes(value?.answer)
  || (value?.answer === "fix" && typeof value.fix === "string" && Boolean(value.fix.trim()));

/**
 * @param {InboxItem} item
 * @param {CaseSelection} selected
 * @param {string} answer
 * @returns {void}
 */
export function setReviewAnswer(item, selected, answer) {
  if (!/** @type {import("./page.d.mts").InboxItemQuestions} */ (item.questions).review.choices.includes(answer)) return;
  selected.review = answer;
  if (removesCase(answer)) selected.findings = {};
}

// `value` is a partial answer ({answer, reason, ticket, fix, target}); a bare string is {answer}.
/**
 * @param {CaseSelection} selected
 * @param {string} id
 * @param {string | Partial<FindingAnswer>} value
 * @returns {void}
 */
export function setFindingAnswer(selected, id, value) {
  if (removesCase(selected.review)) return;
  selected.findings ??= {};
  selected.findings[id] = { ...selected.findings[id], ...(typeof value === "string" ? { answer: value } : value) };
}

/**
 * @param {DismissalValidation | undefined} validation
 * @param {string} field
 * @param {unknown} value
 * @returns {string}
 */
export function dismissalError(validation, field, value) {
  if (value === undefined || value === "") return "";
  return typeof value === "string" && new RegExp(/** @type {import("./page.d.mts").DismissalRule} */ (/** @type {DismissalValidation} */ (validation)[field]).pattern).test(value) ? "" : `Invalid ${field}.`;
}

/**
 * @param {InboxItem[]} items
 * @param {string} [kind]
 * @returns {InboxItem[]}
 */
export function filterCases(items, kind = "") {
  return kind ? items.filter((item) => item.facts.some((fact) => fact.kind === kind)) : items;
}

/**
 * @param {{ items: InboxItem[] }} model
 * @param {Selections} [selections]
 * @returns {Selections}
 */
export function leaveUnansweredReviews(model, selections = {}) {
  /** @type {Selections} */
  const result = { ...selections };
  for (const item of model.items) if (!result[item.key]?.review) {
    result[item.key] = { ...result[item.key], review: "leave" };
  }
  return result;
}

/**
 * @param {string} theme
 * @returns {string | undefined}
 */
export function nextTheme(theme) {
  return /** @type {Record<string, string>} */ ({ system: "light", light: "dark", dark: "system" })[theme];
}

/**
 * @param {InboxItem} item
 * @param {CaseSelection} [selected]
 * @returns {"answered" | "partly answered" | "open"}
 */
export function answerStatus(item, selected = {}) {
  if (removesCase(selected.review) && item.questions?.review.choices.includes(/** @type {string} */ (selected.review))) return "answered";
  /** @param {string} id */
  const answered = (id) => answeredFinding(selected.findings?.[id]);
  const review = /** @type {readonly (string | undefined)[]} */ (["accept", "leave"]).includes(selected.review);
  if (review && item.facts.every((f) => answered(f.id))) return "answered";
  return review || item.facts.some((f) => answered(f.id)) ? "partly answered" : "open";
}

/** @type {PageLimits} */
export const DEFAULT_LIMITS = { warn: 30000, max: 40000 };

/**
 * @param {ReplyPayload} reply
 * @returns {string}
 */
const fencedReply = (reply) => `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``;

/**
 * @param {InboxPageModel} model
 * @param {Selections} [selections]
 * @param {string} [comment]
 * @returns {string}
 */
export function buildReply(model, selections = {}, comment = "") {
  const items = model.items.map((item) => {
    const selected = selections[item.key] ?? {};
    if (removesCase(selected.review)) {
      if (!item.questions?.review.choices.includes(/** @type {string} */ (selected.review))) throw new Error(`${item.key}: ${selected.review} is not offered`);
      return /** @type {ReplyItem} */ ({ key: item.key, review: selected.review, ...(selected.comment && { comment: selected.comment }) });
    }
    /** @type {Record<string, ReplyItemFinding>} */
    const findings = {};
    for (const fact of item.facts) {
      const value = selected.findings?.[fact.id];
      if (!answeredFinding(value)) continue;
      findings[fact.id] = { answer: value.answer };
      if (value.answer === "fix") {
        findings[fact.id].fix = value.fix;
        if (value.target !== undefined) findings[fact.id].target = value.target;
      }
      if (value.answer === "dismiss") for (const field of /** @type {const} */ (["reason", "ticket"])) {
        const error = dismissalError(model.validation, field, value[field]);
        if (error) throw new Error(`${item.key}: ${error}`);
        if (value[field]) {
          findings[fact.id][field] = value[field];
        }
      }
    }
    return /** @type {ReplyItem} */ ({
      key: item.key,
      ...(Object.keys(findings).length && { findings }),
      ...(/** @type {readonly (string | undefined)[]} */ (["accept", "leave"]).includes(selected.review) && { review: selected.review }),
      ...(selected.comment && { comment: selected.comment }),
    });
  });
  return fencedReply(/** @type {ReplyPayload} */ ({
    card_page: model.card_page,
    run: model.run,
    page: model.page,
    count: items.length,
    items,
    ...(comment && { comment }),
  }));
}

// The Reply to copy: the complete fenced block is measured against `limits`; over the maximum only the
// whole cases that fit are taken, in walk order. A page comment, or a case, too large on its own is flagged.
/**
 * @param {InboxPageModel} model
 * @param {Selections} [selections]
 * @param {string} [comment]
 * @returns {PreparedReply}
 */
export function prepareReply(model, selections = {}, comment = "") {
  const block = buildReply(model, selections, comment);
  /** @type {ReplyPayload} */
  const reply = JSON.parse(block.slice(8, -4));
  const { warn, max } = model.limits ?? DEFAULT_LIMITS;
  const commentTooLarge = fencedReply({ ...reply, count: 0, items: [] }).length > max;
  /** @type {ReplyItem[]} */
  const items = [];
  for (const item of reply.items) {
    if (fencedReply({ ...reply, count: items.length + 1, items: [...items, item] }).length <= max) items.push(item);
  }
  return {
    block: commentTooLarge ? null : fencedReply({ ...reply, count: items.length, items }),
    length: block.length,
    taken: items.length,
    left: reply.items.length - items.length,
    warning: block.length >= warn,
    overLimit: block.length > max,
    oversized: reply.items.filter((item) => fencedReply({ ...reply, comment: undefined, count: 1, items: [item] }).length > max).map((item) => item.key),
    commentTooLarge,
  };
}

/**
 * Provenance is recorded as `{by, at}` (and sometimes a commit). The page prints it as readable
 * text, never as JSON.
 * @param {unknown} value
 * @returns {string}
 */
export function showProvenanceText(value) {
  if (!value || typeof value !== 'object') return 'none';
  const provenance = /** @type {{by?: unknown, at?: unknown, commit?: unknown}} */ (value);
  const by = typeof provenance.by === 'string' ? provenance.by : null;
  const at = typeof provenance.at === 'string' ? provenance.at : null;
  const commit = typeof provenance.commit === 'string' ? provenance.commit : null;
  return [by, at, commit && `commit ${commit}`].filter(Boolean).join(', ') || 'none';
}

/** @returns {import('./page.d.mts').ShowFilterState} */
export function showFilterState() {
  return { query: '', rules: { uncovered: false, waived: false, findings: false }, cases: { level: '', tag: '', custom: {}, review: '', finding: '', uncited: false, selected: null, selectedFeature: null } };
}

/**
 * @typedef {{query: string, rules: {active: boolean, keys: string[]}, cases: {active: boolean, keys: string[]}, visible: boolean}} ShowFilterMatch
 */
/** @typedef {import('./page.d.mts').ShowFilterState['cases']} ShowCaseFilters */
/** @typedef {import('./page.d.mts').ShowFilterState['rules']} ShowRuleFilters */

/**
 * A label may be stored as one value or a list. Filtering reads what the model holds.
 * @param {unknown} value
 * @returns {string[]}
 */
export function showValues(value) {
  return value == null ? [] : (Array.isArray(value) ? value : [value]).map(String);
}

/**
 * @param {unknown} value
 * @param {string} query lower-case
 * @returns {boolean}
 */
function showTextIncludes(value, query) {
  if (typeof value === 'string') return value.toLowerCase().includes(query);
  if (Array.isArray(value)) return value.some(item => showTextIncludes(item, query));
  if (value && typeof value === 'object') return Object.values(value).some(item => showTextIncludes(item, query));
  return false;
}

/**
 * @param {ShowRuleRow} rule
 * @param {string} query lower-case
 * @returns {boolean}
 */
export function showRuleTextMatches(rule, query) {
  return showTextIncludes([rule.key, rule.statement, rule.elaboration], query);
}

/**
 * @param {ShowCaseRow} entry
 * @param {string} query lower-case
 * @returns {boolean}
 */
export function showCaseTextMatches(entry, query) {
  return showTextIncludes([entry.key, entry.title, entry.data, entry.sections], query);
}

/**
 * Rule filters read the normalized flags and Findings; they never recompute them from cases.
 * @param {ShowAnnotations | undefined} annotations
 * @param {ShowRuleFilters} filters
 * @returns {boolean}
 */
export function showRuleFilterMatches(annotations, filters) {
  if (filters.uncovered && !annotations?.flags.includes('uncovered')) return false;
  if (filters.waived && !annotations?.flags.includes('waived')) return false;
  if (filters.findings && !annotations?.findings.length) return false;
  return true;
}

/**
 * Case filters read the normalized Review, Findings and gap booleans, plus the case's own labels.
 * `selected` is the shared count-click selection; it is disabled only when null.
 * @param {string} feature
 * @param {ShowCaseRow} entry
 * @param {ShowCaseState | undefined} state
 * @param {ShowCaseFilters} filters
 * @returns {boolean}
 */
export function showCaseFilterMatches(feature, entry, state, filters) {
  if (filters.level && entry.data.level !== filters.level) return false;
  if (filters.tag && !showValues(entry.data.tags).includes(filters.tag)) return false;
  for (const [name, value] of Object.entries(filters.custom)) {
    if (value && !showValues(entry.data[name]).includes(value)) return false;
  }
  if (filters.review) {
    const review = state?.review;
    if (filters.review === 'overdue' ? !review?.overdue : review?.status !== filters.review) return false;
  }
  if (filters.finding) {
    const findings = state?.annotations.findings ?? [];
    if (filters.finding === 'any' ? findings.length === 0 : !findings.some(finding => finding.kind === filters.finding || finding.code === filters.finding)) return false;
  }
  if (filters.uncited && !state?.uncited) return false;
  if (filters.selected !== null && (filters.selectedFeature !== feature || !filters.selected.includes(entry.key))) return false;
  return true;
}

/**
 * One pass over a Feature's in-memory model. Rule and case predicates stay independent; a visible
 * Feature is one that has a match in either bar, or any match for a text query.
 * @param {ShowFeature} feature
 * @param {ShowFilterState} filters
 * @returns {ShowFilterMatch}
 */
export function showMatches(feature, filters) {
  const query = filters.query.trim().toLowerCase();
  const ruleFilter = filters.rules.uncovered || filters.rules.waived || filters.rules.findings;
  const caseFilter = Boolean(filters.cases.level || filters.cases.tag
    || Object.values(filters.cases.custom).some(Boolean)
    || filters.cases.review || filters.cases.finding || filters.cases.uncited
    || filters.cases.selected !== null);
  /** @type {string[]} */
  const rules = [];
  for (const rule of Object.values(feature.rules.rows)) {
    if (ruleFilter && !showRuleFilterMatches(feature.state.rules[rule.key], filters.rules)) continue;
    if (query && !showRuleTextMatches(rule, query)) continue;
    rules.push(rule.key);
  }
  /** @type {string[]} */
  const cases = [];
  for (const scenario of Object.values(feature.scenarios.rows)) {
    for (const entry of Object.values(scenario.cases)) {
      if (caseFilter && !showCaseFilterMatches(feature.key, entry, feature.state.cases[entry.key], filters.cases)) continue;
      if (query && !showCaseTextMatches(entry, query)) continue;
      cases.push(entry.key);
    }
  }
  const visible = query
    ? rules.length > 0 || cases.length > 0
    : ruleFilter && caseFilter ? rules.length > 0 || cases.length > 0
      : ruleFilter ? rules.length > 0
        : caseFilter ? cases.length > 0
          : true;
  return { query, rules: { active: ruleFilter, keys: rules }, cases: { active: caseFilter, keys: cases }, visible };
}

/**
 * @typedef {{ labels: Readonly<Record<string, string>>, matcher: RegExp | null }} ShowFeatureKeys
 * @typedef {Readonly<Record<string, ShowFeatureKeys>>} ShowKeyLookup
 */
/**
 * Client-built, Feature-scoped lookup and one matcher for each Feature. No duplicated summaries
 * cross the JSON seam; rule keys are local to a Feature.
 * @param {import('./page.d.mts').ShowPageModel} model
 * @returns {ShowKeyLookup}
 */
export function showKeyLookup(model) {
  return Object.fromEntries(Object.values(model.features).map(feature => {
    /** @type {Record<string, string>} */
    const labels = { [feature.key]: feature.header.title };
    for (const rule of Object.values(feature.rules.rows)) labels[rule.key] = rule.statement;
    for (const scenario of Object.values(feature.scenarios.rows)) {
      labels[scenario.key] = scenario.title;
      for (const entry of Object.values(scenario.cases)) labels[entry.key] = entry.title;
    }
    const pattern = Object.keys(labels).sort((a, b) => b.length - a.length).map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return [feature.key, { labels: Object.freeze(labels), matcher: pattern ? new RegExp(`(?<![\\w-])(?:${pattern})(?![\\w-])`, 'g') : null }];
  }));
}

/**
 * Freeze serialized projection outputs so section renderers cannot change another section's facts.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function immutableShow(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutableShow(child);
    Object.freeze(value);
  }
  return value;
}
