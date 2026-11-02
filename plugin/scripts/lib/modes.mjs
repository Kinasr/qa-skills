// @ts-check
// The CLI's modes (scripts/scan.mjs): each a command module, as lib/cli.mjs runs it.
/** @import { CommandDefinition, CommandRegistry } from "./cli.mjs" */
import { command as brief } from "./brief.mjs";
import { command as bug } from "./bug.mjs";
import { command as show } from "./show-page.mjs";
import { command as next } from "./next.mjs";
import { command as ask } from "./ask.mjs";
import { command as checkFile } from "./check-file-cli.mjs";
import { command as checkReply } from "./check-reply.mjs";
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

/** @type {CommandRegistry} */
export const MODES = {
  "check-file": checkFile,
  mint,
  "migrate-keys": migrateKeys,
  "migration-status": migrationStatus,
  scan,
  next,
  show,
  ask,
  "deep-dive": deepDive,
  brief,
  "check-reply": checkReply,
  sync,
  publish: /** @type {CommandDefinition} */ (publish),
  impact,
  design,
  delegate,
  init,
  train,
  scout,
  execute,
  codegen,
  bug,
  tester,
  codefix: fix,
  // `/qa-fix`'s mode before the command was renamed `/qa-codefix`, kept for scripts that call it.
  fix,
};
