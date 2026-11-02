// @ts-check
// Code gen's code-evidence sample: the CLI-built, bounded reading of a project's own test code that
// `/qa-train codegen` learns from once (ADR-0049). It samples test files, resolves their support two
// hops deep through the stack adapter, scrubs secrets, and computes the corpus counts and gate
// labels the engineer settles. It never writes Training and never reads `.env*` or auth state.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { scrubRecordText } from "./credentials.mjs";
import { within } from "./paths.mjs";
import { filesUnder } from "./code-source.mjs";
import { redactSensitiveLiterals } from "./sensitive-literals.mjs";

/**
 * @import { CodegenAdapter, CodegenShape } from "./stack.mjs"
 */

/** @type {number} */
export const SAMPLE_BUDGET = 200 * 1024;
/** @type {number} */
export const PER_FILE_CAP = 20 * 1024;
/** @type {number} */
export const SAMPLE_TESTS = 12;
/** @type {number} */
export const PER_DIRECTORY = 3;
/** @type {number} */
export const TOP_SUPPORT = 5;
/** @type {readonly string[]} */
export const SIGNAL_FACETS = ["placement", "key-carrier", "test-naming"];
/** @type {Record<string, string>} */
const SIGNAL_IDS = { placement: "placement-dir", "key-carrier": "key-carrier", "test-naming": "test-naming" };

/**
 * The little a sampler reads of a parsed declaration.
 * @typedef {{
 *   line: number,
 *   name?: string,
 *   classPath?: string,
 *   carriers: readonly { name: string }[],
 *   [key: string]: unknown,
 * }} CodeNode
 */

/**
 * The adapter members the sampler uses; `StackAdapter` provides them.
 * @typedef {{
 *   extensions: readonly string[],
 *   parse: (text: string, file: string) => { classes: readonly CodeNode[], functions: readonly CodeNode[] },
 *   isTest: (fn: CodeNode) => boolean,
 *   keys: (carriers: readonly { name: string }[], names: readonly string[], pattern: unknown) => { key: string, line: number }[],
 *   codegen: CodegenAdapter,
 * }} SamplerAdapter
 */

/**
 * One test file and the facts the corpus and signals read from it.
 * @typedef {{
 *   path: string,
 *   directory: string,
 *   text: string,
 *   parsed: { classes: readonly CodeNode[], functions: readonly CodeNode[] },
 *   tests: CodeNode[],
 *   metrics: Record<string, string | null>,
 * }} FileFact
 */

/**
 * One file in the sample.
 * @typedef {{
 *   path: string,
 *   phase: string,
 *   bytes: number,
 *   truncated: boolean,
 *   text: string,
 * }} SampleFile
 */

/**
 * One cut: a file past the per-file cap, or one dropped by the budget.
 * @typedef {{ path: string, phase: string, reason: "per-file-cap" | "budget" }} Cut
 */

/**
 * A gate signal: one deterministic value with its corpus and sampled labels, or the reason it is an
 * engineer choice.
 * @typedef {{
 *   id: string,
 *   value: string | null,
 *   corpus: string,
 *   sampled: string,
 *   share: number,
 *   counter_examples: string[],
 *   sampled_counter_examples: string[],
 *   choice: boolean,
 *   reason?: string,
 *   recommended?: string,
 *   exemplar?: string,
 *   signal?: { id: string, value: string, corpus: string },
 * }} GateSignal
 */

/**
 * What `/qa-train codegen --from-code` reads.
 * @typedef {{
 *   sample: Record<string, unknown>,
 *   corpus: Record<string, unknown>,
 *   gate: Record<string, unknown>,
 * }} CodegenEvidence
 */

/**
 * @param {{
 *   repo: string,
 *   modulePaths: readonly string[],
 *   annotationMap: Record<string, readonly string[]>,
 *   autPattern: unknown,
 *   adapter: unknown,
 *   exemplars?: readonly string[],
 *   facets?: readonly string[],
 * }} options
 * @returns {CodegenEvidence | { error: string, message: string }}
 */
export function codegenSample({ repo, modulePaths, annotationMap, autPattern, adapter: rawAdapter, exemplars = [], facets = SIGNAL_FACETS }) {
  const adapter = /** @type {SamplerAdapter} */ (rawAdapter);
  const prepared = adapter.codegen.prepare(repo, modulePaths);
  const files = discover(repo, modulePaths, adapter, annotationMap, autPattern);
  if (files.length === 0) return { error: "no_tests", message: "no test code under `module_paths`: teach this stack from the conversation" };
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const exemplar of exemplars) {
    if (!byPath.has(exemplar)) return { error: "unknown_exemplar", message: `\`${exemplar}\` is not a test file under \`module_paths\`` };
  }
  const graph = supportGraph(repo, modulePaths, adapter, prepared, files);
  const supportPool = [...graph.inDegree.entries()].map(([path, inDegree]) => ({ path, in_degree: inDegree })).sort((a, b) => b.in_degree - a.in_degree || a.path.localeCompare(b.path));
  const selection = selectTests(files, exemplars);
  const selectedPaths = selection.map((f) => f.path);
  const signals = Object.fromEntries(SIGNAL_FACETS.map((facet) => [SIGNAL_IDS[facet], signal(facet, files, selectedPaths, exemplars)]));
  const gateSignals = Object.fromEntries(SIGNAL_FACETS.filter((facet) => facets.includes(facet)).map((facet) => [SIGNAL_IDS[facet], signals[SIGNAL_IDS[facet]]]));
  const sample = buildSample({ repo, adapter, prepared, exemplars, selection, supportPool, edges: graph.edges, files });
  return {
    sample,
    corpus: {
      test_files: files.length,
      directories: grouped(files.map((f) => ({ value: f.directory, path: f.path }))),
      key_carriers: grouped(files.filter((f) => f.metrics["key-carrier"] !== null).map((f) => ({ value: f.metrics["key-carrier"], path: f.path }))),
      test_names: grouped(files.filter((f) => f.metrics["test-naming"] !== null).map((f) => ({ value: f.metrics["test-naming"], path: f.path }))),
      support: supportPool,
    },
    gate: {
      facets: [...facets],
      signals: gateSignals,
      exemplars: exemplars.map((path) => ({ path, signals: Object.fromEntries(SIGNAL_FACETS.map((facet) => [SIGNAL_IDS[facet], byPath.get(path)?.metrics[SIGNAL_IDS[facet]] ?? null])) })),
      choices: Object.values(gateSignals).filter((s) => s.choice).map(({ id, reason, value, recommended, exemplar, corpus, sampled, counter_examples }) => ({ id, reason, value, ...(recommended !== undefined && { recommended }), ...(exemplar !== undefined && { exemplar }), corpus, sampled, counter_examples })),
    },
  };
}

// Every test file under the module paths, with the facts the corpus and the gate read.
/**
 * @param {string} repo
 * @param {readonly string[]} modulePaths
 * @param {SamplerAdapter} adapter
 * @param {Record<string, readonly string[]>} annotationMap
 * @param {unknown} autPattern
 * @returns {FileFact[]}
 */
function discover(repo, modulePaths, adapter, annotationMap, autPattern) {
  const names = annotationMap.automation_key ?? [];
  /** @type {FileFact[]} */
  const out = [];
  const candidates = filesUnder(repo, modulePaths, (name) => adapter.extensions.some((extension) => name.endsWith(extension)));
  for (const path of candidates) {
    let text;
    try {
      text = readFileSync(join(repo, path), "utf8");
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = adapter.parse(text, path);
    } catch {
      continue;
    }
    const tests = parsed.functions.filter((fn) => adapter.isTest(fn));
    if (!tests.length) continue;
    /** @type {Record<string, string | null>} */
    const metrics = {
      "placement-dir": dirname(path) === "." ? "." : dirname(path),
      "key-carrier": leading(carrierValues(parsed, adapter, names, autPattern)),
      "test-naming": leading(tests.map((fn) => nameShape(fn.name ?? ""))),
    };
    out.push({ path, directory: dirname(path) === "." ? "." : dirname(path), text, parsed, tests, metrics });
  }
  return out;
}

/**
 * @param {{ classes: readonly CodeNode[], functions: readonly CodeNode[] }} parsed
 * @param {SamplerAdapter} adapter
 * @param {readonly string[]} names
 * @param {unknown} pattern
 * @returns {string[]}
 */
function carrierValues(parsed, adapter, names, pattern) {
  const values = [];
  for (const fn of parsed.functions) {
    if (!adapter.isTest(fn)) continue;
    for (const carrier of fn.carriers) if (adapter.keys([carrier], names, pattern).length) values.push(`${carrier.name} on test`);
  }
  for (const cls of parsed.classes) {
    for (const carrier of cls.carriers) if (adapter.keys([carrier], names, pattern).length) values.push(`${carrier.name} on class`);
  }
  return values;
}

// The support graph two hops from the test files: each source's resolved support, and the in-degree
// of every support file over the corpus.
/**
 * @param {string} repo
 * @param {readonly string[]} modulePaths
 * @param {SamplerAdapter} adapter
 * @param {unknown} prepared
 * @param {FileFact[]} files
 * @returns {{ edges: Map<string, string[]>, inDegree: Map<string, number> }}
 */
function supportGraph(repo, modulePaths, adapter, prepared, files) {
  const tests = new Set(files.map((f) => f.path));
  /** @type {Map<string, string[]>} */
  const edges = new Map();
  /** @type {Map<string, Set<string>>} */
  const incoming = new Map();
  /**
   * @param {string} path
   * @param {string} text
   * @returns {string[]}
   */
  const supportOf = (path, text) => adapter.codegen.support(prepared, path, text)
    .filter((candidate) => !tests.has(candidate) && modulePaths.some((root) => within(candidate, root)) && existsSync(join(repo, candidate)));
  /** @param {string} from @param {string[]} to */
  const note = (from, to) => {
    edges.set(from, to);
    for (const path of to) {
      if (!incoming.has(path)) incoming.set(path, new Set());
      /** @type {Set<string>} */ (incoming.get(path)).add(from);
    }
  };
  for (const fact of files) {
    const first = supportOf(fact.path, fact.text);
    note(fact.path, first);
    for (const path of first) {
      let text;
      try {
        text = readFileSync(join(repo, path), "utf8");
      } catch {
        continue;
      }
      note(path, supportOf(path, text));
    }
  }
  return { edges, inDegree: new Map([...incoming].map(([path, from]) => [path, from.size])) };
}

// The test files a sample learns from: named exemplars first, then keyed files, at most 12 and at
// most 3 per directory.
/**
 * @param {FileFact[]} files
 * @param {readonly string[]} exemplars
 * @returns {FileFact[]}
 */
function selectTests(files, exemplars) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  /** @type {FileFact[]} */
  const selected = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Map<string, number>} */
  const dirCount = new Map();
  /** @param {FileFact} fact @returns {boolean} */
  const add = (fact) => {
    if (seen.has(fact.path) || selected.length >= SAMPLE_TESTS) return false;
    seen.add(fact.path);
    selected.push(fact);
    dirCount.set(fact.directory, (dirCount.get(fact.directory) ?? 0) + 1);
    return true;
  };
  for (const path of exemplars) {
    const fact = byPath.get(path);
    if (fact) add(fact);
  }
  const rest = files.filter((f) => !seen.has(f.path)).sort((a, b) => Number(b.metrics["key-carrier"] !== null) - Number(a.metrics["key-carrier"] !== null) || a.path.localeCompare(b.path));
  for (const fact of rest) {
    if ((dirCount.get(fact.directory) ?? 0) >= PER_DIRECTORY) continue;
    add(fact);
  }
  return selected;
}

// The sample itself: the fixed phase order, each file scrubbed and cut to its per-file cap, then
// dropped when it no longer fits the budget. Every cut is reported.
/**
 * @param {{
 *   repo: string,
 *   adapter: SamplerAdapter,
 *   prepared: unknown,
 *   exemplars: readonly string[],
 *   selection: FileFact[],
 *   supportPool: { path: string, in_degree: number }[],
 *   edges: Map<string, string[]>,
 *   files: FileFact[],
 * }} options
 * @returns {Record<string, unknown>}
 */
function buildSample({ repo, adapter, prepared, exemplars, selection, supportPool, edges }) {
  const byPath = new Map(selection.map((f) => [f.path, f]));
  const runner = adapter.codegen.runnerConfigs(prepared);
  const exemplarSupport = unique(exemplars.flatMap((path) => {
    const first = edges.get(path) ?? (byPath.get(path) ? adapter.codegen.support(prepared, path, /** @type {FileFact} */ (byPath.get(path)).text) : []);
    return [...first, ...first.flatMap((file) => edges.get(file) ?? [])];
  }));
  const top = supportPool.slice(0, TOP_SUPPORT).map((s) => s.path);
  const remaining = supportPool.map((s) => s.path).filter((path) => !top.includes(path) && !exemplarSupport.includes(path));
  /** @type {{ path: string, phase: string }[]} */
  const candidates = [
    ...runner.map((path) => ({ path, phase: "runner" })),
    ...exemplars.map((path) => ({ path, phase: "exemplar" })),
    ...exemplarSupport.map((path) => ({ path, phase: "exemplar-support" })),
    ...top.map((path) => ({ path, phase: "support" })),
    ...selection.filter((f) => !exemplars.includes(f.path)).map((f) => ({ path: f.path, phase: "test" })),
    ...remaining.map((path) => ({ path, phase: "remaining-support" })),
  ];
  const seen = new Set();
  /** @type {SampleFile[]} */
  const files = [];
  /** @type {Cut[]} */
  const truncated = [];
  let bytes = 0;
  for (const candidate of candidates) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    let text;
    try {
      text = readFileSync(join(repo, candidate.path), "utf8");
    } catch {
      continue;
    }
    const scrubbed = scrub(text);
    const wasTruncated = Buffer.byteLength(scrubbed, "utf8") > PER_FILE_CAP;
    const marker = "\n// [truncated]\n";
    const kept = wasTruncated ? truncate(shape(scrubbed, adapter.codegen.shape(scrubbed, candidate.path)), PER_FILE_CAP - Buffer.byteLength(marker, "utf8")) : scrubbed;
    const content = wasTruncated ? `${kept}${marker}` : kept;
    const size = Buffer.byteLength(content, "utf8");
    if (bytes + size > SAMPLE_BUDGET) {
      truncated.push({ path: candidate.path, phase: candidate.phase, reason: "budget" });
      continue;
    }
    bytes += size;
    if (wasTruncated) truncated.push({ path: candidate.path, phase: candidate.phase, reason: "per-file-cap" });
    files.push({ path: candidate.path, phase: candidate.phase, bytes: size, truncated: wasTruncated, text: content });
  }
  return {
    budget: SAMPLE_BUDGET,
    per_file_cap: PER_FILE_CAP,
    bytes,
    files,
    truncated,
    order: [...new Set(files.map((f) => f.phase))],
    counts: {
      test_files: files.filter((f) => ["test", "exemplar"].includes(f.phase)).length,
      support_files: files.filter((f) => ["support", "exemplar-support", "remaining-support"].includes(f.phase)).length,
      truncated: truncated.length,
    },
  };
}

// The ranges a stack's shape names, assembled in reading order: imports/header, hooks, first three
// tests. A source with no shape keeps its first `PER_FILE_CAP` bytes.
/**
 * @param {string} text
 * @param {CodegenShape} shape
 * @returns {string}
 */
function shape(text, shape) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const parts = [];
  /** @param {[number, number] | null} range */
  const push = (range) => {
    if (range && range[0] <= range[1]) parts.push(lines.slice(range[0] - 1, range[1]).join("\n"));
  };
  if (shape.header) push(shape.header);
  else push(shape.imports);
  for (const range of shape.hooks) parts.push(lines.slice(range.line - 1, range.end).join("\n"));
  for (const test of shape.tests.slice(0, 3)) parts.push(lines.slice(test.line - 1, test.end).join("\n"));
  return parts.length ? parts.join("\n") : text;
}

/**
 * `text` cut to at most `cap` UTF-8 bytes, without splitting a character.
 * @param {string} text
 * @param {number} cap
 * @returns {string}
 */
function truncate(text, cap) {
  if (Buffer.byteLength(text, "utf8") <= cap) return text;
  let out = "";
  for (const char of text) {
    if (Buffer.byteLength(out + char, "utf8") > cap) break;
    out += char;
  }
  return out;
}

/**
 * A sample text with known credentials and credential-named string literals redacted, in that order.
 * @param {string} text
 * @returns {string}
 */
function scrub(text) {
  return redactSensitiveLiterals(scrubRecordText(text));
}

// The gate's signal for one facet: the leading per-file value over the corpus, its `X/N` label, the
// same over the sampled files, the counter-example paths, and whether the engineer must choose.
/**
 * @param {string} facet
 * @param {FileFact[]} files
 * @param {readonly string[]} sampled
 * @param {readonly string[]} exemplars
 * @returns {GateSignal}
 */
function signal(facet, files, sampled, exemplars) {
  const id = SIGNAL_IDS[facet];
  const observed = files.filter((f) => f.metrics[id] !== null).map((f) => ({ path: f.path, value: /** @type {string} */ (f.metrics[id]) }));
  const value = leading(observed.map((o) => o.value));
  const matching = observed.filter((o) => o.value === value);
  const counter = observed.filter((o) => o.value !== value).map((o) => o.path);
  const N = observed.length;
  const share = N === 0 ? 0 : matching.length / N;
  const sampledObserved = observed.filter((o) => sampled.includes(o.path));
  const sampledMatching = sampledObserved.filter((o) => o.value === value);
  const exemplar = exemplars.map((path) => files.find((f) => f.path === path)).find((f) => f && f.metrics[id] !== null && f.metrics[id] !== value);
  const reason = exemplar ? "exemplar-disagrees" : N > 0 && share < 0.8 ? "below-80" : undefined;
  const choice = reason !== undefined;
  return {
    id,
    value,
    corpus: `${matching.length}/${N}`,
    sampled: `${sampledMatching.length}/${sampledObserved.length}`,
    share,
    counter_examples: counter,
    sampled_counter_examples: sampledObserved.filter((o) => o.value !== value).map((o) => o.path),
    choice,
    ...(exemplar && { recommended: /** @type {string} */ (exemplar.metrics[id]), exemplar: exemplar.path }),
    ...(reason && { reason }),
    ...(!choice && value !== null && N > 0 ? { signal: { id, value, corpus: `${matching.length}/${N}` } } : {}),
  };
}

// The most common value, the first one seen when several tie, or null for none.
/**
 * @param {string[]} values
 * @returns {string | null}
 */
function leading(values) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

// A test name's word shape: `#` for a token with a digit, `A` for an all-caps word, `W` for a
// capitalised word, `w` for a lower-case one. `TC: LOAN_001 creates a loan @aut_ab12cd` is
// `A # w w w w`, so the corpus can count a naming convention without reading its wording.
/**
 * @param {string} name
 * @returns {string}
 */
function nameShape(name) {
  return name
    .split(/\s+/)
    .map((word) => word.replace(/^[^\w]+|[^\w]+$/g, ""))
    .filter(Boolean)
    .map((word) => (/[0-9]/.test(word) ? "#" : /^[A-Z][A-Z0-9_]*$/.test(word) ? "A" : /^[A-Z]/.test(word) ? "W" : "w"))
    .join(" ");
}

/**
 * @param {{ value: string | null, path: string }[]} entries
 * @returns {{ value: string, files: number }[]}
 */
function grouped(entries) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const { value } of entries) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, files]) => ({ value, files })).sort((a, b) => b.files - a.files || a.value.localeCompare(b.value));
}

/**
 * @template T
 * @param {T[]} list
 * @returns {T[]}
 */
function unique(list) {
  return [...new Set(list)];
}
