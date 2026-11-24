// @ts-check
// The intentionally shallow standalone regress graph: import stems and one fixture extension,
// or references to a Kotlin support file's declared names. It is not a dependency analyser.
import { readFileSync } from 'node:fs';
import { dirname, posix, join } from 'node:path';
import { filesUnder } from '../code-source.mjs';
import { isTsPlaywrightStack, isKotlinJUnit5Stack } from './descriptors.mjs';
/** @import { ProjectConfig } from '../knowledge-file.mjs' */
/**
 * @param {string} repo
 * @param {ProjectConfig} config
 * @param {Record<string, string>} support Touched support, including its pinned declarations.
 * @returns {string[]}
 */
export function regressionDependents(repo, config, support) {
  const ts = config.stack && isTsPlaywrightStack(config.stack);
  const kotlin = config.stack && isKotlinJUnit5Stack(config.stack);
  if (!ts && !kotlin) return [];
  const texts = new Map(filesUnder(repo, config.modulePaths, name => ts ? /\.[cm]?[jt]sx?$/.test(name) : name.endsWith('.kt')).map(path => [path, readFileSync(join(repo, path), 'utf8')]));
  const stem = (/** @type {string} */ path) => path.replace(/\.[cm]?[jt]sx?$/, '').replace(/\/index$/, '');
  if (ts) {
    const parsed = new Map([...texts].map(([file, text]) => [file, scanSource(text, false)]));
    /** @type {(file: string, specs: string[]) => string[]} */
    const imports = (file, specs) => specs.map(spec => spec.startsWith('.') ? stem(posix.normalize(posix.join(dirname(file), spec))) : stem(spec));
    const touched = new Set(Object.keys(support).map(stem));
    const fixture = new Set([...parsed].filter(([file, { code, importSpecs }]) => /\b\w+\.extend\s*(?:<[^;]*?>)?\s*\(/.test(code) && imports(file, importSpecs).some(path => touched.has(path))).map(([file]) => stem(file)));
    return [...parsed].filter(([file, { importSpecs }]) => !Object.hasOwn(support, file) && imports(file, importSpecs).some(path => touched.has(path) || fixture.has(path))).map(([file]) => file);
  }
  const names = new Set(Object.values(support).flatMap(text => [...scanSource(text, true).code.matchAll(/\b(?:class|interface|object|fun|val|var|typealias)\s+(\w+)/g)].map(match => match[1])));
  return [...texts].filter(([file, text]) => !Object.hasOwn(support, file) && [...scanSource(text, true).code.matchAll(/\b\w+\b/g)].some(match => names.has(match[0]))).map(([file]) => file);
}

/**
 * Strip comments and string literals in a single pass so strings containing `//` or `/*` are
 * never treated as comments, while capturing static TS import specifiers outside comments/strings.
 * @param {string} text
 * @param {boolean} kotlin
 * @returns {{ code: string, importSpecs: string[] }}
 */
function scanSource(text, kotlin) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const importSpecs = [];
  const n = text.length;
  const regexKeywords = new Set(['return', 'case', 'throw', 'typeof', 'void', 'delete', 'in', 'instanceof', 'new', 'of', 'await', 'yield']);

  /** @returns {{ char: string | null, word: string }} */
  const prevToken = () => {
    let idx = out.length - 1;
    while (idx >= 0 && /^\s*$/.test(out[idx])) idx--;
    if (idx < 0) return { char: null, word: '' };
    let word = '';
    let w = idx;
    while (w >= 0 && /[A-Za-z0-9_$]/.test(out[w])) {
      word = out[w] + word;
      w--;
    }
    return { char: out[idx], word };
  };

  /** @param {number} start @param {string} ch @returns {number} */
  const skipQuoted = (start, ch) => {
    let k = start;
    while (k < n) {
      if (text[k] === '\\') {
        k += 2;
        continue;
      }
      if (text[k] === ch) return k + 1;
      if (text[k] === '\n') return k;
      k++;
    }
    return k;
  };

  /** @param {number} start @returns {number} */
  const skipRegex = (start) => {
    let k = start + 1;
    let inClass = false;
    while (k < n && text[k] !== '\n') {
      if (text[k] === '\\') {
        k += 2;
        continue;
      }
      if (text[k] === '[') inClass = true;
      else if (text[k] === ']') inClass = false;
      else if (text[k] === '/' && !inClass) return k + 1;
      k++;
    }
    return start + 1;
  };

  /** @param {number} start @returns {number} */
  const scanTemplate = (start) => {
    let k = start + 1;
    while (k < n) {
      if (text[k] === '\\') {
        k += 2;
        continue;
      }
      if (text[k] === '`') return k + 1;
      if (text[k] === '$' && text[k + 1] === '{') {
        out.push(' ');
        k = scanBlock(k + 2, true);
        continue;
      }
      k++;
    }
    return k;
  };

  /** @param {number} start @param {boolean} stopAtBrace @returns {number} */
  const scanBlock = (start, stopAtBrace) => {
    let k = start;
    let braces = stopAtBrace ? 1 : 0;
    while (k < n) {
      const ch = text[k];
      if (stopAtBrace) {
        if (ch === '{') braces++;
        else if (ch === '}' && --braces === 0) return k + 1;
      }
      if (ch === '/' && text[k + 1] === '/') {
        const nl = text.indexOf('\n', k + 2);
        out.push(' ');
        k = nl === -1 ? n : nl;
        continue;
      }
      if (ch === '/' && text[k + 1] === '*') {
        k += 2;
        let depth = 1;
        while (k < n && depth > 0) {
          if (kotlin && text[k] === '/' && text[k + 1] === '*') {
            depth++;
            k += 2;
          } else if (text[k] === '*' && text[k + 1] === '/') {
            depth--;
            k += 2;
          } else k++;
        }
        out.push(' ');
        continue;
      }
      if (kotlin && ch === '"' && text[k + 1] === '"' && text[k + 2] === '"') {
        const end = text.indexOf('"""', k + 3);
        k = end === -1 ? n : end + 3;
        while (k < n && text[k] === '"') k++;
        out.push(' ');
        continue;
      }
      if (ch === '"' || ch === "'") {
        const end = skipQuoted(k + 1, ch);
        if (!kotlin && end > k + 1 && text[end - 1] === ch) {
          const { word } = prevToken();
          if (word === 'from' || word === 'import') importSpecs.push(text.slice(k + 1, end - 1));
        }
        out.push(' ');
        k = end;
        continue;
      }
      if (!kotlin && ch === '`') {
        k = scanTemplate(k);
        out.push(' ');
        continue;
      }
      if (!kotlin && ch === '/') {
        const { char, word } = prevToken();
        if (char === null || '=(:,;[!&|?{}'.includes(char) || regexKeywords.has(word)) {
          const end = skipRegex(k);
          if (end > k + 1) {
            out.push(' ');
            k = end;
            continue;
          }
        }
      }
      out.push(ch);
      k++;
    }
    return k;
  };

  scanBlock(0, false);
  return { code: out.join(''), importSpecs };
}
