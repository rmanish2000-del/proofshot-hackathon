import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { evalCommitted } from "../src/agent/eval.ts";
import type { EvalReport } from "../src/agent/eval.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Everything but latencies, which vary from run to run. */
function stable(r: EvalReport): unknown {
  const { latency_ms: _l, rows, ...rest } = r;
  return { ...rest, rows: rows.map(({ latency_ms: _x, ...row }) => row) };
}

test("agent eval: the committed eval is current, the agent changes no decision, and never recovers a real violation or a length miss", async () => {
  const report = await evalCommitted(join(ROOT, "data", "jobs"), join(ROOT, "evidence", "ms4-summary.json"));
  const committed = JSON.parse(readFileSync(join(ROOT, "evidence", "agent-eval-2026-10-30.json"), "utf8")) as EvalReport;
  assert.deepEqual(stable(report), stable(committed), "evidence/agent-eval-2026-10-30.json is stale: run npm run agent:eval");
  assert.equal(report.decisions_changed_by_agent, 0);
  assert.equal(report.no_recovery_violations, report.by_class.violation);
  assert.equal(report.length.tryon_held_after_agent, report.length.tryon_held_by_gate_before);
  assert.equal(report.length.tryon_recovery_attempts, 0);
  for (const row of report.rows) {
    if (row.class === "violation") assert.ok(!row.tools.includes("request_seller_photo") && !row.tools.includes("rerun_gate"), row.job);
    assert.ok(!row.tools.includes("rerun_gate"), `${row.job}: no re-run without a seller action`);
  }
});
