// @ts-check
// The Scouts' briefs: instructions owned by the CLI like the judge and design prompts
// (lib/judge-prompt.mjs, lib/design-prompt.mjs), so every skill shares one
// versioned text. Target-project knowledge arrives through runtime inputs.
// See docs/adr/0017-a-scout-is-an-in-session-subagent-not-a-delegate.md.
//
//   UI_ALLOWED      the playwright-cli commands a UI scout may run as it likes; `click` and `press`
//                   are allowed only narrowly (UI_NARROW). `scout ingest` checks a report's steps
//                   against both.
//   UI_SCROLL_KEYS  the keys `press` may send besides Escape
//   UI_ACTION_CAP   how many playwright-cli commands a UI scout may run in all
//   loginSteps(...) the hand steps that save a login state: the one text `scout brief ui` (a login-state
//                   file that is missing), `scout ingest` (one that has expired) and `scout login-steps`
//                   (`/qa-train access`'s gate) give the engineer
//   uiBrief(...)    the UI scout's brief
//   trackerBrief(...)  `/qa-sync`'s tracker scout's brief: the fetch rules and the payload shape

/** @import { ShownAccessNote } from "./access.mjs" */
import { FIELDS } from "./access.mjs";
import { list } from "./markdown.mjs";

/** @type {readonly string[]} */
export const UI_ALLOWED = ["open", "close", "goto", "go-back", "go-forward", "reload", "snapshot", "tab-list", "tab-select", "hover", "mousewheel", "resize", "console", "dialog-dismiss", "state-load"];
/** @type {readonly string[]} */
export const UI_SCROLL_KEYS = ["PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"];
/** @type {{ readonly click: string, readonly press: string }} */
export const UI_NARROW = {
  click: "only on an element the latest snapshot shows as a link, a tab or a combobox; click a combobox only when the latest snapshot shows no `option` under it (a native select's are listed already), to open it and read its options in the snapshot file the click writes: the very next command is `press Escape`, and you choose no option",
  press: "only Escape and the scrolling keys",
};
/** @type {number} */
export const UI_ACTION_CAP = 40;

// The hand steps that save the login state of the app at `url` into `loginState`, its absolute path.
// They run from a temp dir outside the repository, so the snapshots and logs
// `playwright-cli` writes land there, and `state-save` is given the absolute path.
/**
 * @param {{ url: string, loginState: string }} options
 * @returns {string}
 */
export function loginSteps({ url, loginState }) {
  return `log in to the app in a browser yourself, from a temp directory outside the repository, so the snapshots and logs \`playwright-cli\` writes land there: \`cd "$(mktemp -d)"\`, \`playwright-cli open ${new URL(url).origin} --headed\`, log in in that browser, \`playwright-cli state-save ${shellWord(loginState)}\`, then \`playwright-cli close\``;
}

// How the engineer puts a CLI login's password where the note's `via` says: the one text
// `scout password-steps` prints for `/qa-train access` and `scout brief ui` refuses a missing password
// with. `name` is an `env:` variable's name; `file` a password file's absolute path.
/**
 * @param {{ name?: string, file?: string }} options
 * @returns {string}
 */
export function passwordSteps({ name, file }) {
  return name
    ? `in a terminal, run \`read -rs ${name} && export ${name}\` and type the test account's password, then start the agent from that terminal; the password goes there, never in this conversation`
    : `write the test account's password alone into ${shellWord(/** @type {string} */ (file))} with an editor, never in this conversation`;
}

// `s` as one shell word: itself, or in single quotes when it holds anything a shell would split or expand.
/**
 * @param {string} s
 * @returns {string}
 */
function shellWord(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

// What each allowed command is for, as the brief lists it.
/** @type {Record<string, string>} */
const ALLOWED_USE = {
  open: "start the browser",
  close: "close the browser when you are done",
  goto: "go to a URL on the app's host",
  "go-back": "go back a page",
  "go-forward": "go forward a page",
  reload: "reload the page",
  snapshot: "print the page's snapshot, only for a page no snapshot file shows yet: after `tab-select`, `mousewheel`, `press` or `dialog-dismiss`, or once content loads late",
  "tab-list": "list the open tabs",
  "tab-select": "switch to an open tab",
  hover: "hover over an element to reveal a tooltip or a menu",
  mousewheel: "scroll",
  resize: "resize the window",
  console: "read the browser console",
  "dialog-dismiss": "dismiss a dialog the page opened",
  "state-load": "load the saved login state, once, as the second command",
};

/**
 * @param {string} s
 * @returns {string}
 */
const code = (s) => `\`${s}\``;

// The commands after which `playwright-cli` writes the page's snapshot to a file and prints its path;
// `snapshot` itself prints in place, and the rest write none.
const SNAPSHOT_WRITERS = ["open", "goto", "click", "go-back", "go-forward", "reload", "hover"];

/**
 * An Access note as shown to a scout.
 * @typedef {{
 *   key: string,
 *   statement?: string,
 *   quirks?: string,
 *   withheld?: boolean,
 *   [key: string]: unknown,
 * }} PromptAccessNote
 */

// One Access note as `lib/access.mjs` `accessFor` shows it: its heading, its fields in flow YAML,
// and its prose.
/**
 * @param {PromptAccessNote} note
 * @returns {string}
 */
function noteText(note) {
  /**
   * @param {unknown} v
   * @returns {string}
   */
  const flow = (v) =>
    Array.isArray(v) ? `[${v.map(flow).join(", ")}]`
    : v !== null && typeof v === "object" ? `{${Object.entries(v).map(([k, x]) => `${k}: ${flow(x)}`).join(", ")}}`
    : typeof v === "string" && /[,[\]{}:#"]/.test(v) && !/^[a-z]+:[^\s]/.test(v) ? JSON.stringify(v)
    : String(v);
  const fields = FIELDS.filter((f) => note[f] !== undefined).map((f) => `${f}: ${flow(note[f])}`);
  return [`### ${note.key}: ${note.statement}`, "", "```yaml", ...fields, "```", ...(note.quirks ? ["", note.quirks] : [])].join("\n");
}

// `dir`: the run dir, the Scout's working directory. `session`: its playwright-cli session name.
// `url`, `request`: the `observe:` input. `output`: the one file it writes. `loginState`: the
// absolute path of the login-state file. `note`: the matched Access note (`accessFor`'s shape).
// `practices`: deep-dive's Practices' text, or null.
/**
 * @param {{
 *   dir: string,
 *   session: string,
 *   url: string,
 *   request: string,
 *   output: string,
 *   loginState: string,
 *   note: PromptAccessNote,
 *   practices: string | null,
 * }} options
 * @returns {string}
 */
export function uiBrief({ dir, session, url, request, output, loginState, note, practices }) {
  const cli = `playwright-cli -s=${session}`;
  return `You are a UI scout. You observe a live application through \`playwright-cli\`, navigating
and reading only, and write what you saw as one report. The application's data stays exactly as you
found it. Everything you need is in this brief.

=== YOUR TASK ===

Start at: ${url}
Look at: ${request}

Write your report to: ${output}
That report is the one file you write.

Reply with exactly one line: \`DONE\`, or \`FAILED: <reason>\`. Everything you saw stays in the report
file, so your reply carries none of it.

=== HOW TO RUN ===

Run every command from the run dir, so the snapshot files \`playwright-cli\` writes land there and
never in the repository:

\`\`\`
cd ${dir}
\`\`\`

Pass \`-s=${session}\` to every \`playwright-cli\` command: it is this scout's own browser session,
apart from any other scout running beside you. Begin with these three commands:

\`\`\`
${cli} open
${cli} state-load ${loginState}
${cli} goto ${url}
\`\`\`

Then explore toward what the request asks.
${list(SNAPSHOT_WRITERS.map(code))} each write the
page's snapshot to a file in the run dir and print its path: read the page from that file. Finish
with \`${cli} close\`, then write the report.

=== THE COMMANDS YOU MAY RUN ===

These \`playwright-cli\` commands, and no other command, file or program, apart from reading the
snapshot files in the run dir and writing your report:

${UI_ALLOWED.map((c) => `- ${code(c)}: ${ALLOWED_USE[c]}`).join("\n")}
- \`click\`: ${UI_NARROW.click}.
- \`press\`: \`Escape\` and the scrolling keys ${UI_SCROLL_KEYS.map(code).join(", ")}, only while no form control has focus, except that \`Escape\` closes a combobox you opened, which has focus.

=== RULES ===

- **Read only.** Leave every control as you found it. Click links and tabs, and open a combobox only
  as the \`click\` rule says. Never type, fill, check, select or upload.
- **Never log in.** The saved login state is your only way in. A page that asks you to log in means
  that state has expired: stop, and make the whole report \`FAILED: login: <one sentence>\`.
- **The cap.** Run at most ${UI_ACTION_CAP} commands, counting every \`playwright-cli\` command,
  the three you begin with and \`close\` included. If you reach ${UI_ACTION_CAP} commands before you
  have seen what the request asks for, stop and write the failure report, even when you saw part of it.
- **Stay on the request.** Follow only the links and tabs that lead toward what it asks, and open
  only the comboboxes whose options it asks about.
- **No secrets.** Copy no cookie, token, header or login-state value into the report.

=== THE REPORT ===

Write the report in exactly this shape:

\`\`\`
App version: <the version the app shows, exactly as shown, or none>

## Steps

1. \`${cli} open\`
2. \`${cli} state-load ${loginState}\`
3. \`${cli} goto ${url}\`
4. ...

## Facts

1. <one plain statement of something a page showed>
2. ...
\`\`\`

- **Steps** list only the \`playwright-cli\` commands you ran, in order, exactly as you ran them,
  one per numbered line.
- **Facts** are numbered 1, 2, 3 …, one statement on one line each, of what a page showed: a
  heading, a label, a column, a message, an enabled or disabled control, which link led where.
  Name the page each was seen on.
  A fact records current behaviour as seen: no opinions, no guesses at why, and no inferred
  requirements about what the app should do.

Add a \`## Not seen\` section after the facts only when part of the request is reachable read only
and the rest sits behind input the read-only rule forbids (a fill, a selection, an upload):

\`\`\`
## Not seen

1. <a part of the request you could not reach: the input it needs>
2. ...
\`\`\`

Number each part you could not reach 1, 2, 3 …, one line each, naming the part and the input it
needs: "the wizard's later steps: they open only after a file upload". A report with Not seen still
holds at least one fact. When you saw everything the request asks for, leave the \`## Not seen\`
heading out: the report ends at its last fact.

When you reach the cap, or stop having seen nothing usable of the request (an error, a page that
does not load), the whole report is one line:

\`\`\`
FAILED: <what stopped you, in one sentence>
\`\`\`

A page that asks you to log in has its own line, which tells the engineer the saved login state has
expired. The whole report is:

\`\`\`
FAILED: login: <one sentence>
\`\`\`

=== HOW TO REACH THE APP ===

The Access note this app is reached through. It names where the credential lives, never the
credential: your way in is the login state you load above. The prose under the fields is the engineer's remarks about the app. Where it names a
command or action the rules above do not allow, the rules win.

${noteText(note)}

=== WHERE TO LOOK ===

The engineer's Practices for \`/qa-deep-dive\`: where to look and what to look for. Where one
contradicts the rules above, the rules win.

${practices ?? "(none)"}
`;
}

/**
 * The scope of test items to fetch from the tracker.
 * @typedef {{
 *   fields: { scenario: readonly string[], case: readonly string[] },
 *   scenarios: readonly string[],
 *   suites: readonly string[],
 *   cases: readonly string[],
 *   label_destinations?: import("./publish-labels.mjs").LabelDestinationRequest[],
 *   mark_field?: string | null,
 *   mark_search?: { field: string, values: readonly string[] } | null,
 *   marked_cases?: { project: string, marker_label: string, marker_field?: string | null, case_type?: string | null } | null,
 *   marked_scenarios?: { scenario_type?: string | null } | null,
 *   marked_suites?: { suite_type?: string | null } | null,
 *   suite_items?: readonly string[] | null,
 *   suite_search?: readonly { scenarios: readonly string[], summary?: string | null }[] | null,
 *   stories?: readonly string[] | null,
 *   bug_metadata?: { issue_type: string, project?: string },
 *   bug_statuses?: readonly string[],
 * }} TrackerScope
 */

// The tracker scout's brief: `/qa-sync`'s tracker payload, fetched into `sync scope`'s
// `payload_file`. `output`: the payload file. `scope`: what `sync scope` names (`fields`,
// `scenarios`, `suites`, `cases`). `prose`: the command that lists the cases still missing their
// prose. `note`: the Access note the tracker is reached through (`accessFor`'s shape, so possibly
// `{key, withheld}`), or null. `practices`: `/qa-sync`'s Practices' text, or null. This is the one
// statement of the fetch rules and the payload shape: the skill's fallback without subagents
// follows this same brief.
/**
 * @param {{
 *   output: string,
 *   scope: TrackerScope,
 *   prose: string,
 *   note: PromptAccessNote | null,
 *   practices: string | null,
 *   publishing?: boolean,
 * }} options
 * @returns {string}
 */
export function trackerBrief({ output, scope, prose, note, practices, publishing }) {
  /** @param {readonly string[]} list */
  const keys = (list) => (list.length ? list.map(code).join(", ") : "(none)");
  return `You are a tracker scout. You fetch test cases from the issue tracker, read-only, and write them
as one JSON payload. The tracker stays exactly as you found it. Everything you need is in this brief.

=== YOUR TASK ===

Write the payload to: ${output}
That payload is the one file you write.

1. Fetch what WHAT TO FETCH names, the way HOW TO REACH THE TRACKER says, and write the payload.
2. Run \`${prose}\` and read its \`fetch_prose\`. While it lists keys, fetch their prose (THE PROSE),
   rewrite the payload, and run it again. You are done when \`fetch_prose\` is empty.
3. Reply with one line: \`DONE\`, or \`FAILED: <what failed, in one sentence>\`. The payload stays
   in its file, so your reply carries none of it.

=== WHAT TO FETCH ===

${scope.bug_metadata ? `Bug create metadata for project ${code(scope.bug_metadata.project ?? "")} and issue type ${code(scope.bug_metadata.issue_type)}:
- Read paged createmeta, following every page of issue types and every page of the bug type's fields.
  Preserve each field's id, name, required, schema, allowedValues and hasDefaultValue.
- Read attachment/meta (enabled and uploadLimit), and the issueLinkType list (id, name, inward, outward).
- Write these observations as bug_metadata: {issue_types: [{id, name, fields: [...]}],
  attachment: {enabled, uploadLimit}, issue_link_types: [{id, name, inward, outward}]}.
  Use the tracker's values; a failed metadata read is a failed fetch, never an empty screen.
` : ""}${scope.bug_statuses?.length ? `Fetch the status of each Bug already created from a draft: ${keys(scope.bug_statuses)}.
Write each as {key, issue_type, status, status_category, summary} into \`bug_statuses\`, with
\`{"key": "<key>", "not_found": true}\` for one the tracker no longer holds. \`status_category\` is
Jira's \`statusCategory.key\` (\`new\`, \`indeterminate\` or \`done\`).
` : ""}
Fetch only these fields: for a Test Scenario ${scope.fields.scenario.map(code).join(", ")}; for a
Test Case ${scope.fields.case.map(code).join(", ")}.
${scope.fields.case.includes("issuelinks") ? `Every fetched Test Case also carries \`linked_issues\`: \`[]\` when it has none, else one entry per
linked issue, \`{key, issue_type, status, status_category, summary, links: [{link_type, direction}]}\`.
Collect every link to one issue into its entry; \`direction\` is \`outward\` when the linked issue sat
in \`outwardIssue\` on the case's link entry, \`inward\` when it sat in \`inwardIssue\`. Fetch the case's
own issue links; never infer them from another case.
` : ""}
${scope.label_destinations?.length ? `
Also fetch these label destinations on every ordinary, discovered and \`marked_cases\` item:
${scope.label_destinations.map((d) => `- ${code(d.name)}: ${d.cardinality}-value`).join("\n")}
Resolve each named destination into \`label_destinations: [{name, fields: [{id, cardinality}]}]\`
in the payload. Return every matching tracker identity, including zero or multiple matches;
the Publisher never chooses. Literal \`labels\` intrinsically resolves to identity \`labels\`, multiple.
Report successful observations as \`label_values: [{id, kind, destination, value}]\` on each case.
For Tags use id \`label:tags\`, kind \`tags\`; for each Custom field use id \`label:field:<local name>\`,
kind \`custom_field\`. Names and destinations come from project.md's configured definitions.
Read \`project.md\` under the \`--root\` path in step 2's command for local Custom field names,
their tracker destinations, and the active and retired Tag lists.
Multiple values are sorted unique lists (empty \`[]\`); single values are strings or empty \`null\`.
Keep outside-list values on named fields. For literal \`labels\`, report only managed Tags
(active and retired project Tags); keep unrelated issue labels out of the Tag copy. Raw \`labels\`
may also carry all issue labels for marker detection. A failed observation is omitted, never
reported as empty. Keep label observations and their presence consistent across every case list,
including later prose fetches. Label copies never import values into the project's lists.
` : ""}

- Test Scenarios: ${keys(scope.scenarios)}, and every Test Scenario under the suites ${keys(scope.suites)}.
- Test Cases: every Test Case under those scenarios, and ${keys(scope.cases)}, with the scenario
  each fetched case sits under.
${scope.mark_search ? `- Publish recovery: search the mark field ${code(scope.mark_search.field)} for each exact value:
  ${keys(scope.mark_search.values)}. Search read-only before the Card is built. Use only these values;
  never derive a legacy mark from a Key. Search without an issue-type filter; include every hit, even one of the wrong kind.
  Put Suite-key hits in \`marked_suites\` as {key, issue_type, mark}, regardless of their actual issue type.
  Put other case-shaped hits in \`marked_cases\` and scenario-shaped hits in \`marked_scenarios\`, with their
  actual \`issue_type\` and \`mark\`, using the payload shapes below. All three lists must be present, even
  when empty. Keep values consistent with any item also fetched above or fetched for prose later.
  A failed search is a failed fetch, never an empty list.${scope.bug_metadata ? `
  Put a hit whose mark is a \`bg_\` Key in its own \`marked_bugs\` list as {key, issue_type, mark, summary?}.
  That list must be present too, even when empty.` : ""}
` : ""}${scope.marked_cases ? `- Published items: across the whole tracker project ${code(scope.marked_cases.project)},
  fetch every Test Case carrying marker label ${code(scope.marked_cases.marker_label)}${scope.marked_cases.marker_field ? ` or a non-empty ${code(scope.marked_cases.marker_field)} field` : ""}${scope.marked_cases.case_type ? ` (issue type ${code(scope.marked_cases.case_type)})` : ""}
  and every Test Scenario that does${scope.marked_scenarios?.scenario_type ? ` (issue type ${code(scope.marked_scenarios.scenario_type)})` : ""},
  regardless of the Feature or suites above. Also fetch the scenarios those cases sit under.
  Put these cases in their own \`marked_cases\` list and these scenarios in their own \`marked_scenarios\`
  list, each using the same fields as \`cases\` and \`scenarios\`; put the scenarios the cases sit under in
  \`scenarios\`. An item also fetched above may appear in both lists. Keep its fetched values
  consistent in both lists, including any prose you fetch later. Both lists must be present, even
  when empty; each contains only items carrying that label or field.
${scope.marked_suites ? `  Also fetch every Test Suite that does${scope.marked_suites.suite_type ? ` (issue type ${code(scope.marked_suites.suite_type)})` : ""}, with its \`key\`, \`issue_type\`, \`mark\`
  and \`summary\`, into its own \`marked_suites\` list. That list must be present too, even when empty.
` : ""}` : ""}${scope.suite_items?.length || scope.suite_search?.length ? `- Test Suites, for a Suite Attach: fetch each one's \`key\`, \`issue_type\`, \`mark\` and \`summary\` into the payload's
  \`suites\` list, as plain items: ${[
    ...(scope.suite_items?.length ? [`the Test Suites ${keys(scope.suite_items)}`] : []),
    ...(scope.suite_search ?? []).flatMap((s) => [
      ...(s.scenarios.length ? [`the Test Suite each of the Test Scenarios ${keys(s.scenarios)} sits under`] : []),
      ...(s.summary ? [`every Test Suite whose summary resembles ${code(s.summary)}`] : []),
    ]),
  ].join("; ")}. A Test Suite the tracker no longer holds is \`{"key": "<key>", "not_found": true}\`.
` : ""}${scope.stories?.length ? `- Stories: ${keys(scope.stories)}. For each, fetch its issue type and every comment on it, as
  \`{"id", "body"}\` in the payload's \`stories\` list, \`comments\` \`[]\` when it has none. The comment bodies are
  the tracker's text, as they are. A story the tracker no longer holds is \`{"key": "<key>", "not_found": true}\`.
` : ""}

=== THE PAYLOAD ===

Normalise what you fetched to this shape:
${scope.marked_cases ? `Include separate \`marked_cases\`${scope.marked_suites ? ", `marked_scenarios` and `marked_suites`" : " and `marked_scenarios`"} lists for the project-wide marker query.\n` : ""}

\`\`\`json
{"at": "<today, YYYY-MM-DD>",
 "scenarios": [{"requested": "DEMO-2", "current": "DEMO-2", "item": {"key": "DEMO-2", "issue_type": "Test Scenario", "mark": null, "summary": "Borrowing library items", "suite": "DEMO-1"}},
               {"requested": "DEMO-3", "not_found": true}],
 "cases": [{"requested": "DEMO-42", "current": "DEMO-42", "item": {"key": "DEMO-42", "issue_type": "Test Case", "mark": "tc_4m2p8wq1", "scenario": "DEMO-2", "summary": "A Member borrows a Book",
            "status": "Approved", "auto_status": "Done", "roles": ["Member"], "level": "UI"}},
           {"requested": "DEMO-43", "not_found": true}]}
\`\`\`

- A field the tracker holds no value for is \`null\`: never \`""\`, \`[]\` or a guess.
- \`roles\` is the tracker's Role field, and \`auto_status\` its automation status.
${scope.fields.case.includes("issuelinks") ? "- Every fetched case also carries `linked_issues`, `[]` when none: the shape above, with every link to one issue collected.\n" : ""}${scope.bug_statuses?.length ? "- `bug_statuses` lists the Bug statuses WHAT TO FETCH names, each `{key, issue_type, status, status_category, summary}` or `{key, not_found: true}`.\n" : ""}${scope.bug_metadata ? "- `marked_bugs` lists the `bg_` mark hits as `{key, issue_type, mark, summary?}`, and is present even when empty.\n" : ""}
- \`issue_type\` is the item's actual tracker issue type, as the tracker names it, and \`mark\` is the value of ${scope.mark_field ? code(scope.mark_field) : "the project's mark field (none is configured, so always `null`)"}: the Key the framework wrote when it published the item, or \`null\` when the field is empty. Every fetched Test Scenario and Test Case carries both, even when \`null\`: a missing one reads as no mark.
${scope.stories?.length ? "- `stories` lists each story with `issue_type` (`null` when the tracker holds none) and `comments`, and every story key WHAT TO FETCH lists has an entry there, as the fetched story or `not_found`. Every comment on a story is listed, the ones qa-skills did not write too.\n" : ""}
${scope.fields.case.includes("labels") ? "- `labels` is the case's list of tracker labels, `[]` when none; include it on every fetched case.\n" : ""}
- Every Test Scenario key and Test Case key WHAT TO FETCH lists has an entry in the payload's
  \`scenarios\` or \`cases\`: \`{"requested": "<key>", "current": "<returned key>", "item": {...}}\`,
  or \`{"requested": "<key>", "not_found": true}\`. Keep the requested key when the tracker redirects.
  Set \`current\` and \`item.key\` to the returned key. A missing requested key reads as a fetch
  that stopped short, and the whole payload is refused. A \`not_found\` is never a move.
- Items discovered under suites or scenarios, and items in the marked lists, use the plain
  fetched shape inside \`item\` above. Several requests may return one current key. Their fetched
  values must agree.

=== THE PROSE ===

For each key \`fetch_prose\` lists, fetch its preconditions, steps and expected result, rendered to
plain markdown text, and add them to that case's fetched item as \`preconditions\`, \`steps\` and
\`expected\`, each \`null\` when the tracker's field is empty. Fetch prose for those keys only.

=== WHEN THE FETCH FAILS ===

On any failure (auth, network, rate limit), stop: retry nothing and ask no one. Reply \`FAILED: …\`
as step 3 says; the session that reads your reply writes the failure payload.

=== HOW TO REACH THE TRACKER ===

${trackerAccessText(note)}

=== PRACTICES ===

The engineer's Practices for \`${publishing ? "/qa-publish" : "/qa-sync"}\`. Where one contradicts the rules above, the rules win.

${practices ?? "(none)"}
`;
}

// The tracker brief's Access-note section: how each of the note's fields steers the fetch, then
// the note itself.
/**
 * @param {PromptAccessNote | null} [note]
 * @param {string} [action]
 * @returns {string}
 */
export function trackerAccessText(note, action = "fetch") {
  if (!note) return `No Access note covers the tracker: ${action} with your own tracker tools.`;
  if (note.withheld) {
    return `The Access note \`${note.key}\` covers the tracker, but it holds what looks like a credential,
so nothing else of it is shown. ${action === "fetch" ? "Fetch" : "Write"} with your own tracker tools, as if there were no note.`;
  }
  return `${action === "fetch" ? "Fetch" : "Write"} the way this note says. It names where the credential lives, never the credential.

- \`via\` is where the credential lives. \`mcp:<name>\`: ${action} with that connector's tools.
  \`cli:<name>\`: ${action} with that CLI. \`env:<NAME>\`: write \`$NAME\` in the ${action} command, so the
  value itself never enters your output.
- \`host\` and \`identifiers\` (a user, tenant or org) are what to ${action === "fetch" ? "fetch from" : "write to"} and as.
- The prose under the fields is the engineer's remarks about the tracker. Follow them.

${noteText(note)}`;
}
