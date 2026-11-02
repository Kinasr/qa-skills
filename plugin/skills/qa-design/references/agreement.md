# The design agreement

Every `/qa-design` run settles one **agreement** before it writes: Phase 1 for a new Feature, the
audit for a populated one, and a **local agreement** for a scoped run (one scenario, `--expand` or
`--regenerate`). The agreement is Run data, never knowledge: `design agree` validates it and returns
the canonical agreement, the planned and actual coverage views, its `refusals` and `gaps`, and
writes nothing.

## The proposal

Send `design agree feature --stdin`, or `design agree <scenario-key> --stdin` for a scoped run, one
JSON object:

```json
{"v": 1, "feature": "<slug>", "scope": "feature",
 "scenarios": {
   "<scenario-key>": {"action": "fill" | "expand" | "regenerate",
                      "summary": "<new scenario only>", "levels": ["<level>"],
                      "rules": ["rule_…"], "highlights": ["rule_…"], "remarks": ["…"]},
   "new:1": {"action": "fill", "summary": "<one line>", "levels": ["<level>"],
             "rules": ["rule_…"], "highlights": [], "remarks": []}},
 "retained": {"rule_…": ["<scenario-key>"]},
 "handoffs": {"proposed_rules": [{"statement": "…", "why": "…"}],
              "coverage_corrections": ["…"]}}
```

- `levels` is a non-empty list from `project.stack.levels`. Every case names exactly one of those
  levels; the scenario file carries no level. Report `missing_levels` entries with code
  `agreed_level_without_cases` when an agreed level got no cases.
- `rules` are the scenario's assignments: the Rules its cases take coverage responsibility for.
- `highlights` are the Rules elsewhere in the Feature that constrain those assignments. They are
  attention guidance: the whole Feature still governs every case, and an empty list never means none.
- `retained` maps a Rule already covered by a kept case to the scenarios that keep it, so the
  allocation map shows the whole Feature.
- `handoffs.proposed_rules` are behaviour claims that need a Rule; `coverage_corrections` are
  one-line Coverage corrections for `/qa-deep-dive`.

## Scope and actions

A whole-Feature run (`scope: "feature"`) — Phase 1, the audit, `--expand` or `--regenerate` —
assigns every uncovered non-Waived Rule and every non-Waived Rule whose only coverage a regenerate
replaces. The audit proposes those assignments; a Rule with no case is a gap to fill with a case,
never a reason to write one without a Rule. The agreement names every scenario the run will touch: a
scenario it leaves out keeps its cases and is reported, never silently regenerated.

A run with a selected scenario passes that Key as `scope` and assigns only that file's obligations:
the Rules it covers today, those its regenerate would leave uncovered, and those the engineer adds.
The Feature's other gaps come back in `gaps`, reported and never refused.

`fill` creates the empty file's cases, `expand` adds to a populated file, and `regenerate` replaces
its unreviewed cases without an effective Tracker key. A `new:N` entry is always a `fill` and
carries a one-line `summary` and wanted `levels`.

## Confirmation and the recorded basis

Word the returned `views` (actual and planned coverage) and `refusals` for the engineer; fix what a
refusal names and send it again. On confirmation, pipe the canonical `agreement` to
`design split <feature-key> --stdin` and keep the run `dir` and `agreement`. `design agree` computes
the agreement's `basis`; `split` records it, and `plan` refuses a stale one.

## Remark authority

A remark is the engineer's note on a scenario. It never changes the knowledge.

- An **allocation remark** moves work between scenarios; it never erases an obligation the
  agreement assigns.
- A **form remark** shapes how the cases are written; it never contradicts a Convention or an
  Invariant.
- A **behaviour claim** is a proposed Rule for `/qa-deep-dive`, never a case's premise.
- A correction that must survive a regenerate becomes a Rule or a Convention before the run ends.
