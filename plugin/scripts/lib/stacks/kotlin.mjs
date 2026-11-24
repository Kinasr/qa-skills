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
 *   endLine: number,
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
 *   endLine: number,
 *   classPath: string,
 *   classes?: KotlinClass[],
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

/**
 * Top-level Kotlin file header parsed from tokens (comments and strings stripped).
 * @typedef {{
 *   package: { name: string, line: number } | null,
 *   imports: Array<{ fqn: string, alias: string | null, line: number }>,
 *   fileAnnotationsEndLine: number,
 * }} KotlinHeader
 */

/**
 * Parse file-site annotations (`@file:...`), `package`, and `import` directives from Kotlin tokens.
 * @param {string} text
 * @returns {KotlinHeader}
 */
export function parseKotlinHeader(text) {
  const toks = tokenize(text);
  /** @type {(k: number, t: string, v?: string) => boolean} */
  const is = (k, t, v) => Boolean(toks[k] && toks[k].t === t && (v === undefined || toks[k].v === v));
  /** @type {(start: number) => { name: string, next: number }} */
  const dotted = (start) => {
    let name = toks[start].v;
    let j = start + 1;
    while (is(j, "p", ".") && is(j + 1, "id")) {
      name += `.${toks[j + 1].v}`;
      j += 2;
    }
    return { name, next: j };
  };
  /** @type {{ name: string, line: number } | null} */
  let pkg = null;
  /** @type {Array<{ fqn: string, alias: string | null, line: number }>} */
  const imports = [];
  let fileAnnotationsEndLine = 0;
  let k = 0;
  while (k < toks.length) {
    if (is(k, "p", ";")) {
      k++;
      continue;
    }
    if (is(k, "p", "@") && is(k + 1, "id", "file") && is(k + 2, "p", ":")) {
      let j = k + 3;
      if (is(j, "p", "[")) {
        j = skipPair(toks, j, "[", "]");
      } else if (is(j, "id")) {
        j = dotted(j).next;
        if (is(j, "p", "(")) j = skipPair(toks, j, "(", ")");
      }
      if (j > k + 3) fileAnnotationsEndLine = Math.max(fileAnnotationsEndLine, toks[j - 1].endLine);
      k = j;
      continue;
    }
    if (is(k, "id", "package") && is(k + 1, "id") && !pkg) {
      const { name, next } = dotted(k + 1);
      pkg = { name, line: toks[k].line };
      k = next;
      continue;
    }
    if (is(k, "id", "import") && is(k + 1, "id")) {
      let { name: fqn, next: j } = dotted(k + 1);
      if (is(j, "p", ".") && is(j + 1, "p", "*")) {
        fqn += ".*";
        j += 2;
      }
      /** @type {string | null} */
      let alias = null;
      if (is(j, "id", "as") && is(j + 1, "id")) {
        alias = toks[j + 1].v;
        j += 2;
      }
      imports.push({ fqn, alias, line: toks[k].line });
      k = j;
      continue;
    }
    break;
  }
  return { package: pkg, imports, fileAnnotationsEndLine };
}

/**
 * Whether `text` declares `annotation class <name>` outside comments and string literals.
 * @param {string} text
 * @param {string} name
 * @returns {boolean}
 */
export function hasAnnotationClass(text, name) {
  const toks = tokenize(text);
  for (let i = 0; i + 2 < toks.length; i++) {
    if (toks[i].t === "id" && toks[i].v === "annotation"
      && toks[i + 1].t === "id" && toks[i + 1].v === "class"
      && toks[i + 2].t === "id" && toks[i + 2].v === name) {
      return true;
    }
  }
  return false;
}

// `{package, classes, functions}` of one file.
//   package    the file's `package` declaration, or null when it has none
//   classes    [{name, line, path, annotations}]                 `path` is the dotted enclosing chain
//   functions  [{name, line, endLine, classPath, annotations}]   members of a class, or top-level
// An annotation is `{name, line, endLine, strings}`: its written name (`Test.User`, `org.junit.Test`) and
// the value of every string literal among its arguments. Declarations inside a function body
// (local classes, lambdas) are not listed.
/**
 * @param {string} text
 * @returns {KotlinFileDeclarations}
 */
export function parseKotlin(text) {
  return { package: parseKotlinHeader(text).package?.name ?? null, ...declarations(tokenize(text)) };
}

const VISIBILITY = new Set(["public", "private", "protected", "internal"]);

const HARD_DECL_STARTERS = new Set([
  "fun", "class", "interface", "object", "val", "var", "init", "constructor", "typealias",
  "import", "package",
]);

const MODIFIERS = new Set([
  "public", "private", "protected", "internal", "open", "final", "abstract", "override", "inner",
  "data", "enum", "sealed", "annotation", "companion", "inline", "suspend", "lateinit", "const",
  "external", "tailrec", "operator", "infix", "value", "expect", "actual", "vararg", "noinline",
  "crossinline", "reified", "fun", "class", "interface", "object", "val", "var", "typealias",
  "init", "constructor", "import", "package",
]);

/**
 * The index after the bracket pair opening at `k`, or `toks.length` on unbalanced EOF.
 * @param {readonly KotlinToken[]} toks
 * @param {number} k
 * @param {string} open
 * @param {string} close
 * @returns {number}
 */
function skipPair(toks, k, open, close) {
  let depth = 0;
  for (; k < toks.length; k++) {
    // The `>` of a function type's `->` closes nothing (`<T : (A) -> B>`).
    const arrow = close === ">" && toks[k].adj && toks[k - 1]?.t === "p" && toks[k - 1].v === "-";
    if (toks[k].t === "p" && toks[k].v === open) depth++;
    else if (toks[k].t === "p" && toks[k].v === close && !arrow && --depth === 0) return k + 1;
  }
  return k;
}

/**
 * Whether `toks[k]` follows an expression-starting operator (`=`, `:`, `(`, `,`, `[`, `->`, `return`, `throw`, `by`).
 * @param {readonly KotlinToken[]} toks
 * @param {number} k
 * @returns {boolean}
 */
function isExprPrev(toks, k) {
  const prev = k > 0 ? toks[k - 1] : null;
  if (!prev) return false;
  if (prev.t === "p" && ["=", ":", "(", ",", "["].includes(prev.v)) return true;
  if (prev.t === "id" && ["return", "throw", "by"].includes(prev.v)) return true;
  return prev.t === "p" && prev.v === ">" && prev.adj && toks[k - 2]?.t === "p" && toks[k - 2].v === "-";
}

/**
 * Whether `toks[idx]` matches token kind `t` (and value `v`, when given).
 * @param {readonly KotlinToken[]} toks
 * @param {number} idx
 * @param {string} t
 * @param {string} [v]
 * @returns {boolean}
 */
function isTok(toks, idx, t, v) {
  return Boolean(toks[idx] && toks[idx].t === t && (v === undefined || toks[idx].v === v));
}

/**
 * `@Name.Sub(args)` at `k`, or null when the `@` is a label (`this@Outer`, `return@forEach`).
 * @param {readonly KotlinToken[]} toks
 * @param {number} k
 * @returns {{ ann: KotlinAnnotation, argsStart: number, argsEnd: number, next: number } | null}
 */
function parseAnnotation(toks, k) {
  if (toks[k].adj && toks[k - 1]?.t === "id") return null;
  let j = k + 1;
  if (!isTok(toks, j, "id")) return null;
  let name = toks[j].v;
  j++;
  // A use-site target (`@field:ID`, `@file:JvmName`) names where it applies, not the annotation.
  if (isTok(toks, j, "p", ":") && isTok(toks, j + 1, "id")) {
    name = toks[j + 1].v;
    j += 2;
  }
  while (isTok(toks, j, "p", ".") && isTok(toks, j + 1, "id")) {
    name += `.${toks[j + 1].v}`;
    j += 2;
  }
  /** @type {string[]} */
  const strings = [];
  let argsStart = -1;
  let argsEnd = -1;
  if (isTok(toks, j, "p", "(") && toks[j].line === toks[j - 1].line) {
    argsStart = j;
    argsEnd = skipPair(toks, j, "(", ")");
    for (let a = argsStart; a < argsEnd; a++) if (toks[a].t === "str") strings.push(toks[a].v);
    j = argsEnd;
  }
  return { ann: { name, line: toks[k].line, endLine: toks[j - 1].endLine, strings }, argsStart, argsEnd, next: j };
}

/**
 * Index of a `fun` declaration's name identifier and the token starting its parameter/body header.
 * @param {readonly KotlinToken[]} toks
 * @param {number} funIdx
 * @returns {{ nameIdx: number, headerStart: number }}
 */
function scanFunSignature(toks, funIdx) {
  let j = funIdx + 1;
  if (isTok(toks, j, "p", "<")) j = skipPair(toks, j, "<", ">");
  let nameIdx = -1;
  while (j < toks.length && !isTok(toks, j, "p", "(") && !isTok(toks, j, "p", "{") && !isTok(toks, j, "p", "}")) {
    if (isTok(toks, j, "p", "<")) {
      j = skipPair(toks, j, "<", ">");
      continue;
    }
    if (toks[j].t === "id") nameIdx = j;
    j++;
  }
  return { nameIdx, headerStart: j };
}

/**
 * Collect candidate capitalized supertype names after `:` in a `class` / `interface` / `object` header.
 * @param {readonly KotlinToken[]} toks
 * @param {number} kwIdx
 * @param {Set<string>} refs
 * @returns {void}
 */
function collectSupertypeRefs(toks, kwIdx, refs) {
  let j = kwIdx + 1;
  if (isTok(toks, j, "id") && !MODIFIERS.has(toks[j].v)) j++;
  if (isTok(toks, j, "p", "<")) j = skipPair(toks, j, "<", ">");
  let p = j;
  while (p < toks.length) {
    if (isTok(toks, p, "id") && VISIBILITY.has(toks[p].v)) { p++; continue; }
    if (isTok(toks, p, "p", "@")) {
      const ann = parseAnnotation(toks, p);
      if (ann) { p = ann.next; continue; }
    }
    break;
  }
  if (isTok(toks, p, "id", "constructor")) j = p + 1;
  if (isTok(toks, j, "p", "(")) j = skipPair(toks, j, "(", ")");
  if (!isTok(toks, j, "p", ":") || isTok(toks, j + 1, "p", ":")) return;

  j++;
  let parenDepth = 0;
  while (j < toks.length) {
    const st = toks[j];
    const stLiteral = isTok(toks, j - 1, "p", ":") && isTok(toks, j - 2, "p", ":");
    const stMember = isTok(toks, j - 1, "p", ".");
    if (st.t === "p" && st.v === "(") {
      parenDepth++;
      j++;
      continue;
    }
    if (st.t === "p" && st.v === ")") {
      if (parenDepth > 0) parenDepth--;
      j++;
      continue;
    }
    if (parenDepth === 0 && (
      (st.t === "p" && (st.v === "{" || st.v === "}" || st.v === "="))
      || (!st.adj && st.t === "p" && st.v === "@")
    )) break;
    if (!stLiteral && !stMember && st.t === "id" && HARD_DECL_STARTERS.has(st.v)
      && !(st.v === "object" && isExprPrev(toks, j))) break;
    if (st.t === "id" && /^[A-Z]/.test(st.v)) {
      let name = st.v;
      let m = j + 1;
      while (isTok(toks, m, "p", ".") && isTok(toks, m + 1, "id") && /^[A-Z]/.test(toks[m + 1].v)) {
        name += `.${toks[m + 1].v}`;
        m += 2;
      }
      refs.add(name);
      j = m;
      continue;
    }
    j++;
  }
}

/**
 * Extract deduplicated candidate supertype, `@Ann(...::class)`, and constructor/factory call names
 * from Kotlin source tokens, ignoring comments, string literals, templates, and raw strings.
 * @param {string} text
 * @returns {string[]}
 */
export function kotlinSupportRefs(text) {
  const toks = tokenize(text);
  /** @type {Set<string>} */
  const refs = new Set();
  /** @type {Set<number>} */
  const funNames = new Set();

  for (let i = 0; i < toks.length; i++) {
    const preceded = isTok(toks, i - 1, "p", ".") || (isTok(toks, i - 1, "p", ":") && isTok(toks, i - 2, "p", ":"));
    if (!preceded && isTok(toks, i, "id", "fun") && !isTok(toks, i + 1, "id", "interface")) {
      const { nameIdx, headerStart } = scanFunSignature(toks, i);
      if (nameIdx !== -1 && isTok(toks, headerStart, "p", "(")) funNames.add(nameIdx);
    }
  }

  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    const literal = isTok(toks, i - 1, "p", ":") && isTok(toks, i - 2, "p", ":");
    const member = isTok(toks, i - 1, "p", ".");

    // 1. Supertypes in `class` / `interface` / `object` headers.
    if (tk.t === "id" && (tk.v === "class" || tk.v === "interface" || tk.v === "object") && !literal && !member) {
      collectSupertypeRefs(toks, i, refs);
    }

    // 2. `::class` inside non-label `@Ann(...)` arguments.
    if (tk.t === "p" && tk.v === "@") {
      const ann = parseAnnotation(toks, i);
      if (ann && ann.argsStart !== -1) {
        for (let a = ann.argsStart + 1; a + 3 < ann.argsEnd; a++) {
          if (toks[a].t === "id" && /^[A-Z]/.test(toks[a].v)
            && isTok(toks, a + 1, "p", ":") && isTok(toks, a + 2, "p", ":") && isTok(toks, a + 3, "id", "class")) {
            refs.add(toks[a].v);
          }
        }
      }
    }

    // 3. Constructor / factory calls outside `fun` declaration names.
    if (tk.t === "id" && !funNames.has(i) && /^[A-Z]/.test(tk.v) && isTok(toks, i + 1, "p", "(")) {
      refs.add(tk.v);
    }
  }
  return [...refs];
}

/**
 * @typedef {{
 *   t: "id" | "str" | "p" | "num",
 *   v: string,
 *   line: number,
 *   endLine: number,
 *   adj: boolean,
 * }} KotlinToken
 */

// Tokens: `{t: "id" | "str" | "p", v, line, endLine, adj}`. `adj` is true when nothing separates
// the token from the one before it (so `this@Outer`'s `@` is a label, not an annotation).
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
    out.push({ t, v, line: at, endLine: line, adj: !gap });
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
    while (k < n && src[k] !== "'" && src[k] !== "\n") {
      if (src[k] === "\\" && k + 1 < n && src[k + 1] !== "\n") k += 2;
      else k++;
    }
    return src[k] === "'" ? Math.min(k + 1, n) : k;
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
 * @typedef {{ kind: "class", cls: KotlinClass } | { kind: "code", fn?: KotlinFunction } | { kind: "block" }} ScopeEntry
 */

/**
 * Active single-expression function state tracked alongside `stack`.
 * @typedef {{ fn: KotlinFunction, baseStackDepth: number, parenDepth: number, bracketDepth: number, lastLine: number }} ExprFnState
 */

/**
 * @param {KotlinToken[]} toks
 */
function declarations(toks) {
  /** @type {KotlinClass[]} */
  const classes = [];
  /** @type {KotlinFunction[]} */
  const functions = [];
  // Open scopes: `{kind: "class", cls}` for a class body, `{kind: "code", fn?}` for a function body
  // or any other block of statements (skipped whole), "block" for any other brace pair among declarations.
  /** @type {ScopeEntry[]} */
  const stack = [];
  /** @type {KotlinAnnotation[]} */
  let pending = [];
  // What the next `{` opens: a class body, code, or (null) a plain block.
  /** @type {ScopeEntry | null} */
  let awaiting = null;
  // Active single-expression `fun ... = expr` body state alongside `stack` (boxed so closures don't trigger `never` narrowing).
  /** @type {{ current: ExprFnState | null }} */
  const exprState = { current: null };
  /**
   * @param {number} k
   * @param {string} t
   * @param {string} [v]
   * @returns {boolean}
   */
  const is = (k, t, v) => /** @type {boolean} */ (toks[k] && toks[k].t === t && (v === undefined || toks[k].v === v));
  const inCode = () => stack.some((s) => s.kind === "code");
  const classChain = () => stack.filter(/** @type {(s: ScopeEntry) => s is { kind: "class", cls: KotlinClass }} */ ((s) => s.kind === "class")).map((s) => s.cls);
  const classPath = () => classChain().map((c) => c.name);
  const finishExprFn = () => {
    if (!exprState.current) return;
    exprState.current.fn.endLine = exprState.current.lastLine;
    exprState.current = null;
    awaiting = null;
  };

  // Skips a declaration header (from `k`, after its name) up to its body or its end. Returns the
  // index to resume at; a `{` there opens the body. `bodyKind` is what that `{` opens.
  /**
   * @param {number} k
   * @param {ScopeEntry | null} bodyKind
   * @param {KotlinFunction | null} [fn]
   * @returns {number}
   */
  const header = (k, bodyKind, fn = null) => {
    while (k < toks.length) {
      const tk = toks[k];
      // A primary constructor (`class A private constructor(…)`, `class A @Inject constructor(…)`)
      // belongs to the header; any other modifier or annotation starts the next declaration.
      /** @param {number} j */
      const ctor = (j) => (is(j, "id", "constructor") ? j + 1 : null);
      const vis = tk.t === "id" && VISIBILITY.has(tk.v) ? ctor(k + 1) : null;
      const ann = tk.t === "p" && tk.v === "@" ? parseAnnotation(toks, k) : null;
      const annotated = ann ? ctor(ann.next) : null;
      if (is(k, "id", "constructor")) k++;
      else if (vis !== null) k = vis;
      else if (annotated !== null) k = annotated;
      else if (tk.t === "p" && tk.v === "(") k = skipPair(toks, k, "(", ")");
      else if (tk.t === "p" && tk.v === "{") {
        awaiting = bodyKind;
        return k;
      } else if (tk.t === "p" && tk.v === "=") {
        if (fn) {
          exprState.current = { fn, baseStackDepth: stack.length, parenDepth: 0, bracketDepth: 0, lastLine: tk.endLine };
          awaiting = null;
        } else {
          // An expression body: anything braced before the next declaration is code.
          awaiting = { kind: "code" };
        }
        return k + 1;
      } else if ((tk.t === "p" && (tk.v === "}" || tk.v === "@")) || (tk.t === "id" && MODIFIERS.has(tk.v))) {
        awaiting = null;
        if (fn) fn.endLine = toks[k - 1]?.endLine ?? fn.line;
        return k;
      } else k++;
    }
    if (fn) fn.endLine = toks[k - 1]?.endLine ?? fn.line;
    return k;
  };

  let k = 0;
  while (k < toks.length) {
    const tk = toks[k];
    const exprFn = exprState.current;
    if (exprFn && stack.length === exprFn.baseStackDepth) {
      if (tk.t === "p" && tk.v === "}") {
        finishExprFn();
      } else if (exprFn.parenDepth === 0 && exprFn.bracketDepth === 0) {
        const preceded = is(k - 1, "p", ".") || (is(k - 1, "p", ":") && is(k - 2, "p", ":"));
        const next = toks[k + 1];
        const terminates =
          (!tk.adj && tk.t === "p" && tk.v === "@")
          || (!preceded && tk.t === "id" && HARD_DECL_STARTERS.has(tk.v)
            && !(tk.v === "object" && isExprPrev(toks, k))
            && !(tk.v === "fun" && is(k + 1, "p", "(")))
          || (!preceded && tk.t === "id" && MODIFIERS.has(tk.v)
            && next?.line === tk.line
            && ((next.t === "id" && MODIFIERS.has(next.v))
              || (!next.adj && next.t === "p" && next.v === "@")));
        if (terminates) finishExprFn();
      }
    }
    const activeExpr = exprState.current;
    if (tk.t === "p" && tk.v === "{") {
      stack.push(awaiting ?? (activeExpr ? { kind: "code", fn: activeExpr.fn } : { kind: inCode() ? "code" : "block" }));
      awaiting = null;
      pending = [];
      if (activeExpr) activeExpr.lastLine = tk.endLine;
      k++;
      continue;
    }
    if (tk.t === "p" && tk.v === "}") {
      const popped = stack.pop();
      const next = toks[k + 1];
      const chained = popped?.kind === "code" && next?.t === "id" && ["else", "catch", "finally", "while"].includes(next.v);
      awaiting = chained ? { kind: "code", ...(popped.fn && { fn: popped.fn }) } : null;
      if (activeExpr) activeExpr.lastLine = tk.endLine;
      else if (popped?.kind === "code" && popped.fn) popped.fn.endLine = tk.endLine;
      pending = [];
      k++;
      continue;
    }
    if (activeExpr && stack.length === activeExpr.baseStackDepth) {
      if (tk.t === "p" && tk.v === "(") activeExpr.parenDepth++;
      else if (tk.t === "p" && tk.v === ")" && activeExpr.parenDepth > 0) activeExpr.parenDepth--;
      else if (tk.t === "p" && tk.v === "[") activeExpr.bracketDepth++;
      else if (tk.t === "p" && tk.v === "]" && activeExpr.bracketDepth > 0) activeExpr.bracketDepth--;
    }
    if (activeExpr) activeExpr.lastLine = tk.endLine;
    if (inCode()) {
      k++;
      continue;
    }
    if (tk.t === "p" && tk.v === "@") {
      awaiting = null;
      const a = parseAnnotation(toks, k);
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
      const exprObject = tk.v === "object" && isExprPrev(toks, k);
      if (!named) {
        // An unnamed companion `object` holds declarations of no class; an object expression
        // (`val x = object : Foo {…}`) is code, whatever it declares.
        awaiting = null;
        pending = [];
        k = header(k + 1, exprObject ? { kind: "code" } : null);
        continue;
      }
      awaiting = null;
      const cls = { name: toks[k + 1].v, line: toks[k + 1].line, path: [...classPath(), toks[k + 1].v].join("."), annotations: pending };
      classes.push(cls);
      pending = [];
      k = header(k + 2, exprObject ? { kind: "code" } : { kind: "class", cls });
      continue;
    }
    if (tk.v === "fun" && is(k + 1, "id", "interface")) {
      // `fun interface Foo`: a class declaration, read as one from `interface`.
      awaiting = null;
      k++;
      continue;
    }
    if (tk.v === "fun") {
      awaiting = null;
      const { nameIdx, headerStart: j } = scanFunSignature(toks, k);
      const name = nameIdx !== -1 ? toks[nameIdx].v : null;
      const line = nameIdx !== -1 ? toks[nameIdx].line : tk.line;
      /** @type {KotlinFunction | null} */
      const fn = name !== null ? { name, line, endLine: line, classPath: classPath().join("."), classes: classChain(), annotations: pending } : null;
      if (fn) functions.push(fn);
      pending = [];
      k = header(j, fn ? { kind: "code", fn } : { kind: "code" }, fn);
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
  finishExprFn();
  const eofLine = toks.at(-1)?.endLine;
  for (const entry of stack) {
    if (entry.kind === "code" && entry.fn && eofLine !== undefined) entry.fn.endLine = eofLine;
  }
  return { classes, functions };
}
