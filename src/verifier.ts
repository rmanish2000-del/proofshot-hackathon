// The live verifier (P6, SPEC §4): Muse Spark Open on Baseten looks at the
// seller's photos and the image to be published and answers with findings.
//
// One chat completion per render, as Grok specified on 28 Oct 09:00: a system
// message that is the §4 schema verbatim plus the rule "return only JSON", then
// one user message whose content parts name each image ("source 1: <name>",
// ... "render") before its data URL, with the instruction last. temperature 0,
// max_tokens 4096 (the model reasons before it answers), no response_format
// (Muse Spark Open on Baseten has no JSON mode). The answer's message content is
// returned raw for src/schema.ts parseFindings, after one defensive step: code
// fences and prose around the first JSON object are dropped. Anything that is
// still not the schema throws there, and a thrown verifier is a refusal, never
// a pass (SPEC §4); nothing here turns a bad answer into findings.
//
// The key comes only from BASETEN_API_KEY through the injected env and goes into
// the Authorization header. The call log handed to `onCall` carries the request
// with every image replaced by its byte count and hash, the response, and the
// key's value replaced wherever it appears. The fetch is injected, so a test
// runs zero network calls. No image is resized: this build has no JPEG decoder,
// so the photos go as they are (Baseten allows 10 MB per image, 100 MiB a body).

import { BASETEN_BASE, BASETEN_MODEL, BasetenConfigError, KEY_PLACEHOLDER } from "./baseten.ts";
import type { SourceImage, Verifier, VerifierUsage } from "./pipeline.ts";
import { imageExt, refuseMuseImage } from "./render.ts";
import { FINDINGS_SCHEMA, VerifierProtocolError } from "./schema.ts";
import { sha256Hex } from "./util.ts";

export const VERIFIER_PROVIDER = "baseten";
/**
 * 4096, not the 1500 first tried: on the first live job
 * (evidence/verifier-2026-10-28T03-55-00-289Z.json) the model spent 1338
 * reasoning tokens before the answer and the 9 findings were cut off at 1500
 * (finish_reason "length"), which the gate refused as not verified.
 */
export const VERIFIER_MAX_TOKENS = 4096;
export const VERIFIER_TIMEOUT_MS = 180_000;
/** Baseten's per-image limit; a larger image is refused before the request. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Baseten's per-request image limit. */
export const MAX_IMAGES = 8;

export const VERIFIER_INSTRUCTIONS =
  "You check garment fidelity. You see the seller's photos of one garment and one image to be published. " +
  "Compare only the garment: colour, pattern, print, embroidery, neckline, sleeves, length, buttons, visible text. " +
  "Ignore the model, pose, background and photo quality. " +
  "Reply with exactly one JSON object that matches this schema and nothing else. " +
  "A bbox is [x, y, w, h], each 0..1 of the image, or null when the attribute has no place in the image. " +
  "If the garment is not clearly visible in an image, say so in the finding's note and give the verdict \"uncertain\" rather than guessing.";

export const VERIFIER_FINAL_INSTRUCTION =
  "Compare the garment in the render (the last image) with the garment in the seller's photos. One finding per attribute: " +
  "color, print_pattern, logo_text, collar, sleeve_length, hem, pocket_count, buttons, fabric_texture. " +
  "Return only JSON matching the schema, no prose.";

export class VerifierTransportError extends Error {
  override name = "VerifierTransportError";
}

export type ContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string; readonly detail: "auto" } };

export type VerifierMessage = { readonly role: "system"; readonly content: string } | { readonly role: "user"; readonly content: readonly ContentPart[] };

/** The part of fetch this module uses. */
export type VerifierFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface VerifierCallLog {
  readonly provider: typeof VERIFIER_PROVIDER;
  readonly model: string;
  readonly url: string;
  readonly render_id: string;
  readonly started_at: string;
  readonly finished_at: string;
  readonly latency_ms: number;
  /** The request with every image data URL replaced by its byte count and sha256; the auth header is a placeholder. */
  readonly request: { method: "POST"; headers: Record<string, string>; body: unknown };
  readonly response: { status: number; body: unknown } | null;
  readonly error: string | null;
  readonly note: string;
}

export interface BasetenVerifierOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: VerifierFetch;
  /** Receives the redacted log of every call, before the result or error is returned. */
  readonly onCall?: (log: VerifierCallLog) => void;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

/** The system message: the instructions, then the §4 schema verbatim, then the one-JSON rule. */
export function verifierSystemPrompt(): string {
  return `${VERIFIER_INSTRUCTIONS}\n\nSchema:\n${JSON.stringify(FINDINGS_SCHEMA, null, 2)}\n\nReturn only JSON matching this schema, no prose.`;
}

function dataUrl(image: SourceImage, what: string): string {
  const ext = imageExt(image.bytes);
  if (!ext) throw new VerifierTransportError(`${what} is not a JPEG or PNG, so it cannot be sent as an image`);
  if (image.bytes.length > MAX_IMAGE_BYTES) throw new VerifierTransportError(`${what} is ${image.bytes.length} bytes, over the ${MAX_IMAGE_BYTES} byte limit per image`);
  return `data:${ext === "png" ? "image/png" : "image/jpeg"};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

/** The two messages of one verification request, images included. */
export function verifierMessages(req: { sources: readonly SourceImage[]; render: Uint8Array }): VerifierMessage[] {
  if (req.sources.length === 0) throw new VerifierTransportError("no source photos to compare the render with");
  if (req.sources.length + 1 > MAX_IMAGES) throw new VerifierTransportError(`${req.sources.length} sources plus the render is over the ${MAX_IMAGES} image limit`);
  const parts: ContentPart[] = [];
  for (const [i, s] of req.sources.entries()) {
    parts.push({ type: "text", text: `source ${i + 1}: ${s.name} (the seller's photo of the garment)` });
    parts.push({ type: "image_url", image_url: { url: dataUrl(s, `source ${i + 1} (${s.name})`), detail: "auto" } });
  }
  parts.push({ type: "text", text: "render: the image to be published" });
  parts.push({ type: "image_url", image_url: { url: dataUrl({ name: "render", bytes: req.render }, "the render"), detail: "auto" } });
  parts.push({ type: "text", text: VERIFIER_FINAL_INSTRUCTION });
  return [
    { role: "system", content: verifierSystemPrompt() },
    { role: "user", content: parts },
  ];
}

/**
 * The model's text with code fences and surrounding prose removed: the
 * substring from the first `{` to the last `}`. Nothing inside is changed, so
 * what parseFindings checks is still what the model wrote.
 */
export function extractJsonObject(text: string): string {
  const unfenced = text.replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end < start) return text.trim();
  return unfenced.slice(start, end + 1);
}

/** Width and height from a JPEG's frame header or a PNG's IHDR; null when neither is found. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const ext = imageExt(bytes);
  if (ext === "png" && bytes.length >= 24) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (ext !== "jpg") return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let m = i + 1;
    while (bytes[m] === 0xff) m++;
    const marker = bytes[m];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return null;
    const length = (bytes[m + 1]! << 8) | bytes[m + 2]!;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (m + 8 >= bytes.length) return null;
      return { height: (bytes[m + 4]! << 8) | bytes[m + 5]!, width: (bytes[m + 6]! << 8) | bytes[m + 7]! };
    }
    i = m + 1 + length;
  }
  return null;
}

/** The request body for the log: each image data URL becomes its byte count and sha256. */
export function redactImages(messages: readonly VerifierMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "system") return m;
    return {
      role: m.role,
      content: m.content.map((p) => {
        if (p.type !== "image_url") return p;
        const match = /^data:([^;]+);base64,(.*)$/s.exec(p.image_url.url);
        if (!match) return { type: "image_url", image_url: { url: "[not a data URL, left out of the log]", detail: p.image_url.detail } };
        const bytes = Buffer.from(match[2]!, "base64");
        return { type: "image_url", image_url: { url: `data:${match[1]};base64,[${bytes.length} bytes, sha256 ${sha256Hex(new Uint8Array(bytes))}, left out of the log]`, detail: p.image_url.detail } };
      }),
    };
  });
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

/**
 * The Verifier. A blank key, or a model id naming Muse Image, is refused when
 * the verifier is built. Per render: one request; a network error, a non-2xx
 * status (reported by number only), a body that is not JSON, or no message
 * content throws, after the redacted log went to `onCall`. On success the raw
 * value is the message content with fences and prose around the JSON object
 * dropped; parseFindings decides whether it is the schema.
 */
export function basetenVerifier(opts: BasetenVerifierOptions): Verifier {
  const key = (opts.env.BASETEN_API_KEY ?? "").trim();
  if (key === "") throw new BasetenConfigError("BASETEN_API_KEY is not set");
  const model = (opts.env.MODEL_VERIFIER ?? "").trim() || BASETEN_MODEL;
  refuseMuseImage(model);
  const url = `${BASETEN_BASE}/chat/completions`;
  const now = opts.now ?? Date.now;
  const maxTokens = opts.maxTokens ?? VERIFIER_MAX_TOKENS;

  return {
    identity: { provider: VERIFIER_PROVIDER, model, base: BASETEN_BASE },
    verify: async (req) => {
      const messages = verifierMessages(req);
      const body = { model, messages, max_tokens: maxTokens, temperature: 0 };
      const started = now();
      let response: VerifierCallLog["response"] = null;
      let error: string | null = null;
      let text = "";
      try {
        const res = await opts.fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? VERIFIER_TIMEOUT_MS),
        });
        text = await res.text();
        response = { status: res.status, body: parseOrText(text) };
        if (res.status < 200 || res.status > 299) error = `VerifierTransportError: Baseten answered HTTP ${res.status}`;
      } catch (e) {
        error = errorText(e);
      }
      const finished = now();
      const images = [...req.sources.map((s) => s.bytes), req.render].map((b) => ({ bytes: b.length, ...(imageSize(b) ?? { width: 0, height: 0 }) }));

      const log: VerifierCallLog = {
        provider: VERIFIER_PROVIDER,
        model,
        url,
        render_id: req.renderId,
        started_at: new Date(started).toISOString(),
        finished_at: new Date(finished).toISOString(),
        latency_ms: finished - started,
        request: { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY_PLACEHOLDER}` }, body: { ...body, messages: redactImages(messages) } },
        response,
        error,
        note: "the auth header is a placeholder; every image data URL is replaced by its byte count and sha256; the key's value is replaced wherever it appears",
      };
      opts.onCall?.(scrub(log, key));

      if (error) throw new VerifierTransportError(error.replace(/^VerifierTransportError: /, ""));
      const content = messageContent(response!.body);
      const usage = usageOf(response!.body, images);
      return { raw: extractJsonObject(content), ...(usage ? { usage } : {}) };
    },
  };
}

/** choices[0].message.content as a non-blank string, else a VerifierProtocolError. */
function messageContent(body: unknown): string {
  const o = body as { choices?: { message?: { content?: unknown } }[] } | null;
  if (typeof body !== "object" || body === null) throw new VerifierProtocolError("verifier output: the response body is not JSON");
  const content = o?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") throw new VerifierProtocolError("verifier output: no message content");
  return content;
}

function usageOf(body: unknown, images: VerifierUsage["images"]): VerifierUsage | undefined {
  const u = (body as { usage?: Record<string, unknown> } | null)?.usage;
  if (typeof u !== "object" || u === null) return { images };
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const cached = n((u.prompt_tokens_details as { cached_tokens?: unknown } | undefined)?.cached_tokens);
  return {
    ...(n(u.prompt_tokens) !== undefined ? { prompt_tokens: n(u.prompt_tokens) } : {}),
    ...(n(u.completion_tokens) !== undefined ? { completion_tokens: n(u.completion_tokens) } : {}),
    ...(cached !== undefined ? { cached_tokens: cached } : {}),
    images,
  };
}

/** Replaces every occurrence of the key anywhere in the log with the placeholder. */
function scrub(log: VerifierCallLog, key: string): VerifierCallLog {
  const text = JSON.stringify(log);
  return text.includes(key) ? (JSON.parse(text.split(key).join(KEY_PLACEHOLDER)) as VerifierCallLog) : log;
}
