# Changelog

## Unreleased

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
