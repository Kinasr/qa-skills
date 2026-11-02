# Operating the application

`/qa-train execute` writes `.qa/train/execute.md`: how to operate the application for a Tester.
It holds Practices (`prc_`), data recipes (`rcp_`), API actions (`act_`), upload fixtures (`upl_`)
and an optional frontmatter `setup_role`. Keys use kebab-case slugs, as the parent skill's keys do.

## Gather evidence

Run `train evidence execute` using the parent skill's CLI prefix. Read its `train.entries` in full,
`roles`, `levels`, `execute_levels`, live `features`, `targets` and bare `fixtures` names.
`execution_results` holds the latest Execution results that are Blocked `precondition`/`step` or
carry interpretations (`/qa-next`'s reader): mine their `why`, `preconditions` and
`interpretations` alongside the conversation. A withheld entry is
a coherence finding to rewrite without the credential.

Mine corrections, setup failures and answers the engineer supplied in this conversation. Quote
the evidence behind each proposal. When neither the conversation nor the evidence teaches anything,
ask the engineer to dictate the setup paths, fixtures and operations the Tester needs. You are done
when every correction or useful result has a proposal or is named as a one-off, and the engineer
has nothing more to add.

Read `/qa-execute`'s current skill when available, holding its Invariants for the coherence pass.
Classify proposals as new, refines or contradicts against every entry of the same kind. For a
refinement, keep the key and `added`, appending sources. Every kind requires `sources` and `added`,
with `human:<name>` once settled. Prose and example fences after the first `yaml` block are optional.

## Entry shapes

Practices use the parent's `prc_` shape, with optional `features: [<feature-key>]`. They may name
existing fixtures and setup paths, and mark a named fixture disposable. A Practice that contradicts
the Tester's rules is void; the rules win. The orchestrating skill reads every Practice. The Tester
receives unscoped Practices plus entries of any of the four kinds whose `features` includes its
Feature. Give recipes, actions and upload fixtures Feature scopes so the right Tester receives them.

A data recipe records a creation path, named existing fixtures, or both:

```yaml
sources: [human:librarian]
added: 2026-10-20
create: Open Loans, choose New, fill the required fields and save
required: {title: "Any non-empty title"}
tag_field: title
fixtures: [Reference catalogue]
disposable: true
features: [loans]
```

`rcp_<entity>` requires at least one of `create` (a non-empty string) and `fixtures` (a non-empty
list). `required` is an optional one-level map of field names to valid values or patterns;
`tag_field` names a free-text field for the Run tag. `disposable`, when present, is `true`.
The example fields are independent options: include only what the engineer taught.

An API action maps step wording to a request:

```yaml
sources: [human:librarian]
added: 2026-10-20
phrase: Create a loan
method: POST
path: /api/loans/{id}
query: [notify]
body: [title]
features: [loans]
```

`act_<slug>` requires `phrase`, an HTTP `method` and a `path` relative to the target origin;
`{param}` placeholders are allowed. Optional `query` and `body` list field names, never credentials.

An upload fixture uses `upl_<name>` and exactly one of these modes:

- Generated: `format: png|jpg|pdf|csv|txt|json`, optionally `bytes` (an integer from 1 to 10485760)
  or `content` (a string). It is named `<name>.<format>`.
- Committed: `file: <bare-name>` naming an existing file under `.qa/fixtures/`.

Both modes require `sources` and `added`, and may carry `features`. A generated upload has no `file`;
a committed upload has no `format`, `bytes` or `content`. The Tester sees fixture names, headings,
format and prose, never a `.qa/fixtures/` path or raw `content`.

Frontmatter may add `setup_role: <Role>` from `project.roles`. Explain its helper purpose at the
gate. A missing covering Access note for that Role on the selected target causes a confirm warning
and omits the helper session; a case that needs it then Blocks `precondition`. Teach login access
through a separate `/qa-train access` run.

Frontmatter may also add `automation_retries`, an integer from 0 to 5 that defaults to 2. It is the
number of extra attempts a failing Automation gets in `/qa-execute`; a stack's own retry config can
add attempts that still count. It is a fact about this project's tolerance, not a Practice.
`train evidence execute` reports the effective value, and `automation_results` alongside
`execution_results` so an Automation pass never reads as a manual pass.

## Gate and coherence

Test every proposal, including existing entries on the coherence pass, against both refusals:

1. **An outcome claim** such as "returns 403" or "Sales can't close" states required behaviour.
   Refuse it and hand it off as a proposed Rule to `/qa-deep-dive <feature-key>`. Valid input values
   and instructions for operating the app are allowed. `outcome_claims` warnings in `train check`
   are non-blocking hints: settle every hit at the gate rather than treating a successful check as
   permission to write a Rule into training.
2. **A credential**: refuse a literal under a credential-named key or a credential anywhere in the
   heading, block, prose or examples. Never repeat it. Name only where the engineer must keep it
   outside committed training. A required input named for a credential needs an Access note or a
   safe operating path, not a literal recipe value.

Re-check every existing Practice against the current Invariants and the Tester's establish/check,
fresh-data and destructive-action limits. Mutable data is created fresh and transitioned to its
needed state; environment preconditions are checked only. Existing mutable data is used only when
training names it as a fixture. A recipe rejected during setup Blocks `precondition`, never Fails.
Access note accounts and named shared fixtures are protected from destructive actions. Flag
contradictory operating paths, dead Feature scopes, missing fixture files and an unknown setup Role
as coherence findings, then use the parent's three-way gate.

Draft the whole agreed file and run `train check execute --stdin`. Fix every structural or relational
error, settle every outcome warning, and write only when the parent's gate and check both pass.
The close hands refused outcome claims to `/qa-deep-dive` as the parent skill specifies.
