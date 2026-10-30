// Evidence Recovery Agent: a local job queue (files, no external service). A task is one bounded agent step for
// one job; the job is queued again only after the seller acts (adds a photo or approves). N workers run in one
// process; a task is claimed by an atomic rename from pending/ to running/, and a seller never has more running
// tasks than its limit. Workers share nothing but the queue folder: each step reads only its own job's files.
//
//   <root>/queue/pending/<enqueued-ms>__<seller>__<job>.json
//   <root>/queue/running/...      (while a worker holds it)
//   <root>/queue/done/...         (with timings)

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { Clock } from "../receipt.ts";
import type { AgentConfig } from "./config.ts";
import { appendMetric } from "./metrics.ts";
import { checkId, scopedPath } from "./paths.ts";
import type { Proposer } from "./policy.ts";
import { runAgentStep } from "./runner.ts";
import type { GateRunner } from "./runner.ts";
import type { Store } from "./store.ts";

interface Task {
  readonly seller: string;
  readonly job: string;
  readonly enqueued_ms: number;
}

export class FileQueue {
  readonly dir: string;
  constructor(root: string) {
    this.dir = scopedPath(root, "queue");
    for (const d of ["pending", "running", "done"]) mkdirSync(scopedPath(this.dir, d), { recursive: true });
  }

  enqueue(seller: string, job: string, nowMs: number = Date.now()): string {
    const name = `${String(nowMs).padStart(15, "0")}__${checkId("seller", seller)}__${checkId("job", job)}.json`;
    writeFileSync(scopedPath(this.dir, "pending", name), JSON.stringify({ seller, job, enqueued_ms: nowMs } satisfies Task));
    return name;
  }

  pending(): string[] {
    return readdirSync(scopedPath(this.dir, "pending")).sort();
  }

  running(): string[] {
    return readdirSync(scopedPath(this.dir, "running"));
  }

  /** The oldest pending task whose seller is under its running limit, moved to running/; null if none. */
  claim(maxPerSeller: number): { name: string; task: Task } | null {
    const busy = new Map<string, number>();
    for (const n of this.running()) {
      const seller = n.split("__")[1]!;
      busy.set(seller, (busy.get(seller) ?? 0) + 1);
    }
    for (const name of this.pending()) {
      const seller = name.split("__")[1]!;
      if ((busy.get(seller) ?? 0) >= maxPerSeller) continue;
      const from = scopedPath(this.dir, "pending", name);
      if (!existsSync(from)) continue;
      renameSync(from, scopedPath(this.dir, "running", name)); // atomic: one worker wins
      return { name, task: JSON.parse(readFileSync(scopedPath(this.dir, "running", name), "utf8")) as Task };
    }
    return null;
  }

  complete(name: string, info: Record<string, unknown>): void {
    const from = scopedPath(this.dir, "running", name);
    const task = JSON.parse(readFileSync(from, "utf8")) as Task;
    writeFileSync(scopedPath(this.dir, "done", name), JSON.stringify({ ...task, ...info }));
    rmSync(from);
  }
}

export interface QueueOptions {
  readonly store: Store;
  readonly gate: GateRunner;
  readonly config: AgentConfig;
  readonly clock?: Clock;
  readonly proposer?: Proposer;
  readonly nowMs?: () => number;
}

/** Runs workers (config.workers) until no task can be claimed; returns how many tasks ran. */
export async function drainQueue(queue: FileQueue, opts: QueueOptions): Promise<number> {
  const nowMs = opts.nowMs ?? (() => Date.now());
  let ran = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const claimed = queue.claim(opts.config.seller.maxConcurrentJobs);
      if (!claimed) {
        // Another seller's task may be waiting only on the per-seller limit; stop when nothing is running either.
        if (queue.pending().length === 0 || queue.running().length === 0) return;
        await new Promise((r) => setTimeout(r, 5));
        continue;
      }
      const { name, task } = claimed;
      const start = nowMs();
      let line;
      try {
        const r = await runAgentStep({ store: opts.store, seller: task.seller, job: task.job, gate: opts.gate, config: opts.config, clock: opts.clock, proposer: opts.proposer });
        line = { ok: true, error: null, cap: r.cap, tools: r.tools.length, reruns: r.tools.filter((t) => t === "rerun_gate").length, rejected: r.rejected.length, model_calls: r.model_calls, cost_usd: r.cost_usd, status: r.status, decision: r.decision };
      } catch (err) {
        line = { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : "error", cap: null, tools: 0, reruns: 0, rejected: 0, model_calls: 0, cost_usd: 0, status: "error", decision: null };
      }
      const end = nowMs();
      appendMetric(opts.store.root, { at: new Date(end).toISOString(), seller: task.seller, job: task.job, queue_ms: start - task.enqueued_ms, processing_ms: end - start, ...line });
      queue.complete(name, { started_ms: start, finished_ms: end, ok: line.ok });
      ran++;
    }
  };
  await Promise.all(Array.from({ length: opts.config.workers }, () => worker()));
  return ran;
}
