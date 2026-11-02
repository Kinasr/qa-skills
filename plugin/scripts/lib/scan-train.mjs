// @ts-check
// Train warnings: the Statability Test, weakly checked on each Convention's statement
// (a tracker key, an HTTP status-code literal or a `project.roles` name means it probably names the
// system under test), and the file's size (growth is a symptom that the file is holding claims).
// Fenced examples are exempt: only the heading's statement is read. Practices and Access notes
// never take the test (ADR-0015). On `train/access.md`, an Access note no Reference resolves to
// (`unused_access_note`). And on every file in `train/`, whatever its `type`, a line that still
// looks like a credential (`possible_credential`). Warnings only.
/** @import { ParsedAccessNote } from "./access.mjs" */
/** @import { ParsedEntry, ParsedFile, ProjectConfig } from "./knowledge-file.mjs" */
/** @import { TrainEntryDescriptor } from "./schema.mjs" */
/** @import { QaFile, ScanContext } from "./scan.mjs" */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { codegenSample } from "./codegen-sample.mjs";
import { accessNotes, matchAccessNotes, trackerUri } from "./access.mjs";
import { credentialIn, credentialMessage, secretsIn, shownKey, tokenIn } from "./credentials.mjs";
import { executeOutcomeClaims } from "./execute-training.mjs";
import { ACCESS_TRAIN_KEY, TRAIN_ENTRIES, canonicalTrainKey, isLegacyTrainKey } from "./schema.mjs";

const ACCESS_REL = `train/${ACCESS_TRAIN_KEY}.md`;

/**
 * The kinds of result this pass reports.
 * @typedef {"train_warning"} TrainResultKind
 */

/**
 * A train file's entry, as the knowledge layer parses it: its heading, its block's values and the
 * lines they sit on.
 * @typedef {{
 *   key: string,
 *   line: number,
 *   end: number,
 *   data: Record<string, unknown>,
 *   keyLines: Record<string, number>,
 *   blockLine: number | null,
 *   statement: string,
 * }} TrainEntry
 */

/**
 * A `.qa/` file the scan reads: its path, its directory, its text, its frontmatter values and the
 * entry lists a train file holds. `parse` writes each of those lists, empty when the file holds
 * none (lib/knowledge-file.mjs).
 * @typedef {{
 *   rel: string,
 *   dir: string,
 *   text: string,
 *   type: string | null,
 *   data: Record<string, unknown>,
 *   keyLines: Record<string, number>,
 *   unreadable?: never,
 *   conventions: TrainEntry[],
 *   practices: TrainEntry[],
 *   access_notes: TrainEntry[],
 *   recipes: TrainEntry[],
 *   actions: TrainEntry[],
 *   uploads: TrainEntry[],
 *   [key: string]: unknown,
 * }} QaFile
 */

/**
 * A `.qa/` file that could not be read: nothing of it is known.
 * @typedef {{
 *   rel: string,
 *   unreadable: string,
 *   type?: never,
 *   data?: never,
 *   dir?: never,
 *   text?: never,
 *   keyLines?: never,
 *   conventions?: never,
 *   practices?: never,
 *   access_notes?: never,
 *   recipes?: never,
 *   actions?: never,
 *   uploads?: never,
 * }} UnreadableQaFile
 */

/**
 * A train warning this pass reports: what it found, and where.
 * @typedef {{
 *   kind: TrainResultKind,
 *   code: string,
 *   file: string,
 *   line?: number,
 *   key?: unknown,
 *   bytes?: number,
 *   matches?: string[],
 *   message: string,
 * }} TrainWarning
 */

/** @type {readonly TrainResultKind[]} */
export const kinds = ["train_warning"];

// The threshold is held loose on purpose. Conventions number in the tens and the whole file is the cached
// prefix of every `/qa-design` call, so 32 KiB (about 8K tokens) is already large.
const SIZE_WARNING_BYTES = 32 * 1024;

// A three-digit number followed by a unit (`120 characters`, `250 ms`) is a limit, never a status. A
// counted noun must be plural and whole, so `404 File Not Found` and `504 Timeout` stay statuses.
const STATUS_CODE = /(?<![\w.])[1-5][0-9]{2}(?![\w.])(?!\s*(?:%|(?:ms|s|secs?|mins?|kb|mb|px|chars|characters|seconds|minutes|hours|days|lines|items|rows|words|bytes|pixels|records|files|cases|steps|times)\b))/gi;

/**
 * @param {string} s
 * @returns {string}
 */
export const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What each code names, as a warning reads it. A code the train draft adds names its own thing
 * there (lib/train.mjs), so this map is open.
 * @type {Record<string, string>}
 */
export const WHAT = { tracker_key: "a tracker key", status_code: "a status-code literal", role_name: "a role name" };

// What in `text` probably names the system under test, as `[{code, matches}]` with an entry only
// for a code that matched: a tracker key, an HTTP status-code literal, a `project.roles` name.
// `train check` runs the same test on a drafted Convention, and adds its own.
/**
 * @param {string} text
 * @param {{ trackerPattern: RegExp | null, roles: Set<string> }} options
 * @returns {{ code: string, matches: string[] }[]}
 */
export function namesOfTheSystem(text, { trackerPattern, roles }) {
  const tokens = text.split(/[^A-Za-z0-9_-]+/).filter(Boolean);
  /** @type {[string, string[]][]} */
  const hits = [
    ["tracker_key", trackerPattern ? tokens.filter((t) => trackerPattern.test(t)) : []],
    ["status_code", [...text.matchAll(STATUS_CODE)].map((m) => m[0])],
    ["role_name", [...roles].filter((r) => new RegExp(`(?<![\\w])${escape(r)}(?![\\w])`).test(text))],
  ];
  return hits.filter(([, matches]) => matches.length).map(([code, matches]) => ({ code, matches }));
}

// A legacy train file (`LEGACY_TRAIN_KEYS`) beside its target's own file is never read: the
// training takes the target's own (lib/training.mjs `trainFile`), so its entries are lost until moved.
/**
 * @param {ScanContext} ctx
 * @returns {void}
 */
function shadowedWarnings(ctx) {
  const train = /** @type {readonly ParsedFile[]} */ (ctx.files).filter((f) => !f.unreadable && f.type === "train");
  for (const legacy of train.filter((f) => isLegacyTrainKey(f.data.key))) {
    const own = train.find((f) => f.data.key === canonicalTrainKey(legacy.data.key));
    if (own) ctx.emit({ kind: "train_warning", code: "legacy_shadowed", file: legacy.rel, key: legacy.data.key, message: `\`${legacy.rel}\` is never read: \`${own.rel}\` holds the same training; move its entries into \`${own.rel}\` and delete it` });
  }
}

/**
 * @param {ScanContext} ctx
 * @returns {void}
 */
export function run(ctx) {
  shadowedWarnings(ctx);
  accessWarnings(ctx);
  codegenWarnings(ctx);
  for (const f of /** @type {readonly ParsedFile[]} */ (ctx.files)) if (!f.unreadable && f.dir === "train") credentialWarnings(ctx, f);
  for (const f of /** @type {readonly ParsedFile[]} */ (ctx.files)) {
    if (f.unreadable || f.type !== "train") continue;
    for (const { field, ...warning } of executeOutcomeClaims(f)) ctx.emit({ kind: "train_warning", file: f.rel, key: field, ...warning });
    // A key in a token format, the file's or an entry's, is shown as `shownKey` shows it.
    const fileKey = shownKey(f.data.key);
    const bytes = Buffer.byteLength(f.text, "utf8");
    if (bytes > SIZE_WARNING_BYTES) {
      ctx.emit({
        kind: "train_warning",
        code: "size",
        file: f.rel,
        key: fileKey,
        bytes,
        message: `the train file is ${bytes} bytes, past ${SIZE_WARNING_BYTES}: a growing training file is usually holding claims that belong in Rules`,
      });
    }
    for (const cnv of /** @type {ParsedEntry[]} */ (f.conventions)) {
      const key = shownKey(cnv.key);
      for (const { code, matches } of namesOfTheSystem(/** @type {string} */ (cnv.statement), ctx.config)) {
        ctx.emit({ kind: "train_warning", code, file: f.rel, line: cnv.line, key, matches, message: `\`${key}\`'s statement carries ${WHAT[code]} (${matches.join(", ")}); a Convention names no part of the system under test` });
      }
    }
  }
}

// `train/access.md`'s Access notes: one no Reference resolves to is dead, matched through the
// same matcher the fetching commands use. A role-less note is matched role-less over every Feature's
// `sources`, the `url` of every Observation, the configured tracker and the origin of every `targets`
// entry; a Role's notes are matched with that Role over the targets alone, as no other command
// reaches them by Role. A note with a malformed `role` draws none: `check-file` refuses it already.
/**
 * @param {ScanContext} ctx
 * @returns {void}
 */
function accessWarnings(ctx) {
  const file = ctx.files.find((f) => !f.unreadable && f.type === "train" && f.rel === ACCESS_REL);
  if (!file) return;
  const notes = accessNotes(file);
  if (!notes.length) return;
  /** @type {Set<string>} */
  const uris = new Set();
  for (const f of ctx.files) {
    if (f.unreadable || f.type !== "feature" || !Array.isArray(f.data.sources)) continue;
    for (const s of f.data.sources) if (typeof s === "string") uris.add(s);
  }
  // The page an Observation was taken from reaches the app through its note too, so a note
  // used only for observing is no dead one.
  for (const f of ctx.files) {
    if (!f.unreadable && f.type === "observation" && typeof f.data.url === "string") uris.add(`url:${f.data.url}`);
  }
  const tracker = trackerUri(ctx.index.project?.data?.tracker);
  if (tracker) uris.add(tracker);
  const targets = Object.values(ctx.config.targets ?? {}).filter((o) => typeof o === "string").map((origin) => `url:${origin}/`);
  for (const uri of targets) uris.add(uri);
  /**
   * @param {readonly string[]} list
   * @param {{ role?: string | null }} [options]
   * @returns {ParsedAccessNote[]}
   */
  const matched = (list, options) => /** @type {ParsedAccessNote[]} */ (Object.values(matchAccessNotes(list, notes, options)).filter(Boolean));
  const used = new Set(matched([...uris]).map((n) => n.key));
  for (const role of new Set(notes.map((n) => n.role).filter((r) => typeof r === "string" && r.trim()))) {
    for (const n of matched(targets, { role })) used.add(n.key);
  }
  for (const n of notes) {
    if (used.has(n.key) || (n.role !== undefined && (typeof n.role !== "string" || !n.role.trim()))) continue;
    const key = shownKey(n.key);
    const searched = n.role === undefined
      ? "matches no Reference in any Feature's sources, no Observation's url, nor the configured tracker, nor any target's origin"
      : "matches no target's origin for its Role";
    ctx.emit({
      kind: "train_warning",
      code: "unused_access_note",
      file: file.rel,
      line: n.line,
      key,
      message: `Access note \`${key}\` ${searched}: check its \`match\`, or remove the note if nothing reaches that target any more`,
    });
  }
}

// Each line of a train file that still looks like a credential, named by the entry it sits in;
// the value itself is never repeated. A line check-file refused for a credential is skipped, as it
// is already an Integrity error: a known token format on any line, and the line a credential-named
// key's `secret` cites. What is left is a looser shape (a JWT, a URL with a password, an
// Authorization value), which is warned about instead.
/**
 * @param {ScanContext} ctx
 * @param {ParsedFile} file
 * @returns {void}
 */
function credentialWarnings(ctx, file) {
  const refused = new Set(/** @type {ParsedEntry[]} */ (file.access_notes).flatMap((e) => secretsIn(e.data).map((s) => e.keyLines[s.key] ?? e.blockLine)));
  const entries = TRAIN_ENTRIES.flatMap((entry) => (/** @type {TrainEntry[]} */ (file[entry.list])).map((e) => ({ e, entry })));
  const lines = file.text.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((text, i) => {
    const line = i + 1;
    const what = credentialIn(text);
    if (!what || refused.has(line) || tokenIn(text)) return;
    const { e, entry } = /** @type {{ e?: TrainEntry, entry?: TrainEntryDescriptor }} */ (entries.find(({ e }) => e.line <= line && line <= e.end) ?? {});
    const key = /** @type {string | undefined} */ (e && shownKey(e.key));
    ctx.emit({
      kind: "train_warning",
      code: "possible_credential",
      file: file.rel,
      line,
      ...(key && { key }),
      message: credentialMessage(line, `what looks like ${what}`, entry, key),
    });
  });
}

// Codegen references must still resolve inside the configured code roots; citations identify a
// current path and line, independently of whether the historical commit remains available.
/** @param {ScanContext} ctx */
function codegenWarnings(ctx) {
  const file = ctx.files.find((f) => !f.unreadable && f.rel === "train/codegen.md" && f.type === "train");
  if (!file) return;
  const roots = ctx.config.modulePaths.filter((p) => existsSync(join(ctx.repo, p)));
  const stack = ctx.config.stack?.root;
  const bases = roots.length ? roots : stack && existsSync(resolve(ctx.repo, stack)) ? [stack] : [];
  /** @param {string} ref */
  const resolves = (ref) => {
    try {
      const target = realpathSync(resolve(ctx.repo, ref));
      return bases.some((base) => {
        const rel = relative(realpathSync(resolve(ctx.repo, base)), target);
        return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
      });
    } catch { return false; }
  };
  const adapter = /** @type {import("./stack.mjs").StackAdapter | null} */ (ctx.stack.adapter);
  const evidence = adapter?.codegen && file.conventions?.some((entry) => entry.data.signal) ? codegenSample({ repo: ctx.repo, modulePaths: ctx.config.modulePaths, annotationMap: ctx.config.annotationMap, autPattern: ctx.config.autPattern ?? null, adapter }) : null;
  const corpus = evidence && !("error" in evidence) ? evidence.corpus : null;
  for (const entry of file.conventions ?? []) {
    const entryStack = typeof entry.data.stack === "string" ? entry.data.stack : "";
    const emit = (/** @type {string} */ code, /** @type {string} */ message) => ctx.emit({ kind: "train_warning", code, file: file.rel, line: entry.line, key: entry.key, stack: entryStack, message });
    const signal = /** @type {{id?: string, value?: string, corpus?: string} | null} */ (entry.data.signal && typeof entry.data.signal === "object" ? entry.data.signal : null);
    if (corpus && Number(corpus.test_files) >= 5 && entryStack === stack && signal?.id && signal.value && signal.corpus) {
      const field = signal.id === "placement-dir" ? "directories" : signal.id === "key-carrier" ? "key_carriers" : signal.id === "test-naming" ? "test_names" : null;
      const baseline = /^(\d+)\/(\d+)$/.exec(signal.corpus);
      const groups = field ? /** @type {{value: string, files: number}[]} */ (corpus[field]) : [];
      if (baseline && field) {
        const observed = groups.reduce((n, group) => n + group.files, 0);
        const total = Number(baseline[2]) ? observed : Number(corpus.test_files);
        const share = total ? (groups.find((group) => group.value === signal.value)?.files ?? 0) / total : 0;
        const old = Number(baseline[2]) ? Number(baseline[1]) / Number(baseline[2]) : null;
        if (old === null ? share < 0.8 : old >= 0.8 ? share < 0.8 : share < old - 0.1 - 1e-10) emit("convention_drift", `Convention \`${entry.key}\` has drifted`);
      }
    }
    for (const ref of Array.isArray(entry.data.refs) ? entry.data.refs : []) {
      if (typeof ref === "string" && !resolves(ref)) emit("ref_unresolved", `Convention \`${entry.key}\` has an unresolved ref`);
    }
    for (const source of Array.isArray(entry.data.sources) ? entry.data.sources : []) {
      if (typeof source !== "string") continue;
      const match = /^code:(.+)#L(\d+)@[0-9a-f]{7}$/i.exec(source);
      if (!match) continue;
      let broken = true;
      try {
        const path = realpathSync(resolve(ctx.repo, match[1]));
        const rel = relative(realpathSync(ctx.repo), path);
        if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("citation outside repository");
        const text = readFileSync(path, "utf8");
        const lines = text === "" ? 0 : text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
        broken = Number(match[2]) > lines || Number(match[2]) < 1;
      } catch { /* missing citation */ }
      if (broken) emit("citation_broken", `Convention \`${entry.key}\` has a broken citation`);
    }
  }
}
