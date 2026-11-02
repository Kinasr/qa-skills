---
name: qa-deep-dive
description: Turn tracker issues, files and URLs into a Feature with Rules, settled by interviewing the engineer.
disable-model-invocation: true
---

# /qa-deep-dive

`/qa-deep-dive [<feature-key>] <ref>...`, or `/qa-deep-dive <feature-key> --dir <run-dir>` to resume a
change `/qa-impact` handed off.

Turns References into one **Feature**: narrative prose plus addressable **Rules**, settled by
grilling the engineer, with questions they cannot answer yet parked. This is the only way Rules
enter the knowledge layer.

## Invariants

A Practice that contradicts an Invariant is void.

- **Propose a Dependency from `other_rules` when a Rule rests on another Feature's behaviour.**
  Settle it with the engineer.
- **Before editing an Upstream Rule, show its `dependents` with their Features and statements.**
- **Boundary keys** come from `mint boundary --feature <slug>`. Keep each key stable; withdrawing
  its Boundary moves the key to the Feature's `retired:` list.
- **Before drafting Rules**, read the scope decisions reference and compare each behaviour with the
  Feature's Boundaries.
- **The Impact forecast reads Rules only, never Test Cases.** On an existing Feature, sort the
  current Rules into Changes, May change and Unaffected before any edit, and have the engineer
  confirm it. Never store it: the Rule edits are the record.
- **A `link_unrepaired` link is the engineer's to repair or confirm.** Never confirm for them.
- **Checkpoint 1 is a commit.** Stale obligations are stored only against a commit, and
  `impact persist` refuses uncommitted knowledge.
- **Every source item stays accounted for.** Dropping an inventory entry never retires a Rule.

- **At startup, on every path**, run
  `node <this skill's directory>/../../scripts/scan.mjs migration-status [--root <qa-dir>]`.
  If `pending`, warn using `migrations` in order. Continue the command.

- **Run it yourself, in this conversation.** It is a multi-turn interview, so never hand it (or any
  part of it, fetching included) to a Delegate or a background worker. The one exception is the UI
  scout an `observe:` input sends.
- **One Feature per run.**
- **Require schema 3 for Feature writes.** Relay a `feature` or `check` schema refusal and stop;
  run `migrate-keys` on the default branch before retrying.
- **Mint a new Feature's Suite key with `mint su`.** Keep its `suite_key` on every re-run and rename.
  Deleting a Feature keeps its slug and Suite key in `project.md`'s `retired_features`.
- **Write the Feature, plus any Observation this run made**: `.qa/features/<slug>/<slug>.md`.
  Never edit `project.md`.
- **Write only a draft that passes `deep-dive check`.**
- **Halt on any failed Reference or `observe:` input.** Write no Feature and start no grilling.
  Never continue on a subset: an expired token must not shrink a Feature to half its
  sources.
- **The tracker is read-only except `/qa-publish`.**
- **A `mirror` comes only from a Group-level issue.** A Story, Task, Bug or Epic goes in `sources`.
- **Never write a retired Feature key.** Settle another.
- **Never ask for a credential.** Name the env var or connector to fix; its value stays with the
  engineer.
- **Never answer your own questions.** Answers are the engineer's.
- **A dirty working tree is fine.** Say nothing about it. Never stage or commit.

## The CLI

Every deterministic step goes through the shared CLI, located relative to this skill's own
directory:

```
node <this skill's directory>/../../scripts/scan.mjs deep-dive <action> ... [--root <qa-dir>]
```

`--root` defaults to `./.qa`, so run it from the repository root. Each call prints one JSON object:
read it, and never re-derive its results by grep or prose. The actions:

| Action | What it answers |
|---|---|
| `refs <ref>...` | each Reference as a URI, with a `status`, its Access note (`access`) and `train` |
| `feature <key>` | the Feature key's usability, its Rules with coverage, Waivers, `depends_on` and `dependents`; other Features' live Rules in `other_rules`; Boundaries, `retired`, `sources`, `open_questions`, `openQuestions`, `caseIndex`, scenario files, `roles`, `next_step`, `categories`, `coverage`, `deferred_count`, `deferred_functionality`, `train` |
| `roles <name>...` | which roles `project.roles` lacks, with the command that adds each |
| `amend <key> <rule>...` | the bounded amendment inventory: those Rules in full, the `cases` linked to them, `omitted` counts |
| `reconcile <key> --stdin [--dir <run-dir>]` | the confirmed forecast against the Rule edits: `edited`, `outside_band`, `unedited_changes`, `boundary_check`, `downstream`, `next_feature`, `widened`, `change_file`, `next_step` |
| `resume --dir <run-dir>` | the quick path's handoff: `references`, `edits`, `open_questions`, `written`, the `uncommitted` files, `next_step` |
| `check <key> --stdin [--confirm <link>,...]` | the drafted Feature file: `check-file` plus the re-run rules and Coverage; each retired Rule's `links`; when `ok`, the `changeset`, `commit` and `next_step`, always `coverage_digest` |

**Training.** `train` is `train/deep-dive.md` (`exists`, `text`, `entries`). Read it from the first
call that returns it (`feature` with a key, else `refs`), before any fetch. Follow its Practices to
the close.

## 1. Split the arguments

The first argument is the Feature key if it is a kebab-case slug (`^[a-z0-9]+(-[a-z0-9]+)*$`)
and not a file in the repository. Everything else is a Reference or an
`observe:<url> "<what to look at>"` input, except `--dir <run-dir>` and repeatable `--focus "<verb phrase>"`.
`--focus` names functionalities; apply [the Deferred reference](references/deferred.md) in §4.
With no Reference, `observe:` input or
`--dir`, ask for one and stop.

**A key was given**: run `deep-dive feature <key>` now.

**`--dir <run-dir>`**: run `deep-dive resume --dir <run-dir>` first. Its `references` are the
References to take in (§2, as usual); its `edits` are Rules already edited and confirmed, so they
open the forecast as Changes and are not asked again; `uncommitted` files hold them in the working
tree; its `open_questions` seed the walk. The run dir is the change's: pass `--dir` to
`reconcile` and name it in the close, for `/qa-design`.

## 2. Take in every Reference, and halt on any failure

A Reference is stored in the Feature's `sources` as one of these URIs:

| Kind | URI | Fetched by |
|---|---|---|
| tracker | `tracker:DEMO-1` | the tracker's read-only tools |
| file | `file:docs/import.md` (repo-relative, one file) | reading it |
| code | `code:path/to/ImportTest.kt` (one source file, never a directory) | reading it |
| url | `url:https://…` | fetching it |
| conversation | `human:<name>` | this session: what the engineer settles while you grill |

A live application is never a Reference: `observe:` records it as a `file:` Observation.

0. **`observe:` inputs first.** Read [the observe reference](references/observe.md), and run each
   input to the `file:` URI that replaces it.
1. Run `deep-dive refs <every ref>`. Bare inputs are inferred (`DEMO-1` → `tracker:`, a URL →
   `url:`, a path → `code:` under `module_paths`, else `file:`) and marked `inferred`. Use the
   `uri` it returns, never the raw input.
2. Fetch each reference **to completion** before the next:
   - `pending` (tracker, url): fetch it yourself. A tracker issue is complete with every field, the
     description and every comment, including the `[qa-skills] Parked questions:` comment; note its
     issue type. A linked issue is read only when passed as its own Reference. If its `access` is a
     note, or a fetch fails on credentials, read [the access reference](references/access.md) first.
   - `resolved` (file, code): read the whole file.
   - `conversation` (human): nothing to fetch.
   - `failed`: carry on, so the report is complete.
3. Print **one report** listing every reference with its URI and status (ok, or failed and why).
   A file git does not track carries an `untracked` warning: a fresh clone cannot re-read it.
   Say so here and again at the close (§10); it does not halt the intake.
4. **If any reference or `observe:` input failed, halt here.** Tell the engineer to fix it or
   re-run without it, and print the access reference's hand-off for a failed tracker or url.

## 3. Settle the Feature slug

**No key**: propose a kebab-case slug named for the behaviour, not for the tracker's structure.
Check it with `deep-dive feature <slug>`, and have the engineer confirm or replace it before you go
on.

`status` decides the run:

- `new`: a fresh Feature; run `mint su` now and keep its returned key for the draft.
- `existing`: a re-run that updates the Feature in place (§4).
- `retired`, `succeeded` or `invalid`: unusable. A Retired key is never reused. Show `error` and
  settle another slug.

Keep its `rules`, `boundaries`, `retired`, `sources`, `openQuestions`, `caseIndex` and `roles` as
the state to reconcile against.

## 4. Inventory

On an `existing` Feature, read [the re-run reference](references/re-run.md) before you build. It
holds the pick-up choice for Deferred functionality, then the Impact forecast, and the amendment
mode: when the confirmed forecast names only some Rules and nothing needs a full inventory,
inventory just those and their linked cases with `deep-dive amend`.

For every full inventory, read [the Deferred reference](references/deferred.md): leaving work for
later, focused inventories, existing items' lifecycle, and stating Coverage with its deferred count.

Build the **functionality inventory** from the References, the Observations and, on a re-run, the
whole existing Feature and its `caseIndex`. Read every case's `summary` and Expected-result
paragraph, and the rest only when needed to interpret its claims. List each **functionality** as a
verb phrase, with its evidence (Reference URI and place, Observation fact, unseen part) and
visibility (seen in the app, documented, unseen).

**Reconcile.** Place every behaviour-bearing item, existing Rule, case, Parked question and
previously named functionality, or set it aside with its reason. A duplicate or misreading
disappears with a one-line reason; a genuine exclusion becomes a Boundary (`Owner: none` allowed).
Dropping an entry never retires a Rule.

**Confirm** the inventory as scope: the engineer adds, renames, merges or drops entries.

**Gate.** Every source item is placed or set aside with its reason, and the engineer confirms the
inventory as scope.

## 5. Plan

Show a table of every functionality, including those needing no further input. For each unsettled
behaviour — ambiguous, contradictory or silent, including a Parked question the new References may
answer — name the existing evidence and either a concrete proposed input (a `file:`, `code:`, `url:`
or `tracker:` Reference, or a bounded `observe:` target and request) or "ask the engineer". For
**behaviour ambiguous, contradictory or silent that needs more evidence**, read
[the investigation reference](references/investigation.md); it also gives the question round
format.

Fetch an approved input as §2 fetches any Reference, and re-enter intake under its rules. Approval
covers that input alone. Afterwards show only material deltas: the engineer reconfirms any changed
scope, and a material evidence delta reopens the pair outcomes it affects, whether or not the scope
changed.

An **active observation** is unavailable: settle intent with the engineer or park; it confers no
execution capability.

**Gate.** Every proposed acquisition has one decision — approved input, engineer interview, or
evidence unavailable and settled — and the engineer confirms the plan.

## 6. Walk

Read [the Coverage categories](../references/coverage-categories.md), then walk the `categories`
`deep-dive feature` returns in their order. Walk functionality-major, then reconcile by category
across functionalities, especially permissions, shared state, concurrency and side effects.

Each functionality × category pair ends on one **aggregate disposition**: covered by Rules,
awaiting an answer, or n/a. A pair with any unsettled behaviour is awaiting.

Show a bulk table with the honest acceptance object the engineer reads: each Rule's key and
statement, the evidence located (an Observation's fact number), an n/a's reason naming the
functionality and scope, and every question still open. Only the engineer parks. Bulk acceptance
covers only the proposals displayed; anything unaddressed or ambiguous stays open.

Ask in rounds in the format the investigation reference gives. Drop any question a live Rule
already answers; never re-ask settled behaviour, even when two References still disagree about it.
An Observation's facts are claims of current behaviour: one becomes a Rule only once the engineer
confirms it. A parked question is tagged `[<category key>]` and enters `## Open questions`.

Once the engineer settles something in conversation, add `human:<their name>` to `sources`. Use the
name they already go by in `.qa/` (such as `human:librarian`). If there is none, ask for it once.

**Gate.** Every pair is confirmed; every source item is still accounted for; nothing depends on a
probe; and the draft passes `check`.

## 7. Write the Rules

Write the Rules from the confirmed outcomes, and `## Coverage` from the walk: one line per
effective category in walk order, aggregating `awaiting` > `covered` > `n/a`.

- One Rule per settled behaviour, headed `### rule_<key>: <statement>` under `## Rules`.
- A **Waiver** marks a Rule left without a Test Case: `Waived: <reason>` in the Rule's field block,
  its contiguous lines at the Rule's first non-blank line.
- **The statement carries the whole claim** and stands alone, so that the heading alone is enough
  for the judge to quote. Optional prose may follow a Rule to clarify it, but it never adds a
  claim.
- Mint every new key with `mint rule --feature <slug> --count <n>`, and never invent one. A Rule's
  key never changes.
- State behaviour at intent level. Never put selectors or payload shapes in a Rule.
- A parked question is prose under `## Open questions`, never under a `rule_` heading. It is not a
  claim, so nothing can cover or contradict it.

**Roles.** Run `deep-dive roles <name>...` on every role the Rules name. A `missing` role never
blocks the Feature: the close (§10) reports it with its `commands` entry.

## 8. The Feature file

Read [the Feature file format](references/feature-file.md) before drafting: frontmatter, sections,
Rule field blocks, Boundary owners, the `## Coverage` lines and `coverage_digest`.

## 9. Check, then write

Pipe the complete draft, `## Coverage` included, into `deep-dive check <slug> --stdin`.

- **`ok: false`**: fix every `errors` entry and check again.
- **A `link_unrepaired` error**: a retired or merged-away Rule is still named by a `covers`, Reliance or
  Dependency (`rules.retired[].links`, across Features). Show the engineer each link with its Feature,
  owner and file. Repair it in the file that holds it (a Dependency in the drafted Feature is edited in
  the draft), or have the engineer confirm it and pass its `id` to `--confirm`.
- **`ok: true`**: add its `coverage_digest` to the frontmatter, check again, then write that draft,
  byte for byte, to `path`. Report any `warnings`. A `retired_feature_key` warning means §3 was skipped.
  On an existing Feature, run `deep-dive reconcile` next and settle its lists with the engineer, as
  the re-run reference says.

## 10. Close

Print, in this order:

1. What changed: `rules.added`, `rules.edited` and `rules.retired` (with the cases each retired
   Rule leaves dangling), `sources_added`, the questions parked or cleared, and any missing roles
   with their `/qa-init --add-role` commands.
2. The `changeset`: the Feature and this run's Observations.
3. The suggested `commit`, as a command for the engineer to run from the repository root (the
   directory holding `.qa/`), plus any other untracked `file:` or `code:` References to add with
   it.
4. The `next_step`: a bare `/qa-design <slug>`. Never run it yourself. After Rule edits that reach
   other Features, also `next_feature` with its `summary`, and any `change_file`.
   Checkpoint 1: the commit in item 3 comes first.
5. If this session taught `/qa-deep-dive` something (a correction, or an answer it would otherwise
   ask again), offer `/qa-train deep-dive` and, on yes, invoke it.
