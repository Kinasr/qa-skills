---
name: qa-next
description: Show what the knowledge layer is waiting on and where to start.
disable-model-invocation: true
---

# /qa-next

`/qa-next [<feature-key>] [--page]`

## Invariants

A Practice that contradicts an Invariant is void.

- **Migration preflight:** on every path where the command's JSON carries `migration`,
  read it first. If `pending`, warn using `migrations` in order; continue the command.
- **Report CLI sections only; never writes the repo, `.qa/`, a run dir or the tracker.**
- **Runs another command only on the engineer's yes.** Run only the CLI calls below, displaying recommended routes.
- **Read stored copies only; never fetches the tracker.** Mirrored values are never current tracker facts.

## Read and run

Read `.qa/train/next.md` before starting, if present, and follow its Practices.

From the repo root (JSON):

```
node <this skill's directory>/../../scripts/scan.mjs next [<feature-key>] [--root <qa-dir>] [--page]
```

Preserve Feature key and root; on `ok: false`, word `refusals` from `code` and facts and stop.

## Render

Use [shared wording rules](../references/wording-rules.md) and this legend.
For `next_steps_page` or an explicit request, follow [Next steps page](references/next-steps-page.md); otherwise word every section in order below.
Each view renders only what the CLI supplies (preserve labels, locations, prerequisites, routes, ordering; add no Next steps); emojis are used only in `/qa-next` output, including its Next steps page:

- **Schema compatibility** and **Run health**: show when present.
- **Training status is overview-only information, never Next steps.** Render one Training status
  line: each command, ✅ and counts (Conventions, Practices) when trained, else ℹ️ untrained; Access notes separately.
  Format: `🎓 Training: design ✅ (4 Conventions, 2 Practices) · deep-dive ℹ️ untrained · Access notes: 2`.
- **Features:** in overview, one line per Feature (label, counts, top step or ✅ when nothing pending).
  In both views, show each Feature's ℹ️ unreviewed count (including zero) and execution results as
  information, never as Next steps: each Case outcome row with legend emoji, label, reason, date,
  target, location, "out of date" when out of date, then hint; then ℹ️ Passed count (◐ Incomplete means a bound level did not run).
- **Next steps:** with a Feature key, show all Next steps (global included) with labels, Keys,
  locations, and prerequisites before each exact route (command or person's action).
  An Uncited case is missing knowledge, never a Finding; reliance never counts as coverage for an uncovered Rule.
  For Automation, show the Scenario label with case Keys, separating ❔ `unknown` from 🤖 `automation_gap`.
  For Parked questions, show count, citations, and optional `/qa-publish` route.
  An open Overreach is at risk: knowledge a Boundary or Waiver forbids.
- **Start here:** finish both views with 👉 Start here (a command: offer it once; run it on yes), or ✅ when absent.
  When a migration is pending, the migration is then Start here: end both views on it.

📤 Review prerequisites precede `/qa-publish`, which fetches the tracker and decides writes.

## Legend

🛑 `blocking` — blocking · ⚠️ `at_risk` — at risk · ❓ `parked` — parked ·
📝 `missing_knowledge` — missing knowledge · 🔍 `judge_needed` — judge needed ·
📤 `publish_pending` — publish pending · 🔗 `binding` — binding ·
🤖 `automation_gap` — Automation gap · ❔ `unknown` — unknown ·
❌ `failed` — Failed · ⛔ `blocked` — Blocked · ◐ `incomplete` — Incomplete ·
ℹ️ `information` — information · ✅ `nothing_pending` — nothing pending · 👉 `start_here` — start here.
