// @ts-check
// The HTTP call of `tester request`: the words of the call in,
// the fixed `run-code` that sends it out, and the response trimmed and redacted on its way back. Pure,
// as tester-command.mjs is: the guard (cap, session, origin, `match`, the log) is tester.mjs's.
//
// The Tester's words are only ever data: they are validated here and then JSON-encoded into a fixed
// function, never joined into code, so no word can change what runs. `run-code` echoes its own code and
// a failing `page.request` prints the request's headers, cookies included, so only its `### Result` is
// read and an error is cut to its first line.
import { redactCredentials, redactQueryParams } from "./credentials.mjs";
import { no } from "./tester-command.mjs";

/** @type {readonly string[]} */
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
// The session supplies authentication and the target, so the Tester may not set them.
/** @type {readonly string[]} */
export const REFUSED_HEADERS = ["cookie", "authorization", "proxy-authorization", "host"];

const MAX_PAIRS = 20;
const MAX_JSON = 65536;
// What the browser hands back of a body: `playwright-cli` prints it as JSON on stdout, which `spawnSync` caps at 1 MB.
const MAX_FETCHED = 200000;
const MAX_INLINE = 4096;
const MAX_ERROR = 200;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A successful tester request parse result.
 * @typedef {{
 *   ok: true,
 *   method: string,
 *   href: string,
 *   url: string,
 *   headers: Record<string, string>,
 *   data?: unknown,
 *   code?: never,
 *   error?: never,
 * }} TesterRequestSuccess
 */

/**
 * A refusal of a tester request parse.
 * @typedef {{
 *   ok: false,
 *   code: string,
 *   error: string,
 *   method?: string,
 *   url?: string,
 *   href?: never,
 *   headers?: never,
 *   data?: never,
 * }} TesterRequestRefusal
 */

/**
 * @typedef {TesterRequestSuccess | TesterRequestRefusal} TesterRequestResult
 */

// `words` is `[<METHOD>, <url>, (--query k=v | --header Name:value | --json <body>)…]` and `origin` the
// target's. `{ok: true, method, href, url, headers, data?}` or `{ok: false, code, error, method?, url?}`: `href` is the
// URL with its query merged, for the request; `url` is what the trace and the output keep, its origin
// and path only. `headers` has lower-case names; `data` is the parsed `--json`.
/**
 * @param {readonly string[]} words
 * @param {{ origin: string }} options
 * @returns {TesterRequestResult}
 */
export function parseTesterRequest(words, { origin }) {
  const [verb, target, ...flags] = words;
  if (typeof verb !== "string" || typeof target !== "string") return /** @type {TesterRequestRefusal} */ (no("bad_arguments", "usage: request <METHOD> <url> [--query k=v]… [--header Name:value]… [--json <body>]"));
  const method = verb.toUpperCase();
  if (!METHODS.includes(method)) return /** @type {TesterRequestRefusal} */ (no("bad_method", `\`${verb.slice(0, 20)}\` is not a request method; the methods are ${METHODS.join(", ")}`));
  if (CONTROL.test(target)) return /** @type {TesterRequestRefusal} */ (no("bad_url", "`request` takes a URL of printable characters"));

  let url;
  try {
    url = new URL(target, `${origin}/`);
  } catch {
    return /** @type {TesterRequestRefusal} */ (no("bad_url", "`request` needs an http or https URL"));
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return /** @type {TesterRequestRefusal} */ (no("bad_url", "`request` needs an http or https URL without credentials in it"));
  // What a refusal below may still log of the call: the method, and the URL cut to its path, or to its origin when off the target.
  const seen = { method, url: url.origin === origin ? url.origin + url.pathname : url.origin };
  const fail = (/** @type {string} */ code, /** @type {string} */ error) => (/** @type {TesterRequestRefusal} */ ({ ...no(code, error), ...seen }));
  /** @type {Array<[string, string]>} */
  const queries = [];
  /** @type {Record<string, string>} */
  const headers = {};
  /** @type {unknown} */
  let body;
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i];
    const value = flags[i + 1];
    if (!["--query", "--header", "--json"].includes(flag)) return fail("bad_arguments", "usage: request <METHOD> <url> [--query k=v]… [--header Name:value]… [--json <body>]");
    if (typeof value !== "string") return fail("bad_arguments", `${flag} needs a value`);
    if (flag === "--json") {
      if (body !== undefined) return fail("bad_arguments", "`--json` is given once");
      if (value.length > MAX_JSON) return fail("bad_json", `\`--json\` is at most ${MAX_JSON} characters`);
      try {
        body = JSON.parse(value);
      } catch {
        return fail("bad_json", "`--json` takes one JSON object or array");
      }
      if (body === null || typeof body !== "object") return fail("bad_json", "`--json` takes one JSON object or array");
    } else if (flag === "--query") {
      const at = value.indexOf("=");
      if (at < 1 || value.includes("\0")) return fail("bad_arguments", "`--query` takes k=v");
      queries.push([value.slice(0, at), value.slice(at + 1)]);
    } else {
      const at = value.indexOf(":");
      const name = at < 1 ? "" : value.slice(0, at);
      const text = at < 1 ? "" : value.slice(at + 1).trim();
      if (!TOKEN.test(name) || CONTROL.test(text)) return fail("bad_header", "`--header` takes Name:value");
      const lower = name.toLowerCase();
      if (REFUSED_HEADERS.includes(lower)) return fail("forbidden_header", `the \`${lower}\` header is the session's, never the Tester's`);
      if (Object.hasOwn(headers, lower)) return fail("bad_header", `the \`${lower}\` header is given once`);
      headers[lower] = text;
    }
  }
  if (queries.length > MAX_PAIRS || Object.keys(headers).length > MAX_PAIRS) return fail("bad_arguments", `at most ${MAX_PAIRS} --query and ${MAX_PAIRS} --header`);

  for (const [k, v] of queries) url.searchParams.append(k, v);
  url.hash = "";
  return { ok: true, method, href: url.href, url: url.origin + url.pathname, headers, ...(body !== undefined && { data: body }) };
}

// The function `playwright-cli run-code` runs, the input JSON-encoded on its one line (`const input = …;`).
// Redirects are not followed, a 4xx or 5xx is data, and the session's cookies apply.
/**
 * @param {{ method: string, href: string, headers: Record<string, string>, data?: unknown }} options
 * @returns {string}
 */
export function requestCode({ method, href, headers, data }) {
  const input = JSON.stringify({ method, href, headers, ...(data !== undefined && { data }) });
  return `async (page) => {
const input = ${input};
try {
  const r = await page.request.fetch(input.href, { method: input.method, headers: input.headers, data: input.data, maxRedirects: 0, failOnStatusCode: false, timeout: 30000 });
  const h = r.headers();
  const text = await r.text();
  return { status: r.status(), headers: { "content-type": h["content-type"], location: h.location, "content-length": h["content-length"] }, body: text.slice(0, ${MAX_FETCHED}), cut: text.length > ${MAX_FETCHED} };
} catch (e) {
  return { error: String((e && e.message) || e).split("\\n")[0] };
}
}`;
}

// A transport error as the Tester may see it: its first line, URLs cut to origin and path, redacted.
/**
 * @param {unknown} text
 * @returns {string}
 */
export const errorLine = (text) => redactCredentials(String(text).split("\n")[0].replace(/(https?:\/\/[^\s?#]*)[?#]\S*/gi, "$1")).slice(0, MAX_ERROR);

/**
 * Result of parsing a response.
 * @typedef {{
 *   status: number,
 *   headers: Record<string, string>,
 *   body: unknown,
 *   cut: boolean,
 *   parsed: boolean,
 *   error?: never,
 * } | {
 *   error: string,
 *   status?: never,
 *   headers?: never,
 *   body?: never,
 *   cut?: never,
 *   parsed?: never,
 * }} TesterResponseResult
 */

// What `run-code` printed (`### Result` only) as `{status, headers, body, cut}` or `{error}`; the
// response's `location` is resolved against `href` and cut to its origin when it is off `origin`, and
// the body is parsed when it is JSON. Never throws: a result in no known shape is an `{error}`.
/**
 * @param {string} result
 * @param {{ href: string, origin: string }} options
 * @returns {TesterResponseResult}
 */
export function responseOf(result, { href, origin }) {
  let r;
  try {
    r = JSON.parse(result);
  } catch {
    return { error: "the request returned no result" };
  }
  if (r === null || typeof r !== "object") return { error: "the request returned no result" };
  if (typeof r.error === "string") return { error: errorLine(r.error) };
  if (!Number.isInteger(r.status)) return { error: "the request returned no status" };
  /** @type {Record<string, string>} */
  const headers = {};
  for (const name of ["content-type", "location", "content-length"]) if (typeof r.headers?.[name] === "string") headers[name] = r.headers[name];
  if (headers.location !== undefined) {
    try {
      const to = new URL(headers.location, href);
      headers.location = to.origin === origin ? redactQueryParams(to.href) : to.origin;
    } catch {
      headers.location = "<unparseable>";
    }
  }
  const text = typeof r.body === "string" ? r.body : "";
  let body = text;
  try {
    body = JSON.parse(text);
    return { status: r.status, headers, body, cut: r.cut === true, parsed: true };
  } catch {
    return { status: r.status, headers, body, cut: r.cut === true, parsed: false };
  }
}

const LEVELS = [{ strings: 200, items: 10 }, { strings: 80, items: 5 }, { strings: 40, items: 3 }];

// `value` with strings cut to `strings` characters and arrays to `items` entries, `…+N more` standing for the rest.
/**
 * @param {unknown} value
 * @param {{ strings: number, items: number }} options
 * @returns {unknown}
 */
function trimmed(value, { strings, items }) {
  if (typeof value === "string") return value.length > strings ? `${value.slice(0, strings)}…` : value;
  if (Array.isArray(value)) return [...value.slice(0, items).map((v) => trimmed(v, { strings, items })), ...(value.length > items ? [`…+${value.length - items} more`] : [])];
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimmed(v, { strings, items })]));
  return value;
}

// The body as the Tester sees it inline, `{body, trimmed}`: strings over 200 characters cut, arrays over
// 10 items cut, and the whole at most 4 KB (cut harder, then as text). `trimmed` says it differs from `value`.
/**
 * @param {unknown} value
 * @returns {{ body: unknown, trimmed: boolean }}
 */
export function inlineBody(value) {
  const whole = JSON.stringify(value) ?? "";
  for (const level of LEVELS) {
    const body = trimmed(value, level);
    const text = JSON.stringify(body) ?? "";
    if (text.length <= MAX_INLINE) return { body, trimmed: text !== whole };
  }
  // As text, cut until its own JSON form (quotes escaped) fits.
  let at = MAX_INLINE;
  let body = "";
  do {
    at = Math.floor(at * 0.9);
    body = `${whole.slice(0, at)}…`;
  } while (JSON.stringify(body).length > MAX_INLINE);
  return { body, trimmed: true };
}
