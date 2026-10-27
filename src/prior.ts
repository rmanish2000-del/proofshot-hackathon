// Prior records (SPEC §3): what earlier jobs on the same garment decided.
//
// A job's output directory holds its receipt.jsonl. Before a new job starts, the
// sibling directories are read, and every earlier job whose job entry names the
// same garment_id is listed on the new job's own receipt. A re-run adds a record;
// it never clears one, so an earlier refusal stays visible.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseReceipt, verifyChain } from "./receipt.ts";

export const RECEIPT_FILE = "receipt.jsonl";

export interface PriorRecord {
  readonly job_id: string;
  /** The earlier receipt's head hash. */
  readonly head: string;
  /** gate entries that decided REFUSE. */
  readonly refusals: number;
  /** release entries. */
  readonly releases: number;
  /** The earlier job entry's timestamp. */
  readonly at: string;
}

/**
 * Every earlier job on `garmentId` in the subdirectories of `outRoot`, oldest
 * first (ties by directory name). `selfDir` (a directory name) is skipped: it is
 * the job being written. A null garment id has no history. A sibling receipt
 * that cannot be parsed or does not verify throws: its refusals cannot be
 * counted, so the new job does not start as if it had none.
 */
export function priorRecords(outRoot: string, garmentId: string | null, selfDir?: string): PriorRecord[] {
  if (garmentId === null || !existsSync(outRoot)) return [];
  const found: { dir: string; record: PriorRecord }[] = [];

  for (const dirent of readdirSync(outRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name === selfDir) continue;
    const path = join(outRoot, dirent.name, RECEIPT_FILE);
    if (!existsSync(path)) continue;

    let entries;
    try {
      entries = parseReceipt(readFileSync(path, "utf8"));
    } catch (err) {
      throw new Error(`prior records: ${path}: ${(err as Error).message}`);
    }
    const check = verifyChain(entries);
    if (!check.ok) throw new Error(`prior records: ${path} does not verify: entry ${check.index}, ${check.reason}`);

    const job = entries[0]!;
    const payload = (typeof job.payload === "object" && job.payload !== null ? job.payload : {}) as Record<string, unknown>;
    if (job.kind !== "job" || payload.garment_id !== garmentId) continue;

    found.push({
      dir: dirent.name,
      record: {
        job_id: typeof payload.job_id === "string" ? payload.job_id : dirent.name,
        head: check.head,
        refusals: entries.filter((e) => e.kind === "gate" && (e.payload as { decision?: unknown } | null)?.decision === "REFUSE").length,
        releases: entries.filter((e) => e.kind === "release").length,
        at: job.at,
      },
    });
  }

  found.sort((a, b) => (a.record.at < b.record.at ? -1 : a.record.at > b.record.at ? 1 : a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  return found.map((f) => f.record);
}
