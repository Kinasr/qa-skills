// @ts-check
// Pure stack recognition shared by file validation and adapter selection. No disk readers here.

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
 * Whether a built-in runner can execute the declared stack, without loading its parser.
 * @param {unknown} tool
 * @param {{ language?: unknown, framework?: unknown } | null | undefined} stack
 * @returns {boolean}
 */
export function testRunnerMatchesStack(tool, stack) {
  if (!stack || typeof stack.language !== "string" || typeof stack.framework !== "string") return false;
  const descriptor = /** @type {{ language: string, framework: string }} */ (stack);
  return (isTsPlaywrightStack(descriptor) && tool === "playwright") ||
    (isKotlinJUnit5Stack(descriptor) && (tool === "gradle" || tool === "maven"));
}

/**
 * The Key carriers a stack's adapter reads and the ones it writes, as `annotation_map` names them.
 * `annotation.<type>` stands for any annotation of that type, and `any` for a stack whose carriers
 * are identifiers it chooses itself (an annotation). A stack declares these beside its descriptor,
 * clear of its parser, so a carrier is judged while the adapter cannot load (ADR-0022).
 * @typedef {{ read: "any" | string[], write: "any" | string[] }} StackCarrierForms
 */

/** @type {StackCarrierForms} */
export const KOTLIN_JUNIT5_CARRIERS = { read: "any", write: "any" };

/** @type {StackCarrierForms} */
export const TS_PLAYWRIGHT_CARRIERS = { read: ["tag", "annotation.<type>", "title"], write: ["tag", "annotation.<type>"] };

/**
 * The carriers the stack a descriptor names can read and write, or null when no adapter reads it.
 * @param {{ language?: unknown, framework?: unknown } | null | undefined} stack
 * @returns {StackCarrierForms | null}
 */
export function stackCarriers(stack) {
  if (!stack || typeof stack.language !== "string" || typeof stack.framework !== "string") return null;
  const descriptor = /** @type {{ language: string, framework: string }} */ (stack);
  return isTsPlaywrightStack(descriptor) ? TS_PLAYWRIGHT_CARRIERS : isKotlinJUnit5Stack(descriptor) ? KOTLIN_JUNIT5_CARRIERS : null;
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
