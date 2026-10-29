// FW1 (Grok 29 Oct 08:24 IST on proofshot #23): a Meta Llama model on
// Fireworks (OpenAI-compatible chat completions) writes two pieces of plain
// text from facts the pipeline already recorded: a receipt summary a seller
// can read, and listing copy from the seller's own claims. It never decides
// anything: the gate decision is read from the receipt and quoted, and the
// text is stored beside the receipt (data/copy/), never inside the chain.
//
// The key is FIREWORKS_API_KEY. It is read from the process env first and, on
// Windows, from the User env scope (HKCU\Environment) when the process did not
// inherit it, so a shell started before the key was set does not silently fall
// back. It goes in the Authorization header and nowhere else. With no key, or
// a spend ledger that would pass 5 USD, the text comes from a fixed template
// and the record says why (`fallback_reason`), never silently.

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { fileLedger } from "./render-replicate.ts";
import type { Ledger } from "./render-replicate.ts";
import type { ReceiptEntry } from "./receipt.ts";
import { sha256Hex } from "./util.ts";

export const FIREWORKS_PROVIDER = "fireworks";
export const FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
/** Meta Llama 3.3 70B Instruct as served by Fireworks; FIREWORKS_MODEL overrides it. */
export const FIREWORKS_MODEL = "accounts/fireworks/models/llama-v3p3-70b-instruct";
export const FIREWORKS_KEY_ENV = "FIREWORKS_API_KEY";
/** USD per million tokens, input and output, from the Fireworks price page for 16B+ models (used when the API reports no cost). */
export const FIREWORKS_PRICE_PER_MTOK = Object.freeze({ input: 0.9, output: 0.9 });
export const FIREWORKS_SPEND_CAP_USD = 5;
export const FIREWORKS_MAX_TOKENS = 400;
export const FIREWORKS_TIMEOUT_MS = 60_000;
export const TEMPLATE_PROVIDER = "template";

export type CopyTask = "receipt_summary" | "listing_copy";
export type CopyFallbackReason = "no_api_token" | "spend_cap" | "fireworks_failed";

export type FireworksFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface ChatMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

/** The facts one text is written from: what the receipt and the seller's note say, nothing else. */
export interface CopyFacts {
  readonly job_id: string;
  readonly receipt_head: string;
  readonly decision: string | null;
  readonly reasons: readonly string[];
  readonly findings: readonly { attribute: string; verdict: string }[];
  readonly claims: readonly { field: string; value: string }[];
}

export interface CopyRecord {
  readonly job_id: string;
  readonly task: CopyTask;
  /** The receipt's last hash when the text was written: the text describes that receipt and no later entry. */
  readonly receipt_head: string;
  readonly provider: typeof FIREWORKS_PROVIDER | typeof TEMPLATE_PROVIDER;
  /** The model id sent, or "none" for the template. */
  readonly model: string;
  /** The model id the API answered with, when it named one. */
  readonly response_model?: string;
  readonly generated: boolean;
  readonly fallback_reason?: CopyFallbackReason;
  readonly key_source?: "process_env" | "user_env";
  /** sha256 of the exact request body sent (no key in it). */
  readonly request_sha256?: string;
  readonly usage?: { prompt_tokens: number; completion_tokens: number };
  readonly cost_usd?: number;
  readonly cost_estimated?: boolean;
  readonly text: string;
}

export interface FireworksCallLog {
  readonly provider: typeof FIREWORKS_PROVIDER;
  readonly model: string;
  readonly url: string;
  readonly task: CopyTask;
  readonly job_id: string;
  readonly started_at: string;
  readonly finished_at: string;
  readonly latency_ms: number;
  /** The auth header is a placeholder; the body is what was sent. */
  readonly request: { method: "POST"; headers: Record<string, string>; body: unknown };
  readonly response: { status: number; body: unknown } | null;
  readonly error: string | null;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Reads one User-scope variable from HKCU\Environment. Null when it is absent or reg fails. The value is returned, never printed. */
export function readWindowsUserEnv(name: string): string | null {
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    return parseRegQuery(out, name);
  } catch {
    return null;
  }
}

/** The value of `name` in `reg query` output (`    NAME    REG_SZ    value`), or null. */
export function parseRegQuery(out: string, name: string): string | null {
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line);
    if (m && m[1]!.toLowerCase() === name.toLowerCase()) return m[2]!.trim() || null;
  }
  return null;
}

export interface KeyLookup {
  readonly platform?: string;
  readonly readUserEnv?: (name: string) => string | null;
}

/** The key and where it came from, or null. The process env wins; the Windows User scope is the fallback. */
export function resolveFireworksKey(env: Env, lookup: KeyLookup = {}): { key: string; source: "process_env" | "user_env" } | null {
  const own = (env[FIREWORKS_KEY_ENV] ?? "").trim();
  if (own) return { key: own, source: "process_env" };
  if ((lookup.platform ?? process.platform) !== "win32") return null;
  const user = ((lookup.readUserEnv ?? readWindowsUserEnv)(FIREWORKS_KEY_ENV) ?? "").trim();
  return user ? { key: user, source: "user_env" } : null;
}

/** The default ledger: %LOCALAPPDATA%\ProofShot\fireworks-ledger.json, outside the repo, beside the Replicate one. */
export function defaultFireworksLedgerPath(env: Env): string | null {
  const base = (env.LOCALAPPDATA ?? "").trim();
  return base ? join(base, "ProofShot", "fireworks-ledger.json") : null;
}

export function fireworksCostUsd(promptTokens: number, completionTokens: number): number {
  const usd = (promptTokens * FIREWORKS_PRICE_PER_MTOK.input + completionTokens * FIREWORKS_PRICE_PER_MTOK.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** A ceiling for one call before it is made: about 3 characters a token for the prompt, plus every output token allowed. */
export function estimateCallUsd(body: string, maxTokens: number): number {
  return fireworksCostUsd(Math.ceil(body.length / 3), maxTokens);
}

/** The facts from a parsed receipt and the seller's note. Bounding boxes, scores and notes from the verifier are left out. */
export function copyFacts(jobId: string, entries: readonly ReceiptEntry[]): CopyFacts {
  const head = entries.at(-1)?.hash ?? "";
  const job = entries.find((e) => e.kind === "job")?.payload as { garment_note?: string } | undefined;
  const gates = entries.filter((e) => e.kind === "gate");
  const gate = gates.at(-1)?.payload as { decision?: string; reasons?: readonly unknown[] } | undefined;
  const verifier = entries.filter((e) => e.kind === "verifier").at(-1)?.payload as { findings?: readonly { attribute?: unknown; verdict?: unknown }[] } | undefined;
  return {
    job_id: jobId,
    receipt_head: head,
    decision: typeof gate?.decision === "string" ? gate.decision : null,
    reasons: (gate?.reasons ?? []).map(reasonText).filter((r) => r !== ""),
    findings: (verifier?.findings ?? [])
      .filter((f) => typeof f.attribute === "string" && typeof f.verdict === "string")
      .map((f) => ({ attribute: f.attribute as string, verdict: f.verdict as string })),
    claims: noteClaims(job?.garment_note ?? ""),
  };
}

function reasonText(r: unknown): string {
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    for (const k of ["message", "reason", "text", "code"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return "";
}

/** `Field: value` claims from the job's garment note, minus empty and "not recorded" values. */
export function noteClaims(note: string): { field: string; value: string }[] {
  // The job entry prefixes the note with the garment folder id ("kurta-02: Type: ...").
  const body = note.replace(/^[a-z0-9][a-z0-9-]*:\s+/, "");
  const out: { field: string; value: string }[] = [];
  for (const part of body.split(/;\s*(?=[A-Z][^:;]*:)/)) {
    const i = part.indexOf(":");
    if (i < 1) continue;
    const field = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!value || /^not recorded$/i.test(value)) continue;
    out.push({ field, value });
  }
  return out;
}

export const COPY_SYSTEM_PROMPT =
  "You write short, plain English for an Indian clothing seller. Use only the facts given. " +
  "Do not add colours, fabrics, sizes, prices, care advice or any claim that is not in the facts. " +
  "Do not change or soften the gate decision. No markdown, no emoji, no headings.";

/** The two messages for one task. Only the facts are sent: no image, no hash other than the receipt head. */
export function copyMessages(task: CopyTask, f: CopyFacts): ChatMessage[] {
  const claims = f.claims.map((c) => `- ${c.field}: ${c.value}`).join("\n") || "- none recorded";
  if (task === "listing_copy") {
    return [
      { role: "system", content: COPY_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Write a product listing of at most 60 words from the seller's claims below. Where a claim says "as in the photos", say nothing about that detail.\n\nSeller's claims:\n${claims}`,
      },
    ];
  }
  const findings = f.findings.map((x) => `- ${x.attribute}: ${x.verdict}`).join("\n") || "- none recorded";
  const reasons = f.reasons.map((r) => `- ${r}`).join("\n") || "- none";
  return [
    { role: "system", content: COPY_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Explain this check result to the seller in at most 70 words. State the decision word exactly as given (RELEASE, REVIEW or REFUSE) and what it means: RELEASE = the image can be published, REVIEW = a person must look first, REFUSE = the image must not be published.\n\n` +
        `Decision: ${f.decision ?? "none recorded"}\nReasons:\n${reasons}\nVerifier findings (attribute: verdict):\n${findings}\nSeller's claims:\n${claims}`,
    },
  ];
}

/** The text used when no model call is made: the facts, word for word. */
export function templateText(task: CopyTask, f: CopyFacts): string {
  if (task === "listing_copy") {
    const parts = f.claims.filter((c) => !/as in the photos/i.test(c.value) && !/must not change/i.test(c.field)).map((c) => `${c.field}: ${c.value}.`);
    return parts.join(" ") || "No seller claims recorded.";
  }
  const meaning: Record<string, string> = {
    RELEASE: "the image can be published",
    REVIEW: "a person must look before it is published",
    REFUSE: "the image must not be published",
  };
  const d = f.decision ?? "none recorded";
  const why = f.reasons.length ? ` Reasons: ${f.reasons.join("; ")}.` : "";
  return `Decision: ${d}${meaning[d] ? `, ${meaning[d]}` : ""}.${why}`;
}

export interface FireworksCopyOptions {
  readonly env: Env;
  /** Null means no network: every task falls back to the template. */
  readonly fetch: FireworksFetch | null;
  readonly ledger: Ledger | null;
  readonly lookup?: KeyLookup;
  readonly onCall?: (log: FireworksCallLog) => void;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export function fireworksLedger(env: Env): Ledger | null {
  const path = defaultFireworksLedgerPath(env);
  return path ? fileLedger(path) : null;
}

/** One text for one task, by Llama on Fireworks when it can run, by the template otherwise. */
export async function writeCopy(task: CopyTask, facts: CopyFacts, opts: FireworksCopyOptions): Promise<CopyRecord> {
  const base = { job_id: facts.job_id, task, receipt_head: facts.receipt_head };
  const fallback = (reason: CopyFallbackReason): CopyRecord => ({
    ...base,
    provider: TEMPLATE_PROVIDER,
    model: "none",
    generated: false,
    fallback_reason: reason,
    text: templateText(task, facts),
  });
  const found = resolveFireworksKey(opts.env, opts.lookup);
  if (!found || !opts.fetch) return fallback("no_api_token");
  const model = (opts.env.FIREWORKS_MODEL ?? "").trim() || FIREWORKS_MODEL;
  const body = JSON.stringify({ model, messages: copyMessages(task, facts), max_tokens: FIREWORKS_MAX_TOKENS, temperature: 0 });
  let spent: number;
  try {
    if (!opts.ledger) return fallback("spend_cap");
    spent = opts.ledger.read().reduce((s, e) => s + e.cost_usd, 0);
  } catch {
    return fallback("spend_cap");
  }
  if (spent + estimateCallUsd(body, FIREWORKS_MAX_TOKENS) > FIREWORKS_SPEND_CAP_USD) return fallback("spend_cap");

  const now = opts.now ?? Date.now;
  const started = now();
  let status = 0;
  let parsed: unknown = null;
  let error: string | null = null;
  try {
    const res = await opts.fetch(FIREWORKS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${found.key}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? FIREWORKS_TIMEOUT_MS),
    });
    status = res.status;
    const raw = await res.text();
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { unparsed_bytes: raw.length };
    }
    if (status !== 200) error = `HTTP ${status}`;
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : "request failed";
  }
  const finished = now();
  opts.onCall?.({
    provider: FIREWORKS_PROVIDER,
    model,
    url: FIREWORKS_URL,
    task,
    job_id: facts.job_id,
    started_at: new Date(started).toISOString(),
    finished_at: new Date(finished).toISOString(),
    latency_ms: finished - started,
    request: { method: "POST", headers: { Authorization: `Bearer [${FIREWORKS_KEY_ENV}]`, "Content-Type": "application/json" }, body: JSON.parse(body) },
    response: status ? { status, body: parsed } : null,
    error,
  });

  const out = parsed as { model?: unknown; choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null;
  const text = typeof out?.choices?.[0]?.message?.content === "string" ? (out.choices[0].message.content as string).trim() : "";
  const pt = typeof out?.usage?.prompt_tokens === "number" ? out.usage.prompt_tokens : null;
  const ct = typeof out?.usage?.completion_tokens === "number" ? out.usage.completion_tokens : null;
  // A call that reached the server is paid for even when its answer is unusable.
  const cost = pt !== null && ct !== null ? fireworksCostUsd(pt, ct) : status ? estimateCallUsd(body, FIREWORKS_MAX_TOKENS) : 0;
  if (cost > 0) opts.ledger.append({ at: new Date(finished).toISOString(), prediction_id: `fireworks:${facts.job_id}:${task}`, cost_usd: cost, estimated: true });
  if (error || !text) return fallback("fireworks_failed");
  return {
    ...base,
    provider: FIREWORKS_PROVIDER,
    model,
    ...(typeof out?.model === "string" ? { response_model: out.model } : {}),
    generated: true,
    key_source: found.source,
    request_sha256: sha256Hex(new TextEncoder().encode(body)),
    ...(pt !== null && ct !== null ? { usage: { prompt_tokens: pt, completion_tokens: ct } } : {}),
    cost_usd: cost,
    cost_estimated: true,
    text,
  };
}
