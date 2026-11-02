// @ts-check
// Access notes (ADR-0015): how to reach a tracker or URL Reference that sits behind a login,
// never the credential. This module holds the lookup the fetching commands (`/qa-deep-dive`,
// `/qa-sync`, `/qa-init`) resolve their References' notes with; what looks like a credential is
// lib/credentials.mjs's to say. The shape of a note's own fields (`cliLoginUser`, `isMatchPrefix`)
// is lib/access-note.mjs's: `check-file` imports it, and this module reads the working tree.
//
//   accessFor(source, uris)   {[uri]: note | null}: the note each normalised Reference URI is
//                             reached through, read from `train/access.md` of `source`. See below.
//   rolesCovering(uri, notes) the Roles of the Role-tagged notes covering a URI: what a
//                             role-less lookup skipped.
/**
 * @import { ParsedEntry, ParsedFile } from "./knowledge-file.mjs"
 * @import { TrainFile } from "./training.mjs"
 */
import { credentialIn, secretsIn, shownKey } from "./credentials.mjs";
import { isMap } from "./dialect.mjs";
import { compileKeyPattern } from "./keys.mjs";
import { ACCESS_TRAIN_KEY } from "./schema.mjs";
import { trainFile } from "./training.mjs";

/**
 * An Access note entry as parsed from `train/access.md`.
 * @typedef {{
 *   key: string,
 *   line: number,
 *   role?: string,
 *   match?: string[] | unknown,
 *   via?: string | unknown,
 *   [key: string]: unknown,
 * }} ParsedAccessNote
 */

/**
 * A train file for access notes with parsed entries.
 * @typedef {ParsedFile & { access_notes: ParsedEntry[] }} TrainAccessFile
 */

/**
 * A shown Access note, as commands read it.
 * @typedef {{
 *   key: string,
 *   statement?: string,
 *   match?: string[],
 *   via?: string,
 *   host?: string,
 *   identifiers?: Record<string, string>,
 *   credential_from?: string,
 *   role?: string,
 *   quirks?: string,
 *   withheld?: boolean,
 * }} ShownAccessNote
 */

// The Access notes of a parsed `train/access.md` (lib/knowledge-file.mjs `parse`), each its `yaml`
// block with its `key` and heading `line`: the shape `matchAccessNotes` reads.
/**
 * @param {ParsedFile | TrainFile | { access_notes?: unknown } | null | undefined} file
 * @returns {ParsedAccessNote[]}
 */
export function accessNotes(file) {
  return (/** @type {ParsedEntry[]} */ (file?.access_notes ?? [])).map((e) => ({ ...e.data, key: e.key, line: e.line }));
}

// Per normalised Reference URI (`resolveReference`'s `uri`), the note whose `match` holds the
// longest prefix of it, or null when none does: `{[uri]: note | null}`. `check-file` refuses two
// notes with one prefix of one Role, so the winner is unique; a malformed `match` matches nothing.
// Notes are filtered by Role before the longest prefix and never fall back: with no `role`
// only notes without one are read, with a string only notes tagged with exactly that Role.
/**
 * @param {readonly string[]} uris
 * @param {readonly ParsedAccessNote[]} notes
 * @param {{ role?: string | null }} [options]
 * @returns {Record<string, ParsedAccessNote | null>}
 */
export function matchAccessNotes(uris, notes, { role = null } = {}) {
  const prefixes = notes.filter((note) => (role === null ? note.role === undefined : note.role === role)).flatMap((note) =>
    (Array.isArray(note.match) ? note.match : []).filter((m) => typeof m === "string" && m).map((prefix) => ({ prefix: /** @type {string} */ (prefix), note })),
  );
  /** @type {Record<string, ParsedAccessNote | null>} */
  const out = {};
  for (const uri of uris) {
    /** @type {{ prefix: string, note: ParsedAccessNote } | null} */
    let best = null;
    for (const p of prefixes) if (covers(p.prefix, uri) && (!best || p.prefix.length > best.prefix.length)) best = p;
    out[uri] = best?.note ?? null;
  }
  return out;
}

// What a command reads of an Access note, from its entry `e` in `file` (a parsed `train/access.md`),
// in `lines`: the fields a fetch needs and nothing else (no `sources`, `added` or line), each
// present only when the note has it.
//   key, statement      the heading: `acc_<slug>` and what the note reaches
//   match               the URI prefixes it covers
//   role                the Role of the test account it logs in as, on an app test-account note
//   via                 where the credential lives: `env:NAME`, `mcp:name`, `cli:name` or `file:<path>`
//   host, identifiers   non-secret facts: the host, and e.g. a user, tenant or org
//   credential_from     where a person gets the credential, in a sentence
//   quirks              the note's prose
// A note that holds what looks like a credential (a hand-edit; `check-file` refuses to write one) is
// returned as `{key, withheld: true}` and nothing else, so a command never repeats it; its key is
// `shownKey`'s.
/** @type {readonly string[]} */
export const FIELDS = ["match", "via", "host", "identifiers", "credential_from", "role"];

/**
 * @param {ParsedEntry} e
 * @param {readonly string[]} lines
 * @returns {ShownAccessNote}
 */
function readable(e, lines) {
  const entry = lines.slice(e.line - 1, e.end).join("\n");
  if (secretsIn(e.data).length > 0 || credentialIn(entry) !== null) return { key: /** @type {string} */ (shownKey(e.key)), withheld: true };
  const quirks = e.prose.map((p) => p.text).join("\n").trim();
  return {
    key: e.key,
    statement: e.statement,
    ...Object.fromEntries(FIELDS.filter((f) => e.data[f] !== undefined).map((f) => [f, e.data[f]])),
    ...(quirks && { quirks }),
  };
}

// The Access note each of `uris` (normalised Reference URIs, as `resolveReference` prints them) is
// reached through, `{[uri]: note | null}`: the note whose `match` is the longest prefix of the URI
// (`matchAccessNotes`), as `readable` shows it, or null when none matches, and so for every `file:`
// and `code:` URI, which no `match` can hold. `source` is a Key index of the working tree or the
// path of the `.qa/` directory, as `trainFor` takes. With no `train/access.md`, every URI is null.
// A note keeping a password in a `file:` (ADR-0019) is the CLI's alone to read: it is null too,
// so a model fetch goes as if no note matched, unless the caller passes `passwordFiles` (`scout brief ui`).
/**
 * @param {string | Record<string, unknown>} source
 * @param {readonly string[]} uris
 * @param {{ passwordFiles?: boolean, role?: string | null }} [options]
 * @returns {Record<string, ShownAccessNote | null>}
 */
export function accessFor(source, uris, { passwordFiles = false, role = null } = {}) {
  const file = /** @type {TrainAccessFile | null} */ (trainFile(source, ACCESS_TRAIN_KEY));
  if (!file) return Object.fromEntries(uris.map((uri) => [uri, null]));
  const lines = textLines(file);
  const shown = new Map(file.access_notes.map((e) => [e.key, readable(e, lines)]));
  const matched = matchAccessNotes(uris, accessNotes(file), { role });
  const hidden = (/** @type {ParsedAccessNote} */ note) => !passwordFiles && typeof note.via === "string" && note.via.startsWith("file:");
  return Object.fromEntries(Object.entries(matched).map(([uri, note]) => [uri, note && !hidden(note) ? /** @type {ShownAccessNote} */ (shown.get(note.key)) : null]));
}

// The distinct Roles, in note order, of the Role-tagged `notes` whose `match` covers `uri` (a
// normalised Reference URI): the Roles a role-less lookup of it skipped. A `role` that is not a
// non-empty, trimmed string is a `check-file` error and is not named.
/**
 * @param {string} uri
 * @param {readonly ParsedAccessNote[]} notes
 * @returns {string[]}
 */
export function rolesCovering(uri, notes) {
  const roles = notes
    .filter((note) => typeof note.role === "string" && note.role !== "" && note.role === note.role.trim())
    .filter((note) => (Array.isArray(note.match) ? note.match : []).some((m) => typeof m === "string" && m && covers(m, uri)))
    .map((note) => /** @type {string} */ (note.role));
  return [...new Set(roles)];
}

// `rolesCovering` over `source`'s `train/access.md`, leaving out the notes `accessFor` would not
// show: one holding what looks like a credential, and (without `passwordFiles`) one keeping a
// password in a `file:`. With no `train/access.md`, none.
/**
 * @param {string | Record<string, unknown>} source
 * @param {string} uri
 * @param {{ passwordFiles?: boolean }} [options]
 * @returns {string[]}
 */
export function rolesCoveringIn(source, uri, { passwordFiles = false } = {}) {
  const file = /** @type {TrainAccessFile | null} */ (trainFile(source, ACCESS_TRAIN_KEY));
  if (!file) return [];
  const lines = textLines(file);
  const shown = new Map(file.access_notes.map((e) => [e.key, readable(e, lines)]));
  const hidden = (/** @type {ParsedAccessNote} */ note) => shown.get(note.key)?.withheld || (!passwordFiles && typeof note.via === "string" && note.via.startsWith("file:"));
  return rolesCovering(uri, accessNotes(file).filter((note) => !hidden(note)));
}

// The Access note whose key is `key` (`acc_<slug>`), as `accessFor` shows it, or null when
// `train/access.md` of `source` holds none: for a reader that was told which note a fetch went
// through (`/qa-sync`'s failure payload) and looks it up rather than matching a URI.
/**
 * @param {string | Record<string, unknown>} source
 * @param {string} key
 * @returns {ShownAccessNote | null}
 */
export function accessNoteNamed(source, key) {
  const file = /** @type {TrainAccessFile | null} */ (trainFile(source, ACCESS_TRAIN_KEY));
  const entry = file?.access_notes.find((e) => e.key === key);
  return entry ? readable(entry, textLines(/** @type {TrainAccessFile} */ (file))) : null;
}

/**
 * @param {{ text: string }} file
 * @returns {string[]}
 */
const textLines = (file) => file.text.replace(/\r\n/g, "\n").split("\n");

// The Reference URI that stands for `project.md`'s configured tracker as a whole, matched like any
// other (`tracker:` and `tracker:DEMO-` both cover `tracker:DEMO-`), or null with no `tracker.key_pattern`.
// It is `tracker:` plus the literal text every key starts with (`^DEMO-[0-9]+$` gives `tracker:DEMO-`,
// `#[0-9]+` gives `tracker:#`); a pattern with no such text (`[0-9]+`), or one that does not compile,
// stands as `tracker:`, every tracker Reference.
/**
 * @param {unknown} tracker
 * @returns {string | null}
 */
export function trackerUri(tracker) {
  const source = isMap(tracker) ? tracker.key_pattern : undefined;
  if (typeof source !== "string" || !source) return null;
  return `tracker:${compileKeyPattern(source) ? literalPrefix(source) : ""}`;
}

// The literal text every match of the regular expression `source` starts with, read conservatively:
// it stops at the first metacharacter, drops a character a quantifier makes optional or repeatable,
// and is empty for any alternation, whose branches need not share a start.
/**
 * @param {string} source
 * @returns {string}
 */
function literalPrefix(source) {
  if (source.includes("|")) return "";
  let out = "";
  let i = source.startsWith("^") ? 1 : 0;
  while (i < source.length) {
    let ch = source[i];
    let width = 1;
    if (ch === "\\") {
      ch = source[i + 1];
      if (ch === undefined || /[0-9A-Za-z]/.test(ch)) break; // a class (`\d`), a backreference, an escape
      width = 2;
    } else if ("^$.[](){}?*+".includes(ch)) {
      break;
    }
    if ("?*{".includes(source[i + width] ?? "")) break; // this character may not be there at all
    out += ch;
    i += width;
  }
  return out;
}

// A `url:` prefix that stops at its host (`url:https://wiki.loans.example.test`) covers that host only, so a
// credential is never handed to `wiki.loans.example.test.evil.io`; any other prefix is a plain string prefix
// (`tracker:DEMO-` scopes to one tracker project).
const URL_HOST_ONLY = /^url:https?:\/\/[^/?#]+$/;

/**
 * @param {string} prefix
 * @param {string} uri
 * @returns {boolean}
 */
export function covers(prefix, uri) {
  if (!uri.startsWith(prefix)) return false;
  return !URL_HOST_ONLY.test(prefix) || uri.length === prefix.length || /[/:?#]/.test(uri[prefix.length]);
}
