// @ts-check
// The agreement block a design unit's brief may carry (ADR-0042).
//
// The release switch below is the single place delivery is chosen. ADR-0042's predeclared outcomes,
// in precedence order, pick its value:
//   - any material regression of C keeps the incumbent brief: `off`;
//   - passing every frozen criterion makes the full agreement block the default: `full`;
//   - otherwise, allocation delivery alone: `allocation`.
// Until the confirmation run decides, the switch stays `off`.
// The follow-up that flips delivery edits this one line. No CLI flag, project setting or training
// file overrides it; the only exception is the test-only environment variable
// `agreementBriefPosition` reads, the way tests set QA_SKILLS_MINT_SEED.
/** @import { Agreement } from "./design-agreement.mjs" */
/** @import { FeatureContext } from "./design-unit.mjs" */
import { effectiveCategories } from "./categories.mjs";

/**
 * One position of the design brief's agreement release switch: `off` (today's brief), `allocation`
 * (assigned Rules, the allocation map and the overlap qualification) or `full` (every element).
 * @typedef {"off" | "allocation" | "full"} AgreementBriefPosition
 */

/**
 * The release switch ADR-0042 gates the agreement block on. Defaults to `off` until the
 * confirmation run decides; flip it here and nowhere else.
 * @type {AgreementBriefPosition}
 */
export const AGREEMENT_BRIEF_SWITCH = "off";

/**
 * The position in force: the constant above, unless a test sets `QA_SKILLS_AGREEMENT_BRIEF` to one
 * of the three positions. A user never sets it, and no project or Training file can.
 * @param {Record<string, string | undefined>} env
 * @returns {AgreementBriefPosition}
 */
export function agreementBriefPosition(env) {
  const value = env.QA_SKILLS_AGREEMENT_BRIEF;
  return value === "off" || value === "allocation" || value === "full" ? value : AGREEMENT_BRIEF_SWITCH;
}

/**
 * The block `brief design <key> --agreement <file>` inserts into the unit's brief, or null when the
 * switch is off. `full` carries every element; `allocation` carries the scenario's obligations, the
 * complete allocation map and the overlap qualification only. The complete map includes `retained`, so
 * the Delegate sees who owns a Rule kept by an existing case elsewhere.
 * @param {FeatureContext} ctx The Feature's design context.
 * @param {Agreement} agreement The recorded agreement.
 * @param {string} scenario This unit's scenario Key.
 * @param {AgreementBriefPosition} position The release switch's position; `off` renders nothing.
 * @returns {string | null}
 */
export function agreementBlock(ctx, agreement, scenario, position) {
  if (position === "off") return null;
  const entry = agreement.scenarios[scenario];
  /** @param {string} key */
  const ruleLine = (key) => {
    const rule = ctx.rules.find((item) => item.key === key);
    return rule ? `- \`${key}\`: ${rule.statement}` : `- \`${key}\``;
  };
  /** @type {string[]} */
  const overlap = [
    "=== OVERLAP POLICY ===",
    "",
    "Assignments are coverage responsibility: they are never a limit on the constraints a case honours or on legitimate multi-Rule passes.",
  ];
  /** @type {string[]} */
  const lines = [
    "=== THE AGREEMENT ===",
    "",
    `The agreement assigns these Rules to \`${scenario}\` (its coverage responsibility):`,
    "",
    ...((entry?.obligations.length ?? 0) > 0 ? /** @type {string[]} */ (entry?.obligations).map(ruleLine) : ["- (none)"]),
    "",
    "The complete allocation map:",
    "",
    ...allocationLines(agreement),
  ];
  if (position === "full") {
    const highlights = entry?.highlights ?? [];
    lines.push(
      "",
      "=== CONSTRAINING RULES ===",
      "",
      "These highlighted Rules elsewhere in the Feature constrain this assignment. They are attention guidance: every applicable Rule in the Feature governs correctness, and an empty list never means none.",
      "",
      ...(highlights.length > 0 ? highlights.map(ruleLine) : ["- (none highlighted)"]),
      "",
      "=== REMARKS ===",
      "",
      ...((entry?.remarks.length ?? 0) > 0 ? /** @type {string[]} */ (entry?.remarks).map((remark) => `- ${oneLine(remark)}`) : ["- (none)"]),
      "",
      ...overlap,
      "",
      "=== COVERAGE CATEGORIES ===",
      "",
      ...effectiveCategories(ctx.root).categories.map((category) => `- \`${category.key}\`: ${category.name}`),
    );
  } else {
    lines.push("", ...overlap);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The whole agreement's allocation: every scenario's action and assigned Rules, then the Rules a
 * kept case elsewhere retains.
 * @param {Agreement} agreement
 * @returns {string[]}
 */
function allocationLines(agreement) {
  const scenarios = Object.entries(agreement.scenarios).map(([key, entry]) =>
    `- \`${key}\` (${entry.action}): ${entry.rules.length > 0 ? entry.rules.map((rule) => `\`${rule}\``).join(", ") : "(none)"}`);
  const retained = Object.entries(agreement.retained).map(([rule, scenariosHolding]) =>
    `\`${rule}\` in ${scenariosHolding.map((key) => `\`${key}\``).join(", ")}`);
  if (retained.length > 0) scenarios.push(`- retained: ${retained.join("; ")}`);
  return scenarios.length > 0 ? scenarios : ["- (no scenarios)"];
}

/**
 * A remark as one bullet line, since the block is a list.
 * @param {string} remark
 * @returns {string}
 */
const oneLine = (remark) => remark.replace(/\s*\n\s*/g, " ");
