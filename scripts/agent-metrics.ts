// npm run agent:metrics [-- --root out/agent-demo/store]
//
// The evidence-checking agent's local monitoring summary (src/agent/metrics.ts): runs, failures, cap hits,
// rejected actions, gate re-runs, model calls, spend, queue and processing time, cost per completed listing.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeMetrics } from "../src/agent/metrics.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--root");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)), i >= 0 && args[i + 1] ? args[i + 1]! : "out/agent-demo/store");
console.log(JSON.stringify(summarizeMetrics(root), null, 2));
