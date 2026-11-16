// @ts-check
// Windows ACL privacy check and safe secret-file helpers.
// Reads directory DACLs via `icacls /save` + `whoami /user` without ever mutating ACLs.
// POSIX callers return immediately with `{ ok: true }` so macOS/Linux behavior stays unchanged.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join as nativeJoin, win32 as win32Path } from "node:path";
import { readEnv } from "./platform-path.mjs";

/** @import { PlatformContext, PlatformRefusal, PlatformRunner, PlatformRunnerOptions } from "./platform.mjs" */

/**
 * Result of checking directory privacy on Windows.
 * @typedef {{ ok: true } | { ok: false, refusal: PlatformRefusal }} PrivacyCheckResult
 */

/**
 * Error instance carrying a typed `PlatformRefusal` from synchronous secret-file helpers.
 * @typedef {Error & { refusal: PlatformRefusal }} PrivacyRefusalThrownError
 */

/**
 * Create an `Error` tagged with `refusal` for synchronous secret helpers on `win32`.
 * @param {PlatformRefusal} refusal
 * @returns {PrivacyRefusalThrownError}
 */
export function createPrivacyRefusalError(refusal) {
  return Object.assign(new Error(refusal.message), { name: "PrivacyRefusalError", refusal });
}

/**
 * Narrow an unknown thrown value to a privacy refusal error.
 * @param {unknown} error
 * @returns {error is PrivacyRefusalThrownError}
 */
export function isPrivacyRefusalError(error) {
  return error instanceof Error && "refusal" in error && typeof error.refusal === "object" && error.refusal !== null;
}

/**
 * Options controlling privacy refusal remediation wording and POSIX mode handling.
 * @typedef {{
 *   suggestDir?: boolean,
 *   chmodExisting?: boolean,
 * }} PrivacyCheckOptions
 */

/**
 * Minimal filesystem surface used when testing secret-site directory/file writes.
 * @typedef {{
 *   mkdirSync?: (path: string, options?: { recursive?: boolean, mode?: number }) => string | undefined | void,
 *   chmodSync?: (path: string, mode: number) => void,
 *   lstatSync?: (path: string, options?: { throwIfNoEntry?: boolean }) => { isSymbolicLink(): boolean, isDirectory(): boolean, uid?: number } | undefined,
 *   writeFileSync?: (path: string, data: string | Uint8Array, options?: { flag?: string, mode?: number }) => void,
 *   renameSync?: (oldPath: string, newPath: string) => void,
 *   rmSync?: (path: string, options?: { recursive?: boolean, force?: boolean }) => void,
 *   mkdtempSync?: (prefix: string) => string,
 *   readFileSync?: (path: string, encoding: BufferEncoding) => string,
 *   existsSync?: (path: string) => boolean,
 *   statSync?: (path: string) => { isFile(): boolean, isDirectory?: () => boolean },
 *   accessSync?: (path: string, mode?: number) => void,
 *   realpathSync?: (path: string) => string,
 * }} PrivacyFs
 */

/**
 * Extended context for privacy helpers, accepting extra test-injected fs write methods.
 * @typedef {Omit<PlatformContext, "fs"> & { fs?: PrivacyFs }} PrivacyContext
 */

const SYSTEM_SID = "S-1-5-18";
const BUILTIN_ADMINS_SID = "S-1-5-32-544";
const CREATOR_OWNER_SID = "S-1-3-0";
const CREATOR_GROUP_OWNER_SID = "S-1-3-4";

/** @type {Record<string, string>} */
const SDDL_SID_ALIASES = {
  SY: SYSTEM_SID,
  BA: BUILTIN_ADMINS_SID,
  CO: CREATOR_OWNER_SID,
  OW: CREATOR_GROUP_OWNER_SID,
  WD: "S-1-1-0",
  AU: "S-1-5-11",
  IU: "S-1-5-4",
  BU: "S-1-5-32-545",
  BG: "S-1-5-32-546",
  PU: "S-1-5-32-547",
  SU: "S-1-5-6",
  AN: "S-1-5-7",
  LS: "S-1-5-19",
  NS: "S-1-5-20",
  RC: "S-1-5-12",
  AC: "S-1-15-2-1",
};

// SDDL rights tokens and bitmask flags that grant read, list, write, or ownership/ACL power.
const EXPOSED_SDDL_RIGHT_TOKENS = new Set([
  "GA", "GR", "GW", "GE", "WO", "WD",
  "FA", "FR", "FW",
  "CC", "DC", "LC", "SD", "RC",
  "KA", "KR", "KW", "CR", "WP", "RP", "LO", "DT",
]);
// Known execute/traverse-only SDDL rights tokens; anything else fails closed.
const KNOWN_HARMLESS_SDDL_RIGHT_TOKENS = new Set(["FX", "GX", "KX"]);
const DEFAULT_SYSTEM_ROOT = "C:\\Windows";
// Read/List/Traverse bits (FILE_READ_DATA 0x1, FILE_WRITE_DATA 0x2, FILE_APPEND_DATA 0x4,
// FILE_READ_EA 0x8, FILE_READ_ATTRIBUTES 0x80, READ_CONTROL 0x20000, WRITE_DAC 0x40000,
// WRITE_OWNER 0x80000, GENERIC_ALL 0x10000000, GENERIC_WRITE 0x40000000, GENERIC_READ 0x80000000).
const EXPOSED_ACCESS_MASK_BITS = 0xD00E008F;

/**
 * Resolve absolute win32 System32 paths for `whoami.exe` and `icacls.exe`, or return null when
 * `SystemRoot` is non-empty and not an absolute win32 drive/UNC root.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ whoami: string, icacls: string } | null}
 */
function resolveSystemTools(env) {
  const rawRoot = readEnv(env, "SystemRoot");
  const systemRoot = rawRoot !== undefined && rawRoot.trim() !== "" ? rawRoot.trim() : DEFAULT_SYSTEM_ROOT;
  const isAbsoluteWin32 = win32Path.isAbsolute(systemRoot) && (/^[A-Za-z]:[\\/]/.test(systemRoot) || /^\\\\[^\\]+\\[^\\]+/.test(systemRoot));
  if (!isAbsoluteWin32) return null;
  return {
    whoami: win32Path.join(systemRoot, "System32", "whoami.exe"),
    icacls: win32Path.join(systemRoot, "System32", "icacls.exe"),
  };
}

/**
 * Default runner wrapping Node's `spawnSync`.
 * @param {string} file
 * @param {readonly string[]} args
 * @param {PlatformRunnerOptions} [options]
 * @returns {import("./platform.mjs").PlatformRunnerResult}
 */
function defaultRunner(file, args, options = {}) {
  const res = spawnSync(file, args, {
    encoding: options.encoding ?? "utf8",
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout,
    killSignal: options.killSignal,
    maxBuffer: options.maxBuffer,
    windowsVerbatimArguments: options.windowsVerbatimArguments,
    shell: options.shell,
  });
  return {
    status: res.status,
    stdout: typeof res.stdout === "string" ? res.stdout : String(res.stdout ?? ""),
    stderr: typeof res.stderr === "string" ? res.stderr : String(res.stderr ?? ""),
    error: res.error,
  };
}

/**
 * Extract a unique Windows user SID from `whoami.exe /user` output without relying on localized headers.
 * @param {PlatformRunner} run
 * @param {NodeJS.ProcessEnv} env
 * @param {string} whoamiPath
 * @returns {string | null}
 */
function readUserSid(run, env, whoamiPath) {
  const res = run(whoamiPath, ["/user"], { env, encoding: "utf8" });
  if (res.error || res.status !== 0) return null;
  const matches = res.stdout.match(/\bS-1-\d+(?:-\d+)+\b/g) ?? [];
  const distinct = [...new Set(matches.map((s) => s.toUpperCase()))];
  return distinct.length === 1 ? distinct[0] : null;
}

/**
 * Build the remediation `icacls` command string for granting private access on `dir`.
 * @param {string} dir
 * @param {string | null} userSid
 * @returns {string}
 */
export function formatPrivateAclCommand(dir, userSid) {
  const userTarget = userSid ? `*${userSid}` : "%USERNAME%";
  return `icacls "${dir}" /inheritance:r /grant:r "*${SYSTEM_SID}:(OI)(CI)F" "*${BUILTIN_ADMINS_SID}:(OI)(CI)F" "${userTarget}:(OI)(CI)F"`;
}

/**
 * Format remediation guidance respecting whether the command supports `--dir`.
 * @param {string} dir
 * @param {string} reason
 * @param {string} command
 * @param {boolean} suggestDir
 * @returns {string}
 */
function formatPrivacyRefusalMessage(dir, reason, command, suggestDir) {
  const locationHint = suggestDir
    ? "Use a private `--dir` or set `TEMP` to a private directory, or fix permissions with:"
    : "Set `TEMP` to a private directory, or fix permissions with:";
  return `Refusing to store secrets in "${dir}": ${reason}. ${locationHint}\n  ${command}`;
}

/**
 * Parse SDDL section headers (`O:`, `G:`, `D:`, `S:`) outside ACE parentheses.
 * In SDDL syntax, `:` at parenthesis depth 0 appears solely as the `O:` / `G:` / `D:` / `S:` section marker.
 * @param {string} sddl
 * @returns {Record<string, string> | null}
 */
function extractSddlSections(sddl) {
  const trimmed = sddl.trim();
  let depth = 0;
  let currentTag = "";
  let currentStart = -1;
  /** @type {Record<string, string>} */
  const sections = {};
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      if (depth === 0) return null;
      depth -= 1;
      continue;
    }
    if (depth === 0 && ch === ":" && i > 0) {
      const tag = trimmed[i - 1].toUpperCase();
      if (tag === "O" || tag === "G" || tag === "D" || tag === "S") {
        if (Object.hasOwn(sections, tag) || tag === currentTag) return null;
        if (currentTag) sections[currentTag] = trimmed.slice(currentStart, i - 1).trim();
        currentTag = tag;
        currentStart = i + 1;
      }
    }
  }
  if (depth !== 0) return null;
  if (currentTag) sections[currentTag] = trimmed.slice(currentStart).trim();
  return sections;
}

/**
 * Split a DACL string into top-level ACE tuples `(type;flags;rights;objGuid;inhGuid;sid)`.
 * @param {string} daclBody
 * @returns {string[] | null}
 */
function parseAceStrings(daclBody) {
  if (!daclBody || /^NO_ACCESS_CONTROL$/i.test(daclBody)) return null;
  const firstParen = daclBody.indexOf("(");
  if (firstParen === -1) {
    // Protected or inherited DACL flags with zero ACEs grants nobody access (valid/private if well-formed).
    return /^[PAIQR]*$/i.test(daclBody) ? [] : null;
  }
  const headerFlags = daclBody.slice(0, firstParen).trim();
  if (headerFlags && !/^[PAIQR]*$/i.test(headerFlags)) return null;
  /** @type {string[]} */
  const aces = [];
  let i = firstParen;
  while (i < daclBody.length) {
    if (daclBody[i] !== "(") return null;
    const close = daclBody.indexOf(")", i + 1);
    if (close === -1) return null;
    aces.push(daclBody.slice(i + 1, close));
    i = close + 1;
  }
  return aces;
}

/**
 * Determine whether an ACE's rights field exposes read/list/write access. Fails closed on unknown tokens.
 * @param {string} rightsField
 * @returns {boolean}
 */
function rightsExposeAccess(rightsField) {
  const raw = rightsField.trim().toUpperCase();
  if (!raw) return true;
  if (raw.startsWith("0X")) {
    if (!/^0X[0-9A-F]+$/.test(raw)) return true;
    const mask = Number.parseInt(raw.slice(2), 16);
    if (!Number.isFinite(mask)) return true;
    return (mask & EXPOSED_ACCESS_MASK_BITS) !== 0;
  }
  if (raw.length % 2 !== 0) return true;
  for (let i = 0; i < raw.length; i += 2) {
    const token = raw.slice(i, i + 2);
    if (EXPOSED_SDDL_RIGHT_TOKENS.has(token) || !KNOWN_HARMLESS_SDDL_RIGHT_TOKENS.has(token)) return true;
  }
  return false;
}

/**
 * Resolve an SDDL SID or two-letter alias to an uppercase SID string.
 * @param {string} trustee
 * @returns {string}
 */
function resolveTrusteeSid(trustee) {
  const upper = trustee.trim().toUpperCase();
  return SDDL_SID_ALIASES[upper] ?? upper;
}

/**
 * Evaluate whether an `icacls /save` SDDL string restricts read/write access to SYSTEM,
 * BUILTIN\Administrators, `userSid`, and inherit-only Creator Owner / Owner Rights.
 * @param {string} rawText
 * @param {string} userSid
 * @returns {{ valid: boolean, private: boolean, reason?: string }}
 */
function analyzeIcaclsSave(rawText, userSid) {
  const clean = rawText.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { valid: false, private: false, reason: "icacls /save output was empty or incomplete" };
  }
  const sddl = lines[1];
  const sections = extractSddlSections(sddl);
  if (sections === null || !Object.hasOwn(sections, "D")) {
    return { valid: false, private: false, reason: "directory DACL is missing from icacls /save output" };
  }
  const daclBody = sections.D;
  if (/^NO_ACCESS_CONTROL$/i.test(daclBody)) {
    return { valid: true, private: false, reason: "directory has null DACL (NO_ACCESS_CONTROL)" };
  }
  const aceStrings = parseAceStrings(daclBody);
  if (aceStrings === null) {
    return { valid: false, private: false, reason: `directory has unparseable or unrestricted DACL (${daclBody})` };
  }
  const normalizedUserSid = userSid.toUpperCase();
  if (Object.hasOwn(sections, "O")) {
    const rawOwner = sections.O;
    if (!rawOwner) {
      return { valid: false, private: false, reason: "directory owner O: in icacls /save output is empty" };
    }
    const ownerSid = resolveTrusteeSid(rawOwner);
    if (ownerSid !== SYSTEM_SID && ownerSid !== BUILTIN_ADMINS_SID && ownerSid !== normalizedUserSid) {
      return {
        valid: true,
        private: false,
        reason: `directory owner ${ownerSid} is not current user, SYSTEM, or Administrators`,
      };
    }
  }
  for (const ace of aceStrings) {
    const parts = ace.split(";");
    if (parts.length !== 6) {
      return { valid: false, private: false, reason: `malformed ACE in DACL (${ace})` };
    }
    const aceType = parts[0].trim().toUpperCase();
    const aceFlags = parts[1].trim().toUpperCase();
    const rights = parts[2].trim();
    const trusteeSid = resolveTrusteeSid(parts[5]);

    if (aceType === "D" || aceType === "OD") continue;
    if (aceType !== "A" && aceType !== "OA") {
      return { valid: false, private: false, reason: `unsupported ACE type "${aceType}" in DACL` };
    }

    const isAllowedPrincipal = trusteeSid === SYSTEM_SID
      || trusteeSid === BUILTIN_ADMINS_SID
      || trusteeSid === normalizedUserSid;
    const isInheritOnlyCreator = (trusteeSid === CREATOR_OWNER_SID || trusteeSid === CREATOR_GROUP_OWNER_SID)
      && aceFlags.includes("IO");

    if (!isAllowedPrincipal && !isInheritOnlyCreator && rightsExposeAccess(rights)) {
      return {
        valid: true,
        private: false,
        reason: `directory ACL grants access to ${trusteeSid}`,
      };
    }
  }
  return { valid: true, private: true };
}

/**
 * Inspect `dir`'s ACL on `win32` without modifying permissions.
 * Immediately succeeds on POSIX (`darwin`, `linux`, etc.).
 * @param {string} dir
 * @param {PrivacyContext} [context]
 * @param {PrivacyCheckOptions} [options]
 * @returns {PrivacyCheckResult}
 */
export function checkDirPrivacy(dir, context = {}, options = {}) {
  const platform = context.platform ?? process.platform;
  if (platform !== "win32") return { ok: true };

  const env = context.env ?? process.env;
  const run = context.run ?? defaultRunner;
  const suggestDir = options.suggestDir ?? true;

  const tools = resolveSystemTools(env);
  if (!tools) {
    const command = formatPrivateAclCommand(dir, null);
    return {
      ok: false,
      refusal: {
        outcome: "refused",
        code: "acl_unreadable",
        message: formatPrivacyRefusalMessage(dir, "invalid `SystemRoot` for Windows ACL tools", command, suggestDir),
        file: dir,
        command,
      },
    };
  }

  const userSid = readUserSid(run, env, tools.whoami);
  if (!userSid) {
    const command = formatPrivateAclCommand(dir, null);
    return {
      ok: false,
      refusal: {
        outcome: "refused",
        code: "acl_unreadable",
        message: formatPrivacyRefusalMessage(dir, "could not determine current user SID via `whoami /user`", command, suggestDir),
        file: dir,
        command,
      },
    };
  }

  const scratchRoot = env.LOCALAPPDATA || env.USERPROFILE || env.TEMP || env.TMP || ".";
  const pathJoin = /^[A-Za-z]:[\\/]|^\\\\/.test(scratchRoot) || scratchRoot.includes("\\") ? win32Path.join : nativeJoin;
  let realScratchDir = "";
  let saveFile = "";
  try {
    if (context.fs) {
      if (context.fs.mkdtempSync) {
        const scratchDir = context.fs.mkdtempSync(pathJoin(scratchRoot, "qa-acl-"));
        saveFile = pathJoin(scratchDir, "acl.sav");
      } else {
        saveFile = pathJoin(scratchRoot, `qa-acl-${randomUUID()}.sav`);
      }
    } else {
      realScratchDir = mkdtempSync(pathJoin(scratchRoot, "qa-acl-"));
      saveFile = pathJoin(realScratchDir, "acl.sav");
    }

    const icaclsRes = run(tools.icacls, [dir, "/save", saveFile], { env, encoding: "utf8" });
    if (icaclsRes.error || icaclsRes.status !== 0) {
      const command = formatPrivateAclCommand(dir, userSid);
      return {
        ok: false,
        refusal: {
          outcome: "refused",
          code: "acl_unreadable",
          message: formatPrivacyRefusalMessage(dir, "`icacls /save` failed to read the directory ACL", command, suggestDir),
          file: dir,
          command,
        },
      };
    }

    let rawAcl;
    try {
      const reader = context.fs?.readFileSync ?? readFileSync;
      rawAcl = reader(saveFile, "utf16le");
    } catch {
      const command = formatPrivateAclCommand(dir, userSid);
      return {
        ok: false,
        refusal: {
          outcome: "refused",
          code: "acl_unreadable",
          message: formatPrivacyRefusalMessage(dir, "could not read `icacls /save` output file", command, suggestDir),
          file: dir,
          command,
        },
      };
    }

    const verdict = analyzeIcaclsSave(rawAcl, userSid);
    if (!verdict.valid) {
      const command = formatPrivateAclCommand(dir, userSid);
      return {
        ok: false,
        refusal: {
          outcome: "refused",
          code: "acl_unreadable",
          message: formatPrivacyRefusalMessage(dir, verdict.reason ?? "directory ACL could not be parsed", command, suggestDir),
          file: dir,
          command,
        },
      };
    }

    if (!verdict.private) {
      const command = formatPrivateAclCommand(dir, userSid);
      return {
        ok: false,
        refusal: {
          outcome: "refused",
          code: "acl_not_private",
          message: formatPrivacyRefusalMessage(dir, verdict.reason ?? "directory is readable by other users", command, suggestDir),
          file: dir,
          command,
        },
      };
    }

    return { ok: true };
  } finally {
    if (realScratchDir) {
      try {
        rmSync(realScratchDir, { recursive: true, force: true });
      } catch {
        // Best-effort scratch cleanup.
      }
    } else if (saveFile && context.fs?.rmSync) {
      try {
        context.fs.rmSync(saveFile, { force: true });
      } catch {
        // Best-effort mock scratch cleanup.
      }
    }
  }
}

/**
 * Check whether an fs errno code indicates a planted target or permission block on secret files/dirs.
 * @param {unknown} error
 * @returns {boolean}
 */
function isTargetBlockedError(error) {
  const code = /** @type {NodeJS.ErrnoException | undefined} */ (error)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EISDIR" || code === "ELOOP";
}

/**
 * Build a refusal for an unwritable or planted secret target path on win32.
 * @param {string} target
 * @param {string} detail
 * @param {boolean} suggestDir
 * @returns {PlatformRefusal}
 */
function secretTargetRefusal(target, detail, suggestDir) {
  const locationHint = suggestDir
    ? "Use a fresh private `--dir` or `TEMP` directory."
    : "Check permissions on `TEMP` and remove any read-only or symlinked target.";
  return {
    outcome: "refused",
    code: "secret_target_unwritable",
    message: `Refusing to write secret target "${target}": ${detail}. ${locationHint}`,
    file: target,
  };
}

/**
 * Ensure `dir` exists and is private.
 * On POSIX, creates with `mode: 0o700` and enforces `chmodSync(..., 0o700)`.
 * On `win32`, creates `dir` and verifies its DACL via `checkDirPrivacy` without altering ACLs.
 * @param {string} dir
 * @param {PrivacyContext} [context]
 * @param {PrivacyCheckOptions} [options]
 * @returns {PrivacyCheckResult}
 */
export function ensurePrivateDir(dir, context = {}, options = {}) {
  const platform = context.platform ?? process.platform;
  const mkdirFn = context.fs?.mkdirSync ?? mkdirSync;
  const chmodFn = context.fs?.chmodSync ?? chmodSync;
  const suggestDir = options.suggestDir ?? true;
  const chmodExisting = options.chmodExisting ?? true;

  if (platform !== "win32") {
    mkdirFn(dir, { recursive: true, mode: 0o700 });
    if (chmodExisting) chmodFn(dir, 0o700);
    return { ok: true };
  }

  try {
    mkdirFn(dir, { recursive: true });
  } catch (error) {
    if (isTargetBlockedError(error)) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      return { ok: false, refusal: secretTargetRefusal(dir, `${code} while creating secret directory`, suggestDir) };
    }
    throw error;
  }
  return checkDirPrivacy(dir, context, options);
}

/**
 * Move an already-created secret file `fromPath` into `targetPath` on `win32`, refusing
 * `EPERM`/`EACCES` or a planted symlink/directory target. On POSIX, performs `chmod 0o600` + `renameSync`.
 * @param {string} fromPath
 * @param {string} targetPath
 * @param {PrivacyContext} [context]
 * @param {PrivacyCheckOptions} [options]
 * @returns {{ ok: true, path: string } | { ok: false, refusal: PlatformRefusal }}
 */
export function moveSecretFileWin32(fromPath, targetPath, context = {}, options = {}) {
  const platform = context.platform ?? process.platform;
  const chmodFn = context.fs?.chmodSync ?? chmodSync;
  const renameFn = context.fs?.renameSync ?? renameSync;
  const lstatFn = context.fs?.lstatSync ?? lstatSync;
  const suggestDir = options.suggestDir ?? true;

  if (platform !== "win32") {
    chmodFn(fromPath, 0o600);
    renameFn(fromPath, targetPath);
    return { ok: true, path: targetPath };
  }

  const existing = lstatFn(targetPath, { throwIfNoEntry: false });
  if (existing && (existing.isSymbolicLink() || existing.isDirectory())) {
    return {
      ok: false,
      refusal: secretTargetRefusal(targetPath, "target already exists as a symlink or directory", suggestDir),
    };
  }

  try {
    renameFn(fromPath, targetPath);
    return { ok: true, path: targetPath };
  } catch (error) {
    if (isTargetBlockedError(error)) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      return { ok: false, refusal: secretTargetRefusal(targetPath, `${code} on rename`, suggestDir) };
    }
    throw error;
  }
}

/**
 * Write `content` to `targetPath` on `win32` by exclusively creating (`flag: "wx"`) a sibling
 * temporary file and renaming it into place, refusing `EPERM`/`EACCES` or planted non-regular targets.
 * On POSIX, writes with `{ mode: 0o600 }`.
 * @param {string} targetPath
 * @param {string | Uint8Array} content
 * @param {PrivacyContext} [context]
 * @param {PrivacyCheckOptions} [options]
 * @returns {{ ok: true, path: string } | { ok: false, refusal: PlatformRefusal }}
 */
export function writeSecretFile(targetPath, content, context = {}, options = {}) {
  const platform = context.platform ?? process.platform;
  const writeFn = context.fs?.writeFileSync ?? writeFileSync;
  const renameFn = context.fs?.renameSync ?? renameSync;
  const rmFn = context.fs?.rmSync ?? rmSync;
  const lstatFn = context.fs?.lstatSync ?? lstatSync;
  const suggestDir = options.suggestDir ?? true;

  if (platform !== "win32") {
    writeFn(targetPath, content, { flag: "wx", mode: 0o600 });
    return { ok: true, path: targetPath };
  }

  const existing = lstatFn(targetPath, { throwIfNoEntry: false });
  if (existing && (existing.isSymbolicLink() || existing.isDirectory())) {
    return {
      ok: false,
      refusal: secretTargetRefusal(targetPath, "target already exists as a symlink or directory", suggestDir),
    };
  }

  const tmpPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    writeFn(tmpPath, content, { flag: "wx" });
    renameFn(tmpPath, targetPath);
    return { ok: true, path: targetPath };
  } catch (error) {
    if (isTargetBlockedError(error)) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      return { ok: false, refusal: secretTargetRefusal(targetPath, `${code} writing secret file`, suggestDir) };
    }
    throw error;
  } finally {
    try {
      rmFn(tmpPath, { force: true });
    } catch {
      // Best-effort temp cleanup.
    }
  }
}
