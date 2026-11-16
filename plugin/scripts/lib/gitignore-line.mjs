// @ts-check
// The one write `/qa-train access` makes outside `.qa/`: the ignore line `train check access` offers
// for an Auth, password or login-state file, appended to the repository's `.gitignore` by the CLI so
// no other line of that file is ever rewritten.
//
//   appendIgnoreLine(top, line)  appends `line` to `<top>/.gitignore` unless a line equal to it is
//                                there: `{added}`. Creates the file when it is missing, and ends
//                                the file's last line first when it has no trailing newline.
//   ignoreLineProblem(line)      why `line` is not one root-anchored ignore line, or null
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const GITIGNORE = ".gitignore";

// A line `train check access` offers is one path anchored at the repository root (`/.qa/auth`,
// `/.qa/.auth/`): a single line, starting `/`, with no surrounding whitespace.
/**
 * @param {string} line
 * @returns {string | null}
 */
export function ignoreLineProblem(line) {
  if (line === "" || /[\r\n]/.test(line)) return "the ignore line is one non-empty line";
  if (line !== line.trim()) return "the ignore line has no leading or trailing whitespace";
  if (!line.startsWith("/") || line === "/") return "the ignore line is a path from the repository root, starting `/`, as `train check access` prints it";
  return null;
}

/**
 * @param {string} top The repository's top directory.
 * @param {string} line
 * @returns {{ added: boolean }}
 */
export function appendIgnoreLine(top, line) {
  const path = join(top, GITIGNORE);
  const text = existsSync(path) ? readFileSync(path, "utf8") : null;
  // Git strips a line's trailing spaces and a CRLF's carriage return: such a line is already there.
  if (text !== null && text.split("\n").some((l) => l.replace(/\r$/, "").trimEnd() === line)) return { added: false };
  appendFileSync(path, `${text !== null && text !== "" && !text.endsWith("\n") ? "\n" : ""}${line}\n`);
  return { added: true };
}
