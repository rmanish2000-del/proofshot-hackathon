// npm run page: rewrites the core.js region of web/verify.html from src/core.js.

import { readFileSync, writeFileSync } from "node:fs";

import { CORE_PATH, PAGE_PATH, pageWithCore } from "../src/page.ts";

const before = readFileSync(PAGE_PATH, "utf8");
const after = pageWithCore(before, readFileSync(CORE_PATH, "utf8"));
if (after === before) {
  console.log("web/verify.html is up to date");
} else {
  writeFileSync(PAGE_PATH, after);
  console.log("web/verify.html updated from src/core.js");
}
