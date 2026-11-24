// @ts-check
// Private CLI credential resolution. Only metadata and safe refusals may leave this module's callers.
import { credentialSource, headerCredential, isHeaderCredentialSource } from "./access-note.mjs";
import { accessNotes } from "./access.mjs";
import { authKeyOf } from "./auth-template.mjs";
import { authFiles, resolveAuthKey, resolveCredential } from "./credential-source.mjs";
import { ACCESS_TRAIN_KEY } from "./schema.mjs";
import { trainFile } from "./training.mjs";

/** @import { AccessNote } from "./access-note.mjs" */
/** @import { CredentialSourceRefusal } from "./credential-source.mjs" */
/** @typedef {{ header: string, scheme?: string, value: string }} ResolvedHeaderCredential */
/**
 * @typedef {{
 *   code: string,
 *   field?: string,
 *   key?: string,
 *   file?: string,
 *   checkout?: string,
 *   env?: string,
 *   gitignore_line?: string,
 *   header_via?: unknown,
 *   expired_via?: unknown,
 *   reason?: string,
 *   errno?: string,
 *   next?: string,
 *   access?: string,
 * }} HeaderRefusal
 */
/** @typedef {{ credential: ResolvedHeaderCredential | null, refusal?: never } | { credential?: never, refusal: HeaderRefusal }} HeaderResolution */

/**
 * Strip prose from a header or credential-source refusal, leaving structured fact fields only.
 * @param {HeaderRefusal | CredentialSourceRefusal} refusal
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, unknown>}
 */
export function headerRefusalFacts(refusal, extra = {}) {
  const { code: _code, message: _message, ...facts } = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (refusal));
  return { ...facts, ...extra };
}

/**
 * @param {CredentialSourceRefusal} refusal
 * @returns {HeaderRefusal}
 */
const fromCredentialRefusal = (refusal) => ({
  code: refusal.code,
  ...(refusal.file && { file: refusal.file }),
  ...(refusal.checkout && { checkout: refusal.checkout }),
  ...(refusal.key && { key: refusal.key }),
  ...(refusal.gitignore_line && { gitignore_line: refusal.gitignore_line }),
});

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
  if (!metadata) return { refusal: { code: "header_credential_invalid", field: "header_via", header_via: note.header_via } };
  const resolved = resolveSource(root, metadata);
  if (resolved.refusal) return { refusal: fromCredentialRefusal(resolved.refusal) };
  if (resolved.value === null) {
    if (metadata.source === "auth") {
      const files = authFiles(root);
      const home = files[files.length - 1];
      return { refusal: { code: "header_credential_missing", key: metadata.name, file: home.rel, checkout: home.checkout } };
    }
    return { refusal: { code: "header_credential_missing", env: metadata.name } };
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
  if (!metadata || !isHeaderCredentialSource(note.expired_via)) {
    return { refusal: { code: "expired_credential_invalid", field: metadata ? "expired_via" : "header_via", ...(metadata ? { expired_via: note.expired_via } : { header_via: note.header_via }) } };
  }
  const resolved = resolveSource(root, credentialSource(note.expired_via));
  if (resolved.refusal) return { refusal: fromCredentialRefusal(resolved.refusal) };
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
 * name as `auth:KEY` (`header_via`, `expired_via`), resolved from the Auth file without overwriting
 * existing CI secrets, alongside any `.qa/auth` refusal encountered so callers fail closed.
 * @param {string} root The `.qa` directory.
 * @param {string} origin The Run's target origin.
 * @param {Record<string, string | undefined>} env
 * @returns {{ env: Record<string, string | undefined>, refusal: CredentialSourceRefusal | null }}
 */
export function resolveAuthHeaderEnv(root, origin, env) {
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
    if (key === null) continue;
    const { value, refusal } = resolveAuthKey(root, key);
    if (refusal) return { env: { ...env }, refusal };
    if (out[key] === undefined && value) out[key] = value;
  }
  return { env: out, refusal: null };
}

/**
 * Env with any same-origin `auth:` Header credential entries added (preserving existing keys).
 * @param {string} root
 * @param {string} origin
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string | undefined>}
 */
export function withAuthHeaderEnv(root, origin, env) {
  return resolveAuthHeaderEnv(root, origin, env).env;
}
