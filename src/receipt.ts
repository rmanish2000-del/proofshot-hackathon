// The receipt (SPEC §3): an append-only, hash-chained JSONL record of a job.
//
// Each entry's hash covers its seq, time, kind, payload and the previous hash,
// so an edit, a reorder, a deleted line or a forged entry breaks the chain at a
// known index. It is not signed: rewriting the whole file from genesis is not
// detectable, and nothing here claims otherwise.

import { appendFileSync, existsSync, readFileSync } from "node:fs";

import { canonicalJson, sha256Hex } from "./util.ts";

export const GENESIS = "0".repeat(64);

export type EntryKind = "job" | "segments" | "render" | "verifier" | "gate" | "release" | "approval";

export interface ReceiptEntry {
  readonly seq: number;
  readonly at: string;
  readonly kind: EntryKind;
  readonly payload: unknown;
  readonly prev: string;
  readonly hash: string;
}

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
  return sha256Hex(canonicalJson({ seq: e.seq, at: e.at, kind: e.kind, payload: e.payload, prev: e.prev }));
}

export type ChainCheck = { ok: true; head: string; length: number } | { ok: false; index: number; reason: string };

/** Checks the chain is non-empty, seq runs 0..n-1, each prev links, and every hash recomputes. */
export function verifyChain(entries: readonly ReceiptEntry[]): ChainCheck {
  if (!Array.isArray(entries) || entries.length === 0) return { ok: false, index: 0, reason: "empty receipt" };
  let prev = GENESIS;
  for (const [index, e] of entries.entries()) {
    if (typeof e !== "object" || e === null) return { ok: false, index, reason: "entry is not an object" };
    if (e.seq !== index) return { ok: false, index, reason: `seq is ${String(e.seq)}, expected ${index}` };
    if (e.prev !== prev) return { ok: false, index, reason: "prev does not match the previous hash" };
    let expected: string;
    try {
      expected = entryHash(e);
    } catch (err) {
      return { ok: false, index, reason: `cannot hash entry: ${(err as Error).message}` };
    }
    if (e.hash !== expected) return { ok: false, index, reason: "hash does not match the entry" };
    prev = e.hash;
  }
  return { ok: true, head: prev, length: entries.length };
}

/** Parses receipt.jsonl text. A line that is not JSON throws with its line number. */
export function parseReceipt(text: string): ReceiptEntry[] {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return lines.map((line, i) => {
    try {
      return JSON.parse(line) as ReceiptEntry;
    } catch {
      throw new Error(`receipt line ${i + 1} is not JSON`);
    }
  });
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
