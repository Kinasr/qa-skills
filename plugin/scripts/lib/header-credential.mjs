// @ts-check
// Private CLI credential resolution. Only metadata and safe refusals may leave this module's callers.
import { credentialSource, headerCredential, isHeaderCredentialSource } from "./access-note.mjs";
import { accessNotes } from "./access.mjs";
import { authKeyOf } from "./auth-template.mjs";
import { authHome, resolveAuthKey, resolveCredential } from "./credential-source.mjs";
import { ACCESS_TRAIN_KEY } from "./schema.mjs";
import { trainFile } from "./training.mjs";

/** @type {Record<string, string>} */
export const HEADER_CREDENTIAL_REFUSALS = {
  header_credential_invalid: "The Access note needs a valid Header credential and an env:NAME or auth:KEY source.",
  header_credential_missing: "The Access note's Header credential source is missing or empty.",
  header_credential_required: "This Credential variant requires a Header credential on the session's Access note.",
  expired_credential_missing: "The expired variant requires an expired_via source with a nonempty value.",
  expired_credential_invalid: "The expired source requires a Header credential and an env:NAME or auth:KEY source.",
};

/** @import { AccessNote } from "./access-note.mjs" */
/** @typedef {{ header: string, scheme?: string, value: string }} ResolvedHeaderCredential */
/** @typedef {{ code: string, message: string, gitignore_line?: string }} HeaderRefusal */
/** @typedef {{ credential: ResolvedHeaderCredential | null, refusal?: never } | { credential?: never, refusal: HeaderRefusal }} HeaderResolution */

// `env:NAME` through the environment and `.env`, `auth:KEY` through the Auth file (ADR-0060).
/**
 * @param {string} root
 * @param {{ name: string, source: "env" | "auth" }} from
 * @returns {import("./credential-source.mjs").CredentialResolution}
 */
const resolveSource = (root, { name, source }) => (source === "auth" ? resolveAuthKey(root, name) : resolveCredential(root, name));

/**
 * Resolve the session's own note against the Run's pinned .qa root, never the Tester's --root.
 * @param {string} root
 * @param {AccessNote | null | undefined} note
 * @returns {HeaderResolution}
 */
export function readHeaderCredential(root, note) {
  if (note?.header_via === undefined) return { credential: null };
  const metadata = headerCredential(note);
  if (!metadata) return { refusal: { code: "header_credential_invalid", message: HEADER_CREDENTIAL_REFUSALS.header_credential_invalid } };
  const resolved = resolveSource(root, metadata);
  if (resolved.refusal) return { refusal: resolved.refusal };
  if (resolved.value === null) {
    const where = metadata.source === "auth" ? ` Add \`${metadata.name}=\` to ${authHome(root)}.` : "";
    return { refusal: { code: "header_credential_missing", message: `${HEADER_CREDENTIAL_REFUSALS.header_credential_missing}${where}` } };
  }
  return { credential: { header: metadata.header, ...(metadata.scheme && { scheme: metadata.scheme }), value: resolved.value } };
}

/**
 * Resolve an optional expired source through the same private resolver as the real credential.
 * Missing values remain optional until a request asks for the expired variant.
 * @param {string} root
 * @param {AccessNote | null | undefined} note
 * @returns {HeaderResolution}
 */
export function readExpiredHeaderCredential(root, note) {
  if (note?.expired_via === undefined) return { credential: null };
  const metadata = headerCredential(note);
  if (!metadata || !isHeaderCredentialSource(note.expired_via)) return { refusal: { code: "expired_credential_invalid", message: HEADER_CREDENTIAL_REFUSALS.expired_credential_invalid } };
  const resolved = resolveSource(root, credentialSource(note.expired_via));
  if (resolved.refusal) return { refusal: resolved.refusal };
  return { credential: resolved.value === null ? null : { header: metadata.header, ...(metadata.scheme && { scheme: metadata.scheme }), value: resolved.value } };
}

/**
 * Cover both source literals and HTTP's trimmed spelling without changing password resolution.
 * @param {ResolvedHeaderCredential | null} credential
 * @returns {string[]}
 */
export const headerCredentialValues = (credential) => credential
  ? [...new Set([credential.value, credential.value.trim(), ...(credential.scheme ? [`${credential.scheme} ${credential.value}`, `${credential.scheme} ${credential.value}`.trim()] : [])])].filter(Boolean)
  : [];

/**
 * Injected into requestCode via toString(); keep this function closure- and import-free.
 * Longer literals win, so the scheme plus value is masked as one credential.
 * @param {string} text
 * @param {readonly string[]} values
 * @returns {string}
 */
export function maskCredentialText(text, values) {
  for (const value of [...new Set(values)].filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(value).join("<credential>");
  return text;
}

/**
 * Injected into requestCode via toString() alongside maskCredentialText; keep both closure- and import-free.
 * Mask decoded strings, including map keys, before any preview or size limit is applied.
 * @template T
 * @param {T} value
 * @param {readonly string[]} values
 * @returns {T}
 */
export function maskCredentialValue(value, values) {
  if (typeof value === "string") return /** @type {T} */ (maskCredentialText(value, values));
  if (Array.isArray(value)) return /** @type {T} */ (value.map((v) => maskCredentialValue(v, values)));
  if (value !== null && typeof value === "object") return /** @type {T} */ (Object.fromEntries(Object.entries(value).map(([k, v]) => [maskCredentialText(k, values), maskCredentialValue(v, values)])));
  return value;
}

/**
 * Called only after the target origin and the session's match have been admitted.
 * @param {Record<string, string>} headers
 * @param {ResolvedHeaderCredential | null} credential
 * @returns {Record<string, string>}
 */
export function injectHeader(headers, credential) {
  return { ...headers, ...(credential && { [credential.header.toLowerCase()]: credential.scheme ? `${credential.scheme} ${credential.value}` : credential.value }) };
}

/**
 * The environment an Automation runs in: `env`, plus each Header credential the target's Access notes
 * name as `auth:KEY` (`header_via`, `expired_via`), resolved from the Auth file, so a test that reads
 * the variable the codegen brief names finds it. A name `env` already holds wins (a CI secret), and a
 * key that does not resolve stays unset, as an unset `env:` variable does. The CLI masks no `env:`
 * Header value in the runner output it records, so this adds none.
 * @param {string} root The .qa directory.
 * @param {string} origin The Run's target origin.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string | undefined>}
 */
export function withAuthHeaderEnv(root, origin, env) {
  const file = trainFile(root, ACCESS_TRAIN_KEY);
  const sameOrigin = (/** @type {unknown} */ m) => {
    if (typeof m !== "string" || !m.startsWith("url:")) return false;
    try { return new URL(m.slice(4)).origin === origin; } catch { return false; }
  };
  const keys = accessNotes(file).filter((note) => Array.isArray(note.match) && note.match.some(sameOrigin))
    .flatMap((note) => [authKeyOf(note.header_via), authKeyOf(note.expired_via)]);
  /** @type {Record<string, string | undefined>} */
  const out = { ...env };
  for (const key of new Set(keys)) {
    if (key === null || out[key] !== undefined) continue;
    const { value } = resolveAuthKey(root, key);
    if (value) out[key] = value;
  }
  return out;
}
