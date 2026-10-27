// The verify page (SPEC §9): one static HTML file with core.js inlined between
// two marker lines, so it runs from file:// with no network call. pageWithCore
// puts the current core.js in; test/page.test.ts fails when the copy in
// web/verify.html is stale, and `npm run page` rewrites it.

export const PAGE_PATH = new URL("../web/verify.html", import.meta.url);
export const CORE_PATH = new URL("./core.js", import.meta.url);

export const BEGIN = "// BEGIN core.js (inlined from src/core.js by npm run page; edit it there)";
export const END = "// END core.js";

/** core.js as a classic script: its `export ` keywords dropped, nothing else changed. */
export function inlineCore(coreSource: string): string {
  if (/<\/script/i.test(coreSource)) throw new Error("core.js must not contain a closing script tag");
  if (/^\s*(import|export\s*\{)/m.test(coreSource)) throw new Error("core.js must have no imports and no export lists");
  return coreSource.replace(/^export /gm, "");
}

/** The page with the region between BEGIN and END replaced by inlineCore(coreSource). */
export function pageWithCore(html: string, coreSource: string): string {
  const begin = html.indexOf(BEGIN);
  const from = begin < 0 ? -1 : html.indexOf("\n", begin) + 1;
  const end = from <= 0 ? -1 : html.indexOf(END, from);
  if (end < 0) throw new Error("verify page: core.js markers missing or out of order");
  return html.slice(0, from) + inlineCore(coreSource) + html.slice(end);
}
