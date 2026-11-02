// @ts-check
// The shared PR plumbing: mode and base resolution, the per-item commit chain, the preparation
// journal and its resume, the scrubbed PR body, and the outcome record. `fix` and `codegen` own
// their plan/verify/done guards and mount these actions; no network command is ever run here.
/** @import { PrFile } from "./pr-git.mjs" */
/** @import { CodeHost } from "./knowledge-file.mjs" */
/** @import { CommandAction, CommandResult } from "./cli.mjs" */
/** @import { RefusalFact } from "./refusal.mjs" */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { noArguments, requireOption } from "./cli.mjs";
import { scrubPageText } from "./credentials.mjs";
import { uncommittedUnder } from "./git.mjs";
import { within } from "./paths.mjs";
import { refusalsFor } from "./refusal.mjs";
import {
  committerIdentity, commitExists, commitFile, createRef, defaultBaseRef, diffTrees, headCommit,
  isAncestor, itemCommit, originSlug, pathsChanged, prGit, refCommit, sameFile, snapshotPrTree,
  symlinkEscapes, upstreamRef, workingFile, writeTreeFile,
} from "./pr-git.mjs";

// The item's `start` snapshots take this; callers should not reach into pr-git for it.
export { snapshotPrTree };

/**
 * A Run's PR options, fixed by its plan.
 * @typedef {{
 *   skill: "fix" | "codegen",
 *   repo: string,
 *   run: string,
 *   commit: string,
 *   modulePaths: string[],
 *   qaPaths?: string[],
 *   requested: boolean,
 *   codeHost?: CodeHost,
 *   target: { slug: string, origin?: string },
 * }} PrOptions
 */

/**
 * One verified item the caller hands over at its `done`.
 * @typedef {{
 *   id: string,
 *   automation?: string,
 *   case?: string,
 *   file?: string,
 *   cases?: { key: string, summary: string }[],
 *   route?: string,
 *   summary?: string,
 *   error?: string,
 *   evidence?: string,
 *   assertions_reduced?: string,
 *   expects?: Record<string, string[]>,
 *   message?: string,
 * }} PrItemInput
 */

/**
 * @typedef {PrItemInput & {
 *   commit: string,
 *   message: string,
 *   changes: Record<string, PrFile | null>,
 * }} PrItem
 */

/**
 * The mode a Run resolved, stated on its confirm.
 * @typedef {{
 *   kind: "pr" | "branch" | "working-tree",
 *   reason?: "not-requested" | "dirty" | "dirty-knowledge" | "external-mint-required" | "no-identity" | "no_code_host" | "no_tool" | "no_origin" | "no_base" | "base_diverged",
 *   base?: string,
 *   repo?: string,
 *   confirm: string,
 * }} PrMode
 */

/**
 * One touched path in the preparation journal: the content the Run produced (`final`) and the
 * content HEAD held (`restore`).
 * @typedef {{ final: PrFile | null, restore: PrFile | null }} PrJournalPath
 */

/**
 * The preparation manifest, written before the ref: everything a resume needs to finish, or to
 * refuse without overwriting what it finds.
 * @typedef {{
 *   mode: "pr" | "branch",
 *   branch: string,
 *   commit: string,
 *   base: string | null,
 *   repo: string | null,
 *   paths: Record<string, PrJournalPath>,
 *   body: string,
 *   bodyFile: string,
 *   title: string,
 *   push: string[],
 *   create: string[] | null,
 *   prepared: boolean,
 * }} PrJournal
 */

/**
 * What `pr-record` wrote, in one of its three forms.
 * @typedef {{ url?: string, pushed?: boolean, error?: string }} PrRecord
 */

/**
 * The PR slice of a Run's state file (`follow-ups.json` or `codegen.json`).
 * @typedef {{
 *   options: PrOptions,
 *   mode: PrMode,
 *   branch: string,
 *   items: PrItem[],
 *   journal?: PrJournal,
 *   record?: PrRecord,
 * }} PrState
 */

/**
 * A success with its JSON, or a refusal with its exit.
 * @typedef {{ ok: true, noop?: boolean, json: Record<string, unknown> }
 *   | { ok: false, exit: number, refusal: RefusalFact }} PrOutcome
 */

// A refusal of a call the state of the Run turns down (a moved HEAD, an occupied branch): exit 1. A
// refusal of what the call itself carried (a path out of scope, a mixed record form): exit 2.
const { fact } = refusalsFor({
  out_of_scope: "The path is outside module_paths, or under .qa/ where only an ADR-named path of this caller may go.",
  no_changes: "The item changed no file.",
  pr_mode_not_planned: "The Run was planned for working-tree mode, so no branch can be prepared.",
  head_moved: "HEAD moved since the Run was pinned.",
  branch_exists: "A branch of that name already exists, and this Run did not prepare it.",
  unexpected_content: "A path holds content this Run did not write, so nothing was overwritten.",
  journal_invalid: "The preparation journal does not match this Run's item chain.",
  no_state: "The Run's state file is missing.",
  state_unreadable: "The Run's state file is not the JSON its planner wrote.",
  not_prepared: "Run `pr-prepare` before `pr-record`.",
  record_form: "`pr-record` takes exactly one of `--url`, `--pushed --error`, or `--error`.",
});

/**
 * @param {string} code
 * @param {Record<string, unknown>} [data]
 * @returns {{ ok: false, exit: number, refusal: RefusalFact }}
 */
const prStop = (code, data = {}) => ({ ok: false, exit: 1, refusal: fact(code, data) });

/**
 * @param {string} code
 * @param {Record<string, unknown>} [data]
 * @returns {{ ok: false, exit: number, refusal: RefusalFact }}
 */
const prRefuse = (code, data = {}) => ({ ok: false, exit: 2, refusal: fact(code, data) });

/**
 * A blocked outcome as the adapter's `{exit, json}`.
 * @param {PrOutcome} outcome
 * @returns {CommandResult}
 */
export function prResult(outcome) {
  return outcome.ok
    ? { exit: 0, json: { ok: true, ...outcome.json } }
    : { exit: outcome.exit, json: { ok: false, refusals: [outcome.refusal] } };
}

// The why behind each mode reason, as the confirm words it.
/** @type {Record<string, string>} */
const WHY = {
  "not-requested": "no PR was asked for",
  dirty: "the test tree is dirty",
  "dirty-knowledge": "a selected Scenario file is dirty",
  "external-mint-required": "the project's own tool mints Automation keys; mint with it, then `/qa-sync`",
  "no-identity": "git has no committer identity",
  no_code_host: "`project.md` names no `code_host`",
  no_origin: "`origin` names no repository",
  no_base: "HEAD has no upstream under `origin`",
  base_diverged: "the base diverged from the Run's commit",
};

/**
 * @param {string | undefined} reason
 * @param {string} [tool]
 * @returns {string}
 */
const whyOf = (reason, tool) => (reason === "no_tool" ? `\`${tool}\` is not installed` : (reason && WHY[reason]) || "the Run cannot open a PR");

/** @param {string} reason @returns {PrMode} */
const workingTree = (reason) => ({ kind: "working-tree", reason: /** @type {PrMode["reason"]} */ (reason), confirm: `Working tree only: ${whyOf(/** @type {PrMode["reason"]} */ (reason))}` });

/**
 * @param {string} branch
 * @param {PrMode["reason"]} reason
 * @param {string} [tool]
 * @returns {PrMode}
 */
const branchOnly = (branch, reason, tool) => ({ kind: "branch", reason, confirm: `Branch ${branch} only: ${whyOf(reason, tool)}; push it and open the PR by hand` });

/**
 * The dirty paths under the given roots, for a caller that must tell a dirty Scenario file from a
 * dirty test tree. It is a thin view over `uncommittedUnder`, the one dirty-tree predicate.
 * @param {string} repo
 * @param {readonly string[]} roots
 * @returns {string[]}
 */
export function dirtyPaths(repo, roots) {
  if (roots.length === 0) return [];
  return uncommittedUnder(repo, roots).paths ?? [];
}

/**
 * @param {string} tool
 * @returns {boolean}
 */
function toolAvailable(tool) {
  return spawnSync(tool, ["--version"], { env: process.env }).status === 0;
}

// The base branch a PR may target: HEAD's upstream under origin, else origin's default, used only
// when the pinned commit is it or an ancestor with none of the Run's touched paths changed.
/**
 * @param {string} repo
 * @param {string} commit
 * @param {readonly string[]} paths
 * @returns {{ name: string, ref: string, reason?: undefined } | { reason: "no_base" | "base_diverged", name?: undefined, ref?: undefined }}
 */
function resolveBase(repo, commit, paths) {
  const ref = upstreamRef(repo) ?? defaultBaseRef(repo);
  if (!ref) return { reason: "no_base" };
  const base = refCommit(repo, ref);
  if (!base) return { reason: "no_base" };
  if (commit !== base) {
    if (!isAncestor(repo, commit, base)) return { reason: "base_diverged" };
    if (pathsChanged(repo, commit, base, paths)) return { reason: "base_diverged" };
  }
  return { name: ref.replace(/^origin\//, ""), ref };
}

/**
 * Resolve the mode a Run will use and open its PR state. `requested` is false when neither the
 * engineer nor a Practice asked for a PR, which keeps a standalone run in the working tree.
 * @param {PrOptions} options
 * @returns {PrState}
 */
export function planPr(options) {
  const branch = `qa/${options.skill}/${options.run}`;
  const tool = options.codeHost?.tool;
  /** @type {PrMode} */
  let mode;
  if (!options.requested) {
    mode = workingTree("not-requested");
  } else if (dirtyPaths(options.repo, options.modulePaths).length > 0) {
    mode = workingTree("dirty");
  } else if (dirtyPaths(options.repo, options.qaPaths ?? []).length > 0) {
    mode = workingTree("dirty-knowledge");
  } else if (!committerIdentity(options.repo)) {
    mode = workingTree("no-identity");
  } else if (!tool) {
    mode = branchOnly(branch, "no_code_host");
  } else if (!toolAvailable(tool)) {
    mode = branchOnly(branch, "no_tool", tool);
  } else {
    const repo = originSlug(options.repo);
    const base = resolveBase(options.repo, options.commit, []);
    if (!repo) mode = branchOnly(branch, "no_origin");
    else if (base.reason) mode = branchOnly(branch, base.reason);
    else mode = { kind: "pr", base: base.name, repo, confirm: `PR to ${base.name} via ${tool}` };
  }
  return { options, mode, branch, items: [] };
}

// Whether a changed path may travel in this caller's commit.
/**
 * @param {PrState} state
 * @param {string} path
 * @returns {string | null}
 */
function scopeProblem(state, path) {
  const options = state.options;
  if (within(path, ".qa")) {
    const named = options.skill === "codegen" && (options.qaPaths ?? []).some((namedPath) => within(path, namedPath));
    if (!named) return "the caller did not name this .qa/ path";
    if (within(path, ".qa/executions") || within(path, ".qa/train") || path === ".qa/project.md") return "this knowledge path never travels in a PR";
    return null;
  }
  return (options.modulePaths ?? []).some((root) => within(path, root)) ? null : "the path is outside module_paths";
}

/**
 * @param {PrState} state
 * @param {PrItemInput} input
 * @returns {string}
 */
function messageOf(state, input) {
  return input.message ?? (state.options.skill === "codegen"
    ? `qa: automate ${input.case ?? "?"} as ${input.automation ?? "?"}`
    : `qa: fix ${input.automation ?? "?"} (${input.route ?? "?"})`);
}

/**
 * Build one done item's commit on a temporary index, seeded from the Run's pinned commit or the
 * previous item's commit, and append it to the chain.
 * @param {PrState} state
 * @param {PrItemInput} input
 * @param {Record<string, PrFile>} before the working tree at the item's start
 * @returns {{ item: PrItem, failure?: undefined } | { item?: undefined, failure: PrOutcome }}
 */
export function commitPrItem(state, input, before) {
  const repo = state.options.repo;
  const changes = diffTrees(before, snapshotPrTree(repo));
  if (Object.keys(changes).length === 0) return { failure: prRefuse("no_changes") };
  const roots = [...(state.options.modulePaths ?? []), ...(state.options.skill === "codegen" ? state.options.qaPaths ?? [] : [])];
  for (const path of Object.keys(changes)) {
    const problem = scopeProblem(state, path);
    if (problem) return { failure: prRefuse("out_of_scope", { path, reason: problem }) };
    if (symlinkEscapes(repo, path, roots)) return { failure: prRefuse("out_of_scope", { path, reason: "its target escapes module_paths" }) };
  }
  const message = messageOf(state, input);
  const parent = state.items.at(-1)?.commit ?? state.options.commit;
  /** @type {PrItem} */
  const item = { ...input, message, changes, commit: itemCommit(repo, parent, changes, message) };
  state.items.push(item);
  return { item };
}

/**
 * @param {PrState} state
 * @param {number} count
 * @returns {string}
 */
function titleOf(state, count) {
  const run = state.options.run;
  return state.options.skill === "codegen"
    ? `qa: automate ${count} ${count === 1 ? "case" : "cases"} from Run ${run}`
    : `qa: fix ${count} ${count === 1 ? "Automation" : "Automations"} from Run ${run}`;
}

// Every text that leaves the session is scrubbed the way ingest scrubs: URL queries cut, page pairs
// and tokens redacted, and any line that still looks like a credential replaced whole.
/**
 * @param {string} text
 * @returns {string}
 */
function scrub(text) {
  return scrubPageText(text);
}

/** The same scrub, for a caller that writes another outward text (codegen's `draft.patch`). */
/** @type {(text: string) => string} */
export const scrubText = scrub;

/**
 * @param {PrState} state
 * @param {PrItem[]} items
 * @returns {string}
 */
function renderBody(state, items) {
  const lines = [
    `# ${titleOf(state, items.length)}`,
    "",
    `Run: ${state.options.run}`,
    `Target: ${state.options.target.slug}`,
    "",
  ];
  for (const item of items) {
    lines.push(`## ${item.automation ?? item.case ?? item.id}`);
    if (item.file) lines.push("", `File: ${item.file}`);
    if (item.route) lines.push(`Route: ${item.route}${item.route === "flaky" ? " (flaky: review with extra care)" : ""}`);
    if (item.cases?.length) lines.push(`Cases: ${item.cases.map((entry) => `${entry.key} (${entry.summary})`).join(", ")}`);
    if (item.error) lines.push("", "Failing error:", "", item.error);
    if (item.evidence) lines.push("", "Passed Execution evidence:", "", item.evidence);
    if (item.expects) lines.push("", "Expected mapping:", "", ...Object.entries(item.expects).map(([sentence, at]) => `- ${sentence} → ${at.join(", ")}`));
    if (item.summary) lines.push("", "What changed:", "", item.summary);
    if (item.assertions_reduced) lines.push("", `Assertions reduced: ${item.assertions_reduced}`);
    lines.push("");
  }
  return `${scrub(lines.join("\n")).trimEnd()}\n`;
}

/**
 * The exact host argv the agent runs, from the host's own flag set.
 * @param {"gh" | "glab"} tool
 * @param {string} repo
 * @param {string} base
 * @param {string} branch
 * @param {string} title
 * @param {string} bodyFile
 * @returns {string[]}
 */
function createArgv(tool, repo, base, branch, title, bodyFile) {
  return tool === "glab"
    ? ["glab", "mr", "create", "--repo", repo, "--source-branch", branch, "--target-branch", base, "--title", title, "--description-file", bodyFile, "--push=false", "--yes"]
    : ["gh", "pr", "create", "-R", repo, "--base", base, "--head", branch, "--title", title, "--body-file", bodyFile];
}

// The Run's final content and HEAD's content for every path the chain touches.
/**
 * @param {string} repo
 * @param {string} commit
 * @param {PrItem[]} items
 * @returns {Record<string, PrJournalPath>}
 */
function journalPaths(repo, commit, items) {
  /** @type {Record<string, PrJournalPath>} */
  const paths = {};
  for (const item of items) for (const [path, file] of Object.entries(item.changes)) paths[path] = { final: file, restore: commitFile(repo, commit, path) };
  return paths;
}

/**
 * Point the Run's branch at its last commit, restore the working tree, write the scrubbed body and
 * return the pinned push and PR argv. `save` persists the journal before anything outside the run
 * dir changes, so a crash resumes rather than refuses.
 * @param {PrState} state
 * @param {{ dir: string, save: (state: PrState) => void }} where
 * @returns {PrOutcome}
 */
export function preparePr(state, { dir, save }) {
  const options = state.options;
  const repo = options.repo;
  const items = state.items.filter((item) => item.commit);
  if (items.length === 0) return { ok: true, noop: true, json: { noop: true, mode: state.mode.kind, branch: state.branch } };
  if (state.mode.kind === "working-tree") return prStop("pr_mode_not_planned", { mode: state.mode.kind });
  const head = headCommit(repo);
  if (head !== options.commit) return prStop("head_moved", { head: head ?? null, commit: options.commit });
  const last = items[items.length - 1].commit;
  /** @type {PrJournal | undefined} */
  let journal = state.journal;
  if (journal && (!journal.branch || !journal.commit || typeof journal.prepared !== "boolean" || !journal.paths)) {
    return prStop("journal_invalid", { branch: journal.branch ?? null });
  }
  if (journal && (journal.branch !== state.branch || journal.commit !== last)) {
    return prStop("journal_invalid", { branch: journal.branch, commit: journal.commit });
  }
  const refName = `refs/heads/${state.branch}`;
  const existing = refCommit(repo, refName);
  if (journal) {
    if (existing && existing !== journal.commit) return prStop("branch_exists", { branch: state.branch });
    if (!existing && !commitExists(repo, journal.commit)) return prStop("journal_invalid", { commit: journal.commit });
  } else if (existing) {
    return prStop("branch_exists", { branch: state.branch });
  }

  if (!journal) {
    const paths = journalPaths(repo, options.commit, items);
    let mode = state.mode;
    if (mode.kind === "pr") {
      const tool = options.codeHost?.tool;
      const slug = originSlug(repo);
      if (!slug || !tool) {
        mode = branchOnly(state.branch, slug ? "no_tool" : "no_origin", tool);
        state.mode = mode;
      } else {
        const base = resolveBase(repo, options.commit, Object.keys(paths));
        if (base.reason) {
          mode = branchOnly(state.branch, base.reason);
          state.mode = mode;
        }
      }
    }
    const body = renderBody(state, items);
    journal = {
      mode: mode.kind === "pr" ? "pr" : "branch",
      branch: state.branch,
      commit: last,
      base: mode.kind === "pr" ? mode.base ?? null : null,
      repo: mode.kind === "pr" ? mode.repo ?? null : null,
      paths,
      body,
      bodyFile: join(dir, "pr-body.md"),
      title: titleOf(state, items.length),
      push: ["git", "push", "origin", state.branch],
      create: mode.kind === "pr" ? createArgv(/** @type {"gh" | "glab"} */ (options.codeHost?.tool), /** @type {string} */ (mode.repo), /** @type {string} */ (mode.base), state.branch, titleOf(state, items.length), join(dir, "pr-body.md")) : null,
      prepared: false,
    };
    state.journal = journal;
    save(state);
  }

  // Validate the body and every path before the ref or the tree changes, so a refusal overwrites
  // nothing at all.
  const bodyExists = existsSync(journal.bodyFile);
  if (bodyExists && readFileSync(journal.bodyFile, "utf8") !== journal.body) {
    return prStop("unexpected_content", { path: journal.bodyFile });
  }
  /** @type {[string, PrFile | null][]} */
  const restores = [];
  for (const [path, entry] of Object.entries(journal.paths)) {
    const current = workingFile(repo, path);
    if (sameFile(current, entry.final)) restores.push([path, entry.restore]);
    else if (sameFile(current, entry.restore)) continue;
    else return prStop("unexpected_content", { path });
  }

  if (!refCommit(repo, refName)) {
    if (!createRef(repo, refName, journal.commit)) {
      return refCommit(repo, refName) ? prStop("branch_exists", { branch: state.branch }) : prStop("journal_invalid", { commit: journal.commit });
    }
  }
  if (!bodyExists) writeFileSync(journal.bodyFile, journal.body);
  for (const [path, file] of restores) writeTreeFile(repo, path, file);
  journal.prepared = true;
  save(state);
  return {
    ok: true,
    json: {
      noop: false,
      mode: journal.mode,
      branch: journal.branch,
      commit: journal.commit,
      base: journal.base,
      repo: journal.repo,
      title: journal.title,
      body: journal.bodyFile,
      push: journal.push,
      create: journal.create,
    },
  };
}

/**
 * @typedef {{ url?: unknown, pushed?: unknown, error?: unknown }} PrRecordInput
 */

/**
 * Record the outcome of the two printed commands in one of the three settled forms. The reason is
 * scrubbed: a failed push or PR create leaves the branch local, and its message may hold a secret.
 * @param {PrState} state
 * @param {PrRecordInput} input
 * @returns {PrOutcome}
 */
export function recordPr(state, { url, pushed, error }) {
  if (!state.journal?.prepared) return prStop("not_prepared", { branch: state.branch });
  const hasUrl = typeof url === "string" && url !== "";
  const hasError = typeof error === "string" && error !== "";
  if (hasUrl && pushed === undefined && error === undefined) {
    state.record = { url: scrub(url) };
    return { ok: true, json: { record: state.record } };
  }
  if (pushed === true && hasError && url === undefined) {
    state.record = { pushed: true, error: scrub(error) };
    return { ok: true, json: { record: state.record } };
  }
  if (pushed !== true && hasError && url === undefined) {
    state.record = { error: scrub(error) };
    return { ok: true, json: { record: state.record } };
  }
  return prRefuse("record_form");
}

/**
 * @typedef {{
 *   data: Record<string, unknown>,
 *   pr: PrState,
 *   failure?: undefined,
 * } | { failure: PrOutcome }} StateRead
 */

/**
 * @param {string} dir
 * @param {string} file
 * @returns {StateRead}
 */
function readState(dir, file) {
  const path = join(dir, file);
  if (!existsSync(path)) return { failure: prStop("no_state", { path }) };
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { failure: prStop("state_unreadable", { path }) };
  }
  const pr = /** @type {Record<string, unknown> | undefined} */ (data?.pr);
  if (!pr || typeof pr !== "object" || !pr.options || typeof pr.mode !== "object" || pr.mode === null || typeof pr.branch !== "string" || !Array.isArray(pr.items)) {
    return { failure: prStop("state_unreadable", { path }) };
  }
  return { data: /** @type {Record<string, unknown>} */ (data), pr: /** @type {PrState} */ (pr) };
}

/**
 * @param {string} dir
 * @param {string} file
 * @param {Record<string, unknown>} data
 * @returns {void}
 */
function saveState(dir, file, data) {
  const path = join(dir, file);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temporary, path);
}

/**
 * The `pr-prepare` and `pr-record` actions a caller mode mounts, over its own run-state file.
 * @param {{ file?: string }} [options]
 * @returns {Record<string, CommandAction>}
 */
export function prActions({ file = "follow-ups.json" } = {}) {
  return {
    "pr-prepare": {
      options: { dir: "value" },
      usage: "--dir <run-dir>",
      run(args, ctx) {
        noArguments("pr-prepare", args, "--dir <run-dir>");
        requireOption("pr-prepare", ctx.dir, "--dir <run-dir>", "the run dir the planner printed");
        const dir = resolve(String(ctx.dir));
        const read = readState(dir, file);
        if (read.failure) return prResult(read.failure);
        return prResult(preparePr(read.pr, { dir, save: (state) => saveState(dir, file, { ...read.data, pr: state }) }));
      },
    },
    "pr-record": {
      options: { dir: "value", url: "value", pushed: "flag", error: "value" },
      usage: "--dir <run-dir> (--url <url> | --pushed --error <reason> | --error <reason>)",
      run(args, ctx) {
        noArguments("pr-record", args, "--dir <run-dir>");
        requireOption("pr-record", ctx.dir, "--dir <run-dir>", "the run dir the planner printed");
        const dir = resolve(String(ctx.dir));
        const read = readState(dir, file);
        if (read.failure) return prResult(read.failure);
        const outcome = recordPr(read.pr, { url: ctx.url, pushed: ctx.pushed, error: ctx.error });
        if (outcome.ok) saveState(dir, file, { ...read.data, pr: read.pr });
        return prResult(outcome);
      },
    },
  };
}
