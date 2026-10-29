// #10 evidence pack (Grok, 29 Oct 18:30 IST on proofshot #23): built only from
// what is committed. No museum images (the Met / Rijksmuseum fetch was dropped),
// no model call, no estimate that is not marked as one.
//
// - jobRows: one row per render in every committed receipt (data/jobs), with the
//   chain check, providers and model ids, the verifier's tokens, fidelity and the
//   gate decision.
// - callStats: latency (median, p90) and cost per stage from the committed call
//   logs in evidence/ (SAM, the verifier per provider, Fireworks copy). Cost is the
//   ledger rule applied to each logged usage: tokens x the price table in
//   src/spend-meta.ts / src/fireworks-copy.ts, SAM at its flat per-call price; it is
//   an estimate from usage, never a bill.
// Everything is sorted and carries no clock, so the same files give the same pack.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { fireworksCostUsd } from "./fireworks-copy.ts";
import { parseReceipt, verifyChain } from "./receipt.ts";
import { SAM_PRICE_PER_CALL_USD, tokensUsd } from "./spend-meta.ts";

export interface PackRow {
  readonly job_id: string;
  readonly provenance: string;
  /** The garment folder the job's note names (`kurta-01: ...`), or "" for a fixture note. */
  readonly garment: string;
  readonly chain_ok: boolean;
  readonly head: string;
  readonly render_id: string;
  readonly render_sha256: string;
  readonly render_provider: string;
  readonly render_model: string;
  readonly segmenter: string;
  readonly verifier_provider: string;
  readonly verifier_model: string;
  readonly findings: number;
  readonly verifier_error: string;
  readonly prompt_tokens: number | null;
  readonly completion_tokens: number | null;
  readonly fidelity: string;
  readonly decision: string;
  readonly cited: string;
}

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Every render of every committed receipt under jobsRoot (upload-* jobs are not committed), sorted by job then render. */
export function jobRows(jobsRoot: string): PackRow[] {
  const rows: PackRow[] = [];
  for (const job of readdirSync(jobsRoot).sort()) {
    const path = join(jobsRoot, job, "receipt.jsonl");
    if (job.startsWith("upload-") || !existsSync(path)) continue;
    const entries = parseReceipt(readFileSync(path, "utf8"));
    const chain = verifyChain(entries);
    const head = entries.at(-1)?.hash ?? "";
    const jobEntry = (entries.find((e) => e.kind === "job")?.payload ?? {}) as Obj;
    const note = str(jobEntry.garment_note);
    const garment = /^([a-z0-9][a-z0-9-]*):\s/.exec(note)?.[1] ?? "";
    const seg = (entries.find((e) => e.kind === "segments")?.payload ?? {}) as Obj;
    const segmenter = seg.segmenter ? `${str((seg.segmenter as Obj).provider)}/${str((seg.segmenter as Obj).model)}` : "none";
    for (const r of entries.filter((e) => e.kind === "render")) {
      const render = r.payload as Obj;
      const of = (kind: string) => (entries.find((e) => e.kind === kind && (e.payload as Obj).render_id === render.render_id)?.payload ?? null) as Obj | null;
      const v = of("verifier");
      const vid = (v?.verifier ?? {}) as Obj;
      const usage = (v?.usage ?? {}) as Obj;
      const gate = of("gate");
      rows.push({
        job_id: job,
        provenance: str(jobEntry.provenance),
        garment,
        chain_ok: chain.ok,
        head,
        render_id: str(render.render_id),
        render_sha256: str(render.sha256),
        render_provider: str(render.provider),
        render_model: str(render.model),
        segmenter,
        verifier_provider: str(vid.provider),
        verifier_model: str(vid.model),
        findings: Array.isArray(v?.findings) ? (v!.findings as unknown[]).length : 0,
        verifier_error: str(v?.error),
        prompt_tokens: num(usage.prompt_tokens),
        completion_tokens: num(usage.completion_tokens),
        fidelity: str(of("fidelity")?.decision),
        decision: str(gate?.decision),
        cited: str((gate?.cited as Obj | undefined)?.reason),
      });
    }
  }
  return rows;
}

const CSV_COLUMNS: readonly (keyof PackRow)[] = [
  "job_id", "provenance", "garment", "chain_ok", "render_id", "render_sha256", "render_provider", "render_model", "segmenter",
  "verifier_provider", "verifier_model", "findings", "verifier_error", "prompt_tokens", "completion_tokens", "fidelity", "decision", "cited", "head",
];

export function rowsCsv(rows: readonly PackRow[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

/** The p-th percentile (0..100) by the nearest-rank rule, or null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

export interface StageStats {
  readonly stage: string;
  readonly calls: number;
  readonly answered: number;
  readonly failed: number;
  readonly latency_ms_median: number | null;
  readonly latency_ms_p90: number | null;
  readonly usd_per_call_median: number | null;
  readonly usd_total: number;
  readonly usd_basis: string;
}

interface CallSample {
  readonly stage: string;
  readonly ok: boolean;
  readonly latency_ms: number | null;
  readonly usd: number | null;
}

/** One sample from one committed call log, by its file name prefix; null for a log this pack does not read. */
export function sampleFromLog(name: string, log: Obj): CallSample | null {
  const latency = num(log.latency_ms);
  const response = (log.response ?? null) as Obj | null;
  const status = num(response?.status);
  const ok = !log.error && status !== null && status >= 200 && status < 300;
  const body = (response?.body ?? null) as Obj | null;
  const usage = (body?.usage ?? null) as Obj | null;
  if (name.startsWith("sam-")) return { stage: "segment: SAM 3.1 (api.meta.ai)", ok, latency_ms: latency, usd: ok ? SAM_PRICE_PER_CALL_USD : null };
  if (name.startsWith("verifier-")) {
    const provider = str(log.provider) || "baseten";
    const model = str(log.model);
    const pt = num(usage?.prompt_tokens ?? usage?.input_tokens);
    const ct = num(usage?.completion_tokens ?? usage?.output_tokens);
    return { stage: `verify: ${model} (${provider})`, ok, latency_ms: latency, usd: pt !== null && ct !== null ? tokensUsd(pt, ct) : null };
  }
  if (name.startsWith("fireworks-")) {
    const pt = num(usage?.prompt_tokens);
    const ct = num(usage?.completion_tokens);
    return { stage: `copy: ${str(log.model) || "model not logged"} (fireworks)`, ok, latency_ms: latency, usd: pt !== null && ct !== null ? fireworksCostUsd(pt, ct) : null };
  }
  return null;
}

/** Stats per stage over every committed call log in the given directories (not recursive). */
export function callStats(dirs: readonly string[]): StageStats[] {
  const samples: CallSample[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      let log: Obj;
      try {
        log = JSON.parse(readFileSync(join(dir, name), "utf8")) as Obj;
      } catch {
        continue;
      }
      const s = sampleFromLog(name, log);
      if (s) samples.push(s);
    }
  }
  const stages = [...new Set(samples.map((s) => s.stage))].sort();
  return stages.map((stage) => {
    const mine = samples.filter((s) => s.stage === stage);
    const ok = mine.filter((s) => s.ok);
    const lat = ok.map((s) => s.latency_ms).filter((v): v is number => v !== null);
    const usd = ok.map((s) => s.usd).filter((v): v is number => v !== null);
    return {
      stage,
      calls: mine.length,
      answered: ok.length,
      failed: mine.length - ok.length,
      latency_ms_median: percentile(lat, 50),
      latency_ms_p90: percentile(lat, 90),
      usd_per_call_median: percentile(usd, 50),
      usd_total: Math.round(usd.reduce((a, b) => a + b, 0) * 1e6) / 1e6,
      usd_basis: stage.startsWith("segment") ? `flat ${SAM_PRICE_PER_CALL_USD} USD per call (secondary sources)` : "logged tokens x the price table (estimate)",
    };
  });
}

export interface PackSummary {
  readonly jobs: number;
  readonly renders: number;
  readonly chains_ok: number;
  readonly garments_with_receipts: readonly string[];
  readonly decisions: Readonly<Record<string, number>>;
  /** The same totals for live renders only, and for fixture renders only. */
  readonly decisions_live: Readonly<Record<string, number>>;
  readonly decisions_fixture: Readonly<Record<string, number>>;
  /** Jobs whose receipt holds more than one render (the chain count is per job, the decisions per render). */
  readonly jobs_with_several_renders: readonly string[];
  readonly live_renders: number;
  readonly verifier_errors: number;
}

export function summarize(rows: readonly PackRow[]): PackSummary {
  const jobs = new Map<string, boolean>();
  for (const r of rows) jobs.set(r.job_id, r.chain_ok);
  const count = (list: readonly PackRow[]) => {
    const out: Record<string, number> = {};
    for (const r of list) out[r.decision || "none"] = (out[r.decision || "none"] ?? 0) + 1;
    return Object.fromEntries(Object.entries(out).sort());
  };
  const decisions = count(rows);
  const perJob = new Map<string, number>();
  for (const r of rows) perJob.set(r.job_id, (perJob.get(r.job_id) ?? 0) + 1);
  return {
    jobs: jobs.size,
    renders: rows.length,
    chains_ok: [...jobs.values()].filter(Boolean).length,
    garments_with_receipts: [...new Set(rows.map((r) => r.garment).filter((g) => g !== ""))].sort(),
    decisions,
    decisions_live: count(rows.filter((r) => r.provenance === "live")),
    decisions_fixture: count(rows.filter((r) => r.provenance !== "live")),
    jobs_with_several_renders: [...perJob].filter(([, n]) => n > 1).map(([j]) => j).sort(),
    live_renders: rows.filter((r) => r.provenance === "live").length,
    verifier_errors: rows.filter((r) => r.verifier_error !== "").length,
  };
}
