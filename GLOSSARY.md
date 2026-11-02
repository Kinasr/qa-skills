# qa-skills

An agentic QA engineering framework: skills that turn requirements into durable feature knowledge and test cases,
backed by a durable markdown knowledge layer the agent consults when something changes.

## Language

### The knowledge layer

**Feature**:
A durable area of the system's behaviour, and the home of the knowledge about it. Bounded by the
reach of its Rules: two Test Scenarios belong to the same Feature if any one Rule could govern
both. Drawn by people, not inherited from a tracker's structure.
_Avoid_: group, suite, module, epic

**Rule**:
One addressable statement of required behaviour within a Feature. What a Test Case covers. Its
statement carries the whole claim; any elaboration beneath it explains, and never adds a claim.
_Avoid_: requirement, behaviour, acceptance criterion

**Test Case**:
One manual pass: the claims about how the system under test should behave that a tester checks from
one setup in one run of steps, identified by its own key and carrying its own provenance and review
state. The atomic concept of the knowledge layer. Its summary is part of its claim, not a label for
it: a case that is a summary and nothing else still claims whatever that summary says.
_Avoid_: test, check, assertion

**Expected-result paragraph**:
The one named part of a Test Case's prose that states the outcome the case expects. Its absence is
what makes an Outcome gap.
_Avoid_: assertion, expected output, acceptance criterion

**Automation**:
One executable test in the code, identified by its own automation id. Automations and Test
Cases relate many-to-many. A test written once and run many times (parameterised, or generated
in a loop from a template title) is one Automation.
_Avoid_: test function, script, automated test case

**Automation run**:
One Automation's attempts within a `/qa-execute` Run, re-runs included. It can be Blocked before any
code starts, and it is never an Execution.
_Avoid_: test run, test pass, automated execution

**Automation result**:
The outcome of one Automation run: Passed, Failed, Flaky, or Blocked with its reason. It is neither an
Execution result nor a Verdict.
_Avoid_: test status, execution result, verdict

**Automation gap**:
A Test Case that can be automated but has no Automation. A case that cannot be automated is
never a gap.
_Avoid_: missing test, uncovered case

**Test Scenario**:
A named group of Test Cases that share a subject, and the unit one knowledge file holds.
_Avoid_: test class, test group, suite

**Test level**:
The layer through which a Test Case exercises the system, such as UI or API, chosen from the
project's own list. One per Test Case and part of its claim; a Test Scenario carries none. Never a
Coverage category.
_Avoid_: test type, layer, tier

**Functionality**:
A user-visible capability of a Feature, named as a verb phrase. The deep dive's working unit, and
never stored, except as a Deferred functionality.
_Avoid_: feature, use case, user story

**Coverage**:
The Feature's per-category record of what the deep dive considered, held as its `## Coverage`
section. It claims no behaviour.
_Avoid_: coverage matrix, coverage report, test plan

**Coverage category**:
A kind of behaviour every Feature is checked for, such as the happy path, permissions or input
validation. A checklist both the deep dive and design walk, never a way to store or split work:
every category ends covered, n/a with a reason, or awaiting a Rule, and the same floor list serves
every project, which a team may extend but never shorten.
_Avoid_: test type, technique, checklist item

**Mirrored value**:
A value copied into the knowledge layer from an external tracker, kept so disagreements can be
seen. Recorded, never authoritative. A copy of a Tag or Custom field is a label copy: a difference
in it is overwritten by the next publish, never a Divergence.
_Avoid_: synced field, source of truth

**Mirror refresh**:
Copying the tracker's current values over the Mirrored values, done when the knowledge layer is
reconciled with the tracker and never as part of change impact. It rewrites only the copies, never
what the knowledge layer owns, so a disagreement survives it as a Divergence.
_Avoid_: sync, pull, import

**Tag**:
A label from the project's own list that marks a Test Case for selection, such as smoke,
regression or end to end. A case carries none, one or several. A label, never part of the case's
claim.
_Avoid_: label, marker, suite, Test level

**Untagged case**:
A Test Case that carries no Tag. Selecting by Tag never picks it; selecting by Test level alone
still can. Not the same as an unclassified case, which is missing a required Custom field.
_Avoid_: unclassified, unlabelled

**Custom field**:
A kind of label a project declares for its Test Cases, with a description of what it means, a
list of allowed values that may grow and retire but never rename, and whether a case holds one or
several. Never part of a case's claim, so changing one never needs a Review. A case missing a
required one is unclassified, never invalid.
_Avoid_: metadata, annotation, attribute, Coverage category

**Role**:
A named kind of user of the system under test, carried on a Test Case as part of its claim, with
the tracker's copy kept beside it as a Mirrored value. Optional: a project whose users do not
differ declares none. The knowledge layer keeps only the list of legal role names and what the list
means; what a role may or may not do is behaviour, and lives as Rules in a Feature like any other
behaviour.
_Avoid_: persona, permission, user type

**Reference**:
Material a Feature's knowledge was derived from, recorded so the derivation can be traced back.
Always durable and resolvable from a fresh clone: a tracker key, a committed file, a source file, a
URL, or the person who settled it in conversation. A live running system is not one — nothing about
it can be cited later.
_Avoid_: input, link, attachment, context

**Parked question**:
A question raised while a Feature was being grilled that the person could not answer yet. Held in
the Feature as prose, never as a Rule, so it is never something a Test Case can cover or contradict.
Cleared by the run that answers it. A Feature's Parked questions may be Published to its tracker
References, where answers are gathered; they still come back only through a run that answers them.
_Avoid_: todo, open issue, backlog, open question (the heading of the section that holds them)

**Deferred functionality**:
A whole Functionality that belongs to a Feature but that the engineer chose to leave out of the
deep dive for now, recorded with its reason and the Reference it came from. Held in the Feature as
prose, never as a Rule or a Boundary: it claims no behaviour, so no Test Case can cover or
contradict it, and ownership stays with the Feature. The Feature's Coverage speaks only for what
was walked. Cleared only by a later deep dive that walks it, finds it a duplicate or misreading,
or replaces it with a Boundary.
_Avoid_: backlog, todo, out of scope, pending, non-goal

**Boundary**:
One addressable statement in a Feature that a named piece of behaviour is not this Feature's, naming
the Feature it belongs to when one exists. Never a Rule: it claims nothing about how the system
behaves, only where knowledge about it lives. Makes explicit an edge the reach of the Feature's
Rules would otherwise leave implied.
_Avoid_: out of scope, exclusion, non-goal

**Waiver**:
A Rule's recorded statement that it is deliberately left without a Test Case, and why. The Rule
still states required behaviour and can still be quoted or contradicted; only its coverage is
given up. A Waived Rule without a case is not a gap; one with a case is an Overreach.
_Avoid_: out of scope, skip, untested, exemption

**Dependency**:
A Rule's recorded statement that the behaviour it requires rests on a Rule of another Feature, its
Upstream Rule. Owned by the dependent Rule and part of its knowledge. It claims no behaviour of its
own, so it never makes two Rules incompatible: a Conflict still needs incompatible quoted claims.
A change to an Upstream Rule reaches every Feature downstream of it, however many Dependencies away.
_Avoid_: link, relation, shared rule, reference

**Upstream Rule**:
The Rule a Dependency names, in the Feature that holds it. Whoever depends on it is downstream; the
Upstream Rule itself does not record its dependents.
_Avoid_: parent rule, source rule, master rule

**Reliance**:
A Test Case's recorded statement that its setup rests on a Rule it does not cover, such as a case
that prepares a 700-unit shipment under a maximum-shipment Rule; the Rule may sit in another
Feature. Optional and empty unless the
setup rests on one. Claims no behaviour of its own; a change to that Rule makes the case Stale.
_Avoid_: precondition, setup dependency, indirect cover

**Business question**:
A question about how the system under test should behave, asked of the knowledge layer and answered
by quoting its Rules, with each cited statement carrying how far it can be trusted. Answering is
retrieval, never a verdict. One the knowledge does not answer shows a gap, never something guessed
from the code or the tracker.
_Avoid_: open question, query, free-form question

**Training**:
What the engineer has taught the agent about working on this project, held as one file per command
that takes training, plus the shared Access notes and the shared Coverage categories in
`train/categories.md`. It holds Conventions, Practices, Access notes, Coverage category entries, and
for execution Data recipes, API actions and Upload fixtures, and never a Rule. Only the training
command writes it; the other commands read it before they start.
_Avoid_: config, settings, memory, instructions

**Convention**:
One addressable statement about the *form* of what the agent writes — a Test Case for design, test
code for code gen: its phrasing, its granularity, the permutations worth proposing, or the shape of
the generated code. Never a claim about the system under test: that is a Rule. Held project-wide,
and nothing in the knowledge layer ever references one.
_Avoid_: rule, style guide, template, pattern

**Statability Test**:
The test that keeps a Convention on the form side of the line: it must be statable without naming
any part of the system under test. Schema field names are allowed, system values are not, and the
examples a Convention carries are exempt. What fails it is not a Convention but a proposed Rule,
unless it is a selector, URL or value literal for the system: that is refused with "page facts live
in the test code" and belongs in the test code, not in Training. Applies to Conventions only.
_Avoid_: claim filter, validation

**Practice**:
One addressable statement about how the agent should *work* while running one command: which tool
to fetch with, what to read, what to always ask. It may name where to look or what to ask about, but
never state a fact or a default about how the system behaves: that is a Rule. Never overrides a
command's own Invariants.
_Avoid_: rule, instruction, preference, setting

**Invariant**:
A statement a command makes about its own work that no Training can change, such as writing the
tracker only through Publish.
_Avoid_: rule, guardrail, constraint

**Facet**:
One part of the shape of generated test code that a Convention settles for a stack, such as its
placement, its waits or its assertions. The list is closed: a stack is trained for code gen only
once every facet has a Convention.
_Avoid_: dimension, category, aspect

**Data recipe**:
How a Tester brings a Test Case's setup data into being in the application under test: the path
that creates it, the existing data it may use instead, or both. Held in execution Training and given
only to the Testers of the Features it is scoped to. Says how to prepare data, never how the system
should behave, so it is never a Rule.
_Avoid_: fixture, seed, test data

**API action**:
A mapping, held in execution Training, from wording a Test Case's steps use to the request a Tester
sends for it. Says how to act on the system, never what it should answer.
_Avoid_: endpoint, call

**Upload fixture**:
A file a Tester may upload during a Test Case's steps, named in execution Training: either generated
in a stated format or a file committed beside the knowledge.
_Avoid_: attachment, sample file

**Access note**:
How to reach one kind of Reference that sits behind a login — its host, its auth method, which
environment variable, git-ignored file or connector carries the credential, non-secret identifiers,
and where a person gets the credential. Never the credential itself. Matched to the tracker and URL
References a run fetches, and to the page an Observation is taken from, never pointed at by hand.
For the application under test, either a saved login state or a user and password the CLI logs in
with (ADR-0019). A note may name the Role it logs in as; one with no Role is the default for its
prefix, and serves only Test Cases that carry no Role. One note is one test account.
_Avoid_: credentials, secrets, connection, environment, auto-login

### Change impact

**Verdict**:
The judge's answer for one selected Test Case in one run: Conflict or Current. Only the cases the
judge was given to judge get one, never a Context case; a Stale is raised by the Scan, never by a
Verdict.
_Avoid_: result, score, classification

**Finding**:
A problem raised about a Test Case, or about its Feature when there is no case yet, for a person to
settle: a Conflict, a Stale, an Outcome gap, a Divergence or an Overreach. Settled by changing the
knowledge, by a Dismissal, or for a Stale by a person's statement that the case still holds; the
agent never clears one on its own. A judge's Current Verdict on a later run does clear a judged
Conflict on that case (ADR-0020).
_Avoid_: issue, alert, error

**Scan**:
The mechanical, judgement-free pass over the knowledge layer and the code that finds Integrity
errors, Divergences, Outcome gaps, Review overdue cases, and the Stale cases the Affected Rules
raise. Never blocks, and never asks a judge.
_Avoid_: validation, lint, check

**Conflict**:
A Test Case whose claim cannot hold alongside a current Rule or another Test Case. Established
only by quoting both sides, and the quoted words themselves must be incompatible: an implication
read into them is not a Conflict. A Mirrored value is never a side; disagreeing with one is a
Divergence.
_Avoid_: breaks, contradiction, failure

**Stale**:
A Test Case that covers or relies on an Affected Rule, with no Conflict established. The case may
still be right. Raised mechanically and stored with its cause, since once the Watermark passes the
change only the stored finding remembers it. Stays open until a person states the case still holds,
dismisses it, or the case itself is edited; a later change adds a cause of its own rather than
reopening a settled one.
_Avoid_: outdated, expired, invalidated

**Outcome gap**:
A Test Case that states no expected outcome. Found mechanically, never by judgement, and fixed by
writing the outcome down. The case is still judged on whatever it does claim; the gap is about
what it leaves unsaid. Like an Automation gap, something missing rather than something wrong.
_Avoid_: unjudgeable, empty case, hollow case

**Divergence**:
A disagreement between the knowledge layer and an outside source of truth (the code, or a
Mirrored value). Not a Conflict: Conflicts are internal to the knowledge. Surfaced for a person to
settle; never corrected automatically, and never a reason to stop. A differing label copy (a Tag
or Custom field) is never one.
_Avoid_: conflict, drift, mismatch

**Overreach**:
Knowledge that lands where its Feature said it would not go: a Rule or Test Case about behaviour a
Boundary hands elsewhere, or a Test Case covering a Waived Rule. Not a Conflict: a Boundary or a
Waiver claims nothing about the system, so there is no incompatible claim to quote. Settled by
moving the knowledge, withdrawing the Boundary or Waiver, or a Dismissal.
_Avoid_: out of scope, violation, scope breach

**Owner**:
The one side (the knowledge layer, the code, or the tracker) whose value for a given field counts.
The knowledge layer owns intent; the code owns what runs; the tracker owns its own fields. Every
field has exactly one Owner.
_Avoid_: source of truth, master, authority

**Review**:
A person's recorded statement that they stand behind a Test Case as it is encoded here, pinned to
the version they read. Absent until given, and never written by an agent. Its absence is the normal
state, not a defect: what a claim is worth day to day is read from its provenance.
_Avoid_: approval, sign-off, verification

**Reject**:
The review outcome that removes a Test Case outright, available only while it has no Tracker key.
A case holding a tracker key can only be corrected or Retired, never rejected.
_Avoid_: delete, discard, decline

**Review overdue**:
A Test Case whose review date has passed. A reminder only; the passing of time never makes a
case Stale.
_Avoid_: stale, expired

**Watermark**:
The commit at which a Feature's changes were last assessed. The sole baseline for change impact:
any change since it in the Feature's impact projection — its stripped knowledge without `## Coverage`
and without `coverage_digest` — is a candidate, so a Coverage-only change makes none; Bookkeeping
never counts. It advances only once every Stale the Affected Rules raise is stored and every
selected Test Case was judged; it certifies that, not that every case was read. It names a commit
that exists in history.
A finding carried forward from an earlier run keeps the commit it was found at; it does not move
with the Watermark. Like every commit pin, it records a digest of the impact projection it
compares, so after a squash or rebase merge it re-anchors to the commit whose knowledge matches
(ADR-0033).
_Avoid_: revision, version, timestamp, last-run

**Impact forecast**:
A proposed sort of the Rules a change may reach into Changes, May change and Unaffected, put to a
person to confirm before any Rule is edited. A conversation-time proposal: the Rule edits it leads
to are the record. Only the person's confirmed answer for each Rule whose statement was edited, and
whether they widened it, is kept in the change's run dir, and a Settlement is refused without it.
_Avoid_: impact analysis, rule triage, prediction

**Quick path**:
Taking a small change to an existing Feature from its References to settled, written Test Cases in
one conversation, rather than through a deep dive and design. Chosen by the change's size: once the
confirmed scope grows past the project's threshold, the change is handed to a deep dive.
_Avoid_: fast track, shortcut, light dive

**Settlement**:
Walking a Feature's open Findings and due Reviews with the engineer until each has an answer, then
recording the answers: Dismissals, Reviews, edits and retirements. It judges before it records, so
no Test Case is certified unjudged, and it never writes a Rule.
_Avoid_: resolution, cleanup, triage (one step of the walk)

**Checkpoint**:
A commit the engineer makes at a fixed point in a change's run, which the run waits for: the first
after the Rule edits, so the Stale cases they raise are stored against a commit; the second once
settlement is done and the cases are written, which advances the Watermark.
_Avoid_: save point, snapshot

**Uncited case**:
A Test Case that names no Rule it covers, whatever its Reliance holds, so no change to its own
Feature's Rules can make it Stale. Reported so its links can be filled in; not a Finding.
_Avoid_: unlinked case, orphan case, untraced case

**Uncovered Rule**:
A Rule that no Test Case covers. A Waived Rule is never uncovered.
_Avoid_: coverage gap, rule gap, missing case

**Affected Rule**:
A Rule changed since a Feature's Watermark, or one downstream of a changed Rule through
Dependencies, however many away. Any edit to a Rule counts: its statement, elaboration, Waiver or
Dependency. The Test Cases that cover or rely on one are Stale.
_Avoid_: changed rule, impacted rule, touched rule

**Change bundle**:
What a judge is given about a change, alongside the selected Test Cases it is judging: every Rule
that governs them in full, the other Rules as their statement; the diff since the Watermark; and
the full text of any Test Case the diff touched, and the **Context cases** of the unit's selected
cases. On a first assessment, a Boundary change, or a new or widened Rule, the selection is the
whole Feature. Assembled so both sides of a Conflict can be quoted.
_Avoid_: context, payload, prompt

**Context case**:
A Test Case of another scenario file of the same Feature that shares a governing Rule with a case a
judge unit is judging, so the selection chose it too. The unit's brief carries it read-only, with its
Key and text and no Verdict asked: a Conflict may name it as its other side, and the Conflict is
recorded on the judged case alone. Its own Verdict comes from its own unit, which in turn sees the
judged case as context. Under the brief's size cap it is the first thing left out.
_Avoid_: sibling case, neighbouring case

**Dismissal**:
A person's recorded statement that a finding needs no action, pinned to the commit it was made at.
The finding becomes actionable again only once the Test Case or the Rule it rests on has changed
since. Distinct from resolving a finding, which changes the knowledge.
_Avoid_: ignore, mute, close, wontfix

**Bookkeeping**:
What the framework records *about* the knowledge rather than stating it: the Watermark, every
finding and its Dismissal, the Review stamp, the Review overdue date, the Tracker key and former Tracker keys, the former Keys
kept by the key migration, the Suite key, the Coverage digest (`coverage_digest`), and the Mirrored
values.
Invisible to every question of whether the knowledge changed — the Watermark diff, Review
freshness, a Dismissal re-arming — because a pin is always committed after the commit it names.
Everything that is not Bookkeeping is knowledge, including fields the schema does not yet know.
_Avoid_: metadata, framework fields, state

### Identity

**Key**:
The stable name every reference uses to point at a concept. A file's name or location is never
its identity; moving or renaming a file changes no Key. A Test Case's or Test Scenario's Key is
minted by the framework when the concept is written and never changes; a Tracker key is never one.
_Avoid_: path, id, slug (as identity)

**Test Suite**:
The tracker's container for one Feature's published Test Scenarios and Test Cases, identified by the
Feature's Suite key. Lives in the tracker, never in the knowledge layer, and never defines a
Feature.
_Avoid_: Feature, folder, test plan

**Suite key**:
The permanent identity of the Test Suite a Feature publishes, minted with the Feature and kept
through renames. Bookkeeping that lets Publish recover a Suite it created but did not record.
_Avoid_: Feature slug, Suite Tracker key (as identity)

**Tracker key**:
The key a tracker gives a Test Case, a Test Scenario or a Bug, recorded beside it as Bookkeeping and
never its Key. Apart from the one-off key migration, set only by Publish, Tracker intake, Attach, or
a tracker move the engineer accepts; never edited by hand. A tracker move keeps the old one as a former Tracker key. Test code may name a case
by its current or a former Tracker key, and either resolves to the case.
_Avoid_: Jira key (as the general term), external id

**Retired key**:
A Key or Tracker key whose concept was merged away or deleted, or a Tracker key found to have been
attached in error. Kept on record and never reused, and never resolves to a live concept: test code
naming one is an Integrity error, and a tracker case whose key is retired is never an intake
candidate.
_Avoid_: deleted key, old id

**Attach**:
Recording an existing tracker Test Case or Test Scenario as the Tracker key of a knowledge-layer
entry of the same kind, or an existing tracker Test Suite as a Feature's Suite, through an accepted
`/qa-sync` Card. It changes no Key; an attached Suite is remarked with the Feature's Suite key by
the next Publish.
_Avoid_: link, rekey, match

**Merge**:
Folding two Test Cases, or two Test Scenarios, of one Feature that turn out to be one into a
single survivor chosen by a person. The other's Key is retired, and its Automations, covered Rules,
unresolved findings and child cases move to the survivor. Its Review never does.
_Avoid_: dedupe, combine

**Key prefix**:
The part of an Automation key that names its test class (a class, or a `describe` block), in a
project whose Automation keys the framework mints in the project's own shape. The class carries it,
so renaming the class keeps it. A test in no class takes its file's, from the file's header.
Two classes may share one: the rest of the key keeps every key unique.
_Avoid_: class code, id prefix (as the framework's term)

**Key carrier**:
The place in a test's own source that holds its Automation key, named per stack: an annotation in
Kotlin, a tag in Playwright (ADR-0005, ADR-0022).
_Avoid_: annotation (as the general term), marker

**Unkeyed test**:
An Automation in the code that carries no Automation key yet, so nothing in the knowledge layer
can point at it. A normal state, never an error: it is a proposal to mint a key.
_Avoid_: untracked test, orphan test

**Tracker intake**:
Adding a Test Case or Test Scenario that exists in the tracker but not in the knowledge layer,
transcribed as it stands there and left unreviewed. Never produces a Rule: Rules come only from
grilling a Feature.
_Avoid_: import (the name of a Feature), sync, reference intake

**Sync**:
Reconciling the knowledge layer with the tracker and the code on one Card: Mirror refresh, Tracker
intake, Attach, Merge and binding Automations to their cases. It reads the tracker and never writes
it; what reaches the tracker goes by Publish.
_Avoid_: publish, push, pull

**Publish**:
The one write qa-skills makes to a tracker, after the engineer accepts a Card listing every write:
sending Test Cases with a fresh Review, a Feature's Parked questions, and Bug drafts, to the
tracker. It also carries out tracker repairs a Merge left pending. It writes only what the
knowledge layer owns, and sets the tracker's own fields only when it creates a case or a bug. A
published case that is edited is not published again until it is Reviewed again. Recovering a case
or a bug it already created writes nothing to the tracker and needs no fresh Review: it only records
the Tracker key.
_Avoid_: push, export, sync, upload

**Unlanded case**:
A tracker Test Case that qa-skills Published and the knowledge layer on the default branch does not
hold, such as one published from a branch that never merged. Told apart from an intake candidate
by the mark Publish leaves on it. Reported for a person to settle, by Tracker intake or by retiring
it in the tracker by hand; never deleted automatically.
_Avoid_: orphan, stray case, dangling case

**Unlanded Suite**:
A tracker Test Suite whose mark is a live Suite key that no Feature on the default branch holds,
and that no Feature names as its Suite, such as one published from a branch that never merged.
Settled by a person, by Attaching it to an existing Feature or by retiring it in the tracker by
hand; never taken in as a new Feature.
_Avoid_: orphan suite, stray suite

**Unclaimed Automation**:
An Automation that carries an Automation key but that no Test Case's `automates` names. A
Divergence, not an error: it is a proposal to link it to a case.
_Avoid_: orphan automation, unbound test

**Integrity error**:
A reference that cannot resolve or does not match its kind's pattern: a dead binding, a malformed
key, a key naming two things. Unlike a Divergence, where both sides resolve and disagree, here
one side does not resolve at all. Never corrected automatically.
_Avoid_: broken link, invalid reference, drift

### Delegation

**Delegate**:
The in-session subagent a command hands its judging or filling to (a judge for change impact, a
filler for design), run on the model of the Tier the framework binds it to. Every Delegate runs
under the session's provider; another CLI or provider is never a Delegate (ADR-0020). A Delegate
returns text and never writes; the orchestrator writes what it returns (ADR-0010).
_Avoid_: agent, worker, runner, executor, lane, relay, cli Delegate

**Tier**:
One of three weights of model the engineer maps to a model label: `deep`, `standard` or `light`.
The framework binds every Delegate and Scout to one Tier; a project never rebinds them. A Tier left
unpicked runs on `inherit`, the session's own model (ADR-0021).
_Avoid_: lane, level, effort, model class

**Fallback**:
`inherit`, the session's own model, which runs a unit whenever the harness refuses its Tier's model.
Using it is announced, never written back.
_Avoid_: default delegate, backup model, Fallback Delegate

**Scout**:
An in-session subagent that does a command's noisy fetching outside the orchestrator's context and
leaves what it found in one output file of the Run, never in the repository. A UI scout observes
the live application for an `observe:` input to `/qa-deep-dive`, navigating and reading only; a
tracker scout fetches `/qa-sync`'s tracker payload. A Scout is not a Delegate: it fetches rather
than judges, though it too runs on its Tier's model. Its failure is handled as the command already
handles a failed fetch (ADR-0017, ADR-0018, ADR-0021).
_Avoid_: agent, researcher, gatherer, crawler

**Publisher**:
The in-session subagent that makes a Publish's tracker writes, doing exactly what its brief lists
and leaving what it created in one output file of the Run. The only agent that ever writes to a
tracker. Not a Scout, which never writes, and not a Delegate, since it judges nothing.
_Avoid_: writer, pusher, sync agent

**Observation**:
A dated, committed record of what a UI scout saw in the live application, written at the
engineer's `observe:` request and never edited afterwards. Evidence of current behaviour, never of
required behaviour: it enters a Feature as a `file:` Reference, and what it shows becomes a Rule
only once the engineer confirms it. It never carries a secret. The live application itself is
never a Reference (ADR-0016).
_Avoid_: snapshot, recording, crawl

**Tester**:
The in-session subagent that carries out a Test Case's steps in the live application and reports
what happened against its Expected-result paragraphs. Not a Scout, which explores rather than
follows steps, and not a Delegate, since it judges no knowledge.
_Avoid_: executor, runner, agent, UI scout

**Application target**:
A named, non-production deployment of the application under test, from the project's own list, that
Executions and Automation runs are pointed at. Never a commit.
_Avoid_: environment, host, target (alone)

**Execution**:
One Tester's pass over one Test Case in the live application, invoked through `/qa-execute`. Never
the running of an Automation, which is the test code's own job.
_Avoid_: run (a Run is one command invocation), test run, replay

**Execution result**:
The outcome of one Execution: Passed, Failed, or Blocked. Failed only when an Expected-result
paragraph was seen not to hold; Blocked, with its reason, whenever the Tester never reached one to
judge, or when the guard stopped the Execution, which decides the result even after a paragraph
was seen failing. Not a Verdict, which judges whether a case still matches its Feature, not whether the
application meets the case; so it never raises a Finding.
_Avoid_: verdict, status, pass/fail

**Execution record**:
A dated, committed record of one `/qa-execute` Run's Automation results and Execution results, never
edited afterwards. Held beside the knowledge, never in it: no Feature cites it and no question of
whether the knowledge changed ever sees it. It never carries a secret.
_Avoid_: report, log, test run

**Fix item**:
One failing or flaky Automation handed to `/qa-codefix` to repair, from a completed `/qa-execute`
Run or the engineer's own request. It ends done, failed with its reason, or handed off when the
cause is the application's, which becomes a Bug draft and is never repaired in the test code.
_Avoid_: fix task, repair job, bug item

**Bug draft**:
A bug written from a failing Test Case's Execution or a code fix hand-off, held in `.qa/bugs/` until
`/qa-publish` creates it in the tracker; afterwards it keeps the bug's Tracker key as the record of
that link and is never edited again. Beside the knowledge, never in it. It never carries a secret.
_Avoid_: bug report, defect, issue, ticket

**Run**:
One invocation of a `/qa-*` command, named by a random id minted at its start.
_Avoid_: session (the agent conversation, which spans many Runs), job, pass

### Engineer interaction

**Card**:
The whole set of changes a command proposes, shown to the engineer in full before anything is
written, with prose written by the model from CLI-supplied data (ADR-0024). Every item that needs
an answer carries its question; nothing takes effect until the engineer's Reply is accepted.
_Avoid_: form, prompt, preview, dry run

**Reply**:
The engineer's free-form answer to a Card, or to one case of a triage walk, mapped by the model
to JSON decisions that the CLI validates against the run dir (ADR-0024). Anything the answer
does not clearly address stays open; ambiguity is asked about, never inferred.
_Avoid_: response, payload, approval (the confirmation a Reply may still need)

**Card page**:
A Card shown as an interactive page on the engineer's own machine, offered only when the engineer
opts in. Its submission is a Reply the engineer pastes back into the conversation, so it is mapped
and validated like any other.
_Avoid_: report, review page (a Review is something else), artifact, form

**Agent pointer**:
A short note `/qa-init` reports for the engineer to paste into the repository's own agent guidance,
never written by the framework. It tells any agent that `.qa/` is managed by qa-skills and changed
only when the engineer or a `/qa-*` command asks, and which `/qa-*` command to name to the user for
a request; the agent keeps doing the user's task and recommends the command, never runs it.
_Avoid_: notice, guidance line, agent guidance entry

**Next step**:
One thing the knowledge layer is waiting on, named with the command, or the person's action, that
settles it. Reported by `/qa-next`, never recorded. Not a Finding: it need not be a problem, and an
unreviewed Test Case is never one.
_Avoid_: todo, task, action item, suggestion

**Next steps page**:
Every Next step, shown as a read-only page on the engineer's own machine. A snapshot, never a Card
page: it proposes no change and takes no Reply.
_Avoid_: report, dashboard, Card page

**Knowledge page**:
The knowledge layer as it stands, for one Feature or for all of them, shown as a read-only page on
the engineer's own machine: Rules, Test Scenarios and Test Cases with their labels, Coverage,
Parked questions, Deferred functionality, gaps and open Findings. A snapshot, never a Card page:
it proposes no change and takes no Reply, and it holds no Next steps.
_Avoid_: report, dashboard, coverage report, test plan, Card page, Next steps page
