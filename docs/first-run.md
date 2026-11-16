# First run

The full walk from a fresh install to a first Execution record, with the edge cases. The README's
quickstart is the short version of this walk. Set up first: Claude Code **2.1.308 or newer**,
**Node >= 22**, `playwright-cli` **0.1.22 or newer**, and a repository with at least one commit —
see the README's prerequisites and the
[support matrix](https://github.com/Kinasr/qa-skills/blob/v0.14.1/docs/support.md). All three
tracker paths below reach a first Execution; the examples use a synthetic library-loans application
at `https://staging.example.test` with two Test levels, `ui` as a browser level and `api` as an
API level.

### What you will be asked to supply

Before you start, prepare:

- **Target origin, levels, stack and Roles** for configuring `.qa/project.md`.
- **Intended behaviour and category dispositions** for settling Features and Rules in `/qa-deep-dive`.
- **Accounts and access, including saved-login capture and renewal** for teaching `/qa-train access`.
- **Any setup or API-operation details execution needs** for running cases in `/qa-execute`.

## 1. Set up the project

Run `/qa-skills:qa-init` in your repository and answer its questions. On its Card you accept, edit,
or drop each numbered item; a Tier you already picked is shown as picked and needs no decision;
nothing is written until you reply. Init writes `.qa/project.md` only. The Card **proposes `targets`
and `execute_levels`** too, from your repo's configuration or your answer, so a freshly initialised
project can execute:

- `targets`: a name → the exact `http` or `https` origin of your non-production application. The
  origin has no path, trailing slash, query, fragment or user information.
- `execute_levels`: a level → `browser` or `api`, where every key already exists in the Card's
  `stack.levels`. Unmapped levels are skipped.

When you accept them, init writes exactly these lines into the existing YAML frontmatter of
`.qa/project.md`. The walk's example declares both levels of the library-loans application on its
one origin:

```yaml
targets: {staging: "https://staging.example.test"}
execute_levels: {ui: browser, api: api}
```

`staging` is the target name you will pass as `target:staging`; `ui` and `api` are the Test levels
the Test Cases can take, and both run against that one origin. `ui` executes in a browser and
`api` through `tester request`, which stays on the target origin and does not follow redirects. At
`api`, the session's cookies from the Access note's login apply, and a Header credential applies
only when the note has one (see the API-only variant). The Tester never sets `Authorization`,
`Cookie`, `Proxy-Authorization`, `Host` or the note's configured header name; the CLI injects that
Header credential itself, and the Tester never sees it. A token the API makes you acquire (OAuth,
refresh tokens, a login endpoint that mints one) stays outside this example. Every `execute_levels`
key already exists in `stack.levels` (`[ui, api]` here).

When the UI and API run on separate origins, name both origins in `targets` and bind each
Test level in `level_targets`. A level left out uses the first entry in `targets`, but a selection
that splits across targets with a level left out is refused, so map every level that differs:

```yaml
targets: {local-ui: "http://localhost:4200", local-api: "http://localhost:8091"}
execute_levels: {ui: browser, api: api}
level_targets: {api: local-api, ui: local-ui}
```

With plain target slugs (`local-ui`, `local-api`), init offers that `level_targets` mapping as a
Suggested answer on the Card whenever more than one Target and more than one executable level exist.

Init never writes what you did not approve: a map the Card asks for needs an explicit answer,
and a dropped map is simply omitted. With either map missing, `/qa-execute` refuses:
first `no_targets`, then `no_execute_levels`, so a project without them cannot reach an Execution
until you revisit the Card. Init preserves both maps on later maintenance runs unless you choose
otherwise. After any edit of `.qa/project.md` — including re-running init — ask Claude Code to
validate it with the CLI's `check-file` command and resolve every error before continuing
([docs/cli.md](cli.md)).

**Pick a tracker path.** Init asks which of these applies, and the walk follows all three below;
only the project frontmatter's `tracker` map differs.

- **No tracker.** Say so; init omits `tracker` entirely and writes a valid project without one.
  Use committed files or the conversation as References. You reach a first Execution with no
  tracker account at all.
- **Story-only Jira, without Publish.** Give the project and the key pattern, and it needs nothing
  else: init needs just `provider`, `project` and `key_pattern`, together; no test-management issue
  types. Cases and Test Scenarios then reference existing stories; `/qa-publish` is refused as
  not configured, which is the point of the path. For project `DEMO`, the accepted line is:

  ```yaml
  tracker: {provider: jira, project: DEMO, key_pattern: "^DEMO-[0-9]+$"}
  ```

  Tell init the host plus the authenticated connector, CLI or environment-variable **name** it
  should read the tracker through. If it cannot read the tracker yet, supply the setup values when
  asked. Run `/qa-skills:qa-train access` to retain that access method, with the note matching
  `tracker:DEMO-`. Establishing working read access does **not** include Publish.
- **Test management.** Use a named connector or CLI whose workflows cover what you need; there is
  no generic Xray/Zephyr support claim. Ask init to configure Publish only if wanted: the Suite,
  Scenario and Case issue types, the story link type, the initial status and the marker field and
  label. All three issue types must accept the marker field and label in the create call itself.
  This is expected to work until a named configuration passes the release checks
  ([Trackers row](https://github.com/Kinasr/qa-skills/blob/v0.14.1/docs/support.md#trackers)).

**YAML quoting.** `.qa/project.md` is checked by a limited YAML dialect. Use double-quoted strings
where quoting is needed, as in the Jira pattern above; a single-quoted string inside a nested flow
map is refused ("a nested collection is outside the dialect here"), as is a raw unmatched quote.
Every list or map must stay on the same line inside `targets`, `execute_levels` and `tracker`, and
both maps must be non-empty. A wrong origin is refused naming the exact field (`targets.staging`),
and so is an `execute_levels` key no `stack.levels` entry declares.

Init also prints an **Agent pointer** to paste into your repository's agent guidance, and reports
an Automation-key declaration for your chosen stack when it is needed; init writes neither.
Paste the pointer, copy any declared text per its instruction, and commit what you accepted when
you like — a dirty working tree is fine everywhere except where a step below says otherwise.

At close, a fresh `/qa-init` names exactly **one next step**: `/qa-skills:qa-train access` when a
login (or the Role-less note `observe:` needs) is missing, and otherwise straight to the concrete
`/qa-skills:qa-deep-dive <feature-slug> human:<you>` (or `file:`/`observe:`). If your app needs no
login and you do not use `observe:`, you skip access training knowingly.

## 2. Teach application access

If Cases need a login, run `/qa-skills:qa-train access`. It asks what the app is and how to log in;
for a single-page user/password form it names the user and where the password lives, for SSO, MFA
or a multi-page login you save a login state yourself. You are never asked for a credential: name
the connector, CLI or file that carries it.

- One Access note is one test account, one file. Run it once per Role your Test Cases will use,
  plus a Role-less default note when cases log in without a Role, and a Role-less note for
  `observe:` even when no case does. A Role-less note never stands in for a named Role.
  Add a Role the project config lacks with `/qa-skills:qa-init --add-role <name>`; a case naming
  a Role outside `project.roles` is an Integrity error before anything runs.
- **Password form:** a git-ignored file such as `.qa/.auth/staging.password`, holding the password
  alone (write it with your editor, or name an environment variable). `/qa-train access` prints the
  steps to write that file, naming the path the note carries.
- **Saved login / SSO:** for an app with SSO, MFA or a multi-page login, you capture a saved login
  yourself. `/qa-train access` prints the browser steps to run: log in from a temporary directory
  outside the repo so `playwright-cli`'s snapshots and logs land there, save the state with
  `playwright-cli state-save`, and close the browser. The file, e.g. `.qa/.auth/staging.json`, holds
  session cookies; keep the file ignored via the ignore line the access step offers (`/.qa/.auth/`).
  Renew it on expiry by saving the state again the same way. You are never asked for a credential,
  only for where it lives; never paste passwords, tokens or login-state contents into chat or
  Training.

Before you create either kind of file, `/qa-train access` reports `access_files`: every
login-state or password file the notes name that Git does **not** ignore, with the exact
`.gitignore` line — usually:

```gitignore
/.qa/.auth/
```

It offers that line and appends it to `.gitignore` as its second write only on an explicit yes; a
no leaves `.gitignore` unchanged. The line is added idempotently (never a duplicate), and ignoring
a file does **not** untrack it: a file Git already tracks is reported `tracked`, and you fix that
with `git rm --cached <path>` yourself. Execution refuses any login file that is missing, or
tracked, or sits in a path Git does not ignore — so re-run `/qa-train access` after moving files.

On the guided first-run path, where the access run is a fresh setup (`access.md` did not exist), its
close names the concrete `/qa-skills:qa-deep-dive <feature-slug> human:<you>` last, adding
`observe:<url> "<what to look at>"` when a note reaches the application. A run that found an
existing `access.md` names no continuation.

## 3. Settle one Feature

Use a committed file that describes the required behaviour, a tracked story, or the conversation:

```text
/qa-skills:qa-deep-dive first-feature file:docs/requirements.md --focus "<verb phrase>"
```

To keep your first Feature small enough to finish in one sitting, pass `--focus "<verb phrase>"`
naming the functionality to walk. The References are still read in full, but other whole
Functionalities are deferred explicitly so no scope silently disappears, and only unanswered
questions are parked.

With no document, use `/qa-skills:qa-deep-dive first-feature human:<your-name>` and describe the
intended behaviour; with a story-only tracker's working read access and a matching Access note,
`tracker:DEMO-1` works too. Answer the interview to settle Rules — each one a statement the
Feature's cases will cover; park what you cannot answer. A failed Reference stops the intake.

Optionally, add `observe:<url> "<what to look at>"` to record an Observation of the running app:
`observe:` needs a Role-less Access note for that target's origin, and what is seen becomes a Rule
only when you confirm it.

## 4. Design the Test Cases

```text
/qa-skills:qa-design first-feature
```

Agree the Test Scenario split. There is no level question. `/qa-design` writes **Layer-free cases**:
a case carries no Test level, and its claim holds on any one layer that reaches it, so the layer is
chosen when it runs. A case is bound to a level only when its claim binds one — a visual layout to
`ui`, a payload contract to `api`, or a denial that must hold on every level. The design report
shows each binding and its reason; if a binding is wrong, unbind the case there before executing.
Delegates fill the scenario files. Read the generated Test Cases: at least one needs a
`**Steps.**` numbered list and a `**Expected result.**` paragraph, because a case missing either is
skipped at Execution, not executed. Empty scenario files cannot execute; follow any reported re-run
command if filling failed, and check each case's Roles have Access notes. Test code for a case comes
later, from `/qa-skills:qa-codegen`, once its stack is trained.

## 5. Make a first Execution

Review the setup and generated knowledge; commit what you want to keep. A fresh repository must
have a commit before this step (`Execution needs a resolving HEAD`); uncommitted case edits still
execute, as edited.

```text
/qa-skills:qa-execute first-feature level:ui level:api target:staging
```

The two `level:` filters run each Layer-free case once at `ui` and once at `api`. A case bound to
one of them runs at that level; a case bound only to another level is a filter exclusion, reported
apart from skips rather than skipped. With no `level:` filter a Layer-free case runs at its
Automations' sole executable level when they share one, otherwise at the level a
`train/execute.md` Practice names, or at the one browser-mode level. A Practice naming a level that
cannot run, or Practices naming more than one level, stops the plan `no_default_level` even when a
browser level exists; the same stop applies when none of these resolves.

It refuses anything not ready before it plans: no targets or no execution levels (`no_targets`,
`no_execute_levels`), no commit, and a scope token that names no live Key; raw URLs are not
targets. Then it prints the selection: origin, each case's bound, selected, executed and omitted
levels, each case's Role → Access note mapping, the Run directory, and the ingest command for when
the Run is over. Read any `Excluded by filters` lines too: they name the cases the level filter
left out. Confirm to begin; no login or browser opens before you confirm, and the skill is
interactive only: never run `/qa-execute` unattended. Before it schedules anything, the Run also
verifies your Claude Code host against the
[supported floor](https://github.com/Kinasr/qa-skills/blob/v0.14.1/docs/support.md#claude-code); a
refusal names the support-matrix row and the version found, and makes no login or browser call.
Cases are then executed by background Testers inside the Run's guard, which allows the calls
through the CLI's `tester` wrapper only. A case whose login access fails pauses once so you can fix
or skip that note.

### API-only project

A product with no browser level declares one API level and executes with `level:api`. Copy the
frontmatter into `.qa/project.md` as step 1 describes:

```yaml
targets: {staging: "https://staging.example.test"}
execute_levels: {api: api}
```

A Layer-free case then has no default level: with no `level:` filter the plan stops
`no_default_level`, unless the case's Automations share one executable level or a `train/execute.md`
Practice names a default level, because a Layer-free case otherwise defaults to the browser-mode
level and this project has none. The variant's command plans each case at `api`:

```text
/qa-skills:qa-execute first-feature level:api target:staging
```

An API that takes a key or bearer token authenticates through a header-only Access note.
`/qa-skills:qa-train access` proposes the note. The guide never asks you for the value: you name
where the secret lives, and you never paste it into the conversation, Training or the note.

```yaml
match: ["url:https://staging.example.test/"]
header_via: env:STAGING_API_KEY
identifiers: {header: X-API-Key}
sources: [human:reader]
added: 2026-11-05
```

`header_via` names an environment variable; `identifiers.header` is the header the CLI adds, and an
optional `identifiers.scheme` (such as `Bearer`) prefixes the value. Put the secret in
`STAGING_API_KEY` in the environment Claude Code was started from, or as `STAGING_API_KEY=<value>` on
its own line in the repo-root `.env`, which stays git-ignored: add `/.env` to `.gitignore`. The
`.env` parser reads only plain `NAME=value` lines: quotes stay part of the value, and `export` and
interpolation are unsupported.

```gitignore
/.env
```

A note with `header_via` and no `via` is header-only: no browser opens, and only `tester request` is
available. That request carries the same limits: same origin, no redirects, and no `Authorization`,
`Cookie`, `Proxy-Authorization` or `Host` header from the Tester; the note's own Header credential is
the only one it carries. When an API runs on a separate origin, name both origins in `targets`, keep
`execute_levels`, and bind `api` to the API Target in `level_targets` (see step 1). A token an API
makes you acquire (OAuth, refresh tokens, a login endpoint that mints one) stays outside this example.

Two other APIs work without a header-only note:

- An API that accepts the session the UI login produces on the same origin keeps a `via` note.
- An API that needs both that session and a header keeps a shared note with `via` and `header_via`.

The [support document](support.md#data-handling) covers both and the Credential variants
(`--auth absent|invalid|expired`).

## 6. Review the record before committing it

`/qa-execute` never stages or commits anything. `execute ingest` writes one Execution record at
`.qa/executions/<date>-<run-id>.md`, uncommitted: it holds the origin, Role names, `Expected`,
`Seen` and `Why` prose, evidence lines, the command trace, preconditions and action counts, so it
can quote application data. The record has one block per case and level, so the `ui` and `api`
results for a case sit side by side. Each Execution result is **Passed**, **Failed** or
**Blocked**. The **Case outcome** is that case's summary across levels: **Failed** if any level
failed, else **Blocked** if any was blocked, else **Passed**; **Incomplete** when a level the case
is bound to did not run. Temporary evidence pointers name files in the OS temp run directory and
are not durable attachments. Read and review the record, then commit it yourself if you want it in
history.

### After a failed first Execution

A red first run is not a dead end. Read the failing level's block in the Execution record: its
`Expected`, `Seen` and `Why` describe what went wrong on that layer. Review the record before you
commit it, whichever result you got.

- **Failed (a product failure):** the application did not behave as expected. `/qa-execute`'s
  follow-ups already draft the Bug from the case's failing levels, so read the draft in `.qa/bugs/`
  and review it there; one draft covers the case across its failing levels, and a second `/qa-bug`
  for that Run is refused `draft_exists_for_run`.
- **Blocked (an access or setup failure):** the test could not run. A case whose login access fails
  pauses once during execution so you can fix or skip that Access note; otherwise, fix the Access note
  or application setup, and re-run the same command.

Run `/qa-skills:qa-next` to inspect what remains to be done.

## 7. Clean up and recover

Everything a Tester creates in your application stays there, and nothing rolls back: clean up test
data the executions left behind. The record's `created` list, when there is one, names them; an
interrupted run can lose it.

If a Run is interrupted — the session dies, a Tester hangs, you stop it — recover like this:

1. Stop or drain the running Testers (let in-flight Executions finish, or stop them).
2. Run the ingest command the confirm printed, `execute ingest --dir <run-dir>`, once on the same
   run dir: an Execution that acted but wrote no valid report is recorded Blocked; Executions
   Blocked before dispatch are recorded with their reason; Executions that never ran are listed as
   not run and their previous result stays the latest. Kept login states are removed and recorded
   sessions are closed first.

The record is written once: a second ingest refuses with `record_exists` rather than rewriting it.
Nothing else is deleted by recovery; the browser a crash left open, you close by hand.

## Where you stand afterwards

Commit reviewed knowledge (`.qa/`), with login files ignored. From here:

- `/qa-skills:qa-next` shows what to do next without performing it.
- If you want test code next, `/qa-skills:qa-codegen` writes Automations in your test suite. It asks
  for Training first (`/qa-skills:qa-train codegen`), where proposals come from existing test code.
  Each of the 12 facets accepts an explicit negative or a default answer.
- `/qa-skills:qa-sync` reconciles code and tracker changes on a Card; if you already have
  existing tests, bind them to cases with `/qa-skills:qa-sync` instead of generating new ones.
- On an unsupported stack, knowledge, design and Tester Execution still work: see the
  [On any stack](support.md#on-any-stack) statement in the support document.
- `/qa-skills:qa-impact` takes a small change to a Feature end to end, handing a big one to
  `/qa-skills:qa-deep-dive`.
- `/qa-skills:qa-ask` answers Business questions from recorded Rules.

The [support document](https://github.com/Kinasr/qa-skills/blob/v0.14.1/docs/support.md) documents
the full data-handling statement, storage and lifecycle, and operational limits — including that
application-data confidentiality is not guaranteed and that non-production targets with test accounts
are the supported use.
