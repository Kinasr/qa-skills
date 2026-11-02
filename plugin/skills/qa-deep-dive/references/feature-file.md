# The Feature file

```markdown
---
type: feature
key: <slug>
suite_key: <minted su_ key>
coverage_digest: <the digest deep-dive check returns>
mirror: {group: <the Group-level issue's summary>, at: <YYYY-MM-DD>}
retired: [rule_…, boundary_…]
generated: {by: human:<name>, at: <YYYY-MM-DD>}
sources: [tracker:DEMO-1, file:docs/import.md, human:<name>]
---

# <Feature name>

<Narrative prose: what this area of the system does, which References it came from, and the
scope it covers.>

## Rules

### rule_<key>: <statement carrying the whole claim>
Depends on: <feature_key>/<rule_key>
Waived: <reason>

## Boundaries

### boundary_<key>: <statement>
Owner: <feature_key | none>

## Coverage

- <key>: covered by <rule_key>[, <rule_key>…][; n/a for <functionality>: <reason>]
- <key>: n/a: <reason>
- <key>: awaiting

## Deferred

- **<functionality as a verb phrase>**: <reason>. From: <reference uri>[, <place>]

## Open questions

1. **<question>**: <what the References say, and why it is still open>
```

- **Bookkeeping** (`suite_key`, `watermark`, `finding`, `coverage_digest`, `mirror`, `formerly`) is the framework's. Write a
  `mirror` for a new Feature only, and only when a fetched tracker issue is of the Group-level type
  in `project.tracker.issue_types` (the first of Suite / Scenario / Case). With no `issue_types`,
  write no `mirror`. `coverage_digest` is written by the run: copy the `deep-dive check` result
  into the draft.
- **Coverage** records what the deep dive considered for walked functionalities only; when stating
  it, say that limit and give `deferred: <n>`, including zero. Write one line per effective category in walk order,
  as `deep-dive feature` returns them in `categories`. It claims no behaviour. A category is
  `covered by` the Rules that apply, a Waived Rule included; an `n/a` says why the Feature has no
  behaviour of that kind, naming the scope considered or the Boundary that hands it elsewhere; an
  `awaiting` line needs an open Parked question tagged `[<key>]`, and a tag on any other category is
  refused. Aggregation is `awaiting` > `covered` > `n/a`; a Waived Rule counts toward "covered by
  Rules", never toward case coverage. Omit Coverage only on a Feature that never had one; a re-run
  never drops it.
- **Deferred** holds one list item per whole Deferred functionality, using the syntax above: a
  non-empty verb phrase, reason and Reference URI, with an optional place. Each URI is listed in
  `sources`. It claims no behaviour and has no keys. Omit the section when empty. Follow
  [the Deferred reference](deferred.md) when a full inventory defers or reconciles items.
- Omit `retired`, `## Open questions` and every other empty collection. Never write `[]`.
- A Boundary's `Owner:` is its first non-blank line and names another existing Feature.
  `none` hands the behaviour to no Feature.
- A Waiver and a Dependency share a Rule's field block: contiguous `Waived: <reason>` and
  `Depends on: <feature_key>/<rule_key>[, <feature_key>/<rule_key>…]` lines at its first non-blank
  line, in either order. `Waived:` records why the Rule has no Test Case; keep the Rule.
  `Depends on:` names the Upstream Rule the Rule rests on, in another Feature; keep the local Rule,
  whose statement carries the behaviour. A broken Dependency is the Scan's to report, for the
  engineer to settle.
- Mint each Boundary key with `mint boundary --feature <slug>`. Keep it stable; add a withdrawn key
  to `retired:`.
- `generated.at` is today; a re-run refreshes it and keeps `generated.by`.
- Stay inside the YAML dialect: no comments, no block scalars, and quote any value that holds
  `: `.

