---
name: qa-execute
description: Execute Test Cases against an application target and record the observed results.
disable-model-invocation: true
---

# /qa-execute

`/qa-execute [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>]`

Executes live **Test Cases** against an application target. The CLI plans the selection, checks
prerequisites, handles skips, and prints a confirm. On confirmation, the CLI schedules Executions,
you spawn background **Tester** subagents to follow pinned case steps, record each reply, prompt
once for paused notes under the Access failure rule, and relay the closing summary.

`<scope>` is the engineer's arguments: Case, Scenario, Suite, Feature or Tracker keys.
With filters alone, scope is all live cases. Tags and Test levels match exact names: any-of
within each kind, AND across kinds. Give keys or at least one filter.

## Invariants

A Practice that contradicts an Invariant is void.

- **At startup, on every path**, run
  `node <this skill's directory>/../../scripts/scan.mjs migration-status [--root <qa-dir>]`.
  If `pending`, warn using `migrations` in order. Continue the command.

- **Interactive use only.** Never run unattended or in automation.
- **Nothing touches the app before the engineer confirms.** Never log in, open a session or dispatch an Execution before yes.
- **Relay confirm text verbatim.** Present the CLI-written confirm exactly as printed, without reformatting or re-deriving it.
- **Preserve selection tokens.** Pass scope keys, `tag:<name>` and `level:<name>` values exactly as given, including repeats; the CLI resolves and validates them.
- **Brief passed verbatim.** Pass the content of the file at `brief` unchanged as the Tester's prompt.
- **Omit model for inherit.** Pass `model` only when non-null; omit it when null.
- **End the turn while a Tester is in flight.** Wait for replies without taking additional turns while any Tester runs.
- **Prompt once for paused notes.** Only after draining in-flight Executions, prompt the engineer once listing every paused note under the Access failure rule.
- **Never ask for a secret.** The credential stays with the engineer: never ask for a secret, token or password; neither use nor repeat one.
- **Relay ingest text verbatim.** Present the end-of-Run summary exactly as the CLI writes it.
- **Relay summary text verbatim.** Present `execute summary`'s `text` exactly as the CLI writes it, and print nothing when it is null.
- **The CLI's work list is the only follow-up work.** Work the items `execute follow-ups` returns, in its order, and resume only the Run whose `--run` dir it names.
- **Follow-ups run in this conversation, with no subagent and no Tier.** A stopped Run: relay
  ingest's resume command and stop; no follow-up starts. An empty work list: with `counts.fix` and
  `counts.bug` both 0, go straight to the `/qa-train` offer. A chained skill relays one progress line
  per item and has no close of its own; when `/qa-codefix` ran, run `execute follow-ups --dir <dir>`
  again to pick up any hand-off's bug item, and `/qa-bug` drafts each the same way. Relay `text`
  verbatim when it is non-null; when it is null, print nothing.
- **Offer `/qa-train` once.** Make the offer in §6.5 the Run's only one.
- **Test code runs only through `execute automation`.** Never run the project's test command yourself.
- **The Automation decides the Execution.** Only a Failed aggregate Automation, or a case with no
  Automation, gets a Tester Execution; Passed, Flaky and Blocked cases finish with none.
- **The tracker is read-only except `/qa-publish`.**
- **Never stage or commit.** A dirty working tree is fine.

## The CLI

Run from the repository root (`--root` defaults to `./.qa`); each call prints one JSON object:

```
node <this skill's directory>/../../scripts/scan.mjs <mode> ...
```

- `execute plan [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--root <qa-dir>]`
- `execute confirm --dir <run-dir>`
- `execute automation --dir <run-dir> [--root <qa-dir>]`
- `execute next --dir <run-dir> [--root <qa-dir>]`
- `execute resume --dir <run-dir> --note <acc> [--skip]`
- `execute record --dir <run-dir> --execution <id> --status ok|failed|timeout|refused|quota`
- `execute ingest --dir <run-dir> [--root <qa-dir>]`
- `execute follow-ups --dir <run-dir> [--root <qa-dir>]`
- `execute summary --dir <run-dir> [--root <qa-dir>]`

**`ok: false`** on any call: nothing was executed. Each `refusals` entry provides one factual
`line` and its data; explain it and say what to do next, copying `next` intact.

## 1. Practices

Read every Practice (`prc_` entries) in `.qa/train/execute.md`, if it exists, and follow them
throughout.

## 2. Plan

Run `execute plan [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>]` (preserving root if given).

- **`ok: false`**: explain each refusal line and stop.
- **No `dir`**: all selected cases were skipped. Relay `text` verbatim and stop.
- **`dir` present**: relay `text` verbatim and ask the engineer to confirm. Wait for their answer. Nothing touches the app before yes.

## 3. Confirm

- On yes: run `execute confirm --dir <dir>`.
- If the engineer declines or cancels: stop.

## 4. Run

Run `execute automation --dir <dir>` once (preserving root if given) and relay `text` verbatim. It
runs each selected case's Automations through the project's `test_runner`, with the retry count in
`train/execute.md`. The CLI starts only the Executions that follow: a Failed aggregate Automation,
or a case with no Automation. Passed, Flaky and Blocked cases finish with none; a case with
incomplete prose records `execution_skipped` instead. On `ok: false`, explain each refusal line and
stop.

Loop:

Run `execute next --dir <dir>` (preserving root if given).

`execute next` may return `blocked` (Executions Blocked before starting, e.g. an unreachable target);
only note them, since ingest records them.

1. **Start ready Executions**: for each item `{id, brief, model}` in `start`, spawn one background Tester subagent (agent type `qa-skills:tester`):
   - **prompt**: read the file at `brief` and pass its content verbatim (its first line binds the Tester);
   - **model**: pass `model` only when non-null; omit `model` when null (to inherit).

2. **Wait while in flight**: if `in_flight > 0`, end the turn while any Tester is in flight.

3. **Record replies**: on each Tester subagent reply:
   - Determine `--status`:
     - `ok` for a `DONE` reply;
     - `failed` for a `FAILED:` reply;
     - `timeout`, `refused`, or `quota` when stopped by those harness conditions.
   - Run `execute record --dir <dir> --execution <id> --status <status>`.
   - Call `execute next` again.

4. **Paused notes**: when `in_flight === 0` and `paused` is non-empty:
   Prompt the engineer ONCE listing every paused note under the Access failure rule:
   - State the Access note key (`acc`), its affected Roles (`roles`), and the refusal `reason`.
   - The credential stays with the engineer: never ask for a secret, token or password; neither use nor repeat one. Direct them to update the credentials where `train/access.md` indicates.
   - Ask the engineer to fix the login and reply "done", or reply "skip".
   - For each answer:
     - On "done": run `execute resume --dir <dir> --note <acc>`.
     - On "skip": run `execute resume --dir <dir> --note <acc> --skip`.
   - Call `execute next` again.

5. **Completion**: when `done: true` and `in_flight === 0`, exit the loop and proceed to §5.

## 5. Ingest

Run `execute ingest --dir <dir>` (preserving root if given).
Relay `text` verbatim.

If the Run is interrupted or the engineer stops it, run `execute ingest --dir <dir>` on the same run dir and relay its text verbatim; unstarted Executions are reported as not run.

## 6. Follow-ups

Run `execute follow-ups --dir <dir>` (preserving root if given). It builds the work list once, takes
the dirty-tree snapshot, and prints the one resume command. On `ok: false`, explain each refusal
line and stop.

Then follow the Invariants' rules for a stopped Run, an empty work list and the chain.

1. Invoke `/qa-codefix --run <dir>` when the work list holds a fix item.
2. When `/qa-codefix` ran, run `execute follow-ups --dir <dir>` again, then invoke
   `/qa-bug --run <dir>` when the list holds one.
3. Run `execute summary --dir <dir>`.
4. When `publish.ask` is true, ask its one question and follow the answer: yes invokes
   `/qa-publish --run <dir>`, no leaves the drafts, and discarding runs `bug discard <bg_key…>`.
5. Offer to run `/qa-train` now on whichever target the Run made stale. On yes, invoke it in this
   conversation; on no, finish.
