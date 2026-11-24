// @ts-check
// Pure stack recognition and capability descriptors shared by file validation, adapter selection,
// and edit guards. No disk readers or parser imports here.

/**
 * @param {{ language: string, framework: string }} stack
 * @returns {boolean}
 */
export const isKotlinJUnit5Stack = (stack) => stack.language.toLowerCase() === "kotlin" && /junit[\s_-]?5/i.test(stack.framework);

/**
 * @param {{ language: string, framework: string }} stack
 * @returns {boolean}
 */
export const isTsPlaywrightStack = (stack) => /^(typescript|ts|javascript|js)$/i.test(stack.language) && /playwright/i.test(stack.framework) && !/junit/i.test(stack.framework);

/**
 * The Key carriers a stack's adapter reads and the ones it writes, as `annotation_map` names them.
 * `annotation.<type>` stands for any annotation of that type, and `any` for a stack whose carriers
 * are identifiers it chooses itself (an annotation). A stack declares these beside its descriptor,
 * clear of its parser, so a carrier is judged while the adapter cannot load (ADR-0022).
 * @typedef {{ read: "any" | string[], write: "any" | string[] }} StackCarrierForms
 */

/**
 * Protected build, config, and manifest files owned by a stack.
 * @typedef {{ readonly names: readonly string[], readonly basenames: readonly RegExp[] }} ProtectedFiles
 */

/**
 * Capability descriptor binding stack matching, compatible runner tools, carriers, and protected files.
 * @typedef {{
 *   readonly fits: (stack: { language: string, framework: string }) => boolean,
 *   readonly runnerTools: readonly string[],
 *   readonly carriers: StackCarrierForms,
 *   readonly protectedFiles: ProtectedFiles,
 * }} StackCapabilityDescriptor
 */

/** @type {StackCarrierForms} */
export const KOTLIN_JUNIT5_CARRIERS = { read: "any", write: "any" };

/** @type {StackCarrierForms} */
export const TS_PLAYWRIGHT_CARRIERS = { read: ["tag", "annotation.<type>", "title"], write: ["tag", "annotation.<type>"] };

/**
 * TypeScript/JavaScript package manifests, lockfiles, and bundler/compiler configs.
 * @type {ProtectedFiles}
 */
export const TS_PLAYWRIGHT_PROTECTED_FILES = Object.freeze({
  names: Object.freeze([
    "package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock",
    "pnpm-lock.yaml", "pnpm-workspace.yaml", "bun.lock", "bun.lockb", "bunfig.toml",
    "turbo.json", "nx.json", "lerna.json", "workspace.json", "project.json",
  ]),
  basenames: Object.freeze([
    /^tsconfig.*\.json$/,
    /^\.(?:babelrc|swcrc|npmrc|yarnrc|pnpmrc|nvmrc).*/,
    /^(?:webpack|vite|rollup|esbuild|tsup|babel)\.config\.[^.]+$/,
  ]),
});

/**
 * Kotlin/JUnit 5 builds through Gradle and Maven runner descriptors rather than stack-private files.
 * @type {ProtectedFiles}
 */
export const KOTLIN_JUNIT5_PROTECTED_FILES = Object.freeze({
  names: Object.freeze([]),
  basenames: Object.freeze([]),
});

/**
 * Capability descriptors for all supported stacks.
 * @type {readonly StackCapabilityDescriptor[]}
 */
export const STACK_DESCRIPTORS = Object.freeze([
  Object.freeze({
    fits: isTsPlaywrightStack,
    runnerTools: Object.freeze(["playwright"]),
    carriers: TS_PLAYWRIGHT_CARRIERS,
    protectedFiles: TS_PLAYWRIGHT_PROTECTED_FILES,
  }),
  Object.freeze({
    fits: isKotlinJUnit5Stack,
    runnerTools: Object.freeze(["gradle", "maven"]),
    carriers: KOTLIN_JUNIT5_CARRIERS,
    protectedFiles: KOTLIN_JUNIT5_PROTECTED_FILES,
  }),
]);

/**
 * Protected file groups across all supported stacks.
 * @type {readonly ProtectedFiles[]}
 */
export const STACK_PROTECTED_FILES = Object.freeze(STACK_DESCRIPTORS.map((d) => d.protectedFiles));

/**
 * Resolves the capability descriptor matching a `{ language, framework }` stack, if any.
 * @param {{ language?: unknown, framework?: unknown } | null | undefined} stack
 * @returns {StackCapabilityDescriptor | undefined}
 */
function findStackDescriptor(stack) {
  if (!stack || typeof stack.language !== "string" || typeof stack.framework !== "string") return undefined;
  const descriptor = /** @type {{ language: string, framework: string }} */ (stack);
  return STACK_DESCRIPTORS.find((d) => d.fits(descriptor));
}

/**
 * Whether a built-in runner can execute the declared stack, without loading its parser.
 * @param {unknown} tool
 * @param {{ language?: unknown, framework?: unknown } | null | undefined} stack
 * @returns {boolean}
 */
export function testRunnerMatchesStack(tool, stack) {
  if (typeof tool !== "string") return false;
  return findStackDescriptor(stack)?.runnerTools.includes(tool) ?? false;
}

/**
 * The carriers the stack a descriptor names can read and write, or null when no adapter reads it.
 * @param {{ language?: unknown, framework?: unknown } | null | undefined} stack
 * @returns {StackCarrierForms | null}
 */
export function stackCarriers(stack) {
  return findStackDescriptor(stack)?.carriers ?? null;
}

/**
 * Whether `name` is a carrier the stack can use: one it reads (`kind: "read"`) or writes
 * (`kind: "write"`). A stack no adapter reads uses none.
 * @param {StackCarrierForms | null | undefined} carriers
 * @param {string} name
 * @param {"read" | "write"} kind
 * @returns {boolean}
 */
export function carrierSupported(carriers, name, kind) {
  const forms = carriers?.[kind];
  if (forms === undefined) return false;
  if (forms === "any") return true;
  return forms.some((form) => (form === "annotation.<type>" ? /^annotation\.[A-Za-z_][A-Za-z0-9_]*$/.test(name) : form === name));
}
