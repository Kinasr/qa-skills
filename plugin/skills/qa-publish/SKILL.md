---
name: qa-publish
description: Publish Reviewed Test Cases and Bug drafts behind the Card, recover tracker items and carry out pending tracker repairs. Use only on a `/qa-*` hand-off with `--run <dir>` or when the engineer explicitly asks to publish; plain chat gets the command, never a tracker write.
---

# /qa-publish

`/qa-publish [<feature-key>] | --run <execute-run-dir>`

Publish new or changed Test Cases with fresh Reviews and their missing parents. Word the Card
from CLI data; map the engineer's Reply to JSON decisions. Recover items already created through
accepted recovery items.

## Invariants

A Practice that contradicts an Invariant is void.

- **Startup scope.** If this skill is reached with neither `--run <dir>` nor an explicit request,
  stop and recommend `/qa-publish`. Run only on a `/qa-*` hand-off or an explicit request.
- **Chained Publish needs its own Card.** The end-of-Run yes authorizes invocation only.
  Under `--run`, make no `/qa-train` offer; return to the caller for its single training offer.
  Read [the Run branch](references/run.md) before proceeding with `--run`.
- **On every path where the command's JSON carries `migration`**, read it first: if `pending`,
  warn using `migrations` in order; continue the command.
- **Run it yourself, in this conversation**: follow the CLI briefs directly rather than delegating;
  the tracker scout reads, and the Publisher makes the accepted writes.
- **The tracker is written only by the Publisher, only after the Reply.** A Scout never writes.
  In a harness without subagents, follow the same briefs yourself.
- **The CLI alone commits.** Run `publish record` to complete Publish, where the CLI alone commits
  exactly the `tracker:`, Mirror, repair and whole bug-file paths; never stage or commit yourself.
- **Keep credentials with the engineer.** Name the Access note and env var or connector to fix; its
  value stays with the engineer, so never ask for a credential.
- **Answers belong to the engineer.** Ask about ambiguity and leave unclear items open; never
  guess an answer, and take fresh answers after a rebuild so you never apply answers given before a
  rebuild.
- **Use the CLI's eligibility.** Rely on scan's freshness judgement; never write a Review yourself.

## The CLI

Run from the repository root (`--root` defaults to `./.qa`):

```
node <this skill's directory>/../../scripts/scan.mjs publish scope [<feature-key> | --run <execute-run-dir>] [--dir <run-dir>] [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs scout brief tracker --dir <run-dir> [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs publish card [<feature-key>] --dir <run-dir> [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs publish apply --dir <run-dir> --input <file> [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs scout brief publisher --dir <run-dir> [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs publish record --dir <run-dir> [--root <qa-dir>]
```

Commands that read input take it from a file: write it outside the repository (the run dir or your scratch directory) and pass its absolute path as `--input <file>`. Run each command as one plain `node` line, with no pipe, heredoc, `&&` or `;` chain, variable prefix or `cd`.

Each call prints JSON. Keep `scope`'s `dir` throughout. The CLI checks the Card digest; pass decisions without carrying it. Every refusal stops. For `publishing_not_configured`, direct to `/qa-init`; otherwise word every refusal (including shared guards) from `refusals` (`code` and facts), labels and data.

## 1. Fetch the tracker

Run `publish scope [<feature-key>]`, or use the Run branch for `--run`. Follow `train`'s Practices throughout. `access` is the Access
note the tracker is reached through, or `null`. If
`access` is a note, or credentials fail, read [the access reference](../qa-sync/references/access.md)
first.

Use [the tracker-fetch reference](../qa-sync/references/tracker-fetch.md), including its fallback
without subagents. The tracker scout's brief names the exact fetch command, including label and Test
level destinations and observed case label values. A failed fetch stops Publish: explain the refusal.

## 2. Word the Card

Run `publish card --dir <run-dir>`. Read [the shared wording
rules](../references/wording-rules.md) and word every section in order with the supplied labels:

- **Notices**: relay each notice once (unpublished label kinds, disabled destinations, or schema
  migration notices when publishing claims only below the level-on-case schema).
- **Test Suites, Test Scenarios and Test Cases**: show every numbered item's summary, fields, story
  links, Suite/Scenario target and dependencies. Show each recovery with its Tracker key and actual
  Mirrored values; recovery needs no fresh Review and writes nothing to the tracker. It works for an
  empty Feature, and missing Suite keys require preflight `migrations` commands in order on the default branch. Suite recovery
  writes only `mirror.suite` and `at`, preserving other Mirror fields, and rejecting it cascades to
  dependent creates. For updates, show each field's tracker and new values, Divergences needing
  confirmation, Tags rows, clears and removals: Labels are overwrites, outside Divergences; accepting
  the Card authorizes the label operations; Label-only edits keep fresh Reviews fresh; and a
  local-copy item records label copies only, with no Publisher write. Below the level-on-case schema,
  publish claims only. A level is written only as claimed: A Layer-free case writes no level, one
  binding writes its slug, and a list writes several values only where the tracker's Test level
  field accepts them and is reported unsupported otherwise.
- **Tracker Repairs**: approve each tracker repair on the Card, showing its Tracker key and mark value
  or retirement transition. A remark rewrites the mark to the surviving Key, or an attached Suite's
  mark to its Feature's Suite key; a Suite remark comes first, with dependent creates waiting on it.
  A retire uses `tracker.retire_transition`.
- **Bug Drafts**: show each draft's number, `bg_` Key, summary, route, case Key and title, resolved
  Tracker key, link type and direction, field values, unanswered required fields with allowed values,
  offered screenshots (marked not scrubbed), each dropped screenshot's reason, stale and redacted
  flags, and full body. A regular scope offers no screenshots and notes they need `--run`. An open
  linked bug is flagged and needs a confirm ("case already has an open bug" with key, summary,
  status and links); a closed one is information needing no answer; a local published bug the case
  does not link counts as an existing bug. Older drafts are discard-only on a chained Card. A
  recovered bug says "link and attachments not verified". Bug grouping states a fact, never a cause.
- **Parked-Questions Comments**: show each numbered comment (create or edit) with its story and body.
- **Skipped Items**: include skips and reasons; show a missing transition as a skip. When a skip's
  remedy asks for Merge or manual reconciliation, explain whether to run `/qa-sync` (Merge) or reconcile by
  hand so one body remains. Wait for the Reply.

## 3. Apply decisions

Translate only clear answers into a JSON file:

```json
{"take":"all","drop":[3]}
```

`take` is `"all"` only for explicit whole-Card acceptance, otherwise a list of item numbers.
`drop` lists rejected items. Unmentioned items stay open. For a Bug, `fields` answers its fields by
item number or `all`, `attach` ticks offered screenshots by name, `discard` deletes a draft, and
`confirmed` answers a stale or open-linked bug. Run `publish apply`. Apply checks this grammar
first, then reports any required confirmation sections together.

- **`ok: true`**: the Reply is accepted; proceed to §4.
- **`confirm: true`**: word every section in order with the supplied labels (cascaded drops, removed
  edits, Divergences needing confirmation, required bug fields and bug confirmations), wait for
  explicit confirmation, and submit its `decisions` only after the engineer's explicit yes, or
  revise them from the engineer's answer; a changed state requires rebuilding the Card.
- **`rebuild: true`**: rebuild, show the new Card and obtain fresh answers.
- **Otherwise**: resolve refused or open answers before retrying.

## 4. Publish and record

Run `scout brief publisher`. Spawn one Publisher with tracker tools and a shell, using its
printed `model` (omit for `null`), prompted `Read <brief_file> and follow it.` If that model is
refused, announce the Fallback and use the session's model. Without subagents or their required
tools, say once that you will follow the brief yourself, then do so.

The Publisher must create with the marker in the create call itself for Suites, Scenarios, cases and
bugs (an unsupported atomic mark fails before creation; a timeout after submission stays uncertain
for recovery). One case is one atomic field update: the Publisher refuses before mutating when
unsupported, preserves unmanaged labels and the marker label, and returns confirmed label values.

Run `publish record` even when the Publisher fails or stops. When the accepted Reply holds no
tracker write, skip the Publisher and run `publish record` directly; the tracker read before the
Card still happened. `publish record` validates `output_file` before writing: only successful items
are applied, Record copies only from those confirmations (a rejected value fails that case while
independent items continue), and it records each success's Tracker link and Mirrored values (`mirror.suite`
and `at` only for Suites); completed repairs are removed; failed or dropped repairs stay pending,
and only those paths are committed.

Word every section in order with the supplied labels: applied items (with Tracker keys), discarded
drafts, manual remedies (a bug with a valid Tracker key is published even with an error; report its
manual remedy), failures with their reasons (naming any Access note's name, method and credential
source), Card-rebuild notices (a race hit requires a new Card to rebuild and take fresh answers),
and committed files with the commit hash. Failed updates keep their Mirrors, unfinished creates
stay unlinked for later recovery, and after repairing failures, re-run from a fresh scope and Card.
When a commit fails, keep and name the written Publish paths and the run dir.

With `--run`, return to the caller. Otherwise, close by offering `/qa-train publish` if Publish
taught `/qa-publish` something, and `/qa-train access` if access needed repair or used a value from
chat, invoking each on yes.
