// @ts-check
// `/qa-init`'s smoke test of a Delegate label (ADR-0020): one subagent on that model, asked for
// a one-line reply, proves the harness accepts the label before it goes on the card. The CLI cannot
// spawn a subagent, so it does everything else: it writes the fixed brief and the subagent's prompt
// into the run dir, judges the reply the agent saved, and records the outcome there, where
// `init card` reads it. It proves a label is accepted, not honoured (ADR-0020).
//
// Each label's files sit under `smoke/` in the run dir, named by the label's hash so a label with a
// slash or a dot is still one file name:
//   <id>.brief.md    the one-line brief (`SMOKE_BRIEF`), which holds every instruction
//   <id>.prompt.md   the prompt the subagent is spawned with, pointing at the brief (ADR-0011)
//   <id>.reply.md    where the agent saves the subagent's final message (any file will do)
//   <id>.json        the outcome: `{model, ok, reason?}`, written only by a judged reply
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readRunFile } from "./run-dir.mjs";

/**
 * Why a reply was not the one the brief asked for.
 * @typedef {"missing" | "empty" | "wrong"} SmokeReason
 */

/**
 * The outcome of a judged reply: it passed, or it did not and why.
 * @typedef {{ ok: true } | { ok: false, reason: SmokeReason, excerpt?: string }} SmokeOutcome
 */

/**
 * The record `init smoke` writes in `smoke/<id>.json` and reads back: the model's label, whether
 * its reply passed, and why not.
 * @typedef {{ model: string, ok: boolean, reason?: SmokeReason, excerpt?: string }} SmokeRecord
 */

/**
 * The files one model's smoke test keeps in a run dir, absolute.
 * @typedef {{ brief: string, prompt: string, reply: string, record: string }} SmokeFiles
 */

/**
 * What `init smoke` starts: the brief, the prompt and where the reply is saved, absolute.
 * @typedef {{ brief: string, prompt: string, reply: string }} SmokeStarted
 */

/**
 * The state of a model's smoke test, as `init card` reads it: `{passed: true}`, or the `{state}`
 * that keeps it off the card.
 * @typedef {{ passed: true } | { passed?: undefined, state: "missing" | "failed" } | { passed?: undefined, state: "unreadable", error: string }} SmokeState
 */

// The brief: one line, the same for every label. There is no task, and it says everything the
// subagent is to do and not do.
/** @type {string} */
export const SMOKE_BRIEF = 'This is /qa-init\'s smoke test and there is no task: read nothing else, write nothing and run nothing, and reply with exactly {"ok": true} and nothing else.\n';

// The prompt the subagent is spawned with: it points at the brief file, which the CLI wrote, and
// leaves every instruction to it (ADR-0011).
/**
 * @param {string} briefPath
 * @returns {string}
 */
const promptText = (briefPath) => `You are /qa-init's smoke test. Your complete brief is the file ${briefPath}: read it, and follow it. Your final message is the reply it asks for.\n`;

// The paths of `model`'s smoke files in run dir `dir`.
/**
 * @param {string} dir
 * @param {string} model
 * @returns {SmokeFiles}
 */
function smokePaths(dir, model) {
  const id = createHash("sha256").update(model).digest("hex").slice(0, 16);
  /**
   * @param {string} ext
   * @returns {string}
   */
  const at = (ext) => join(dir, "smoke", `${id}.${ext}`);
  return { brief: at("brief.md"), prompt: at("prompt.md"), reply: at("reply.md"), record: at("json") };
}

// Starts the smoke test of `model` in `dir`: writes the brief and the prompt, and drops any outcome
// an earlier attempt recorded, so a retry is judged afresh. `{brief, prompt, reply}`, absolute.
/**
 * @param {string} dir
 * @param {string} model
 * @returns {SmokeStarted}
 */
export function startSmoke(dir, model) {
  const f = smokePaths(dir, model);
  mkdirSync(join(dir, "smoke"), { recursive: true });
  writeFileSync(f.brief, SMOKE_BRIEF);
  writeFileSync(f.prompt, promptText(f.brief));
  rmSync(f.record, { force: true });
  return { brief: f.brief, prompt: f.prompt, reply: f.reply };
}

// Whether the smoke test of `model` was started in `dir` (its brief is there).
/**
 * @param {string} dir
 * @param {string} model
 * @returns {boolean}
 */
export const smokeStarted = (dir, model) => existsSync(smokePaths(dir, model).brief);

// Judges the reply in `replyPath` (null when the file is not there) and records the outcome in
// `dir`: `{ok, reason?, excerpt?}`, `reason` one of `missing`, `empty` or `wrong`, and `excerpt`
// the reply's first line, cut short, for a wrong one.
/**
 * @param {string} dir
 * @param {string} model
 * @param {string | null} replyPath
 * @returns {SmokeOutcome}
 */
export function judgeSmoke(dir, model, replyPath) {
  const outcome = verdict(replyPath);
  writeFileSync(smokePaths(dir, model).record, `${JSON.stringify(/** @type {SmokeRecord} */ ({ model, ...outcome }), null, 2)}\n`);
  return outcome;
}

// The longest excerpt of a wrong reply an outcome carries.
const EXCERPT = 120;

// The outcome of the reply in `replyPath`, as `judgeSmoke` records it.
/**
 * @param {string | null} replyPath
 * @returns {SmokeOutcome}
 */
function verdict(replyPath) {
  if (replyPath === null || !existsSync(replyPath)) return { ok: false, reason: "missing" };
  const text = readFileSync(replyPath, "utf8").trim();
  if (!text) return { ok: false, reason: "empty" };
  // The one line, as asked; a model that wraps it in a code span or a fenced block still answered.
  const bare = text.replace(/^```[^\n]*\n([\s\S]*?)\n```$/, "$1").replace(/^`([^`]*)`$/, "$1").trim();
  try {
    if (isDeepStrictEqual(JSON.parse(bare), { ok: true })) return { ok: true };
  } catch {
    // not JSON: a wrong reply
  }
  const first = text.split("\n")[0];
  return { ok: false, reason: "wrong", excerpt: first.length > EXCERPT ? `${first.slice(0, EXCERPT)}…` : first };
}

// `model`'s smoke test in run dir `dir` (null when the card names none): `{passed: true}`, or the
// `{state}` that keeps it off the card:
//   missing     no outcome is recorded (`dir` null too: no run dir was named)
//   failed      the reply was judged and did not pass
//   unreadable  the record is not the JSON `init smoke` wrote (`error` says why)
// The record is read at the trusted boundary: its type is declared, not checked.
/**
 * @param {string | null} dir
 * @param {string} model
 * @returns {SmokeState}
 */
export function smokeState(dir, model) {
  if (dir === null) return { state: "missing" };
  /** @type {import("./run-dir.mjs").RunFileResult<SmokeRecord>} */
  const read = readRunFile(dir, relative(dir, smokePaths(dir, model).record), { by: "init smoke", restart: "init smoke" });
  if (read.error) return { state: "unreadable", error: read.error };
  if (read.value === null || /** @type {SmokeRecord} */ (read.value).model !== model) return { state: "missing" };
  return /** @type {SmokeRecord} */ (read.value).ok === true ? { passed: true } : { state: "failed" };
}
