# Attach

An **Attach** item records an existing tracker case or scenario as the `tracker:` of an unlinked
entry of the same kind. Accepting it sets `tracker:` and nothing else; the Key stays. A Suite
Attach (`attach_suite`) does the same for a Feature's Test Suite: see [Suite Attach](#suite-attach).

## Proposed candidates

Each candidate in `candidates` has a `strength` and its `evidence`. Word the evidence from the data:

- **strong**: the entry and the tracker item share the Automations listed.
- **weak**: the summaries are similar. Show both and let the engineer judge.
- **named**: the engineer named the key.

A lone candidate is the default. With several, `tracker` is an open question: edit it with the
chosen candidate's key. An entry with no evidence has no item.

## Naming a key

When the engineer names a tracker key for an entry (one with no item, one with candidates, or
one already linked), send `{"name": {"<entry Key>": "<tracker key>"}}` alone. The CLI writes
nothing to `.qa/`; it keeps the key in the run and refuses with `attach_named` and `rebuild: true`.
Then fetch again: run `scout brief tracker` and a scout, since `sync scope` now lists the key.
Run `sync card`, and show the new Card, whose item vets the fetched tracker item (kind, mark,
owner). Carry the engineer's earlier answers over to the new item numbers; ask when one is unclear.

An owned key is refused at once (`attach_owned`): ask for another. A named key the fetched item
cannot take comes back as an `attach_named_refused` note with its `reason`; word the reason and
ask for another key.

## Correcting a wrong link

Naming a key for an entry that already has a `tracker:` gives a separate `correct_tracker` item.
Show `wrong`, the key to retire, beside the new `tracker`. Accepting it records the wrong key in
the Feature's `retired:` as `tracker:…` (an alias in `tracker_formerly:` would claim it named this
entry) and attaches the new key. Offer a correction only after the engineer names a key.

## Suite Attach

An `attach_suite` item records an existing tracker Test Suite as the `mirror.suite` of a Feature
that has a Suite key and records no Suite. Accepting it writes `mirror.suite` and `mirror.at`,
keeps the other Mirror fields, never writes `tracker:`, and queues a remark in the Feature's
`repairs:`: `/qa-publish` later rewrites the Suite's mark to the Feature's Suite key, before any
create under that Suite. Say so when you show the item.

- **strong** evidence lists the Feature's linked Test Scenarios that sit under the Suite.
- **weak**: the Suite's summary resembles the Feature's title. Show both.
- `shared_with` names the other Features whose `mirror.suite` already names it; they keep it.
- `retires` is the Suite's foreign Suite key, added to `project.md`'s `retired_features` in the
  same write.

To name a Suite, send `{"name": {"<feature slug>": "<Suite key>"}}` alone, then fetch and rebuild
as for any named key. A Feature that already records a `mirror.suite` is refused
(`attach_suite_recorded`): correcting it is out of scope, so say so. A Feature with no Suite key is
refused (`attach_suite_key_missing`): `migrate-keys` gives it one. A Suite marked with another
live Feature's Suite key is owned (`attach_owned`), and the note names that Feature in `owner`.
