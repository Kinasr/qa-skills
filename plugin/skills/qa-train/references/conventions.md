# Conventions

A **Convention** is a statement about the *form* of what the agent writes (its phrasing, its
granularity, the permutations worth writing): a Test Case for design, test code for code gen.
Design's Conventions live in `train/design.md` and `/qa-design` inlines every one of them into every
design unit's brief, so each Convention in `train/design.md` shapes every generated case. Code gen's
live in `train/codegen.md`; [the Codegen reference](codegen.md) says what they add.

## Read the evidence

On a scenario-evidence run, run the `evidence` call that matches the arguments. (A conversation run
on `design` has no scenario evidence: its evidence is the engineer's own words, as the Practices
reference says.)

- **`ok: false`** (`no_cases`, `no_changes`): print its `error` and stop. There is nothing to learn
  from, so write nothing.
- **Exemplar** (`source: exemplar`): the scenario is treated as the golden example of house style.
  Read `exemplar.text` in full.
- **Changes** (`source: diff` or `uncommitted`): each entry of `changes` is one scenario file with
  its stripped `diff`, and each of its `cases` has its `before` and `after`. A case whose
  `generated_by` names a Delegate (`delegate:…`) and was `modified` is an engineer's **fix** to a
  generated case. Fixes are the strongest evidence: each one is a literal delta between what the
  generator wrote and what the engineer wanted. Other changes are weaker evidence. Bookkeeping
  (`mirror`, `review`, findings, Watermarks) is already stripped, so a tracker refresh is never a
  change.

## Derive proposals

Look for what the evidence does *consistently* with the **form** of its cases: how summaries are
phrased, how many outcomes an Expected result states, how steps are cut, which permutations get
their own case, what is left out. A form seen once is weak evidence; say so. Every proposal comes
from the evidence; grilling at the gate only confirms it. You are done when every fix sits behind a
proposal or is named as a one-off.

What a Convention adds to the shared proposal shape (SKILL.md §1):

- its **sources** start with the case keys it was learnt from, in the order you used them (a
  dictated one has `human:<name>` alone);
- it carries at least one **minimal fenced example** of the facet it governs (a summary line, a
  step snippet, a permutation list), never a whole Test Case. A **prohibition** ("never …") carries
  an **anti-example**, marked as the wrong form. A formatting convention carries a worked example or
  a before/after pair.

## The Statability Test

A Convention must be statable **without naming any part of the system under test**: no role name
from `roles`, no endpoint path, payload field, status code, domain error string, tracker key,
Feature, Rule or a term the Rules use for the system. Schema field names (`level`, `roles`,
`steps`, `expected`, `covers`, `automatable`) and the values in `levels` are allowed. Fenced
examples are exempt, because a real exemplar names real things.

Apply it to every proposal's statement and rationale. A proposal that fails is **refused as a
Convention**: restate it as a proposed Rule, one sentence, for the gate's hand-off to
`/qa-deep-dive <feature-key>`. For example, "always assert 202 on upload" is a claim about one
endpoint, not a Convention. A selector, URL or value literal for the system takes the second route:
refuse it with "page facts live in the test code", with no hand-off, because the page's own facts
belong in the test code rather than in Training.

## The coherence pass

Every run that writes `train/design.md`, a conversation run included, reads every Convention, old
and proposed, together: look for pairs that contradict each other, overlap or have drifted, and
apply the Statability Test to every old Convention again. Flag old ones too, not only the new ones.
Each is a coherence finding for the gate.

## Settling `statability` hits

`check` lists each mechanical hit on every Convention (a tracker key, status code, role name, `.qa/`
key, Rule term or endpoint path in its statement or rationale), with its `status`:

- **`added` or `edited`**: treat the hit as a refusal, unless the engineer confirms it names
  nothing in the system (for example, a length limit that reads as a status code). Then check
  again.
- **`unchanged`**: if the gate did not already settle it, put it to the engineer as a coherence
  finding (reword it, or remove it and hand it to `/qa-deep-dive`), and never block this run's
  write on it.
