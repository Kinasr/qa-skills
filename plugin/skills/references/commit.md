# Making the commit

A command commits the files it wrote as the project's Commit mode says (ADR-0062). Never run git
yourself. Write the output's commit line, exactly as printed, to a file outside the repository (the
run dir or your scratch directory), then run this one plain command, with that file's absolute path:

```
node <this skill's directory>/../../scripts/scan.mjs commit --input <file> [--confirmed] [--root <qa-dir>]
```

then act on `status`:

- `print`: give the engineer the `commit` command.
- `ask`: ask the engineer whether to commit, saying `reason` when `mode` is `auto`.
  On yes, run it again with `--confirmed` and act on that `status`; on no, give the `commit` command.
- `committed`: report the short `sha` and go on.
- `failed`: report `reason` and give the `commit` command. Never retry it, and never with
  `--no-verify`.
- `refused`: report `reason` and give the `commit` command.

Only the changeset is committed. A file the engineer must add or fix themselves stays theirs to
commit.

At a Checkpoint, the run goes on once the commit exists: at `committed`, or when the engineer
confirms they made the commit the other statuses gave them.
