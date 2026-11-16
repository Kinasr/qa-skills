// @ts-check
// CLI-private values a session resolved. Keep every rotation until ingest, including
// values used only for masking an absent variant. The scheduler sweeps login .json files, so these
// exclusive per-call files use .jsonl and survive until ingest sweeps the whole auth/ directory.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AUTH_DIR } from "./execute-auth.mjs";
import { ensurePrivateDir, writeSecretFile } from "./platform-privacy.mjs";

/** @import { PlatformRefusal } from "./platform.mjs" */
/** @import { PrivacyContext } from "./platform-privacy.mjs" */
/** @typedef {string[]} UsedCredentialValues */
const PREFIX = "credentials-";

/**
 * Persist credential literals in `<run>/auth/credentials-<uuid>.jsonl` for final ingestion masking.
 * @param {string} runDir
 * @param {readonly string[]} values
 * @param {PrivacyContext} [context]
 * @returns {{ ok: true, path?: string } | { ok: false, refusal: PlatformRefusal }}
 */
export function retainCredentialValues(runDir, values, context = {}) {
  if (!values.length) return { ok: true };
  const auth = join(runDir, AUTH_DIR);
  const dirCheck = ensurePrivateDir(auth, context);
  if (!dirCheck.ok) return dirCheck;
  /** @type {UsedCredentialValues} */
  const kept = [...values];
  return writeSecretFile(join(auth, `${PREFIX}${randomUUID()}.jsonl`), JSON.stringify(kept), context);
}

/** @param {string} runDir @returns {UsedCredentialValues | null} */
export function readCredentialValues(runDir) {
  const auth = join(runDir, AUTH_DIR);
  if (!existsSync(auth)) return [];
  try {
    /** @type {UsedCredentialValues} */
    const values = [];
    for (const file of readdirSync(auth).filter((file) => file.startsWith(PREFIX) && file.endsWith(".jsonl"))) {
      const data = JSON.parse(readFileSync(join(auth, file), "utf8"));
      if (!Array.isArray(data) || !data.every((value) => typeof value === "string")) return null;
      values.push(.../** @type {UsedCredentialValues} */ (data));
    }
    return values;
  } catch {
    // Filesystem and parse errors can quote private input; callers print only a fixed refusal.
    return null;
  }
}
