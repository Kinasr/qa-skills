#!/usr/bin/env node
// @ts-check
// qa-skills' one mechanical seam (ADR-0008).
// Zero dependencies. Every mode prints one JSON object on stdout, `mode` first; skills read it and
// never re-derive its results.
//
//   node scan.mjs <mode> [<action>] [<argument>...] [--<option> [<value>]]...
//
// Each mode is a command module, named in lib/modes.mjs, which declares its actions, the options
// each takes, and its synopsis, and documents what each prints; lib/cli.mjs runs one call against
// it. A bare or unknown mode refuses `unknown_mode` with every synopsis in `usage`.
//
// Every `UsageError` prints `{mode, [migration,] ok: false, refusals: [{code, ...facts}]}` (with
// zero `text` or `error` fields and zero `command.refuse` overrides) and exits 2; `migration` is
// emitted only on allowlisted entry commands/actions and omitted on helper modes, inner-loop
// actions, and shared-parser usage errors (lib/modes.mjs). A `.qa/` whose `project.md` declares a
// newer, malformed, or below-minimum `schema_version` is refused by commands that write into the
// repository with `{mode, [migration,] ok: false, refusals: [SchemaFact]}`, exit 1, writing
// nothing; `scan` runs on, warning of a newer one (lib/schema-guard.mjs).
//
// `--root` names the `.qa/` directory (default ./.qa). Every run dir is named by `--dir` and printed
// back absolute (lib/run-dir.mjs); `impact plan`, `design split` and `design plan` still take
// `--out`, its deprecated old name.
import { readFileSync } from "node:fs";
import { runCommand } from "./lib/cli.mjs";
import { MODES } from "./lib/modes.mjs";

const { exit, json } = await runCommand(MODES, process.argv.slice(2), { env: process.env, input: () => readFileSync(0, "utf8") });
process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
process.exitCode = exit;
