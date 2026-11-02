// @ts-check
// `scout`: the CLI half of the Scouts (ADR-0017, ADR-0018): in-session subagents that do a
// command's noisy fetching and leave the result in one file of a run dir.
//
//   brief tracker --dir <sync-run-dir>
//       `/qa-sync`'s tracker scout's brief (lib/scout-prompt.mjs `trackerBrief`): what `sync scope`
//       names for the run in that dir, with the Access note the tracker is reached through and
//       `train/sync.md`'s Practices inlined. Its `output_file` is that run's `payload_file`, which
//       `sync card` reads in place. Refuses a dir `sync scope` did not make, and a project with no
//       tracker.
//
//   brief ui <url> <request> [--dir <run-dir>]
//       The UI scout's brief for one `observe:` input (lib/scout-prompt.mjs `uiBrief`), with the
//       Access note matching <url> and `train/deep-dive.md`'s Practices inlined. A note with a saved
//       login (`via: cli:playwright-cli`) names the login-state file; a CLI login (ADR-0019;
//       `identifiers.user`, the password in `env:NAME` or a `file:`) has it log in first
//       (lib/scout-login.mjs), saving the login state into the run dir. Refuses, writing nothing,
//       when `project.md`'s `scout.allowed_hosts` bars <url>'s host (checked first), no note
//       matches, the note is neither, the login-state or password file is missing or one git would
//       track, the password's variable is unset, or the login fails.
//
//   ingest --dir <run-dir>
//       Checks the report a UI scout wrote into the run dir and writes it as an Observation at
//       `.qa/observations/<date>-<slug>.md`, printing `{ok, path, uri}` with its `file:` URI; see
//       lib/scout-ingest.mjs for each refusal. The only scout action that writes into `.qa/`.
//
//   login-steps <url> <login_state>
//       The hand steps that save the login state of the app at <url> (lib/scout-prompt.mjs
//       `loginSteps`, the text `brief ui` and `ingest` refuse with), for `/qa-train access` to show
//       at its gate, before the Access note exists. <login_state> is the repo-relative path an Access
//       note's `identifiers.login_state` holds. Prints `{ok, login_state, steps}`: `login_state` its
//       absolute path from the repository root, `steps` the text to show as it stands. Reads no
//       note, and needs no file at the path, which the steps create. Writes nothing. Refuses as
//       `brief ui` does when `scout.allowed_hosts` bars <url>'s host, unless its origin is in `targets`.
//
//   password-steps <via>
//       How the engineer puts a CLI login's password where `via` (`env:NAME` or `file:<path>`) says
//       (lib/scout-prompt.mjs `passwordSteps`, the text `brief ui` refuses a missing password with),
//       for `/qa-train access` to show at its gate. Prints `{ok, steps}`, and for a file its absolute
//       path from the repository root as `password_file`. Reads no note. Writes nothing.
//
// One Scout per run dir (for `ui` a fresh OS temp dir by default; ADR-0024's convention,
// lib/run-dir.mjs; for `tracker`, sync's own run dir, where a new brief replaces the last). A
// `brief <scout>` call writes, and prints the absolute path of:
//
//   scout-<scout>.brief.md   `brief_file`: the brief, which the Scout is told to read
//   scout-<scout>.json       the input the brief was written for (for `ui`: `url`, `request`, the
//                            Access note's key, the login-state file's absolute path, for a CLI
//                            login `login: "cli"` and the `user`, the session and `output_file`),
//                            which a later `scout` call reads back; what it
//                            checks the output against is lib/scout-prompt.mjs's, never a copy
//
// and prints `output_file`, the one file the Scout writes (ADR-0018). For `ui` it is
// `scout-ui.report.md` in the run dir, which `scout ingest` reads back. Every refusal prints
// `{ok: false, reason, error}` and exits 1; a usage error is a thrown `UsageError` (lib/cli.mjs).
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { accessFor, rolesCoveringIn } from "./access.mjs";
import { cliLoginUser, PASSWORD_VIA } from "./access-note.mjs";
import { orThrow, SCAN_CLI, UsageError, usageOf } from "./cli.mjs";
import { rootConfig } from "./qa-index.mjs";
import { newRunDir } from "./run-dir.mjs";
import { subagentModel, tierOf } from "./tiers.mjs";
import { refuseUnreadSchema } from "./schema-guard.mjs";
import { ANY_SCHEMA_VERSION, DEEP_DIVE_TRAIN_KEY, PUBLISH_TRAIN_KEY, SYNC_TRAIN_KEY } from "./schema.mjs";
import { ingestUi, refuse } from "./scout-ingest.mjs";
import { logIn } from "./scout-login.mjs";
import { loginSteps, passwordSteps, trackerBrief, uiBrief } from "./scout-prompt.mjs";
import { isSyncRunDir, command as sync } from "./sync.mjs";
import { practicesText } from "./training.mjs";
import { publisherBrief, isPublishRunDir, command as publish } from "./publish.mjs";

/**
 * @typedef {import("./cli.mjs").CommandContext} CommandContext
 * @typedef {import("./cli.mjs").CommandDefinition} CommandDefinition
 * @typedef {import("./cli.mjs").CommandResult} CommandResult
 * @typedef {import("./cli.mjs").OptionSpec} OptionSpec
 */

/**
 * The command context of a scout action: `--root` is a `qa-dir` option, so always resolved.
 * @typedef {CommandContext & { root: string }} ScoutCommandContext
 */

/**
 * An Access note as `accessFor` shows it, transcribed for the fields a scout reads.
 * @typedef {{
 *   key: string,
 *   statement?: string,
 *   match?: unknown,
 *   role?: string,
 *   via?: string,
 *   host?: string,
 *   identifiers?: Record<string, unknown>,
 *   credential_from?: string,
 *   quirks?: string,
 *   withheld?: true,
 * }} ScoutAccessNote
 */

/**
 * `scout-ui.json`, the UI scout's record, written by `brief ui` and read by `ingest`.
 * @typedef {{
 *   scout: "ui",
 *   url: string,
 *   request: string,
 *   access: string,
 *   login_state: string,
 *   login?: "cli",
 *   user?: string,
 *   session: string,
 *   output_file: string,
 * }} ScoutUiRecord
 */

/**
 * `scout-tracker.json`, the tracker scout's record.
 * @typedef {{
 *   scout: "tracker",
 *   access: string | null,
 *   output_file: string,
 * }} ScoutTrackerRecord
 */

/**
 * What a UI scout's login adds to its record.
 * @typedef {{ login?: "cli", user?: string }} ScoutLoginRecord
 */

/**
 * What `reach(dir, session)` returns: the saved login-state path, or the refusal.
 * @typedef {{ state: string, refusal?: undefined } | { refusal: CommandResult, unreachable?: boolean, state?: undefined }} ScoutReach
 */

/**
 * How the UI scout gets into the app: a refusal, or a reach function and its record fields.
 * @typedef {{ refusal: CommandResult, reach?: never, record?: never }
 *   | { refusal?: never, reach: (dir: string, session: string) => ScoutReach, record: ScoutLoginRecord }} ScoutLogin
 */

/**
 * A CLI login's password: the password, or the refusal for a missing one.
 * @typedef {{ password: string, refusal?: never } | { password?: never, refusal: CommandResult }} ScoutSecret
 */

/**
 * Where a password `via` keeps it.
 * @typedef {{ name?: string, file?: string }} PasswordPlace
 */

/**
 * A file git tracks or would track, from the repository's top.
 * @typedef {{ tracked: boolean, rel: string, top: string }} GitTracking
 */

/**
 * @typedef {{ reason: string, what: string, holding: string }} TrackedFile
 */

/**
 * @typedef {{ tier: string, label: string, model: string | null }} ScoutModel
 */

// Every scout action's synopsis, which each usage error ends with.
const usage = () => usageOf("scout", command).join(" | ");

// The `via` an app's Access note names: the UI scout reaches the app through playwright-cli alone.
const PLAYWRIGHT_VIA = "cli:playwright-cli";
// The key of the Access note's `identifiers` that names the login-state file, repo-relative.
const LOGIN_STATE = "login_state";

// The command line's `scout <action>` (scripts/scan.mjs): each prints `{json, exit}`. Every action
// takes the same options, which may come before it.
/** @type {OptionSpec} */
const OPTIONS = { root: "qa-dir", dir: "value" };

/** @type {CommandDefinition} */
export const command = {
  options: OPTIONS,
  actions: {
    brief: {
      usage: ["ui <url> <request> [--dir <run-dir>] [--root <qa-dir>]", "tracker --dir <run-dir> [--root <qa-dir>]", "publisher --dir <run-dir> [--root <qa-dir>]"],
      /**
       * @param {string[]} params
       * @param {CommandContext} ctx
       * @returns {CommandResult}
       */
      run([kind, ...args], ctx) {
        if (!Object.hasOwn(BRIEFS, kind ?? "")) throw new UsageError(`scout brief takes a scout: ${Object.keys(BRIEFS).join(", ")}; ${usage()}`);
        const result = BRIEFS[/** @type {string} */ (kind)](args, /** @type {ScoutCommandContext} */ (ctx));
        return { exit: result.exit, json: { action: "brief", scout: kind, ...result.json } };
      },
    },
    ingest: {
      usage: "--dir <run-dir> [--root <qa-dir>]",
      /**
       * @param {string[]} args
       * @param {ScoutCommandContext} ctx
       * @returns {CommandResult}
       */
      run(args, { root, dir }) {
        if (args.length !== 0) throw new UsageError(`scout ingest takes no arguments, only --dir <run-dir>; ${usage()}`);
        const newer = refuseUnreadSchema(root, ANY_SCHEMA_VERSION);
        if (newer) return newer;
        const result = orThrow(ingestUi(dir, root));
        return { exit: result.exit, json: { action: "ingest", ...result.json } };
      },
    },
    "login-steps": {
      usage: "<url> <login_state> [--root <qa-dir>]",
      /**
       * @param {string[]} args
       * @param {ScoutCommandContext} ctx
       * @returns {CommandResult}
       */
      run(args, { root }) {
        if (args.length !== 2) throw new UsageError(`scout login-steps takes exactly a <url> and a <login_state>; ${usage()}`);
        const [url, named] = args;
        if (!isWebUrl(url)) throw new UsageError(`\`${url}\` is not an http or https URL`);
        if (!named.trim()) throw new UsageError("scout login-steps needs a <login_state>: the repo-relative path of the login-state file");
        const target = Object.values(rootConfig(root).targets ?? {}).includes(new URL(url).origin);
        const barred = target ? null : hostRefusal(root, url);
        if (barred) return { exit: barred.exit, json: { action: "login-steps", ...barred.json } };
        const login_state = repoPath(root, named);
        return { exit: 0, json: { action: "login-steps", ok: true, login_state, steps: loginSteps({ url, loginState: login_state }) } };
      },
    },
    "password-steps": {
      usage: "<via> [--root <qa-dir>]",
      /**
       * @param {string[]} args
       * @param {ScoutCommandContext} ctx
       * @returns {CommandResult}
       */
      run(args, { root }) {
        if (args.length !== 1 || !PASSWORD_VIA.test(args[0])) throw new UsageError(`scout password-steps takes exactly a <via>, \`env:NAME\` or \`file:<path>\`; ${usage()}`);
        const place = passwordPlace(root, args[0]);
        return { exit: 0, json: { action: "password-steps", ok: true, ...(place.file && { password_file: place.file }), steps: passwordSteps(place) } };
      },
    },
  },
  // An unknown action's usage error lists every action's synopsis.
  refuse: (e) => ({ exit: 2, json: { ok: false, error: e.detail.code === "unknown_action" ? `${e.message}; ${usage()}` : e.message } }),
};

/**
 * One scout's brief: `args` after the scout name, the command context, and the `{exit, json}` it prints.
 * @typedef {(args: string[], ctx: ScoutCommandContext) => CommandResult} ScoutBrief
 */

/** @type {Record<string, ScoutBrief>} */
const BRIEFS = {
  /**
   * @param {string[]} args
   * @param {ScoutCommandContext} options
   * @returns {CommandResult}
   */
  publisher(args, options) {
    const result = publisherBrief(args, options);
    if (result.json.ok) Object.assign(result.json, modelOf(options.root, "publisher"));
    return result;
  },
  /**
   * @param {string[]} args
   * @param {ScoutCommandContext} options
   * @returns {CommandResult}
   */
  ui(args, { root, dir }) {
    if (args.length !== 2) throw new UsageError(`scout brief ui takes exactly a <url> and a <request>; ${usage()}`);
    const [url, request] = args;
    if (!isWebUrl(url)) throw new UsageError(`\`${url}\` is not an http or https URL`);
    if (!request.trim()) throw new UsageError("scout brief ui needs a <request>: what to look at");
    const barred = hostRefusal(root, url);
    if (barred) return barred;
    const run = newRunDir(dir, "qa-scout-");
    if (run.error) throw new UsageError(run.error);
    if (run.exists && existsSync(join(/** @type {string} */ (run.dir), "scout-ui.json"))) {
      return refuse("dir_has_scout", `${run.dir} already holds a UI scout's brief: one UI scout per run dir, so name a fresh --dir`);
    }

    // observe: reads the role-less note only; the lookup URI is normalised as a Reference's is.
    const uri = `url:${new URL(url).href}`;
    const note = /** @type {ScoutAccessNote | null} */ (accessFor(root, [uri], { passwordFiles: true })[uri]);
    if (!note) {
      const roles = rolesCoveringIn(root, uri, { passwordFiles: true });
      if (roles.length) return refuse("no_access_note", `no role-less Access note matches ${url}, only Role-tagged ones (${roles.join(", ")}), and observe: reads a role-less note only: add a role-less note with its own test account for the app with \`/qa-train access\`, or drop \`role\` from the note of the account observe: should use`, { roles });
      return refuse("no_access_note", `no Access note matches ${url}: teach how to reach the app with \`/qa-train access\` (a \`url:\` prefix covering it, \`via: ${PLAYWRIGHT_VIA}\` and the login-state file)`);
    }
    if (note.withheld) return refuse("note_withheld", `the Access note matching ${url} holds what looks like a credential, so it is not passed to a Scout: fix \`train/access.md\` with \`/qa-train access\``);
    const login = loginFor(root, note, url);
    if (login.refusal) return login.refusal;

    const made = (/** @type {{ make: () => string }} */ (run)).make();
    const session = basename(made).replace(/[^A-Za-z0-9_-]/g, "-");
    const reached = login.reach(made, session);
    if (reached.refusal) {
      // A run dir this brief made holds nothing worth keeping; one named by --dir that already existed is left.
      if (!run.exists) rmSync(made, { recursive: true, force: true });
      return reached.refusal;
    }
    const loginState = reached.state;
    const brief_file = join(made, "scout-ui.brief.md");
    const output_file = join(made, "scout-ui.report.md");
    const practices = practicesText(root, DEEP_DIVE_TRAIN_KEY);
    writeFileSync(brief_file, uiBrief({ dir: made, session, url, request, output: output_file, loginState, note, practices }));
    /** @type {ScoutUiRecord} */
    const record = { scout: "ui", url, request, access: note.key, login_state: loginState, ...login.record, session, output_file };
    writeFileSync(join(made, "scout-ui.json"), `${JSON.stringify(record, null, 2)}\n`);
    return { exit: 0, json: { ok: true, dir: made, brief_file, output_file, access: note.key, ...modelOf(root, "ui scout") } };
  },

  // `/qa-sync`'s tracker scout: briefed in sync's own run dir, it writes `sync scope`'s
  // `payload_file`, where `sync card` reads it in place. A later brief in the same dir replaces
  // this one: the one retry after a credential failure is a fresh scout.
  /**
   * @param {string[]} args
   * @param {ScoutCommandContext} options
   * @returns {CommandResult}
   */
  tracker(args, { root, dir }) {
    if (args.length) throw new UsageError(`scout brief tracker takes no arguments, only --dir <run-dir>, the \`dir\` \`sync scope\` printed; ${usage()}`);
    if (dir === undefined) throw new UsageError(`scout brief tracker needs --dir <run-dir>, the \`dir\` \`sync scope\` printed; ${usage()}`);
    const runDir = resolve(dir);
    const publishing = isPublishRunDir(runDir);
    if (!publishing && !isSyncRunDir(runDir)) {
      return refuse("not_a_sync_run", `${runDir} is not a /qa-sync run dir: run \`sync scope\` first and pass the \`dir\` it prints`);
    }
    // `sync scope` and `publish scope` print the same tracker-scope fields; this names the ones read here.
    const scoped = /** @type {{ exit: number, json: { ok?: boolean, refusals?: { reason?: string, line?: string }[], text: string, payload_file: string, access: ScoutAccessNote | null, [field: string]: unknown } }} */ (
      (publishing ? publish : sync).actions.scope.run([], { root, dir: runDir }));
    if (scoped.json.ok === false) throw new UsageError(scoped.json.refusals?.[0]?.reason ?? scoped.json.refusals?.[0]?.line ?? scoped.json.text);
    const { payload_file, tracker, fields, label_destinations, mark_field, mark_search, scenarios, suites, cases, suite_items, suite_search, marked_cases, marked_scenarios, marked_suites, stories, bug_metadata, bug_statuses, access } = scoped.json;
    if (!tracker) return refuse("no_tracker", "`project.md` configures no tracker, so there is nothing for a tracker scout to fetch");

    const brief_file = join(runDir, "scout-tracker.brief.md");
    const prose = `node ${SCAN_CLI} ${publishing ? "publish" : "sync"} scope --dir ${runDir} --root ${resolve(root)}`;
    const practices = practicesText(root, publishing ? PUBLISH_TRAIN_KEY : SYNC_TRAIN_KEY);
    writeFileSync(brief_file, trackerBrief({ output: payload_file, scope: /** @type {import("./scout-prompt.mjs").TrackerScope} */ ({ fields, label_destinations, mark_field, mark_search, scenarios, suites, cases, suite_items, suite_search, marked_cases, marked_scenarios, marked_suites, stories, bug_metadata, bug_statuses }), prose, note: access, practices, publishing }));
    /** @type {ScoutTrackerRecord} */
    const record = { scout: "tracker", access: access?.key ?? null, output_file: /** @type {string} */ (payload_file) };
    writeFileSync(join(runDir, "scout-tracker.json"), `${JSON.stringify(record, null, 2)}\n`);
    return { exit: 0, json: { ok: true, dir: runDir, brief_file, output_file: payload_file, access: record.access, ...modelOf(root, "tracker scout") } };
  },
};

// The refusal for observing `url` when `project.md`'s `scout.allowed_hosts` bars its host, or
// null: `observe_disabled` for `[]`, `host_not_allowed` for a host not listed. Only the URL observed
// is checked: an Access note's `login_url` is a sign-in page, not the app.
/**
 * @param {string} root
 * @param {string} url
 * @returns {CommandResult | null}
 */
function hostRefusal(root, url) {
  const allowed = rootConfig(root).allowedHosts;
  if (allowed === null) return null;
  if (!allowed.length) return refuse("observe_disabled", "`scout.allowed_hosts` in `.qa/project.md` is empty, so observe: is turned off: list a host there to observe it");
  const host = new URL(url).hostname;
  if (allowed.includes(host)) return null;
  return refuse("host_not_allowed", `${host} is not in \`scout.allowed_hosts\` in \`project.md\` (${allowed.join(", ")}), so it is not observed: add it there if it is safe to observe`, { host, allowed_hosts: allowed });
}

// The Tier a Scout is bound to (lib/tiers.mjs) and the model it is spawned with: that Tier's label
// (`tier`, `label`), or none (`model: null`) for `inherit`, the session's own model (ADR-0021).
/**
 * @param {string} root
 * @param {string} agent
 * @returns {ScoutModel}
 */
function modelOf(root, agent) {
  const { tier, label } = tierOf(root, agent);
  return { tier, label, model: subagentModel(label) };
}

// How the UI scout gets into the app, from the Access note matching `url`: `{refusal}` when the note
// cannot get it in, else `{reach(dir, session), record}`. `reach` returns `{state}`, the absolute path
// of the login-state file the brief loads, or `{refusal}`; `record` is what the brief's record adds.
// A saved login (`via: cli:playwright-cli`) names that file; a CLI login (ADR-0019) logs in
// into the run dir `dir`, as `cliLoginUser` with the password its `via` names (`reach` also says
// `unreachable: true` when the app could not be reached at all, which is no failed login). `execute plan`
// calls it for the refusal alone, never `reach`: a missing secret or state is found before the confirm.
/**
 * @param {string} root
 * @param {ScoutAccessNote} note
 * @param {string} url
 * @returns {ScoutLogin}
 */
export function loginFor(root, note, url) {
  const user = cliLoginUser(note);
  if (user) {
    const secret = readSecret(root, note);
    if (secret.refusal) return /** @type {ScoutLogin} */ (secret);
    /**
     * @param {string} dir
     * @param {string} session
     * @returns {ScoutReach}
     */
    const reach = (dir, session) => {
      /** @type {{ state: string, reason?: undefined, error?: undefined, unreachable?: undefined } | { reason: string, error: string, unreachable?: boolean, state?: undefined }} */
      const login = logIn({ dir, session, url, password: secret.password, identifiers: note.identifiers });
      return login.reason ? { refusal: refuse(login.reason, `Access note \`${note.key}\`: ${login.error}`, { access: note.key }), ...(login.unreachable && { unreachable: true }) } : { state: /** @type {string} */ (login.state) };
    };
    return { reach, record: { login: "cli", user } };
  }
  if (note.via !== PLAYWRIGHT_VIA) {
    return { refusal: refuse("wrong_via", `Access note \`${note.key}\` matches ${url} but reaches it through \`${note.via}\`; a UI scout reaches the app through \`${PLAYWRIGHT_VIA}\` with a saved login state, or logs in as the note's \`user\` with the password in \`env:NAME\` or \`file:<path>\`: change the note with \`/qa-train access\``) };
  }
  const named = note.identifiers?.[LOGIN_STATE];
  if (typeof named !== "string" || !named) {
    return { refusal: refuse("no_login_state", `Access note \`${note.key}\` names no login-state file: add \`${LOGIN_STATE}\` to its \`identifiers\`, a git-ignored path such as \`.qa/.auth/app.json\`, with \`/qa-train access\``) };
  }
  const loginState = repoPath(root, named);
  if (!existsSync(loginState)) {
    return { refusal: refuse("login_state_missing", `the login-state file \`${named}\` that Access note \`${note.key}\` names does not exist: ${loginSteps({ url, loginState })}`) };
  }
  const tracked = trackedRefusal(loginState, { reason: "login_state", what: "the login-state file", holding: "its session cookies" });
  if (tracked) return { refusal: tracked };
  return { reach: () => ({ state: loginState }), record: {} };
}

// The password a CLI-login note's `via` names: `{password}`, or `{refusal}` when the variable is unset
// or empty, or the file is missing, empty or one git would track. A file's one trailing line break,
// which an editor adds, is not part of the password.
/**
 * @param {string} root
 * @param {ScoutAccessNote} note
 * @returns {ScoutSecret}
 */
function readSecret(root, note) {
  /** @param {string} where @param {string} steps @returns {ScoutSecret} */
  const missing = (where, steps) => ({ refusal: refuse("login_secret_missing", `Access note \`${note.key}\` logs in with the password in ${where}: ${steps}${from(note)}`, { access: note.key }) });
  const { name, file } = passwordPlace(root, /** @type {string} */ (note.via));
  if (name) {
    const password = process.env[name];
    return password ? { password } : missing(`the environment variable \`${name}\`, which is not set in the environment this agent was started from`, passwordSteps({ name }));
  }
  const named = /** @type {string} */ (note.via).slice("file:".length);
  if (!existsSync(/** @type {string} */ (file))) return missing(`the file \`${named}\`, which does not exist`, passwordSteps({ file }));
  const tracked = trackedRefusal(/** @type {string} */ (file), { reason: "login_secret", what: "the password file", holding: "the password" });
  if (tracked) return { refusal: tracked };
  const password = readFileSync(/** @type {string} */ (file), "utf8").replace(/\r?\n$/, "");
  return password ? { password } : missing(`the file \`${named}\`, which is empty`, passwordSteps({ file }));
}

// Where a password `via` (`PASSWORD_VIA`) keeps it: `{name}`, an environment variable's, or `{file}`,
// the absolute path of a repo-relative file.
/**
 * @param {string} root
 * @param {string} via
 * @returns {PasswordPlace}
 */
function passwordPlace(root, via) {
  return via.startsWith("env:") ? { name: via.slice("env:".length) } : { file: repoPath(root, via.slice("file:".length)) };
}

// The refusal for a file at `abs` that git would track or tracks (`<reason>_not_ignored`,
// `<reason>_tracked`), with the `.gitignore` line to add, or null when git ignores it.
/**
 * @param {string} abs
 * @param {TrackedFile} details
 * @returns {CommandResult | null}
 */
function trackedRefusal(abs, { reason, what, holding }) {
  const tracking = gitTracking(abs);
  if (!tracking) return null;
  const line = gitignoreLine(tracking);
  const fix = tracking.tracked
    ? `git tracks ${what} \`${tracking.rel}\`, so it would be committed with ${holding}: run \`git rm --cached -- ${tracking.rel}\` and add this line to \`.gitignore\`: ${line}`
    : `git would track ${what} \`${tracking.rel}\`, so it could be committed with ${holding}: add this line to \`.gitignore\`: ${line}`;
  return refuse(tracking.tracked ? `${reason}_tracked` : `${reason}_not_ignored`, fix, { gitignore_line: line });
}

// Where a person gets the note's credential, as a closing clause, when the note says.
/**
 * @param {ScoutAccessNote} note
 * @returns {string}
 */
const from = (note) => (typeof note.credential_from === "string" && note.credential_from ? ` (the password: ${note.credential_from})` : "");

// The absolute path of a repo-relative path an Access note names (a login-state or password file):
// under the repository's root, the directory that holds `root` (`.qa/`).
/**
 * @param {string} root
 * @param {string} named
 * @returns {string}
 */
export function repoPath(root, named) {
  return resolve(dirname(resolve(root)), named);
}

// Whether git would track the file at `abs`: null when it would not (it is ignored, or it lies
// outside any repository), else `{tracked, rel, top}`: its path from the repository's top, and the top.
/**
 * @param {string} abs
 * @returns {GitTracking | null}
 */
function gitTracking(abs) {
  const real = realpathSync(abs);
  const found = spawnSync("git", ["-C", dirname(real), "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (found.status !== 0) return null;
  const top = found.stdout.trim();
  const rel = relative(realpathSync(top), real).split(sep).join("/");
  if (rel.startsWith("../") || isAbsolute(rel)) return null;
  /** @param {...string} a @returns {number | null} */
  const git = (...a) => spawnSync("git", ["-C", top, ...a, "--", rel], { encoding: "utf8" }).status;
  if (git("ls-files", "--error-unmatch") === 0) return { tracked: true, rel, top };
  return git("check-ignore", "-q") === 0 ? null : { tracked: false, rel, top };
}

// The `.gitignore` line for the login-state file at `rel` (from the repository's top `top`): its
// directory, `/.qa/.auth/`, the form `/qa-train access` teaches, unless git tracks another file
// under that directory, which the line would hide too; then the file itself, `/.qa/state.json`,
// as it does for a file in the repository's root, `/auth.json`.
/**
 * @param {{ rel: string, top: string }} tracking
 * @returns {string}
 */
function gitignoreLine({ rel, top }) {
  const dir = dirname(rel);
  if (dir === ".") return `/${rel}`;
  const tracked = spawnSync("git", ["-C", top, "ls-files", "-z", "--", dir], { encoding: "utf8" });
  const others = tracked.status === 0 ? tracked.stdout.split("\0").filter((p) => p && p !== rel) : [];
  return others.length ? `/${rel}` : `/${dir}/`;
}

/**
 * @param {string} s
 * @returns {boolean}
 */
function isWebUrl(s) {
  if (!/^https?:\/\/\S+$/.test(s)) return false;
  try {
    return ["http:", "https:"].includes(new URL(s).protocol);
  } catch {
    return false;
  }
}
