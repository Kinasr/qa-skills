// @ts-check
// The orchestrator's write of one design unit (ADR-0010). It runs the moment a unit's reply is usable (the design contract's `accept`, in
// lib/contracts.mjs), so a fan-out that stops at file 18 of 25 leaves the 17 finished files on
// disk, and a bare re-run fills only the files still empty.
//
// For each case of the reply it mints the `tc_` Key, writes the Delegate's `automatable`, the
// level, the roles, `covers` and `generated: {by: delegate:<label>, at}`, with no `sources` and no `review`, then
// the steps and the Expected-result paragraph, after the file's last line. In every mode the
// new cases are appended: a fill's file was empty, an expand's keeps every case it had, and a
// regenerate's first loses the entries its unit replaces (`replace`: only unreviewed cases with no
// effective Tracker key, chosen when the brief was built), and their Keys go to the Feature's `retired:`. The whole file goes through `check-file` and
// is written only if it passes. The file must still be byte for byte what the unit's brief was
// built from: a file that changed since is never written over, and never loses a case. Before it
// mints or writes anything, the reply's cases are compared with the Feature's stored cases and
// with each other (lib/design-duplicates.mjs): a case that repeats another is refused unless the
// engineer's stated reason says it is a distinct pass. A fill or expand writes the
// reply's other cases; a regenerate refuses the whole reply, since a partial write would delete the
// cases it replaces and write too few in their place.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { refusalLine, repeats, storedCases } from "./design-duplicates.mjs";
import { digest, loadFeature } from "./design-unit.mjs";
import { checkFile, edit, parse } from "./knowledge-file.mjs";
import { proseLines } from "./markdown.mjs";
import { stripListMarker } from "./case-fields.mjs";
import { carriedLabels, labelEntries, mergeLabels, storedLabels, withoutRetired } from "./case-labels.mjs";
import { mint } from "./mint.mjs";
import { backfill } from "./pin-digest.mjs";
import { buildIndex, loadWorkingTree, qaRel, rootConfig } from "./qa-index.mjs";
import { line, role } from "./render.mjs";
import { localDate } from "./scan.mjs";
import { retiredWith, tombstonesOf } from "./tombstones.mjs";

/** @import { EditResult, DesignBrief } from "./design-unit.mjs"; */
/** @import { CaseEntry, ParsedFile as QaFile } from "./knowledge-file.mjs"; */
/** @import { DesignCase, DesignResult } from "./design-contract.mjs"; */
/** @import { Override, Repeat } from "./design-duplicates.mjs"; */

/**
 * The outcome of the write of one unit's usable reply, before the unit's file names it, as design's
 * `report` reads it back: what was appended, what a regenerate replaced, and the refusal when the
 * file changed, is gone, or the write failed (`io`). A proposal-only reply writes nothing and records
 * `awaiting_rules` with the Rules its Delegate proposed.
 * @typedef {object} FillOutcome
 * @property {"awaiting_rules"} [outcome] - the terminal outcome of a proposal-only reply; absent
 *   on every other reply
 * @property {boolean} written - whether the file was written
 * @property {number} cases_written
 * @property {string[]} keys - the minted Keys of the written cases
 * @property {string[]} [not_automatable] - Keys written `automatable: false`
 * @property {string[]} [replaced] - the Keys a regenerate's file lost
 * @property {Array<Omit<Override, "summary"> & { key: string }>} [overridden] - the written cases
 *   that repeat a stored case and the engineer stated why they are a distinct pass, by their minted Key
 * @property {Array<import("./case-labels.mjs").DroppedLabel & { key: string }>} [dropped_labels] - the
 *   labels of the written cases a reply assigned that were dropped, by the Key of their case
 * @property {import("./case-labels.mjs").LostLabel[]} [lost_labels] - the labels of the cases a regenerate
 *   replaced that no regenerated case took: none covers the same Rules, or the Tag or value is retired
 * @property {Repeat[]} [duplicates] - the proposed cases a `duplicate` refusal names
 * @property {import("./design-contract.mjs").DesignProposedRule[]} [proposals] - the Rules an
 *   `awaiting_rules` reply proposed
 * @property {"io" | "missing" | "changed" | "duplicate"} [reason] - why nothing was written
 * @property {string[]} [problems] - the refusal's lines
 */
/**
 * A design Run dir's `<key>.written.json` record: the outcome of the write of one
 * usable reply, alone or beside `scenario` and `file`.
 * @typedef {FillOutcome & { scenario: string, file: string }} WrittenRecord
 */

/**
 * `unit` is the JSON `brief design <key>` printed (a {@link DesignBrief}); `accepted` the usable
 * `check-reply design` result (a {@link DesignResult} of lib/design-contract.mjs); `delegate` the
 * label of the Delegate whose reply it is. A proposal-only reply records `awaiting_rules` and its
 * proposals and writes nothing: no case, no replacement and no retirement. Any other usable reply is
 * written as today. Returns the outcome, also saved as JSON at `written`:
 * `{outcome?, written, file, cases_written, keys, not_automatable?, replaced?, reason?, problems?,
 * proposals?}`, `not_automatable` the keys written `automatable: false`, and `outcome` and
 * `proposals` present only on `awaiting_rules`. It never throws: an exception (an I/O failure, or a
 * fault in the framework) is the refusal `io` like any other, so the attempt's `call` line is still
 * appended. `changed` and `missing` are the only other refusals: what a usable reply holds cannot
 * make the write fail.
 * @param {DesignBrief} unit
 * @param {DesignResult & { cases: DesignCase[] }} accepted
 * @param {{ delegate: string, written?: string | null }} options
 * @returns {WrittenRecord}
 */
export function writeFill(unit, accepted, { delegate, written }) {
  /** @type {FillOutcome | WrittenRecord} */
  let result;
  if (accepted.outcome === "awaiting_rules") {
    result = { outcome: "awaiting_rules", written: false, cases_written: 0, keys: [], proposals: accepted.proposed_rules ?? [] };
  } else {
    try {
      result = fill(unit, accepted, delegate);
    } catch (e) {
      result = { written: false, cases_written: 0, keys: [], reason: "io", problems: [/** @type {Error} */ (e).message] };
    }
  }
  result = /** @type {WrittenRecord} */ ({ scenario: unit.scenario, file: unit.file, ...result });
  try {
    if (written) writeFileSync(written, `${JSON.stringify(result, null, 2)}\n`);
  } catch {
    // The scenario file is the record that matters; `design report` reads the file state too.
  }
  return /** @type {WrittenRecord} */ (result);
}

// The write's one attempt: read the file, retire what a regenerate replaces, mint, append the
// cases, check, and write.
/**
 * @param {DesignBrief} unit
 * @param {DesignResult & { cases: DesignCase[] }} accepted
 * @param {string} delegate
 * @returns {FillOutcome}
 */
function fill(unit, accepted, delegate) {
  /**
   * @param {"io" | "missing" | "changed" | "duplicate"} reason
   * @param {string[]} problems
   * @param {Repeat[]} [duplicates]
   * @returns {FillOutcome}
   */
  const refused = (reason, problems, duplicates) => ({ written: false, cases_written: 0, keys: [], reason, problems, ...(duplicates && { duplicates }) });
  const current = existsSync(unit.path) ? readFileSync(unit.path, "utf8") : null;
  if (current === null) return refused("missing", [`${unit.file} no longer exists`]);
  if (digest(current) !== unit.digest) return refused("changed", [`${unit.file} changed after its brief was built; it is not written over`]);

  const replace = unit.replace ?? [];
  // A case a regenerate replaces is going, so its rewrite is no duplicate of it; every other stored
  // case of the Feature, in any scenario file, is what a proposal is compared with.
  const files = /** @type {QaFile[]} */ (loadWorkingTree(unit.root));
  const { refused: repeated, overridden } = repeats(/** @type {DesignCase[]} */ (accepted.cases), storedCases(files, buildIndex(files), unit.feature, new Set(replace)), unit.overrides);
  if (repeated.length && (unit.mode === "regenerate" || repeated.length === accepted.cases.length)) return refused("duplicate", repeated.map(refusalLine), repeated);
  // The cases written are the reply's, less the repeats refused; `place` maps a case's place in the
  // reply to its place among them.
  const dropped = new Set(repeated.map((r) => r.case));
  const replyCases = /** @type {DesignCase[]} */ (accepted.cases).filter((_, i) => !dropped.has(i + 1));
  const place = (/** @type {number} */ n) => n - 1 - [...dropped].filter((d) => d < n).length;

  const file = /** @type {QaFile} */ (parse(qaRel(unit.root, unit.path), current));
  const { cases: proposals, lost: lostLabels } = keepLabels(unit, file, replyCases, replace);
  // Prepare retirement before minting; the pending Feature entries also reserve Keys.
  const tombstone = replace.length && proposals.length ? retire(unit, file, replace) : null;

  // What a usable reply holds cannot make the rest fail: a fault here is a bug, and `writeFill` records it as `io`.
  const minted = /** @type {import("./mint.mjs").MintedKeys & { error?: string }} */ (mint("tc", { count: proposals.length, root: unit.root, reserved: /** @type {string[]} */ (tombstone?.file.data.retired ?? []) }));
  if (minted.error) throw new Error(`no key could be minted for the cases of ${unit.file}: ${minted.error}`);
  const by = `delegate:${delegate}`;
  const at = localDate();
  /** @type {string[]} */
  const entries = [];
  for (const [i, c] of proposals.entries()) {
    const e = /** @type {{ text: string, error?: string }} */ (renderCase(minted.keys[i], c, { by, at }));
    if (e.error) throw new Error(`a case of ${unit.file} cannot be rendered: ${e.error}`);
    entries.push(e.text);
  }
  // A regenerate's file loses the case entries it replaces, each from its heading to the line
  // before the next heading of level 3 or above, so every other line, every kept case included,
  // stays byte for byte where it was; the new entries go at the end.
  /** @type {EditResult} */
  const out = /** @type {EditResult} */ (entries.length ? edit(file, [...replace.map((key) => ({ remove: key })), ...entries.map((e) => ({ append: e }))]) : { ok: true, text: current, file });
  if (!out.ok) throw new Error(`${unit.file}: ${out.message}`);
  const text = out.text;
  const config = rootConfig(unit.root);
  /** @type {[string, QaFile][]} */
  const checks = [[unit.file, out.file]];
  // A replaced case is gone for good, so its Key (and each former Tracker key it held) goes on the
  // Feature's `retired:` too. The Feature file is written first, so no crash can leave a removed
  // case unrecorded.
  if (tombstone) checks.push([tombstone.file.rel, tombstone.file]);
  for (const [name, f] of checks) {
    const checked = /** @type {import("./design-unit.mjs").CheckFileResult} */ (checkFile(f, config));
    if (!checked.ok) throw new Error(`${name} would not pass its check: ${checked.errors.map((e) => (e.line ? `line ${e.line}: ${e.message}` : e.message)).join("; ")}`);
  }
  if (tombstone) writeFileSync(join(unit.root, tombstone.file.rel), backfill(unit.root, tombstone.file.rel, tombstone.text));
  if (text !== current) writeFileSync(unit.path, backfill(unit.root, unit.file, text));
  const droppedLabels = (accepted.dropped_labels ?? []).filter((d) => !dropped.has(d.case)).map(({ case: n, ...d }) => ({ key: minted.keys[place(n)], ...d }));
  const notAutomatable = minted.keys.filter((_, i) => proposals[i].automatable === false);
  return {
    written: true,
    cases_written: entries.length,
    keys: minted.keys,
    not_automatable: notAutomatable,
    ...(replace.length && { replaced: replace }),
    ...(repeated.length && { duplicates: repeated }),
    ...(droppedLabels.length && { dropped_labels: droppedLabels }),
    ...(lostLabels.length && { lost_labels: lostLabels }),
    ...(overridden.length && { overridden: overridden.map(({ summary: _summary, ...o }) => ({ ...o, key: minted.keys[place(o.case)] })) }),
  };
}

// The cases to write, a regenerate's with the labels the engineer set on the cases they replace: the
// replaced case that covered the same Rules lends its Tags and Custom-field values, and the
// filler's add to them without removing one. A retired Tag or value is not lent to a new case, and a
// replaced case no regenerated case matches loses its labels; both are `lost`, by the replaced Key.
/**
 * @param {DesignBrief} unit
 * @param {QaFile} file
 * @param {DesignCase[]} cases
 * @param {string[]} replace
 * @returns {{ cases: DesignCase[], lost: import("./case-labels.mjs").LostLabel[] }}
 */
function keepLabels(unit, file, cases, replace) {
  if (!replace.length || !unit.labels) return { cases, lost: [] };
  const defs = unit.labels;
  const gone = file.cases.filter((c) => replace.includes(c.key)).map((c) => ({ key: c.key, covers: Array.isArray(c.data.covers) ? /** @type {string[]} */ (c.data.covers) : [], labels: storedLabels(c.data, defs) }));
  const { lent, unmatched } = carriedLabels(gone, cases);
  /** @type {import("./case-labels.mjs").LostLabel[]} */
  const lost = unmatched.flatMap(({ key, labels }) => labelEntries(labels).map((l) => ({ key, ...l, code: /** @type {const} */ ("label_unmatched") })));
  const kept = cases.map((c, i) => {
    const had = lent[i];
    if (had === null) return c;
    const { active, retired } = withoutRetired(had.labels, defs);
    lost.push(...retired.map((l) => ({ key: had.key, ...l, code: /** @type {const} */ ("label_retired") })));
    const merged = mergeLabels(active, { tags: c.tags ?? [], values: c.custom ?? {} }, defs);
    const { tags: _tags, custom: _custom, ...rest } = c;
    return { ...rest, ...(merged.tags.length && { tags: merged.tags }), ...(Object.keys(merged.values).length && { custom: merged.values }) };
  });
  return { cases: kept, lost };
}

// The Feature file with `replace` (Keys of `scenario`'s cases) added to its `retired:`: `{text, file}`.
/**
 * @param {DesignBrief} unit
 * @param {QaFile} scenario
 * @param {string[]} replace
 * @returns {EditResult}
 */
function retire(unit, scenario, replace) {
  // The frontmatter `feature:` was validated by the check the file passed when the brief was built.
  const slug = /** @type {string} */ (scenario.data.feature);
  const featureFile = loadFeature(unit.root, slug).feature;
  if (!featureFile) throw new Error(`${unit.file} names Feature \`${slug}\`, which no file declares, so it cannot keep the Retired keys`);
  /** @type {string[]} */
  const added = replace.flatMap((key) => /** @type {string[]} */ (tombstonesOf(key, scenario.cases.find((c) => c.key === key)?.data)));
  /** @type {EditResult} */
  const out = /** @type {EditResult} */ (edit(featureFile, [{ set: { retired: retiredWith(featureFile.data.retired, added) } }]));
  if (!out.ok) throw new Error(`${featureFile.rel}: ${out.message}`);
  return out;
}

/**
 * One Test Case entry: heading, block, then the labelled paragraphs. `{text}`, or `{error}` for a
 * value the YAML dialect cannot hold. A usable reply's levels, roles and covers were all read from
 * the dialect, so a refusal here, or from `check-file` below it, is a bug to report, not a reply to
 * retry.
 * @param {string} key
 * @param {DesignCase} c
 * @param {{ by: string, at: string }} options
 * @returns {{ text: string, error?: undefined } | { error: string, text?: undefined }}
 */
function renderCase(key, c, { by, at }) {
  /** @type {Array<[string, unknown]>} */
  const fields = [
    ["key", key],
    ["automatable", c.automatable],
    ["level", c.level],
    ...(c.roles.length ? [/** @type {[string, unknown]} */ (["roles", c.roles])] : []),
    ["covers", c.covers],
    ...(c.relies_on?.length ? [/** @type {[string, unknown]} */ (["relies_on", c.relies_on])] : []),
    ...(c.tags?.length ? [/** @type {[string, unknown]} */ (["tags", c.tags])] : []),
    ...Object.entries(c.custom ?? {}),
    ["generated", { by, at }],
  ];
  /** @type {string[]} */
  const block = [];
  for (const [field, value] of fields) {
    const r = /** @type {import("./render.mjs").RenderLineResult} */ (line(field, value, field === "roles" ? { item: role } : {}));
    if (r.error) return r;
    block.push(/** @type {string} */ (r.text));
  }
  /** @type {string[]} */
  const prose = [];
  if (c.preconditions?.length) prose.push("**Preconditions.**", "", ...c.preconditions.map((s) => `- ${stripListMarker(s).replace(/\s+/g, " ")}`), "");
  if (c.steps) prose.push("**Steps.**", "", ...c.steps.map((s, i) => `${i + 1}. ${stripListMarker(s).replace(/\s+/g, " ")}`), "");
  prose.push("**Expected result.**", "", .../** @type {string[]} */ (proseLines(c.expected)));
  return { text: [`### ${key}: ${c.summary.replace(/\s+/g, " ")}`, "", "```yaml", ...block, "```", "", ...prose].join("\n") };
}
