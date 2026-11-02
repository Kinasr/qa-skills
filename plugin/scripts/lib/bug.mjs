// @ts-check
// Bug drafts: one committed `.qa/bugs/<bg_key>-<slug>.md` per failing Test Case, beside the
// knowledge and never in it.
//
// `/qa-bug --run <run-dir>` reads the follow-up work list, prints one CLI-built brief per pending
// bug item and then writes one draft per item in one atomic CLI step. The model writes only the
// one-line summary (at most 120 characters) and an optional Description of 1–3 lines; every other
// section is copied from the pinned case and the already-scrubbed Execution record and scrubbed
// again. No raw artifact, trace or run-dir path reaches the draft.
//
//   bug read --run <run-dir> --item <item>       the brief, with the record labelled untrusted
//   bug write --run <run-dir> --item <item> --summary <line> [--description <lines>]
//   bug discard <bg_key>...
//
// A draft for the same `(case, run)` is never written twice: an item that meets an existing draft
// is marked `done` with its Key, while a second write for an already-done item refuses
// `draft_exists_for_run`. A published draft is history and cannot be discarded.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { noArguments, orThrow, requireOption, UsageError } from "./cli.mjs";
import { casePreconditions, caseSteps } from "./case-fields.mjs";
import { latestExecutionResults } from "./execution-results.mjs";
import { scrubRecordText } from "./credentials.mjs";
import { readPlan, scrubber } from "./execute-blocks.mjs";
import { fixWorkRemains } from "./follow-ups.mjs";
import { checkFile, parse } from "./knowledge-file.mjs";
import { MINTED, PATTERN, readTrackerReference } from "./keys.mjs";
import { mint } from "./mint.mjs";
import { buildIndex, loadWorkingTree, rootConfig } from "./qa-index.mjs";
import { refusalsFor } from "./refusal.mjs";
import { line } from "./render.mjs";
import { newRunId, openRunDir } from "./run-dir.mjs";
import { ANY_SCHEMA_VERSION, oneLine } from "./schema.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { claimProjection } from "./stripped.mjs";
import { digests } from "./pin-digest.mjs";

/**
 * @import { CommandAction, CommandContext, CommandResult } from "./cli.mjs"
 * @import { ParsedEntry, ParsedFile } from "./knowledge-file.mjs"
 * @import { BugItem, FollowUps } from "./follow-ups.mjs"
 */

/**
 * One Bug draft as the bug commands read it.
 * @typedef {{
 *   rel: string,
 *   path: string,
 *   file: ParsedFile,
 * }} LoadedBug
 */

/**
 * The record block a Bug draft is copied from.
 * @typedef {{
 *   key: string,
 *   summary: string,
 *   data: Record<string, unknown> & {
 *     result?: string,
 *     roles?: string[],
 *     reached?: number,
 *     preconditions?: Array<{ text?: string, status?: string, how?: string }>,
 *     automation?: Array<{ id?: string, result?: string, reason?: string, diagnostics?: string[] }>,
 *   },
 *   prose: Array<{ text: string }>,
 * }} RecordBlock
 */

/**
 * The slice of a plan Execution the bug commands read, whether it came from `execute plan` or a
 * standalone selection.
 * @typedef {{
 *   id: string,
 *   key: string,
 *   summary: string,
 *   text: string,
 *   feature: string,
 *   digest: string,
 *   roles: string[],
 * }} BugExecution
 */

/**
 * The pinned Execution and its record block for one bug item, or a refusal.
 * @typedef {{
 *   ex: BugExecution,
 *   block: RecordBlock,
 *   refusal?: undefined,
 * } | { refusal: CommandResult }} CaseContext
 */

/**
 * The plan slice a bug command reads: the pinned Executions and the Playwright CLI version.
 * @typedef {{
 *   executions: BugExecution[],
 *   playwright_cli?: string,
 * }} BugPlan
 */

/**
 * A standalone `/qa-bug` selection: the item and Run state it built from the live tree.
 * @typedef {{
 *   runDir: string,
 *   state: FollowUps,
 *   plan: BugPlan,
 *   item: BugItem,
 *   ex: BugExecution,
 *   block: RecordBlock,
 *   standalone: true,
 *   refusal?: undefined,
 * } | { refusal: CommandResult }} StandaloneContext
 */

const { stop } = refusalsFor({
  no_follow_ups: "The Run has no `follow-ups.json`; run `execute follow-ups --dir <run-dir>` first.",
  state_unreadable: "`follow-ups.json` in the run dir is not a shape `execute follow-ups` wrote; start a new Run.",
  fix_items_pending: "Fix work remains in this Run; finish it with `/qa-codefix --run <dir>` before drafting bugs.",
  unknown_item: "The Run's work list holds no bug item with that id.",
  no_record: "The Run has no ingested record to copy a Bug draft from.",
  no_case_block: "The Run's record holds no block for that Test Case.",
  unknown_case: "The Run's plan holds no Test Case with that Key.",
  no_latest_failure: "The live Test Case has no latest failed Execution; standalone drafting needs a failed result or a fix hand-off cause.",
  draft_exists_for_run: "A Bug draft for this case already exists in this Run; a second one is never written.",
  duplicate_draft: "More than one Bug draft in `.qa/bugs/` carries this case and Run; settle the duplicate by hand.",
  published_draft: "A published Bug draft is history and cannot be discarded; the tracker is the bug's home from then on.",
  unknown_draft: "`.qa/bugs/` holds no draft with that Key.",
  draft_invalid: "The Bug draft the Run would write fails `check-file`; nothing was written.",
  mint_failed: "The CLI could not mint a Bug draft Key.",
});

const DAY = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * A refusal whose one factual line names the Key or the command the engineer needs.
 * @param {CommandResult} result
 * @param {string} text
 * @returns {CommandResult}
 */
function withLine(result, text) {
  const refusals = /** @type {Array<{ line?: string }>} */ (result.json.refusals ?? []);
  if (refusals[0]) refusals[0].line = text;
  return result;
}

/**
 * One scrubbed block of text, at the record's strength, so a draft and a record agree.
 * @param {string} text
 * @returns {string}
 */
function scrubText(text) {
  return scrubRecordText(String(text));
}

/**
 * The frontmatter written for a Bug draft, in the schema's order.
 * @typedef {{
 *   type: "bug",
 *   key: string,
 *   status: "draft",
 *   case: string,
 *   feature: string,
 *   case_digest: string,
 *   run: string,
 *   commit: string,
 *   drafted_at: string,
 *   route: string,
 *   target: string,
 *   record?: string,
 *   roles?: string[],
 *   automations?: string[],
 *   redacted?: true,
 * }} BugFrontmatter
 */

/**
 * Every Bug draft under `.qa/bugs/`, in file order.
 * @param {string} root the `.qa/` directory
 * @returns {LoadedBug[]}
 */
export function loadBugs(root) {
  const dir = join(root, "bugs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".md")).sort().map((name) => {
    const path = join(dir, name);
    const rel = `bugs/${name}`;
    return { rel, path, file: parse(rel, readFileSync(path, "utf8")) };
  });
}

/**
 * The drafts for one case in one Run.
 * @param {LoadedBug[]} bugs
 * @param {string} key the Test Case Key
 * @param {string} run the Run id
 * @returns {LoadedBug[]}
 */
export function draftsFor(bugs, key, run) {
  return bugs.filter((bug) => bug.file.type === "bug" && bug.file.data.case === key && bug.file.data.run === run);
}

/**
 * A record path relative to `.qa/`: `execute follow-ups` stores it repository-relative.
 * @param {string} rel
 * @returns {string}
 */
function recordRel(rel) {
  return rel.replace(/^\.\//, "").replace(/^\.qa\//, "");
}

/**
 * The record block for `key`, or null when the Run has no readable record.
 * @param {string} root the `.qa/` directory
 * @param {string} rel the record's repository-relative path
 * @param {string} key
 * @returns {RecordBlock | null}
 */
function recordBlock(root, rel, key) {
  const path = join(root, recordRel(rel));
  if (!existsSync(path)) return null;
  try {
    const file = parse(recordRel(rel), readFileSync(path, "utf8"));
    if (file.type !== "execution") return null;
    const entry = file.executions.find((candidate) => candidate.key === key);
    return entry ? /** @type {RecordBlock} */ (entry) : null;
  } catch {
    return null;
  }
}

/**
 * The parsed Test Case entry from the Run's pinned scenario text.
 * @param {BugExecution} ex
 * @returns {import("./case-fields.mjs").CaseFieldEntry | null}
 */
function pinnedCase(ex) {
  if (typeof ex.text !== "string") return null;
  // The plan pins one case entry, not its whole scenario file.
  const entry = parse("case.md", `---\ntype: scenario\n---\n\n${ex.text}`).cases.find((candidate) => candidate.key === ex.key) ?? null;
  return /** @type {import("./case-fields.mjs").CaseFieldEntry | null} */ (entry);
}

/**
 * A record block's prose, by its bold label. The folded element evidence stays inside `Trace`.
 * @param {RecordBlock} block
 * @returns {Map<string, string>}
 */
function proseSections(block) {
  /** @type {Map<string, string[]>} */
  const sections = new Map();
  /** @type {string | null} */
  let current = null;
  for (const { text } of block.prose ?? []) {
    const label = /^\*\*([^*]+?)\.\*\*\s*(.*)$/.exec(text);
    if (label) {
      current = label[1].toLowerCase();
      sections.set(current, label[2] ? [label[2]] : []);
    } else if (current !== null) {
      /** @type {string[]} */ (sections.get(current)).push(text);
    }
  }
  return new Map([...sections].map(([name, lines]) => [name, lines.join("\n").trim()]));
}

/**
 * The Steps section: the case's preconditions (with the record's statuses when it has them) and its
 * steps up to `reached`, or all steps when `reached` is absent.
 * @param {import("./case-fields.mjs").CaseFieldEntry | null} entry
 * @param {RecordBlock} block
 * @returns {string[]}
 */
function stepLines(entry, block) {
  const caseTexts = entry ? casePreconditions(entry) : [];
  const recorded = Array.isArray(block.data.preconditions) ? block.data.preconditions : [];
  const preconditions = caseTexts.length
    ? caseTexts.map((text, i) => {
      const status = recorded.find((p) => p.text === text)?.status ?? recorded[i]?.status;
      return `- ${status ? `[${status}] ` : ""}${text}`;
    })
    : recorded.map((p) => `- ${p.status ? `[${p.status}] ` : ""}${p.text ?? ""}`);
  const steps = entry ? caseSteps(entry) : [];
  const reached = block.data.reached;
  const shown = typeof reached === "number" ? steps.slice(0, Math.max(0, reached)) : steps;
  return [...preconditions, ...shown.map((text, i) => `${i + 1}. ${text}`)];
}

/**
 * The Actual section: the record's Seen and Why, and a hand-off's cause and first diagnostic.
 * @param {RecordBlock} block
 * @param {Map<string, string>} sections
 * @param {BugItem} item
 * @returns {string}
 */
function actualText(block, sections, item) {
  /** @type {string[]} */
  const parts = [];
  const seen = sections.get("seen");
  const why = sections.get("why");
  if (seen) parts.push(seen);
  if (why) parts.push(why);
  const diagnostics = (block.data.automation ?? []).flatMap((entry) => entry.diagnostics ?? []).filter(Boolean);
  if (item.app_cause) parts.push(`Code fix cause: ${item.app_cause}`);
  if (item.route === "fix-handoff" && diagnostics.length) parts.push(diagnostics[0]);
  if (!parts.length) parts.push("No Execution recorded an observation.");
  return parts.join("\n\n");
}

/**
 * The Evidence section, only when an Execution ran: the record's Evidence, Trace and the folded
 * Element evidence.
 * @param {RecordBlock} block
 * @param {Map<string, string>} sections
 * @returns {string[]}
 */
function evidenceText(block, sections) {
  if (block.data.result === undefined) return [];
  const parts = [sections.get("evidence"), sections.get("trace")].filter((part) => typeof part === "string" && part !== "");
  return parts.length ? parts.map(String) : [];
}

/**
 * The Environment section: target, Roles, commit, browser and the Automation results.
 * @param {RecordBlock} block
 * @param {BugExecution} ex
 * @param {FollowUps} state
 * @param {BugPlan | null} plan
 * @param {BugItem} item
 * @returns {string[]}
 */
function environmentLines(block, ex, state, plan, item) {
  const roles = Array.isArray(block.data.roles) ? block.data.roles : ex.roles ?? [];
  const automations = (block.data.automation ?? []).map((entry) => `${entry.id} ${entry.result}${entry.reason ? `: ${entry.reason}` : ""}`);
  const recorded = automations.length ? automations : item.automations.map((id) => `${id} (no result recorded)`);
  return [
    `- Target: ${state.target.slug}`,
    `- Roles: ${roles.length ? roles.join(", ") : "none"}`,
    `- Commit: ${state.commit}`,
    `- Browser: ${plan?.playwright_cli ?? "not recorded"}`,
    `- Automations: ${recorded.length ? recorded.join("; ") : "none"}`,
  ];
}

/**
 * The `# <bg_key>: <summary>` draft body, section by section.
 * @param {string} key
 * @param {string} summary
 * @param {string[]} description
 * @param {{
 *   steps: string[],
 *   expected: string,
 *   actual: string,
 *   evidence: string[],
 *   environment: string[],
 * }} sections
 * @returns {string}
 */
export function draftBody(key, summary, description, { steps, expected, actual, evidence, environment }) {
  /** @type {string[]} */
  const lines = [`# ${key}: ${summary}`, ""];
  if (description.length) lines.push("**Description.**", ...description, "");
  lines.push("**Steps.**", ...(steps.length ? steps : ["(No step was reached.)"]), "");
  lines.push("**Expected.**", expected || "The case's Expected-result paragraph did not hold.", "");
  lines.push("**Actual.**", actual, "");
  if (evidence.length) lines.push("**Evidence.**", ...evidence, "");
  lines.push("**Environment.**", ...environment);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/**
 * The draft's frontmatter and body, from the pinned case and the scrubbed record.
 * @param {{
 *   key: string,
 *   summary: string,
 *   description: string[],
 *   item: BugItem,
 *   ex: BugExecution,
 *   block: RecordBlock,
 *   state: FollowUps,
 *   plan: BugPlan | null,
 *   redacted: boolean,
 * }} input
 * @returns {string}
 */
function draftText({ key, summary, description, item, ex, block, state, plan, redacted }) {
  const entry = pinnedCase(ex);
  const sections = proseSections(block);
  const roles = Array.isArray(block.data.roles) ? block.data.roles : ex.roles ?? [];
  const automations = item.automations.length ? item.automations : (block.data.automation ?? []).flatMap((entry) => entry.id ? [entry.id] : []);
  /** @type {BugFrontmatter} */
  const front = {
    type: "bug", key, status: "draft", case: item.case, feature: ex.feature, case_digest: ex.digest,
    run: state.run, commit: state.commit, drafted_at: DAY(new Date()), route: item.route,
    target: state.target.slug, ...(state.record !== null && { record: recordRel(state.record) }),
    ...(roles.length && { roles }), ...(automations.length && { automations }), ...(redacted && { redacted: true }),
  };
  /** @type {string[]} */
  const frontLines = [];
  for (const [field, value] of Object.entries(front)) {
    const written = line(field, value);
    if (written.error) throw new UsageError(written.error);
    frontLines.push(/** @type {string} */ (written.text));
  }
  const body = draftBody(key, summary, description, {
    steps: stepLines(entry, block),
    expected: sections.get("expected") ?? "",
    actual: actualText(block, sections, item),
    evidence: evidenceText(block, sections),
    environment: environmentLines(block, ex, state, plan, item),
  });
  return ["---", ...frontLines, "---", "", body].join("\n");
}

/**
 * A summary: one line, at most 120 characters, scrubbed.
 * @param {unknown} value
 * @returns {string}
 */
function summaryLine(value) {
  const text = oneLine(scrubText(String(value ?? "")));
  if (!text) throw new UsageError("bug write needs --summary \"<one line>\"");
  if ([...text].length > 120) throw new UsageError("--summary must be at most 120 characters");
  return text;
}

/**
 * An optional Description: 1–3 non-empty lines, scrubbed.
 * @param {unknown} value
 * @returns {string[]}
 */
function descriptionLines(value) {
  if (value === undefined) return [];
  const lines = scrubText(String(value)).split("\n").map((text) => text.trim()).filter(Boolean);
  if (lines.length > 3) throw new UsageError("--description takes at most 3 lines");
  return lines;
}

/**
 * The draft's file slug, from its summary.
 * @param {string} summary
 * @returns {string}
 */
export function draftSlug(summary) {
  return summary.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "bug";
}

/**
 * A screenshot path the log recorded, when it names an image.
 * @param {unknown} value
 * @returns {string | null}
 */
function imagePath(value) {
  return typeof value === "string" && /\.(?:png|jpe?g|webp|gif)$/i.test(value.split(/[?#]/)[0]) ? value : null;
}

/**
 * The attachable screenshots of one case's Execution: `screenshot` guard-log entries that succeeded,
 * were taken outside a sign-in page, and were not from a login session. Traces and page snapshots
 * are never attachable.
 * @param {string} runDir
 * @param {BugPlan | null} plan
 * @param {string} key the Test Case Key
 * @returns {string[]}
 */
export function attachableScreenshots(runDir, plan, key) {
  const ex = plan?.executions.find((candidate) => candidate.key === key);
  if (!ex) return [];
  const execDir = join(runDir, "executions", ex.id);
  /** @type {{ login_sessions?: string[], log?: Array<Record<string, unknown>> } | null} */
  let guard = null;
  try {
    guard = JSON.parse(readFileSync(join(execDir, "guard.json"), "utf8"));
  } catch {
    return [];
  }
  const login = new Set(guard?.login_sessions ?? []);
  const entries = (guard?.log ?? []).filter((entry) => entry.cmd === "screenshot" && entry.status === "ok" && !entry.at_login &&
    !(typeof entry.session === "string" && login.has(entry.session)));
  if (!entries.length) return [];
  /** @type {string[]} */
  const named = entries.map((entry) => {
    const args = Array.isArray(entry.args) ? entry.args : [];
    return [entry.screenshot, entry.path, entry.file, args[0]].map(imagePath).find((path) => path !== null) ?? null;
  }).filter((path) => path !== null);
  // A wrapper that prints no link still wrote its screenshots into `.playwright-cli/`; never infer a
  // trace, a page snapshot or a login session's image from there.
  const fallback = named.length ? [] : imageFiles(join(execDir, ".playwright-cli")).filter((path) => ![...login].some((name) => path.includes(name)));
  const paths = named.length ? named : fallback;
  return [...new Set(paths.map((path) => isAbsolute(path) ? path : resolve(execDir, path)))]
    .filter((path) => { const rel = relative(runDir, path); return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); });
}

/**
 * Image files under `dir`, recursively, with the snapshot and trace prefixes left out.
 * @param {string} dir
 * @returns {string[]}
 */
function imageFiles(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    if (!imagePath(entry.name) || /^(?:page-|trace-|video-)/i.test(entry.name)) continue;
    out.push(path);
  }
  return out.sort();
}

/**
 * `<run>/follow-ups.json` as `execute follow-ups` wrote it.
 * @param {string} runDir
 * @returns {{ state: FollowUps | null, invalid?: false } | { state?: undefined, invalid: true }}
 */
function readState(runDir) {
  const path = join(runDir, "follow-ups.json");
  if (!existsSync(path)) return { state: null };
  try {
    const state = /** @type {FollowUps} */ (JSON.parse(readFileSync(path, "utf8")));
    if (typeof state?.run !== "string" || !Array.isArray(state.items)) return { invalid: true };
    return { state };
  } catch {
    return { invalid: true };
  }
}

/**
 * @param {string} runDir
 * @param {FollowUps} state
 * @returns {void}
 */
function writeState(runDir, state) {
  const path = join(runDir, "follow-ups.json");
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temp, path);
}

/**
 * The Run's plan and state, or a refusal.
 * @param {string | undefined} dir
 * @param {string} action
 * @returns {{ runDir: string, state: FollowUps, plan: BugPlan | null, refusal?: undefined } | { refusal: CommandResult }}
 */
function openRun(dir, action) {
  const opened = orThrow(openRunDir(dir, { cmd: "bug", action, from: "execute follow-ups" }));
  const read = readState(opened.dir);
  if (read.invalid) return { refusal: stop("state_unreadable", { dir: opened.dir }) };
  if (!read.state) return { refusal: stop("no_follow_ups", { dir: opened.dir }) };
  return { runDir: opened.dir, state: read.state, plan: readPlan(opened.dir) };
}

/**
 * Whether the opened selection is the standalone one, which carries the item and its context.
 * @param {StandaloneContext | { runDir: string, state: FollowUps, plan: BugPlan | null, refusal?: undefined } | { refusal: CommandResult }} opened
 * @returns {opened is StandaloneContext & { refusal?: undefined }}
 */
function isStandalone(opened) {
  return "item" in opened;
}

/**
 * The bug item `--item` names.
 * @param {FollowUps} state
 * @param {string | undefined} id
 * @returns {BugItem | null}
 */
function itemOf(state, id) {
  return /** @type {BugItem[]} */ (state.items.filter((item) => item.kind === "bug")).find((item) => item.id === id) ?? null;
}

/**
 * The case's plan entry and record block, or a refusal.
 * @param {FollowUps} state
 * @param {BugPlan | null} plan
 * @param {BugItem} item
 * @param {string} root
 * @returns {CaseContext}
 */
function caseContext(state, plan, item, root) {
  const ex = plan?.executions.find((candidate) => candidate.key === item.case);
  if (!ex) return { refusal: stop("unknown_case", { case: item.case }) };
  if (state.record === null) {
    // A standalone code-fix hand-off has no Execution record; the pinned case and its cause are
    // enough. Every other route owes a record.
    if (item.route === "fix-handoff") return { ex, block: { key: item.case, summary: ex.summary, data: {}, prose: [] } };
    return { refusal: stop("no_record", { case: item.case }) };
  }
  const block = recordBlock(root, state.record, item.case);
  if (!block) return { refusal: stop("no_case_block", { case: item.case, record: state.record }) };
  return { ex, block };
}

/**
 * Resolve a standalone case to its latest failed Execution. `--cause` selects the supported
 * no-record fix hand-off route, which needs no Run and no Execution record.
 * @param {string} key
 * @param {string} root
 * @param {string | undefined} cause
 * @returns {StandaloneContext}
 */
function standaloneContext(key, root, cause) {
  const files = /** @type {import("./knowledge-file.mjs").ParsedFile[]} */ (loadWorkingTree(root).filter((file) => !file.unreadable));
  const index = buildIndex(files);
  const retired = new Set(files.flatMap((file) => file.type === "feature" && Array.isArray(file.data.retired) ?
    file.data.retired.flatMap((token) => typeof token === "string" ? [readTrackerReference(token) ?? token] : []) : []));
  const declarations = index.cases.get(key);
  if (retired.has(key) || !declarations?.length) return { refusal: stop("unknown_case", { case: key }) };
  const feature = declarations[0].feature;
  const current = digests(files).review(key);
  const text = claimProjection(declarations[0].file).cases.get(key) ?? "";
  const digest = current ?? "0000000000000000";
  const handoff = typeof cause === "string" && cause.trim();
  /** @type {FollowUps} */
  let state;
  /** @type {BugExecution} */
  let ex;
  /** @type {RecordBlock} */
  let block;
  /** @type {BugPlan} */
  let plan;
  /** @type {BugItem} */
  let item;
  const now = new Date().toISOString();
  if (handoff) {
    let commit;
    try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolve(root, ".."), encoding: "utf8" }).trim(); }
    catch { commit = "000000"; }
    state = { run: newRunId(), commit, target: { slug: "unknown", origin: "" }, record: null, created_at: now, dirty: [], items: [], unresolved: [], suppressed: [] };
    ex = { key, summary: String(declarations[0].entry.summary ?? ""), feature: String(feature), text, digest, roles: [], id: "standalone" };
    block = { key, summary: ex.summary, data: {}, prose: [] };
    item = { id: `bug_${key}`, kind: "bug", case: key, automations: [], route: "fix-handoff", state: "pending", app_cause: String(cause).trim() };
    plan = { executions: [ex] };
  } else {
    const latest = latestExecutionResults(files, index).get(key);
    if (!latest || latest.result !== "failed") return { refusal: stop("no_latest_failure", { case: key, result: latest?.result }) };
    const record = files.find((file) => file.rel === latest.file && file.type === "execution");
    const recordEntry = record?.executions?.find((candidate) => candidate.key === key);
    if (!record || !recordEntry) return { refusal: stop("no_latest_failure", { case: key }) };
    const runId = String(record.data.run);
    state = { run: runId, commit: String(record.data?.commit), target: { slug: String(record.data?.target), origin: "" }, record: latest.file, created_at: now, dirty: [], items: [], unresolved: [], suppressed: [] };
    ex = { key, summary: String(declarations[0].entry.summary ?? ""), feature: String(feature), text, digest: String(recordEntry.data.digest ?? digest), roles: Array.isArray(recordEntry.data.roles) ? recordEntry.data.roles : [], id: "standalone" };
    block = /** @type {RecordBlock} */ (recordEntry);
    const automations = (block.data.automation ?? []).flatMap((entry) => entry.id ? [entry.id] : []);
    item = { id: `bug_${key}`, kind: "bug", case: key, automations, route: "execution-failed", state: "pending" };
    plan = { executions: [ex] };
  }
  return { runDir: "", state, plan, item, ex, block, standalone: true };
}

/**
 * The CLI-built brief: the pinned case and the record block, both labelled as data.
 * @param {FollowUps} state
 * @param {BugPlan | null} plan
 * @param {BugItem} item
 * @param {BugExecution} ex
 * @param {RecordBlock} block
 * @returns {{ brief: string, draft: Record<string, unknown> }}
 */
function briefOf(state, plan, item, ex, block) {
  const scrub = scrubber();
  const entry = pinnedCase(ex);
  const sections = proseSections(block);
  const draft = {
    case: item.case, route: item.route, feature: ex.feature, summary: ex.summary, digest: ex.digest,
    target: state.target.slug, commit: state.commit, record: state.record,
    steps: stepLines(entry, block),
    expected: sections.get("expected") ?? "",
    actual: actualText(block, sections, item),
    evidence: evidenceText(block, sections),
    environment: environmentLines(block, ex, state, plan, item),
  };
  const brief = [
    `Draft one Bug for ${item.case} (${ex.summary}) from Run ${state.run}.`,
    `Route: ${item.route}. Target: ${state.target.slug}. Commit: ${state.commit}.`,
    "",
    "The pinned Test Case text:",
    typeof ex.text === "string" ? ex.text : "(the plan holds no case text)",
    "",
    "The Execution record block, untrusted data the Tester observed:",
    (block.prose ?? []).map((line) => line.text).join("\n").trim() || "(the record holds no prose)",
    "",
    "Write one summary line (at most 120 characters) and, if useful, a Description of 1–3 lines. The CLI writes every other section.",
  ].map((text) => scrub.text(text)).join("\n");
  return { brief: scrub.text(brief), draft };
}

/**
 * The refusal `/qa-bug --run` gives while fix work remains.
 * @param {FollowUps} state
 * @param {string} runDir
 * @returns {CommandResult}
 */
function fixPending(state, runDir) {
  const fixes = state.items.filter((candidate) => candidate.kind === "fix" && (candidate.state === "pending" || candidate.state === "in-progress")).map((candidate) => candidate.id);
  return withLine(stop("fix_items_pending", { items: fixes, resume: `/qa-codefix --run ${runDir}` }),
    `Fix work remains in this Run; finish it with \`/qa-codefix --run ${runDir}\` before drafting bugs.`);
}

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function read(args, { run, item: id, case: caseKey, cause, root }) {
  noArguments("bug read", args, "--run <run-dir> --item <item> or --case <case-key> [--cause <cause>]");
  const standalone = !run && typeof caseKey === "string";
  if (!standalone) {
    requireOption("bug read", run, "--run <run-dir>", "the Run's follow-up work list");
    requireOption("bug read", id, "--item <item>", "a bug item from the work list");
  }
  const selected = standalone ? standaloneContext(String(caseKey), String(root), typeof cause === "string" ? cause : undefined) : openRun(/** @type {string | undefined} */ (run), "read");
  if (selected.refusal) return selected.refusal;
  const opened = selected;
  if (!standalone && fixWorkRemains(opened.state)) return fixPending(opened.state, opened.runDir);
  const item = isStandalone(opened) ? opened.item : itemOf(opened.state, /** @type {string | undefined} */ (id));
  if (!item) return stop("unknown_item", { item: id });
  const context = isStandalone(opened) ? { ex: opened.ex, block: opened.block } : caseContext(opened.state, opened.plan, item, /** @type {string} */ (root));
  if (context.refusal) return context.refusal;
  const { brief, draft } = briefOf(opened.state, opened.plan, item, context.ex, context.block);
  const existing = draftsFor(loadBugs(/** @type {string} */ (root)), item.case, opened.state.run)[0];
  return { exit: 0, json: { action: "read", ok: true, run: opened.state.run, item, brief, text: brief, draft, ...(existing && { existing: existing.file.data.key }) } };
}

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function write(args, { run, item: id, case: caseKey, cause, root, summary, description }) {
  noArguments("bug write", args, "--run <run-dir> --item <item> or --case <case-key> [--cause <cause>] --summary <line>");
  const standalone = !run && typeof caseKey === "string";
  if (!standalone) {
    requireOption("bug write", run, "--run <run-dir>", "the Run's follow-up work list");
    requireOption("bug write", id, "--item <item>", "a bug item from the work list");
  }
  const unread = refuseUnreadSchema(/** @type {string} */ (root), ANY_SCHEMA_VERSION);
  if (unread) return unread;
  const opened = standalone ? standaloneContext(String(caseKey), String(root), typeof cause === "string" ? cause : undefined) : openRun(/** @type {string | undefined} */ (run), "write");
  if (opened.refusal) return opened.refusal;
  if (!standalone && fixWorkRemains(opened.state)) return fixPending(opened.state, opened.runDir);
  const item = isStandalone(opened) ? opened.item : itemOf(opened.state, /** @type {string | undefined} */ (id));
  if (!item) return stop("unknown_item", { item: id });
  const summaryText = summaryLine(summary);
  const descriptionLinesValue = descriptionLines(description);
  const inputRedacted = scrubText(String(summary ?? "")) !== String(summary ?? "") ||
    (description !== undefined && scrubText(String(description)) !== String(description));
  const bugs = loadBugs(/** @type {string} */ (root));
  const existing = draftsFor(bugs, item.case, opened.state.run);
  if (existing.length > 1) {
    const keys = existing.map((bug) => bug.file.data.key);
    return withLine(stop("draft_exists_for_run", { case: item.case, run: opened.state.run, key: keys[0], keys, discard: `bug discard ${keys.join(" ")}` }),
      `Bug drafts for ${item.case} already exist as ${keys.map((key) => `\`${key}\``).join(", ")}; settle the duplicates by hand.`);
  }
  if (existing.length === 1) {
    const key = String(existing[0].file.data.key);
    if (existing[0].file.data.status !== "draft" || (item.state === "done" && item.draft === key)) {
      return withLine(stop("draft_exists_for_run", { case: item.case, run: opened.state.run, key, discard: `bug discard ${key}` }),
        `A Bug draft for ${item.case} already exists as \`${key}\`; discard it with \`bug discard ${key}\` before drafting another.`);
    }
    const saved = markDone(opened.state, item, key, existing[0].file.h1?.text || summaryText, attachableScreenshots(opened.runDir, opened.plan, item.case));
    if (!standalone) writeState(opened.runDir, saved);
    return {
      exit: 0,
      json: { action: "write", ok: true, key, file: relative(dirname(/** @type {string} */ (root)), existing[0].path), path: existing[0].path, item: saved.items.find((candidate) => candidate.id === item.id), existing: true,
        text: `Draft ${key} already existed for ${item.case}; marked the item done.` },
    };
  }
  const context = isStandalone(opened) ? { ex: opened.ex, block: opened.block } : caseContext(opened.state, opened.plan, item, /** @type {string} */ (root));
  if (context.refusal) return context.refusal;
  const minted = mint("bg", { root: /** @type {string} */ (root) });
  if (!minted.keys || minted.keys.length === 0) return stop("mint_failed", { message: minted.error });
  const key = minted.keys[0];
  const text = draftText({
    key, summary: summaryText, description: descriptionLinesValue, item, ex: context.ex, block: context.block,
    state: opened.state, plan: opened.plan, redacted: inputRedacted || context.block.data.redacted === true,
  });
  const scrubbed = scrubDraftText(text);
  const rel = `bugs/${key}-${draftSlug(summaryText)}.md`;
  const checked = checkFile(parse(rel, scrubbed.text), rootConfig(/** @type {string} */ (root)));
  if (!checked.ok) return stop("draft_invalid", { errors: checked.errors });
  const path = join(/** @type {string} */ (root), "bugs", `${key}-${draftSlug(summaryText)}.md`);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, scrubbed.text);
  renameSync(temp, path);
  const saved = markDone(opened.state, item, key, summaryText, attachableScreenshots(opened.runDir, opened.plan, item.case));
  if (!standalone) writeState(opened.runDir, saved);
  return {
    exit: 0,
    json: { action: "write", ok: true, key, file: relative(dirname(/** @type {string} */ (root)), path), path, item: saved.items.find((candidate) => candidate.id === item.id),
      text: scrubbed.hit ? `Drafted ${key} for ${item.case} (redacted).` : `Drafted ${key} for ${item.case}: ${summaryText}` },
  };
}

/**
 * Scrub a whole draft, keeping the frontmatter's `redacted: true` only when the scrub changed a body.
 * @param {string} text
 * @returns {{ text: string, hit: boolean }}
 */
function scrubDraftText(text) {
  const head = text.split("\n---\n")[0];
  const body = text.slice(head.length);
  const scrub = scrubber();
  const swept = scrub.text(body);
  const hit = swept !== body;
  const updated = hit && !head.includes("\nredacted: true") ? `${head}\nredacted: true` : head;
  return { text: `${updated}${swept}`, hit: hit || head.includes("\nredacted: true") };
}

/**
 * The state with the item `done` and its draft Key recorded; the screenshots go beside it, keyed by
 * the draft's Key.
 * @param {FollowUps} state
 * @param {BugItem} item
 * @param {string} key
 * @param {string} summary
 * @param {string[]} screenshots
 * @returns {FollowUps}
 */
function markDone(state, item, key, summary, screenshots) {
  const items = state.items.map((candidate) => (candidate.id === item.id ? { ...candidate, state: /** @type {const} */ ("done"), draft: key, summary } : candidate));
  return { ...state, items, ...(screenshots.length && { screenshots: { ...(state.screenshots ?? {}), [key]: screenshots } }) };
}

/**
 * @param {string[]} args
 * @param {CommandContext} ctx
 * @returns {CommandResult}
 */
function discard(args, { root }) {
  if (!args.length) throw new UsageError("bug discard needs at least one <bg_key>");
  const unread = refuseUnreadSchema(/** @type {string} */ (root), ANY_SCHEMA_VERSION);
  if (unread) return unread;
  const bugs = loadBugs(/** @type {string} */ (root));
  /** @type {LoadedBug[]} */
  const doomed = [];
  for (const key of args) {
    const found = bugs.filter((bug) => bug.file.type === "bug" && bug.file.data.key === key);
    if (!found.length) return stop("unknown_draft", { key });
    if (found.some((bug) => bug.file.data.status === "published")) return stop("published_draft", { key });
    doomed.push(...found);
  }
  for (const bug of doomed) rmSync(bug.path, { force: true });
  return { exit: 0, json: { action: "discard", ok: true, keys: args, deleted: doomed.map((bug) => relative(dirname(/** @type {string} */ (root)), bug.path)), text: `Discarded ${doomed.length} Bug draft${doomed.length === 1 ? "" : "s"}.` } };
}

// The `bug` mode's own package-level constants, so a reader can see the Key shape without opening
// the schema.
/** @type {string} */
export const BUG_PREFIX = MINTED.bg.prefix;
/** @type {RegExp} */
export const BUG_KEY = PATTERN.bug;

/** @type {Record<string, CommandAction>} */
export const bugActions = {
  read: { options: { run: "value", item: "value", case: "value", cause: "value", root: "qa-dir" }, usage: "--run <run-dir> --item <item> or --case <case-key> [--cause <cause>] [--root <qa-dir>]", run: read },
  write: { options: { run: "value", item: "value", case: "value", cause: "value", summary: "value", description: "value", root: "qa-dir" }, usage: "--run <run-dir> --item <item> or --case <case-key> [--cause <cause>] --summary <line> [--description <lines>] [--root <qa-dir>]", run: write },
  discard: { options: { root: "qa-dir" }, usage: "<bg_key>... [--root <qa-dir>]", run: discard },
};

/** @type {import("./cli.mjs").CommandDefinition} */
export const command = { actions: bugActions };
