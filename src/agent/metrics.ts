// Evidence Recovery Agent: local monitoring. One JSON line per queue run in <root>/metrics.jsonl (no external
// service), and a summary: runs, failures, cap hits, gate re-runs, spend, latency, queue time, processing time,
// failure rate, and cost per completed listing (a listing whose latest gate decision is RELEASE).

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface MetricLine {
  readonly at: string;
  readonly seller: string;
  readonly job: string;
  readonly queue_ms: number;
  readonly processing_ms: number;
  readonly ok: boolean;
  readonly error: string | null;
  readonly cap: string | null;
  readonly tools: number;
  readonly reruns: number;
  readonly rejected: number;
  readonly model_calls: number;
  readonly cost_usd: number;
  readonly status: string;
  readonly decision: string | null;
}

export function metricsPath(root: string): string {
  return join(root, "metrics.jsonl");
}

export function appendMetric(root: string, line: MetricLine): void {
  appendFileSync(metricsPath(root), `${JSON.stringify(line)}\n`);
}

function pct(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
}

export interface MetricsSummary {
  readonly runs: number;
  readonly failures: number;
  readonly failure_rate: number | null;
  readonly cap_hits: Readonly<Record<string, number>>;
  readonly rejected_actions: number;
  readonly gate_reruns: number;
  readonly model_calls: number;
  readonly spend_usd: number;
  readonly completed_listings: number;
  readonly cost_per_completed_listing_usd: number | null;
  readonly queue_ms: { readonly p50: number | null; readonly p90: number | null };
  readonly processing_ms: { readonly p50: number | null; readonly p90: number | null };
}

export function summarizeMetrics(root: string): MetricsSummary {
  const lines: MetricLine[] = existsSync(metricsPath(root))
    ? readFileSync(metricsPath(root), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as MetricLine)
    : [];
  const caps: Record<string, number> = {};
  for (const l of lines) if (l.cap) caps[l.cap] = (caps[l.cap] ?? 0) + 1;
  const failures = lines.filter((l) => !l.ok).length;
  const spend = Math.round(lines.reduce((s, l) => s + l.cost_usd, 0) * 1e6) / 1e6;
  // A completed listing: the last line for that job says the gate decided RELEASE.
  const last = new Map<string, MetricLine>();
  for (const l of lines) last.set(`${l.seller}/${l.job}`, l);
  const completed = [...last.values()].filter((l) => l.decision === "RELEASE").length;
  return {
    runs: lines.length,
    failures,
    failure_rate: lines.length ? Math.round((failures / lines.length) * 1000) / 1000 : null,
    cap_hits: caps,
    rejected_actions: lines.reduce((s, l) => s + l.rejected, 0),
    gate_reruns: lines.reduce((s, l) => s + l.reruns, 0),
    model_calls: lines.reduce((s, l) => s + l.model_calls, 0),
    spend_usd: spend,
    completed_listings: completed,
    cost_per_completed_listing_usd: completed ? Math.round((spend / completed) * 1e6) / 1e6 : null,
    queue_ms: { p50: pct(lines.map((l) => l.queue_ms), 50), p90: pct(lines.map((l) => l.queue_ms), 90) },
    processing_ms: { p50: pct(lines.map((l) => l.processing_ms), 50), p90: pct(lines.map((l) => l.processing_ms), 90) },
  };
}
