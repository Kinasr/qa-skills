# Reaching the tracker through an Access note

`sync scope` returns `access`: the **Access note** that covers the tracker, or `null`. A note is the
engineer's own record of how to reach it. The tracker scout's brief inlines it and says how each
field steers the fetch. What is yours:

- **`via`** is where the credential lives: what the engineer fixes when a fetch fails on credentials.
- **`withheld: true`**: the note holds what looks like a credential, so nothing else is shown, and
  the scout fetches as if it had no note. Tell the engineer that `/qa-train access` rewrites it
  without the credential. If the fetch fails, the failure payload still names it, and the card
  repeats the advice.

The engineer may give a changed host or identifier in chat, such as a tracker that moved. Use it for
this run: add it to the scout's prompt. The note on disk stays as it is.

## A credential failure

The fetch fails on credentials when the credential is refused, expired or missing, the connector or
CLI is not signed in, or the host or identifier no longer reaches the tracker. Judge the scout's
`FAILED` line by this. Before you write the failure payload:

1. Name the note (`key`) and its `via`, and say what to fix: the variable to set, the connector to
   reconnect, with `credential_from` for where to get a new credential. Ask the engineer to fix it
   and say "done".
2. The credential stays with the engineer. If a token is pasted anyway, neither use nor repeat it:
   point to `via` as the place it belongs.
3. On "done", run `scout brief tracker --dir <run-dir>` again (it re-reads the notes, so one
   corrected meanwhile applies) and run a fresh tracker scout. That is the one retry. A second
   failure is the fetch failing: write the failure payload with `access_note` set to the note's
   `key`, as [the fetch reference](tracker-fetch.md) shows. The card skips only the tracker
   sections, names the note and its `via`, and the code repairs still run.
4. Report a failing note as it stands. Only `/qa-train access` changes one.

A failure with no note, or not on credentials, gets no retry and no `access_note`. A `withheld`
note gets no retry either: it shows no `via` to fix.

## The hand-off

Print it where you ask for the retry and again where a credential failure ends the fetch, with a
note or without:

> To record how to reach the tracker for every run: `/qa-train access`

When the run used a value from chat, print the proposed entry in full beneath it, so that it
survives `/clear`. It is the note `scope` returned (`key`, `statement`, its fields, `quirks`) with
the chat value in place of the old one, plus `sources: [human:<name>]` (the name `.qa/` already goes
by, such as `human:kinasr`; ask once if there is none) and `added:` today, shaped as in
[the `/qa-train access` reference](../../qa-train/references/access.md) ("Gate and draft").
