# Binding review after filling

Show each `bindings` entry in `design report`: its case `key`, `scenario`, `file`, `level` and
`reason`, including every level of a list. Show each `case_warnings` entry before Review: its case
covers a Permissions Rule but binds no level, or not every executable one, and `missing_levels`
names each level it omits. The reason is held in the Run's written record, never on the case. Cases
are already written into the working tree; while uncommitted and unreviewed, they have not yet been
kept.

Check that each binding follows its covered Rule: visual layout binds to its UI layer, a payload
contract to its API layer, and a denial to every level in `execute_levels`. A Layer-free case
covering a Permissions Rule leaves its denial to execution: show the warning and ask the engineer
whether to bind it to every level. Other cases stay Layer-free. One behaviour gets one case even
when its binding names several levels. Apply the
[actor-side wording rule](../../references/wording-rules.md) to its steps and Expected result.

Offer the engineer each binding for review before commit or Review. On their request, run
`design unbind --dir <dir> <case-key>` for that case. It removes the written case's `level`, refuses
a case this Run did not write or one already committed or reviewed, and records `unbound: true`
with the original binding and reason in the Run. Run `design report` again and show each unbinding.
There is no keep command: the engineer's later commit or Review keeps the case.

Word `missing_levels` only when the agreement explicitly named levels: each entry means an agreed
level got no cases. An agreement without levels adds no layer obligation.
