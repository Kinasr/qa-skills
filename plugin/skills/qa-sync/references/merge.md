# Merge

Merge folds two distinct Test Cases or two Test Scenarios of one Feature into the survivor the engineer chooses.
Two declarations of the same Key are an Integrity error. Settle their bodies by hand.
Cross-Feature Merge is refused.

## Choose

A `merge_case` or `merge_scenario` item proposes two entries with the same `tracker:`.
Show both `choices` and ask which survives. Edit `survivor` with that entry's Key.
Whole-Card acceptance alone chooses none.

The engineer may name any pair with `{"merge": {"<loser Key>": "<survivor Key>"}}` alone.
This records the choice in the run. It writes no knowledge.

For a loser's distinct tracker item, choose `tracker_disposition` as `keep` or `retire`:

- `keep` adds the loser's `tracker:` to the survivor's `tracker_formerly:`.
- `retire` records `tracker:…` in the Feature's `retired:` and schedules a retire repair.

Each choice returns `merge_selected` and `rebuild: true`. Run `sync card` again.
Show the rebuilt Card before accepting its result. Carry earlier answers to the new item numbers.

## Show the result

Copy `result.text` intact. Show `retired`, `repairs` and the tracker disposition too.
The survivor supplies prose, level, primary `tracker:` and every field not unioned.
`tracker_formerly` and historical `formerly` are unioned.
The primary Tracker key and a retired tracker item are excluded from the aliases.

### Case Merge

Show `review`. The survivor supplies roles. `automates`, `covers` and `relies_on` are unioned.
The loser's unresolved findings carry over. Its Dismissals carry only where their dependencies
match the result. Other Dismissals reopen their findings.
`finding.dismissed_case` keeps the original case of a carried Dismissal's pin. The stamp stays.

Reviews never transfer or restamp. The survivor's Review is void if its compared knowledge changed.
A current `tracker:` binding outranks a mark. Remark and retire repairs go to Feature `repairs:`.
Only `/qa-publish` carries out those repairs. The tracker stays read-only.

### Scenario Merge

The loser's child cases move into the survivor's file with their Keys, Reviews, findings and
Dismissals intact. Moving a case is not a knowledge change.
Show `case_merges` as separate Case Merge proposals. Duplicate tracker bindings produce these
proposals. Offer other duplicate children as engineer-named pairs.
Apply the Scenario Merge first, then start a new sync run and reconcile its children case by case.
Never merge same-Key children automatically. `duplicate_key` needs manual reconciliation before
Scenario Merge can proceed.
Show `dependencies`. Pending remark repairs naming the loser follow the survivor throughout `.qa/`.
Sources, tracker mirrors and historical pins keep their values.
The loser's Scenario Key is retired and its file is removed. Tracker disposition and repairs
follow the same choices above.

## Accept

Accept the shown item without choice edits. Editing a choice rebuilds the Card again.
Unmentioned items stay open. Drop overlapping edits to either participant or apply them in a
separate run: `merge_pending_edit` refuses a result changed by another accepted item.
For Scenario Merge, this includes edits or intake into either file and Case Merges of its children.
`sync apply` writes the survivor, removes the loser and records retirement and repairs together.
