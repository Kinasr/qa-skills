// @ts-check
// `impact entry`: the front door of `/qa-impact`. The command has one form now, the quick path
// (`/qa-impact <feature-key> [<ref>...]`); the judge flow's flags and its read-only report went to `/qa-design`
// and `/qa-next` (ADR-0043). Every old invocation gets a refusal that names its replacement, so an
// old habit fails clearly. It reads `.qa/` only to check the Feature exists, and writes nothing.
import { PATTERN } from "./keys.mjs";
import { fact, refuse } from "./impact-json.mjs";
import { scan } from "./scan.mjs";

/**
 * @param {{ root: string, args: string[], persist?: boolean, review?: string | boolean, target?: string | boolean }} options
 * @returns {import("./cli.mjs").CommandResult}
 */
export function enter({ root, args, persist = false, review, target }) {
  const references = args.slice(1);
  const reviewed = typeof review === "string" ? review : undefined;
  for (const key of [args[0], reviewed]) {
    if (key !== undefined && !PATTERN.slug.test(key)) return refuse("not_feature_key", { given: key });
  }
  const placeholder = reviewed ?? args[0] ?? "<feature-key>";
  /** @type {Array<Record<string, unknown>>} */
  const refusals = [];
  if (persist) refusals.push(fact("persist_retired", { replacement: `/qa-design ${placeholder}` }));
  if (review !== undefined && review !== false) refusals.push(fact("review_retired", { replacement: `/qa-design ${placeholder} --review` }));
  if (target !== undefined) refusals.push(fact("target_retired", { given: target, replacement: `/qa-design ${placeholder}` }));
  if (refusals.length) return { exit: 2, json: { ok: false, refusals } };
  if (args[0] === undefined) return refuse("read_only_retired", { replacement: "/qa-next" });
  if (!scan(root, { feature: args[0] }).history.features.some((f) => f.feature === args[0])) return refuse("no_feature", { slug: args[0], root });
  return { exit: 0, json: { ok: true, route: "quick", feature: args[0], references, next_step: "impact quick" } };
}
