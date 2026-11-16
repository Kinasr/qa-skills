# Reading an OpenAPI contract

Read OpenAPI 3.0 and 3.1, in YAML or JSON, as an ordinary `file:`, `code:` or `url:`
Reference. For Swagger 2.0, halt before building the inventory and ask the engineer to
"convert to OpenAPI 3 and pass the result". Do not record the Swagger document in `sources`;
remove it if intake already added it.

## Inventory and scope

Every `paths` operation and every `webhooks` entry is a source item. Group operations into
verb-phrase Functionalities, keeping each operation and webhook traceable to a Functionality,
a plumbing group or a set-aside reason. Callbacks are read as part of their operation.

For large contracts, propose `--focus` and Deferred lines whose place is `METHOD /path`.
Apply [the Deferred reference](deferred.md) for focus, confirmation, lifecycle and Coverage.

## Walked schemas

Follow `$ref`, `allOf`, `oneOf` and `anyOf` to leaf constraints for walked Functionalities only.
Leave unwalked schemas unexpanded. A `$ref` into another file is proposed as its own input in the
plan; fetch it only after approval through ordinary intake.

Group pure wire or database plumbing, or mark it n/a with a reason: envelope fields, pagination
cursors, internal IDs and transport headers can belong here. Use the ordinary Coverage categories.

## Claims and confirmation

A Draft Rule is a bulk-table proposal. Propose each leaf constraint as a Draft Rule in the bulk
table, except plumbing accounted for above. Cite `<reference uri>, <METHOD /path → JSON pointer>`.
The pointer names the leaf where it is defined, including behind a `$ref`; for a `$ref` into
another file, use that leaf's own file URI as `<reference uri>` and resolve the JSON pointer
against that file. The operation names how it is reached. `sources` keeps the bare URI.

Only the engineer's confirmation makes a Rule, under [the walk's bulk acceptance](../SKILL.md#6-walk).
Put disagreements between the contract and an Observation or code file to the engineer as questions.

Confirmed bounds (min/max, exclusive limits, lengths, item counts) and `enum` sets stay as literals
in the Rule's statement. State confirmed `pattern` and `required` constraints at intent level in the
statement, describing what the actor may or must supply.

"Boundary test cases" means atomic cases over a limits Rule's stated edges; a Boundary records
an ownership edge.
