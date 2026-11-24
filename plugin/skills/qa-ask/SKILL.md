---
name: qa-ask
description: Answer a Business question by quoting the knowledge layer's governing Rules.
disable-model-invocation: true
---

# /qa-ask

`/qa-ask "<question>" [--feature <key>]`

## Invariants

A Practice that contradicts an Invariant is void.

- **Migration preflight:** on every path where the command's JSON carries `migration`, read it
  first. If `pending`, warn using `migrations` in order; continue the command.
- **Read-only retrieval:** answer in chat as an unrecorded retrieval aid that never replaces
  `/qa-impact` or its judge; never writes `.qa/`, a run dir or the tracker.
- **Never runs another command.** Run only the CLI calls below; display supplied routes.
- **Run it yourself, in this conversation**, without a Tier or subagent.
- **Sources are Features and Test Scenarios.** Never reads the code, the tracker,
  `observations/`, `mirror:` values or Training as a source.

## Read and run

Read `.qa/train/ask.md` before starting, if present. Its Practices shape how it works and never
supply a claim.

From the repo root:

```
node <this skill's directory>/../../scripts/scan.mjs ask [--feature <key>] [--root <qa-dir>]
```

Pass the supplied Feature key and root. On a refusal with `refusals`, word each entry from `code`
and facts and stop; on `ok: false` with `sections`, word every section in order — an error is never a
knowledge gap — and stop (even after a migration warning): the catalogue cannot establish that no
Rule governs the question.

## Select and answer

Use [shared wording rules](../references/wording-rules.md). The Feature hint never filters, so
select governing Rules across Features (ordered by the hint, summaries and Dependencies). Verify
quotes and citations in the permitted files. Word every section in order and omit empty sections:

- After choosing from the catalogue, read only the cited Feature files, the chosen Rules' covering
  Test Scenarios and cited nearby cases' Test Scenarios. Rule elaboration explains the statement and
  adds no claim; never fetch provenance References.
- **Quote each governing Rule verbatim**; never restate it or infer what it implies.
- **A Rule with a Waiver is deliberately untested:** give its reason, never recommend a case for
  it, and exclude it from coverage gaps.
- **Use a Test Case only as an example of a cited Rule**, or cite a nearby case as "found nearby",
  never as the answer; a Test Case never stands in for required behaviour. Cite covering or nearby
  cases with their Test Scenario label and render each case's trust note as supplied (provenance,
  Review freshness, due date, findings), including absent provenance. A void Review is never shown
  as reviewed.
- **No verdicts:** report stored findings by status — recorded open Conflict: report as recorded
  with the open-Conflict route; holding Dismissal: report as dismissed, no route; Rule against
  case or case against case: "possible Conflict, not judged", quote both sides with the
  possible-Conflict route (fill its `<case-key>` with the quoted case's Key; the engineer names
  `<run-dir>` and runs it, which escalates the case to the judge); two Rules that disagree:
  "unsettled Rules" with the unsettled-Rules route, across Features too.
- **Citations inline on every statement:** Key label, `file:line`, trust note. Lead with the gap
  when nothing answers the question; for a partial answer, state the remaining gap alongside the
  cited quotations (waived Rules are not gaps).
- **Cite a matching Parked question as an open Parked question: asked before, still open**
  (text, repo-relative file and line, Feature label, trust note). Prose under `## Open questions`
  is cited only as an open Parked question, never as settled intent.
- **Render trust notes, routes and errors only as the CLI supplies them**; retain their evidence
  and locations and add no routes. Pick the route by case — matching Parked question: Feature's
  Parked-question route; Feature silent or partial: Feature's gap route; no Feature: the no-Feature
  route — and render steps verbatim in order.

End after the answer and any supplied routes.
