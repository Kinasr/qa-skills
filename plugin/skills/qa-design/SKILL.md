---
name: qa-design
description: Agree a Test Scenario split for a Feature, then have a Delegate fill each scenario file with Test Cases.
disable-model-invocation: true
---

# /qa-design

`/qa-design <feature-key> [<scenario-key>] [--expand] [--regenerate] [--review]`

Agrees a **Test Scenario** split for one **Feature** with the engineer (Phase 1),
then has a **Delegate** fill empty scenario files with **Test Cases** (Phase 2).

**`<scope>`** is the engineer's arguments, passed unchanged to every `design` step:
`<feature-key> [<scenario-key>] [--expand | --regenerate] [--review]`.

## Invariants

A Practice that contradicts an Invariant is void.

- **At startup, on every path**, run
  `node <this skill's directory>/../../scripts/scan.mjs migration-status [--root <qa-dir>]`.
  If `pending`, warn using `migrations` in order. Continue the command.

- **You word everything the engineer reads** (ADR-0024), by [the shared wording
  rules](../references/wording-rules.md): every refusal, the split proposal and
  the closing report. Copy commands and paths exactly.
- Atomic + interaction/journey; escalate ambiguity: [procedure](references/interactions.md).
- **Cases are Layer-free by default**; bind only a layer-bound claim and explain why.
- **Inputs are `.qa/` only**; `/qa-deep-dive` owns intake.
- A carried claim needs its own local Rule, from `/qa-deep-dive`.
- A `Waived:` Rule stays required and gets no Test Case; keep its reason in briefs.
- **A Rule fix on the walk** is passed to `design rule-fix <feature> --dir <dir> --input <file>`; the settled causes resting on that Rule are open again and the others stay closed.
- **A settlement judges before it persists:** the plan's `--cmd impact` units are dispatched and each
  reply is checked by `check-reply judge` before `impact persist`; an unjudged case is never certified.
- **A refused repeat is overridden by the engineer's stated reason only**, through `design override --input <file>`.
- **The tracker is read-only except `/qa-publish`.**
- **Rules only enter through `/qa-deep-dive`.** Never write the Feature file's Rules or `project.md`.
  Settlement writes findings, Reviews and retirements through the CLI, never a Rule. Its one Feature
  write is `design keep`, of Proposed Rules the engineer kept.
- **The orchestrator writes; a Delegate never does.** `design split` writes Phase 1's files, and the
  CLI writes each unit's cases on a usable reply. Pass each reply unchanged.
- **Never guess an answer**: ask about ambiguity; leave unclear answers open.
- **Never pre-select an answer.** Every finding, review and link is the engineer's. Your proposal is data
  shown beside the offered `choices`; never mark one, default one or apply one unasked.
- **`design propose` records proposals; `design link` writes only the links the engineer confirmed.**
- **Uncovered Rules come after the agreement**, never during settlement.
- **Never run git to stage or commit yourself.** The commit follows the project's Commit mode through
  `scan.mjs commit` (ADR-0062), never retried with `--no-verify`. A dirty working tree is fine.
- **Before answering a question about written cases, read the relevant stored cases and governing
  Rules** — all relevant scenarios for a cross-scenario or exhaustive claim. Support the answer
  with case content; never answer from titles.

## The CLI

Run from the repository root (`--root` defaults to `./.qa`); each prints one JSON object:

```
node <this skill's directory>/../../scripts/scan.mjs <mode> ...
```

Commands that read input take it from a file: write it outside the repository (the run dir or your scratch directory) and pass its absolute path as `--input <file>`. Run each command as one plain `node` line, with no pipe, heredoc, `&&` or `;` chain, variable prefix or `cd`.

- `design state <scope>`
- `design agree <scope> --input <file>`
- `design split <feature-key> --input <file>`
- `design plan <scope> [--dir <run-dir>]`
- `design override --input <file> [--dir <run-dir>]`
- `deep-dive roles <name>...`
- `design propose --dir <run-dir> --input <file>`
- `design link --dir <run-dir> --case <key> --input <file>`
- `design report --dir <run-dir>`
- `design keep --dir <run-dir> --input <file>`
- `design unbind --dir <run-dir> <case-key>`
- `delegate resolve|start|next|record ...`, the shared delegation procedure

**`ok: false`** on any call: nothing was written. Each `refusals` entry is a `code`, one factual
`line` or `message` and its data; explain it and say what to do next, copying `next` intact.

## 1. State

Run `design state <scope>`. It prints `phase1`, `rules`, `roles`, `levels`, `train`,
`coverage`, `open_findings`, `uncited_cases`, `uncovered_rules` and `proposed_rules` (with `--review`, also `review`); `train` is `train/design.md` (`exists`, `text`, `entries`), whose Practices you
follow throughout. Word `coverage.markdown`; recommend `coverage.next_step` if set.

- **`open_findings.open`**: settle before the split or `--expand`. It names every open finding by
  `by_kind` and Feature: Stale causes, old Conflicts, Overreaches, Divergences, Outcome gaps and
  Feature-level findings. Tell the engineer what is open, run the settlement below, and return here.
- **`review`** (`--review`): its `cases` are the unreviewed ones and those with a passed `review_by`,
  a fresh Review included (`why`). Settle them likewise, with `--review` on the settlement's plan.
- **`no_targets`**: there is nothing to expand or regenerate; recommend a bare
  `/qa-design <feature-key>` and stop.
- Otherwise: §2, then §3.

To settle, run `impact plan <feature-key> --persist [--review] [--dir <run-dir>]`, with the run dir `/qa-impact`,
`/qa-deep-dive` or an escalation printed for this change so the settlement reuses it. **Judge before
`impact persist`**: dispatch the plan's `units` as [the judge step](../qa-impact/SKILL.md#the-judge-step)
does, following `<this skill's directory>/../../scripts/delegation.md` with `--cmd impact` and the plan's
`dir`. With no `units`, skip the dispatch. Then `impact persist --dir <dir>`; the Watermark certifies
at the checkpoint. Then the walk here (a Feature with nothing changed since its Watermark judges
nothing). `design walk`, `triage`, `checkpoint`, `page` and `page-reply` settle that run dir. Follow the
shared [walk](../qa-impact/references/triage.md) and [Card page](../qa-impact/references/card-page.md)
procedures.

**Propose before each walk.** Read each walk case's text and Rules, then pass
`{"v":1,"items":{"<case key>":{"outcome":"keep|fix|retire","reason":"…","covers":[…],"relies_on":[…]}}}`
to `design propose --dir <dir> --input <file>`: `outcome` for a case with an open Stale, `covers` and
`relies_on` for every case you touch. The walk prints it as `case.proposal` beside `choices`
(`confirmed` marks links the case already holds). Show it as your proposal; the engineer's answer
decides. Write confirmed links with `design link --dir <dir> --case <key> --input <file>`, passing
`{"covers":[…],"relies_on":[…]}` exactly as the engineer confirmed them.

**`uncited_cases`**: cases with no `covers`, Reliance or not. They are a report, never a finding.
Offer to link them; for each the engineer selects, propose `covers` and `relies_on`, then confirm
and write them with `design link`.

When the walk shows a Rule is wrong, the engineer edits it, uncommitted, and confirms the forecast; word the
Boundary check and downstream Rules of the `rule-fix` output as `/qa-deep-dive` does, then resume the walk.
Commit the fix before settling the reopened causes anew.

## 2. Agree the split


`phase1: true` proposes the split; a populated Feature audits it; a scoped run settles a **local
agreement**. Each run settles one agreement before anything is written. Read
[the agreement](references/agreement.md) for its fields, scope, remark authority and delivery.

Read the Rules and `train.text` in full, then propose in one message:

1. **The scenario split and assignments**: each Test Scenario as a one-line summary and the Rules it covers per Coverage category; in a whole-Feature agreement every Rule
   falls in one. Highlight the Rules elsewhere constraining each entry, and carry the engineer's
   remarks.
2. **The audit** (populated Feature): name every non-Waived Rule with no case, including one a
   regenerate would leave uncovered, and the scenario that takes it.
3. **Proposed Rules implied by Conventions**: a Convention that would have a case claim what no Rule
   states is no case; list it as a proposed Rule for `/qa-deep-dive <slug>` and write none. Name §1's
   `proposed_rules` as awaiting it.
4. **Roles missing from the project**: run `deep-dive roles <name>...` for every role the Rules
   name; give each missing one's `commands` entry exactly.

Pass the proposal to `design agree feature --input <file>` (or `design agree <scenario-key> --input <file>` for a
one-scenario run); word its `views` and `refusals` for the engineer, and fix what a refusal names
before asking for confirmation.

Wait for the engineer, who confirms, edits or replaces the proposal. If they added a role, run
`design state <feature-key>` again. A role they decline stays out of every case. On confirmation,
pass the canonical `agreement` to `design split <feature-key> --input <file>`; keep its `dir` and
`agreement`.

Once the engineer confirms the split, name each `uncovered_rules` entry (a Waived Rule is never
listed) and the scenario that takes it, as the audit assigns.

## 3. Plan

Run `design plan <scope> --dir <dir>`. It prints `dir` and `units`, how many scenario files to
dispatch. With none, go to §5.
Apply the actor-side rule in the shared wording rules when reviewing cases. Never add training to a brief: each carries the Conventions, and Practices stay with you.

**A refused repeat** is the engineer's call: when a `duplicates` entry is a distinct pass, ask for the
reason (any `proposed_reason` is a draft), pass `{"<Key it repeats>":"<reason>"}` to
`design override --input <file> --dir <dir>`, and plan and dispatch that scenario again with the same
`--dir`. The reason reaches the Delegate's brief and is written beside the case as the engineer's. An
`of: null` entry has no Key: it stays refused.

## 4. Dispatch

Follow `<this skill's directory>/../../scripts/delegation.md`, all of it, with `--cmd design`, the
plan's `dir`. Say nothing to the engineer until dispatch is over.

## 5. Report

Run `design report --dir <dir>`; show every binding and reason, following [binding review](references/bindings.md). Review each written case's Roles, following [role review](references/roles.md). Word its report, copying non-null `written_markdown` and
`changeset.commit` intact. Cover each `replaced` case; every unit that wrote nothing, with its
`reason` and `problems`; each `duplicates` entry, a refused repeat, beside the Key it repeats (a
written unit's other cases were written); each `overridden` case with its stated `reason` and `by`; `skipped` when nothing was dispatched; `still_empty` with `rerun` or
`reruns`; `proposals` with `handoff`, then [keep](references/keep.md); `check_gaps` with `check_handoff`, which `/qa-train design`
settles as a Convention; `awaiting_rules` with its `proposals` and `/qa-deep-dive`
rerun; `not_automatable` and `not_manual`, for Review (a case in both cannot run either way); `dropped_labels` ([labels](references/labels.md)); and `run_health`.

Then cover `coverage` from §1: a legacy (`assessed: false`) or `due` one, naming `due.trigger`,
`due.detail` and `next_step`. Word the report's `declared_coverage` — its `label`, per-scenario
`markdown` and each obligation's `outcome` — and its `handoffs`.

When `changeset.commit` is not null, make it as [the commit reference](../references/commit.md)
says, unless a keep's `commit` already covered it. A Rule the engineer fixed by hand stays their own commit.

If this session taught `/qa-design` something, end by offering `/qa-train design` and, on yes,
invoking it.
