---
name: qa-show
description: Browse a Feature's recorded Rules and Test Cases on a Knowledge page.
disable-model-invocation: true
---

# /qa-show

`/qa-show [<feature-key>]`

## Invariants

A Practice that contradicts an Invariant is void.

- **Migration preflight:** on every path where the command's JSON carries `migration`, read it
  first. If `pending`, warn using `migrations` in order; continue the command.
- **The CLI renders the Knowledge page.** Never read or summarize Feature files to build it.
- **The CLI writes only the snapshot outside the repo;** never writes the repo, `.qa/`, a run dir
  or the tracker.
- **Report the open command for the engineer to run;** never opens a browser.
- **No Training for `show`:** skip Training and `/qa-train`.

## Run

From the repo root (`<qa-dir>` defaults to `.qa`), run only the CLI calls below; preserve the
Feature key and root:

```
node <this skill's directory>/../../scripts/scan.mjs show [<feature-key>] --root <qa-dir>
```

Read the JSON. On `ok: false`, word `refusals` in one line from `code` and facts and stop. Word every
section in order; with no emojis, report only the page path and the
shell-quoted OS open command on success (`knowledge_page.path`):

- macOS: `open '<path>'`
- Linux: `xdg-open '<path>'`
- Windows PowerShell: `Invoke-Item -LiteralPath '<path>'`

For POSIX single quotes inside the path, use `'\''`; for PowerShell, double them.
