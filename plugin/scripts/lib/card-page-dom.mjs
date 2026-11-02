// @ts-check
// Composition entry for the page script. Section views import only the neutral
// client; this entry may also import their mounts. Keep top-level bindings unique
// across the ordered PAGE_MODULES manifest for raw inlining.
import { showScenariosView } from "./card-page-view-show-scenarios.mjs";
import { showKnowledgeView } from "./card-page-view-show-knowledge.mjs";
import { showErrorsView } from "./card-page-view-show-errors.mjs";
import { showStateView } from "./card-page-view-show-state.mjs";
import { showLinksView } from "./card-page-view-show-links.mjs";
import { showFiltersView } from "./card-page-view-show-filters.mjs";
import { showOverviewView } from "./card-page-view-show-overview.mjs";
import { mountShow } from "./card-page-view-show.mjs";
import {
  answerStatus,
  cardPageLayout,
  DEFAULT_LIMITS,
  dismissalError,
  filterCases,
  leaveUnansweredReviews,
  nextTheme,
  prepareReply,
  removesCase,
  setFindingAnswer,
  setReviewAnswer,
} from "./card-page-client.mjs";

/**
 * @typedef {import("./page.d.mts").CaseSelection} CaseSelection
 * @typedef {import("./page.d.mts").FindingAnswer} FindingAnswer
 * @typedef {import("./page.d.mts").InboxItem} InboxItem
 * @typedef {import("./page.d.mts").InboxPageModel} InboxPageModel
 * @typedef {import("./page.d.mts").NextExecutions} NextExecutions
 * @typedef {import("./page.d.mts").NextPageModel} NextPageModel
 * @typedef {import("./page.d.mts").NextRoute} NextRoute
 * @typedef {import("./page.d.mts").NextStep} NextStep
 * @typedef {import("./page.d.mts").PageLimits} PageLimits
 * @typedef {import("./page.d.mts").PageModel} PageModel
 * @typedef {import("./page.d.mts").PreparedReply} PreparedReply
 * @typedef {import("./page.d.mts").Selections} Selections
 */

/** @type {Record<string, (model: PageModel, doc: Document, ctx: { app: HTMLElement, header: HTMLElement, node: (<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: Element) => HTMLElementTagNameMap[K]) }) => void>} */
const views = {
  // Feature order: errors and state, knowledge (Coverage through Boundaries), Rules, the two
  // filter bars, then the Scenario → Case tree. The summary and banners stay page-level.
  show: (model, doc, ctx) => mountShow(/** @type {import("./page.d.mts").ShowPageModel} */ (model), doc, ctx, [showErrorsView, showStateView, showKnowledgeView, showFiltersView, showScenariosView, showLinksView, showOverviewView], 3),
  inbox: /** @type {(model: PageModel, doc: Document, ctx: { app: HTMLElement, header: HTMLElement, node: (<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: Element) => HTMLElementTagNameMap[K]) }) => void} */ (mountInbox),
  next: /** @type {(model: PageModel, doc: Document, ctx: { app: HTMLElement, header: HTMLElement, node: (<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: Element) => HTMLElementTagNameMap[K]) }) => void} */ (mountNext),
};

/**
 * The summaries a keyed text can show in `feature`: every Feature, Test Scenario and Test Case, and that
 * Feature's Rules only, since Rule keys are scoped per Feature.
 * @param {import("./page.d.mts").InboxSummaries | undefined} summaries
 * @returns {(feature?: string) => Record<string, string | undefined>}
 */
const featureLabels = (summaries = {}) => (feature) => ({ ...summaries.features, ...summaries.scenarios, ...summaries.cases, ...summaries.rules?.[/** @type {string} */ (feature)] });

/**
 * @param {Document} doc
 * @param {<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: Element) => HTMLElementTagNameMap[K]} node
 * @param {(feature?: string) => Record<string, string | undefined>} labelsForFeature
 * @returns {(parent: Element, text: string | number | null | undefined, feature?: string, owner?: Element) => void}
 */
function keyedText(doc, node, labelsForFeature) {
  let tooltipId = 0;
  // Text with `code spans` rendered as <code> and every known Feature, Test Scenario, Test Case and Rule key
  // wrapped so its summary shows on hover and focus. Everything enters the document as text.
  // Inside a button (`owner`) the key is not focusable; the button carries the description instead.
  return (parent, text, feature, owner) => {
    const labels = labelsForFeature(feature);
    const keys = Object.keys(labels).filter(Boolean).sort((a, b) => b.length - a.length);
    const pattern = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    /** @type {string[]} */
    const described = [];
    /**
     * @param {Element} into
     * @param {string} part
     */
    const withKeys = (into, part) => {
      let end = 0;
      for (const match of pattern ? part.matchAll(new RegExp(`(?<![\\w-])(?:${pattern})(?![\\w-])`, "g")) : []) {
        into.append(doc.createTextNode(part.slice(end, match.index)));
        const key = node("span", match[0], into);
        key.className = "key";
        if (!owner) key.tabIndex = 0;
        const tooltip = node("span", labels[match[0]], key);
        tooltip.className = "key-summary";
        tooltip.id = `key-summary-${++tooltipId}`;
        tooltip.setAttribute("role", "tooltip");
        if (owner) described.push(tooltip.id); else key.setAttribute("aria-describedby", tooltip.id);
        end = /** @type {number} */ (match.index) + match[0].length;
      }
      into.append(doc.createTextNode(part.slice(end)));
    };
    parent.replaceChildren();
    text = String(text);
    let end = 0;
    for (const span of text.matchAll(/`([^`\n]+)`/g)) {
      withKeys(parent, text.slice(end, span.index));
      withKeys(node("code", undefined, parent), span[1]);
      end = /** @type {number} */ (span.index) + span[0].length;
    }
    withKeys(parent, text.slice(end));
    if (owner && described.length) owner.setAttribute("aria-describedby", described.join(" "));
  };
}

/**
 * @param {Document} doc
 * @param {string} text
 * @param {HTMLTextAreaElement} manual
 * @returns {Promise<boolean>}
 */
async function copyText(doc, text, manual) {
  try { await /** @type {Window} */ (doc.defaultView).navigator.clipboard.writeText(text); manual.hidden = true; return true; } catch {}
  manual.value = text;
  manual.hidden = false;
  manual.focus();
  manual.select();
  // @ts-ignore execCommand is deprecated in DOM types, and its optional call is the runtime check
  try { if (doc.execCommand?.("copy")) { manual.hidden = true; return true; } } catch {}
  manual.focus();
  manual.select();
  return false;
}

// DOM adapter: all knowledge and Reply strings enter the document as text or values.
/**
 * @param {PageModel} model
 * @param {unknown} [doc] - a `Document`: its DOM type is left out of the export, which the policy check walks
 * @returns {void}
 */
export function mountCardPage(model, doc = document) {
  const layout = cardPageLayout(model.layout === undefined ? "inbox" : model.layout);
  /** @type {Document} */ (doc).title = layout.title;
  /**
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag
   * @param {string} [text]
   * @param {Element} [parent]
   * @returns {HTMLElementTagNameMap[K]}
   */
  const node = (tag, text, parent) => {
    const el = /** @type {Document} */ (doc).createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (parent) parent.append(el);
    return el;
  };
  const app = /** @type {HTMLElement} */ (/** @type {Document} */ (doc).getElementById("card-page-app"));
  const header = node("header", undefined, app);
  node("h1", layout.heading(model), header);
  const theme = node("button", "Theme: system", header);
  theme.type = "button";
  let themeSetting = "system";
  theme.addEventListener("click", () => {
    themeSetting = /** @type {string} */ (nextTheme(themeSetting));
    if (themeSetting === "system") /** @type {Document} */ (doc).documentElement.removeAttribute("data-theme");
    else /** @type {Document} */ (doc).documentElement.setAttribute("data-theme", themeSetting);
    theme.textContent = `Theme: ${themeSetting}`;
  });
  const view = views[model.layout === undefined ? "inbox" : model.layout];
  view(model, /** @type {Document} */ (doc), { app, header, node });
}

/**
 * @param {NextPageModel} model
 * @param {Document} doc
 * @param {{ app: HTMLElement, header: HTMLElement, node: (<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: Element) => HTMLElementTagNameMap[K]) }} ctx
 * @returns {void}
 */
function mountNext(model, doc, { app, header, node }) {
  const labelsForFeature = featureLabels(model.summaries);
  const keyed = keyedText(doc, node, labelsForFeature);
  const badge = (/** @type {string} */ kind) => {
    const entry = model.legend.find((entry) => entry.kind === kind);
    return entry ? `${entry.emoji} ${entry.label}` : kind;
  };
  const section = (/** @type {string} */ title) => {
    const el = node("section", undefined, app);
    el.setAttribute("aria-label", title);
    node("h2", title, el);
    return el;
  };
  const location = (/** @type {{ file?: string, line?: number }} */ place) => `${place.file}${place.line ? `:${place.line}` : ""}`;
  const routeText = (/** @type {NextRoute} */ route) => route.type === "command" ? [route.command, ...(/** @type {string[]} */ (route.args))].join(" ") : /** @type {string} */ (route.text);
  const showRoute = (/** @type {NextRoute} */ route, /** @type {Element} */ parent, optional = false, /** @type {string | undefined} */ feature = undefined) => {
    const text = routeText(route);
    const line = node("p", undefined, parent);
    keyed(line, `${optional ? "Optional: " : ""}${text}`, feature);
    if (route.type !== "command") return;
    line.append(" ");
    const copy = node("button", "Copy route", line);
    copy.type = "button";
    line.append(" ");
    const message = node("span", "", line);
    message.setAttribute("role", "status");
    const manual = node("textarea", undefined, line);
    manual.setAttribute("aria-label", "Route to copy");
    manual.readOnly = true;
    manual.hidden = true;
    copy.addEventListener("click", async () => {
      message.textContent = await copyText(doc, text, manual)
        ? "Copied. Paste the command into your conversation." : "Press ⌘C or Ctrl+C to copy the selected route.";
    });
  };
  const showStepRoutes = (/** @type {NextStep} */ step, /** @type {Element} */ parent) => {
    const feature = step.feature ?? undefined;
    for (const prerequisite of step.prerequisites) keyed(node("p", undefined, parent), `Prerequisite: ${prerequisite}`, feature);
    showRoute(step.route, parent, false, feature);
    for (const route of step.optional_routes ?? []) showRoute(route, parent, true, feature);
  };
  // Execution results are information about the application, never Next steps.
  const showExecutions = (/** @type {NextExecutions} */ { passed, results }, /** @type {Element} */ parent, /** @type {string} */ feature) => {
    for (const row of results) {
      const parts = [badge(row.kind), row.label, row.reason, row.date, row.target, row.out_of_date && "out of date", row.at_login && "at login", location(row)];
      keyed(node("p", undefined, parent), parts.filter(Boolean).join(" · "), feature);
      if (row.hint) keyed(node("p", undefined, parent), row.hint, feature);
    }
    if (passed.count) node("p", `ℹ️ ${passed.count} Passed${passed.out_of_date ? ` · ${passed.out_of_date} out of date` : ""}`, parent);
  };
  const { stamp, global } = model;
  node("p", `Generated: ${stamp.generated_at} · HEAD: ${stamp.head ?? "none"} · ${stamp.dirty ? ".qa/ has uncommitted edits" : ".qa/ has no uncommitted edits"}`, header);
  node("p", `Root: ${stamp.root}`, header);
  node("p", `Refresh: ${stamp.refresh}`, header);

  const health = section("Global health");
  node("p", `Migration: ${global.migration.pending ? `${global.migration.count} declarations; ${(global.migration.migrations ?? []).map((step) => step.command).join(" then ")}` : "current"}`, health);
  if (global.migration.declarations?.length) {
    const declarations = node("details", undefined, health);
    declarations.open = false;
    node("summary", "Migration declarations", declarations);
    for (const declaration of global.migration.declarations) node("p", `${declaration.key ?? "No Key"} · ${location(declaration)}`, declarations);
  }
  node("p", `Schema: ${global.schema.code} · version ${global.schema.version} · supported ${global.schema.supported}`, health);
  for (const item of global.run_health) node("p", `${item.code}: ${item.message}`, health);
  if (!global.run_health.length) node("p", "Run health: healthy", health);
  if (global.training) {
    const training = section("Training");
    for (const item of global.training.commands) node("p", `${item.command}: ${item.trained ? "trained" : "untrained"} · ${item.conventions} Conventions · ${item.practices} Practices`, training);
    node("p", `Access notes: ${global.training.access_notes}`, training);
  }

  const features = section("Features");
  for (const feature of model.features) {
    const detail = node("details", undefined, features);
    detail.open = !feature.nothing_pending || Boolean(feature.executions);
    node("summary", `${feature.label}${feature.nothing_pending ? ` · ${badge("nothing_pending")}` : ""}`, detail);
    for (const info of feature.information) node("p", `${badge(info.kind)} · ${info.count} ${info.labels.signal}`, detail);
    for (const [kind, count] of Object.entries(feature.counts)) if (count) node("p", `${badge(kind)} · ${count}`, detail);
    if (feature.executions) showExecutions(feature.executions, detail, feature.key);
  }
  if (model.start_here) {
    const start = node("div", undefined, app);
    keyed(node("p", undefined, start), `${badge("start_here")} · ${model.start_here.labels.signal}`, model.start_here.feature ?? undefined);
    showStepRoutes(model.start_here, start);
  } else node("p", badge("nothing_pending"), app);

  const steps = section("Next steps");
  const kindLabel = node("label", "Kind", steps);
  const kindFilter = node("select", undefined, kindLabel);
  for (const kind of ["", ...new Set(model.next_steps.map((step) => step.kind))]) {
    const option = node("option", kind ? badge(kind) : "All kinds", kindFilter);
    option.value = kind;
  }
  const featureLabel = node("label", "Feature", steps);
  const featureFilter = node("select", undefined, featureLabel);
  for (const feature of [{ key: "", label: "All Features" }, ...model.features]) {
    const option = node("option", feature.label.replace(/`([^`\n]+)`/g, "$1"), featureFilter);
    option.value = feature.key;
  }
  const status = node("p", "", steps);
  status.setAttribute("role", "status");
  const list = node("ol", undefined, steps);
  /** @type {HTMLLIElement[]} */
  const items = [];
  for (const step of model.next_steps) {
    const item = node("li", undefined, list);
    items.push(item);
    const feature = step.feature ?? undefined;
    const labels = labelsForFeature(feature);
    keyed(node("h3", undefined, item), `${badge(step.kind)} · ${step.labels.signal}`, feature);
    keyed(node("p", undefined, item), step.feature === null ? "global" : /** @type {string} */ (step.labels.feature), feature);
    if (step.labels.detail) keyed(node("p", undefined, item), step.labels.detail, feature);
    if (step.count !== undefined) node("p", `Count: ${step.count}`, item);
    if (step.scenario) keyed(node("p", undefined, item), `${step.scenario} · ${step.labels.scenario ?? labels[step.scenario] ?? ""}`, feature);
    step.keys.forEach((key, i) => keyed(node("p", undefined, item), `${key} · ${(/** @type {string[]} */ (step.labels.keys))[i] ?? labels[key] ?? ""}`, feature));
    const places = step.locations.length ? step.locations : step.file ? [step] : [];
    for (const place of places) node("p", location(place), item);
    showStepRoutes(step, item);
  }
  const filter = () => {
    model.next_steps.forEach((step, i) => {
      items[i].hidden = Boolean((kindFilter.value && step.kind !== kindFilter.value)
        || (featureFilter.value && step.feature !== null && step.feature !== featureFilter.value));
    });
    const shown = items.filter((item) => !item.hidden).length;
    status.textContent = shown ? `Showing ${shown} of ${items.length} Next steps.` : "No steps match these filters.";
  };
  kindFilter.addEventListener("change", filter);
  featureFilter.addEventListener("change", filter);
  filter();
  const legend = section("Legend");
  for (const entry of model.legend) node("p", `${entry.emoji} ${entry.label}`, legend);
}

/**
 * @param {InboxPageModel} model
 * @param {Document} doc
 * @param {{ app: HTMLElement, header: HTMLElement, node: (<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: Element) => HTMLElementTagNameMap[K]) }} ctx
 * @returns {void}
 */
function mountInbox(model, doc, { app, header, node }) {
  const keyed = keyedText(doc, node, featureLabels(model.summaries));
  /** @type {Selections} */
  const selections = Object.create(null);
  node("p", "Answer cases, copy the Reply, then paste it into your conversation.", header);
  const filterLabel = node("label", "Finding kind", app);
  const filter = node("select", undefined, filterLabel);
  for (const kind of ["", "Conflict", "Stale", "Divergence", "Outcome gap", "Overreach"]) {
    const option = node("option", kind || "All cases", filter);
    option.value = kind;
  }
  const bulk = node("button", "Leave every unanswered review", app);
  bulk.type = "button";
  const inbox = node("div", undefined, app);
  inbox.className = "inbox";
  const list = node("nav", undefined, inbox);
  list.setAttribute("aria-label", "Cases");
  const card = node("section", undefined, inbox);
  card.setAttribute("aria-label", "Selected case");
  const detail = node("div", undefined, card);
  /** @type {HTMLButtonElement[]} */
  const buttons = [];
  /** @type {HTMLSpanElement[]} */
  const statuses = [];
  /** @type {HTMLSpanElement[]} */
  const dots = [];
  /** @type {HTMLInputElement[]} */
  let reviewControls = [];
  let selectedIndex = -1;
  /** @type {Record<string, string>} */
  const statusLabels = { answered: "Settled on page", "partly answered": "Partly answered", open: "Open" };
  let refreshSize = () => {};
  const update = () => {
    model.items.forEach((item, i) => {
      const status = answerStatus(item, selections[item.key]);
      statuses[i].textContent = ` · ${statusLabels[status]}`;
      dots[i].className = `dot ${status === "answered" ? "done" : status === "open" ? "open" : "partial"}`;
    });
    updateReview();
    refreshSize();
  };
  const syncReview = () => {
    const selected = selections[model.items[selectedIndex]?.key];
    reviewControls.forEach((input) => {
      input.checked = selected?.review === input.value;
    });
  };
  /**
   * @param {Element} parent
   * @param {string} title
   * @param {string | undefined} value
   * @param {(val: string) => void} changed
   * @param {boolean} [multiline]
   * @param {(val: string) => string} [validate]
   * @returns {{ input: HTMLInputElement | HTMLTextAreaElement, check: () => void }}
   */
  const field = (parent, title, value, changed, multiline = false, validate) => {
    const label = node("label", title, parent);
    const input = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (node(multiline ? "textarea" : "input", undefined, label));
    if (!multiline) /** @type {HTMLInputElement} */ (input).type = "text";
    input.value = value ?? "";
    const error = validate && node("span", "", label);
    const check = () => {
      if (!validate) return;
      /** @type {HTMLSpanElement} */ (error).textContent = validate(input.value);
      input.setCustomValidity(/** @type {HTMLSpanElement} */ (error).textContent);
      input.setAttribute("aria-invalid", String(Boolean(/** @type {HTMLSpanElement} */ (error).textContent)));
    };
    check();
    input.addEventListener("input", () => { changed(input.value); check(); update(); });
    return { input, check };
  };
  /**
   * @param {Element} parent
   * @param {string} name
   * @param {string[]} choices
   * @param {string | undefined} value
   * @param {(val: string) => void} changed
   * @returns {HTMLInputElement[]}
   */
  const radios = (parent, name, choices, value, changed) => {
    /** @type {HTMLInputElement[]} */
    const inputs = [];
    for (const choice of choices) {
      const label = node("label", undefined, parent);
      const input = node("input", undefined, label);
      input.type = "radio";
      input.name = name;
      input.value = choice;
      input.checked = value === choice;
      node("span", choice, label);
      input.addEventListener("change", () => { changed(choice); update(); });
      inputs.push(input);
    }
    return inputs;
  };
  /**
   * @param {InboxItem} item
   * @param {number} i
   */
  const show = (item, i) => {
    selectedIndex = i;
    detail.replaceChildren();
    buttons.forEach((button, n) => button.setAttribute("aria-pressed", String(n === i)));
    keyed(node("h2", undefined, detail), item.label, item.feature);
    keyed(node("p", undefined, detail), `${item.feature} · ${item.scenario}`, item.feature);
    for (const why of /** @type {NonNullable<InboxItem["why"]>} */ (item.why)) keyed(node("p", undefined, detail), why.line, item.feature);
    if (item.explanation) keyed(node("p", undefined, detail), item.explanation, item.feature);
    for (const line of item.proposal ?? []) keyed(node("p", undefined, detail), line, item.feature);
    const texts = node("details", undefined, detail);
    node("summary", "Case and covered Rule texts", texts);
    keyed(node("pre", undefined, texts), item.texts?.case ?? "", item.feature);
    for (const rule of item.texts?.rules ?? []) {
      keyed(node("h3", undefined, texts), `${rule.feature} · ${rule.key}`, rule.feature);
      keyed(node("pre", undefined, texts), rule.text, rule.feature);
    }
    const selected = selections[item.key] ??= { findings: Object.create(null) };
    selected.findings ??= Object.create(null);
    /** @type {Array<{ group: HTMLFieldSetElement, extras: HTMLDivElement, fix: HTMLDivElement, fields: Array<{ input: HTMLInputElement | HTMLTextAreaElement, check: () => void }>, target: HTMLSelectElement }>} */
    const findingGroups = [];
    for (const fact of item.facts) {
      const group = node("fieldset", undefined, detail);
      group.disabled = removesCase(selected.review);
      node("legend", `${fact.n}. ${fact.kind}`, group);
      keyed(node("p", undefined, group), fact.line, item.feature);
      const answer = /** @type {Record<string, FindingAnswer>} */ (selected.findings)[fact.id] ??= {};
      const extras = node("div");
      const fix = node("div");
      /** @type {Array<{ input: HTMLInputElement | HTMLTextAreaElement, check: () => void }>} */
      const fields = [];
      const target = node("select");
      findingGroups.push({ group, extras, fix, fields, target });
      radios(group, `finding-${i}-${fact.n}`, /** @type {{ choices: string[] }} */ (/** @type {NonNullable<InboxItem["questions"]>} */ (item.questions).findings).choices, answer.answer, (value) => {
        setFindingAnswer(selected, fact.id, { answer: value });
        extras.hidden = value !== "dismiss";
        fix.hidden = value !== "fix";
        syncReview();
      });
      group.append(extras);
      extras.hidden = answer.answer !== "dismiss";
      for (const [name, title] of [["reason", "Reason (optional, one line)"], ["ticket", "Ticket (optional)"]]) {
        fields.push(field(extras, title, answer[/** @type {"reason" | "ticket"} */ (name)], (value) => { setFindingAnswer(selected, fact.id, { [name]: value }); }, false,
          (value) => dismissalError(model.validation, name, value)));
      }
      group.append(fix);
      fix.hidden = answer.answer !== "fix";
      fields.push(field(fix, "What to change (instruction)", answer.fix, (value) => { setFindingAnswer(selected, fact.id, { fix: value }); syncReview(); }, true));
      const targetLabel = node("label", "Fix target", fix);
      targetLabel.append(target);
      for (const [value, label] of [["case", /** @type {string} */ (item.label)], ...(item.texts?.rules ?? []).map((r) => [r.key, `${r.key}: ${r.text}`])]) {
        const option = node("option", label, target);
        option.value = value;
      }
      target.value = answer.target ?? "case";
      target.addEventListener("change", () => { setFindingAnswer(selected, fact.id, { target: target.value }); });
    }
    const review = node("fieldset", undefined, detail);
    node("legend", `Review · ${/** @type {NonNullable<InboxItem["review_state"]>} */ (item.review_state).status}`, review);
    reviewControls = radios(review, `review-${i}`, /** @type {NonNullable<InboxItem["questions"]>} */ (item.questions).review.choices, selected.review, (value) => {
      setReviewAnswer(item, selected, value);
      for (const { group, extras, fix, fields, target } of findingGroups) {
        group.disabled = removesCase(value);
        if (!removesCase(value)) continue;
        extras.hidden = true;
        fix.hidden = true;
        target.value = "case";
        for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (group.querySelectorAll("input[type=radio]"))) input.checked = false;
        for (const { input, check } of fields) {
          input.value = "";
          check();
        }
      }
      syncReview();
    });
    syncReview();
    field(detail, "Case comment (optional)", selected.comment, (value) => { selected.comment = value; }, true);
    updateNavigation();
  };
  const navigation = node("div", undefined, card);
  navigation.className = "case-navigation";
  const previous = node("button", "Previous", navigation);
  const next = node("button", "Next", navigation);
  previous.type = next.type = "button";
  const position = node("span", "", navigation);
  node("p", "Keys: j / k outside text fields", card).className = "muted";
  const visibleIndexes = () => model.items.map((_, i) => i).filter((i) => !buttons[i].hidden);
  const updateNavigation = () => {
    const visible = visibleIndexes();
    const n = visible.indexOf(selectedIndex);
    previous.disabled = n <= 0;
    next.disabled = n < 0 || n === visible.length - 1;
    position.textContent = n < 0 ? "0 cases" : `${n + 1} of ${visible.length}`;
  };
  const move = (/** @type {number} */ delta, focusList = false) => {
    const visible = visibleIndexes();
    const n = visible.indexOf(selectedIndex);
    const i = visible[Math.max(0, Math.min(visible.length - 1, n + delta))];
    if (i === undefined) return;
    if (i !== selectedIndex) show(model.items[i], i);
    if (focusList) buttons[i].focus();
  };
  previous.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  doc.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(/** @type {HTMLElement} */ (event.target).tagName) || /** @type {HTMLElement} */ (event.target).isContentEditable) return;
    if (event.key !== "j" && event.key !== "k") return;
    event.preventDefault();
    move(event.key === "j" ? 1 : -1, true);
  });
  model.items.forEach((item, i) => {
    const button = node("button", undefined, list);
    button.type = "button";
    const dot = node("span", "", button);
    dot.setAttribute("aria-hidden", "true");
    dots.push(dot);
    keyed(node("span", undefined, button), item.label, item.feature, button);
    statuses.push(node("span", "", button));
    const kinds = node("small", [...new Set(item.facts.map((fact) => fact.kind))].join(", ") || "Review only", button);
    kinds.className = "muted";
    button.addEventListener("click", () => show(item, i));
    buttons.push(button);
  });
  bulk.addEventListener("click", () => {
    for (const [key, value] of Object.entries(leaveUnansweredReviews(model, selections))) {
      Object.assign(selections[key] ??= {}, value);
    }
    syncReview();
    update();
  });
  filter.addEventListener("change", () => {
    const visible = new Set(filterCases(model.items, filter.value));
    buttons.forEach((button, i) => { button.hidden = !visible.has(model.items[i]); });
    if (!visible.has(model.items[selectedIndex])) {
      const i = model.items.findIndex((item) => visible.has(item));
      if (i >= 0) show(model.items[i], i);
      else {
        selectedIndex = -1;
        reviewControls = [];
        detail.replaceChildren();
        node("p", "No cases match this finding kind.", detail);
        buttons.forEach((button) => button.setAttribute("aria-pressed", "false"));
      }
    }
    updateNavigation();
  });
  const reviewAll = node("details", undefined, app);
  node("summary", "Review all", reviewAll);
  const tableWrap = node("div", undefined, reviewAll);
  tableWrap.className = "table-scroll";
  const table = node("table", undefined, tableWrap);
  table.setAttribute("aria-label", "Review all answers");
  node("caption", "Every case in walk order, including unanswered choices.", table);
  const heading = node("tr", undefined, node("thead", undefined, table));
  for (const title of ["Case", "Findings", "Review", "Comment"]) node("th", title, heading).setAttribute("scope", "col");
  const rows = node("tbody", undefined, table);
  const updateReview = () => {
    rows.replaceChildren();
    for (const item of model.items) {
      const selected = selections[item.key] ?? {};
      const row = node("tr", undefined, rows);
      node("td", `${item.label} · ${statusLabels[answerStatus(item, selected)]}`, row);
      const answers = item.facts.map((fact) => {
        const value = /** @type {FindingAnswer} */ (selected.findings?.[fact.id]);
        let answer = value?.answer || "Unanswered";
        if (answer === "fix" && !value.fix?.trim()) answer = "Unanswered (blank fix)";
        const fields = answer === "dismiss" ? ["reason", "ticket"] : answer === "fix" ? ["fix", "target"] : [];
        const extras = fields.filter((field) => value[/** @type {keyof FindingAnswer} */ (field)]).map((field) => `${field}: ${value[/** @type {keyof FindingAnswer} */ (field)]}`);
        return `${fact.n}. ${fact.kind}: ${answer}${extras.length ? `; ${extras.join("; ")}` : ""}`;
      });
      node("td", answers.join("\n") || "No findings", row);
      node("td", selected.review || "Unanswered", row);
      node("td", selected.comment || "—", row);
    }
  };
  update();
  if (model.items.length) show(model.items[0], 0);
  let comment = "";
  field(app, "Page comment (optional)", "", (value) => { comment = value; }, true);
  const meter = node("meter", undefined, app);
  meter.min = 0;
  const limits = model.limits ?? DEFAULT_LIMITS;
  meter.max = limits.max;
  meter.high = limits.warn;
  meter.optimum = 0;
  meter.setAttribute("aria-label", "Reply characters");
  const size = node("p", "", app);
  size.setAttribute("role", "status");
  const copy = node("button", "Copy Reply", app);
  copy.type = "button";
  const message = node("p", "", app);
  message.setAttribute("role", "status");
  const manual = node("textarea", undefined, app);
  manual.setAttribute("aria-label", "Reply to copy");
  manual.readOnly = true;
  manual.hidden = true;
  refreshSize = () => {
    try {
      const result = prepareReply(model, selections, comment);
      meter.value = Math.min(result.length, /** @type {PageLimits} */ (model.limits).max);
      const flags = [
        result.commentTooLarge && "Shorten the page comment: it exceeds the maximum on its own.",
        result.oversized.length && `Shorten these cases: ${result.oversized.join(", ")}. Each exceeds the maximum on its own.`,
        result.overLimit && `Copy includes ${result.taken} whole cases; ${result.left} left.`,
      ].filter(Boolean);
      size.textContent = `${result.length} characters / ${limits.max} maximum (warning at ${limits.warn}). ${result.warning ? "Size warning. " : ""}${flags.join(" ")}`;
      copy.disabled = result.commentTooLarge;
    } catch {
      size.textContent = "";  // an unwritable answer is reported when Copy is pressed
    }
  };
  refreshSize();
  copy.addEventListener("click", async () => {
    /** @type {PreparedReply | undefined} */
    let result;
    try {
      result = prepareReply(model, selections, comment);
    } catch (error) {
      message.textContent = /** @type {Error} */ (error).message;
      return;
    }
    if (!result.block) {
      message.textContent = "Shorten the page comment before copying.";
      return;
    }
    const block = result.block;
    const remainder = result.left ? ` ${result.taken} whole cases included; ${result.left} left.` : "";
    message.textContent = await copyText(doc, block, manual)
      ? `Copied. Paste the Reply into your conversation.${remainder}` : `Press ⌘C to copy the selected Reply.${remainder}`;
  });
}
