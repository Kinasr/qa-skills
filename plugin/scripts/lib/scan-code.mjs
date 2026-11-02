// @ts-check
// The code side of `scan` (ADR-0005): the code index over `module_paths`, the code-side
// invariants, the code Divergences, and the binding proposals of
// `/qa-sync` that it applies. Nothing here writes: a dead `automates` entry, a copied key or a
// wrong tracker key is reported and proposed, never corrected.
import { buildCodeIndex, keyPatterns } from "./code-index.mjs";
import { blameLine } from "./git.mjs";
import { PATTERN, prefixFits, prefixRule, suggestPrefix } from "./keys.mjs";

/**
 * @import { CodeIndex, CodeKey, IndexedClass, IndexedFunction, IndexedHeader } from "./code-index.mjs"
 * @import { BlameLineResult } from "./git.mjs"
 * @import { MintRecipe } from "./keys.mjs"
 * @import { StackAdapter, StackUnavailableNote, StackWords } from "./stack.mjs"
 * @import { CaseEntry, QaFile, ScanContext } from "./scan.mjs"
 * @import { TrackerClaim, TrackerEntry, TrackerResolveResult, TrackerResolver } from "./tracker-resolver.mjs"
 */

/**
 * A `.qa/` file as the Key index holds it: its path and its frontmatter values.
 * @typedef {{
 *   rel: string,
 *   data: Record<string, unknown>,
 * }} IndexFile
 */

/**
 * The stack a project names, as `project.md` holds it.
 * @typedef {{
 *   language: unknown,
 *   framework: unknown,
 * }} StackDescriptor
 */

/**
 * The stack adapter this pass reads (lib/stack.mjs's `StackAdapter`): the separator a class path
 * joins with, the engineer's words, and the two flags that shape a Key prefix. Only what this pass
 * reads of the adapter is named here.
 * @typedef {{
 *   sep: string,
 *   words: StackWords,
 *   ownTrackerKeyScopes: boolean,
 *   fileKeyPrefix?: boolean,
 * }} ScanAdapter
 */

/**
 * The Key index the scan reads (lib/qa-index.mjs): the Scenarios it holds and the tracker.
 * @typedef {{
 *   scenarios: Map<string, { file: IndexFile, line: number, feature: string | null }[]>,
 *   tracker: TrackerResolver,
 *   featureOf: (file: QaFile) => string | null,
 * }} ScanIndex
 */

/**
 * The `project.md` settings the scan reads (lib/knowledge-file.mjs `projectConfig`).
 * @typedef {{
 *   stack: StackDescriptor | null,
 *   autPattern: RegExp,
 *   autExternal: boolean,
 *   autRecipe: MintRecipe | null,
 *   trackerPattern: RegExp | null,
 *   modulePaths: readonly string[],
 *   annotationMap: Record<string, readonly string[]>,
 *   autMintProblem?: string,
 *   autMintReason?: string,
 * }} ScanConfig
 */

/**
 * Where an Automation is: the file, the line, the class and the function's name.
 * @typedef {{
 *   file: string,
 *   line: number,
 *   class: string,
 *   name: string,
 * }} FunctionRef
 */

/**
 * Where a class is: the file, the line, its name and its path.
 * @typedef {{
 *   file: string,
 *   line: number,
 *   name: string,
 *   path: string,
 * }} ClassRef
 */

/**
 * The Key prefix a key minted for a function starts with (ADR-0013).
 * @typedef {{
 *   prefix: string | null,
 *   class: ClassRef | null,
 *   file?: string,
 *   proposed?: boolean,
 *   problem?: string,
 * }} KeyPrefix
 */

/**
 * A function a proposal names: where it is, what it would bind, and what git blame says of it.
 * @typedef {{
 *   file: string,
 *   line: number,
 *   class: string,
 *   name: string,
 *   blame: BlameLineResult | null,
 *   bind: string[],
 *   cross_feature: boolean,
 *   key_prefix?: KeyPrefix,
 * }} ProposalFunction
 */

/**
 * A function a proposal would re-key: where it is and what it would bind.
 * @typedef {{
 *   function: FunctionRef,
 *   bind: string[],
 *   cross_feature: boolean,
 * }} RekeyFunction
 */

/**
 * A binding proposal: what `/qa-sync` offers on its card.
 * @typedef {{
 *   code: string,
 *   message: string,
 *   feature?: string,
 *   key?: string,
 *   file?: string,
 *   line?: number,
 *   automation?: string,
 *   function?: FunctionRef,
 *   functions?: ProposalFunction[],
 *   class?: ClassRef,
 *   keep?: FunctionRef | null,
 *   rekey?: RekeyFunction[],
 *   undecidable?: boolean,
 *   bind?: string[],
 *   replace_in?: string[],
 *   cross_feature?: boolean,
 *   parameterised?: boolean,
 *   key_prefix?: KeyPrefix,
 *   annotation?: string[],
 * }} BindingProposal
 */

/**
 * The kinds of result this pass reports.
 * @typedef {"integrity_error" | "divergence" | "binding_proposal"} CodeResultKind
 */

/**
 * A result this pass reports: an Integrity error, a Divergence or a binding proposal.
 * @typedef {{
 *   kind: CodeResultKind,
 *   code: string,
 *   message: string,
 *   file?: string,
 *   line?: number,
 *   feature?: string,
 *   key?: string,
 *   automation?: string,
 *   function?: FunctionRef,
 *   class?: ClassRef,
 *   mirror?: string,
 *   annotation?: string[],
 *   knowledge?: string[],
 *   bind?: string[],
 *   replace_in?: string[],
 *   cross_feature?: boolean,
 *   parameterised?: boolean,
 *   key_prefix?: KeyPrefix,
 *   functions?: ProposalFunction[],
 *   keep?: FunctionRef | null,
 *   rekey?: RekeyFunction[],
 *   undecidable?: boolean,
 * }} CodeScanResult
 */

/**
 * A run-health note: what this run could not do (lib/scan.mjs's `health`).
 * @typedef {{
 *   code: string,
 *   message?: string,
 *   language?: unknown,
 *   framework?: unknown,
 *   version?: string | null,
 *   reason?: string,
 *   fix?: string,
 * }} RunHealthNote
 */

/**
 * The output's `index.automations`: each Automation key → its (first) function and Feature.
 * @typedef {{
 *   file: string,
 *   line: number,
 *   class: string,
 *   name: string,
 *   feature: string | undefined,
 * }} AutomationIndexEntry
 */

/**
 * An `automates` entry of a case: the Automation key and where it is written.
 * @typedef {{
 *   aut: string,
 *   file: string,
 *   line: number,
 *   feature: string | undefined,
 *   key: string,
 *   entry: CaseEntry,
 * }} AutomateEntry
 */

/**
 * Which code a Feature can claim: the invariant below.
 * @typedef {{
 *   scenarios: Map<string, string | null | undefined>,
 *   suites: Map<string, Set<string>>,
 *   ofChain: (chain: IndexedClass[]) => { feature: string | null } | null,
 *   ofClass: (cls: IndexedClass) => { feature: string | null } | null,
 * }} ScanScope
 */

/**
 * A class's Key prefix holder: the class and the scope it sits in.
 * @typedef {{
 *   c: IndexedClass,
 *   s: { feature: string | null },
 * }} ClassKeyHolder
 */

/**
 * Every fact the checks share, computed once.
 * @typedef {{
 *   ctx: ScanContext,
 *   code: CodeIndex,
 *   adapter: ScanAdapter,
 *   scope: ScanScope,
 *   entries: AutomateEntry[],
 *   binders: Map<string, AutomateEntry[]>,
 *   single: Map<string, IndexedFunction>,
 *   duplicate: Map<string, IndexedFunction[]>,
 *   malformed: { fn: IndexedFunction, key: string }[],
 *   dead: Map<string, AutomateEntry[]>,
 *   retired: Map<string, string>,
 * }} BindingFacts
 */

/** @type {readonly CodeResultKind[]} */
export const kinds = ["integrity_error", "divergence", "binding_proposal"];

// `ctx.stack` is the run's resolved stack adapter (lib/stack.mjs `resolveAdapter`).
/**
 * @param {ScanContext} ctx
 * @returns {void}
 */
export function run(ctx) {
  const { adapter, unavailable } = ctx.stack;
  const s = ctx.config.stack;
  if (unavailable) {
    // An adapter reads the stack but cannot load in this repository (ADR-0023): code binding is
    // skipped with the adapter's own note, never by parsing with guesswork.
    ctx.health({ code: "adapter_unavailable", language: /** @type {StackDescriptor} */ (s).language, framework: /** @type {StackDescriptor} */ (s).framework, ...unavailable });
    return;
  }
  if (!adapter) {
    const pair = s ? `(${s.language ?? "?"}, ${s.framework ?? "?"})` : "(no `project.stack`)";
    ctx.health({ code: "no_scanner", message: `${pair}: no scanner; code binding skipped`, language: s?.language ?? null, framework: s?.framework ?? null });
    return;
  }
  // What the adapter read with, when it reports it (ADR-0023: the repository's own parser), so a
  // version drift across projects is visible.
  if (ctx.stack.version) ctx.health({ code: "adapter_version", language: /** @type {StackDescriptor} */ (s).language, framework: /** @type {StackDescriptor} */ (s).framework, version: ctx.stack.version, message: `(${/** @type {StackDescriptor} */ (s).language}, ${/** @type {StackDescriptor} */ (s).framework}): read with ${ctx.stack.version}` });
  const code = buildCodeIndex(ctx.repo, ctx.config.modulePaths, ctx.config.annotationMap, /** @type {StackAdapter} */ (adapter), keyPatterns(ctx.config));
  if (code.files === 0) {
    // An existing but empty test root (or a `.qa/` scanned without its code): calling every
    // `automates` entry dead would bury the one real finding, a misconfigured `module_paths`.
    ctx.health({ code: "no_code", message: `no ${adapter.words.source} under \`module_paths\`; code binding skipped` });
    return;
  }
  if (ctx.config.autMintProblem) ctx.health({ code: "no_minting", reason: ctx.config.autMintReason, message: ctx.config.autMintProblem });
  const b = binding(ctx, code, adapter);
  ctx.indexAutomations(automationIndex(b));
  automates(b);
  automationKeys(b);
  keyPrefixes(b);
  classKeys(b);
  retiredInCode(b);
  divergences(b);
  proposals(b);
}

// Every fact the checks share, computed once:
//   ctx, code     the scan context and the code index
//   adapter       the stack's adapter (lib/stack.mjs)
//   scope         which code a Feature can claim (below)
//   entries       every `automates` entry of every case: {aut, file, line, feature, key, entry}
//   binders       Automation key → the entries naming it
//   single        well-formed key on exactly one function → that function
//   duplicate     well-formed key on several functions → those functions
//   malformed     [{fn, key}] for keys not matching the Automation-key pattern
//   dead          well-formed key no function carries → the entries naming it
//   retired       retired case or Scenario key → where it is recorded
/**
 * @param {ScanContext} ctx
 * @param {CodeIndex} code
 * @param {ScanAdapter} adapter
 * @returns {BindingFacts}
 */
function binding(ctx, code, adapter) {
  const onFns = groupBy(code.functions.flatMap((fn) => fn.automationKeys.map(({ key }) => /** @type {[string, IndexedFunction]} */ ([key, fn]))));
  /** @type {Map<string, IndexedFunction>} */
  const single = new Map();
  /** @type {Map<string, IndexedFunction[]>} */
  const duplicate = new Map();
  /** @type {{ fn: IndexedFunction, key: string }[]} */
  const malformed = [];
  const aut = autPattern(ctx);
  for (const [key, fns] of onFns) {
    if (!aut.test(key)) malformed.push(...fns.map((fn) => ({ fn, key })));
    else if (fns.length === 1) single.set(key, fns[0]);
    else duplicate.set(key, fns);
  }
  const entries = automatesEntries(ctx);
  const binders = groupBy(entries.map((e) => /** @type {[string, AutomateEntry]} */ ([e.aut, e])));
  const dead = groupBy(entries.filter((e) => aut.test(e.aut) && !onFns.has(e.aut)).map((e) => /** @type {[string, AutomateEntry]} */ ([e.aut, e])));
  return { ctx, code, adapter, scope: scoping(ctx, code, adapter.sep), entries, binders, single, duplicate, malformed, dead, retired: retiredKeys(ctx) };
}

// `project.md`'s Automation-key test (`aut_` unless `automation_key_pattern` sets another), and how
// a finding names it.
/**
 * @param {ScanContext} ctx
 * @returns {RegExp}
 */
const autPattern = (ctx) => ctx.config.autPattern ?? PATTERN.aut;
/**
 * @param {ScanContext} ctx
 * @returns {string}
 */
const autShape = (ctx) => {
  if (ctx.config.autExternal) return `\`automation_key_pattern\` \`${/** @type {RegExp} */ (ctx.config.autPattern).source}\``;
  if (ctx.config.autRecipe) return `the shape of \`automation_key_mint\`, \`${/** @type {RegExp} */ (ctx.config.autPattern).source}\``;
  return "`aut_` + 6 Crockford base32 characters";
};

// `[[key, value]]` → Map key → [values], in first-seen order.
/**
 * @template V
 * @param {readonly (readonly [string, V])[]} pairs
 * @returns {Map<string, V[]>}
 */
function groupBy(pairs) {
  /** @type {Map<string, V[]>} */
  const out = new Map();
  for (const [k, v] of pairs) {
    if (!out.has(k)) out.set(k, []);
    /** @type {V[]} */ (out.get(k)).push(v);
  }
  return out;
}

// Where an Automation is: `{file, line, class, name}`, `file` relative to the repository.
/**
 * @param {IndexedFunction} fn
 * @returns {FunctionRef}
 */
const fnRef = (fn) => ({ file: fn.file, line: fn.line, class: fn.class, name: fn.name });
/**
 * @param {IndexedClass} c
 * @returns {ClassRef}
 */
const classRef = (c) => ({ file: c.file, line: c.line, name: c.name, path: c.path });
/**
 * @param {{ feature: string | null } | null} s
 * @returns {string | undefined}
 */
const featureOf = (s) => s?.feature ?? undefined;
/**
 * @param {unknown} v
 * @returns {string[]}
 */
const stringsIn = (v) => (Array.isArray(v) ? v.filter((k) => typeof k === "string") : []);
/**
 * @param {readonly string[]} keys
 * @returns {string}
 */
const quoted = (keys) => (keys.length ? keys.map((k) => `\`${k}\``).join(", ") : "nothing");

// Which code a Feature can claim, the invariant below. `project.md` maps no module path to a
// Feature, so the mapping is read from the tracker keys the code already carries: a class is in
// scope when it, or a class enclosing it, carries a known Scenario key (that Scenario's Feature) or
// one of a Feature's suites (a `mirror.suite` of its scenarios). The innermost such class decides;
// a suite shared by several Features leaves the class in scope with no one Feature.
//   scope.ofChain(classes)  {feature} | null, for a chain of classes outermost first
//   scope.ofClass(cls)      the same for one class and its enclosing classes
//   scenarios               Tracker key → Scenario Feature;  suites  suite key → Set of Features
// `sep` joins a class path (the adapter's).
/**
 * @param {ScanContext} ctx
 * @param {CodeIndex} code
 * @param {string} sep
 * @returns {ScanScope}
 */
function scoping(ctx, code, sep) {
  /** @type {Map<string, string | null | undefined>} */
  const scenarios = new Map();
  /** @type {Map<string, Set<string>>} */
  const suites = new Map();
  for (const decls of ctx.index.scenarios.values()) {
    const d = decls[0];
    const suite = /** @type {Record<string, unknown>} */ (d.file.data.mirror)?.suite;
    if (typeof suite === "string" && d.feature) {
      if (!suites.has(suite)) suites.set(suite, new Set());
      /** @type {Set<string>} */ (suites.get(suite)).add(d.feature);
    }
  }
  for (const key of ctx.index.tracker.claims.keys()) {
    const r = ctx.index.tracker.resolve(key);
    if (r.status === "unique" && r.entry.kind === "scenario") scenarios.set(key, r.entry.feature);
  }
  /**
   * @param {IndexedClass[]} chain
   * @returns {{ feature: string | null } | null}
   */
  const ofChain = (chain) => {
    for (let i = chain.length - 1; i >= 0; i--) {
      for (const { key } of chain[i].trackerKeys) {
        if (scenarios.has(key)) return { feature: scenarios.get(key) ?? null };
        const fs = suites.get(key);
        if (fs) return { feature: fs.size === 1 ? [...fs][0] : null };
      }
    }
    return null;
  };
  /** @type {Map<string, IndexedClass>} */
  const byPath = new Map(code.classes.map((c) => /** @type {[string, IndexedClass]} */ ([`${c.file}:${c.path}`, c])));
  /**
   * @param {IndexedClass} c
   * @returns {IndexedClass[]}
   */
  const chainOf = (c) => {
    const parts = c.path.split(sep);
    return /** @type {IndexedClass[]} */ (parts.map((_, i) => byPath.get(`${c.file}:${parts.slice(0, i + 1).join(sep)}`)).filter(Boolean));
  };
  return { scenarios, suites, ofChain, ofClass: (c) => ofChain(chainOf(c)) };
}

// Every `automates` entry of every case, with where it is written.
/**
 * @param {ScanContext} ctx
 * @returns {AutomateEntry[]}
 */
function automatesEntries(ctx) {
  /** @type {AutomateEntry[]} */
  const out = [];
  for (const f of ctx.files) {
    if (f.unreadable || f.type !== "scenario") continue;
    const feature = ctx.index.featureOf(f) ?? undefined;
    for (const c of f.cases) {
      for (const aut of stringsIn(c.data.automates)) {
        out.push({ aut, file: f.rel, line: c.keyLines.automates ?? c.blockLine ?? c.line, feature, key: c.key, entry: c });
      }
    }
  }
  return out;
}

// Tracker tombstones, including a tombstone that clashes with a live link.
/**
 * @param {ScanContext} ctx
 * @returns {Map<string, string>}
 */
function retiredKeys(ctx) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const [key, claims] of ctx.index.tracker.claims) {
    const retired = claims.find((c) => c.field === "retired");
    if (retired) out.set(key, `\`retired\` of ${retired.file.rel}`);
  }
  return out;
}

// The output's `index.automations`: each Automation key → its (first) function and Feature.
/**
 * @param {BindingFacts} facts
 * @returns {Map<string, AutomationIndexEntry>}
 */
function automationIndex({ scope, single, duplicate, binders }) {
  /** @type {Map<string, AutomationIndexEntry>} */
  const out = new Map();
  for (const [aut, fns] of [...single].map(([k, fn]) => /** @type {[string, IndexedFunction[]]} */ ([k, [fn]])).concat([...duplicate])) {
    const fn = fns[0];
    out.set(aut, { ...fnRef(fn), feature: featureOf(scope.ofChain(fn.classes)) ?? binders.get(aut)?.[0].feature });
  }
  return out;
}

// Invariant 4: `automates` resolves to an `aut_` in the code scan. A dead entry is reported, never
// dropped: only a person-approved proposal removes it.
/**
 * @param {BindingFacts} facts
 * @returns {void}
 */
function automates({ ctx, dead }) {
  for (const [aut, es] of dead) {
    for (const e of es) {
      ctx.emit({
        kind: "integrity_error",
        code: "unresolved_automates",
        file: e.file,
        line: e.line,
        feature: e.feature,
        key: e.key,
        automation: aut,
        message: `\`${e.key}\` automates \`${aut}\`, which no Automation under \`module_paths\` carries`,
      });
    }
  }
}

// Invariants 1, 2 and 5 on the code side: an Automation key matches its pattern and is on one
// function only.
/**
 * @param {BindingFacts} facts
 * @returns {void}
 */
function automationKeys({ ctx, scope, malformed, duplicate }) {
  for (const { fn, key } of malformed) {
    ctx.emit({
      kind: "integrity_error",
      code: "automation_key_pattern",
      feature: featureOf(scope.ofChain(fn.classes)),
      key,
      function: fnRef(fn),
      message: `\`${fn.name}\` carries Automation key \`${key}\`, which does not match ${autShape(ctx)}`,
    });
  }
  for (const [key, fns] of duplicate) {
    const places = fns.map((f) => `${f.file}:${f.line} \`${f.name}\``).join(", ");
    for (const fn of fns) {
      ctx.emit({
        kind: "integrity_error",
        code: "duplicate_automation_key",
        feature: featureOf(scope.ofChain(fn.classes)),
        key,
        function: fnRef(fn),
        message: `Automation key \`${key}\` is on ${fns.length} functions: ${places}`,
      });
    }
  }
}

// ADR-0013: a class's Key prefix fits `automation_key_mint`, else `/qa-sync` cannot mint for its
// tests. Never corrected, and never compared with the keys already minted under it: a key keeps
// its prefix when its class's changes.
/**
 * @param {BindingFacts} facts
 * @returns {void}
 */
function keyPrefixes({ ctx, code, scope }) {
  const recipe = ctx.config.autRecipe;
  if (!recipe) return;
  for (const c of code.classes) {
    for (const { key } of c.keyPrefixes) {
      if (prefixFits(key, recipe)) continue;
      ctx.emit({
        kind: "integrity_error",
        code: "key_prefix",
        feature: featureOf(scope.ofClass(c)),
        key,
        class: classRef(c),
        message: `class \`${c.path}\` carries Key prefix \`${key}\`, which is not ${prefixRule(recipe)} (\`automation_key_mint\`)`,
      });
    }
  }
  // A file's header Key prefix (ADR-0022), read whole whatever it holds, so a wrong one is seen.
  for (const h of code.headers ?? []) {
    for (const { key, line } of h.keyPrefixes) {
      if (prefixFits(key, recipe)) continue;
      ctx.emit({
        kind: "integrity_error",
        code: "key_prefix",
        file: h.file,
        line,
        key,
        message: `file \`${h.file}\` carries Key prefix \`${key}\` in its header, which is not ${prefixRule(recipe)} (\`automation_key_mint\`)`,
      });
    }
  }
}

// Invariant 6: in scope, a class's tracker key names a known Scenario (file-level binding, one to
// one) or a Feature's suite, and no Scenario key sits on two classes. Classes out of scope are
// Unkeyed territory and never checked.
/**
 * @param {BindingFacts} facts
 * @returns {void}
 */
function classKeys({ ctx, code, scope, retired }) {
  /** @type {Map<string, ClassKeyHolder[]>} */
  const holders = new Map();
  for (const c of code.classes) {
    const s = c.trackerKeys.length ? scope.ofClass(c) : null;
    if (!s) continue;
    for (const { key } of c.trackerKeys) {
      if (scope.scenarios.has(key)) {
        const scenarioKey = /** @type {TrackerEntry} */ (ctx.index.tracker.resolve(key).entry).key;
        if (!holders.has(scenarioKey)) holders.set(scenarioKey, []);
        if (!/** @type {ClassKeyHolder[]} */ (holders.get(scenarioKey)).some((h) => h.c === c)) /** @type {ClassKeyHolder[]} */ (holders.get(scenarioKey)).push({ c, s });
      } else if (!scope.suites.has(key) && !retired.has(key)) {
        const r = ctx.index.tracker.resolve(key);
        const what = r.status === "unique" && r.entry.kind === "case" ? "a Test Case, not a Scenario" : "no Scenario or suite in `.qa/`";
        ctx.emit({
          kind: "integrity_error",
          code: "unresolved_class_key",
          feature: featureOf(s),
          key,
          class: classRef(c),
          message: `class \`${c.path}\` carries tracker key \`${key}\`, which names ${what}`,
        });
      }
    }
  }
  for (const [key, list] of holders) {
    if (list.length < 2) continue;
    const places = list.map(({ c }) => `${c.file}:${c.line} \`${c.path}\``).join(", ");
    for (const { c, s } of list) {
      ctx.emit({
        kind: "integrity_error",
        code: "duplicate_class_key",
        feature: featureOf(s),
        key,
        class: classRef(c),
        message: `Scenario key \`${key}\` is on ${list.length} classes: ${places}`,
      });
    }
  }
}

// Invariant 12's code half: no retired key resolves to a live tracker-key annotation, on a
// function or a class, anywhere under `module_paths`.
/**
 * @param {BindingFacts} facts
 * @returns {void}
 */
function retiredInCode({ ctx, code, scope, retired }) {
  if (!retired.size) return;
  /**
   * @param {string} key
   * @param {{ feature: string | null } | null} s
   * @param {{ class?: ClassRef, function?: FunctionRef }} where
   * @param {string} what
   * @returns {void}
   */
  const flag = (key, s, where, what) => {
    ctx.emit({
      kind: "integrity_error",
      code: "retired_key_in_code",
      feature: featureOf(s),
      key,
      ...where,
      message: `${what} carries tracker key \`${key}\`, retired in ${retired.get(key)}`,
    });
  };
  for (const c of code.classes) {
    for (const { key } of c.trackerKeys) if (retired.has(key)) flag(key, scope.ofClass(c), { class: classRef(c) }, `class \`${c.path}\``);
  }
  for (const fn of code.functions) {
    for (const { key } of fn.trackerKeys) if (retired.has(key)) flag(key, scope.ofChain(fn.classes), { function: fnRef(fn) }, `\`${fn.name}\``);
  }
}

const CANCELED = /^cancell?ed$/i;

// The Divergences that need the code. The case
// ↔ Automation edge is stated twice on purpose (ADR-0005): `automates` is the intended binding,
// the function's tracker-key annotation is what runs. Both sides are quoted; neither is corrected.
/**
 * @param {BindingFacts} facts
 * @returns {void}
 */
function divergences({ ctx, scope, entries, binders, single, duplicate }) {
  /**
   * @param {AutomateEntry} e
   * @returns {{ file: string, line: number, feature: string | undefined, key: string }}
   */
  const at = (e) => ({ file: e.file, line: e.line, feature: e.feature, key: e.key });

  // `mirror.status` Canceled while an Automation still runs: it resolves, and neither it nor an
  // enclosing class is @Disabled.
  for (const e of entries) {
    const status = /** @type {Record<string, unknown>} */ (e.entry.data.mirror)?.status;
    if (typeof status !== "string" || !CANCELED.test(status)) continue;
    const fns = single.has(e.aut) ? /** @type {IndexedFunction[]} */ ([single.get(e.aut)]) : duplicate.get(e.aut) ?? [];
    const running = fns.find((fn) => !fn.disabled);
    if (!running) continue;
    ctx.emit({
      kind: "divergence",
      code: "canceled_but_automated",
      ...at(e),
      automation: e.aut,
      function: fnRef(running),
      mirror: status,
      message: `\`${e.key}\` is ${status} in the tracker, but its Automation \`${e.aut}\` (\`${running.name}\`) still runs`,
    });
  }

  // A duplicated key is an Integrity error first; which function it means is not yet settled.
  for (const [aut, fn] of single) {
    const bound = binders.get(aut) ?? [];
    const named = [...new Set(fn.trackerKeys.map((t) => t.key))];
    if (!bound.length) {
      const target = named.map((k) => ctx.index.tracker.resolve(k)).find((r) => r.status === "unique" && r.entry.kind === "case")?.entry;
      ctx.emit({
        kind: "divergence",
        code: "unclaimed_automation",
        feature: target?.feature ?? featureOf(scope.ofChain(fn.classes)),
        key: aut,
        function: fnRef(fn),
        annotation: named,
        message: `Automation \`${aut}\` (\`${fn.name}\`) is named by no case's \`automates\``,
      });
      continue;
    }
    // A code tracker key vs `automates`: only a function that states a tracker key can disagree.
    if (!named.length) continue;
    const knowledge = [...new Set(bound.map((e) => e.key))];
    const quote = { automation: aut, function: fnRef(fn), knowledge, annotation: named };
    for (const e of bound) {
      if (named.some((k) => {
        const r = ctx.index.tracker.resolve(k);
        return r.status === "unique" && r.entry.kind === "case" && r.entry.key === e.key;
      })) continue;
      ctx.emit({
        kind: "divergence",
        code: "tracker_key_vs_automates",
        ...at(e),
        ...quote,
        message: `\`${e.key}\` automates \`${aut}\`, but \`${fn.name}\`'s tracker key names ${quoted(named)}`,
      });
    }
    /** @type {Set<TrackerEntry>} */
    const reported = new Set();
    for (const k of named) {
      const r = ctx.index.tracker.resolve(k);
      const d = r.status === "unique" && r.entry.kind === "case" ? r.entry : null;
      if (!d || knowledge.includes(d.key) || reported.has(d)) continue;
      reported.add(d);
      ctx.emit({
        kind: "divergence",
        code: "tracker_key_vs_automates",
        file: d.file.rel,
        line: d.line,
        feature: d.feature ?? undefined,
        key: d.key,
        ...quote,
        message: `\`${fn.name}\`'s tracker key names \`${k}\`, but \`${k}\` does not automate \`${aut}\``,
      });
    }
  }
}

// Binding proposals: what `/qa-sync` offers on its card, each applied only on approval. The
// target of a binding is what the function's tracker-key annotation names: every case
// it names that `.qa/` holds, many-to-many, flagged cross-Feature when those cases (or the
// Feature whose code holds the function) are not all one Feature. A key is minted even when
// nothing binds (item 6).
/**
 * @param {BindingFacts} facts
 * @returns {void}
 */
function proposals({ ctx, code, adapter, scope, entries, dead, single, duplicate }) {
  /**
   * @param {BindingProposal} p
   * @returns {void}
   */
  const propose = (p) => ctx.emit({ kind: "binding_proposal", ...p });
  const keyPrefix = keyPrefixOf(ctx, code);
  /**
   * @param {IndexedFunction} fn
   * @returns {{ bind: string[], cross_feature: boolean, feature: string | undefined }}
   */
  const target = (fn) => {
    const resolved = /** @type {TrackerEntry[]} */ (fn.trackerKeys.map((t) => ctx.index.tracker.resolve(t.key)).filter((r) => r.status === "unique" && r.entry.kind === "case").map((r) => r.entry));
    const bind = [...new Set(resolved.map((d) => d.key))];
    const home = scope.ofChain(fn.classes)?.feature;
    const features = new Set(resolved.map((d) => d.feature));
    if (home) features.add(home);
    const feature = home ?? resolved[0]?.feature;
    return { bind, cross_feature: features.size > 1, feature: feature ?? undefined };
  };

  // Unkeyed tests a Feature can claim: out-of-scope code is never listed. An enclosing
  // class's key scopes a test; where none does, the test's own tracker key scopes it only where the
  // stack's adapter says so (`ownTrackerKeyScopes`, ADR-0022).
  /**
   * @param {IndexedFunction} fn
   * @returns {boolean}
   */
  const ownKey = (fn) => adapter.ownTrackerKeyScopes && fn.trackerKeys.some((t) => {
    const r = ctx.index.tracker.resolve(t.key);
    return r.status === "unique" && r.entry.kind === "case";
  });
  const unkeyed = code.functions.filter((fn) => !fn.automationKeys.length && (scope.ofChain(fn.classes) || ownKey(fn)));

  // Rebind: a dead key and an Unkeyed function whose tracker key names a case holding
  // it, paired one to one. The new key replaces the dead one only in the cases the function names;
  // any other case holding the dead key keeps its own removal. Anything ambiguous stays separate.
  /** @type {Map<string, IndexedFunction[]>} */
  const candidates = new Map();
  const deadCount = new Map(unkeyed.map((fn) => /** @type {[IndexedFunction, number]} */ ([fn, 0])));
  for (const [aut, es] of dead) {
    const cases = new Set(es.map((e) => e.key));
    const fns = unkeyed.filter((fn) => target(fn).bind.some((key) => cases.has(key)));
    candidates.set(aut, fns);
    for (const fn of fns) deadCount.set(fn, /** @type {number} */ (deadCount.get(fn)) + 1);
  }
  /** @type {Set<string | IndexedFunction>} */
  const rebound = new Set(); // functions, and `aut:case` entries, a rebind already covers
  for (const [aut, es] of dead) {
    const fns = /** @type {IndexedFunction[]} */ (candidates.get(aut));
    if (fns.length !== 1 || deadCount.get(fns[0]) !== 1) continue;
    const [fn] = fns;
    const t = target(fn);
    const named = new Set(t.bind);
    const replaceIn = [...new Set(es.map((e) => e.key))].filter((k) => named.has(k));
    rebound.add(fn);
    for (const k of replaceIn) rebound.add(`${aut}:${k}`);
    propose({
      code: "rebind",
      feature: /** @type {AutomateEntry} */ (es.find((e) => named.has(e.key))).feature ?? t.feature,
      automation: aut,
      function: fnRef(fn),
      replace_in: replaceIn,
      bind: t.bind.filter((k) => !replaceIn.includes(k)),
      cross_feature: t.cross_feature,
      ...keyPrefix(fn),
      message: `mint a key for \`${fn.name}\` and swap it for the dead \`${aut}\` in ${quoted(replaceIn)}`,
    });
  }
  for (const [aut, es] of dead) {
    for (const e of es) {
      if (rebound.has(`${aut}:${e.key}`)) continue;
      propose({
        code: "remove_dead_automates",
        file: e.file,
        line: e.line,
        feature: e.feature,
        key: e.key,
        automation: aut,
        message: `remove the dead \`${aut}\` from \`${e.key}\`'s \`automates\``,
      });
    }
  }
  for (const fn of unkeyed) {
    if (rebound.has(fn)) continue;
    const t = target(fn);
    propose({
      code: "mint_and_bind",
      feature: t.feature,
      function: fnRef(fn),
      bind: t.bind,
      cross_feature: t.cross_feature,
      parameterised: fn.parameterised,
      ...keyPrefix(fn),
      message: `mint a key for \`${fn.name}\`, ${adapter.words.write} it and bind ${quoted(t.bind)}`,
    });
  }

  // Duplicate `aut_`: the function whose annotation line is older by `git blame`
  // keeps the Key; every other one is re-keyed and bound by its own tracker key. Uncommitted lines
  // and ties leave it undecidable, for the card to ask.
  for (const [aut, fns] of duplicate) {
    const blamed = fns.map((fn) => ({ fn, blame: blameLine(ctx.repo, fn.file, /** @type {CodeKey} */ (fn.automationKeys.find((k) => k.key === aut)).line) }));
    const committed = /** @type {{ fn: IndexedFunction, blame: BlameLineResult }[]} */ (blamed.filter((b) => b.blame));
    const oldest = Math.min(...committed.map((b) => b.blame.time));
    const winners = committed.filter((b) => b.blame.time === oldest);
    const keep = winners.length === 1 ? winners[0].fn : null;
    /**
     * @param {IndexedFunction} fn
     * @returns {{ bind: string[], cross_feature: boolean }}
     */
    const bound = (fn) => {
      const { bind, cross_feature } = target(fn);
      return { bind, cross_feature };
    };
    /**
     * @param {IndexedFunction} fn
     * @returns {{ function: FunctionRef, bind: string[], cross_feature: boolean }}
     */
    const rekey = (fn) => ({ function: fnRef(fn), ...bound(fn) });
    propose({
      code: "duplicate_automation_key",
      feature: target(fns[0]).feature,
      key: aut,
      // Each function with the target it would be bound to if re-keyed, so a person who settles
      // an undecidable case (or overrides blame) needs nothing re-derived.
      functions: blamed.map(({ fn, blame }) => ({ ...fnRef(fn), blame, ...bound(fn), ...keyPrefix(fn) })),
      keep: keep ? fnRef(keep) : null,
      rekey: keep ? fns.filter((fn) => fn !== keep).map(rekey) : [],
      undecidable: !keep,
      message: keep
        ? `\`${keep.name}\` keeps \`${aut}\` (its ${adapter.words.carrier} is older by git blame); mint new keys for the ${fns.length - 1} other(s)`
        : `\`${aut}\` is on ${fns.length} functions and git blame cannot say which ${adapter.words.carrier} is older: ask which keeps it`,
    });
  }

  // Unclaimed Automations: link to the cases the tracker key names, if any. With
  // nothing to link to, the Divergence stands alone.
  /** @type {Set<string>} */
  const claimed = new Set(entries.map((e) => e.aut));
  for (const [aut, fn] of single) {
    if (claimed.has(aut)) continue;
    const t = target(fn);
    if (!t.bind.length) continue;
    propose({
      code: "link_unclaimed",
      feature: t.feature,
      key: aut,
      function: fnRef(fn),
      bind: t.bind,
      cross_feature: t.cross_feature,
      message: `add \`${aut}\` to the \`automates\` of ${quoted(t.bind)}`,
    });
  }
}

// ADR-0013: with `automation_key_mint`, the Key prefix a key minted for a function starts with, as
// `{key_prefix: {prefix, class, proposed?, problem?}}` (nothing without the recipe). It is the
// nearest enclosing class's `automation_key_prefix` annotation; with none, one is proposed for
// the outermost class from its name (`prefix` null when its name has too few letters), shunning
// the prefixes other classes carry or were proposed. `problem` says why nothing can be minted: a
// prefix breaking the recipe, or a top-level function with no class to carry one.
//
// A stack whose files carry a Key prefix in a header (`fileKeyPrefix`, ADR-0022) falls back to the
// file instead of the outermost class: with no enclosing class carrying one, the prefix is the
// file's header's, as `{prefix, class: null, file, problem?}`; with none there, one is proposed for
// the file from its name (`proposed: true`), whether or not the test is in a class.
/**
 * @param {ScanContext} ctx
 * @param {CodeIndex} code
 * @returns {(fn: IndexedFunction) => { key_prefix?: KeyPrefix }}
 */
function keyPrefixOf(ctx, code) {
  const recipe = ctx.config.autRecipe;
  if (!recipe) return () => ({});
  /** @type {Map<string, IndexedHeader>} */
  const headers = new Map((code.headers ?? []).map((h) => /** @type {[string, IndexedHeader]} */ ([h.file, h])));
  /** @type {Set<string>} */
  const taken = new Set([...code.classes, ...headers.values()].flatMap((c) => c.keyPrefixes.map((p) => p.key)));
  /** @type {Map<string, string | null>} */
  const proposed = new Map();
  /**
   * @param {string} id
   * @param {string} name
   * @returns {string | null}
   */
  const suggest = (id, name) => {
    if (!proposed.has(id)) {
      const prefix = suggestPrefix(name, recipe, taken);
      if (prefix) taken.add(prefix);
      proposed.set(id, prefix);
    }
    return /** @type {string | null} */ (proposed.get(id));
  };
  /**
   * @param {IndexedClass} c
   * @returns {string | null}
   */
  const propose = (c) => suggest(`${c.file}:${c.path}`, c.name);
  // A file's name, less its directory and every extension (`orders.spec.ts` → `orders`).
  /**
   * @param {string} file
   * @returns {string}
   */
  const stem = (file) => file.slice(file.lastIndexOf("/") + 1).split(".")[0];
  /**
   * @param {IndexedFunction} fn
   * @returns {{ key_prefix?: KeyPrefix }}
   */
  const ofFile = (fn) => {
    const [held] = headers.get(fn.file)?.keyPrefixes ?? [];
    if (!held) return { key_prefix: { prefix: suggest(fn.file, stem(fn.file)), class: null, file: fn.file, proposed: true } };
    const problem = prefixFits(held.key, recipe) ? {} : { problem: `file \`${fn.file}\`'s Key prefix \`${held.key}\` does not fit \`automation_key_mint\`: fix it, then sync again` };
    return { key_prefix: { prefix: held.key, class: null, file: fn.file, ...problem } };
  };
  return (fn) => {
    const holder = [...fn.classes].reverse().find((c) => c.keyPrefixes.length);
    if (holder) {
      const prefix = holder.keyPrefixes[0].key;
      const problem = prefixFits(prefix, recipe) ? {} : { problem: `class \`${holder.path}\`'s Key prefix \`${prefix}\` does not fit \`automation_key_mint\`: fix it, then sync again` };
      return { key_prefix: { prefix, class: classRef(holder), ...problem } };
    }
    if (/** @type {ScanAdapter} */ (ctx.stack.adapter).fileKeyPrefix) return ofFile(fn);
    if (!fn.classes.length) return { key_prefix: { prefix: null, class: null, problem: `\`${fn.name}\` is in no class, so no ${/** @type {ScanAdapter} */ (ctx.stack.adapter).words.classCarrier} can carry its Key prefix` } };
    const outer = fn.classes[0];
    return { key_prefix: { prefix: propose(outer), class: classRef(outer), proposed: true } };
  };
}
