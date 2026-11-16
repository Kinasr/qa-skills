# Support

What this version of qa-skills supports, what it does with your data, and what it keeps. Every factual
statement here is grounded in the code (`plugin/scripts/`) and in the automated test suite; the
live evidence the code alone cannot produce is listed as [pending](#live-detection-evidence),
never claimed done.

## Support matrix

Each row names its exact tested configuration, the capability exercised, the evidence, and the
limits, with one of three statuses:

- **Supported** — exercised by the automated suite in CI or by a recorded live entry.
- **Expected to work** — not exercised in this release; issue reports are welcome.
- **Unsupported** — does not work and is not targeted.

An installed version alone is not evidence. Rows whose evidence depends on the pending live runs
below say so under their limits; their status changes only when a recorded live entry lands.

### Claude Code

- **Status:** Supported on macOS in the terminal CLI at Claude Code 2.1.308 and in the desktop app
  at its bundled Claude Code (2.1.321, and 2.1.325 for 0.14.0), from the recorded live entries under
  [Live detection evidence](#live-detection-evidence) and
  [Live enforcement evidence](#live-enforcement-evidence). Host-version detection, guard denial,
  hook blocking on crash and on timeout and a macOS end-to-end Run passed on qa-skills 0.13.1;
  browser-artifact placement passed on 0.13.2 on both surfaces; `agentId` binding passed on 0.13.1
  in the terminal CLI and on 0.13.2 in the desktop app. Every one of these passed again on 0.14.0,
  on both surfaces. Guard denial passed again on 0.14.1 on both surfaces, after the Tester guard
  changed. Linux end-to-end is Pending.
- **Tested configuration:** Claude Code 2.1.308 or newer (the floor). The desktop app bundles its
  own Claude Code and cannot be pinned, so its entries ran on the bundled 2.1.321 (2.1.325 for
  0.14.0), at or above the floor. Before any login or browser
  call, `/qa-execute` asks the host binary named by `CLAUDE_CODE_EXECPATH` for `--version`, parses
  the answer strictly, and refuses an older, unverifiable or unrecognised host with the stop code
  `host_unverified`. The refusal names the failed check (`check`), the host as identified (Claude
  Code, by `CLAUDE_CODE_EXECPATH` or an `AI_AGENT` of `claude-code_*`, or not), the version found
  and the `AI_AGENT` value seen, and links this row at the running plugin's version. The check runs again on every call
  that opens an application session (`execute next` before it schedules, direct `execute open`
  too); a refusal makes no login or browser call and leaves the Run unchanged, while cleanup and
  ingest stay available. A host below the floor is always refused, with an "upgrade to >= floor"
  message. Any other failure (a missing or relative `CLAUDE_CODE_EXECPATH`, a failing or timed-out
  version command, an unrecognised format, a malformed or disagreeing `AI_AGENT`), on Claude Code
  or any other host, can run as an Unguarded Run (ADR-0057). There `execute plan` names the
  unverified guard on the pre-run Card,
  and the Run is admitted only after the engineer explicitly acknowledges it there, through `execute confirm --stdin` and the Card's digest check. Every
  admitted call then reports `unguarded: true`, and the ingest summary says so.
- **Capability exercised:** a background Tester subagent (`agent_type` `qa-skills:tester`,
  `agent_id` bound to one Execution) whose every Bash, Read and Write call inside an Execution
  passes through the `PreToolUse` guard and the CLI `tester` wrapper (the guard is the security
  boundary). Codes, paths and login steps are CLI-written; the model briefs, reports and maps
  Replies.
- **Evidence:** the automated suite exercises host admission (missing, empty, non-executable,
  failing, timed-out and malformed version sources, `AI_AGENT` disagreement, below-floor and
  success), the guard's closed allow-lists, and the binding with synthetic host events and fake
  hosts, in CI (see [Automated suite](#automated-suite)). No live Claude Code run happens there.
  The live entries add the real host on both surfaces: the guard denying a call outside its
  allow-lists, the hook blocking on its own crash and on timeout, a background Tester binding to its
  Execution, browser artifacts placed under the Execution, host detection, and one end-to-end
  Execution against a real application.
- **Limits:** host detection relies on two pieces of **undocumented** Claude Code metadata,
  `CLAUDE_CODE_EXECPATH` and `AI_AGENT`. A future format change makes `/qa-execute` refuse until
  the floor is re-qualified for the new format, which is the intended fail-closed behaviour. The
  hook capabilities the guard relies on are themselves documented (`agent_type`/`agent_id` since
  2.1.69, `onFailure: "block"` since 2.1.295); the two version variables are not. Live entries
  cover macOS only, one application (the self-hosted Toolshop fallback) and the plugin installed
  from a local marketplace under a distinct name; Linux end-to-end, the install and update paths,
  and the desktop app on 2.1.308 itself are Pending below. Header credentials and mocking are
  qualified separately in their own rows.

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
- **Limits:** the CLI is pre-1.0 and changes fast. A live run of the wrapped commands on the
  floor version against a real application is recorded on macOS; Linux is pending below. A real application
  writes browser artifacts this document's scrubbing does not cover (see
  [Raw artifacts outside the promise](#raw-artifacts-outside-the-promise)). Install with
  `npm install -g @playwright/cli@latest`.

### Header credentials

- **Status:** Supported on the terminal CLI at Claude Code 2.1.308 on macOS, from the recorded live
  entries under [Live enforcement evidence](#live-enforcement-evidence). The desktop app and Linux
  are not exercised.
- **Tested configuration:** an Access note naming a Header credential with `identifiers.header`
  `Authorization`, `identifiers.scheme` `Bearer` and `header_via: auth:KEY`, the secret held in the
  git-ignored Auth file `.qa/auth`, in both shapes: header-only (`header_via`, no `via`) and shared
  (`via` plus `header_via`), against a local fixture app. `playwright-cli` 0.1.22 for the shared
  shape.
- **Capability exercised:** a guarded `/qa-execute` Execution per shape. Header-only: `tester
  request` authenticates with no browser, an echoed key comes back `<credential>`, `--auth invalid`
  gets a 401 with no `auth_rejected`, and a default call's 401 carries `auth_rejected: true`.
  Shared: the CLI login works and `tester request` carries the session and the injected header, the
  credential-bearing call runs as `run-code --filename`, and no process argv holds the secret.
- **Evidence:** the automated suite covers injection, the variants, masking and the temporary
  file's cleanup with stand-in servers and a fake `playwright-cli`, in CI. The live entries add a
  literal-secret scan over each Execution directory, the committed Execution record and the
  Tester's report, which finds the secret neither with nor without its scheme and no file left
  under the Run's `auth/`.
- **Limits:** a static header only; one fixture app, not a production API. The `env:NAME` source
  and the repo root's `.env` were not exercised live, and neither was `--auth expired`. Values in
  other encodings, screenshots and raw `playwright-cli` artifacts stay outside the masking promise
  (see [Raw artifacts outside the promise](#raw-artifacts-outside-the-promise)).

### Mocking

- **Status:** Supported on the terminal CLI at Claude Code 2.1.308 on macOS, from the recorded live
  entries under [Live enforcement evidence](#live-enforcement-evidence). The desktop app and Linux
  are not exercised.
- **Tested configuration:** a UI case whose precondition states that the cart service answers with a
  server error, against the self-hosted Toolshop fallback, whose UI and API are separate configured
  targets on separate origins. A Practice in `.qa/train/execute.md` names the API's full endpoint
  pattern, and the Role-less Access note names the API's sign-in URL in `identifiers.sign_in_urls`.
  `playwright-cli` 0.1.22.
- **Capability exercised:** a guarded `/qa-execute` Execution in which the Tester mocks the API
  origin's cart endpoint with status 500, the UI shows its error message, and the Execution record
  lists the route under `routes`; a `route` with `--header` refused; and no route left once the
  session closed.
- **Evidence:** the automated suite covers the route grammar, its refusals, the frozen origins and
  sign-in URLs, the record's `routes` and the brief with a fake `playwright-cli`, in CI. The live
  entries add the real host, the real CLI and a real application.
- **Limits:** one application and one condition (a status-500 answer with a short JSON body). The
  `--header` refusal and the route's end at close were shown through the CLI in a session the host
  admitted as guarded, not through a Tester, which mocks only what its case states.

### Operating systems

- **macOS** — Expected to work. Live Executions during development ran on macOS; recorded
  release-gate evidence on the floor version is pending.
- **Linux** — Supported for the automated suite: CI runs it on ubuntu-latest, Node 22 (with a
  fake `playwright-cli`, no browser). A live Execution on Linux is expected to work, with no
  recorded evidence yet.
- **WSL2** — Unsupported. The ladder: **Expected to work** once the drvfs refusal and the PATH
  fixes land and the suite has passed inside WSL2; **Supported** on its own PASS rows at the floor
  or above, with the repo on ext4. A Linux end-to-end row does not move it, and it does not move
  Linux: the two tracks finish separately.
- **Windows** — Unsupported. The ladder: **Expected to work** once the guard amendment, the
  Windows spawn module, the privacy contract and the CRLF work have landed and `windows-latest` is
  green and required; **Supported** on its own PASS rows, including guard-denial with Developer-Mode
  symlinks. Until then nothing here claims a Windows capability, and no row recorded on another OS
  is read as one.

### Trackers

The CLI makes no tracker call on any path. Tracker reads happen through
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

#### On any stack

Knowledge, design and Tester Execution do not depend on the test stack: `/qa-init`,
`/qa-deep-dive`, `/qa-design`, and `/qa-execute` running cases through the Tester against the
application work on any stack. They still need what they always need: a `project.md`, cases, a
reachable target and, behind a login, Access notes. What needs one of the two stacks above is the
code side: indexing test code and binding Automation keys (`/qa-sync`'s code section), running
bound Automations in `/qa-execute`, generation (`/qa-codegen`) and repair (`/qa-codefix`).

Today's route on an unsupported stack: `/qa-init` records the stack it finds; design and run cases
as on any stack; `/qa-sync` skips its code section and says so; `codegen plan` refuses before
`/qa-codegen` asks for any Training, as the stack has no matching test runner or code adapter;
and with no bound Automation, `/qa-codefix` has nothing to repair. Your existing test code keeps
running in your own pipeline, unbound to any case.

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

Three kinds of evidence, kept apart: the automated suite, live detection evidence and live
enforcement evidence. The automated suite can only prove what code does in its own
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

### Live evidence

Only a recorded live entry moves a support status. A demo, a GIF, an informal observation or a
simulated-host test changes no status: none of them is kept where a reader can check it, and a
simulated-host test proves what a script does with synthetic events, not what a host enforces.

A recorded entry is one row of a Markdown table under *Live evidence*, with exactly these columns
in this order:

| qa-skills revision | Claude Code | Surface | OS | Condition | Outcome | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |

Entries keep the Delegate-isolation record's style below: a dated bullet naming the run, then its
table, with one row per recorded condition.

- **qa-skills revision** — `<plugin version> @ <short commit>`. A run from a plugin tree with
  uncommitted changes names no reproducible commit: the probe marks it `-dirty`, and it is never a
  recorded entry.
- **Claude Code** — the host version string the run reported (`claude --version`'s number).
- **Surface** — `terminal CLI` or `desktop app`, then the install method in parentheses
  (`local marketplace`, `--plugin-dir`, `marketplace install`, `faulted copy, --plugin-dir`,
  `faulted copy, local marketplace`, `local marketplace, distinct name`).
- **OS** — OS name and version, classified to one of `macOS`, `Linux`, `WSL2` or `Windows`. A row
  counts only for its own family: a WSL2 cell naming its Linux distribution is `WSL2`,
  never `Linux`, and a PASS on one OS never satisfies another OS's gate.
- **Condition** — the condition's words as the entry contract states them, optionally followed by
  ` — <qualifier>`. The qualifier names the part of a multi-part item the row covers (`crash`,
  `timeout`), never an OS: the `OS` column carries the OS, so the `end-to-end` item's words name
  none.
- **Outcome** — `PASS` or `FAIL` only. An INCONCLUSIVE run is named as a rerun in prose and is never
  a row, so it never counts.
- **Date** — `YYYY-MM-DD`.
- **Evidence** — a Markdown link to committed evidence in the test project
  (`https://github.com/Kinasr/qa-skills-live-evidence/...`).

A probe prints a row in this column order; it prints `TODO: link` where it cannot know the
evidence link, for the engineer to fill. A run it cannot grade is printed on its own line as
`INCONCLUSIVE (rerun, not counted): ...`, never as a row.

`tests/support-doc.test.mjs` pins this format and the gate it feeds: an entry that lacks a field or
carries an outcome other than `PASS` or `FAIL` fails the suite, and the Claude Code row cannot say
**Supported** until every trust-core item and host detection has a `PASS` row on both surfaces,
with each qualifier a multi-part item needs. When one item has more than one row, its most recent
Date decides; on the same Date the later qa-skills revision decides, and only when the Date and the
revision are both equal does a `FAIL` win. So a later failing rerun revokes an earlier `PASS`.

The gate is keyed per (OS family, surface): for every OS the Claude Code `Status:` line names as
Supported, and for each surface, every condition that applies to that OS needs its own `PASS` row.
A Windows row never satisfies a macOS gate, and the suite-only Linux support is not gated by live
rows at all. A condition key may name the one OS it applies to, and then no other OS's gate asks
for it: the Windows-only ACL refusal below is never required of macOS, Linux or WSL2.

#### Installing a local build

A marketplace's name comes from the `name` field of its `.claude-plugin/marketplace.json`, and a
user registers one marketplace per name. This repository's manifest is named `qa-skills`, the same
name the public install registers, so adding a checkout as a marketplace adds no second one: the
host reports that `qa-skills` already exists and now points at the checkout. Every later
`claude plugin update qa-skills@qa-skills` then installs that build, so a newer installed version
can be silently downgraded to the local one. Install a local build by one of these routes, in this
order:

1. **`--plugin-dir`** for a terminal evidence run: `claude --plugin-dir <checkout>/plugin`. A
   session-loaded plugin runs under the reserved `inline` marketplace, so no registered name can be
   repointed. Record the Surface as `terminal CLI (--plugin-dir)`.
2. **A marketplace under a distinct name** for a marketplace install from a local build, such as a
   desktop evidence run: copy `.claude-plugin/` and `plugin/` to a scratch directory, change only
   the copy's `name` to `qa-skills-local`, then `claude plugin marketplace add <scratch>` and
   `claude plugin install qa-skills@qa-skills-local`. Never edit the committed manifest; the copy
   is the served build. Record the install method as `local marketplace, distinct name`
   (`desktop app (local marketplace, distinct name)` for that surface).
3. **Remove the user-level `qa-skills` marketplace first**, with
   `claude plugin marketplace remove qa-skills`, only when neither route above is available. That
   also uninstalls the plugins installed from it, so reinstall them afterwards and then add the
   checkout.

After any `claude plugin update`, confirm the installed version: `claude plugin list` names each
plugin with its marketplace and its `Version`, and a loaded plugin's `version` must be the build you
meant to install. Nothing else reports a downgrade.

#### Live detection evidence

Each surface must show host-version detection working on the floor version, with the host
configuration and the detection route recorded. The condition, in these items' words, is
`host-version detection working on the floor version`:

- desktop app: **Recorded** (row below);
- terminal CLI: **Recorded** (row below).

- **Terminal CLI detection**, 2026-11-13, qa-skills 0.13.1 installed as `qa-skills@qa-skills-local`
  on Claude Code 2.1.308, macOS, with `scripts/probe-trust-core.mjs`. `execute plan` took the
  guarded admission: `CLAUDE_CODE_EXECPATH` was absolute, `--version` answered
  `2.1.308 (Claude Code)` and `AI_AGENT` was `claude-code_2-1-308_agent`.

| qa-skills revision | Claude Code | Surface | OS | Condition | Outcome | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.13.1 @ b550c9c | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | host-version detection working on the floor version | PASS | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/3679761c/evidence/0.13.1-terminal/detection-1) |

- **Desktop app detection**, 2026-11-13, qa-skills 0.13.1 installed as `qa-skills@qa-skills-local`
  in the Claude desktop app, whose bundled Claude Code reported 2.1.321, macOS 27.2.1, with
  `scripts/probe-trust-core.mjs`. `execute plan` took the guarded admission:
  `CLAUDE_CODE_EXECPATH` was the absolute path of the app's bundled binary, `--version` answered
  `2.1.321 (Claude Code)` and `AI_AGENT` was `claude-code_2-1-321_agent`.

| qa-skills revision | Claude Code | Surface | OS | Condition | Outcome | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.13.1 @ b550c9c | 2.1.321 | desktop app (local marketplace, distinct name) | macOS 27.2.1 | host-version detection working on the floor version | PASS | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/9caae3a7/evidence/0.13.1-desktop/detection-1) |

- **0.14.0 detection**, 2026-11-16, qa-skills 0.14.0 installed as `qa-skills@qa-skills-local`,
  macOS 27.2.1, with `scripts/probe-trust-core.mjs`. Terminal CLI on Claude Code 2.1.308, the
  probe's `--installed` profile: `CLAUDE_CODE_EXECPATH` was absolute, `--version` answered
  `2.1.308 (Claude Code)` and `AI_AGENT` was `claude-code_2-1-308_agent`. Desktop app, whose
  bundled Claude Code reported 2.1.325: `CLAUDE_CODE_EXECPATH` was the absolute path of the app's
  bundled binary, `--version` answered `2.1.325 (Claude Code)` and `AI_AGENT` was
  `claude-code_2-1-325_agent`. Both took the guarded admission.

| qa-skills revision | Claude Code | Surface | OS | Condition | Outcome | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.14.0 @ 0a68a48 | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | host-version detection working on the floor version | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/eeefb4ef/evidence/0.14.0-terminal/detection) |
| 0.14.0 @ 0a68a48 | 2.1.325 | desktop app (local marketplace, distinct name) | macOS 27.2.1 | host-version detection working on the floor version | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/eeefb4ef/evidence/0.14.0-desktop/detection) |

#### Live enforcement evidence

On the floor version. Each of the first five items needs a recorded `PASS` on both surfaces, and an
item stays **Pending** on any surface without one. The desktop app bundles its own Claude Code and
cannot be pinned to the floor, so a desktop entry on the app's bundled build counts as on the floor
when that build is at or above it; its row names the version the app reported.

- the Tester guard denying a call outside its allow-lists: terminal CLI **Recorded**; desktop app
  **Recorded**;
- the hook blocking on its own crash and on timeout (`onFailure: "block"`): terminal CLI
  **Recorded** (crash and timeout); desktop app **Recorded** (crash and timeout);
- a background-launched Tester binding to its Execution (`agentId`): terminal CLI **Recorded**;
  desktop app **Recorded**;
- real browser-artifact placement under the Execution directory, confirmed with the real CLI:
  terminal CLI **Recorded**; desktop app **Recorded**, both on 0.13.2 (on 0.13.1 both were
  recorded as `FAIL`: Chromium wrote its profile to the OS temp directory);
- a live Execution end-to-end against a real application, on macOS and on Linux: terminal CLI
  **Recorded** on macOS; desktop app **Recorded** on macOS; Linux **Pending**;

On native Windows one further condition applies to the Claude Code row, and on Windows only:
a secret-bearing directory under a shared `TEMP` is refused with the `icacls` fix named. It
needs a `PASS` row on both surfaces, recorded on a Windows host, before any Windows claim is
Supported; no macOS, Linux or WSL2 gate asks for it, because their privacy guarantee is the file
mode and open flags the code already keeps. It is **Pending**: no row records it yet.

All **Pending** in this release:

- a fresh install, an update from 0.1.1 with cache migration, and an anonymous install from the
  public repository;
- a report received through the private route in `SECURITY.md`;
- the Delegate-isolation probe in the desktop app on the 2.1.308 floor itself (the app ships its
  own build; the recorded desktop cells ran on 2.1.309);
- the Windows-only ACL refusal, on native Windows, on both surfaces.

A macOS `PASS` on the end-to-end item does not move its Linux half: Linux end-to-end stays
Pending until a Linux row lands.

Each run adds a row here:

- **Terminal CLI trust core**, 2026-11-13, qa-skills 0.13.1 installed as `qa-skills@qa-skills-local`
  on Claude Code 2.1.308, macOS 27.2.1, against the self-hosted Toolshop fallback. The four probe
  rows were graded by `scripts/probe-trust-core.mjs` from the saved transcripts and Run files. The
  probe's terminal launcher always uses `--plugin-dir`, so these runs used its installed-plugin path
  (`--prepare-desktop`, a headless `claude -p` launch, `--grade-desktop`), with each row's Surface
  set to the terminal CLI. The crash and timeout runs installed the faulted copy from a local-scope
  marketplace, with the release install disabled. The end-to-end row is an ordinary
  `/qa-skills:qa-execute tc_d68h3nc7 level:ui`: plan, confirm, one bound Tester Execution, ingest,
  and its Execution record committed in the project. Three runs were INCONCLUSIVE and are reruns,
  not counted. In both guard-denial runs the Tester declined the injected out-of-allow-list calls,
  so nothing reached the guard to be denied. In the artifact-placement run the host saved the
  probe's 7.2 MB inventory to a file instead of returning it, so the grader could not bind it to a
  Bash result.
- **Terminal CLI formal reruns**, 2026-11-13, same install, host and OS, with
  `scripts/probe-trust-core.mjs` at `c22468f` in its `--installed` terminal profile,
  which needs no `--plugin-dir`. Guard denial passed without injecting any call. The guard denied the
  sibling's command through a linked plugin root, and denied the own Tester's ordinary artifact Read
  and report Write through planted links. Placement failed: Chromium wrote into
  `playwright_chromiumdev_profile-*` directories in the OS temp directory, outside the Execution.
  The same failure lists files from
  an unrelated Gradle/Kotlin build that was running at the same time, because the grader attributes
  every new file to playwright-cli. The Chromium files fail the condition on their own. These two
  rows supersede the INCONCLUSIVE runs above.

| qa-skills revision | Claude Code | Surface | OS | Condition | Outcome | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.13.1 @ b550c9c | 2.1.308 | terminal CLI (faulted copy, local marketplace) | macOS 27.2.1 | the hook blocking on its own crash and on timeout (`onFailure: "block"`) — crash | PASS | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/3679761c/evidence/0.13.1-terminal/hook-crash-1) |
| 0.13.1 @ b550c9c | 2.1.308 | terminal CLI (faulted copy, local marketplace) | macOS 27.2.1 | the hook blocking on its own crash and on timeout (`onFailure: "block"`) — timeout | PASS | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/3679761c/evidence/0.13.1-terminal/hook-timeout-1) |
| 0.13.1 @ b550c9c | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | a background-launched Tester binding to its Execution (`agentId`) | PASS | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/3679761c/evidence/0.13.1-terminal/agentid-binding-1) |
| 0.13.1 @ b550c9c | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | a live Execution end-to-end against a real application | PASS | 2026-11-13 | [Execution record](https://github.com/Kinasr/qa-skills-live-evidence/blob/3679761c/.qa/executions/2026-11-13-xb8rw77t.md) |
| 0.13.1 @ b550c9c | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | the Tester guard denying a call outside its allow-lists | PASS | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/4c28a76e/evidence/0.13.1-terminal/guard-denial-formal) |
| 0.13.1 @ b550c9c | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | real browser-artifact placement under the Execution directory, confirmed with the real CLI | FAIL | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/4c28a76e/evidence/0.13.1-terminal/artifact-placement-formal) |

- **Desktop app trust core**, 2026-11-13, qa-skills 0.13.1 installed as `qa-skills@qa-skills-local`
  in the Claude desktop app, whose bundled Claude Code reported 2.1.321, macOS 27.2.1, against the
  self-hosted Toolshop fallback. Each probe run was prepared with `--prepare-desktop`, pasted into
  its own desktop Code session on the project, and graded with `--grade-desktop` from that
  session's saved transcript. The crash and timeout runs installed the faulted copy from a
  local-scope marketplace, with the release install disabled. The end-to-end row is an ordinary
  `/qa-skills:qa-execute tc_d68h3nc7 level:ui` in the app: plan, confirm, one background Tester
  Execution, ingest, and its Execution record committed in the project. Placement failed as on the
  terminal CLI: Chromium wrote into `playwright_chromiumdev_profile-*` directories in the OS temp
  directory. The desktop host differs from the terminal one in two ways the probe had not met: it
  records an `Agent` call's `run_in_background` as the string `"true"`, and it refuses a Write over
  an existing file the Tester has not read before any `PreToolUse` hook runs. The probe's grader and
  its planted report link were fixed for both, and the guard-denial PASS ran on the fixed probe.
  Six runs were INCONCLUSIVE and are reruns, not counted. The first guard-denial and binding runs
  named the plugin cache path in their briefs instead of the root the guard trusts, so the guard
  refused the own Tester's ordinary commands. The second guard-denial run stopped at the host's
  Write refusal above. In two binding runs the Tester declined the sibling call the probe injects
  into its brief, so nothing reached the guard to be refused; `agentId` binding stayed Pending on the
  desktop app until the 0.13.2 rerun below. In the first placement run the parent ran the before-inventory inside a compound
  setup call, which the grader cannot bind to the saved listing.

| qa-skills revision | Claude Code | Surface | OS | Condition | Outcome | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.13.1 @ b550c9c | 2.1.321 | desktop app (local marketplace, distinct name) | macOS 27.2.1 | the Tester guard denying a call outside its allow-lists | PASS | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/9caae3a7/evidence/0.13.1-desktop/guard-denial-3) |
| 0.13.1 @ b550c9c | 2.1.321 | desktop app (faulted copy, local marketplace) | macOS 27.2.1 | the hook blocking on its own crash and on timeout (`onFailure: "block"`) — crash | PASS | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/9caae3a7/evidence/0.13.1-desktop/hook-crash-1) |
| 0.13.1 @ b550c9c | 2.1.321 | desktop app (faulted copy, local marketplace) | macOS 27.2.1 | the hook blocking on its own crash and on timeout (`onFailure: "block"`) — timeout | PASS | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/9caae3a7/evidence/0.13.1-desktop/hook-timeout-1) |
| 0.13.1 @ b550c9c | 2.1.321 | desktop app (local marketplace, distinct name) | macOS 27.2.1 | real browser-artifact placement under the Execution directory, confirmed with the real CLI | FAIL | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/9caae3a7/evidence/0.13.1-desktop/artifact-placement-2) |
| 0.13.1 @ b550c9c | 2.1.321 | desktop app (local marketplace, distinct name) | macOS 27.2.1 | a live Execution end-to-end against a real application | PASS | 2026-11-13 | [Execution record](https://github.com/Kinasr/qa-skills-live-evidence/blob/9caae3a7/.qa/executions/2026-11-13-gr175f21.md) |

- **0.13.2 reruns**, 2026-11-13, qa-skills 0.13.2 installed as `qa-skills@qa-skills-local`, macOS
  27.2.1, against the self-hosted Toolshop fallback. 0.13.2 keeps each browser session's Chromium
  profile under its Execution, and its binding probe injects nothing: an intruder Tester launched
  on the own Execution's binding line, with the sibling's brief built by the CLI, is refused on its
  ordinary first command. Placement ran on the terminal CLI (Claude Code 2.1.308, the probe's
  `--installed` profile) and in the desktop app (bundled Claude Code 2.1.321); binding ran in the
  desktop app. No `playwright_chromiumdev_profile-*` directory appeared in the OS temp directory.
  All three were graded with `scripts/probe-trust-core.mjs` at `784f831`, from the saved transcripts
  and Run files. Two grader fixes were made before grading, and each evidence directory keeps the
  earlier grade. The idle sibling's browser writes its own profile under its own Execution, which
  the earlier grader took for a file outside the own Execution, so the terminal placement first
  graded `FAIL`. The desktop parent passed the intruder's brief without its trailing blank lines,
  so binding first graded INCONCLUSIVE.

| qa-skills revision | Claude Code | Surface | OS | Condition | Outcome | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.13.2 @ e8822f0 | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | real browser-artifact placement under the Execution directory, confirmed with the real CLI | PASS | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/837d0f19/evidence/0.13.2-terminal/artifact-placement) |
| 0.13.2 @ e8822f0 | 2.1.321 | desktop app (local marketplace, distinct name) | macOS 27.2.1 | real browser-artifact placement under the Execution directory, confirmed with the real CLI | PASS | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/837d0f19/evidence/0.13.2-desktop/artifact-placement) |
| 0.13.2 @ e8822f0 | 2.1.321 | desktop app (local marketplace, distinct name) | macOS 27.2.1 | a background-launched Tester binding to its Execution (`agentId`) | PASS | 2026-11-13 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/837d0f19/evidence/0.13.2-desktop/agentid-binding) |

- **Header credentials**, 2026-11-14, qa-skills 0.13.2 installed as `qa-skills@qa-skills-local`
  on Claude Code 2.1.308, terminal CLI, macOS 27.2.1, against a local fixture app that requires an
  `Authorization: Bearer` header and echoes the headers it received. Both secrets are in the
  git-ignored Auth file `.qa/auth`, named by `auth:` keys, the source `/qa-train access` proposes,
  and `train check access` reports no unignored file. Each shape is an ordinary
  `/qa-skills:qa-execute` Run (plan, confirm, one Tester Execution, ingest), with its Execution
  record committed in the project. After ingest, a committed scan script read the secret from the
  Auth file, printed no value, and found it neither with nor without its `Bearer` scheme in the Run
  dir, the record or the Tester's report, and no file under the Run's `auth/`. A process watcher
  sampled every argv during each Run. Header-only: the default call got 200 with its echoed key as
  `<credential>`. `--auth invalid` got 401 with no `auth_rejected`: the code sets that only on a
  default call's 401, so a default call to an endpoint that always refuses got 401 with
  `auth_rejected: true`. Shared: the CLI login worked, `tester request` carried the session and the
  header, its one credential-bearing call ran as `run-code --filename`, and none of the 18
  `playwright-cli` argvs held the secret. Three earlier Runs are reruns, not counted. In two, the
  fixture echoed the key only beside the `authorization` name, which pattern redaction shows as
  `<redacted>`, so `<credential>` was not visible. In the third, the fixture's account field was
  named for a session, a credential word, so the Tester could not read the account. Every scan was
  clean.

| qa-skills revision | Claude Code | Surface | OS | Condition | Outcome | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.13.2 @ e8822f0 | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | a guarded Execution with a Header credential against a local fixture app, with a literal-secret scan — header-only | PASS | 2026-11-14 | [Execution evidence](https://github.com/Kinasr/qa-skills-live-evidence/tree/3a07a282/evidence/0.13.2-header/header-only) |
| 0.13.2 @ e8822f0 | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | a guarded Execution with a Header credential against a local fixture app, with a literal-secret scan — shared | PASS | 2026-11-14 | [Execution evidence](https://github.com/Kinasr/qa-skills-live-evidence/tree/3a07a282/evidence/0.13.2-header/shared) |

- **Mocking**, 2026-11-14, qa-skills 0.13.3 installed as `qa-skills@qa-skills-local` on Claude Code
  2.1.308, terminal CLI, macOS 27.2.1, against the self-hosted Toolshop fallback (UI and API on
  separate origins). The guarded row is an ordinary `/qa-skills:qa-execute tc_5e7vr0rs level:ui`
  Run (plan, confirm, one bound Tester Execution, ingest), with its Execution record committed in
  the project. `execute plan` froze the API's origin and the sign-in URLs the Access notes name.
  The Tester routed `http://localhost:8091/carts**` with status 500 and a 26-byte JSON body, as the
  Training Practice states, then added a product. The page showed a "Server Error" alert, no
  confirmation and no cart count, and the case passed. The record's `routes` holds
  `http://localhost:8091/carts** → 500`. After ingest, `playwright-cli list` showed no browser and
  `route-list` reported the session not open. The boundary row planned, confirmed and opened the
  same case through the CLI in a 2.1.308 host session that took the guarded admission. A `route`
  with `--header` was refused `route_header` and spent an action. The same route without it was
  admitted, and `route-list` showed it. After `execute close`, no browser and no route were left.

| qa-skills revision | Claude Code | Surface | OS | Condition | Outcome | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.13.3 @ 8bc7f64 | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | a guarded Execution mocking a server error its case states, against a real application — guarded | PASS | 2026-11-14 | [Execution record](https://github.com/Kinasr/qa-skills-live-evidence/blob/84c17cc1/.qa/executions/2026-11-14-1yfbqn8k.md) |
| 0.13.3 @ 8bc7f64 | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | a guarded Execution mocking a server error its case states, against a real application — boundary | PASS | 2026-11-14 | [Execution evidence](https://github.com/Kinasr/qa-skills-live-evidence/tree/84c17cc1/evidence/0.13.3-mocking/boundary) |

- **0.14.0 trust core**, 2026-11-16, qa-skills 0.14.0 installed as `qa-skills@qa-skills-local`,
  macOS 27.2.1, against the self-hosted Toolshop fallback, on the terminal CLI (Claude Code 2.1.308)
  and in the desktop app (bundled Claude Code 2.1.325). Every probe row was graded by
  `scripts/probe-trust-core.mjs` at `0a68a48` from the saved transcripts and Run files. On the
  terminal CLI, guard denial, binding and placement used the probe's `--installed` profile. The
  crash and timeout runs used its installed-plugin path (`--prepare-desktop`, a headless `claude -p`
  launch, `--grade-desktop`), so their grade lines name the desktop app; the rows name the terminal
  CLI they ran on. In the desktop app each probe prompt ran in its own Code session on the project.
  Every crash and timeout run installed the faulted copy from a local-scope marketplace, with the
  release install disabled. Placement found no browser file outside the own Execution or the idle
  sibling's on either surface. Each end-to-end row is an ordinary
  `/qa-skills:qa-execute tc_d68h3nc7 level:ui`: plan, confirm, one bound Tester Execution, ingest,
  and its Execution record committed in the project. On the terminal CLI the first Run finished
  `blocked` (Run `6w0azksh`): the cart was right, but the Tester did not observe the short-lived
  confirmation message. It is a rerun, not counted, and its record is committed beside the passing
  one. Evidence files have workstation paths replaced by `~` and `$TMPDIR`.

| qa-skills revision | Claude Code | Surface | OS | Condition | Outcome | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.14.0 @ 0a68a48 | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | the Tester guard denying a call outside its allow-lists | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/eeefb4ef/evidence/0.14.0-terminal/guard-denial) |
| 0.14.0 @ 0a68a48 | 2.1.308 | terminal CLI (faulted copy, local marketplace) | macOS 27.2.1 | the hook blocking on its own crash and on timeout (`onFailure: "block"`) — crash | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/eeefb4ef/evidence/0.14.0-terminal/hook-crash) |
| 0.14.0 @ 0a68a48 | 2.1.308 | terminal CLI (faulted copy, local marketplace) | macOS 27.2.1 | the hook blocking on its own crash and on timeout (`onFailure: "block"`) — timeout | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/eeefb4ef/evidence/0.14.0-terminal/hook-timeout) |
| 0.14.0 @ 0a68a48 | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | a background-launched Tester binding to its Execution (`agentId`) | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/eeefb4ef/evidence/0.14.0-terminal/agentid-binding) |
| 0.14.0 @ 0a68a48 | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | real browser-artifact placement under the Execution directory, confirmed with the real CLI | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/eeefb4ef/evidence/0.14.0-terminal/artifact-placement) |
| 0.14.0 @ 0a68a48 | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | a live Execution end-to-end against a real application | PASS | 2026-11-16 | [Execution record](https://github.com/Kinasr/qa-skills-live-evidence/blob/eeefb4ef/.qa/executions/2026-11-16-ghxpyatj.md) |
| 0.14.0 @ 0a68a48 | 2.1.325 | desktop app (local marketplace, distinct name) | macOS 27.2.1 | the Tester guard denying a call outside its allow-lists | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/eeefb4ef/evidence/0.14.0-desktop/guard-denial) |
| 0.14.0 @ 0a68a48 | 2.1.325 | desktop app (faulted copy, local marketplace) | macOS 27.2.1 | the hook blocking on its own crash and on timeout (`onFailure: "block"`) — crash | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/eeefb4ef/evidence/0.14.0-desktop/hook-crash) |
| 0.14.0 @ 0a68a48 | 2.1.325 | desktop app (faulted copy, local marketplace) | macOS 27.2.1 | the hook blocking on its own crash and on timeout (`onFailure: "block"`) — timeout | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/eeefb4ef/evidence/0.14.0-desktop/hook-timeout) |
| 0.14.0 @ 0a68a48 | 2.1.325 | desktop app (local marketplace, distinct name) | macOS 27.2.1 | a background-launched Tester binding to its Execution (`agentId`) | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/eeefb4ef/evidence/0.14.0-desktop/agentid-binding) |
| 0.14.0 @ 0a68a48 | 2.1.325 | desktop app (local marketplace, distinct name) | macOS 27.2.1 | real browser-artifact placement under the Execution directory, confirmed with the real CLI | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/eeefb4ef/evidence/0.14.0-desktop/artifact-placement) |
| 0.14.0 @ 0a68a48 | 2.1.325 | desktop app (local marketplace, distinct name) | macOS 27.2.1 | a live Execution end-to-end against a real application | PASS | 2026-11-16 | [Execution record](https://github.com/Kinasr/qa-skills-live-evidence/blob/eeefb4ef/.qa/executions/2026-11-16-89shn1cp.md) |

- **0.14.1 guard re-check**, 2026-11-16, qa-skills 0.14.1 installed as `qa-skills@qa-skills-local`,
  macOS 27.2.1, against the self-hosted Toolshop fallback. 0.14.1 changed the Tester guard after the
  0.14.0 entries: the wrapper's `--expect` wait for a short-lived message. Guard denial ran again with
  the same probe, on the terminal CLI (Claude Code 2.1.308, `--installed` profile) and in the desktop
  app (bundled Claude Code 2.1.325, its own Code session on the project), graded by
  `scripts/probe-trust-core.mjs` at `4c3d81f`. The other 0.14.0 entries stand for 0.14.1, which
  changed nothing they exercise.

| qa-skills revision | Claude Code | Surface | OS | Condition | Outcome | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.14.1 @ 4c3d81f | 2.1.308 | terminal CLI (local marketplace, distinct name) | macOS 27.2.1 | the Tester guard denying a call outside its allow-lists | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/0fdb5ff9/evidence/0.14.1-terminal/guard-denial) |
| 0.14.1 @ 4c3d81f | 2.1.325 | desktop app (local marketplace, distinct name) | macOS 27.2.1 | the Tester guard denying a call outside its allow-lists | PASS | 2026-11-16 | [probe run](https://github.com/Kinasr/qa-skills-live-evidence/tree/dc73f90d/evidence/0.14.1-desktop/guard-denial) |

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

  The matrix records four role cells per surface and is kept in the form it was recorded, not
  recast as single-condition entry rows.

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

For an `env:NAME` login password, the CLI uses its own environment first, then the repo root's
`.env` when the variable is unset. An explicitly empty environment variable stays missing. The CLI
reads plain `NAME=value` lines literally (including spaces, quotes, `#` and `$` in the value),
without interpolation, shell evaluation or exporting anything; `export NAME=value` is not read.
The first assignment for a name wins; an empty value is missing. The file must be git-ignored
and untracked: add `/.env` to the repo root's `.gitignore`, and if already tracked run
`git rm --cached -- .env`. `check-file` and `train check access` refuse an unsafe existing `.env`
for an Access note naming an `env:` source. Login also checks immediately before reading it;
an environment value needs no `.env`. The password is never printed by the CLI. Password `file:`
sources keep their existing behaviour.

A **Header credential** uses `header_via`, `identifiers.header` (an HTTP header name), and
optionally `identifiers.scheme` (one HTTP token, such as `Bearer`). The new keys name metadata and a
source, never a credential value. `header_via: auth:KEY` reads the key from the Auth file
`.qa/auth`, which must be git-ignored and untracked as `.env` must; `header_via: env:NAME` uses the
same environment-first, literal `.env` resolver and Git protection described above. A note must cover its origin: execution
selects accounts at `url:<origin>/`, so a note matching only `/api/` is never selected. `cookie`,
`host` and `proxy-authorization` cannot be the configured header.

A note with `header_via` and no `via` opens a **header-only session**: no browser, navigation or
landing check. Only `tester request` is available; `tester do` refuses `header_only_session`.
The CLI sends requests with Node's `fetch`, after the ordinary grammar, origin and account `match`
checks, with a 30-second timeout and no redirect following. It reads the session's own note and
the Run's pinned knowledge root, so a Tester's `--root` cannot select a different source. The
configured header name is also forbidden in Tester-supplied headers, case-insensitively.

A shared note with both `via` and `header_via` keeps its browser login and adds the header only
to `tester request`. Browser and shared sessions still require `playwright-cli`.

For shared and header-only sessions, every Role's resolved credential, with and without its scheme
and including HTTP-trimmed spellings, becomes `<credential>` on
decoded strings (keys included) before response limits or inline previews: bodies, allowed response
headers, saved responses, errors, `tester do` output and the guard trace. Ingest also scrubs
`tester.report.md` and the Execution record using retained values. The existing pattern scrub also applies. A
default credential-bearing request's 401 sets `auth_rejected: true` on the output and trace for
information; it neither stops the Execution nor pauses its note or decides a result. Other
encodings, screenshots and the raw artifacts below remain outside this literal-masking promise.

**Credential variants.** A step may request `--auth absent`, `--auth invalid` or `--auth expired`.
Each suppresses session cookies; `absent` omits the Header credential, `invalid` sends a fresh
random value behind its scheme, and `expired` uses the note's `expired_via: env:NAME` source.
Expired values receive the same literal masking as real credentials. Invalid and expired variants
need a Header credential; an expired variant also needs a resolving expired source. Refusals are
Blocked `step`; wrong-role cases use Role notes. A variant response's **`Set-Cookie` can still
change the shared browser session**, even though the outgoing call suppressed its cookies.

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
`abc` too. A boolean or null is never redacted, since it carries no secret: `{"session": true,
"token": null}`, `"remember_token": null` and `session=true` keep their values, in parsed and cut
bodies and in page text alike. A quoted `"true"` is a string and still goes unless its key is exempted as below.

For response bodies and `tester do` page text, the engineer may declare `redaction_exempt: [sessions, sessionCount]`
in `.qa/train/execute.md` frontmatter. JSON keys match exact names case-insensitively. Page-text pair
keys and snapshot accessible names match a trailing word run case-insensitively only after
allowlisted count words such as `Total` or `number of`, never state words such as `Current` or `Active`. Declaring `sessions` keeps
`Total sessions: 3`, but `password sessions: x` and `activeSessions: 9` still lose their values.
Only names whose credential words are `session(s)`, `cookie(s)` or `token(s)` are eligible. Passwords,
secrets, API keys, private keys, bearer, authorization and session-cookie identifiers cannot be
exempted. An exempt leaf keeps its value (`sessions: 3`); an object or array is still redacted
whole, including in cut bodies. Exempt strings still pass token-format and page-text scrubs.
`execute open` pins the list from the Run's root; a Tester-supplied `--root` cannot change it.
The list also applies to non-JSON bodies and snapshot controls' accessible names. Headers,
`{name, value}` entries, URL queries, playwright errors, outward text and training checks stay unchanged.

### Raw artifacts outside the promise

The scrubbing reaches only what the Tester returns through the wrapper and what it saves through
it. It does **not** reach the files `playwright-cli` writes by itself, which `Read` may then admit
whole: the session's earlier page snapshots under `executions/<id>/`, its screenshots and trace
files, the CLI's own logs, and anything else under the Execution directory the Tester never passes
through the wrapper. Values visible there are not scrubbed and can reach the model; the same holds
for anything the Tester copies from such a file into its own `tester.report.md`.

### Storage and lifecycle

A Run's directory lives in the OS temp dir: `execute plan` makes one and prints its absolute path
as `Run dir:`. Nothing deletes a run dir automatically, and ordinary artifacts survive ingest;
deleting it is the engineer's job. One row per store:

| Store | What it holds | Normal retention | Retry or reset | Left by a crash |
|---|---|---|---|---|
| `<run>/execute.json` | the pinned plan: case text and digests, Roles, target, caps | kept; no retry deletes it | never deleted | remains |
| `<run>/dispatch.json` | mutable scheduling state: locks, pauses, retries, breaker, the Tester's raw reply | kept, but `execute ingest` removes the reply once the record is written | updated in place | remains |
| `<run>/<id>.reply.md` | a Tester's raw reply, written by `/qa-execute` for `execute record` | removed by `execute record`, which reads it | written afresh for each attempt | remains |
| `<run>/.playwright/` | the session anchor `playwright-cli` scopes its sessions to | kept | kept | remains |
| `<run>/auth/<acc>.json` | a CLI login state made for one Execution (mode 0600 in a 0700 dir) | deleted once no queued Execution needs its note; every Execution logs in fresh | remade by the next Execution's login | removed by `execute ingest`; otherwise remains |
| `<run>/executions/<id>/brief.md` | the Tester's brief, whose first line binds it | kept | removed with the directory | remains |
| `<run>/executions/<id>/guard.json` | the action trace ingest reads: used calls, stops, sessions | kept | removed with the directory | remains |
| `<run>/executions/<id>/tester.report.md` | the Tester's raw report | kept | removed with the directory | remains |
| `<run>/executions/<id>/responses/<n>.json` | saved HTTP responses, scrubbed before saving | kept | removed with the directory | remains |
| `<run>/executions/<id>/uploads/` | files generated from upload recipes the Tester may attach | kept | removed with the directory | remains |
| `<run>/executions/<id>/.playwright-cli/` | the raw files `playwright-cli` writes itself: snapshots, screenshots, traces, logs (outside the scrubbing promise) | kept | removed with the directory | remains |
| `<run>/executions/<id>/profiles/<session>/` | a browser session's Chromium profile, with its cookies and Local Storage, a Role's signed-in session among them; outside the Tester's Read allow-list | removed by `execute close` once its session is closed, or by a failed `execute open`; a CLI login's own profile goes once its state is saved | removed with the directory | remains |
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
run — in the summary, and as the record front's `not_run` keys, with no block of their own — so
their previous result stays the latest; kept login states are removed and every recorded
session is closed first. Nothing is rolled back: the application keeps whatever was done, and a
browser a crash left open must be closed by hand. The record is written once; a second ingest
refuses rather than rewriting it. `execute follow-ups` then builds the work list and takes the
dirty-tree snapshot when follow-up work actually resumes, and `execute summary --dir <run-dir>` can
be run at any time to see a Run's follow-up state.

### Entities left in the application

Everything the Tester creates in the application stays in it. Case prose may instruct tagging or
listing created entities, and the report may name them, but `created` is optional and an
interrupted run can lose the list. Nothing is torn down: `execute close` and `execute ingest` close
sessions but delete no application data, and cleaning up entities the Tester leaves behind is the
engineer's job.

The ingest summary groups what was left by case and Role: one line per case block that reports
`created` entities, `<Key> (<Roles>): <label>; <label>…`, from the record's already scrubbed
labels. The group is capped like the other summary groups, and past the cap `and N more` points at
the Execution record for the rest. Its heading keeps the tag note: entities are tagged
`qa-<run-id>` where the application's free-text fields allowed it, so the application can be
searched for what the list misses.

An Execution that acted without a valid report (its report is missing or off-contract) left
entities the record cannot list: the summary warns with how many, and names those case Keys, saying
anything they created is unlisted. `execute ingest`'s JSON carries that count as
`unreported_acted`, beside `created`. Ingest still deletes nothing and adds no report field.

### Mocking in guarded manual Execution

When a Test Case's plain precondition or step prose, or `.qa/train/execute.md`, states a server,
network or data-return condition, the Tester mocks it with declarative `route` and `unroute` commands.
Mocking is strictly scoped: only a condition the case or Training states may be mocked, and never to
get past an unexpected failure (an unexpected server error is what the Tester reports). If a case
asks for a condition but neither the case nor Training names an endpoint pattern, the Execution ends
Blocked `precondition`.

The guard enforces hard limits on what may be routed:
- **Reach:** a path resolves onto the Run's target origin. A full URL may also name the origin of
  another target configured in `.qa/project.md`, such as a UI target's API served from its own
  origin; `execute plan` freezes those origins into the Run, with the sign-in URLs the Access notes
  name there (`login_url` and `identifiers.sign_in_urls`). A route that could match one of them is
  refused, and a route on such an origin is refused outright while no sign-in URL is known for it.
  The Role's Access note `match` applies only on the target origin. `goto` and `tester request`
  still stay on the target origin.
- **Refused outright:** header flags (`--header` and `--remove-header` are refused because they rewrite
  outgoing request headers), patterns on other origins or schemes than those above, host globs, URL credentials, patterns
  outside the Role's Access note `match`, any pattern that can match the session's login URL, and
  bodies over 64 KB (65,536 UTF-8 bytes). A route with neither a status nor a body is also refused.
- **Cap accounting:** every `route` and `unroute` call, whether admitted or refused, counts toward
  the per-Execution action cap.
- **The record:** each admitted call is recorded in the Execution record's `routes` list in call order
  (`"<pattern> → <status>"` or `"unroute …"`), with bodies recorded only as byte counts, so downstream
  evidence, Bug drafts and follow-ups see that the run was mocked.
- **Lifetime:** routes end with the sessions when the Execution closes (`execute record` and
  `execute ingest`); no mock outlives its Execution, and one Role's routes never affect another Role's
  session.
- **Evidence:** a mocked Passed is evidence about the stated condition: because the case or Training
  stated the condition, the mock is the precondition rather than a substitute for the target, proving
  how the UI handles that condition.

## Non-production use

The supported use of `/qa-execute` is **non-production targets with test accounts**. That is
stated as the supported use, not enforced on any target. Say plainly what the safeguards do not
do: permitted actions mutate application data; nothing enforces that a target is non-production,
and there is no network-egress control. Origin checks run before explicit navigation and
requests; navigation triggered by an action is checked only after it happens, so it cannot be
prevented. Destructive-action limits are brief instructions in case prose and training, never
enforcement. `bypassPermissions` adds no prompt boundary — the Tester's boundary is its guard's
closed allow-lists.
