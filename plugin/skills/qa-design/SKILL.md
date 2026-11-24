---
name: qa-design
description: Agree a Test Scenario split for a Feature, then have a Delegate fill each scenario file with Test Cases.
disable-model-invocation: true
---

# /qa-design

`/qa-design <feature-key> [<scenario-key>] [--expand] [--regenerate] [--review]`

Agrees a **Test Scenario** split for one **Feature** with the engineer (Phase 1),
then has a **Delegate** fill empty scenario files with **Test Cases** (Phase 2).

**`<scope>`** is `<feature-key> [<scenario-key>] [--expand | --regenerate]`.

## Invariants

A Practice that contradicts an Invariant is void.

- **On every path where the command's JSON carries `migration`**, read it first: if `pending`,
  warn using `migrations` in order; continue the command.

- **You word everything the engineer reads**, by [the shared wording rules](../references/wording-rules.md):
  every refusal, the split proposal and the closing report. Copy commands and paths exactly.
- **Inputs are `.qa/` only**; `/qa-deep-dive` owns intake.
- **The tracker is read-only except `/qa-publish`.**
- **Rules only enter through `/qa-deep-dive`.** Never write the Feature file's Rules or `project.md`:
  settlement writes findings, Reviews and retirements through the CLI, never a Rule, and its one
  Feature write is `design keep`, of Proposed Rules the engineer kept.
- **The orchestrator writes; a Delegate never does.** `design split` writes Phase 1's files, and the
  CLI writes each unit's cases on a usable reply. Pass each reply unchanged.
- **Every answer is the engineer's.** Never guess an answer: ask about ambiguity and leave unclear
  answers open. Never pre-select an answer: every finding, review and link is the engineer's, and
  your proposal is data shown beside the offered `choices`, never marked, defaulted or applied
  unasked.
- **Never run git to stage or commit yourself.** The commit follows the project's Commit mode through
  `scan.mjs commit`, never retried with `--no-verify`. A dirty working tree is fine.
- **Before answering a question about written cases, read the relevant stored cases and governing
  Rules** — all relevant scenarios for a cross-scenario or exhaustive claim. Support the answer
  with case content; never answer from titles.

## The CLI

Run from the repository root (`--root` defaults to `./.qa`); each prints one JSON object:

```
node <this skill's directory>/../../scripts/scan.mjs <mode> ...
```

Commands that read input take it from a file: write it outside the repository (the run dir or your scratch directory) and pass its absolute path as `--input <file>`. Run each command as one plain `node` line, with no pipe, heredoc, `&&` or `;` chain, variable prefix or `cd`.

- `design state <scope> [--review]`
- `design agree (feature | <scenario-key>) --input <file>`
- `design split <feature-key> --input <file> [--dir <run-dir>]`
- `design plan <scope> [--dir <run-dir>]`
- `design override --input <file> [--dir <run-dir>]`
- `deep-dive roles <name>...`
- `design propose --dir <run-dir> --input <file>`
- `design link --dir <run-dir> --case <key> --input <file>`
- `design report --dir <run-dir>`
- `design keep --dir <run-dir> --input <file>`
- `design unbind --dir <run-dir> <case-key>`
- `design resume --dir <run-dir>`
- `impact plan <feature-key> --persist [--review] [--dir <run-dir>]`, then `impact persist --dir <run-dir>`
- `design walk --dir <run-dir> [--by human:<name>] [--case <key>]`
- `design triage --dir <run-dir> --input <file> [--case <key>]`
- `design page --dir <run-dir> [--input <file>]`; `design page-reply --dir <run-dir> --input <file>`
- `design rule-fix <feature-key> --dir <run-dir> --input <file>`
- `design checkpoint --dir <run-dir>`
- `delegate resolve|start|next|record ...`, the shared delegation procedure

**`ok: false`** on any call: nothing was written. Each `refusals` entry is a `code` and facts;
word it, then say the next step, copying `next` intact.

## 1. State

Run `design state <scope> [--review]`. `phase1`, `no_targets`, the Rules, Roles and Levels and design's training
are its run header; follow the Practices in `train/design.md` throughout. Word every section in order,
recommending any follow-up command a section carries.

- **Open findings**: settle before the split or `--expand`. The section names every open finding by
  kind and Feature: Stale causes, old Conflicts, Overreaches, Divergences, Outcome gaps and
  Feature-level findings. Tell the engineer what is open, run the settlement below, and return here.
- **Review due** (`--review`): the section lists the unreviewed cases and those past their `review_by`,
  a fresh Review included, with why. Settle them likewise, with `--review` on the settlement's plan.
- **`no_targets`**: there is nothing to expand or regenerate; recommend a bare
  `/qa-design <feature-key>` and stop.
- Otherwise: §2, then §3.

To settle, run `impact plan <feature-key> --persist [--review] [--dir <run-dir>]`, with the run dir `/qa-impact`,
`/qa-deep-dive` or an escalation printed for this change so the settlement reuses it. **A settlement
judges before it persists:** the plan's `--cmd impact` units are dispatched and each reply is checked
by `check-reply judge` before `impact persist`; an unjudged case is never certified. Dispatch them as
[the judge step](../qa-impact/SKILL.md#the-judge-step) does, following `<this skill's directory>/../../scripts/delegation.md`
with `--cmd impact` and the plan's `dir`; with no `units`, skip the dispatch. Then
`impact persist --dir <dir>`; the Watermark certifies at the checkpoint. Then the walk here (a Feature
with nothing changed since its Watermark judges nothing). `design walk`, `triage`, `checkpoint`, `page`
and `page-reply` settle that run dir. Follow the shared [walk](../qa-impact/references/triage.md) and
[Card page](../qa-impact/references/card-page.md) procedures.

**Propose before each walk.** Read each walk case's text and Rules, then pass
`{"v":1,"items":{"<case key>":{"outcome":"keep|fix|retire","reason":"…","covers":[…],"relies_on":[…]}}}`
to `design propose --dir <dir> --input <file>`: `outcome` for a case with an open Stale, `covers` and
`relies_on` for every case you touch. `design propose` records proposals; `design link` writes only
the links the engineer confirmed. The walk prints the proposal beside `choices` (`confirmed` marks
links the case already holds). Show it as your proposal; the engineer's answer decides. Write
confirmed links with `design link --dir <dir> --case <key> --input <file>`, passing
`{"covers":[…],"relies_on":[…]}` exactly as the engineer confirmed them.

**Uncited Test Cases**: cases with no `covers`, Reliance or not. They are a report, never a finding.
Offer to link them; for each the engineer selects, propose `covers` and `relies_on`, then confirm
and write them with `design link`.

When the walk shows a Rule is wrong, the engineer edits it, uncommitted, and confirms the forecast; pass
the fix to `design rule-fix <feature> --dir <dir> --input <file>`, then word the Boundary check and
downstream Rules of its output as `/qa-deep-dive` does and resume the walk. The settled causes resting
on that Rule are open again and the others stay closed. Commit the fix before settling the reopened
causes anew.

## 2. Agree the split


`phase1: true` proposes the split; a populated Feature audits it; a scoped run settles a **local
agreement**. Each run settles one agreement before anything is written. Read
[the agreement](references/agreement.md) for its fields, scope, remark authority and delivery.

Atomic + interaction/journey; escalate ambiguity by [the procedure](references/interactions.md).
Cases are Layer-free by default: bind only a layer-bound claim and explain why.

Read the Rules and design's training in full, then propose in one message:

1. **The scenario split and assignments**: each Test Scenario as a one-line summary and the Rules it covers per Coverage category; in a whole-Feature agreement every Rule
   falls in one. Highlight the Rules elsewhere constraining each entry, and carry the engineer's
   remarks.
2. **The audit** (populated Feature): name every non-Waived Rule with no case, including one a
   regenerate would leave uncovered, and the scenario that takes it. A `Waived:` Rule stays required
   and gets no Test Case; keep its reason in briefs.
3. **Proposed Rules implied by Conventions**: a Convention that would have a case claim what no Rule
   states is no case; list it as a proposed Rule for `/qa-deep-dive <slug>` and write none. A carried
   claim needs its own local Rule, from `/qa-deep-dive`. Name §1's Proposed Rules as awaiting it.
4. **Roles missing from the project**: run `deep-dive roles <name>...` for every role the Rules
   name; give each missing one's `commands` entry exactly.

Pass the proposal to `design agree feature --input <file>` (or `design agree <scenario-key> --input <file>` for a
one-scenario run); word every section in order and its `refusals` for the engineer, and fix what a
refusal names before asking for confirmation.

Wait for the engineer, who confirms, edits or replaces the proposal. If they added a role, run
`design state <feature-key>` again. A role they decline stays out of every case. On confirmation,
pass the canonical `agreement` to `design split <feature-key> --input <file>`; keep its `dir` and
`agreement`.

Once the engineer confirms the split, name each Uncovered Rule (a Waived Rule is never listed) and the
scenario that takes it, as the audit assigns. Uncovered Rules come after the agreement, never during
settlement.

## 3. Plan

Run `design plan <scope> --dir <dir>`. It prints `dir` and `units`, how many scenario files to
dispatch. With none, go to §5.
Apply the actor-side rule in the shared wording rules when reviewing cases. Never add training to a brief: each carries the Conventions, and Practices stay with you.

**A refused repeat is overridden by the engineer's stated reason only.** When a repeated case is a
distinct pass, ask for the reason (a drafted reason is only a draft), pass
`{"<Key it repeats>":"<reason>"}` to `design override --input <file>` with `--dir <dir>`, and plan and
dispatch that scenario again with the same `--dir`. The reason reaches the Delegate's brief and is
written beside the case as the engineer's. A repeat naming no Key stays refused.

## 4. Dispatch

Follow `<this skill's directory>/../../scripts/delegation.md`, all of it, with `--cmd design`, the
plan's `dir`. Say nothing to the engineer until dispatch is over.

## 5. Report

Run `design report --dir <dir>`. Show every binding and its reason ([binding review](references/bindings.md)); review Roles ([role review](references/roles.md)).

Word every section in order; copy each Markdown table row for row, and any commit command, intact. Show refused repeats beside the Keys they repeat; check gaps settle as Convention via `/qa-train design`; apply [labels](references/labels.md). Flag automatable-no or manual-no cases for Review (both flagged: cannot run at all). Cover §1's coverage standing: unassessed or due, why, and its next step.

Use [keep](references/keep.md) for Proposed Rules. Commit per [commit](../references/commit.md) unless keep did; hand-fixed Rules stay the engineer's.

Taught: offer `/qa-train design` once; run it on yes.
