// @ts-check
// The code side of `/qa-sync`'s card (ADR-0005, ADR-0022): the Key-carrier
// declaration the code needs, and the code repairs `scan` proposes (lib/scan-code.mjs). Nothing here
// re-derives a proposal: each item is one `binding_proposal` of the scan, and its target is the one
// the scan gave. An item may be edited by the person before it is applied (`edits` names the
// fields). Whatever is particular to the stack (the declaration, how a carrier is written, the
// words) is its adapter's (lib/stack.mjs).
//
// The key is written under the first name in `annotation_map.automation_key`.
//
// With `automation_key_mint` (ADR-0013), every key starts with its class's Key prefix: a class
// with none has one proposed on the card, its own item, which the keys it prefixes `require`; and
// the Unkeyed tests of a class whose prefix breaks the recipe get no item, only a reason
// (`skipped` on the code section).
/**
 * @import { MintRecipe } from "./keys.mjs"
 * @import { StackDeclaration } from "./stack.mjs"
 */
import { carrierNames } from "./code-source.mjs";
import { wordsOf } from "./stack.mjs";
import { prefixFits, prefixRule } from "./keys.mjs";

/**
 * Declaration adapter shape.
 * @typedef {{
 *   state(ctx: unknown, role?: string): { status: string, home?: unknown, [key: string]: unknown },
 *   item(name: unknown, state: unknown): Record<string, unknown>,
 *   check(repo: string, item: unknown): { problem?: Record<string, unknown> | null, path: string, home: unknown, [key: string]: unknown },
 *   text(home: unknown, annotation: unknown, role?: string): string,
 *   [key: string]: unknown,
 * }} SyncCodeDeclarationAdapter
 */

/**
 * Prefix carrier object within Annotation.
 * @typedef {{
 *   name: string,
 *   home: string | null,
 * }} SyncCodePrefixCarrier
 */

/**
 * The Key carrier object returned by annotation().
 * @typedef {{
 *   name: string | null,
 *   names: string[],
 *   home: string | null,
 *   prefix?: SyncCodePrefixCarrier,
 * }} SyncCodeAnnotation
 */

/**
 * Stack adapter shape read by sync-code.
 * @typedef {{
 *   needsDeclaration?: boolean,
 *   declaration?: SyncCodeDeclarationAdapter,
 *   words: { carrier: string, write?: string },
 *   headerText: (prefix: string) => string,
 *   carrierText: (name: string, prefix: string) => string,
 *   [key: string]: unknown,
 * }} SyncCodeStackAdapter
 */

/**
 * An item on a sync card section.
 * @typedef {{
 *   code?: string,
 *   annotation?: unknown,
 *   function?: unknown,
 *   functions?: unknown[],
 *   key?: string,
 *   n?: number,
 *   bind?: string[],
 *   replace_in?: string[],
 *   automation?: unknown,
 *   file?: unknown,
 *   class?: { path?: string, [key: string]: unknown },
 *   prefix?: string | null,
 *   key_prefix?: unknown,
 *   keep?: number | null,
 *   requires?: unknown[],
 *   [key: string]: unknown,
 * }} SyncCodeCardItem
 */

/**
 * The Plan interface used by sync-code.
 * @typedef {{
 *   declare(path: string, text: string, home: unknown, role: string): void,
 *   key(item: unknown, fn: unknown, bind: unknown, keyPrefix?: unknown): unknown,
 *   keyPrefix(cls: unknown, prefix: unknown): void,
 *   fileKeyPrefix(file: unknown, prefix: unknown): void,
 *   annotate(fn: unknown, handle: unknown): void,
 *   rekey(fn: unknown, from: unknown, handle: unknown): void,
 *   bind(ref: { key: string }, key: unknown): void,
 *   unbind(ref: { file: unknown, key: unknown }, aut: unknown): void,
 *   replace(ref: { key: string }, from: unknown, key: unknown): void,
 *   [key: string]: unknown,
 * }} SyncCodePlan
 */

/**
 * Function proposal in a duplicate key situation.
 * @typedef {{
 *   name: string,
 *   file: string,
 *   line: number,
 *   bind?: string[],
 *   key_prefix?: { problem?: string, proposed?: boolean, [key: string]: unknown },
 *   [key: string]: unknown,
 * }} DuplicateFunctionProposal
 */

/**
 * Descriptor of a key prefix proposal.
 * @typedef {{
 *   prefix?: string,
 *   class?: { file?: string, path?: string },
 *   file?: string,
 *   proposed?: boolean,
 *   problem?: string,
 *   [key: string]: unknown,
 * }} KeyPrefixDescriptor
 */

/**
 * State of card code section.
 * @typedef {{
 *   items: SyncCodeCardItem[],
 *   skipped: Array<Record<string, unknown>>,
 *   prefixes: Map<string, SyncCodeCardItem>,
 * }} SyncCodeCardState
 */

/**
 * Sync context projection for sync-code.
 * @typedef {{
 *   repo: string,
 *   config: {
 *     annotationMap?: unknown,
 *     autRecipe?: unknown,
 *     autMints?: boolean,
 *     autExternal?: boolean,
 *     autMintProblem?: unknown,
 *     [key: string]: unknown,
 *   },
 *   stack: {
 *     adapter?: unknown,
 *     [key: string]: unknown,
 *   },
 *   scan: {
 *     run_health: Array<Record<string, unknown>>,
 *     results: Array<Record<string, unknown> & { kind: string, code: string }>,
 *     [key: string]: unknown,
 *   },
 *   index: {
 *     cases: { has(key: string): boolean },
 *     [key: string]: unknown,
 *   },
 *   codeCard?: SyncCodeCardState,
 *   [key: string]: unknown,
 * }} SyncCodeContext
 */

/**
 * A section of the sync card.
 * @typedef {{
 *   key: string,
 *   title: string | ((ctx: SyncCodeContext) => string),
 *   codes: string[],
 *   only?: (ctx: SyncCodeContext) => boolean,
 *   items(ctx: SyncCodeContext): SyncCodeCardItem[],
 *   apply(ctx: SyncCodeContext, item: SyncCodeCardItem, plan: SyncCodePlan): Record<string, unknown> | null,
 *   notes?: (ctx: SyncCodeContext) => Array<Record<string, unknown>>,
 *   info?: (ctx: SyncCodeContext) => Record<string, unknown>,
 * }} SyncCodeSection
 */

/**
 * @param {string} s
 * @returns {string}
 */
const capital = (s) => s[0].toUpperCase() + s.slice(1);

const HEALTH_SKIPS = new Set(["no_scanner", "adapter_unavailable", "no_code"]);

// The Key carrier `/qa-sync` writes: `{name, names, home, prefix}`. `name` is the first
// `automation_key` name (null when there is none), `names` every name the scan reads the key
// under, and `home` where the code declares or imports it (the stack adapter's `declaration`), or
// null while it is missing or the stack declares nothing (a proposed declaration counts only once it
// is accepted). `prefix` is the Key-prefix class carrier, `{name, home}` alike, with
// `automation_key_mint`.
/**
 * @param {SyncCodeContext} ctx
 * @returns {SyncCodeAnnotation}
 */
export function annotation(ctx) {
  const names = carrierNames(/** @type {Record<string, unknown>} */ (ctx.config.annotationMap), "automation_key");
  const decl = declarationOf(ctx);
  const homeOf = (/** @type {string} */ role) => {
    const state = decl ? decl.state(ctx, role) : { status: "missing" };
    return state.status === "missing" ? null : /** @type {string | null} */ (state.home);
  };
  /** @type {SyncCodeAnnotation} */
  const out = { name: names[0] ?? null, names, home: names.length ? homeOf("automation_key") : null };
  const [prefix] = carrierNames(/** @type {Record<string, unknown>} */ (ctx.config.annotationMap), "automation_key_prefix");
  if (ctx.config.autRecipe && prefix) out.prefix = { name: prefix, home: homeOf("automation_key_prefix") };
  return out;
}

// The stack adapter's `declaration` (lib/stack.mjs), or null when its carriers need none.
/**
 * @param {SyncCodeContext} ctx
 * @returns {SyncCodeDeclarationAdapter | null}
 */
const declarationOf = (ctx) => {
  const { adapter } = /** @type {{ adapter?: SyncCodeStackAdapter | null }} */ (ctx.stack);
  return adapter?.needsDeclaration ? (/** @type {SyncCodeDeclarationAdapter} */ (adapter.declaration)) : null;
};

/**
 * @param {SyncCodeContext} ctx
 * @returns {boolean}
 */
const codeBindingRuns = (ctx) =>
  !ctx.scan.run_health.some((h) => HEALTH_SKIPS.has(/** @type {string} */ (h.code))) && carrierNames(/** @type {Record<string, unknown>} */ (ctx.config.annotationMap), "automation_key").length > 0;

// The two kinds of item the `declaration` section can carry, by `code`: which carrier's role
// `plan.declare` sets.
/** @type {Record<string, { role: string }>} */
const DECLARATION_KINDS = {
  declare_annotation: { role: "automation_key" },
  declare_prefix_annotation: { role: "automation_key_prefix" },
};

// One item of the `declaration` section: the carrier the code declares nowhere, and where its
// declaration would go (the adapter's). Shared by both kinds in `DECLARATION_KINDS`, which differ in
// `code`, the carrier `name`, and the role whose state is read for it.
/**
 * @param {string} code
 * @param {SyncCodeContext} ctx
 * @param {unknown} name
 * @param {string} role
 * @returns {SyncCodeCardItem}
 */
function declarationItem(code, ctx, name, role) {
  const decl = /** @type {SyncCodeDeclarationAdapter} */ (declarationOf(ctx));
  return { code, ...decl.item(name, decl.state(ctx, role)) };
}

// Whether the card carries a declaration item for the Key-prefix carrier (ADR-0013): `ann` (from
// `annotation(ctx)`) carries a `prefix` (the recipe is set and names the carrier), the card proposes
// at least one Key prefix (so one will be written), and nothing in the code declares or imports
// that carrier.
/**
 * @param {SyncCodeContext} ctx
 * @param {SyncCodeAnnotation} ann
 * @returns {boolean}
 */
function prefixDeclarationNeeded(ctx, ann) {
  if (!ann.prefix) return false;
  if (!codeCard(ctx).prefixes.size) return false;
  return (/** @type {SyncCodeDeclarationAdapter} */ (declarationOf(ctx))).state(ctx, "automation_key_prefix").status === "missing";
}

// The card's first item(s) when the code has no declaration of the Automation-key carrier
// (the declaration ships with the binding change), and, with `automation_key_mint`, a
// second for the Key-prefix carrier when a Key prefix will be written and nothing declares
// or imports it. A stack whose carriers need no declaration has none. Each item's default home is
// the adapter's.
/** @type {SyncCodeSection} */
export const declaration = {
  key: "declaration",
  // Named by the stack's word for its Key carrier. A card lists the section with no adapter too.
  title: (ctx) => `${capital(wordsOf(ctx.stack.adapter).carrier)} declaration`,
  codes: Object.keys(DECLARATION_KINDS),
  items(ctx) {
    if (!codeBindingRuns(ctx) || !declarationOf(ctx)) return [];
    /** @type {SyncCodeCardItem[]} */
    const items = [];
    const ann = annotation(ctx);
    if ((/** @type {SyncCodeDeclarationAdapter} */ (declarationOf(ctx))).state(ctx).status === "missing") items.push(declarationItem("declare_annotation", ctx, ann.name, "automation_key"));
    if (prefixDeclarationNeeded(ctx, ann)) items.push(declarationItem("declare_prefix_annotation", ctx, (/** @type {SyncCodePrefixCarrier} */ (ann.prefix)).name, "automation_key_prefix"));
    return items;
  },
  apply(ctx, item, plan) {
    const decl = /** @type {SyncCodeDeclarationAdapter} */ (declarationOf(ctx));
    const checked = decl.check(ctx.repo, item);
    if (checked.problem) return checked.problem;
    const { role } = DECLARATION_KINDS[/** @type {string} */ (item.code)];
    plan.declare(checked.path, decl.text(checked.home, item.annotation, role), checked.home, role);
    return null;
  },
};

// The code repairs, one entry per proposal `code`, in the card's order.
// `item` turns a scan proposal into a card item; `apply` records an accepted item on the plan and
// returns a problem, or null.
/**
 * @type {Record<string, {
 *   item: (p: Record<string, unknown>) => SyncCodeCardItem,
 *   apply: (ctx: SyncCodeContext, item: SyncCodeCardItem, plan: SyncCodePlan) => Record<string, unknown> | null | void,
 * }>}
 */
const REPAIRS = {
  mint_and_bind: {
    item: (p) => (/** @type {SyncCodeCardItem} */ ({ ...p, edits: ["bind"] })),
    apply(ctx, item, plan) {
      const key = plan.key(item, item.function, item.bind, item.key_prefix);
      plan.annotate(item.function, key);
      for (const k of (/** @type {string[]} */ (item.bind))) plan.bind({ key: k }, key);
    },
  },

  // `keep` is the 1-based position in `functions` of the function that keeps the key, or null
  // when git blame could not decide and the person must. Each other function gets a fresh key and
  // is bound to the cases its own tracker key names; a case the keeper does not name gives up the
  // copied key for the fresh one, since it meant this function all along.
  //
  // ADR-0013: only a function to be re-keyed (every function but `keep`) needs a usable Key
  // prefix; the keeper's is never minted from, so its own `key_prefix.problem` never matters.
  duplicate_automation_key: {
    item: (/** @type {Record<string, unknown> & { rekey?: unknown, keep?: unknown, functions?: DuplicateFunctionProposal[], message?: string }} */ { rekey, keep, ...p }) => {
      const at = duplicateKeepAt(/** @type {DuplicateFunctionProposal[]} */ (p.functions), /** @type {{ file: string, line: number } | null | undefined} */ (keep));
      const base = /** @type {SyncCodeCardItem} */ ({ ...p, keep: at || null, needs: at ? [] : ["keep"], edits: ["keep"] });
      if (at) return base;
      const bad = prefixProblems(/** @type {DuplicateFunctionProposal[]} */ (p.functions));
      if (bad.length !== 1) return base;
      return /** @type {SyncCodeCardItem} */ ({ ...base, message: `${p.message}; only \`${bad[0].name}\` leaves every other function a usable prefix if kept` });
    },
    apply(ctx, item, plan) {
      const { keep, functions } = /** @type {{ keep: number | null | undefined, functions: DuplicateFunctionProposal[] }} */ (item);
      if (keep === null || keep === undefined) {
        return { code: "undecided", message: `git blame cannot say which function keeps \`${item.key}\`: edit item ${item.n} with \`keep\` (1 to ${functions.length})` };
      }
      if (!Number.isInteger(keep) || keep < 1 || keep > functions.length) return { code: "bad_keep", message: `\`keep\` must be 1 to ${functions.length}` };
      const bad = badFreshKey(functions, keep);
      if (bad) {
        const problems = prefixProblems(functions);
        const onlyKeep = problems.length === 1 ? functions.indexOf(problems[0]) + 1 : null;
        const hint = onlyKeep ? `; keeping \`${functions[onlyKeep - 1].name}\` instead would work` : `; ${noKeepWorks(problems)}`;
        return {
          code: "bad_prefix",
          item: item.n,
          badFunction: bad.name,
          onlyKeep,
          keeperName: onlyKeep ? functions[onlyKeep - 1].name : null,
          message: `\`${bad.name}\` cannot get a fresh key: ${/** @type {NonNullable<typeof bad.key_prefix>} */ (bad.key_prefix).problem}${hint}`,
        };
      }
      const keeper = functions[keep - 1];
      functions.forEach((fn, i) => {
        if (i + 1 === keep) return;
        const key = plan.key(item, fn, fn.bind, fn.key_prefix);
        plan.rekey(fn, item.key, key);
        for (const k of (/** @type {string[]} */ (fn.bind))) {
          if (!(/** @type {string[]} */ (keeper.bind)).includes(k)) plan.replace({ key: k }, item.key, key);
          plan.bind({ key: k }, key);
        }
      });
    },
  },

  rebind: {
    item: (p) => (/** @type {SyncCodeCardItem} */ ({ ...p, edits: ["bind"] })),
    apply(ctx, item, plan) {
      const key = plan.key(item, item.function, [...(/** @type {string[]} */ (item.replace_in)), ...(/** @type {string[]} */ (item.bind))], item.key_prefix);
      plan.annotate(item.function, key);
      for (const k of (/** @type {string[]} */ (item.replace_in))) plan.replace({ key: k }, item.automation, key);
      for (const k of (/** @type {string[]} */ (item.bind))) plan.bind({ key: k }, key);
    },
  },

  remove_dead_automates: {
    item: (p) => (/** @type {SyncCodeCardItem} */ ({ ...p, edits: [] })),
    apply(ctx, item, plan) {
      plan.unbind({ file: item.file, key: item.key }, item.automation);
    },
  },

  link_unclaimed: {
    item: (p) => (/** @type {SyncCodeCardItem} */ ({ ...p, edits: ["bind"] })),
    apply(ctx, item, plan) {
      for (const k of (/** @type {string[]} */ (item.bind))) plan.bind({ key: k }, item.key);
    },
  },
};

// How another line names a repair minting a key for `item.function`.

// The repairs that mint a key. A project with its own `automation_key_pattern` mints its keys with
// its own tool, so these are not on its card: the scan still reports them, and the tool fixes them.
const MINTING = new Set(["mint_and_bind", "duplicate_automation_key", "rebind"]);

// " starting with its class's Key prefix `IMPO`", for an item minting a key, or "" with no recipe.
// A Key prefix in a file's header (ADR-0022) is its file's.

// What holds a `key_prefix`: its class, or, for a header's (ADR-0022), its file.

// The one card item per holder of a proposed Key prefix: a class (`file:path`), or a file.
/**
 * @param {KeyPrefixDescriptor} kp
 * @returns {string}
 */
function prefixId(kp) {
  return kp.class ? `${kp.class.file}:${kp.class.path}` : (/** @type {string} */ (kp.file));
}

// The lines flagging what an item's links hold that may surprise: a parameterised Automation, and
// Test Cases in more than one Feature.

// Why nothing is minted for an Automation, from its class's Key prefix, and the fix. `rule` is the
// Key-prefix recipe's rule in words.

// Each minting proposal's Key prefixes (ADR-0013): the `key_prefix` of the function it keys, or of
// every function a duplicate may re-key. An item `requires` the proposed ones, the keeper's
// included: `keep` stays editable after the card is frozen, and a proposed prefix never has a
// `problem`, so requiring it never blocks the item.
/**
 * @param {Record<string, unknown> & { functions?: DuplicateFunctionProposal[], key_prefix?: KeyPrefixDescriptor }} p
 * @returns {KeyPrefixDescriptor[]}
 */
const keyPrefixes = (p) => /** @type {KeyPrefixDescriptor[]} */ ((p.functions ? p.functions.map((f) => f.key_prefix) : [p.key_prefix]).filter(Boolean));

// A duplicate's `keep` (a function ref, or null when git blame could not decide) as the 1-based
// position in `functions`, or 0 when undecided.
/**
 * @param {Array<{ file: string, line: number }>} functions
 * @param {{ file?: string, line?: number } | null | undefined} keep
 * @returns {number}
 */
const duplicateKeepAt = (functions, keep) => (keep ? functions.findIndex((f) => f.file === keep.file && f.line === keep.line) + 1 : 0);

// Which of a duplicate's functions carry a Key-prefix problem.
/**
 * @param {DuplicateFunctionProposal[]} functions
 * @returns {DuplicateFunctionProposal[]}
 */
const prefixProblems = (functions) => functions.filter((f) => f.key_prefix?.problem);

// The first function that would get a fresh key under `at` (every function but the one at that
// 1-based position; 0 keeps them all in play) whose Key prefix is unusable, or undefined.
/**
 * @param {DuplicateFunctionProposal[]} functions
 * @param {number} at
 * @returns {DuplicateFunctionProposal | undefined}
 */
const badFreshKey = (functions, at) => functions.find((f, i) => i + 1 !== at && f.key_prefix?.problem);

// Why no choice of `keep` can give every other function a usable prefix: at least two functions
// carry a Key-prefix problem, so any single keeper still leaves one of them behind.
/**
 * @param {unknown[]} problems
 * @returns {string}
 */
const noKeepWorks = (problems) => `no choice of \`keep\` gives every other function a usable prefix (${problems.length} functions carry a Key-prefix problem)`;

// The code section's items and the minting proposals it skips for their Key prefix, and the
// proposed prefixes, one item per class: built once per card, since an item `requires` its
// prefixes' item objects.
/**
 * @param {SyncCodeContext} ctx
 * @returns {SyncCodeCardState}
 */
function codeCard(ctx) {
  if (ctx.codeCard) return ctx.codeCard;
  /** @type {SyncCodeCardState} */
  const out = { items: [], skipped: [], prefixes: new Map() };
  ctx.codeCard = out;
  if (!codeBindingRuns(ctx)) return out;
  const proposals = ctx.scan.results.filter((r) => r.kind === "binding_proposal" && (ctx.config.autMints || !MINTING.has(r.code)));
  const prefixItem = (/** @type {KeyPrefixDescriptor} */ kp) => {
    const id = prefixId(kp);
    if (!out.prefixes.has(id)) out.prefixes.set(id, prefixProposal(ctx, kp));
    return /** @type {SyncCodeCardItem} */ (out.prefixes.get(id));
  };
  for (const [c, r] of Object.entries(REPAIRS)) {
    for (const { kind, ...p } of proposals.filter((x) => x.code === c)) {
      if (c === "duplicate_automation_key") {
        const skip = duplicateSkip(p);
        if (skip) {
          out.skipped.push({ code: c, reason: skip.reason, functions: p.functions, key_prefix: skip.key_prefix, message: skip.message });
          continue;
        }
        const requires = [...new Set(keyPrefixes(p).filter((kp) => kp.proposed).map(prefixItem))];
        out.items.push({ ...r.item(p), ...(requires.length && { requires }) });
        continue;
      }
      const prefixes = MINTING.has(c) ? keyPrefixes(p) : [];
      const problem = prefixes.find((kp) => kp.problem);
      if (problem) {
        out.skipped.push({ code: c, ...(/** @type {object | null | undefined} */ (p.function && { function: p.function })), ...(/** @type {object | null | undefined} */ (p.functions && { functions: p.functions })), key_prefix: problem, message: problem.problem });
        continue;
      }
      const requires = [...new Set(prefixes.filter((kp) => kp.proposed).map(prefixItem))];
      out.items.push({ ...r.item(p), ...(requires.length && { requires }) });
    }
  }
  return out;
}

// Whether a `duplicate_automation_key` proposal is skipped for its functions' Key prefixes
// (ADR-0013), and why: only a function that would get a fresh key (every function but `keep`)
// needs a usable prefix. Decided (`keep` set by git blame): skipped when any such function has a
// problem. Undecided: 0 problems changes nothing; exactly 1 leaves the item on the card (its
// `keep` still undecided: `item()` adds the hint); 2 or more means no choice of keeper avoids
// leaving one behind, so it is skipped.
/**
 * @param {Record<string, unknown> & { functions?: DuplicateFunctionProposal[], keep?: unknown }} p
 * @returns {{ reason: string, key_prefix: unknown, message: unknown } | null}
 */
function duplicateSkip(p) {
  const at = duplicateKeepAt(/** @type {DuplicateFunctionProposal[]} */ (p.functions), /** @type {{ file: string, line: number } | null | undefined} */ (p.keep));
  if (at) {
    const bad = badFreshKey(/** @type {DuplicateFunctionProposal[]} */ (p.functions), at);
    return bad ? { reason: "fresh_key_prefix", key_prefix: bad.key_prefix, message: /** @type {NonNullable<typeof bad.key_prefix>} */ (bad.key_prefix).problem } : null;
  }
  const problems = prefixProblems(/** @type {DuplicateFunctionProposal[]} */ (p.functions));
  if (problems.length < 2) return null;
  return { reason: "no_keep_works", key_prefix: problems[0].key_prefix, message: noKeepWorks(problems) };
}

// A proposed Key prefix: the class carrier that holds it, editable before it is written. One for a
// file (`class` null, ADR-0022) is its header line instead, the adapter's `headerText`.
/**
 * @param {SyncCodeContext} ctx
 * @param {KeyPrefixDescriptor} descriptor
 * @returns {SyncCodeCardItem}
 */
function prefixProposal(ctx, { prefix, class: cls, file }) {
  const { name } = /** @type {SyncCodePrefixCarrier} */ (annotation(ctx).prefix);
  const { adapter } = /** @type {{ adapter: SyncCodeStackAdapter }} */ (ctx.stack);
  if (!cls) {
    return {
      code: "propose_key_prefix",
      file,
      prefix,
      needs: prefix ? [] : ["prefix"],
      edits: ["prefix"],
      message: prefix
        ? `add \`${adapter.headerText(prefix)}\` to the header of \`${file}\`: no Key prefix covers its tests`
        : `file \`${file}\` carries no Key prefix, and none can be drawn from its name: name one`,
    };
  }
  return {
    code: "propose_key_prefix",
    class: cls,
    prefix,
    annotation: name,
    needs: prefix ? [] : ["prefix"],
    edits: ["prefix"],
    message: prefix
      ? `${(/** @type {SyncCodeStackAdapter} */ (ctx.stack.adapter)).words.write} class \`${cls.path}\` \`${(/** @type {SyncCodeStackAdapter} */ (ctx.stack.adapter)).carrierText(name, prefix)}\`: it and its nested classes carry no Key prefix`
      : `class \`${cls.path}\` carries no Key prefix, and none can be drawn from its name: name one`,
  };
}

// ADR-0013's proposed Key prefixes, ahead of the code repairs whose keys start with them.
/** @type {SyncCodeSection} */
export const prefixes = {
  key: "prefix",
  title: "Key prefixes",
  codes: ["propose_key_prefix"],
  only: (ctx) => Boolean(ctx.config.autRecipe),
  items(ctx) {
    return [...codeCard(ctx).prefixes.values()];
  },
  apply(ctx, item, plan) {
    const recipe = /** @type {MintRecipe} */ (ctx.config.autRecipe);
    if (item.prefix === null || item.prefix === undefined) return { code: "needs_edit", message: `name the Key prefix of \`${item.class?.path ?? item.file}\` (edit item ${item.n} with \`prefix\`)` };
    if (!prefixFits(item.prefix, recipe)) {
      return { code: "bad_prefix", item: item.n, prefix: item.prefix, message: `\`${item.prefix}\` does not fit \`automation_key_mint\`: ${prefixRule(recipe)}` };
    }
    if (item.class) plan.keyPrefix(item.class, item.prefix);
    else plan.fileKeyPrefix(item.file, item.prefix);
    return null;
  },
};

// A proposed Key prefix for a file (ADR-0022): the line written in its header, and what it covers.

/**
 * @type {SyncCodeSection & {
 *   notes(ctx: SyncCodeContext): Array<Record<string, unknown>>,
 * }}
 */
export const code = {
  key: "code",
  title: "Code repairs",
  codes: Object.keys(REPAIRS),
  notes(ctx) {
    if (!ctx.config.autExternal || ctx.config.autMintProblem || !codeBindingRuns(ctx)) return [];
    const count = ctx.scan.results.filter((r) => r.kind === "binding_proposal" && MINTING.has(r.code)).length;
    return count ? [{ code: "own_minting", count }] : [];
  },
  items(ctx) {
    return codeCard(ctx).items;
  },
  // The tests nothing is minted for, for their Key prefix, each with the reason and the fix.
  // A project whose own tool mints its Automation keys (ADR-0012): the repairs that would mint one
  // are not on the card.
  // The code side's notes: the scan's run health (lib/scan-code.mjs), and its own.
  info(ctx) {
    const { skipped } = codeCard(ctx);
    return skipped.length ? { skipped } : {};
  },
  apply(ctx, item, plan) {
    if ("bind" in item) {
      const bad = badBind(ctx, /** @type {string[]} */ (item.bind));
      if (bad) return bad;
    }
    return (/** @type {{ apply: (ctx: SyncCodeContext, item: SyncCodeCardItem, plan: SyncCodePlan) => Record<string, unknown> | null | void }} */ (REPAIRS[/** @type {string} */ (item.code)])).apply(ctx, item, plan) ?? null;
  },
};

// Why an (edited) `bind` list cannot be applied, or null: it names case keys `.qa/` holds.
/**
 * @param {SyncCodeContext} ctx
 * @param {string[]} bind
 * @returns {{ code: string, message: string } | null}
 */
function badBind(ctx, bind) {
  const unknown = bind.filter((k) => !ctx.index.cases.has(k));
  if (unknown.length) return { code: "unknown_case", message: `no case ${unknown.map((k) => `\`${k}\``).join(", ")} in \`.qa/\`` };
  return null;
}

// Why `project.md`'s Key-prefix recipe cannot be used, by the scan's `no_minting` `reason`.
