// @ts-check
// `train`: the deterministic half of `/qa-train`. The skill
// derives Conventions, Practices and Access notes, classifies them and holds the gate with the
// engineer; everything here only reads.
//
//   evidence [design] <scenario-key>              an exemplar scenario, Bookkeeping-stripped
//   evidence [design] --diff <commit-ish> [<key>] the scenario changes since <commit-ish>: the
//                                                 engineer's fixes, case by case
//   evidence  (no target, no --diff, no key)      the uncommitted scenario changes (since HEAD)
//   evidence <target>                             the target's training alone: the skill mines the
//                                                 conversation, or the engineer dictates
//   evidence codegen --from-code [<path>...]      the bounded test-code sample, corpus and gate
//     [--relearn [--facet <facet>...]]
//   check [<target>] --stdin                      a drafted train file, before the skill writes it
//
// A target is one of the closed list `check-file` keeps (`TRAIN_KEYS`), and a first argument on
// that list is always the target, never a scenario key. No target means `design`, so every v1
// form keeps its meaning. A scenario key or `--diff` teaches design's Conventions, so it takes no
// other target.
//
// A target's file holds one family of entries: `access` holds Access notes (`access_notes`), every
// other target Practices, and design's Conventions too. Every `evidence` also returns the target's
// train file as it stands (its entries, for classifying each proposal as new, refining or
// contradicting one) and the project's vocabulary, which the Statability Test reads. The skill
// writes `train/<target>.md` only through its gate, and only after `check` passes.
/** @import { CommandDefinition } from "./cli.mjs" */
/** @import { ExecuteTrainingEntry } from "./execute-training.mjs" */
/** @import { ExecutionResult } from "./execution-results.mjs" */
/** @import { ParsedEntry, ParsedFile, ProjectConfig } from "./knowledge-file.mjs" */
/** @import { KeyIndex } from "./qa-index.mjs" */
/** @import { Stripped, StrippableFile } from "./stripped.mjs" */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CATEGORIES_TRAIN_KEY, checkCategoriesDraft, effectiveCategories } from "./categories.mjs";
import { commitLine } from "./changeset.mjs";
import { UsageError } from "./cli.mjs";
import { filesUnder } from "./code-source.mjs";
import { codegenSample } from "./codegen-sample.mjs";
import { credentialIn, secretsIn, shownKey, WITHHELD } from "./credentials.mjs";
import { isMap } from "./dialect.mjs";
import { latestAutomationResults, latestExecutionResults } from "./execution-results.mjs";
import { executeIntegrity, executeOutcomeClaims, executeTraining, fixtureExists } from "./execute-training.mjs";
import { loadQaAt, repositoryOf, resolveRef } from "./git-tree.mjs";
import { PATTERN } from "./keys.mjs";
import { checkFile, parse, projectConfig } from "./knowledge-file.mjs";
import { resolvesUnderAny } from "./paths.mjs";
import { buildIndex, loadWorkingTree, rootConfig } from "./qa-index.mjs";
import { scan } from "./scan.mjs";
import { escape, namesOfTheSystem, WHAT as SCAN_WHAT } from "./scan-train.mjs";
import { repoPath as namedRepoPath } from "./scout.mjs";
import { fixTraining } from "./fix-training.mjs";
import { trainFile } from "./training.mjs";
import { ACCESS_TRAIN_KEY, BUG_TRAIN_KEY, CODEGEN_FACETS, CODEGEN_TRAIN_KEY, DESIGN_TRAIN_KEY, EXECUTE_TRAIN_KEY, CODEFIX_TRAIN_KEY, KNOWN, TRAIN_KEYS, canonicalTrainKey, isSharedTrainKey } from "./schema.mjs";
import { resolveAdapter } from "./stack.mjs";
import { claimProjection, strip, unifiedDiff } from "./stripped.mjs";

/**
 * The `.qa/` tree the train reads: its files (each parsed as far as it goes), its Key index and
 * `project.md`'s configuration. The repository under test is the parent of `.qa/`.
 * @typedef {{ root: string, repo: string, files: ParsedFile[], index: KeyIndex } & ProjectConfig} TrainContext
 */

/**
 * A train file's entry, as the loader parses it: its heading, its block's values, the lines they
 * sit on, and the entry's whole text.
 * @typedef {{
 *   key: string,
 *   statement: string | undefined,
 *   line: number,
 *   sources: string[],
 *   added: unknown,
 *   rationale: { line: number, text: string }[],
 *   entry: string,
 *   data: Record<string, unknown>,
 *   withheld: boolean,
 * }} TrainEntry
 */

/**
 * What changed in one entry list: the keys added, edited and removed, and each draft entry's
 * status.
 * @typedef {{
 *   added: unknown[],
 *   edited: { key: unknown, from: string | undefined, to: string | undefined }[],
 *   removed: unknown[],
 * }} TrainListed
 */

/**
 * One entry list's change from the baseline to the draft.
 * @typedef {{
 *   draft: TrainEntry[],
 *   listed: TrainListed,
 *   status: (c: TrainEntry) => "added" | "edited" | "unchanged",
 * }} TrainChanges
 */

/**
 * A hit of the Statability Test: what it names and where.
 * @typedef {{ code: string, matches: string[], message: string }} TrainHit
 */

/**
 * The scenario changes a run reports: the scenario, the Feature it belongs to, the file, what
 * changed in it, and its stripped diff.
 * @typedef {{
 *   scenario: unknown,
 *   was?: unknown,
 *   feature: string | null,
 *   file: string,
 *   status: "added" | "deleted" | "modified",
 *   cases: {
 *     key: string,
 *     was?: string,
 *     change: "added" | "modified" | "removed",
 *     generated_by: string | null,
 *     before: string | null | undefined,
 *     after: string | null | undefined,
 *   }[],
 *   diff: string,
 * }} TrainScenarioChange
 */

/**
 * @param {string} target
 * @returns {string}
 */
const relOf = (target) => `train/${target}.md`;

// Where `target`'s file lives: the file the training reads for it (lib/training.mjs `trainFile`),
// which is a legacy one (`LEGACY_TRAIN_KEYS`) until it is renamed; its own path when there is none.
/**
 * @param {TrainContext} ctx
 * @param {string} target
 * @returns {string}
 */
const relIn = (ctx, target) => /** @type {{ rel?: string } | null} */ (trainFile(ctx.index, target))?.rel ?? relOf(target);
// The entry lists a target's file holds, as a parsed train file keeps them.
/**
 * @param {string} target
 * @returns {string[]}
 */
const kindsOf = (target) => (target === ACCESS_TRAIN_KEY ? ["access_notes"] : target === EXECUTE_TRAIN_KEY ? ["practices", "recipes", "actions", "uploads"] : target === BUG_TRAIN_KEY ? ["practices"] : ["conventions", "practices"]);

// The `.qa/` tree at `root`, its Key index and `project.md`'s configuration. The repository under
// test is the parent of `.qa/`.
/**
 * @param {string} root
 * @returns {TrainContext}
 */
function load(root) {
  const files = /** @type {ParsedFile[]} */ (loadWorkingTree(root));
  const index = buildIndex(files);
  return { root: resolve(root), repo: dirname(resolve(root)), files, index, ...projectConfig(index.project) };
}

// `[target, ...args]` split: `named` is the target the command line names, or null when it names
// none (design's v1 forms).
/**
 * @param {string[]} args
 * @returns {{ named: string | null, args: string[] }}
 */
function splitTarget(args) {
  const named = /** @type {string} */ (canonicalTrainKey(args[0]));
  return TRAIN_KEYS.includes(named) ? { named, args: args.slice(1) } : { named: null, args };
}

// The command line's `train <action>` (scripts/scan.mjs): each prints `{json, exit}`. Every action
// takes the same options, which may come before it.
/** @type {{ root: "qa-dir", stdin: "flag", diff: "value", stack: "value", "from-code": "flag", relearn: "flag", facet: "values" }} */
const OPTIONS = { root: "qa-dir", stdin: "flag", diff: "value", stack: "value", "from-code": "flag", relearn: "flag", facet: "values" };

/** @type {CommandDefinition} */
export const command = {
  options: OPTIONS,
  actions: {
    evidence: {
      usage: "[<target>] [<scenario-key>] [--diff <commit-ish>] [--stack <root>] [--from-code] [--relearn] [--facet <facet>[,<facet>]] [--root <qa-dir>]",
      run(given, { root, diff, stack, "from-code": fromCode, relearn, facet }) {
        const { named, args } = splitTarget(given);
        const target = named ?? DESIGN_TRAIN_KEY;
        const codeBranch = target === CODEGEN_TRAIN_KEY && (fromCode === true || relearn === true || facet !== undefined || args.length > 0);
        if (!codeBranch && args.length > 1) throw new UsageError("train evidence takes at most a <target> and one <scenario-key>");
        if (target !== CODEGEN_TRAIN_KEY && (fromCode === true || relearn === true || facet !== undefined)) {
          throw new UsageError("`--from-code`, `--relearn` and `--facet` belong to `train evidence codegen`");
        }
        const ctx = load(/** @type {string} */ (root));
        checkStack(target, /** @type {string | undefined} */ (stack), ctx);
        /** @type {Record<string, unknown>} */
        const common = { action: "evidence", target, train: trainState(ctx, target), roles: [...ctx.roles], levels: [...ctx.levels] };
        // Code gen writes `stack:` from the project's one stack root, never from an unstated default.
        if (target === CODEGEN_TRAIN_KEY) {
          common.stack = ctx.stack ?? null;
          common.upkeep = scan(ctx.root).results.filter((r) => r.kind === "train_warning" && ["ref_unresolved", "convention_drift", "citation_broken"].includes(r.code));
          if (!codeBranch) {
            common.citation_context = relearnGate(ctx, CODEGEN_FACETS, { sample: {}, corpus: {}, gate: {} }, resolveRef(ctx.root, "HEAD"));
            common.ref_candidates = refCandidates(ctx);
          }
        }
        if (target === EXECUTE_TRAIN_KEY) Object.assign(common, executeEvidence(ctx));
        // The origins an app test-account note is for, beside `project.roles` in `roles`.
        if (target === ACCESS_TRAIN_KEY) common.targets = ctx.targets ?? {};
        if (codeBranch) return codegenEvidence(ctx, args, { relearn: relearn === true, facet: /** @type {readonly string[] | undefined} */ (facet), common });
        const [key] = args;
        if (target !== DESIGN_TRAIN_KEY && (key !== undefined || diff !== undefined)) {
          const learned = !isSharedTrainKey(target) ? "Practices" : target === ACCESS_TRAIN_KEY ? "Access notes" : "Coverage categories";
          throw new UsageError(`a <scenario-key> or --diff teaches design's Conventions, so it takes the target \`${DESIGN_TRAIN_KEY}\` or none; \`${target}\` learns its ${learned} from the conversation: run \`train evidence ${target}\``);
        }
        // A named target alone is a conversation run: there is no scenario evidence to read.
        if (named && key === undefined && diff === undefined) return { exit: 0, json: { ...common, ok: true, source: "target" } };
        if (diff !== undefined || key === undefined) return changesSince(ctx, /** @type {string} */ (diff ?? "HEAD"), key ?? null, { ...common, source: diff === undefined ? "uncommitted" : "diff" });
        const decl = ctx.index.scenarios.get(key)?.[0];
        if (!decl) throw new UsageError(`no scenario \`${key}\` in ${root}`);
        const file = decl.file;
        const exemplar = { scenario: key, feature: decl.feature, file: repoPath(ctx, file.rel), cases: file.cases.length, text: strip(/** @type {StrippableFile} */ (file)).text };
        if (file.cases.length === 0) {
          return { exit: 1, json: { ...common, ok: false, source: "exemplar", reason: "no_cases", error: `scenario \`${key}\` has no Test Cases: an empty file has no form to learn from`, exemplar } };
        }
        return { exit: 0, json: { ...common, ok: true, source: "exemplar", exemplar } };
      },
    },

    check: {
      usage: ["[<target>] --stdin [--root <qa-dir>]", "categories [--stdin] [--root <qa-dir>]"],
      run(given, { root, stdin, stack }) {
        // Categories are shared training, not a command's file: their whole-file check validates a
        // draft against the floor, and with no draft checks the file on disk (absent is the floor).
        if (given[0] === CATEGORIES_TRAIN_KEY) {
          if (given.length !== 1) throw new UsageError(`train check ${CATEGORIES_TRAIN_KEY} takes no other argument`);
          const ctx = load(/** @type {string} */ (root));
          const rel = relOf(CATEGORIES_TRAIN_KEY);
          const path = join(ctx.root, rel);
          const baseline = existsSync(path) ? readFileSync(path, "utf8") : null;
          const draft = stdin ? stdin() : baseline;
          const checked = draft === null
            ? { ok: true, errors: [], warnings: [], categories: { added: [], edited: [], removed: [] }, effective: effectiveCategories(ctx.root) }
            : checkCategoriesDraft(draft, baseline);
          const statability = checked.effective ? categoryStatability(checked.effective.categories, checked.categories, ctx) : [];
          // An added or edited category that names the system under test is refused, like a
          // Convention; an unchanged one is a coherence finding the gate puts to the engineer.
          const refusals = statability
            .filter((hit) => hit.status !== "unchanged")
            .map((hit) => ({ code: "invalid", field: hit.key, message: `category \`${hit.key}\` ${hit.message}` }));
          const errors = [...checked.errors, ...refusals];
          const ok = checked.ok && refusals.length === 0;
          const file = repoPath(ctx, rel);
          const json = {
            action: "check",
            target: CATEGORIES_TRAIN_KEY,
            file,
            path,
            ...checked,
            ok,
            errors,
            statability,
            // A refused draft resolves no effective list, as the structural refusals do.
            ...(!ok && { effective: undefined }),
            ...(ok ? { changeset: [file], commit: commitLine([file], "qa(train): /qa-train categories") } : {}),
          };
          return { json, exit: ok ? 0 : 1 };
        }
        const { named, args } = splitTarget(given);
        const target = named ?? DESIGN_TRAIN_KEY;
        if (args.length !== 0) throw new UsageError(`train check takes at most a <target>: the draft is always train/<target>.md, here train/${target}.md`);
        if (!stdin) throw new UsageError("train check reads the drafted train file from --stdin");
        const ctx = load(/** @type {string} */ (root));
        checkStack(target, /** @type {string | undefined} */ (stack), ctx);
        const checked = checkDraft(ctx, stdin(), target);
        const { draft, ...report } = checked;
        const ok = checked.ok === true;
        const json = {
          action: "check",
          target,
          ...report,
          ok,
          // Only a draft `ok` carries the report: the gate offers its lines, and a draft that failed
          // is rewritten before anything is offered.
          ...(target === ACCESS_TRAIN_KEY && ok ? { access_files: accessFiles(ctx, /** @type {TrainEntry[]} */ (draft)) } : {}),
        };
        return { json, exit: ok ? 0 : 1 };
      },
    },
  },
};

/** @param {string} target @param {string | undefined} stack @param {TrainContext} ctx */
function checkStack(target, stack, ctx) {
  if (stack !== undefined && (target !== CODEGEN_TRAIN_KEY || stack !== ctx.stack?.root)) throw new UsageError("--stack must match the configured stack.root for codegen");
}

// The code-evidence branch of `/qa-train codegen`: the CLI-built sample of the project's test code,
// its corpus summary and the gate labels. Named paths are exemplars; `--relearn` forces this branch
// (the per-facet diff itself belongs to upkeep) and `--facet` narrows which facets the gate shows.
/**
 * @param {TrainContext} ctx
 * @param {string[]} args
 * @param {{ relearn: boolean, facet: readonly string[] | undefined, common: Record<string, unknown> }} options
 * @returns {{ exit: number, json: Record<string, unknown> }}
 */
function codegenEvidence(ctx, args, { relearn, facet, common }) {
  if (facet !== undefined && !relearn) throw new UsageError("`--facet` narrows a `--relearn` run; add `--relearn`");
  const facets = facet === undefined ? CODEGEN_FACETS : [...new Set(facet.flatMap((f) => f.split(",")).map((f) => f.trim()).filter(Boolean))];
  if (facets.length === 0) throw new UsageError("`--facet` needs at least one facet");
  const unknown = facets.filter((f) => !CODEGEN_FACETS.includes(f));
  if (unknown.length) throw new UsageError(`\`--facet\` names ${unknown.map((f) => `\`${f}\``).join(", ")}; facets are ${CODEGEN_FACETS.join(", ")}`);
  const resolved = resolveAdapter(ctx.stack, ctx.repo);
  if (resolved.unavailable) {
    return { exit: 1, json: { ...common, ok: false, source: "code", reason: "adapter_unavailable", error: `${resolved.unavailable.message}; ${resolved.unavailable.fix}` } };
  }
  if (!resolved.adapter?.codegen) {
    return { exit: 1, json: { ...common, ok: false, source: "code", reason: "no_adapter", error: "no stack adapter reads this project's test code: train this stack from the conversation" } };
  }
  const exemplars = args.map((path) => (isAbsolute(path) ? relative(ctx.repo, resolve(path)).split(sep).join("/") : path.replace(/^\.\//, "").replace(/\\/g, "/")));
  const evidence = codegenSample({
    repo: ctx.repo,
    modulePaths: ctx.modulePaths,
    annotationMap: ctx.annotationMap,
    autPattern: ctx.autPattern ?? null,
    adapter: resolved.adapter,
    exemplars,
    facets,
  });
  if ("error" in evidence) return { exit: 1, json: { ...common, ok: false, source: "code", reason: evidence.error, error: evidence.message } };
  const repo = repositoryOf(ctx.root);
  const commit = repo ? resolveRef(ctx.root, "HEAD") : null;
  if (relearn) evidence.gate.relearn = relearnGate(ctx, facets, evidence, commit);
  return { exit: 0, json: { ...common, ok: true, source: "code", relearn, ...(commit && { commit: commit.slice(0, 7) }), ...evidence } };
}

// A current path/declaration listing lets the conversation repair a moved ref without sampling.
/** @param {TrainContext} ctx @returns {string[]} */
function refCandidates(ctx) {
  const adapter = resolveAdapter(ctx.stack, ctx.repo).adapter;
  if (!adapter) return [];
  const paths = filesUnder(ctx.repo, ctx.modulePaths, (name) => adapter.extensions.some((ext) => name.endsWith(ext)));
  const lines = [];
  for (const path of paths) {
    if (path.split("/").some((part) => part.startsWith(".") || /auth/i.test(part))) continue;
    lines.push(`- ${path}`);
    try {
      const parsed = adapter.parse(readFileSync(join(ctx.repo, path), "utf8"), path);
      for (const node of [...parsed.classes, ...parsed.functions]) if (node.name) lines.push(`  - ${node.name}`);
    } catch { /* unreadable or unparseable file */ }
  }
  return lines;
}

// The relearn gate compares each selected facet with the on-disk entries. A keep is only a
// proposal: the engineer settles it before the skill writes the refreshed sources and baseline.
/**
 * @param {TrainContext} ctx
 * @param {readonly string[]} facets
 * @param {import("./codegen-sample.mjs").CodegenEvidence} evidence
 * @param {string | null} commit
 */
function relearnGate(ctx, facets, evidence, commit) {
  const baseline = baselineOf(ctx, CODEGEN_TRAIN_KEY);
  const entries = baseline ? entriesOf(baseline.rel, readFileSync(baseline.path, "utf8"), "conventions") : [];
  /** @param {string[]} args */
  const git = (args) => spawnSync("git", ["-C", ctx.repo, ...args], { encoding: "utf8" });
  const findings = scan(ctx.root).results.filter((r) => r.kind === "train_warning" && ["ref_unresolved", "convention_drift", "citation_broken"].includes(r.code));
  const groups = facets.map((facet, order) => {
    const conventions = entries.filter((entry) => entry.data.stack === ctx.stack?.root && entry.data.facet === facet).map((entry) => {
      if (entry.withheld) return { key: entry.key, withheld: true, proposal: "diff", flags: ["withheld"] };
      /** @type {string[]} */
      const flags = findings.filter((finding) => finding.key === entry.key && finding.stack === entry.data.stack).map((finding) => finding.code);
      const afterMetadata = entry.entry.replace(/```yaml[^\n]*\n[\s\S]*?\n```/, "");
      const matchExample = /```[^\n]*\n([\s\S]*?)\n```/.exec(afterMetadata);
      const example = matchExample?.[1].trim() ?? "";
      const sources = entry.sources.map((source) => {
        const match = /^code:(.+)#L(\d+)@([0-9a-f]{7})$/i.exec(source);
        if (!match) return source;
        const [, path, line, sha] = match;
        if (git(["cat-file", "-e", `${sha}^{commit}`]).status !== 0) { flags.push("citation_sha_unreachable"); return source; }
        const old = git(["show", `${sha}:${path}`]);
        const head = commit ? git(["show", `${commit}:${path}`]) : null;
        let current = "";
        try {
          const absolute = realpathSync(resolve(ctx.repo, path));
          const rel = relative(realpathSync(ctx.repo), absolute);
          if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("citation outside repository");
          current = readFileSync(absolute, "utf8");
        } catch { /* missing or outside repository */ }
        if (old.status !== 0 || old.stdout !== current) flags.push("cited_file_changed");
        if (!head || head.status !== 0 || !example || !head.stdout.includes(example) || !current.includes(example)) { flags.push("citation_unmatched"); return source; }
        const oldLines = old.stdout.split("\n");
        const cited = oldLines[Number(line) - 1]?.trim();
        const headLines = head.stdout.split("\n");
        const matches = headLines.flatMap((text, i) => cited && text.trim() === cited ? [i + 1] : []);
        if (matches.length !== 1) { flags.push("citation_unmatched"); return source; }
        return `code:${path}#L${matches[0]}@${commit?.slice(0, 7)}`;
      });
      const signal = isMap(entry.data.signal) ? { ...entry.data.signal } : null;
      if (signal && typeof signal.id === "string" && typeof signal.value === "string") {
        const field = signal.id === "placement-dir" ? "directories" : signal.id === "key-carrier" ? "key_carriers" : signal.id === "test-naming" ? "test_names" : null;
        const groups = field ? /** @type {{value: string, files: number}[] | undefined} */ (evidence.corpus[field]) : undefined;
        if (groups) signal.corpus = `${groups.find((group) => group.value === signal.value)?.files ?? 0}/${groups.reduce((n, group) => n + group.files, 0)}`;
      }
      return { key: entry.key, statement: entry.statement, entry: entry.entry, proposal: entry.sources.length > 0 && entry.sources.every((source) => source.startsWith("human:")) ? "keep" : "diff", flags: [...new Set(flags)], keep: { sources, signal } };
    });
    return { facet, conventions, actions: ["keep", "replace", "add", "remove"], order, flagged: conventions.some((entry) => entry.flags.length > 0) };
  });
  return groups.sort((a, b) => Number(b.flagged) - Number(a.flagged) || a.order - b.order).map(({ order, ...group }) => group);
}

// Codegen's relational checks: its stack is the project's one root, and every `refs` path resolves
// under `module_paths` — or, in greenfield (no module path exists yet), under the existing stack
// root. Outside greenfield a `placement` Convention must carry its test directory as a ref, so a
// renamed or deleted test directory is caught. `refs` are paths, never prose, so they are not part
// of the Statability Test.
/**
 * @param {TrainContext} ctx
 * @param {ParsedFile} parsed
 * @param {{ code: string, field?: string, message: string, line?: number | null }[]} errors
 * @returns {void}
 */
function checkCodegenDraft(ctx, parsed, errors) {
  const stack = ctx.stack?.root;
  const data = parsed.data;
  const error = (/** @type {string} */ field, /** @type {string} */ message) => errors.push({ code: "invalid", field, message });
  if (Array.isArray(data.trained_stacks) && data.trained_stacks.some((s) => s !== stack)) {
    error("trained_stacks", "a trained stack is the project's `stack.root`");
  }
  const roots = ctx.modulePaths.filter((p) => existsSync(join(ctx.repo, p)));
  const stackExists = stack !== undefined && existsSync(resolve(ctx.repo, stack));
  const allowed = roots.length ? roots : stackExists && stack !== undefined ? [stack] : [];
  for (const entry of parsed.conventions ?? []) {
    if (entry.data.stack !== stack) error(`${entry.key}.stack`, "a Convention's `stack` is the project's `stack.root`");
    const refs = Array.isArray(entry.data.refs) ? entry.data.refs : [];
    if (entry.data.facet === "placement" && roots.length && refs.length === 0) {
      error(`${entry.key}.refs`, "a placement Convention carries its test directory as a ref outside greenfield");
    }
    for (const ref of refs) {
      if (typeof ref !== "string") continue;
      if (!resolvesUnderAny(ctx.repo, ref, allowed)) {
        // The ref is never repeated: a ref is a path, and a path can carry a credential.
        error(`${entry.key}.refs`, `a ref does not resolve under ${roots.length ? "`module_paths`" : "the stack root"}`);
      }
    }
  }
}

// A drafted train file for `target`, checked against the one on disk (none for the first). `ok` is
// `check-file`'s verdict alone. What changed is listed by key, each kind apart: the target's
// Conventions and Practices, or for `access` its Access notes (`edited` is any entry whose text
// changed, with its statement before and after, so an edit to a note's block alone leaves the two
// equal). Nothing printed repeats a credential: `check-file`'s errors name the field and never the
// value, and a statement holding one is withheld. Every
// Convention, old ones included (the coherence pass re-checks the whole file), takes the
// Statability Test on its statement and rationale, each hit marked `added`, `edited` or
// `unchanged`; fenced examples and the `yaml` block are exempt. A hit does not make the file
// invalid: the matching is weak (a length limit can read as a status code), so the skill's gate
// refuses an added or edited proposal and offers it to /qa-deep-dive, or has the engineer confirm
// the hit names nothing of the system, and puts an unchanged one to the engineer as a coherence
// finding. Practices never take the test (ADR-0015): "for import Features, read the ENG wiki
// space" names the system and claims nothing about it. Whether a Practice states how the system
// behaves, or contradicts the target's Invariants, is the gate's judgement, never this check's.
//
// The draft is checked at the target's path, so `check-file` refuses a key that is not the
// target's.
/**
 * @param {TrainContext} ctx
 * @param {string} text
 * @param {string} target
 * @returns {Record<string, unknown>}
 */
function checkDraft(ctx, text, target) {
  const rel = relIn(ctx, target);
  const path = join(ctx.root, rel);
  const file = repoPath(ctx, rel);
  const parsed = parse(rel, text);
  const checked = checkFile(parsed, rootConfig(ctx.root));
  if (target === CODEGEN_TRAIN_KEY) checkCodegenDraft(ctx, parsed, checked.errors);
  checked.errors.push(...executeIntegrity(parsed, { root: ctx.root, roles: ctx.roles, features: /** @type {Set<string>} */ (/** @type {unknown} */ (ctx.index.features)) }));
  checked.warnings.push(...executeOutcomeClaims(parsed));
  checked.ok = checked.errors.length === 0;
  const baseline = baselineOf(ctx, target);
  /**
   * @param {string} list
   * @returns {TrainEntry[]}
   */
  const was = (list) => (baseline ? entriesOf(baseline.rel, readFileSync(baseline.path, "utf8"), list) : []);
  /**
   * @param {string} list
   * @returns {TrainEntry[]}
   */
  const drafted = (list) => entriesOf(rel, text, list);
  const changes = Object.fromEntries(kindsOf(target).map((list) => /** @type {[string, TrainChanges]} */ ([list, changesOf(was(list), drafted(list))])));
  const { conventions } = changes;
  const terms = ruleTerms(ctx);
  const statability = (conventions?.draft ?? []).flatMap((c) => [
    ...statabilityHits(c.statement, ctx, terms).map((h) => ({ key: shownKey(c.key), status: conventions.status(c), where: "statement", line: c.line, ...h })),
    ...statabilityHits(c.rationale.map((r) => r.text).join("\n"), ctx, terms).map((h) => ({ key: shownKey(c.key), status: conventions.status(c), where: "rationale", line: c.rationale[0].line, ...h })),
  ]);
  const listed = Object.fromEntries(Object.entries(changes).map(([list, c]) => [list, c.listed]));
  const out = { ok: checked.ok, file, path, errors: checked.errors, warnings: checked.warnings, ...listed, statability };
  if (!out.ok) return out;
  const changeset = [file];
  // Design's message stays v1's, since bare `/qa-train` still means design.
  const message = target === DESIGN_TRAIN_KEY ? "qa(train): /qa-train" : `qa(train): /qa-train ${target}`;
  // The draft's raw entries leave only here, for `access`'s file report; they are never printed.
  return { ...out, changeset, commit: commitLine(changeset, message), draft: changes.access_notes?.draft ?? [] };
}

// The login-state and password files the drafted Access notes name, each with where Git stands on
// it: a tracked one carries `tracked`, and an untracked one that Git ignores (the check is
// `check-ignore --stdin`, so ignore negation and custom paths are honoured) is left out. Each entry
// carries the exact line to add to `.gitignore`: the file's directory (`/.qa/.auth/`, the form the
// Access reference teaches, chosen while hiding nothing Git already tracks), or the file itself
// (`/.qa/state.json`, and one in the repository's top `/auth.json`) when Git tracks another file
// under that directory. Read-only: nothing is staged or written. A path outside the repository is
// beyond `.gitignore` and is not named.
/**
 * @param {TrainContext} ctx
 * @param {readonly TrainEntry[]} notes
 * @returns {{ path: string, tracked: boolean, gitignore_line: string }[]}
 */
function accessFiles(ctx, notes) {
  const repo = repositoryOf(ctx.root);
  if (!repo) return [];
  const root = realpathSync(ctx.root);
  /** @param {string[]} args @param {string} [input] */
  const git = (args, input) => spawnSync("git", ["-C", repo.top, ...args], { encoding: "utf8", input });
  /** @param {string} rel */
  const line = (rel) => {
    const dir = dirname(rel);
    if (dir === ".") return `/${rel}`;
    const listed = git(["ls-files", "-z", "--", dir]);
    const others = listed.status === 0 ? listed.stdout.split("\0").filter((p) => p && p !== rel) : [];
    return others.length > 0 ? `/${rel}` : `/${dir}/`;
  };
  /** @type {Map<string, { path: string, tracked: boolean, gitignore_line: string }>} */
  const findings = new Map();
  for (const note of notes) {
    const { via } = note.data;
    const named = /** @type {unknown[]} */ ([
      ...(via === "cli:playwright-cli" ? [isMap(note.data.identifiers) ? note.data.identifiers.login_state : undefined] : []),
      ...(typeof via === "string" && via.startsWith("file:") ? [via.slice("file:".length)] : []),
    ]);
    for (const name of named) {
      if (typeof name !== "string" || name === "" || name.includes("\\")) continue;
      // A note names its file from the repository under test, the parent of `.qa/`, as scout resolves it.
      const rel = relative(repo.top, namedRepoPath(root, name)).split(sep).join("/");
      if (!rel || rel.startsWith("../") || isAbsolute(rel)) continue;
      const tracked = git(["ls-files", "--error-unmatch", "--", rel]).status === 0;
      if (!tracked && git(["check-ignore", "--quiet", "--stdin"], `${rel}\n`).status === 0) continue;
      findings.set(rel, { path: rel, tracked, gitignore_line: line(rel) });
    }
  }
  return [...findings.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// One entry kind's change from `was` to `draft` (each a list from `entriesOf`): the keys `listed`
// as added, edited and removed, and each draft entry's `status`. Entries are told apart by key; a
// key in a token format is listed as `shownKey` shows it.
/**
 * @param {TrainEntry[]} was
 * @param {TrainEntry[]} draft
 * @returns {TrainChanges}
 */
function changesOf(was, draft) {
  const before = new Map(was.map((c) => [c.key, c]));
  const drafted = new Set(draft.map((c) => c.key));
  const changed = draft.filter((c) => before.has(c.key) && /** @type {TrainEntry} */ (before.get(c.key)).entry !== c.entry);
  const listed = {
    added: draft.filter((c) => !before.has(c.key)).map((c) => shownKey(c.key)),
    edited: changed.map((c) => ({ key: shownKey(c.key), from: /** @type {TrainEntry} */ (before.get(c.key)).statement, to: c.statement })),
    removed: [...before.keys()].filter((k) => !drafted.has(k)).map(shownKey),
  };
  return { draft, listed, status: (c) => (!before.has(c.key) ? "added" : changed.includes(c) ? "edited" : "unchanged") };
}

// The train file a run for `target` starts from, `train/<target>.md`, or null when there is none.
/**
 * @param {TrainContext} ctx
 * @param {string} target
 * @returns {{ rel: string, path: string } | null}
 */
function baselineOf(ctx, target) {
  const rel = relIn(ctx, target);
  const path = join(ctx.root, rel);
  return existsSync(path) ? { rel, path } : null;
}

// The Statability Test, mechanically: scan's weak checks (a tracker key, a status-code
// literal, a role name), plus a `.qa/` key (a `rule_`, `tc_`, `ts_` or Automation key, or a hyphenated
// Feature key: a one-word one is too often a plain word), a term a Rule marks as the system's own
// (a code span in any Rule's statement, such as a column or field name) and an endpoint-like
// path. Schema field names and level values are the framework's vocabulary, never the system's,
// so they are exempt.
/**
 * @param {string | undefined} text
 * @param {TrainContext} ctx
 * @param {Set<string>} terms
 * @returns {TrainHit[]}
 */
function statabilityHits(text, ctx, terms) {
  return systemHits(text, ctx, terms).map((h) => ({ ...h, message: `names ${WHAT[h.code]} (${h.matches.join(", ")}): a Convention names no part of the system under test` }));
}

// What in `text` names the system under test, without the Convention's wording: the same weak
// checks a category takes.
/**
 * @param {string | undefined} text
 * @param {TrainContext} ctx
 * @param {Set<string>} terms
 * @returns {{ code: string, matches: string[] }[]}
 */
function systemHits(text, ctx, terms) {
  const hits = namesOfTheSystem(/** @type {string} */ (text), ctx);
  const tokens = /** @type {string} */ (text).split(/[^A-Za-z0-9_-]+/).filter(Boolean);
  const keys = tokens.filter((t) => PATTERN.rule.test(t) || PATTERN.case.test(t) || PATTERN.scenario.test(t) || (ctx.autPattern ?? PATTERN.aut).test(t) || (t.includes("-") && ctx.index.features.has(t)));
  if (keys.length) hits.push({ code: "qa_key", matches: keys });
  const named = [...terms].filter((t) => new RegExp(`(?<![\\w])${escape(t)}(?![\\w])`).test(/** @type {string} */ (text)));
  if (named.length) hits.push({ code: "rule_term", matches: named });
  const paths = [.../** @type {string} */ (text).matchAll(PATH)].map((m) => m[0]);
  if (paths.length) hits.push({ code: "path", matches: paths });
  return hits;
}

/**
 * A category's name and meaning, checked for the same thing a Convention's statement is: it names
 * a kind of behaviour, never a screen, endpoint, role, key or other part of the system under test.
 * The key is checked too, since a category key is read as prose in the walk.
 * @param {readonly import("./categories.mjs").EffectiveCategory[]} categories
 * @param {{ added: string[], edited: { key: string }[] }} changes
 * @param {TrainContext} ctx
 * @returns {(TrainHit & { key: string, status: "added" | "edited" | "unchanged", where: "key" | "name" | "meaning" })[]}
 */
function categoryStatability(categories, changes, ctx) {
  const terms = ruleTerms(ctx);
  const added = new Set(changes.added);
  const edited = new Set(changes.edited.map((entry) => entry.key));
  return categories.filter((category) => !category.floor).flatMap((category) => {
    /** @type {"added" | "edited" | "unchanged"} */
    const status = added.has(category.key) ? "added" : edited.has(category.key) ? "edited" : "unchanged";
    /** @type {("key" | "name" | "meaning")[]} */
    const fields = ["key", "name", "meaning"];
    return fields.flatMap((where) => systemHits(category[where], ctx, terms).map((hit) => ({
      key: category.key,
      status,
      where,
      ...hit,
      message: `names ${WHAT[hit.code]} (${hit.matches.join(", ")}): a category names a kind of behaviour, never a screen, endpoint or component of the system under test`,
    })));
  });
}

const PATH = /(?<![\w.:/])\/[A-Za-z0-9_{}:.-]+(?:\/[A-Za-z0-9_{}:.-]+)+/g;
/** @type {Record<string, string>} */
const WHAT = { ...SCAN_WHAT, qa_key: "a Feature, Rule or case key", rule_term: "a term the Rules use for the system", path: "an endpoint path" };

// Every code span in a Rule statement across `.qa/`, less the framework's own vocabulary.
/**
 * @param {TrainContext} ctx
 * @returns {Set<string>}
 */
function ruleTerms(ctx) {
  const schema = new Set([...KNOWN.case, ...ctx.levels]);
  const terms = new Set();
  for (const f of ctx.files) {
    if (f.unreadable || f.type !== "feature") continue;
    for (const r of f.rules) for (const m of r.statement.matchAll(/`([^`]+)`/g)) if (!schema.has(m[1].trim())) terms.add(m[1].trim());
  }
  return terms;
}

// The scenario changes from commit `ref` to the working tree, compared Bookkeeping-stripped so a
// tracker refresh or a triage stamp is no change: each changed scenario file with its stripped
// diff, and each changed case before and after. The engineer's fixes to generated cases are the
// ones whose `generated_by` names a Delegate. The migration's Key rewrite is followed through `formerly`, so a case
// or scenario keyed anew since `ref` pairs with what it was (`was`). `only` scopes the result to
// one scenario key, on either side.
/**
 * @param {TrainContext} ctx
 * @param {string} ref
 * @param {string | null} only
 * @param {Record<string, unknown>} json
 * @returns {{ exit: number, json: Record<string, unknown> }}
 */
function changesSince(ctx, ref, only, json) {
  const repo = repositoryOf(ctx.root);
  if (!repo) throw new UsageError(`train evidence reads git history, and ${ctx.root} is not inside a git repository`);
  const commit = resolveRef(ctx.root, ref);
  if (!commit) throw new UsageError(`--diff \`${ref}\` names no commit`);
  /**
   * @param {ParsedFile[]} files
   * @returns {ParsedFile[]}
   */
  const scenarios = (files) => files.filter((f) => !f.unreadable && f.type === "scenario" && typeof f.data.key === "string");
  const before = scenarios(/** @type {ParsedFile[]} */ (loadQaAt(repo, commit)));
  const after = scenarios(ctx.files);
  const { index } = ctx;
  const beforeIndex = buildIndex(before);
  const byKey = new Map(before.map((f) => /** @type {[unknown, ParsedFile]} */ ([f.data.key, f])));
  const paired = new Set();

  /** @type {TrainScenarioChange[]} */
  const changes = [];
  for (const now of after) {
    const was = byKey.get(now.data.key) ?? listOf(now.data.formerly).map((k) => byKey.get(k)).find(Boolean) ?? null;
    if (was) paired.add(was);
    const change = scenarioChange(ctx, was, now, index.featureOf(now));
    if (change) changes.push(change);
  }
  for (const was of before) if (!paired.has(was)) changes.push(/** @type {TrainScenarioChange} */ (scenarioChange(ctx, was, null, beforeIndex.featureOf(was))));
  const scoped = changes.filter((c) => only === null || c.scenario === only || c.was === only);
  if (only !== null && !index.scenarios.has(only) && !byKey.has(only)) throw new UsageError(`no scenario \`${only}\` in ${ctx.root} or at \`${ref}\``);
  const base = { ref, commit };
  if (scoped.length === 0) {
    const since = json.source === "uncommitted" ? "uncommitted" : `since \`${ref}\``;
    return { exit: 1, json: { ...json, ok: false, base, reason: "no_changes", error: `no ${since} scenario change${only ? ` to \`${only}\`` : ""}: nothing to learn from`, changes: [] } };
  }
  return { exit: 0, json: { ...json, ok: true, base, changes: scoped } };
}

// One scenario file's change between `was` and `now` (either may be null), or null when their
// stripped text is the same.
/**
 * @param {TrainContext} ctx
 * @param {ParsedFile | null} was
 * @param {ParsedFile | null} now
 * @param {string | null} feature
 * @returns {TrainScenarioChange | null}
 */
function scenarioChange(ctx, was, now, feature) {
  const a = was ? claimProjection(/** @type {StrippableFile} */ (was)) : null;
  const b = now ? claimProjection(/** @type {StrippableFile} */ (now)) : null;
  if (a && b && a.text === b.text) return null;
  const file = /** @type {ParsedFile} */ (now ?? was).rel;
  /** @type {TrainScenarioChange["cases"]} */
  const cases = [];
  const beforeCases = new Map((was?.cases ?? []).map((c) => [c.key, c]));
  const seen = new Set();
  for (const c of now?.cases ?? []) {
    const prior = beforeCases.has(c.key) ? c.key : listOf(c.data.formerly).find((k) => beforeCases.has(k)) ?? null;
    if (prior) seen.add(prior);
    const beforeText = prior ? /** @type {Stripped} */ (a).cases.get(prior) : null;
    const afterText = /** @type {Stripped} */ (b).cases.get(c.key);
    if (beforeText === afterText) continue;
    cases.push({
      key: c.key,
      ...(prior && prior !== c.key && { was: prior }),
      change: prior ? "modified" : "added",
      generated_by: generatedBy(/** @type {ParsedEntry} */ (prior ? beforeCases.get(prior) : c)),
      before: beforeText,
      after: afterText,
    });
  }
  for (const [k, c] of beforeCases) {
    if (!seen.has(k)) cases.push({ key: k, change: "removed", generated_by: generatedBy(c), before: /** @type {Stripped} */ (a).cases.get(k), after: null });
  }
  return {
    scenario: /** @type {ParsedFile} */ (now ?? was).data.key,
    ...(was && now && was.data.key !== now.data.key && { was: was.data.key }),
    feature,
    file: repoPath(ctx, file),
    status: !was ? "added" : !now ? "deleted" : "modified",
    cases,
    diff: unifiedDiff(repoPath(ctx, file), a?.text ?? null, b?.text ?? null),
  };
}

/**
 * A case's `generated` block: the Delegate that generated it.
 * @typedef {{ by?: string }} TrainGenerated
 */

/**
 * @param {ParsedEntry} c
 * @returns {string | null}
 */
const generatedBy = (c) => (typeof (/** @type {TrainGenerated} */ (c.data.generated))?.by === "string" ? /** @type {string} */ (/** @type {TrainGenerated} */ (c.data.generated).by) : null);
/**
 * @param {unknown} v
 * @returns {string[]}
 */
const listOf = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

// The target's train file as it stands: `file` and `path` name `train/<target>.md`, the file the
// skill writes; whether a baseline `exists`, and each of its entries (Conventions and Practices, or
// for `access` its Access notes) with its `sources` and `added`, for classifying a proposal against
// it. An Access note adds the `match` prefixes it covers, the `via` that carries its credential, and
// its `role`, `host` and `identifiers` (null when it has none): what a refinement, a collision or
// two notes sharing one account turns on.
/**
 * @param {TrainContext} ctx
 * @param {string} target
 * @returns {Record<string, unknown>}
 */
function trainState(ctx, target) {
  const baseline = baselineOf(ctx, target);
  /**
   * @param {string} list
   * @returns {TrainEntry[]}
   */
  const entries = (list) => (baseline ? entriesOf(baseline.rel, readFileSync(baseline.path, "utf8"), list) : []);
  // An entry already on disk that holds a credential is listed by its key alone (`withheld`):
  // evidence never repeats one, so the gate raises the entry as a finding to be rewritten without it.
  /**
   * @param {TrainEntry} entry
   * @returns {Record<string, unknown>}
   */
  const brief = ({ key, statement, sources, added, line, withheld }) => ({
    key: shownKey(key),
    ...(withheld ? { line, withheld } : { statement, sources, added, line }),
  });
  /**
   * @param {TrainEntry} e
   * @returns {Record<string, unknown>}
   */
  const noteBrief = (e) => (e.withheld ? brief(e) : {
    ...brief(e),
    match: listOf(e.data.match),
    via: typeof e.data.via === "string" ? e.data.via : null,
    role: typeof e.data.role === "string" ? e.data.role : null,
    host: typeof e.data.host === "string" ? e.data.host : null,
    identifiers: isMap(e.data.identifiers) ? e.data.identifiers : null,
  });
  const rel = relIn(ctx, target);
  const base = {
    file: repoPath(ctx, rel),
    path: join(ctx.root, rel),
    exists: baseline !== null,
  };
  // Categories are shared, not a command's file: their state is the resolved extensions and the
  // keys never to reuse, in walk order.
  if (target === CATEGORIES_TRAIN_KEY) {
    const { categories, retired } = effectiveCategories(ctx.root);
    return {
      ...base,
      categories: categories.filter((category) => !category.floor).map(({ key, name, meaning, after }) => ({ key, name, meaning, after })),
      retired,
    };
  }
  if (target === EXECUTE_TRAIN_KEY) {
    const file = baseline ? parse(baseline.rel, readFileSync(baseline.path, "utf8")) : null;
    const training = executeTraining(file);
    const withheld = new Set(kindsOf(target).flatMap(entries).filter((e) => e.withheld).map((e) => e.line));
    return { ...base, ...training,
      ...((secretsIn({ setup_role: training.setup_role }).length > 0 || credentialIn(JSON.stringify(training.setup_role) ?? "")) && { setup_role: WITHHELD }),
      entries: training.entries.map((e) => withheld.has(e.line) ? { kind: e.kind, key: shownKey(e.key), line: e.line, withheld: true } : e),
    };
  }
  if (target === CODEFIX_TRAIN_KEY) {
    const file = baseline ? parse(baseline.rel, readFileSync(baseline.path, "utf8")) : null;
    return { ...base, ...fixTraining(file), practices: entries("practices").map(brief) };
  }
  if (target === CODEGEN_TRAIN_KEY) {
    const file = baseline ? parse(baseline.rel, readFileSync(baseline.path, "utf8")) : null;
    const data = file?.data ?? {};
    return { ...base, pr: data.pr ?? "on-request", trained_stacks: data.trained_stacks ?? [], codegen_repeats: data.codegen_repeats ?? 3, codegen_attempts: data.codegen_attempts ?? 3,
      conventions: entries("conventions").map((e) => e.withheld ? brief(e) : { ...brief(e), stack: e.data.stack, facet: e.data.facet, refs: e.data.refs ?? [], signal: e.data.signal ?? null }),
      practices: entries("practices").map(brief) };
  }
  return {
    ...base,
    ...Object.fromEntries(kindsOf(target).map((list) => [list, entries(list).map(list === "access_notes" ? noteBrief : brief)])),
  };
}

/**
 * @param {TrainContext} ctx
 * @returns {Record<string, unknown>}
 */
function executeEvidence(ctx) {
  /** @type {string[]} */
  let fixtures = [];
  try {
    fixtures = readdirSync(join(ctx.root, "fixtures")).filter((name) => fixtureExists(ctx.root, name)).sort();
  } catch { /* No fixtures have been committed yet. */ }
  return {
    features: [...ctx.index.features].map(([key, declarations]) => ({ key, summary: declarations[0].file.h1?.text ?? key })),
    targets: ctx.targets ?? {},
    execute_levels: ctx.execute_levels ?? {},
    fixtures,
    // The latest Blocked precondition/step and interpreted Execution results (`/qa-next`'s reader).
    execution_results: [...latestExecutionResults(ctx.files, /** @type {Parameters<typeof latestExecutionResults>[1]} */ (ctx.index)).values()]
      .filter((r) => (r.result === "blocked" && ["precondition", "step"].includes(/** @type {string} */ (r.reason))) || r.interpretations)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(({ key, feature, result, reason, date, target, out_of_date, interpretations, preconditions, why, file, line }) => ({
        key, feature, result, ...(/** @type {{ reason: unknown }} */ (reason && { reason })), date, target, out_of_date,
        ...(/** @type {{ interpretations: unknown }} */ (interpretations && { interpretations })), ...(/** @type {{ preconditions: unknown }} */ (preconditions && { preconditions })), ...(why && { why }),
        file: repoPath(ctx, file), line,
      })),
    // The latest Automation results, selected on their own, so an Automation pass never reads as a
    // manual pass: one case per entry, its `automation` entries as the record holds them.
    automation_results: [...latestAutomationResults(ctx.files, /** @type {Parameters<typeof latestAutomationResults>[1]} */ (ctx.index)).values()]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(({ key, feature, automation, date, target, out_of_date, file, line }) => ({
        key, feature, automation, date, target, out_of_date, file: repoPath(ctx, file), line,
      })),
  };
}

// Every entry of one kind (`list`: `conventions`, `practices` or `access_notes`) of the train file
// at `rel` whose text is `text`, as the loader parses it, plus its `sources` and `added`, its
// rationale (the non-blank prose outside any fence), the entry's whole text and its parsed `yaml`
// block (`data`). An entry holding a credential is `withheld`, and its statement is replaced
// (`WITHHELD`): text in the shape of one anywhere in the entry, or in an Access note a key named
// for a credential.
/**
 * @param {string} rel
 * @param {string} text
 * @param {string} list
 * @returns {TrainEntry[]}
 */
function entriesOf(rel, text, list) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return (/** @type {ParsedEntry[]} */ (parse(rel, text)[list])).map((c) => {
    const entry = lines.slice(c.line - 1, c.end).join("\n").replace(/\s+$/, "");
    const withheld = credentialIn(entry) !== null || ((list === "access_notes" || rel === relOf(EXECUTE_TRAIN_KEY)) && secretsIn(c.data).length > 0);
    return {
      key: c.key,
      statement: withheld ? WITHHELD : c.statement,
      line: c.line,
      sources: listOf(c.data.sources),
      added: c.data.added ?? null,
      rationale: c.prose.filter((p) => p.text.trim()),
      entry,
      data: c.data,
      withheld,
    };
  });
}

// A path under `.qa/` as the repository under test sees it.
/**
 * @param {TrainContext} ctx
 * @param {string} rel
 * @returns {string}
 */
function repoPath(ctx, rel) {
  return relative(ctx.repo, join(ctx.root, rel)).split(sep).join("/");
}
