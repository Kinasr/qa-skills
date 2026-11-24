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
- **`via`**: where the credential lives, outside anything git tracks: `auth:KEY` for a secret the
  engineer keeps in their **Auth file**, `env:NAME`, `mcp:name` or `cli:name`, `file:<path>` for
  an older app's password, or `none` for a signed-out Role (below).
- **`host`**, **`identifiers`**: non-secret facts, such as a user name, a tenant or an org.
- **`role`**: the Role an app test account logs in as, or a signed-out visitor plays (below); absent
  on every other note.
- **`credential_from`**: where a person gets the credential, in a sentence.
- **`sources`**, **`added`** and the quirks as prose, as for any entry. An Access note needs no
  example.

## The application under test

An Access note also reaches the running application, for `/qa-deep-dive`'s `observe:` input. Ask
the engineer: "Does the app log in with a single form of user name and password?" Yes is a **CLI
login**; SSO, MFA, or a form that asks for the password on a second page is a **saved login**.
Either way, `match` is the application's `url:` prefix (`url:https://staging.loans.example.test/`) and
`credential_from` says where a person gets the dedicated test account.

Ask whether the API authenticates with a header key or token. If so, propose `identifiers.header`
for the header name, optional `identifiers.scheme`, and `header_via: auth:<SLUG>_TOKEN`; an expired
test credential may also use `expired_via: auth:<SLUG>_EXPIRED_TOKEN`. `header_via: env:NAME` and
`expired_via: env:NAME` are for an engineer who asks for the environment. Header-only omits `via`;
shared notes keep it. Ask for the key or variable name, never the secret. Run `scout header-steps
<header_via> [--root <qa-dir>]` and show its CLI-written `steps` with the password steps. They explain
where the secret goes: the Auth file for `auth:KEY`, the environment or the repo root's `.env`
(ignored as `/.env`) for `env:NAME`. Never ask for or repeat the value in chat.

**The Role.** Ask only here, and only when `roles` is non-empty: "Is this one Role's test account
(which?), or the default role-less one?", offering `roles`. A Role's answer goes in `role`; no
answer leaves it out. One note with a login is one test account, so each Role that signs in gets a
note of its own with its own login-state or password file. `/qa-execute` needs one note per Role a
case carries, and `observe:` a role-less one with an account of its own; tell the engineer both.

**A signed-out Role.** Also ask, only when `roles` is non-empty and no note has `via: none` yet,
whether a visitor who never signs in acts in any case. If so, ask for a **new, distinct Role** name
that has no login note (suggest one, such as `Visitor`; accept an existing Role from `roles` only
when no login note uses it, never a Role that already signs in). When the chosen name is not in
`roles` (`project.roles`), give the exact `/qa-init --add-role <Name>` step to declare it before
recording the note, and never route to `/qa-deep-dive` for a missing Role. Once declared, propose a
note with `role`, `via: none`, and only `url:` prefixes in `match`, with no `identifiers` or
`credential_from`.

**A CLI login**: `/qa-deep-dive` logs in by itself before every look at the app, so a session never
goes stale.

- **`identifiers`**: `{user: <the test account's user name>}`. When the page defeats the defaults
  (the first password field, the nearest input before it, Enter to submit, the app's origin), add
  `user_field` and `pass_field` selectors and a `login_url`. Name it `pass_field`: `check` refuses
  any key named for a password.
- **`via`**: where the password lives: `auth:<SLUG>_PASSWORD`, the note's slug in capitals with `_`
  for `-`, a key in the engineer's Auth file. One Auth file serves every note and every worktree of
  the clone. Propose `env:NAME` only when the engineer asks for it.
- Run `node <this skill's directory>/../../scripts/scan.mjs scout password-steps <via> [--root <qa-dir>]`
  with the note's `via`, and show the engineer its `steps` as written.
- **`identifiers.sign_in_urls`** (optional, any note): full URLs of further sign-in endpoints, such
  as an API's token call on its own origin. `/qa-execute` refuses to mock them, and refuses every
  mock on another target's origin until one is named there.

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

1. **Fill the Auth file, or save the login state**, as above. The Auth template,
   `.qa/auth.example`, lists every key; the engineer copies it to `.qa/auth` in the main checkout
   and fills in the values once per clone.
2. **Keep that file under a git-ignored path**, `.qa/.auth/` by default, and `.qa/auth` for the Auth
   file. `train check access` returns `access_files`, the Access Files To Ignore section: each
   login-state, password or Auth file the
   notes name that Git does not ignore, or already tracks, with the exact line to add to
   `.gitignore`. Have a draft checked
   before the gate — `check` writes nothing — so the report is in hand: at the gate, offer each
   line and ask for an explicit yes. Write `.qa/train/access.md` first (§3); only on yes have the CLI
   append the agreed line to `.gitignore` as the second write:
   `node <this skill's directory>/../../scripts/scan.mjs train auth-ignore <gitignore_line> [--root <qa-dir>]`,
   once per agreed line. It appends that one line, never a line that is already there
   (`added: false`), and keeps every other byte; leave `.gitignore` itself to it. Make its `commit`
   as [the commit reference](../../references/commit.md) says, beside the training file's, and name in
   the close any file this run changed that no commit covers. A no
   leaves `.gitignore` unchanged. An ignore line does not untrack a tracked file: for one the
   report marks `tracked`, tell the engineer to run `git rm --cached <path>`. `observe:` is
   refused while Git would track the file.
3. **Use a disposable environment** (staging or a throwaway instance) **with a dedicated test
   account**, so exploring cannot touch data anyone needs.

You are done when the gate shows the note with all three beneath it. `train check access` also
returns `auth_template`, `{path, text}`, when a note names an `auth:` key: write its `text`
byte for byte to `path` in the same gate write as `train/access.md`, so the template stays current;
a `text` of `null` means no note names a key any more, so delete the file in that write.
`check` warns for a key no Auth file holds yet and refuses a template that holds a value. The scan warns that the note
matches no Reference until an `observe:` has made an Observation at that URL: expected.

## Close

On a fresh setup (`evidence access` found no `access.md`), name the continuation last:
`/qa-deep-dive <feature-slug> human:<you>`, adding `observe:<url> "<what to look at>"` when a note
reaches the application; offer it once; run it on yes.

## Refusals

Test every proposal against these. Explain each refusal to the engineer in plain words and fix the
proposal with them; nothing is written until `check` passes.

1. **A credential**: a token, password or key in chat, in a field, in the heading or in the prose.
   Never repeat it, not in a quote, the gate or the draft. Point to `via` as the place it belongs and
   ask for that name instead. `check` refuses a credential-named key and text in a known token
   format on any line, and names the note or line, never the value.
2. **A `via` outside `auth:KEY`, `env:NAME`, `mcp:name`, `cli:name`, `file:<path>` or `none`**, an `auth:` key outside `[A-Z_][A-Z0-9_]*`, a `file:` on a
   note that is not a CLI login, or a `match` that is not a `tracker:` or `url:` prefix.
3. **A `role` the note cannot carry**: an empty or padded one, or one on a note that is not an app
   test account (a `url:`-only `match`, and a CLI login or `cli:playwright-cli` with a
   `login_state`, a Header credential, or `via: none`). A Role outside `roles` is an Integrity error
   the scan reports: for a signing-in note ask for one from the list (or give
   `/qa-init --add-role <Name>`), and for a `via: none` note give `/qa-init --add-role <Name>`
   before recording it. A `via: none` note needs a distinct Role of its own (never one that already
   has a login note), names no user or login state and carries no Header credential.
4. **A way of working** (what to read, what to ask, where to look in the application) is a Practice
   for the command that does it: list that command's `/qa-train` run at the close.

## The coherence pass

Read every existing note beside the proposals. Two notes claiming one `match` prefix and Role
contradict (`check` refuses the pair), and so do two notes sharing a `login_state`, an
`(origin, user)` or a password file, whatever their Roles: one note is one test account. Two notes
may share one `auth:` key. A host or `via` that differs between notes for the same Reference is a
finding. For each existing note with `via: file:<path>` or `env:NAME` (or a header source of that
kind), offer to convert it to `auth:<SLUG>_PASSWORD` (or `_TOKEN`, `_EXPIRED_TOKEN`), shown at the
gate like any edit; the engineer moves the value into the Auth file. You are done when each existing note has been read against every proposal.

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
