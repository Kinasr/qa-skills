# Fetching the tracker for /qa-sync

The CLI makes no network calls, so a **tracker scout** fetches the tracker: a subagent you spawn in
this session, which writes what it fetched as a JSON payload to `payload_file` in the run dir. The
payload stays out of your context: you pass its path along and leave it unread. The tracker is
read-only: fetch, never write, comment, transition or link.

The scout's brief, which `scout brief tracker` writes, is the one statement of the fetch: what to
fetch, the payload's shape and its not-found marker, and each case's prose.

## Run the tracker scout

1. Run `scout brief tracker --dir <run-dir>`. It prints `brief_file`, and `output_file`, which is
   `payload_file`.
2. Spawn one subagent with this session's tracker tools and a shell, on the `model` the brief call
   printed (none when it is null), prompted:
   `Read <brief_file> and follow it.` Add any changed host or identifier the engineer gave in chat
   (see [the access reference](access.md)). It is a Scout, not a Delegate: spawn it yourself, in
   this session.
3. Its reply is one line. **`DONE`**, with `payload_file` present: go on to the card.
   **`FAILED: …`**, any other reply, or no `payload_file`: the fetch failed. Write the failure
   payload below yourself, whatever the scout left there, after the access reference's retry when
   it failed on credentials.

**Without subagents.** When this harness cannot spawn one, or its subagents have no shell or no
tracker tools, say once that the tracker is fetched in this conversation, without a scout. Then
run `scout brief tracker` all the same and follow its brief yourself, taking its last step's reply
as step 3 above.

## When the fetch fails

On any failure (auth, network, rate limit, a scout that wrote nothing), write
`{"error": "<what failed>"}` as the payload and carry on. The card then skips only the tracker
sections, says so, and the code repairs still run.

When a credential failure ends a fetch with an Access note in play, add the note's `key`:
`{"error": "<what failed>", "access_note": "<acc_slug>"}`. The card then names the note and its
`via`. [The access reference](access.md) says when.

## Running the scout again

A fresh `scout brief tracker` and a fresh scout fetch the whole payload again, prose included. Run
one again, once, when:

- `sync card` still lists cases in `fetch_prose`;
- the card says the tracker payload is invalid: the payload is not the brief's shape, or leaves
  out scenarios or cases `sync scope` named;
- the engineer says "done" after a credential failure: the access reference's one retry.

If that second scout falls short the same way, the fetch has failed: write the failure payload,
naming what is still wrong, then run `sync card` again.

The payload may be rewritten until the card is shown. After that, leave it alone: `sync apply`
refuses a card whose payload changed.
