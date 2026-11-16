---
name: qa-codegen
description: Write one Automation for an uncovered Test Case, prove it with repeated passing runs, and bind it to the case.
disable-model-invocation: true
---

# /qa-codegen

`/qa-codegen [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--stack <root>]`

Writes one Automation per uncovered **Test level** of a **Test Case**, in the project's own test code, and binds it with
a Key carrier and the case's `automates`. It follows the Conventions `/qa-train codegen` learned,
proves the test with repeated passing runs through the project's `test_runner`, and leaves the edits
in your working tree unless a PR was asked for. With no scope it targets every Automation gap in the
live universe.

`<scope>` is execute's: Case, Scenario, Suite, Feature or Tracker keys. Tags and Test levels match
exact names: any-of within each kind, AND across kinds. `--stack` is optional and must name
`project.stack.root`.

## Invariants

A Practice that contradicts an Invariant is void.

- **At startup, on every path**, run
  `node <this skill's directory>/../../scripts/scan.mjs migration-status [--root <qa-dir>]`.
  If `pending`, warn using `migrations` in order. Continue the command.

- **Code gen stops until its stack is trained** (ADR-0049). When `train/codegen.md`'s `trained_stacks` lacks `project.stack.root`, offer `/qa-train codegen --stack <root>` once `codegen plan` passes, before relaying it: on yes run it here, then plan again; on no stop.
- **Engineer-invoked only.** Never run it from `/qa-execute`; the engineer asks for it. Run it in this conversation, with no subagent and no Tier.
- **One confirm before anything is written.** Wait for the engineer to accept or edit the plan; nothing under `module_paths` changes before then.
- **The CLI steps run in order.** `codegen plan`, then `codegen start`, then `codegen verify`, then `codegen done` or `codegen fail`.
- **Relay CLI text verbatim.** Present the plan, verify and close text exactly as printed.
- **Test code runs only through `codegen verify`.** Never run the project's test command yourself.
- **Never drive the live app.** The Tester guard (ADR-0035) stays the only browser path.
- **Read only** selected cases and Training to choose a Layer-free approach before planning; then the brief, the files its refs listing names, and a sibling Automation's spec file. Never read `.env*`, auth state, Access notes, or another test file for style.
- **Expected values come only from the case's prose, the Feature Rules, or a Passed Execution's evidence**, never from application source.
- **Locators come from support code, read-only application source, or a Passed Execution's Element evidence**, never from a live page.
- **In Element evidence, `<typed>` can mask a word of a control's own label or placeholder**; never read the mask as an empty or wrong field.
- **One case per Automation.** Write one per uncovered bound level; parameterise only when the case states data variants.
- **Never invert the pyramid.** A Practice that inverts it is void.
- **Full UI with API support** needs a reason in the choice or a Practice that moves the threshold.
- **Never add a skip, focus, `fixme`, `@Disabled`, assumption, fixed sleep, retry or longer timeout.**
- **Never edit `.qa/`, the tracker or Training.** The CLI writes the case's `automates` at `done`.
- **Never stage or commit.** Only the CLI commits, one item at a time; you run only the push and PR commands it prints.
- **PR mode is on request.** Edits stay in the working tree unless `--pr` or `train/codegen.md`'s `pr: always` asks for a PR. In PR mode, run `codegen regress` before `pr-prepare`, then `pr-record`. A dirty Scenario file downgrades the Run to `dirty-knowledge`; a dirty `module_paths` path the item touches fails `dirty`.
- **An ADR-0012 project runs in the working tree.** Its own tool mints the key: the CLI writes the tracker-key carrier, you mint, then `/qa-sync`, and PR mode is refused as `external-mint-required`. Losing the file before minting loses the work.
- **A failed item's `draft.patch` is its only copy.** Name it in the close; never write the draft again yourself.
- **Never ask for a secret.** Never read, write or repeat a credential.

## The CLI

Run from the repository root (`--root` defaults to `./.qa`); each call prints one JSON object:

```
node <this skill's directory>/../../scripts/scan.mjs codegen plan [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--stack <root>] [--choices <json>] [--pr] [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs codegen start --dir <run-dir>
node <this skill's directory>/../../scripts/scan.mjs codegen verify --dir <run-dir> --item <id> --hypothesis <line>
node <this skill's directory>/../../scripts/scan.mjs codegen done --dir <run-dir> --item <id> --expects <json>
node <this skill's directory>/../../scripts/scan.mjs codegen regress --dir <run-dir>
node <this skill's directory>/../../scripts/scan.mjs codegen fail --dir <run-dir> --item <id> --reason <reason> [--cnv <key>]
node <this skill's directory>/../../scripts/scan.mjs codegen pr-prepare --dir <run-dir>
node <this skill's directory>/../../scripts/scan.mjs codegen pr-record --dir <run-dir> (--url <url> | --pushed --error <reason> | --error <reason>)
```

**`ok: false`** on any call: explain the refusal's `line` and stop, copying `next` intact.

## 1. Plan

For each Layer-free case, choose the lowest approach observing every Expected result: API, mocked UI, then full UI for a live end-to-end claim. Prepare UI state through the API where supported. Pass `--choices` as a JSON object keyed by case Key, each value `{level, approach, reason, practice?}`; approach is `api`, `mocked-ui` or `full-ui`. Run `codegen plan` with the engineer's arguments exactly as given: a scope Key exempts its case from `unreviewed`, so add none. To narrow, ask the engineer or rely on the `other-level` skip. Relay `text` verbatim: counts, stack, target, mode and skipped cases. **Wait for the engineer** to accept or edit it. On no, stop.

- **`spanning_targets`**: run each named per-target command with the same `--choices`, without asking again.

- **Mode**: PR mode commits one item at a time on `qa/codegen/<run-id>`.
- **`prefixes` non-empty**: show each proposed prefix. Use the accepted or edited one for a new class or file; the first verify pins it when the test carries none.
- **No `dir`**: every selected case is skipped; relay the refusal and stop.

## 2. Start

For each item, in plan order, run `codegen start --dir <dir>` and read the file at `brief`. It holds
the pinned case, the Expected sentences to map, the Feature Rules, a Passed Execution's evidence,
the Conventions and Practices, and the only files you may read. A resumed start rolls the interrupted
item's partial test back before retrying it, and it re-checks every Convention `ref`, refusing before
touching the item when one no longer resolves.

Write exactly one new test under `module_paths`, following the Conventions. Leave it unkeyed: the
first verify mints its Automation key and renders the carrier, or, under ADR-0012, writes the
tracker-key carrier and leaves the test for your tool.

A case whose outcome would pass with its precondition false asserts the precondition first, such as a
signed-in case checking that the user menu shows. An outcome that already proves it needs no
assertion.

## 3. Verify

Before the first verify, check the test against every Convention the brief lists: verify repeats it `codegen_repeats` times, so a breach does its harm that many times. A test that changes an account's state, a failed sign-in included, uses the fixture the Conventions name for that. Rewrite it to meet each one; if it cannot, fail the item `convention-conflict` with that Convention's key, unverified and unbound.

Run `codegen verify --item <id> --hypothesis "<one line stating what the test checks>"`. It runs the
test through `project.test_runner`, retries 0, for `codegen_repeats` consecutive passing runs with
every instance passing and none skipped.

- **`passed: true`**: go to §4.
- **`passed: false`**: read `diagnostics`, edit the test, and verify again. Count the cycles the CLI
  reports; at `cap-reached`, the item fails with its `draft.patch`.
- **`ok: false`**: the tree edits or the brief are wrong; explain the refusal and correct it. A dirty
  `module_paths` path the item touches fails it `dirty` and restores your own edit.

## 4. Done

Map every Expected sentence to the lines that check it: `codegen done --item <id> --expects
'{"e1": ["<file>:<line>"]}'`. Each line is an added, non-comment, non-import line inside the new
test or a new support declaration. At least one mapped line per sentence must belong to an
assertion statement; when `done` refuses the `--expects` mapping, nothing is recorded and `done`
can be retried with a corrected mapping.

Every mapped line must fail if its sentence is false, an empty or missing compared value included: a
sentence about an error asserts an error is present and what it says, not only that two values
match. `--expects` checks the mapping structurally, never the meaning. A line that would not fail
means changing the test and verifying it again before `done`.

When an edit since the check changed the test, check it again against the Conventions before `done`.

`done` requires the tree to equal the passing verify's snapshot, then writes `automates` and keeps
the case's Review fresh. In PR mode it also commits the test, its support files and the Scenario's
`automates` together; the checkout and its index are untouched. Relay `text` verbatim.

- **`regress: true`**: a pre-existing file was touched; go to §5 before preparing a PR.
- **No `automates`**: an ADR-0012 project; tell the engineer to mint with their tool, then `/qa-sync`.

Then ask the engineer to review the diff; make the usual `/qa-train` offer when this run taught code
gen a Convention. Name any fact about the application you learned while writing the test that the
Feature does not hold, and hand it to `/qa-deep-dive`.

## 5. Regress

When a done item reports `regress: true`, run `codegen regress --dir <dir>` before `pr-prepare`, and
in the working tree before the close. It rechecks the Automations in the touched files and the
support dependents; a regression rolls the item back, restoring its test files and its Scenario's
`automates` together, and rebuilds the surviving commits. Relay its `text` verbatim.

## 6. Pull request

In PR mode, after a passing regress when one was needed, run `codegen pr-prepare --dir <dir>`. It
points `qa/codegen/<run-id>` at the last commit, restores the working tree, and prints the exact
`git push` and `gh pr create`/`glab mr create` commands. Run only those commands, then
`codegen pr-record --dir <dir> --url <url>` (or `--pushed --error <reason>`, or `--error <reason>`).
Relay the scrubbed `text` verbatim. A failed push leaves the branch local.

## 7. Fail

When an item cannot be finished, run `codegen fail --item <id> --reason <reason>`, with `--cnv <key>`
for `convention-conflict`. The reason is one of `cap-reached`, `out-of-scope`, `blocked`,
`app-disagrees`, `case-wrong`, `not-expressible`, `convention-conflict`, `invalid-key-prefix`,
`no-auth`, `dirty`, `regressed`. It keeps the unverified work as a scrubbed `draft.patch` in the Run
dir and restores every path the item changed, so no partial test remains. Relay `text` verbatim and
name its one next step:

- `app-disagrees`: `/qa-execute <case>`;
- `case-wrong` or `not-expressible`: `/qa-design <feature>`;
- `convention-conflict`: `/qa-train codegen`;
- `blocked` or `no-auth`: the refusal the verify or brief named.
