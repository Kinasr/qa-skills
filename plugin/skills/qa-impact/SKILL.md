---
name: qa-impact
description: Take a small change to a Feature end to end (Rules, Stale cases, new cases), handing a big one to /qa-deep-dive.
disable-model-invocation: true
---

# /qa-impact

`/qa-impact <feature-key> [<ref>...]` is the **quick path**, its only form. Only the earlier user-facing
slash-command flags (`--persist`, `--review`, `--target`, and bare `/qa-impact`) are retired,
answered in [Entry](#entry); internal `impact plan --persist` and `impact persist` remain the shared CLI judge step.

The quick path takes a small change to an existing **Feature** from References to written, settled
**Test Cases** in one conversation. The engineer chose it by size; it hands the change to `/qa-deep-dive`
when the confirmed scope grows past a threshold. It calls the transitions `/qa-deep-dive` and `/qa-design`
call, with the same CLI steps and wording: only the order, the run dir and the threshold are its own.

Its judge step judges the cases a change selects in each changed Feature since its **Watermark** (its
Stale, new, edited and escalated cases, and the cases they collide with; the whole Feature when a Rule is
new or widened, a Boundary changed or no Watermark exists), one unit per scenario file holding a
selected case and one per Feature with Boundaries, beside the mechanical **Scan**. Write the report from CLI data.
It then walks the engineer through the written findings case by case; map their free-form
answers to JSON decisions.

An **Overreach** is knowledge that crosses its Feature's stated scope: a Test Case that covers a
Rule the Feature **Waived**, a Test Case that checks behaviour a **Boundary** hands elsewhere, or
a Rule that states it. The **Scan** raises the first, whatever changed since the Watermark; the
**judge** raises the others, beside the case's verdict. A Rule that crosses a Boundary is judged
in a unit of its own, which judges the Feature's Rules against its Boundaries. Every Overreach is
settled like any other finding: by moving the knowledge, withdrawing the Waiver or the Boundary,
or a Dismissal.

## Invariants

A Practice that contradicts an Invariant is void.

- **On every path where the command's JSON carries `migration`**, read it first: if `pending`,
  warn using `migrations` in order; continue the command.

- **The tracker is read-only except `/qa-publish`.**

- **Until `impact persist`, only the run dir is written**, besides quick-path Rule edits. It lives
  in the OS temp dir. Then the CLI
  writes every finding, Dismissal, Review stamp and Watermark; your one `.qa/` edit is a knowledge fix
  the engineer asks for.
- **Every finding and every review answer is the engineer's; never pre-select one.** Offer the
  case's `choices`. A `proposal` on the case is design's data, shown beside them and never marked,
  defaulted or applied for the engineer. Ask about ambiguity, and leave open what the reply does
  not clearly address.
- **Code and training never reach the judge.** Never pass test code, a diff of the code, training
  or your own notes; the framework supplies only the unit's CLI-built brief as task content.
  Delegates launch fresh and non-forked, with automatic startup loading of user, project and local
  CLAUDE.md disabled and without parent auto memory. Read is not path-confined; hooks and
  instructions loaded during file access remain residual channels. Qualified live (`docs/support.md`).
- **The commit follows the project's Commit mode through `scan.mjs commit`, never retried with `--no-verify`: never run git to stage or commit yourself.**
- **Ask for the engineer's name; never stamp a name the engineer didn't give.**
- **The quick path runs in this conversation.** Delegates only judge and write cases; never hand its forecast, Rule edits or walk to a Delegate.
- **Rules change only through `/qa-deep-dive`'s procedure,** and cases are written only through
  design's Delegate, so the Conventions, the agreement brief and the Tier apply.
- **One run dir per change.** Name it once with `impact quick`, and pass it to every call.

## The CLI

Run from the repository root (`--root` defaults to `./.qa`); each call prints one JSON object:

```
node <this skill's directory>/../../scripts/scan.mjs <mode> ...
```

Commands that read input take it from a file: write it outside the repository (the run dir or your scratch directory) and pass its absolute path as `--input <file>`. Run each command as one plain `node` line, with no pipe, heredoc, `&&` or `;` chain, variable prefix or `cd`.

- `impact entry [<feature-key>] [--persist] [--review [<feature-key>]] [--target <ref>]`, the engineer's arguments as given
- `impact quick [--dir <run-dir>]`, then `impact quick-check <feature-key> --dir <run-dir> --input <file>`
- `impact plan [<feature-key>] --persist --dir <dir>`, then `impact persist --dir <dir>`
- `delegate resolve|start|next|record ...`, the shared delegation procedure
- `design walk --dir <dir> [--by human:<name>] [--case <key>]`
- `design triage --dir <dir> --input <file> [--case <key>]`, JSON decisions in the `--input` file
- `design page --dir <dir>`; `design page-reply --dir <dir> --input <file>`, the pasted Reply unchanged
- `design checkpoint --dir <dir>`

**`ok: false`**: `refusals` carry a `code` and facts (including shared guards). Word them in your own
words and say what to do next. A refused
triage wrote nothing: resolve refusals and retry. If the case changed,
run `walk` and obtain fresh answers. Elsewhere, stop.

## Entry

An old invocation is answered, never run: Entry refuses it; do not run the retired flow.
Run `impact entry` with the engineer's arguments as given, before anything else. With `route: quick`,
go to the quick path. Otherwise word each refusal from `code` and its `replacement`, and stop:
`--persist` and `--review` are `/qa-design <feature-key>`'s, which settles open findings and
`--review` (unreviewed and Review overdue cases); `--target` has no replacement, since the judge reads
the committed knowledge at HEAD; a call with no Feature key is `/qa-next`'s question.

## The quick path

1. **Open.** Run `impact quick [--dir <run-dir>]`, with the engineer's `--dir` if an escalation or an
   earlier run named one. Its `dir` is the change's only run dir: pass it to every later call, and
   print it for `/qa-deep-dive` and `/qa-design`, which reuse it. `design_dir` is design's own run
   inside it. `train` holds impact's Practices, which you follow throughout; `threshold` is the limit.
2. **Forecast and Rules.** Follow [`/qa-deep-dive`](../qa-deep-dive/SKILL.md) §1 to §9 on the Feature
   and References: intake, Impact forecast, amendment inventory, walk, Rules, `deep-dive check`, the
   written file. Keep its Invariants. Skip its `reconcile` and its close, which step 3 replaces.
3. **Scope.** Pass `{"forecast": {...}, "references": ["<URI>"], "open_questions": [...]}` to
   `impact quick-check <feature-key> --dir <dir> --input <file>`: the confirmed forecast (`widened` and `by`
   as `deep-dive reconcile` takes them), every Reference's URI and each question still open. Word every
   section in order and settle its findings as the deep-dive
   re-run reference says. The engineer may confirm **one** downstream Rule to edit in this run: edit
   it, `deep-dive check` its Feature, and run `quick-check` again with that Feature's key.
4. **Threshold.** When `over` is true, `handoff` is written: over the threshold, stop and never go on. Write
   the handoff and give `/qa-deep-dive`'s command (`next_step`): offer it once; run it on yes, else stop. When it is
   not, go on.
5. **Checkpoint 1.** Checkpoints follow the Commit mode: run the next step only once the checkpoint
   commit exists; under `auto` the CLI makes it and the run goes on. Make `quick-check`'s
   `changeset.commit`, the Rule edits, as [the commit reference](../references/commit.md) says.
6. **Store and judge.** Persist only into the run dir that holds the confirmed forecast (`plan --persist`
   refuses a Rule whose statement changed without one: run `quick-check` into the same dir again).
   Run [the judge step](#the-judge-step) with `impact plan --persist --dir <dir>`
   (with the Feature key when `quick-check`'s `next_step` names it), then its Dispatch, and
   `impact persist --dir <dir>`. Report as its Report does.
7. **Settle.** Follow `/qa-design` §1's settlement from its walk, step 6 having judged, with
   `design walk|triage|propose|link|rule-fix` over `dir`, and [the chat walk](references/triage.md) or [Card page](references/card-page.md) as it says.
   If a case changed, walk again: never reuse answers given before the case changed.
   **Ask the engineer for the name** their stamps carry (`human:<name>`), unless they gave it. Pass it
   once, on the first walk; the run dir keeps it for every triage. When `persist` carries
   `card_page.offer`, or the engineer asks for a Card page, or pastes a Card page Reply, follow
   [the page procedure](references/card-page.md): it places the offer in the stamp-name question.
   Otherwise, and when the engineer declines the page, follow [the chat walk](references/triage.md).
8. **Cases.** Write the new cases as `/qa-design <feature-key> --expand` does, its §2 to §5, passing
   `--dir <design_dir>` to `design split` and `design plan`.
9. **Checkpoint 2.** When the walk is `done` and the cases are written, make the commit of
   the walk's `changeset` as [the commit reference](../references/commit.md) says. Once it exists, run
   `design checkpoint --dir <dir>`: it advances each held Watermark to HEAD and prints the final
   `changeset`, which you give intact. Report `walk_unfinished` or `persist_refused` as what remains
   to settle or commit.

The engineer may stop at any step: a run stopped before a checkpoint stores nothing past the last
one, and each settled case is already on disk with its Watermark not moved. `/qa-design <feature-key>`
settles what is open, walking a Feature's open findings without judging it again.

## The judge step

In the judge step, never interactive until the walk: ask the engineer nothing until the report is shown.

### 1. Plan

Run `impact plan` as step 6 gives it. Use its `dir` in every later call. `units` counts judge units;
`train` holds impact's training (`exists`, `text`, `entries`). Follow its Practices throughout, the walk
included. When `units` is 0, skip to §3.

### 2. Dispatch

Follow `<this skill's directory>/../../scripts/delegation.md`, with `--cmd impact`, the
plan's `dir`. Dispatch every unit, however unrelated the change looks: a Delegate judges each
case, and each Feature's Rules against its Boundaries.

### 3. Report

Run `impact persist --dir <dir>`. Read
[the shared wording rules](../references/wording-rules.md), then word every section in order: copy each
Markdown table row for row, word itemised sections from their codes, facts and labels, and give any
reasons, notes, failed units and re-run command present. Then settle (step 7).

### 4. Close

End the run, or the walk when the engineer stops it, by offering `/qa-train impact` if the
session taught `/qa-impact` something (a correction, or an answer it would otherwise ask again).
On yes, invoke it.
