# Coverage categories

Every Feature is walked against the same kinds of behaviour. The ten below are the floor: they
always apply, in this order, and a team may add categories after them but never remove, rename or
reorder one. A team's additions live in `train/categories.md`; the CLI resolves the floor and those
extensions into one effective list. The list is a checklist, never a way to store or split work.

| # | Key | Category | Meaning |
|---|---|---|---|
| 1 | `happy-path` | Happy path | The main flow produces its required outcome for a permitted actor with valid input. |
| 2 | `variations` | Valid variations | Other valid inputs, paths and modes, including valid refusal or no-change outcomes. |
| 3 | `results` | Results and retrieval | Which information is returned or presented, and how selection, ordering, calculation and transformation decide it. |
| 4 | `permissions` | Permissions | Who may act on or see which data, under which conditions: roles, ownership, disclosure, signed-out users. |
| 5 | `input-validation` | Input validation | Missing, malformed or disallowed content is rejected, with what the user or caller is told. Channel-agnostic. |
| 6 | `limits` | Edges and limits | Values at and past their edges: empty, zero, min, max, length, size, quota, pagination ends, time thresholds, precision, rounding. |
| 7 | `state` | State and lifecycle | Allowed and refused transitions, repeats (duplicates, idempotence), undo, temporary state, expiry, cancellation, what persists. |
| 8 | `failures` | Failures and recovery | A dependency or step fails or times out: what the user sees, partial completion, rollback, the consistency left behind, retry. |
| 9 | `concurrency` | Concurrency | Overlapping actions by the same or different actors, background work, stale data. |
| 10 | `side-effects` | Side effects | Other required observable effects: notifications, audit records, integrations, other Features (a Dependency still needs its own Rule). |

There is no API-contract category, and validation is never split by channel.

An extension is one `### <key>: <name>` entry in `train/categories.md` whose `yaml` block carries a
one-line `meaning` and an `after:` anchor naming a floor key or an earlier extension. The resolver
inserts it directly after that anchor; extensions sharing an anchor keep their file order. A removed
key goes to the file's `retired:` list and is never reused. Meanings are immutable.
