// CAP1 (Grok 29 Oct 10:25 IST on proofshot #23, Manish approved): the Meta
// spend ledger. Every call to a Meta model (the muse-spark-open verifier on
// Baseten, SAM 3.1 on the Meta Model API) goes through meteredFetch, which
// refuses before the request when the ledger would pass the cap less the
// reserve, and appends one entry per call that reached the server. The ledger
// lives outside the repo: %LOCALAPPDATA%\ProofShot\meta-ledger.json.
//
// A refusal is a thrown SpendCapError, so the step fails closed exactly as a
// network error would: the verifier records no findings (gate REFUSE,
// not_verified), SAM gives no mask. Nothing is skipped silently.

import { join } from "node:path";

import { fileLedger } from "./render-replicate.ts";
import type { Ledger } from "./render-replicate.ts";

/** CAP1: hard cap on the Meta ledger. */
export const META_SPEND_CAP_USD = 80;
/** CAP1: left unspent; calls stop at cap - reserve. */
export const META_RESERVE_USD = 70;
/** muse-spark-open on Baseten, USD per million tokens: Baseten's pricing page as captured 23 Oct (UsagePricing snapshot); same as Fireworks. */
export const BASETEN_MUSE_PRICE_PER_MTOK = Object.freeze({ input: 1.25, output: 4.25 });
/** SAM 3.1 on the Meta Model API: 2.50 USD per 1000 images, from secondary sources quoting dev.meta.ai (not read first-hand); one call = one image. */
export const SAM_PRICE_PER_CALL_USD = 0.0025;
/** Prompt tokens assumed per image part when estimating before a verifier call (four 715x1600 JPEGs measured about 6900 tokens). */
const TOKENS_PER_IMAGE = 2000;

export type MetaCallKind = "verifier" | "sam";

export class SpendCapError extends Error {
  override name = "SpendCapError";
}

type Env = Readonly<Record<string, string | undefined>>;

export function metaLedgerPath(env: Env): string | null {
  const base = (env.LOCALAPPDATA ?? "").trim();
  return base ? join(base, "ProofShot", "meta-ledger.json") : null;
}

export function metaLedger(env: Env): Ledger | null {
  const path = metaLedgerPath(env);
  return path ? fileLedger(path) : null;
}

export function tokensUsd(promptTokens: number, completionTokens: number): number {
  const usd = (promptTokens * BASETEN_MUSE_PRICE_PER_MTOK.input + completionTokens * BASETEN_MUSE_PRICE_PER_MTOK.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** A ceiling for one call before it is made. A verifier call counts its image parts, its text and every output token it allows. */
export function estimateMetaUsd(kind: MetaCallKind, body: string): number {
  if (kind === "sam") return SAM_PRICE_PER_CALL_USD;
  let images = 0;
  let maxTokens = 16384;
  let text = body.length;
  try {
    const req = JSON.parse(body) as { max_tokens?: unknown; messages?: { content?: unknown }[] };
    if (typeof req.max_tokens === "number") maxTokens = req.max_tokens;
    text = 0;
    for (const m of req.messages ?? []) {
      if (typeof m.content === "string") text += m.content.length;
      else if (Array.isArray(m.content)) {
        for (const part of m.content as { type?: unknown; text?: unknown }[]) {
          if (part.type === "image_url") images++;
          else if (typeof part.text === "string") text += part.text.length;
        }
      }
    }
  } catch {
    // An unreadable body is estimated from its length: too high, never too low.
  }
  return tokensUsd(images * TOKENS_PER_IMAGE + Math.ceil(text / 3), maxTokens);
}

/** What one call cost: the response's token usage when it has one, else the estimate. */
export function metaCallUsd(kind: MetaCallKind, body: string, responseText: string): { cost: number; estimated: boolean } {
  if (kind === "sam") return { cost: SAM_PRICE_PER_CALL_USD, estimated: true };
  try {
    const usage = (JSON.parse(responseText) as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
    if (typeof usage?.prompt_tokens === "number" && typeof usage.completion_tokens === "number") {
      return { cost: tokensUsd(usage.prompt_tokens, usage.completion_tokens), estimated: true };
    }
  } catch {
    // fall through to the estimate
  }
  return { cost: estimateMetaUsd(kind, body), estimated: true };
}

export interface SpendSummary {
  readonly calls: number;
  readonly spent_usd: number;
  readonly cap_usd: number;
  readonly reserve_usd: number;
  /** What may still be spent before the reserve is touched. */
  readonly available_usd: number;
}

export function spendSummary(ledger: Ledger, cap: number, reserve: number): SpendSummary {
  const entries = ledger.read();
  const spent = Math.round(entries.reduce((s, e) => s + e.cost_usd, 0) * 1e6) / 1e6;
  return { calls: entries.length, spent_usd: spent, cap_usd: cap, reserve_usd: reserve, available_usd: Math.max(0, Math.round((cap - reserve - spent) * 1e6) / 1e6) };
}

type Init = { readonly body: string };
type Res = { readonly status: number; text(): Promise<string> };

/**
 * Wraps a fetch so every Meta call is capped and booked. Before the request:
 * no ledger, an unreadable ledger, or spent + estimate over cap - reserve throws
 * SpendCapError and nothing is sent. After it: one ledger entry, then the same
 * status and body to the caller.
 */
export function meteredFetch<I extends Init>(
  inner: (url: string, init: I) => Promise<Res>,
  opts: { readonly kind: MetaCallKind; readonly ledger: Ledger | null; readonly cap?: number; readonly reserve?: number; readonly now?: () => number },
): (url: string, init: I) => Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  const cap = opts.cap ?? META_SPEND_CAP_USD;
  const reserve = opts.reserve ?? META_RESERVE_USD;
  let n = 0;
  return async (url, init) => {
    if (!opts.ledger) throw new SpendCapError("no Meta spend ledger (LOCALAPPDATA is not set)");
    let spent: number;
    try {
      spent = opts.ledger.read().reduce((s, e) => s + e.cost_usd, 0);
    } catch (err) {
      throw new SpendCapError(`the Meta spend ledger cannot be read: ${err instanceof Error ? err.message : String(err)}`);
    }
    const estimate = estimateMetaUsd(opts.kind, init.body);
    if (spent + estimate > cap - reserve + 1e-9) {
      throw new SpendCapError(`Meta spend ${spent.toFixed(4)} + ${estimate.toFixed(4)} would pass ${(cap - reserve).toFixed(2)} USD (cap ${cap}, reserve ${reserve})`);
    }
    const res = await inner(url, init);
    const text = await res.text();
    const { cost, estimated } = metaCallUsd(opts.kind, init.body, text);
    const at = new Date((opts.now ?? Date.now)()).toISOString();
    opts.ledger.append({ at, prediction_id: `meta:${opts.kind}:${at}:${++n}`, cost_usd: cost, estimated });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, text: async () => text };
  };
}
