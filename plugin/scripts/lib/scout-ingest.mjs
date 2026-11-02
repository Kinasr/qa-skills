// @ts-check
// `scout ingest --dir <run-dir>` (ADR-0016, ADR-0018): the one scout action that writes into
// `.qa/`. It reads back what `scout brief ui` left in the run dir (`scout-ui.json`) and the report
// the UI scout wrote there (`scout-ui.report.md`), checks the report, and writes it as an
// Observation at `.qa/observations/<date>-<slug>.md`, printing its `file:` URI.
//
// In order, each refusal writing nothing:
//   no_report           the scout wrote no report
//   credential          the shared credential matcher (lib/credentials.mjs) flags a line of the
//                       report or the request, URLs' query strings and fragments already cut; the
//                       error names the kind and the line, never the value
//   login_expired       the report is the one line `FAILED: login: <sentence>`, the marker the brief has
//                       the scout write for a page that asks it to log in: the login state has expired,
//                       or, after a CLI login, the app asks for more than a password, and the
//                       error says to switch the note to a saved login.
//                       `failure` carries the sentence, `access` the key of the Access note briefed,
//                       and, for a saved login, the error gives the steps to save the login state again (lib/scout-prompt.mjs
//                       `loginSteps`, the text `scout brief ui` gives for a missing login-state file)
//   scout_failed        the report is any other one line `FAILED: <reason>`; `failure` carries the reason
//   report_shape        the report is not the brief's shape (lib/scout-prompt.mjs `uiBrief`); the
//                       error names the line, never its text
//   over_cap            more steps than UI_ACTION_CAP
//   prohibited_command  a step runs a command outside the brief's allow-list
//   observation_invalid the Observation it would write fails `check-file` (a request or a version
//                       the dialect cannot hold)
//
// What it writes: the observed URL and every URL in the report with its query string and fragment
// cut; the steps as the scout ran them, with the repository's absolute path cut from them so the
// login state reads as the repo-relative path the Access note names (after a CLI login, as the file's
// name in the run dir, which it deletes whatever the report says); the facts as numbered; and,
// when the report has them, the parts of the request the scout could not reach under `## Not seen`.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { credentialIn, stripUrls } from "./credentials.mjs";
import { checkFile, parse } from "./knowledge-file.mjs";
import { qaRel, rootConfig } from "./qa-index.mjs";
import { quote } from "./render.mjs";
import { openRunDir, readRunFile } from "./run-dir.mjs";
import { localDate } from "./scan.mjs";
import { UI_ACTION_CAP, UI_ALLOWED, UI_NARROW, UI_SCROLL_KEYS, loginSteps } from "./scout-prompt.mjs";
/** @import { RunFileResult } from "./run-dir.mjs" */

/**
 * @typedef {import("./cli.mjs").CommandResult} CommandResult
 * @typedef {import("./scout.mjs").ScoutUiRecord} ScoutUiRecord
 */

/**
 * The report a UI scout writes, in the brief's shape (`uiBrief`), after `parseReport` has read it:
 * the app version, the commands run, the facts, and the parts of the request it could not see.
 * @typedef {{
 *   version: string | null,
 *   steps: string[],
 *   facts: string[],
 *   notSeen: string[],
 *   loginExpired?: undefined,
 *   failed?: undefined,
 *   problem?: undefined,
 * }} ScoutReport
 */

/**
 * Why `parseReport` could not read a report: the login marker, any other `FAILED:` line, or the
 * first line that is not the brief's shape. Each names what it found, never the report's text.
 * @typedef {{
 *   loginExpired?: string,
 *   failed?: string,
 *   problem?: string,
 *   version?: undefined,
 *   steps?: undefined,
 *   facts?: undefined,
 *   notSeen?: undefined,
 * }} ScoutReportRefusal
 */

/**
 * The input `observationText` writes as an Observation.
 * @typedef {{
 *   date: string,
 *   url: string,
 *   version: string | null,
 *   request: string,
 *   steps: string[],
 *   facts: string[],
 *   notSeen: string[],
 * }} ObservationInput
 */

const BRIEFED_BY = "scout brief ui";
const AGAIN = "nothing was written: observe again";

// `{exit, json}`, or `{error}` for a usage error. `dir`: the run dir `--dir` names; `root`: `.qa/`.
/**
 * @param {string | undefined} dir
 * @param {string} root
 * @returns {CommandResult | { error: string }}
 */
export function ingestUi(dir, root) {
  const run = /** @type {{ dir: string, error?: string }} */ (openRunDir(dir, { cmd: "scout", action: "ingest", from: BRIEFED_BY }));
  if (run.error) return /** @type {{ error: string }} */ (run);
  /** @type {RunFileResult<ScoutUiRecord>} */
  const read = readRunFile(run.dir, "scout-ui.json", { by: BRIEFED_BY, restart: BRIEFED_BY, missing: `no UI scout was briefed in ${run.dir}: run \`${BRIEFED_BY}\` first` });
  if (read.error) return /** @type {{ error: string }} */ (read);
  const record = /** @type {ScoutUiRecord} */ (read.value);
  if (!["url", "request", "session", "access", "login_state"].every((k) => typeof (/** @type {Record<string, unknown> | null | undefined} */ (record))?.[k] === "string")) {
    return { error: `${join(run.dir, "scout-ui.json")} is not the record \`${BRIEFED_BY}\` wrote: start a new run with \`${BRIEFED_BY}\`` };
  }

  // A CLI login's state file holds live session cookies and is the CLI's own: deleted whatever
  // the report says. Only a file in the run dir, so a corrupt record never deletes anything else.
  const cliLogin = record.login === "cli";
  if (cliLogin && resolve(dirname(record.login_state)) === resolve(run.dir)) rmSync(record.login_state, { force: true });

  const reportFile = join(run.dir, "scout-ui.report.md");
  if (!existsSync(reportFile)) return refuse("no_report", `the UI scout wrote no report at ${reportFile}: ${AGAIN}`);
  const text = stripUrls(readFileSync(reportFile, "utf8"));
  const request = stripUrls(record.request);
  const secret = secretIn(text, request);
  if (secret) return refuse("credential", `${secret}; an Observation never carries a secret, so ${AGAIN}, and revoke the credential if it is real`);

  const report = /** @type {ScoutReport & { loginExpired?: string, failed?: string, problem?: string }} */ (parseReport(text, record.session));
  if (report.loginExpired && cliLogin) {
    return refuse("login_expired", `the UI scout was asked to log in right after the CLI logged in as \`${record.user}\` for Access note \`${record.access}\`, so the app asks for more than a user name and password: ${report.loginExpired}. Nothing was written: switch the note to a saved login with \`/qa-train access\` (\`via: cli:playwright-cli\` and a \`login_state\`), then observe again`, { failure: report.loginExpired, access: record.access });
  }
  if (report.loginExpired) {
    return refuse("login_expired", `the UI scout was asked to log in, so the login state saved for Access note \`${record.access}\` has expired: ${report.loginExpired}. Nothing was written: ${loginSteps({ url: record.url, loginState: record.login_state })}; then observe again`, { failure: report.loginExpired, access: record.access });
  }
  if (report.failed) return refuse("scout_failed", `the UI scout failed: ${report.failed}`, { failure: report.failed });
  if (report.problem) return refuse("report_shape", `the scout's report is not in its brief's shape: ${report.problem}; ${AGAIN}`);
  if (report.steps.length > UI_ACTION_CAP) {
    return refuse("over_cap", `the scout's report lists ${report.steps.length} steps, over the cap of ${UI_ACTION_CAP} commands: a scout that reaches the cap fails rather than report part of what it was asked; narrow the request, then observe again`);
  }
  for (const [i, step] of report.steps.entries()) {
    const why = prohibited(step);
    if (why) return refuse("prohibited_command", `step ${i + 1} of the scout's report ${why}, outside the commands its brief allows, so ${AGAIN}`);
  }

  const qa = resolve(root);
  const repo = dirname(qa);
  const date = localDate();
  const path = mintPath(join(qa, "observations"), `${date}-${slugOf(request)}`);
  const body = observationText({
    date,
    url: stripUrls(record.url),
    version: report.version,
    request,
    steps: report.steps.map((s) => s.replaceAll(`${repo}${sep}`, "").replaceAll(`${resolve(run.dir)}${sep}`, "")),
    facts: report.facts,
    notSeen: report.notSeen,
  });
  const checked = checkFile(parse(qaRel(qa, path), body), rootConfig(qa));
  if (!checked.ok) {
    return refuse("observation_invalid", `the Observation made from the scout's report fails check-file, so ${AGAIN}`, { errors: checked.errors });
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { flag: "wx" });
  return { exit: 0, json: { ok: true, path, uri: `file:${relative(repo, path).split(sep).join("/")}` } };
}

// A refusal every scout action prints (`scout.mjs` imports it): `{ok: false, reason, error}`, exit 1.
/**
 * @param {string} reason
 * @param {string} error
 * @param {Record<string, unknown>} [extra]
 * @returns {CommandResult}
 */
export const refuse = (reason, error, extra = {}) => ({ exit: 1, json: { ok: false, reason, error, ...extra } });

/**
 * @param {string} text
 * @returns {string[]}
 */
const linesOf = (text) => text.replace(/\r\n/g, "\n").split("\n");

// Where the shared credential matcher finds something in the report or the request, and what kind,
// never the value; null when it finds nothing.
/**
 * @param {string} report
 * @param {string} request
 * @returns {string | null}
 */
function secretIn(report, request) {
  const lines = linesOf(report);
  for (let i = 0; i < lines.length; i++) {
    const found = credentialIn(lines[i]);
    if (found) return `line ${i + 1} of the scout's report holds text in the format of ${found}`;
  }
  const found = credentialIn(request);
  return found ? `the request the scout was briefed for holds text in the format of ${found}` : null;
}

// The report in the brief's shape: `App version: <x | none>`, `## Steps` numbering each command run
// as one code span, `## Facts` numbering one statement each, then optionally `## Not seen` numbering
// each part of the request behind input the scout may not give; blank lines anywhere. Returns
// `{version, steps, facts, notSeen}` (each item's text), `{loginExpired}` (the sentence of a
// `FAILED: login: ` report), `{failed}` (the reason of any other `FAILED: ` report), or `{problem}`,
// which names a line, never its text.
/**
 * @param {string} text
 * @param {string} session
 * @returns {ScoutReport | ScoutReportRefusal}
 */
function parseReport(text, session) {
  const lines = linesOf(text);
  const filled = lines.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => l.trim());
  if (!filled.length) return { problem: "it is empty" };
  const failed = /^FAILED:\s*(\S.*)$/.exec(filled[0].l);
  if (failed && filled.length === 1) {
    const reason = failed[1].trim();
    const login = /^login:\s*(\S.*)$/.exec(reason);
    return login ? { loginExpired: login[1] } : { failed: reason };
  }

  /** @param {number} n @param {string} what @returns {ScoutReportRefusal} */
  const at = (n, what) => ({ problem: `line ${n} ${what}` });
  const version = /^App version:\s*(\S.*)$/.exec(filled[0].l);
  if (!version) return at(filled[0].n, "is not the `App version: <the version, or none>` line it begins with");
  /** @type {string[]} */
  const steps = [];
  /** @type {string[]} */
  const facts = [];
  /** @type {string[]} */
  const notSeen = [];
  /** @type {string[] | null} */
  let list = null;
  /** @type {number | null} */
  let notSeenAt = null;
  for (const { l, n } of filled.slice(1)) {
    if (l === "## Steps" && list === null) list = steps;
    else if (l === "## Facts" && list === steps) list = facts;
    else if (l === "## Not seen" && list === facts) [list, notSeenAt] = [notSeen, n];
    else if (/^#/.test(l)) {
      return at(n, list === null ? "is a heading where `## Steps` comes next"
        : list === steps ? "is a heading where `## Facts` comes next"
        : list === facts ? "is a heading after `## Facts`, where only `## Not seen` may follow"
        : "is a heading after `## Not seen`, which ends the report");
    } else {
      const item = /^(\d+)\. (\S.*)$/.exec(l);
      if (!list || !item) return at(n, "is not an item of a numbered list under `## Steps`, `## Facts` or `## Not seen`");
      if (Number(item[1]) !== list.length + 1) return at(n, `is numbered ${item[1]} where ${list.length + 1} comes next`);
      if (list === steps) {
        const problem = stepProblem(item[2], session);
        if (problem) return at(n, problem);
      }
      list.push(item[2]);
    }
  }
  if (!steps.length) return { problem: "it lists no steps under a `## Steps` heading" };
  if (!facts.length) return { problem: "it numbers no facts under a `## Facts` heading, after the steps" };
  if (notSeenAt && !notSeen.length) return at(notSeenAt, "is a `## Not seen` heading with nothing numbered under it");
  const v = version[1].trim();
  return { version: /^none$/i.test(v) ? null : v, steps, facts, notSeen };
}

// What is wrong with a step's shape, or null: one code span holding the command as run, and a
// playwright-cli command passes this scout's own session first.
/**
 * @param {string} step
 * @param {string} session
 * @returns {string | null}
 */
function stepProblem(step, session) {
  if (!/^`[^`]+`$/.test(step)) return "is a step that is not the command run, as one code span";
  if (/^`playwright-cli\s/.test(step) && !step.startsWith(`\`playwright-cli -s=${session} `)) {
    return `is a playwright-cli step not run in this scout's session \`-s=${session}\``;
  }
  return null;
}

// Why a step falls outside the brief's allow-list (lib/scout-prompt.mjs), or null when it does not.
// `click` passes as the brief narrows it (a link, a tab, or a combobox opened and closed again with
// `press Escape`), since the report cannot show what was clicked; `press` only with Escape or a
// scrolling key. Names the command, never the rest of the step.
const PRESS_KEYS = ["Escape", ...UI_SCROLL_KEYS];
/**
 * @param {string} step
 * @returns {string | null}
 */
function prohibited(step) {
  const words = step.slice(1, -1).trim().split(/\s+/);
  if (words[0] !== "playwright-cli") return `runs \`${words[0]}\`, not playwright-cli`;
  const [cmd, arg] = words.slice(2);
  if (UI_ALLOWED.includes(cmd) || cmd === "click") return null;
  if (cmd === "press") return PRESS_KEYS.includes(arg) ? null : `runs \`${["press", arg].filter(Boolean).join(" ")}\`, and \`press\` is ${UI_NARROW.press}`;
  return cmd ? `runs \`${cmd}\`` : "runs playwright-cli with no command";
}

// The request in kebab-case without its stop words (`s` is the possessive's), cut at the last whole
// word within SLUG_MAX characters; a request of nothing but stop words keeps them, and one with no
// word at all is `observation`.
const SLUG_MAX = 50;
const STOP_WORDS = new Set(["a", "an", "the", "of", "its", "it", "as", "and", "or", "to", "in", "on", "at", "for", "with", "by", "is", "s"]);
/**
 * @param {string} request
 * @returns {string}
 */
function slugOf(request) {
  const words = request.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return kebab(words.filter((w) => !STOP_WORDS.has(w))) || kebab(words) || "observation";
}

// `words` joined by hyphens, as many whole words as fit in SLUG_MAX characters.
/**
 * @param {string[]} words
 * @returns {string}
 */
function kebab(words) {
  let slug = "";
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > SLUG_MAX) break;
    slug = next;
  }
  return slug;
}

// `<dir>/<name>.md`, or `<name>-2.md`, `-3` … when it is taken: an Observation is never overwritten.
/**
 * @param {string} dir
 * @param {string} name
 * @returns {string}
 */
function mintPath(dir, name) {
  for (let n = 1; ; n++) {
    const path = join(dir, `${name}${n === 1 ? "" : `-${n}`}.md`);
    if (!existsSync(path)) return path;
  }
}

/**
 * @param {ObservationInput} input
 * @returns {string}
 */
function observationText({ date, url, version, request, steps, facts, notSeen }) {
  return [
    "---",
    "type: observation",
    `observed_at: ${date}`,
    `url: ${url}`,
    `app_version: ${version === null ? "null" : quote(version)}`,
    `request: ${quote(request)}`,
    "---",
    "",
    "## Steps",
    "",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Facts",
    "",
    ...facts.map((f, i) => `${i + 1}. ${f}`),
    "",
    ...(notSeen.length ? ["## Not seen", "", ...notSeen.map((x, i) => `${i + 1}. ${x}`), ""] : []),
  ].join("\n");
}
