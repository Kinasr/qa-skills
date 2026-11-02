// @ts-check
// The stack-adapter seam (ADR-0005, ADR-0022): everything `scan`, `/qa-sync` and `/qa-init`
// know about one test stack's language and framework sits behind one adapter in lib/stacks/. No
// module outside lib/stacks/ names a language, a framework, a file extension or a declaration
// syntax, and engineer text names the stack's code and its Key carriers only in the adapter's
// `words` (or, for a stack no adapter reads, lib/stacks/no-adapter.mjs's). What stays outside is
// the `annotation_map` setting's own vocabulary, which names that `project.md` field. A third stack
// is one more module in lib/stacks/ and one entry here.
//
// An adapter is an object with these members.
//
// Read side (lib/code-index.mjs, lib/scan-code.mjs):
//   extensions            the file name endings it reads
//   parse(text, file)     {classes, functions} of one file:
//                           classes    [{name, line, path, carriers}]       `path` joins the
//                                                                          enclosing chain with `sep`
//                           functions  [{name, line, classPath, carriers}]  `classPath` likewise, ""
//                                                                          for a test in no class
//                         `carriers` is the adapter's own list of Key carriers; only the adapter's
//                         other members read it.
//   keys(carriers, names, pattern)   [{key, line}]: the keys the carriers named `names` hold.
//                         `pattern` is the role's key test (a RegExp, or `{test}`), or null: a
//                         free-text carrier holds a key only as a token that passes it, so the
//                         adapter may use it; one whose carrier holds whole keys may ignore it
//   isTest(fn)            whether a parsed function is a test
//   parameterised(fn)     one source test that runs many times
//   disabled(node)        a function or class that is skipped
//   sep                   how a class path joins, e.g. "."
//   ownTrackerKeyScopes   whether a test's own tracker key brings it into scope when no enclosing
//                         class's key does: in no class, or inside classes no Scenario key covers.
//                         False keeps such a test out of scope, as only a class's key scopes it
//   fileKeyPrefix         (optional) whether a file carries a Key prefix in a header comment
//                         (ADR-0022). Its `parse` then also returns `header: {keyPrefixes: [{key,
//                         line}], at}`, and with no enclosing class carrying a prefix, a test's is
//                         its file's, proposed for the file where it has none
//
// Write side (lib/sync-plan.mjs, lib/sync-code.mjs, lib/init.mjs):
//   render(text, ops, carrier, file)   {text, errors}: one file (at repository path `file`) with
//                         keys written. `ops` is {annotate: [{fn, handle}], rekey: [{fn, from,
//                         handle}], prefix: [{cls, prefix}], header: [{prefix}]}, `header` a file's
//                         Key prefix for a `fileKeyPrefix` adapter; `carrier` is {name, names, home, prefix: {name, home}}, the
//                         carrier name to write, every name a key is read under, and where each is
//                         declared (null while undeclared). Edits are byte-offset splices
//                         (`splice`), and the result is re-parsed to check every key landed. Each
//                         error is `{kind, message}`: `stale` when the file no longer holds, where
//                         the card saw it, the test or class a write is for; any other kind is the
//                         adapter's own, and `/qa-sync` shows its `message`.
//                         A `rekey` may name a class as `fn` (with `path`), with `names` overriding
//                         the function carrier names to use the configured class carriers.
//   carrierText(name, value)     how the card shows a value written in carrier `name`
//   headerText(prefix)    (with `fileKeyPrefix`) the header line that carries a file's Key prefix
//   needsDeclaration      whether a carrier must be declared before the code compiles; when true,
//                         `declaration` holds the declaration's state, text, card item, checks,
//                         card wording and refusals, and the warning for keys written undeclared
//   words                 the stack's words in engineer text:
//                           source, testSuite   what the module paths hold ("… source"), and the
//                                               test code a judge must not read
//                           carrier, aCarrier, carriers, classCarrier   one Key carrier in a
//                                               sentence ("its …"), with its article, several,
//                                               and a class's
//                           write               the verb for writing a carrier on a test or
//                                               class ("… it")
//                           keyCarrier, keyCarrierTitle   a carrier holding a key ("leave 2 …s
//                                               unread"), and `/qa-init`'s heading for the
//                                               Automation key's
//
// Loading. Each stack module (lib/stacks/, one each; deleting one leaves no trace of its stack
// anywhere else) exports an entry `{fits(stack), load(repo)}`: whether it reads that
// `project.stack`, and the adapter above for one repository under test, as
//   {adapter, version?}   loaded; `version` is what it found to read with (a parser), if any
//   {unavailable: note}   it reads the stack but cannot here (a parser the repository lacks):
//                         `note` is the run-health note's data, `{message, …}`
// A command resolves its adapter once, at its entry (`resolveAdapter`), and passes the result on
// the context its modules share (`ctx.stack`: `scan` and `/qa-sync`); a command with no shared
// context (`/qa-init`, `brief`, `/qa-impact`'s report) resolves at its own entry. A resolution is
// kept per repository, so a stack loads once per process.
import { KOTLIN_JUNIT5 } from "./stacks/kotlin-junit5.mjs";
import { NO_ADAPTER_WORDS } from "./stacks/no-adapter.mjs";
import { TS_PLAYWRIGHT } from "./stacks/ts-playwright.mjs";

/**
 * @import { AdapterWords } from "./stacks/no-adapter.mjs"
 * @import { KotlinAdapter, KotlinDeclaration, KotlinStackDescriptor, KotlinStackEntry, KotlinUnavailableNote } from "./stacks/kotlin-junit5.mjs"
 * @import { TsAdapter, TsStackDescriptor, TsStackEntry, TsUnavailableNote } from "./stacks/ts-playwright.mjs"
 */

/**
 * @typedef {AdapterWords & { classCarrier?: string, write?: string }} StackWords
 */

/**
 * @typedef {{
 *   state: (ctx: { repo: string, config: unknown }) => {
 *     status: string,
 *     path?: string,
 *     home?: unknown,
 *     proposed: { path?: string, home?: unknown },
 *   },
 *   text: (home: unknown, name: string) => string,
 *   snippet?: { fence?: string, anywhere?: string },
 *   [key: string]: unknown,
 * }} StackDeclaration
 */

/**
 * The line ranges a per-file-cap truncation keeps: imports and the class or describe header,
 * hooks, and each test's span. Lines are 1-based and inclusive.
 * @typedef {{
 *   imports: [number, number] | null,
 *   header: [number, number] | null,
 *   hooks: { line: number, end: number }[],
 *   tests: { line: number, end: number }[],
 * }} CodegenShape
 */

/**
 * What a stack contributes to the code-evidence sample (`/qa-train codegen`). A prepared context is
 * opaque to the sampler, which only passes it back: the stack resolves its own imports, annotations
 * and constructor calls to repository files and finds its own runner config.
 * @typedef {{
 *   prepare: (repo: string, modulePaths: readonly string[]) => unknown,
 *   support: (prepared: unknown, file: string, text: string) => string[],
 *   runnerConfigs: (prepared: unknown) => string[],
 *   shape: (text: string, file: string) => CodegenShape,
 * }} CodegenAdapter
 */

/**
 * @typedef {(Omit<KotlinAdapter, "declaration" | "parse"> & {
 *   needsDeclaration: true,
 *   declaration: StackDeclaration,
 *   fileKeyPrefix?: false,
 *   codegen?: CodegenAdapter,
 *   parse: (text: string, file: string) => (import("./stacks/kotlin-junit5.mjs").KotlinParsedFile & { header?: never }),
 * }) | (TsAdapter & {
 *   needsDeclaration: false,
 *   declaration?: never,
 *   codegen?: CodegenAdapter,
 * })} StackAdapter
 */

/**
 * @typedef {KotlinUnavailableNote | TsUnavailableNote} StackUnavailableNote
 */

/**
 * @typedef {{
 *   fits: (stack: KotlinStackDescriptor & TsStackDescriptor) => boolean,
 *   load: (repo: string) => {
 *     adapter?: unknown,
 *     version?: string | null,
 *     unavailable?: StackUnavailableNote | null,
 *   },
 * }} StackEntry
 */

/**
 * @typedef {{
 *   adapter: StackAdapter | null,
 *   version: string | null,
 *   unavailable: StackUnavailableNote | null,
 * }} ResolvedStack
 */

export { splice } from "./stacks/splice.mjs";

// The words a text names the stack's code by: `adapter`'s own, or, with none (a stack no adapter
// reads), the general ones of lib/stacks/no-adapter.mjs.
/**
 * @param {{ words?: StackWords } | unknown} adapter
 * @returns {StackWords}
 */
export const wordsOf = (adapter) => (/** @type {{ words?: StackWords } | null | undefined} */ (adapter))?.words ?? NO_ADAPTER_WORDS;

// Every stack's entry, in the order `resolveAdapter` tries them.
/** @type {readonly StackEntry[]} */
const ADAPTERS = [KOTLIN_JUNIT5, TS_PLAYWRIGHT];

// Each entry's load per repository, so a command that scans more than once (`/qa-sync` scans, then
// plans) loads its adapter once.
/** @type {WeakMap<object, Map<string, ResolvedStack>>} */
const loaded = new WeakMap();

// The adapter for `project.stack` (`{language, framework}`) in repository `repo`:
//   {adapter, version, unavailable}
// `adapter` null and `unavailable` null: no adapter reads the stack. `adapter` null and
// `unavailable` a note: one reads it but cannot load here. Otherwise the loaded adapter, and the
// version it reported (null when none). `adapters` is for tests.
/**
 * @param {{ language?: unknown, framework?: unknown } | null | undefined} stack
 * @param {string} repo
 * @param {readonly StackEntry[]} [adapters]
 * @returns {ResolvedStack}
 */
export function resolveAdapter(stack, repo, adapters = ADAPTERS) {
  /** @type {ResolvedStack} */
  const none = { adapter: null, version: null, unavailable: null };
  if (!stack || typeof stack.language !== "string" || typeof stack.framework !== "string") return none;
  const entry = adapters.find((a) => a.fits(/** @type {KotlinStackDescriptor & TsStackDescriptor} */ (stack)));
  if (!entry) return none;
  if (!loaded.has(entry)) loaded.set(entry, new Map());
  const byRepo = /** @type {Map<string, ResolvedStack>} */ (loaded.get(entry));
  if (!byRepo.has(repo)) {
    const r = entry.load(repo);
    byRepo.set(repo, r.unavailable ? { ...none, unavailable: r.unavailable } : { adapter: /** @type {StackAdapter} */ (r.adapter), version: r.version ?? null, unavailable: null });
  }
  return /** @type {ResolvedStack} */ (byRepo.get(repo));
}

export { testRunnerMatchesStack } from "./stacks/descriptors.mjs";
