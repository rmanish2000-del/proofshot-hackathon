// Seller corrections (UX-EASY2): the optional "Something wrong? Correct it" on
// the upload page's result card. A correction is the seller's view of the nine
// chips (matches / does not match / not sure) plus one optional line. It is
// stored beside the job, outside the hash chain, the way listing copy lives in
// data/copy: data/corrections/<job-id>.json, each record naming the receipt head
// it refers to. It is never a receipt entry and never an input to the gate, so
// saving one leaves the receipt bytes and the decision exactly as they were.
// Nobody reviews corrections; the file only keeps what the seller said.
//
// The upload-* files are in .gitignore, like the upload job folders, so a
// seller's words are never committed by a sync.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ATTRIBUTES } from "./types.ts";
import type { Attribute } from "./types.ts";

export const SELLER_VIEWS = ["matches", "does_not_match", "not_sure"] as const;
export type SellerView = (typeof SELLER_VIEWS)[number];

/** What every saved record says about its effect; the page shows the same words. */
export const CORRECTION_EFFECT = "none: stored outside the receipt chain; the gate never reads it, so the decision does not change";
export const MAX_CORRECTION_NOTE = 300;

export interface CorrectionRecord {
  readonly job_id: string;
  /** The head hash of the receipt the seller was looking at. */
  readonly receipt_head: string;
  readonly saved_at: string;
  /** The seller's view per attribute; an attribute the seller left alone is absent. */
  readonly attributes: Readonly<Partial<Record<Attribute, SellerView>>>;
  readonly note: string | null;
  readonly effect: typeof CORRECTION_EFFECT;
}

export interface CorrectionFile {
  readonly job_id: string;
  /** Oldest first; the page shows the last one. */
  readonly records: readonly CorrectionRecord[];
}

export class CorrectionError extends Error {
  override name = "CorrectionError";
}

/** Checks one posted correction; throws CorrectionError with the reason the page shows. */
export function parseCorrection(body: unknown): { attributes: Partial<Record<Attribute, SellerView>>; note: string | null } {
  if (typeof body !== "object" || body === null) throw new CorrectionError("the correction is not a JSON object");
  const b = body as { attributes?: unknown; note?: unknown };
  const raw = b.attributes ?? {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new CorrectionError("attributes must be an object");
  const attributes: Partial<Record<Attribute, SellerView>> = {};
  for (const [name, view] of Object.entries(raw as Record<string, unknown>)) {
    if (!(ATTRIBUTES as readonly string[]).includes(name)) throw new CorrectionError(`${JSON.stringify(name)} is not one of the nine attributes`);
    if (!(SELLER_VIEWS as readonly unknown[]).includes(view)) throw new CorrectionError(`${name} must be one of ${SELLER_VIEWS.join(", ")}`);
    attributes[name as Attribute] = view as SellerView;
  }
  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") throw new CorrectionError("note must be text");
  const note = typeof b.note === "string" && b.note.trim() !== "" ? b.note.trim() : null;
  if (note !== null && note.length > MAX_CORRECTION_NOTE) throw new CorrectionError(`note is longer than ${MAX_CORRECTION_NOTE} characters`);
  if (Object.keys(attributes).length === 0 && note === null) throw new CorrectionError("nothing to save: mark an attribute or write a line");
  return { attributes, note };
}

export function correctionPath(dir: string, jobId: string): string {
  return join(dir, `${jobId}.json`);
}

export function readCorrections(dir: string, jobId: string): CorrectionFile | null {
  const file = correctionPath(dir, jobId);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as CorrectionFile) : null;
}

/** Appends one record to data/corrections/<job>.json and returns it. Touches nothing in the job folder. */
export function saveCorrection(dir: string, jobId: string, receiptHead: string, body: unknown, now: Date = new Date()): CorrectionRecord {
  const { attributes, note } = parseCorrection(body);
  const record: CorrectionRecord = { job_id: jobId, receipt_head: receiptHead, saved_at: now.toISOString(), attributes, note, effect: CORRECTION_EFFECT };
  const previous = readCorrections(dir, jobId);
  const file: CorrectionFile = { job_id: jobId, records: [...(previous?.records ?? []), record] };
  mkdirSync(dir, { recursive: true });
  writeFileSync(correctionPath(dir, jobId), `${JSON.stringify(file, null, 2)}\n`);
  return record;
}
