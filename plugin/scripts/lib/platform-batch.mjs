// @ts-check
// The win32 half of `spawnBatchWrapper`, the one primitive Gradle and Maven may use: Node refuses
// to spawn a `.bat`/`.cmd` file without a shell (CVE-2024-27980), and a `cmd.exe` command line
// re-parses metacharacters, so every token is checked against an allow-list and quoted before the
// whole line reaches `cmd.exe` with `windowsVerbatimArguments`.
//
// `platform.mjs` dispatches here only when `platform === "win32"`; on POSIX it returns the call's
// file, args and options unchanged, so nothing here is observable on macOS or Linux. The module
// also owns the launcher's default choice, because "the project's wrapper" is a different file per
// platform (`gradlew` there, `gradlew.bat` here) and both halves must agree.
import { existsSync as fsExistsSync } from "node:fs";
import { join, win32 } from "node:path";
import {
  BATCH_EXTENSIONS,
  EXE_EXTENSION,
  findWin32CommandHit,
  mergePlatformFs,
  readEnv,
} from "./platform-path.mjs";
/** @import { BatchArgToken, BatchWrapperRequest, PlatformContext, PlatformRefusal, PlatformRunnerOptions, PlatformSpawnResult } from "./platform.mjs" */

/**
 * Every character a token passed to `cmd.exe` may contain: letters, digits, `_`, `.`, `,`, `:`, `=`,
 * `+`, `#`, `$`, `/`, `\`, `@`, `[`, `]`, space, `'` and `-`. Everything else — `(`, `)`, `!`, `%`,
 * `"`, `^`, `&`, `|`, `<`, `>`, and control characters — `cmd.exe` re-parses, so it is refused.
 * @type {RegExp}
 */
export const BATCH_ARGUMENT = /^[A-Za-z0-9_.,:=+#$/\\@[\] '-]+$/;

/** The interpreter Windows names in `%ComSpec%`. */
const DEFAULT_COMSPEC = "C:\\Windows\\System32\\cmd.exe";

/**
 * A filesystem reader and a child's environment, as resolution needs them.
 * @typedef {{
 *   cwd: string,
 *   env: NodeJS.ProcessEnv,
 *   exists: (path: string) => boolean,
 * }} LauncherResolution
 */

/**
 * Either a resolved launcher or the refusal that stops the invocation.
 * @typedef {{ file: string } | { refusal: PlatformRefusal }} LauncherResult
 */

/**
 * Whether a launcher names a path (so it is resolved against the working directory) rather than a
 * bare command looked up on `PATH`.
 * @param {string} file
 * @returns {boolean}
 */
function hasDirectory(file) {
  return /[/\\]/.test(file);
}

/**
 * The first character `cmd.exe` would re-parse (plus its string index), or null when every
 * character is allowed. An empty token has no offending character; the caller refuses it separately.
 * @param {string} value
 * @returns {{ index: number, char: string } | null}
 */
function disallowedChar(value) {
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (!BATCH_ARGUMENT.test(char)) return { index, char };
  }
  return null;
}

/**
 * Resolve attribution for a refused token, drilling into composite `parts` by offending char index.
 * @param {BatchArgToken | undefined} token
 * @param {string} value
 * @param {number} charIndex
 * @returns {string | undefined}
 */
function resolveTokenSource(token, value, charIndex) {
  if (token === undefined || token.value !== value) return undefined;
  if (!token.parts || token.parts.map((part) => part.value).join("") !== value) {
    return token.source;
  }
  let offset = 0;
  for (const part of token.parts) {
    const end = offset + part.value.length;
    if (charIndex < end) return part.source ?? token.source;
    offset = end;
  }
  return token.source;
}

/**
 * Quote one validated token for a `cmd.exe` / CommandLineToArgvW command line, doubling any
 * trailing backslash run before the closing quote so it does not escape `"`.
 * @param {string} part
 * @returns {string}
 */
const quoteBatchToken = (part) => `"${part.replace(/\\+$/, (runs) => runs + runs)}"`;

/**
 * A launcher that does not exist on disk.
 * @param {string} file what the engineer's `project.md` names, or the default command
 * @param {string} expected the fix, naming the file that would make it resolve
 * @param {string | undefined} source `test_runner.launcher` when configured, or undefined when default
 * @returns {PlatformRefusal}
 */
function launcherMissing(file, expected, source) {
  return {
    outcome: "missing",
    code: "command_missing",
    message: source === undefined
      ? `No default Windows launcher ${file}: ${expected}`
      : `No Windows launcher ${file} from ${source}: ${expected}`,
    file,
    ...(source === undefined ? {} : { source }),
  };
}

/**
 * A launcher that exists but is not something this module may run: only `.bat`, `.cmd` and `.exe`
 * are admitted, so a planted `.ps1`, `.vbs` or other `PATHEXT` match is refused rather than run.
 * @param {string} file what the engineer's `project.md` names, or the default command
 * @param {string} found the file that matched
 * @param {string | undefined} source `test_runner.launcher` when configured, or undefined when default
 * @returns {PlatformRefusal}
 */
function launcherNotBatch(file, found, source) {
  return {
    outcome: "refused",
    code: "disallowed_wrapper",
    message: source === undefined
      ? `Default Windows launcher ${JSON.stringify(found)} is not a batch wrapper: expected a .bat, .cmd or .exe file for ${file}`
      : `Windows launcher ${JSON.stringify(found)} from ${source} is not a batch wrapper: expected a .bat, .cmd or .exe file for ${file}`,
    file: found,
    ...(source === undefined ? {} : { source }),
  };
}

/**
 * A launcher path `cmd.exe` would re-parse, so it never reaches the command line.
 * @param {string} file the resolved launcher path
 * @param {string} char the character that stops it
 * @param {string | undefined} source `test_runner.launcher` when configured, or undefined when default
 * @returns {PlatformRefusal}
 */
function launcherMetachar(file, char, source) {
  return {
    outcome: "refused",
    code: "disallowed_metachar",
    message: source === undefined
      ? `Default batch launcher path ${JSON.stringify(file)} contains ${JSON.stringify(char)}: cmd.exe would re-parse it`
      : `Batch launcher path ${JSON.stringify(file)} from ${source} contains ${JSON.stringify(char)}: cmd.exe would re-parse it`,
    file,
    char,
    ...(source === undefined ? {} : { source }),
  };
}

/**
 * A token `cmd.exe` cannot receive. The message names the offending character and where the token
 * came from: the `project.md` key it was configured under, or the Automation whose selector it is.
 * @param {string} value the refused token
 * @param {string | undefined} source the `project.md` key, when the token came from one
 * @param {string | undefined} automation the Automation the token was selected for
 * @param {string | null} char the offending character, or null for an empty token
 * @returns {PlatformRefusal}
 */
function tokenRefusal(value, source, automation, char) {
  const origin = source === undefined ? `for Automation ${automation ?? "an unnamed Automation"}` : `from ${source}`;
  const label = source ?? (automation === undefined ? undefined : `Automation ${automation}`);
  return {
    outcome: "refused",
    code: "disallowed_metachar",
    message:
      char === null
        ? `Batch argument ${JSON.stringify(value)} ${origin} is empty: cmd.exe would drop it`
        : `Batch argument ${JSON.stringify(value)} ${origin} contains ${JSON.stringify(char)}: cmd.exe would re-parse it`,
    ...(label === undefined ? {} : { source: label }),
    ...(char === null ? {} : { char }),
  };
}

/**
 * Resolve a launcher that names a path against the run's working directory: an admitted extension
 * is used as it is, an extensionless `./gradlew`/`./mvnw` maps to its sibling `.bat`/`.cmd`, and
 * anything else is refused.
 * @param {string} file
 * @param {{ cwd: string, exists: (path: string) => boolean, source?: string }} resolution
 * @returns {LauncherResult}
 */
function resolveLauncherPath(file, { cwd, exists, source }) {
  const absolute = win32.resolve(cwd, file);
  const extension = win32.extname(absolute).toLowerCase();
  if (extension === EXE_EXTENSION || BATCH_EXTENSIONS.has(extension)) {
    return exists(absolute) ? { file: absolute } : { refusal: launcherMissing(file, "the file does not exist", source) };
  }
  if (extension === "") {
    const siblings = [...BATCH_EXTENSIONS].map((candidate) => `${absolute}${candidate}`);
    const found = siblings.find((candidate) => exists(candidate));
    return found === undefined
      ? { refusal: launcherMissing(file, `expected ${file}.bat or ${file}.cmd`, source) }
      : { file: found };
  }
  return { refusal: launcherNotBatch(file, absolute, source) };
}

/**
 * Resolve a bare `gradle`/`mvn` through `platform-path.mjs`'s shared `PATH`/`PATHEXT` walker:
 * a `.exe` runs directly, a `.bat`/`.cmd` runs through `cmd.exe`, and any other match is refused.
 * @param {string} name
 * @param {{ env: NodeJS.ProcessEnv, fs: import("./platform.mjs").PlatformFs, probe: "stat" | "exists", source?: string }} resolution
 * @returns {LauncherResult}
 */
function resolveLauncherOnPath(name, { env, fs, probe, source }) {
  const hit = findWin32CommandHit(fs, env, name, { probe });
  if (!hit) {
    return { refusal: launcherMissing(name, `${name} is not on PATH as an .exe, .bat or .cmd file`, source) };
  }
  const admitted = (win32.extname(hit.hitPath) || hit.ext).toLowerCase();
  return admitted === EXE_EXTENSION || BATCH_EXTENSIONS.has(admitted)
    ? { file: hit.hitPath }
    : { refusal: launcherNotBatch(name, hit.hitPath, source) };
}

/**
 * The launcher a Gradle or Maven runner uses when `project.md` names none: the project's own wrapper
 * when its file exists, else the bare tool. The wrapper is `gradlew`/`mvnw` on POSIX and
 * `gradlew.bat`/`mvnw.cmd` on win32, so the same `project.md` serves every OS.
 * @param {"gradle" | "maven"} tool
 * @param {string} cwd
 * @param {PlatformContext} [context]
 * @returns {string}
 */
export function defaultBatchLauncher(tool, cwd, { platform = process.platform, fs } = {}) {
  const exists = fs?.existsSync ?? fsExistsSync;
  const wrapper = tool === "gradle" ? "gradlew" : "mvnw";
  const command = tool === "gradle" ? "gradle" : "mvn";
  if (platform !== "win32") return exists(join(cwd, wrapper)) ? `./${wrapper}` : command;
  const candidates = tool === "gradle" ? ["gradlew.bat", "gradlew.cmd"] : ["mvnw.cmd", "mvnw.bat"];
  const found = candidates.find((candidate) => exists(win32.join(cwd, candidate)));
  return found === undefined ? command : `./${found}`;
}

/**
 * Resolve a Gradle or Maven batch wrapper invocation on win32: check the launcher and every token
 * against the allow-list, quote them, and hand `%ComSpec% /d /s /c` the whole line verbatim.
 * @template [TOptions=PlatformRunnerOptions]
 * @param {BatchWrapperRequest<TOptions>} request
 * @param {PlatformContext} [context]
 * @returns {PlatformSpawnResult<TOptions>}
 */
export function spawnBatchWin32(request, { env = process.env, fs: injectedFs } = {}) {
  const mergedFs = mergePlatformFs(injectedFs);
  const cwd = request.cwd ?? process.cwd();
  const launcher = hasDirectory(request.file)
    ? resolveLauncherPath(request.file, { cwd, exists: mergedFs.existsSync, source: request.source })
    : resolveLauncherOnPath(request.file, { env, fs: mergedFs, probe: injectedFs?.statSync ? "stat" : "exists", source: request.source });
  if ("refusal" in launcher) return { refusal: launcher.refusal };

  // An .exe needs no shell, so its arguments reach it exactly as the call site wrote them.
  if (win32.extname(launcher.file).toLowerCase() === EXE_EXTENSION) {
    return { file: launcher.file, args: request.args, options: request.options };
  }
  const launcherBad = disallowedChar(launcher.file);
  if (launcherBad !== null) return { refusal: launcherMetachar(launcher.file, launcherBad.char, request.source) };

  const tokens = request.tokens ?? [];
  for (const [index, value] of request.args.entries()) {
    const token = tokens[index];
    if (value === "") {
      // A token list that disagrees with the arguments is ignored rather than misattributed.
      const source = token !== undefined && token.value === value ? token.source : undefined;
      return { refusal: tokenRefusal(value, source, request.automation, null) };
    }
    const bad = disallowedChar(value);
    if (bad !== null) {
      const source = resolveTokenSource(token, value, bad.index);
      return { refusal: tokenRefusal(value, source, request.automation, bad.char) };
    }
  }

  // cmd.exe's `/s` strips one surrounding quote pair, so the line carries its own pair around the
  // quoted launcher and arguments; each token is quoted so a space (or a `,` or `=`) cannot split it.
  const commandLine = `"${[launcher.file, ...request.args].map(quoteBatchToken).join(" ")}"`;
  /** @type {TOptions} */
  const options = /** @type {TOptions} */ ({ ...request.options, shell: false, windowsVerbatimArguments: true });
  return {
    file: readEnv(env, "ComSpec") ?? DEFAULT_COMSPEC,
    args: ["/d", "/s", "/c", commandLine],
    options,
  };
}
