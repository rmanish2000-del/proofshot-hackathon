// Evidence Recovery Agent: the eval on the committed jobs (round 5). Each committed receipt is copied into a
// scratch store as run-1 of a job, and the agent takes one offline step. No seller acts and no model is called,
// so the gate runner given here throws if the agent ever tries to re-run: the eval measures what the agent
// would do and ask for, and proves it changes no decision. "Resolved" needs a new seller photo or an approved
// paid re-check, which the committed data does not have, so it is reported as measured: zero.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReceipt } from "../receipt.ts";
import { makeConfig } from "./config.ts";
import { outcomeOf } from "./reasons.ts";
import { runAgentStep } from "./runner.ts";
import type { GateRunner } from "./runner.ts";
import { Store } from "./store.ts";

export interface EvalRow {
  readonly job: string;
  readonly provenance: string;
  readonly decision_before: string;
  readonly decision_after: string;
  readonly class: string;
  readonly code: string;
  readonly tools: readonly string[];
  readonly status: string;
  readonly requested_view: string | null;
  readonly try_on: boolean;
  readonly latency_ms: number;
}

export interface EvalReport {
  readonly jobs: number;
  readonly by_class: Readonly<Record<string, number>>;
  readonly decisions_changed_by_agent: number;
  readonly recovery_requests: Readonly<Record<string, number>>;
  readonly paid_recheck_proposals: number;
  readonly no_recovery_violations: number;
  readonly resolved_with_committed_data: number;
  readonly seller_steps_proposed: number;
  readonly length: {
    readonly verifier_alone_passed_shortened_tryon_checks: string;
    readonly tryon_receipts: number;
    readonly tryon_held_by_gate_before: number;
    readonly tryon_held_after_agent: number;
    readonly tryon_recovery_attempts: number;
  };
  readonly latency_ms: { readonly p50: number; readonly p90: number; readonly max: number };
  readonly rows: readonly EvalRow[];
}

const neverCalled: GateRunner = async () => {
  throw new Error("the eval gives the agent no seller action, so it must not re-run the gate");
};

function pct(v: readonly number[], p: number): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
}

export async function evalCommitted(jobsRoot: string, ms4SummaryPath: string): Promise<EvalReport> {
  const store = new Store(mkdtempSync(join(tmpdir(), "agent-eval-")));
  const config = makeConfig({});
  const rows: EvalRow[] = [];
  for (const job of readdirSync(jobsRoot).sort()) {
    const receiptPath = join(jobsRoot, job, "receipt.jsonl");
    if (job.startsWith("upload-") || !existsSync(receiptPath)) continue;
    const entries = parseReceipt(readFileSync(receiptPath, "utf8"));
    const o = outcomeOf(entries);
    const runDir = join(store.runDir("eval", job), "run-1");
    mkdirSync(runDir, { recursive: true });
    copyFileSync(receiptPath, join(runDir, "receipt.jsonl"));
    // Committed jobs carry no view labels, so the agent sees no labelled photos and asks for the view it needs.
    store.writeJob({
      seller: "eval", job, garment_note: "", candidate: "candidate.jpg", photos: [], status: "new", steps: 0, model_calls: 0, cost_usd: 0,
      runs: [{ n: 1, mode: "offline", decision: o.decision, head: entries.at(-1)!.hash }], approvals: [], request: null, explanation: null,
    });
    const t0 = performance.now();
    const step = await runAgentStep({ store, seller: "eval", job, gate: neverCalled, config });
    const latency = Math.round((performance.now() - t0) * 10) / 10;
    const after = store.readJob("eval", job);
    const render = entries.find((e) => e.kind === "render");
    rows.push({
      job, provenance: String((entries[0]!.payload as { provenance?: string }).provenance ?? ""),
      decision_before: o.decision, decision_after: after.runs.at(-1)!.decision, class: o.class, code: o.code,
      tools: step.tools, status: step.status, requested_view: after.request?.view ?? null,
      try_on: (render?.payload as { provider?: string } | undefined)?.provider === "replicate-pruna-tryon", latency_ms: latency,
    });
  }
  const count = (f: (r: EvalRow) => boolean) => rows.filter(f).length;
  const byClass: Record<string, number> = {};
  for (const r of rows) byClass[r.class] = (byClass[r.class] ?? 0) + 1;
  const requests: Record<string, number> = {};
  for (const r of rows) if (r.requested_view) requests[r.requested_view] = (requests[r.requested_view] ?? 0) + 1;
  const ms4 = JSON.parse(readFileSync(ms4SummaryPath, "utf8")) as { by_expected: { changed: { answered: number; correct: number } } };
  const changed = ms4.by_expected.changed;
  const tryons = rows.filter((r) => r.try_on);
  const lat = rows.map((r) => r.latency_ms);
  return {
    jobs: rows.length,
    by_class: byClass,
    decisions_changed_by_agent: count((r) => r.decision_before !== r.decision_after),
    recovery_requests: requests,
    paid_recheck_proposals: count((r) => r.status === "awaiting_approval"),
    no_recovery_violations: count((r) => r.class === "violation" && r.status === "done" && !r.tools.includes("request_seller_photo") && !r.tools.includes("rerun_gate")),
    resolved_with_committed_data: 0,
    seller_steps_proposed: count((r) => r.requested_view !== null),
    length: {
      verifier_alone_passed_shortened_tryon_checks: `${changed.answered - changed.correct} of ${changed.answered}`,
      tryon_receipts: tryons.length,
      tryon_held_by_gate_before: tryons.filter((r) => r.decision_before !== "RELEASE").length,
      tryon_held_after_agent: tryons.filter((r) => r.decision_after !== "RELEASE").length,
      tryon_recovery_attempts: tryons.filter((r) => r.tools.includes("request_seller_photo") || r.tools.includes("rerun_gate")).length,
    },
    latency_ms: { p50: pct(lat, 50), p90: pct(lat, 90), max: Math.max(...lat) },
    rows,
  };
}
