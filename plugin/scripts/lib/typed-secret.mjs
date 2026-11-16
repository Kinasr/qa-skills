// @ts-check
// `fill-password` (ADR-0066): the one secret the wrapper types for the Tester, a Role's password, and
// what keeps its value out of everything the Tester can read. Nothing here returns the password to a
// caller that prints it: `spellings` feeds the wrapper's scrub, `readPassword` the one `fill`.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliLoginUser } from "./access-note.mjs";
import { PROBE_TIMEOUT_MS, playwright, sectionsOf } from "./execution-guard.mjs";
import { readSecret } from "./scout.mjs";

/** What the wrapper asks of the element a `fill-password` names; the Tester cannot choose or change it. */
export const PASSWORD_FIELD_PROBE = "el => el instanceof HTMLInputElement && el.type === 'password'";

/** @import { PlatformContext } from "./platform.mjs" */
/**
 * Whether `ref` is an `input` of `type=password` now.
 * @param {string} cwd
 * @param {string} session
 * @param {string} ref
 * @param {NodeJS.ProcessEnv | undefined} env
 * @param {PlatformContext} [context]
 * @returns {boolean}
 */
export function isPasswordField(cwd, session, ref, env, context = {}) {
  const asked = playwright(cwd, session, ["eval", PASSWORD_FIELD_PROBE, ref], env, PROBE_TIMEOUT_MS, context);
  if (asked.missing || asked.refused || asked.error) return false;
  return sectionsOf(asked.text).find((s) => s.name === "Result")?.body.split("\n")[0].trim() === "true";
}

/**
 * Whether a note has a password source: a user and a password the CLI logs in with (ADR-0019).
 * @param {import("./access.mjs").ShownAccessNote | null | undefined} note
 * @returns {boolean}
 */
export const hasPasswordSource = (note) => Boolean(note && !note.withheld && cliLoginUser(/** @type {never} */ (note)));

/**
 * The password a note's CLI login uses: `{password}`, `{none: true}` when the note has no password
 * source, or `{error}` when the source cannot be read.
 * @param {string} root
 * @param {import("./access.mjs").ShownAccessNote | null | undefined} note
 * @returns {{ password: string, none?: never, error?: never } | { none: true, password?: never, error?: never } | { error: string, password?: never, none?: never }}
 */
export function readPassword(root, note) {
  if (!hasPasswordSource(note)) return { none: true };
  const secret = readSecret(root, /** @type {never} */ (note));
  if (secret.refusal) return { error: String(/** @type {{ error?: unknown }} */ (secret.refusal.json).error ?? "the password could not be read") };
  return { password: secret.password };
}

/**
 * Every spelling of `password` a page, a log or a snapshot may carry.
 * @param {string} password
 * @returns {string[]}
 */
export const spellings = (password) => [...new Set([password, JSON.stringify(password).slice(1, -1), encodeURIComponent(password)])].filter(Boolean);

/**
 * Rewrites every file under `<execDir>/.playwright-cli/` that carries one of `values`, so the Tester
 * never Reads it. Files without the value are left as they are.
 * @param {string} execDir
 * @param {readonly string[]} values
 * @returns {void}
 */
export function scrubSnapshots(execDir, values) {
  const dir = join(execDir, ".playwright-cli");
  if (!values.length || !existsSync(dir)) return;
  /** @param {string} at */
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const file = join(at, name);
      if (statSync(file).isDirectory()) { walk(file); continue; }
      const bytes = readFileSync(file);
      if (!values.some((v) => bytes.includes(v))) continue;
      let text = bytes.toString("utf8");
      for (const v of [...values].sort((a, b) => b.length - a.length)) text = text.split(v).join("<credential>");
      writeFileSync(file, text);
    }
  };
  walk(dir);
}
