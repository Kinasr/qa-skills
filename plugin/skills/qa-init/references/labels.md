# Test levels, Tags, Roles and Custom fields

A Test Case carries a **Test level** (part of its claim), **Roles** (part of its claim) and labels,
**Tags** and **Custom fields**, which are never part of its claim. The proposal always covers four
lists. Read the repository and the tracker first; propose a suggestion only when they show nothing.

A suggestion is a real Card question with a suggested answer:
`{"value": <suggestion>, "evidence": {"asked": true}}`. Never `{"default": true}`: that makes the
list unasked and undroppable.

| List | Fields | Detected from | Suggest when nothing is shown |
|---|---|---|---|
| Test levels | `stack.levels` | the first token of test names, guidance files, tracker | `["api", "ui"]` |
| Tags | `tags` | tags, markers or categories the test framework or tracker already uses | `e2e`, `smoke`, `regression`, each with a written one-line meaning |
| Roles | `roles`, `role_meaning` | the tracker's Role field | nothing: ask "does this project have user roles?"; with Roles, also ask `role_meaning`, one line on what the list means |
| Custom fields | `custom_fields` | the tracker's own fields for cases | nothing: ask whether the team classifies cases by anything else (a team category, priority, component) |

- **Tags** are a map of Tag to one-line meaning: `{"smoke": "A critical path a release cannot ship
  without"}`. A meaning may be empty, but the `/qa-design` Delegate assigns only Tags that have one,
  so write one. The engineer may empty the list.
- **A Custom field** is `{name, description, values, multiple, required}`. The `name` starts with a
  letter and is no built-in key (`level`, `roles`, `tags`, `summary`, `steps`, ...); the
  `description` is required and one line; `values` are distinct and non-empty; `multiple` and
  `required` default to false. Roles stay built in: never declare one as a Custom field.
- **Publish destination:** among the optional publish fields, ask for each Custom field's optional
  `tracker_field`: the exact tracker field name. Leaving it unset leaves that Custom field unpublished.
  Its tracker options must use the value names verbatim; `multiple` determines cardinality.
- **A Custom-field value that repeats a Coverage category key** (`happy-path`, `limits`, ...) is a
  note on the Card, never a refusal. A team category is never a Coverage category: say so, and let
  the engineer keep or change the value.

## Maintenance

Propose the label fields to change (`tags`, `retired_tags`, `role_meaning`, `custom_fields`); one the
file holds is already an item. Each edit is the whole new value.

- **Add** a Tag or a Custom-field value by listing it. **Retire** one by taking it out of `tags` or
  `values` and putting it in `retired_tags` or the field's `retired`, in the same decisions.
  Existing cases keep a retired value, and new ones do not take it.
- **Never remove, rename or reuse** one: the Card refuses it, naming the Tag or value, and nothing
  is written. A retired value stays retired.
- **A Tag a migration created has no meaning.** `migrate-keys --levels` names such Tags in
  `tags_without_meaning`. Offer to give each a meaning here; until then the `/qa-design` Delegate
  never assigns it.
- **A description edit** (a Tag's meaning, a Custom field's description, `role_meaning`) changes what
  the label means. The Card returns `confirm: true` with each change's `described` entries: the
  `kind`, the `name` and `cases`, the number of cases that carry it. Show the counts and write only
  on the engineer's explicit yes.
