---
name: qa-init
description: Set up or maintain `.qa/project.md` from evidence in the repo.
disable-model-invocation: true
---

# /qa-init

`/qa-init [--add-role <name>]...`

Configure `.qa/project.md` on one numbered Card. Write its prose from CLI data; map the engineer's
free-form Reply to JSON decisions.

**After the startup check, run `init state`**, on every path. It prints `train`: `train/init.md` and its entries.
Follow its Practices throughout. It also prints `access`: the **Access note**
for the tracker, or `null`; and `pointer`: the **Agent pointer**, shown at Close.

**Which path.**

- `--add-role <name>` (repeatable): **Add roles**. No scan, no card.
- `.qa/project.md` exists: **Maintain an existing project.md**.
- Otherwise it is the first run: sections 1 to 4.

## Invariants

A Practice that contradicts an Invariant is void.

- **At startup, on every path**, run
  `node <this skill's directory>/../../scripts/scan.mjs migration-status [--root <qa-dir>]`.
  If `pending`, warn using `migrations` in order. Continue the command.

- **Tags publish by opt-in.** Ask for optional `tracker.tag_field`: a multi-value tracker field or
  `labels`. Keep it separate from required publish fields; show marker/Tag and destination
  collisions as Integrity errors before any write.

- **The tracker is read-only except `/qa-publish`.**

- **Propose `test_runner`, `code_host` and `stack.root` from evidence; list the support directories
  beside the tests in `module_paths`, under a root that contains them; ask for unknown values.**

- **Evidence, never a guess.** Every detected value names its source, count and sample;
  ask for values the repo and tracker cannot show.
- **Nothing is written until the engineer replies.** Then `init apply` writes, in one write.
- **Only `.qa/project.md`.** The Automation-key declaration and the Agent pointer are reported,
  never written.
- **A dirty working tree is fine.** Say nothing about it. Never stage or commit.
- **Never ask for a credential.** Ask which connector, CLI or variable carries it; its value stays
  with the engineer.
- **Never guess an answer.** Ask about ambiguity. Leave anything the Reply does not clearly address
  open; never confirm for them.
- **Never apply answers given before a rebuild.** Show the new Card and ask again.
- **On maintenance, nothing changes unless the engineer picks it.** A change that would cause
  Integrity errors (knowledge references that no longer resolve) is written only once they
  confirm it. Init never rewrites knowledge to follow a change. There is no `--force`.

## The CLI

Run from the repository root (`--root` defaults to `./.qa`, which need not exist yet):

```
node <this skill's directory>/../../scripts/scan.mjs init <state|smoke|card|apply|add-role> ...
```

Each call prints JSON. The first `init smoke` or `init card` makes the run dir (`dir`); pass it as
`--dir` to every later call. The CLI checks the card's digest; never carry it in decisions.

## 1. Gather evidence

Build the proposal as [the proposal reference](references/proposal.md) says, including story-only
trackers, optional publish setup and [the four lists](references/labels.md): the evidence for every
value (the tracker is read the way `access` says), and the engineer's answers to what the evidence
cannot show (marked `{"asked": true}`).

## 2. Pick the Tiers

A **Tier** is a weight of model: `deep` for hard judgement, `standard` for filling, `light` for
fetching. Offer labels your harness accepts; an unpicked Tier runs on `inherit`, the session's
model. Smoke-test each other picked label as
[the Tier reference](references/tiers.md) says, then put the picks on the proposal.

## 3. Word the card

Pipe the proposal to `init card --stdin [--dir <run-dir>]`.

- `ok: false`: fix the proposal from the evidence, or ask the engineer, and run `card` again.
- `ok: true`: read [the shared wording rules](../references/wording-rules.md). Present `card`: the
  counts, notes, each numbered item's label, value, evidence and allowed answers,
  `fallback` unnumbered, and each file's `frontmatter` in a fenced block under its path. Mark an
  item with `needs` as a question; list `stacks` and `options` (an option not `settled` needs the
  interview). Wait for the engineer's reply.

## 4. Apply decisions

Translate only clear answers into JSON on stdin, for example:

```json
{"take":"all","drop":[10],"edits":{"5":{"value":"jira"}}}
```

`take` is `"all"` only for explicit whole-Card acceptance, otherwise item numbers. `drop` lists items
left out. `edits` accepts and answers an item: `value` (a string, string array, number, map or list of maps matching
`type`), `stack` (a root from `stacks`) or `minting` (an option number).
Unmentioned items stay open. Ask on ambiguity; retain clear decisions across
clarification turns.

Run `init apply --dir <run-dir> --stdin`. If a shared guard returns `text`, relay that procedural
text intact.

- **`ok: true`**: say what `applied` and `dropped` changed; give `report`: `files`, `commit`
  intact, notes, and `snippet`, the Automation-key carrier's declaration:
  `missing` carries `text` to copy intact in a `fence` block, `unavailable` carries `message` and
  `fix`; other statuses need nothing added. Then Close.
- **`rebuild: true`**: rebuild and show the new Card; obtain fresh answers before applying.
- **Otherwise** nothing was written. Explain `refusals` from `code`, `line` and data; ask about open
  items. With `cause: repository`, ask them to settle what changed; with `answers`, for different
  answers. Changes to evidence or unsettled minting options return to the interview and a new Card.

## Add roles

Run `init add-role <name>...` with every name, quoting names with spaces. Describe `added` and
`already`; copy `commit` intact. After
`no_project`, `add_role_check_file` or `project_unreadable`, offer the first run or **Maintain an
existing project.md**, and start the one the engineer picks. Then Close.

## Maintain an existing project.md

1. **Detect again.** Read the evidence as in section 1: `fields` holds only what you re-read, with
   its evidence, and any Tier the engineer wants changed, picked as in section 2. Show the card as
   in section 3: `check` errors first, each item's `current` value, and where `adopt` is true the
   `detected` value with its evidence and `effect`.
2. **Apply decisions** as in section 4, naming only the items to change (labels: see the reference):

   ```json
   {"adopt":[3],"drop":[11],"edits":{"16":{"value":2}}}
   ```

   `adopt` takes the detected value. On `confirm: true` nothing was written: show every change's
   `errors`, unread key annotations (`words`) and `described` label counts, wait for the engineer's explicit confirmation,
   then submit the CLI's `decisions`, or revise from their answer. `confirm` lists explicitly
   confirmed change numbers. Report `todo`, the Integrity errors the write made. Then Close.

## Close

However a path ends, give `pointer`. `missing`: say to paste `text` intact, in a fenced block, into
`file`; with `import`, also to add its `add` line to its `file`. `present`: one line naming `file:line`;
show `text` only if the engineer asks for the current template.

However a path ends, offer `/qa-train init` if the session taught `/qa-init` something (a
correction, or an answer it would otherwise ask again), and `/qa-train access` if init had to ask
how to reach the tracker, or its note was `withheld`. On yes, invoke each.
