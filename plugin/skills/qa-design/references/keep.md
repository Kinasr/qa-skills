# Keeping Proposed Rules

A Proposed Rule the engineer keeps waits in the Feature's `## Proposed Rules` until a deep dive
settles it (ADR-0067). The report's `proposals` number every proposal of the Run once: each
Delegate's, then the agreement's Conventions-implied ones (`scenario: null`). A `kept: true` one
is already in the Feature.

1. **Ask.** When `keep` is set, ask which numbered `proposals` the engineer keeps for
   `/qa-deep-dive`, offering to reword any. Pre-select none. Done when the engineer has named
   their items, or none.
2. **Keep.** Pass their answer to the `keep` command as
   `{"keep":[{"item":<n>,"statement":"<the rewording, only if they reworded>"}]}`, the statement one
   line. Word `kept` and `already_kept`: an already-kept one was not written twice. Done when the
   command answered `ok: true`, or the engineer kept none.
3. **Commit.** A non-null `commit` covers the Feature and the Run's changeset: make it in place of
   `changeset.commit`, as [the commit reference](../../references/commit.md) says. Done when it is
   made, or its `status` is handled.

A proposal not kept is only reported. `keep` is the one Feature write `/qa-design` makes: it writes
no Rule and moves no pin.
