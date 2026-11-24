// @ts-check
// A `.qa/` this CLI does not read: its `project.md` declares a `schema_version` past
// `SCHEMA_VERSION`, written for a newer qa-skills, or one that is no `schema_version` at all, so
// which qa-skills reads it is unknown. Every command that writes into the repository refuses it
// before it reads anything else, writing nothing; `scan` never blocks, so it only warns of a newer
// one (lib/scan-integrity.mjs), and check-file reports a malformed one. The commands that write:
// `design split`, `delegate start` and `record`, `impact persist` and `triage`, `init apply` and
// `add-role`, `sync apply` and `scout ingest`.
import { rootConfig } from "./qa-index.mjs";
import { fact } from "./refusal.mjs";
import { ANY_SCHEMA_VERSION, pendingMigrations, SCHEMA_VERSION, SUITE_KEYS_SCHEMA_VERSION } from "./schema.mjs";

/**
 * Structured schema-guard refusal fact (ADR-0024).
 * @typedef {{ code: "schema_newer", version: number, supported: number, file: "project.md" }
 *   | { code: "schema_malformed", file: "project.md", supported: number, declared?: unknown }
 *   | { code: "schema_migration_required", version: number, required: number, next?: string }
 *   | { code: "suite_schema_required", version: number, required: number, next: "migrate-keys" }} SchemaFact
 */

/**
 * The refusal of a writing command on a `.qa/` this CLI does not read (ADR-0024): `{exit: 1, json:
 * {ok: false, refusals: [SchemaFact]}}`.
 * @typedef {{
 *   exit: 1,
 *   json: {
 *     ok: false,
 *     refusals: [SchemaFact],
 *   },
 * }} UnreadSchemaRefusal
 */

/**
 * The refusal of a writing command that needs the Suite boundary (ADR-0024): `{exit: 1, json: {ok:
 * false, refusals: [SchemaFact]}}`.
 * @typedef {{
 *   exit: 1,
 *   json: {
 *     ok: false,
 *     refusals: [SchemaFact],
 *   },
 * }} SuiteSchemaRefusal
 */

/**
 * Either refusal a writing command may answer with.
 * @typedef {UnreadSchemaRefusal | SuiteSchemaRefusal} SchemaRefusal
 */

/**
 * Builds an exit-1 schema refusal carrying a typed SchemaFact.
 * @param {SchemaFact["code"]} code
 * @param {Record<string, unknown>} data
 * @returns {{ exit: 1, json: { ok: false, refusals: [SchemaFact] } }}
 */
function schemaStop(code, data) {
  return {
    exit: /** @type {const} */ (1),
    json: {
      ok: false,
      refusals: [/** @type {SchemaFact} */ (fact(code, data))],
    },
  };
}

// The refusal of a writing command on the `.qa/` directory `root` (ADR-0024): `{exit: 1, json: {ok:
// false, refusals: [SchemaFact]}}`, or null when the schema is supported and reaches the writer's minimum.
/**
 * @param {string} root
 * @param {number} minimum
 * @returns {UnreadSchemaRefusal | null}
 */
export function refuseUnreadSchema(root, minimum) {
  const { schemaVersion, declaredSchemaVersion } = rootConfig(root);
  if (schemaVersion !== null && schemaVersion <= SCHEMA_VERSION) {
    if (schemaVersion >= minimum) return null;
    const command = pendingMigrations(schemaVersion)[0]?.command;
    return schemaStop(
      "schema_migration_required",
      { version: schemaVersion, required: minimum, ...(command && { next: command }) },
    );
  }
  if (schemaVersion === null) {
    return schemaStop(
      "schema_malformed",
      {
        file: "project.md",
        supported: SCHEMA_VERSION,
        ...(declaredSchemaVersion !== undefined && { declared: declaredSchemaVersion }),
      },
    );
  }
  return schemaStop(
    "schema_newer",
    { version: schemaVersion, supported: SCHEMA_VERSION, file: "project.md" },
  );
}

// Agent-written Feature files need the Suite boundary too.
/**
 * @param {string} root
 * @returns {SchemaRefusal | null}
 */
export function refuseSuiteSchema(root) {
  const unread = refuseUnreadSchema(root, ANY_SCHEMA_VERSION);
  if (unread) return unread;
  const { schemaVersion } = rootConfig(root);
  if (schemaVersion >= SUITE_KEYS_SCHEMA_VERSION) return null;
  return schemaStop(
    "suite_schema_required",
    { version: schemaVersion, required: SUITE_KEYS_SCHEMA_VERSION, next: "migrate-keys" },
  );
}
