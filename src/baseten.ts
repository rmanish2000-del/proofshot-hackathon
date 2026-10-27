// One call to Muse Spark Open on Baseten (proofshot #16), written up as a call
// log that can be committed: request without the key, response, timestamps,
// model id. The key is read only from BASETEN_API_KEY and never appears in the
// log, even if the server echoes it back.

import { refuseMuseImage } from "./render.ts";

/** Baseten's OpenAI-compatible endpoint. */
export const BASETEN_BASE = "https://inference.baseten.co/v1";
/** Muse Spark Open's model id on Baseten (proofshot #16). */
export const BASETEN_MODEL = "meta-models/muse-spark-open-1026";
/** Stands in for the key wherever the log shows the auth header. */
export const KEY_PLACEHOLDER = "[BASETEN_API_KEY]";

export class BasetenConfigError extends Error {
  override name = "BasetenConfigError";
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** The part of fetch this module uses, so tests can inject one that never touches the network. */
export type Fetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface CallLog {
  provider: "baseten";
  model: string;
  url: string;
  started_at: string;
  finished_at: string;
  latency_ms: number;
  request: { method: "POST"; headers: Record<string, string>; body: unknown };
  /** null when no response arrived (network error or timeout). */
  response: { status: number; body: unknown } | null;
  /** `<name>: <message>` when the call threw or the status was not 2xx; null otherwise. */
  error: string | null;
}

/**
 * Sends one chat completion and returns its log. A missing key, or a model id
 * that names Muse Image, throws before any request. A network error, a timeout
 * or a non-2xx status does not throw: it is in the log's `error`.
 */
export async function basetenCall(opts: {
  env: Readonly<Record<string, string | undefined>>;
  fetch: Fetch;
  messages: readonly ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  now?: () => number;
}): Promise<CallLog> {
  const key = (opts.env.BASETEN_API_KEY ?? "").trim();
  if (!key) throw new BasetenConfigError("BASETEN_API_KEY is not set");
  const model = (opts.env.MODEL_VERIFIER ?? "").trim() || BASETEN_MODEL;
  refuseMuseImage(model);
  const now = opts.now ?? Date.now;
  const url = `${BASETEN_BASE}/chat/completions`;
  const body = { model, messages: opts.messages, max_tokens: opts.maxTokens ?? 64 };

  const started = now();
  let response: CallLog["response"] = null;
  let error: string | null = null;
  try {
    const res = await opts.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
    const text = await res.text();
    response = { status: res.status, body: parseOrText(text) };
    if (res.status < 200 || res.status > 299) error = `HttpError: status ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : `Error: ${String(e)}`;
  }
  const finished = now();

  const log: CallLog = {
    provider: "baseten",
    model,
    url,
    started_at: new Date(started).toISOString(),
    finished_at: new Date(finished).toISOString(),
    latency_ms: finished - started,
    request: { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY_PLACEHOLDER}` }, body },
    response,
    error,
  };
  return scrub(log, key);
}

function parseOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Replaces every occurrence of the key anywhere in the log with the placeholder. */
function scrub(log: CallLog, key: string): CallLog {
  const text = JSON.stringify(log);
  return text.includes(key) ? (JSON.parse(text.split(key).join(KEY_PLACEHOLDER)) as CallLog) : log;
}
