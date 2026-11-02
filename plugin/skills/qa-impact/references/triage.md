# Chat triage walk

Loop until `walk` returns `done: true`. A `--review` run walks unreviewed and Review overdue cases,
even with a fresh Review: accepting clears a passed `review_by` with the Review stamp; leaving changes nothing.

1. Run `design walk --dir <dir>` (`--by human:<name>` the first time). When `done` is true, give
   `merge_rules` and `changeset` intact, then §5.
2. Present `case`: its `label`, `why` it is walked, each numbered finding (`kind`, `code`, `line`), its
   review and its `choices`. `scenario_divergences` are shown, not settled. Wait for the answer.
3. **A fix comes first.** When the engineer answers any finding `fix`, the change is made before
   the decisions are sent: the engineer makes it, or tells you what to change and you make exactly
   that edit to the knowledge (the case, or the Rule it rests on). Findings, Dismissals, Review
   stamps and Watermarks stay the CLI's to write. Run `check-file` on the file you edited. A `fix`
   answered with `accept` needs the fix committed first: the Review pins that commit.
4. Translate only clear answers; ask on ambiguity. Retain clear decisions across clarification
   turns. Send `design triage --dir <dir> --stdin` when every finding and review is answered:

Shape only:

```json
{"findings":[{"n":"<number>","answer":"<choice>","reason":"<optional line>","ticket":"<optional key>"}],"review":"<choice>"}
```

   A finding's `answer` is `dismiss`, `keep`, `fix` or, for a Stale only, `holds` (the case is still
   right after the change); `reason` (one line) and `ticket` go with `dismiss` only. The `review` is
   `accept`, `leave`, `reject` or `retire`: `accept` may go with a `fix`; `reject` (no Tracker key) and
   `retire` (a Tracker key held) stand alone, only when offered. `retire` removes the case, keeps its
   Key and Tracker key as Retired keys and queues the tracker repair for `/qa-publish`; report the
   `settled.retirement.automation` keys (`unlinked` ones now have no case) and never write the tracker.
5. `ok: true`: say what `settled` records; go back to 1.
