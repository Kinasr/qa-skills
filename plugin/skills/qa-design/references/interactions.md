# Two-layer design and ambiguity

Read this before Phase 1, when reviewing filler replies, and after `/qa-deep-dive` returns a
Rule answer. Apply the built-in strategy before project Conventions refine its form.

## Agree and fill

Propose atomic coverage of each Rule's partitions, boundaries and negative conditions, plus
interaction and journey coverage across several Rules. Size both as one manual pass (ADR-0038).
A scenario's subject may be a journey or a cluster of interacting Rules. Assign every Rule involved;
an interaction or journey case asserts only what the interaction produces, without duplicating
atomic outcomes. A journey needs an interaction outcome of its own, not a collection of atomic
checks. Review semantic overlap across scenarios as well as within one.

At Phase 1, list the conflicts visible from the Rules, quoting the implicated statements and
naming the combined outcome they leave unclear. Show these questions at the agreement gate for
`/qa-deep-dive <feature-key>`. Preserve them in the scenario's agreement remarks so the filler can
return the same question and held proposal. Do not ask the filler to resolve intent. Derive
interaction cases only from stated Rules; only the case that needs the answer waits. Continue the
agreement and design of settled cases.

## Filler questions and the Run

A filler may return `questions` alongside `cases` and `proposed_rules`. Each question has `text`,
`rules` (distinct live implicated Rule keys), and `held_case`: `summary`, `covers` containing every
implicated Rule, and optional `preconditions` and `steps` lists. No Expected result is demanded
from a held proposal. Keep it out of `cases`. This is Run data, never a Test Case or a proposed
answer. Pass the reply unchanged. The contract validates questions and the writer saves them in
`<scenario>.written.json`; other settled cases remain usable. A question-only reply ends in
`awaiting_rules`, including on regenerate: it replaces and retires nothing.

A filler may also return `check_gaps`: `{case, needs}` entries naming one of its own cases by summary
and what checking its Expected result needs of the test environment. They are Training's knowledge,
never a proposed Rule: show them with `check_handoff`, and never send them to `/qa-deep-dive` in
place of a behaviour gap a Rule must state.

Run `design report --dir <dir>` as usual. Show its `questions`, each implicated Rule and held
proposal, then its `question_handoff` command. The report writes `design-questions.json` in the
Run. `/qa-deep-dive` reads it with `deep-dive resume --dir <dir>` and uses the existing Feature
`## Open questions` mechanism. There is no new Finding kind. Never edit Rules or park Feature prose
from design.

## Pick up the held case

After the deep dive, run `design resume --dir <dir>` using the original design Run. Keep that dir
when a later deep-dive settlement uses another. A still-parked question or unchanged Rule claims
returns `waiting`; do not fill its expected outcome. `ready` offers the held proposal and its
`rerun` command after Rule claims change and the question leaves Open questions. This is a cue to
reconsider, never proof of resolution: read the Rules and verify that they now answer the question.
A different Rule edit, a removed Rule or a cleared question alone supplies no missing behaviour.
If still unclear, hand it back and leave that case held.

For an answered question, offer the proposal again with its answering Rule in `covers`. Use the
returned scoped rerun, a fresh agreement and a fresh Run: the original agreement's basis is stale.
Include the held proposal in the new agreement's remarks so it reaches the filler. Use `--expand`
when settled cases already populated the scenario, otherwise fill. Write the case through the
normal reply contract; never copy a held proposal directly into knowledge. Keep all other cases.
