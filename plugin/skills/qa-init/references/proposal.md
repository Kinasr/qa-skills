# Building the /qa-init proposal

The proposal is the JSON you pipe to `init card --stdin`: every value with the evidence it came
from. Read the repository with shell counts (`find`, `grep`) and its guidance files (`AGENTS.md`,
`CLAUDE.md`, `README*`, `CONTRIBUTING*`, `docs/`).

## Evidence

Every value carries evidence: `{file, count, sample}` (where it came from, how many hits, one
verbatim hit), `{tracker, count, sample}` for a value read from the tracker ("Jira field Role"), or
`{"asked": true}` for the engineer's answer. `stack.levels` may add its `histogram`
(`{"ui": 524, "api": 308}`) and `docs: {file, quote}`.

| Field | Evidence |
|---|---|
| `stack.language`, `stack.framework` | the chosen stack's build manifest and test-file extensions |
| `module_paths` | the test roots and support directories beside the tests of the **one** chosen stack |
| `stack.root` | the chosen stack's repo-relative root; widen the chosen stack root to contain every proposed test and support directory |
| `stack.levels` | the first token of test function names, as a histogram, beside what the guidance files say; asked when there is no signal |
| `targets` | name → exact http/https origin from application configuration or guidance, with file, count and sample; ask when unknown |
| `execute_levels` | level → `browser` or `api`, using only keys in `stack.levels`, from the chosen stack's tests or guidance; ask when unclear |
| `tracker.provider` | asked, or confirmed from a tracker connection you have |
| `tracker.project`, `tracker.key_pattern` | the value shape of the tracker-key annotation's values |
| `annotation_map.tracker_key_fn`, `.tracker_key_class` | annotations whose values match `key_pattern`, on functions and on classes |
| `annotation_map.automation_key` | an existing annotation with `aut_` values, else asked, proposing `Automation` |
| `roles` | the **tracker's Role field** (its allowed values), else asked; may be empty |
| `role_meaning`, `tags`, `custom_fields` | see [the labels reference](labels.md) |

- **Roles come from the tracker, never from test code** (`@Test.User` is who a test runs as).
- **No tracker.** Leave out the `tracker.*` fields.
- **Story-only tracker.** Propose `tracker.provider`, `tracker.project` and `tracker.key_pattern`
  together; `issue_types` is optional and belongs to publishing below.
- `concurrency_cap` has a default and is not asked.

Always propose both execution maps. Target names are slugs; origins have no path, trailing slash,
query, fragment or user info. Never invent an origin. For an unknown origin, include
`"targets": {"value": null, "evidence": {"asked": true}}` so the Card asks for the map.
Use the same unanswered shape for `execute_levels` when its modes are unclear. A map with
`{"asked": true}` needs a `value` answer on the Card, or an explicit drop; a dropped map is omitted.
Both maps are checked by `check-file` and written only on acceptance. On maintenance, propose only
what was re-read; an unchosen detection leaves the existing map intact.

### Automation runner and code host

Always propose `test_runner` and `code_host` as optional, askable maps, and `stack.root` from the
chosen stack. Include support directories beside the tests in `module_paths`; widen the chosen
stack root to contain them so every module path remains under that root. The durable identity is
`stack.root`, defaulting to `.` in older projects.

For `test_runner` tool selection, ask only when the runner tool cannot be determined from the
Playwright config, Gradle/Maven build files, wrappers or package scripts. Name that evidence:
Playwright Test uses `playwright`; Kotlin/JUnit uses `gradle` or `maven` according to its build.
Propose a parameter map, never a shell command:

- `tool`: the matching built-in runner.
- `dir`: its repo-relative working directory, default `.`; parent traversal and symlink escapes
  are refused.
- Optional `launcher`: literal argv words, default `npx playwright test`, `./gradlew` else `gradle`,
  or `./mvnw` else `mvn`. Optional `task`: Gradle only, default `test`.
- Optional `args`: literal extra argv words; selection, output, reporter and retry flags belong
  to the CLI and are refused here.
- Required `target_env`: names read by the tests for their base URL, from configuration or guidance.
  Set `target_env: []` only when evidence or the engineer says the tests choose their own base URL.
  Ask when those names are unknown; never store credentials or reserved process-control names.

Read `origin` with `git remote get-url origin`. Infer `code_host: {tool: gh | glab}` from its host:
GitHub uses `gh`; GitLab uses `glab`. Ask for unknown hosts, including an unidentified self-hosted
service. Login stays with the CLI. Unknown maps use `{"value": null, "evidence": {"asked": true}}`;
the Card needs a map answer or explicit drop. On maintenance, an unchosen detection keeps the
current values.

### Optional publish fields

These fields have no defaults; leave them out when publishing is not wanted.
On a tracker without test-management issue types (plain Jira), the engineer creates three custom
issue types (Suite, Scenario, Case) before the publish fields can name them. The framework adds
no type mapping: use the created names directly.

| Field | Evidence |
|---|---|
| `tracker.issue_types` | optional; read from the tracker when publishing is wanted, else asked |
| `tracker.suite_type`, `tracker.scenario_type`, `tracker.case_type` | issue types for publish (Suite, Scenario, Case), asked |
| `tracker.link_type` | link type from a published case to its story, asked |
| `tracker.initial_status` | status set when a case is created, asked |
| `tracker.marker_label` | label every published Suite, Scenario and Case carries, asked |
| `tracker.marker_field` | tracker field holding a published item's permanent Key, asked |
| `tracker.bug_type`, `tracker.bug_link_type`, `tracker.bug_link_direction` | ask for the Bug issue type, the tracker's Issue Link Type name and the link's direction (`outward` or `inward`) together, when bug publishing is wanted |
| `bug_fields` | ask for optional create defaults as a block list of `{field: <tracker field id or name>, value: <scalar or list>}` maps |
| `tracker.tag_field` | optional multi-value tracker field or literal `labels`, asked; leaving it unset leaves Tags unpublished |

- **Bug publishing.** The bug group has no defaults: all three fields are required together. Omit
  the group and `bug_fields` when bug publishing is off. The Bug issue type differs from the Suite,
  Scenario and Case types. Bug fields cannot repeat or use the marker field, labels, summary,
  description, environment, issuetype, project or status. Bugs reuse `marker_label` and
  `marker_field`, with the bg Key as the mark.
- **Atomic publish marks.** The Suite issue type needs the marker field too; all three issue types
  must support setting the marker field and label in the create call itself.

## Tiers

The labels the engineer picked in section 2, one field per Tier: `tiers.deep`, `tiers.standard` and
`tiers.light`. Each is
`{"value": "<label>", "evidence": {"picked": true}}`: a pick is an answer, so the card asks nothing
more. Leave a skipped Tier out: it then runs on `inherit`. A label other than
`inherit` goes on only once its smoke test passed, in the run dir passed to `init card`.

## Reaching the tracker

`roles`, and `tracker.issue_types` when publishing is wanted, are read from the tracker the way
`access` says (from `init state`):

- **`via`** is where the credential lives. `mcp:name`: read with that connector's tools. `cli:name`:
  with that CLI. `env:NAME`: write `$NAME` in the command, so the value never enters the
  conversation.
- **`host`** and **`identifiers`** (a user, tenant or org) are what to read from and as. **`quirks`**
  are the engineer's remarks about this tracker. Follow them.
- **No usable note.** `access` is `null`, or `withheld: true` (the note holds what looks like a
  credential, so nothing else is shown), or the read fails: ask how the tracker is reached (its
  host, and the connector, CLI or variable that carries its credential), never for the credential
  itself, and read it that way. With no way to read it, ask for the values themselves and mark them
  `{"asked": true}`.

## Several test stacks

List each as `stacks: [{root, language, framework, count, sample, last_commit, guidance?}]`.
Pre-select (`chosen_stack`) the one the guidance files name as primary, quoting each such line
verbatim as `guidance: [{file, line, quote}]`; a legacy stack is the one they call legacy, even
when it uses the same annotations. With no guidance naming one, the engineer picks:
`chosen_by: "human"`.

## Who mints Automation keys

Settled in the interview, mark each answer `{"asked": true}`, and put only the chosen option's fields
on the proposal:

1. the framework mints `aut_` keys (nothing set; the default);
2. the project's own tool mints them: `automation_key_pattern`, the regex every value matches
   (ADR-0012), proposed when the annotation's existing values are not `aut_` keys;
3. the framework mints them in the project's shape (ADR-0013): `automation_key_mint`
   (`{prefix_length: [3, 6], separator: "-", length: 4, case: upper}` for keys like `LOAN-6QST`)
   with `annotation_map.automation_key_prefix`, the class annotation carrying the Key prefix.

## The whole proposal

```json
{"fields": {"stack.language": {"value": "kotlin", "evidence": {"file": "app/pom.xml", "count": 149, "sample": "ImportTest.kt"}},
            "tracker.provider": {"value": "jira", "evidence": {"asked": true}},
            "roles": {"value": ["Admin"], "evidence": {"tracker": "Jira field Role", "count": 14, "sample": "Admin"}}},
 "stacks": [{"root": "app", "language": "kotlin", "framework": "playwright-junit5", "count": 149, "sample": "...", "guidance": [{"file": "CLAUDE.md", "line": 12, "quote": "..."}]}],
 "chosen_stack": "app"}
```

On a re-run, `fields` holds only what you re-read: a field left out keeps its value.
