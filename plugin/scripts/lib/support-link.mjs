// @ts-check
// A link to a row of the support document at the running plugin's own version, so the row a
// refusal or Card names is the one that describes the code printing it.
import { readFileSync } from "node:fs";

/** @type {string | undefined} */
let version;

/**
 * @param {string} anchor a heading anchor in `docs/support.md`, such as `claude-code`
 * @returns {string}
 */
export function supportLink(anchor) {
  if (version === undefined) {
    /** @type {{ version: string }} */
    const manifest = JSON.parse(readFileSync(new URL("../../.claude-plugin/plugin.json", import.meta.url), "utf8"));
    version = manifest.version;
  }
  return `https://github.com/Kinasr/qa-skills/blob/v${version}/docs/support.md#${anchor}`;
}
