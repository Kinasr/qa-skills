# Publish a completed Run's Bug drafts

For `/qa-publish --run <execute-run-dir>`, run `execute follow-ups --dir <execute-run-dir>` first,
preserving the root. Resume the same Run. Then run
`publish scope --run <execute-run-dir> [--dir <publish-run-dir>]` and use the returned publish
`dir` for every later call. `run.json` pins `execute_run`; the CLI reloads the follow-ups at every
step. A Feature cannot accompany `--run`.

This scope contains only draft bugs whose Run items are done. It contains no case writes, parents,
repairs or Parked-questions comments. `scope.cases` still names the case Tracker keys to fetch.
The tracker scout reads the bug type's paged createmeta, attachment/meta and issueLinkType list,
and follows the Publish Practices. Use the normal fetch, Card, apply, Publisher and record sequence.

The chain-ending skill relays `execute summary` and asks the publish question when `publish.ask`
is true. Yes invokes `/qa-publish --run <dir>`; no leaves the drafts; discard all or named Keys runs
`bug discard <bg_key…>`, expanding all to `publish.keys`. That yes authorizes invocation only:
a separate Card still needs the engineer's Reply. Return to the caller after Publish; the caller
owns the Run's single training offer.

Show every bug's number, Key, summary, route, case Key and title, resolved Tracker key, link type
and direction, create fields, unanswered required fields with allowed values, offered screenshots
marked not scrubbed with each dropped one's reason, stale and redacted flags, and full body on the
Card. An open linked bug says "case already has an open bug" with its key, summary, status and
links; a closed one is information needing no answer; a local published bug the case does not link
says so. Older drafts are discard-only lines, ignored by `take: "all"` and kept when unanswered. A
recovered bug says "link and attachments not verified". Bugs that failed together with one
Automation in one Run are grouped as that fact, never a cause. `fields` answers by item number or `all`; `attach` ticks offered screenshots by name;
`discard` deletes a draft. A stale bug or an open linked bug needs `confirmed`. Apply checks the
grammar first, then reports `needs_edit` and `confirm` together; submit its `decisions` only after
the engineer's explicit yes, and rebuild when the state changed. Relay incomplete-Card refusals and
stop; they never authorize a create with guessed fields or an unresolved case link.
Screenshot selection and field answers use the CLI's available Card data; never invent attachments.

Run `publish record` even after a Publisher failure. A valid bug Tracker key is recorded as
published even with an error: report the manual remedy and never republish that draft. A failed
attachment never stops the others. The CLI commits the whole accepted bug file, adding an untracked
one, and commits a discarded draft's deletion; a changed file requires a new Card. With no tracker
write, skip the Publisher and run `publish record` directly.
Under `--run`, make no `/qa-train` offer.
