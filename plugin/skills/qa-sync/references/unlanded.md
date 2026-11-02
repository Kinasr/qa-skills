# Unlanded cases and Suites

The Card checks marked tracker items only on the default branch. A marked item holds the Key
`/qa-publish` wrote in the mark field. A Test Case whose marked Key `.qa/` lacks is an Unlanded
case. A Test Suite marked with a live Suite key no Feature holds, and that no Feature names in
`mirror.suite`, is an Unlanded Suite. Word the skipped-check note the CLI supplies.

An Unlanded case is a Divergence with three resolutions. Leave `resolution` unanswered until
the engineer chooses; accepting the Card alone does not choose a resolution.

- **Tracker intake**: set `resolution` to `intake`. Show `intake`'s defaults, questions and any
  scenario it creates. Answer its `level`, `roles`, `scenario` and `feature` questions as needed.
  It transcribes the fetched case unreviewed under the Key its mark holds, with the tracker key
  beside it; a scenario it creates keeps its own marked Key too. `report.intaken` lists each Key,
  `reused` when it came from a mark. A missing tracker summary must be supplied by a person in
  the tracker before fetching again.
- **Retired by hand**: set `resolution` to `retired_by_hand` when the engineer says they retired
  the tracker case themselves. This records only a report note; it makes no tracker or `.qa/`
  edit. If the next fetch still finds the marked case, it is reported again.
- **Dismissal**: set `resolution` to `dismiss`, with `by` as the engineer's supplied `human:<name>`.
  Answer `dismiss`'s Feature question when present; `reason` and `ticket` are optional strings.
  The CLI records a Feature-level Divergence with the case as its subject, pinned to HEAD like
  any other Dismissal. No tracker edit follows.

## Unlanded Suites

An `unlanded_suite` item is a Divergence with three resolutions, from `choices.suite_resolution`.
Leave `resolution` unanswered until the engineer chooses.

- **Attach**: set `resolution` to `attach` and `feature` to one of `choices.attach_feature`. It
  writes the Feature's `mirror.suite` as [Attach](attach.md) does, queues the remark for
  `/qa-publish`, and retires the Suite's own mark (`mark`) in `retired_features`.
- **Retired by hand** and **Dismissal**: as for a case; the Dismissal's subject is the Suite.

The Suite is never taken in as a new Feature: only `/qa-deep-dive` writes one. An Unlanded case
showing `unlanded_suite` sits under that Suite: its Feature follows the Suite's Attach. Present it
as depending on that Attach; without the Attach, ask the engineer for its `feature`.

`drop` leaves the case or Suite unresolved. The tracker stays read-only for every resolution. Include
`report.notes` in the closing report.

## Marks reported, never taken in

A Divergence whose `code` starts `unlanded_mark_`, or is `unlanded_scenario`, has no item and no
resolution. Each carries the item's `kind`: `case`, `scenario` or `suite`. Word each from its
`why` and `mark`, and tell the engineer the fix lies in the tracker:

- `unlanded_mark_retired`: the mark names a Retired key. The engineer retires the tracker item.
- `unlanded_mark_malformed`: the mark is empty or is no Key. The engineer corrects the field.
- `unlanded_mark_wrong_kind`: the mark, or the item's issue type, belongs to another kind.
- `unlanded_mark_unmappable`: a legacy `new_…` mark that no single Key of `.qa/` records.
- `unlanded_scenario`: a marked Test Scenario `.qa/` lacks, with no Unlanded case under it.
