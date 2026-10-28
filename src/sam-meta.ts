// Meta Model API transport for SAM 3.1 (#18, SPEC §10): the HTTP side of the
// segmentation adapter in src/sam.ts, as Grok specified on 28 Oct 08:15.
//
// One request per image: POST /v1/responses in the Responses-API shape, model
// `sam-3.1`, one noun phrase as input_text, the image as an input_image data
// URL, `stream: true`, metadata {mask_encoding: "one_bit", include_confidence:
// "true"}. The answer is a server-sent event stream; the text of every
// `response.output_text.delta` event is joined, and the masks are `<|mask;...|>`
// tokens inside that text. Turning those tokens into segments is the job of
// @meta-sam/parser (0.1.0, the glue is src/sam-parser.ts); the parser is
// injected so this module builds the request, reads the stream and fails
// closed on everything it does not understand, with zero network in tests.
// No mask token at all is "no match", an empty segment list, not an error.
//
// The key comes from MODEL_API_KEY through an injected env; it goes into the
// Authorization header and nowhere else, never into an error or a log. The
// fetch is injected too, so a test runs zero network calls.

import type { SourceImage } from "./pipeline.ts";
import { imageExt } from "./render.ts";
import { SegmentConfigError, SegmentProtocolError } from "./sam.ts";
import type { SamTransport } from "./sam.ts";

export const META_MODEL_API_URL = "https://api.meta.ai/v1/responses";
/** The model named in the request body. */
export const META_SAM_REQUEST_MODEL = "sam-3.1";
/** The model id the receipt records for this transport: MODEL_SEGMENT must say exactly this. */
export const META_SAM_MODEL_ID = "meta/sam-3.1 (api.meta.ai)";
export const MASK_TOKEN_START = "<|mask";

export class SegmentTransportError extends Error {
  override name = "SegmentTransportError";
}

/** The part of fetch this transport uses. */
export type FetchLike = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Turns the joined output text, mask tokens included, into what
 * src/sam.ts `parseSegments` accepts: `{ segments: [{ label, box, score, mask }] }`,
 * or a promise of it. @meta-sam/parser does the decoding; the glue that calls
 * it (src/sam-parser.ts `metaSamParser`) is passed here, with the prompt so
 * the segments can carry it as their label.
 */
export type MaskParser = (outputText: string, image: SourceImage, prompt: string) => unknown;

export interface MetaSamTransportOptions {
  readonly fetch: FetchLike;
  /** Read at request time, so a test can leave it blank. */
  readonly apiKey: () => string;
  readonly parse: MaskParser;
  readonly url?: string;
}

/** The request body for one image, as JSON. Exported so a test can check it without a fetch. */
export function metaSamRequestBody(prompt: string, image: SourceImage): string {
  const ext = imageExt(image.bytes);
  if (!ext) throw new SegmentConfigError(`${image.name} is not a JPEG or PNG, so it cannot be sent as an input_image`);
  const mime = ext === "png" ? "image/png" : "image/jpeg";
  return JSON.stringify({
    model: META_SAM_REQUEST_MODEL,
    stream: true,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: `data:${mime};base64,${Buffer.from(image.bytes).toString("base64")}` },
        ],
      },
    ],
    metadata: { mask_encoding: "one_bit", include_confidence: "true" },
  });
}

/**
 * The output text of a Responses-API answer: the `delta` of every
 * `response.output_text.delta` event of an SSE stream, joined in order. A
 * `response.failed` or `error` event throws with the server's message. A body
 * that is one JSON object (no stream) gives its `output_text`, or the
 * `output_text` content parts of its `output`. Anything else throws.
 */
export function joinOutputText(body: string, image: string): string {
  const fail = (reason: string): never => {
    throw new SegmentProtocolError(`Meta Model API answer for ${image}: ${reason}`);
  };
  const trimmed = body.trim();
  if (trimmed === "") return fail("empty body");
  if (trimmed.startsWith("{")) {
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return fail("body is neither an event stream nor JSON");
    }
    return outputTextOf(obj) ?? fail("JSON body has no output text");
  }
  let text = "";
  let deltas = 0;
  let completed: unknown;
  for (const [i, line] of body.split(/\r?\n/).entries()) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "" || data === "[DONE]") continue;
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return fail(`event on line ${i + 1} is not JSON`);
    }
    if (typeof event !== "object" || event === null) return fail(`event on line ${i + 1} is not an object`);
    const e = event as { type?: unknown; delta?: unknown; response?: unknown; error?: unknown };
    if (e.type === "response.output_text.delta") {
      if (typeof e.delta !== "string") return fail(`delta event on line ${i + 1} has no text`);
      text += e.delta;
      deltas++;
    } else if (e.type === "response.failed" || e.type === "error") {
      return fail(`the server reported a failure: ${errorMessage(e)}`);
    } else if (e.type === "response.completed") {
      completed = e.response;
    }
  }
  if (deltas > 0) return text;
  // No delta at all: the completed response may carry the text whole.
  const whole = completed === undefined ? null : outputTextOf(completed);
  if (whole !== null) return whole;
  return fail(completed === undefined ? "no output_text delta and no completed response" : "completed response has no output text");
}

function outputTextOf(obj: unknown): string | null {
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as { output_text?: unknown; output?: unknown };
  if (typeof o.output_text === "string") return o.output_text;
  if (!Array.isArray(o.output)) return null;
  const parts: string[] = [];
  for (const item of o.output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as { type?: unknown; text?: unknown };
      if (p?.type === "output_text" && typeof p.text === "string") parts.push(p.text);
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

function errorMessage(e: { error?: unknown; response?: unknown }): string {
  const err = (e.error ?? (e.response as { error?: unknown } | undefined)?.error) as { message?: unknown; code?: unknown } | undefined;
  if (err && typeof err.message === "string") return err.message.slice(0, 200);
  if (err && typeof err.code === "string") return err.code;
  return "no message";
}

/**
 * The transport. It refuses, before any request, a model id other than
 * META_SAM_MODEL_ID (the receipt would otherwise claim one thing while the
 * request names another), a blank key, and an image that is not a JPEG or PNG.
 * An HTTP status other than 2xx is a SegmentTransportError naming the status
 * only. The joined text with no mask token is `{ segments: [] }`; with one, it
 * goes to the injected parser, whose answer src/sam.ts checks.
 */
export function metaSamTransport(opts: MetaSamTransportOptions): SamTransport {
  const url = opts.url ?? META_MODEL_API_URL;
  return async ({ model, prompt, image }) => {
    if (model !== META_SAM_MODEL_ID) {
      throw new SegmentConfigError(`this transport sends ${META_SAM_REQUEST_MODEL} to api.meta.ai and records it as ${JSON.stringify(META_SAM_MODEL_ID)}; MODEL_SEGMENT says ${JSON.stringify(model)}`);
    }
    const key = opts.apiKey();
    if (key === "") throw new SegmentConfigError("MODEL_API_KEY is not set");
    const body = metaSamRequestBody(prompt, image);
    const res = await opts.fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "text/event-stream" },
      body,
    });
    const answer = await res.text();
    if (!res.ok) throw new SegmentTransportError(`Meta Model API answered HTTP ${res.status} for ${image.name}`);
    const text = joinOutputText(answer, image.name);
    if (!text.includes(MASK_TOKEN_START)) return { segments: [] };
    return opts.parse(text, image, prompt);
  };
}

/** The transport with the key read from MODEL_API_KEY at request time. The value is never returned or logged. */
export function metaSamTransportFromEnv(env: Readonly<Record<string, string | undefined>>, fetch: FetchLike, parse: MaskParser): SamTransport {
  return metaSamTransport({ fetch, parse, apiKey: () => (env.MODEL_API_KEY ?? "").trim() });
}
