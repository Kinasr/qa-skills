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

- **On every path where the command's JSON carries `migration`**, read it first: if `pending`,
  warn using `migrations` in order; continue the command.
- **Interactive use only:** run directly with the engineer present, rather than unattended or in automation.
- **Nothing touches the app before the engineer confirms:** log in, open a session or dispatch an Execution only after yes.
- **Keep credentials with the engineer:** never ask for a secret, token or password; neither use nor repeat one.
- **Test code runs only through `execute automation`:** route every automated test run through the CLI instead of invoking the project's test command directly.
- **The tracker is read-only except `/qa-publish`.**
- **Leave git state to the engineer:** never stage or commit; a dirty working tree is fine.

## The CLI

Run from repository root; forward `--root` when given (default `./.qa`). Each call prints one JSON object:

```
node <this skill's directory>/../../scripts/scan.mjs <mode> ...
```

Commands that read input take it from a file: write it outside the repository (the run dir or your scratch directory) and pass its absolute path as `--input <file>`. Run each command as one plain `node` line, with no pipe, heredoc, `&&` or `;` chain, variable prefix or `cd`.

- `execute plan [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--root <qa-dir>]`
- `execute confirm (--dir <run-dir>)... [--input <file>]`
- `execute automation --dir <run-dir> [--root <qa-dir>]`
- `execute next --dir <run-dir> [--root <qa-dir>]`
- `execute resume --dir <run-dir> --note <acc> [--skip]`
- `execute record --dir <run-dir> --execution <id> --status ok|failed|timeout|refused|quota [--reason-file <path>]`
- `execute ingest --dir <run-dir> [--root <qa-dir>]`
- `execute follow-ups --dir <run-dir> [--root <qa-dir>]`
- `execute summary --dir <run-dir> [--root <qa-dir>]`

**`ok: false`**: nothing executed. Word each `refusals` entry from `code` and facts;
say what to do next, copying `next` intact.

## 1. Practices

Follow every Practice (`prc_` entry) in `.qa/train/execute.md`, if present, throughout.
The Tester mocks a server, network or data-return condition that precondition or step prose states (no marker, no level), at an endpoint the case or `train/execute.md` names. Point a request to mock at Training. An endpoint on another configured target's origin (a UI's API on its own origin) is named by full URL.

## 2. Plan

Run `execute plan` with the engineer's arguments. **Preserve selection tokens:** pass scope keys,
`tag:<name>` and `level:<name>` values exactly as given, including repeats; the CLI resolves and
validates them.

- **`ok: false`**: word each refusal and stop.
- **No `dir` and no `runs`**: all selected cases were skipped. Word every section in order and stop.
- **`dir` or `runs` present**: word every section in order, present the CLI-written confirm without
  reformatting or re-deriving it, and ask the engineer to confirm. Wait for their answer.

## 3. Confirm

- **An Unguarded Run needs the engineer's own words:** when the plan reports `unguarded`, pass
  `{"acknowledge": "unguarded"}` to `execute confirm --input <file>` only after the engineer
  explicitly accepts running without the Tester guard; a plain yes is not that.
- On yes: run `execute confirm --dir <dir>`, with one `--dir` per Run in `runs`.
- If the engineer declines or cancels: stop.

After the engineer's yes, for a multi-Run plan (`runs`), execute one Run at a time in `targets`
order — finishing Automation, Testers and ingest for each Run before starting the next — and follow
[references/multi-run.md](references/multi-run.md) across §§4–6.

## 4. Run

- **The Automation decides the Execution:** group Automations by level before scheduling and
  chaining. Only Failed aggregates or absent Automations send that level to a Tester Execution;
  Passed, Flaky and Blocked require none. The Case outcome combines results per level.
- **Relay Credential-variant results:** the Tester maps step prose to `--auth` and judges
  `auth_rejected` under the Access failure rule. Relay variant refusals as Blocked `step`.
  Wrong-role cases use Role notes; header-only sessions allow `tester request` only.

Run `execute automation --dir <dir>` once and word every section in order. Incomplete prose and
`manual: false` cases record `execution_skipped` instead of an Execution. On `ok: false`, word each refusal and stop.

Loop:

Run `execute next --dir <dir>`, wording every section in order; ingest records Executions Blocked
before starting. Follow the first matching step in order:

1. **Start ready Executions**: per `{id, brief, model}` in `start`, spawn one background Tester (`qa-skills:tester`):
   - **Brief passed verbatim:** read the file at `brief` and pass its content verbatim as the Tester's prompt (its first line binds the Tester);
   - **Omit model for inherit:** pass `model` only when non-null; omit `model` when null.

2. **Wait while in flight**: if `in_flight > 0` (either after spawning `start`, or when `start` is empty while Testers still run), **end the turn while a Tester is in flight** — wait for replies without taking additional turns while any Tester runs.

3. **Record replies**: on each Tester reply:
   - Determine `--status`:
     - `ok` for a `DONE` reply;
     - `failed` for a `FAILED:` reply;
     - `timeout`, `refused`, or `quota` when stopped by those harness conditions.
   - When the reply holds more than a bare `DONE`, on any status, save its full reply with the Write tool to `<dir>/<id>.reply.md`.
   - Run `execute record --dir <dir> --execution <id> --status <status>`, adding `--reason-file <dir>/<id>.reply.md` when you saved one.
   - Call `execute next` again.

4. **Paused notes**: when `in_flight === 0` and the paused section is present (any Access note is paused):
   **Prompt once for paused notes** only after draining in-flight Executions, listing every paused
   note under the Access failure rule:
   - State the Access note Key, affected Roles, and refusal details.
   - Keep credentials with the engineer: never ask for a secret, token or password; neither use nor repeat one. Direct them to update the credentials where `train/access.md` indicates.
   - Ask the engineer to fix the login and reply "done", or reply "skip".
   - For each answer:
     - On "done": run `execute resume --dir <dir> --note <acc>`.
     - On "skip": run `execute resume --dir <dir> --note <acc> --skip`.
   - Call `execute next` again.

5. **Cooldown backoff**: when `in_flight === 0`, no Access note is paused, and `wait_ms` is present (cooling down until `next_ready_at`), run one standalone pause command (one plain `node` line with no chaining or variable expansion), then call `execute next` again; if a residual `wait_ms` returns, pause again:

   ```
   node -e "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, <wait_ms> + 25)"
   ```

6. **Completion**: when `done: true` and `in_flight === 0`, exit the loop and proceed to §5.

## 5. Ingest

Run `execute ingest --dir <dir>` and word every section in order, presenting the end-of-Run summary
without reformatting or re-deriving it.

If interrupted or stopped by the engineer, run `execute ingest --dir <dir>` on that Run and word
every section in order; unstarted Executions are reported as not run.

## 6. Follow-ups

Run `execute follow-ups --dir <dir>`. It builds the work list once, takes
the dirty-tree snapshot, and prints the one resume command. On `ok: false`, word each refusal
and stop.

- **The CLI's work list is the only follow-up work:** work the items `execute follow-ups` returns, in
  its order, and resume only the Run whose `--run` dir it names.
- **Follow-ups run in this conversation, with no subagent and no Tier:**
  - Stopped Run: relay ingest's resume command and stop; no follow-up starts.
  - Empty work list: with `counts.fix` and `counts.bug` both 0, go straight to the `/qa-train` offer.
  - Multi-Run: follow-ups run per Run in `targets` order after every Run ingests.

1. Invoke `/qa-codefix --run <dir>` when the work list holds a fix item; it relays one progress line
   per item and has no close of its own.
2. When `/qa-codefix` ran, run `execute follow-ups --dir <dir>` again to pick up any hand-off's
   bug item, then invoke `/qa-bug --run <dir>` when the list holds one (`/qa-bug` drafts each the same
   way).
3. Run `execute summary --dir <dir>`. Word every section `execute summary` returns in order, and
   print nothing when it returns none.
4. When `publish.ask` is true, ask its one question and follow the answer: yes invokes
   `/qa-publish --run <dir>`, no leaves the drafts, and discarding runs `bug discard <bg_key…>`.
5. **Offer `/qa-train` once:** offer to run `/qa-train` now on whichever target the Run made stale
   (across multiple Runs, one `/qa-train` offer covers every target made stale). On yes, invoke it
   in this conversation; on no, finish.
