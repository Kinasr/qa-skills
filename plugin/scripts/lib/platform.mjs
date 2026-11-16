// @ts-check
// Platform boundary for non-git child process resolution and Windows ACL privacy checks.
// Every non-git spawn caller asks this module so POSIX keeps byte-for-byte identity while
// win32 enforces Node-only execution for Node CLIs and an allow-listed cmd.exe boundary
// exclusively for Gradle and Maven batch wrappers.
import { spawnSync } from "node:child_process";
import { win32 } from "node:path";
import { spawnBatchWin32 } from "./platform-batch.mjs";
import {
  BATCH_EXTENSIONS,
  DEFAULT_PLATFORM_FS,
  EXE_EXTENSION,
  mergePlatformFs,
  NODE_SCRIPT_EXTENSIONS,
  resolveWin32PathCommand,
} from "./platform-path.mjs";
import { resolvePlaywrightRunner } from "./platform-runner.mjs";

export { defaultBatchLauncher } from "./platform-batch.mjs";
export {
  BATCH_EXTENSIONS,
  DEFAULT_PLATFORM_FS,
  EXE_EXTENSION,
  mergePlatformFs,
  NODE_SCRIPT_EXTENSIONS,
} from "./platform-path.mjs";

/**
 * Minimal filesystem reader surface used across platform resolution and ACL privacy checks.
 * Any omitted method defaults to the corresponding `node:fs` implementation.
 * @typedef {{
 *   existsSync: (path: string) => boolean,
 *   statSync: (path: string) => { isFile(): boolean, isDirectory?: () => boolean },
 *   accessSync: (path: string, mode?: number) => void,
 *   readFileSync: (path: string, encoding: BufferEncoding) => string,
 *   realpathSync: (path: string) => string,
 * }} PlatformFs
 */

/**
 * Options accepted by the injected command runner.
 * @typedef {{
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   encoding?: BufferEncoding,
 *   timeout?: number,
 *   killSignal?: NodeJS.Signals | number,
 *   maxBuffer?: number,
 *   windowsVerbatimArguments?: boolean,
 *   shell?: boolean,
 * }} PlatformRunnerOptions
 */

/**
 * Output returned by the injected command runner.
 * @typedef {{
 *   status: number | null,
 *   stdout: string,
 *   stderr?: string,
 *   error?: Error,
 * }} PlatformRunnerResult
 */

/**
 * Command runner seam for testing win32 command probes on POSIX.
 * Defaults to a wrapper around `node:child_process`'s `spawnSync`.
 * @typedef {(file: string, args: readonly string[], options?: PlatformRunnerOptions) => PlatformRunnerResult} PlatformRunner
 */

/**
 * Injectable platform seams. All fields default to the real Node.js process/fs/child_process values.
 * @typedef {{
 *   platform?: NodeJS.Platform,
 *   env?: NodeJS.ProcessEnv,
 *   fs?: Partial<PlatformFs>,
 *   run?: PlatformRunner,
 *   execPath?: string,
 * }} PlatformContext
 */

/**
 * Outcome category distinguishing not-found from an explicit policy/integrity refusal.
 * Callers (`on-path`, `playwright-version`, `execution-guard`, `scout-login`, `execute-open`)
 * map this into `ok | missing | old | refused` without collapsing `refused` into `missing`.
 * @typedef {"missing" | "refused"} PlatformFailureOutcome
 */

/**
 * Machine-readable refusal codes produced by platform primitives.
 * @typedef {(
 *   "unsupported_exec_path"
 *   | "command_missing"
 *   | "unresolvable_shim"
 *   | "unconfined_bin"
 *   | "disallowed_wrapper"
 *   | "disallowed_metachar"
 *   | "acl_unreadable"
 *   | "acl_not_private"
 *   | "secret_target_unwritable"
 * )} PlatformRefusalCode
 */

/**
 * Typed refusal returned when a win32 spawn or check cannot proceed safely.
 * @typedef {{
 *   outcome: PlatformFailureOutcome,
 *   code: PlatformRefusalCode,
 *   message: string,
 *   file?: string,
 *   source?: string,
 *   char?: string,
 *   command?: string,
 * }} PlatformRefusal
 */

/**
 * Resolved child-process invocation ready for `spawnSync` / `spawn`.
 * @template [TOptions=PlatformRunnerOptions]
 * @typedef {{
 *   file: string,
 *   args: string[],
 *   options: TOptions,
 *   refusal?: undefined,
 * }} PlatformSpawnSpec
 */

/**
 * Refusal result returned by `spawnNodeCli` or `spawnBatchWrapper`.
 * @typedef {{
 *   file?: undefined,
 *   args?: undefined,
 *   options?: undefined,
 *   refusal: PlatformRefusal,
 * }} PlatformRefusalResult
 */

/**
 * Union returned by `spawnNodeCli` and `spawnBatchWrapper`.
 * @template [TOptions=PlatformRunnerOptions]
 * @typedef {PlatformSpawnSpec<TOptions> | PlatformRefusalResult} PlatformSpawnResult
 */

/**
 * Request to `spawnNodeCli`.
 * @template [TOptions=PlatformRunnerOptions]
 * @typedef {{
 *   file: string,
 *   args: string[],
 *   options: TOptions,
 *   kind?: "exec-path" | "playwright-cli" | "path-tool" | "playwright-runner",
 *   cwd?: string,
 *   source?: string,
 * }} NodeCliRequest
 */

/**
 * Tagged argument token for `spawnBatchWrapper` so metacharacter refusals can attribute the key or selector.
 * When a single token joins segments from different sources (e.g. a Gradle `:module:task` path),
 * `parts` lists them in concatenation order so attribution falls on the segment that failed.
 * @typedef {{
 *   value: string,
 *   source?: string,
 *   parts?: readonly BatchArgToken[],
 * }} BatchArgToken
 */

/**
 * Request to `spawnBatchWrapper` (reserved for Gradle and Maven runners).
 * @template [TOptions=PlatformRunnerOptions]
 * @typedef {{
 *   file: string,
 *   args: string[],
 *   options: TOptions,
 *   cwd?: string,
 *   source?: string,
 *   tokens?: readonly BatchArgToken[],
 *   automation?: string,
 * }} BatchWrapperRequest
 */

/** @type {PlatformRunner} */
export const defaultPlatformRunner = (file, args, options = {}) => {
  const result = spawnSync(file, [...args], { encoding: "utf8", ...options });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    ...(result.error ? { error: result.error } : {}),
  };
};

/**
 * Map a `PlatformRefusal` into `{ missing: true }` or `{ refused: true, refusal }`.
 * @param {PlatformRefusal} refusal
 * @returns {{ missing: true } | { refused: true, refusal: PlatformRefusal }}
 */
export function mapSpawnRefusal(refusal) {
  return refusal.outcome === "missing" ? { missing: true } : { refused: true, refusal };
}

/**
 * Map a `PlatformRefusal` into `{ status: "missing" }` or `{ status: "refused", refusal }`.
 * @param {PlatformRefusal} refusal
 * @returns {{ status: "missing" } | { status: "refused", refusal: PlatformRefusal }}
 */
export function mapStatusRefusal(refusal) {
  return refusal.outcome === "missing" ? { status: "missing" } : { status: "refused", refusal };
}

/**
 * Resolve an explicit host/executable path on win32: `.exe` runs directly, `.js`/`.cjs`/`.mjs`
 * run through Node (`execPath`), and anything else (including `.cmd`) is refused.
 * @template [TOptions=PlatformRunnerOptions]
 * @param {NodeCliRequest<TOptions>} request
 * @param {string} execPath
 * @returns {PlatformSpawnResult<TOptions>}
 */
function resolveWin32ExecPath(request, execPath) {
  const ext = win32.extname(request.file).toLowerCase();
  if (ext === EXE_EXTENSION) {
    return { file: request.file, args: request.args, options: request.options };
  }
  if (NODE_SCRIPT_EXTENSIONS.has(ext)) {
    return { file: execPath, args: [request.file, ...request.args], options: request.options };
  }
  return {
    refusal: {
      outcome: "refused",
      code: "unsupported_exec_path",
      message: `Unsupported Windows executable path ${request.file}: expected .exe or .js/.cjs/.mjs`,
      file: request.file,
    },
  };
}

/**
 * Resolve a Node CLI invocation (`CLAUDE_CODE_EXECPATH`, `playwright-cli`, `gh`/`glab`, or
 * the Playwright test runner) without ever invoking `cmd.exe`. On POSIX, returns the request's
 * `file`, `args`, and `options` unchanged.
 *
 * For `kind: "playwright-runner"` the returned `file` and `args` are the launcher prefix the adapter
 * appends its own selection, reporter and output arguments to (see `platform-runner.mjs`).
 * @template [TOptions=PlatformRunnerOptions]
 * @param {NodeCliRequest<TOptions>} request
 * @param {PlatformContext} [context]
 * @returns {PlatformSpawnResult<TOptions>}
 */
export function spawnNodeCli(request, context = {}) {
  const { platform = process.platform, execPath = process.execPath } = context;
  if (platform !== "win32") {
    return { file: request.file, args: request.args, options: request.options };
  }
  const kind = request.kind ?? "exec-path";
  switch (kind) {
    case "exec-path":
      return resolveWin32ExecPath(request, execPath);
    case "playwright-runner":
      return resolvePlaywrightRunner(request, context);
    case "playwright-cli":
    case "path-tool": {
      const env = context.env ?? /** @type {{ env?: NodeJS.ProcessEnv } | undefined} */ (request.options)?.env ?? process.env;
      return resolveWin32PathCommand(request, { env, fs: mergePlatformFs(context.fs), execPath });
    }
    default: {
      /** @type {never} */
      const unexpected = kind;
      throw new Error(`Unsupported spawnNodeCli kind: ${JSON.stringify(unexpected)}`);
    }
  }
}

export { checkDirPrivacy, ensurePrivateDir, formatPrivateAclCommand, isPrivacyRefusalError, moveSecretFileWin32, writeSecretFile } from "./platform-privacy.mjs";

/**
 * Resolve a Gradle or Maven batch wrapper invocation behind the win32 `cmd.exe` allow-list.
 * On POSIX, returns the request's `file`, `args`, and `options` unchanged.
 * @template [TOptions=PlatformRunnerOptions]
 * @param {BatchWrapperRequest<TOptions>} request
 * @param {PlatformContext} [context]
 * @returns {PlatformSpawnResult<TOptions>}
 */
export function spawnBatchWrapper(request, context = {}) {
  const { platform = process.platform } = context;
  if (platform !== "win32") {
    return { file: request.file, args: request.args, options: request.options };
  }
  return spawnBatchWin32(request, context);
}
