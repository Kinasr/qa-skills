---
name: qa-codegen
description: Write one Automation for an uncovered Test Case, prove it with repeated passing runs, and bind it to the case.
disable-model-invocation: true
---

# /qa-codegen

`/qa-codegen [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--stack <root>]`

Writes one Automation per uncovered **Test level** of a **Test Case**, in the project's own test code, and binds it with
a Key carrier and the case's `automates`. It follows the Conventions `/qa-train codegen` learned and
proves the test with repeated passing runs through the project's `test_runner`. With no scope it
targets every Automation gap in the live universe.

`<scope>` is execute's: Case, Scenario, Suite, Feature or Tracker keys. Tags and Test levels match
exact names: any-of within each kind, AND across kinds. `--stack` is optional and must name
`project.stack.root`.

## Invariants

A Practice that contradicts an Invariant is void.

- **On every path where the command's JSON carries `migration`**, read it first: if `pending`,
  warn using `migrations` in order; continue the command.

- **Engineer-invoked only.** Never run it from `/qa-execute`; the engineer asks for it. Run it in this conversation, with no subagent and no Tier.
- **One confirm before anything is written.** Wait for the engineer to accept or edit the plan; nothing under `module_paths` changes before then.
- **Test code runs only through `codegen verify`.** Never run the project's test command yourself.
- **Prove behaviour from the test code alone:** never drive the live app; the Tester guard is the only browser path.
- **Expected values come only from the case's prose, the Feature Rules, or a Passed Execution's evidence**, never from application source.
- **Locators come from support code, read-only application source, or a Passed Execution's Element evidence**, never from a live page.
- **One case per Automation; edit no existing test.** Write one per uncovered bound level; parameterise only when the case states data variants.
- **Write a plain passing test: never add a skip, focus, `fixme`, `@Disabled`, assumption, fixed sleep, retry or longer timeout.**
- **Write only test code under `module_paths`:** never edit `.qa/`, the tracker or Training. The CLI writes the case's `automates` at `done`.
- **Only the CLI commits**, one item at a time; you run only the push and PR commands it prints and never stage or commit.
- **A failed item's `draft.patch` is its only copy.** Name it in the close; never write the draft again yourself.
- **Keep credentials with the engineer:** never read `.env*`, auth state or Access notes, never ask for a secret, or read, write or repeat a credential.

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

**`ok: false`**: word the refusal from `code` and facts and stop, copying `next` intact.

## 1. Plan

Read only the selected cases and Training to choose a Layer-free approach before planning. Choose the
lowest approach that observes every Expected result — API, mocked UI, then full UI for a live
end-to-end claim — and full UI with API support needs a reason in the choice or a Practice that moves
the threshold; never invert the pyramid, since a Practice that does is void. Prepare UI state through
the API where supported. Pass `--choices` as a JSON object keyed by case Key, each value `{level,
approach, reason, practice?}`; approach is `api`, `mocked-ui` or `full-ui`. The CLI steps run in
order, one item at a time: `codegen plan`, then `codegen start`, then `codegen verify`, then `codegen
done` or `codegen fail`. Run `codegen plan` with the engineer's arguments exactly as given: a scope
Key exempts its case from `unreviewed`, so add none. To narrow, ask the engineer or rely on the
`other-level` skip. Word every section in order, copying each table row and command intact. Show each
proposed Key prefix and use the accepted or edited one for a new class or file; the first verify pins
it when the test carries none. **Wait for the engineer** to accept or edit it. On no, stop.

- **Code gen stops until its stack is trained.** When `train/codegen.md`'s `trained_stacks` lacks `project.stack.root`, offer `/qa-train codegen --stack <root>` once `codegen plan` passes, before relaying it: on yes run it here, then plan again; on no stop.
- **A `spanning_targets` refusal**: run each named per-target command with the same `--choices`, without asking again.
- **A dirty Scenario file** downgrades the Run to working-tree mode.
- **No run dir**: word the refusal and stop.

## 2. Start

For each item, in plan order, run `codegen start --dir <dir>` and read the file at `brief`. It holds
the pinned case, the Expected sentences to map, the Feature Rules, a Passed Execution's evidence,
the Conventions and Practices, and the only files you may read: the brief, the files its refs
listing names, and a sibling Automation's spec file. A resumed start rolls the interrupted
item's partial test back before retrying it, and re-checks every Convention `ref`, refusing before
touching the item when one no longer resolves.

Write exactly one new test under `module_paths`, following the Conventions. Leave it unkeyed: the
first verify mints its Automation key and renders the carrier, or, on a project whose own tool mints
keys, writes the tracker-key carrier and leaves the test for your tool.

- **A project whose own tool mints Automation keys runs in the working tree**: the CLI writes the tracker-key carrier, you mint, then `/qa-sync`; PR mode is refused, and losing the file before minting loses the work.

Never read another test file for style.

In Element evidence, `<typed>` can mask a word of a control's own label or placeholder; never read the
mask as an empty or wrong field.

A case whose outcome would pass with its precondition false asserts the precondition first, such as a
signed-in case checking that the user menu shows. An outcome that already proves it needs no
assertion.

## 3. Verify

Before the first verify, check the test against every Convention the brief lists: verify repeats it `codegen_repeats` times, so a breach does its harm that many times. A test that changes an account's state, a failed sign-in included, uses the fixture the Conventions name for that. Rewrite it to meet each one; if it cannot, fail the item `convention-conflict` with that Convention's key, unverified and unbound.

Run `codegen verify --item <id> --hypothesis "<one line stating what the test checks>"`. It runs the
test through `project.test_runner`, retries 0, for `codegen_repeats` consecutive passing runs with
every instance passing and none skipped. Word its section.

- **`passed: true`**: go to §4.
- **`passed: false`**: read its diagnostics, edit the test, and verify again. Count the cycles the CLI
  reports; at `cap-reached`, the item fails with its `draft.patch`.
- **`ok: false`**: the tree edits or the brief are wrong; word the refusal and correct it. A dirty
  `module_paths` path the item touches fails it `dirty` and restores your own edit.

## 4. Done

Map every Expected sentence to the lines that check it: `codegen done --item <id> --expects
'{"e1": ["<file>:<line>"]}'`. Each line is an added, non-comment, non-import line inside the new
test or a new support declaration, with at least one assertion line per sentence.

Every mapped line must fail if its sentence is false, an empty or missing compared value included: a
sentence about an error asserts an error is present and what it says, not only that two values
match. `--expects` is stored unchecked. A line that would not fail means changing the test and
verifying it again before `done`.

When an edit since the check changed the test, check it again against the Conventions before `done`.

`done` requires the tree to equal the passing verify's snapshot, then writes `automates` and keeps
the case's Review fresh. In PR mode it also commits the test, its support files and the Scenario's
`automates` together; the checkout and its index are untouched. Word its section.

- **`regress: true`**: a pre-existing file was touched; go to §5 before preparing a PR.
- **No `automates`**: a project whose own tool mints keys; tell the engineer to mint with their tool, then `/qa-sync`.

Then ask the engineer to review the diff; make the usual `/qa-train` offer when this run taught code
gen a Convention. Name any fact about the application you learned while writing the test that the
Feature does not hold, and hand it to `/qa-deep-dive`: offer it once; run it on yes.

## 5. Regress

When a done item reports `regress: true`, run `codegen regress` before `pr-prepare`, in the working
tree before the close, as `codegen regress --dir <dir>`. It rechecks the Automations in the touched
files and the support dependents; a regression rolls the item back, restoring its test files and its
Scenario's `automates` together, and rebuilds the surviving commits. On a failed check, review the
run dir and fix the touched support code. Word its section.

## 6. Pull request

PR mode is on request: edits stay in the working tree unless `--pr` or `train/codegen.md`'s
`pr: always` asks for a PR, and it commits one item at a time on `qa/codegen/<run-id>`. After a
passing regress when one was needed, run `codegen pr-prepare --dir <dir>`: it points the branch at
the last commit, restores the working tree, and prints the exact `git push` and `gh pr create`/`glab
mr create` commands. Run only those commands, then `codegen pr-record --dir <dir> --url <url>` (or
`--pushed --error <reason>`, or `--error <reason>`). Word its section. A failed push leaves the branch
local.

## 7. Fail

When an item cannot be finished, run `codegen fail --item <id> --reason <reason>`, with `--cnv <key>`
for `convention-conflict`. The reason is one of `cap-reached`, `out-of-scope`, `blocked`,
`app-disagrees`, `case-wrong`, `not-expressible`, `convention-conflict`, `invalid-key-prefix`,
`no-auth`, `dirty`, `regressed`. It keeps the unverified work as a scrubbed `draft.patch` and
restores every path the item changed, so no partial test remains. Word its section. Name its one next
step:

- `app-disagrees`: `/qa-execute <case>`;
- `case-wrong` or `not-expressible`: `/qa-design <feature>`;
- `convention-conflict`: `/qa-train codegen`;
- `blocked` or `no-auth`: the refusal the verify or brief named.
