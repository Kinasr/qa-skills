# Changelog

## Unreleased

## [0.14.1] - 2026-11-16

### Changed

- Links to the support, first-run and CLI documents point at the `v0.14.1` tag.
- The support document records a guard-denial re-check on 0.14.1, which passed after the Tester guard changed, in the terminal CLI on Claude Code 2.1.308 and in the desktop app on its bundled 2.1.325.
- The support document records the 0.14.0 live evidence on macOS. Host-version detection, guard denial, hook blocking on crash and on timeout, `agentId` binding, browser-artifact placement and an end-to-end Run all passed in the terminal CLI on Claude Code 2.1.308 and in the desktop app on its bundled 2.1.325.

### Fixed

- `/qa-execute` no longer misses a short-lived confirmation message, such as a toast, by chance. When an Expected result names one, the Tester attaches `--expect='<text>'` to the action that raises it and the wrapper waits up to 5 seconds for the text, at no extra action. A message that never appears fails the case instead of blocking it.

## [0.14.0] - 2026-11-16

### Added

- On Windows, verify ACL privacy before writing credentials, login state, browser profiles, or HTML snapshots by inspecting `whoami /user` SIDs and UTF-16LE SDDL from `icacls /save` without modifying ACLs, refusing shared `TEMP` or unreadable ACLs (`acl_not_private`, `acl_unreadable`) with remediation commands, and writing secret files exclusively (`wx`) and renaming into place (`secret_target_unwritable` on `EPERM`/`EACCES`) while keeping POSIX `0o600`/`0o700` and `O_NOFOLLOW` unchanged.

### Changed

- Ship `.gitattributes` (`* text=auto eol=lf`, and `*.cmd`/`*.bat` as `eol=crlf`) so checkouts on Windows preserve LF line endings without changing any tracked file.
- The support matrix gives WSL2 its own row and states each ladder: what moves WSL2 and native Windows from Expected to work to Supported, and that each moves on its own PASS rows. Both rows stay Unsupported until those rows are recorded.
- A recorded live-evidence row now counts only for the OS its `OS` cell names — `macOS`, `Linux`, `WSL2` or `Windows` — so a PASS on one OS never satisfies another OS's claim. A condition key may name the one OS it applies to; the Windows-only refusal of a secret-bearing directory under a shared `TEMP`, with the `icacls` fix named, is required of the Windows claim and never of macOS, Linux or WSL2.

### Fixed

- On Windows, the Playwright runner starts the project's local `@playwright/test` through Node for its version probe, its test listing and the run itself, so neither `npx.cmd` nor `cmd.exe` is involved. A configured `test_runner.launcher` ending in `.exe` (or naming a Node script) still runs, while one that is a `.cmd`/`.bat` batch file is refused, naming `test_runner.launcher`, as that Automation's runner error; a project without `@playwright/test` installed reports it instead of a missing report. Nothing changes on macOS or Linux.
- On Windows, the Gradle and Maven runners execute `gradlew.bat` and `mvnw.cmd` through `cmd.exe` with every token checked against an allow-list and quoted (doubling trailing backslashes before closing quotes), refusing metacharacters with the offending character and `project.md` key or Automation selector while leaving macOS and Linux unchanged.
- On Windows, Gradle and Maven default to the project's `.bat`/`.cmd` wrapper, map configured `./gradlew`/`./mvnw` paths to their `.bat`/`.cmd` siblings, and resolve bare `gradle`/`mvn` commands through `PATH` and `PATHEXT` (attributing configured launcher failures to `test_runner.launcher` and omitting attribution for defaults).
- On Windows, host admission spawns `.exe` `CLAUDE_CODE_EXECPATH` binaries directly, runs `.js`/`.cjs`/`.mjs` hosts through Node (`process.execPath`), accepts `\r\n` `--version` output, and keeps other extensions (including `.cmd`) unverified, so an old npm host is refused for its version instead of being offered an Unguarded Run while POSIX behavior stays unchanged.
- On Windows, `playwright-cli` and `gh`/`glab` resolution walks `PATH` and `PATHEXT` in JavaScript without invoking `cmd.exe`, running `.exe` binaries directly and confined `@playwright/cli` npm shims through `process.execPath` while leaving POSIX behavior unchanged.
- Refused Windows wrappers and broken or unconfined `@playwright/cli` shims surface as distinct refusals across `/qa-init`, `/qa-execute`, the Tester runner, and UI scout login instead of collapsing into missing or unreachable.
- The PR flow honours `core.autocrlf` and `.gitattributes` clean/smudge filters when committing and restoring regular files while keeping snapshots, symlinks, raw snapshot restores and the preparation journal raw, so commits hold the same blobs `git add` produces, restores leave `git status` clean and resume compares raw bytes to raw bytes.
- Under `core.filemode=false`, the PR flow takes regular-file modes from the git index (`100644` for untracked files or replaced symlinks) and skips `chmod` during tree restores.
- Line endings alone never change what a checkout sees: a Scenario's digest and the Card seals of `/qa-sync`, `/qa-publish` and `/qa-init` fold CRLF before hashing, as the pin, Coverage and agreement digests already did, so no Test Scenario is flagged stale and no Card is refused as changed on a CRLF checkout. A `.qa` file that already held CRLF on macOS or Linux now takes the digest of its LF copy, so its Scenarios may be flagged as changed once.

## [0.13.6] - 2026-11-15

### Fixed

- `codegen done` refuses an Expected sentence none of whose mapped lines belongs to an assertion statement, as the stack adapter recognises one (a continuation line of a multi-line `expect(…)` or `assertEquals(…)` counts), with the new code `expects_no_assertion`. Nothing is recorded, so the item stays `in_progress` and `done` can be retried with a corrected mapping. Before, a mapping one line off an assertion was accepted and could not be corrected afterwards.

## [0.13.5] - 2026-11-15

### Changed

- Every `scan.mjs` action that reads `--stdin` also takes `--input <path>`, which reads the same bytes from a file. Passing both is a usage error. The skills, the shared commit reference and the briefs the CLI writes now have the agent write its input to a file and run one plain `node .../scan.mjs ... --input <file>` line, so the one allow rule `Bash(node:*)` covers them. Nothing tells the agent to use a heredoc, a pipe, a `&&` or `;` chain or a variable prefix, and `npm run lint:skills` fails a skill that shows one of those forms, or `--stdin`.
- No delegate is told to `cd`. The `/qa-deep-dive` UI scout opens its browser with `playwright-cli open --config <run dir>/playwright-cli.json`, which sends its snapshot files into the run dir, so `observe` no longer gives the scout a working directory. The tracker scout runs its one command as a plain line with absolute paths.

### Fixed

- The `/qa-deep-dive` UI scout replies `FAILED` for a tool problem only once a `playwright-cli` command it needs has failed or been denied. A denied command of another kind is run again in a plainer form or worked around.
- `/qa-train access` has the CLI append an agreed ignore line to `.gitignore` with the new `train auth-ignore <line>`, which keeps every other line and writes nothing when the line is already there, so the agent never edits `.gitignore` itself. Its commit covers `.gitignore` and follows the Commit mode.
- The `/qa-init` maintenance Card asks for `level_targets` whenever a first-run Card would: on a project with several targets and execution levels and no map, the item marks `needs` and is answered, its Suggested pairing adopted, or dropped. Left alone, the Reply is refused. Before, an ambiguous pairing showed the field only as unset.
- With a schema migration pending, `/qa-next`'s Start here is the migration: it names each pending command in order (for example `scan.mjs migrate-keys`) and says to run it on the default branch. The other steps stay listed. `/qa-init` maintenance offers to run the migration first and runs it only on the engineer's yes.
- A `module_paths` entry that does not exist yet is a `module_path_absent` warning, no longer an Integrity error, so `/qa-next` no longer lists it as Blocking on a project with no tests yet. A path that exists but is not a directory is still an Integrity error.
- The Agent pointer `/qa-init` gives you to paste still tells an agent doing other work to recommend a qa-skills command rather than start one, and now says running one is fine when you ask for it or a running `/qa-*` command names it next. A project that already pasted the pointer keeps the old text, since `/qa-init` reports it as present: ask `/qa-init` for the current template and paste it over the old one.
- When `codegen plan` skips cases as `unreviewed`, it names `/qa-design <feature> --review` once per Feature: as the refusal's `next` when every case is skipped, and in the confirm otherwise.
- `codegen`'s additive check protects only each pre-existing test's own text, from its first line to the line closing its body, so a test appended after the last test inside a `describe` is no longer refused `not_additive`. An edit inside an existing test's body, or a deleted token outside any test, is still refused.
- `codegen plan` under `level:<x>` skips a Layer-free case whose choice names another level, listing it under `skipped` as `other-level`, where it used to refuse the whole plan `invalid_choice`. A case with no choice is still refused. `/qa-codegen` reuses its proposed choices for each per-target command a `spanning_targets` refusal names, and passes the engineer's scope as given, since only the engineer's own case Keys exempt a case from `unreviewed`.
- `codefix verify` runs an item's first verify with no edit of its own once an earlier item's fix is done, so an Automation that fix already repaired can pass, and `codefix done` closes it with the outcome `fixed-by <item>`. The follow-up report lists it with the fixed items, naming that item, instead of under the failed ones with a next step. A repeated verify on an unchanged tree is still refused.
- `design keep` prints a `commit` covering the Feature it wrote and the Run's changeset, and `/qa-design` makes it as the Commit mode says, so a kept Proposed Rule is no longer left uncommitted. The Run records which report item each kept statement came from, so a re-run `design report` shows a reworded keep as `kept: true`.
- The `/qa-execute` Tester brief names, on each Role's Sessions line, the user name to `fill` when its Access note has `identifiers.user` and a password source, and tells the Tester to report Blocked rather than guess one when the note names none.
- `execute ingest` records a Tester that was dispatched and returned without a report or any guarded call as Blocked `step` with `reached: 0`, its Why saying the guard hook may have failed, instead of leaving the case out as not run.
- A Tester interpretation placed `after step N` (a decision made once a step had finished) is kept in the Execution record; the brief lists it beside `setup`, `step N` and `expected`, and any other placement is still dropped and counted.
- `train check access` warns about a missing Auth key first used by `header_via` or `expired_via` with a `scout header-steps` hint, as `/qa-train access` does, rather than `scout password-steps`.
- The trust-core placement grader fails a run only on new paths a browser could have written (under a Run dir or the project, or a temp/home path named like a browser or playwright directory), and lists other processes' temp and home writes as ignored.

## [0.13.4] - 2026-11-14

### Changed

- `docs/support.md` moves the Claude Code row to Supported on macOS: the terminal CLI on Claude Code 2.1.308 and the desktop app on its bundled 2.1.321. It cites the recorded live entries: host detection, guard denial, hook blocking, `agentId` binding and a macOS end-to-end Run on qa-skills 0.13.1, and browser-artifact placement (and desktop binding) on 0.13.2, with Header credentials on 0.13.2 and mocking on 0.13.3. When two entries for one item share a Date, the later qa-skills revision now decides, and a `FAIL` wins only when both match. Linux end-to-end, the install and update paths, the `SECURITY.md` route and the desktop Delegate-isolation cell on 2.1.308 stay Pending. The README's requirement line says the same.
- `docs/support.md` adds a Mocking row and records its live entries on qa-skills 0.13.3, terminal CLI, Claude Code 2.1.308, macOS, against the Toolshop fallback. A guarded Execution mocked the API origin's cart endpoint with a server error, the UI showed its error message, and the Execution record listed the route under `routes`. A route with `--header` was refused, and no route was left once the session closed. Both rows passed.

## [0.13.3] - 2026-11-14

### Changed

- A Tester `route` in `/qa-execute` can now mock an endpoint on another target the project configures, named by full URL, so a UI whose API runs on its own origin can have that API answer with a server error. `execute plan` freezes the other targets' origins into the Run, and the Tester brief names them. A route that could match a sign-in URL the Access notes name on that origin (`login_url`, or the new optional `identifiers.sign_in_urls`) is refused, on the Run's own origin as well, and every route on an origin with no known sign-in URL is refused until Training names one. The Role's Access note `match` applies only on the Run's own target origin. A bare path still resolves onto the target origin, and `goto` and `tester request` still stay on it.
- `docs/support.md` adds a Header credentials row and records its live entries on qa-skills 0.13.2, terminal CLI, Claude Code 2.1.308, macOS. Against a local fixture app, a header-only note and a shared note each ran one guarded Execution, with the secret in the git-ignored Auth file. An echoed key came back `<credential>`, a default call's 401 carried `auth_rejected`, and the shared call kept the secret out of every `playwright-cli` argv. A literal-secret scan of each Run dir, Execution record and Tester report found nothing. Both shapes passed. The Header credential paragraph now names the `auth:KEY` source beside `env:NAME`.
- `docs/support.md` records the 0.13.2 live-evidence reruns on macOS. Browser-artifact placement passes on the terminal CLI (Claude Code 2.1.308) and in the desktop app (bundled Claude Code 2.1.321), now that Chromium's profile stays under the Execution. `agentId` binding passes in the desktop app. The Claude Code row stays Expected to work while the Linux end-to-end Run is Pending.

### Fixed

- The trust-core placement grader counts files the idle sibling Execution's browser writes under that sibling's own Execution as placed, not as files outside the own Execution. The binding grader matches the intruder's launch prompt to its saved brief while ignoring trailing whitespace, which the desktop app's parent drops.

## [0.13.2] - 2026-11-14

### Changed

- `docs/support.md` records the desktop app live-evidence entries on qa-skills 0.13.1, in the Claude desktop app with its bundled Claude Code 2.1.321, on macOS. A desktop entry on the app's bundled build counts as on the floor when that build is at or above it, since the app cannot be pinned. Host detection, guard denial, hook blocking on crash and on timeout, and a macOS end-to-end Run passed. Browser-artifact placement failed, because Chromium keeps its profile in the OS temp directory, and it is recorded as a FAIL. `agentId` binding was inconclusive twice and stays Pending on the desktop app. The Claude Code row stays Expected to work.
- `docs/support.md` records the formal terminal CLI reruns on qa-skills 0.13.1 and Claude Code 2.1.308. Guard denial passes and is recorded. Browser-artifact placement fails, because Chromium keeps its profile in the OS temp directory outside the Execution, and it is recorded as a FAIL.
- `docs/support.md` records the first terminal CLI live-evidence entries, taken on qa-skills 0.13.1 and Claude Code 2.1.308 (the floor), macOS, with the plugin installed from a `qa-skills-local` marketplace. Host detection, `agentId` binding, hook blocking on crash and on timeout, and a macOS end-to-end Run passed. Guard denial and browser-artifact placement were inconclusive, are named as reruns, and stay Pending. The Claude Code row stays Expected to work until the desktop app is recorded.

### Fixed

- `/qa-execute` keeps each browser session's Chromium profile under its Execution directory, at `executions/<id>/profiles/<session>/`, instead of a `playwright_chromiumdev_profile-*` directory in the OS temp directory. The temp profile held cookies and Local Storage and could outlive the Run. `execute close`, and a failed `execute open`, remove a session's profile once the session is closed, and the CLI login removes its own as soon as it has saved the state. The Tester's Read allow-list doesn't reach the profile. `/qa-scout`'s CLI login keeps its profile under the scout's run dir the same way.
- The trust-core probe's `agentId` binding mode no longer injects a sibling call into the own Tester's brief, which the desktop app's Tester declined. An intruder Tester is now launched with a brief that probe code builds: the own Execution's binding line, then the sibling's CLI-built brief, unchanged. It is bound to the own Execution, so its ordinary first command, on the sibling, is refused. The own Tester is then launched with its brief unchanged, rebinding the own Execution, and its ordinary commands are admitted.
- The trust-core probe grades desktop app transcripts. The desktop host records an `Agent` call's `run_in_background` as the string `"true"`, which the grader did not take for a background launch. It also refuses a Write over an existing file the Tester has not read before any `PreToolUse` hook runs, so the guard-denial probe's report link now points at a missing file and the Write reaches the guard. The placement prompt tells the parent to run each inventory as its own standalone call, which the grader requires. The desktop fault-mode steps disable the `qa-skills@qa-skills-local` release install too. The probe's comment now says that a directory marketplace's guard runs from the marketplace's own plugin directory, not the cache path `claude plugin list` reports.
- The trust-core probe's guard-denial mode no longer injects calls into a Tester's brief, which the Tester declined, so nothing reached the guard. It now plants state that turns ordinary calls into refusable ones. The own Execution's `.playwright-cli/` and report path become links outside it, so its artifact Read and report Write are refused. The sibling's brief is built by the CLI through a linked plugin root, so its commands name an off-allow-list `scan.mjs`. Both probe Executions end without a report; only the captured denials are graded.
- The trust-core probe's artifact-placement inventory call saves its listing itself and prints only a path count and SHA-256, which the grader recomputes from the saved file. A real machine's multi-megabyte listing was saved to a file by the host instead of returned, so it never matched. The inventory also leaves out macOS daemons' `com.apple.*` directories in the OS temp directory, whose churn read as files the browser wrote, and the grader's shell-word matching no longer hangs on a long parent command.
- The trust-core probe takes `--installed` for the terminal CLI: it launches without `--plugin-dir` against the project's `qa-skills@qa-skills-local` install, after `claude plugin list --json` shows it as the only enabled qa-skills registration at the probed root and version, and its rows name `terminal CLI (local marketplace, distinct name)`. The fault modes refuse it. Grading also writes `capture-public.json`, the capture's tool calls and results with e-mail addresses redacted and placement's listings reduced to digests and new paths, for committing as evidence instead of `capture.json`.

## [0.13.1] - 2026-11-13

### Fixed

- A committed Bug draft no longer reads as deleted knowledge in the `--persist` dirty check, so `design checkpoint` passes on a clean tree and the Watermark advances. Both sides of the check leave out Bugs, as they already did Executions, and the `persist_refused` line names only the reason it gave: the changed files, no commits, or `.qa/` outside git.
- `docs/support.md` and the release runbook warn that a checkout's marketplace carries the public `qa-skills` name, so adding it repoints a user-level `qa-skills` marketplace and `plugin update` can silently downgrade. They give the safe routes in order (`--plugin-dir`, a copy renamed `qa-skills-local`, or removing the user-level marketplace first) and say to confirm the installed version after any update. A live-evidence row can record `local marketplace, distinct name`, which the desktop probe now proposes.
- `design report` no longer crashes when an agreement leaves a scenario out: it lists that scenario as kept, since the agreement didn't name it, and prints the coverage summary. The skip-reason table is typed by the plan's reasons, so a reason without a line fails the type check.
- `/qa-execute`'s multi-Run reference starts after the engineer's yes and no longer runs its own `execute confirm`. §3 owns the one confirm, with one `--dir` per Run.
- On a project with Level targets, `/qa-init` proposes in `test_runner.target_env` only the variables for the origin a Run reaches, names the ones it leaves out (they keep the test configuration's default), and asks when the evidence doesn't show which variable serves which origin. A Card on such a project notes a `target_env` that lists more than one variable, and the maintenance Card proposes the narrowed list (ADR-0068).
- `/qa-train access` asks for a new Role of its own for a visitor who never signs in (such as `Visitor`), never one that already signs in, and names the `/qa-init --add-role <Name>` step when it isn't declared. `train check` refuses a `via: none` note that reuses a signing-in Role's prefix with that reason, and `/qa-design`'s role review flags a role-less case that needs a signed-out session and proposes the Signed-out Role, or creating one (ADR-0063).

## [0.13.0] - 2026-11-12

### Added

- `/qa-design` asks which Proposed Rules from its report to keep, letting you reword them, and `design keep` writes them to a new `## Proposed Rules` section of the Feature. `/qa-next` lists each one as missing knowledge for `/qa-deep-dive`, the Knowledge page shows them, and a full deep dive settles each. A kept item moves no pin, doesn't make Coverage due, and goes into no Delegate or judge brief.
- `.qa/project.md` takes a `commit_mode` of `print`, `ask` or `auto`, and `/qa-deep-dive`, `/qa-design`, `/qa-impact`, `/qa-sync`, `/qa-train` and `/qa-init` commit the files they wrote through `scan.mjs commit` as it says. A project without the field keeps printing the commit, as before; `/qa-init` offers `ask` as the suggested answer (ADR-0062).
- `.qa/project.md` takes an optional `level_targets` map from a Test level to the target that serves it, such as `{api: local-api, ui: local-ui}`, and `/qa-execute` runs each level's cases against its Level target. On a project with several targets, a mixed selection that splits across targets with a level left unmapped, or that maps none of its levels, is refused with `unmapped_levels`, naming the `level_targets` line to add, before any session opens. A project without the key plans as before (ADR-0068).
- A `/qa-execute` whose selection spans targets through `level_targets` plans one Run per target, each with its own run directory and record, and one yes (and one Unguarded acknowledgement) confirms them all. The Runs execute one after another in `targets` order; a login refusal on any target refuses the whole plan. `execute confirm` takes `--dir` once per Run.
- `/qa-codegen` and a standalone `/qa-codefix` baseline prove tests against the Level target of their tests' level. A selection that spans targets is refused with one command per target, and `/qa-codefix --run` keeps its Run's target.
- `/qa-init` asks for `level_targets` when a project has more than one target and more than one executable level, suggesting a pairing only when the slugs make it plain (such as `api` with `local-api`), and a maintenance Card can add, change or drop it. `docs/first-run.md` shows a split UI and API origin.

## [0.12.0] - 2026-11-12

### Changed

- Rules and Boundaries are numbered list items under `## Rules` and `## Boundaries`, not `###` headings. New projects start at schema 6. Plain `migrate-keys` at schema 5 rewrites an existing Feature word for word, recomputes `coverage_digest`, and re-pins fresh Watermarks, Reviews and Dismissals across the one-time digest change; at schema 6 `check` reports a remaining heading and names `migrate-keys`.

## [0.11.0] - 2026-11-12

### Added

- `/qa-train access` keeps every test-account password and token in one git-ignored Auth file, `.qa/auth`, named in notes as `auth:KEY`. Each worktree finds it, key by key, in its own `.qa/auth` and then the main checkout's. The CLI writes a committed template, `.qa/auth.example`, that lists every key you need.
- A saved login state missing in a worktree is read from the main checkout, and `scout login-steps` in a worktree saves it there.
- Generated tests get `auth:` Header credentials in their environment when the CLI runs them, unless the environment already sets that name.

### Changed

- `/qa-train access` proposes `auth:` for new secrets and no longer proposes a password file per note. Existing `file:` and `env:` notes keep working, and it offers to convert them.

## [0.10.1] - 2026-11-11

### Changed

- No change to the skills. The release checks now verify that every version field and the top changelog entry name the same version.

## [0.10.0] - 2026-11-11

### Added

- `tester do … fill-password <ref>` types a Role's password into a password field of the target without the Tester seeing it. It is refused off the target origin, on a non-password element, and for a Role whose Access note has no password source. The exact value is redacted from all wrapper output, records and `.playwright-cli/` snapshots (ADR-0066).
- A Tester may sign a Role out in setup, and the sign-in page that follows is no longer Blocked `no-access`.
- The pre-run Card warns, per Role, when its Access note has no password source.

## [0.9.0] - 2026-11-10

### Added

- An Access note may log in as nobody: `via: none` with a Role. A case carrying that Role opens signed out, its sign-in page is expected, and `/qa-design` gives signed-out cases that Role (ADR-0063).
- `observe:signed-out <url> "<request>"` takes an Observation with no login; the Observation records `signed_out: true` (ADR-0065).
- A Test Case may say `manual: false` when no Tester can perform it. `/qa-execute` runs its Automations, starts no Tester, and skips it with a reason; `design report` lists such cases.
- `execute record --reason-file <path>` carries the Tester's reply into a record with no report.
- An Execution record names the selected cases that never started in `not_run`.
- `execute plan` names Layer-free cases narrowed to their Automation's level and the levels left out.
- `design report` lists `check_gaps` (what checking a case needs from the test environment, handed to `/qa-train design`) and Permissions warnings for the cases it wrote.

### Changed

- Every Execution on a CLI-login note logs in fresh, so an earlier case's sign-out never leaves a later one a dead login (ADR-0064 supersedes ADR-0036).
- The Tester's report is now `tester.report.md`, a name Claude Code lets a subagent write.
- `/qa-init`: taking an item accepts its suggested answer; a picked Tier is a settled line; Roles need `role_meaning`; `target_env` is asked in terms of the Application target; only Key carriers the stack writes are accepted; Execution levels are worded by mode.
- `/qa-codegen` checks a test against the Conventions before verify, and asks for assertions that fail when a sentence or precondition is false.
- `/qa-deep-dive` compares each clause of a Coverage category before a pair is covered; `deep-dive check` refuses an `n/a` that names a live Rule.
- `train check` warns on a Convention prohibition with no anti-example wherever it appears.

### Fixed

- A malformed `interpretations` line no longer costs the Execution its result; a report with an `unmet` precondition settles Blocked `precondition`.
- Run paths no longer reach record text, and an over-long `Why` is cut at a word boundary.
- A Bug draft carries the record's Element evidence.
- The Playwright runner selects and matches tests relative to Playwright's own root, so a subfolder `testDir` works.
- `no_code_adapter` names the real reason when an adapter could not load, including a `typescript` with no compiler API.

## [0.8.4] - 2026-11-06

### Changed

- Tests now pin that a session's Header credential (real and expired, with or without its scheme) stays `<credential>` even under a `redaction_exempt` key, in `tester request` bodies (parsed or cut, inline and saved), error lines, the guard log and `tester do` page text and Evidence.

## [0.8.3] - 2026-11-06

### Changed

- `redaction_exempt` now also applies to `tester do` page text (Result, Page, Snapshot and console output, including form controls' accessible names) and to non-JSON `tester request` bodies. A label may match a declared name after leading count words such as `Total` or `number of` (`Total sessions: 3` survives with `sessions` declared); any other leading word, including state words such as `Current` or `Active`, keeps the value redacted, so `access token` still goes. Token formats, URL queries, `{name, value}` entries, headers and playwright error text are unchanged.

## [0.8.2] - 2026-11-06

### Added

- `train/execute.md` may declare `redaction_exempt: [sessions, sessionCount]`: those exact JSON body keys (case-insensitive) keep their leaf values in `tester request` responses, parsed or cut. Only names whose credential words are `session(s)`, `cookie(s)` or `token(s)` are accepted; objects and arrays are still redacted whole, strings still pass the token and page-text scrubs, and headers and `{name, value}` entries are unchanged. `execute open` pins the list from the Run's root (ADR-0059).

## [0.8.1] - 2026-11-06

### Fixed

- A boolean or null under a credential-named key is no longer redacted: `{"session": true, "token": null}`, `"remember_token": null` and `session=true` keep their values in `tester request` bodies (parsed or cut) and in page text. A quoted `"true"` still goes, as does a whole credential-named object.

## [0.8.0] - 2026-11-06

### Added

- `/qa-deep-dive` reads an OpenAPI 3.0 or 3.1 contract (YAML or JSON) through a new disclosed reference: every operation and webhook is accounted for, `--focus` defers the rest by `METHOD /path`, `$ref` and composition are followed for walked Functionalities only, and each leaf constraint is proposed as a Draft Rule citing `<reference uri>, <METHOD /path → JSON pointer>`. Swagger 2.0 is answered with "convert to OpenAPI 3".
- A Rule may name a button, selector, HTTP method, endpoint, status, header or payload field when the engineer confirms it is about that UI detail or the API contract itself (amended ADR-0056). The walk's bulk table accepts a Reference place as evidence.
- The investigation channels gain a Contract row ("what the contract says, not what is required").

### Changed

- The first-run guide and README quickstart walk one UI+API first run on one origin (`level:ui level:api`, Layer-free cases), with an API-only variant using a header-only Access note, the `tester request` limits, a saved-login/SSO note, guided entry and `--focus`, and what to do after a failed first Execution. A doc test checks the guide's blocks and commands against the CLI.
## [0.7.0] - 2026-11-06

### Added

- `/qa-execute` can mock a server, network or data-return condition that a case's precondition or step, or `train/execute.md`, states: the Tester's new `tester do … route '<pattern>' [--status=…] [--body='…'] [--content-type=…]` and `unroute ['<pattern>']`. Patterns stay on the target origin and inside the Role's `match`; the login URL, header flags (`--header`, `--remove-header`) and bodies over 64 KB are refused; every call counts toward the action cap.
- The Execution record shows a mocked run as `routes` (`"<pattern> → <status>"`, `"unroute …"`); bodies are kept only as byte counts. `/qa-codegen` evidence, Bug drafts and follow-ups carry the routes.
- `execute ingest`'s summary lists the created entities left in the app per case and Role (capped, with the `qa-<run-id>` tag note), and warns with a count and the case Keys when Executions acted without a valid report. Its JSON gains `unreported_acted`.
## [0.6.1] - 2026-11-06

### Added

- `docs/support.md` states the recorded live-entry format (revision, Claude Code version, surface, OS, condition, PASS or FAIL, date, evidence link). Only a recorded entry moves a support status, and the Claude Code row cannot say Supported until every trust-core item and host detection has a PASS on both the terminal CLI and the desktop app.
- An opt-in live probe, `scripts/probe-trust-core.mjs` (`QA_LIVE_PROBE=1`, never in CI), drives a real Run (host detection stops at `execute plan`) and grades guard denial, `agentId` binding, hook crash and timeout, browser-artifact placement and host detection, printing rows in that format. A dirty plugin tree refuses unless `QA_LIVE_PROBE_ALLOW_DIRTY=1`, which marks the revision `-dirty`; such a row is never a recorded entry.

## [0.6.0] - 2026-11-05

### Added

- An Access note can name a Header credential (`identifiers.header`, an optional `scheme`, `header_via: env:NAME`). The CLI adds it to `tester request` calls; the Tester cannot supply that header itself. Literal values become `<credential>` in wrapper output, saved responses, guard logs, and ingested reports and records; raw `playwright-cli` artifacts and screenshots are outside this promise.
- A note with only a Header credential opens a header-only session: no browser and no landing check. The CLI sends the requests itself, so API-only Executions run in parallel cheaply.
- A note with both a UI login and a Header credential logs in as before and sends the header through the browser, via a private code file that keeps the secret out of the process list.
- `tester request --auth absent|invalid|expired` sends a negative-auth call without the session's cookies; `expired_via: env:NAME` supplies a real expired token. The record's trace shows the variant, and `auth_rejected` flags a 401 on a call that carried the real credential.
- `env:NAME` passwords and Header credentials also resolve from the repo root's `.env`, which must be git-ignored and untracked; an environment variable wins.
- `execute ingest` masks the credential values the Run actually used in `report.md` and the Execution record, even if the key was rotated mid-Run.
- `/qa-train access` proposes a Header credential, with setup steps from the new `scout header-steps`.
- The `/qa-codegen` brief lists the header name, scheme and variable name per Role and target, so generated API tests authenticate the same way.

## [0.5.1] - 2026-11-05

### Fixed

- Maven runs now include the `test` phase; a default `mvn` launcher previously exited with no goal.
- A Kotlin/JUnit test in a nested class is selected as `Outer$Inner` and its report is found under both Gradle and Maven, instead of ending Blocked `runner-error`.
- A Surefire `@BeforeAll` failure reads as a failed Automation, not Blocked `no-result`.
- Every Gradle invocation passes `--rerun`, so a build-cache hit can no longer pass off a cached report as a fresh run (needs Gradle 7.6+).

## [0.5.0] - 2026-11-05

### Added

- Layer-free Test Cases (schema 5): a case may carry no Test level, one, or a list. `migrate-keys` advances to schema 5 without rewriting a case or re-pinning a Review; older installs refuse a schema-5 project.
- `/qa-design` writes cases from the actor's side and Layer-free by default, binds a case only for a layout, payload contract or denial (with a reason kept in the Run), and lists bindings in its report; `design unbind` removes a binding before the case is kept.
- `/qa-design` writes atomic and interaction or journey cases, and hands an outcome that combined Rules leave unclear to `/qa-deep-dive` as an Open question; `design resume` offers the held case once the Rule lands.
- `/qa-execute` runs a Layer-free case at the default level (the browser-mode level, or a `train/execute.md` Practice's level), a bound case once per level, and reports a Case outcome across levels: Failed, then Blocked, then Incomplete, then Passed. A Layer-free case with Automations at one executable level runs them there.
- `level:<name>` runs Layer-free cases at that level, narrows multi-level cases and lists excluded cases; the plan and record show bound, selected and omitted levels.
- `train/codegen.md` declares the stack's approaches (`api`, `mocked-ui`, `full-ui`) and their paths; an Automation's level follows from its path, and a multi-level case stays an Automation gap until each supported level has one.
- `/qa-codegen` automates a Layer-free case at the lowest pyramid layer that observes its outcomes.
- `scan` warns when a case covering a Permissions Rule is bound to only some executable levels.

### Changed

- `/qa-publish` writes no level for a Layer-free case and a list as multiple values where the tracker supports it; tracker intake no longer requires a level and offers a tracker level for confirmation.
- `/qa-show` filters by level membership and labels Layer-free cases.
- `/qa-train design` refuses entries about layers or execution speed and names `/qa-train execute` or `/qa-train codegen`.
- `/qa-next` shows Incomplete Case outcomes.

## [0.4.5] - 2026-11-05

### Changed

- `/qa-execute` on a Claude Code host whose version metadata cannot be verified (a missing or relative `CLAUDE_CODE_EXECPATH`, a failing or timed-out version command, an unrecognised format, a malformed or disagreeing `AI_AGENT`) now offers the acknowledged Unguarded Run instead of refusing. A host below the supported floor is still refused, with an upgrade message.
- An `AI_AGENT` of `claude-code_*` also identifies a Claude Code host.
- The `host_unverified` refusal and the pre-run Card name the failed check and the `AI_AGENT` value seen, and link the support document at the running plugin's version.

## [0.4.4] - 2026-11-05

### Fixed

- `tester request` no longer leaks values nested under a credential-named key (or a credential cookie's `value`) when a JSON response is cut at the return limit. The cut body is redacted the same way as a whole one.

## [0.4.3] - 2026-11-05

### Changed

- A first `/qa-init` now ends by naming one next step: `/qa-train access` when the target's login has no Access note, otherwise the concrete `/qa-deep-dive` to run. On a fresh setup, `/qa-train access` ends by naming that deep-dive.
- `/qa-codegen` offers Training only after its plan passes, so a stack it cannot generate for is refused before any Training is asked for.
- `docs/support.md` and the README now say what works on any test stack, and give today's route for an unsupported stack.

## [0.4.2] - 2026-11-04

### Fixed

- `/qa-design` now gives each scenario's writer the agreement the engineer confirmed: its assigned Rules, the allocation map, the constraining Rules and the remarks. A remark never overrides a Rule, a Convention or an Invariant.

## [0.4.1] - 2026-11-04

### Fixed

- `/qa-execute` offers an Unguarded Run only on a host that is not Claude Code. A Claude Code host below the supported version, or one whose version check fails or disagrees, is refused as before.

## [0.4.0] - 2026-11-04

### Added

- `/qa-execute` on a host that cannot run the Tester guard refuses by default and runs as an Unguarded Run only after you explicitly acknowledge it on the pre-run Card; every step and the end-of-Run summary say so.

### Changed

- `/qa-codegen` checks for a trained stack in its skill instructions instead of a CLI refusal, and offers `/qa-train codegen --stack` as before.
- `codegen pr-prepare` no longer refuses before `codegen regress`; the skill still runs regress first.

## [0.3.7] - 2026-11-02

### Changed

- The README's support line no longer names a version.

## [0.3.6] - 2026-11-02

### Changed

- Links to the support, first-run and CLI documents point at the `v0.3.6` tag.

## [0.3.5] - 2026-11-02

### Fixed

- `/qa-design` writes a case that repeats a stored one only on the engineer's stated reason
  (`design override`). A design Delegate's own `override_reason` is shown beside the refusal as
  `proposed_reason`, a draft for the engineer, and a repeat of an earlier case of the same reply
  stays refused.
- Finding the Rules a change affects no longer walks every Dependency path, so a deep diamond of
  Dependencies scans in milliseconds instead of minutes.
- `impact plan --persist` refuses (`forecast_missing`) when a Rule's statement changed since the
  Watermark and the run dir holds no confirmed forecast for it, so a fresh or lost run dir can no
  longer narrow the judge's selection and let the Watermark pass a widened Rule. `deep-dive
  reconcile` and `impact quick-check` record the forecast of every edited statement, widened or
  not; confirm it again into the same `--dir` to go on. Projects below schema 3 are not checked.
- A judge unit sees, as read-only context, the cases of the Feature's other scenario files that
  collide with its selected cases, and a Conflict may name one as its other side.

## [0.3.4] - 2026-11-02

### Fixed

- `/qa-impact` refuses a judge reply whose Conflict quotes words the case does not say, quotes
  the other side not word for word, or names a Rule the Feature does not state.
- `/qa-codefix` refuses a repair that turns an assertion into a check of the expected value
  against itself.
- `/qa-codegen` and `/qa-codefix` no longer read the whole repository into memory, or copy it into
  the run dir, for every item: each file is recorded by its git blob id. A codegen or codefix Run
  started on an earlier version should be started again. A `git gc` that prunes a Run's recorded
  files is reported as `snapshot_pruned`, and the item is started again.
- A `.qa/` value may hold a backslash (written `\\` inside double quotes), and a `__proto__` key is
  refused instead of setting fields the file never wrote.
- The suggested commit command quotes a path or message a shell would split or expand.
- A Convention that states a limit such as "under 120 characters" is no longer warned about as an
  HTTP status code.

## [0.3.3] - 2026-11-02

### Changed

- The agent guidance `/qa-init` offers now routes every command, including `/qa-impact` for a small
  change, `/qa-codegen`, `/qa-codefix`, `/qa-bug`, `/qa-publish` and `/qa-train`.
- `/qa-ask`, `/qa-next` and `/qa-show` read the migration status from their own output instead of
  a separate check.

### Fixed

- The README and first-run guide describe `/qa-impact`'s quick path and no longer call test-code
  generation out of scope; support-matrix links, including the host-version refusal's, point at
  v0.3.0.

## [0.3.2] - 2026-11-01

### Fixed

- The test suite no longer depends on the Claude Code session it runs in, so CI's `test` job
  passes again: a local run used to inherit the real host and pass tests that fail without it.

## [0.3.1] - 2026-11-01

### Changed

- `/qa-fix` is now `/qa-codefix`, pairing it with `/qa-codegen`: type `/qa-codefix --run <dir>`,
  including to resume a Run paused before the upgrade. Its training is `/qa-train codefix` and
  `.qa/train/codefix.md`; an existing `.qa/train/fix.md` keeps working in place, and the CLI's
  `fix` mode still runs as an alias of `codefix`.

## [0.3.0] - 2026-11-01

### Added

- `/qa-execute` runs each selected case's Automations first, through a `test_runner` declared in
  `project.md` (Playwright, Gradle or Maven, built into argv with no shell). A failing Automation is
  re-run (`automation_retries`, default 2), mixed results mark it Flaky, and a case whose Automation
  passes needs no manual Execution. A Failed Automation is followed by the Tester's Execution, and
  the pair routes the case to code fix or bug report.
- After a Run, `execute follow-ups` builds the fix and bug work list and the Run ends with
  CLI-written summaries and one publish question.
- `/qa-fix` repairs test code in a CLI-checked verify loop, with edit guards, regression checks,
  flaky repeats and an optional PR the CLI commits without touching your checkout.
- `/qa-bug` drafts one Bug draft per failing case into `.qa/bugs/`, copied from the scrubbed
  Execution record; `/qa-next` points at drafts waiting to be published.
- `/qa-publish --run` publishes Bug drafts to the tracker behind its own Card: linked to their case,
  with required fields, offered screenshots, open-bug and duplicate checks, and crash recovery.
- `/qa-codegen` writes and binds one Automation per uncovered case in the project's own style,
  proved by repeated passing runs, in the working tree or as a PR.
- `/qa-train codegen` learns code gen Conventions from the conversation or the project's test code,
  and warns when they drift.
- `/qa-init` proposes `test_runner`, `code_host`, `stack.root` and the tracker's bug group.
- `/qa-show [<feature-key>]` writes a private Knowledge page for one Feature or every Feature: the
  snapshot stamp and project legend, then each Feature's Coverage with Deferred functionality,
  Parked questions, Boundaries and Waivers, Rules, and Scenario → Case tree. Open Findings and gaps
  stay in step with `/qa-next`; Rules and cases filter and search, and link to each other across
  Features. Broken knowledge appears in place as an error card.

## [0.2.6] - 2026-10-31

- `/qa-execute` selects live Test Cases with `tag:<name>` and `level:<name>` tokens, with or
  without scope keys: any-of within each kind, AND across kinds, using exact project names.
- Execution confirms name the filters and any requested Test levels that cannot execute;
  frozen plans and Execution records preserve the requested selection, including repeats.

## [0.2.5] - 2026-10-31

- `/qa-publish` writes a case's Tags to the tracker when `tracker.tag_field` is set (a multi-value field, or `labels`, where only the project's own Tags are added or removed).
- `/qa-publish` writes mapped Custom field values when a Custom field names its `tracker_field`; an unclassified case clears the field.
- `/qa-sync` reads the tracker's Tags and Custom field values back as label copies. A difference is never a Divergence and never needs a Review.
- The first publish after configuring labels records copies locally, with no tracker write, where the tracker already matches; changing a label destination never clears the old one.
- `/qa-next` reports label-only changes as publish work, and asks for a Review first when the case's Review is not fresh.
- `/qa-init` and `check` report label destinations that collide with the marker label, the marker field, a built-in publish field or each other.

## [0.2.1] - 2026-10-31

- The `/qa-next --page` Next steps page shows each Feature's own Rule statement when two Features share a Rule slug.

## [0.2.0] - 2026-10-23

- `/qa-execute` checks that the Claude Code host meets the supported version before opening an application.
- Credential scrubbing covers additional credential names and URL query parameters, with data-handling promises clarified.
- A support matrix documents tested configurations, capabilities, evidence, limits, and operational data handling.
- `/qa-init` proposes execution targets and levels; `/qa-train access` helps keep login files out of version control.
- MIT licensing now accompanies the package and installed plugin.
