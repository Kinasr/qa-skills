---
name: qa-deep-dive
description: Turn tracker issues, files and URLs into a Feature with Rules, settled by interviewing the engineer.
disable-model-invocation: true
---

# /qa-deep-dive

`/qa-deep-dive [<feature-key>] <ref>...`, or `/qa-deep-dive <feature-key> --dir <run-dir>` to resume a
change `/qa-impact` handed off.

Turns References into one **Feature**: narrative prose plus addressable **Rules**, settled by
grilling the engineer, who parks what they cannot answer yet. Only this command adds Rules to
the knowledge layer.

## Invariants

A Practice that contradicts an Invariant is void.

- **On every path where the command's JSON carries `migration`**, read it first: if `pending`,
  warn using `migrations` in order; continue the command.
- **Run it yourself, in this conversation.** It is a multi-turn interview, so keep every step
  (fetching included) here rather than handing it to a Delegate or background worker; the one
  exception is the UI scout an `observe:` input sends.
- **Write the Feature, plus any Observation this run made**: `.qa/features/<slug>/<slug>.md`.
  Leave `project.md` untouched (project changes go through `/qa-init`).
- **The tracker is read-only except `/qa-publish`.**
- **Keep credentials with the engineer: never ask for a credential.** Name the env var or
  connector to fix; its value stays with the engineer.
- **Answers are the engineer's: never answer your own questions.**
- **Never run git to stage or commit yourself.** The commit follows the project's Commit mode through
  `scan.mjs commit`, never retried with `--no-verify`.
- **Settle an active Feature slug: never write a retired Feature key** (on unusable, report why and
  settle another).
- **A `mirror` comes only from a Group-level issue**; a Story, Task, Bug or Epic goes in `sources`.

## The CLI

Every deterministic step uses the shared CLI, relative to this skill's directory:

```
node <this skill's directory>/../../scripts/scan.mjs deep-dive <action> ... [--root <qa-dir>]
```

Commands that read input take it from a file: write it outside the repository (the run dir or your scratch directory) and pass its absolute path as `--input <file>`. Run each command as one plain `node` line, with no pipe, heredoc, `&&` or `;` chain, variable prefix or `cd`.

`--root` defaults to `./.qa`, so run it from the repository root. Each call prints one JSON object:
read it and use its fields directly rather than re-deriving results by grep or prose. Actions:

| Action | What it answers |
|---|---|
| `refs <ref>...` | each Reference in `sections`, its Access note (`access`) and `train` |
| `feature <key>` | usability (`status`), `suite_key`, `file`, `path`, `next_step`, `train`, and knowledge `sections` |
| `roles <name>...` | known and missing roles in `sections` with each add-role command |
| `amend <key> <rule>...` | bounded amendment inventory in `sections` and `next_step` |
| `reconcile <key> --input <file> [--dir <run-dir>]` | forecast vs. Rule edits in `sections`, `change_file`, `next_step` |
| `resume --dir <run-dir>` | quick-path handoff (`dir`, `feature`, `next_step`) and state `sections` |
| `check <key> --input <file> [--confirm <link>,...]` | validation and changes in `sections`, `coverage_digest`, plus `path`, `changeset`, `commit`, `next_step` when `ok` |

Word every reported section of `sections` in order, keeping exact commands and paths intact.

**Training.** `train` is `train/deep-dive.md` (`exists`, `text`, `entries`). Read it from the first
call that returns it (`feature` with a key, else `refs`), before fetching. Follow its Practices to
the close.

## 1. Split the arguments

The first argument is the Feature key if it is a kebab-case slug (`^[a-z0-9]+(-[a-z0-9]+)*$`)
and not a file in the repository. Everything else is a Reference or an
`observe:<url> "<what to look at>"` input, `observe:signed-out <url> "<what to look at>"` for a
signed-out page, except `--dir <run-dir>` and repeatable `--focus "<verb phrase>"`.
`--focus` names functionalities; apply [the Deferred reference](references/deferred.md) in §4.
With no Reference, `observe:` input or
`--dir`, ask for one and stop.

**A key was given**: run `deep-dive feature <key>` now.

**`--dir <run-dir>`**: run `deep-dive resume --dir <run-dir>` first. Its sections supply the
References to take in (§2), the Rules already edited and confirmed (opening the forecast as Changes
without re-asking), the uncommitted files holding them in the working tree, and any open or design
questions to seed the walk. The run dir is the change's: pass `--dir` to `reconcile` and name it in
the close, for `/qa-design`.

## 2. Take in every Reference, and halt on any failure

A Reference is stored in the Feature's `sources` as one of these URIs:

| Kind | URI | Fetched by |
|---|---|---|
| tracker | `tracker:DEMO-1` | the tracker's read-only tools |
| file | `file:docs/import.md` (repo-relative, one file) | reading it |
| code | `code:path/to/ImportTest.kt` (one source file, not a directory) | reading it |
| url | `url:https://…` | fetching it |
| conversation | `human:<name>` | this session: what the engineer settles while you grill |

To cite a live application, record it with `observe:` as a `file:` Observation.

0. **`observe:` inputs first.** Read [the observe reference](references/observe.md), and run each
   input to the `file:` URI that replaces it.
1. Run `deep-dive refs <every ref>`. Bare inputs are inferred (`DEMO-1` → `tracker:`, a URL →
   `url:`, a path → `code:` under `module_paths`, else `file:`). Use the returned URI instead of
   the raw input.
2. Fetch each reference **to completion** before the next:
   - `pending` (tracker, url): fetch it yourself. A tracker issue is complete with every field, the
     description and every comment, including the `[qa-skills] Parked questions:` comment; note its
     issue type. A linked issue is read only when passed as its own Reference. If its `access` is a
     note, or a fetch fails on credentials, read [the access reference](references/access.md) first.
   - `resolved` (file, code): read the whole file.
   - `conversation` (human): nothing to fetch.
   - `failed`: carry on, so the report is complete.
3. Print **one report** wording `sections` in order (URI, status, untracked warning, failure reason).
   A file git does not track carries an untracked warning: a fresh clone cannot re-read it. Say so
   here and at the close (§10); it does not halt the intake.
4. **Halt on any failed Reference or `observe:` input.** Write no Feature, start no grilling, and
   never continue on a subset (an expired token must not shrink a Feature to half its sources).
   Tell the engineer to fix it or re-run without it, and print the access reference's hand-off for
   a failed tracker or url.

## 3. Settle the Feature slug

One Feature per run. **No key**: propose a kebab-case slug named for the behaviour, not for the
tracker's structure. Run `deep-dive feature <slug>`; have the engineer confirm or replace it before
continuing.

Require schema 3 for Feature writes: relay a `feature` or `check` schema refusal and stop; run
preflight `migrations` commands in order on the default branch before retrying.

`status` decides the run:

- `new`: a fresh Feature; mint a new Feature's Suite key with `mint su` now and keep its
  `suite_key` on every re-run and rename (deleting a Feature keeps its slug and Suite key in
  `project.md`'s `retired_features`).
- `existing`: a re-run that updates the Feature in place (§4), keeping its `suite_key`.
- `retired`, `succeeded` or `invalid`: unusable; report why and settle another slug.

Reconcile against every section `deep-dive feature` returns.

## 4. Inventory

On an `existing` Feature, read [the re-run reference](references/re-run.md) before building: offer the
pick-up choice for any Deferred functionality, then run the Impact forecast (the Impact forecast reads Rules only,
never Test Cases; sort the Rules into Changes, May change and Unaffected before any edit, have the
engineer confirm it, and never store it: the Rule edits are the record). Before editing an Upstream
Rule, show every Rule that depends on it with its Feature and statement. When the confirmed forecast names
only some Rules and nothing needs a full inventory, inventory those and their linked cases with
`deep-dive amend`.

For full inventories, read [the Deferred reference](references/deferred.md): leaving work for
later, focused inventories, existing items' lifecycle, and stating Coverage with its deferred count.

For an OpenAPI or Swagger Reference, read [the contract reference](references/openapi.md).

Build the **functionality inventory** from References, Observations and, on re-runs, the
whole existing Feature and its Case Index section. Read every case's summary and Expected-result
paragraph, and the rest only to interpret its claims. List each **functionality** as a
verb phrase, with its evidence (Reference URI and place, Observation fact, unseen part) and
visibility (seen in the app, documented, unseen).

**Reconcile.** Every source item stays accounted for: place every behaviour-bearing item, existing
Rule, case, Parked question, kept Proposed Rule and previously named functionality, or set it
aside with its reason. A duplicate or misreading disappears with a one-line reason; a genuine
exclusion becomes a Boundary (`Owner: none` allowed). Dropping an inventory entry never retires a
Rule.

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

Read [the Coverage categories](../references/coverage-categories.md), then walk the Coverage Categories section
`deep-dive feature` returns in order. Walk functionality-major, then reconcile by category
across functionalities, especially permissions, shared state, concurrency and side effects.

Each functionality × category pair ends on one **aggregate disposition**: covered by Rules,
awaiting an answer, or n/a. A pair with any unsettled behaviour is awaiting.

Before a pair is `covered`, compare each clause of the category's meaning with the Rules it cites. A
clause they leave out is a question to the engineer, and the pair stays awaiting until answered.
Ask at intent level — is that behaviour claimed, and does a case need to check it? — never for exact
wording. The engineer may answer that the Rule claims only what it states, settling the clause.

Show a bulk table with the honest acceptance object the engineer reads: each Rule's key and
statement, the evidence located (an Observation's fact number or a Reference place:
`<reference uri>, <place>`), an n/a's reason naming the functionality and scope, and every open
question. Propose a Dependency from the other Features' live Rules when a Rule rests on another Feature's behaviour,
and settle it with the engineer. Only the engineer parks. Bulk acceptance covers only the proposals
displayed; anything unaddressed or ambiguous stays open.

Ask in rounds in the investigation reference's format. Drop any question a live Rule
already answers; skip re-asking settled behaviour, even when two References still disagree about it.
An Observation's facts are claims of current behaviour: one becomes a Rule only once the engineer
confirms it. A parked question is tagged `[<category key>]` and enters `## Open questions`.

Once the engineer settles something in conversation, add `human:<their name>` to `sources`. Use the
name they already go by in `.qa/` (such as `human:librarian`). If there is none, ask for it once.

**Gate.** Every pair is confirmed; every source item is still accounted for; nothing depends on a
probe; and the draft passes `check`.

## 7. Write the Rules

Before drafting Rules, read the scope decisions reference and compare each behaviour with the
Feature's Boundaries (see [scope-decisions.md](references/scope-decisions.md)). Write the Rules from
the confirmed outcomes, and `## Coverage` from the walk: one line per effective category in walk
order, aggregating `awaiting` > `covered` > `n/a`.

- One Rule per settled behaviour, appended as the last item of `## Rules`: `<n>. **rule_<key>**: <statement>`.
- A **Waiver** marks a Rule left without a Test Case: `Waived: <reason>` in the Rule's field block,
  its contiguous lines directly under the statement.
- **The statement carries the whole claim**: its item's first line stands alone for judges to quote.
  Optional prose follows, indented under the item, clarifying the Rule without adding claims.
- Mint every new Rule key with `mint rule --feature <slug> --count <n>`, keeping each Rule's key
  fixed, and mint Boundary keys with `mint boundary --feature <slug>` (keep each key stable;
  withdrawing its Boundary moves the key to the Feature's `retired:` list).
- State behaviour at intent level by default. Name a button, selector, HTTP method, endpoint,
  status, header or payload field only when the engineer confirms the Rule is about that UI detail or
  the API contract itself.
- Write a parked question as prose under `## Open questions` rather than a `rule_` item. It is not a
  claim, so nothing can cover or contradict it.

**Roles.** Run `deep-dive roles <name>...` on every role the Rules name. Keep writing the Feature
even when a role is missing: the close (§10) reports it with its add-role command.

## 8. The Feature file

Read [the Feature file format](references/feature-file.md) before drafting: frontmatter, sections,
Rule field blocks, Boundary owners, the `## Coverage` lines and `coverage_digest`.

## 9. Check, then write

Pass the complete draft, `## Coverage` included, to `deep-dive check <slug> --input <file>`. Write
only a draft that passes.

- **`ok: false`**: fix every reported error and check again.
- **A `link_unrepaired` error**: a retired or merged-away Rule is still named by a `covers`, Reliance or
  Dependency across Features. Show the engineer each link from that check error with its Feature,
  owner and file. A `link_unrepaired` link is the engineer's to repair or confirm (never confirm for
  them): repair it in the file that holds it (a Dependency in the drafted Feature is edited in the
  draft), or pass its confirmed `id` to `--confirm`.
- **`ok: true`**: add `coverage_digest` to frontmatter, check again, then write byte for byte to
  `path`. Word any warnings section (`retired_feature_key` means §3 was skipped). On an existing
  Feature, run `deep-dive reconcile` next and settle its sections, as the re-run reference says.

## 10. Close

Print in order:

1. Word every section of `check`, `roles` and (on an existing Feature) `reconcile` in order (cases a
   retired Rule leaves dangling, questions parked/cleared, missing roles with `/qa-init --add-role`
   commands).
2. The `changeset`: the Feature and this run's Observations.
3. The commit of the `changeset`, made as [the commit reference](../references/commit.md) says
   (a dirty working tree is fine; say nothing about it), plus any other untracked `file:` or `code:`
   References for the engineer to add themselves.
4. `next_step` (`/qa-design <slug>`): offer it once; run it on yes. After Rule edits reaching other
   Features, word the next downstream Feature section and any `change_file`. Checkpoint 1 is a commit:
   item 3's commit comes first, since stale obligations store only against a commit and
   `impact persist` refuses uncommitted knowledge.
5. If this session taught `/qa-deep-dive` something (a correction, or an answer it would otherwise
   ask again), offer `/qa-train deep-dive` and, on yes, invoke it.
