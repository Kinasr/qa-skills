// @ts-check
// The Kotlin/JUnit 5 stack adapter (lib/stack.mjs, ADR-0005, ADR-0022): a Key carrier is an
// annotation, read by the source scan of lib/stacks/kotlin.mjs and written as its own line above
// the function or class, with the import it needs.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { carrierNames, filesUnder } from "../code-source.mjs";
import { listFiles } from "../git.mjs";
import { kotlinAssertionContracts, parseKotlin } from "./kotlin.mjs";
import { splice } from "./splice.mjs";
import { isKotlinJUnit5Stack } from "./descriptors.mjs";

/**
 * @import { KotlinAnnotation, KotlinClass, KotlinFunction } from "./kotlin.mjs"
 * @import { SpliceEdit } from "./splice.mjs"
 * @import { CodegenAdapter, CodegenShape } from "../stack.mjs"
 */

/**
 * A class of a parsed Kotlin file, with its annotations as its Key carriers.
 * @typedef {{
 *   name: string,
 *   line: number,
 *   path: string,
 *   carriers: KotlinAnnotation[],
 * }} KotlinTestClass

/**
 * A function of a parsed Kotlin file, with its annotations as its Key carriers.
 * @typedef {{
 *   name: string,
 *   line: number,
 *   classPath: string,
 *   carriers: KotlinAnnotation[],
 * }} KotlinTestFunction

/**
 * A parsed Kotlin file: its package declaration, classes and functions.
 * @typedef {{ package: string | null, classes: KotlinTestClass[], functions: KotlinTestFunction[] }} KotlinParsedFile

/**
 * A key a carrier holds, and the line it is written at.
 * @typedef {{ key: string, line: number }} KotlinKey

/**
 * A declaration of a reparsed Kotlin file, read as a class or as a function: the write's kind says
 * which of the two it is.
 * @typedef {KotlinClass & KotlinFunction} KotlinReparsed

/**
 * The stack's words in engineer text (lib/stack.mjs).
 * @typedef {{
 *   source: string,
 *   testSuite: string,
 *   carrier: string,
 *   aCarrier: string,
 *   carriers: string,
 *   classCarrier: string,
 *   keyCarrier: string,
 *   keyCarrierTitle: string,
 *   write: string,
 * }} KotlinAdapterWords

/**
 * A function or a class a write is for, as the card saw it: a function by its name and its class,
 * a class by its path.
 * @typedef {{ line: number, name?: string, class?: string, path?: string }} KotlinFnRef

/**
 * A class a write is for, as the card saw it.
 * @typedef {{ line: number, path: string }} KotlinClassRef

/**
 * The key a write writes.
 * @typedef {{ key: string }} KotlinHandle

/**
 * A rekey a card asks for: the test or class it saw, the key it carried, and the key to write.
 * @typedef {{
 *   fn: KotlinFnRef,
 *   from: string,
 *   handle: KotlinHandle,
 *   kind?: "function" | "class",
 *   names?: string[],
 * }} KotlinRekeyOp

/**
 * The writes a card asks for on one file.
 * @typedef {{
 *   annotate: { fn: KotlinFnRef, handle: KotlinHandle }[],
 *   rekey: KotlinRekeyOp[],
 *   prefix: { cls: KotlinClassRef, prefix: string }[],
 * }} KotlinRenderOps

/**
 * The Key carrier a write is written in, and the Key-prefix carrier beside it.
 * @typedef {{
 *   name: string,
 *   names: string[],
 *   home: string | null,
 *   prefix: { name: string, home: string | null },
 * }} KotlinWriteCarrier

/**
 * A write's error: `stale` when the file no longer holds what the card saw, `unlanded` when it does
 * but a re-parse does not find the key on it.
 * @typedef {{ kind: string, message: string }} KotlinWriteError

/**
 * One file with its keys written.
 * @typedef {{ text: string, errors: KotlinWriteError[] }} KotlinRenderResult

/**
 * Where the code declares the carrier.
 * @typedef {{
 *   status: "declared",
 *   path: string,
 *   home: string,
 * }} KotlinDeclaredState

/**
 * Where the test code imports the carrier from, as a library.
 * @typedef {{
 *   status: "imported",
 *   path?: undefined,
 *   home: string,
 * }} KotlinImportedState

/**
 * Where the carrier would be declared: the default home, each field null when there is none.
 * @typedef {{
 *   status: "missing",
 *   proposed: { path: string | null, home: string | null },
 * }} KotlinMissingState

/**
 * The declaration's state.
 * @typedef {KotlinDeclaredState | KotlinImportedState | KotlinMissingState} KotlinDeclarationState

/**
 * The `/qa-sync` card item for a carrier declared nowhere.
 * @typedef {{
 *   annotation: string,
 *   path: string | null,
 *   package: string | null,
 *   needs: string[],
 *   edits: string[],
 *   message: string,
 * }} KotlinDeclarationItem

/**
 * A declaration item on the `/qa-sync` card: the item, and the number the card gives it.
 * @typedef {KotlinDeclarationItem & { n: number | string }} KotlinDeclarationCardItem

/**
 * The context the declaration is read in: the repository, its configuration, and the states read
 * so far.
 * @typedef {{
 *   repo: string,
 *   config: {
 *     annotationMap?: Record<string, string[]> | null,
 *     modulePaths?: readonly string[],
 *   },
 *   declarations?: Record<string, KotlinDeclarationState | undefined>,
 * }} KotlinDeclarationContext

/**
 * An answered declaration item, checked against the repository.
 * @typedef {{
 *   path: string,
 *   home: string,
 *   problem?: never,
 * }} KotlinDeclarationChecked

/**
 * A checked answer that cannot be declared where it names.
 * @typedef {{
 *   problem: { code: string, message: string },
 *   path?: never,
 *   home?: never,
 * }} KotlinDeclarationProblem

/**
 * What `check` answers.
 * @typedef {KotlinDeclarationChecked | KotlinDeclarationProblem} KotlinDeclarationCheck

/**
 * The card's wording of a declaration item: what the carrier is, what the card writes in it, the
 * item's open questions, and how the card joins words.
 * @typedef {{
 *   what: string,
 *   written: string,
 *   open: string[],
 *   list: (words: string[]) => string,
 * }} KotlinDeclarationWording

/**
 * A declaration item the card states, with the change that moves it.
 * @typedef {{
 *   line: string,
 *   change: string,
 *   ask?: never,
 *   open?: never,
 * }} KotlinDeclarationStated

/**
 * A declaration item the card asks about.
 * @typedef {{
 *   line: string,
 *   ask: { question: string, options: [string, string][] },
 *   open: string,
 *   change?: never,
 * }} KotlinDeclarationAsked

/**
 * A declaration item as the card words it.
 * @typedef {KotlinDeclarationStated | KotlinDeclarationAsked} KotlinDeclarationRendered

/**
 * The declaration of a Key carrier: where it is declared, its text, the card item it becomes, the
 * check of an answer, the card's wording of it, and its refusals.
 * @typedef {{
 *   state: (ctx: KotlinDeclarationContext, role?: "automation_key" | "automation_key_prefix") => KotlinDeclarationState,
 *   text: (home: string | null, name: string, role?: "automation_key" | "automation_key_prefix") => string,
 *   item: (name: string, state: KotlinMissingState) => KotlinDeclarationItem,
 *   check: (repo: string, item: { n: number | string, path?: unknown, package?: unknown }) => KotlinDeclarationCheck,
 *   render: (item: KotlinDeclarationCardItem, wording: KotlinDeclarationWording) => KotlinDeclarationRendered,
 *   label: (item: KotlinDeclarationItem) => string,
 *   unimported: (name: string) => string,
 *   refusals: {
 *     bad_path: (item: KotlinDeclarationItem) => { text: string, fields: string[] },
 *     bad_package: (item: KotlinDeclarationItem) => { text: string, fields: string[] },
 *   },
 *   snippet: { fence: string, anywhere: string },
 * }} KotlinDeclaration

/**
 * The adapter this stack reads its tests with (lib/stack.mjs).
 * @typedef {{
 *   extensions: string[],
 *   parse: (text: string, file?: string) => KotlinParsedFile,
 *   keys: (carriers: readonly KotlinAnnotation[], names: readonly string[]) => KotlinKey[],
 *   isTest: (fn: KotlinTestFunction) => boolean,
 *   parameterised: (fn: KotlinTestFunction) => boolean,
 *   disabled: (node: KotlinTestClass | KotlinTestFunction) => boolean,
 *   sep: string,
 *   ownTrackerKeyScopes: boolean,
 *   words: KotlinAdapterWords,
 *   guard: KotlinGuard,
 *   render: (text: string, ops: KotlinRenderOps, carrier: KotlinWriteCarrier) => KotlinRenderResult,
 *   carrierText: (name: string, value: string) => string,
 *   codegen: CodegenAdapter,
 *   needsDeclaration: boolean,
 *   declaration: KotlinDeclaration,
 * }} KotlinAdapter

/**
 * The tokens and assertion counter the shared test-code edit guards use: what a fix may never add,
 * and how many assertions a file holds.
 * @typedef {{
 *   never: readonly { id: string, pattern: RegExp }[],
 *   assertions: (text: string) => number,
 *   contracts: (text: string) => import("../fix-assertions.mjs").AssertionContract[],
 * }} KotlinGuard
 */

/**
 * The stack a project names: its language and its framework.
 * @typedef {{ language: string, framework: string }} KotlinStackDescriptor

/**
 * A note that an adapter cannot load here: what is missing, and how to fix it.
 * @typedef {{ reason: string, message: string, fix: string }} KotlinUnavailableNote

/**
 * The adapter a stack's entry loads.
 * @typedef {{
 *   adapter: KotlinAdapter,
 *   version?: string,
 *   unavailable?: never,
 * }} KotlinLoadedAdapter

/**
 * The note a stack's entry gives when it cannot load here.
 * @typedef {{
 *   unavailable: KotlinUnavailableNote,
 *   adapter?: never,
 *   version?: never,
 * }} KotlinUnavailableAdapter

/**
 * What a stack's entry loads: the adapter and the version it found, or the note that says why it
 * cannot.
 * @typedef {KotlinLoadedAdapter | KotlinUnavailableAdapter} KotlinAdapterLoad

/**
 * A stack's entry: whether it reads a project, and the adapter it loads.
 * @typedef {{
 *   fits: (stack: KotlinStackDescriptor) => boolean,
 *   load: (repo: string) => KotlinAdapterLoad,
 * }} KotlinStackEntry

// The stack's entry (lib/stack.mjs). The scan is hand-written, so it needs nothing from the
// repository and always loads.
/** @type {KotlinStackEntry} */
export const KOTLIN_JUNIT5 = {
  // Any framework naming JUnit 5 counts (e.g. `playwright-junit5`).
  fits: isKotlinJUnit5Stack,
  load: () => ({ adapter: KOTLIN }),
};

// The tokens a fix may never add, in the language this adapter reads. They are matched on added
// lines only, so an existing disable elsewhere in the file is not a new one.
/** @type {KotlinGuard} */
const GUARD = {
  contracts: kotlinAssertionContracts,
  never: [
    { id: "disable", pattern: /@(?:Disabled|Enabled)[A-Za-z]*\b|@Ignore\b/ },
    { id: "focus", pattern: /@Focus\b/ },
    { id: "assume", pattern: /\bassume(?:True|False|That)\s*\(|\bAssumptions\s*\./ },
    { id: "sleep", pattern: /\b(?:Thread\s*\.\s*sleep|sleep|delay)\s*\(/ },
    { id: "retry", pattern: /\bretry(?:Count|Times|When|Until)?\s*[:=(]/ },
    { id: "timeout", pattern: /@Timeout\b|\bwithTimeout\s*\(|\btimeout\s*[:=]/ },
  ],
  assertions: (text) => {
    let count = 0;
    for (const _ of text.matchAll(/\bassert(?:[A-Z]\w*)?\s*\(/g)) count++;
    for (const _ of text.matchAll(/\bfail\s*\(/g)) count++;
    for (const _ of text.matchAll(/\bverify\s*\(/g)) count++;
    for (const _ of text.matchAll(/\bshould(?:Be|Equal|Contain|Not|Throw|Match)\w*\b/g)) count++;
    return count;
  },
};

/** @type {KotlinAdapter} */
const KOTLIN = {
  extensions: [".kt"],
  parse,
  keys,
  isTest: (fn) => fn.carriers.some((a) => JUNIT_TESTS.has(last(a.name)) || a.name.split(".")[0] === "Test"),
  parameterised: (fn) => fn.carriers.some((a) => PARAMETERISED(a.name)),
  disabled: (node) => node.carriers.some((a) => last(a.name) === "Disabled"),
  sep: ".",
  // Only a class's tracker key scopes a test: one outside any class, or in classes no Scenario key
  // covers, is out of scope by design.
  ownTrackerKeyScopes: false,
  words: {
    source: "Kotlin source",
    testSuite: "Kotlin test suite",
    // One Key carrier in a sentence ("its annotation"), several, a class's, and the verb for writing
    // one on a test or class ("annotate it").
    carrier: "annotation",
    aCarrier: "an annotation",
    carriers: "annotations",
    classCarrier: "class annotation",
    keyCarrier: "key annotation",
    keyCarrierTitle: "Automation-key annotation",
    write: "annotate",
  },
  guard: GUARD,
  render,
  carrierText: (name, value) => `@${name}("${value}")`,
  codegen: codegenAdapter(),
  needsDeclaration: true,
  declaration: {
    state: declarationState,
    text: declarationText,
    item: declarationItem,
    check: checkDeclaration,
    render: renderDeclaration,
    label: (item) => `the declaration of \`annotation class ${item.annotation}\``,
    // The warning when keys are written in carrier `name` while nothing declares it.
    unimported: (name) => `nothing declares or imports \`${name}\`: the annotations are written without an import, and will not compile until it is declared`,
    // The `/qa-sync` refusals of an answered declaration item that `check` turned down, by its
    // `code`: the sentence, and the fields the suggested answer names.
    refusals: {
      bad_path: (item) => ({ text: `\`${item.path}\` is not a \`.kt\` path inside the repository. Answer with a path inside the repository ending in \`.kt\`, or drop it.`, fields: ["path"] }),
      bad_package: (item) => ({ text: `\`${item.package}\` is not a Kotlin package name. Answer with a package name, or drop it.`, fields: ["package"] }),
    },
    // `/qa-init`'s snippet of the declaration: its code fence, and where it goes when nothing shows.
    snippet: { fence: "kotlin", anywhere: "in a Kotlin file of your choosing" },
  },
};

// JUnit 5's test annotations. A custom `@Test.User(…)` family (nested in an annotation class
// named `Test`) marks a test too.
/** @type {Set<string>} */
const JUNIT_TESTS = new Set(["Test", "ParameterizedTest", "RepeatedTest", "TestFactory", "TestTemplate"]);
/**
 * @param {string} name
 * @returns {boolean}
 */
const PARAMETERISED = (name) => last(name) === "ParameterizedTest" || /Sources?$/.test(last(name));

/**
 * @param {string} name
 * @returns {string}
 */
const last = (name) => name.slice(name.lastIndexOf(".") + 1);

// The annotations among `carriers` whose name is one of `names` (written bare or qualified), as
// `[{key, line}]`. A key is a whole string argument, so `pattern` is not needed, and a malformed one
// is still read for the scan to report. A string argument may list several keys separated by
// commas (`@ID("DEMO-1, DEMO-2")`).
/**
 * @param {readonly KotlinAnnotation[]} carriers
 * @param {readonly string[]} names
 * @returns {KotlinKey[]}
 */
function keys(carriers, names) {
  /** @type {KotlinKey[]} */
  const out = [];
  for (const a of carriers) {
    if (!names.some((n) => a.name === n || a.name.endsWith(`.${n}`))) continue;
    for (const s of a.strings) for (const key of keysIn(s)) out.push({ key, line: a.line });
  }
  return out;
}

// parseKotlin's declarations, each with its annotations as its Key carriers.
/**
 * @param {string} text
 * @returns {KotlinParsedFile}
 */
function parse(text) {
  const { package: pkg, classes, functions } = parseKotlin(text);
  return {
    package: pkg,
    classes: classes.map(({ annotations, ...c }) => ({ ...c, carriers: annotations })),
    functions: functions.map(({ annotations, ...f }) => ({ ...f, carriers: annotations })),
  };
}

// --- code-evidence sample ---------------------------------------------------------------------

/**
 * The declarations a Kotlin sample resolves support against, by fully-qualified and by package name.
 * @typedef {{
 *   repo: string,
 *   modulePaths: readonly string[],
 *   common: string,
 *   byFqn: Map<string, string>,
 *   byPackage: Map<string, Map<string, string>>,
 * }} KotlinCodegenPrepared
 */

/** @type {Set<string>} */
const KOTLIN_HOOKS = new Set(["BeforeEach", "BeforeAll", "AfterEach", "AfterAll"]);

/** @returns {CodegenAdapter} */
function codegenAdapter() {
  return {
  prepare(repo, modulePaths) {
    /** @type {Map<string, string>} */
    const byFqn = new Map();
    /** @type {Map<string, Map<string, string>>} */
    const byPackage = new Map();
    for (const file of filesUnder(repo, modulePaths, (name) => name.endsWith(".kt"))) {
      let text;
      try {
        text = readFileSync(join(repo, file), "utf8");
      } catch {
        continue;
      }
      const pkg = packageOf(text);
      for (const cls of parseKotlin(text).classes) {
        byFqn.set(pkg ? `${pkg}.${cls.name}` : cls.name, file);
        if (!byPackage.has(pkg)) byPackage.set(pkg, new Map());
        /** @type {Map<string, string>} */ (byPackage.get(pkg)).set(cls.name, file);
      }
    }
    return { repo, modulePaths, common: commonRoot(modulePaths), byFqn, byPackage };
  },

  support(prepared, file, text) {
    const p = /** @type {KotlinCodegenPrepared} */ (prepared);
    const pkg = packageOf(text);
    /** @type {Map<string, string>} */
    const imported = new Map();
    for (const fqn of importsOf(text)) {
      const target = p.byFqn.get(fqn);
      if (target) imported.set(fqn.slice(fqn.lastIndexOf(".") + 1), target);
    }
    /** @type {Set<string>} */
    const out = new Set();
    /**
     * @param {string} name
     * @returns {void}
     */
    const resolve = (name) => {
      const simple = name.slice(name.lastIndexOf(".") + 1);
      const target = p.byFqn.get(name) ?? imported.get(simple) ?? p.byPackage.get(pkg)?.get(simple);
      if (target && target !== file) out.add(target);
    };
    for (const fqn of importsOf(text)) resolve(fqn);
    const clean = cleanedKotlin(text);
    for (const m of clean.matchAll(/\b(?:class|interface|object)\s+\w+[^{}]*?(?::\s*([^{}]+))?\s*\{/g)) {
      for (const name of m[1]?.matchAll(/\b([A-Z]\w*(?:\.[A-Z]\w*)?)/g) ?? []) resolve(name[1]);
    }
    for (const m of clean.matchAll(/@[\w.]+(?:\(([^)]*)\))?/g)) {
      for (const name of m[1]?.matchAll(/\b([A-Z]\w*)::class\b/g) ?? []) resolve(name[1]);
    }
    // Constructor calls: a known class or an imported one, never a Kotlin or JUnit API.
    for (const m of clean.matchAll(/\b([A-Z]\w*)\s*\(/g)) resolve(m[1]);
    return [...out];
  },

  runnerConfigs(prepared) {
    const p = /** @type {KotlinCodegenPrepared} */ (prepared);
    const names = ["build.gradle.kts", "build.gradle", "pom.xml"];
    /** @type {string[]} */
    const found = [];
    for (const dir of ancestors(p.common)) for (const name of names) {
      const rel = join(dir, name).replace(/^\.\//, "").split(sep).join("/");
      if (existsSync(join(p.repo, rel)) && !found.includes(rel)) found.push(rel);
    }
    return found;
  },

  shape(text) {
    return codegenShape(text);
  },
  };
}

// The directory shared by every module path (`app/src/test/kotlin` and `app/support` → `app`).
/**
 * @param {readonly string[]} paths
 * @returns {string}
 */
function commonRoot(paths) {
  let common = dirname((paths[0] ?? ".").replace(/\/+$/, ""));
  for (const p of paths.slice(1)) {
    while (common !== "." && p !== common && !p.startsWith(`${common}/`)) common = dirname(common);
  }
  return common === "" ? "." : common;
}

// `dir` and every directory above it up to the repository root.
/**
 * @param {string} dir
 * @returns {string[]}
 */
function ancestors(dir) {
  /** @type {string[]} */
  const out = [];
  for (let d = dir || "."; ; d = dirname(d)) {
    out.push(d || ".");
    if (!d || d === "." || d === "/") break;
  }
  return out;
}

/**
 * The Kotlin package a file declares, or "".
 * @param {string} text
 * @returns {string}
 */
function packageOf(text) {
  return /^\s*package\s+([\w.]+)/m.exec(cleanedKotlin(text))?.[1] ?? "";
}

/**
 * The fully-qualified names a file imports.
 * @param {string} text
 * @returns {string[]}
 */
function importsOf(text) {
  return [...cleanedKotlin(text).matchAll(/^\s*import\s+([\w.]+)/gm)].map((m) => m[1]);
}

// Kotlin with strings and comments blanked: enough to find declarations, annotations and calls
// without a page of prose or a brace in a string counting as code.
/**
 * @param {string} text
 * @returns {string}
 */
function cleanedKotlin(text) {
  return text
    .replace(/"""(?:[\s\S]*?)"""/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

/**
 * The parts of a Kotlin file a per-file cap keeps: package/imports and the class header, hooks, and
 * the first three tests. A function's annotations start its block.
 * @param {string} text
 * @returns {CodegenShape}
 */
function codegenShape(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const { functions } = parseKotlin(text);
  /** @type {{ line: number, end: number }[]} */
  const hooks = [];
  /** @type {{ line: number, end: number }[]} */
  const tests = [];
  for (const fn of functions) {
    const start = Math.min(fn.line, ...fn.annotations.map((a) => a.line));
    const end = blockEnd(lines, fn.line);
    if (fn.annotations.some((a) => KOTLIN_HOOKS.has(last(a.name)))) hooks.push({ line: start, end });
    if (fn.annotations.some((a) => JUNIT_TESTS.has(last(a.name)) || a.name.split(".")[0] === "Test")) tests.push({ line: start, end });
  }
  const first = Math.min(
    ...[...hooks, ...tests].map((e) => e.line).filter((n) => Number.isFinite(n)),
  );
  const header = Number.isFinite(first) && first > 1 ? /** @type {[number, number]} */ ([1, first - 1]) : null;
  return { imports: null, header, hooks: hooks.sort((a, b) => a.line - b.line), tests: tests.sort((a, b) => a.line - b.line) };
}

// The line closing the brace block a function opens, or the last line when it has none.
/**
 * @param {string[]} lines
 * @param {number} from
 * @returns {number}
 */
function blockEnd(lines, from) {
  let depth = 0;
  let started = false;
  let block = false;
  let raw = false;
  for (let i = Math.max(from - 1, 0); i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      if (block) {
        if (line[j] === "*" && line[j + 1] === "/") {
          block = false;
          j++;
        }
        continue;
      }
      if (raw) {
        if (line.startsWith('"""', j)) {
          raw = false;
          j += 2;
        }
        continue;
      }
      if (line.startsWith('"""', j)) {
        raw = true;
        j += 2;
      } else if (line[j] === '"' || line[j] === "'") {
        const quote = line[j];
        j++;
        while (j < line.length && line[j] !== quote) j += line[j] === "\\" ? 2 : 1;
      } else if (line[j] === "/" && line[j + 1] === "/") break;
      else if (line[j] === "/" && line[j + 1] === "*") {
        block = true;
        j++;
      } else if (line[j] === "{") {
        depth++;
        started = true;
      } else if (line[j] === "}") {
        depth--;
        if (started && depth === 0) return i + 1;
      }
    }
  }
  return lines.length;
}


// --- write side --------------------------------------------------------------------------------

// One Kotlin file with its keys written: a new `@Name("aut_…")` line above each Unkeyed function, a
// copied key swapped for a fresh one on its own annotation line, a Key prefix above its class, and
// the imports the annotations need. `home` is the package a carrier is declared in (null while
// nothing declares it, so nothing is imported). Every write is a byte-offset splice, verified by
// re-parsing the result.
/**
 * @param {string} text
 * @param {KotlinRenderOps} ops
 * @param {KotlinWriteCarrier} carrier
 * @returns {KotlinRenderResult}
 */
function render(text, { annotate, rekey, prefix }, { name, names, home, prefix: prefixCarrier }) {
  /** @type {KotlinWriteError[]} */
  const errors = [];
  // `stale`: the file no longer holds, where the card saw it, the test or class a write is for.
  // `unlanded`: it does, but a re-parse does not find the key on it.
  /**
   * @param {string} kind
   * @param {string} message
   */
  const fail = (kind, message) => errors.push({ kind, message });
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // A file that has any CRLF is written with CRLF throughout.
  if (eol === "\r\n") text = text.replace(/\r?\n/g, "\r\n");
  const lines = linesOf(text);
  const parsed = parseKotlin(text);
  /**
   * @param {KotlinFnRef} fn
   * @param {"function" | "class"} [kind]
   * @returns {KotlinClass | KotlinFunction | undefined}
   */
  const at = (fn, kind = "function") => kind === "class"
    ? parsed.classes.find((c) => c.line === fn.line && c.path === fn.path)
    : parsed.functions.find((f) => f.line === fn.line && f.name === fn.name && f.classPath === (fn.class ?? ""));
  /**
   * @param {KotlinClassRef} cls
   * @returns {boolean}
   */
  const hasClass = (cls) => parsed.classes.some((c) => c.line === cls.line && c.path === cls.path);

  // A rekey swaps the first whole `from` on its annotation's line, in turn: two on one line each
  // see the line as the one before left it. Each rewritten line is one edit.
  /** @type {Map<number, string>} */
  const rekeyed = new Map(); // line number → its text after the rekeys
  /** @type {Set<KotlinRekeyOp>} */
  const gone = new Set(); // the rekeys whose annotation the file no longer holds
  for (const op of rekey) {
    const { fn, from, handle } = op;
    const ann = at(fn, op.kind)?.annotations.find((a) => (op.names ?? names).some((n) => a.name === n || a.name.endsWith(`.${n}`)) && holds(a, from));
    if (!ann) {
      gone.add(op);
      fail("stale", `\`${fn.name}\` no longer carries \`${from}\` at line ${fn.line}`);
      continue;
    }
    const before = rekeyed.get(ann.line) ?? lines[ann.line - 1].text;
    rekeyed.set(ann.line, before.replace(new RegExp(`(?<![0-9A-Za-z_])${from}(?![0-9A-Za-z_])`), handle.key));
  }
  const edits = [...rekeyed].map(([n, after]) => ({ at: lines[n - 1].start, del: lines[n - 1].text.length, ins: after }));
  const inserts = [
    ...annotate.map(({ fn, handle }) => ({ line: fn.line, found: at(fn), missing: `no function \`${fn.name}\` at line ${fn.line}`, text: `@${name}("${handle.key}")` })),
    ...prefix.map(({ cls, prefix: p }) => ({ line: cls.line, found: hasClass(cls), missing: `no class \`${cls.path}\` at line ${cls.line}`, text: `@${prefixCarrier.name}("${p}")` })),
  ];
  // Bottom-up, as the errors are reported; on one line, the last insert lands on top.
  /** @type {SpliceEdit[]} */
  const above = [];
  for (const ins of inserts.sort((a, b) => b.line - a.line)) {
    if (!ins.found) {
      fail("stale", ins.missing);
      continue;
    }
    const line = lines[ins.line - 1];
    above.push({ at: line.start, del: 0, ins: `${/** @type {RegExpMatchArray} */ (line.text.match(/^\s*/))[0]}${ins.text}${eol}` });
  }
  // A new line above a rewritten one lands first: they share the line's offset.
  let out = splice(text, [...above.reverse(), ...edits]);
  if (home && annotate.length) out = addImport(out, `${home}.${name}`, home, eol);
  if (prefix.length && prefixCarrier.home) out = addImport(out, `${prefixCarrier.home}.${prefixCarrier.name}`, prefixCarrier.home, eol);

  // A key that did not land on a test or class the file no longer holds is stale like its write.
  const reparsed = parseKotlin(out);
  // A new annotation is written under `name`; a re-keyed one keeps whichever name it had.
  /** @type {(fn: KotlinFnRef, key: string, under: string[], kind?: "function" | "class") => boolean} */
  const carries = (fn, key, under, kind = "function") => (/** @type {KotlinReparsed[]} */ (kind === "class" ? reparsed.classes : reparsed.functions)).some((f) =>
    (kind === "class" ? f.path === fn.path : f.name === fn.name && f.classPath === (fn.class ?? ""))
    && f.annotations.some((a) => under.includes(last(a.name)) && holds(a, key)));
  for (const { fn, handle } of annotate) if (!carries(fn, handle.key, [name])) fail(at(fn) ? "unlanded" : "stale", `\`${handle.key}\` did not land on \`${fn.name}\``);
  for (const op of rekey) if (!carries(op.fn, op.handle.key, op.names ?? names, op.kind)) fail(gone.has(op) ? "stale" : "unlanded", `\`${op.handle.key}\` did not land on \`${op.fn.name}\``);
  for (const { cls, prefix: p } of prefix) {
    const landed = reparsed.classes.some((c) => c.path === cls.path && c.annotations.some((a) => last(a.name) === prefixCarrier.name && a.strings.includes(p)));
    if (!landed) fail(hasClass(cls) ? "unlanded" : "stale", `Key prefix \`${p}\` did not land on class \`${cls.path}\``);
  }
  return { text: out, errors };
}

// The keys one string argument holds: several may be listed, separated by commas.
/**
 * @param {string} s
 * @returns {string[]}
 */
const keysIn = (s) => s.split(",").map((p) => p.trim()).filter(Boolean);

// Whether annotation `a` carries `key` among its string arguments' keys.
/**
 * @param {KotlinAnnotation} a
 * @param {string} key
 * @returns {boolean}
 */
const holds = (a, key) => a.strings.some((s) => keysIn(s).includes(key));

// Each line of `text` as `{start, text}`: its offset, and its content without its line ending.
// Split as `/\r?\n/` splits, so a text ending in a line ending has a last, empty line.
/**
 * @param {string} text
 * @returns {{ start: number, text: string }[]}
 */
function linesOf(text) {
  /** @type {{ start: number, text: string }[]} */
  const out = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) {
      out.push({ start, text: text.slice(start) });
      return out;
    }
    out.push({ start, text: text.slice(start, text[nl - 1] === "\r" ? nl - 1 : nl) });
    start = nl + 1;
  }
}

// `text` with `import <fqn>` added, unless the file is in package `pkg`, or already imports it or
// all of `pkg`. It goes in sorted position among the imports, else after the `package` line (with a
// blank line), else first.
/**
 * @param {string} text
 * @param {string} fqn
 * @param {string} pkg
 * @param {string} eol
 * @returns {string}
 */
function addImport(text, fqn, pkg, eol) {
  const lines = linesOf(text);
  const filePkg = lines.map((l) => l.text.match(/^\s*package\s+([\w.]+)/)?.[1]).find(Boolean) ?? "";
  if (filePkg === pkg) return text;
  /** @type {{ i: number, name: string }[]} */
  const imports = [];
  lines.forEach((l, i) => {
    const m = l.text.match(/^import\s+([\w.*]+)/);
    if (m) imports.push({ i, name: m[1] });
  });
  if (imports.some((x) => x.name === fqn || x.name === `${pkg}.*`)) return text;
  // `content` as a line (or lines) of its own, before line `i`, or after the last line.
  /**
   * @param {number} i
   * @param {string} content
   * @returns {string}
   */
  const insert = (i, content) => splice(text, [i < lines.length ? { at: lines[i].start, del: 0, ins: `${content}${eol}` } : { at: text.length, del: 0, ins: `${eol}${content}` }]);
  const line = `import ${fqn}`;
  if (imports.length) {
    const after = imports.find((x) => x.name > fqn);
    return insert(after ? after.i : imports[imports.length - 1].i + 1, line);
  }
  const p = lines.findIndex((l) => /^\s*package\s/.test(l.text));
  return p === -1 ? insert(0, line) : insert(p + 1, `${eol}${line}`);
}

// --- the carrier's declaration -----------------------------------------------------------------

// Each role's `@Target`: the Automation-key annotation lands on a function, the Key-prefix one on
// a class (ADR-0013).
/** @type {Record<string, string>} */
const TARGETS = { automation_key: "FUNCTION", automation_key_prefix: "CLASS" };

// The `annotation class` declaring carrier `name` in package `home` (`<package>` while none is
// known), for `role`.
/**
 * @param {string | null} home
 * @param {string} name
 * @param {"automation_key" | "automation_key_prefix"} [role]
 * @returns {string}
 */
function declarationText(home, name, role = "automation_key") {
  return `package ${home ?? "<package>"}

@Target(AnnotationTarget.${TARGETS[role]})
@Retention(AnnotationRetention.RUNTIME)
annotation class ${name}(
    val value: String
)
`;
}

// Where `role`'s first carrier is declared, cached on `ctx` (`{repo, config}` at least):
//   {status: "declared", path, home}   a Kotlin source in the repository declares it
//   {status: "imported", home}         none does, but test code imports it by name (a library)
//   {status: "missing", proposed: {path, home}}   neither; `proposed` is the default home, each
//                                      field null when there is none
// `home` is the package.
/**
 * @param {KotlinDeclarationContext} ctx
 * @param {"automation_key" | "automation_key_prefix"} [role]
 * @returns {KotlinDeclarationState}
 */
function declarationState(ctx, role = "automation_key") {
  ctx.declarations ??= {};
  return (ctx.declarations[role] ??= findDeclaration(ctx, role));
}

/**
 * @param {KotlinDeclarationContext} ctx
 * @param {"automation_key" | "automation_key_prefix"} role
 * @returns {KotlinDeclarationState}
 */
function findDeclaration(ctx, role) {
  const [name] = carrierNames(ctx.config.annotationMap, role);
  const sources = /** @type {{ file: string, text: string }[]} */ (kotlinSources(ctx).map((file) => ({ file, text: read(join(ctx.repo, file)) })).filter((s) => s.text !== null));
  /** @type {(n: string) => RegExp} */
  const declares = (n) => new RegExp(`^[ \\t]*(?:[\\w@.()]+[ \\t]+)*annotation[ \\t]+class[ \\t]+${n}\\b`, "m");
  /** @type {(text: string) => string} */
  const packageOf = (text) => text.match(/^[ \t]*package[ \t]+([\w.]+)/m)?.[1] ?? "";
  const found = sources.find((s) => declares(name).test(s.text));
  if (found) return { status: "declared", path: found.file, home: packageOf(found.text) };
  for (const s of sources) {
    const m = s.text.match(new RegExp(`^[ \\t]*import[ \\t]+([\\w.]+)\\.${name}[ \\t]*$`, "m"));
    if (m) return { status: "imported", home: m[1] };
  }
  /** @type {(path: string) => string} */
  const dirOf = (path) => path.slice(0, path.lastIndexOf("/") + 1);
  // The default home: for the Key-prefix annotation (ADR-0013), beside the Automation-key
  // annotation's own declaration, when the code declares it (never merely imports it); otherwise,
  // and for the Automation-key annotation's own default, beside the tracker-key annotation's.
  // Reading the Automation-key annotation's already-declared state, never its own proposed
  // default, keeps this independent of any other card item's edits.
  /** @type {{ path: string | null, home: string | null }} */
  let proposed = { path: null, home: null };
  if (role === "automation_key_prefix") {
    const key = declarationState(ctx, "automation_key");
    if (key.status === "declared") proposed = { path: `${dirOf(key.path)}${name}.kt`, home: key.home || null };
  }
  if (proposed.path === null) {
    const beside = carrierNames(ctx.config.annotationMap, "tracker_key_fn")
      .map((n) => sources.find((s) => declares(n).test(s.text)))
      .find(Boolean);
    if (beside) proposed = { path: `${dirOf(beside.file)}${name}.kt`, home: packageOf(beside.text) || null };
  }
  return { status: "missing", proposed };
}

/**
 * @param {string} path
 * @returns {string | null}
 */
function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// Every Kotlin source of the repository under test: a declaration usually lives outside the test
// roots (`src/main`), so this is what git lists (tracked or not, never ignored). Outside a
// repository, only what the module paths hold.
/**
 * @param {KotlinDeclarationContext} ctx
 * @returns {string[]}
 */
function kotlinSources(ctx) {
  return listFiles(ctx.repo, "*.kt") ?? filesUnder(ctx.repo, /** @type {readonly string[]} */ (ctx.config.modulePaths), (n) => n.endsWith(".kt"));
}

// The `/qa-sync` card item (all but its `code`) for carrier `name`, declared nowhere: where it would
// go (`state`, from `declarationState`), and what the person must name for it.
/**
 * @param {string} name
 * @param {KotlinMissingState} state
 * @returns {KotlinDeclarationItem}
 */
function declarationItem(name, state) {
  const needs = /** @type {string[]} */ ([state.proposed.path ? null : "path", state.proposed.home ? null : "package"].filter(Boolean));
  return {
    annotation: name,
    path: state.proposed.path,
    package: state.proposed.home,
    needs,
    edits: ["path", "package"],
    message: state.proposed.path
      ? `declare \`annotation class ${name}\` in ${state.proposed.path}: the code declares no \`${name}\` annotation`
      : `declare \`annotation class ${name}\`: the code declares no \`${name}\` annotation; name its file and package`,
  };
}

// An answered declaration item (`{n, path, package}`) as `{path, home}`, `path` relative to the
// repository, or `{problem}` when it cannot be declared there.
/**
 * @param {string} repo
 * @param {{ n: number | string, path?: unknown, package?: unknown }} item
 * @returns {KotlinDeclarationCheck}
 */
function checkDeclaration(repo, { n, path, package: pkg }) {
  if (typeof path !== "string" || typeof pkg !== "string") return { problem: { code: "needs_edit", message: `name the declaration's \`path\` and \`package\` (edit item ${n})` } };
  const abs = resolve(repo, path);
  const rel = relative(repo, abs).split(sep).join("/");
  if (rel.startsWith("..") || !rel.endsWith(".kt")) return { problem: { code: "bad_path", message: `\`${path}\` is not a \`.kt\` path inside the repository` } };
  if (existsSync(abs)) return { problem: { code: "bad_path", message: `\`${path}\` already exists` } };
  if (!/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(pkg)) return { problem: { code: "bad_package", message: `\`${pkg}\` is not a Kotlin package name` } };
  return { path: rel, home: pkg };
}

// A declaration item on the `/qa-sync` card. `what` names the carrier ("the annotation that
// carries each Automation key"), `written` what the card writes in it ("the keys"), `open` the
// item's open questions, and `list` joins words as the card does.
/**
 * @param {KotlinDeclarationCardItem} item
 * @param {KotlinDeclarationWording} wording
 * @returns {KotlinDeclarationRendered}
 */
function renderDeclaration(item, { what, written, open, list }) {
  const why = `The code declares no \`annotation class ${item.annotation}\`, ${what}, so ${written} this card writes would not compile`;
  const example = `${item.n} path=<file>.kt package=<package>`;
  if (!open.length) {
    return {
      line: `${why}: declare it in \`${item.path}\`, package \`${item.package}\`.`,
      change: `To change it: \`${example}\` declares it there instead.`,
    };
  }
  /** @type {Record<string, string>} */
  const asked = { path: "which file", package: "which package" };
  const answer = `${item.n} ${open.map((f) => `${f}=${f === "path" ? "<file>.kt" : "<package>"}`).join(" ")}`;
  return {
    line: `${why}, and there is no declaration to put it beside.`,
    ask: {
      question: `In ${list(open.map((f) => asked[f]))} should \`annotation class ${item.annotation}\` be declared?`,
      options: [
        [answer, `creates that Kotlin file, in that package, declaring it.`],
        [`drop ${item.n}`, `writes ${written} without it; they do not compile until something declares it.`],
      ],
    },
    open: answer,
  };
}
