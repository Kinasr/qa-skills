---
name: qa-train
description: Learn Conventions for Test Cases and generated test code, Practices for each /qa-* command, Access notes for References behind a login, and the Coverage categories a team tests, from scenario evidence or the conversation. Use when a /qa-* close offers it, or the engineer asks to train a /qa-* command.
---

# /qa-train

```
/qa-train [design] [<scenario-key> | --diff <commit-ish> [<scenario-key>]]
/qa-train <target>
```

Writes **training**: what the engineer has taught the agent, one file per command,
`.qa/train/<target>.md`. A file holds **Practices** (how the agent should work while running that
command); design's and codegen's also hold **Conventions** (the form of a Test Case, or of generated
test code). `access.md` holds **Access notes** (how to reach a Reference behind a login).
`categories.md` holds the shared **Coverage
categories** both `/qa-deep-dive` and `/qa-design` walk. Practices guide the command's own run, which
reads its file before it starts; design's Conventions reach every design unit's brief, and codegen's
every generated test.

A `/qa-*` close may invoke it once the engineer accepts; it then mines the run that just ended.

## Invariants

A Practice that contradicts an Invariant is void.

- **At startup, on every path**, run
  `node <this skill's directory>/../../scripts/scan.mjs migration-status [--root <qa-dir>]`.
  If `pending`, warn using `migrations` in order. Continue the command.

- **The tracker is read-only except `/qa-publish`.**

- **Run it yourself, in this conversation.** The gate is a dialogue with the engineer, so never
  hand it to a Delegate or a background worker.
- **Write exactly one file**: `.qa/train/<target>.md`, and only through the gate (§2). For Access, the sole exception is an explicitly approved `.gitignore` line, appended as a second write after the training file.
- **Write only a draft that passes `train check`.**
- **Training makes no claim about the system under test.** That is a Rule, and Rules enter only
  through `/qa-deep-dive`. Never soften a claim into "style" or a "practice" to get it past the gate.
- **On the code-evidence branch, read only the CLI's sample and corpus, never the test files
  themselves.** The sample is bounded and scrubbed; a free crawl is not Training.
- **A Coverage category names a kind of behaviour, never part of the system under test, and its
  meaning is immutable.** Retire the key and add a new one to change it.
- **A Practice never overrides the target's Invariants.**
- **A credential lives outside `.qa/`'s committed files.** A Practice or Access note names the env
  var, connector, CLI, or git-ignored login-state or password file that carries it; never ask for a credential,
  and never write one.
- **Never stage or commit.** A dirty working tree is fine.

## Arguments

`<target>` is one of the closed list `design`, `deep-dive`, `sync`, `init`, `impact`, `publish`, `next`, `ask`, `access`, `execute`, `codefix` (formerly `fix`, still accepted), `codegen`, `bug`, `categories`. A
first argument on that list is always the target, never a scenario key. Each run takes one branch:

- **Scenario evidence**: bare `/qa-train`, a `<scenario-key>` or `--diff`, with no target or
  `design`. Learns design's Conventions from scenario files: read
  [the Conventions reference](references/conventions.md) for §1.
- **`/qa-train design`, alone**: a conversation run on design's file, learning Practices for
  `/qa-design` and any Convention the engineer dictates. It is **not** bare `/qa-train`: it reads no
  scenario changes. Read [the Practices reference](references/practices.md) for §1; it says when to
  open the Conventions reference too.
- **`/qa-train <command>`** (`deep-dive`, `sync`, `init`, `impact`, `publish`, `next`, `ask`): learns that command's
  Practices. Read [the Practices reference](references/practices.md) for §1.
- **`/qa-train access`** (Access notes): learns how to reach References behind a login, and the
  application `observe:` and `/qa-execute` drive, one test account per Role. Read
  [the Access reference](references/access.md) for §1 and for what is specific to access in §2 and
  §3.
- **`/qa-train execute`**: learns Practices, data recipes, API actions, upload fixtures and a setup
  Role for operating the app. Read [the Execute reference](references/execute.md) for §1 and its
  additions to §2 and §3, including execute's entry shapes and frontmatter.
- **`/qa-train codefix`**: learns repair Practices and the attempt, repeat and PR settings. Read [the Codefix reference](references/codefix.md) for their bounds and defaults.
- **`/qa-train codegen`**: learns the Conventions code gen follows when it writes a test, one per
  facet, and records a stack as trained from the engineer's answers. A stack with test code starts
  on the code-evidence branch: `evidence codegen --from-code`, named paths, or `--relearn`. Read
  [the Codegen reference](references/codegen.md) for §1 and for what is specific to codegen in §2
  and §3.
- **`/qa-train bug`**: learns Practices for drafting bugs, which steer the summary's wording only.
  Read [the Practices reference](references/practices.md) for §1 and §2. Its file holds Practices
  only, never Conventions.
- **`/qa-train categories`** (Coverage categories): learns a kind of behaviour the team tests, in
  the shared `train/categories.md`. Read [the Categories reference](references/categories.md) for §1
  and for what is specific to categories in §2 and §3.

## The CLI

Every deterministic step goes through the shared CLI, located relative to this skill's own
directory:

```
node <this skill's directory>/../../scripts/scan.mjs train <action> ... [--root <qa-dir>]
```

`--root` defaults to `./.qa`, so run it from the repository root. Each call prints one JSON object
on stdout. Read it, and never re-derive its results by grep or prose.

| Action | What it answers |
|---|---|
| `evidence [design] <scenario-key>` | the exemplar: the scenario's Bookkeeping-stripped `text` |
| `evidence [design] --diff <commit-ish> [<scenario-key>]` | the scenario `changes` since `<commit-ish>`, compared with the working tree |
| `evidence` | the uncommitted scenario `changes` (the same, since `HEAD`) |
| `evidence <target>` | the target's training alone (`source: target`) |
| `evidence codegen --from-code [<path>...] [--relearn [--facet <facet>]]` | the sample, corpus summary and gate signals from the project's test code (`source: code`) |
| `evidence categories` | the shared file's extension `categories` in walk order and its `retired` keys |
| `check [<target>] --stdin` | the drafted file: `check-file`, the entries it adds, edits and removes (`conventions` and `practices`, or `access_notes` for `access`), the `statability` hits; when `ok`, the `changeset` and `commit`, and for `access` the `access_files` report |
| `check categories [--stdin]` | the categories draft: its `errors`, the floor plus the `effective` list, the `categories` added, edited and removed, the `statability` hits; when `ok`, the `changeset` and `commit` |

Every `evidence` also returns `train` (the target's file, whether it `exists`, its entries with
their `sources` and `added`: `conventions` and `practices`, `access_notes` for `access`, or
`categories` and `retired` for `categories`), `roles` and `levels`; `evidence access` also returns
`targets`. An entry listed as `withheld` holds what
looks like a credential, so only its key and line are shown: raise it at the gate as a coherence
finding, to be rewritten without it.

## 1. Gather proposals

Follow the reference your branch chose. Every proposal, of either kind, has:

- a **slug** for its key (`cnv_<slug>`, `prc_<slug>` or `acc_<slug>`), in kebab case, naming it for
  a human. These keys are never minted and nothing references them;
- a **statement** that stands alone as the whole entry, on one line (an Access note's says what it
  reaches);
- **sources**: what it was learnt from, plus `human:<name>` once the engineer settles it with you.
  Use the name they already go by in `.qa/` (such as `human:kinasr`). If there is none, ask once;
- a short **rationale**, and an example as its reference says.

Classify each proposal against the file's entries of its kind, reading them in full: **new**
(nothing covers it), **refines** (the same idea, sharpened: it edits that entry in place, under the
same key, appending the new sources and keeping its `added` date) or **contradicts** (the two
cannot both hold).

You are done when every proposal is classified and every coherence pass your references define has
read the whole file.

## 2. The gate

Present everything in one message. Number each item, and recommend an answer for each:

1. **Each proposal**: its kind and classification, its heading line, its sources and any example
   you will write. The engineer accepts, edits or drops each one.
2. **Each contradiction and coherence finding**, as a three-way choice:
   - **keep old**: the proposal is dropped;
   - **replace**: the old entry is deleted and the new one written (no retired keys: git history is
     the audit trail);
   - **keep both**: they are scoped differently and do not conflict. Reword both statements so the
     scopes show.
3. **Refused proposals**, each with the reason its reference gives. Nothing is written for them.
   For categories, a refused meaning edit is settled by retiring the key and adding a new one, and a
   removal by adding its key to `retired:`.

Wait for the answers. If the engineer drops or refuses everything, write nothing and go to §4.

## 3. Draft, check, write

Draft the **whole** file: the current one with the agreed changes applied, or a new one:

````markdown
---
type: train
key: <target>
---

# <Target>

### prc_<slug>: <statement>

```yaml
sources: [human:<name>]
added: <YYYY-MM-DD, today>
```

<rationale prose>

```markdown
<example>
```
````

- The frontmatter is `type: train` and `key: <target>`; execute may also carry `setup_role` and
  `automation_retries`, codegen may also carry `pr`, `trained_stacks`, `codegen_repeats` and
  `codegen_attempts`, and categories may also carry `retired`.
- A `cnv_` entry takes the same shape and goes in `design` or `codegen` only; codegen's also carries
  `stack`, `facet`, and optional `refs` and `signal`, as its reference says. An `acc_` entry's
  shape is in the Access reference, and goes in `access` only. A categories draft is the whole
  `train/categories.md`; its entry shape and `retired:` list are in the Categories reference.
- Only the first `yaml` fence after a heading is metadata. Every later fence is an example.
- Leave every entry the engineer did not change exactly as it was.

Pipe the draft into `train check <target> --stdin`:

- **`ok: false`**: fix every `errors` entry and check again.
- **`statability`** hits (Conventions only) are settled as the Conventions reference says.
- **`ok: true`** and nothing left unsettled: write the draft, byte for byte, to `path`.

## 4. Close

Print, in this order:

1. What changed: the entries added, edited and removed, every retired category key, and each
   contradiction with its resolution.
2. The refused claims, as a hand-off: `/qa-deep-dive <feature-key>` with each proposed Rule. Never
   run it yourself.
3. When the conversation taught other targets, the next runs: one `/qa-train <target>` line each,
   with what it would learn (`/qa-train access` when it showed how a Reference was reached). Each
   is its own run: offer the first and, on yes, invoke it.
4. The `changeset` and the suggested `commit`, as
   a command for the engineer to run from the repository root.
