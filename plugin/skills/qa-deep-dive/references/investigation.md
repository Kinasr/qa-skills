# Investigating unsettled behaviour

Read this when behaviour is ambiguous, contradictory or silent and needs more evidence.

## Channels

A channel is an evidence source for a question, never a way to exercise the system.

| Channel | Gets you | Limits |
|---|---|---|
| `observe:` | what the live application shows, through the UI scout | navigates and reads only; a part that needs input is unseen |
| `code:` | one source file: handlers, validators, API specs in the repo | what runs, not what is required |
| `file:` / `url:` / `tracker:` | a committed document, a page, or a tracker issue | what a document says, not what the system now does |
| `human:` | the engineer's answer | the only channel that settles required behaviour |

An active probe is unavailable: settle intent with the engineer or park. It confers no execution
capability. An Access note changes how a channel is reached, never what it can settle.

## Acquiring evidence

- Propose the concrete input in the plan: a file, document, bounded `observe:` target and request,
  or "ask the engineer". Fetch only what the engineer approved.
- An approved input re-enters intake under §2's rules: fetch it to completion, halt on any failure,
  and add it to `sources`. Approval covers that input alone; a linked issue is its own Reference.
- Evidence never settles intent. An Observation's fact is current behaviour and a code path is
  what runs; put either to the engineer and let their answer become the Rule.
- A part seen only in a document is documented; one no channel reached is unseen. Put every unseen
  part to the engineer.

## Asking the engineer

Ask in rounds, each holding every question you can ask without guessing an unheard answer. Number
each and give your recommended answer:

```
❓ **Q1** - **<title>**: <the question, quoting the References that disagree or fall silent>

➡️ <your recommended answer, and why>
```

Never ask for a fact you could fetch yourself. Only the engineer parks a question; an answer that
does not clearly settle it stays open.
