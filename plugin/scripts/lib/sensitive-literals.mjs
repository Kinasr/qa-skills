// @ts-check
// Sensitive string literals in test code and in `train/codegen.md`: a string assigned to, or passed
// to, a name that carries a credential (`password`, `token`, `clientSecret`, …). This is narrower
// than `credentials.mjs`'s known token formats: it catches the shape a test often hard-codes, which
// no token format recognises. The value is never returned, only its name and line; callers either
// redact it (the code sample) or refuse it (the training draft).

// The names a credential is assigned to or passed as. Matching is case-insensitive and permits
// `_`/`-` between the words of `api_key`, `client_secret` and `private_key`.
const NAME = "(?:password|passwd|secret|api[_-]?key|apikey|token|client[_-]?secret|passcode|private[_-]?key)";

// The literal after `name:`, `name =` or `name(`, quoted with `"`, `'` or a backtick. The name may
// be a quoted object key (`{"password": …}`). The opening and closing quote of the value are kept;
// the value between them is what redaction removes.
const LITERAL = new RegExp(
  `((?:^|[^A-Za-z0-9_])["'\`]?(?:${NAME})["'\`]?\\s*(?::|=|\\()\\s*)(["'\`])((?:\\\\.|(?!\\2)[^\\\\])*?)\\2`,
  "gim",
);

// The same shape on one line, without capturing the value: the name a line would lose, or null.
const HIT = new RegExp(`(?:^|[^A-Za-z0-9_])["'\`]?(${NAME})["'\`]?\\s*(?::|=|\\()\\s*["'\`]`, "i");

/**
 * What sensitive name the line assigns a string literal to or passes it as, or null.
 * @param {string} line
 * @returns {string | null}
 */
export function sensitiveLiteralName(line) {
  const m = HIT.exec(line);
  return m ? m[1] : null;
}

/**
 * Every line of `text` that assigns a string literal to, or passes one as, a sensitive name, with
 * the name and 1-based line number. The value is never returned.
 * @param {string} text
 * @returns {{ line: number, name: string }[]}
 */
export function sensitiveLiterals(text) {
  /** @type {{ line: number, name: string }[]} */
  const out = [];
  text.replace(/\r\n/g, "\n").split("\n").forEach((line, i) => {
    const name = sensitiveLiteralName(line);
    if (name) out.push({ line: i + 1, name });
  });
  return out;
}

/**
 * `text` with every sensitive string literal's value replaced by `<redacted>`, keeping the name and
 * the quotes. A value already `<redacted>` is left alone.
 * @param {string} text
 * @returns {string}
 */
export function redactSensitiveLiterals(text) {
  return text.replace(LITERAL, (match, head, quote, value) => (value === "<redacted>" ? match : `${head}${quote}<redacted>${quote}`));
}
