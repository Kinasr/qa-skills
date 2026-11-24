# CLI reference

Every skill reaches one shared CLI, `node plugin/scripts/scan.mjs`, with each mode's commands below.
The entrypoint keeps its first name: `scan.mjs` runs every mode, and only its `scan` mode is the
mechanical Scan.
Each call prints one JSON object on stdout, `mode` first, and exits 0 on success; every refusal
prints `{mode, ok: false, ...}` and never writes. CLI `UsageError`s (exit 2), `schema-guard`
rejections (exit 1), standalone codefix baseline stops (exit 1), and migrated commands emit unified
`{mode, [migration,] ok: false, refusals: [{code, ...facts}]}` with zero `text` or `error` fields
(quarantined deferred legacy shapes remain only on `scout`, `train`, `deep-dive`,
`migrate-keys --levels` non-schema errors, and exit-0 `tester request` transport errors). Every
allowlisted skill entry mode and entry action carries `migration` at the top level (including
`no_qa_dir` refusals), while helper modes, inner-loop actions (`omitMigration`), and shared-parser
usage errors omit it.

## The CLI

```
node plugin/scripts/scan.mjs check-file <path> [--input <path>] [--root <qa-dir>]
node plugin/scripts/scan.mjs commit --input <path> [--confirmed] [--root <qa-dir>]
node plugin/scripts/scan.mjs mint <tc|ts|su|aut|rule|boundary|bg> [--count <n>] [--root <qa-dir>] [--feature <key>] [--prefix <P>]
node plugin/scripts/scan.mjs migrate-keys [--levels [--map-level <from=level+tag,...>]] [--root <qa-dir>]
node plugin/scripts/scan.mjs migration-status [--root <qa-dir>]
node plugin/scripts/scan.mjs scan [<feature>] [--target <ref>] [--root <qa-dir>]
node plugin/scripts/scan.mjs next [<feature-key>] [--root <qa-dir>] [--page]
node plugin/scripts/scan.mjs show [<feature-key>] [--root <qa-dir>]
node plugin/scripts/scan.mjs ask [--feature <key>] [--root <qa-dir>]
node plugin/scripts/scan.mjs deep-dive refs <ref>... [--root <qa-dir>]
node plugin/scripts/scan.mjs deep-dive feature <key> [--root <qa-dir>]
node plugin/scripts/scan.mjs deep-dive roles <name>... [--root <qa-dir>]
node plugin/scripts/scan.mjs deep-dive reconcile <key> --input <path> [--dir <run-dir>] [--root <qa-dir>]
node plugin/scripts/scan.mjs deep-dive resume --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs deep-dive amend <key> <rule>... [--root <qa-dir>]
node plugin/scripts/scan.mjs deep-dive check <key> --input <path> [--confirm <link>,...] [--root <qa-dir>]
node plugin/scripts/scan.mjs brief judge <scenario-key> [--target <ref>] [--cap <bytes>] [--change <change-json>] [--root <qa-dir>]
node plugin/scripts/scan.mjs brief feature <feature-key> [--target <ref>] [--root <qa-dir>]
node plugin/scripts/scan.mjs brief design <scenario-key> [--expand | --regenerate] [--agreement <file>] [--root <qa-dir>]
node plugin/scripts/scan.mjs check-reply <judge|design> <reply-path | --input <path>> --brief <brief-json>
node plugin/scripts/scan.mjs sync scope [<feature>] [--dir <run-dir>] [--root <qa-dir>]
node plugin/scripts/scan.mjs sync card [<feature>] --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs sync apply --dir <run-dir> --input <path> [--root <qa-dir>]
node plugin/scripts/scan.mjs publish scope [<feature>] [--dir <run-dir>] [--root <qa-dir>]
node plugin/scripts/scan.mjs publish card [<feature>] --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs publish apply --dir <run-dir> --input <path> [--root <qa-dir>]
node plugin/scripts/scan.mjs publish record --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs impact plan [<feature>] [--target <ref>] [--persist [--review [<feature>]]] [--cap <bytes>] [--dir <run-dir>] [--root <qa-dir>]
node plugin/scripts/scan.mjs impact report --dir <run-dir>
node plugin/scripts/scan.mjs impact persist --dir <run-dir>
node plugin/scripts/scan.mjs impact escalate --dir <run-dir> --case <key> [--root <qa-dir>]
node plugin/scripts/scan.mjs impact entry [<feature> [<ref>...]] [--persist] [--review [<feature>]] [--target <ref>] [--root <qa-dir>]
node plugin/scripts/scan.mjs impact quick [--dir <run-dir>] [--root <qa-dir>]
node plugin/scripts/scan.mjs impact quick-check <feature> --dir <run-dir> --input <path> [--root <qa-dir>]
node plugin/scripts/scan.mjs design state <feature> [<scenario>] [--expand | --regenerate] [--review] [--root <qa-dir>]
node plugin/scripts/scan.mjs design agree <scope> --input <path> [--root <qa-dir>]
node plugin/scripts/scan.mjs design split <feature> --input <path> [--dir <run-dir>] [--root <qa-dir>]
node plugin/scripts/scan.mjs design override --input <path> [--dir <run-dir>]
node plugin/scripts/scan.mjs design plan <feature> [<scenario>] [--expand | --regenerate] [--dir <run-dir>] [--root <qa-dir>]
node plugin/scripts/scan.mjs design unbind --dir <run-dir> <case-key>
node plugin/scripts/scan.mjs design resume --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs design report --dir <run-dir>
node plugin/scripts/scan.mjs design keep --dir <run-dir> --input <path>
node plugin/scripts/scan.mjs design walk --dir <run-dir> [--by human:<name>] [--case <key>]
node plugin/scripts/scan.mjs design triage --dir <run-dir> --input <path> [--case <key>]
node plugin/scripts/scan.mjs design checkpoint --dir <run-dir>
node plugin/scripts/scan.mjs design rule-fix <feature> --dir <run-dir> --input <path>
node plugin/scripts/scan.mjs design page --dir <run-dir> [--input <path>]
node plugin/scripts/scan.mjs design page-reply --dir <run-dir> --input <path>
node plugin/scripts/scan.mjs design propose --dir <run-dir> --input <path>
node plugin/scripts/scan.mjs design link --dir <run-dir> --case <key> --input <path>
node plugin/scripts/scan.mjs delegate resolve --cmd <impact|design> [--root <qa-dir>]
node plugin/scripts/scan.mjs delegate start --dir <run-dir>
node plugin/scripts/scan.mjs delegate next --dir <run-dir>
node plugin/scripts/scan.mjs delegate record --dir <run-dir> --unit <id> --attempt <n> [--status <status>] [--wall-ms <ms>]
node plugin/scripts/scan.mjs init state [--root <qa-dir>]
node plugin/scripts/scan.mjs init card --input <path> [--dir <run-dir>] [--root <qa-dir>]
node plugin/scripts/scan.mjs init apply --dir <run-dir> --input <path> [--root <qa-dir>]
node plugin/scripts/scan.mjs init smoke --model <label> [--reply <file>] [--dir <run-dir>]
node plugin/scripts/scan.mjs init add-role <name>... [--root <qa-dir>]
node plugin/scripts/scan.mjs train evidence [<target>] [<scenario-key>] [--diff <commit-ish>] [--stack <root>] [--from-code] [--relearn] [--facet <facet>[,<facet>]] [--root <qa-dir>]
node plugin/scripts/scan.mjs train check [<target>] --input <path> [--root <qa-dir>]
node plugin/scripts/scan.mjs train check categories [--input <path>] [--root <qa-dir>]
node plugin/scripts/scan.mjs train auth-ignore <line> [--root <qa-dir>]
node plugin/scripts/scan.mjs scout brief ui <url> <request> [--signed-out] [--dir <run-dir>] [--root <qa-dir>]
node plugin/scripts/scan.mjs scout brief tracker --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs scout brief publisher --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs scout ingest --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs scout login-steps <url> <login_state> [--root <qa-dir>]
node plugin/scripts/scan.mjs scout password-steps <via> [--root <qa-dir>]
node plugin/scripts/scan.mjs scout header-steps <header_via> [--root <qa-dir>]
node plugin/scripts/scan.mjs execute plan [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--root <qa-dir>]
node plugin/scripts/scan.mjs execute confirm (--dir <run-dir>)... [--input <path>]
node plugin/scripts/scan.mjs execute open --dir <run-dir> --execution <id> [--root <qa-dir>]
node plugin/scripts/scan.mjs execute close --dir <run-dir> --execution <id>
node plugin/scripts/scan.mjs execute brief --dir <run-dir> --execution <id> [--root <qa-dir>]
node plugin/scripts/scan.mjs execute ingest --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs execute next --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs execute resume --dir <run-dir> --note <acc> [--skip]
node plugin/scripts/scan.mjs execute record --dir <run-dir> --execution <id> --status ok|failed|timeout|refused|quota [--reason-file <path>]
node plugin/scripts/scan.mjs execute automation --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs execute follow-ups --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs execute summary --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs codegen plan [<scope>...] [tag:<name>...] [level:<name>...] [target:<slug>] [--stack <root>] [--choices <json>] [--pr] [--root <qa-dir>]
node plugin/scripts/scan.mjs codegen start --dir <run-dir>
node plugin/scripts/scan.mjs codegen verify --dir <run-dir> --item <id> --hypothesis <line>
node plugin/scripts/scan.mjs codegen done --dir <run-dir> --item <id> --expects <json>
node plugin/scripts/scan.mjs codegen regress --dir <run-dir>
node plugin/scripts/scan.mjs codegen fail --dir <run-dir> --item <id> --reason <reason> [--cnv <key>]
node plugin/scripts/scan.mjs codegen pr-prepare --dir <run-dir>
node plugin/scripts/scan.mjs codegen pr-record --dir <run-dir> (--url <url> | --pushed --error <reason> | --error <reason>)
node plugin/scripts/scan.mjs bug read --run <run-dir> --item <item> or --case <case-key> [--cause <cause>] [--root <qa-dir>]
node plugin/scripts/scan.mjs bug write --run <run-dir> --item <item> or --case <case-key> [--cause <cause>] --summary <line> [--description <lines>] [--root <qa-dir>]
node plugin/scripts/scan.mjs bug discard <bg_key>... [--root <qa-dir>]
node plugin/scripts/scan.mjs tester do <execution-id> <role> <command> [<arg>…] --dir <run-dir>
node plugin/scripts/scan.mjs tester request <execution-id> <role> <METHOD> <url> [--query k=v]… [--header Name:value]… [--json <body>] [--auth absent|invalid|expired] --dir <run-dir>
node plugin/scripts/scan.mjs codefix plan [<Automation-or-Case key>…] [target:<slug>] [--pr] [--flaky] [--dir <run-dir>] [--root <qa-dir>]
node plugin/scripts/scan.mjs codefix start --dir <run-dir> --item <id> [--root <qa-dir>]
node plugin/scripts/scan.mjs codefix verify --dir <run-dir> --item <id> --hypothesis <text> [--root <qa-dir>]
node plugin/scripts/scan.mjs codefix done --dir <run-dir> --item <id> --summary <text> [--root <qa-dir>]
node plugin/scripts/scan.mjs codefix fail --dir <run-dir> --item <id> --reason <reason> [--root <qa-dir>]
node plugin/scripts/scan.mjs codefix handoff --dir <run-dir> --item <id> --cause <cause> [--root <qa-dir>]
node plugin/scripts/scan.mjs codefix regress --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs codefix pr-prepare --dir <run-dir> [--root <qa-dir>]
node plugin/scripts/scan.mjs codefix pr-record --dir <run-dir> (--url <url> | --pushed --error <reason> | --error <reason>) [--root <qa-dir>]
```

`fix` is the `codefix` mode's name from before `/qa-fix` became `/qa-codefix`, and still runs it.

`--root` names the `.qa/` directory (default `./.qa`). A `.qa/` whose `project.md` declares a
newer `schema_version` than this CLI reads, or a malformed one, is refused by every command that
writes into the repository, writing nothing; `scan` runs on, warning of a newer one.

Every action that takes `--input <path>` also takes `--stdin`, which reads the same bytes from
standard input; the two are never given together. The skills and the briefs the CLI writes use
`--input`: the agent writes the input to a file outside the repository, then runs one plain
`node <plugin>/scripts/scan.mjs <mode> ... --input <path>` line, with absolute paths and no pipe,
heredoc, `&&` or `;` chain, variable prefix or `cd`. So the one allow rule `Bash(node:*)` covers
every call the skills make to the CLI. `npm run lint:skills` fails a skill that shows one of those
forms, or `--stdin`.

`--dir` names a run directory. The commands that make one (`init card`, `design split`, `design override` and
`design plan`, `impact plan`, and the `sync` and `publish` `scope` steps) make a fresh OS temp dir
when it is not given and print it as `dir`; `--out` is that option's deprecated old name in
`design` and `impact`, accepted beside `--dir` but never with it.

## Maintenance and startup

`migrate-keys` is the one-off move of a legacy `.qa/` to framework-minted Keys (ADR-0027). It
renames each Test Case and Test Scenario to a `tc_…`/`ts_…` Key, moving the old Key to `formerly:`
and a tracker key to `tracker:`, renames the Scenario files and headings to match, deletes the
`migrate_as:` overrides it used, backfills each Feature's missing `suite_key` with `mint su`, and
sets `project.md`'s `schema_version` to 3 (ADR-0028). The Suite backfill runs only on the default
branch, identified by `origin/HEAD`; existing Suite keys stay unchanged. Case/Scenario validation
still starts at schema 2. The planned tree is checked for identity errors before any write. It leaves
`sources:`, `automates:`, prose and every human pin as written, writes no Watermark or human stamp,
and never commits: review the result as a PR. It refuses a `.qa/` outside git or with uncommitted
changes, and writes nothing on any refusal. When two entries would take one Key it refuses and
prints the fix: add `migrate_as: tc_…` (or `ts_…`) to one of them, commit that edit, and run it
again. Its JSON (`ok`, `changed`, `mapping`, `renamed`, `rewritten`, `check.errors`) says what it did;
a rerun on a migrated `.qa/` reports `changed: false`. **To recover an interrupted run**, restore
`.qa/` from the starting commit with git (`git checkout -- .qa && git clean -fd -- .qa`), then run it again.

After committing the Key migration, run `migrate-keys --levels` to reach schema 4. It copies a
Scenario's level onto cases lacking one, preserves case overrides, and removes the Scenario level.
At schema 4, every case requires one project level. An unknown legacy level refuses with
`level_mapping_required`, listing the missing mappings, execution-mode changes and potential
new duplicate cases; nothing is written. Supply `--map-level e2e=ui+e2e` (comma-separated for
several mappings) to choose a project level and a Tag. The Tag is declared with an empty meaning
if absent, and `execute_levels` is rewritten; conflicting execution modes refuse. The success JSON names
those Tags in `tags_without_meaning`: a Tag with no meaning is never assigned by the `/qa-design` filler,
so ask the engineer for a meaning with `/qa-init` maintenance. A Scenario whose rewrite cannot be applied
refuses with `level_rewrite_failed`, naming the file and the edit `errors`. Verified fresh
Reviews and Dismissals receive a carried digest and `migrated: 4`, retaining their original commit,
author and date. Stale and unverifiable pins stay untouched; the JSON `pins` lists each outcome.
Only this migration and the schema 6 Rule-list step carry pins across a rewrite. Review and commit their changes separately.

After reaching schema 4, `migrate-keys` advances to schema 5 by changing only the version marker:
it rewrites no case and re-pins no Review or Dismissal. A case may omit `level` (a Layer-free
case), name one project level slug, or name a non-empty list of distinct `stack.levels` members.
Unknown, duplicate, empty or non-slug bindings are shape errors at the file-write check. Claim
comparisons and digests treat a one-item list as its slug and sort longer lists; removing or
changing a binding still changes the claim. Below schema 4, a case with no level continues to
inherit its Scenario's level. An install that reads only schema 4 refuses schema 5 through the
existing version guard.

The next plain `migrate-keys` at schema 5 performs the schema 6 step: it rewrites every heading-form
Rule and Boundary into a numbered list item under `## Rules` or `## Boundaries`, word for word,
numbering from 1 in file order per section and indenting fields and elaboration to the item's
content. Features already in list form are left alone. A heading outside its section refuses with
`rule_outside_section`, naming the file and line, rather than moving text. Prose between a section
heading and its first entry refuses with `prose_in_section`, naming the file and line: move that
prose above the section heading or into a Rule's elaboration, then run the migration again. Every
result is checked before anything is written. Comparisons read a neutral canonical form of each
entry, so the stored digests change once: the step recomputes each Feature's `coverage_digest`,
re-pins every fresh Watermark to its new digest, and re-pins every fresh Review and Dismissal to the
new digest with `migrated: 6`; a pin that was already Stale stays as it was. The JSON `pins` lists
each outcome.
New projects start at schema 6 and write the list form. At schema 6, `check` reports a Rule or
Boundary still written as a `###` heading and names `migrate-keys` as the fix.

Writers declare a minimum schema and refuse below it with `schema_migration_required`, naming
the first migration to run. Design and execution require schema 4; Feature writers retain
`suite_schema_required` for the Suite boundary, schema 3. Readers continue to read older projects.

`migration-status` is the read-only migration check; every allowlisted entry mode (`ask`, `next`,
`show`, `scan`, `migrate-keys`) and entry action (`bug read`, `bug discard`, `codefix plan`,
`fix plan`, `codegen plan`, `deep-dive refs`, `deep-dive feature`, `deep-dive roles`,
`deep-dive resume`, `design state`, `design resume`, `execute plan`, `execute follow-ups`,
`impact entry`, `init state`, `init add-role`, `publish scope`, `sync scope`, `train evidence`,
`scout brief`) carries its result at the top level as `migration` (including allowlisted `no_qa_dir`
refusals), so skills still read it from their first command instead of making a separate call, while
helper modes, inner-loop actions, and shared-parser usage errors omit it (`lib/modes.mjs`). Its JSON holds
`pending`, ordered `migrations: [{version, command}]`, `count` and `declarations: [{file, line, key}]` for live Case headings and Scenario
frontmatter keys that need migration. A heading that disagrees with its YAML key is counted once
and reported with `malformed: true` and `block_key` (null when missing), even if the heading is
minted. Historical `formerly:` and `retired:` entries do not count. A missing root reports
`pending: false`, `count: 0`. It performs no code scan or git operation and exits 0. The skills
warn using the ordered `migrations` when pending and continue their command.

## The scan and the Next steps

`scan` is the global relational pass. Its JSON holds the Key index (`index`, with the code
index's `automations` when code binding ran), every result in `results` labelled by `kind`
(`integrity_error`, `unknown_key`, `outcome_gap`, `divergence`, `review_overdue`,
`case_warning`, `train_warning`, `config_warning`, `binding_proposal`) with a `code` naming the
check, `counts` per kind, and `run_health` for what the run could not do (such as `no scanner; code
binding skipped`). `config_warning` `module_path_absent` names a `module_paths` entry that does not
exist yet, which `/qa-codegen` creates; one that exists but is no directory is the
`missing_module_path` Integrity error.
It never writes and always exits 0; only a usage error exits 2. Each concern is a pass module
(`plugin/scripts/lib/scan-*.mjs`) registered in `plugin/scripts/lib/scan.mjs`.

`case_warning` reports Permissions drift: `partial_permission_binding` names the Test Case, its
`missing_levels` and a message when the case covers a Rule the Feature's covered `permissions`
Coverage line names, but its binding omits some level in `execute_levels`. A Layer-free case raises
it with every executable level missing when two or more are executable. A case bound to every
executable level, one covering no Permissions Rule, and a Layer-free case with one executable level
raise none.

Beside `results` it publishes two link reports, neither a Finding, so no entry of `counts` holds
them. `uncited_cases` lists each case whose `covers` is empty, whatever its `relies_on` holds
(`feature`, `scenario`, `key`, `file`, `line`, `relies_on`). `uncovered_rules` lists each live Rule
that no case covers, never a Waived one (`feature`, `rule`, `file`, `line`, `relied_on_by`: the
cases whose Reliance names it, for information, since Reliance is never coverage). Both follow file
and line order and respect the `<feature>` limit; `next` reads them from the scan.

Its `history` section holds the history-aware facts `/qa-impact` is built on. Each one compares
Bookkeeping-stripped text read from git: each Feature's candidate class and stripped diff since its
Watermark, the Rules and cases that diff touched, its Affected Rules (`affected_rules`: every Rule
changed since the Watermark plus every Rule downstream of one through Dependencies, over both the
baseline and target edges), the `--persist` dirty check, review freshness,
the open Stales (`stales`: each one's pin and whether it resolves), the Stale obligations
(`stale_obligations`: for every case that covers a local Affected Rule, or relies on any Affected
Rule, one entry per causing Rule with the `baseline` and `target` commits, `causes`, `affects`,
`cause_digest`, `via` and whether the case already stores it), Dismissal re-arm, and the oldest
`mirror.at`. `scan` only reports the obligations; `impact persist` stores each as a Stale finding
on its case, once per (`baseline`, `cause_digest`), and a stored Conflict stays beside it. A Stale
stored with no `baseline` and `causes`, as every Stale was before, stays open and settleable.
`--target <ref>`
makes the scan read `.qa/` at that commit instead of the working tree. One structural Rule diff
decides what changed: a statement, elaboration, Waiver or Dependency edit each counts, and
`deep-dive check` classifies the same edit the same way.

The tracer projects today's scan Integrity errors, Outcome gaps, Divergences, binding proposals
and Training warnings; other scan signal groups join it the same way. Its JSON contract is:

- `global`: `migration` (the shared migration-status result), `schema` (`code`, `version`,
  `supported`; a newer version retains the scan's `schema_newer` evidence), and `run_health`.
- `features`: ordered summaries with `key`, `label`, `counts` by kind, `nothing_pending` and
  `top_next_step` (null when empty).
- `next_steps`: the full ordered list; `start_here` is its first entry or null. `feature` is the
  selected Feature key or null, and `root` is the supplied `.qa/` root.
- Each Next step has `kind`, `signal` (the scan code), `feature` (null for global results), `keys`,
  `labels` (`signal`, `detail`, `feature`, `keys`), `prerequisites`, `route` and numeric `priority`.
  Evidence is flattened to `file`/`line`, relative to the repository, including the `.qa/` prefix
  for knowledge files; an absent file supplies neither. A code location comes from `function` or
  `class`; `locations` retains all evidence locations when a proposal names several functions or
  also cites a knowledge binding. `file`/`line` are its first location. Signal codes can be shared
  across kinds, as with duplicate Automation errors and proposals.
- A route is `{type: "command", command, args: [...]}` or `{type: "manual", text}`. Arguments are
  separate tokens; manual text is the exact action. Migration uses `node` with the installed CLI
  path and the supplied root. Tracker keys are repaired through supported `/qa-sync` flows.

The kinds are `blocking`, `at_risk`, `parked`, `missing_knowledge`, `judge_needed`, `publish_pending`,
`binding`, `automation_gap`, `unknown`. Signal rows and the priority table live together in
`plugin/scripts/lib/next.mjs`: missing project (0), other Integrity errors (10), Conflicts (20),
Stales (30), Watermark behind (40), Parked questions (50), missing knowledge (60), publish pending
(70), Outcome gaps (80), Divergences and sync proposals (90), Training warnings (100), Review overdue
(110), Automation gaps (120). Ties use Feature Key, then Key, then signal and location for stability.

Bug drafts add one `publish_pending` step per Feature (`signal: bug_drafts`), whether or not bug
publishing is configured; its detail counts the drafts awaiting publish, those whose case changed
since `case_digest` (stale), those whose case a Feature retired (retired-blocked), and those sharing
a case with another bug file (shared-case).

`next` is `/qa-next`'s deterministic half and the `next` command above. `[<feature-key>]` shows
that Feature's full list and keeps global results; no argument shows the global status. With
`--page`, or when it offers one above 15 pending Next steps, it writes a read-only Next steps page
to the OS temp dir, outside the repo. The fixed emoji legend lives in the skill and is used only
in `/qa-next` output, including that page.

The code index is a source scan of `module_paths` (ADR-0005). Each test stack is one adapter in
`plugin/scripts/lib/stacks/`, chosen by `project.stack` (`plugin/scripts/lib/stack.mjs`, ADR-0022): Kotlin/JUnit 5
(`stack.language: kotlin`, a `stack.framework` naming JUnit 5) and TypeScript/Playwright Test
(`stack.language` TypeScript or JavaScript, a `stack.framework` naming Playwright), which parses with the
repository's own `typescript` (ADR-0023). Each reads its Key carriers' names from `annotation_map`,
and declares the carrier forms it reads and writes beside its descriptor, clear of its parser, so
`/qa-init` refuses and `scan` warns on an Automation-key carrier the stack cannot write.
A result located in the code carries `function: {file, line, class, name}` or
`class: {file, line, name, path}`, with `file` relative to the repository, instead of a `.qa/`
`file`.

## The judge briefs and reply checks

`deep-dive` is the deterministic half of `/qa-deep-dive`. It never writes a Feature; its one write is
`reconcile`'s `change.json` in `--dir`. `refs` turns each
Reference into its URI and resolves the local ones. It also returns `access`, the Access note from
`train/access.md` that each tracker or url Reference is reached through (`null` for any other), and
`train`, deep-dive's own training. `feature` reports whether a Feature key is usable, and
the Feature's Rules with every case covering each. `roles` names the roles `project.roles` lacks.
`check` validates a drafted Feature file (`check-file` plus the re-run rules) and returns the
changeset, the suggested commit and the next step. It exits 1 when the draft fails. A retired or
merged-away Rule lists in `rules.retired[].links` every `covers`, Reliance (`relies_on`) and Dependency
(`depends_on`) that names it across Features, each with an `id` (`<rule>:<kind>:<owner>`), `feature`,
`owner`, `file`, `line` and `resolution`. A link the working tree no longer holds is repaired and not
listed; a link still there is a `link_unrepaired` error until `--confirm <id>,...` confirms it, and a
`--confirm` id that names no listed link is `confirm_unknown`. A Dependency inside the drafted Feature
is read from the draft and can only be repaired by editing it. The next step
after Rule edits is always a bare `/qa-design <feature>`.

`reconcile` is the Rule-edit transition on an existing Feature. It diffs the Feature file in the
working tree against the one HEAD committed (the same four-kind Rule diff as `check` and the Scan) and
reads the confirmed Impact forecast from `--input <path>` as `{"changes": [...], "may_change": [...],
"unaffected": [...]}` of local Rule keys (conversation-time; only the answer for an edited statement is
recorded, as below). It lists the `edited` Rules
with their `band`, the ones `outside_band` (forecast Unaffected, or in no band), the `unedited_changes`,
the `added` and `retired` Rules, a `boundary_check` pairing each edited or added Rule with the Feature's
Boundaries and their owners for the agent to compare, the `downstream` Rules (every Dependency path,
baseline edges included, each with its Feature, statement and `via`) and the `next_feature` to run with
a `summary`. When the forecast also carries `widened` (Rule keys) and `by`, `--dir` is required and the
engineer-confirmed widened Rules are merged by key into the run dir's `change.json`, which `impact plan
--dir` reads; a refused call writes nothing. With `--dir`, it also records a `forecast` entry (`{feature,
rule, widened, statement, by, at}`, `by` null when none was given) for each Rule the forecast puts under
Changes or May change, or widens, whose statement was edited since the Feature's Watermark, the edits
already committed included: a clean working tree confirms again what the commit holds. The entry
replaces the Rule's earlier one, and the output lists them as `forecast`. A Rule left Unaffected or
unnamed is the `outside_band` edit still to settle, and has no entry. Without `--dir` nothing is
recorded. `amend` is the bounded amendment inventory: the named Rules
in full, the cases whose `covers` or Reliance names them, and counts of what it left out. `resume
--dir <run-dir>` continues a change the quick path handed off: it reads the dir's `handoff.json` (see
`impact quick-check`) and prints its `references`, `edits`, `open_questions` and `written` files, the
`uncommitted` subset of those still differing from HEAD, the `feature` and the `next_step`
(`/qa-deep-dive <feature> <reference>...`). It writes nothing; with no handoff it answers `no_handoff`.

`brief judge` assembles the self-contained brief for one judge unit: one scenario file of
a Feature `scan` classes `first_judgement` or `candidate` (or `unchanged`, with a case escalated in `--change`), with the Feature's Change bundle, its
Boundaries and both files inlined (ADR-0010). The scenario file is cut to the cases the change
selects (the Stale, new, edited and escalated cases and the cases they collide with; every case on
a first assessment, a new or widened Rule, or a Boundary change), and an unselected sibling is
absent from the brief and its JSON. `--change <change-json>` gives it the run's `change.json`
(`impact plan` passes the same data). Every Rule that governs a selected case is sent in full,
unchanged ones included, and the other Rules as their statement. The unit is an error when none of
the file's cases is selected. Its JSON carries the brief text, the selected case keys it
sends (`check-reply judge` expects exactly these), the Feature's Boundaries, each sent case's text, and whether the
changed cases went past the cap (`changed_cases.degraded`, default 32768 bytes, unmeasured). The brief
also carries, as read-only context, the cases of the Feature's other scenario files that share a
governing Rule with a case it judges (a Conflict may name one as its other side; no verdict is asked
for it): `context_text` holds each one's text beside `case_text`, and `context_cases` says which
there were and whether the cap left them out (`dropped`). The context and the changed cases share the
cap, and the context is trimmed first, whole. The
judge instructions and output contract live in `plugin/scripts/lib/judge-prompt.mjs`. Its scope section is
generic, and the prompt runs unmeasured until it is re-measured on real data (ADR-0025).

`brief feature` assembles the self-contained brief for one Feature-level judge unit: a Feature's
Boundaries and the candidate Rules it judges them against, inlined. It is planned for a Feature
that has Boundaries and at least one candidate Rule: every Rule changed since the Watermark, or
every Rule when a Boundary changed or the Feature has no Watermark yet. Its JSON carries the
brief text, the Rule keys it sends, the Boundaries, and each Rule's text.

`check-reply judge` reads one Delegate reply against the JSON `brief` printed for that unit and says
whether it is usable (exit 0) or not (exit 1), with every problem found. A verdict is `Conflict` or
`Current`; a `Stale` is the Scan's and is refused as not a verdict. An unusable reply yields no
verdicts; extra keys, a context case's among them, are dropped and counted. A Conflict may name a
context case's Key in `rules`, and its `quote_other` is then checked word for word against that
case's text; the Conflict is recorded on the judged case only. The reply's `overreaches` list is checked too: each
entry names a case sent (or, in a Feature-level unit, a Rule) and a Boundary of the Feature, quotes
both word for word, and names no pair twice.

## The tracker

The repo-under-test's tracker is read-only except `/qa-publish` (ADR-0026).
`sync` is the deterministic half of `/qa-sync`. The tracker is never read or written by the CLI:
the skill's tracker scout fetches it read-only and writes what it fetched as a JSON payload in the
run's **run dir** (its shape is documented in `plugin/scripts/lib/sync-tracker.mjs`, and for the agent in
the brief `scout brief tracker` writes, from `plugin/scripts/lib/scout-prompt.mjs`). Each call prints `dir` plus only what the agent acts
on: labels and glossary pieces, compact Markdown and factual refusals. The model writes the
Card's prose and closing report and maps the engineer's free-form Reply to JSON decisions
(ADR-0024); commands, paths and login steps stay CLI-written.

- `scope` makes the run dir (in the OS temp dir, unless `--dir` names one) and records its Feature.
  It supplies the tracker fetch specification, payload path, intake prose still needed, matched
  Access note and sync training. A failed fetch may name its Access note in the payload.
- `card` builds the numbered Card from the payload and records its digest in the run dir,
  replacing any earlier Card without writing the repository. It supplies `fetch_prose` and,
  once that is empty, `card`: counts, labels, questions, allowed edits, dependencies and tables.
  Sections are annotation declarations, Mirror refresh, Tracker intake, Key prefixes and
  code repairs. A failed or missing payload omits the tracker sections and supplies a note.
- `apply` reads JSON decisions from the file `--input <path>` names (`{"take":"all","drop":[3],"edits":{"4":{"level":"ui"},"7":{"keep":1}}}`),
  rebuilds the Card and checks the run dir's digest, ids and values. `take: "all"` means explicit
  whole-Card acceptance; otherwise unaddressed items remain open. It returns factual refusals,
  `rebuild` when fresh answers are needed, or a report of the applied items, files and exact commit
  command. A cascade returns `confirm`, labelled dependants and proposed JSON `decisions`, writing
  nothing until the engineer explicitly confirms their effect.

`apply` writes the accepted items in one pass:

- in the code, the Automation-key annotations and any import or declaration they need;
- in `.qa/`, `automates`, mirrors and intake cases and scenarios with permanent Keys and `tracker:` fields.

Tracker intake accepts a case with no level: it is written Layer-free, with no `level` key. A
tracker level it finds is offered as `offered_level` and needs an explicit `level` answer (the value,
or `""` to decline) rather than being applied silently; a tracker level outside `project.stack.levels`
is shown as `tracker_level` and never binds.

Every `.qa/` file goes through `check-file` first. `sync` writes all or
nothing, renamed files included (`writeAll`, `plugin/scripts/lib/changeset.mjs`), and never stages or commits. Each card section is a module
registered in `plugin/scripts/lib/sync.mjs`; `plugin/scripts/lib/sync-json.mjs` supplies their Card data.

`publish` sends unlinked Test Scenarios and Test Cases with fresh Reviews and updates cases that
have a Tracker key (`tracker:`) whose owned fields differ from their Mirrored values. Whether a
case is created or updated follows its effective tracker association, never its Key shape. It
reuses scan's Review freshness, sync's tracker fetch and the sealed Card lifecycle. `scope`
refuses missing tracker configuration or dirty paths it would rewrite; `card`
lists eligible and skipped cases with summaries and targets. A Case or Scenario the tracker
resolver finds ambiguous is skipped with a `remedy`: `merge` for distinct entries of one Feature holding one
tracker key, `reconcile` for two declarations of one Key or a clash a Merge cannot settle. `apply`
accepts JSON decisions and
records them in `publish.json`, then `scout brief publisher` writes `scout-publisher.brief.md`
and `scout-publisher.json`. The Publisher creates Suites, Scenarios and cases with the configured
type and marker field and label in the create call itself (initial status on cases only), then makes the cases' configured story
links; a framework parent reference becomes the tracker key of an existing parent or of a parent
created earlier in the run. It records
`{"results":[{"n":1,"key":"<framework Key>","tracker_key":"<created tracker key>","linked":["<story key>"]}]}` in
`publisher-results.json`. `record` validates those results, writes Case/Scenario `tracker:`
links and Mirrored values (Suite links only in the Feature's `mirror.suite`), and commits exactly those `.qa/` paths as `qa: /qa-publish tracker links and Mirrors`. No
Key, filename or code file changes. Other staged files stay staged. A changed Card is refused at
both later steps. The CLI makes no tracker calls; the Publisher alone writes it, after the Reply.
Publish searches every in-scope Suite key, including linked Features, without an issue-type filter.
The scout must return `marked_suites`, even when empty; an incomplete search refuses the Card.
One matching Suite offers an approved `recover_suite`, including for an empty Feature: no Review
or tracker write, only `mirror.suite` and `at`, preserving the other Mirror fields. Multiple hits,
wrong types, retirement, a different recorded Suite or disagreeing Scenario parents skip dependent
creates. Duplicate Suite keys are checked across all `.qa/`, even with `--feature`. Creates on the
same Card target the recovered Suite and depend on its recovery. The Publisher searches again
before every create; a race hit returns `rebuild: true` and needs a new Card.

Updates show each field's tracker and new values and require confirmation when the tracker differs
from the Mirror. Their writes name the case by `tracker_key` and exclude status, automation status,
issue type and marker; results are `{n,key}` or `{n,key,error}`. Successful updates refresh the
owned Mirrored values. Prose Mirrors are optional lists of lines (or `null`), alongside optional
`level` (a slug or a list) and `scenario` values; older Mirrors remain valid.

A published `level` follows the case's claim. A Layer-free case writes none: a create omits the
field and an update clears a level the tracker still holds. One binding writes its slug. A list
writes several values only when the payload's `level_destinations` names one multiple-valued
`level` field; otherwise the case is skipped with `level_list_unsupported`. Mirror comparison uses
the canonical claim form, so a one-item list, a reordered list and a slug of the same binding never
differ.

## Impact

`impact` is the deterministic half of `/qa-impact`. `plan` runs `scan` before any dispatch and
lays out the run: each Feature in scope with its candidate class, one judge unit per parseable
scenario file of each judged Feature that holds a selected case, the empty files and the files with
no selected case (listed, counted as judged, never dispatched) and the unparseable ones (excluded),
and the mechanical Scans. The judge reads only the cases a change selects (ADR-0043): the Stale
cases (the Scan's `history.stale_obligations` and the open mechanical Stale a case stores), the new
and edited cases (`cases_changed`), the cases in the run dir's `change.json` under `escalated`, and
every case that shares a governing Rule (one it covers or relies on) with a selected one. The
selection is every case of the Feature on a first assessment, a new Rule, a Rule listed under
`widened` for that Feature in `change.json`, or a Boundary change. `change.json` is Run data, the
JSON `{"v": 2, "widened": [{"feature", "rule", "by", "at"}], "forecast": [{"feature", "rule",
"widened", "statement", "by", "at"}], "escalated": [{"feature", "case", "by", "at"}]}` that a prior
command left in the `--dir` run dir: a file that is not JSON refuses the plan, and a key or entry
`plan` cannot read is a `change_data_unknown` note in `run_health`, never a refusal. `forecast` is the
engineer's confirmed answer for each Rule whose statement was edited since the Watermark, widened or
not, with the statement it was given against; `v` 2 marks the file that records it, and a file of `v`
1 (or none) holds `widened` Rules only, each still meaning what it meant. `plan --persist` is refused,
as `forecast_missing` with the `rules` (`feature/rule`) concerned and nothing written, no run dir
made, when a Feature it plans has a Rule whose statement changed between its Watermark and the target
and the run dir holds no `forecast` entry for that Rule at the statement it has at the target. That
does not apply where the selection is the whole Feature already (a first assessment, a new Rule, a
Boundary change), nor to an edit of only a Rule's elaboration, Waiver or Dependency, nor to a plan
that is not persisted, nor below schema 3, where `reconcile` and `quick-check` refuse and nothing could
record the forecast; a widened Rule of a file of the older shape is taken as confirmed.
`impact escalate --dir <run-dir> --case <key>` is the writer of `escalated`: `/qa-ask` never writes, so its
possible-Conflict route prints this command and the engineer runs it. It records `{feature, case, rules
(the case's covers), by: "ask", at}`, merged by Feature and case into the dir's `change.json` and written
whole, every other key kept; it makes the dir if absent and refuses (`unknown_case`, `needs_case`,
`run_dir`) writing nothing. An escalated case puts its Feature in the plan even when it is `unchanged`: the
unit's brief says `/qa-ask` sent the case. A case escalated in a Feature the run cannot judge is an
`escalated_not_judged` note. A Feature with
Boundaries also gets a Feature-level judge unit, which judges its Rules against them (ADR-0039):
every Rule changed since the Watermark, or every Rule when a Boundary changed or the Feature has
no Watermark yet. It writes `plan.json`,
each unit's brief (`<key>.brief.json` for `check-reply`, `<key>.brief.md` for the Delegate) and
`dispatch.spec.json` (the units, for `delegate`) to the run directory, a fresh OS temp dir unless
`--dir` names one, and never writes `.qa/`. The delegation layer leaves each unit's reply beside
them as `<key>.reply.md`. `report` checks every reply with `check-reply judge` and prints the four
sections, Scope, Judgements, Scans and Run health (with the Run's retries, failed units, breaker
trips, fallbacks and the exact re-run command), then the changeset, as data for the skill to word:
labels, glossary pieces, Markdown tables and a code plus one factual line for every reason
(lib/impact-json.mjs; Scan results carry codes, factual lines, locations and labels from
lib/finding-data.mjs for the skill to word). `persist`
does the same for a `--persist` plan after writing the findings. A Feature-level
Overreach is written on the Feature file, with the Rule as its subject. A Feature's Watermark is
due once its Feature-level unit is judged too, and it advances at `persist` only when the walk has
no case to settle; otherwise it waits for `checkpoint` (see below). `design walk` shows the
triage walk one case at a time, its findings numbered and the answers it offers (none chosen), and
stores the engineer's `--by` name once; `design triage` settles that case from JSON decisions in the
file `--input <path>` names
(`{"findings": [{"n": 1, "answer": "dismiss", "reason": "…", "ticket": "X"}], "review": "leave"}`,
`decisionsOf` in lib/impact-json.mjs). A finding's answer is `dismiss`, `keep`, `fix` or, for a Stale
only, `holds`: `holds` writes `holds: {by, at, commit}` on that Stale cause (refused while what it
rests on has uncommitted edits, `uncommitted_holds`), `keep` writes nothing, and `accept` may go
with `fix` once the fixed text is committed (`uncommitted_review` otherwise). A `fix` is judged against
the commit the finding was raised on, so a committed fix counts; a version of `.qa/` the level
migration cannot rewrite refuses the settle with `level_rewrite_failed` and its file. A Dismissal re-arms when any Rule
in the Stale's `causes` or `affects`, in the case's `covers` or `relies_on`, or named by the
evidence changes. The walk lists every case with an open mechanical Stale, stored by this run or an
earlier one. `design checkpoint` is checkpoint 2: refused with `walk_unfinished` while a case is unsettled and
with `persist_refused` while `.qa/` holds uncommitted knowledge; otherwise it advances each Watermark
the persisted run held to HEAD (the commit the Reviews pin), prunes the Stale closed with `holds`, and
prints `{ok, checkpoint: {commit, watermarks, pruned}, changeset, merge_rules, glossary}`. A Stale still
open keeps its own baseline and target. `design rule-fix <feature> --dir <run-dir> --input <path>` is a Rule fix on
the walk: the engineer has edited a Rule of `<feature>` in the working tree (uncommitted) and pipes
the confirmed forecast, as `deep-dive reconcile` reads it (lib/rule-fix.mjs, lib/settle-walk.mjs). It
runs that Rule-edit transition and prints its Boundary check (`boundary_check`), downstream walk
(`downstream`) and edits outside the forecast (`outside_band`), then reopens the closed mechanical
Stale causes resting on a fixed Rule: a `holds` or Dismissal is removed from each Stale whose `causes`
or `affects`, or whose case's `covers` or `relies_on`, names it, and the case is on the walk again
(`reopened: [{case, feature, was, rules}]`, `resume`). Unrelated settlements stay closed. It is refused,
writing nothing, with `no_rule_edit` while the Feature's Rules match HEAD and `no_feature` for an
unknown Feature. It records the fixed Rules' text in the Run, so `checkpoint` is refused with
`rules_edited_since_persist` (listing the Rules) when a Rule reaching a Feature of the run was
edited and committed after `persist` without it: run `impact plan --persist` again to store the Stale
that edit owes. Each prints only what the agent acts on: `plan` `{ok, dir,
units, train}`, `report` `{ok, report}`, `persist` `{ok, report, walk}`, `walk` `{ok, done, train,
progress, case, glossary}`, `triage` `{ok, settled, glossary}`, and every refusal `{ok: false,
refusals: [{code, line, ...}]}`. `walk`, `triage`, `checkpoint`, `rule-fix`, `page` and `page-reply` are
`design` actions on the settle engine (lib/settle-walk.mjs), over the run dir `impact plan` made.
`impact` no longer has them: each of those names is an `unknown_action` under it.

`design agree` accepts scenarios without `levels`; `design state` asks no level question.
The filler writes Layer-free cases by default. A binding is one project level slug or a non-empty
list of distinct project slugs and requires `binding_reason` in the reply. Visual layout and
payload contract claims bind to their layers; a denial binds to every level in `execute_levels`.
Case writing requires schema 5. Steps state the actor's action and outcome; a button, selector,
HTTP method or endpoint is named only when the covered Rule claims that detail.

Design fills atomic coverage per Rule and interaction or journey coverage across Rules, grouped by
manual pass. A filler can return `questions` beside its writable `cases`: each has `text`, implicated
`rules`, and `held_case` (`summary`, `covers`, optional `preconditions` and `steps`). The held proposal
has no invented Expected result and is not written as a Test Case. A question-only reply is
`awaiting_rules`; a mixed reply writes its settled cases. Questions and the brief's Rule claims stay
in the Run's written record.

`design report --dir <run-dir>` returns `sections`: the non-empty ones, in a fixed order from
`written` to `run_health`, each `{id, label, items}` or, for `written` and `declared_coverage`,
`{id, label, markdown}`, with an optional `next` naming the command that section hands off to.
Its `questions` section lists the held questions, `next` the deep-dive handoff, and the command
writes the Run's `design-questions.json`. `deep-dive resume --dir <run-dir>` reads this handoff as `design_questions`
and `open_questions`; deep-dive parks unanswered questions in the Feature's existing Open questions
section. `design resume --dir <run-dir>` returns `held_cases`: `waiting` while Rule claims are
unchanged or the question remains parked, otherwise `ready` with the proposal and a scoped `rerun`.
Ready means reconsider against the new Rules, never assume an answer. Use a fresh agreement and
Run, carrying the proposal in the agreement remarks; expand a populated scenario and fill an empty
one. No new Finding kind is introduced.

`check-reply design` also reads `check_gaps`: each `{case, needs}` names one of the reply's own
cases by its summary and what checking its Expected result needs of the test environment. A
malformed entry is `bad_check_gap`; one naming no case of the reply is `unknown_check_case`.
`design report` lists them in its `check_gaps` section, items `{scenario, label, key, case, needs}`,
`key` null when the Run wrote no such case, `next` `/qa-train design`. They are never proposed
Rules: the behaviour is already a Rule's, and only how to check it is Training's.

The report's `bindings` section lists each written bound case's `key`, `scenario`,
`file`, canonical `level` and `reason`. Reasons live only in the Run's `<scenario>.written.json`,
never on the case. Cases are written to the working tree as replies arrive. Its `case_warnings`
section lists each written case the scan's `partial_permission_binding` warns about: its `key`, `scenario`, `file`
and `missing_levels`, so binding review shows it before Review. Before a case is kept
by commit or Review, `design unbind --dir <run-dir> <case-key>` removes its `level` and records
`unbound: true` beside its original binding and reason in the Run. Repeating it is safe. It refuses
a case the Run did not write, a missing or ambiguous case, a committed or reviewed case, unreadable
repository history, or an edit that fails file checking; refusals change nothing.
Its `missing_levels` section lists `agreed_level_without_cases` only for levels explicitly named
in the agreement; omitting levels creates no such obligation.

`design` briefs and reports carry the project's labels (ADR-0045). `brief design` adds `labels`
`{tags, retiredTags, customFields}` and the brief text lists only the Tags that have a meaning and each
Custom field's description and active values. `check-reply design` reads a case's `tags` and each Custom
field under its own name apart from the claim: a Tag with no meaning, an unknown or retired Tag or value
and a wrong shape are dropped from the case (`cases[].tags`, `cases[].custom` hold the rest) and listed
in `dropped_labels` `[{case, field, value, code}]`, never a reason the reply is unusable. The codes are
`label_shape`, `label_unknown`, `label_retired` and `label_unmeant`. `design report` lists them in
its `dropped_labels` section, items `{scenario, scenario_label, key, label, field, value, code, line}`. The Tag and
Custom-field definitions join the agreement's `basis`, so changing one makes `design split` refuse a
recorded agreement with `stale_agreement`. `--regenerate` lends a replaced case's Tags and Custom-field
values to the regenerated case that covers the same Rules, and the filler's labels only add to them.
A label it cannot lend is reported, never dropped silently: the write result and `design report`
(its `lost_labels` section, items `{scenario, scenario_label, key, label, field, value, code, line}`,
`key` the replaced case) list it
with `label_unmatched` (no regenerated case covers the same Rules) or `label_retired` (the Tag or value
is retired, so it is not given to a new case).

`init card` and `init apply` carry the labels as four more settings: `role_meaning` (text), `tags` (a map
of Tag to its one-line meaning, which may be empty), `retired_tags` (a list) and `custom_fields` (type
`records`: a list of `{name, description, values, multiple, required}`, written as a block list). They are
asked like `stack.levels`, as `{"value": <suggestion>, "evidence": {"asked": true}}`; `{"default": true}`
is refused with `no_evidence`. A non-empty `roles` with no `role_meaning` makes the Card ask what the
Roles mean, and a first run refuses it with `role_meaning_missing`, naming the setting. On maintenance a
label setting is an item when the file holds it or the proposal names it. A Tag or Custom-field value is
retired (moved to `retired_tags` or the field's `retired`), never removed, renamed or reused: removing one
is refused with `label_removed`, naming it. An edit to a Tag's meaning, a Custom field's description or
`role_meaning` returns `confirm: true` with each change's `described` `[{kind, name, cases}]`, where `cases`
counts the cases that carry it, and writes only when the decisions list the change in `confirm`. A
Custom-field value that repeats a Coverage category key adds the note `label_repeats_category` (with
`overlaps`), never a refusal.

`impact entry [<feature> [<ref>...]] [--persist] [--review [<feature>]] [--target <ref>]` is the front door of
`/qa-impact` (lib/impact-entry.mjs); it writes nothing. A Feature key, with any references after it, prints `{ok, route: "quick",
feature, references, next_step: "impact quick"}`. Every old invocation is refused with exit 2, one refusal per flag
given, each naming its `replacement`: `--persist` is `persist_retired` (`/qa-design <feature>` settles),
`--review [<feature>]` is `review_retired` (`/qa-design <feature> --review`), `--target <ref>` is
`target_retired` (the judge reads HEAD; commit, then `/qa-design <feature>`) and a read-only call with no
Feature key is `read_only_retired` (`/qa-next`). A malformed or unknown key is `not_feature_key` or
`no_feature`. `impact plan`, `report` and `persist` stay the judge engine the quick path and
`/qa-design` call, with their own `--persist`, `--review` and `--target`.

`design state` reports the settle phase of its Feature: `open_findings` `{open, total, by_kind,
features: [{feature, total, by_kind, cases}]}`, the open-finding gate (every open Stale, Conflict,
Overreach, Divergence, Outcome gap and Feature-level finding the walk would offer; `open: false`
when there are none). With `--review` it adds `review` `{feature, cases: [{key, scenario, file,
why}]}`, the cases with no fresh Review (`unreviewed`) or a passed `review_by`, a fresh Review
included (`review_overdue`). A bare `/qa-design` settles an open gate before it offers the split or
`--expand`. It also reports the Scan's `uncited_cases` and `uncovered_rules` for the Feature (neither
is a Finding, so neither is on the walk): the skill offers a linking route for the first and handles
the second after Phase 1's agreement.

`impact quick` and `impact quick-check` are the quick path's own steps (lib/quick-path.mjs); the rest
of the quick path is the shared CLI above, called unchanged. `quick [--dir <run-dir>]` names the
change's run dir (made in the OS temp dir unless `--dir` names one, and reused when it exists, so a
dir an escalation named keeps its `change.json`) and prints `dir`, `design_dir` (`<dir>/design`, where
design's own agreement, plan and unit briefs go, since `impact plan` and `design plan` each keep a
`plan.json`), `threshold` `{limit, source}` and any `handoff` already there. One dir serves one change:
`deep-dive reconcile --dir`, `impact escalate --dir`, `impact plan --persist --dir` and the settle walk
(`design walk --dir`) all name it. `quick-check <feature> --dir <run-dir> --input <path>` reads `{forecast:
{changes, may_change, unaffected, widened?, by?}, references: [<URI>], open_questions?: [<text>]}`,
runs the Rule-edit transition (`deep-dive reconcile`'s own function, and prints its output) and counts
the threshold: `threshold` `{limit, source, rules, stale_cases, total, over}`, where `rules` is every
Rule added, edited or retired in the working tree against HEAD in any Feature (the edits the engineer
confirmed, a downstream one included) and `stale_cases` the distinct cases the Scan's
`history.stale_obligations` owes over the working tree, the downstream walk's cases among them. The
limit is 10 or a Practice of `train/impact.md` reading "Quick path threshold: <n>" (the last one wins,
`source` names it); the quick path stops when `total` is more than the limit. Below it, `changeset` `{paths, commit}` is Checkpoint 1's commit: the knowledge files differing from HEAD, for `commit --input <path>` (ADR-0062); over it, `{paths: [], commit: null}`. Then it writes
`<dir>/handoff.json`, `{v: 1, references, edits: [{feature, rule, band}], open_questions, written}`
(`band` is the forecast band of an edit in `<feature>`, null outside the forecast, and `downstream` in
another Feature; `written` the knowledge files differing from HEAD), prints its path as `handoff` and a
`next_step` of `/qa-deep-dive <feature> --dir <dir>`; at or under the limit it removes a handoff an
earlier call wrote and the `next_step` is checkpoint 1 followed by `impact plan --persist --dir`. It
refuses `run_dir` (no such dir) and `quick_input`.

`design propose --dir <run-dir> --input <path>` records design's proposals in the run dir's `proposals.json`:
`{v: 1, items: {<case key>: {outcome?, reason?, covers?, relies_on?}}}`. `outcome` (`keep`, `fix` or
`retire`) is for a case with an open Stale (`proposal_not_stale` otherwise); `covers` and `relies_on`
name live Rules (`proposal_link`). A refusal writes nothing, and a later entry replaces the case's
earlier one. `walk` prints the case's proposal as `case.proposal` beside `choices`, with the links the
case holds now (`current`) and `confirmed` once it holds the proposed ones; the Card page prints it
beside the case. A proposal answers nothing and writes nothing. `design link --dir <run-dir> --case
<key> --input <path>` writes the links the engineer confirmed, `{covers?, relies_on?}`: a list given replaces
the case's own, every Rule must be live (`link_rule`), the file passes `check-file`, and the path joins
the walk's changeset. Any case may be linked, an Uncited one included.

## Delegation

`delegate` is the shared delegation layer every delegating command uses; the skill-side half of it
is `plugin/scripts/delegation.md`, which each such skill follows. A command's plan step writes
`dispatch.spec.json` (`{cmd, root, feature, target, extras, units: [{id, feature, scenario, brief,
reply, contract}]}`) and hands its run directory over:

- `resolve` picks the Delegate, a model label (ADR-0020, ADR-0021): the `project.md` `tiers` entry
  of the Tier the command's agent is bound to (the one binding table is `plugin/scripts/lib/tiers.mjs`; a
  project cannot override it), with the
  Fallback (always `inherit`, which an unpicked Tier runs on) and `concurrency_cap` (4 when
  missing). The label is passed to the subagent unchanged; `scout brief ui|tracker` names its
  Tier's model the same way (`tier`, `label`, `model`).
- `start` resolves the Delegate once, before the first unit, and mints the 8-char Run id.
- `next` hands the units back to spawn as subagents synchronously, with the fixed prompt that points at
  the brief file (ADR-0011): 3 attempts per (unit, Delegate), kind-blind, each retry at the back of
  the queue after 15 s × attempt; a breaker that trips on `quota`, on 3 consecutive failed retries or
  at once on a refused spawn, and moves the remaining units to the Fallback with a fresh budget,
  stopping if the Fallback trips. It never sleeps in-process or creates `attempts/` / rewrites
  `dispatch.json` while waiting: when `dispatch` and `in_flight` are empty, `!done`, and queued
  units are in cooldown (`not_before > now`), it emits `wait_ms` and `next_ready_at` (ISO-8601 UTC
  timestamp) so `plugin/scripts/delegation.md` waits via standalone
  `node -e "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, <wait_ms> + 25)"` before
  re-calling `delegate next`.
- `record` settles one attempt from its saved reply. A failure is classified `quota` or `other`.

`QA_SKILLS_DISPATCH_SCALE` scales those times; only the tests set it.

## Execution

`execute plan` accepts Case, Scenario, Suite, Feature and Tracker keys alongside `tag:<name>`
and `level:<name>` tokens. Give at least one key or filter; filters alone start from all live
Test Cases, excluding retired Features, Test Scenarios and cases. Keys resolve first, then
filters match exact names: any-of within Tags or Test levels, AND across the two kinds.
For example, `execute plan tag:smoke tag:regression level:api` selects smoke or regression
cases at API level. An untagged case fails a Tag filter and remains eligible otherwise.
A retired Tag already on a case remains valid; a request for one refuses, as does an
undeclared Tag or Test level, with the valid values listed. Blank names, whitespace and
extra colons in filter values refuse. Repeated tokens are harmless.

`execute plan` expands a Test Case bound to several Test levels into one Execution per executable
level, in canonical binding order; each Execution keeps its own `level`, the case's full
`bound_levels`, its `selected_levels` and the bound `omitted_levels`, so narrowing a Run never loses
the binding. One Run may therefore hold several Executions of one case, each with its own result.

A Layer-free case expands into one Execution. Without a `level:` filter, if its bound Automations
resolve through scan's `index.automations[id].level` to exactly one level in `execute_levels`, it
runs there with that level's Automations. Passing Automations need no Tester; failed ones send that
level to a Tester. Otherwise (none, all unresolved, several levels, or a non-executable level), it
uses the plan's default: the one `execute_levels` entry whose mode is `browser`, or the level a
`train/execute.md` Practice names with `level`. Unresolved Automations retain the sole-selected-level
fallback. Only cases needing the default can refuse `no_default_level` when zero or several
browser-mode levels and no Practice resolve it. A `level:<name>` filter
runs every Layer-free case there, narrows a multi-level case to that level, and excludes a case
bound only elsewhere as a filter exclusion, reported apart from the eligibility skips.

The Integrity gate checks every file contributing live cases to the base scope before
filtering. If none of the requested Test levels is in `execute_levels`, the request refuses;
in mixed requests, matching cases at other levels stay `level` skips and the confirm names
the limitation once. Skips and Access notes are resolved after filtering, with login checks
only for matching, non-skipped cases.

The frozen `execute.json` and ingested Execution record carry optional
`selection: {scope: [...], tags: [...], levels: [...]}`: scope tokens as given, Tag and Test
level suffixes without their prefixes, and repeats kept. An empty scope list means implicit
all. An absent selection means the request was not recorded; ingest leaves it absent.
Historical selection values are checked for shape, never against current project membership.

`execute plan` is `/qa-execute`'s plan step (`plugin/scripts/lib/execute.mjs`): it refuses invalid
project setup, missing targets or execution levels, a repository without a resolving commit, and
an empty or unknown scope before it plans anything. It needs `playwright-cli` 0.1.22 or newer,
the floor the code enforces, and refuses a missing, older or unreadable version. Its confirm prints
the selection, each case's bound, selected, executed and omitted Test levels, every filter
exclusion, each case's Role to Access note mapping, blocked and skipped cases and the Run
directory, and the ingest command to run when the Run is over. On a host whose Tester guard cannot be verified
(one that fails host admission for any check but the floor; Claude Code below the floor is refused
`host_unverified` with an upgrade message instead) the plan carries `unguarded` and its confirm says so; `execute confirm` then refuses
`unguarded_unacknowledged` unless `--input <path>` carries the engineer's `{"acknowledge": "unguarded"}`,
and refuses `card_changed` when the plan or the host changed since the Card was shown (ADR-0057). `execute automation` runs each
selected case's Automations once through the project's `test_runner`, with `automation_retries` from
`train/execute.md`, one invocation per `<run>/automation/<n>/`, and writes their per-instance
attempts to `<run>/automation.json`; `execute next` starts a Tester Execution only for a case whose
aggregate Automation result is Failed or that has no Automation, running synchronously without
in-process sleeps: when `start` is empty, `in_flight` is `0`, `!done`, and no Access note is paused
(`paused` section absent), any remaining retry cooldown returns `wait_ms` and `next_ready_at`
alongside accumulated `sections` and optional `unguarded` so `/qa-execute` pauses via standalone
`node -e "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, <wait_ms> + 25)"` before
re-calling `execute next` (while paused Access notes suppress cooldown backoff so the engineer prompt
runs first), and `execute ingest` records the Automation results and any `execution_skipped` reason
in the same case block. `execute record`
settles one attempt, and its optional `--reason-file <path>` is a file holding the Tester's reply,
which it reads and removes; a record with no report shows that reply as its Why. `execute open` opens
the application
session for one Execution through the guarded `tester` wrapper, re-checking the host version first
(see the [Claude Code row](https://github.com/Kinasr/qa-skills/blob/v0.15.1/docs/support.md#claude-code));
`tester do` and `tester request` are that wrapper's two commands, scrubbed by
`plugin/scripts/lib/credentials.mjs`. `execute ingest` writes one Execution record at
`.qa/executions/<date>-<run-id>.md` — outside the knowledge layer, uncommitted, and never
rewritten — with one block per case and Test level; `level` and `bound_levels` keep that
identity, while `selected_levels`, `omitted_levels` and the record front's `excluded` show what
the selection did, and a selected case that never started is named in the front's `not_run` with
no block, so its previous result stays the latest; two blocks of one case at different levels
never collide. It removes the Run's kept
login states and prints the Run's Case outcomes: Failed if any level failed, else Blocked, else
Incomplete when a bound level did not run, else Passed. `execute follow-ups` reads the frozen plan and
that record and is the only writer of `<run>/follow-ups.json`: one fix item per Automation that
needs code fixed (a Failed Automation whose covered cases all passed their Execution, or a Flaky
one) and one bug item per case whose Case outcome failed, listing every failing level. It is
idempotent, takes the working tree's
dirty paths on the first call, and returns the one resume command: `/qa-codefix --run <dir>` while fix
work remains, otherwise `/qa-bug --run <dir>`. `execute summary` is read-only and untruncated: over
`follow-ups.json` it reports what the fixes did, where they are, the drafts awaiting publish and what
still needs resuming, and returns `{text, publish}` with `text` null for an empty work list.
`bug read` prints the CLI-built brief for one bug item; `bug write` mints a `bg_` Key, derives the
slug and every section from the pinned case and the scrubbed record, scrubs again, writes the one
file at `.qa/bugs/<bg_key>-<slug>.md`, lists any attachable screenshots by that Key in
`follow-ups.json`, and marks the item `done`. `bug read --case <key>` drafts without a Run: it selects
the case's latest failed Case outcome from `.qa/executions/` — one Run, Application target and
claim digest, across every level — and refuses a case that is not live or
whose latest outcome did not fail; `--cause` selects the standalone fix-hand-off route, which writes
no `record` and needs none. `bug write --case <key>` writes that draft without a follow-up work list.
`bug discard` deletes named drafts, refusing a published one. The storage and lifecycle of every
store a Run creates is in
[docs/support.md](https://github.com/Kinasr/qa-skills/blob/v0.15.1/docs/support.md#storage-and-lifecycle).


## Code generation

`codegen plan` is `/qa-codegen`'s plan step (`plugin/scripts/lib/codegen.mjs`): it refuses an
unresolved Convention `ref`, a missing `test_runner`, and the same scope and
Integrity refusals execute makes, then writes one item per eligible case to `<run>/codegen.json`.
`train check codegen --input <path>` accepts an `approaches` frontmatter list in `train/codegen.md`:
each entry has `approach` (`api`, `mocked-ui` or `full-ui`), a project `level`, and a
repository-relative `path` pattern. Only `/qa-train codegen` writes it. Patterns support `*`,
`?` and whole-segment `**`. Scan reports each Automation's path-derived `level` in
`index.automations`; no match or ambiguous levels produce `null`.

An Automation gap closes for a Layer-free case with any Automation; a bound case needs one at
every supported Test level. Codegen reports unsupported bindings separately in `unsupported`
(`[{key, levels}]`), including a `no_eligible_cases` refusal. `/qa-next` reports missing supported
levels as `automation_gap` with `missing_levels`, and unsupported bindings separately as
`automation_unsupported` with `unsupported_levels`, routed to `/qa-train codegen`. Unsupported
levels never count as covered. Declared approaches set automation support;
Training with no `approaches` field keeps its previous eligibility, at any schema, until declared.

`codegen start` snapshots the item's `module_paths` and writes its brief. `codegen verify` runs the
new test through the project's `test_runner` with retries 0, `codegen_repeats` times, and mints and
renders the Automation key at the first verify. `codegen done` checks the passing verify's snapshot
and the Expected-to-line mapping, then writes the case's `automates`; with `--pr` or `pr: always` it
also commits the test, its support files and the Scenario's `automates` together. `codegen regress`
rechecks the Automations a done item's touched files hold and rolls a regressing item back with its
Scenario file; `codegen fail` keeps the unverified work as a scrubbed `draft.patch`, restores the
item and records one closed reason. `pr-prepare` and `pr-record` are the shared PR plumbing; the skill runs
`codegen regress` before `pr-prepare` (ADR-0057). A dirty Scenario file downgrades the Run to the working tree, and an
ADR-0012 project runs there only. A verify writes only under the run dir, never an Execution record.

## Knowledge page

`show [<feature-key>] --root <qa-dir>` writes a read-only Knowledge page outside the repo.
`--root` is required. Missing roots, malformed keys and unknown Features fail before a snapshot
is written. Feature existence is determined by directories under `features/`, including a Feature
whose own file is unreadable. One scoped scan retains the full parsed index for cross-Feature
lookups. No second scan is performed.

The JSON returns `ok`, `knowledge_page: {path}` (or null), `migration`, and ordered `sections` on
success (`Schema compatibility` when non-current), and `{ok: false, knowledge_page: null,
migration, refusals: [{code, ...facts}], sections: []}` on exit-1 refusals. Usage errors return
`{mode, [migration,] ok: false, refusals: [{code, ...facts}]}`, exit 2. A pending migration renders
a banner and continues. Only `schema_newer` (`{version, supported, file: "project.md"}`) refuses
compatibility, exit 1. Snapshot safety refusals also exit 1, under `refusals` (such as
`snapshot_write`).

The file is `$TMPDIR/qa-skills/show-<root hash>[-<feature-key>].html`, replaced on each run;
its directory is private (0700), its file is private (0600), and symlinks are refused.
The `show` layout carries a snapshot stamp (generation time, HEAD or null, knowledge dirtiness,
root and refresh command), the Feature header and lazily built Rules with direct-covers counts.
The embedded model has keyed Feature/section outputs, label definitions and normalized Review
state. Text is inserted through `textContent`; JSON escapes HTML delimiters and U+2028/U+2029.
The skill prints the path and the OS open command; it never opens a browser. `show` has no Training.
