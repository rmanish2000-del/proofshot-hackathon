// Types for core.js, which stays plain JavaScript so the verify page can inline it.

export type EntryKind = "job" | "segments" | "render" | "verifier" | "fidelity" | "gate" | "release" | "approval" | "agent";

export interface ReceiptEntry {
  readonly seq: number;
  readonly at: string;
  readonly kind: EntryKind;
  readonly payload: unknown;
  readonly prev: string;
  readonly hash: string;
}

export type ChainCheck = { ok: true; head: string; length: number } | { ok: false; index: number; reason: string };

export type ImageStatus = "VALID" | "NOT RELEASED" | "TAMPERED";

export interface ImageCheck {
  readonly status: ImageStatus;
  /** The render the hash belongs to, when it belongs to one. */
  readonly render_id: string | null;
  /** On NOT RELEASED, that render's gate decision (null when no gate entry exists). */
  readonly decision: "RELEASE" | "REVIEW" | "REFUSE" | null;
  readonly reason: string;
}

export type ChainText = string | { readonly error: string };

export type RecordCheck =
  | { readonly supported: false; readonly message: string }
  | { readonly supported: true; readonly chain: ChainCheck; readonly image_sha256: string | null; readonly image: ImageCheck | null };

export function canonicalJson(value: unknown): string;
export function entryText(e: Pick<ReceiptEntry, "seq" | "at" | "kind" | "payload" | "prev">): string;
export function parseReceipt(text: string): ReceiptEntry[];
export function chainTexts(entries: readonly ReceiptEntry[]): ChainText[];
export function checkChain(entries: readonly ReceiptEntry[], digests: readonly ChainText[]): ChainCheck;
export function checkImageWith(entries: readonly ReceiptEntry[], chain: ChainCheck, imageSha256: string): ImageCheck;
export function shaFromFragment(fragment: string | null | undefined): string | null;
export function verifyRecord(
  receiptText: string,
  image: { readonly bytes: Uint8Array } | { readonly sha256: string } | null,
  subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> } | undefined | null,
): Promise<RecordCheck>;
