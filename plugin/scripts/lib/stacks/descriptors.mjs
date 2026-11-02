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
