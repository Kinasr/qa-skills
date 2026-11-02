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
  const clean = (/** @type {string} */ text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const stem = (/** @type {string} */ path) => path.replace(/\.[cm]?[jt]sx?$/, '').replace(/\/index$/, '');
  const imports = (/** @type {string} */ file, /** @type {string} */ text) => [...clean(text).matchAll(/\b(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map(match => match[1].startsWith('.') ? stem(posix.normalize(posix.join(dirname(file), match[1]))) : stem(match[1]));
  if (ts) {
    const touched = new Set(Object.keys(support).map(stem));
    const fixture = new Set([...texts].filter(([file, text]) => /\b\w+\.extend\s*(?:<[^;]*?>)?\s*\(/.test(clean(text)) && imports(file, text).some(path => touched.has(path))).map(([file]) => stem(file)));
    return [...texts].filter(([file, text]) => !Object.hasOwn(support, file) && imports(file, text).some(path => touched.has(path) || fixture.has(path))).map(([file]) => file);
  }
  const names = new Set(Object.values(support).flatMap(text => [...clean(text).matchAll(/\b(?:class|interface|object|fun|val|var|typealias)\s+(\w+)/g)].map(match => match[1])));
  return [...texts].filter(([file, text]) => !Object.hasOwn(support, file) && [...clean(text).matchAll(/\b\w+\b/g)].some(match => names.has(match[0]))).map(([file]) => file);
}
