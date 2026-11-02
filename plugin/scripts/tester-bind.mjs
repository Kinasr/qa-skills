#!/usr/bin/env node
// @ts-check
// Plugin-wide PostToolUse hook on Agent: binds a launched Tester to the Execution its brief names.
import { readFileSync } from "node:fs";
import { bindTester } from "./lib/tester-guard.mjs";

/**
 * PostToolUse hook event sent by Claude Code on stdin (CODING_STANDARDS: trusted read boundary).
 * @typedef {{
 *   hook_event_name?: string,
 *   tool_name?: string,
 *   tool_input?: {
 *     subagent_type?: string | null,
 *     prompt?: string | null,
 *     [key: string]: unknown,
 *   } | null,
 *   tool_response?: {
 *     agentId?: string | null,
 *     [key: string]: unknown,
 *   } | null,
 *   [key: string]: unknown,
 * }} PostToolUseEvent
 */

try {
  const bound = /** @type {({ execDir: string, error?: never } | { execDir?: never, error: string }) | null} */ (bindTester(/** @type {PostToolUseEvent} */ (JSON.parse(readFileSync(0, "utf8")))));
  if (bound?.error) {
    process.stderr.write(`Tester binding: ${bound.error}; the guard refuses every call of this Tester.\n`);
    process.exit(2);
  }
} catch {
  // Not a launch this hook can read: an unbound Tester is refused by the guard anyway.
}
