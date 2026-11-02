# Next steps page

## Offer or request

When `next_steps_page.offer` is present, resolve the preference in this order: the engineer's
conversation, then their own setup (`CLAUDE.md` or memory), then a Practice in `train/next.md`.
With no preference, offer. "Always" means offer whenever eligible; "never" skips only the offer
and renders the usual chat view. An explicit request always gets a page, even below the threshold
or with a "never" preference.

An eligible run without "never" shows the chat summary below plus a one-line offer. Wait for the
engineer: a yes runs the page command; a no renders the usual chat view in
[the skill's Render section](../SKILL.md#render).

On acceptance or an explicit request, run the CLI `next [<feature-key>] --page [--root <qa-dir>]`,
preserving the Feature key and root. The CLI writes the page outside the repo and returns
`next_steps_page.path`; render the summary from its JSON. The page is a snapshot; refreshing it
means running the command again.

Treat a route the engineer pastes from the page as a fresh request, never as an answer to an earlier
turn (ADR-0032).

## Chat summary

With a page, and on the offer turn, keep global health, each Feature's Information and `executions`, and 👉 `start_here`
in chat using [Render](../SKILL.md#render). Add only:

- The 🎓 Training line from `global.training`, overview only, using the skill's Training format.
- The pending count: count entries in `next_steps` with `kind !== "unknown"`; report
  ❔ `unknown` entries separately.

When a page path is returned, finish with the exact OS open command, with `next_steps_page.path`
shell-quoted: `open '<path>'` on macOS, `xdg-open '<path>'` on Linux,
`Invoke-Item -LiteralPath '<path>'` in PowerShell. Use POSIX single-quote escaping on macOS/Linux
and double embedded single quotes in PowerShell. Never open it yourself. On the offer turn,
there is no page path yet: finish with the offer instead.

## Classification

An unclassified case is missing required Custom fields: a non-blocking Next step, never an
Integrity error. Show the CLI's manual route to assign values using the project's field descriptions.
Changing Tags or Custom fields leaves the claim and its Review unchanged; a classification edit
cannot fix a Stale or any other claim finding.
