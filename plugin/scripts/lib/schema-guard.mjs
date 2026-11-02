// @ts-check
// A `.qa/` this CLI does not read: its `project.md` declares a `schema_version` past
// `SCHEMA_VERSION`, written for a newer qa-skills, or one that is no `schema_version` at all, so
// which qa-skills reads it is unknown. Every command that writes into the repository refuses it
// before it reads anything else, writing nothing; `scan` never blocks, so it only warns of a newer
// one (lib/scan-integrity.mjs), and check-file reports a malformed one. The commands that write:
// `design split`, `delegate start` and `record`, `impact persist` and `triage`, `init apply` and
// `add-role`, `sync apply` and `scout ingest`.
import { rootConfig } from "./qa-index.mjs";
import { ANY_SCHEMA_VERSION, pendingMigrations, SCHEMA_VERSION, SUITE_KEYS_SCHEMA_VERSION } from "./schema.mjs";

/**
 * The refusal of a writing command on a `.qa/` this CLI does not read (ADR-0024): `{exit: 1, json:
 * {ok: false, text}}`.
 * @typedef {{
 *   exit: 1,
 *   json: {
 *     ok: false,
 *     text: string,
 *     code?: "schema_migration_required",
 *   },
 * }} UnreadSchemaRefusal
 */

/**
 * The refusal of a writing command that needs the Suite boundary (ADR-0024): `{exit: 1, json: {ok:
 * false, code, text}}`.
 * @typedef {{
 *   exit: 1,
 *   json: {
 *     ok: false,
 *     code: "suite_schema_required",
 *     text: string,
 *   },
 * }} SuiteSchemaRefusal
 */

/**
 * Either refusal a writing command may answer with.
 * @typedef {UnreadSchemaRefusal | SuiteSchemaRefusal} SchemaRefusal
 */

// The refusal of a writing command on the `.qa/` directory `root` (ADR-0024): `{exit: 1, json: {ok:
// false, text}}`, or null when the schema is supported and reaches the writer's minimum.
/**
 * @param {string} root
 * @param {number} minimum
 * @returns {UnreadSchemaRefusal | null}
 */
export function refuseUnreadSchema(root, minimum) {
  const { schemaVersion } = rootConfig(root);
  if (schemaVersion !== null && schemaVersion <= SCHEMA_VERSION) {
    if (schemaVersion >= minimum) return null;
    const command = pendingMigrations(schemaVersion)[0].command;
    return { exit: 1, json: { ok: false, code: "schema_migration_required", text: `Nothing was written: schema ${minimum} is required. Run \`${command}\`, commit the migration, then run this command again.` } };
  }
  const text =
    schemaVersion === null
      ? "Nothing was written: `.qa/project.md` declares a `schema_version` that is not an integer ≥ 1, so which qa-skills reads it is unknown. Fix it, then run the command again."
      : `Nothing was written: \`.qa/project.md\` declares \`schema_version: ${schemaVersion}\`, and this qa-skills reads up to ${SCHEMA_VERSION}. Update qa-skills, then run the command again.`;
  return { exit: 1, json: { ok: false, text } };
}

// Agent-written Feature files need the Suite boundary too.
/**
 * @param {string} root
 * @returns {SchemaRefusal | null}
 */
export function refuseSuiteSchema(root) {
  const unread = refuseUnreadSchema(root, ANY_SCHEMA_VERSION);
  if (unread) return unread;
  if (rootConfig(root).schemaVersion >= SUITE_KEYS_SCHEMA_VERSION) return null;
  return { exit: 1, json: { ok: false, code: "suite_schema_required", text: "Run `migrate-keys` on the default branch before writing Features: schema 3 is required." } };
}
