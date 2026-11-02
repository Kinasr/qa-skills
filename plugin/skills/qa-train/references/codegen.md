# Codegen

`/qa-train codegen` writes `.qa/train/codegen.md`: the Conventions the code-generation command
follows when it writes a test, and its Practices. It is the only writer (ADR-0015), and code gen
reads the whole file before it writes anything.

This page covers two branches. The **code-evidence branch** samples the project's test code once:
`train evidence codegen --from-code` when the stack is untrained, `... <path>...` for named
exemplars, or `... --relearn [--facet <facet>[,<facet>]]` to relearn. The **conversation branch** is
everything else: the evidence is the engineer's answers, used for a greenfield stack or an answer
they dictate.

## Read the evidence

On the code-evidence branch, read `sample.files` in the order the CLI returns it: runner config;
named exemplars and their support; the five highest in-degree support files; up to twelve sampled
tests, at most three per directory, preferring files with Automation keys; then remaining support.
The sample is bounded to 200 KB, with each file capped at 20 KB (imports, class or describe header,
hooks, first three tests). Every cut is in `sample.truncated`, and the sample's text is scrubbed.

Read `corpus` for the CLI-computed counts: files per directory, Key-carrier form and position,
test-name patterns, and the support import graph. Read `gate` before proposing:

- a `corpus` label `X/N` is a CLI-computed count over all test files; `sampled` counts `x/k` over
  the sampled text;
- `choice: true` makes the facet the engineer's: `exemplar-disagrees` recommends the exemplar's
  `recommended` value, and `below-80` means the leading pattern holds in under 80% of observed
  files;
- `counter_examples` name the files that disagree;
- a `signal` is present only when the facet maps to one deterministic value: write it verbatim.

On the conversation branch, run `evidence codegen` and read the whole file it returns. Its `train`
holds:

- `pr`, `trained_stacks`, `codegen_repeats` and `codegen_attempts`, with their defaults when absent;
- `conventions`, each with its `stack`, `facet`, `refs` and `signal`;
- `practices`.

`stack` is the project's one stack root. Write it as each Convention's `stack:` and as the entry in
`trained_stacks`; never invent a root. Read the code-generation command's own skill before the gate,
as the Practices reference says, so no Practice contradicts its Invariants.

## A trained stack

A stack is trained only when every one of these twelve facets has at least one Convention for it:

`placement`, `structure`, `test-naming`, `key-carrier`, `interaction-layer`, `addressing`,
`fixtures`, `test-data`, `helpers`, `waits`, `assertions`, `imports`.

Ask about every facet the file does not cover. For each, take one of three answers, never "follow
the nearest file":

- the project has a rule: write it as a Convention;
- it has none: an **explicit negative** ("inline locators, no page objects");
- the stack's own default: say it as such ("no project wrapper: use standard `<stack>` idioms
  directly").

Add the stack root to `trained_stacks` only after the last facet is settled. A draft that names a
stack before then is refused by `train check`. Practices never name a runner or a verification
command: how a generated test is run and proved is the CLI's step, and a Practice covers only how
the agent works.

## Derive proposals

Every Convention carries:

- a **statement** about the form of the code: placement, naming, structure, fixtures, locators,
  waits, assertions or imports. It names no part of the system under test;
- **sources**: `human:<name>` for an answer, or `code:<path>#L<line>@<sha7>` when the project's test
  code is the evidence. `train check` validates the syntax only;
- one **minimal fenced example**. A **prohibition** ("never …") also carries an **anti-example**,
  marked as the wrong form;
- **refs** for the support paths it points at, a repository-relative path under `module_paths`. In a
  non-greenfield stack every `placement` Convention carries its test directory as a ref; in
  greenfield a ref may be a path under the existing stack root. A dead ref is refused, because a
  Convention must not point at nothing;
- a **signal** only on `placement`, `key-carrier` and `test-naming`, when the answer is one
  deterministic value: `{id: placement-dir | key-carrier | test-naming, value: <string>, corpus:
  "X/N"}`.

A statement that claims how the system behaves is a Rule: refuse it and hand it to
`/qa-deep-dive <feature-key>`. A selector, URL or value literal about the system is refused with
"page facts live in the test code", with no hand-off. The Statability Test reads the statement and
rationale; `refs` are paths and stay out of it.

A Practice covers workflow and interaction only: what to ask, what to read, when to create a shared
fixture. It never names a runner or a verification command, and it never becomes a Convention.


## Relearn and repair

Read `upkeep` and `citation_context` at the gate. For a moved ref, use the CLI's current path and declaration listing to choose its replacement. Settle each warning; keep drift and broken citations visible when unresolved.

On `--relearn`, present `gate.relearn` in order, comparing each Convention's existing `entry` with the sample. For every facet offer keep, replace under the same `cnv_` key, add, or remove. Recommend keep only when `proposal` says keep. Surface every `flags` entry, including unreachable citation commits and changed cited files. On a confirmed keep, write its `keep.sources` and `keep.signal`; an unmatched citation remains flagged and unchanged. Settle every facet before drafting.
