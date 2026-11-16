# Re-running /qa-deep-dive on an existing Feature

A re-run updates the Feature in place, changing only what this run settled:

- **Sources**: append the new References, deduplicated. Keep every existing one.
- **Rules**: edit a statement in its item's first line, under the same key. Append a new Rule at the
  end of `## Rules`, with a new key.
- **Deferred**: keep and show the list in amendment mode; reconcile every item only in a full
  inventory, following [the Deferred reference](deferred.md).
- **Proposed Rules**: keep them in amendment mode unless the engineer pulls one in; a full inventory
  settles every one, so its draft's `check` shows no `proposed_rules_left`.
- **Open questions**: remove each one this run answered, in the same file. Keep the rest.
- **Narrative**: update it where the new References change the picture.
- **Bookkeeping** (`suite_key`, `watermark`, `finding`, an existing `mirror`, `formerly`) stays byte for byte as
  it is. `coverage_digest` is written afresh from `deep-dive check`.

## Pick up Deferred functionality before the forecast

When the Feature has deferred items, list them before the Impact forecast and ask which this run
picks up. Picking any goes straight to the full inventory, skipping amendment selection. The
engineer's choice decides; matching the run's References to an item's Reference never decides a
pick-up, even when several items share one Reference. Forecast existing Rules before editing them
as usual, while keeping this run in full inventory mode.

A `--focus` naming a Deferred item answers the pick-up question: run the full inventory, retaining
existing Rules and the other deferred items in the light pass. A focus on functionality that
already has Rules feeds the Impact forecast; amendment mode applies as usual. A focus matching
neither is new functionality: run the full inventory with the focused and light passes. Apply the
Deferred reference's unmatched-focus check against the References before walking.

## Retiring a Rule

Retiring needs the engineer's approval, every time:

1. List each case in the Rule's `covered_by` (from `deep-dive feature`) by key, scenario and file,
   and ask.
2. Only on an explicit yes, delete the Rule's item and append its key to the frontmatter `retired:`
   list.
3. Tell the engineer that the Scan now reports an Integrity error on each of those cases, since its
   `covers` names a Rule that no longer resolves, until its `covers` is edited.

## Impact forecast

On every change to an existing Feature, even when the engineer names the Rules, forecast before any
edit. The forecast reads Rules only, never Test Cases: take the Feature's current Rules from
`deep-dive feature` and sort each into one band.

- **Changes**: the new References plainly alter it.
- **May change**: you are not sure. Ask about it; a doubtful Rule never lands in Unaffected.
- **Unaffected**: the References leave it alone.

Show the three bands and, for each Rule in Changes, how it changes. The engineer confirms the forecast
and each change before any edit, and may move Rules between bands. Ask which confirmed Rules now claim
more than before: those are **widened**, and only the engineer's answer makes one so. The forecast
lives in this conversation: never write it to a file, the Feature or a run dir. The Rule edits are the
record; only `reconcile` writes the confirmed answer for an edited statement, below.

## Amendment mode

When the confirmed Changes and May change bands name fewer Rules than the Feature holds, inventory only
the Rules in play: run `deep-dive amend <key> <rule>...` with every Rule of those two bands. Build the
inventory from its `rules` and `cases` alone, reading each listed case's summary and Expected-result
paragraph, and reconcile only those; `omitted` counts what stays untouched. A Rule outside the bands
that the References contradict joins the bands once the engineer confirms it, and `amend` runs again.
With every Rule in play, or no Rules yet, run the full inventory.

The full inventory also applies when the pick-up choice or new functionality requires it, even
with only some existing Rules forecast to change. Amendment mode keeps and shows every deferred
item without reconciling the list.

## Reconcile after writing

Once the draft is written, pass the confirmed forecast to `deep-dive reconcile <key> --input <file>`:
`{"changes": [...], "may_change": [...], "unaffected": [...]}` of local Rule keys, and name the change's
run dir with `--dir <run-dir>`: reconcile records there the forecast of each Rule whose statement was
edited, and the settlement refuses a statement edit without one. For the widened Rules
add `"widened": [...]` and `"by": "human:<name>"`; reconcile
records them as Run data for `/qa-impact`, and the close prints its `change_file`. Then settle each list
with the engineer:

1. `outside_band`: show each Rule edited while forecast Unaffected or in no band, with its `kinds`; the
   engineer confirms the edit or reverts it.
2. `unedited_changes`: ask whether each forecast change was dropped on purpose.
3. `boundary_check`: compare each Rule with the Boundaries beside it. Quote any Boundary a Rule
   crosses, as the scope decisions reference says, and revise the Rule unless the engineer says yes.
4. `downstream`: show each Rule with its Feature and statement, then `next_feature` and its `summary`.
   The engineer runs `next_feature.command` in a run of its own.

A Rule changed after the forecast reruns `check` and `reconcile`.

## Questions handed off by design

A design Run's `deep-dive resume --dir <run-dir>` returns `design_questions`, each with text,
implicated Rules and a held case proposal, plus `open_questions` for the walk. Read those Rules;
the proposal is context for the question, never evidence or an Expected result. Continue the
existing forecast and interview with the Feature's References. Only the engineer settles intent
or parks. Park an unanswered design question as a numbered, category-tagged item under the
Feature's `## Open questions`, retaining its question text and implicated Rule keys. Reuse the
existing Parked question mechanism; add no Finding kind. A held proposal stays in the design Run,
never under a Rule or as a Test Case.

When the engineer answers, write the settled Rule through the usual draft/check/write procedure
and clear only the answered question. At the close also offer `design resume --dir <run-dir>`
with the original design Run so `/qa-design` can reconsider its held proposal. Other cases were
usable throughout; the answer does not call for regenerating them.
