# Practices

A **Practice** is a statement about how the agent should *work* while running one command: which
tool to fetch with, what to read, what to always ask. It may name where to look or what to ask about
("for import Features, read the ENG wiki space"). It lives in `train/<target>.md`, and the target
command reads that file before it starts.

## Read the target

Run `evidence <target>`. Its `train` holds the file as it stands: whether it `exists` and its
`practices` (for `design`, its `conventions` too). Then read the target's own skill in full, at
`<this skill's directory>/../qa-<target>/SKILL.md`. You are done when you hold every bullet of its
`## Invariants` section, word for word: the rules no Practice may override.

## Mine, or have the engineer dictate

- **Mine** when this conversation ran `/qa-<target>` or worked on what it does: collect every
  correction the engineer gave, every answer you had to ask for that a later run would need again,
  and every way of working they asked for. Quote each one back as the evidence for its proposal.
  You are done when every correction in the conversation sits behind a proposal or is named as a
  one-off.
- **Dictate** when the conversation holds nothing for the target: ask the engineer what they want
  `/qa-<target>` to do differently, and take their answers as the evidence. You are done when they
  say there is nothing more to add.

While mining, note what the conversation taught **other** targets, for the close's next runs.

On `design`, an item about the form of a Test Case is a Convention, not a Practice: shape it as
[the Conventions reference](conventions.md) says under "Derive proposals" and give it the
Statability Test. Run that reference's coherence pass on every `design` run, so the existing
Conventions are re-checked too.

A Practice's sources are `human:<name>`, and its example is optional.

## Two refusals

Test every proposal against both:

1. **It states a fact or a default about how the system behaves** ("imports are capped at 10 MB",
   "Guests can't renew"). That is a Rule. Restate it as a proposed Rule, one sentence, for
   the hand-off to `/qa-deep-dive <feature-key>`.
2. **It contradicts one of the target's Invariants** ("when a linked page fails to load, carry on
   without it" against deep-dive's "Halt on any failed Reference"). Quote the Invariant, word for
   word, as the reason.

A proposal that names a role, a page or an endpoint as *where to look* passes: it claims nothing
about how the system behaves.

For `impact`, "Always offer a Card page" or "Never offer a Card page" describes how the agent works,
so record it as a Practice in `train/impact.md`. So is the quick path's limit (the Rules plus Stale
cases it takes before handing off to `/qa-deep-dive`, 10 by default); word it "Quick path threshold:
<number>", since `impact quick` reads that number. For `next`, "Always offer a Next steps page" or
"Never offer a Next steps page" belongs in `train/next.md`. Each takes no Statability Test; that
test applies only to Conventions. The target's page procedure resolves whose offer preference
wins; an explicit page request still gets a page.

## The coherence pass

Read every existing Practice against the target's *current* Invariants, since a skill update can
make an old Practice void, and against the other Practices. An old Practice that now contradicts
an Invariant (refusal 2) is a coherence finding for the gate: reword or remove it, with the
Invariant quoted. You are done when every existing Practice has been read against every Invariant.
