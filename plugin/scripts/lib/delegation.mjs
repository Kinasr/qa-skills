// @ts-check
// `delegate`: the shared delegation layer (ADR-0021). Every
// delegating command lays its units out in a run directory as `dispatch.spec.json` and hands the
// directory here. Nothing in this module knows which command it serves beyond the spec's `cmd` and
// each unit's contract.
//
//   resolve   which Delegate a Run would use: the model label of the Tier its agent is bound to
//             (lib/tiers.mjs), the Fallback (`inherit`) and the concurrency cap. Never writes.
//   start     resolves the chosen Delegate's label, once, before the first unit, and mints the Run
//             id. Writes `dispatch.json`.
//   next      hands the orchestrator the units to spawn as subagents, as many as may run now under
//             the concurrency policy; it saves each reply and calls `record`. `done: true` when nothing is left.
//   record    settles one attempt from its saved reply.
//
// A contract may act on a usable reply before the attempt settles (`accept`, in
// lib/contracts.mjs): `/qa-design`'s writes the unit's cases into its scenario file.
//
// `dispatch.spec.json`:
//   {v: 1, cmd, root, feature, target, units: [{id, feature, scenario, brief, reply,
//    contract: {kind, ...}}]}
// `brief` is the unit's brief file, given byte for byte; `reply` is where the usable reply (else
// the last one obtained) is left for the command to read. A Feature-level judge unit (ADR-0039)
// judges a Feature's Rules against its Boundaries rather than a scenario file's cases, so it has
// no `scenario`: `null`.
//
// Cooldowns are real time. QA_SKILLS_DISPATCH_SCALE scales them; nothing but a test sets it.
// Nothing outside the harness can end a subagent, so a timeout is whatever the harness reports
// (`record --status timeout`), and so is a refusal to spawn one with the model (`--status refused`).
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { orThrow, UsageError } from "./cli.mjs";
import { CONTRACTS } from "./contracts.mjs";
import { AGENT_TYPES, COMMANDS, resolveDelegates } from "./delegates.mjs";
import { activeDelegate, finished, inFlight, launch, newDispatch, nextReadyAt, POLICY, ready, settle } from "./dispatch.mjs";
import { newRunId, openRunDir, readRunFile } from "./run-dir.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { ANY_SCHEMA_VERSION, LEVEL_ON_CASE_SCHEMA_VERSION } from "./schema.mjs";
import { subagentModel } from "./tiers.mjs";
/** @import { RunFileResult } from "./run-dir.mjs" */

/** @import {CommandContext, CommandDefinition, CommandResult, OptionSpec} from "./cli.mjs" */
/** @import {Attempt, DispatchSpec, DispatchSpecUnit, DispatchState, DispatchedUnit, UnitStatus} from "./dispatch.mjs" */

/**
 * A note the resolution made (lib/delegates.mjs `concurrencyCap` is unchecked): a code and one
 * line.
 * @typedef {object} DelegateNote
 * @property {string} code
 * @property {string} message
 */

/**
 * The report the resolution gave the Run: the Delegate it chose, under which Tier, the Fallback
 * behind it, the concurrency cap, and its notes. `delegate resolve` prints it and `start` stores
 * it (lib/delegates.mjs `resolveDelegates` is unchecked, so this names the fields it reads).
 * @typedef {object} DelegateResolution
 * @property {{ label: string, tier: string }} chosen
 * @property {string} fallback
 * @property {number} concurrency_cap
 * @property {DelegateNote[]} notes
 */

/**
 * The run's dispatch state, as `dispatch.json` carries it: the machine's own state
 * (`DispatchState`) and the Run's identity and resolution report.
 * @typedef {DispatchState<DispatchSpecUnit> & {
 *   v: number,
 *   run: string,
 *   cmd: string,
 *   root: string,
 *   feature: string | null,
 *   target: string | null,
 *   chosen: string,
 *   tier: string,
 *   fallback: string,
 *   announcements: string[],
 *   notes: DelegateNote[],
 * }} DispatchJson
 */

/**
 * One unit of the Run, as `dispatch.json` tracks it: the spec's unit plus the machine's own
 * fields.
 * @typedef {DispatchedUnit<DispatchSpecUnit>} DispatchJsonUnit
 */

/**
 * The run's `dispatch.json` as `load` returns it, or its `{error}`.
 * @typedef {DispatchJson & { error?: never } | { error: string }} LoadedDispatch
 */

/**
 * One attempt `next` hands out: the unit, its attempt, and everything the orchestrator needs to
 * spawn the subagent.
 * @typedef {object} NextUnit
 * @property {string} unit
 * @property {number} attempt
 * @property {string} feature
 * @property {string | null} scenario - the scenario key; null for a Feature-level judge unit
 * @property {string} delegate
 * @property {string} agent - the plugin agent type the subagent is spawned as, never null
 * @property {string | null} model
 * @property {string} brief
 * @property {string} reply
 * @property {string} prompt
 */

/**
 * What `delegate next` prints: the units to spawn now, what is still in flight, and — when the
 * Run is done — its dispatch summary.
 * @typedef {object} NextJson
 * @property {"next"} action
 * @property {true} ok
 * @property {string} run
 * @property {boolean} done
 * @property {NextUnit[]} dispatch
 * @property {string[]} in_flight
 * @property {DispatchReport} [summary]
 */

/**
 * One attempt's settlement, as `record` gathers it from its options and its saved reply.
 * @typedef {object} AttemptOutcome
 * @property {string} status
 * @property {string | null} error_kind
 * @property {string | null} reply
 * @property {number | null} wall_ms
 */

/**
 * One unit the Run did not give a usable reply from: the Feature and scenario it is, how many
 * attempts it took, and — when the reply failed its contract — the reply's problems, as
 * `settle` recorded them on the attempt. A Feature-level judge unit (ADR-0039) has no scenario.
 * @typedef {{ unit: string, feature: string, scenario: string | null, attempts: number, kind: string, problems?: string[] }} DispatchFailedUnit
 */

/**
 * What the Run's dispatch did, for Run health: who ran, retries, failed
 * units by kind, breaker trips and fallbacks. A failed unit's `kind` is its last attempt's
 * `error_kind`, `unusable` when that attempt came back but failed its contract, or
 * `not_dispatched` when dispatch stopped before it ran.
 * @typedef {object} DispatchReport
 * @property {string} run
 * @property {string} chosen
 * @property {string[]} delegates
 * @property {string[]} announcements
 * @property {{ planned: number, usable: number }} units
 * @property {number} calls
 * @property {{ unit: string, feature: string, scenario: string | null, attempts: number }[]} retried
 * @property {DispatchFailedUnit[]} failed
 * @property {Record<string, number>} failed_by_kind
 * @property {{ delegate: string, reason: string }[]} breaker_trips
 * @property {{ from: string, to: string, reason: string }[]} fallbacks
 * @property {string | null} stopped
 */

/**
 * One `delegate record --dir <run-dir> --unit <id> --attempt <n> [--status <status>] [--wall-ms <ms>]`
 * call: the command line's options, with `dir`, `unit` and `attempt` required.
 * @typedef {CommandContext & { dir: string, unit: string, attempt: string, status?: string, "wall-ms"?: string }} RecordOptions
 */

// The commands whose plan makes a run dir and writes its `dispatch.spec.json`.
const PLANS = COMMANDS.map((c) => `${c} plan`);
const SPEC = "dispatch.spec.json";
const STATE = "dispatch.json";
const STATUSES = ["ok", "failed", "timeout", "refused"];

// The run dir `--dir` names for `action`: the one a plan made, for `start`, else the one `start` began.
/**
 * @param {string} action
 * @param {string[]} args
 * @param {string | undefined} dir
 * @returns {string}
 */
function opened(action, args, dir) {
  if (dir === undefined) throw new UsageError(`delegate ${action} needs --dir <run-dir>`);
  if (args.length) throw new UsageError(`delegate ${action} takes no arguments`);
  return orThrow(openRunDir(dir, { cmd: "delegate", action, from: action === "start" ? PLANS : "delegate start" })).dir;
}

// The command line's `delegate <action>` (scripts/scan.mjs): each resolves `{json, exit}`.
/** @type {OptionSpec} */
const RUN_DIR = { dir: "value" };

/** @type {CommandDefinition} */
export const command = {
  actions: {
    resolve: {
      options: { root: "qa-dir", cmd: "value" },
      usage: "--cmd <impact|design> [--root <qa-dir>]",
      run(args, { root, cmd }) {
        if (args.length) throw new UsageError("delegate resolve takes no arguments");
        const r = orThrow(resolveDelegates(root, { cmd }));
        return { exit: 0, json: { action: "resolve", ok: true, ...r } };
      },
    },
    start: { options: RUN_DIR, usage: "--dir <run-dir>", run: (args, { dir }) => start(opened("start", args, dir)) },
    next: { options: RUN_DIR, usage: "--dir <run-dir>", run: (args, { dir }) => next(opened("next", args, dir)) },
    record: {
      options: { dir: "value", unit: "value", attempt: "value", status: "value", "wall-ms": "value" },
      usage: "--dir <run-dir> --unit <id> --attempt <n> [--status <status>] [--wall-ms <ms>]",
      // cli.mjs resolves the options before run: every value option is a string the CLI parsed.
      run: (args, options) => record(/** @type {RecordOptions} */ ({ ...options, dir: opened("record", args, options.dir) })),
    },
  },
};

// The least schema a Run of `cmd` writes at: design writes cases, so it needs the level on the case.
/**
 * @param {string} cmd
 * @returns {number}
 */
const minimumSchema = (cmd) => (cmd === "design" ? LEVEL_ON_CASE_SCHEMA_VERSION : ANY_SCHEMA_VERSION);

// Resolves the chosen Delegate's label, once, and mints the Run id.
/**
 * @param {string} dir
 * @returns {CommandResult}
 */
function start(dir) {
  if (existsSync(join(dir, STATE))) throw new UsageError(`${dir} is already started: one Run per run directory`);
  const spec = orThrow(readSpec(dir));
  const newer = refuseUnreadSchema(spec.root, minimumSchema(spec.cmd));
  if (newer) return newer;
  // lib/delegates.mjs is unchecked; its resolution (or `{error}`) is trusted past the gate in
  // `readSpec`'s units.
  const r = orThrow(/** @type {DelegateResolution | { error: string }} */ (resolveDelegates(spec.root, { cmd: spec.cmd })));

  const chosen = r.chosen.label;
  const fallback = r.fallback;
  const chain = chosen === fallback ? [fallback] : [chosen, fallback];

  /** @type {DispatchJson} */
  const state = {
    v: 1,
    run: newRunId(),
    cmd: spec.cmd,
    root: spec.root,
    feature: spec.feature ?? null,
    target: spec.target ?? null,
    chosen,
    tier: r.chosen.tier,
    fallback,
    announcements: [],
    notes: r.notes,
    ...newDispatch({ units: spec.units, chain, cap: r.concurrency_cap }),
  };
  save(dir, state);
  return {
    exit: 0,
    json: {
      action: "start",
      ok: true,
      run: state.run,
      delegate: chain[0],
      tier: state.tier,
      // lib/tiers.mjs is unchecked: the label's model, or null when no Tier binds it.
      model: /** @type {string | null} */ (subagentModel(chain[0])),
      chosen,
      fallback,
      units_planned: spec.units.length,
      concurrency_cap: state.cap,
      notes: r.notes,
    },
  };
}

// The units to spawn now, under the failure policy.
/**
 * @param {string} dir
 * @returns {Promise<CommandResult>}
 */
async function next(dir) {
  const state = orThrow(load(dir));
  /** @type {NextUnit[]} */
  let dispatch = [];
  const label = activeDelegate(state);
  if (label && !finished(state)) {
    let now = Date.now();
    if (ready(state, now).length === 0 && inFlight(state).length === 0) {
      const at = nextReadyAt(state);
      if (at !== null && at > now) await sleep(at - now);
      now = Date.now();
    }
    mkdirSync(join(dir, "attempts"), { recursive: true });
    dispatch = ready(state, now).map((u) => {
      const a = launch(state, u, now);
      return {
        unit: u.id,
        attempt: a.n,
        feature: u.feature,
        scenario: u.scenario,
        delegate: label,
        agent: AGENT_TYPES[state.cmd],
        // lib/tiers.mjs is unchecked: the label's model, or null when no Tier binds it.
        model: /** @type {string | null} */ (subagentModel(label)),
        brief: u.brief,
        reply: attemptReply(dir, u, a),
        prompt: subagentPrompt(state, u),
      };
    });
    save(dir, state);
  }
  const done = finished(state);
  /** @type {NextJson} */
  const json = { action: "next", ok: true, run: state.run, done, dispatch, in_flight: inFlight(state).filter((u) => !dispatch.some((x) => x.unit === u.id)).map((u) => u.id) };
  if (done) json.summary = dispatchSummary(state);
  return { exit: 0, json };
}

// Settles one attempt from its saved reply.
/**
 * @param {RecordOptions} options
 * @returns {CommandResult}
 */
function record(options) {
  const { dir } = options;
  const state = orThrow(load(dir));
  const newer = refuseUnreadSchema(state.root, minimumSchema(state.cmd));
  if (newer) return newer;
  const unit = state.units.find((u) => u.id === options.unit);
  if (!unit) throw new UsageError(`--unit \`${options.unit}\` is no unit of this Run`);
  const attempt = unit.attempts[unit.attempts.length - 1];
  if (unit.status !== "in_flight" || String(attempt?.n) !== options.attempt) {
    throw new UsageError(`unit \`${unit.id}\` has no attempt ${options.attempt} in flight: record each attempt \`next\` handed out, once`);
  }
  const status = options.status ?? "ok";
  if (!STATUSES.includes(status)) throw new UsageError(`--status must be one of ${STATUSES.join(", ")}`);
  const wall = options["wall-ms"] === undefined ? undefined : Number(options["wall-ms"]);
  if (wall !== undefined && !(Number.isInteger(wall) && wall >= 0)) throw new UsageError("--wall-ms takes an integer ≥ 0");
  const path = attemptReply(dir, unit, attempt);
  const reply = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (status === "ok" && reply === null) throw new UsageError(`no reply is saved at ${path}: save the subagent's final message there, or record it with --status failed`);

  /** @type {AttemptOutcome} */
  const outcome = {
    status,
    error_kind: status === "ok" ? null : status === "failed" ? classify(reply ?? "") : status,
    reply: status === "ok" ? reply : null,
    wall_ms: wall ?? null,
  };
  /** @type {string[]} */
  const lines = [];
  const checked = conclude(dir, state, unit, attempt, outcome, lines, options.env);
  save(dir, state);
  return {
    exit: 0,
    json: {
      action: "record",
      ok: true,
      unit: unit.id,
      attempt: attempt.n,
      status,
      error_kind: outcome.error_kind,
      usable: checked.usable,
      problems: checked.problems,
      retry: /** @type {UnitStatus} */ (unit.status) === "queued",
      announcements: lines,
    },
  };
}

// Validates `dispatch.spec.json`, returning it, or `{error}`.
/**
 * @param {string} dir
 * @returns {DispatchSpec | { error: string }}
 */
function readSpec(dir) {
  // lib/run-dir.mjs's read result, flattened so the gate below reads its own `{error}`.
  /** @type {RunFileResult<DispatchSpec>} */
  const read = readRunFile(dir, SPEC, { by: PLANS, restart: PLANS, missing: `no ${SPEC} in ${dir}: run ${PLANS.map((p) => `\`${p}\``).join(" or ")} first` });
  if (read.error) return /** @type {{ error: string }} */ (read);
  // What a plan wrote (lib/impact.mjs, lib/design.mjs): its raw JSON, trusted at this boundary.
  const spec = /** @type {DispatchSpec} */ (read.value);
  /**
   * @param {string} why
   * @returns {{ error: string }}
   */
  const bad = (why) => ({ error: `${join(dir, SPEC)}: ${why}` });
  if (!COMMANDS.includes(spec?.cmd)) return bad(`\`cmd\` must be one of ${COMMANDS.join(", ")}`);
  if (typeof spec.root !== "string" || !existsSync(spec.root)) return bad("`root` must name the `.qa/` directory");
  if (!Array.isArray(spec.units)) return bad("`units` must be a list");
  const ids = new Set();
  for (const u of spec.units) {
    if (typeof u?.id !== "string" || ids.has(u.id)) return bad(`every unit needs its own string \`id\` (${JSON.stringify(u?.id)})`);
    ids.add(u.id);
    for (const k of ["feature", "brief", "reply"]) if (typeof u[k] !== "string") return bad(`unit \`${u.id}\` has no \`${k}\``);
    // A Feature-level judge unit (ADR-0039) judges a Feature, not a scenario file, so it has no
    // scenario.
    if (u.scenario !== null && typeof u.scenario !== "string") return bad(`unit \`${u.id}\` has no \`scenario\``);
    if (!existsSync(u.brief)) return bad(`unit \`${u.id}\`'s brief ${u.brief} does not exist`);
    const contract = CONTRACTS[u.contract?.kind];
    if (!contract) return bad(`unit \`${u.id}\`'s contract must be one of ${Object.keys(CONTRACTS).join(", ")}`);
    const data = contract.load(u.contract);
    if (data.error) return bad(`unit \`${u.id}\`: ${data.error}`);
  }
  return spec;
}

/**
 * The run's `dispatch.json`, or its `{error}`.
 * @param {string} dir
 * @returns {LoadedDispatch}
 */
function load(dir) {
  // lib/run-dir.mjs's read result, flattened so the ternary below reads its own `{error}`.
  /** @type {RunFileResult<DispatchJson>} */
  const read = readRunFile(dir, STATE, { by: "delegate start", restart: PLANS, missing: `${dir} has no started Run: run \`delegate start --dir ${dir}\` first` });
  return read.error ? /** @type {{ error: string }} */ (read) : /** @type {DispatchJson & { error?: never }} */ (read.value);
}

/**
 * @param {string} dir
 * @param {DispatchJson} state
 * @returns {void}
 */
function save(dir, state) {
  const tmp = join(dir, `${STATE}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, join(dir, STATE));
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
const scale = (env) => {
  const s = Number(env.QA_SKILLS_DISPATCH_SCALE);
  return Number.isFinite(s) && s > 0 ? s : 1;
};
/**
 * @param {number} ms
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
const scaled = (ms, env) => Math.round(ms * scale(env));
/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Where one attempt's reply is saved: in the run directory, beside the unit's.
/**
 * @param {string} dir
 * @param {DispatchJsonUnit} unit
 * @param {Attempt} attempt
 * @returns {string}
 */
function attemptReply(dir, unit, attempt) {
  return join(dir, "attempts", `${unit.id.replace(/[^A-Za-z0-9_.-]/g, "_")}.${attempt.n}.reply.md`);
}

// Checks one settled attempt against its unit's contract, lets the contract act on a usable reply
// (`accept`) and settles it in the policy. Leaves the usable reply (else
// the last one obtained) at the unit's `reply` path.
/**
 * @param {string} dir
 * @param {DispatchJson} state
 * @param {DispatchJsonUnit} unit
 * @param {Attempt} attempt
 * @param {AttemptOutcome} outcome
 * @param {string[]} lines
 * @param {Record<string, string | undefined>} [env]
 * @returns {import("./contracts.mjs").ReplyCheck}
 */
function conclude(dir, state, unit, attempt, outcome, lines, env = process.env) {
  const contract = CONTRACTS[unit.contract.kind];
  const data = contract.load(unit.contract);
  // The reply is on disk and the brief cleared `load`, so `check` runs against what it loaded;
  // `checkReply`'s own gates ran at load (CODING_STANDARDS: trusted read boundary).
  const checked = outcome.status === "ok" && outcome.reply !== null && !data.error
    ? contract.check(outcome.reply, /** @type {import("./contracts.mjs").LoadedContractData} */ (data))
    : { usable: false, problems: [] };
  const label = state.chain[attempt.delegate];
  if (checked.usable && contract.accept) contract.accept(/** @type {string} */ (outcome.reply), /** @type {import("./contracts.mjs").LoadedContractData} */ (data), { checked, delegate: label });
  if (outcome.reply !== null) {
    const path = attemptReply(dir, unit, attempt);
    if (!existsSync(path)) {
      mkdirSync(join(dir, "attempts"), { recursive: true });
      writeFileSync(path, outcome.reply);
    }
    if (checked.usable || !unit.attempts.some((a) => a.usable)) copyFileSync(path, unit.reply);
  }
  lines.push(...settle(state, unit, { status: outcome.status, error_kind: outcome.error_kind, usable: checked.usable, problems: checked.problems.map((p) => p.code) }, Date.now(), scaled(POLICY.cooldown_ms, env)));
  state.announcements.push(...lines.filter((l) => !state.announcements.includes(l)));
  return checked;
}

// The classification of a failed attempt's text: `quota` (the allowance is spent; a retry in this
// Run is futile), else `other`.
const QUOTA = /RESOURCE_EXHAUSTED|quota|resets in/i;
/**
 * @param {string} text
 * @returns {"quota" | "other"}
 */
const classify = (text) => (QUOTA.test(text) ? "quota" : "other");

// The fixed prompt a subagent unit is spawned with. The brief itself is the file it names, which the
// CLI wrote byte for byte (ADR-0011): retyping ~40 KB per unit into each prompt costs more than the
// unit. The prompt tells the subagent to read all of it and to keep its reader's line numbers out
// of every quote.
/**
 * @param {DispatchJson} state
 * @param {DispatchJsonUnit} unit
 * @returns {string}
 */
export function subagentPrompt(state, unit) {
  const role = CONTRACTS[unit.contract.kind].role;
  return [
    `You are one ${role} of /qa-${state.cmd}. Your complete brief is the file ${unit.brief}. Read all of it:`,
    "if a read stops early or cuts a line short, read on until you have every line in full. Your file",
    "reader may put a line number before each line; that number is not part of the brief, so never",
    "include it in anything you quote. The files the brief names are inlined in it: open no other file,",
    "including those. Write nothing and run nothing. Your final message is the report the brief asks",
    "for, ending with its one fenced json block.",
  ].join("\n");
}

// The Run's dispatch as the command's report needs it, or null when nothing was dispatched (no
// `delegate start` in `dir`): `dispatchSummary` and the resolution notes.
/**
 * @param {string} dir
 * @returns {DispatchReport & { notes: DelegateNote[] } | null}
 */
export function readDispatch(dir) {
  const state = load(dir);
  if (state.error) return null;
  return { ...dispatchSummary(/** @type {DispatchJson} */ (state)), notes: /** @type {DispatchJson} */ (state).notes ?? [] };
}

// What the Run's dispatch did, for Run health: who ran, retries, failed
// units by kind, breaker trips and fallbacks. A failed unit's `kind` is its last attempt's
// `error_kind`, `unusable` when that attempt came back but failed its contract, or
// `not_dispatched` when dispatch stopped before it ran.
/**
 * @param {DispatchJson} state
 * @returns {DispatchReport}
 */
export function dispatchSummary(state) {
  const retried = state.units.filter((u) => u.attempts.length > 1).map((u) => ({ unit: u.id, feature: u.feature, scenario: u.scenario, attempts: u.attempts.length }));
  const failed = state.units.filter((u) => u.status !== "done").map((u) => {
    const last = u.attempts[u.attempts.length - 1];
    const kind = !last ? "not_dispatched" : last.status === undefined ? "in_flight" : last.error_kind ?? "unusable";
    // `settle` records the reply's problems' codes on the attempt (lib/dispatch.mjs).
    return { unit: u.id, feature: u.feature, scenario: u.scenario, attempts: u.attempts.length, kind, ...(kind === "unusable" ? { problems: /** @type {string[]} */ (last.problems) } : {}) };
  });
  /** @type {Record<string, number>} */
  const byKind = {};
  for (const f of failed) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  const ran = [...new Set(state.units.flatMap((u) => u.attempts.map((a) => a.delegate)))].sort().map((i) => state.chain[i]);
  const fallbacks = [];
  for (const t of state.trips) if (t.to !== null) fallbacks.push({ from: t.delegate, to: t.to, reason: t.reason });
  return {
    run: state.run,
    chosen: state.chosen,
    delegates: ran.length ? ran : [state.chain[0]],
    announcements: state.announcements,
    units: { planned: state.units.length, usable: state.units.filter((u) => u.status === "done").length },
    calls: state.units.reduce((n, u) => n + u.attempts.length, 0),
    retried,
    failed,
    failed_by_kind: byKind,
    breaker_trips: state.trips.map((t) => ({ delegate: t.delegate, reason: t.reason })),
    fallbacks,
    stopped: state.stopped?.reason ?? null,
  };
}
