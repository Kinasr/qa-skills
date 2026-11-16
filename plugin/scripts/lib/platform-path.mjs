// @ts-check
// Windows (`win32`) PATH walk and `@playwright/cli` shim resolution.
// POSIX callers bypass this module in `platform.mjs` and execute unchanged.
import { accessSync, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { win32 } from "node:path";

/** @import { NodeCliRequest, PlatformContext, PlatformFs, PlatformRefusal, PlatformRunnerOptions, PlatformSpawnResult } from "./platform.mjs" */

/** Default `PATHEXT` precedence order used on `win32` when `PATHEXT` is unset or blank. */
export const DEFAULT_WIN32_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"];

/** Executable extension that runs directly without a Node host or shell. */
export const EXE_EXTENSION = ".exe";

/** Batch wrapper extensions requiring `cmd.exe` (disallowed for Node CLI launches). */
export const BATCH_EXTENSIONS = new Set([".bat", ".cmd"]);

/** Node script extensions dispatched through `process.execPath`. */
export const NODE_SCRIPT_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);

/**
 * Default Node filesystem reader surface used across platform resolution and privacy checks.
 * @type {PlatformFs}
 */
export const DEFAULT_PLATFORM_FS = {
  existsSync,
  statSync,
  accessSync,
  readFileSync: (filePath, encoding) => readFileSync(filePath, { encoding }),
  realpathSync,
};

/**
 * Merge a partial `PlatformFs` override with `DEFAULT_PLATFORM_FS`.
 * @param {Partial<PlatformFs>} [fs]
 * @returns {PlatformFs}
 */
export function mergePlatformFs(fs) {
  return fs ? { ...DEFAULT_PLATFORM_FS, ...fs } : DEFAULT_PLATFORM_FS;
}

/**
 * Read a Windows environment variable case-insensitively across plain mock objects.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @returns {string | undefined}
 */
export function readEnv(env, name) {
  if (env[name] !== undefined) return env[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === lower) return env[key];
  }
  return undefined;
}

/**
 * Split `PATH` strictly on `;` for `win32` and strip surrounding quotes.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function pathDirs(env) {
  const raw = readEnv(env, "PATH") ?? "";
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .map((entry) => (entry.startsWith("\"") && entry.endsWith("\"") && entry.length >= 2 ? entry.slice(1, -1) : entry))
    .filter(Boolean);
}

/**
 * Resolve `PATHEXT` entries in precedence order.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function pathExts(env) {
  const raw = readEnv(env, "PATHEXT");
  if (!raw || !raw.trim()) return DEFAULT_WIN32_PATHEXT;
  const exts = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
  return exts.length > 0 ? exts : DEFAULT_WIN32_PATHEXT;
}

/**
 * Return the first candidate path naming an existing file (`stat` checks `isFile()`, `exists` checks `existsSync`).
 * @param {PlatformFs} fs
 * @param {readonly string[]} candidates
 * @param {"stat" | "exists"} probe
 * @returns {string | null}
 */
function existingFile(fs, candidates, probe = "stat") {
  for (const path of new Set(candidates)) {
    try {
      const ok = probe === "exists" ? fs.existsSync(path) : fs.statSync(path).isFile();
      if (ok) return path;
    } catch {
      // Absent or unreadable entries continue the PATH walk.
    }
  }
  return null;
}

/**
 * Find the first file match on `PATH` using `PATHEXT`, or resolve an explicit path.
 * @param {PlatformFs} fs
 * @param {NodeJS.ProcessEnv} env
 * @param {string} command
 * @param {{ probe?: "stat" | "exists" }} [options]
 * @returns {{ hitPath: string, ext: string, dir: string } | null}
 */
export function findWin32CommandHit(fs, env, command, options = {}) {
  if (!command) return null;
  const probe = options.probe ?? "stat";
  const exts = pathExts(env);
  if (win32.isAbsolute(command) || /[\\/]/.test(command)) {
    const dir = win32.dirname(command);
    const base = win32.basename(command);
    const explicitExt = win32.extname(base);
    if (explicitExt) {
      const hit = existingFile(fs, [command], probe);
      return hit ? { hitPath: hit, ext: explicitExt, dir } : null;
    }
    for (const ext of exts) {
      const hit = existingFile(
        fs,
        [win32.join(dir, base + ext.toLowerCase()), win32.join(dir, base + ext), win32.join(dir, base + ext.toUpperCase())],
        probe,
      );
      if (hit) return { hitPath: hit, ext, dir };
    }
    return null;
  }

  const dirs = pathDirs(env);
  const explicitExt = win32.extname(command);
  for (const dir of dirs) {
    if (explicitExt) {
      const hit = existingFile(fs, [win32.join(dir, command)], probe);
      if (hit) return { hitPath: hit, ext: explicitExt, dir };
      continue;
    }
    for (const ext of exts) {
      const hit = existingFile(
        fs,
        [win32.join(dir, command + ext.toLowerCase()), win32.join(dir, command + ext), win32.join(dir, command + ext.toUpperCase())],
        probe,
      );
      if (hit) return { hitPath: hit, ext, dir };
    }
  }
  return null;
}

/**
 * Verify that `targetPath` resolves strictly inside `rootDir`.
 * @param {string} rootDir
 * @param {string} targetPath
 * @returns {boolean}
 */
function isConfinedToDir(rootDir, targetPath) {
  const rel = win32.relative(win32.resolve(rootDir), win32.resolve(targetPath));
  return Boolean(rel) && rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../") && !win32.isAbsolute(rel);
}

/**
 * Locate the `@playwright/cli` package directory accompanying a `<dir>\playwright-cli.cmd` shim.
 * Checks the global npm layout first, then the local `.bin` layout when `dir` is `.bin`.
 * @param {PlatformFs} fs
 * @param {string} dir
 * @returns {{ pkgDir: string, pkgJsonPath: string } | null}
 */
function findPlaywrightPackage(fs, dir) {
  const candidates = [win32.join(dir, "node_modules", "@playwright", "cli")];
  if (win32.basename(dir).toLowerCase() === ".bin") {
    candidates.push(win32.resolve(dir, "..", "@playwright", "cli"));
  }
  for (const pkgDir of candidates) {
    const pkgJsonPath = win32.join(pkgDir, "package.json");
    if (existingFile(fs, [pkgJsonPath])) return { pkgDir, pkgJsonPath };
  }
  return null;
}

/**
 * Construct a typed refusal result for win32 PATH resolution failures.
 * @param {PlatformRefusal["outcome"]} outcome
 * @param {PlatformRefusal["code"]} code
 * @param {string} message
 * @param {string} command
 * @param {string} [file]
 * @param {string} [source]
 * @returns {{ refusal: PlatformRefusal }}
 */
function fail(outcome, code, message, command, file, source) {
  return {
    refusal: {
      outcome,
      code,
      message,
      command,
      ...(file !== undefined && { file }),
      ...(source !== undefined && { source }),
    },
  };
}

/**
 * Resolve `playwright-cli.cmd` via `@playwright/cli`'s confined `bin` entry.
 * Never invokes `npm root -g` or parses the `.cmd` script.
 * @template [TOptions=PlatformRunnerOptions]
 * @param {NodeCliRequest<TOptions>} request
 * @param {PlatformFs} fs
 * @param {string} execPath
 * @param {string} dir
 * @param {string} hitPath
 * @returns {PlatformSpawnResult<TOptions>}
 */
function resolvePlaywrightCmdShim(request, fs, execPath, dir, hitPath) {
  const pkgLocation = findPlaywrightPackage(fs, dir);
  if (!pkgLocation) {
    return fail("refused", "unresolvable_shim", `Refusing win32 shim ${hitPath}: accompanying @playwright/cli package.json was not found`, request.file, hitPath);
  }
  const { pkgDir, pkgJsonPath } = pkgLocation;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  } catch {
    return fail("refused", "unresolvable_shim", `Refusing win32 shim ${hitPath}: @playwright/cli package.json is unreadable or invalid JSON`, request.file, hitPath, pkgJsonPath);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("refused", "unresolvable_shim", `Refusing win32 shim ${hitPath}: @playwright/cli package.json must be an object`, request.file, hitPath, pkgJsonPath);
  }
  const rawBin = /** @type {{ bin?: unknown }} */ (parsed).bin;
  const binEntry = typeof rawBin === "string"
    ? rawBin
    : rawBin && typeof rawBin === "object" && !Array.isArray(rawBin)
      ? /** @type {Record<string, unknown>} */ (rawBin)["playwright-cli"]
      : undefined;
  if (typeof binEntry !== "string" || !binEntry.trim()) {
    return fail("refused", "unresolvable_shim", `Refusing win32 shim ${hitPath}: @playwright/cli package.json has no playwright-cli bin entry`, request.file, hitPath, pkgJsonPath);
  }

  const pkgResolved = win32.resolve(pkgDir);
  const resolvedEntry = win32.resolve(pkgResolved, binEntry);
  if (!isConfinedToDir(pkgResolved, resolvedEntry)) {
    return fail("refused", "unconfined_bin", `Refusing win32 shim ${hitPath}: bin entry escapes @playwright/cli package directory`, request.file, hitPath, resolvedEntry);
  }
  let realPkg;
  let realEntry;
  try {
    realPkg = fs.realpathSync(pkgResolved);
    realEntry = fs.realpathSync(resolvedEntry);
  } catch {
    // Missing targets fall through to existingFile below so they report unresolvable_shim.
  }
  if (realPkg && realEntry && !isConfinedToDir(realPkg, realEntry)) {
    return fail("refused", "unconfined_bin", `Refusing win32 shim ${hitPath}: resolved bin symlink escapes @playwright/cli package directory`, request.file, hitPath, realEntry);
  }
  if (!existingFile(fs, [resolvedEntry])) {
    return fail("refused", "unresolvable_shim", `Refusing win32 shim ${hitPath}: bin entry ${resolvedEntry} does not exist`, request.file, hitPath, resolvedEntry);
  }
  return { file: execPath, args: [resolvedEntry, ...request.args], options: request.options };
}

/**
 * Resolve a `playwright-cli` or `path-tool` invocation on `win32`.
 * Walks `PATH` and `PATHEXT` in JS without `cmd.exe` or `npm root -g`.
 * @template [TOptions=PlatformRunnerOptions]
 * @param {NodeCliRequest<TOptions>} request
 * @param {{ env: NodeJS.ProcessEnv, fs: PlatformFs, execPath: string }} context
 * @returns {PlatformSpawnResult<TOptions>}
 */
export function resolveWin32PathCommand(request, { env, fs, execPath }) {
  const hit = findWin32CommandHit(fs, env, request.file);
  if (!hit) {
    return fail("missing", "command_missing", `Command ${JSON.stringify(request.file)} was not found on win32 PATH`, request.file, request.file);
  }
  const extLower = hit.ext.toLowerCase();
  if (extLower === EXE_EXTENSION) {
    return { file: hit.hitPath, args: request.args, options: request.options };
  }
  if (request.kind === "playwright-cli" && extLower === ".cmd") {
    return resolvePlaywrightCmdShim(request, fs, execPath, hit.dir, hit.hitPath);
  }
  return fail("refused", "disallowed_wrapper", `Refusing win32 wrapper ${hit.hitPath} for ${request.file}`, request.file, hit.hitPath);
}
