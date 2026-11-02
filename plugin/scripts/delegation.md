# Delegation: the dispatch procedure

Every `/qa-*` skill that delegates units of work follows this procedure: `/qa-impact` for its judge
units and `/qa-design` for its scenario fills. The skill's plan step has already written a run
directory holding `dispatch.spec.json`; this procedure turns it into replies beside it, and the
skill's report step reads them back.

The CLI owns every decision in it: which Delegate, what runs when, retries, the breaker and the
Fallback. Your part is only what the CLI cannot do: spawn subagents and save what
they return. Never retry, skip, reorder or re-dispatch a unit yourself, never judge or answer a
unit yourself, and never edit a brief, a prompt, a reply or `dispatch.json`.

`scan.mjs` below is `<the skill's directory>/../../scripts/scan.mjs`, run from the repository root.

## 1. Resolve the Delegate

```
node scan.mjs delegate resolve --cmd <impact|design>
```

It names the model each Delegate runs on: a model label, such as `sonnet`, `haiku` or `inherit` (the
session's own model), which the CLI takes from the Tier the command is bound to. A usage error: show its `error` and stop,
before anything is dispatched.

## 2. Start the Run

```
node scan.mjs delegate start --dir <dir>
```

It mints the Run id and prints the `model` the units run on.

## 3. Dispatch

Loop:

```
node scan.mjs delegate next --dir <dir>
```

- `done: true`: dispatch is over. Go on to the skill's report step.
- Otherwise, for each item of `dispatch`, spawn one subagent, all of this `next`'s items at once:
  - agent: the item's `agent`, exactly as given, as the subagent type: `qa-skills:qa-judge` or
    `qa-skills:qa-filler`. Spawn each item fresh and non-forked. Never spawn a generic agent, and
    never substitute another agent type;
  - model: none when the item's `model` is null (a Delegate on `inherit`), otherwise that label,
    exactly as given;
  - prompt: exactly the item's `prompt`, never paraphrased, shortened or added to. It points the
    subagent at the item's `brief` file, which is the whole brief.
- As each subagent returns, or its spawn is refused:
  1. Save its final message, byte for byte, to the item's `reply` path. If it errored or returned
     nothing, save the harness's error text, or nothing.
  2. Record it:

     ```
     node scan.mjs delegate record --dir <dir> --unit <unit> --attempt <attempt> \
       [--status failed|timeout|refused] [--wall-ms <ms>]
     ```

     Choose `--status` by what happened to the item:
     - `refused`: the harness rejected the model itself, so no subagent ran (an unknown label, a
       plan without that model, a harness that does not offer it). The CLI moves every unit to the
       Fallback at once, without retries.
     - `failed`: no subagent ran for any other reason, including the harness not knowing the agent
       type; or a subagent ran and errored or returned nothing. Save the harness's error text to the
       item's `reply` path. The CLI retries it.
     - `timeout`: your harness stopped it for time.
     - A subagent returned its final message: leave `--status` out.

     Pass `--wall-ms` only when your harness reported it for that subagent, as reported; never
     estimate it.
  3. Print each line of its `announcements` exactly as given (a breaker trip that moves units to
     the Fallback, or stops dispatch).
- When every item of this `next` is recorded, call `next` again. Retried units come back from it
  with their next attempt number; that is the CLI's policy at work, not a reason to intervene.

## What the Run leaves

- The replies, in the run directory (the OS temp dir), where the skill's report reads them.
- For `/qa-design`, each unit's Test Cases, written into its scenario file by the CLI as its reply
  comes back usable (never by you).
