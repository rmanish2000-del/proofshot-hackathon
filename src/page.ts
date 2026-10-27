// The static pages (SPEC §9, §11): HTML files with core.js inlined between two
// marker lines, so they run with no module loading and the verify page runs
// from file:// with no network call. pageWithCore puts the current core.js in;
// test/page.test.ts fails when a page's copy is stale, and `npm run page`
// rewrites every page in PAGES.

export const PAGE_PATH = new URL("../web/verify.html", import.meta.url);
export const SHOP_PATH = new URL("../web/shop.html", import.meta.url);
export const CORE_PATH = new URL("./core.js", import.meta.url);

/** Every page that inlines core.js. */
export const PAGES: readonly { readonly name: string; readonly path: URL }[] = [
  { name: "web/verify.html", path: PAGE_PATH },
  { name: "web/shop.html", path: SHOP_PATH },
];

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
  if (end < 0) throw new Error("page: core.js markers missing or out of order");
  return html.slice(0, from) + inlineCore(coreSource) + html.slice(end);
}
