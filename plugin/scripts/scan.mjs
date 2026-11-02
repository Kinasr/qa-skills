#!/usr/bin/env node
// @ts-check
// qa-skills' one mechanical seam (ADR-0008).
// Zero dependencies. Every mode prints one JSON object on stdout, `mode` first; skills read it and
// never re-derive its results.
//
//   node scan.mjs <mode> [<action>] [<argument>...] [--<option> [<value>]]...
//
// Each mode is a command module, named in lib/modes.mjs, which declares its actions, the options
// each takes, its synopsis and its refusals, and documents what each prints; lib/cli.mjs runs one
// call against it. A bare or unknown mode prints every synopsis.
//
// A usage error prints `{mode, ok: false, error}` and exits 2; `design`, `impact`, `init` and `sync`
// word their own, `{mode, ok: false, text}`. A `.qa/` whose `project.md` declares a newer
// `schema_version` than this CLI reads, or a malformed one, is refused by every command that writes
// into the repository, `{mode, ok: false, text}`, exit 1, writing nothing; `scan` runs on, warning
// of a newer one (lib/schema-guard.mjs).
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
