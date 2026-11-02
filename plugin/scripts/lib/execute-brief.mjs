// @ts-check
// `execute brief`: the Tester's brief for one opened Execution, so every Tester
// works from the same contract. The skill passes it verbatim.
//
//   brief --dir <run-dir> --execution <id> [--root <qa-dir>]
//       Prints `{action: "brief", ok, execution, text}`, `text` the brief, from `execute.json` (the
//       Execution as the plan pinned it: its case text is the pinned one, never `.qa/features/`'s now)
//       and `guard.json` (the cap, the upload names, the Role tokens of the sessions). Only the
//       Feature's context (its Rules, its References and Observations) and `train/execute.md` are read
//       from the working tree. `not_open` before `execute open`.
//
// Sections, in order: Task, The case, The Feature, Sessions, Commands, Rules, Training, The report. A
// session name, a login state, an Access note key, a `match` prefix or a `.qa/fixtures/` path never
// reaches it. Its command lines are the ones the Tester hook admits (lib/tester-guard.mjs): a plain
// `node <plugin>/scripts/scan.mjs tester do|request …`, each word bare or single-quoted.
/**
 * @import { CommandAction, CommandResult } from "./cli.mjs"
 * @import { ExecuteExecution, ExecutePlan } from "./execute.mjs"
 * @import { ExecuteTrainingEntry } from "./execute-training.mjs"
 * @import { ExecutionGuard, ExecutionSession } from "./execution-guard.mjs"
 * @import { ParsedEntry, ParsedFile, ParsedRule } from "./knowledge-file.mjs"
 * @import { RefusalResult } from "./refusal.mjs"
 * @import { KeyIndex, TreeFile } from "./qa-index.mjs"
 */
import { realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SCAN_CLI, noArguments, requireOption } from "./cli.mjs";
import { redactCredentials, shownKey } from "./credentials.mjs";
import { execution } from "./execute-open.mjs";
import { executeTraining } from "./execute-training.mjs";
import { GUARD_STOPS, executionDir, readGuard } from "./execution-guard.mjs";
import { REPORT_EXAMPLES } from "./execution-report.mjs";
import { repositoryOf } from "./git-tree.mjs";
import { TESTER_REASONS } from "./check-file.mjs";
import { buildIndex, loadWorkingTree } from "./qa-index.mjs";
import { refusalsFor } from "./refusal.mjs";
import { EXECUTE_TRAIN_KEY } from "./schema.mjs";
import { TESTER_ALLOWED } from "./tester-command.mjs";
import { bindingLine } from "./tester-guard.mjs";
import { trainFile } from "./training.mjs";

/**
 * Result of building an Execution brief.
 * @typedef {{
 *   text: string,
 *   refusal?: never,
 * } | {
 *   refusal: RefusalResult,
 *   text?: never,
 * }} ExecutionBriefResult
 */

/**
 * Feature context gathered from the working tree for the brief.
 * @typedef {{
 *   summary: string | null,
 *   rules: ParsedRule[],
 *   entryPoints: string[],
 * }} FeatureContext
 */

/**
 * Training context gathered from the working tree for the brief.
 * @typedef {{
 *   setup_role?: string,
 *   entries: ExecuteTrainingEntry[],
 * }} TrainingContext
 */

/**
 * Context passed to each section builder of the brief.
 * @typedef {{
 *   pinned: ExecutePlan,
 *   ex: ExecuteExecution,
 *   guard: ExecutionGuard,
 *   runDir: string,
 *   execDir: string,
 *   target: { slug: string, origin: string },
 *   feature: FeatureContext,
 *   training: TrainingContext,
 * }} BriefContext
 */

const { stop } = refusalsFor({
  not_open: "The Execution is not open; run `execute open` for it before building its brief.",
});

// One shell word the Tester hook admits: bare when it is only safe characters, else single-quoted.
/**
 * @param {string} s
 * @returns {string}
 */
const word = (s) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);
/**
 * @param {unknown} s
 * @returns {string}
 */
const code = (s) => `\`${s}\``;
/**
 * @param {readonly string[]} items
 * @returns {string[]}
 */
const list = (items) => items.map((i) => `- ${i}`);
// A fence longer than any run of backticks in `text`, so a pinned case's own `yaml` block cannot close it.
/**
 * @param {string} text
 * @returns {string}
 */
const fenceFor = (text) => "`".repeat(Math.max(4, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));

// How each `tester do` command is written, `<ref>` being a `ref` of the latest snapshot. Free text and
// URLs are single-quoted: the hook admits no other quote.
/** @type {Record<string, [string, string]>} */
const COMMANDS = {
  goto: ["goto '<url>'", "go to a URL, a path on the target (`/loans`) or a full URL on its origin"],
  "go-back": ["go-back", "go back a page"],
  reload: ["reload", "reload the page"],
  snapshot: ["snapshot", "print the page's snapshot, with the `ref` of each element"],
  screenshot: ["screenshot", "take a screenshot (kept in the run dir)"],
  click: ["click <ref> [left|right|middle]", "click an element"],
  dblclick: ["dblclick <ref> [left|right|middle]", "double-click an element"],
  fill: ["fill <ref> '<text>' [--submit]", "type into a field; `--submit` presses Enter after"],
  check: ["check <ref>", "tick a checkbox or radio"],
  uncheck: ["uncheck <ref>", "untick a checkbox"],
  select: ["select <ref> '<value>'", "choose an option of a select"],
  hover: ["hover <ref>", "hover over an element"],
  press: ["press <key>", "press one key, such as `Enter` or `Control+a` (single-quote a key that is not a letter or digit)"],
  "tab-list": ["tab-list", "list the open tabs"],
  "tab-select": ["tab-select <n>", "switch to tab n of `tab-list`"],
  "dialog-accept": ["dialog-accept ['<text>']", "accept the open dialog, answering a prompt with the text"],
  "dialog-dismiss": ["dialog-dismiss", "dismiss the open dialog"],
  upload: ["upload <fixture-name>", "attach one of the fixtures listed below to the file input the last snapshot shows"],
  console: ["console", "print the browser console"],
};
const REQUEST = "<METHOD> '<url>' [--query <k>=<v>]… [--header '<k>:<v>']… [--json '<body>']";

// The Role token of a session: its slug, or `-` for the case without Roles.
/**
 * @param {ExecutionSession} s
 * @returns {string}
 */
const tokenOf = (s) => (s.role === "-" ? "-" : s.slug);

/**
 * @param {BriefContext} param0
 * @returns {string[]}
 */
function taskSection({ pinned, ex, execDir }) {
  return [
    "## Task",
    "",
    `You are the Tester for Execution ${code(ex.id)} (${code(ex.key)}: ${ex.summary}) of Run ${code(pinned.run)}. Carry out the case below in the live application and report what you saw.`,
    "",
    ...list([
      `Tag: ${code(`qa-${pinned.run}`)}. It marks everything you create (see Rules).`,
      `Report: write ${code(`${execDir}/report.md`)}, in the grammar of The report. It is the only file you write.`,
      `Reply ${code("DONE")} once the report is written, whatever its result; reply ${code("FAILED: <reason>")} only when you could not write it.`,
    ]),
  ];
}

/**
 * @param {BriefContext} param0
 * @returns {string[]}
 */
function caseSection({ ex }) {
  const fence = fenceFor(ex.text);
  const via = ex.mode === "api" ? `Its level ${code(ex.level)} runs in ${code("api")} mode: carry out the steps through ${code("tester request")}.` : `Its level ${code(ex.level)} runs in ${code("browser")} mode: carry out the steps through ${code("tester do")}.`;
  return [
    "## The case",
    "",
    ...list([
      `Key: ${code(ex.key)}${ex.tracker ? ` (Tracker: ${ex.tracker})` : ""}`,
      `Roles: ${ex.roles.length ? ex.roles.join(", ") : "none"}`,
      via,
    ]),
    "",
    "This is the case as it stood when the Run was planned. Follow it, not any other copy:",
    "",
    `${fence}markdown`,
    ex.text,
    fence,
  ];
}

/**
 * @param {BriefContext} param0
 * @returns {string[]}
 */
function featureSection({ ex, feature, target }) {
  const lines = ["## The Feature", "", `Feature ${code(ex.feature)}${feature.summary ? `: ${feature.summary}` : ""}.`];
  if (feature.rules.length) {
    lines.push("", "Rules, for context and terms only. Never fail a case for a Rule the Expected result does not assert:", "", ...list(feature.rules.map((r) => `${code(shownKey(r.key))}: ${r.statement}`)));
  }
  if (feature.entryPoints.length) {
    lines.push("", `Where the Feature lives on ${target.slug} (paths on its origin; ${code("goto")} takes them as they are):`, "", ...list(feature.entryPoints.map(code)));
  }
  return lines;
}

/**
 * @param {BriefContext} param0
 * @returns {string[]}
 */
function sessionsSection({ pinned, guard }) {
  const sessions = guard.sessions.map((s) => {
    const who = s.role === "-" ? "the case has no Roles" : `Role ${s.role}`;
    return `${who}: pass ${code(tokenOf(s))} as \`<role>\`${s.setup ? ". Marked setup: it only prepares data for a precondition and never acts in a numbered Step" : ""}`;
  });
  return [
    "## Sessions",
    "",
    `Target: ${pinned.target.slug}, ${pinned.target.origin}. You stay on that origin. Each session below is already open; a Role's session is signed in as that Role's test account.`,
    "",
    ...list(sessions),
  ];
}

/**
 * @param {BriefContext} param0
 * @returns {string[]}
 */
function commandsSection({ ex, guard, runDir, execDir }) {
  const head = (/** @type {string} */ verb) => `node ${word(SCAN_CLI)} tester ${verb} ${ex.id}`;
  const dir = `--dir ${word(runDir)}`;
  const uploads = Object.keys(guard.uploads ?? {});
  return [
    "## Commands",
    "",
    "Every action is one standalone command through Bash, and these are the only commands you have. Write each as a plain `node …` line with nothing before or after it: single quotes only (an apostrophe inside is `'\\''`), no `cd … &&`, no `;`, `&&`, `|`, `$(…)`, no environment-variable prefix, no double quotes. Free text and URLs are always single-quoted.",
    "",
    `In the lines below ${code("<role>")} is a Role token from Sessions. Each line ends with ${code(dir)}, as shown.`,
    "",
    "Browser commands:",
    "",
    ...TESTER_ALLOWED.map((name) => `- ${code(`${head("do")} <role> ${COMMANDS[name][0]} ${dir}`)}: ${COMMANDS[name][1]}`),
    "",
    "HTTP requests, sent with the Role's own session. The URL may be relative to the target origin; the method is one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS:",
    "",
    `- ${code(`${head("request")} <role> ${REQUEST} ${dir}`)}`,
    "",
    `Each command prints what the browser or the app answered, then a trailer: ${code("used")} and ${code("cap")} (the actions spent and the budget, ${guard.cap} in all), ${code("page_url")}, ${code("modal: true")} while a dialog blocks the page (answer it with ${code("dialog-accept")} or ${code("dialog-dismiss")} first), ${code("at_login: true")} when the app landed on its sign-in page, and ${code("stopped")} once the Execution is stopped. A refused command counts as an action too.`,
    "",
    uploads.length ? `Upload fixtures for ${code("upload")}: ${uploads.map(code).join(", ")}. Nothing else can be attached.` : `There are no upload fixtures: ${code("upload")} is refused.`,
    "",
    `You may Read only the files a command prints under ${code(`${execDir}/.playwright-cli/`)} and the responses saved under ${code(`${execDir}/responses/`)} (${code("<n>.json")}). Read nothing else.`,
  ];
}

/**
 * @param {BriefContext} param0
 * @returns {string[]}
 */
function rulesSection({ pinned, ex }) {
  const tag = `qa-${pinned.run}`;
  /** @type {Record<string, string>} */
  const reasons = {
    "no-access": "the app showed its sign-in page (`at_login: true`) in setup or in a step that neither logs out nor tests login, or the guard stopped you with `no-access`. In setup, `reached: 0`",
    precondition: "a precondition could not be established or checked, or setup failed in any way, a recipe the app rejected and an unexpected `5xx` in setup included. `reached: 0`",
    step: "a step cannot be carried out as written (the element or button it names is not there, a command is refused), an Expected-result clause can only be seen outside the target, or a step would touch an account or shared fixture you may not (see Limits)",
    "ambiguous-actor": "a case with two or more Roles has a step that does not open with `As <Role>, `. `reached` is that step",
    "action-cap": "the action budget is spent. The guard sets it; you report what you have",
    "off-target": "the browser left the target origin. The guard sets it; you report what you have",
    "connection-lost": "the browser or the app was lost during the run. The guard sets it; you report what you have",
  };
  return [
    "## Rules",
    "",
    "The case",
    ...list([
      "One Execution is this one case. Carry out its steps in order and nothing else: improvise no step, skip none, add none.",
      "In a case with two or more Roles each step opens with `As <Role>, `: use that Role's session for it. A step that does not name its actor stops you: Blocked `ambiguous-actor`. A Role marked setup never acts in a numbered Step.",
      "When one Role's step makes something another Role's step uses, note its identifier (an id, a name) as you go and use that identifier, not a guess.",
    ]),
    "",
    "Preconditions",
    ...list([
      "The preconditions are the list items under **Preconditions.** of the case, or its non-empty lines when it is not a list; there may be none.",
      "Data a precondition needs that a Role can make or change is established: create a fresh entity and bring it to the state required, with the commands above, in any session you hold. What your Roles cannot create (environment, configuration, seed data) is only checked.",
      "A precondition that needs a Role you have no session for, or a password, is Blocked `precondition`. Any setup failure is Blocked `precondition`, never Failed, unless a guard stop overrides it.",
      "Setup spends actions from the same budget as the steps.",
      "Report each precondition as `{text, status, how?}`, `status` established, checked, unmet or skipped. Every precondition after the first unmet one is skipped.",
    ]),
    "",
    "Data",
    ...list([
      `Use fresh entities of your own by default. Put ${code(tag)} in the name, title, summary, description or note fields the case neither fixes nor leaves blank (${code(`${tag}@example.com`)} for an email), never in a field the app validates.`,
      "Use existing data only when Training names it as a fixture (create fresh children under it when the case changes them), or for read-only reference data your Roles cannot create. If there is none, Blocked `precondition`.",
      "Do not tear anything down. List in `created` each entity you made, in setup or in the steps, by a short label with no secret in it.",
    ]),
    "",
    "Limits",
    ...list([
      "A step that changes or destroys something acts only on an entity created in this Execution, or one Training marks disposable.",
      "Never delete, deactivate, lock, add MFA to or change the credentials of the account you are signed in as, and never destroy a named shared fixture. If the case needs it: Blocked `step` (`precondition` in setup).",
      "Outside the steps, only create entities, change your own, and empty the signed-in account's own containers (cart, drafts, saved-for-later, notifications) whole when a precondition needs them empty.",
      `${code("dialog-accept")} only inside a step that states a destructive action, or a setup change to an entity of this Execution. Any other destructive dialog gets ${code("dialog-dismiss")}.`,
      "Never copy a cookie, token, header value, password or any login-state content into the report, a label or an interpretation.",
    ]),
    "",
    "Stops and retries",
    ...list([
      `A refusal that names ${code("stopped")} (${GUARD_STOPS.map(code).join(", ")}) is final. Stop and write the report; the stop decides its result.`,
      "Do not retry to tell a flaky app from a failing one: \"flaky\" is no result and no reason. Taking `snapshot` again while a page or dialog is still rendering is not a retry.",
      "Never repeat `click`, `fill --submit`, `select` or `dialog-accept` once you have seen its outcome.",
      "Never retry a `request` on any HTTP status: an unexpected `5xx` is Failed in a step and Blocked `precondition` in setup. Only a transport `{error}` (no status) may be sent once more, inside the budget; judge that response as usual and record the retry as an interpretation.",
    ]),
    "",
    "Judging",
    ...list([
      "Judge each paragraph of the Expected result on what you saw. The case is Failed only when one paragraph was seen not to hold, and the report names the one clause that failed and quotes its paragraph verbatim.",
      "\"Succeeds\" means a `2xx` unless the Expected result names a status. \"Fails\", \"is rejected\" and \"is denied\" mean a `4xx` whose reason matches any reason the Expected result states, never a `5xx` unless it is named. Do not map a reason to a particular `4xx`. A status the Expected result names must match exactly.",
      "A UI label matches when it names the same action (\"Edit\" and \"Edit Offer\"); record it as an interpretation.",
      "An absence (\"no Mark Available Today\") is judged on the surface the step opened.",
      "A clause that can only be seen outside the target is Blocked `step`; never guess it.",
      "Where the text leaves something open, pick the reading that fits the case and record it as an interpretation: `<where>: <what the text left open> → <what I did>`, `<where>` being `setup`, `step N` or `expected`. One line each, at most 5, none with a secret.",
      "After the last step you started, run `console` once, in the session of the Role that acted last, and quote its error-level entries, shortened, in `**Evidence.**`: errors only, never warnings or info messages, never a secret. Skip it when a refusal named `stopped`, when the case was Blocked in setup (`reached: 0`), or when the last trailer shows `used` equal to `cap`: the read counts against the budget, so check the trailer before the call.",
      "Console errors never change the result on their own: one makes the case Failed only when an Expected-result paragraph says the console stays clean.",
    ]),
    "",
    "`reached` is the number of the last step you started, 0 for setup or when no step started.",
    "",
    "A case is Blocked, never Failed, whenever you could not get to an Expected result. The reasons:",
    "",
    ...list(TESTER_REASONS.map((r) => `${code(r)}: ${reasons[r]}.`)),
  ];
}

// An entry's operating fields, one `name: value` per line; an upload shows only what the Tester may know of a fixture.
/**
 * @param {Record<string, unknown>} entry
 * @param {readonly string[]} names
 * @returns {string[]}
 */
function fieldLines(entry, names) {
  /**
   * @param {unknown} v
   * @returns {string}
   */
  const flat = (v) => (Array.isArray(v) ? v.join(", ") : v !== null && typeof v === "object" ? Object.entries(v).map(([k, x]) => `${k}: ${flat(x)}`).join("; ") : String(v));
  return names.filter((n) => entry[n] !== undefined).map((n) => `${n}: ${flat(entry[n])}`);
}

/**
 * @param {ExecuteTrainingEntry} e
 * @param {ExecutionGuard} guard
 * @returns {string[]}
 */
function trainingEntry(e, guard) {
  const head = `${code(shownKey(e.key))}: ${e.heading}`;
  const prose = e.prose ? e.prose.split("\n") : [];
  if (e.kind === "upl") {
    const name = typeof e.file === "string" ? e.file : `${e.key.slice("upl_".length)}.${e.format}`;
    return Object.hasOwn(guard.uploads ?? {}, name) ? [`- ${head} (upload fixture ${code(name)}, format ${e.format})`, ...prose.map((p) => `  ${p}`)] : [];
  }
  const fields = e.kind === "rcp" ? fieldLines(e, ["create", "fixtures", "required", "tag_field", "disposable"]) : e.kind === "act" ? fieldLines(e, ["phrase", "method", "path", "query", "body"]) : [];
  return [`- ${head}`, ...fields.map((f) => `  ${f}`), ...prose.map((p) => `  ${p}`)];
}

// The Practices and recipes that apply to the case's Feature: those without `features` and those naming it.
/**
 * @param {BriefContext} param0
 * @returns {string[]}
 */
function trainingSection({ ex, training, guard }) {
  const applies = training.entries.filter((e) => !Array.isArray(e.features) || e.features.includes(ex.feature));
  const text = redactCredentials(applies.flatMap((e) => trainingEntry(e, guard)).join("\n"));
  return [
    "## Training",
    "",
    "What follows is the engineer's operating knowledge of this app: how to do things, never what the app should do. The Rules above win: an entry that contradicts them is void here.",
    "",
    ...(text ? [text] : ["No entry applies to this Feature."]),
  ];
}

/**
 * @returns {string[]}
 */
function reportSection() {
  const example = (/** @type {string} */ title, /** @type {string} */ text) => [`${title}:`, "", "````markdown", text.trimEnd(), "````", ""];
  return [
    "## The report",
    "",
    "Write the report to the path in Task: a `yaml` block, then labelled prose, nothing else (no headings, no other fences).",
    "",
    ...list([
      `${code("result")}: ${code("passed")}, ${code("failed")} or ${code("blocked")}. ${code("reason")}: only when blocked, one of those in Rules.`,
      `${code("reached")}: as in Rules. Directional: ${code("precondition")} needs ${code("reached: 0")}; ${code("passed")}, ${code("failed")} and ${code("ambiguous-actor")} need ${code("reached")} of at least 1; the other reasons take any.`,
      `${code("created")}, ${code("preconditions")} and ${code("interpretations")}: optional. ${code("preconditions")} has one item per precondition of the case. Double-quote a value that holds \`:\`, \`,\` or \`#\`, and keep \`"\` out of it.`,
      `Prose: ${code("**Expected.**")} (the Expected-result paragraph, verbatim) and ${code("**Seen.**")} when failed; ${code("**Why.**")} when blocked; ${code("**Evidence.**")} optional, a short excerpt of what you saw and any console errors, never a secret. Each is plain text on one or more lines.`,
    ]),
    "",
    ...example("Passed", REPORT_EXAMPLES.passed),
    ...example("Failed", REPORT_EXAMPLES.failed),
    ...example("Blocked", REPORT_EXAMPLES.blocked),
  ];
}

const MAX_ENTRY_POINTS = 10;

// The Feature's context from the working tree: its title, its live Rules, and the paths on the target
// that its References point at: a `url:` Reference on the target origin, and the page of each
// Observation it cites (`file:`), which may have been taken on another origin and is resolved here.
/**
 * @param {string | undefined} root
 * @param {{ files: readonly TreeFile[], index: KeyIndex }} ctx
 * @param {ExecuteExecution} ex
 * @param {{ slug: string, origin: string }} target
 * @returns {FeatureContext}
 */
function featureContext(root, { files, index }, ex, target) {
  const file = index.features.get(ex.feature)?.[0]?.file;
  if (!file) return { summary: null, rules: [], entryPoints: [] };
  const retired = new Set(Array.isArray(file.data.retired) ? file.data.retired : []);
  const sources = /** @type {string[]} */ (Array.isArray(file.data.sources) ? file.data.sources.filter((s) => typeof s === "string") : []);
  /** @type {string[]} */
  const paths = [];
  const add = (/** @type {string} */ href, { anyOrigin = false } = {}) => {
    try {
      const url = new URL(href);
      if ((anyOrigin || url.origin === target.origin) && !paths.includes(url.pathname)) paths.push(url.pathname);
    } catch {
      // A source that is no URL is no entry point.
    }
  };
  for (const s of sources) if (s.startsWith("url:")) add(s.slice("url:".length));
  const top = repositoryOf(root)?.top;
  if (top) {
    const observed = new Map(files.filter((f) => f.type === "observation" && typeof /** @type {NonNullable<typeof f.data>} */ (f.data).url === "string").map((f) => [relative(top, join(realpathSync(/** @type {string} */ (root)), f.rel)).split(sep).join("/"), /** @type {string} */ (/** @type {NonNullable<typeof f.data>} */ (f.data).url)]));
    for (const s of sources) if (s.startsWith("file:") && observed.has(s.slice("file:".length))) add(/** @type {string} */ (observed.get(s.slice("file:".length))), { anyOrigin: true });
  }
  return { summary: file.h1?.text ?? null, rules: file.rules.filter((r) => !retired.has(r.key)), entryPoints: paths.slice(0, MAX_ENTRY_POINTS) };
}

// The brief of Execution `id` in the Run at `dir`: `{text}`, or `{refusal}` (unknown id, not open).
/**
 * @param {string | undefined} dir
 * @param {string} id
 * @param {{ root?: string }} options
 * @returns {ExecutionBriefResult}
 */
export function executionBrief(dir, id, { root }) {
  const found = execution(dir, id, "brief");
  if (found.refusal) return found;
  const { pinned, ex } = found;
  const guard = readGuard(executionDir(found.runDir, id));
  if (!guard) return { refusal: stop("not_open", { execution: id }) };
  const runDir = realpathSync(found.runDir);
  const files = loadWorkingTree(root);
  const index = buildIndex(files);
  const ctx = {
    pinned, ex, guard, runDir, execDir: executionDir(runDir, id), target: pinned.target,
    feature: featureContext(root, { files, index }, ex, pinned.target),
    training: executeTraining(trainFile(index, EXECUTE_TRAIN_KEY)),
  };
  /** @type {Array<(c: BriefContext) => string[]>} */
  const sections = [taskSection, caseSection, featureSection, sessionsSection, commandsSection, rulesSection, trainingSection, reportSection];
  return { text: `${bindingLine(runDir, id)}\n\n${sections.map((section) => section(ctx).join("\n")).join("\n\n")}\n` };
}

/**
 * @param {readonly string[]} args
 * @param {{ dir?: string, execution?: string, root?: string }} options
 * @returns {CommandResult}
 */
function briefAction(args, { dir, execution: id, root }) {
  noArguments("execute brief", args, "--dir <run-dir> and --execution <id>");
  requireOption("execute brief", id, "--execution <id>", "an id of the plan's Executions");
  const built = executionBrief(dir, /** @type {string} */ (id), { root });
  if (built.refusal) return built.refusal;
  return { exit: 0, json: { action: "brief", ok: true, execution: id, text: built.text } };
}

/** @type {Record<string, CommandAction>} */
export const briefActions = {
  brief: { options: { root: "qa-dir", dir: "value", execution: "value" }, usage: "--dir <run-dir> --execution <id> [--root <qa-dir>]", run: briefAction },
};

