// @ts-check
// The migration preflight (ADR-0027): read-only, over authoritative Case headings and Scenario
// frontmatter. It reads only `.qa/`, with no code scan or git operation.
// `{pending, count, declarations}` lists declarations needing attention, once per heading or
// frontmatter key. A heading/block disagreement adds `malformed: true` and `block_key` (null
// when missing), even for a minted heading. Historical fields never enter this count.
/** @import { CommandDefinition } from "./cli.mjs" */
import { pendingMigrations } from "./schema.mjs";
import { projectConfig } from "./knowledge-file.mjs";
import { UsageError } from "./cli.mjs";
import { isLiveCaseKey, isScenarioKey } from "./keys.mjs";
import { loadWorkingTree } from "./qa-index.mjs";

/**
 * A declaration that needs attention: where it is written, the key it declares, and whether the
 * heading and the block disagree.
 * @typedef {{
 *   file: string,
 *   line: number,
 *   key: unknown,
 *   malformed?: true,
 *   block_key?: unknown,
 * }} Declaration
 */

/**
 * The preflight's result (`json` of the `migration-status` command): what is pending, how many
 * declarations need attention, and each declaration.
 * @typedef {{ pending: boolean, count: number, declarations: Declaration[], migrations: { version: number, command: string }[] }} MigrationStatus
 */

/** @type {CommandDefinition} */
export const command = {
  options: { root: "qa-dir?" },
  usage: "[--root <qa-dir>]",
  run(args, { root }) {
    if (args.length) throw new UsageError("migration-status takes no argument: it checks the whole `.qa/`");
    return { exit: 0, json: migrationStatus(loadWorkingTree(root)) };
  },
};

/**
 * @param {import("./knowledge-file.mjs").QaFile[]} files
 * @returns {MigrationStatus}
 */
export function migrationStatus(files) {
  /** @type {Declaration[]} */
  const declarations = [];
  // The parsed files: a file that could not be read is no Scenario, and the check below skips it.
  const project = files.find((f) => f.type === "project");
  const version = projectConfig(project).schemaVersion;
  const migrations = project && Number.isInteger(version) && version > 0 ? pendingMigrations(version) : [];
  for (const file of files) {
    if (file.type !== "scenario") continue;
    if (!isScenarioKey(file.data.key)) declarations.push({ file: file.rel, line: file.keyLines.key ?? file.frontmatterLine, key: file.data.key ?? null });
    for (const entry of file.cases) {
      const malformed = entry.key !== entry.data.key;
      if (!isLiveCaseKey(entry.key) || malformed) declarations.push({
        file: file.rel, line: entry.line, key: entry.key,
        ...(malformed ? { malformed: true, block_key: entry.data.key ?? null } : {}),
      });
    }
  }
  return { pending: declarations.length > 0 || migrations.length > 0, count: declarations.length, declarations, migrations };
}
