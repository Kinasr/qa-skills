# Access notes

An **Access note** says how to reach one kind of Reference that sits behind a login: its host, how
the agent authenticates, and where a person gets the credential. It lives in `train/access.md`. A
Reference is matched to a note by its `match` prefixes, the longest first, so one note serves every
command that reaches the Reference.

## Read the file

Run `evidence access`. Its `train` holds `access.md` as it stands: whether it `exists` and its
`access_notes`, each with the `match` prefixes it covers, its `via`, and its `role`, `host` and
`identifiers`; beside it, the project's `roles` and `targets`. You are done when you hold every
existing note's prefixes and test account.

## Mine, or have the engineer dictate

- **Mine** when this conversation fetched, or failed to fetch, a tracker or URL Reference: collect
  how it was reached. A hand-off from an earlier run that carries a proposed entry is the strongest
  evidence. You are done when every Reference the conversation reached or failed to reach sits
  behind a proposal or is named as a one-off.
- **Dictate** when the conversation holds nothing for access: ask which Reference the engineer
  wants reached without being asked, or which application `observe:` should look at, then the
  fields below. You are done when they say there is nothing more to add.

Ask for the *name* of the env var, connector or CLI, never for its value. Record where the
credential lives and where a person gets it.

A note's fields:

- **`match`**: the prefixes of the normalised Reference URIs it reaches: `tracker:DEMO-` for one
  tracker project, `tracker:` for the whole tracker, `url:https://wiki.loans.example.test/` for a host. Take
  each from the `uri` a command printed for the Reference, else from the host the engineer names.
  A `file:` or `code:` Reference needs no login, so no note reaches it.
- **`via`**: where the credential lives, outside anything git tracks: `env:NAME`, `mcp:name` or
  `cli:name`, or `file:<path>` for an app's password (below).
- **`host`**, **`identifiers`**: non-secret facts, such as a user name, a tenant or an org.
- **`role`**: the Role an app test account logs in as (below); absent on every other note.
- **`credential_from`**: where a person gets the credential, in a sentence.
- **`sources`**, **`added`** and the quirks as prose, as for any entry. An Access note needs no
  example.

## The application under test

An Access note also reaches the running application, for `/qa-deep-dive`'s `observe:` input. Ask
the engineer: "Does the app log in with a single form of user name and password?" Yes is a **CLI
login**; SSO, MFA, or a form that asks for the password on a second page is a **saved login**.
Either way, `match` is the application's `url:` prefix (`url:https://staging.loans.example.test/`) and
`credential_from` says where a person gets the dedicated test account.

**The Role.** Ask only here, and only when `roles` is non-empty: "Is this one Role's test account
(which?), or the default role-less one?", offering `roles`. A Role's answer goes in `role`; no
answer leaves it out. One note is one test account, so each Role gets a note of its own with its
own login-state or password file. `/qa-execute` needs one note per Role a case carries, and
`observe:` a role-less one with an account of its own; tell the engineer both.

**A CLI login**: `/qa-deep-dive` logs in by itself before every look at the app, so a session never
goes stale.

- **`identifiers`**: `{user: <the test account's user name>}`. When the page defeats the defaults
  (the first password field, the nearest input before it, Enter to submit, the app's origin), add
  `user_field` and `pass_field` selectors and a `login_url`. Name it `pass_field`: `check` refuses
  any key named for a password.
- **`via`**: where the password lives. `file:<path>`, a git-ignored file holding the password alone,
  `.qa/.auth/<slug>.password` by default (the note's slug), suits every harness. `env:NAME` suits
  an agent started from a terminal.
- Run `node <this skill's directory>/../../scripts/scan.mjs scout password-steps <via> [--root <qa-dir>]`
  with the note's `via`, and show the engineer its `steps` as written.

**A saved login**: the engineer logs in by hand and saves the login state, which expires with the
app's session.

- **`via`**: `cli:playwright-cli`.
- **`identifiers`**: `{login_state: <path>}`, the file holding the saved login state, by default
  `.qa/.auth/<slug>.json`. The file holds session cookies, so the note carries its path alone.
- Run `node <this skill's directory>/../../scripts/scan.mjs scout login-steps <url> <login_state> [--root <qa-dir>]`
  with the note's `match` URL (its `url:` prefix removed) and its `login_state`, and show the
  engineer its `steps` as written. The password goes into the browser alone, never into this
  conversation.

Under the note at the gate, tell the engineer to:

1. **Write the password file, or save the login state**, as above.
2. **Keep that file under a git-ignored path**, `.qa/.auth/` by default. `train check access`
   returns `access_files`: each login-state or password file the notes name that Git does not
   ignore, or already tracks, with the exact line to add to `.gitignore`. Have a draft checked
   before the gate — `check` writes nothing — so the report is in hand: at the gate, offer each
   line and ask for an explicit yes. Write `.qa/train/access.md` first (§3); only on yes append the
   agreed line to `.gitignore` as the second write, and never a line that is already there. A no
   leaves `.gitignore` unchanged. An ignore line does not untrack a tracked file: for one the
   report marks `tracked`, tell the engineer to run `git rm --cached <path>`. `observe:` is
   refused while Git would track the file.
3. **Use a disposable environment** (staging or a throwaway instance) **with a dedicated test
   account**, so exploring cannot touch data anyone needs.

You are done when the gate shows the note with all three beneath it. The scan warns that the note
matches no Reference until an `observe:` has made an Observation at that URL: expected.

## Refusals

Test every proposal against these. Explain each refusal to the engineer in plain words and fix the
proposal with them; nothing is written until `check` passes.

1. **A credential**: a token, password or key in chat, in a field, in the heading or in the prose.
   Never repeat it, not in a quote, the gate or the draft. Point to `via` as the place it belongs and
   ask for that name instead. `check` refuses a credential-named key and text in a known token
   format on any line, and names the note or line, never the value.
2. **A `via` outside `env:NAME`, `mcp:name`, `cli:name` or `file:<path>`**, a `file:` on a note that
   is not a CLI login, or a `match` that is not a `tracker:` or `url:` prefix.
3. **A `role` the note cannot carry**: an empty or padded one, or one on a note that is not an app
   test account (a `url:`-only `match`, and a CLI login or `cli:playwright-cli` with a
   `login_state`). A Role outside `roles` is an Integrity error the scan reports; ask for one from
   the list.
4. **A way of working** (what to read, what to ask, where to look in the application) is a Practice
   for the command that does it: list that command's `/qa-train` run at the close.

## The coherence pass

Read every existing note beside the proposals. Two notes claiming one `match` prefix and Role
contradict (`check` refuses the pair), and so do two notes sharing a `login_state`, an
`(origin, user)` or a password file, whatever their Roles: one note is one test account. A host or
`via` that differs between notes for the same Reference is a finding. You are done when each existing note has been read against every proposal.

## Gate and draft

Show each proposed note at the gate as it will be written: heading, block and prose. `check` lists
`access_notes` added, edited and removed by key. An edited note's heading before and after are
equal when only its block changed, so rely on the note you show.

An `acc_` entry is the shared draft shape without an example:

````markdown
### acc_<slug>: <what it reaches>

```yaml
match: [tracker:DEMO-, "url:https://wiki.loans.example.test/"]
via: mcp:atlassian
host: loans.atlassian.net
identifiers: {user: librarian@loans.example.test}
credential_from: "Atlassian, Profile, API tokens; export as JIRA_TOKEN"
sources: [human:librarian]
added: <YYYY-MM-DD, today>
```

<quirks, if any>
````
