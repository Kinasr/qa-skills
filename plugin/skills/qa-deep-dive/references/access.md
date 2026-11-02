# Reaching a Reference behind a login

`refs` returns `access`: per Reference URI, the **Access note** that covers it, or `null`. A note
is the engineer's own record of how to reach that target, so fetch the way it says.

## Fetch the way the note says

- **`via`** is where the credential lives. `mcp:name`: fetch with that connector's tools.
  `cli:name`: fetch with that CLI. `env:NAME`: write `$NAME` in the fetch command, so the value
  itself never enters the conversation.
- **`host`** and **`identifiers`** (a user, tenant or org) are what to fetch from and as.
- **`quirks`** are the engineer's remarks about this target. Follow them.
- **`null`**: fetch as you would with no note.
- **`withheld: true`**: the note holds what looks like a credential, so nothing else is shown. Fetch
  as if it had no note, and tell the engineer that `/qa-train access` rewrites it without the
  credential.

The engineer may give a changed host or identifier in chat, such as a wiki that moved. Use it for
this run. The note on disk stays as it is.

## A credential failure

A fetch fails on credentials when the credential is refused, expired or missing, the connector or
CLI is not signed in, or the host or identifier no longer reaches the target. Fetch the other
References first, then, before the report:

1. For each failed Reference that has a note, name the note (`key`) and its `via`, and say what to
   fix: the variable to set, the connector to reconnect, with `credential_from` for where to get a
   new credential. Ask the engineer to fix it and say "done".
2. The credential stays with the engineer. If a token is pasted anyway, neither use nor repeat it:
   point to `via` as the place it belongs.
3. On "done", re-run `refs` (it re-reads the notes, so one corrected meanwhile applies) and fetch
   the failed References again. That is the one retry. A second failure leaves the Reference
   `failed`, and §2 step 4 halts. Never continue on a subset.
4. Report a failing note as it stands. Only `/qa-train access` changes one.

A failed Reference with no note halts as it does today, with no retry.

## The hand-off

Print it where you ask for the retry and again where the run halts:

> To record how to reach this Reference for every run: `/qa-train access`

When the run used a value from chat, print the proposed entry in full beneath it, so that it
survives `/clear`. It is the note `refs` returned (`key`, `statement`, its fields, `quirks`) with
the chat value in place of the old one, plus `sources: [human:<name>]` (the engineer's name, as §4
settles it) and `added:` today, shaped as in
[the `/qa-train access` reference](../../qa-train/references/access.md) ("Gate and draft").
