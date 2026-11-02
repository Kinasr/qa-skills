// @ts-check
// Scan results about Test Cases and Scenarios that are not Integrity errors: Outcome gaps (ADR-0009), the Divergences that need no code (a
// Mirrored value disagreeing with what the knowledge layer owns, ADR-0003), `review_by` overdue,
// and the Overreach a Test Case covering a Waived Rule is (ADR-0039). The code-side Divergences
// belong to the code index pass.

import { isMap } from "./dialect.mjs";
import { noList, sameSummary } from "./schema.mjs";

/** @import { CaseEntry, QaFile, ScanContext } from "./scan.mjs" */
/** @import { ParsedRule } from "./knowledge-file.mjs" */

/**
 * The kinds of result this pass reports.
 * @typedef {"outcome_gap" | "divergence" | "review_overdue" | "overreach"} CaseResultKind
 */

/**
 * Where a result sits: the file, the line, the Feature and the Key it is about.
 * @typedef {{
 *   file: string,
 *   line: number,
 *   feature: string | undefined,
 *   key: string,
 *   scenario?: string,
 * }} ResultWhere
 */

/**
 * A result this pass reports: what it holds beside the place is the owned claim (`knowledge`) and
 * the tracker's copy of it (`mirror`).
 * @typedef {{
 *   kind: CaseResultKind,
 *   code: string,
 *   message: string,
 *   file?: string,
 *   line?: number,
 *   feature?: string,
 *   key?: string,
 *   scenario?: string,
 *   knowledge?: string | string[] | true,
 *   mirror?: string | string[],
 *   review_by?: string,
 *   rests_on?: string,
 * }} CaseScanResult
 */

/** @type {readonly CaseResultKind[]} */
export const kinds = ["outcome_gap", "divergence", "review_overdue", "overreach"];

/**
 * @param {ScanContext} ctx
 * @returns {void}
 */
export function run(ctx) {
  for (const f of ctx.files) {
    if (f.unreadable || f.type !== "scenario") continue;
    const feature = ctx.index.featureOf(f) ?? undefined;
    const scenario = typeof f.data.key === "string" ? f.data.key : undefined;
    const waived = feature === undefined ? new Map() : waivedRules(ctx, feature);

    if (f.h1?.key && isMap(f.data.mirror)) {
      summary(ctx, f.h1.text, f.data.mirror, { file: f.rel, line: f.h1.line, feature, key: f.h1.key });
    }
    for (const c of f.cases) {
      const where = { file: f.rel, line: c.line, feature, scenario, key: c.key };
      if (!hasExpectedResult(c)) {
        ctx.emit({ kind: "outcome_gap", code: "no_expected_result", ...where, message: `\`${c.key}\` states no expected outcome: it has no \`**Expected result.**\` paragraph` });
      }
      const m = c.data.mirror;
      if (isMap(m)) {
        summary(ctx, c.summary, m, where);
        roles(ctx, c, m, where);
        if (m.auto_status === "Not Applicable" && (c.data.automatable ?? true) === true) {
          ctx.emit({
            kind: "divergence",
            code: "not_applicable_automatable",
            ...where,
            knowledge: true,
            mirror: m.auto_status,
            message: `\`${c.key}\` is \`automatable: true\` but the tracker's automation status is Not Applicable`,
          });
        }
      }
      const due = c.data.review_by;
      if (typeof due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(due) && due < ctx.today) {
        ctx.emit({ kind: "review_overdue", code: "review_by_passed", ...where, review_by: due, message: `\`${c.key}\` was due for review by ${due}` });
      }
      overreach(ctx, c, where, waived);
    }
  }
}

// The Waived Rules of a Feature, by Rule key: the Rules its file holds with a Waiver (ADR-0039). A
// Rule that is Waived is deliberately left without a Test Case, so a case that covers one crosses
// the Feature's stated scope.
/**
 * @param {ScanContext} ctx
 * @param {string} feature
 * @returns {Map<string, ParsedRule>}
 */
function waivedRules(ctx, feature) {
  const file = ctx.index.features.get(feature)?.[0]?.file;
  if (!file) return new Map();
  return new Map(file.rules.filter((r) => r.waiver).map((r) => [r.key, r]));
}

// The Overreach (ADR-0039): a Test Case whose `covers` names a Waived Rule. The Scan finds it
// mechanically, whatever changed since the Watermark: the Waiver says the Rule is left without a
// Test Case, and this case is one. The finding rests on the Waived Rule, named by `rests_on`.
/**
 * @param {ScanContext} ctx
 * @param {CaseEntry} c
 * @param {ResultWhere} where
 * @param {Map<string, ParsedRule>} waived
 * @returns {void}
 */
function overreach(ctx, c, where, waived) {
  const covers = Array.isArray(c.data.covers) ? c.data.covers.filter((k) => typeof k === "string") : [];
  for (const key of covers) {
    const rule = waived.get(key);
    if (!rule) continue;
    ctx.emit({
      kind: "overreach",
      code: "waived_rule_covered",
      ...where,
      rests_on: key,
      message: `\`${where.key}\` covers \`${key}\`, which is Waived: ${rule.waiver}`,
    });
  }
}

// The Expected-result paragraph: a prose line opening with the label, and some text before the
// next labelled paragraph. A label with nothing under it states no outcome either.
const LABEL = /^\*\*[^*]+\.\*\*/;
const EXPECTED = /^\*\*Expected result\.\*\*(.*)$/;

/**
 * @param {CaseEntry} c
 * @returns {boolean}
 */
function hasExpectedResult(c) {
  for (let i = 0; i < c.prose.length; i++) {
    const m = c.prose[i].text.match(EXPECTED);
    if (!m) continue;
    if (m[1].trim()) return true;
    for (let j = i + 1; j < c.prose.length && !LABEL.test(c.prose[j].text); j++) {
      if (c.prose[j].text.trim()) return true;
    }
  }
  return false;
}

// The heading's summary is the owned claim; `mirror.summary` is the tracker's copy. `null` means
// the tracker holds no value, which is nothing to compare. Whitespace carries no claim: the two
// compare as `/qa-sync` compares them.
/**
 * @param {ScanContext} ctx
 * @param {string} owned
 * @param {Record<string, unknown>} mirror
 * @param {ResultWhere} where
 * @returns {void}
 */
function summary(ctx, owned, mirror, where) {
  if (typeof mirror.summary !== "string" || sameSummary(mirror.summary, owned)) return;
  ctx.emit({
    kind: "divergence",
    code: "summary",
    ...where,
    knowledge: owned,
    mirror: mirror.summary,
    message: `\`${where.key}\`'s summary differs from the tracker's`,
  });
}

// Roles compare as sets: order carries no claim. A mirror holding no roles (`null` or `[]`) is the
// tracker holding no value, which is nothing to compare.
/**
 * @param {ScanContext} ctx
 * @param {CaseEntry} c
 * @param {Record<string, unknown>} mirror
 * @param {ResultWhere} where
 * @returns {void}
 */
function roles(ctx, c, mirror, where) {
  if (!Array.isArray(mirror.roles) || noList(mirror.roles)) return;
  const owned = Array.isArray(c.data.roles) ? /** @type {string[]} */ (c.data.roles) : [];
  const a = new Set(owned);
  const b = new Set(/** @type {string[]} */ (mirror.roles));
  if (a.size === b.size && [...a].every((r) => b.has(r))) return;
  ctx.emit({
    kind: "divergence",
    code: "roles",
    ...where,
    knowledge: owned,
    mirror: /** @type {string[]} */ (mirror.roles),
    message: `\`${c.key}\`'s roles differ from the tracker's`,
  });
}
