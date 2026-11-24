// @ts-check
// The CLI's modes (scripts/scan.mjs): each a command module, as lib/cli.mjs runs it.
/** @import { CommandAction, CommandDefinition, CommandRegistry } from "./cli.mjs" */
import { command as brief } from "./brief.mjs";
import { command as bug } from "./bug.mjs";
import { command as show } from "./show-page.mjs";
import { command as next } from "./next.mjs";
import { command as ask } from "./ask.mjs";
import { command as checkFile } from "./check-file-cli.mjs";
import { command as checkReply } from "./check-reply.mjs";
import { command as commit } from "./commit.mjs";
import { command as deepDive } from "./deep-dive.mjs";
import { command as delegate } from "./delegation.mjs";
import { command as design } from "./design.mjs";
import { command as impact } from "./impact.mjs";
import { command as init } from "./init.mjs";
import { command as mint } from "./mint.mjs";
import { command as migrateKeys } from "./migrate-keys.mjs";
import { command as migrationStatus } from "./migration-status.mjs";
import { command as scan } from "./scan.mjs";
import { command as scout } from "./scout.mjs";
import { command as sync } from "./sync.mjs";
import { command as publish } from "./publish.mjs";
import { command as train } from "./train.mjs";
import { command as execute } from "./execute.mjs";
import { command as codegen } from "./codegen.mjs";
import { command as fix } from "./fix.mjs";
import { command as tester } from "./tester.mjs";

/**
 * Wraps a command definition so every invocation skips `.qa/` migration preflight scanning.
 * @param {CommandDefinition} command
 * @returns {CommandDefinition}
 */
export function omitAllMigration(command) {
  return { ...command, omitMigration: true };
}

/**
 * Wraps a multi-action command definition so only `allowedActions` run `.qa/` migration preflight
 * scanning; every other own action gets `omitMigration: true` without mutating `command`.
 * Throws synchronously at import time if `command.actions` is missing or an allowlisted action is absent.
 * @param {CommandDefinition} command
 * @param {readonly string[]} allowedActions
 * @returns {CommandDefinition}
 */
export function allowMigration(command, allowedActions) {
  if (!command.actions) throw new Error("allowMigration requires a command with actions");
  for (const action of allowedActions) {
    if (!Object.hasOwn(command.actions, action)) {
      throw new Error(`allowMigration: unknown action "${action}"`);
    }
  }
  const allowed = new Set(allowedActions);
  /** @type {Record<string, CommandAction>} */
  const actions = {};
  for (const [name, actionDef] of Object.entries(command.actions)) {
    actions[name] = allowed.has(name) ? actionDef : { ...actionDef, omitMigration: true };
  }
  return { ...command, actions };
}

const wrappedFix = allowMigration(fix, ["plan"]);

/** @type {CommandRegistry} */
export const MODES = {
  "check-file": omitAllMigration(checkFile),
  commit: omitAllMigration(commit),
  mint: omitAllMigration(mint),
  "migrate-keys": migrateKeys,
  "migration-status": omitAllMigration(migrationStatus),
  scan,
  next,
  show,
  ask,
  "deep-dive": allowMigration(deepDive, ["refs", "feature", "roles", "resume"]),
  brief: omitAllMigration(brief),
  "check-reply": omitAllMigration(checkReply),
  sync: allowMigration(sync, ["scope"]),
  publish: allowMigration(/** @type {CommandDefinition} */ (publish), ["scope"]),
  impact: allowMigration(impact, ["entry"]),
  design: allowMigration(design, ["state", "resume"]),
  delegate: omitAllMigration(delegate),
  init: allowMigration(init, ["state", "add-role"]),
  train: allowMigration(train, ["evidence"]),
  scout: allowMigration(scout, ["brief"]),
  execute: allowMigration(execute, ["plan", "follow-ups"]),
  codegen: allowMigration(codegen, ["plan"]),
  bug: allowMigration(bug, ["read", "discard"]),
  tester: omitAllMigration(tester),
  codefix: wrappedFix,
  // `/qa-fix`'s mode before the command was renamed `/qa-codefix`, kept for scripts that call it.
  fix: wrappedFix,
};
