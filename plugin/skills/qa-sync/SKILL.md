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

- **At startup, on every path**, run
  `node <this skill's directory>/../../scripts/scan.mjs migration-status [--root <qa-dir>]`.
  If `pending`, warn using `migrations` in order. Continue the command.

- **Run it yourself, in this conversation**: there is no Delegate. The one subagent is the tracker
  scout: a Scout, which fetches and does not judge.
- **Nothing is written before the engineer answers the card.** `sync apply` writes code and `.qa/`
  once, at the end.
- **The tracker is read-only except `/qa-publish`.** This run's tracker scout fetches it field-limited.
- **Never ask for a credential.** Name the env var or connector to fix; its value stays with the engineer.
- **Never stage or commit.** A dirty working tree is fine; say nothing about it. Give the engineer
  the CLI's commit command.
- `name` maps an entry's Key, or a Feature's slug for its Test Suite, to a tracker key the engineer names, sent alone ([Attach](references/attach.md)).
- **Never guess an answer.** Ask about ambiguity. Leave anything the Reply does not clearly address open.
- **Never delete an Unlanded case automatically.** Never stamp a name the engineer didn't give.

## The CLI

Located relative to this skill's directory; run from the repository root (`--root` defaults to `./.qa`):

```
node <this skill's directory>/../../scripts/scan.mjs sync scope [<feature-key>] [--dir <run-dir>] [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs scout brief tracker --dir <run-dir> [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs sync card [<feature-key>] --dir <run-dir> [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs sync apply --dir <run-dir> --stdin [--root <qa-dir>]
```

Each call prints JSON. Keep `scope`'s `dir` for every later call: the run dir holds the Feature,
tracker payload and Card digest. The CLI checks the digest; never carry it in decisions.

## 1. Fetch the tracker

Run `sync scope [<feature-key>]`. Follow `train`'s Practices throughout. `access` is the
**Access note** the tracker is reached through, or `null`.

- **`tracker: false`**: skip to §2.
- Otherwise one **tracker scout** fetches into `payload_file`; the payload stays outside this
  conversation. Follow [the tracker-fetch reference](references/tracker-fetch.md), including failed
  fetches and harnesses without subagents. If `access` is a note, or credentials fail, read
  [the access reference](references/access.md) first.

## 2. Word the Card

Run `sync card --dir <run-dir>`.

- **`fetch_prose` is not empty**: fetch those cases' prose through the tracker scout, then rebuild
  until `card` is present.
- **`card` is present**: read [the shared wording rules](../references/wording-rules.md). Present
  each section and item: its effect, defaults, dependencies, editable values and open
  questions. Use `fields`, `labels`, `glossary` and `choices`; copy non-null `markdown` and `procedure`
  intact. Identify `unclaimed` mint proposals. Include skipped repairs, notes and Divergences.
  For Unlanded cases and Suites and the marks the Card only reports, follow [their resolutions](references/unlanded.md).
  For Attach items and wrong links, follow [Attach](references/attach.md).
  For Merge proposals or a pair the engineer names, follow [Merge](references/merge.md).
  Wait for the engineer's Reply.

## 3. Apply decisions

Translate only clear answers into JSON on stdin, for example:

```json
{"take":"all","drop":[3],"edits":{"4":{"level":"ui"},"7":{"keep":1}}}
```

`take` is `"all"` only for explicit whole-Card acceptance, otherwise a list of item numbers.
`drop` lists rejected items. `edits` maps item numbers to allowed fields: strings, `keep` as a
number, `roles` and `bind` as string arrays. An edit accepts its item. `merge` names a
pair ([Merge](references/merge.md)). Unmentioned
items stay open. Ask on ambiguity before submitting. Retain clear decisions across clarification turns.

Run `sync apply --dir <run-dir> --stdin`; explain refusal facts using their codes and data.
If a shared guard returns `text`, relay that procedural text intact.

- **`ok: true`**: describe `applied` and `dropped`, minted keys and links, the Keys tracker intake
  wrote (`intaken`), warnings and files from `report`, including its notes; copy its Markdown and
  commit command. Finish at §4.
- **`confirm: true`**: nothing was written. Show every cascaded drop and removed answer. Wait for
  explicit confirmation, then submit the CLI's `decisions`, or revise from the engineer's answer.
- **`rebuild: true`**: rebuild and show the new Card; obtain fresh answers before applying.
- **Otherwise**: nothing was written. Ask about `open` items or refused answers; retry only when resolved.

## 4. Close

However the run ends, offer `/qa-train sync` if the session taught `/qa-sync` something, and
`/qa-train access` if the tracker fetch hit an access failure or used a value from chat. On yes,
invoke each.
