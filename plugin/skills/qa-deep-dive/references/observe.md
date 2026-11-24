# Observing the live application: `observe:`

`observe:<url> "<what to look at>"` sends a **UI scout**: an in-session subagent that explores the
running application through `playwright-cli` in its own context, so its page snapshots never reach
this conversation. The CLI turns its report into an **Observation**, a committed record under
`.qa/observations/`, and the input becomes that file's `file:` Reference. The UI scout is the one
part of a run you hand off; `tracker:` and `url:` References you still fetch yourself.

Add `signed-out` after the colon to observe the page as a signed-out visitor sees it:
`observe:signed-out <url> "<what to look at>"`. The scout opens it with no login state and makes no
login, and the Observation records `signed_out: true`.

## A shell-capable subagent

The scout needs a subagent that can run a shell. On a harness without subagents, or whose subagents
have no shell, fail every `observe:` input with this message, and keep the exploration out of this
conversation:

> `observe:` needs a subagent that can run a shell, and this harness has none. Re-run without it, or
> pass what you saw as a committed file.

## Run each input to its URI

Run every `observe:` input at once, each through these three steps, from the repository root with
the same CLI and `--root` as `deep-dive`:

1. `scout brief ui <url> "<what to look at>"`, adding `--signed-out` for a signed-out input. Each
   call makes a fresh run dir, so scouts never share one.
2. Spawn one subagent on the `model` step 1 printed (none when it is null), with this prompt and
   no working directory of its own: the brief names every path absolutely, and the scout never `cd`s.
   ``Read <brief_file> and follow it exactly. Reply with exactly one line, `DONE` or `FAILED: <reason>`:
   everything you saw goes in the report file, and a reply carrying more is ignored, since only the
   Observation is cited.`` Wait for it to finish. The brief holds everything it needs, and its report
   lands in `output_file`.
3. `scout ingest --dir <dir>`, **once** per run dir: a second call writes a duplicate Observation.
   Its `uri` replaces the `observe:` input in the list you pass to `deep-dive refs`.

A step that prints `ok: false` fails that input. Word `refusals` (`code` and facts) when present,
falling back to `.error` only for deferred exit-1 `scout` / `scout ingest` refusals: it says what to
fix. With no Access note for the URL, it names `/qa-train access`.

`scout.allowed_hosts` in `.qa/project.md`, when set, lists the hosts `observe:` may look at, checked
before the Access note; without it, any host an Access note reaches is observed. `observe_disabled` means the list is empty, so `observe:` is off; `host_not_allowed`
means the URL's `host` is not on it (`allowed_hosts` on the refusal). Tell the engineer which, and
that whether a host is safe to observe is theirs to decide in that list. Neither is retried.

A signed-out input checks the same list. With no list, any note that reaches the host is enough,
Role-tagged included, so a host covered only by notes that log in can still be observed signed out.

When the note logs in as a user, `scout brief ui` logs in itself before writing the brief. A
signed-out input does not: it makes no login and loads no login state, so `login_secret_missing` and
`login_failed` cannot happen for it. An ordinary input's `login_secret_missing` or `login_failed` is
a credential failure: follow the rule in [the access reference](access.md), naming the note
(`access` on the refusal), and on "done" run step 1 again. That is the one retry.

## A failed input

- **It fails the intake**, as a failed Reference does. Run the other inputs and `deep-dive refs` to
  the end anyway, so that the §2 report lists every input, then halt at §2 step 4.
- **An expired session**: `scout ingest` refuses with `reason: "login_expired"`, its `failure` the
  scout's sentence on the page that asked it to log in. Follow the credential failure rule in
  [the access reference](access.md): name the note (`access` on the refusal) and its `via`, ask the
  engineer to do what the refusal's `error` says (log in again with its steps, or, after a CLI
  login, switch the note to a saved login), and say "done". On "done", run all three steps again
  with a fresh brief. That is the one retry; a second failure fails the input. A signed-out input
  has no session to expire: a sign-in page is expected there, so its `FAILED:` line is a plain
  failure.
- **Reaching the cap**: `scout ingest` refuses with `reason: "over_cap"`. For a form with many
  comboboxes, suggest one request per form: each custom combobox the request asks about costs the
  scout two commands to open and close.
- **An Observation already written stays on disk** when the run halts later: an ordinary untracked
  file. Tell the engineer its `file:` URI cites it on a re-run, with no second exploration, and that
  committing or deleting it is theirs.

## In the report and the grilling

- An Observation carries `refs`' `untracked` warning. Note that the suggested commit adds it (§9),
  so a fresh clone will hold it.
- A signed-out Observation carries `signed_out: true`: its facts are what that visitor saw, never
  what a logged-in account saw.
- Read each Observation whole, as any `file:` Reference. Its facts are **claims** of current
  behaviour: the app may be wrong. Put each one that bears on a Rule to the engineer to confirm,
  quoting the Observation and the fact's number. Only a confirmed claim becomes a Rule.
- The scout navigates and reads only, so a flow that needs input (a form, a toggle, an upload) is
  unseen: the Observation numbers each such part under `## Not seen`. Put every Not-seen item to
  the engineer as an unseen flow to settle, quoting the Observation and the item's number.
- An Observation is never edited. Observing again writes a new one.
