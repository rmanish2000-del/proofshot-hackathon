// npm run page: rewrites the core.js region of every page in PAGES from src/core.js.

import { readFileSync, writeFileSync } from "node:fs";

import { CORE_PATH, PAGES, pageWithCore } from "../src/page.ts";

const core = readFileSync(CORE_PATH, "utf8");
for (const page of PAGES) {
  const before = readFileSync(page.path, "utf8");
  const after = pageWithCore(before, core);
  if (after === before) {
    console.log(`${page.name} is up to date`);
  } else {
    writeFileSync(page.path, after);
    console.log(`${page.name} updated from src/core.js`);
  }
}
