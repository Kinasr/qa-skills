// @ts-check
// The Playwright test runner's launcher on win32: one slot of the platform module
// (`spawnNodeCli` kind `playwright-runner`, ADR-0069), kept in its own module so the platform
// boundary stays one dispatch line.
//
// The adapter starts three child processes per Run: the version probe, the root probe for a
// `--test-list` line, and the run itself. On native Windows all three start the same way:
//   - the default `npx playwright test` runs the project's local `@playwright/test` `bin` through
//     Node (`execPath`), so neither `npx.cmd` nor `cmd.exe` is involved;
//   - a configured `test_runner.launcher` ending in `.exe` runs directly, and one that is a Node script
//     runs through Node too;
//   - a configured `.cmd`/`.bat` is refused naming `test_runner.launcher`, since no batch file is
//     spawned outside the Gradle and Maven wrappers.
// The resolved `file` and `args` are the launcher *prefix*: the adapter appends its own selection,
// reporter and output arguments to it, which is why it resolves once and spawns three times.
//
// POSIX never reaches this module: `spawnNodeCli` returns its request unchanged there.
import { dirname, extname, join, resolve, sep, win32 } from "node:path";
import {
  BATCH_EXTENSIONS,
  EXE_EXTENSION,
  findWin32CommandHit,
  mergePlatformFs,
  NODE_SCRIPT_EXTENSIONS,
} from "./platform-path.mjs";
/**
 * @import {
 *   NodeCliRequest,
 *   PlatformContext,
 *   PlatformFs,
 *   PlatformRefusal,
 *   PlatformRefusalResult,
 *   PlatformRunnerOptions,
 *   PlatformSpawnResult,
 * } from "./platform.mjs"
 */

/**
 * The launcher the adapter uses when `test_runner.launcher` is unset. On win32 its `@playwright/test`
 * `bin` is resolved inside the project instead.
 * @type {readonly string[]}
 */
export const PLAYWRIGHT_RUNNER_LAUNCHER = Object.freeze(["npx", "playwright", "test"]);

/**
 * @param {PlatformRefusal} refusal
 * @returns {PlatformRefusalResult}
 */
const refuse = (refusal) => ({ refusal });

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether `file` resolves inside the directory `base`: the confinement `@playwright/test`'s `bin`
 * entry must satisfy, so a planted or escaping entry never runs.
 * @param {string} base
 * @param {string} file
 * @returns {boolean}
 */
const confined = (base, file) => {
  const pathSep = base.includes("\\") ? "\\" : sep;
  return file === base || file.startsWith(`${base}${pathSep}`);
};

/**
 * `npx playwright …` is the default launcher: its target is the project's own `@playwright/test`.
 * @param {string} file
 * @param {string[]} args
 * @returns {boolean}
 */
const isNpxPlaywright = (file, args) => file.toLowerCase() === "npx" && (args[0] ?? "").toLowerCase() === "playwright";

/**
 * The project's local `@playwright/test`, found the way Node and npm find it: the `node_modules` of
 * the working directory, then of each parent (a workspace keeps it at the repository root). The
 * working directory's own candidate is returned when none exists, so the refusal names the path an
 * engineer would install into.
 * @param {string} cwd
 * @param {PlatformFs} fs
 * @returns {string}
 */
function localPackageDir(cwd, fs) {
  const start = resolve(cwd);
  for (let dir = start; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", "@playwright", "test");
    if (fs.existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) return join(start, "node_modules", "@playwright", "test");
  }
}

/**
 * The project's local `@playwright/test` `bin`, confined to the package and run through Node.
 * @template [TOptions=PlatformRunnerOptions]
 * @param {NodeCliRequest<TOptions>} request
 * @param {string[]} args The launcher's words after `npx playwright`.
 * @param {PlatformFs} fs
 * @param {string} execPath
 * @returns {PlatformSpawnResult<TOptions>}
 */
function resolveLocalPackage(request, args, fs, execPath) {
  const packageDir = localPackageDir(request.cwd ?? process.cwd(), fs);
  const manifest = join(packageDir, "package.json");
  /** @type {Pick<PlatformRefusal, "file" | "source">} */
  const origin = { file: packageDir, source: "test_runner.launcher" };
  if (!fs.existsSync(manifest)) {
    return refuse({
      outcome: "missing",
      code: "command_missing",
      ...origin,
      message: `${packageDir} holds no @playwright/test; install it so the Playwright runner can start`,
    });
  }
  /** @type {unknown} */
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(manifest, "utf8"));
  } catch {
    return refuse({
      outcome: "refused",
      code: "unresolvable_shim",
      ...origin,
      message: `${manifest} is not readable JSON; reinstall @playwright/test`,
    });
  }
  const bin = isRecord(packageJson) ? packageJson.bin : undefined;
  const entry = typeof bin === "string" ? bin : isRecord(bin) && typeof bin.playwright === "string" ? bin.playwright : undefined;
  if (!entry) {
    return refuse({
      outcome: "refused",
      code: "unresolvable_shim",
      ...origin,
      message: `@playwright/test at ${packageDir} names no playwright bin entry; reinstall it`,
    });
  }
  const script = resolve(packageDir, entry);
  if (!confined(packageDir, script)) {
    return refuse({
      outcome: "refused",
      code: "unconfined_bin",
      ...origin,
      message: `@playwright/test's playwright bin entry ${entry} resolves outside ${packageDir}`,
    });
  }
  if (!fs.existsSync(script)) {
    return refuse({
      outcome: "refused",
      code: "unresolvable_shim",
      ...origin,
      message: `@playwright/test's playwright bin entry ${entry} is not in ${packageDir}; reinstall it`,
    });
  }
  let realPkg;
  let realScript;
  try {
    realPkg = fs.realpathSync(packageDir);
    realScript = fs.realpathSync(script);
  } catch {
    return refuse({
      outcome: "refused",
      code: "unresolvable_shim",
      ...origin,
      message: `@playwright/test's playwright bin entry ${entry} is not in ${packageDir}; reinstall it`,
    });
  }
  if (!confined(realPkg, realScript)) {
    return refuse({
      outcome: "refused",
      code: "unconfined_bin",
      ...origin,
      message: `@playwright/test's playwright bin entry ${entry} resolves outside ${packageDir}`,
    });
  }
  return { file: execPath, args: [script, ...args], options: request.options };
}

/**
 * Resolve a bare extensionless configured `test_runner.launcher` (e.g. `node`) via `PATH`/`PATHEXT`.
 * `.exe` runs directly; `.cmd`/`.bat` and any other hit are refused naming `test_runner.launcher`.
 * @template [TOptions=PlatformRunnerOptions]
 * @param {NodeCliRequest<TOptions>} request
 * @param {PlatformFs} fs
 * @param {NodeJS.ProcessEnv} env
 * @param {boolean} hasStatSync
 * @returns {PlatformSpawnResult<TOptions>}
 */
function resolveBareRunnerCommand(request, fs, env, hasStatSync) {
  const probe = hasStatSync ? "stat" : "exists";
  const hit = findWin32CommandHit(fs, env, request.file, { probe });
  if (!hit) {
    return refuse({
      outcome: "missing",
      code: "command_missing",
      file: request.file,
      source: "test_runner.launcher",
      message: `test_runner.launcher ${request.file} was not found on win32 PATH`,
    });
  }
  const hitExt = (win32.extname(hit.hitPath) || hit.ext).toLowerCase();
  if (hitExt === EXE_EXTENSION) {
    return { file: hit.hitPath, args: request.args, options: request.options };
  }
  if (BATCH_EXTENSIONS.has(hitExt)) {
    return refuse({
      outcome: "refused",
      code: "disallowed_wrapper",
      file: hit.hitPath,
      source: "test_runner.launcher",
      message: `test_runner.launcher ${request.file} resolved to Windows batch file ${hit.hitPath}, which the Playwright runner never starts through cmd.exe; set it to a .exe, or leave it unset to run the project's @playwright/test through Node`,
    });
  }
  return refuse({
    outcome: "refused",
    code: "unsupported_exec_path",
    file: hit.hitPath,
    source: "test_runner.launcher",
    message: `test_runner.launcher ${request.file} resolved to ${hit.hitPath}, which is not a .exe; set it to a .exe, or leave it unset to run the project's @playwright/test through Node`,
  });
}

/**
 * Resolve the Playwright runner's launcher for `platform`. On POSIX the request is returned
 * unchanged; on win32 the launcher prefix is resolved as described at the top of this module.
 * @template [TOptions=PlatformRunnerOptions]
 * @param {NodeCliRequest<TOptions>} request
 * @param {PlatformContext} [context]
 * @returns {PlatformSpawnResult<TOptions>}
 */
export function resolvePlaywrightRunner(request, { platform = process.platform, execPath = process.execPath, env: injectedEnv, fs: injectedFs } = {}) {
  if (platform !== "win32") {
    return { file: request.file, args: request.args, options: request.options };
  }
  const fs = mergePlatformFs(injectedFs);
  const extension = extname(request.file).toLowerCase();
  if (!extension) {
    if (isNpxPlaywright(request.file, request.args)) return resolveLocalPackage(request, request.args.slice(1), fs, execPath);
    if (!win32.isAbsolute(request.file) && !/[\\/]/.test(request.file)) {
      const env = injectedEnv ?? /** @type {{ env?: NodeJS.ProcessEnv } | undefined} */ (request.options)?.env ?? process.env;
      const hasStatSync = !(injectedFs?.existsSync && !injectedFs?.statSync);
      return resolveBareRunnerCommand(request, fs, env, hasStatSync);
    }
    return refuse({
      outcome: "refused",
      code: "unsupported_exec_path",
      file: request.file,
      source: "test_runner.launcher",
      message: `test_runner.launcher ${request.file} has no .exe or Node script extension; set it to a .exe, or leave it unset to run the project's @playwright/test through Node`,
    });
  }
  if (extension === EXE_EXTENSION) {
    return { file: request.file, args: request.args, options: request.options };
  }
  if (BATCH_EXTENSIONS.has(extension)) {
    return refuse({
      outcome: "refused",
      code: "disallowed_wrapper",
      file: request.file,
      source: "test_runner.launcher",
      message: `test_runner.launcher ${request.file} is a Windows batch file, which the Playwright runner never starts through cmd.exe; set it to a .exe, or leave it unset to run the project's @playwright/test through Node`,
    });
  }
  if (NODE_SCRIPT_EXTENSIONS.has(extension)) {
    return { file: execPath, args: [request.file, ...request.args], options: request.options };
  }
  return refuse({
    outcome: "refused",
    code: "unsupported_exec_path",
    file: request.file,
    source: "test_runner.launcher",
    message: `test_runner.launcher ${request.file} is not a .exe or a Node script; set it to one, or leave it unset to run the project's @playwright/test through Node`,
  });
}
