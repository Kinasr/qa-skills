---
name: qa-init
description: Set up or maintain `.qa/project.md` from evidence in the repo.
disable-model-invocation: true
---

# /qa-init

`/qa-init [--add-role <name>]...`

Configure `.qa/project.md` on one numbered Card.

**Run `init state` first** on every path: follow `train` (`train/init.md`) Practices throughout,
read the tracker via `access` (the **Access note**, or `null`), and keep its **Agent pointer**
section for Close.

**Which path.**

- `--add-role <name>` (repeatable): **Add roles**. No scan, no card.
- `.qa/project.md` exists: **Maintain an existing project.md**.
- Otherwise it is the first run: sections 1 to 4.

## Invariants

A Practice that contradicts an Invariant is void.

- **On every path where the command's JSON carries `migration`**, read it first: if `pending`,
  warn using `migrations` in order; continue the command.
- **The tracker is read-only except `/qa-publish`.**
- **Nothing is written until the engineer replies.** Then `init apply` writes, in one write.
- **Only `.qa/project.md`, and a migration the engineer says yes to.** The Automation-key
  declaration and the Agent pointer are reported, never written.
- **Leave git state to the engineer:** never run git to stage or commit yourself; the commit
  follows the project's Commit mode through `scan.mjs commit`, never retried with `--no-verify`.
  A dirty working tree is fine; say nothing about it.
- **Keep credentials with the engineer:** never ask for a credential; ask which connector, CLI or
  variable carries it; its value stays with the engineer.
- **Every answer is the engineer's:** never guess an answer; ask about ambiguity, leave anything
  the Reply does not clearly address open, and never confirm for them.

## The CLI

Run from the repository root (`--root` defaults to `./.qa`, which need not exist yet):

```
node <this skill's directory>/../../scripts/scan.mjs init <state|smoke|card|apply|add-role> ...
```

Commands that read input take it from a file: write it outside the repository (the run dir or your scratch directory) and pass its absolute path as `--input <file>`. Run each command as one plain `node` line, with no pipe, heredoc, `&&` or `;` chain, variable prefix or `cd`.

Each call prints JSON. The first `init smoke` or `init card` makes the run dir (`dir`); pass it as
`--dir` to every later call. The CLI checks the card's digest; omit it from decisions.

## 1. Gather evidence

Build the proposal as [the proposal reference](references/proposal.md) says, including story-only
trackers, optional publish setup and [the four lists](references/labels.md): every detected value
names its source, count and sample (read the tracker via `access`), and unanswered ones are marked
`{"asked": true}`.
Propose `test_runner`, `code_host` and `stack.root` from evidence; list the support directories
beside the tests in `module_paths`, under a root that contains them; ask for unknown values.
Tags publish by opt-in: ask for optional `tracker.tag_field` (a multi-value tracker field or
`labels`), keeping it separate from required publish fields.

## 2. Pick the Tiers

A **Tier** is a weight of model: `deep` for hard judgement, `standard` for filling, `light` for
fetching. Offer labels your harness accepts; an unpicked Tier runs on `inherit`, the session's
model. Smoke-test each other picked label as
[the Tier reference](references/tiers.md) says, then put the picks on the proposal.

## 3. Word the card

Pass the proposal to `init card --input <file> [--dir <run-dir>]`.

- `ok: false`: fix the proposal from evidence or ask the engineer; show marker/Tag and
  destination collisions as Integrity errors before any write, and run `card` again.
- `ok: true`: read [the shared wording rules](../references/wording-rules.md) and word every
  section in order: summary counts, notes, each numbered item (label, value, evidence, allowed
  answers), unnumbered picked Tiers with smoke-test results and fallback, stacks, minting options
  (unsettled ones need the interview), and each file's frontmatter fenced under its path. Word
  `Execution levels` as what its mode does: a `browser` level runs in a browser, an `api` level as
  direct HTTP calls; never `level → mode`. Mark an item needing an answer as a question on its own
  line; its Evidence names only where its value came from, or that nothing was found plus any
  repository hint. When a note flags multiple origins in `target_env`, or `target_env` omits
  another origin's variable, name the omitted variables and say that `target_env` sets every listed
  variable to the Run's origin on every Run, so omitted ones keep the test config's default. Wait
  for the reply.

## 4. Apply decisions

Translate only clear answers into a JSON file, for example:

```json
{"take":"all","drop":[10],"edits":{"5":{"value":"jira"}}}
```

`take` is `"all"` only for explicit whole-Card acceptance, otherwise item numbers. `drop` lists items
left out. `edits` accepts and answers an item: `value` (a string, string array, number, map or list of maps matching
`type`), `stack` (a root from the listed stacks) or `minting` (an option number).
Taking an item showing a suggested value accepts it; an edit wins. An item without a value needs
its answer. Retain clear decisions across clarification turns.

Run `init apply --dir <run-dir> --input <file>`.

- **`ok: true`**: word every section in order (copy a missing Automation-key declaration intact in
  a fenced block; for an unavailable scanner, relay its message and fix; other statuses need nothing
  added). When `commit` is not null, make it as
  [the commit reference](../references/commit.md) says. Then Close.
- **`rebuild: true`**: rebuild, show the new Card and obtain fresh answers; never apply answers
  given before a rebuild.
- **Otherwise** nothing was written. Word `refusals` (including shared guards) from `code` and facts; ask about open
  items. With `cause: repository`, ask them to settle what changed; with `answers`, for different
  answers. Changes to evidence or unsettled minting options return to the interview and a new Card.

## Add roles

Run `init add-role <name>...` with every name, quoting names with spaces. Word every section in
order. When `commit` is not null, make it as [the commit reference](../references/commit.md) says. After
`no_project`, `add_role_check_file` or `project_unreadable`, offer the first run or **Maintain an
existing project.md**, and start the one the engineer picks. Then Close.

## Maintain an existing project.md

On maintenance, nothing changes unless the engineer picks it; a change causing Integrity errors
(knowledge references that no longer resolve) is written only once confirmed. Init never rewrites
knowledge to follow a change, and there is no `--force`.

When the preflight found `pending`, offer to run it first: each `migrations` `command` in order,
as `node <this skill's directory>/../../scripts/scan.mjs <command> [--root <qa-dir>]`, on the
default branch. Run it only on the engineer's yes, report the rewritten files and leave their
commit to the engineer. A no carries on with the warning.

1. **Detect again.** Read the evidence as in section 1: `fields` holds only what you re-read, with
   its evidence, and any Tier the engineer wants changed, picked as in section 2. Show the card as
   in section 3: check errors, current values, and any detected value with evidence and effect. Ask
   each unanswered item: the Reply answers, adopts or drops it.
2. **Apply decisions** as in section 4, naming only the items to change (labels: see the reference):

   ```json
   {"adopt":[3],"drop":[11],"edits":{"16":{"value":2}}}
   ```

   `adopt` takes the detected value. On `confirm: true` nothing was written: word every section in
   order (each change's Integrity errors, unread key annotations and affected-case counts), wait for
   explicit confirmation, then submit the CLI's `decisions` or revise from their answer. `confirm`
   lists confirmed change numbers. Once written, word every section in order, commit as in section 4
   and Close.

## Close

However a path ends, word `init state`'s Agent pointer section: when missing, say to paste its
template intact in a fenced block into the target file (plus any import line into its file); when
present, give one line naming its file and line, showing the template only if asked.

A first run ends on one next step (run it on yes): `/qa-train access` when the target's login has
no Access note (`observe:` needs a role-less one), else `/qa-deep-dive <feature-slug> human:<you>`
or `file:`/`observe:`.

However a path ends, offer `/qa-train init` only for what the engineer taught: a correction they
gave, or a team-specific answer they stated. CLI behaviour, a suspected defect, and your own
inference or generalisation never qualify; with nothing qualifying, make no offer. Offer
`/qa-train access` if init had to ask how to reach the tracker, or its note was `withheld`. On yes,
invoke each.
