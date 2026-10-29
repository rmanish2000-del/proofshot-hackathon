// CAP1 / CAP1b (Grok 29 Oct 10:25 and 10:55 IST on proofshot #23, Manish
// approved): spend ledgers for the paid model calls, one per account, each
// outside the repo in %LOCALAPPDATA%\ProofShot.
//
//   meta      the Meta Model API credit (api.meta.ai, MODEL_API_KEY): SAM 3.1
//             and Muse Spark. Batch cap 80 USD, then a 70 USD reserve.
//   baseten   Baseten's own bill: the muse-spark-open verifier. Not the Meta
//             credit, so it never counts toward the Meta total.
//   fireworks lives in src/fireworks-copy.ts (60 USD batch, 40 USD reserve).
//
// A batch stops at the cap. The reserve is the rest of the credit, kept for
// the live judge demo and re-runs: a call made with PROOFSHOT_USE_RESERVE=1
// may go up to cap + reserve and never past it.
//
// Every metered call refuses before the request when it would pass its limit,
// or when the ledger is missing or unreadable, by throwing SpendCapError, so
// the step fails closed exactly as a network error would (verifier: no
// findings, gate REFUSE not_verified; SAM: no mask). Each call that reached
// the server gets one ledger entry. Nothing is skipped silently.

import { join } from "node:path";

import { fileLedger } from "./render-replicate.ts";
import type { Ledger } from "./render-replicate.ts";

export interface SpendLimit {
  /** What a batch may spend. */
  readonly cap_usd: number;
  /** Kept back above the cap; only an explicit PROOFSHOT_USE_RESERVE=1 call may use it. */
  readonly reserve_usd: number;
}

/** CAP1b: the Meta Model API credit, 150 USD = 80 batch + 70 reserve. */
export const META_LIMIT: SpendLimit = Object.freeze({ cap_usd: 80, reserve_usd: 70 });
/**
 * Baseten, its own account. No figure was given for it on #23; 5 USD is the
 * cap MS1 first named, kept until Grok or Manish sets another.
 */
export const BASETEN_LIMIT: SpendLimit = Object.freeze({ cap_usd: 5, reserve_usd: 0 });
export const USE_RESERVE_ENV = "PROOFSHOT_USE_RESERVE";

/** USD per million tokens for muse-spark-open (Baseten pricing page as captured 23 Oct) and Muse Spark on api.meta.ai (secondary sources quoting Meta's price). */
export const MUSE_PRICE_PER_MTOK = Object.freeze({ input: 1.25, output: 4.25 });
/** SAM 3.1 on the Meta Model API: 2.50 USD per 1000 images, from secondary sources quoting dev.meta.ai (not read first-hand); one call = one image. */
export const SAM_PRICE_PER_CALL_USD = 0.0025;
/** Prompt tokens assumed per image part when estimating before a call (four 715x1600 JPEGs measured about 6900 tokens). */
const TOKENS_PER_IMAGE = 2000;

export type MeteredAccount = "meta" | "baseten";
/** sam is priced per image; the others by tokens. */
export type MeteredCallKind = "verifier" | "sam" | "muse";

export class SpendCapError extends Error {
  override name = "SpendCapError";
}

type Env = Readonly<Record<string, string | undefined>>;

export function useReserve(env: Env): boolean {
  return (env[USE_RESERVE_ENV] ?? "").trim() === "1";
}

/** The most this ledger may hold after a call: the cap, or cap + reserve with the explicit opt-in. */
export function spendLimitUsd(limit: SpendLimit, env: Env): number {
  return limit.cap_usd + (useReserve(env) ? limit.reserve_usd : 0);
}

export function ledgerPath(account: MeteredAccount, env: Env): string | null {
  const base = (env.LOCALAPPDATA ?? "").trim();
  return base ? join(base, "ProofShot", `${account}-ledger.json`) : null;
}

export function accountLedger(account: MeteredAccount, env: Env): Ledger | null {
  const path = ledgerPath(account, env);
  return path ? fileLedger(path) : null;
}

export function tokensUsd(promptTokens: number, completionTokens: number): number {
  const usd = (promptTokens * MUSE_PRICE_PER_MTOK.input + completionTokens * MUSE_PRICE_PER_MTOK.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** A ceiling for one call before it is made: image parts, text and every output token the request allows. */
export function estimateCallUsd(kind: MeteredCallKind, body: string): number {
  if (kind === "sam") return SAM_PRICE_PER_CALL_USD;
  let images = 0;
  let maxTokens = 16384;
  let text = body.length;
  try {
    const req = JSON.parse(body) as { max_tokens?: unknown; max_output_tokens?: unknown; messages?: unknown[]; input?: unknown[] };
    const cap = typeof req.max_tokens === "number" ? req.max_tokens : typeof req.max_output_tokens === "number" ? req.max_output_tokens : null;
    if (cap !== null) maxTokens = cap;
    text = 0;
    const walk = (v: unknown): void => {
      if (typeof v === "string") text += v.length;
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (o.type === "image_url" || o.type === "input_image") {
          images++;
          return;
        }
        for (const [k, x] of Object.entries(o)) if (k === "text" || k === "content" || k === "messages" || k === "input") walk(x);
      }
    };
    walk(req.messages ?? req.input ?? []);
  } catch {
    // An unreadable body is estimated from its length: too high, never too low.
  }
  return tokensUsd(images * TOKENS_PER_IMAGE + Math.ceil(text / 3), maxTokens);
}

/** What one call cost: the answer's token usage when it has one (chat or responses shape), else the estimate. */
export function callUsd(kind: MeteredCallKind, body: string, responseText: string): { cost: number; estimated: boolean } {
  if (kind === "sam") return { cost: SAM_PRICE_PER_CALL_USD, estimated: true };
  try {
    const usage = (JSON.parse(responseText) as { usage?: Record<string, unknown> }).usage;
    const inTok = usage?.prompt_tokens ?? usage?.input_tokens;
    const outTok = usage?.completion_tokens ?? usage?.output_tokens;
    if (typeof inTok === "number" && typeof outTok === "number") return { cost: tokensUsd(inTok, outTok), estimated: true };
  } catch {
    // fall through to the estimate
  }
  return { cost: estimateCallUsd(kind, body), estimated: true };
}

export interface SpendSummary {
  readonly calls: number;
  readonly spent_usd: number;
  readonly cap_usd: number;
  readonly reserve_usd: number;
  /** What a batch may still spend. */
  readonly batch_left_usd: number;
  /** What is left of the reserve, for opt-in calls only. */
  readonly reserve_left_usd: number;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function spendSummary(ledger: Ledger, limit: SpendLimit): SpendSummary {
  const entries = ledger.read();
  const spent = r6(entries.reduce((s, e) => s + e.cost_usd, 0));
  return {
    calls: entries.length,
    spent_usd: spent,
    cap_usd: limit.cap_usd,
    reserve_usd: limit.reserve_usd,
    batch_left_usd: r6(Math.max(0, limit.cap_usd - spent)),
    reserve_left_usd: r6(Math.max(0, limit.reserve_usd - Math.max(0, spent - limit.cap_usd))),
  };
}

export function summaryLine(name: string, s: SpendSummary): string {
  return `${name}: ${s.spent_usd} USD in ${s.calls} call(s); batch cap ${s.cap_usd}, ${s.batch_left_usd} left; reserve ${s.reserve_usd}, ${s.reserve_left_usd} left (PROOFSHOT_USE_RESERVE=1 only)`;
}

type Init = { readonly body: string };
type Res = { readonly status: number; text(): Promise<string> };

/**
 * Wraps a fetch so every call is capped and booked in one account's ledger.
 * Before the request: no ledger, an unreadable ledger, or spent + estimate
 * over the limit (cap, or cap + reserve with the opt-in) throws SpendCapError
 * and nothing is sent. After it: one ledger entry, then the same status and
 * body to the caller.
 */
export function meteredFetch<I extends Init>(
  inner: (url: string, init: I) => Promise<Res>,
  opts: { readonly kind: MeteredCallKind; readonly account: MeteredAccount; readonly ledger: Ledger | null; readonly env: Env; readonly limit?: SpendLimit; readonly now?: () => number },
): (url: string, init: I) => Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  const limit = opts.limit ?? (opts.account === "meta" ? META_LIMIT : BASETEN_LIMIT);
  const max = spendLimitUsd(limit, opts.env);
  let n = 0;
  return async (url, init) => {
    if (!opts.ledger) throw new SpendCapError(`no ${opts.account} spend ledger (LOCALAPPDATA is not set)`);
    let spent: number;
    try {
      spent = opts.ledger.read().reduce((s, e) => s + e.cost_usd, 0);
    } catch (err) {
      throw new SpendCapError(`the ${opts.account} spend ledger cannot be read: ${err instanceof Error ? err.message : String(err)}`);
    }
    const estimate = estimateCallUsd(opts.kind, init.body);
    if (spent + estimate > max + 1e-9) {
      const why = max > limit.cap_usd ? `cap ${limit.cap_usd} + reserve ${limit.reserve_usd}` : `the batch cap ${limit.cap_usd} (the ${limit.reserve_usd} USD reserve needs ${USE_RESERVE_ENV}=1)`;
      throw new SpendCapError(`${opts.account} spend ${spent.toFixed(4)} + ${estimate.toFixed(4)} would pass ${max.toFixed(2)} USD, ${why}`);
    }
    const res = await inner(url, init);
    const text = await res.text();
    const { cost, estimated } = callUsd(opts.kind, init.body, text);
    const at = new Date((opts.now ?? Date.now)()).toISOString();
    opts.ledger.append({ at, prediction_id: `${opts.account}:${opts.kind}:${at}:${++n}`, cost_usd: cost, estimated });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, text: async () => text };
  };
}
