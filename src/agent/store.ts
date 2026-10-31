// Evidence Recovery Agent: storage, keyed by seller and job. Photos (blobs) and records (job record, gate
// receipts, the agent section) live in separate trees so they can move to separate stores later:
//
//   <root>/blobs/<seller>/<job>/<photo>              seller photos and the candidate image
//   <root>/records/<seller>/<job>/job.json           the job record: photos + views, status, next action, usage
//   <root>/records/<seller>/<job>/runs/run-<n>/      one gate run: receipt.jsonl (+ the image the pipeline writes)
//   <root>/records/<seller>/<job>/agent.jsonl        the agent section, hash-chained like a receipt
//   <root>/sellers/<seller>.json                     per-seller usage (model calls, spend)
//
// Every path goes through scopedPath with checked ids, so one job cannot read or write another's files.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { Receipt, parseReceipt } from "../receipt.ts";
import type { Clock, ReceiptEntry } from "../receipt.ts";
import { checkFileName, checkId, scopedPath } from "./paths.ts";
import type { PrimaryProblem, View } from "./vocab.ts";

export interface PhotoRecord {
  readonly file: string;
  readonly view: View;
  readonly sha256: string;
}

export interface RunRecord {
  readonly n: number;
  readonly mode: "offline" | "live";
  readonly decision: string;
  readonly head: string;
}

export interface ApprovalRecord {
  readonly what: "paid_rerun" | "publish" | "replace_primary";
  readonly by: string;
  readonly at: string;
  readonly estimate_usd?: number;
  readonly used?: boolean;
}

/** One replacement of photo 1: what was replaced, by whom, and the gate runs on the new photos. */
export interface ReplacedRecord {
  readonly old: PhotoRecord;
  readonly new: PhotoRecord;
  readonly problems: readonly PrimaryProblem[];
  readonly by: string;
  readonly at: string;
  readonly runs: readonly { readonly n: number; readonly mode: "offline" | "live"; readonly decision: string; readonly cost_usd: number }[];
}

export interface JobRecord {
  readonly seller: string;
  readonly job: string;
  readonly garment_note: string;
  readonly candidate: string;
  readonly photos: readonly PhotoRecord[];
  readonly status: "new" | "awaiting_seller" | "awaiting_approval" | "ready_to_publish" | "published" | "stopped" | "done";
  readonly steps: number;
  readonly model_calls: number;
  readonly cost_usd: number;
  readonly runs: readonly RunRecord[];
  readonly approvals: readonly ApprovalRecord[];
  readonly request: { readonly view: View; readonly instructions_en: string; readonly instructions_hi: string } | null;
  /** The agent's open request to replace photo 1 (absent on records from before this action existed). */
  readonly replace_request?: { readonly photo: string; readonly problems: readonly PrimaryProblem[]; readonly text_en: string; readonly text_hi: string } | null;
  readonly replaced?: readonly ReplacedRecord[];
  readonly explanation: { readonly en: string; readonly hi: string } | null;
}

export interface SellerUsage {
  readonly model_calls: number;
  readonly spend_usd: number;
}

export class Store {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  blobDir(seller: string, job: string): string {
    return scopedPath(this.root, "blobs", checkId("seller", seller), checkId("job", job));
  }

  recordDir(seller: string, job: string): string {
    return scopedPath(this.root, "records", checkId("seller", seller), checkId("job", job));
  }

  /** A photo of this job, read only from this job's blob folder. */
  readPhoto(seller: string, job: string, file: string): Uint8Array {
    return new Uint8Array(readFileSync(scopedPath(this.blobDir(seller, job), checkFileName(file))));
  }

  writePhoto(seller: string, job: string, file: string, bytes: Uint8Array): void {
    const dir = this.blobDir(seller, job);
    mkdirSync(dir, { recursive: true });
    writeFileSync(scopedPath(dir, checkFileName(file)), bytes);
  }

  readJob(seller: string, job: string): JobRecord {
    return JSON.parse(readFileSync(scopedPath(this.recordDir(seller, job), "job.json"), "utf8")) as JobRecord;
  }

  hasJob(seller: string, job: string): boolean {
    return existsSync(scopedPath(this.recordDir(seller, job), "job.json"));
  }

  /** Written to a temp file and renamed, so a reader never sees half a record. */
  writeJob(record: JobRecord): void {
    const dir = this.recordDir(record.seller, record.job);
    mkdirSync(dir, { recursive: true });
    const tmp = scopedPath(dir, "job.json.tmp");
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(tmp, scopedPath(dir, "job.json"));
  }

  runDir(seller: string, job: string): string {
    return scopedPath(this.recordDir(seller, job), "runs");
  }

  readRunReceipt(seller: string, job: string, n: number): ReceiptEntry[] {
    return parseReceipt(readFileSync(scopedPath(this.runDir(seller, job), `run-${n}`, "receipt.jsonl"), "utf8"));
  }

  agentLogPath(seller: string, job: string): string {
    return scopedPath(this.recordDir(seller, job), "agent.jsonl");
  }

  /** The agent section: a hash-chained JSONL file of its own (entry kind "agent"); the gate receipt is untouched. */
  agentLog(seller: string, job: string, clock?: Clock): Receipt {
    mkdirSync(this.recordDir(seller, job), { recursive: true });
    return new Receipt({ path: this.agentLogPath(seller, job), clock });
  }

  readAgentLog(seller: string, job: string): ReceiptEntry[] {
    const p = this.agentLogPath(seller, job);
    return existsSync(p) ? parseReceipt(readFileSync(p, "utf8")) : [];
  }

  sellerUsage(seller: string): SellerUsage {
    const p = scopedPath(this.root, "sellers", `${checkId("seller", seller)}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as SellerUsage) : { model_calls: 0, spend_usd: 0 };
  }

  writeSellerUsage(seller: string, usage: SellerUsage): void {
    const dir = scopedPath(this.root, "sellers");
    mkdirSync(dir, { recursive: true });
    writeFileSync(scopedPath(dir, `${checkId("seller", seller)}.json`), `${JSON.stringify(usage)}\n`);
  }
}
