// @ts-check
// Whether a command is installed on this machine: `onPath("playwright-cli")` is true when a directory
// of the PATH holds an executable file of that name. On Windows the name may also carry any of
// the PATHEXT extensions. A file that is not executable, or a directory of that name, does not count.
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * @param {string} command
 * @returns {boolean}
 */
export function onPath(command) {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)] : [""];
  return dirs.some((dir) =>
    extensions.some((ext) => {
      const file = join(dir, command + ext);
      try {
        if (!statSync(file).isFile()) return false;
        accessSync(file, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }),
  );
}
