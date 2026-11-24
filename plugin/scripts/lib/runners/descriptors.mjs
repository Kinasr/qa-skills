// @ts-check
// Pure runner capability descriptors: built-in tool ids, default task configuration, and protected
// build/wrapper files. Zero imports and zero I/O so parsing modules never pull runtime adapters.

/**
 * Built-in test runner tool identifier.
 * @typedef {"playwright" | "gradle" | "maven"} RunnerTool
 */

/**
 * Protected build and wrapper paths owned by a built-in test runner.
 * @typedef {{ readonly names: readonly string[], readonly basenames: readonly RegExp[] }} RunnerProtectedFiles
 */

/**
 * Capability descriptor for a built-in test runner.
 * @typedef {{ readonly tool: RunnerTool, readonly defaultTask?: string, readonly protectedFiles: RunnerProtectedFiles }} RunnerDescriptor
 */

/**
 * The Gradle task run when `test_runner.task` is absent.
 * @type {string}
 */
export const GRADLE_DEFAULT_TASK = "test";

/**
 * Capability descriptors keyed by built-in runner tool.
 * @type {Readonly<Record<RunnerTool, RunnerDescriptor>>}
 */
export const RUNNER_DESCRIPTORS = Object.freeze({
  playwright: Object.freeze({
    tool: /** @type {const} */ ("playwright"),
    protectedFiles: Object.freeze({
      names: Object.freeze([]),
      basenames: Object.freeze([/^playwright\.config\.[^.]+$/]),
    }),
  }),
  gradle: Object.freeze({
    tool: /** @type {const} */ ("gradle"),
    defaultTask: GRADLE_DEFAULT_TASK,
    protectedFiles: Object.freeze({
      names: Object.freeze([
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
        "gradle.properties",
        "gradle.lockfile",
        "gradlew",
        "gradlew.bat",
      ]),
      basenames: Object.freeze([]),
    }),
  }),
  maven: Object.freeze({
    tool: /** @type {const} */ ("maven"),
    protectedFiles: Object.freeze({
      names: Object.freeze(["pom.xml", "mvnw", "mvnw.cmd", "mvnwdebug"]),
      basenames: Object.freeze([]),
    }),
  }),
});

/**
 * Protected file groups across all built-in runners.
 * @type {readonly RunnerProtectedFiles[]}
 */
export const RUNNER_PROTECTED_FILES = Object.freeze(
  Object.values(RUNNER_DESCRIPTORS).map((d) => d.protectedFiles),
);

/**
 * Applies descriptor defaults (`dir`, and any tool `defaultTask`) to a raw `test_runner` map.
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function defaultRunnerConfig(raw) {
  const tool = raw.tool;
  const descriptor = typeof tool === "string" && Object.hasOwn(RUNNER_DESCRIPTORS, tool)
    ? RUNNER_DESCRIPTORS[/** @type {RunnerTool} */ (tool)]
    : undefined;
  return {
    ...raw,
    dir: raw.dir ?? ".",
    ...(descriptor?.defaultTask !== undefined ? { task: raw.task ?? descriptor.defaultTask } : {}),
  };
}
