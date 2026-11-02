# Smoke-testing a Tier's model label

Smoke-test each distinct picked label other than `inherit` once, however many Tiers pick it:

1. `init smoke --model <label> [--dir <run-dir>]` writes the brief and the subagent's prompt, and
   prints the paths `prompt` and `reply`.
2. Spawn one subagent with that model; copy the `prompt` file's text intact. Save its final message
   to the `reply` path; when the harness refuses the spawn, save the refusal's message there. When
   the subagent ends with no message, save nothing: the CLI judges the reply missing.
3. `init smoke --model <label> --reply <reply> --dir <run-dir>` judges it. On `ok: false`, say what
   happened (`reason` `missing`, `empty` or `wrong`, with the reply's `excerpt`) and offer retry,
   change the label, or skip: act on the engineer's answer.
