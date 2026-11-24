// @ts-check
// The CLI login (ADR-0019): `scout brief ui` logs in to the app under test with its own code,
// through `playwright-cli`, before a UI scout runs, so the scout starts from a fresh session. No model
// sees the password: it is passed to `playwright-cli fill` alone, whose output is never printed.
//
//   logIn({dir, session, url, password, identifiers})
//       Logs in as `identifiers.user`: opens `identifiers.login_url` (else `url`'s origin) in a browser session of its own, run from the
//       run dir `dir` so its snapshots land there; fills the user and the password, submitting with
//       Enter; checks the password field is gone; saves the login state to `<dir>/login-state.json`
//       and closes the browser. Returns `{state}`, its path, or `{reason, error}` on a failure, whose
//       text never carries the password. A failure to open the login page at all also says
//       `unreachable: true`: it is the environment, not the credentials (`/qa-execute` reports it so).
/** @import { PlatformContext, PlatformRefusal, PlatformRunnerOptions } from "./platform.mjs" */
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dropProfile, ensureProfileFlag, profileFlag } from "./browser-profile.mjs";
import { defaultPlatformRunner, mapSpawnRefusal, platformRefusalFacts, spawnNodeCli } from "./platform.mjs";
import { ensurePrivateDir, writeSecretFile } from "./platform-privacy.mjs";

/** @import { PrivacyContext } from "./platform-privacy.mjs" */

/**
 * Result of a successful CLI login: the path to the saved login-state file.
 * @typedef {{
 *   state: string,
 *   reason?: never,
 *   error?: never,
 *   unreachable?: never,
 * }} LogInSuccess
 */

/**
 * Result of a failed CLI login.
 * @typedef {{
 *   reason: string,
 *   error: string,
 *   check?: string,
 *   command?: string,
 *   facts?: Record<string, unknown>,
 *   unreachable?: boolean,
 *   state?: never,
 * }} LogInFailure
 */

/**
 * What `logIn` returns: the saved login-state path, or a failure.
 * @typedef {LogInSuccess | LogInFailure} LogInResult
 */

/**
 * Access note identifiers used by CLI login.
 * @typedef {{
 *   user: string,
 *   login_url?: string,
 *   user_field?: string,
 *   pass_field?: string,
 *   [key: string]: unknown,
 * }} LogInIdentifiers
 */

/**
 * Options for logging in via playwright-cli.
 * @typedef {{
 *   dir: string,
 *   session: string,
 *   url: string,
 *   password: string,
 *   identifiers?: LogInIdentifiers | Record<string, unknown>,
 *   platformContext?: PlatformContext,
 * }} LogInOptions
 */

// The file the login state is saved to, in the run dir.
/** @type {"login-state.json"} */
export const LOGIN_STATE_FILE = "login-state.json";

// The default selectors: the first password field, and the nearest input before it that a person types
// into, so a search box in the page's header is passed over.
const CALL_TIMEOUT_MS = 60000;
const PASS_FIELD = "input[type=password] >> nth=0";
const USER_FIELD = "xpath=(//input[@type='password'])[1]/preceding::input[not(@type='hidden' or @type='checkbox' or @type='radio' or @type='submit' or @type='button')][1]";

/**
 * @param {LogInOptions} options
 * @param {PrivacyContext} [context]
 * @returns {LogInResult}
 */
export function logIn({ dir, session, url, password, identifiers = {}, platformContext }, context = {}) {
  const loginUrl = /** @type {string | undefined} */ (/** @type {LogInIdentifiers} */ (identifiers).login_url) ?? new URL(url).origin;
  const userField = /** @type {string | undefined} */ (/** @type {LogInIdentifiers} */ (identifiers).user_field) ?? USER_FIELD;
  const passField = /** @type {string | undefined} */ (/** @type {LogInIdentifiers} */ (identifiers).pass_field) ?? PASS_FIELD;
  const name = `${session}-login`;
  const platform = context.platform ?? process.platform;
  if (platform === "win32") {
    const dirCheck = ensurePrivateDir(dir, context);
    if (!dirCheck.ok) return { reason: dirCheck.refusal.code, error: dirCheck.refusal.message, facts: platformRefusalFacts(dirCheck.refusal), ...(dirCheck.refusal.command && { command: dirCheck.refusal.command }) };
    const profileCheck = ensureProfileFlag(dir, name, context);
    if (!profileCheck.ok) return { reason: profileCheck.refusal.code, error: profileCheck.refusal.message, facts: platformRefusalFacts(profileCheck.refusal), ...(profileCheck.refusal.command && { command: profileCheck.refusal.command }) };
  }
  const pw = (/** @type {string[]} */ ...args) => playwright(dir, name, args, platformContext);
  try {
    const opened = pw("open", loginUrl, profileFlag(dir, name));
    if (opened.missing) return { reason: "no_playwright_cli", error: "`playwright-cli` is not on your PATH, so the CLI cannot log in to the app: install it, then observe again" };
    if (opened.refused) return { reason: "refused_playwright_cli", error: opened.refusal.message, check: opened.refusal.code, facts: { check: opened.refusal.code, ...platformRefusalFacts(opened.refusal) } };
    if (opened.error) return { ...failed(`could not open ${loginUrl}: ${opened.error}`), unreachable: true };
    if (pw("fill", userField, /** @type {string} */ (/** @type {LogInIdentifiers} */ (identifiers).user)).error) return failed(`found no user name field on ${loginUrl}: give the note's \`identifiers\` a \`user_field\` selector with \`/qa-train access\``);
    if (pw("fill", passField, password, "--submit").error) return failed(`found no password field on ${loginUrl}: give the note's \`identifiers\` a \`pass_field\` selector with \`/qa-train access\``);
    // Only "matches no element" says the field is gone: any other failure proves nothing.
    const check = pw("eval", "(e) => e.isConnected", passField);
    if (!check.error) return failed(`${loginUrl} still shows the password field after submitting: the password may be wrong, or the page asked for a captcha`);
    if (!NO_MATCH.test(check.error)) return failed(`could not check whether the login worked: ${check.error}`);
    const state = join(dir, LOGIN_STATE_FILE);
    if (platform === "win32") {
      const tmpState = join(dir, `.${LOGIN_STATE_FILE}.${randomUUID()}.tmp`);
      try {
        const saved = pw("state-save", tmpState);
        if (saved.error) return failed(`could not save the login state: ${saved.error}`);
        const raw = context.fs?.readFileSync ? context.fs.readFileSync(tmpState, "utf8") : readFileSync(tmpState);
        const written = writeSecretFile(state, raw, context);
        if (!written.ok) return { reason: written.refusal.code, error: written.refusal.message, facts: platformRefusalFacts(written.refusal) };
        return { state: written.path };
      } finally {
        try {
          rmSync(tmpState, { force: true });
        } catch {
          // Best-effort temp cleanup.
        }
      }
    }
    const saved = pw("state-save", state);
    if (saved.error) return failed(`could not save the login state: ${saved.error}`);
    return { state };
  } finally {
    pw("close");
    dropProfile(dir, name);
  }
}

/**
 * @param {string} error
 * @returns {LogInFailure}
 */
const failed = (error) => ({ reason: "login_failed", error });

// How `playwright-cli` says a selector matches nothing.
const NO_MATCH = /does not match any elements/;

// One `playwright-cli` call in session `session`, run from `dir`: `{missing}` when it is not on the
// PATH, `{error}` the first line of its error (it exits 0 on a failure and prints `### Error`), else
// `{}`. Its output is never returned, since a `fill` echoes the text it typed.
/**
 * @param {string} dir
 * @param {string} session
 * @param {readonly string[]} args
 * @param {PlatformContext} [platformContext]
 * @returns {{ missing: true, refused?: undefined, refusal?: undefined, error?: undefined } | { refused: true, refusal: PlatformRefusal, missing?: undefined, error?: undefined } | { error: string, missing?: undefined, refused?: undefined, refusal?: undefined } | { missing?: undefined, refused?: undefined, refusal?: undefined, error?: undefined }}
 */
function playwright(dir, session, args, platformContext = {}) {
  const env = platformContext.env ?? process.env;
  /** @type {PlatformRunnerOptions} */
  const spawnOptions = { cwd: dir, env, encoding: "utf8", timeout: CALL_TIMEOUT_MS };
  const resolved = spawnNodeCli(
    { kind: "playwright-cli", file: "playwright-cli", args: [`-s=${session}`, ...args], options: spawnOptions },
    { ...platformContext, env },
  );
  if (resolved.refusal) return mapSpawnRefusal(resolved.refusal);
  const runner = platformContext.run ?? defaultPlatformRunner;
  const r = runner(resolved.file, resolved.args, resolved.options);
  if ((/** @type {NodeJS.ErrnoException | undefined} */ (r.error))?.code === "ENOENT") return { missing: true };
  if (r.error) return { error: /** @type {NodeJS.ErrnoException} */ (r.error).code === "ETIMEDOUT" ? "playwright-cli timed out" : r.error.message };
  const out = `${r.stdout}\n${r.stderr}`;
  const at = out.search(/^### Error/m);
  if (r.status !== 0 || at !== -1) return { error: errorLine(out.slice(at === -1 ? 0 : at)) };
  return {};
}

// The first `Error: ` line of `playwright-cli`'s output, without the prefix.
/**
 * @param {string} text
 * @returns {string}
 */
function errorLine(text) {
  const line = text.split("\n").find((l) => l.startsWith("Error: "));
  return line ? line.slice("Error: ".length) : "playwright-cli failed";
}
