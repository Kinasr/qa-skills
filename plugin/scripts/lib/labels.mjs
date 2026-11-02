// @ts-check
// Labels and glossary pieces supplied as data for model-written Cards (ADR-0024).

/** @type {Record<string, string>} */
export const GLOSSARY = {
  Publish: "sending Test Cases with fresh Reviews to the tracker after the engineer accepts a Card listing the writes",
  Publisher: "the in-session subagent that makes exactly the tracker writes in its brief and records their results in one file of the Run",
  "Unkeyed test": "an Automation in the code that carries no Automation key yet, so nothing in `.qa/` can point at it",
  "Unclaimed Automation": "an Automation that carries an Automation key no Test Case names, so nothing in `.qa/` claims it",
  "Key prefix": "the part of an Automation key that names its test class; the class carries it",
  "Tracker key": "the key a tracker gives a Test Case or Test Scenario, recorded beside it as Bookkeeping and never its Key",
  "Access note": "how to reach a tracker or URL Reference that sits behind a login: its host, where its credential is supplied from, and where a person gets one, never the credential itself",
  Attach: "recording an existing tracker Test Case or Test Scenario as the Tracker key of an entry of the same kind that has none, on an accepted Card; the entry's Key never changes",
  "Mirror refresh": "copying the tracker's current values over the copies `.qa/` keeps of them, never over what `.qa/` owns",
  "Mirrored value": "a tracker value copied into `.qa/` so a disagreement can be seen, never the value that counts",
  "Tracker intake": "adding a Test Case or Test Scenario the tracker holds and `.qa/` does not, as it stands there, unreviewed",
  "Unlanded case": "a tracker Test Case carrying the publish marker that `.qa/` neither holds nor names as a Retired key, reported on the default branch for a person to settle",
  "Unlanded Suite": "a tracker Test Suite whose mark is a live Suite key no Feature holds, and that no Feature names as its Suite, reported on the default branch for a person to settle by Attach, by retiring it by hand, or by a Dismissal",
  Divergence: "a disagreement between `.qa/` and the code or a Mirrored value, for a person to settle",
  "Retired key": "a Key or Tracker key whose concept was merged away or deleted, or a Tracker key attached in error; kept on record and never used again, and never resolving to a live concept",
  "Integrity error": "a reference in `.qa/` that cannot resolve, or does not have the shape its kind takes; unlike a Divergence, one side does not resolve at all, and it is never corrected automatically",
  Verdict: "the judge's answer for one Test Case in one run: Conflict, Stale or Current, where only Current leaves nothing to act on",
  Finding: "a problem raised about a Test Case, or about its Feature when it has no case yet, for a person to settle: a Conflict, a Stale, an Outcome gap, a Divergence or an Overreach",
  Conflict: "a Test Case whose claim cannot hold alongside a current Rule or another Test Case, shown by quoting both sides",
  Stale: "a Test Case something it depends on has changed since it was last judged, with no Conflict found; the case may still be right, and it stays open until a person dismisses it, the case is edited, or a run that saw the change judges it again",
  "Outcome gap": "a Test Case that states no expected outcome, fixed by writing the outcome down",
  Overreach: "knowledge that crosses its Feature's stated scope: a Test Case that covers a Rule its Feature deliberately left without one, a Test Case that checks behaviour a Boundary hands elsewhere, or a Rule that states it; settled by moving the knowledge, withdrawing the Waiver or the Boundary, or a Dismissal",
  "Expected-result paragraph": "the one named part of a Test Case's prose that states the outcome the case expects",
  Watermark: "the commit at which a Feature's Test Cases were last judged: what changed in the Feature since then is what the next run judges",
  Dismissal: "a person's recorded statement that a Finding needs no action, pinned to the commit it was made at; the Finding comes back once the Test Case or the Rule it rests on changes",
  Scan: "the mechanical pass over `.qa/` and the code that finds Integrity errors, Divergences, Outcome gaps and overdue Reviews, with no judge and no judgement",
  Reject: "the review outcome that removes a Test Case outright, open only while it has no Tracker key",
  Review: "a person's recorded statement that they stand behind a Test Case as it is written here, pinned to the text they read; a case with none is normal",
  "Review overdue": "a Test Case whose review date has passed: a reminder only, which never makes a case Stale",
  Tag: "a label from the project's own list that marks a Test Case for selection; never part of the case's claim",
  "Custom field": "a kind of label a project declares for its Test Cases, with a description and allowed values that may be added and retired but never renamed; never part of the case's claim",
  Role: "a named kind of user of the system under test, carried on a Test Case as part of its claim; the project lists which names are legal",
  "Bug draft": "a bug written from a failing Test Case's Execution or a code fix hand-off, held in `.qa/bugs/` until `/qa-publish` creates it in the tracker, then keeping the bug's Tracker key as the record of that link and never edited again; beside the knowledge, never in it, and never carrying a secret",
  Run: "one invocation of a `/qa-*` command, named by a random id",
  Delegate: "the in-session subagent a command hands its judging to, named by its model label alone, or `inherit` for the model already in use; it returns text, and never writes",
  Fallback: "`inherit`, the session's own model, which every project has and which runs a unit whenever the harness refuses its Tier's model; using it is announced, never written back",
  Tier: "one of three weights of model the engineer maps to a model label: `deep`, `standard` or `light`; the framework binds every Delegate and Scout to one",
};

/**
 * A key with its summary or statement, or the bare key when neither is available.
 * @param {string | undefined} [key]
 * @param {string | undefined} [summary]
 * @returns {string}
 */
export const keyLabel = (key, summary) => (summary ? `\`${key}\` (${summary})` : `\`${key}\``);

/**
 * Data provider for summaries lookup.
 * @typedef {{
 *   cases?: { get(key: string): readonly { entry?: { summary?: string } }[] | undefined },
 *   scenarios?: { get(key: string): readonly { file?: { rel?: string, h1?: { text?: string } | null } | null }[] | undefined },
 *   features?: { get(key: string): readonly { file: { rel?: string, h1?: { text?: string } | null } }[] | undefined },
 *   [key: string]: unknown,
 * }} SummariesIndexSource
 */

/**
 * The lookup functions for summaries of keys.
 * @typedef {{
 *   testCase(key?: string): string | undefined,
 *   scenario(key?: string): string | undefined,
 *   feature(key?: string): string | undefined,
 *   rule(key?: string, feature?: string): string | undefined,
 *   boundary(key?: string): string | undefined,
 * }} SummariesLookup
 */

/**
 * Summaries from the scan index; a Rule uses its statement and is unique within its Feature, and
 * so is a Boundary.
 * @param {SummariesIndexSource} index
 * @returns {SummariesLookup}
 */
export function summaries(index) {
  /** @type {Map<string, string> | null} */
  let statements = null;
  /** @type {Map<string, string> | null} */
  let boundaryStatements = null;
  return {
    testCase: (key) => (/** @type {Required<SummariesIndexSource>} */ (index)).cases.get(/** @type {string} */ (key))?.[0]?.entry?.summary,
    // A scenario file's heading, less the key it opens with.
    scenario(key) {
      const text = (/** @type {Required<SummariesIndexSource>} */ (index)).scenarios.get(/** @type {string} */ (key))?.[0]?.file?.h1?.text;
      return text?.startsWith(`${key}: `) ? text.slice((/** @type {string} */ (key)).length + 2) : text;
    },
    feature: (key) => (/** @type {Required<SummariesIndexSource>} */ (index)).features.get(/** @type {string} */ (key))?.[0].file.h1?.text,
    rule(key, feature) {
      const features = (/** @type {Map<string, readonly { file: { rules: readonly { key: string, statement: string }[] } }[]>} */ (index.features));
      if (feature) return features.get(feature)?.[0]?.file.rules.find((rule) => rule.key === key)?.statement;
      if (statements === null) {
        statements = new Map();
        for (const [, decls] of features) for (const r of decls[0].file.rules) if (!statements.has(r.key)) statements.set(r.key, r.statement);
      }
      return statements.get(/** @type {string} */ (key));
    },
    boundary(key) {
      if (boundaryStatements === null) {
        boundaryStatements = new Map();
        for (const [, decls] of (/** @type {Map<string, readonly { file: { boundaries: readonly { key: string, statement: string }[] } }[]>} */ (index.features))) for (const b of decls[0].file.boundaries) if (!boundaryStatements.has(b.key)) boundaryStatements.set(b.key, b.statement);
      }
      return boundaryStatements.get(/** @type {string} */ (key));
    },
  };
}

/**
 * One glossary entry with its explanation.
 * @typedef {{
 *   term: string,
 *   explanation: string,
 * }} GlossaryEntry
 */

/**
 * @param {readonly string[] | ReadonlySet<string>} terms
 * @returns {GlossaryEntry[]}
 */
export const glossaryOf = (terms) => [...new Set(terms)].filter((term) => Object.hasOwn(GLOSSARY, term)).map((term) => ({ term, explanation: GLOSSARY[term] }));

/**
 * @param {SummariesLookup} summaries
 * @param {string | undefined} [key]
 * @param {string | undefined} [feature]
 * @returns {string}
 */
export const labelOf = (summaries, key, feature) => keyLabel(key, summaries.testCase(key) ?? summaries.scenario(key) ?? summaries.feature(key) ?? summaries.rule(key, feature) ?? summaries.boundary(key));

/**
 * Collector for glossary terms.
 * @typedef {{
 *   add(...terms: string[]): void,
 *   pieces(): GlossaryEntry[],
 * }} GlossaryCollector
 */

/**
 * @returns {GlossaryCollector}
 */
export function terms() {
  /** @type {Set<string>} */
  const names = new Set();
  return { add: (...terms) => terms.forEach((term) => names.add(term)), pieces: () => glossaryOf(names) };
}
