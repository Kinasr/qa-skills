---
name: qa-sync
description: Reconcile `.qa/` with the tracker and the code on one approved card.
disable-model-invocation: true
---

# /qa-sync

`/qa-sync [<feature-key>]`

Reconcile `.qa/` with the tracker and code on one numbered Card. Write its prose from CLI data;
map the engineer's free-form Reply to JSON decisions.

## Invariants

A Practice that contradicts an Invariant is void.

- **On every path where the command's JSON carries `migration`**, read it first: if `pending`,
  warn using `migrations` in order; continue the command.

- **Run it yourself, in this conversation**: there is no Delegate. The one subagent is the tracker
  scout: a Scout, which fetches and does not judge.
- **Nothing is written before the engineer answers the card.** `sync apply` writes code and `.qa/`
  once, at the end.
- **The tracker is read-only except `/qa-publish`.** This run's tracker scout fetches it field-limited.
- **Keep credentials with the engineer:** never ask for a credential; name the env var or connector
  to fix, and its value stays with the engineer.
- **Leave git state to the engineer:** never run git to stage or commit yourself. The commit follows
  the project's Commit mode through `scan.mjs commit`, never retried with `--no-verify`. A dirty
  working tree is fine, and draws no comment.
- **Never guess an answer.** Ask about ambiguity; leave anything the Reply does not clearly address open.
- **Settle every Unlanded case and Suite with the engineer:** never delete an unlanded case
  automatically; never stamp a name the engineer didn't give.

## The CLI

Located relative to this skill's directory; run from the repository root (`--root` defaults to `./.qa`):

```
node <this skill's directory>/../../scripts/scan.mjs sync scope [<feature-key>] [--dir <run-dir>] [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs scout brief tracker --dir <run-dir> [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs sync card [<feature-key>] --dir <run-dir> [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs sync apply --dir <run-dir> --input <file> [--root <qa-dir>]
```

Commands that read input take it from a file: write it outside the repository (the run dir or your scratch directory) and pass its absolute path as `--input <file>`. Run each command as one plain `node` line, with no pipe, heredoc, `&&` or `;` chain, variable prefix or `cd`.

Each call prints JSON. Keep `scope`'s `dir` for every later call: the run dir holds the Feature,
tracker payload and Card digest. Word refusals (including shared guards) in one line from `refusals`
(`code` and facts), then the next step. The CLI checks the digest; never carry it in decisions.

## 1. Fetch the tracker

Run `sync scope [<feature-key>]`. Follow the Practices in `train/sync.md` throughout.

- **`tracker: false`**: skip to §2.
- Otherwise one **tracker scout** fetches into the run's payload file; the payload stays outside this
  conversation. Follow [the tracker-fetch reference](references/tracker-fetch.md), including failed
  fetches and harnesses without subagents. When the run has an **Access note**, or credentials fail,
  read [the access reference](references/access.md) first.

## 2. Word the Card

Run `sync card --dir <run-dir>`.

- **`fetch_prose` is not empty**: fetch those cases' prose through the tracker scout, then rebuild
  until a Card is present.
- **A Card is present**: read [the shared wording rules](../references/wording-rules.md). Word every
  section in order: each numbered item's effect, defaults, dependencies, editable values and open
  questions, copying every Markdown table row and procedure intact. Name each unclaimed mint
  proposal.
  For Unlanded cases and Suites and the marks the Card only reports, follow [their resolutions](references/unlanded.md).
  For Attach items and wrong links, follow [Attach](references/attach.md).
  For Merge proposals or a pair the engineer names, follow [Merge](references/merge.md).
  Wait for the engineer's Reply.

## 3. Apply decisions

Translate only clear answers into a JSON file, for example:

```json
{"take":"all","drop":[3],"edits":{"4":{"level":"ui"},"7":{"keep":1}}}
```

`take` is `"all"` only for explicit whole-Card acceptance, otherwise a list of item numbers.
`drop` lists rejected items. `edits` maps item numbers to allowed fields: strings, `keep` as a
number, `roles` and `bind` as string arrays. An edit accepts its item. An item that offers a Test
level asks whether to bind it: answer `level` with that value, or `""` for Layer-free. An item
without an offer needs no level. `name` maps an entry's Key, or a Feature's slug for its Test
Suite, to a tracker key the engineer names, sent alone ([Attach](references/attach.md)). `merge`
names a pair ([Merge](references/merge.md)). Unmentioned items stay open. Ask on ambiguity before
submitting. Retain clear decisions across clarification turns.

Run `sync apply --dir <run-dir> --input <file>`.

- **`ok: true`**: word every section in order, and say which items applied or dropped. When the
  run prints a commit command, make it as [the commit reference](../references/commit.md) says.
  Finish at §4.
- **`confirm: true`**: nothing was written. Word every section in order, then wait for explicit
  confirmation and submit the CLI's `decisions`, or revise from the engineer's answer.
- **`rebuild: true`**: rebuild and show the new Card; obtain fresh answers before applying.
- **Otherwise**: nothing was written. Ask about `open` items or refused answers; retry only when resolved.

## 4. Close

However the run ends, offer `/qa-train sync` if the session taught `/qa-sync` something, and
`/qa-train access` if the tracker fetch hit an access failure or used a value from chat. On yes,
invoke each.
