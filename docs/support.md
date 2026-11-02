# Support

What this version of qa-skills supports, what it does with your data, and what it keeps. Every factual
statement here is grounded in the code (`plugin/scripts/`) and in the automated test suite; the
live evidence the code alone cannot produce is listed as [pending](#live-detection-evidence),
never claimed done.

## Support matrix

Each row names its exact tested configuration, the capability exercised, the evidence, and the
limits, with one of three statuses:

- **Supported** — exercised by the automated suite in CI or by a live run.
- **Expected to work** — not exercised in this release; issue reports are welcome.
- **Unsupported** — does not work and is not targeted.

An installed version alone is not evidence. Rows whose evidence depends on the pending live runs
below say so under their limits; their status changes only when that evidence lands.

### Claude Code

- **Status:** Expected to work. The floor below is pinned provisionally: it is raised or lowered
  only from live evidence that a version passes the enforcement runs on
  [Live enforcement evidence](#live-enforcement-evidence).
- **Tested configuration:** Claude Code 2.1.308 or newer (the provisional floor; no live run of
  the Tester guard is recorded yet). Before any login or browser
  call, `/qa-execute` asks the host binary named by `CLAUDE_CODE_EXECPATH` for `--version`, parses
  the answer strictly, and refuses an older, unverifiable or unrecognised host with the stop code
  `host_unverified`, naming this row and the version found. The check runs again on every call
  that opens an application session (`execute next` before it schedules, direct `execute open`
  too); a refusal makes no login or browser call and leaves the Run unchanged, while cleanup and
  ingest stay available.
- **Capability exercised:** a background Tester subagent (`agent_type` `qa-skills:tester`,
  `agent_id` bound to one Execution) whose every Bash, Read and Write call inside an Execution
  passes through the `PreToolUse` guard and the CLI `tester` wrapper (the guard is the security
  boundary). Codes, paths and login steps are CLI-written; the model briefs, reports and maps
  Replies.
- **Evidence:** the automated suite exercises host admission (missing, empty, non-executable,
  failing, timed-out and malformed version sources, `AI_AGENT` disagreement, below-floor and
  success), the guard's closed allow-lists, and the binding with synthetic host events and fake
  hosts, in CI (see [Automated suite](#automated-suite)). No live Claude Code run happens there.
- **Limits:** host detection relies on two pieces of **undocumented** Claude Code metadata,
  `CLAUDE_CODE_EXECPATH` and `AI_AGENT`. A future format change makes `/qa-execute` refuse until
  the floor is re-qualified for the new format, which is the intended fail-closed behaviour. The
  hook capabilities the guard relies on are themselves documented (`agent_type`/`agent_id` since
  2.1.69, `onFailure: "block"` since 2.1.295); the two version variables are not. Detection on the
  floor version must be shown in both the desktop app and the terminal CLI before this row is
  Supported; if the terminal CLI lacks the version source, running `/qa-execute` from the terminal
  is unsupported in this release.

#### Delegate isolation

- **Status:** Supported on the terminal CLI at Claude Code 2.1.308 and on the desktop app at its
  bundled 2.1.309, from the live qualification run recorded under
  [Live enforcement evidence](#live-enforcement-evidence). The desktop app on 2.1.308 is not
  exercised: the app bundles its own Claude Code, which cannot be pinned.
- **Tested configuration:** Claude Code at the floor stated in the row above. `qa-judge` and
  `qa-filler` ship as plugin agents (`qa-skills:qa-judge`, `qa-skills:qa-filler`) with
  `omitClaudeMd: true`, tools exactly `Read`, and no skills or memory; the Tester carries
  `omitClaudeMd: true` too and keeps its tools and guard.
- **Capability exercised:** each `delegate next` dispatch item names its Delegate's agent type; the
  Tier's model label stays the `model` override, and a launch, retry or Fallback keeps the same
  agent type. Delegates start fresh and non-forked, with automatic loading of the repo under test's
  CLAUDE.md levels and parent auto memory disabled. The CLI-built brief remains the whole
  instruction set, and it sits in the OS temp dir, so reading it loads nothing from the repo.
- **Evidence:** deterministic dispatch tests run in CI. The live evidence is the opt-in marker
  probe, `scripts/probe-delegate-isolation.mjs`, run with `QA_LIVE_PROBE=1` (once as is for
  `inherit`, and once with `QA_LIVE_PROBE_CHILD_MODEL` set for a Tier override): the workspace marker
  must appear in a generic child's captured startup context before its absence from the shim
  child's context counts. Every cell of the qualification matrix passed on 2026-10-28 (both
  Delegate roles and the Tester path; `inherit` and a `haiku` override; terminal CLI and desktop
  app); the runs are recorded under [Live enforcement evidence](#live-enforcement-evidence).
- **Limits:** this is a startup-exclusion contract, not a security boundary. It is not fail-closed,
  and unlike the Tester guard there is no host admission: an older host may resolve the agent while
  ignoring the setting. Residual and not neutralised: the repo under test's project hooks
  (`SubagentStart` and tool hooks), managed policy, `git status`, and instructions loaded on file
  access; Read is not path-confined. This change does not protect verdict integrity against
  malicious project hooks. Requalify when the Claude Code floor moves, an agent file's frontmatter
  changes, or the probe's capture format changes. The probe plants no auto-memory marker, so the
  parent-auto-memory exclusion rests on the agent files leaving `memory` unset.

### Node

- **Status:** Supported.
- **Tested configuration:** Node >= 22, as `package.json` states in `engines.node`. CI pins
  Node 22 on Ubuntu.
- **Capability exercised:** the whole CLI — every command the automated suite touches, in-process
  and through the real `plugin/scripts/scan.mjs` entry point.
- **Evidence:** the automated suite runs in CI on ubuntu-latest with Node 22.
- **Limits:** the suite drives a fake `playwright-cli` and no real browser or host. Newer Node
  releases are expected to work and unexercised.

### playwright-cli

- **Status:** Expected to work.
- **Tested configuration:** `playwright-cli` 0.1.22 or newer, the floor the code enforces
  (`MIN_PLAYWRIGHT_CLI`). `execute plan` and each `execute open` run `playwright-cli --version`
  with a two-second bound and refuse missing, older or unreadable versions, naming the upgrade
  command; the found version is recorded in the Run's pinned plan and in the Execution record.
- **Capability exercised:** the guarded browser and HTTP surface `/qa-execute` drives through the
  CLI `tester` wrapper: sessions, page commands, snapshots, `page.request`, state save and load.
- **Evidence:** the automated suite exercises the wrapper against a fake `playwright-cli` (argv,
  caps, stops, scrubbing) and the version check against fake versions. The command grammar has
  been checked against documented and installed releases of the real CLI through 0.1.22.
- **Limits:** the CLI is pre-1.0 and changes fast. No live run of the wrapped commands on the
  floor version against a real application is recorded yet (pending below), and a real application
  writes browser artifacts this document's scrubbing does not cover (see
  [Raw artifacts outside the promise](#raw-artifacts-outside-the-promise)). Install with
  `npm install -g @playwright/cli@latest`.

### Operating systems

- **macOS** — Expected to work. Live Executions during development ran on macOS; recorded
  release-gate evidence on the floor version is pending.
- **Linux** — Supported for the automated suite: CI runs it on ubuntu-latest, Node 22 (with a
  fake `playwright-cli`, no browser). A live Execution on Linux is expected to work, with no
  recorded evidence yet.
- **Windows** — Unsupported. It is not targeted in this release (`playwright-cli` behaviour there
  is unqualified and nothing exercises it).

### Trackers

The CLI is network-free: it makes no tracker call on any path. Tracker reads happen through
read-only fetch briefs the engineer's host performs, and only `/qa-publish` writes the tracker,
through a Publisher subagent, after the engineer accepts a Card. What is supported are the
deterministic halves plus the flows around them:

- **No tracker (trackerless)** — **Supported.** Design, train, next, ask, impact and execute work
  with no tracker configured at all; cases hold no `tracker:` field. Exercised by the automated
  suite with synthetic trees.
- **Story-only, without Publish** — **Expected to work.** Cases and Scenarios reference existing
  tracker stories (`tracker:` keys) without a Publish configuration; Publish is refused without
  the configuration it needs. Nothing exercises a real story tracker in this release.
- **Test management** — **Expected to work.** Defined as configured Mirror, intake and Publish
  workflows through a named tracker configuration with the Suite, Scenario and Case issue types,
  the story links, the initial status and the marker field and label Publish needs; there is no
  built-in default mapping. There is **no generic Xray/Zephyr claim**: no test-management tool is
  named as supported, and configuration is per tracker. Expected to work unless a gate run
  exercises it.

Limits for all three: the reads and writes an outsider can hardly verify from here happen in the
engineer's host with the engineer's own credentials; only the deterministic halves are tested.

### Test stacks

- **Status:** Expected to work for both, until a gate run with a real project passes.
- **Tested configuration:** Kotlin with JUnit 5 (`stack.language: kotlin`), and TypeScript (or
  JavaScript) with Playwright Test. The stack comes from `project.md`; each stack is one adapter
  the framework does not extend automatically.
- **Capability exercised:** the source scan that finds a stack's Key carriers by name and
  annotation and binds Automation keys to code (`function`/`class` locations in scan results), and
  the parse checks a keyed test file must satisfy.
- **Evidence:** the automated suite exercises both adapters with synthetic fixtures, including the
  TypeScript adapter parsing with a pinned real `typescript`, in CI.
- **Limits:** no real Kotlin or TypeScript repository run is recorded in this release's evidence;
  any other framework or language is unsupported and would need its own adapter.

## Operational limits

- **Model usage and cost.** Each Execution in a Run is served by a background Tester subagent on
  the model the project's Tier configuration binds, so a Run's cost and quota use follow the
  project's own Tier choices. Skills are interactive only: never run `/qa-execute` unattended.
- **Quota and refusal.** A tester attempt is retried at most 3 times per Delegate (after a 15 s
  per-attempt cooldown, kind-blind), and a per-Delegate breaker trips on a quota failure, a
  refused spawn, or 3 consecutive failed retries. On a trip, the Run's remaining Executions move
  to the Fallback Tier with a fresh budget; if the Fallback trips too, dispatch stops and the Run
  ends incomplete, with `execute ingest` recording what happened.
- **Concurrency.** At most `concurrency_cap` Executions (project config, 4 when unset) are in
  flight; a freed slot is filled by the next scheduled call.
- **Access-note locks.** While an Execution runs, its case Roles' notes are held exclusively and
  its setup-only Roles' notes shared, so two Executions never drive one login at once. Locks
  resolve contention inside one Run only; nothing coordinates separate Runs.
- **Action cap.** One Execution may make up to 10 + 5 × (steps + preconditions) counted calls;
  hitting the cap stops it as Blocked, never Failed.

## Evidence

Three kinds of evidence, kept apart. The automated suite can only prove what code does in its own
processes; only live runs prove what a real host does.

### Automated suite

The `node --test` suite (CI: ubuntu-latest, Node 22; `npm test`, `npm run lint:skills`,
`npm ci`, `npm run typecheck`) proves script behaviour through public CLI commands and module
interfaces:

- host admission through the CLI and `admitHost` (`tests/host-admission.test.mjs`);
- the `PreToolUse` hook fed synthetic events, proving script behaviour only, never host
  enforcement (`tests/tester-guard.test.mjs`);
- the credential scrubbing module, table-driven (`tests/credentials.test.mjs`)
  and the surfaces that show its result (command output, saved responses, guard trace, `page_url`,
  `Location`, accepted and refused calls);
- document contracts that pin this document's floors to the code constants
  (`tests/support-doc.test.mjs`), and the wrapper's version check (`tests/playwright-version.test.mjs`).

It never runs a live Claude Code host, never drives a real browser, and never calls a real tracker.

### Live detection evidence

All **Pending** in this release; each must show host-version detection working on the floor
version, with the host configuration and the detection route recorded:

- desktop app;
- terminal CLI.

### Live enforcement evidence

All **Pending** in this release, on the floor version:

- the Tester guard denying a call outside its allow-lists;
- the hook blocking on its own crash and on timeout (`onFailure: "block"`);
- a background-launched Tester binding to its Execution (`agentId`);
- real browser-artifact placement under the Execution directory, confirmed with the real CLI;
- a live Execution end-to-end against a real application, on macOS and on Linux;
- a fresh install, an update from 0.1.1 with cache migration, and an anonymous install from the
  public repository;
- a report received through the private route in `SECURITY.md`;
- the Delegate-isolation probe in the desktop app on the 2.1.308 floor itself (the app ships its
  own build; the recorded desktop cells ran on 2.1.309).

Recorded:

- **Delegate isolation**, 2026-10-28, plugin `qa-skills` 0.2.0, macOS, with
  `scripts/probe-delegate-isolation.mjs`. Every cell PASSes: the positive control's startup
  context showed the workspace marker, and no isolated child's transcript held the workspace or
  parent marker while its reply held the brief marker.

  | Surface | Claude Code | Model | Control | qa-judge | qa-filler | Tester path |
  | --- | --- | --- | --- | --- | --- | --- |
  | terminal CLI (`--plugin-dir`) | 2.1.308 | `inherit` | PASS | PASS | PASS | PASS |
  | terminal CLI (`--plugin-dir`) | 2.1.308 | `haiku` override | PASS | PASS | PASS | PASS |
  | desktop app (marketplace install) | 2.1.309 | `inherit` | PASS | PASS | PASS | PASS |
  | desktop app (marketplace install) | 2.1.309 | `haiku` override | PASS | PASS | PASS | PASS |

  The desktop app bundles its own Claude Code, so its cells ran on 2.1.309, the build it shipped at
  the time, not on the 2.1.308 floor. In the override runs the Delegate children's turns ran on
  Haiku; in the `inherit` runs they ran on the parent's model. One desktop `haiku` run whose session
  opened outside the workspace was INCONCLUSIVE and was rerun; it is not counted. The desktop
  `inherit` run first graded FAIL because the grader missed replies a desktop subagent hands back
  through `SubagentHandback`; that was fixed in the probe and the run was regraded from its saved
  transcripts.

## Data handling

`/qa-execute` surfaces a summary of this section, with a link to it, in the confirm `execute plan`
prints, before the engineer confirms and before anything opens a login or a browser. Two separate
guarantees, worded narrowly:

**Credential protection.** Configured credential **sources** are denied to the model: an Access
note's login-state file and its password files (commonly under `.qa/.auth/`, which `/qa-train`
helps keep git-ignored — `train check` is read-only and names every file that isn't, with the
exact `.gitignore` line), and the Run's kept-login directory `auth/` are never admitted to a
Tester's Read, and no tool returns a state file's content. The engineer types the credential into
a CLI login; the browser logs in, the CLI saves the state, the model never sees it and never asks
for it. Recognised credential patterns are additionally scrubbed from the enumerated surfaces
below. Values that show up in application text, screenshots or the raw artifacts listed below are
**not** guaranteed.

**Application data confidentiality is not guaranteed.** Tool results, artifact Reads and briefs
expose project and application data to the session, under the engineer's own host configuration
and provider terms. Choose targets and data accordingly.

### Scrubbed surfaces

What the CLI `tester` wrapper scrubs before it returns or saves:

- **Command output** (`tester do`): the kept `### Result`, `Page`, `Snapshot`, `Modal state` and
  `Error` blocks, with typed text masked as `<typed>` (the echoed-code section is dropped), then
  credential-named `key: value` and `key=value` pairs in page text, credential-named query
  parameters in page URLs, and whole token formats (PEM private keys, JWTs, GitHub, Slack and AWS
  key forms, `bearer`/`basic` values) redacted.
- **HTTP request responses** (`tester request`): bodies, headers and error lines scrubbed the same
  way; the sensitive headers `cookie`, `authorization`, `proxy-authorization` and `host` are
  refused outright. A same-origin redirect keeps its URL with credential-named query parameters'
  values gone; a cross-origin redirect is reduced to the origin.
- **Saved responses** (`executions/<id>/responses/<n>.json`): the whole body is scrubbed before
  the file is written.
- **The guard trace** (`executions/<id>/guard.json`, `log`): typed text masked in arguments, page
  URLs and `goto` arguments cut of credential-named query parameter values, a URL off the target
  reduced to its origin.
- **The Execution record** `execute ingest` writes: every text field cut of URL queries and
  fragments and scrubbed, a line that still looks like a credential replaced whole, and
  `redacted: true` set on the block when anything was changed.

Deliberate over-redaction: `session`, `cookie`, `api key` and `private key` are credential names,
with their plurals, and so are common session-cookie identifiers such as `JSESSIONID`,
`PHPSESSID` and `asp.net_sessionid`. A whole `session` or `cookies` object therefore loses its
value, and pair-shaped prose such as `sessions=3` or `cookies=2` goes with it; keys that themselves
look like tokens are withheld rather than shown. Quoted keys and values follow the same rule, with
the quotes kept: `password="hunter2"` becomes `password="<redacted>"`, and `{"token": "abc"}` loses
`abc` too.

### Raw artifacts outside the promise

The scrubbing reaches only what the Tester returns through the wrapper and what it saves through
it. It does **not** reach the files `playwright-cli` writes by itself, which `Read` may then admit
whole: the session's earlier page snapshots under `executions/<id>/`, its screenshots and trace
files, the CLI's own logs, and anything else under the Execution directory the Tester never passes
through the wrapper. Values visible there are not scrubbed and can reach the model; the same holds
for anything the Tester copies from such a file into its own `report.md`.

### Storage and lifecycle

A Run's directory lives in the OS temp dir: `execute plan` makes one and prints its absolute path
as `Run dir:`. Nothing deletes a run dir automatically, and ordinary artifacts survive ingest;
deleting it is the engineer's job. One row per store:

| Store | What it holds | Normal retention | Retry or reset | Left by a crash |
|---|---|---|---|---|
| `<run>/execute.json` | the pinned plan: case text and digests, Roles, target, caps | kept; no retry deletes it | never deleted | remains |
| `<run>/dispatch.json` | mutable scheduling state: locks, pauses, retries, breaker | kept | updated in place | remains |
| `<run>/.playwright/` | the session anchor `playwright-cli` scopes its sessions to | kept | kept | remains |
| `<run>/auth/<acc>.json` | a CLI login state kept for the Run (mode 0600 in a 0700 dir) | deleted once no queued Execution needs its note, or when a kept login proves stale, so it logs in once more | remade by the next login | removed by `execute ingest`; otherwise remains |
| `<run>/executions/<id>/brief.md` | the Tester's brief, whose first line binds it | kept | removed with the directory | remains |
| `<run>/executions/<id>/guard.json` | the action trace ingest reads: used calls, stops, sessions | kept | removed with the directory | remains |
| `<run>/executions/<id>/report.md` | the Tester's raw report | kept | removed with the directory | remains |
| `<run>/executions/<id>/responses/<n>.json` | saved HTTP responses, scrubbed before saving | kept | removed with the directory | remains |
| `<run>/executions/<id>/uploads/` | files generated from upload recipes the Tester may attach | kept | removed with the directory | remains |
| `<run>/executions/<id>/.playwright-cli/` | the raw files `playwright-cli` writes itself: snapshots, screenshots, traces, logs (outside the scrubbing promise) | kept | removed with the directory | remains |
| `<run>/executions/<id>/` (whole) | an Execution's working directory | kept | deleted when a failed attempt is retried before any command reached the app, so a re-run repeats nothing | remains |
| `<repo>/.qa/executions/<date>-<run-id>.md` | the Execution record (below) | written once by `execute ingest`, never rewritten | never deleted by a retry | absent, or already written: a re-run refuses rather than rewriting |
| `<repo>/.qa/bugs/<bg_key>-<slug>.md` | one Bug draft per failed case, copied from the scrubbed record; a published draft keeps its Tracker key | committed by the engineer, beside the knowledge; published drafts are history | `bug discard` deletes a draft, never a published one | absent until `bug write` writes it; an interrupted turn leaves no placeholder |
| `<run>/follow-ups.json` | the Run's work list: one item per Automation to fix and per case to file, the item states, the dirty-tree snapshot, the draft Keys, the attachable screenshots by that Key and the PR state | never committed; kept until the engineer deletes the run dir | updated in place by the follow-up skills' CLI | remains: `execute follow-ups` returns it as it stands, and `execute summary` reads it read-only |
| engineer's `login_state` files | the saved states Access notes name | owned by the engineer; never copied or deleted by a Run | never | never |
| `<tmpdir>/qa-skills/` | the read-only Next steps page `/qa-next` writes | replaced by the next page | not touched by a Run | remains until the OS clears it |

### What the record holds

`execute ingest` writes one Execution record at `.qa/executions/<executed_at date>-<run-id>.md`,
outside the knowledge layer. It is **uncommitted**: `/qa-execute` never stages or commits
anything, and this record is no exception — the no-commit promise is scoped to `/qa-execute`
(`/qa-publish` commits selected `.qa/` paths of its own, only after its own Card is accepted).
Review the record before committing it: it holds origin, Role names, `Expected`/`Seen`/`Why`
prose, evidence lines, a numbered command trace, preconditions, Tracker and Access note keys,
digests, Review state, flags (unedited, stale, at a sign-in page, redacted), reached steps and
action counts, and what was created. The record carries prose only — it does not copy the Run's
files, so the browser's raw artifacts stay in the temp run dir and are not durable attachments.

### Interrupted runs

Recovery from a stopped or interrupted Run is an explicit engineer action, and returns the Run to
a recordable end state:

1. Stop or drain the running Testers (let in-flight ones finish or stop them).
2. Run the ingest command the confirm printed, `execute ingest --dir <run-dir>`, once on the same
   run dir.

Then: an Execution that acted but wrote no valid report is recorded as Blocked; Executions Blocked
before dispatch (with their reason) are recorded; Executions that never acted are listed as not
run and their previous result stays the latest; kept login states are removed and every recorded
session is closed first. Nothing is rolled back: the application keeps whatever was done, and a
browser a crash left open must be closed by hand. The record is written once; a second ingest
refuses rather than rewriting it. `execute follow-ups` then builds the work list and takes the
dirty-tree snapshot when follow-up work actually resumes, and `execute summary --dir <run-dir>` can
be run at any time to see a Run's follow-up state.

### Entities left in the application

Everything the Tester creates in the application stays in it. Case prose may instruct tagging or
listing created entities, and the report may name them, but `created` is optional and an
interrupted run can lose the list. Cleaning up entities the Tester leaves behind is the
engineer's job.

## Non-production use

The supported use of `/qa-execute` is **non-production targets with test accounts**. That is
stated as the supported use, not enforced on any target. Say plainly what the safeguards do not
do: permitted actions mutate application data; nothing enforces that a target is non-production,
and there is no network-egress control. Origin checks run before explicit navigation and
requests; navigation triggered by an action is checked only after it happens, so it cannot be
prevented. Destructive-action limits are brief instructions in case prose and training, never
enforcement. `bypassPermissions` adds no prompt boundary — the Tester's boundary is its guard's
closed allow-lists.
