// @ts-check
// Sealed Card lifecycle: rebuild, validate decisions, issue and verify confirmations, then write.
// Adapters supply build/data/decisions/apply, refusal facts and run-file options.
import { createHash } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { parseDecisions } from "./refusal.mjs";
import { join } from "node:path";
import { changedPaths, commitLine, writeAll } from "./changeset.mjs";
import { backfillChangeset } from "./pin-digest.mjs";
import { readRunFile } from "./run-dir.mjs";
/** @import { RunFileResult } from "./run-dir.mjs" */

/**
 * A refusal fact: a code, its human line, and the data it carries.
 * @typedef {{ code: string, line?: string } & Record<string, unknown>} CardRefusal
 */

/**
 * The run-file options an adapter hands `readRunFile` when it reads its Card.
 * @typedef {{ by: string | string[], restart: string | string[], missing?: string }} CardRunOptions
 */

/**
 * The JSON decisions an adapter validates, and the pending decisions a Card record keeps.
 * @typedef {object} CardDecisions
 * @property {number[] | "all"} [take]
 * @property {number[]} [drop]
 * @property {Record<string, Record<string, unknown>>} [edits]
 * @property {number[]} [confirm]
 * @property {number[]} [confirmed]
 * @property {number[]} [discard]
 * @property {Record<string, Record<string, unknown>>} [fields]
 * @property {Record<string, string[]>} [attach]
 * @property {Record<string, string>} [name]
 * @property {Record<string, string>} [merge]
 * @property {CardDecisions} [input]
 * @property {CardRefusal[]} [errors]
 */

/**
 * The `card.json` record of a sealed Card, as `card-run` writes it and reads it back.
 * @template [Input=unknown]
 * @template {Record<string, unknown>} [Data=Record<string, unknown>]
 * @typedef {object} CardRecord
 * @property {string} kind
 * @property {string} digest
 * @property {Input} input
 * @property {Data} [card]
 * @property {CardDecisions} [pending]
 */

/**
 * A write in the changeset an adapter's apply hands the lifecycle.
 * @typedef {{ path: string, text: string, absent?: boolean }} CardWrite
 */

/**
 * The changeset an adapter's apply hands the lifecycle to write.
 * @typedef {{ writes: CardWrite[], deletes?: string[] }} CardChangeset
 */

/**
 * What an adapter's build returns: a Card to seal, or the refusals that stopped it.
 * @template [Card=unknown]
 * @typedef {{ card: Card, seal?: unknown, refused?: undefined } | { card?: Card, seal?: unknown, refused: CardRefusal[] }} CardBuild
 */

/**
 * A pending confirmation: the decisions kept until the caller confirms them, and what the Card shows.
 * @typedef {{ decisions: CardDecisions } & Record<string, unknown>} CardConfirm
 */

/**
 * An applied change: its changeset, the commit message, and the report the adapter renders for it.
 * @template {Record<string, unknown>} [Data=Record<string, unknown>]
 * @typedef {{ changeset: CardChangeset, message: string, report: (commit: string | null) => unknown, data?: Data }} CardApplyDone
 */

/**
 * What an adapter's apply returns: a refusal, a pending confirmation, or the changeset to write.
 * @template {Record<string, unknown>} [Data=Record<string, unknown>]
 * @typedef {{ refused: CardRefusal[], rebuild?: boolean, data?: Data, confirm?: undefined } | { confirm: CardConfirm, refused?: undefined, data?: undefined, rebuild?: undefined } | (CardApplyDone<Data> & { confirm?: undefined, refused?: undefined, rebuild?: undefined })} CardApplyOut
 */

/**
 * A refused call, which may ask for a rebuild.
 * @typedef {{ ok: false, rebuild: boolean, refusals: CardRefusal[], exit: number }} CardRefused
 */

/**
 * A Card shown after a successful build.
 * @template {Record<string, unknown>} [Data=Record<string, unknown>]
 * @typedef {{ ok: true, dir: string, card: Data, exit: number }} CardShown
 */

/**
 * An applied Card: its adapter's data, or a pending confirmation.
 * @template {Record<string, unknown>} [Data=Record<string, unknown>]
 * @typedef {{ ok: true, report: unknown, exit: number } & Data | ({ ok: false, confirm: boolean, exit: number } & CardConfirm)} CardApplied
 */

/**
 * The command context the lifecycle reads: the repository it writes, and the root it backs digests up to.
 * @typedef {{ repo: string, root?: string }} CardContext
 */

/**
 * The Card adapter `init`, `sync` and `publish` supply to the sealed lifecycle.
 * @template {CardContext} [Ctx=CardContext]
 * @template [Input=unknown]
 * @template [Card=unknown]
 * @template {Record<string, unknown>} [Data=Record<string, unknown>]
 * @typedef {object} CardAdapter
 * @property {string} kind
 * @property {CardRunOptions} run
 * @property {boolean} [keepData]
 * @property {(code: string, data?: Record<string, unknown>) => CardRefusal} fact
 * @property {(ctx: Ctx, input: Input) => CardBuild<Card>} build
 * @property {(ctx: Ctx, card: Card) => Data} data
 * @property {(ctx: Ctx, card: Card, input: CardDecisions) => CardDecisions} decisions
 * @property {(ctx: Ctx, card: Card, decisions: CardDecisions, input: Input) => CardApplyOut<Data>} apply
 */

/**
 * The sealed lifecycle: show a Card, then apply decisions against it.
 * @template {CardContext} [Ctx=CardContext]
 * @template [Input=unknown]
 * @template [Card=unknown]
 * @template {Record<string, unknown>} [Data=Record<string, unknown>]
 * @typedef {object} CardLifecycle
 * @property {(ctx: Ctx, dir: string | (() => string), input: Input) => CardShown<Data> | CardRefused} card
 * @property {(ctx: Ctx, dir: string, text: string) => CardApplied<Data> | CardRefused} apply
 */

const CARD_FILE = "card.json";

/** @param {unknown} seal @returns {string} */
const digestOf = (seal) => createHash("sha256").update(JSON.stringify(seal)).digest("hex").slice(0, 16);

/**
 * @template {CardContext} [Ctx=CardContext]
 * @template [Input=unknown]
 * @template [Card=unknown]
 * @template {Record<string, unknown>} [Data=Record<string, unknown>]
 * @param {CardAdapter<Ctx, Input, Card, Data>} adapter
 * @returns {CardLifecycle<Ctx, Input, Card, Data>}
 */
export function cardRun(adapter) {
  const { kind } = adapter;
  /**
   * @param {CardRefusal[]} refusals
   * @param {boolean} [rebuild]
   * @param {number} [exit]
   * @returns {CardRefused}
   */
  const refused = (refusals, rebuild = false, exit = 1) => ({ ok: false, rebuild, refusals, exit });
  /** @param {string} code @returns {CardRefused} */
  const stale = (code) => refused([adapter.fact(code, {})], true);

  return {
    card(ctx, dir, input) {
      const built = adapter.build(ctx, input);
      if (built.refused !== undefined) {
        if (typeof dir === "string") rmSync(join(dir, CARD_FILE), { force: true });
        return refused(built.refused);
      }
      const at = typeof dir === "function" ? dir() : dir;
      writeFileSync(join(at, CARD_FILE), `${JSON.stringify(/** @type {CardRecord<Input, Data>} */ ({ kind, digest: digestOf(built.seal), input, ...(adapter.keepData && { card: adapter.data(ctx, built.card) }) }), null, 2)}\n`);
      return { ok: true, dir: at, card: adapter.data(ctx, built.card), exit: 0 };
    },

    apply(ctx, dir, text) {
      /** @type {RunFileResult<CardRecord<Input, Data>>} */
      const recorded = readRunFile(dir, CARD_FILE, /** @type {{ by: string | string[], restart: string | string[], missing: string | undefined }} */ (adapter.run));
      if (recorded.error) return refused([adapter.fact("run_dir", { reason: recorded.error })], false, 2);
      if (recorded.value === null) return stale("no_card");
      if (/** @type {CardRecord<Input, Data>} */ (recorded.value).kind !== kind) return stale("card_changed");
      const built = adapter.build(ctx, /** @type {CardRecord<Input, Data>} */ (recorded.value).input);
      if (built.seal === undefined || digestOf(built.seal) !== /** @type {CardRecord<Input, Data>} */ (recorded.value).digest || (adapter.keepData && JSON.stringify(/** @type {CardRecord<Input, Data>} */ (recorded.value).card) !== JSON.stringify(adapter.data(ctx, /** @type {Card} */ (built.card))))) return stale("card_changed");

      /** @type {{ input?: CardDecisions, errors?: CardRefusal[] }} */
      const parsed = parseDecisions(text);
      if (parsed.errors) return refused(parsed.errors.map(({ code, ...data }) => adapter.fact(code, data)));
      const { input } = /** @type {{ input: CardDecisions }} */ (parsed);
      const decisions = adapter.decisions(ctx, /** @type {Card} */ (built.card), input);
      if (decisions.errors?.length) return refused(decisions.errors);
      const pending = /** @type {CardRecord<Input, Data>} */ (recorded.value).pending;
      const confirmed = input.confirm ?? [];
      if (confirmed.length && (!pending || !isDeepStrictEqual(input, pending))) return refused([adapter.fact("confirmation_not_pending")]);
      const out = adapter.apply(ctx, /** @type {Card} */ (built.card), decisions, /** @type {CardRecord<Input, Data>} */ (recorded.value).input);

      if ("refused" in out) return { ...refused(out.refused ?? [], out.rebuild ?? false), ...out.data };
      if (out.confirm) {
        writeFileSync(join(dir, CARD_FILE), `${JSON.stringify(/** @type {CardRecord<Input, Data>} */ ({ .../** @type {CardRecord<Input, Data>} */ (recorded.value), pending: out.confirm.decisions }), null, 2)}\n`);
        return { ok: false, confirm: true, ...out.confirm, exit: 0 };
      }

      const { changeset, message, report } = out;
      // `changeset.mjs` is not adopted yet, so `changedPaths` infers `deletes: never[]` from its default.
      const paths = changedPaths(/** @type {{ writes: CardWrite[], deletes?: never[] }} */ (changeset));
      if (paths.length) {
        const written = writeAll(ctx.repo, backfillChangeset(ctx.root, ctx.repo, changeset));
        if (written.error) return refused([adapter.fact("write_failed", { reason: written.reason })]);
      }
      if (pending) {
        delete /** @type {CardRecord<Input, Data>} */ (recorded.value).pending;
        writeFileSync(join(dir, CARD_FILE), `${JSON.stringify(/** @type {CardRecord<Input, Data>} */ (recorded.value), null, 2)}\n`);
      }
      return { ok: true, ...out.data, report: report(paths.length ? commitLine(paths, message) : null), exit: 0 };
    },
  };
}
