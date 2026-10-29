// MS2 (Grok 29 Oct 10:50 IST on proofshot #23): the garment check by Muse
// Spark on the Meta Model API (api.meta.ai, MODEL_API_KEY), so it draws on the
// Meta credit and not on Baseten. Same instructions, schema, image parts and
// JSON extraction as the Baseten verifier (src/verifier.ts); only the wire
// format differs: the Responses API (POST /v1/responses, `instructions` +
// `input` with input_text / input_image parts, `max_output_tokens`), as the
// SAM 3.1 transport already uses on the same host (src/sam-meta.ts).
//
// The model id is the exact one GET /v1/models lists (npm run models:meta, 29
// Oct: muse-spark-1.1, 1.2, 1.3 and their -contributor ids). The default is
// muse-spark-1.3. A Muse Image id is refused (SPEC §8), and so is a
// -contributor id: Meta may train on what is sent to that tier, and these are
// a seller's photos. An answer in any shape other than a Responses-API output
// text throws (a refusal, never a pass), after the redacted log is written.

import { readWindowsUserEnv } from "./fireworks-copy.ts";
import type { SourceImage, Verifier, VerifierAttempt, VerifierUsage } from "./pipeline.ts";
import { refuseMuseImage } from "./render.ts";
import { META_MODEL_API_URL, joinOutputText } from "./sam-meta.ts";
import { VerifierProtocolError } from "./schema.ts";
import {
  VERIFIER_MAX_TOKENS, VERIFIER_RETRY_MAX_TOKENS, VERIFIER_RETRY_TIMEOUT_MS, VERIFIER_TIMEOUT_MS, VerifierTransportError, VerifierTruncatedError,
  extractJsonObject, imageSize, verifierMessages,
} from "./verifier.ts";
import type { ContentPart, VerifierCallLog, VerifierFetch } from "./verifier.ts";
import { sha256Hex } from "./util.ts";

export const META_VERIFIER_PROVIDER = "meta";
export const META_VERIFIER_MODEL = "muse-spark-1.3";
export const META_VERIFIER_ENV = "MODEL_VERIFIER_META";
export const META_KEY_ENV = "MODEL_API_KEY";
/** What the logs show instead of the key. (ms2-kurta-01, the first MS2 job, was logged with Baseten's placeholder name by mistake; no key was in it.) */
export const META_KEY_PLACEHOLDER = `[${META_KEY_ENV}]`;

type Env = Readonly<Record<string, string | undefined>>;

export class MetaVerifierConfigError extends Error {
  override name = "MetaVerifierConfigError";
}

/**
 * A key from the process env, or on Windows from the User env scope when the
 * process did not inherit it. The value goes back to the caller and nowhere else.
 */
export function resolveUserEnvKey(
  env: Env,
  name: string,
  lookup: { platform?: string; readUserEnv?: (name: string) => string | null } = {},
): { key: string; source: "process_env" | "user_env" } | null {
  const own = (env[name] ?? "").trim();
  if (own) return { key: own, source: "process_env" };
  if ((lookup.platform ?? process.platform) !== "win32") return null;
  const user = ((lookup.readUserEnv ?? readWindowsUserEnv)(name) ?? "").trim();
  return user ? { key: user, source: "user_env" } : null;
}

/** The model id to send: MODEL_VERIFIER_META or muse-spark-1.3. Muse Image and -contributor ids are refused. */
export function metaVerifierModel(env: Env): string {
  const model = (env[META_VERIFIER_ENV] ?? "").trim() || META_VERIFIER_MODEL;
  refuseMuseImage(model);
  if (/-contributor$/i.test(model)) throw new MetaVerifierConfigError(`${model} is the contributor tier: Meta may train on what is sent to it, so seller photos are not sent there`);
  return model;
}

type ResponsesPart = { readonly type: "input_text"; readonly text: string } | { readonly type: "input_image"; readonly image_url: string };

/** The Baseten request's parts in Responses-API form: the same texts and images in the same order. */
export function responsesInput(parts: readonly ContentPart[]): ResponsesPart[] {
  return parts.map((p) => (p.type === "text" ? { type: "input_text", text: p.text } : { type: "input_image", image_url: p.image_url.url }));
}

/** The request body for one verification, as an object (images included). */
export function metaVerifierBody(model: string, req: { sources: readonly SourceImage[]; render: Uint8Array }, maxTokens: number): Record<string, unknown> {
  const [system, user] = verifierMessages(req);
  return {
    model,
    instructions: system!.content,
    input: [{ role: "user", content: responsesInput((user as { content: readonly ContentPart[] }).content) }],
    max_output_tokens: maxTokens,
    temperature: 0,
    stream: false,
  };
}

function redact(body: Record<string, unknown>): Record<string, unknown> {
  const input = (body.input as { role: string; content: ResponsesPart[] }[]).map((m) => ({
    ...m,
    content: m.content.map((p) => {
      if (p.type !== "input_image") return p;
      const match = /^data:([^;]+);base64,(.*)$/s.exec(p.image_url);
      if (!match) return { type: "input_image", image_url: "[not a data URL, left out of the log]" };
      const bytes = Buffer.from(match[2]!, "base64");
      return { type: "input_image", image_url: `data:${match[1]};base64,[${bytes.length} bytes, sha256 ${sha256Hex(new Uint8Array(bytes))}, left out of the log]` };
    }),
  }));
  return { ...body, input };
}

function parseOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : `Error: ${String(err)}`;
}

/** True when a Responses-API answer stopped at max_output_tokens. */
function truncated(body: unknown): boolean {
  const o = body as { status?: unknown; incomplete_details?: { reason?: unknown } } | null;
  return o?.status === "incomplete" && o.incomplete_details?.reason === "max_output_tokens";
}

function usageOf(body: unknown, images: VerifierUsage["images"]): VerifierUsage {
  const u = (body as { usage?: Record<string, unknown> } | null)?.usage;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  if (!u) return { images };
  const cached = n((u.input_tokens_details as { cached_tokens?: unknown } | undefined)?.cached_tokens);
  return {
    ...(n(u.input_tokens) !== undefined ? { prompt_tokens: n(u.input_tokens) } : {}),
    ...(n(u.output_tokens) !== undefined ? { completion_tokens: n(u.output_tokens) } : {}),
    ...(cached !== undefined ? { cached_tokens: cached } : {}),
    images,
  };
}

function attemptOf(body: unknown, maxTokens: number): VerifierAttempt {
  const u = (body as { usage?: { output_tokens?: unknown; output_tokens_details?: { reasoning_tokens?: unknown } } } | null)?.usage;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    max_tokens: maxTokens,
    finish_reason: truncated(body) ? "length" : typeof (body as { status?: unknown })?.status === "string" ? ((body as { status: string }).status) : null,
    ...(n(u?.output_tokens) !== undefined ? { completion_tokens: n(u?.output_tokens) } : {}),
    ...(n(u?.output_tokens_details?.reasoning_tokens) !== undefined ? { reasoning_tokens: n(u?.output_tokens_details?.reasoning_tokens) } : {}),
  };
}

export interface MetaVerifierOptions {
  readonly key: string;
  readonly env: Env;
  readonly fetch: VerifierFetch;
  readonly onCall?: (log: VerifierCallLog) => void;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly retryTimeoutMs?: number;
}

/**
 * The Verifier on api.meta.ai. Per render: one request; a network error, a
 * non-2xx status, a body that is not JSON, or no output text throws, after
 * the redacted log went to `onCall`. An answer cut off at max_output_tokens is
 * never read: it is asked once more at the retry limit, and a second cut-off
 * throws VerifierTruncatedError. A request that times out is sent once more
 * with the longer timeout. A request that fails before any answer (a network
 * TypeError such as "fetch failed", a suspected network failure: NR3
 * shirt-plaid, 29 Oct) is sent once more on a new attempt; nothing
 * else is retried, a spend-cap refusal included. Every attempt is listed in the usage when more than
 * one was sent.
 */
export function metaVerifier(opts: MetaVerifierOptions): Verifier {
  const key = opts.key.trim();
  if (key === "") throw new MetaVerifierConfigError(`${META_KEY_ENV} is not set`);
  const model = metaVerifierModel(opts.env);
  const now = opts.now ?? Date.now;
  return {
    identity: { provider: META_VERIFIER_PROVIDER, model, base: "https://api.meta.ai/v1" },
    verify: async (req) => {
      const images = [...req.sources.map((s) => s.bytes), req.render].map((b) => ({ bytes: b.length, ...(imageSize(b) ?? { width: 0, height: 0 }) }));
      const attempts: VerifierAttempt[] = [];
      let timeoutRetried = false;
      let networkRetried = false;
      const send = async (limit: number): Promise<{ body: unknown; text: string }> => {
        for (;;) {
          const timeout = timeoutRetried ? (opts.retryTimeoutMs ?? VERIFIER_RETRY_TIMEOUT_MS) : (opts.timeoutMs ?? VERIFIER_TIMEOUT_MS);
          const payload = metaVerifierBody(model, req, limit);
          const started = now();
          let response: VerifierCallLog["response"] = null;
          let raw = "";
          let error: string | null = null;
          let timedOut = false;
          let network = false;
          try {
            const res = await opts.fetch(META_MODEL_API_URL, {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(timeout),
            });
            raw = await res.text();
            response = { status: res.status, body: parseOrText(raw) };
            if (res.status < 200 || res.status > 299) error = `VerifierTransportError: the Meta Model API answered HTTP ${res.status}`;
          } catch (e) {
            error = errorText(e);
            timedOut = e instanceof Error && e.name === "TimeoutError";
            network = !timedOut && e instanceof TypeError;
          }
          const finished = now();
          const log = {
            provider: META_VERIFIER_PROVIDER,
            model,
            url: META_MODEL_API_URL,
            render_id: req.renderId,
            started_at: new Date(started).toISOString(),
            finished_at: new Date(finished).toISOString(),
            latency_ms: finished - started,
            request: { method: "POST" as const, headers: { "content-type": "application/json", authorization: `Bearer ${META_KEY_PLACEHOLDER}` }, body: redact(payload) },
            response,
            error,
            note: "the auth header is a placeholder; every image data URL is replaced by its byte count and sha256; the key's value is replaced wherever it appears",
          };
          const json = JSON.stringify(log);
          opts.onCall?.((json.includes(key) ? JSON.parse(json.split(key).join(META_KEY_PLACEHOLDER)) : log) as VerifierCallLog);
          if (error) {
            attempts.push({ max_tokens: limit, finish_reason: null, ...(timedOut || timeoutRetried ? { timeout_ms: timeout } : {}), error });
            if (timedOut && !timeoutRetried) {
              timeoutRetried = true;
              continue;
            }
            if (network && !networkRetried) {
              networkRetried = true;
              continue;
            }
            const err = new VerifierTransportError(error.replace(/^VerifierTransportError: /, ""), timedOut);
            if (attempts.length > 1) Object.assign(err, { usage: { images, attempts: [...attempts] } });
            throw err;
          }
          if (typeof response!.body !== "object" || response!.body === null) throw new VerifierProtocolError("verifier output: the Meta Model API body is not JSON");
          attempts.push({ ...attemptOf(response!.body, limit), ...(timeoutRetried ? { timeout_ms: timeout } : {}) });
          return { body: response!.body, text: raw };
        }
      };
      const usageAfter = (body: unknown): VerifierUsage => (attempts.length > 1 ? { ...usageOf(body, images), attempts: [...attempts] } : usageOf(body, images));

      let out = await send(VERIFIER_MAX_TOKENS);
      if (truncated(out.body)) {
        out = await send(VERIFIER_RETRY_MAX_TOKENS);
        if (truncated(out.body)) throw new VerifierTruncatedError(`the answer was cut off at max_output_tokens ${VERIFIER_MAX_TOKENS} and again at ${VERIFIER_RETRY_MAX_TOKENS}`, usageAfter(out.body));
      }
      let text: string;
      try {
        text = joinOutputText(out.text, req.renderId);
      } catch (e) {
        throw new VerifierProtocolError(`verifier output: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (text.trim() === "") throw new VerifierProtocolError("verifier output: no output text");
      return { raw: extractJsonObject(text), usage: usageAfter(out.body) };
    },
  };
}
