// @ts-check
// CLI-only credential reads. Values stay inside the caller; never put a resolved value in output.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { authKeyOf, authKeysNeeded, authTemplate, templateKeysWithValue } from "./auth-template.mjs";
import { runGit } from "./git.mjs";

/** @import { ParsedEntry, ParsedFile } from "./knowledge-file.mjs" */
/** @import { CheckProblem } from "./check-file.mjs" */
/**
 * Safe to print: no credential values or file contents.
 * @typedef {{ code: string, message: string, gitignore_line: string, file?: string, checkout?: string, key?: string }} CredentialSourceRefusal
 */
/**
 * @typedef {{ value: string | null, refusal?: never } | { value?: never, refusal: CredentialSourceRefusal }} CredentialResolution
 */

/**
 * Check the existing repo-root .env without reading it. Git errors fail closed.
 * Tracked files are refused even when an ignore pattern also matches them.
 * @param {string} root The .qa directory.
 * @returns {CredentialSourceRefusal | null}
 */
export function credentialEnvRefusal(root) {
  const repo = dirname(resolve(root));
  if (!existsSync(join(repo, ".env"))) return null;
  const tracked = runGit(repo, ["ls-files", "--error-unmatch", "--", ".env"]).status === 0;
  const ignored = runGit(repo, ["check-ignore", "--quiet", "--", ".env"]).status === 0;
  if (!tracked && ignored) return null;
  return {
    code: tracked ? "credential_env_tracked" : "credential_env_not_ignored",
    file: ".env",
    message: `${tracked ? "Git tracks `.env`: run `git rm --cached -- .env` and add" : "Git would track `.env`: add"} this line to the repo root's \`.gitignore\`: \`/.env\` before using it for credentials`,
    gitignore_line: "/.env",
  };
}

/**
 * Disk-aware validation, kept outside check-file's pure schema checks. `draft` is true for a train
 * file not yet written, whose Auth template cannot be current until it is.
 * @param {string} root The .qa directory.
 * @param {ParsedFile} file
 * @param {{ draft?: boolean }} [options]
 * @returns {CheckProblem[]}
 */
export function credentialSourceProblems(root, file, { draft = false } = {}) {
  // parse() initializes every Training entry array, including on non-Training files.
  const accessNotes = /** @type {ParsedEntry[]} */ (file.access_notes);
  const notes = accessNotes.flatMap((e) => ["via", "header_via", "expired_via"].filter((field) => typeof e.data[field] === "string" && /^env:[A-Z_][A-Z0-9_]*$/.test(/** @type {string} */ (e.data[field]))).map((field) => ({ e, field })));
  const refusal = notes.length ? credentialEnvRefusal(root) : null;
  return [
    ...(refusal ? notes.map(({ e, field }) => ({ code: refusal.code, field, line: e.line, message: refusal.message })) : []),
    ...authProblems(root, file, accessNotes, draft),
  ];
}

// The note and field that first name an `auth:` key, for a problem to point at.
/**
 * @param {readonly ParsedEntry[]} notes
 * @param {string} [key]
 * @returns {{ e: ParsedEntry, field: string } | null}
 */
function firstAuthUse(notes, key) {
  for (const e of notes) for (const field of ["via", "header_via", "expired_via"]) if (authKeyOf(e.data[field]) !== null && (key === undefined || authKeyOf(e.data[field]) === key)) return { e, field };
  return null;
}

/**
 * What the Auth files and the Auth template contribute to a check: refusals for an Auth file git
 * would track or that sets a key twice, and for a template with a value or (once written) out of
 * date. Names keys and files, never a value.
 * @param {string} root
 * @param {ParsedFile} file
 * @param {readonly ParsedEntry[]} notes
 * @param {boolean} draft
 * @returns {CheckProblem[]}
 */
function authProblems(root, file, notes, draft) {
  const keys = authKeysNeeded(notes);
  const use = firstAuthUse(notes);
  /** @type {CheckProblem[]} */
  const problems = [];
  if (use) {
    for (const loc of authFiles(root)) {
      if (!existsSync(loc.file)) continue;
      const read = authEntries(loc);
      const at = { field: use.field, line: use.e.line };
      if (read.refusal) { problems.push({ code: read.refusal.code, ...at, message: read.refusal.message }); continue; }
      for (const key of new Set(read.entries.map(([k]) => k).filter((k, i, all) => all.indexOf(k) !== i))) {
        problems.push({ code: "credential_auth_duplicate", ...at, message: `${where(loc)} sets \`${key}\` more than once: keep one line` });
      }
    }
  }
  if (file.rel !== "train/access.md") return problems;
  const path = join(resolve(root), AUTH_TEMPLATE);
  if (!existsSync(path)) return keys.length && !draft ? [...problems, { code: "auth_template_stale", message: `\`.qa/${AUTH_TEMPLATE}\` is missing: write the \`auth_template\` that \`train check access\` returns` }] : problems;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [...problems, { code: "auth_template_unreadable", message: `\`.qa/${AUTH_TEMPLATE}\` could not be read` }];
  }
  for (const key of templateKeysWithValue(text)) problems.push({ code: "auth_template_value", message: `\`.qa/${AUTH_TEMPLATE}\` sets a value for \`${key}\`: the template holds keys only, so clear it and put the value in \`.qa/auth\`` });
  if (!draft && !keys.length) {
    problems.push({ code: "auth_template_stale", message: `\`.qa/${AUTH_TEMPLATE}\` is left over: no note names an \`auth:\` key, so delete it` });
  } else if (!draft && text.replace(/\r\n/g, "\n") !== authTemplate(notes)) {
    problems.push({ code: "auth_template_stale", message: `\`.qa/${AUTH_TEMPLATE}\` does not match \`train/access.md\`: rewrite it from the \`auth_template\` that \`train check access\` returns` });
  }
  return problems;
}

/**
 * Keys the notes need that no Auth file holds, one warning each, naming the key only: a CI run or a
 * fresh clone has no Auth file, so this never refuses.
 * @param {string} root The .qa directory.
 * @param {ParsedFile} file
 * @returns {CheckProblem[]}
 */
export function credentialSourceWarnings(root, file) {
  const notes = /** @type {ParsedEntry[]} */ (file.access_notes);
  const needed = authKeysNeeded(notes);
  if (!needed.length) return [];
  const held = authKeysHeld(root);
  return needed.filter((k) => !held.has(k)).map((key) => {
    const use = /** @type {{ e: ParsedEntry, field: string }} */ (firstAuthUse(notes, key));
    return { code: "auth_keys_missing", field: use.field, line: use.e.line, message: `No Auth file holds \`${key}\`: add \`${key}=\` to ${authHome(root)} (\`scout ${use.field === "via" ? "password" : "header"}-steps auth:${key}\` says how)` };
  });
}

/**
 * Resolve an env variable through the CLI's environment, then the repo-root .env.
 * `root` is the repository's .qa directory, pinned by the Run for execution callers.
 * Empty environment variables remain missing, as for the existing password login.
 * @param {string} root
 * @param {string} name
 * @returns {CredentialResolution}
 */
export function resolveCredential(root, name) {
  if (process.env[name] !== undefined) return { value: process.env[name] || null };
  const file = join(dirname(resolve(root)), ".env");
  if (!existsSync(file)) return { value: null };
  const refusal = credentialEnvRefusal(root);
  if (refusal) return { refusal };
  let entries;
  try {
    entries = readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    return { refusal: { code: "credential_env_unreadable", file: ".env", message: "The repo root's `.env` could not be read; restore read access before using credentials.", gitignore_line: "/.env" } };
  }
  for (const line of entries) {
    const assignment = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (assignment && assignment[1] === name) return { value: assignment[2] || null };
  }
  return { value: null };
}

// The Auth file (ADR-0060): `.qa/auth`, `KEY=value` lines read as `.env` is, found in the current
// worktree and then in the main checkout, per key. Values stay inside the callers here.
/** The Auth file's name inside `.qa/`, and the template's. */
export const AUTH_FILE = "auth";
/** @type {string} */
export const AUTH_TEMPLATE = "auth.example";

/** @typedef {{ checkout: "worktree" | "main", dir: string, rel: string, file: string }} AuthLocation */
/** @typedef {{ checkout: "worktree" | "main", root: string, top: string, fromTop: string }} CheckoutRoot */

/**
 * @param {string} dir
 * @param {string[]} args
 * @returns {string | null} Trimmed stdout, or null when git fails.
 */
function gitOut(dir, args) {
  const r = runGit(dir, args);
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * The `.qa` directories one project has across its checkouts, the current one first: `root` itself,
 * then the main checkout's at the same path from the repository top. The main checkout is the parent
 * of git's common dir (ADR-0060); a bare repository has none, and the main checkout is one entry.
 * @param {string} root The .qa directory.
 * @returns {CheckoutRoot[]}
 */
export function checkoutRoots(root) {
  const qa = resolve(root);
  const repo = dirname(qa);
  /** @type {CheckoutRoot} */
  const here = { checkout: "worktree", root: qa, top: repo, fromTop: basename(qa) };
  if (!existsSync(repo)) return [here];
  const top = gitOut(repo, ["rev-parse", "--show-toplevel"]);
  const common = gitOut(repo, ["rev-parse", "--git-common-dir"]);
  if (top === null || common === null) return [here];
  const realTop = realpathSync(top);
  const commonDir = realpathSync(resolve(repo, common));
  const fromTop = relative(realTop, join(realpathSync(repo), basename(qa)));
  const mine = { ...here, top: realTop, fromTop };
  if (basename(commonDir) !== ".git" || gitOut(commonDir, ["rev-parse", "--is-bare-repository"]) === "true") return [mine];
  const main = dirname(commonDir);
  if (main === realTop) return [mine];
  return [mine, { checkout: "main", root: join(main, fromTop), top: main, fromTop }];
}

/**
 * The Auth files to read for the `.qa` directory `root`, the worktree's first.
 * @param {string} root The .qa directory.
 * @returns {AuthLocation[]}
 */
export function authFiles(root) {
  return checkoutRoots(root).map((c) => {
    const file = join(c.root, AUTH_FILE);
    return { checkout: c.checkout, dir: c.top, rel: join(c.fromTop, AUTH_FILE).split("\\").join("/"), file };
  });
}

/**
 * Where a missing key belongs, as a phrase: the main checkout's Auth file, or the only one there is.
 * @param {string} root The .qa directory.
 * @returns {string}
 */
export function authHome(root) {
  const files = authFiles(root);
  const last = files[files.length - 1];
  return `${files.length > 1 ? "the main checkout's " : ""}\`${last.rel}\``;
}

/** @param {AuthLocation} loc */
const where = (loc) => `${loc.checkout === "main" ? "the main checkout's" : "this worktree's"} \`${loc.rel}\``;

/**
 * Check one Auth file without reading it, as `credentialEnvRefusal` does `.env`: git must neither
 * track it nor leave it unignored in its own checkout. Git errors fail closed.
 * @param {AuthLocation} loc
 * @returns {CredentialSourceRefusal | null}
 */
function authStanding(loc) {
  const tracked = runGit(loc.dir, ["ls-files", "--error-unmatch", "--", loc.rel]).status === 0;
  const ignored = runGit(loc.dir, ["check-ignore", "--quiet", "--", loc.rel]).status === 0;
  if (!tracked && ignored) return null;
  const line = `/${loc.rel}`;
  return {
    code: tracked ? "credential_auth_tracked" : "credential_auth_not_ignored",
    file: loc.rel,
    checkout: loc.checkout,
    message: `${tracked ? `Git tracks ${where(loc)}: run \`git rm --cached -- ${loc.rel}\` and add` : `Git would track ${where(loc)}: add`} this line to its checkout's \`.gitignore\`: \`${line}\` before using it for credentials`,
    gitignore_line: line,
  };
}

/**
 * The file's `KEY=value` lines, in order, or a refusal. An empty value is kept: callers treat it as missing.
 * @param {AuthLocation} loc
 * @returns {{ entries: Array<[string, string]>, refusal?: never } | { entries?: never, refusal: CredentialSourceRefusal }}
 */
function authEntries(loc) {
  const standing = authStanding(loc);
  if (standing) return { refusal: standing };
  let lines;
  try {
    lines = readFileSync(loc.file, "utf8").split(/\r?\n/);
  } catch {
    return { refusal: { code: "credential_auth_unreadable", file: loc.rel, checkout: loc.checkout, message: `${where(loc)} could not be read; restore read access before using credentials.`, gitignore_line: `/${loc.rel}` } };
  }
  /** @type {Array<[string, string]>} */
  const entries = [];
  for (const line of lines) {
    const assignment = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (assignment) entries.push([assignment[1], assignment[2]]);
  }
  return { entries };
}

/**
 * Resolve an Auth-file key: the worktree's own `.qa/auth` first, then the main checkout's, one key at
 * a time. Empty values are missing. A duplicated requested key is refused, naming the key alone.
 * @param {string} root The .qa directory.
 * @param {string} key
 * @returns {CredentialResolution}
 */
export function resolveAuthKey(root, key) {
  for (const loc of authFiles(root)) {
    if (!existsSync(loc.file)) continue;
    const read = authEntries(loc);
    if (read.refusal) return { refusal: read.refusal };
    const hits = read.entries.filter(([k]) => k === key);
    if (hits.length > 1) return { refusal: { code: "credential_auth_duplicate", file: loc.rel, checkout: loc.checkout, key, message: `${where(loc)} sets \`${key}\` more than once: keep one line`, gitignore_line: `/${loc.rel}` } };
    if (hits[0]?.[1]) return { value: hits[0][1] };
  }
  return { value: null };
}

/**
 * The keys an Auth file holds with a value, across both files, by name only. A file git would not
 * let the CLI read contributes none; `authDuplicateKeys` and `resolveAuthKey` say why.
 * @param {string} root The .qa directory.
 * @returns {Set<string>}
 */
export function authKeysHeld(root) {
  /** @type {Set<string>} */
  const held = new Set();
  for (const loc of authFiles(root)) {
    if (!existsSync(loc.file)) continue;
    for (const [k, v] of authEntries(loc).entries ?? []) if (v) held.add(k);
  }
  return held;
}

/**
 * Keys an Auth file sets more than once, by name only, with the checkout whose file does.
 * @param {string} root The .qa directory.
 * @returns {Array<{ key: string, checkout: "worktree" | "main" }>}
 */
export function authDuplicateKeys(root) {
  /** @type {Array<{ key: string, checkout: "worktree" | "main" }>} */
  const out = [];
  for (const loc of authFiles(root)) {
    if (!existsSync(loc.file)) continue;
    const seen = new Set();
    for (const [k] of authEntries(loc).entries ?? []) {
      if (seen.has(k) && !out.some((d) => d.key === k && d.checkout === loc.checkout)) out.push({ key: k, checkout: loc.checkout });
      seen.add(k);
    }
  }
  return out;
}
