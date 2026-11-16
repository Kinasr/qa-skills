---
name: qa-next
description: Show what the knowledge layer is waiting on and where to start.
disable-model-invocation: true
---

# /qa-next

`/qa-next [<feature-key>] [--page]`

## Invariants

A Practice that contradicts an Invariant is void.

- **Migration preflight:** on every path where the command's JSON carries `global.migration`,
  read it first. If `pending`, warn using `migrations` in order; continue the command. The
  migration is then `start_here`: end both views on it.
- **Never writes the repo, `.qa/`, a run dir or the tracker.**
- **Never runs another command.** Run only the CLI calls below, displaying recommended routes.
- **Never fetches the tracker.** Mirrored values are stored copies, never current tracker facts.
- **An Uncited case is missing knowledge, never a Finding.** An `uncited_case` step has an empty `covers`; reliance never counts as coverage for an `uncovered_rule` step.
- **Renders only what the CLI supplies.** Preserve labels, locations, prerequisites, routes, ordering; add no Next steps.
- **Emojis are used only in `/qa-next` output, including its Next steps page.**
- **Read `.qa/train/next.md` before starting**, if present, and follow its Practices.
- **Training status is overview-only information, never Next steps.** Render one Training status
  line from `global.training`: each `commands` entry's `command`, ✅ and counts
  (`conventions`, `practices`) when `trained`, else ℹ️ untrained; `access_notes` separately.
  Format: `🎓 Training: design ✅ (4 Conventions, 2 Practices) · deep-dive ℹ️ untrained · Access notes: 2`.

## Read and run

From the repo root (JSON):

```
node <this skill's directory>/../../scripts/scan.mjs next [<feature-key>] [--root <qa-dir>] [--page]
```

Preserve Feature key and root; explain usage `error` and stop.

## Render

Use [shared wording rules](../references/wording-rules.md) and this legend.
For `next_steps_page` or an explicit request, follow [Next steps page](references/next-steps-page.md); otherwise render below.

Show `global` migration, schema, run health. Overview: each `features`
label, `counts`, `top_next_step` on one line; ✅ for `nothing_pending`.
In both views, show each Feature's `information` label and ℹ️ unreviewed count, including zero, and
each non-null `executions` as information, never as Next steps: each `results` row is a Case
outcome, with its legend emoji, `label`, `reason`, `date`, `target`, `file`/`line`, "out of date"
when `out_of_date`, then its `hint`; then ℹ️ `passed.count` Passed, and ◐ Incomplete means a bound
level did not run.
With a Feature key, show all `next_steps`, global ones included, with `labels`, Keys,
`file`/`line` and `locations`. Show each `prerequisites` string before its exact `route`: a command with `args`,
or a person's `text` action. Finish with 👉 `start_here`, or ✅ when null.
For Automation, show `labels.scenario` with its case Keys; separate ❔ `unknown` from
🤖 `automation_gap`.
For Parked questions, show `count` and citations; offer `optional_routes` to collect answers
via the tracker.
An open Overreach is an at-risk step: knowledge a Boundary or Waiver forbids.

📤 Review prerequisites precede `/qa-publish`, which fetches the tracker and decides writes.

## Legend

🛑 `blocking` — blocking · ⚠️ `at_risk` — at risk · ❓ `parked` — parked ·
📝 `missing_knowledge` — missing knowledge · 🔍 `judge_needed` — judge needed ·
📤 `publish_pending` — publish pending · 🔗 `binding` — binding ·
🤖 `automation_gap` — Automation gap · ❔ `unknown` — unknown ·
❌ `failed` — Failed · ⛔ `blocked` — Blocked · ◐ `incomplete` — Incomplete ·
ℹ️ `information` — information · ✅ `nothing_pending` — nothing pending · 👉 `start_here` — start here.
