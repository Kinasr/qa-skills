# Multi-Run execution

Multi-Run execution begins after the engineer's yes: once §2's confirm has been presented in order
and the engineer has said yes, and for an Unguarded Run once its explicit acknowledgement is given
too. The confirm is §3's, one `--dir` per Run in `runs` (one Run per Target in `targets` order); the
sequence below starts once every Run is confirmed, without interleaving Runs.

## Sequential Runs

1. For each Run in `runs` order, finish every execution step before starting the next Run:
   - `execute automation --dir <dir>`
   - the `execute next` / Tester / `execute record` loop
   - `execute ingest --dir <dir>` (word every section in order)

## Stop rules

- **Unreachable target**: an unreachable target stops only its own Run. Ingest that stopped Run so its completed results and not-run Executions are recorded, then move on to the next Run in `runs`. That stopped Run gets no follow-ups; relay its resume command at the end.
- **Engineer stop**: an engineer stop ends every unfinished Run. Ingest the active Run and any other started Run that has not been ingested yet, report unstarted Runs as not run, relay each stopped Run's resume command at the end, and start no follow-ups.

## Follow-ups and training offer

When no engineer stop ended the sequence, after every Run has ingested:

1. For each Run in `runs` order that was not stopped, run the §6 follow-up steps (`execute follow-ups --dir <dir>`, `/qa-codefix --run <dir>`, refresh `execute follow-ups` when `/qa-codefix` ran, `/qa-bug --run <dir>`, `execute summary --dir <dir>`, and any `publish.ask` action) against that Run's `--dir`. Hold the `/qa-train` offer until every Run's follow-ups finish.
2. After all Runs complete their follow-ups, make a single `/qa-train` offer covering every Target made stale across the Runs.
