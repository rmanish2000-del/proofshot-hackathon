// SAM 3.1 segmentation adapter (#18, SPEC §10): the pipeline's Segmenter behind
// an injected transport.
//
// This module decides what is sent (one request per source image, with the
// model id and a text prompt) and checks what comes back, failing closed: an
// answer that is not the documented shape throws SegmentProtocolError, which
// the pipeline records as a segment_failed refusal (SPEC §3), never as "no
// garment found". The HTTP request itself is the transport's job, so nothing
// here reads a key, and a test can stand a table in for the model. The model
// id goes on the receipt as the segments entry's `segmenter`; it is the
// provider's claim of which weights ran (SPEC §6), no more.

import type { Segment, Segmenter, SourceImage } from "./pipeline.ts";
import { refuseMuseImage } from "./render.ts";

export const SAM_PROVIDER = "meta";
export const DEFAULT_SEGMENT_PROMPT = "the garment";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export class SegmentProtocolError extends Error {
  override name = "SegmentProtocolError";
}

export class SegmentConfigError extends Error {
  override name = "SegmentConfigError";
}

/** Sends one segmentation request and returns the provider's raw answer. */
export type SamTransport = (req: { model: string; prompt: string; image: SourceImage }) => Promise<unknown>;

export interface SamOptions {
  /** The provider's model id, verbatim; it is recorded on the receipt. */
  readonly model: string;
  readonly transport: SamTransport;
  readonly prompt?: string;
}

/**
 * The answer shape this adapter accepts, per image:
 * `{ segments: [{ label, box: [x, y, w, h] in 0..1, score: 0..1, mask: base64 PNG | null }] }`.
 * A missing `mask` is null. Anything else throws.
 */
export function parseSegments(raw: unknown, image: string): Segment[] {
  const fail = (reason: string): never => {
    throw new SegmentProtocolError(`segmenter output for ${image}: ${reason}`);
  };
  const value = typeof raw === "string" ? parseJson(raw, fail) : raw;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("not an object");
  const list = (value as { segments?: unknown }).segments;
  if (!Array.isArray(list)) return fail("no segments array");
  return list.map((s: unknown, i: number): Segment => {
    if (typeof s !== "object" || s === null || Array.isArray(s)) return fail(`segment ${i} is not an object`);
    const seg = s as Record<string, unknown>;
    if (typeof seg.label !== "string" || seg.label.trim() === "") return fail(`segment ${i} has no label`);
    const box = seg.box;
    if (!Array.isArray(box) || box.length !== 4 || !box.every((n) => typeof n === "number" && Number.isFinite(n))) return fail(`segment ${i} (${seg.label}) has no box of four finite numbers`);
    if (typeof seg.score !== "number" || !Number.isFinite(seg.score)) return fail(`segment ${i} (${seg.label}) has no finite score`);
    const unit = (n: number) => Math.min(1, Math.max(0, n));
    let mask: Uint8Array | null = null;
    if (seg.mask !== undefined && seg.mask !== null) {
      if (typeof seg.mask !== "string") return fail(`segment ${i} (${seg.label}) mask is not a base64 string`);
      mask = new Uint8Array(Buffer.from(seg.mask, "base64"));
      if (mask.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, k) => mask![k] !== b)) return fail(`segment ${i} (${seg.label}) mask is not a PNG`);
    }
    return {
      label: `${image}/${seg.label}`,
      box: [unit(box[0] as number), unit(box[1] as number), unit(box[2] as number), unit(box[3] as number)],
      score: unit(seg.score),
      mask,
    };
  });
}

function parseJson(text: string, fail: (reason: string) => never): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return fail("not JSON");
  }
}

/**
 * A Segmenter that asks the transport once per source image, in order, and
 * labels every segment `<image name>/<label>` so the receipt says which photo
 * each mask belongs to. The model id is checked once here; a blank one, or one
 * naming Muse Image, is refused before any request.
 */
export function samSegmenter(opts: SamOptions): Segmenter {
  const model = opts.model.trim();
  if (model === "") throw new SegmentConfigError("segmenter needs a model id");
  refuseMuseImage(model);
  const prompt = opts.prompt ?? DEFAULT_SEGMENT_PROMPT;
  return {
    identity: { provider: SAM_PROVIDER, model },
    segment: async (sources) => {
      const out: Segment[] = [];
      for (const image of sources) {
        const raw = await opts.transport({ model, prompt, image });
        out.push(...parseSegments(raw, image.name));
      }
      return out;
    },
  };
}

/**
 * The segmenter MODEL_SEGMENT names (trimmed; blank is unset). There is no
 * default: the model id on a receipt is a claim, and this build does not guess
 * it. Reads no key; the transport does the request.
 */
export function segmenterFromEnv(env: Readonly<Record<string, string | undefined>>, transport: SamTransport): Segmenter {
  const model = (env.MODEL_SEGMENT ?? "").trim();
  if (model === "") throw new SegmentConfigError("MODEL_SEGMENT is not set");
  return samSegmenter({ model, transport, ...(env.SEGMENT_PROMPT?.trim() ? { prompt: env.SEGMENT_PROMPT.trim() } : {}) });
}
