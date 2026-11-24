// @ts-check
// The command line's `check-file <path>` (scripts/scan.mjs): write-time local validation of one
// `.qa/` file, checked under the configuration `locate` finds for it. lib/check-file.mjs stays pure,
// so reading the file and finding its `.qa/` happen here.
/** @import { CommandDefinition } from "./cli.mjs" */
import { readFileSync } from "node:fs";
import { UsageError } from "./cli.mjs";
import { checkFile, parse } from "./knowledge-file.mjs";
import { locate } from "./qa-index.mjs";
import { credentialSourceProblems, credentialSourceWarnings } from "./credential-source.mjs";

// With `--input <path>` the contents come from that file, or with `--stdin` from stdin, and <path>
// is where they are about to be written. Exit 0 if ok, 1 if not.
/** @type {CommandDefinition} */
export const command = {
  options: { stdin: "flag", root: "value" },
  usage: "<path> [--input <path>] [--root <qa-dir>]",
  run(args, { stdin, root }) {
    if (args.length !== 1) throw new UsageError("check-file takes exactly one <path>");
    const [file] = args;
    /** @type {string} */
    let text;
    try {
      text = stdin ? stdin() : readFileSync(file, "utf8");
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code === "ENOENT") throw new UsageError(`no such file: ${file}`);
      throw e;
    }
    const { rel, config, root: qa } = locate(file, { root });
    const parsed = parse(rel, text);
    const result = checkFile(parsed, config);
    result.errors.push(...credentialSourceProblems(qa, parsed, { draft: Boolean(stdin) }));
    result.warnings.push(...credentialSourceWarnings(qa, parsed));
    result.ok = result.errors.length === 0;
    return { exit: result.ok ? 0 : 1, json: { file, ...result } };
  },
};
