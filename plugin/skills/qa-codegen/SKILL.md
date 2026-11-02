---
name: qa-codegen
description: Write one Automation for an uncovered Test Case, prove it with repeated passing runs, and bind it to the case.
disable-model-invocation: true
---

# /qa-codegen

`/qa-codegen [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--stack <root>]`

Writes one Automation per uncovered **Test Case**, in the project's own test code, and binds it with
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

- **Engineer-invoked only.** Never run it from `/qa-execute`; the engineer asks for it. Run it in this conversation, with no subagent and no Tier.
- **One confirm before anything is written.** Wait for the engineer to accept or edit the plan; nothing under `module_paths` changes before then.
- **The CLI steps run in order.** `codegen plan`, then `codegen start`, then `codegen verify`, then `codegen done` or `codegen fail`.
- **Relay CLI text verbatim.** Present the plan, verify and close text exactly as printed.
- **Test code runs only through `codegen verify`.** Never run the project's test command yourself.
- **Never drive the live app.** The Tester guard (ADR-0035) stays the only browser path.
- **Read only** the brief, the files its refs listing names, and a sibling Automation's spec file. Never read `.env*`, auth state, Access notes, or another test file for style.
- **Expected values come only from the case's prose, the Feature Rules, or a Passed Execution's evidence**, never from application source.
- **Locators come from support code, read-only application source, or a Passed Execution's Element evidence**, never from a live page.
- **One case, one Automation.** Never write one Automation for several cases, nor several for one; parameterise only when the case states data variants.
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
node <this skill's directory>/../../scripts/scan.mjs codegen plan [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--stack <root>] [--pr] [--root <qa-dir>]
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

Run `codegen plan [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--stack <root>] [--pr] [--root <qa-dir>]`.

Relay `text` verbatim: it shows the counts, stack, target, mode, the skipped cases' closed reasons
and any Key-prefix proposal. **Wait for the engineer** to accept or edit it. On no, stop.

- **Mode**: working tree by default. `--pr` or `train/codegen.md`'s `pr: always` asks for one commit per item on `qa/codegen/<run-id>`. A dirty Scenario file downgrades the Run to `dirty-knowledge`. An ADR-0012 project refuses `--pr` and downgrades `pr: always` as `external-mint-required`.
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

## 3. Verify

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
test or a new support declaration; the CLI checks the mapping structurally.

`done` requires the tree to equal the passing verify's snapshot, then writes `automates` and keeps
the case's Review fresh. In PR mode it also commits the test, its support files and the Scenario's
`automates` together; the checkout and its index are untouched. Relay `text` verbatim.

- **`regress: true`**: a pre-existing file was touched; go to §5 before preparing a PR.
- **No `automates`**: an ADR-0012 project; tell the engineer to mint with their tool, then `/qa-sync`.

Then ask the engineer to review the diff; make the usual `/qa-train` offer when this run taught code
gen a Convention.

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
