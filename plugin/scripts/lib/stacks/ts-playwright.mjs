// @ts-check
// The TypeScript Playwright Test stack adapter (lib/stack.mjs, ADR-0022, ADR-0023). A test has no
// annotations: its Key carriers are places in its own call, read and written with the parser of the
// repository's own `typescript`, loaded through `createRequire` anchored in the repository. With
// none installed the adapter is unavailable, and code binding is skipped: never a guessed parse.
//
// Carriers, as `annotation_map` names them:
//   tag                 each tag of the details object (`{ tag: '@x' }` or `{ tag: ['@x', …] }`),
//                       read without its `@`, and each `@word` of the title (read only)
//   annotation.<type>   the `description` of each `{ type, description }` in `annotation`
//   title               the title (read only: a key is never written in it, ADR-0022)
// A key is a token of a carrier's text that passes the role's key pattern, so a tracker URL in an
// `issue` annotation yields its key. A `describe` is a class; a test that no describe's key scopes
// (in none, or in describes no Scenario key covers) is claimable through its own tracker key, and a
// test no describe gives a Key prefix takes its file's header comment, `// qa-key-prefix: SAL`,
// among the line comments before the file's first statement.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { splice } from "./splice.mjs";
import { isTsPlaywrightStack } from "./descriptors.mjs";

/**
 * @import { SpliceEdit } from "./splice.mjs"
 * @import { CodegenAdapter, CodegenShape } from "../stack.mjs"
 */

/**
 * A node of the TypeScript syntax tree, as this adapter reads it: the compiler API's `ts.Node`.
 * @typedef {object} TsNode
 * @property {number} pos
 * @property {number} end
 * @property {(sourceFile?: unknown) => number} getStart
 * @property {(sourceFile?: unknown) => string} getText
 */

/**
 * A node with the text it carries: an identifier, a property name, a string literal.
 * @typedef {TsNode & { text: string }} TsTextual
 */

/**
 * An identifier: the name it is written with.
 * @typedef {TsTextual} TsIdentifier
 */

/**
 * An expression of the syntax tree.
 * @typedef {TsNode} TsExpression
 */

/**
 * A property access: `expression.name`.
 * @typedef {TsNode & { name: TsIdentifier, expression: TsExpression }} TsPropertyAccessExpression
 */

/**
 * A call: `expression(arguments)`.
 * @typedef {TsNode & { expression: TsExpression, arguments: TsExpression[] }} TsCallExpression
 */

/**
 * A string literal: its decoded text.
 * @typedef {TsTextual} TsStringLiteral
 */

/**
 * A template literal with no substitution: its text.
 * @typedef {TsTextual} TsNoSubstitutionTemplateLiteral
 */

/**
 * A template literal with substitutions.
 * @typedef {TsNode} TsTemplateExpression
 */

/**
 * A block of statements.
 * @typedef {TsNode & { statements: TsNode[] }} TsBlock
 */

/**
 * An arrow function.
 * @typedef {TsNode & { body: TsBlock }} TsArrowFunction
 */

/**
 * A function expression.
 * @typedef {TsNode & { body: TsBlock }} TsFunctionExpression
 */

/**
 * A property assignment: `name: initializer`.
 * @typedef {TsNode & { name: TsNode, initializer: TsExpression }} TsPropertyAssignment
 */

/**
 * An object literal: the properties it holds.
 * @typedef {TsNode & { properties: TsPropertyAssignment[] }} TsObjectLiteralExpression
 */

/**
 * An array literal: its elements.
 * @typedef {TsNode & { elements: TsExpression[] }} TsArrayLiteralExpression
 */

/**
 * A parsed file: its statements, and the line an offset falls on.
 * @typedef {{
 *   pos: number,
 *   end: number,
 *   getStart: (sourceFile?: unknown) => number,
 *   getText: (sourceFile?: unknown) => string,
 *   statements: TsNode[],
 *   getLineAndCharacterOfPosition: (pos: number) => { line: number, character: number },
 * }} TsSourceFile
 */

/**
 * A comment range: where it starts and ends, and its kind.
 * @typedef {{ pos: number, end: number, kind: number }} TsCommentRange

/**
 * The compiler API this adapter reads: the members of the repository's own `typescript` it uses.
 * @typedef {object} TsApi
 * @property {string} version
 * @property {(fileName: string, sourceText: string, languageVersion: number, setParentNodes: boolean, scriptKind?: number) => TsSourceFile} createSourceFile
 * @property {(text: string, pos: number) => TsCommentRange[] | undefined} getLeadingCommentRanges
 * @property {(node: TsNode, cbNode: (node: TsNode) => void) => void} forEachChild
 * @property {(node: TsNode) => node is TsIdentifier} isIdentifier
 * @property {(node: TsNode) => node is TsPropertyAccessExpression} isPropertyAccessExpression
 * @property {(node: TsNode) => node is TsStringLiteral} isStringLiteral
 * @property {(node: TsNode) => node is TsNoSubstitutionTemplateLiteral} isNoSubstitutionTemplateLiteral
 * @property {(node: TsNode) => node is TsTemplateExpression} isTemplateExpression
 * @property {(node: TsNode) => node is TsArrowFunction} isArrowFunction
 * @property {(node: TsNode) => node is TsFunctionExpression} isFunctionExpression
 * @property {(node: TsNode) => node is TsCallExpression} isCallExpression
 * @property {(node: TsNode) => boolean} isForStatement
 * @property {(node: TsNode) => boolean} isForOfStatement
 * @property {(node: TsNode) => boolean} isForInStatement
 * @property {(node: TsNode) => boolean} isWhileStatement
 * @property {(node: TsNode) => boolean} isDoStatement
 * @property {(node: TsNode) => node is TsPropertyAssignment} isPropertyAssignment
 * @property {(node: TsNode) => node is TsArrayLiteralExpression} isArrayLiteralExpression
 * @property {(node: TsNode) => node is TsObjectLiteralExpression} isObjectLiteralExpression
 * @property {{ TS: number, TSX: number, JS: number, JSX: number }} ScriptKind
 * @property {{ Latest: number }} ScriptTarget
 * @property {{ SingleLineCommentTrivia: number }} SyntaxKind
 */

/**
 * The compiler API the code sample uses: module resolution and tsconfig reading, on top of `TsApi`.
 * @typedef {TsApi & {
 *   isImportDeclaration: (node: TsNode) => node is TsNode & { moduleSpecifier?: TsStringLiteral },
 *   isExportDeclaration: (node: TsNode) => node is TsNode & { moduleSpecifier?: TsStringLiteral },
 *   resolveModuleName: (name: string, containingFile: string, options: Record<string, unknown>, host: {
 *     fileExists: (path: string) => boolean,
 *     readFile: (path: string) => string | undefined,
 *     directoryExists?: (path: string) => boolean,
 *     getCurrentDirectory?: () => string,
 *     getDirectories?: (path: string) => string[],
 *     realpath?: (path: string) => string,
 *     useCaseSensitiveFileNames?: boolean,
 *   }) => { resolvedModule?: { resolvedFileName: string } },
 *   sys: {
 *     fileExists: (path: string) => boolean,
 *     readFile: (path: string) => string | undefined,
 *     directoryExists?: (path: string) => boolean,
 *     getCurrentDirectory?: () => string,
 *     getDirectories?: (path: string) => string[],
 *     realpath?: (path: string) => string,
 *     useCaseSensitiveFileNames?: boolean,
 *   },
 *   readConfigFile: (path: string, read: (path: string) => string | undefined) => { config?: Record<string, unknown>, error?: unknown },
 *   parseJsonConfigFileContent: (json: Record<string, unknown>, host: unknown, basePath: string) => { options: Record<string, unknown>, errors: unknown[] },
 *   ModuleResolutionKind: { NodeJs: number },
 * }} TsCodegenApi
 */

/**
 * A Key carrier of a test: the name it is written under, the line it is written at, the strings it
 * holds, and the offsets of the literal it is written in (absent for one read from the title).
 * @typedef {{
 *   name: string,
 *   line: number,
 *   strings: string[],
 *   span?: { start: number, end: number },
 * }} TsCarrier

/**
 * A key a carrier holds, and the line it is written at.
 * @typedef {{ key: string, line: number }} TsKey

/**
 * A describe of a parsed file.
 * @typedef {{
 *   name: string,
 *   line: number,
 *   path: string,
 *   carriers: TsCarrier[],
 *   skipped: boolean,
 *   call: { start: number },
 * }} TsClass

/**
 * The scope a test call is found in: the classes above it, whether it is generated, and the file's
 * own scope. `skipped` is read from a scope and never written to one.
 * @typedef {{
 *   path: string[],
 *   cls: TsClass | null,
 *   generated: boolean,
 *   whole: { skipped: boolean },
 *   skipped?: boolean,
 * }} TsScope

/**
 * A test of a parsed file, as the scope it was found in.
 * @typedef {{
 *   name: string,
 *   line: number,
 *   classPath: string,
 *   carriers: TsCarrier[],
 *   skipped: boolean,
 *   scope: TsScope,
 *   generated: boolean,
 *   template: boolean,
 *   call: { start: number },
 * }} TsFunction

/**
 * A test of a parsed file, as the caller reads it.
 * @typedef {{
 *   name: string,
 *   line: number,
 *   classPath: string,
 *   carriers: TsCarrier[],
 *   skipped: boolean,
 *   generated: boolean,
 *   template: boolean,
 *   call: { start: number },
 * }} TsTest

/**
 * The file's Key prefixes, and the offset a new one goes at.
 * @typedef {{ keyPrefixes: TsKey[], at: number }} TsHeader

/**
 * A parsed file: its describes, its tests, and its header.
 * @typedef {{ classes: TsClass[], functions: TsTest[], header: TsHeader }} TsParsedFile

/**
 * A role's key test: a pattern, or a test of its own.
 * @typedef {RegExp | { test(s: string): boolean }} TsKeyPattern

/**
 * A function or a class a write is for, as the card saw it: a function by its name and its class,
 * a class by its path.
 * @typedef {{ line: number, name?: string, class?: string, path?: string }} TsFnRef

/**
 * A class a write is for, as the card saw it.
 * @typedef {{ line: number, path: string }} TsClassRef

/**
 * The key a write writes.
 * @typedef {{ key: string }} TsHandle

/**
 * The writes a card asks for on one file.
 * @typedef {{
 *   annotate: { fn: TsFnRef, handle: TsHandle }[],
 *   rekey: { fn: TsFnRef, from: string, handle: TsHandle, kind?: "function" | "class", names?: string[] }[],
 *   prefix: { cls: TsClassRef, prefix: string }[],
 *   header: { prefix: string }[],
 * }} TsRenderOps

/**
 * The Key carrier a write is written in, and the Key-prefix carrier beside it.
 * @typedef {{
 *   name: string,
 *   names: string[],
 *   home: string | null,
 *   prefix: { name: string, home: string | null },
 * }} TsWriteCarrier

/**
 * A write's error: `stale` when the file no longer holds what the card saw, any other kind the
 * adapter's own.
 * @typedef {{ kind: string, message: string }} TsWriteError

/**
 * One file with its keys written.
 * @typedef {{ text: string, errors: TsWriteError[] }} TsRenderResult

/**
 * The writes for one carrier: the edits, or the problem that stops them.
 * @typedef {{ edits: SpliceEdit[], problem?: never } | { problem: string, edits?: never }} TsCarrierEdit

/**
 * What the re-parse must find: the key on a test.
 * @typedef {{
 *   test: TsClass | TsTest,
 *   describe?: never,
 *   header?: never,
 *   key: string,
 *   under: string[],
 *   message: string,
 * }} TsLandingTest

/**
 * What the re-parse must find: the key on a describe.
 * @typedef {{
 *   describe: TsClass,
 *   test?: never,
 *   header?: never,
 *   key: string,
 *   under?: string[],
 *   message: string,
 * }} TsLandingDescribe

/**
 * What the re-parse must find: the Key prefix in the file's header.
 * @typedef {{
 *   header: true,
 *   test?: never,
 *   describe?: never,
 *   key: string,
 *   under?: never,
 *   message: string,
 * }} TsLandingHeader

/**
 * What the re-parse must find.
 * @typedef {TsLandingTest | TsLandingDescribe | TsLandingHeader} TsLanding

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
 * }} TsAdapterWords

/**
 * The adapter this stack reads its tests with (lib/stack.mjs).
 * @typedef {{
 *   extensions: string[],
 *   parse: (text: string, file?: string) => TsParsedFile,
 *   keys: (carriers: TsCarrier[], names: string[], pattern: TsKeyPattern | null) => TsKey[],
 *   isTest: (fn: TsTest) => boolean,
 *   parameterised: (fn: TsTest) => boolean,
 *   disabled: (node: TsClass | TsTest) => boolean,
 *   sep: string,
 *   ownTrackerKeyScopes: boolean,
 *   fileKeyPrefix: boolean,
 *   headerText: (prefix: string) => string,
 *   words: TsAdapterWords,
 *   guard: TsGuard,
 *   render: (text: string, ops: TsRenderOps, carrier: TsWriteCarrier, file?: string) => TsRenderResult,
 *   carrierText: (name: string, value: string) => string,
 *   codegen: CodegenAdapter,
 *   needsDeclaration: boolean,
 * }} TsAdapter

/**
 * The tokens and assertion counter the shared test-code edit guards use: what a fix may never add,
 * and how many assertions a file holds.
 * @typedef {{
 *   never: readonly { id: string, pattern: RegExp }[],
 *   assertions: (text: string) => number,
 *   contracts: (text: string) => import("../fix-assertions.mjs").AssertionContract[],
 * }} TsGuard
 */

/**
 * The stack a project names: its language and its framework.
 * @typedef {{ language: string, framework: string }} TsStackDescriptor

/**
 * A note that an adapter cannot load here: what is missing, and how to fix it.
 * @typedef {{ reason: string, message: string, fix: string }} TsUnavailableNote

/**
 * The adapter a stack's entry loads.
 * @typedef {{
 *   adapter: TsAdapter,
 *   version: string,
 *   unavailable?: never,
 * }} TsLoadedAdapter

/**
 * The note a stack's entry gives when it cannot load here.
 * @typedef {{
 *   unavailable: TsUnavailableNote,
 *   adapter?: never,
 *   version?: never,
 * }} TsUnavailableAdapter

/**
 * What a stack's entry loads: the adapter and the version it found, or the note that says why it
 * cannot.
 * @typedef {TsLoadedAdapter | TsUnavailableAdapter} TsAdapterLoad

/**
 * A stack's entry: whether it reads a project, and the adapter it loads.
 * @typedef {{
 *   fits: (stack: TsStackDescriptor) => boolean,
 *   load: (repo: string) => TsAdapterLoad,
 * }} TsStackEntry

// The stack's entry (lib/stack.mjs). Playwright Test in TypeScript or JavaScript; a framework that
// names JUnit belongs to the Kotlin stack, never this.
/** @type {TsStackEntry} */
export const TS_PLAYWRIGHT = {
  fits: isTsPlaywrightStack,
  load(repo) {
    /** @type {TsApi | null} */
    let ts;
    try {
      ts = /** @type {TsApi} */ (createRequire(join(repo, "package.json"))("typescript"));
    } catch {
      ts = null;
    }
    if (typeof ts?.createSourceFile !== "function") {
      return { unavailable: { reason: "no_typescript", message: "the repository has no `typescript` installed to read its tests with", fix: "install the project's dependencies" } };
    }
    return { adapter: adapterWith(ts), version: `typescript ${ts.version}` };
  },
};

// How a class path joins: Playwright's own separator, since a describe title holds dots and spaces.
/** @type {string} */
const SEP = " › ";

// The file header that carries a file's Key prefix (ADR-0022).
/** @type {RegExp} */
const HEADER = /^\/\/[ \t]*qa-key-prefix:[ \t]*(\S+)[ \t]*$/;
/**
 * @param {string} prefix
 * @returns {string}
 */
const headerText = (prefix) => `// qa-key-prefix: ${prefix}`;

// The tokens a fix may never add, in the language this adapter reads. They are matched on added
// lines only, so an existing skip elsewhere in the file is not a new one.
/** @type {Omit<TsGuard, "contracts">} */
const GUARD = {
  never: [
    { id: "disable", pattern: /\b(?:test|describe)(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\.\s*(?:skip|fixme)\b/ },
    { id: "focus", pattern: /\b(?:test|describe)(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\.\s*only\b/ },
    { id: "assume", pattern: /\bassume(?:True|False|That)?\s*\(/ },
    { id: "sleep", pattern: /\b(?:waitForTimeout|sleep|setTimeout)\s*\(/ },
    { id: "retry", pattern: /\bretry(?:Count|Times|When|Until)?\s*[:=(]/ },
    { id: "timeout", pattern: /\b(?:setDefaultTimeout|slow)\s*\(|\btimeout\s*:/ },
  ],
  assertions: (text) => {
    let count = 0;
    for (const _ of text.matchAll(/\bexpect(?:\s*\.\s*(?:soft|poll))?\s*\(/g)) count++;
    for (const _ of text.matchAll(/\bassert(?:\s*\.\s*[A-Za-z_$][\w$]*)?\s*\(/g)) count++;
    return count;
  },
};

/**
 * @param {TsApi} ts
 * @returns {TsAdapter}
 */
function adapterWith(ts) {
  /**
   * @param {string} text
   * @param {string} [file]
   * @returns {TsParsedFile}
   */
  const parse = (text, file) => parseWith(ts, text, file);
  return {
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    parse,
    keys,
    isTest: () => true, // `parse` lists test calls only
    parameterised: (fn) => fn.generated || fn.template,
    disabled: (node) => node.skipped,
    sep: SEP,
    // A Playwright project puts tracker keys on its tests (`annotation: {type: 'issue'}`, a title):
    // tests with no enclosing describe are normal, and so are keyed tests inside describes; its
    // own tracker key scopes a test no describe's key does (ADR-0022).
    ownTrackerKeyScopes: true,
    // A file's header comment carries the Key prefix of its tests that no describe gives one.
    fileKeyPrefix: true,
    headerText,
    words: {
      source: "TypeScript source",
      testSuite: "TypeScript test suite",
      carrier: "Key carrier",
      aCarrier: "a Key carrier",
      carriers: "Key carriers",
      classCarrier: "describe's Key carrier",
      keyCarrier: "Key carrier",
      keyCarrierTitle: "Automation key's Key carrier",
      write: "mark",
    },
    guard: { ...GUARD, contracts: (text) => assertionContracts(ts, text) },
    render: (text, ops, carrier, file) => render(ts, text, ops, carrier, file),
    carrierText,
    codegen: codegenWith(ts),
    needsDeclaration: false,
  };
}

// How the card shows `value` written in carrier `name`.
/**
 * @param {string} name
 * @param {string} value
 * @returns {string}
 */
function carrierText(name, value) {
  if (name.startsWith("annotation.")) return `{ annotation: { type: '${name.slice("annotation.".length)}', description: '${value}' } }`;
  return `{ ${name}: '@${value}' }`;
}

// --- code-evidence sample ---------------------------------------------------------------------

/** @type {Set<string>} */
const HOOKS = new Set(["beforeEach", "beforeAll", "afterEach", "afterAll"]);

/**
 * The repository state the sample resolves against: the tsconfig it reads and the roots it searches
 * for a runner config.
 * @typedef {{
 *   repo: string,
 *   modulePaths: readonly string[],
 *   common: string,
 *   options: Record<string, unknown>,
 * }} TsCodegenPrepared
 */

/**
 * @param {TsApi} ts
 * @returns {CodegenAdapter}
 */
function codegenWith(ts) {
  const cts = /** @type {TsCodegenApi} */ (ts);
  return {
    prepare(repo, modulePaths) {
      const common = commonRoot(modulePaths);
      const config = ancestors(common)
        .map((dir) => join(dir, "tsconfig.json").replace(/^\.\//, "").split(sep).join("/"))
        .find((p) => existsSync(join(repo, p)));
      let options = /** @type {Record<string, unknown>} */ ({});
      if (config) {
        const read = cts.readConfigFile(join(repo, config), cts.sys.readFile);
        if (read.config) options = cts.parseJsonConfigFileContent(read.config, cts.sys, dirname(join(repo, config))).options;
      }
      if (options.baseUrl === undefined) options.baseUrl = repo;
      if (options.moduleResolution === undefined) options.moduleResolution = cts.ModuleResolutionKind.NodeJs;
      return { repo, modulePaths, common, options };
    },

    support(prepared, file, text) {
      const p = /** @type {TsCodegenPrepared} */ (prepared);
      const sf = sourceFile(cts, text, file);
      /** @type {string[]} */
      const specifiers = [];
      cts.forEachChild(sf, (node) => {
        if ((cts.isImportDeclaration(node) || cts.isExportDeclaration(node)) && node.moduleSpecifier && typeof node.moduleSpecifier.text === "string") specifiers.push(node.moduleSpecifier.text);
      });
      /** @type {Set<string>} */
      const out = new Set();
      for (const specifier of specifiers) {
        const resolved = cts.resolveModuleName(specifier, join(p.repo, file), p.options, cts.sys).resolvedModule?.resolvedFileName;
        if (!resolved) continue;
        const rel = relative(p.repo, resolved).split(sep).join("/");
        if (!rel || rel === file || rel.startsWith("../") || isAbsolute(rel)) continue;
        if (!inside(rel, p.modulePaths) || !cts.sys.fileExists(join(p.repo, rel))) continue;
        out.add(rel);
      }
      return [...out];
    },

    runnerConfigs(prepared) {
      const p = /** @type {TsCodegenPrepared} */ (prepared);
      const names = ["playwright.config.ts", "playwright.config.js", "playwright.config.mjs", "playwright.config.cjs"];
      /** @type {string[]} */
      const found = [];
      for (const dir of ancestors(p.common)) for (const name of names) {
        const rel = join(dir, name).replace(/^\.\//, "").split(sep).join("/");
        if (existsSync(join(p.repo, rel)) && !found.includes(rel)) found.push(rel);
      }
      return found;
    },

    shape(text, file) {
      return codegenShape(cts, text, file);
    },
  };
}

// The directory shared by every module path (`web/tests` and `web/fixtures` → `web`).
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
 * @param {string} path
 * @param {readonly string[]} roots
 * @returns {boolean}
 */
const inside = (path, roots) => roots.some((root) => path === root || path.startsWith(`${root.replace(/\/+$/, "")}/`));

// The parts of a file a per-file cap keeps: its imports, the next class or describe header, its
// hooks, and its first three tests. The sampler assembles those ranges and cuts them to the cap.
/**
 * @param {TsCodegenApi} ts
 * @param {string} text
 * @param {string} file
 * @returns {CodegenShape}
 */
function codegenShape(ts, text, file) {
  const sf = sourceFile(ts, text, file);
  /** @param {number} pos */
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  let imports = /** @type {[number, number] | null} */ (null);
  /** @type {{ line: number, end: number }[]} */
  const hooks = [];
  /** @type {{ line: number, end: number }[]} */
  const tests = [];
  /**
   * @param {TsNode} node
   * @returns {void}
   */
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const range = /** @type {[number, number]} */ ([imports?.[0] ?? lineOf(node.getStart(sf)), lineOf(node.end - 1)]);
      imports = range;
    }
    if (ts.isCallExpression(node)) {
      const c = callee(ts, node.expression);
      const first = c ? (c.root === "test" ? c.chain[0] : c.chain.length === 0 ? c.root : undefined) : undefined;
      if (c && first !== undefined && HOOKS.has(first)) hooks.push({ line: lineOf(node.getStart(sf)), end: lineOf(node.end - 1) });
      else if (c?.root === "test" && first !== "describe" && node.arguments.length >= 2 && node.arguments.some((a) => isFunction(ts, a))) {
        tests.push({ line: lineOf(node.getStart(sf)), end: lineOf(node.end - 1) });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  /** @param {{ line: number }[]} list */
  const start = (list) => (list.length ? Math.min(...list.map((e) => e.line)) : Infinity);
  const first = Math.min(start(hooks), start(tests));
  const headerEnd = Number.isFinite(first) && first > 1 ? first - 1 : null;
  const header = headerEnd === null ? null : /** @type {[number, number]} */ ([1, Math.max(headerEnd, imports?.[1] ?? 1)]);
  return { imports, header, hooks: hooks.sort((a, b) => a.line - b.line), tests: tests.sort((a, b) => a.line - b.line) };
}


// --- read side ---------------------------------------------------------------------------------

/** @type {Set<string>} */
const DISABLING = new Set(["skip", "fixme"]);
/** @type {Set<string>} */
const VARIANTS = new Set(["only", "skip", "fixme", "fail"]);

// `test.describe.serial.skip` → {root: "test", chain: ["describe", "serial", "skip"]}, or null.
/**
 * @param {TsApi} ts
 * @param {TsExpression} expr
 * @returns {{ root: string, chain: string[] } | null}
 */
function callee(ts, expr) {
  /** @type {string[]} */
  const chain = [];
  while (ts.isPropertyAccessExpression(expr)) {
    chain.unshift(expr.name.text);
    expr = expr.expression;
  }
  return ts.isIdentifier(expr) ? { root: expr.text, chain } : null;
}

// A string literal's value, or a template literal's raw text with each `${…}` kept, and whether it
// has substitutions.
/**
 * @param {TsApi} ts
 * @param {TsNode | undefined} node
 * @param {TsSourceFile} sf
 * @returns {{ text: string, template: boolean } | null}
 */
function literal(ts, node, sf) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text, template: false };
  if (ts.isTemplateExpression(node)) return { text: node.getText(sf).slice(1, -1), template: true };
  return null;
}

/**
 * @param {TsApi} ts
 * @param {TsNode} n
 * @returns {n is TsArrowFunction | TsFunctionExpression}
 */
const isFunction = (ts, n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n);

// `{classes, functions, header}` of one file (lib/stack.mjs `parse`):
//   classes    [{name, line, path, carriers, skipped, call}]    one per titled describe
//   functions  [{name, line, classPath, carriers, skipped, generated, template, call}]
//   header     {keyPrefixes: [{key, line}], at}   the `// qa-key-prefix:` lines among the comments
//              before the first statement, and the offset a new one goes at
// A carrier is `{name, line, strings, span?}`: `span` the offsets of the literal it is written in,
// absent for one read from the title. `call` is the call's `{start}` offset. A test is generated
// when a loop or a `forEach`/`map` callback defines it, and skipped when it or an enclosing describe
// is `skip`/`fixme`, or a bare `test.skip()` disables its scope; a conditional
// `test.skip(condition, …)` skips only sometimes, so it disables nothing.
/**
 * @param {TsApi} ts
 * @param {string} text
 * @param {string} [file]
 * @returns {TsParsedFile}
 */
function parseWith(ts, text, file = "x.ts") {
  const sf = sourceFile(ts, text, file);
  /** @type {(pos: number) => number} */
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  /** @type {TsClass[]} */
  const classes = [];
  /** @type {TsFunction[]} */
  const functions = [];

  /** @type {(call: TsCallExpression, titleNode: TsExpression) => TsCarrier[]} */
  const carriers = (call, titleNode) => {
    /** @type {TsCarrier[]} */
    const out = [];
    const title = literal(ts, titleNode, sf);
    if (title) {
      const line = lineOf(titleNode.getStart(sf));
      out.push({ name: "title", line, strings: [title.text] });
      for (const m of title.text.matchAll(/(?:^|\s)@([\w-]+)/g)) out.push({ name: "tag", line, strings: [m[1]] });
    }
    const details = detailsOf(ts, call);
    for (const p of details?.properties ?? []) {
      if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
      const items = ts.isArrayLiteralExpression(p.initializer) ? p.initializer.elements : [p.initializer];
      if (p.name.text === "tag") {
        for (const e of items) {
          const s = literal(ts, e, sf);
          if (s) out.push({ name: "tag", line: lineOf(e.getStart(sf)), strings: [s.text.replace(/^@/, "")], span: { start: e.getStart(sf), end: e.end } });
        }
      }
      if (p.name.text === "annotation") {
        for (const e of items) {
          if (!ts.isObjectLiteralExpression(e)) continue;
          /** @type {(k: string) => TsExpression | undefined} */
          const get = (k) => e.properties.find((q) => ts.isPropertyAssignment(q) && q.name.getText(sf) === k)?.initializer;
          const type = literal(ts, get("type"), sf)?.text;
          const desc = get("description");
          const d = literal(ts, desc, sf);
          if (type) out.push({ name: `annotation.${type}`, line: lineOf(e.getStart(sf)), strings: d ? [d.text] : [], ...(d && { span: { start: /** @type {TsExpression} */ (desc).getStart(sf), end: /** @type {TsExpression} */ (desc).end } }) });
        }
      }
    }
    return out;
  };

  // Walks what defines tests: describe callbacks, loops, blocks and helpers; never a test or hook body.
  /** @type {(node: TsNode, scope: TsScope) => void} */
  const visit = (node, scope) => {
    if (ts.isCallExpression(node)) {
      const c = callee(ts, node.expression);
      if (c?.root === "test") return testCall(node, c, scope);
    }
    let inner = scope;
    if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) inner = { ...scope, generated: true };
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["forEach", "map", "flatMap"].includes(node.expression.name.text)) inner = { ...scope, generated: true };
    ts.forEachChild(node, (n) => visit(n, inner));
  };

  /** @type {(call: TsCallExpression, callee: { chain: string[] }, scope: TsScope) => void} */
  const testCall = (call, { chain }, scope) => {
    const [first, ...rest] = chain;
    const titleNode = call.arguments[0];
    const title = literal(ts, titleNode, sf);
    const body = call.arguments.find((a) => isFunction(ts, a));
    if (first === "describe") {
      if (rest.includes("configure")) return;
      if (!title) {
        // An untitled describe groups nothing a key can name: its tests belong to the scope.
        if (body) ts.forEachChild(body.body, (n) => visit(n, scope));
        return;
      }
      const cls = {
        name: title.text,
        line: lineOf(call.getStart(sf)),
        path: [...scope.path, title.text].join(SEP),
        carriers: carriers(call, titleNode),
        skipped: scope.skipped || rest.some((m) => DISABLING.has(m)),
        call: { start: call.getStart(sf) },
      };
      classes.push(cls);
      if (body) ts.forEachChild(body.body, (n) => visit(n, { ...scope, path: [...scope.path, title.text], cls }));
      return;
    }
    if (DISABLING.has(first) && !(title && body)) {
      // `test.skip()` disables its scope; `test.skip(condition, reason)` only sometimes.
      if (call.arguments.length === 0) {
        if (scope.cls) scope.cls.skipped = true;
        else scope.whole.skipped = true;
      }
      return;
    }
    if (first !== undefined && !VARIANTS.has(first)) return; // hooks, `test.step`, `test.use`, …
    if (!title || !body) return;
    functions.push({
      name: title.text,
      line: lineOf(call.getStart(sf)),
      classPath: scope.path.join(SEP),
      carriers: carriers(call, titleNode),
      skipped: DISABLING.has(first),
      scope,
      generated: scope.generated,
      template: title.template,
      call: { start: call.getStart(sf) },
    });
  };

  /** @type {{ skipped: boolean }} */
  const whole = { skipped: false }; // the file, as a scope
  ts.forEachChild(sf, (n) => visit(n, { path: [], cls: null, generated: false, whole }));
  // A describe or file skipped by a bare `test.skip()` after its tests skips them too.
  const fns = functions.map(({ scope, ...f }) => ({ ...f, skipped: f.skipped || whole.skipped || Boolean(scope.cls?.skipped) }));
  return { classes, functions: fns, header: headerOf(ts, sf, text, lineOf) };
}

// The parsed file, read as its extension says (`.tsx` and `.jsx` hold JSX).
/**
 * @param {TsApi} ts
 * @param {string} text
 * @param {string} file
 * @returns {TsSourceFile}
 */
function sourceFile(ts, text, file) {
  /** @type {Record<string, number | undefined>} */
  const kinds = { tsx: ts.ScriptKind.TSX, jsx: ts.ScriptKind.JSX, js: ts.ScriptKind.JS, mjs: ts.ScriptKind.JS, cjs: ts.ScriptKind.JS };
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kinds[file.slice(file.lastIndexOf(".") + 1)] ?? ts.ScriptKind.TS);
}

// The details object of a `test`/`describe` call: its object-literal argument after the title.
/**
 * @param {TsApi} ts
 * @param {TsCallExpression} call
 * @returns {TsObjectLiteralExpression | null}
 */
function detailsOf(ts, call) {
  return call.arguments.slice(1).find((a) => ts.isObjectLiteralExpression(a)) ?? null;
}

/**
 * @param {TsApi} ts
 * @param {TsSourceFile} sf
 * @param {string} text
 * @param {(pos: number) => number} lineOf
 * @returns {TsHeader}
 */
function headerOf(ts, sf, text, lineOf) {
  const first = sf.statements[0];
  /** @type {TsKey[]} */
  const keyPrefixes = [];
  if (!first) return { keyPrefixes, at: text.length };
  for (const r of ts.getLeadingCommentRanges(text, first.pos) ?? []) {
    if (r.kind !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
    const m = HEADER.exec(text.slice(r.pos, r.end));
    if (m) keyPrefixes.push({ key: m[1], line: lineOf(r.pos) });
  }
  return { keyPrefixes, at: first.getStart(sf) };
}

// The keys the carriers named `names` hold, as `[{key, line}]`: each token of their text that
// passes the role's `pattern`. With no pattern, only a value that is one whole token counts, so free
// text is never read as a key.
/**
 * @param {readonly TsCarrier[]} carriers
 * @param {readonly string[]} names
 * @param {TsKeyPattern | null} pattern
 * @returns {TsKey[]}
 */
function keys(carriers, names, pattern) {
  /** @type {TsKey[]} */
  const out = [];
  for (const c of carriers) {
    if (!names.includes(c.name)) continue;
    for (const s of c.strings) {
      if (pattern) {
        for (const m of s.matchAll(TOKEN)) if (pattern.test(m[0])) out.push({ key: m[0], line: c.line });
      } else if (/^[0-9A-Za-z_-]+$/.test(s.trim())) out.push({ key: s.trim(), line: c.line });
    }
  }
  return out;
}

/** @type {RegExp} */
const TOKEN = /[0-9A-Za-z_-]+/g;
/**
 * @param {string} k
 * @returns {RegExp}
 */
const token = (k) => new RegExp(`(?<![0-9A-Za-z_-])${k}(?![0-9A-Za-z_-])`);

// --- write side --------------------------------------------------------------------------------

// One file with its keys written (lib/stack.mjs `render`): a new key in the test's `carrier.name`
// carrier, a copied key swapped in place, a Key prefix in its describe's `carrier.prefix.name`
// carrier, and a file's Key prefix as its header comment (`header: [{prefix}]`). Each is a
// byte-offset splice of the original text; the result is re-parsed, and each test, describe and
// header is found again by its offset, moved by the edits before it.
/**
 * @param {TsApi} ts
 * @param {string} text
 * @param {TsRenderOps} ops
 * @param {TsWriteCarrier} carrier
 * @param {string} [file]
 * @returns {TsRenderResult}
 */
function render(ts, text, { annotate, rekey, prefix, header = [] }, { name, names, prefix: prefixCarrier }, file = "x.ts") {
  /** @type {TsWriteError[]} */
  const errors = [];
  /**
   * @param {string} kind
   * @param {string} message
   */
  const fail = (kind, message) => errors.push({ kind, message });
  /** @type {(t: string) => TsParsedFile} */
  const parse = (t) => parseWith(ts, t, file);
  const parsed = parse(text);
  const sf = sourceFile(ts, text, file);
  /** @type {Map<number, TsCallExpression>} */
  const calls = new Map();
  /** @type {(n: TsNode) => void} */
  const collect = (n) => {
    if (ts.isCallExpression(n)) calls.set(n.getStart(sf), n);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  /**
   * @param {TsFnRef} fn
   * @param {"function" | "class"} [kind]
   * @returns {TsClass | TsTest | undefined}
   */
  const at = (fn, kind = "function") => kind === "class"
    ? parsed.classes.find((c) => c.line === fn.line && c.path === fn.path)
    : parsed.functions.find((f) => f.line === fn.line && f.name === fn.name && f.classPath === (fn.class ?? ""));
  /** @type {SpliceEdit[]} */
  const edits = [];
  /** @type {TsLanding[]} */
  const landing = []; // what the re-parse must find: {find(reparsed, shift), message}

  for (const { fn, handle } of annotate) {
    const f = at(fn);
    if (!f) {
      fail("stale", `no test \`${fn.name}\` at line ${fn.line}`);
      continue;
    }
    const edit = carrierEdit(ts, sf, calls.get(f.call.start), name, handle.key);
    if (edit.problem) {
      fail("carrier", edit.problem);
      continue;
    }
    edits.push(.../** @type {SpliceEdit[]} */ (edit.edits));
    landing.push({ test: f, key: handle.key, under: [name], message: `\`${handle.key}\` did not land on \`${fn.name}\`` });
  }
  for (const { fn, from, handle, kind, names: carrierNames = names } of rekey) {
    const f = at(fn, kind);
    const c = f?.carriers.find((x) => carrierNames.includes(x.name) && x.strings.some((s) => token(from).test(s)));
    if (!c) {
      fail("stale", `\`${fn.name}\` no longer carries \`${from}\` at line ${fn.line}`);
      continue;
    }
    if (!c.span) {
      fail("carrier", `\`${fn.name}\` carries \`${from}\` in its title, which is never rewritten`);
      continue;
    }
    const m = token(from).exec(text.slice(c.span.start, c.span.end));
    if (!m) {
      // The read side matches the literal's decoded text, so a key written with a string escape
      // matches there but not in the raw span, and is not rewritten.
      fail("carrier", `\`${fn.name}\` carries \`${from}\` written with a string escape, which is never rewritten`);
      continue;
    }
    edits.push({ at: c.span.start + m.index, del: from.length, ins: handle.key });
    landing.push({ ...(kind === "class" ? { describe: /** @type {TsClass} */ (f) } : { test: /** @type {TsClass | TsTest} */ (f) }), key: handle.key, under: carrierNames, message: `\`${handle.key}\` did not land on \`${fn.name}\`` });
  }
  for (const { cls, prefix: p } of prefix) {
    const c = parsed.classes.find((x) => x.line === cls.line && x.path === cls.path);
    if (!c) {
      fail("stale", `no describe \`${cls.path}\` at line ${cls.line}`);
      continue;
    }
    const edit = carrierEdit(ts, sf, calls.get(c.call.start), prefixCarrier.name, p);
    if (edit.problem) {
      fail("carrier", edit.problem);
      continue;
    }
    edits.push(.../** @type {SpliceEdit[]} */ (edit.edits));
    landing.push({ describe: c, key: p, message: `Key prefix \`${p}\` did not land on describe \`${cls.path}\`` });
  }
  for (const { prefix: p } of header) {
    if (parsed.header.keyPrefixes.length) {
      fail("stale", `the file carries Key prefix \`${parsed.header.keyPrefixes[0].key}\` already`);
      continue;
    }
    const lineStart = text.lastIndexOf("\n", parsed.header.at - 1) + 1;
    edits.push({ at: lineStart, del: 0, ins: `${headerText(p)}${eol}` });
    landing.push({ header: true, key: p, message: `Key prefix \`${p}\` did not land in the file's header` });
  }

  /** @type {string} */
  let out;
  try {
    out = splice(text, edits);
  } catch {
    return { text, errors: [...errors, { kind: "carrier", message: "two writes to one test call overlap" }] };
  }
  // An offset of the original text in `out`: moved by every edit before it, and by an insert at it.
  /** @type {(offset: number) => number} */
  const shift = (offset) => offset + edits.filter((e) => e.at < offset || (e.at === offset && e.del === 0)).reduce((n, e) => n + e.ins.length - e.del, 0);
  const re = parse(out);
  /** @type {(node: TsClass | TsTest, under: string[], key: string) => boolean} */
  const holds = (node, under, key) => keys(node.carriers, under, { test: (t) => t === key }).length > 0;
  for (const l of landing) {
    let ok;
    if (l.header) ok = re.header.keyPrefixes.some((k) => k.key === l.key);
    else if (l.describe) ok = re.classes.some((c) => c.call.start === shift(l.describe.call.start) && holds(c, l.under ?? [prefixCarrier.name], l.key));
    else ok = re.functions.some((f) => f.call.start === shift(l.test.call.start) && holds(f, l.under, l.key));
    if (!ok) fail("unlanded", l.message);
  }
  return { text: out, errors };
}

// The splices that write `value` into carrier `carrier` of `call`, as `{edits}`, or `{problem}` for
// a carrier no key is written in. The file's own quote style is kept.
/**
 * @param {TsApi} ts
 * @param {TsSourceFile} sf
 * @param {TsCallExpression | undefined} call
 * @param {string} carrier
 * @param {string} value
 * @returns {TsCarrierEdit}
 */
function carrierEdit(ts, sf, call, carrier, value) {
  if (carrier !== "tag" && !carrier.startsWith("annotation.")) return { problem: `a test's \`${carrier}\` is never written: keys are written in \`tag\` or an \`annotation.<type>\`` };
  const [title] = /** @type {TsCallExpression} */ (call).arguments;
  const details = detailsOf(ts, /** @type {TsCallExpression} */ (call));
  const first = title.getText(sf)[0];
  const q = first === "\"" ? "\"" : "'";
  const prop = carrier === "tag" ? { key: "tag", value: `${q}@${value}${q}` } : { key: "annotation", value: `{ type: ${q}${carrier.slice("annotation.".length)}${q}, description: ${q}${value}${q} }` };
  if (!details) return { edits: [{ at: title.end, del: 0, ins: `, { ${prop.key}: ${prop.value} }` }] };
  const existing = details.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === prop.key);
  if (!existing) {
    if (!details.properties.length) return { edits: [{ at: details.getStart(sf), del: details.end - details.getStart(sf), ins: `{ ${prop.key}: ${prop.value} }` }] };
    return { edits: [{ at: details.getStart(sf) + 1, del: 0, ins: ` ${prop.key}: ${prop.value},` }] };
  }
  const init = existing.initializer;
  if (ts.isArrayLiteralExpression(init)) {
    const last = init.elements[init.elements.length - 1];
    return { edits: [last ? { at: last.end, del: 0, ins: `, ${prop.value}` } : { at: init.getStart(sf) + 1, del: 0, ins: prop.value }] };
  }
  return { edits: [{ at: init.getStart(sf), del: init.end - init.getStart(sf), ins: `[${init.getText(sf)}, ${prop.value}]` }] };
}

// Only complete expect(...).matcher(...) calls are outcome contracts; AST walking ignores comments
// and handles multiline expressions. The matcher chain includes negation and soft/poll modes.
/** @param {TsApi} ts @param {string} text @returns {import("../fix-assertions.mjs").AssertionContract[]} */
function assertionContracts(ts, text) {
  const sf = sourceFile(ts, text, "assertions.ts");
  /** @type {import("../fix-assertions.mjs").AssertionContract[]} */
  const checks = [];
  /** @param {TsNode} node @returns {void} */
  function visit(node) {
    if (ts.isCallExpression(node)) {
      /** @type {string[]} */
      const literals = [];
      const expected = (/** @type {TsExpression[]} */ args) => args.map(arg => {
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) { literals.push(arg.text); return '$literal'; }
        if (/^(?:[+-]?\d+(?:\.\d+)?|true|false|null)$/.test(arg.getText(sf))) { literals.push(arg.getText(sf)); return '$literal'; }
        return arg.getText(sf).replace(/\s+/g, '');
      }).join(',');
      const direct = callee(ts, node.expression);
      // The actual operand is the expected one: the check compares a value with itself.
      // Whitespace is dropped outside string literals only, so `f("a b")` and `f("ab")` stay apart.
      const text = (/** @type {TsExpression} */ arg) => arg.getText(sf).replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\s+/g, (_, literal) => literal ?? '');
      if (direct?.root === 'assert') checks.push({ matcher: ['assert', ...direct.chain].join('.'), expected: expected(node.arguments), literals, constant: false, same: node.arguments.length >= 2 && text(node.arguments[0]) === text(node.arguments[1]) });
      if (ts.isPropertyAccessExpression(node.expression)) {
        let root = node.expression.expression;
        const chain = [node.expression.name.text];
        while (ts.isPropertyAccessExpression(root)) { chain.unshift(root.name.text); root = root.expression; }
        if (ts.isCallExpression(root) && /^expect(?:\.(?:soft|poll))?$/.test(root.expression.getText(sf))) {
          checks.push({ matcher: root.expression.getText(sf) + '.' + chain.join('.'), expected: expected(node.arguments), literals, constant: /^(?:true|false|null|[+-]?\d+|["'`])/.test(root.arguments[0]?.getText(sf) ?? ''), same: root.arguments.length > 0 && node.arguments.length > 0 && text(root.arguments[0]) === text(node.arguments[0]) });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return checks;
}
