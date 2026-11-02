// @ts-check
// The delegation failure policy as a state machine over plain JSON, so a Run's state survives between CLI
// calls in `dispatch.json`. Nothing here launches anything or reads a clock: drivers pass `now`.
//
//   - 3 attempts per (unit, Delegate), kind-blind: a failed dispatch and an unusable reply are
//     retried alike. A retry goes to the back of the queue, not before 15 s × attempt.
//   - A per-Delegate breaker trips on a `quota` failure, on 3 consecutive failed retries
//     (attempt ≥ 2 on that Delegate) with no usable reply between, or at once on a `refused`
//     attempt (the harness rejected the model: no retry could cure it). On a trip every unit still
//     without a usable reply, including one whose budget is spent, moves to the Fallback
//     with a fresh budget; in-flight units finish first, and move if they fail or are refused too.
//     `attempt` stays monotonic per unit per Run. If the Fallback itself trips, dispatch stops.
//
//   - An attempt may be settled `retryable: false` (a Tester that already acted: `/qa-execute`, a re-run
//     could repeat a mutation). It feeds the breaker like any failure, but its unit is final: never
//     requeued by `settle()` or by a trip, and left where it is when the Delegate changes.
//
// "Attempt" in the cooldown and in the breaker's "attempt ≥ 2" is the attempt on that Delegate:
// the Fallback's fresh budget starts again at 1, and its first attempt is no retry.

/**
 * @typedef {{
 *   attempts: number;
 *   cooldown_ms: number;
 *   trip_after: number;
 * }} DispatchPolicy
 */

/**
 * Default failure and retry policy configuration.
 * @type {DispatchPolicy}
 */
export const POLICY = { attempts: 3, cooldown_ms: 15000, trip_after: 3 };

/**
 * Known reasons for tripping a breaker.
 * @typedef {"quota" | "consecutive_failed_retries" | "refused"} TripReason
 */

/**
 * Breaker state tracked per Delegate label.
 * @typedef {{
 *   streak: number;
 *   tripped: string | null;
 * }} BreakerState
 */

/**
 * A recorded breaker trip event.
 * @typedef {{
 *   delegate: string;
 *   reason: string;
 *   to: string | null;
 * }} TripRecord
 */

/**
 * Stopped state when dispatch halts permanently.
 * @typedef {{
 *   reason: string;
 *   [key: string]: unknown;
 * }} StoppedState
 */

/**
 * Budget tracking for a unit on its active delegate.
 * @typedef {{
 *   delegate: number;
 *   used: number;
 * }} UnitBudget
 */

/**
 * A single execution or dispatch attempt for a unit.
 * @typedef {{
 *   n: number;
 *   local: number;
 *   delegate: number;
 *   ts: number;
 *   settled?: number;
 *   status?: string;
 *   error_kind?: string | null;
 *   usable?: boolean;
 *   retryable?: boolean;
 *   [key: string]: unknown;
 * }} Attempt
 */

/**
 * Status of a dispatched unit.
 * @typedef {"queued" | "in_flight" | "done" | "failed"} UnitStatus
 */

/**
 * A unit tracked in the dispatch state, wrapping caller fields with state-machine metadata.
 * @template [U=Record<string, unknown>]
 * @typedef {U & {
 *   status: UnitStatus;
 *   seq: number;
 *   not_before: number;
 *   budget: UnitBudget;
 *   attempts: Attempt[];
 *   final?: boolean;
 * }} DispatchedUnit
 */

/**
 * The base dispatch state machine.
 * @template [U=Record<string, unknown>]
 * @typedef {{
 *   cap: number;
 *   chain: string[];
 *   active: number;
 *   stopped: StoppedState | null;
 *   seq: number;
 *   breakers: Record<string, BreakerState>;
 *   trips: TripRecord[];
 *   units: Array<DispatchedUnit<U>>;
 * }} DispatchState
 */

/**
 * Options for initializing a new dispatch state.
 * @template [U=Record<string, unknown>]
 * @typedef {{
 *   units: U[];
 *   chain: string[];
 *   cap: number;
 * }} NewDispatchOptions
 */

/**
 * Outcome of an in-flight attempt passed to `settle`.
 * @typedef {{
 *   status?: string;
 *   error_kind?: string | null;
 *   usable?: boolean;
 *   retryable?: boolean;
 *   [key: string]: unknown;
 * }} SettlementOutcome
 */

/**
 * The unit-level contract descriptor in a dispatch spec (`dispatch.spec.json`).
 * @typedef {{
 *   kind: string;
 *   brief_json?: string;
 *   written?: string | null;
 *   [key: string]: unknown;
 * }} DispatchSpecContract
 */

/**
 * A single unit in a dispatch spec (`dispatch.spec.json`).
 * @typedef {{
 *   id: string;
 *   feature: string;
 *   scenario: string | null;
 *   brief: string;
 *   reply: string;
 *   contract: DispatchSpecContract;
 *   [key: string]: unknown;
 * }} DispatchSpecUnit
 */

/**
 * The dispatch spec contract (`dispatch.spec.json`) written by commands
 * such as `design` and `impact`, and read by `delegation`.
 * @typedef {{
 *   v: number;
 *   cmd: string;
 *   root: string;
 *   feature?: string | null;
 *   target?: string | null;
 *   units: DispatchSpecUnit[];
 *   extras?: unknown;
 *   [key: string]: unknown;
 * }} DispatchSpec
 */

// The failure kinds that trip a breaker at once, the kind being the trip's reason: no retry cures a
// spent allowance or a model the harness rejects.
/** @type {ReadonlySet<string | null | undefined>} */
const IMMEDIATE = new Set(["quota", "refused"]);

// The Feature-level judge unit's name in a Run (ADR-0039): it judges a Feature's Rules against its
// Boundaries, not a scenario file's cases, so it is named apart from the scenario keys.
/** @type {"feature"} */
export const FEATURE_UNIT = "feature";

/**
 * A Feature-level unit's id in a Run.
 * @param {string} slug - the Feature's key
 * @returns {string}
 */
export const featureUnitId = (slug) => `${FEATURE_UNIT}-${slug}`;

/**
 * Whether a unit judges a Feature's Rules against its Boundaries (ADR-0039).
 * @param {{ scenario: string | null }} unit
 * @returns {boolean}
 */
export const isFeatureUnit = (unit) => unit.scenario === null;

// `chain` is the Delegates' labels in the order the Run may use them: the chosen one, then the
// Fallback (just the Fallback when it was chosen).
/**
 * @template [U=Record<string, unknown>]
 * @param {NewDispatchOptions<U>} options
 * @returns {DispatchState<U>}
 */
export function newDispatch({ units, chain, cap }) {
  return {
    cap,
    chain,
    active: 0,
    stopped: null,
    seq: units.length,
    breakers: Object.fromEntries(chain.map((label) => [label, { streak: 0, tripped: null }])),
    trips: [],
    units: units.map((u, i) => ({ ...u, status: /** @type {UnitStatus} */ ("queued"), seq: i, not_before: 0, budget: { delegate: 0, used: 0 }, attempts: [] })),
  };
}

/**
 * @template [U=Record<string, unknown>]
 * @param {DispatchState<U>} s
 * @returns {string | null}
 */
export const activeDelegate = (s) => (s.stopped ? null : s.chain[s.active]);

/**
 * @template [U=Record<string, unknown>]
 * @param {DispatchState<U>} s
 * @returns {Array<DispatchedUnit<U>>}
 */
export const inFlight = (s) => s.units.filter((u) => u.status === "in_flight");

// The units that may launch now, in queue order, within the cap. `admit(unit)` may veto a unit
// that is otherwise ready (it is called once per such unit, in order, and a vetoed one is skipped,
// not a stop); it is where a driver holds back what a lock denies.
/**
 * @template [U=Record<string, unknown>]
 * @param {DispatchState<U>} s
 * @param {number} now
 * @param {(unit: DispatchedUnit<U>) => boolean} [admit]
 * @returns {Array<DispatchedUnit<U>>}
 */
export function ready(s, now, admit = () => true) {
  if (s.stopped) return [];
  const room = s.cap - inFlight(s).length;
  /** @type {Array<DispatchedUnit<U>>} */
  const out = [];
  for (const u of queued(s)) {
    if (out.length >= room) break;
    if (u.not_before <= now && admit(u)) out.push(u);
  }
  return out;
}

// When the earliest queued unit becomes ready, or null when nothing is queued.
/**
 * @template [U=Record<string, unknown>]
 * @param {DispatchState<U>} s
 * @returns {number | null}
 */
export function nextReadyAt(s) {
  if (s.stopped) return null;
  const times = queued(s).map((u) => u.not_before);
  return times.length ? Math.min(...times) : null;
}

/**
 * @template [U=Record<string, unknown>]
 * @param {DispatchState<U>} s
 * @returns {boolean}
 */
export const finished = (s) => inFlight(s).length === 0 && (s.stopped !== null || queued(s).length === 0);

/**
 * @template [U=Record<string, unknown>]
 * @param {DispatchState<U>} s
 * @returns {Array<DispatchedUnit<U>>}
 */
const queued = (s) => s.units.filter((u) => u.status === "queued").sort((a, b) => a.seq - b.seq);

// Marks one unit launched on the active Delegate; returns its attempt `{n, local, delegate, ts}`.
/**
 * @template [U=Record<string, unknown>]
 * @param {DispatchState<U>} s
 * @param {DispatchedUnit<U>} unit
 * @param {number} now
 * @returns {Attempt}
 */
export function launch(s, unit, now) {
  unit.status = "in_flight";
  unit.budget.used += 1;
  const attempt = { n: unit.attempts.length + 1, local: unit.budget.used, delegate: s.active, ts: now };
  unit.attempts.push(attempt);
  return attempt;
}

// Settles a unit's in-flight attempt with its outcome (`{status, error_kind, usable, ...}`).
// `cooldownMs` is the cooldown per attempt (15 s, unless a test scales time). Returns the
// announcement lines the settlement caused (breaker trips).
/**
 * @template [U=Record<string, unknown>]
 * @param {DispatchState<U>} s
 * @param {DispatchedUnit<U>} unit
 * @param {SettlementOutcome} outcome
 * @param {number} now
 * @param {number} [cooldownMs]
 * @returns {string[]}
 */
export function settle(s, unit, outcome, now, cooldownMs = POLICY.cooldown_ms) {
  const attempt = unit.attempts[unit.attempts.length - 1];
  Object.assign(attempt, outcome, { settled: now });
  if (outcome.retryable === false) unit.final = true;
  const breaker = s.breakers[s.chain[attempt.delegate]];
  /** @type {string[]} */
  const lines = [];
  if (outcome.usable) {
    unit.status = "done";
    breaker.streak = 0;
    return lines;
  }
  if (attempt.local >= 2) breaker.streak += 1;
  if (!breaker.tripped && attempt.delegate === s.active && !s.stopped) {
    const reason = IMMEDIATE.has(outcome.error_kind) ? outcome.error_kind : breaker.streak >= POLICY.trip_after ? "consecutive_failed_retries" : null;
    if (reason) lines.push(trip(s, attempt.delegate, reason, now));
  }
  if (unit.final || s.stopped) unit.status = "failed";
  else if (attempt.delegate !== s.active) requeue(s, unit, now, 0);
  else if (unit.budget.used < POLICY.attempts) requeue(s, unit, now, cooldownMs * attempt.local);
  else unit.status = "failed";
  return lines;
}

/**
 * @template [U=Record<string, unknown>]
 * @param {DispatchState<U>} s
 * @param {DispatchedUnit<U>} unit
 * @param {number} now
 * @param {number} cooldown
 * @returns {void}
 */
function requeue(s, unit, now, cooldown) {
  if (unit.budget.delegate !== s.active) unit.budget = { delegate: s.active, used: 0 };
  unit.status = "queued";
  unit.seq = s.seq++;
  unit.not_before = now + cooldown;
}

/**
 * @template [U=Record<string, unknown>]
 * @param {DispatchState<U>} s
 * @param {number} index
 * @param {string} reason
 * @param {number} now
 * @returns {string}
 */
function trip(s, index, reason, now) {
  const label = s.chain[index];
  s.breakers[label].tripped = reason;
  const why = TRIP_REASON[reason];
  const remaining = s.units.filter((u) => u.status !== "done");
  const moving = remaining.filter((u) => !u.final);
  if (index === s.chain.length - 1) {
    s.stopped = { reason: "fallback_tripped" };
    s.trips.push({ delegate: label, reason, to: null });
    return `The Fallback ${delegateName(label)} tripped its breaker on ${why}: dispatch stopped, ${plural(remaining.length, "unit")} without a usable reply.`;
  }
  s.active = index + 1;
  const to = s.chain[s.active];
  s.trips.push({ delegate: label, reason, to });
  // Queued and spent units move now; in-flight ones move if they fail.
  for (const u of s.units) if (u.status === "queued" || (u.status === "failed" && !u.final)) requeue(s, u, now, 0);
  return `Delegate ${delegateName(label)} tripped its breaker on ${why}: moving ${plural(moving.length, "unit")} without a usable reply to the Fallback ${delegateName(to)}, with a fresh budget.`;
}

/** @type {Record<string, string>} */
const TRIP_REASON = { quota: "a quota failure", consecutive_failed_retries: `${POLICY.trip_after} consecutive failed retries`, refused: "a refusal by the harness" };

/**
 * @param {string} label
 * @returns {string}
 */
const delegateName = (label) => `\`${label}\``;

/**
 * @param {number} n
 * @param {string} one
 * @returns {string}
 */
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
