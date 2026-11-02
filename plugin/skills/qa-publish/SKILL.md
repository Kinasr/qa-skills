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

- **At startup, on every path**, run
  `node <this skill's directory>/../../scripts/scan.mjs migration-status [--root <qa-dir>]`.
  If `pending`, warn using `migrations` in order. Continue the command.

- **Run it yourself, in this conversation**: there is no Delegate. The tracker scout reads;
  the Publisher makes the accepted writes, following its CLI-written brief.
- **The tracker is written only by the Publisher, only after the Reply.** A Scout never writes.
  In a harness without subagents, follow the same briefs yourself.
- **Never stage or commit.** The CLI alone commits exactly the `tracker:`, Mirror, repair and whole bug-file paths. Run
  `publish record` to complete Publish; never run its git operations yourself.
- **Never ask for a credential.** Name the Access note and env var or connector to fix; its value
  stays with the engineer.
- **Never guess an answer.** Ask about ambiguity. Leave anything the Reply does not clearly
  address open. Never apply answers given before a rebuild.
- **Use the CLI's eligibility.** Never write a Review or replace scan's freshness judgement.
- **Every refusal stops.** For `publishing_not_configured`, direct to `/qa-init`; otherwise
  explain the fix.
- **Recovery needs no fresh Review and writes nothing to the tracker.** Show its Tracker key and
  actual Mirrored values on the Card. A race hit requires a new Card.
- **Suite recovery writes only `mirror.suite` and `at`, preserving other Mirror fields.** It works
  for an empty Feature. Rejecting it cascades to dependent creates. Missing Suite keys require
  `migrate-keys` on the default branch.
- **Create with the marker in the create call itself for Suites, Scenarios, cases and bugs.** An unsupported atomic
  mark fails before creation; a timeout after submission stays uncertain for recovery.
- **Approve each tracker repair on the Card.** A remark rewrites the mark to the surviving Key,
  or an attached Suite's mark to its Feature's Suite key; a Suite remark comes first, and the
  creates under that Suite depend on it.
  A retire uses `tracker.retire_transition`. Show a missing transition as a skip.
  Completed repairs are removed; failed or dropped repairs stay pending.
- **Labels are overwrites, outside Divergences.** Show the Tags row, clears, removals and every
  `notices` entry once; accepting the Card authorizes the label operations. Label-only edits keep
  fresh Reviews fresh. A local-copy item records label copies only, with no Publisher write.
  Below the level-on-case schema, publish claims only and relay the migration notice.
- **One case is one atomic field update.** The Publisher refuses before mutating when unsupported,
  preserves unmanaged labels and the marker label, and returns confirmed label values. Record copies
  only from those confirmations; a rejected value fails that case while independent items continue.
- **Record partial results.** Run `publish record` even when the Publisher fails or stops; only
  successful items are applied. A bug with a valid Tracker key is published even with an error;
  report its manual remedy. Re-run from a fresh scope and Card after repairing failures.
- **Existing bugs are facts on the Card.** An open linked bug is flagged and needs a confirm; a
  closed one is information needing no answer. A local published bug the case does not link counts
  as an existing bug. A recovery records only, saying "link and attachments not verified". Older
  drafts are discard-only on a chained Card. Bug grouping states a fact, never a cause.

## The CLI

Run from the repository root (`--root` defaults to `./.qa`):

```
node <this skill's directory>/../../scripts/scan.mjs publish scope [<feature-key> | --run <execute-run-dir>] [--dir <run-dir>] [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs scout brief tracker --dir <run-dir> [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs publish card [<feature-key>] --dir <run-dir> [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs publish apply --dir <run-dir> --stdin [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs scout brief publisher --dir <run-dir> [--root <qa-dir>]
node <this skill's directory>/../../scripts/scan.mjs publish record --dir <run-dir> [--root <qa-dir>]
```

Each call prints JSON. Keep `scope`'s `dir` throughout. The CLI checks the Card digest; never carry
it in decisions. Explain refusal codes, labels and data. Relay a shared guard's `text` intact.

## 1. Fetch the tracker

Run `publish scope [<feature-key>]`, or use the Run branch for `--run`. Follow `train`'s Practices throughout. `access` is the Access
note the tracker is reached through, or `null`. If
`access` is a note, or credentials fail, read [the access reference](../qa-sync/references/access.md)
first.

Use [the tracker-fetch reference](../qa-sync/references/tracker-fetch.md), including its fallback
without subagents. The tracker scout's brief names the exact fetch command. A failed fetch stops Publish: explain the refusal.

**Resolve named label destinations before the Card.** Use `scope.label_destinations`; for each
named destination other than `labels`, fetch matching tracker identities and cardinalities into
`tracker.json`'s `label_destinations: [{name, fields: [{id, cardinality}]}]`, `cardinality` being
`single` or `multiple`. Include zero or multiple matches as observed; the CLI skips affected cases
rather than choosing a field. Fetch each case's named-field Tags as
`label_values: [{id: "label:tags", kind: "tags", destination, value: []}]`, using the actual list in
`value`, so the Card shows removals. Fetch each mapped Custom field the same way, as
`{id: "label:field:<name>", kind: "custom_field", destination, value}`: a scalar or null for single.

## 2. Word the Card

Run `publish card --dir <run-dir>`. Read [the shared wording
rules](../references/wording-rules.md). Show every numbered Suite, Scenario and case, its summary,
fields and dependencies, and each case's story links and Suite/Scenario target. Show every numbered
recovery with its Tracker key and actual Mirrored values. It only records the link and Mirrors.
Show every numbered Bug draft with its number, `bg_` Key, summary, route, case Key and title,
resolved Tracker key, link type and direction, field values and any unanswered required field with
its allowed values, offered screenshots (marked not scrubbed), each dropped screenshot's reason,
and its stale and redacted flags, plus the full body that will be sent. A regular scope offers no
screenshots and says they need `--run`. An open linked bug says "case already has an open bug" with
its key, summary, status and links; a closed one is information needing no answer; a local published
bug the case does not link says so. Older drafts are discard-only lines. A recovered bug says "link
and attachments not verified". Bugs that failed together with one Automation in one Run are grouped
as that fact, never a cause.
Show every numbered Parked-questions comment (`create` or `edit`) with its story and body.
Show every numbered repair with its Tracker key and mark value or retirement transition. For updates
show each field's
tracker and new values, and Divergences needing confirmation. Include skips and reasons. A skip's `remedy` is `merge` (a Merge) or `reconcile` (a person keeps one body). Wait for the Reply.

## 3. Apply decisions

Translate only clear answers into JSON on stdin:

```json
{"take":"all","drop":[3]}
```

`take` is `"all"` only for explicit whole-Card acceptance, otherwise a list of item numbers.
`drop` lists rejected items. Unmentioned items stay open. Run `publish apply`.

For a Bug, `fields` answers its fields by item number or `all`; `attach` ticks offered screenshots
by name; `discard` deletes a draft. `confirmed` answers a stale bug. Apply checks this grammar
first, then reports `needs_edit` and `confirm` together. Submit its `decisions` only after the
engineer's explicit yes; a changed state needs a new Card.

- **`ok: true`**: the Reply is accepted; proceed to §4.
- **`confirm: true`**: show the CLI's effects, wait for explicit confirmation, then submit its
  `decisions`, or revise them from the engineer's answer.
- **`rebuild: true`**: rebuild, show the new Card and obtain fresh answers.
- **Otherwise**: resolve refused or open answers before retrying.

## 4. Publish and record

Run `scout brief publisher`. Spawn one Publisher with tracker tools and a shell, using its
printed `model` (none for `null`), prompted `Read <brief_file> and follow it.` If that model is
refused, announce the Fallback and use the session's model. Without subagents or their required
tools, say once that you will follow the brief in this conversation, then do so.

Run `publish record` after the Publisher returns or stops. When the accepted Reply holds no tracker
write, skip the Publisher and run `publish record` directly; the tracker read before the Card still
happened. It validates `output_file` before
writing, records each success's Tracker link and Mirrored values (a Suite only in `mirror.suite`), removes completed repairs and commits those paths.

Describe `applied`, `failed` and `report.files` with the supplied labels; name `report.commit`.
Report each `error`; failed updates keep their Mirrors, unfinished creates stay unlinked for a
later run, which proposes recovery on a new Card. Report `rebuild: true` as a requirement to rebuild
the Card and obtain fresh answers. With `access`, name the Access note, its
`via` and `credential_from`. Explain refusals and stop. A failed commit names the written
Publish paths; keep them and the run dir. With `--run`, return to the caller. Otherwise, close by offering `/qa-train publish` if
the session taught `/qa-publish` something, and `/qa-train access` if access needed repair or used
a value from chat. On yes, invoke each.
