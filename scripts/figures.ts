// npm run figures [-- --check]
//
// Writes every marked figure (`<!--f:key-->value<!--/f-->`) in README.md and
// SUBMISSION.md from committed evidence (src/figures.ts). With --check it
// writes nothing and exits 1 if a doc is out of date. Run `npm run evidence:pack`
// first when receipts or call logs changed.

import { readFileSync, writeFileSync } from "node:fs";

import { FIGURE_DOCS, applyFigures, computeFigures } from "../src/figures.ts";

const check = process.argv.includes("--check");
const figures = computeFigures(".");
let stale = false;
for (const doc of FIGURE_DOCS) {
  const before = readFileSync(doc, "utf8");
  const { text, unknown, count } = applyFigures(before, figures);
  if (unknown.length) {
    console.error(`${doc}: unknown figure keys ${unknown.join(", ")}`);
    process.exitCode = 1;
  }
  const changed = text !== before;
  console.log(`${doc}: ${count} figures${changed ? (check ? ", OUT OF DATE" : ", updated") : ", current"}`);
  if (changed) stale = true;
  if (changed && !check) writeFileSync(doc, text);
}
if (check && stale) process.exitCode = 1;
