// @ts-check
// What looks like a credential in training (ADR-0015), by structure rather than by
// guess: the test `check-file` refuses on and `scan` warns on for every file in `train/`, and how
// every reader shows a key or problem that would otherwise repeat one. No entropy heuristic: a
// tenant UUID, an email or a host is never a secret.
import { isMap } from "./dialect.mjs";

// Credential names match whole words split on casing and non-alphanumeric separators, or adjacent
// `api key(s)` / `private key(s)` words (including their unseparated spellings). Compound
// session-cookie identifiers the tokenizer cannot split also match: a word whose lower-case form
// ends in `sessionid` (`jsessionid`, `sessionid`, `asp.net_sessionid`) or is `phpsessid`.
// Substrings such as `tokenizer`, `cookiejar` and `privateKeyframe` survive. This deliberately
// over-redacts: a whole `session` object and even `sessionCount` lose their values, since `session`
// is a credential word. Training uses the same predicate: an Access note names where a credential
// lives, never its value.
const CREDENTIAL_WORDS = new Set([
  "token", "tokens", "password", "passwords", "secret", "secrets",
  "cookie", "cookies", "apikey", "apikeys", "authorization", "session", "sessions",
  "bearer", "privatekey", "privatekeys",
]);
/**
 * @param {string} key
 * @returns {string[]}
 */
const credentialWords = (key) => {
  const cased = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  // Also match separator-delimited words before splitting casing, so `cOoKiE` remains a word.
  return [key, cased].flatMap((name) => {
    const words = name.toLowerCase().split(/[^a-z0-9]+/);
    return words.flatMap((word, i) => CREDENTIAL_WORDS.has(word) || word.endsWith("sessionid") || word === "phpsessid" ? [word] :
      ((word === "api" || word === "private") && (words[i + 1] === "key" || words[i + 1] === "keys")) ? [`${word}key`] : []);
  });
};

/** @param {string} key @returns {boolean} */
export const credentialNamed = (key) => credentialWords(key).length > 0;

// The only credential words an engineer may exempt from body and page-text redaction.
const EXEMPTABLE_WORDS = new Set(["session", "sessions", "cookie", "cookies", "token", "tokens"]);

/** @param {string} key @returns {boolean} */
export const redactionExemptName = (key) => {
  const words = credentialWords(key);
  return words.length > 0 && words.every((word) => EXEMPTABLE_WORDS.has(word));
};

/**
 * @param {string} key
 * @param {unknown} value
 * @param {ReadonlySet<string> | undefined} exempt
 * @returns {boolean}
 */
const exemptLeaf = (key, value, exempt) => Boolean(exempt?.has(key.toLowerCase())) && (value === null || typeof value !== "object");

// Page labels prefix a count; anything else may qualify a credential, so fail closed.
const QUANTITY_WORDS = new Set([
  "total", "number", "of", "count", "max", "maximum", "min", "minimum", "average", "avg",
  "daily", "weekly", "monthly",
]);

/**
 * A page label may drop only allowlisted leading count words to match a declared name.
 * @param {string} key
 * @param {ReadonlySet<string> | undefined} exempt
 * @returns {boolean}
 */
function exemptPageKey(key, exempt) {
  if (!exempt?.size) return false;
  let suffix = key;
  for (;;) {
    if (exempt.has(suffix.toLowerCase())) return true;
    const space = suffix.indexOf(" ");
    if (space === -1 || !QUANTITY_WORDS.has(suffix.slice(0, space).toLowerCase())) return false;
    suffix = suffix.slice(space + 1);
  }
}

// A boolean or null carries no secret, so every scrub keeps it under a credential-named key
// (`redactValue` on parsed values; `literalEnd` on text). A quoted `"true"` is a string and goes.
/**
 * @param {unknown} value
 * @returns {boolean}
 */
const carriesNoSecret = (value) => value === null || typeof value === "boolean";

// What may follow a kept literal. In JSON text it must end its member: closers, then the line's or
// text's end, or a comma before the next key (a cut text may end anywhere after the comma). Prose
// after it (`password: true, hunter2`, `token: null} s3cret`) means it is not a JSON value, so the
// whole value goes. A `=` value is a run, so its literal ends at the run's terminator.
const MEMBER_END = /^\s*[}\]\s]*(?:$|,\s*(?:$|"(?:[^"\\\n]|\\.)*"\s*:))/;
const CUT_MEMBER_END = /^\s*[}\]\s]*(?:$|,\s*(?:$|["{[]))/;
const RUN_END = /^(?:[\s&#<>"']|$)/;

// The index just past the unquoted literal `true`, `false` or `null` at `at` in `text` when `ends`
// accepts what follows it, or -1: `nullable` and `TRUE` are not the literal.
/**
 * @param {string} text
 * @param {number} at
 * @param {RegExp} ends
 * @returns {number}
 */
function literalEnd(text, at, ends) {
  const word = /^(?:true|false|null)/.exec(text.slice(at, at + 5))?.[0];
  if (!word) return -1;
  const past = at + word.length;
  return ends.test(text.slice(past)) ? past : -1;
}

// Values in a known token format.
const TOKEN_SIGNATURES = [
  { name: "a PEM private key", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { name: "a GitHub token", pattern: /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "a GitHub fine-grained token", pattern: /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/ },
  { name: "an AWS access key id", pattern: /(?<![A-Z0-9])A(?:KI|SI)A[A-Z0-9]{16}(?![A-Z0-9])/ },
  { name: "a Slack token", pattern: /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/ },
];

// The token format `text` carries, by name, or null.
/**
 * @param {string} text
 * @returns {string | null}
 */
export function tokenIn(text) {
  return TOKEN_SIGNATURES.find((s) => s.pattern.test(text))?.name ?? null;
}

// What a reader shows for a train entry's or file's key: the key, or `WITHHELD` when the key is
// itself in a token format (a Slack token is a valid slug, so `prc_<it>` is a well-formed key).
/** @type {string} */
export const WITHHELD = "(withheld: it looks like a credential)";
/**
 * @param {unknown} key
 * @returns {unknown}
 */
export const shownKey = (key) => (typeof key === "string" && tokenIn(key) ? WITHHELD : key);

// Formats too loose to refuse that still look like a credential, so scan warns on them: by shape
// alone, never by entropy. An Authorization value mixes letters and digits, so prose such as "Basic
// authentication-protected" is not one.
const AUTH_VALUE = "(?=[A-Za-z0-9._~+/=-]*[0-9])(?=[A-Za-z0-9._~+/=-]*[A-Za-z])[A-Za-z0-9._~+/=-]{16,}";
const LOOKS_LIKE = [
  { name: "a JSON Web Token", pattern: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./ },
  { name: "a URL carrying a password", pattern: /:\/\/[^\s/:@]+:[^\s/@]+@/ },
  { name: "an Authorization header value", pattern: new RegExp(`\\b(?:bearer|basic)\\s+${AUTH_VALUE}`, "i") },
];

// What in `text` still looks like a credential, by name, or null: a known token format or a looser
// shape.
/**
 * @param {string} text
 * @returns {string | null}
 */
export function credentialIn(text) {
  return tokenIn(text) ?? LOOKS_LIKE.find((s) => s.pattern.test(text))?.name ?? null;
}

// Redaction consumes whole credentials: the detection patterns for PEM and JWT deliberately
// recognise only their signatures, which must never leave a body or signature behind in history.
// The URL patterns start at `://`, not at the scheme before it: a scheme-first pattern rescans a
// run of letters and digits from each of its characters, which is quadratic on a long body.
/**
 * @param {string} text
 * @returns {string}
 */
export function redactCredentials(text) {
  let out = text
    .replace(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g, "<redacted>")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "<redacted>")
    .replace(/(:\/\/)[^\s/?#]+:[^\s/?#]*@/g, "$1<redacted>@")
    .replace(/((?:"|')?(?:proxy-)?authorization["']?\s*:\s*)(["'])[^\r\n]*?\2/gi, "$1$2<redacted>$2")
    .replace(/(\b(?:proxy-)?authorization\s*:\s*)[^\r\n]+/gi, "$1<redacted>");
  for (const { pattern } of TOKEN_SIGNATURES) out = out.replace(new RegExp(pattern.source, "g"), "<redacted>");
  return out.replace(new RegExp(LOOKS_LIKE[2].pattern.source, "gi"), "<redacted>");
}

// Redact structured values before trimming: credential-named keys lose their whole value, a key
// or value in a token format is replaced whole, and other strings are scrubbed as page text is
// (`redactPageText`), so a `password: x` pair or a credential-named URL parameter inside one goes
// too. A `{name, value}` entry whose `name` is credential-named loses its `value`: the shape of a
// storage state's `localStorage` item and a HAR header (`redactPairs` does the same in JSON text).
// A boolean or null is kept under any key (`carriesNoSecret`).
/**
 * @param {unknown} value
 * @param {ReadonlySet<string>} [exempt] Exact lower-case JSON body keys whose leaf values are kept.
 * @returns {unknown}
 */
export function redactValue(value, exempt) {
  const redacted = "<redacted>";
  if (typeof value === "string") return credentialIn(value) ? redacted : redactPageText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, exempt));
  if (value === null || typeof value !== "object") return value;
  const name = /** @type {Record<string, unknown>} */ (value).name;
  const namesCredential = typeof name === "string" && credentialNamed(name);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    let key = tokenIn(k) || credentialIn(k) ? redacted : k;
    for (let n = 2; Object.hasOwn(out, key); n++) key = `${redacted}-${n}`;
    out[key] = !carriesNoSecret(v) && ((credentialNamed(k) && !exemptLeaf(k, v, exempt)) || (namesCredential && k === "value")) ? redacted : redactValue(v, exempt);
  }
  return out;
}

// `text` with the query string and fragment cut from every http(s) URL in it, since either can carry
// a token (a session id, an access token) and an Observation is committed. Punctuation ending the
// sentence after a URL is kept.
const URL_TAIL = /(https?:\/\/[^\s?#<>`"']+)[?#][^\s<>`"']*?(?=[.,;:!)\]]*(?:[\s<>`"']|$))/g;
/**
 * @param {string} text
 * @returns {string}
 */
export const stripUrls = (text) => text.replace(URL_TAIL, "$1");

// A URL of another scheme (`stripUrls` cuts http and https): committed Evidence refuses any with a
// query or fragment, so it cuts those too.
const OTHER_URL_TAIL = /([a-z][a-z0-9+.-]*:\/\/[^\s<>"'`?#]*)[?#][^\s<>"'`]*/gi;
/**
 * Every URL's query and fragment cut, http(s) and other schemes alike: the shared first step of the
 * committed Evidence scrub and the element-evidence scrub.
 * @param {string} text
 * @returns {string}
 */
export const stripUrlQueries = (text) => stripUrls(text).replace(OTHER_URL_TAIL, "$1");

// In `href`'s query, every parameter whose name is credential-named (the JSON predicate, so casing
// and separators differ freely) loses its value and keeps its name: `?token=abc` stays, its value
// does not. Pair order, the rest of the URL and the fragment keep their bytes; decoding only
// decides, an undecodable, nameless or valueless pair is kept as it is (there is nothing to drop, and
// text already scrubbed to `token=<redacted>` ends its URL at the `<`).
/**
 * @param {string} href
 * @returns {string}
 */
export function redactQueryParams(href) {
  const hash = href.indexOf("#");
  const q = href.indexOf("?");
  if (q === -1 || (hash !== -1 && hash < q)) return href;
  const end = hash === -1 ? href.length : hash;
  const kept = href.slice(q + 1, end).split("&").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1 || eq === pair.length - 1) return pair;
    const name = pair.slice(0, eq);
    let decoded;
    try {
      decoded = decodeURIComponent(name.replaceAll("+", "%20"));
    } catch {
      return pair;
    }
    return credentialNamed(decoded) ? `${name}=<redacted>` : pair;
  });
  return `${href.slice(0, q + 1)}${kept.join("&")}${href.slice(end)}`;
}

// Text the Tester shows from a page: page snapshot text, a console line. Credential-named
// `key: value` and `key=value` pairs lose their value and keep the key (`password: hunter2` ->
// `password: <redacted>`), and credential-named query parameters in http(s) URLs in the text lose
// theirs. The key is the run of key characters and spaces immediately before a separator, so it
// may span a label's wording (`Old Password`, `user session`); a `:`'s value is the rest of its
// line (a hint after the value goes too), a `=`'s value runs to whitespace, `&`, `#`, an HTML
// bracket or a quote. A snapshot renders a form control as its role, its accessible name in quotes,
// zero or more `[...]` attribute groups, then its value (`textbox "Password" [ref=e5]: s3cret`);
// when the accessible name is credential-named the value behind the `:` goes. The control's role,
// quoted name and attributes stay, and a control with nothing behind the `:` (`- button "Reset
// password" [ref=e7]`, `- heading "Password" [level=2]`) is not a value pair and survives, as do
// benign names (`- textbox "Username" [ref=e3]: bob`). Pair-shaped prose follows the same predicate
// as JSON scrubbing, which deliberately over-redacts by default: `sessions=3`, `cookies=2`, `apiKeys=1` and
// `Total session count: 42` go, `tokenizer: on` and `Password reset link sent` (no pair shape)
// survive. Quoted keys and values follow the same rule, with the quotes kept: `password="hunter2"`
// becomes `password="<redacted>"`, and `{"token": "abc"}` loses `abc` too. A JSON `{"name": ...,
// "value": ...}` entry whose name is credential-named (`{"name":"authToken","value":"abc"}`, a
// storage state's `localStorage` item) loses its value the same way.
// Exempt names match a trailing run of space-separated words only after allowlisted count
// words and an unambiguous key boundary. Leaf pair values survive; objects and arrays,
// name/value entries, URL query parameters and token-format values keep their usual scrubs.
const KEY_CHAR = /[A-Za-z0-9_.\/-]/;

// The form-control line of a snapshot: a role in lower case, the accessible name quoted (a `\"`
// escape allowed), zero or more attribute groups, then its value pair. The quoted name is the key.
const CONTROL_LINE = /^([ \t]*- [a-z]+ )("((?:[^"\\\n]|\\.)*)")((?: \[[^\]\n]*\])*)(:)([^\n]*?)(?=\r?$)/gm;

// A JSON `"name": "<name>", "value": "<value>"` run, in either order, the name captured to test and
// the value to drop. `redactValue` applies the same rule to parsed objects.
const STRING = '"((?:[^"\\\\\\n]|\\\\.)*)"';
const NAME_FIRST = new RegExp(`("name"\\s*:\\s*${STRING}\\s*,\\s*"value"\\s*:\\s*")((?:[^"\\\\\\n]|\\\\.)*)(")`, "g");
const VALUE_FIRST = new RegExp(`("value"\\s*:\\s*")((?:[^"\\\\\\n]|\\\\.)*)("\\s*,\\s*"name"\\s*:\\s*${STRING})`, "g");

/**
 * @param {string} text
 * @param {ReadonlySet<string>} [exempt] Lower-case names matched against trailing page-key words.
 * @returns {string}
 */
export function redactPairs(text, exempt) {
  text = text
    .replace(NAME_FIRST, (pair, head, name, value, tail) => (credentialNamed(name) ? `${head}<redacted>${tail}` : pair))
    .replace(VALUE_FIRST, (pair, head, value, tail, name) => (credentialNamed(name) ? `${head}<redacted>${tail}` : pair));
  text = text.replace(CONTROL_LINE, (line, prefix, quoted, name, attrs, colon, value) => {
    if (!credentialNamed(name) || !value.trim() || exemptPageKey(name, exempt)) return line;
    return `${prefix}${quoted}${attrs}${colon} <redacted>`;
  });
  let out = "";
  let at = 0;
  for (;;) {
    const colon = text.indexOf(":", at);
    const equals = text.indexOf("=", at);
    const sep = colon === -1 ? equals : equals === -1 ? colon : Math.min(colon, equals);
    if (sep === -1) return out + text.slice(at);
    let start = sep;
    while (start > at && (text[start - 1] === " " || text[start - 1] === "\t")) start--;
    let key = start;
    let keyAtLineStart = false;
    let exemptBoundary = false;
    for (;;) {
      if (key === at || text[key - 1] === "\n") {
        // Mid-line, the scan resumes after an earlier separator (`Access: token: abc`), which may qualify the key.
        keyAtLineStart = exemptBoundary = key === 0 || text[key - 1] === "\n";
        break;
      }
      const previous = text[key - 1];
      if (KEY_CHAR.test(previous) || previous === " ") {
        key--;
        continue;
      }
      if (/\s/.test(previous) || previous === "|") {
        // Non-plain gaps are allowed only as indentation, never inside a label's word run.
        let indent = key - 1;
        while (indent > at && text[indent - 1] !== "\n" && /\s/.test(text[indent - 1])) indent--;
        keyAtLineStart = exemptBoundary = indent === 0 || text[indent - 1] === "\n";
      } else {
        exemptBoundary = /[([{"']/.test(previous);
      }
      break;
    }
    let named = text.slice(key, start).trim();
    // A quoted key is a key too: JSON's `"token": "abc"`.
    if (!named && start > at && (text[start - 1] === '"' || text[start - 1] === "'")) {
      const quote = text[start - 1];
      let open = start - 2;
      while (open >= at && text[open] !== quote && text[open] !== "\n") open--;
      if (open >= at && text[open] === quote) named = text.slice(open + 1, start - 1);
    }
    if (!named || !credentialNamed(named)) {
      out += text.slice(at, sep + 1);
      at = sep + 1;
      continue;
    }
    let value = sep + 1;
    while (value < text.length && (text[value] === " " || text[value] === "\t")) value++;
    const pageKey = keyAtLineStart && named.startsWith("- ") ? named.slice(2).trimStart() : named;
    const exemptPair = exemptBoundary && exemptPageKey(pageKey, exempt);
    if (exemptPair && text[value] !== "{" && text[value] !== "[") {
      // Keep scanning inside the leaf: a nested password pair or URL still needs its scrub.
      out += text.slice(at, sep + 1);
      at = sep + 1;
      continue;
    }
    const nl = text.indexOf("\n", sep + 1);
    const lineEnd = nl === -1 ? text.length : nl;
    // An unquoted `true`, `false` or `null` is kept: as a `=` value's whole run, or as a `:` value
    // ending its line or its JSON member (`"remember_token": null,`). `password: true story` still goes.
    const past = literalEnd(text.slice(0, lineEnd), value, text[sep] === "=" ? RUN_END : MEMBER_END);
    if (past !== -1) {
      out += text.slice(at, past);
      at = past;
      continue;
    }
    // A quoted value is scrubbed inside its quotes, which stay: `password="hunter2"`.
    if (value < lineEnd && (text[value] === '"' || text[value] === "'")) {
      const quote = text[value];
      let close = value + 1;
      while (close < lineEnd && text[close] !== quote) close += text[close] === "\\" ? 2 : 1;
      if (close < lineEnd) {
        out += `${text.slice(at, value + 1)}<redacted>${quote}`;
        at = close + 1;
        continue;
      }
    }
    let end = lineEnd;
    if (text[sep] === "=") {
      end = value;
      while (end < lineEnd && !/[\s&#<>"']/.test(text[end])) end++;
    }
    if (value < end) {
      out += `${text.slice(at, value)}<redacted>`;
      at = end;
    } else {
      out += text.slice(at, sep + 1);
      at = sep + 1;
    }
  }
}

// The index just past the JSON string that opens at `at`, or the text's end when the cut fell inside it.
/**
 * @param {string} text
 * @param {number} at
 * @returns {number}
 */
function jsonStringEnd(text, at) {
  let j = at + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
  return Math.min(j + 1, text.length);
}

// A cut JSON body closed so it parses: everything up to the last whole member, then the closers its
// open containers need. `undefined` when it does not open as JSON or still does not parse.
/**
 * @param {string} text
 * @returns {unknown}
 */
function closedJson(text) {
  const start = text.search(/\S/);
  if (start === -1 || (text[start] !== "{" && text[start] !== "[")) return undefined;
  const { safe } = scanJson(text, start, text.length);
  const tail = scanJson(text, start, safe).closers.toReversed().join("");
  try {
    return JSON.parse(text.slice(start, safe) + tail);
  } catch {
    return undefined;
  }
}

// From `start` to `end` (or the top container's close): the closers still open at `end`, and the last
// index (`safe`) the text can be cut at to keep only whole members.
/**
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {{ closers: string[], safe: number }}
 */
function scanJson(text, start, end) {
  /** @type {string[]} */
  const closers = [];
  let safe = start;
  for (let i = start; i < end && (i === start || closers.length > 0); ) {
    const c = text[i];
    if (c === '"') {
      i = jsonStringEnd(text, i);
      continue;
    }
    if (c === "{" || c === "[") closers.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") closers.pop();
    if ("{[}],".includes(c)) safe = c === "," ? i : i + 1;
    i++;
  }
  return { closers, safe };
}

// A response body cut at the return limit, redacted as a parsed one is: closed and given to
// `redactValue` when it opens as JSON, so every rule (credential-named subtrees, a credential `name`'s
// `value`) holds at any depth; otherwise the structural text scrub, then the page scrub.
/**
 * @param {string} text
 * @param {ReadonlySet<string>} [exempt] Exact lower-case JSON body keys whose leaf values are kept.
 * @returns {unknown}
 */
export function redactCutBody(text, exempt) {
  const closed = closedJson(text);
  if (closed !== undefined) return redactValue(closed, exempt);
  // Protect only already-scrubbed JSON leaves from the page scrub's credential pair rules.
  let prefix = "__qa_leaf_";
  while (text.includes(prefix)) prefix += "_";
  /** @type {string[]} */
  const leaves = [];
  const masked = cutJson(text, exempt, (leaf) => {
    const marker = `${prefix}${leaves.length}__`;
    leaves.push(leaf);
    return marker;
  });
  let out = redactPageText(masked, exempt);
  for (const [i, leaf] of leaves.entries()) out = out.replaceAll(`${prefix}${i}__`, () => leaf);
  return out;
}

// JSON text that may stop anywhere (a response body cut before it parsed), with the whole value of
// every credential-named key replaced by `"<redacted>"`, at any depth: a nested object or array to its
// matching close, or to the end of the text when the cut fell inside it. `redactValue` does the same
// to a parsed body; the line-based `redactPairs` would keep a nested subtree's children.
/**
 * @param {string} text
 * @param {ReadonlySet<string>} [exempt] Exact lower-case JSON body keys whose leaf values are kept.
 * @returns {string}
 */
export function redactCutJson(text, exempt) {
  return cutJson(text, exempt, (leaf) => leaf);
}

/**
 * @param {string} text
 * @param {ReadonlySet<string> | undefined} exempt
 * @param {(leaf: string) => string} keepLeaf
 * @returns {string}
 */
function cutJson(text, exempt, keepLeaf) {
  const n = text.length;
  const stringEnd = (/** @type {number} */ at) => jsonStringEnd(text, at);
  const skipSpace = (/** @type {number} */ at) => {
    while (at < n && /\s/.test(text[at])) at++;
    return at;
  };
  const valueEnd = (/** @type {number} */ at) => {
    if (text[at] === '"') return stringEnd(at);
    if (text[at] !== "{" && text[at] !== "[") {
      while (at < n && !/[,}\]\s]/.test(text[at])) at++;
      return at;
    }
    let depth = 0;
    for (let j = at; j < n; ) {
      const c = text[j];
      if (c === '"') {
        j = stringEnd(j);
        continue;
      }
      if (c === "{" || c === "[") depth++;
      else if ((c === "}" || c === "]") && --depth === 0) return j + 1;
      j++;
    }
    return n;
  };
  let out = "";
  let at = 0;
  for (;;) {
    const open = text.indexOf('"', at);
    if (open === -1) return out + text.slice(at);
    const keyEnd = stringEnd(open);
    const colon = skipSpace(keyEnd);
    let key = text.slice(open + 1, keyEnd - 1);
    try {
      key = JSON.parse(text.slice(open, keyEnd));
    } catch {
      // A key the cut fell inside, or a bad escape, is judged as its raw text.
    }
    // A string that is not a key (no colon follows) is a value, passed through as it is.
    if (text[colon] !== ":" || !credentialNamed(key)) {
      out += text.slice(at, keyEnd);
      at = keyEnd;
      continue;
    }
    const valueStart = skipSpace(colon + 1);
    const end = valueEnd(valueStart);
    // A cheap name check first, so a redacted subtree is never parsed.
    if (exempt?.has(key.toLowerCase()) && CUT_MEMBER_END.test(text.slice(end))) {
      try {
        const leaf = JSON.parse(text.slice(valueStart, end));
        if (exemptLeaf(key, leaf, exempt)) {
          out += text.slice(at, open) + keepLeaf(`${text.slice(open, valueStart)}${JSON.stringify(redactValue(leaf))}`);
          at = end;
          continue;
        }
      } catch {
        // An incomplete leaf has no value safe to keep.
      }
    }
    // A boolean or null is kept, as `redactValue` keeps it; a literal the cut fell inside goes.
    const past = literalEnd(text, valueStart, CUT_MEMBER_END);
    if (past !== -1) {
      out += text.slice(at, past);
      at = past;
      continue;
    }
    out += `${text.slice(at, valueStart)}"<redacted>"`;
    at = end;
  }
}

// The URL queries of every http(s) URL in `text`, scrubbed like a page URL or a `Location` is: the
// match runs through the query, so a percent-encoded name (`access%5Ftoken`) is decoded and judged.
const URL_QUERY = /https?:\/\/[^\s<>`"']*/g;
/**
 * @param {string} text
 * @returns {string}
 */
export const redactQueryText = (text) => text.replace(URL_QUERY, (url) => redactQueryParams(url));

/**
 * What the Tester shows of a page as text: pairs first, then the URLs in it, then the whole-form
 * redaction a response body gets.
 * @param {string} text
 * @param {ReadonlySet<string>} [exempt] Lower-case names matched against trailing page-key words.
 * @returns {string}
 */
export const redactPageText = (text, exempt) => redactCredentials(redactQueryText(redactPairs(text, exempt)));

// The two scrub strengths an outward text uses. The record strength redacts known credential shapes
// and cuts URL queries, leaving ordinary page pairs alone; the page strength also redacts
// credential-named pairs, for text a page or a session produced. Both replace a whole line that still
// looks credential-shaped, so a match the regexes only partly caught never leaves.
/**
 * The record scrub: what an Execution record, its briefs and a Bug draft use.
 * @param {unknown} text
 * @returns {string}
 */
export function scrubRecordText(text) {
  const stripped = stripUrlQueries(String(text));
  return redactCredentials(stripped).split("\n").map((line) => (credentialIn(line) ? "<redacted>" : line)).join("\n");
}

/**
 * The page scrub: what text leaving the session (a PR body, a fix brief, a diagnostic) uses.
 * @param {unknown} text
 * @returns {string}
 */
export function scrubPageText(text) {
  const stripped = stripUrlQueries(String(text));
  return redactPageText(stripped).split("\n").map((line) => (credentialIn(line) ? "<redacted>" : line)).join("\n");
}

// This scrubbing covers only what the Tester returns (its text, a page URL, a request's `Location`)
// and the surfaces it writes (saved responses, guard logs) — read on before promising more. It does
// not reach the raw artifacts `playwright-cli` writes by itself, which `Read` may admit whole: the
// session's earlier page snapshots (`tester.report.md` and the `.playwright-cli/` directory's `page-*.yml`
// snapshot files, screenshots and trace files), the CLI's own logs, and anything else under the
// Execution dir the Tester never passes through here. Values visible in those files are not
// scrubbed; the support document's data-handling statement must list them as excluded.

/**
 * A credential location found in parsed YAML.
 * @typedef {{
 *   key: string,
 *   path: string,
 *   why: string,
 * }} DiscoveredSecret
 */

// Every place a parsed `yaml` block holds a credential: `{key, path, why}`, where `key` is the
// block's top-level key it sits under (to find its line by), `path` the dotted key path to it (a
// list's items share their list's path; empty for the block itself) and `why` what gave it away.
// Neither `path` nor `why` ever carries a credential: a key in a token format is the credential, so
// the path stops at the map holding it.
/**
 * @param {unknown} data
 * @returns {DiscoveredSecret[]}
 */
export function secretsIn(data) {
  /** @type {DiscoveredSecret[]} */
  const out = [];
  /**
   * @param {unknown} v
   * @param {string | null} top
   * @param {string} at
   */
  const walk = (v, top, at) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, top, at));
    if (isMap(v)) {
      for (const [k, x] of Object.entries(v)) {
        const key = top ?? k;
        const token = tokenIn(k);
        const p = token ? at : at ? `${at}.${k}` : k;
        if (token) out.push({ key, path: p, why: `a key is in the format of ${token}` });
        else if (credentialNamed(k)) out.push({ key, path: p, why: `the key \`${k}\` names a credential` });
        walk(x, key, p);
      }
      return;
    }
    const token = typeof v === "string" && tokenIn(v);
    if (token) out.push({ key: /** @type {string} */ (top), path: at, why: `its value is in the format of ${token}` });
  };
  walk(data, null, "");
  return out;
}

// What a problem on a credential found on `line` of a train file says: where it sits (in `entry`,
// the train entry it falls in as `trainEntry` gives it, under `key`, when the key is shown), what
// was `found` there ("text in the format of a GitHub token"), and what to do. Never the value.
/**
 * @param {number} line
 * @param {string} found
 * @param {{ label?: string, kind?: string } | null | undefined} [entry]
 * @param {string | null} [key]
 * @returns {string}
 */
export function credentialMessage(line, found, entry, key) {
  const where = entry && key ? ` of ${entry.label} \`${key}\`` : "";
  const remedy = entry?.kind === "access_note" ? "an Access note names where the credential lives in `via`, never the credential itself" : "training never holds a credential";
  return `line ${line}${where} holds ${found}: ${remedy}; remove it, and revoke it if it is real`;
}
