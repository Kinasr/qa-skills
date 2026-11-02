// @ts-check
// The reply contracts the delegation layer checks each attempt against. A contract says
// whether one reply is usable. Each delegating command registers one: `judge` for `/qa-impact`,
// `design` for `/qa-design`.
//
// Every contract has
//   role                   what one unit is, for the subagent prompt ("judge unit")
//   load(contract)         reads what the check needs: `{error}` or data. `delegate start` calls it to
//                          refuse a unit it could never check; each check loads it again
//   check(reply, data)     `{usable, problems}` for a reply that came back
// and may have
//   accept(reply, data, {checked, delegate})
//                          runs once, on the usable reply, before the attempt settles:
//                          `/qa-design` writes the unit's cases here
import { readFileSync } from "node:fs";
import { checkReply } from "./check-reply.mjs";
import { writeFill } from "./design-write.mjs";

/** @import {JudgeBrief} from "./impact.mjs" */
/** @import {DispatchSpecContract} from "./dispatch.mjs" */
/** @import {JudgeProblem, JudgeResult} from "./check-reply.mjs" */
/** @import {DesignCase, DesignProblem, DesignResult} from "./design-contract.mjs" */
/** @import {DesignBrief} from "./design-unit.mjs" */

/**
 * What one contract's `load` reads out of the unit's brief file: `{unit}`, and `written` for the
 * design contract — or `{error}` naming why the file is not the brief that unit expects.
 * @typedef {{
 *   error: string,
 *   unit?: undefined,
 *   written?: undefined,
 * } | {
 *   unit: JudgeBrief,
 *   error?: undefined,
 *   written?: undefined,
 * } | {
 *   unit: DesignBrief,
 *   written: string | null,
 *   error?: undefined,
 * }} ContractData
 */

/**
 * One reply's check: whether it is usable and its problems, and — for the design contract — the
 * normalised result the writer takes (`accepted`, present on a usable reply).
 * @typedef {object} ReplyCheck
 * @property {boolean} usable
 * @property {(JudgeProblem | DesignProblem)[]} problems
 * @property {DesignResult} [accepted]
 */

/**
 * The data a contract's `check` and `accept` read: what `load` returned when it did not fail —
 * `delegate start` and `record` are the only callers that saw a load failure, so `(CODING_STANDARDS:
 * trusted read boundary)` past `!data.error`'s gate the error member is gone.
 * @typedef {Exclude<ContractData, { error: unknown }>} LoadedContractData
 */

/**
 * What each delegating command checks one attempt against: the subagent prompt's role, `load`
 * reading the unit's brief, `check` on the reply, and — for the design contract — `accept`, which
 * writes the reply's cases before the attempt settles.
 * @typedef {object} ReplyContract
 * @property {string} role
 * @property {(contract: DispatchSpecContract) => ContractData} load
 * @property {(reply: string, data: LoadedContractData) => ReplyCheck} check
 * @property {(reply: string, data: LoadedContractData, options: { checked: ReplyCheck, delegate: string }) => void} [accept]
 */

/**
 * @typedef {Record<string, ReplyContract>} Contracts
 */

/** @type {Contracts} */
export const CONTRACTS = {
  judge: {
    role: "judge unit",
    load(contract) {
      /** @type {JudgeBrief} */
      let unit;
      try {
        // The plan wrote a `brief_json` path for every judge unit (lib/impact.mjs): trusted past
        // the contract's own read.
        unit = JSON.parse(readFileSync(/** @type {string} */ (contract.brief_json), "utf8"));
      } catch {
        return { error: `\`contract.brief_json\` ${contract.brief_json} is not the JSON \`brief judge\` printed` };
      }
      if (unit?.unit !== "judge" || !Array.isArray(unit.keys)) return { error: `${contract.brief_json} is not the JSON \`brief judge\` printed` };
      return { unit };
    },
    check(reply, { unit }) {
      // `checkReply` accepted the brief the same gate ran at load, so its result is a
      // {@link JudgeResult} here (CODING_STANDARDS: trusted read boundary).
      const r = /** @type {JudgeResult} */ (checkReply("judge", reply, unit));
      return { usable: r.usable, problems: r.problems };
    },
  },

  // `/qa-design`'s design units.
  design: {
    role: "design unit",
    load(contract) {
      /** @type {DesignBrief} */
      let unit;
      try {
        // The plan wrote a `brief_json` path for every design unit (lib/design.mjs): trusted past
        // the contract's own read.
        unit = JSON.parse(readFileSync(/** @type {string} */ (contract.brief_json), "utf8"));
      } catch {
        return { error: `\`contract.brief_json\` ${contract.brief_json} is not the JSON \`brief design\` printed` };
      }
      if (unit?.unit !== "design" || !Array.isArray(unit.rules)) return { error: `${contract.brief_json} is not the JSON \`brief design\` printed` };
      return { unit, written: contract.written ?? null };
    },
    check(reply, { unit }) {
      // `checkReply` accepted the brief this contract loaded, so its result is a
      // {@link DesignResult} here (CODING_STANDARDS: trusted read boundary).
      const r = /** @type {DesignResult} */ (checkReply("design", reply, unit));
      return { usable: r.usable, problems: r.problems, accepted: r };
    },
    accept(_reply, { unit, written }, { checked, delegate }) {
      // The reply cleared `checkReply`'s design gates, so it carries the cases this contract
      // loaded (CODING_STANDARDS: trusted read boundary).
      writeFill(/** @type {DesignBrief} */ (unit), /** @type {DesignResult & { cases: DesignCase[] }} */ (checked.accepted), { delegate, written });
    },
  },
};
