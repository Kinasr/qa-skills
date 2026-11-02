// @ts-check
// Shared renderer; the closed layout set contains Inbox and Next steps.
import { readFileSync } from "node:fs";
import { cardPageLayout } from "./card-page-client.mjs";
import { PAGE_MODULES } from "./page-modules.mjs";

/** @import {PageModel} from "./page.d.mts" */

// Tests validate this deliberately small module syntax with the TypeScript
// compiler: named unaliased imports and exported declarations. The CLI itself
// needs no compiler or bundler at runtime.
/**
 * @param {readonly string[]} modules
 * @returns {string}
 */
function inlinePageModules(modules) {
  return modules.map((source) => source
    .replace(/^import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?[ \t]*\n?/gm, "")
    .replace(/^export\s+(?=(?:async\s+)?function\b|class\b|const\b|let\b|var\b)/gm, "")).join("\n;\n");
}

const client = inlinePageModules(PAGE_MODULES.map((path) => readFileSync(new URL(path, import.meta.url), "utf8")));

// `source` is the inlined client; a closing script tag inside it would end its element early.
/**
 * @param {PageModel} model
 * @param {string | readonly string[]} [source] - a script or ordered module sources
 * @returns {string}
 */
export function renderCardPage(model, source = client) {
  source = typeof source === "string" ? source : inlinePageModules(source);
  const layout = cardPageLayout(/** @type {string} */ (model.layout));
  const data = JSON.stringify(model).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${layout.title}</title>
<style>
:root{--bg:#f6f6f3;--fg:#1d1d1b;--mute:#5c5c57;--line:#8a8a82;--card:#ffffff;--acc:#2450c0;--on-acc:#ffffff;--ok:#1f6a33;--warn:#8f4208;--bad:#a3201a;--chip:#ecebe5}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#161615;--fg:#ecebe6;--mute:#a9a8a1;--line:#6b6b64;--card:#1f1f1d;--acc:#9db6ff;--on-acc:#10182e;--ok:#7fd18f;--warn:#f0a35c;--bad:#ff8a80;--chip:#2a2a27}}
:root[data-theme=dark]{--bg:#161615;--fg:#ecebe6;--mute:#a9a8a1;--line:#6b6b64;--card:#1f1f1d;--acc:#9db6ff;--on-acc:#10182e;--ok:#7fd18f;--warn:#f0a35c;--bad:#ff8a80;--chip:#2a2a27}
:root{color-scheme:light dark}:root[data-theme=light]{color-scheme:light}:root[data-theme=dark]{color-scheme:dark}
*{box-sizing:border-box}[hidden]{display:none!important}
body{font:16px/1.5 system-ui,sans-serif;color:var(--fg);background:var(--bg);margin:0 auto;padding:24px;max-width:1200px}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;margin-bottom:16px}header h1{font-size:1.25rem;margin:0}header p{flex-basis:100%;margin:0;color:var(--mute)}
.header-stack{display:block;flex-basis:100%;min-width:0}.header-stack>p{margin:0;color:var(--mute)}
.knowledge-prose{white-space:pre-wrap}.muted{color:var(--mute)}.case-section-label{font-weight:600;margin:12px 0 0}section .case-section-label:first-child{margin-top:0}
.inbox{display:grid;grid-template-columns:minmax(240px,1fr) minmax(0,3fr);gap:24px;margin:16px 0}
nav{display:flex;flex-direction:column;gap:8px;align-items:stretch}
section{min-width:0;overflow-wrap:anywhere;background:var(--card);padding:20px;border:1px solid var(--line);border-radius:8px}
button,input,textarea,select{font:inherit;color:inherit}
button{padding:8px 12px;text-align:left;border:1px solid var(--line);border-radius:6px;background:var(--card);cursor:pointer}
button:disabled{color:var(--mute);cursor:not-allowed}
nav button{display:block}nav button small{display:block}
button[aria-pressed=true]{border-color:var(--acc);box-shadow:inset 4px 0 0 var(--acc);font-weight:600}
.dot{display:inline-block;width:10px;height:10px;margin-right:8px;border-radius:50%;border:2px solid var(--mute)}
.dot.done{background:var(--ok);border-color:var(--ok)}.dot.partial{background:linear-gradient(90deg,var(--warn) 50%,transparent 50%);border-color:var(--warn)}.dot.open{background:transparent;border-color:var(--mute)}
fieldset{min-width:0;margin:16px 0;border:1px solid var(--line);border-radius:6px}legend{font-weight:600;padding:0 6px}
label{display:block;margin:10px 0}input[type=radio]{margin-right:8px}
select{max-width:100%;padding:6px;background:var(--card);border:1px solid var(--line);border-radius:6px}
input[type=text],textarea{display:block;width:100%;padding:8px;background:var(--bg);border:1px solid var(--line);border-radius:6px}textarea{min-height:90px}
.case-navigation{display:flex;gap:8px;align-items:center;margin-top:12px}
details{margin:16px 0}summary{cursor:pointer;color:var(--mute)}
.table-scroll{overflow-x:auto;max-width:100%}table{width:100%;border-collapse:collapse;background:var(--card)}caption{text-align:left;color:var(--mute);padding:6px 0}th,td{border-bottom:1px solid var(--line);padding:6px;text-align:left;vertical-align:top;white-space:pre-wrap}
:focus-visible{outline:3px solid var(--acc);outline-offset:3px}
@media(max-width:700px){.inbox{grid-template-columns:1fr}}
pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%}code{padding:0 4px;background:var(--chip);border-radius:3px;overflow-wrap:anywhere}.key{position:relative;text-decoration:underline dotted}.key-summary{display:none;position:absolute;left:0;top:100%;z-index:1;min-width:180px;max-width:320px;padding:8px;background:var(--fg);color:var(--bg);border-radius:4px;font:14px/1.5 system-ui,sans-serif;white-space:normal}.key:hover>.key-summary,.key:focus-within>.key-summary,button:focus-visible .key-summary{display:block}
</style></head><body><main id="card-page-app"></main>
<script type="application/json" id="card-page-data">${data}</script>
<script>${source.replace(/<\/(script)/gi, "<\\/$1")}\nmountCardPage(JSON.parse(document.getElementById("card-page-data").textContent));</script>
</body></html>`;
}
