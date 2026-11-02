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
- **Never writes the repo, `.qa/`, a run dir or the tracker.** The CLI writes only the snapshot outside the repo.
- **Never opens a browser.** Report the open command for the engineer to run.
- **No Training for `show`.** Run only the CLI calls below; preserve the Feature key and root.
- **No emojis.** Report only the page path and the shell-quoted OS open command on success.

## Run

From the repo root, using `.qa` as `<qa-dir>` unless the engineer names another root:

```
node <this skill's directory>/../../scripts/scan.mjs show [<feature-key>] --root <qa-dir>
```

Read the JSON. Explain any usage `error` or `refusal.message` and stop. A pending `migration`
continues with the banner; `schema` describes compatibility. On success, print `knowledge_page.path`
and the command for the current OS, shell-quoting the actual path:

- macOS: `open '<path>'`
- Linux: `xdg-open '<path>'`
- Windows PowerShell: `Invoke-Item -LiteralPath '<path>'`

For POSIX single quotes inside the path, use `'\''`; for PowerShell, double them.
