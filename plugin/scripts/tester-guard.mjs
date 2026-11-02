#!/usr/bin/env node
// @ts-check
// Plugin-wide PreToolUse guard: stay silent outside the named Tester.
import { readFileSync } from "node:fs";
import { TESTER_AGENT, testerCommandAllowed, testerReadAllowed, testerWriteAllowed } from "./lib/tester-guard.mjs";

/**
 * PreToolUse hook event sent by Claude Code on stdin (CODING_STANDARDS: trusted read boundary).
 * @typedef {{
 *   agent_type?: string,
 *   agent_id?: string,
 *   tool_name?: string,
 *   tool_input?: {
 *     command?: string,
 *     file_path?: string,
 *     [key: string]: unknown,
 *   },
 *   [key: string]: unknown,
 * }} PreToolUseEvent
 */

/**
 * @param {string} reason
 * @returns {never}
 */
function deny(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

try {
  /** @type {PreToolUseEvent | null | undefined} */
  const event = JSON.parse(readFileSync(0, "utf8"));
  if (!event || typeof event !== "object" || Array.isArray(event)) deny("Tester guard: invalid hook input.");
  if (event.agent_type !== TESTER_AGENT) process.exit(0);
  const agent = event.agent_id;
  if (event.tool_name === "Bash" && testerCommandAllowed(event.tool_input?.command, process.env.CLAUDE_PLUGIN_ROOT, agent)) process.exit(0);
  if (event.tool_name === "Read" && testerReadAllowed(event.tool_input?.file_path, agent)) process.exit(0);
  if (event.tool_name === "Write" && testerWriteAllowed(event.tool_input?.file_path, agent)) process.exit(0);
  deny("Tester guard: use only standalone tester do|request commands, artifacts and the report of your own Execution, with the brief's --dir.");
} catch {
  deny("Tester guard: could not validate the tool call.");
}
