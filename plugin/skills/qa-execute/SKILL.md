---
name: qa-execute
description: Execute Test Cases against an application target and record the observed results.
disable-model-invocation: true
---

# /qa-execute

`/qa-execute [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>]`

The CLI plans **Test Cases**, checks prerequisites, lists skips and prints a confirm. Confirmed,
it schedules Executions: spawn background **Tester** subagents following pinned steps, record replies,
prompt once for paused notes under the Access failure rule; relay the summary.

`<scope>` accepts Case, Scenario, Suite, Feature or Tracker keys; filters alone select all live cases.
Tags and Test levels match exact names: any-of per kind, AND across kinds. Give keys or filters.
`level:<name>` runs Layer-free cases there, narrows bound cases, and reports cases bound elsewhere
as exclusions, not skips. Without `level:`, Layer-free cases use their Automations' sole resolved
level if executable, otherwise the default; when other executable levels exist, the plan names each
case, its level and the levels left out; `level:<name>` runs it elsewhere.

## Invariants

A Practice that contradicts an Invariant is void.

- **At startup, on every path**, run
  `node <this skill's directory>/../../scripts/scan.mjs migration-status [--root <qa-dir>]`.
  If `pending`, warn using `migrations` in order. Continue the command.

- **Interactive use only.** Never run unattended or in automation.
- **Relay Credential-variant results.** The Tester maps step prose to `--auth` and judges `auth_rejected` under the Access failure rule. Relay variant refusals as Blocked `step`. Wrong-role cases use Role notes; header-only sessions allow `tester request` only.
- **Nothing touches the app before the engineer confirms.** Never log in, open a session or dispatch an Execution before yes.
- **An Unguarded Run needs the engineer's own words.** When the plan reports `unguarded`, pass `{"acknowledge": "unguarded"}` to `execute confirm --input <file>` only after the engineer explicitly accepts running without the Tester guard; a plain yes is not that.
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
- **Offer `/qa-train` once.** Make the offer in §6.5 the Run's only one; across multiple Runs, one `/qa-train` offer covers every target made stale.
- **When a plan returns `runs`, execute one Run at a time in `targets` order.** Finish Automation, Testers and ingest for each Run before starting the next; follow [references/multi-run.md](references/multi-run.md) for stop rules. Across multiple Runs, follow-ups run per Run in `targets` order after every Run ingests.
- **Test code runs only through `execute automation`.** Never run the project's test command yourself.
- **The Automation decides the Execution.** Group Automations by level before scheduling and
  chaining. Only Failed aggregates or absent Automations send that level to a Tester Execution; Passed,
  Flaky and Blocked require none. The Case outcome combines results per level.
- **The tracker is read-only except `/qa-publish`.**
- **Never stage or commit.** A dirty working tree is fine.

## The CLI

Run from repository root; forward `--root` when given (default `./.qa`). Each call prints one JSON object:

```
node <this skill's directory>/../../scripts/scan.mjs <mode> ...
```

Commands that read input take it from a file: write it outside the repository (the run dir or your scratch directory) and pass its absolute path as `--input <file>`. Run each command as one plain `node` line, with no pipe, heredoc, `&&` or `;` chain, variable prefix or `cd`.

- `execute plan [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--root <qa-dir>]`
- `execute confirm --dir <run-dir>... [--input <file>]`
- `execute automation --dir <run-dir> [--root <qa-dir>]`
- `execute next --dir <run-dir> [--root <qa-dir>]`
- `execute resume --dir <run-dir> --note <acc> [--skip]`
- `execute record --dir <run-dir> --execution <id> --status ok|failed|timeout|refused|quota [--reason-file <path>]`
- `execute ingest --dir <run-dir> [--root <qa-dir>]`
- `execute follow-ups --dir <run-dir> [--root <qa-dir>]`
- `execute summary --dir <run-dir> [--root <qa-dir>]`

**`ok: false`**: nothing executed. Explain each `refusals` entry's factual `line` and data;
say what to do next, copying `next` intact.

## 1. Practices

Follow every Practice (`prc_` entry) in `.qa/train/execute.md`, if present, throughout.
The Tester mocks a server, network or data-return condition that precondition or step prose states (no marker, no level), at an endpoint the case or `train/execute.md` names. Point a request to mock at Training. An endpoint on another configured target's origin (a UI's API on its own origin) is named by full URL.

## 2. Plan

Run `execute plan` with the engineer's arguments.

- **`ok: false`**: explain each refusal line and stop.
- **No `dir` and no `runs`**: all selected cases were skipped. Relay `text` verbatim and stop.
- **`dir` or `runs` present**: relay `text` verbatim and ask the engineer to confirm. Wait for their answer.

## 3. Confirm

- On yes: run `execute confirm --dir <dir>`, with one `--dir` per Run in `runs`.
- If the engineer declines or cancels: stop.

After the engineer's yes, for a multi-Run plan (`runs`), follow
[references/multi-run.md](references/multi-run.md) across §§4–6.

## 4. Run

Run `execute automation --dir <dir>` once; relay `text` verbatim. Incomplete prose and `manual: false`
cases record `execution_skipped` instead of an Execution. On `ok: false`, explain each refusal line and stop.

Loop:

Run `execute next --dir <dir>`.

Only note `blocked` (Executions Blocked before starting); ingest records them.

1. **Start ready Executions**: per `{id, brief, model}` in `start`, spawn one background Tester (`qa-skills:tester`):
   - **prompt**: read the file at `brief` and pass its content verbatim (its first line binds the Tester);
   - **model**: pass `model` only when non-null; omit `model` when null (to inherit).

2. **Wait while in flight**: if `in_flight > 0`, end the turn while any Tester is in flight.

3. **Record replies**: on each Tester reply:
   - Determine `--status`:
     - `ok` for a `DONE` reply;
     - `failed` for a `FAILED:` reply;
     - `timeout`, `refused`, or `quota` when stopped by those harness conditions.
   - When the reply holds more than a bare `DONE`, on any status, save its full text with the Write tool to `<dir>/<id>.reply.md`.
   - Run `execute record --dir <dir> --execution <id> --status <status>`, adding `--reason-file <dir>/<id>.reply.md` when you saved one.
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

Run `execute ingest --dir <dir>`.
Relay `text` verbatim.

If interrupted or stopped by the engineer, run `execute ingest --dir <dir>` on that Run;
relay `text` verbatim. Unstarted Executions are reported as not run.

## 6. Follow-ups

Run `execute follow-ups --dir <dir>`. It builds the work list once, takes
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
