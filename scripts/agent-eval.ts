// npm run agent:eval
//
// The evidence-checking agent on the committed jobs (src/agent/eval.ts): one offline step each, no seller action,
// no model call. Writes evidence/agent-eval-2026-10-30.json and prints the summary. Latencies vary run to run;
// everything else is a function of the committed receipts.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evalCommitted } from "../src/agent/eval.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const report = await evalCommitted(join(root, "data", "jobs"), join(root, "evidence", "ms4-summary.json"));
const out = join(root, "evidence", "agent-eval-2026-10-30.json");
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
const { rows: _rows, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
console.log(`-> ${out}`);
