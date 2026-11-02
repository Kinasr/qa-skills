---
name: qa-ask
description: Answer a Business question by quoting the knowledge layer's governing Rules.
disable-model-invocation: true
---

# /qa-ask

`/qa-ask "<question>" [--feature <key>]`

## Invariants

A Practice that contradicts an Invariant is void.

- **Migration preflight:** on every path where the command's JSON carries `global`'s `migration`,
  read it first. If `pending`, warn using `migrations` in order; continue the command.
- **Never writes `.qa/`, a run dir or the tracker.** An unrecorded retrieval aid that never
  replaces `/qa-impact` or its judge.
- **Never runs another command.** Run only the CLI calls below; display supplied routes.
- **Run it yourself, in this conversation**, without a Tier or subagent.
- **Read `.qa/train/ask.md` before starting**, if present. Its Practices shape how it works
  and never supply a claim.
- **Sources are Features and Test Scenarios.** Never reads the code, the tracker, `observations/`,
  `mirror:` values or Training as a source. After choosing from the catalogue, read only the
  cited Feature files, the chosen Rules' `covered_by` Test Scenarios and cited `nearby` cases' Test Scenarios.
  Rule elaboration explains the statement and adds no claim.
  Prose under `## Open questions` is cited only as an open Parked question, never as settled intent.
- **Quote each governing Rule verbatim.** Never restate it or infer what it implies.
- **A Rule with `waiver` is deliberately untested.** Give its reason, never recommend a case for it,
  and exclude it from coverage gaps.
- **Use a Test Case only as an example of a cited Rule, or cite a `nearby` case as
  "found nearby", never as the answer.**
  A Test Case never stands in for required behaviour.
- **Render each case's trust note as supplied.** A void Review is never shown as reviewed.
- **Render trust notes, routes and errors only as the CLI supplies them.** Retain their
  evidence and locations; an error is never a knowledge gap. Add no routes.
- **No verdicts.** Use `findings`' `status`:
  recorded open Conflict: report as recorded with `routes.open_conflict`;
  holding Dismissal: report as dismissed, no route.
  Rule against case or case against case: "possible Conflict, not judged", quote both sides
  with `routes.possible_conflict` (fill its `<case-key>` with the quoted case's Key; the engineer names `<run-dir>` and runs it, which
  escalates the case to the judge); two Rules that disagree: "unsettled Rules" with `routes.unsettled_rules`,
  across Features too.
- **Citations inline on every statement:** Key label, `file:line`, trust note. Omit empty sections.
- **The Feature hint never filters.** Consider governing Rules across the catalogue.
- **Lead with the gap when nothing answers the question.** For a partial answer, state the
  remaining gap alongside the cited quotations; waived Rules are not gaps.
- **Cite a matching `parked_questions` entry as an open Parked question: asked before, still open.**
  Cite its `text`, `file` and `line` with the Feature's label and trust note.
- **Pick the route by case.** Matching Parked question: Feature's `routes.parked_question`;
  Feature silent or partial: `routes.gap`; no Feature: `global.routes.no_feature`.
  Render steps verbatim in order.

## Read and run

From the repository root:

```
node <this skill's directory>/../../scripts/scan.mjs ask [--feature <key>] [--root <qa-dir>]
```

Pass the supplied Feature key and root. On usage refusal, explain `error` and stop.
Show `global`'s `schema` and `errors` next. If errors exist, explain the supplied
problems and stop: the catalogue cannot establish that no Rule governs the question.
Stop on `migration_pending` after warning.

## Select and answer

Use [shared wording rules](../references/wording-rules.md). Select governing `rules` by `statement`,
`features`' summaries, `depends_on` and `dependents`; `hint` orders them. Verify quotes and
citations in the permitted files.
Each `label`, `file` and `line` citation carries supplied `trust`, including absent provenance
(`null` and `[]`). References in `sources` record provenance; never fetch them.

For a case, cite `covered_by` or `nearby` with its `scenario` label and full supplied `trust`
(`generated`, `sources`, `review`, `review_by`, `findings`).

End after the answer and any supplied routes.
