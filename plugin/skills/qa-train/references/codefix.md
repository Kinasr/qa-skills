# Codefix Training

For `/qa-train codefix`, use the Practices dialogue and gate in [practices.md](practices.md).
Write `.qa/train/codefix.md` through `train check codefix` and `train apply codefix` only. A repo
that still holds `.qa/train/fix.md` (`key: fix`, from before the rename) keeps that file: the CLI
reads and writes it, so a draft of it keeps `key: fix`, until the engineer renames it to
`train/codefix.md` with `key: codefix`.

Its frontmatter allows `fix_attempts` (integer 1–5, default 3), `flaky_repeats`
(integer 3–10, default 5), and `pr` (`on-request`, the default, or `always`).
Absent settings use these defaults; record only what the engineer chooses.

Practices steer diagnosis and repair in both chained and standalone runs. They cannot relax
`/qa-codefix`'s Invariants: scope, identity, assertions, stale-literal sources and the route-specific
hand-off rules still apply. No credential or target behaviour belongs in this file.
