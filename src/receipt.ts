// The receipt (SPEC §3): an append-only, hash-chained JSONL record of a job.
//
// Each entry's hash covers its seq, time, kind, payload and the previous hash,
// so an edit, a reorder, a deleted line or a forged entry breaks the chain at a
// known index. It is not signed: rewriting the whole file from genesis is not
// detectable, and nothing here claims otherwise.

import { appendFileSync, existsSync, readFileSync } from "node:fs";

import { canonicalJson, chainTexts, checkChain, entryText, parseReceipt } from "./core.js";
import type { ChainCheck, EntryKind, ReceiptEntry } from "./core.js";
import { sha256Hex } from "./util.ts";

export { parseReceipt };
export type { ChainCheck, EntryKind, ReceiptEntry } from "./core.js";

export const GENESIS = "0".repeat(64);

/** Returns an ISO timestamp for the next entry. */
export type Clock = () => string;

export const wallClock: Clock = () => new Date().toISOString();

/**
 * A clock that hands out recorded timestamps in order, for replay. Running out
 * throws: a replay never quietly falls back to the wall clock.
 */
export function recordedClock(timestamps: readonly string[]): Clock {
  const queue = [...timestamps];
  let used = 0;
  return () => {
    if (used >= queue.length) throw new Error(`recorded clock ran out after ${queue.length} timestamps`);
    return queue[used++] as string;
  };
}

export function entryHash(e: Pick<ReceiptEntry, "seq" | "at" | "kind" | "payload" | "prev">): string {
  return sha256Hex(entryText(e));
}

/**
 * Checks the chain is non-empty, seq runs 0..n-1, each prev links, and every
 * hash recomputes. The logic is core.js checkChain, shared with the verify page;
 * only the hashing (node:crypto here, crypto.subtle there) differs.
 */
export function verifyChain(entries: readonly ReceiptEntry[]): ChainCheck {
  return checkChain(entries, chainTexts(entries).map((t) => (typeof t === "string" ? sha256Hex(t) : t)));
}

/**
 * Builds a chain in memory and, given a path, appends each entry to that file as
 * it is made. An existing file is verified and continued, never truncated; a
 * file that does not verify is refused.
 */
export class Receipt {
  readonly #entries: ReceiptEntry[] = [];
  readonly #clock: Clock;
  readonly #path: string | undefined;

  constructor(opts: { clock?: Clock; path?: string } = {}) {
    this.#clock = opts.clock ?? wallClock;
    this.#path = opts.path;
    if (this.#path && existsSync(this.#path)) {
      const existing = parseReceipt(readFileSync(this.#path, "utf8"));
      if (existing.length > 0) {
        const check = verifyChain(existing);
        if (!check.ok) throw new Error(`refusing to append to a broken receipt: entry ${check.index}, ${check.reason}`);
        this.#entries.push(...existing);
      }
    }
  }

  append(kind: EntryKind, payload: unknown): ReceiptEntry {
    const last = this.#entries.at(-1);
    const body = { seq: this.#entries.length, at: this.#clock(), kind, payload, prev: last ? last.hash : GENESIS };
    // Hash first: a payload canonicalJson rejects never reaches the file.
    const entry: ReceiptEntry = { ...body, hash: entryHash(body) };
    // Store the JSON round trip, so the in-memory chain equals what a reader parses.
    const line = JSON.stringify(entry);
    if (this.#path) appendFileSync(this.#path, line + "\n");
    const stored = JSON.parse(line) as ReceiptEntry;
    this.#entries.push(stored);
    return stored;
  }

  get entries(): readonly ReceiptEntry[] {
    return [...this.#entries];
  }

  get head(): string {
    return this.#entries.at(-1)?.hash ?? GENESIS;
  }

  toJsonl(): string {
    return this.#entries.map((e) => JSON.stringify(e) + "\n").join("");
  }
}

/**
 * The garment's identity across jobs: the hash of its sorted source-image
 * hashes, so the same photos in any order give the same id. null when no
 * source image could be hashed.
 */
export function garmentId(sourceHashes: readonly string[]): string | null {
  if (sourceHashes.length === 0) return null;
  return sha256Hex(canonicalJson([...sourceHashes].sort()));
}
