# First run

The full walk from a fresh install to a first Execution record, with the edge cases. The README's
quickstart is the short version of this walk. Set up first: Claude Code **2.1.308 or newer**,
**Node >= 22**, `playwright-cli` **0.1.22 or newer**, and a repository with at least one commit —
see the README's prerequisites and the
[support matrix](https://github.com/Kinasr/qa-skills/blob/v0.3.6/docs/support.md). All three
tracker paths below reach a first Execution; the examples use a synthetic library-loans application
at `https://staging.example.test` with a browser level named `ui`.

## 1. Set up the project

Run `/qa-skills:qa-init` in your repository and answer its questions. On its numbered Card you
accept, edit, or drop each item; nothing is written until you reply. Init writes `.qa/project.md`
only. The Card **proposes `targets` and `execute_levels`** too, from your repo's configuration or
your answer, so a freshly initialised project can execute:

- `targets`: a name → the exact `http` or `https` origin of your non-production application. The
  origin has no path, trailing slash, query, fragment or user information.
- `execute_levels`: a level → `browser` or `api`, where every key already exists in the Card's
  `stack.levels`. Unmapped levels are skipped.

When you accept them, init writes exactly these lines into the existing YAML frontmatter of
`.qa/project.md`:

```yaml
targets: {staging: "https://staging.example.test"}
execute_levels: {ui: browser}
```

`staging` is the target name you will pass as `target:staging`; the `ui` key is the level the Test
Cases take. With two levels (`stack: {…, levels: [ui, api]}`), the second map instead reads:

```yaml
execute_levels: {ui: browser, api: api}
```

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
  ([Trackers row](https://github.com/Kinasr/qa-skills/blob/v0.3.6/docs/support.md#trackers)).

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
- **Saved login:** `/qa-train access` prints the browser steps to run yourself — log in from a
  temporary directory outside the repository so `playwright-cli`'s snapshots and logs land there,
  save the state with `playwright-cli state-save`, and close the browser. The file, e.g.
  `.qa/.auth/staging.json`, holds session cookies; never paste passwords, tokens or login-state
  contents into chat or Training. An expired saved login is saved again the same way.

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

## 3. Settle one Feature

Use a committed file that describes the required behaviour, a tracked story, or the conversation:

```text
/qa-skills:qa-deep-dive first-feature file:docs/requirements.md
```

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

Agree the Test Scenario split and each scenario's wanted levels from `stack.levels`.
For this browser walk, agree `[ui]`; every generated case names `level: ui`. Delegates fill the scenario files. Read the generated Test Cases: at least one
needs a `**Steps.**` numbered list and a `**Expected result.**` paragraph, because a case missing
either is skipped at Execution, not executed. Empty scenario files cannot execute; follow any
reported re-run command if filling failed, and check each case's Roles have Access notes. Test code
for a case comes later, from `/qa-skills:qa-codegen`, once its stack is trained.

## 5. Make a first Execution

Review the setup and generated knowledge; commit what you want to keep. A fresh repository must
have a commit before this step (`Execution needs a resolving HEAD`); uncommitted case edits still
execute, as edited.

```text
/qa-skills:qa-execute first-feature target:staging
```

It refuses anything not ready before it plans: no targets or no execution levels (`no_targets`,
`no_execute_levels`), no commit, and a scope token that names no live Key; raw URLs are not
targets. Then it prints the selection: origin, each case's Role → Access note mapping, the Run
directory, and the ingest command for when the Run is over. Confirm to begin; no login or browser
opens before you confirm, and the skill is interactive only: never run `/qa-execute` unattended.
Before it schedules anything, the Run
also verifies your Claude Code host against the
[supported floor](https://github.com/Kinasr/qa-skills/blob/v0.3.6/docs/support.md#claude-code); a
refusal names the support-matrix row and the version found, and makes no login or browser call.
Cases are then executed by background Testers inside the Run's guard, which allows the calls
through the CLI's `tester` wrapper only. A case
whose login access fails pauses once so you can fix or skip that note.

## 6. Review the record before committing it

`/qa-execute` never stages or commits anything. `execute ingest` writes one Execution record at
`.qa/executions/<date>-<run-id>.md`, uncommitted: it holds the origin, Role names, `Expected`,
`Seen` and `Why` prose, evidence lines, the command trace, preconditions and action counts, so it
can quote application data. Results are **Passed**, **Failed** or **Blocked**. Temporary evidence
pointers name files in the OS temp run directory and are not durable attachments. Read and review
the record, then commit it yourself if you want it in history.

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

Commit reviewed knowledge (`.qa/`), with login files ignored. From here: `/qa-skills:qa-next` shows
what to do next without performing it; `/qa-skills:qa-impact` takes a small change to a Feature end to end, handing a big one to `/qa-skills:qa-deep-dive`; `/qa-sync`
reconciles code and tracker changes on a Card; `/qa-ask` answers Business questions. The
[support document](https://github.com/Kinasr/qa-skills/blob/v0.3.6/docs/support.md) documents the
full data-handling statement, storage and lifecycle, and operational limits — including that
application-data confidentiality is not guaranteed and that non-production targets with test
accounts are the supported use.
