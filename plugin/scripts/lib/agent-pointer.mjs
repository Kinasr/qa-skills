// @ts-check
// The Agent pointer: the note `/qa-init` reports for the engineer to paste into the
// repository's own agent guidance, so an agent without the plugin knows `.qa/` is managed by
// qa-skills and which command to recommend. Reported, never written: init writes only
// `.qa/project.md`.
//
//   AGENT_POINTER      the template, verbatim.
//   pointerFor(repo)   whether the guidance beside `.qa/` (AGENTS.md, then CLAUDE.md) already
//                      mentions qa-skills, where to paste the template when it does not, and whether
//                      CLAUDE.md must import AGENTS.md for Claude Code to see it.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { repositoryOf } from "./git-tree.mjs";
import { qaRel } from "./qa-index.mjs";

/** The fixed template, shown verbatim; the model never words it. @type {string} */
export const AGENT_POINTER = `## QA knowledge (qa-skills)

This repo's test knowledge lives in \`.qa/\`, managed by the qa-skills commands. Don't change \`.qa/\`
unless the engineer or a \`/qa-skills:qa-*\` command asks; if a manual repair is needed, show it to
the engineer. Don't run these commands yourself: keep doing the user's task, and when it touches
what they cover, say this repo uses qa-skills and recommend the command for the user to run.

- Small change to a feature's expected behaviour → \`/qa-skills:qa-impact\`
- New feature, or a big requirement change → \`/qa-skills:qa-deep-dive\`, then \`/qa-skills:qa-design\`
- Code or test code changed → \`/qa-skills:qa-sync\`
- How is a feature recorded to behave? → \`/qa-skills:qa-ask\`
- Run existing Test Cases against the app → \`/qa-skills:qa-execute\`
- Write test code for a Test Case → \`/qa-skills:qa-codegen\`
- An automated test fails or flakes → \`/qa-skills:qa-codefix\`
- A Test Case failed against the app → \`/qa-skills:qa-bug\`
- Send reviewed Test Cases or bug drafts to the tracker → \`/qa-skills:qa-publish\`
- Teach a command how this team works → \`/qa-skills:qa-train\`
- Browse a feature's recorded rules and test cases? → \`/qa-skills:qa-show\`
- Unsure where to start → \`/qa-skills:qa-next\`

If these commands are not available, the qa-skills plugin is not installed: see its README.
`;

// Only the name counts: `.qa/` alone is too ambiguous to mean this framework.
const MENTION = "qa-skills";
// A Claude Code import of AGENTS.md, anywhere in CLAUDE.md.
const IMPORTS_AGENTS = /(^|\s)@(\.\/)?AGENTS\.md(\s|$)/m;

/**
 * The Agent pointer's state, as `init state` returns it. `file` and `import.file` are relative to the
 * repository's top level (to the directory holding `.qa/` outside git), so a package's guidance is
 * named with its package; `line` is 1-based; `import.add` is the line to add to `import.file`.
 * @typedef {{
 *   status: "missing" | "present",
 *   file: string,
 *   line?: number,
 *   text: string,
 *   import?: { file: string, add: string },
 * }} AgentPointer
 */

/**
 * @param {string} repo the directory holding `.qa/`, whose guidance files are read
 * @returns {AgentPointer}
 */
export function pointerFor(repo) {
  const top = repositoryOf(repo)?.top ?? repo;
  const here = realpathSync(repo);
  const shown = (/** @type {string} */ name) => qaRel(top, join(here, name));
  const agents = readGuidance(repo, "AGENTS.md");
  const claude = readGuidance(repo, "CLAUDE.md");
  const found = [{ name: "AGENTS.md", text: agents }, { name: "CLAUDE.md", text: claude }].flatMap(({ name, text }) => {
    const line = text === null ? -1 : text.split("\n").findIndex((l) => l.includes(MENTION));
    return line < 0 ? [] : [{ name, line: line + 1 }];
  })[0];
  // The pointer is, or would be, in AGENTS.md, which Claude Code reads only through an import.
  const needsImport = claude !== null && !IMPORTS_AGENTS.test(claude) && found?.name !== "CLAUDE.md";
  /** @type {AgentPointer} */
  const pointer = found
    ? { status: "present", file: shown(found.name), line: found.line, text: AGENT_POINTER }
    : { status: "missing", file: shown("AGENTS.md"), text: AGENT_POINTER };
  if (needsImport) pointer.import = { file: shown("CLAUDE.md"), add: "@AGENTS.md" };
  return pointer;
}

/**
 * @param {string} repo
 * @param {string} name
 * @returns {string | null}
 */
function readGuidance(repo, name) {
  const path = join(repo, name);
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : null;
}
