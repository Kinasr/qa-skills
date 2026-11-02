// @ts-check
// Per-action element evidence for an Execution's guard log (ADR-0035): the ref's ARIA path in
// the snapshot the Tester was shown, the locator playwright-cli emitted, and a DOM excerpt the
// wrapper probed before the action. The Tester never sees any of it.
//
// The snapshot cache is `.element-snapshot.json` in the Execution's directory: per session, the page
// URL and the last snapshot the wrapper returned, reduced to depth, role, accessible name and ref
// (never a control's value or any other page text). It is dropped when a command navigates or
// changes tab without returning a new snapshot.
/**
 * @import { ExecutionEvidence, ExecutionExcerpt, ExecutionExcerptNode } from "./execution-guard.mjs"
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { credentialNamed, redactPageText, redactQueryParams, scrubPageText } from "./credentials.mjs";
import { maskTyped, sectionsOf } from "./execution-guard.mjs";

/** @type {".element-snapshot.json"} */
export const SNAPSHOT_CACHE_FILE = ".element-snapshot.json";

const MAX_ANCESTORS = 8;
const MAX_ATTRIBUTES = 20;
const MAX_CLASSES = 10;
const MAX_ATTRIBUTE_CHARS = 120;
const MAX_EXCERPT_BYTES = 2048;
const MAX_ARIA_NODES = 8;
const MAX_ARIA_CHARS = 400;
const MAX_LOCATOR_CHARS = 500;

/**
 * One node of a cached snapshot: its indent, role, accessible name and, when it has one, its ref.
 * @typedef {{
 *   depth: number,
 *   role: string,
 *   name: string,
 *   ref?: string,
 * }} SnapshotNode
 */

/**
 * The per-session snapshot cache written beside the guard: the page URL and current tab the
 * snapshot described, reduced to a hierarchy of roles, names and refs.
 * @typedef {{
 *   version: 1,
 *   sessions: Record<string, { url: string, tab?: number, nodes: SnapshotNode[] }>,
 * }} SnapshotCache
 */

/**
 * A surface cut by a limit, and whether the cut came from the 2 KB byte cap.
 * @typedef {{
 *   ancestors?: true,
 *   attributes?: true,
 *   classes?: true,
 *   values?: true,
 *   bytes?: true,
 * }} ExcerptFlags
 */

/** @typedef {"ancestors" | "attributes" | "classes" | "values" | "bytes"} ExcerptFlagKey */

/**
 * @typedef {{
 *   text: string,
 *   truncated: boolean,
 * }} BoundedText
 */

const NAVIGATING = new Set(["goto", "go-back", "reload", "tab-select"]);
const LOCATOR_METHODS = new Set([
  "getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByTestId", "getByAltText",
  "getByTitle", "locator", "frameLocator", "filter", "nth", "first", "last", "and", "or",
]);
const ACTION_METHODS = new Set([
  "click", "dblclick", "fill", "selectOption", "check", "uncheck", "hover", "press", "type",
  "clear", "focus", "blur", "tap", "dragTo", "setInputFiles", "evaluate",
]);
const EXCERPT_ATTRIBUTES = new Set(["id", "name", "type", "role", "placeholder", "for", "href", "class"]);

// Page text and committed Evidence are scrubbed through different helpers today: page text loses
// credential-named pairs and URL queries, Evidence loses every URL's query and fragment and then
// redacts a line that still carries a credential shape. Evidence gets both.
/**
 * @param {string} text
 * @returns {string}
 */
export function scrubEvidence(text) {
  return scrubPageText(text);
}

/**
 * The `### Snapshot` section's YAML: inline after `snapshot`, or the file a page command links. A
 * link outside the Execution's directory is not read.
 * @param {string} text
 * @param {string} execDir
 * @returns {string | null}
 */
export function snapshotFromOutput(text, execDir) {
  const section = sectionsOf(text).find((part) => part.name === "Snapshot");
  if (!section || !section.body) return null;
  const fenced = /```ya?ml\r?\n([\s\S]*?)\r?\n```/.exec(section.body);
  if (fenced) return fenced[1];
  const link = /\[Snapshot\]\(([^)\s]+)\)/.exec(section.body);
  if (!link) return null;
  const relative = link[1];
  if (relative.startsWith("/") || relative.includes("\0")) return null;
  const root = resolve(execDir);
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(`${root}${sep}`)) return null;
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * A snapshot's lines as nodes: the role, the quoted accessible name and the ref, at the depth its
 * indentation gives. Values and every other attribute are left out.
 * @param {string} text
 * @returns {SnapshotNode[]}
 */
export function parseSnapshot(text) {
  /** @type {SnapshotNode[]} */
  const nodes = [];
  for (const line of text.split(/\r?\n/)) {
    const item = /^([ \t]*)- (.*)$/.exec(line);
    if (!item) continue;
    const roleMatch = /^([A-Za-z][A-Za-z0-9_-]*)/.exec(item[2]);
    if (!roleMatch) continue;
    const role = roleMatch[1].toLowerCase();
    const rest = item[2].slice(roleMatch[0].length);
    const nameMatch = /^\s+"((?:[^"\\]|\\.)*)"/.exec(rest);
    let name = "";
    if (nameMatch) {
      try {
        name = /** @type {string} */ (JSON.parse(`"${nameMatch[1]}"`));
      } catch {
        name = nameMatch[1];
      }
      name = redactPageText(name);
    }
    const ref = /\[ref=([^\]\s]+)\]/.exec(item[2])?.[1];
    nodes.push({ depth: item[1].replaceAll("\t", "  ").length, role, name, ...(ref ? { ref } : {}) });
  }
  return nodes;
}

/**
 * The ref's node and the ancestors the snapshot's indentation gives it, outermost last, or null
 * when the ref is not in this snapshot.
 * @param {readonly SnapshotNode[]} nodes
 * @param {string} ref
 * @returns {SnapshotNode[] | null}
 */
export function ariaPathOf(nodes, ref) {
  const at = nodes.findIndex((node) => node.ref === ref);
  if (at === -1) return null;
  const path = [nodes[at]];
  let depth = nodes[at].depth;
  for (let i = at - 1; i >= 0; i--) {
    if (nodes[i].depth < depth) {
      path.unshift(nodes[i]);
      depth = nodes[i].depth;
      if (depth === 0) break;
    }
  }
  return path;
}

/**
 * The nodes whose snapshots the wrapper has, for `session`, or null when it has none or an older
 * one was dropped.
 * @param {string} execDir
 * @param {string} session
 * @returns {SnapshotNode[] | null}
 */
export function snapshotNodes(execDir, session) {
  const cached = readCache(execDir).sessions[session];
  return cached && Array.isArray(cached.nodes) ? cached.nodes : null;
}

/**
 * Keeps the snapshot this command returned for its session, or drops the session's cache when a
 * navigation or tab change came back without one. An older snapshot never supplies a ref.
 * @param {{
 *   execDir: string,
 *   session: string,
 *   command: string,
 *   text: string,
 *   url?: string,
 *   tab?: number,
 * }} input
 * @returns {void}
 */
export function cacheAfterCommand({ execDir, session, command, text, url, tab }) {
  const snapshot = snapshotFromOutput(text, execDir);
  const cache = readCache(execDir);
  const previous = cache.sessions[session];
  const safeUrl = url === undefined ? undefined : redactQueryParams(url);
  if (snapshot !== null) {
    const nodes = parseSnapshot(snapshot);
    if (nodes.length) {
      cache.sessions[session] = { url: safeUrl ?? previous?.url ?? "", ...(tab !== undefined && { tab }), nodes };
    } else {
      // A snapshot that names no node leaves nothing a ref could resolve against.
      delete cache.sessions[session];
    }
    writeCache(execDir, cache);
    return;
  }
  const navigated = safeUrl !== undefined && previous !== undefined && safeUrl !== previous.url;
  const tabChanged = tab !== undefined && previous?.tab !== undefined && tab !== previous.tab;
  if (previous && (NAVIGATING.has(command) || navigated || tabChanged)) {
    delete cache.sessions[session];
    writeCache(execDir, cache);
  }
}

/**
 * One admitted element action's evidence. Each surface is scrubbed before it is bounded, and any
 * cut carries a marker.
 * @param {{
 *   nodes: readonly SnapshotNode[] | null,
 *   ref: string,
 *   text: string,
 *   typed: string | undefined,
 *   probe: { ok: true, value: unknown } | { ok: false },
 * }} input
 * @returns {ExecutionEvidence}
 */
export function elementEvidence({ nodes, ref, text, typed, probe }) {
  const aria = ariaText(nodes ? ariaPathOf(nodes, ref) : null, typed);
  const locator = locatorExpression(text, typed) ?? { text: "unavailable", truncated: false };
  const excerpt = probe.ok ? excerptOf(probe.value, typed) : { value: /** @type {const} */ ("unavailable"), truncated: false };
  /** @type {ExecutionEvidence} */
  const evidence = { aria: aria.text, locator: locator.text, excerpt: excerpt.value };
  /** @type {NonNullable<ExecutionEvidence["truncated"]>} */
  const truncated = {};
  if (aria.truncated) truncated.aria = true;
  if (locator.truncated) truncated.locator = true;
  if (excerpt.truncated) truncated.excerpt = true;
  if (Object.keys(truncated).length) evidence.truncated = truncated;
  return evidence;
}

/**
 * Only the locator expression of the emitted action statement, never the action or its arguments.
 * An unknown or unbalanced form is unavailable, never guessed by splitting strings.
 * @param {string} text
 * @param {string | undefined} typed
 * @returns {BoundedText | null}
 */
export function locatorExpression(text, typed) {
  const section = sectionsOf(text).find((part) => part.name === "Ran Playwright code");
  if (!section) return null;
  const statement = statementOf(section.body);
  if (!statement) return null;
  const chain = chainOf(statement.replace(/^await\s+page\./, ""));
  if (!chain) return null;
  const locator = scrubEvidence(maskTyped(chain, typed));
  if (locator.length > MAX_LOCATOR_CHARS) return { text: `${locator.slice(0, MAX_LOCATOR_CHARS - 1)}…`, truncated: true };
  return { text: locator, truncated: false };
}

/**
 * The action statement of a code block, across wrapped lines, or null.
 * @param {string} body
 * @returns {string | null}
 */
function statementOf(body) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*await\s+page\./.test(line));
  if (start === -1) return null;
  let text = lines[start].trim();
  for (let at = start + 1; !balanced(text) && at < lines.length; at++) text += ` ${lines[at].trim()}`;
  if (!balanced(text)) return null;
  return text.replace(/;\s*$/, "").trim();
}

/**
 * Whether every bracket and quote in `text` is closed.
 * @param {string} text
 * @returns {boolean}
 */
function balanced(text) {
  let depth = 0;
  /** @type {string | null} */
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && quote === null;
}

/**
 * The locator part of a `page.` call chain, when every segment is a known locator method and the
 * last is a known action. Otherwise null.
 * @param {string} rest
 * @returns {string | null}
 */
function chainOf(rest) {
  /** @type {string[]} */
  const segments = [];
  let at = 0;
  for (;;) {
    const name = /^[A-Za-z_$][\w$]*/.exec(rest.slice(at))?.[0];
    if (!name) return null;
    at += name.length;
    if (rest[at] !== "(") return null;
    const end = callEnd(rest, at);
    if (end === -1) return null;
    segments.push(rest.slice(at - name.length, end));
    at = end;
    if (at === rest.length) break;
    if (rest[at] !== ".") return null;
    at += 1;
  }
  if (segments.length < 2) return null;
  const nameOf = (/** @type {string} */ segment) => /^[A-Za-z_$][\w$]*/.exec(segment)?.[0] ?? "";
  if (!ACTION_METHODS.has(nameOf(segments[segments.length - 1]))) return null;
  const locators = segments.slice(0, -1);
  if (!locators.every((segment) => LOCATOR_METHODS.has(nameOf(segment)))) return null;
  return locators.join(".");
}

/**
 * The index just past the call that starts at `at` (a `(`), or -1 when it never closes.
 * @param {string} text
 * @param {number} at
 * @returns {number}
 */
function callEnd(text, at) {
  let depth = 0;
  /** @type {string | null} */
  let quote = null;
  for (let i = at; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The ARIA path as `role "name" > …`, the target last. Unnamed structural nodes are left out; the
 * path is bounded by nodes and characters, and keeps the end nearest the target.
 * @param {readonly SnapshotNode[] | null} path
 * @param {string | undefined} typed
 * @returns {BoundedText}
 */
function ariaText(path, typed) {
  if (!path) return { text: "unavailable", truncated: false };
  const kept = path.filter((node, at) => at === path.length - 1 || node.name !== "" || !["generic", "none"].includes(node.role));
  const shown = kept.length > MAX_ARIA_NODES ? kept.slice(-MAX_ARIA_NODES) : kept;
  let truncated = shown.length < kept.length;
  const parts = shown.map((node) => (node.name ? `${node.role} ${JSON.stringify(scrubEvidence(maskTyped(node.name, typed)))}` : node.role));
  let text = parts.join(" > ");
  if (truncated) text = `… > ${text}`;
  if (text.length > MAX_ARIA_CHARS) {
    text = `…${text.slice(-(MAX_ARIA_CHARS - 1))}`;
    truncated = true;
  }
  return { text, truncated };
}

/**
 * The bounded, scrubbed excerpt, or unavailable when the probe's value is not an element.
 * @param {unknown} value
 * @param {string | undefined} typed
 * @returns {{ value: ExecutionExcerpt | "unavailable", truncated: boolean }}
 */
function excerptOf(value, typed) {
  if (!value || typeof value !== "object") return { value: "unavailable", truncated: false };
  const raw = /** @type {Record<string, unknown>} */ (value);
  const element = excerptNode(raw.element, typed);
  if (!element) return { value: "unavailable", truncated: false };
  const rawAncestors = Array.isArray(raw.ancestors) ? raw.ancestors : [];
  const ancestors = rawAncestors.slice(0, MAX_ANCESTORS).map((ancestor) => excerptNode(ancestor, typed)).filter((node) => node !== null);
  /** @type {ExcerptFlags} */
  const flags = { ...element.flags };
  if (rawAncestors.length > MAX_ANCESTORS) flags.ancestors = true;
  for (const ancestor of ancestors) Object.assign(flags, ancestor.flags);
  /** @type {ExecutionExcerpt} */
  const excerpt = { element: element.node, ancestors: ancestors.map((ancestor) => ancestor.node) };
  if (raw.boundary === "iframe" || raw.boundary === "shadow" || raw.boundary === "unknown") excerpt.boundary = raw.boundary;
  return fitExcerpt(excerpt, flags);
}

/**
 * One element of a probe result with the allow-listed attributes, scrubbed and bounded: 20 sorted
 * by name, 10 classes, 120 characters each. A credential-named attribute, a value, a handler or a
 * hidden input is never kept.
 * @param {unknown} value
 * @param {string | undefined} typed
 * @returns {{ node: ExecutionExcerptNode, flags: ExcerptFlags } | null}
 */
function excerptNode(value, typed) {
  if (!value || typeof value !== "object") return null;
  const raw = /** @type {Record<string, unknown>} */ (value);
  const tag = typeof raw.tag === "string" ? raw.tag.toLowerCase() : "";
  if (!tag) return null;
  const attributes = raw.attributes && typeof raw.attributes === "object" ? /** @type {Record<string, unknown>} */ (raw.attributes) : {};
  if (typeof attributes.type === "string" && attributes.type.toLowerCase() === "hidden") return null;
  /** @type {Array<[string, string]>} */
  const entries = [];
  for (const [rawName, rawValue] of Object.entries(attributes)) {
    const name = rawName.toLowerCase();
    if (typeof rawValue !== "string") continue;
    if (name === "value" || name === "style" || name === "hidden" || name.startsWith("on")) continue;
    const allowed = EXCERPT_ATTRIBUTES.has(name) || name.startsWith("aria-") || name.startsWith("data-");
    if (!allowed || credentialNamed(name)) continue;
    entries.push([name, rawValue]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  /** @type {ExcerptFlags} */
  const flags = {};
  const kept = entries.length > MAX_ATTRIBUTES ? entries.slice(0, MAX_ATTRIBUTES) : entries;
  if (kept.length < entries.length) flags.attributes = true;
  /** @type {Record<string, string>} */
  const result = {};
  for (const [name, rawValue] of kept) {
    let text = scrubEvidence(maskTyped(name === "href" ? hrefPath(rawValue) : rawValue, typed));
    if (name === "class") {
      const classes = text.split(/\s+/).filter(Boolean);
      if (classes.length > MAX_CLASSES) {
        text = classes.slice(0, MAX_CLASSES).join(" ");
        flags.classes = true;
      } else text = classes.join(" ");
    }
    if (text.length > MAX_ATTRIBUTE_CHARS) {
      text = `${text.slice(0, MAX_ATTRIBUTE_CHARS - 1)}…`;
      flags.values = true;
    }
    if (text !== "") result[name] = text;
  }
  return { node: { tag, attributes: result }, flags };
}

/**
 * A href without its query or fragment, and without its origin: the path alone.
 * @param {string} value
 * @returns {string}
 */
function hrefPath(value) {
  const stripped = value.replace(/[?#].*$/, "");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(stripped) && !stripped.startsWith("//")) return stripped;
  try {
    return new URL(value, "http://evidence.invalid/").pathname;
  } catch {
    return stripped;
  }
}

/**
 * The excerpt inside its 2 KB UTF-8 serialized bound. Outermost ancestors go first, then the
 * element's last attributes, every cut marked.
 * @param {ExecutionExcerpt} excerpt
 * @param {ExcerptFlags} flags
 * @returns {{ value: ExecutionExcerpt, truncated: boolean }}
 */
function fitExcerpt(excerpt, flags) {
  /** @param {ExcerptFlagKey} key */
  const mark = (key) => {
    if (!excerpt.truncated) excerpt.truncated = {};
    excerpt.truncated[key] = true;
  };
  if (Object.keys(flags).length) excerpt.truncated = { ...flags };
  while (bytesOf(excerpt) > MAX_EXCERPT_BYTES) {
    if (excerpt.ancestors.length) {
      excerpt.ancestors.pop();
      mark("ancestors");
      mark("bytes");
      continue;
    }
    const names = Object.keys(excerpt.element.attributes);
    if (!names.length) break;
    delete excerpt.element.attributes[names[names.length - 1]];
    mark("attributes");
    mark("bytes");
  }
  if (bytesOf(excerpt) > MAX_EXCERPT_BYTES) {
    excerpt.element.attributes = {};
    mark("attributes");
    mark("bytes");
  }
  return { value: excerpt, truncated: Boolean(excerpt.truncated) };
}

/**
 * @param {ExecutionExcerpt} excerpt
 * @returns {number}
 */
const bytesOf = (excerpt) => Buffer.byteLength(JSON.stringify(excerpt), "utf8");

/**
 * @param {string} execDir
 * @returns {string}
 */
const cacheFile = (execDir) => join(execDir, SNAPSHOT_CACHE_FILE);

/**
 * @param {string} execDir
 * @returns {SnapshotCache}
 */
function readCache(execDir) {
  try {
    const parsed = /** @type {Partial<SnapshotCache> | null} */ (JSON.parse(readFileSync(cacheFile(execDir), "utf8")));
    if (parsed && parsed.version === 1 && parsed.sessions && typeof parsed.sessions === "object") return /** @type {SnapshotCache} */ (parsed);
  } catch {
    // A missing or damaged cache is an empty one.
  }
  return { version: 1, sessions: {} };
}

/**
 * @param {string} execDir
 * @param {SnapshotCache} cache
 * @returns {void}
 */
function writeCache(execDir, cache) {
  const file = cacheFile(execDir);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(cache)}\n`);
  renameSync(`${file}.tmp`, file);
}
