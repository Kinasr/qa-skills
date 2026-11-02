// @ts-check
// A source scan of one Kotlin file (ADR-0005): annotations, function names, class declarations and
// brace depth. No compiler, no build, no IDE index; every fact the code index needs is a literal
// in an annotation. Comments, strings and string templates are tokenised away first, so a brace or
// an annotation inside one never counts. It never throws: unbalanced input just ends the walk.

/**
 * An annotation parsed from Kotlin source.
 * @typedef {{
 *   name: string,
 *   line: number,
 *   strings: string[],
 * }} KotlinAnnotation
 */

/**
 * A class declaration parsed from Kotlin source.
 * @typedef {{
 *   name: string,
 *   line: number,
 *   path: string,
 *   annotations: KotlinAnnotation[],
 * }} KotlinClass
 */

/**
 * A function declaration parsed from Kotlin source.
 * @typedef {{
 *   name: string,
 *   line: number,
 *   classPath: string,
 *   annotations: KotlinAnnotation[],
 * }} KotlinFunction
 */

/**
 * Declarations parsed from a Kotlin file.
 * @typedef {{
 *   package: string | null,
 *   classes: KotlinClass[],
 *   functions: KotlinFunction[],
 * }} KotlinFileDeclarations
 */

// `{package, classes, functions}` of one file.
//   package    the file's `package` declaration, or null when it has none
//   classes    [{name, line, path, annotations}]           `path` is the dotted enclosing chain
//   functions  [{name, line, classPath, annotations}]      members of a class, or top-level
// An annotation is `{name, line, strings}`: its written name (`Test.User`, `org.junit.Test`) and
// the value of every string literal among its arguments. Declarations inside a function body
// (local classes, lambdas) are not listed.
/**
 * @param {string} text
 * @returns {KotlinFileDeclarations}
 */
export function parseKotlin(text) {
  return { package: /^[ \t]*package[ \t]+([\w.]+)/m.exec(text)?.[1] ?? null, ...declarations(tokenize(text)) };
}

const VISIBILITY = new Set(["public", "private", "protected", "internal"]);

const MODIFIERS = new Set([
  "public", "private", "protected", "internal", "open", "final", "abstract", "override", "inner",
  "data", "enum", "sealed", "annotation", "companion", "inline", "suspend", "lateinit", "const",
  "external", "tailrec", "operator", "infix", "value", "expect", "actual", "vararg", "noinline",
  "crossinline", "reified", "fun", "class", "interface", "object", "val", "var", "typealias",
  "init", "constructor", "import", "package",
]);

/**
 * @typedef {{
 *   t: "id" | "str" | "p" | "num",
 *   v: string,
 *   line: number,
 *   adj: boolean,
 * }} KotlinToken
 */

// Tokens: `{t: "id" | "str" | "p", v, line, adj}`. `adj` is true when nothing separates the token
// from the one before it (so `this@Outer`'s `@` is a label, not an annotation).
/**
 * @param {string} src
 * @returns {KotlinToken[]}
 */
function tokenize(src) {
  /** @type {KotlinToken[]} */
  const out = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let gap = true;
  /**
   * @param {"id" | "str" | "p" | "num"} t
   * @param {string} v
   * @param {number} at
   */
  const push = (t, v, at) => {
    out.push({ t, v, line: at, adj: !gap });
    gap = false;
  };
  /**
   * @param {number} from
   * @param {number} to
   */
  const newlines = (from, to) => {
    for (let k = from; k < to; k++) if (src[k] === "\n") line++;
  };

  // A `"…"` string from `i` (at the opening quote): its decoded value and the index after it.
  /** @param {number} start */
  const string = (start) => {
    let v = "";
    let k = start + 1;
    while (k < n && src[k] !== '"') {
      if (src[k] === "\\" && k + 1 < n) {
        const e = src[k + 1];
        v += { n: "\n", t: "\t", r: "\r", b: "\b" }[e] ?? e;
        k += 2;
      } else if (src[k] === "$" && src[k + 1] === "{") {
        const end = template(k + 2);
        v += src.slice(k, end);
        k = end;
      } else {
        v += src[k++];
      }
    }
    return { v, end: Math.min(k + 1, n) };
  };
  // A `"""…"""` raw string: no escapes; it closes on the last quote of the first run of three.
  /** @param {number} start */
  const raw = (start) => {
    let k = start + 3;
    while (k < n) {
      if (src[k] === "$" && src[k + 1] === "{") {
        k = template(k + 2);
        continue;
      }
      if (src.startsWith('"""', k)) {
        let e = k + 3;
        while (src[e] === '"') e++;
        return { v: src.slice(start + 3, e - 3), end: e };
      }
      k++;
    }
    return { v: src.slice(start + 3), end: n };
  };
  // The index just after the `}` closing a `${` template whose body starts at `k`.
  /** @param {number} k */
  const template = (k) => {
    let depth = 1;
    while (k < n && depth > 0) {
      const c = src[k];
      if (src.startsWith('"""', k)) k = raw(k).end;
      else if (c === '"') k = string(k).end;
      else if (c === "'") k = char(k);
      else if (src.startsWith("//", k)) k = lineEnd(k);
      else if (src.startsWith("/*", k)) k = blockEnd(k);
      else {
        if (c === "{") depth++;
        if (c === "}") depth--;
        k++;
      }
    }
    return k;
  };
  /** @param {number} k */
  const char = (k) => {
    k++;
    while (k < n && src[k] !== "'" && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
    return Math.min(k + 1, n);
  };
  /** @param {number} k */
  const lineEnd = (k) => {
    const e = src.indexOf("\n", k);
    return e === -1 ? n : e;
  };
  // Kotlin block comments nest.
  /** @param {number} k */
  const blockEnd = (k) => {
    let depth = 0;
    while (k < n) {
      if (src.startsWith("/*", k)) {
        depth++;
        k += 2;
      } else if (src.startsWith("*/", k)) {
        depth--;
        k += 2;
        if (depth === 0) return k;
      } else k++;
    }
    return n;
  };

  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      gap = true;
    } else if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\uFEFF") {
      i++;
      gap = true;
    } else if (src.startsWith("//", i)) {
      i = lineEnd(i);
      gap = true;
    } else if (src.startsWith("/*", i)) {
      const e = blockEnd(i);
      newlines(i, e);
      i = e;
      gap = true;
    } else if (src.startsWith('"""', i)) {
      const at = line;
      const { v, end } = raw(i);
      newlines(i, end);
      i = end;
      push("str", v, at);
    } else if (c === '"') {
      const at = line;
      const { v, end } = string(i);
      newlines(i, end);
      i = end;
      push("str", v, at);
    } else if (c === "'") {
      i = char(i);
      push("p", "'", line);
    } else if (c === "`") {
      const e = src.indexOf("`", i + 1);
      const end = e === -1 ? n : e;
      push("id", src.slice(i + 1, end), line);
      newlines(i, end);
      i = end + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let e = i + 1;
      while (e < n && /[A-Za-z0-9_]/.test(src[e])) e++;
      push("id", src.slice(i, e), line);
      i = e;
    } else if (/[0-9]/.test(c)) {
      let e = i + 1;
      while (e < n && /[0-9A-Za-z_.]/.test(src[e]) && !(src[e] === "." && src[e + 1] === ".")) e++;
      push("num", src.slice(i, e), line);
      i = e;
    } else {
      push("p", c, line);
      i++;
    }
  }
  return out;
}

/**
 * Open scopes in declaration parser.
 * @typedef {{ kind: "class", cls: KotlinClass } | { kind: "code" } | { kind: "block" }} ScopeEntry
 */

/**
 * @param {KotlinToken[]} toks
 */
function declarations(toks) {
  /** @type {KotlinClass[]} */
  const classes = [];
  /** @type {KotlinFunction[]} */
  const functions = [];
  // Open scopes: `{kind: "class", cls}` for a class body, "code" for a function body or any other
  // block of statements (skipped whole), "block" for any other brace pair among declarations.
  /** @type {ScopeEntry[]} */
  const stack = [];
  /** @type {KotlinAnnotation[]} */
  let pending = [];
  // What the next `{` opens: a class body, code, or (null) a plain block.
  /** @type {ScopeEntry | null} */
  let awaiting = null;
  /**
   * @param {number} k
   * @param {string} t
   * @param {string} [v]
   * @returns {boolean}
   */
  const is = (k, t, v) => /** @type {boolean} */ (toks[k] && toks[k].t === t && (v === undefined || toks[k].v === v));
  const inCode = () => stack.some((s) => s.kind === "code");
  const classPath = () => stack.filter(/** @type {(s: ScopeEntry) => s is { kind: "class", cls: KotlinClass }} */ ((s) => s.kind === "class")).map((s) => s.cls.name);

  // The index after the bracket pair opening at `k`.
  /**
   * @param {number} k
   * @param {string} open
   * @param {string} close
   * @returns {number}
   */
  const skipPair = (k, open, close) => {
    let depth = 0;
    for (; k < toks.length; k++) {
      // The `>` of a function type's `->` closes nothing (`<T : (A) -> B>`).
      const arrow = close === ">" && toks[k].adj && is(k - 1, "p", "-");
      if (is(k, "p", open)) depth++;
      else if (is(k, "p", close) && !arrow && --depth === 0) return k + 1;
    }
    return k;
  };

  // `@Name.Sub(args)` at `k`, or null when the `@` is a label (`this@Outer`, `return@forEach`).
  /**
   * @param {number} k
   * @returns {{ ann: KotlinAnnotation, next: number } | null}
   */
  const annotation = (k) => {
    if (toks[k].adj && toks[k - 1]?.t === "id") return null;
    let j = k + 1;
    if (!is(j, "id")) return null;
    let name = toks[j].v;
    j++;
    // A use-site target (`@field:ID`, `@file:JvmName`) names where it applies, not the annotation.
    if (is(j, "p", ":") && is(j + 1, "id")) {
      name = toks[j + 1].v;
      j += 2;
    }
    while (is(j, "p", ".") && is(j + 1, "id")) {
      name += `.${toks[j + 1].v}`;
      j += 2;
    }
    /** @type {string[]} */
    const strings = [];
    if (is(j, "p", "(") && toks[j].line === toks[j - 1].line) {
      const end = skipPair(j, "(", ")");
      for (let a = j; a < end; a++) if (toks[a].t === "str") strings.push(toks[a].v);
      j = end;
    }
    return { ann: { name, line: toks[k].line, strings }, next: j };
  };

  // Skips a declaration header (from `k`, after its name) up to its body or its end. Returns the
  // index to resume at; a `{` there opens the body. `bodyKind` is what that `{` opens.
  /**
   * @param {number} k
   * @param {ScopeEntry | null} bodyKind
   * @returns {number}
   */
  const header = (k, bodyKind) => {
    while (k < toks.length) {
      const tk = toks[k];
      // A primary constructor (`class A private constructor(…)`, `class A @Inject constructor(…)`)
      // belongs to the header; any other modifier or annotation starts the next declaration.
      /** @param {number} j */
      const ctor = (j) => (is(j, "id", "constructor") ? j + 1 : null);
      const vis = tk.t === "id" && VISIBILITY.has(tk.v) ? ctor(k + 1) : null;
      const ann = tk.t === "p" && tk.v === "@" ? annotation(k) : null;
      const annotated = ann ? ctor(ann.next) : null;
      if (is(k, "id", "constructor")) k++;
      else if (vis !== null) k = vis;
      else if (annotated !== null) k = annotated;
      else if (tk.t === "p" && tk.v === "(") k = skipPair(k, "(", ")");
      else if (tk.t === "p" && tk.v === "{") {
        awaiting = bodyKind;
        return k;
      } else if (tk.t === "p" && tk.v === "=") {
        // An expression body: anything braced before the next declaration is code.
        awaiting = { kind: "code" };
        return k + 1;
      } else if ((tk.t === "p" && (tk.v === "}" || tk.v === "@")) || (tk.t === "id" && MODIFIERS.has(tk.v))) {
        awaiting = null;
        return k;
      } else k++;
    }
    return k;
  };

  let k = 0;
  while (k < toks.length) {
    const tk = toks[k];
    if (tk.t === "p" && tk.v === "{") {
      stack.push(awaiting ?? { kind: inCode() ? "code" : "block" });
      awaiting = null;
      pending = [];
      k++;
      continue;
    }
    if (tk.t === "p" && tk.v === "}") {
      stack.pop();
      awaiting = null;
      pending = [];
      k++;
      continue;
    }
    if (inCode()) {
      k++;
      continue;
    }
    if (tk.t === "p" && tk.v === "@") {
      const a = annotation(k);
      if (a) {
        pending.push(a.ann);
        k = a.next;
      } else k++;
      continue;
    }
    if (tk.t !== "id") {
      k++;
      continue;
    }
    // `Foo::class` is a class literal, not a declaration.
    const literal = is(k - 1, "p", ":") && is(k - 2, "p", ":");
    if ((tk.v === "class" || tk.v === "interface" || tk.v === "object") && !literal) {
      const named = is(k + 1, "id") && !MODIFIERS.has(toks[k + 1].v);
      if (!named) {
        // An unnamed companion `object` holds declarations of no class; an object expression
        // (`val x = object : Foo {…}`) is code, whatever it declares.
        pending = [];
        k = header(k + 1, awaiting?.kind === "code" ? awaiting : null);
        continue;
      }
      const cls = { name: toks[k + 1].v, line: toks[k + 1].line, path: [...classPath(), toks[k + 1].v].join("."), annotations: pending };
      classes.push(cls);
      pending = [];
      k = header(k + 2, { kind: "class", cls });
      continue;
    }
    if (tk.v === "fun" && is(k + 1, "id", "interface")) {
      // `fun interface Foo`: a class declaration, read as one from `interface`.
      k++;
      continue;
    }
    if (tk.v === "fun") {
      let j = k + 1;
      if (is(j, "p", "<")) j = skipPair(j, "<", ">");
      let name = null;
      let line = tk.line;
      // The name is the last identifier before the parameter list (`fun Receiver.name(`).
      while (j < toks.length && !is(j, "p", "(") && !is(j, "p", "{") && !is(j, "p", "}")) {
        if (is(j, "p", "<")) {
          j = skipPair(j, "<", ">");
          continue;
        }
        if (toks[j].t === "id") {
          name = toks[j].v;
          line = toks[j].line;
        }
        j++;
      }
      if (name !== null) functions.push({ name, line, classPath: classPath().join("."), annotations: pending });
      pending = [];
      k = header(j, { kind: "code" });
      continue;
    }
    if (tk.v === "val" || tk.v === "var" || tk.v === "init" || tk.v === "constructor" || tk.v === "get" || tk.v === "set") {
      // A property or initialiser: whatever it braces is code.
      pending = [];
      awaiting = { kind: "code" };
      k++;
      continue;
    }
    if (tk.v === "import" || tk.v === "package" || tk.v === "typealias") {
      pending = [];
      awaiting = null;
    }
    k++;
  }
  return { classes, functions };
}

// Assertion contracts reuse the lexer, so comments, strings, nested calls and multiline checks
// keep the same interpretation as the code index. Interpolated strings remain dynamic expressions.
/** @param {string} text @returns {import("../fix-assertions.mjs").AssertionContract[]} */
export function kotlinAssertionContracts(text) {
  const tokens = tokenize(text);
  /** @type {import("../fix-assertions.mjs").AssertionContract[]} */
  const checks = [];
  /** @param {number} start @returns {{ args: KotlinToken[][], next: number }} */
  function call(start) {
    let depth = 1;
    let next = start + 1;
    const args = /** @type {KotlinToken[][]} */ ([[]]);
    while (next < tokens.length && depth) {
      const token = tokens[next++];
      if (token.t === 'p' && ['(', '[', '{'].includes(token.v)) depth++;
      if (token.t === 'p' && [')', ']', '}'].includes(token.v)) depth--;
      if (depth === 1 && token.v === ',' && token.t === 'p') args.push([]);
      else if (depth) args.at(-1)?.push(token);
    }
    return { args, next };
  }
  /** @param {KotlinToken[]} actual @returns {boolean} */
  const constant = actual => actual.length === 1 && (['str', 'num'].includes(actual[0].t) || /^(?:true|false|null)$/.test(actual[0].v));
  // The actual operand is the expected one, token for token: the check compares a value with itself.
  /** @param {KotlinToken[]} actual @param {KotlinToken[]} expected @returns {boolean} */
  const same = (actual, expected) => actual.length > 0 && actual.map(t => `${t.t}:${t.v}`).join(' ') === expected.map(t => `${t.t}:${t.v}`).join(' ');
  for (let i = 0; i < tokens.length; i++) {
    const name = tokens[i];
    if (name.t === 'id' && /^should(?:Be|Equal|Contain|Not|Throw|Match)\w*$/.test(name.v)) {
      const rhs = tokens.slice(i + 1).filter(token => token.line === name.line);
      const literals = rhs.filter(token => token.t === 'str' || token.t === 'num').map(token => token.v);
      /** @type {KotlinToken[]} */
      const lhs = [];
      // The operands end at the statement or lambda edge: `{ it -> a shouldBe a }`.
      const arrow = (/** @type {number} */ k) => tokens[k].v === '>' && tokens[k].adj && tokens[k - 1]?.v === '-';
      for (let k = i - 1; k >= 0 && tokens[k].line === name.line && !(tokens[k].t === 'p' && ['{', ';', '='].includes(tokens[k].v)) && !arrow(k); k--) lhs.unshift(tokens[k]);
      /** @type {KotlinToken[]} */
      const operand = [];
      for (let depth = 0, k = 0; k < rhs.length; k++) {
        const token = rhs[k];
        if (token.t === 'p' && ['(', '[', '{'].includes(token.v)) depth++;
        if (token.t === 'p' && ([')', ']', '}'].includes(token.v) ? depth-- === 0 : token.v === ';' && depth === 0)) break;
        operand.push(token);
      }
      checks.push({ matcher: name.v, expected: rhs.map(token => token.t === 'str' || token.t === 'num' ? '$literal' : token.v).join(''), literals, constant: /^(?:true|false)$/.test(tokens[i - 1]?.v ?? ''), same: same(lhs, operand) });
    }
    if (name.t !== 'id' || !/^(?:assert\w*|verify|fail)$/.test(name.v) || tokens[i + 1]?.v !== '(') continue;
    const root = call(i + 1);
    let next = root.next;
    let matcher = name.v;
    let expectedArgs = root.args.flat();
    let actual = /** @type {KotlinToken[]} */ ([]);
    // Each chained call's arguments on their own, so a description such as `.as("total")` is not
    // read as part of the value an `.isEqualTo(expected)` compares with.
    const operands = /** @type {KotlinToken[][]} */ ([]);
    if (/^assert(?:Equals|NotEquals|Same|NotSame|ArrayEquals)$/.test(name.v)) { expectedArgs = root.args[0]; actual = root.args[1] ?? []; operands.push(expectedArgs); }
    while (tokens[next]?.v === '.' && tokens[next + 1]?.t === 'id' && tokens[next + 2]?.v === '(') {
      if (next === root.next) { actual = root.args.flat(); expectedArgs = []; operands.length = 0; }
      matcher += '.' + tokens[next + 1].v;
      const chained = call(next + 2);
      expectedArgs.push(...chained.args.flat());
      operands.push(...chained.args);
      next = chained.next;
    }
    const literals = /** @type {string[]} */ ([]);
    const expected = expectedArgs.map(token => {
      if ((token.t === 'str' && !token.v.includes('$')) || token.t === 'num') { literals.push(token.v); return '$literal'; }
      return token.v;
    }).join('');
    checks.push({ matcher, expected, literals, constant: actual.length ? constant(actual) : root.args.length === 1 && constant(root.args[0]), same: operands.some(operand => same(actual, operand)) });
  }
  return checks;
}
