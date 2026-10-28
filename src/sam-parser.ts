// The glue around @meta-sam/parser (#18, SPEC §10): the joined output text of
// one SAM 3.1 answer in, the `{ segments: [...] }` shape src/sam.ts accepts out.
//
// @meta-sam/parser 0.1.0 (Meta, SAM License, no runtime dependencies) reads the
// `<|box;...|>` and `<|mask;...|>` tokens of a Responses-API stream. It is fed
// here as a stream of one output_text delta (the joined text src/sam-meta.ts
// produced) and a completed event, and its records are turned into segments:
// one per mask, paired with its box by object id; the box in pixels becomes
// [x, y, w, h] in 0..1 of the frame; the one-bit raster, which covers only the
// mask's bounds at its own resolution, is stretched into them (nearest
// neighbour) inside a full-frame 8-bit greyscale PNG (white where garment),
// the form the receipt hashes and the fidelity check decodes.
//
// Fails closed: a parser diagnostic of severity error, an incomplete outcome,
// a box or mask without a confidence, a frame size that cannot be read, or a
// raster that does not fit its bounds throws SegmentProtocolError, which the
// pipeline records as segment_failed, never as "no garment found". Text with
// no mask record at all is `{ segments: [] }`: no match.

import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import type { ImageSegmentationResult, SegmentationBoxRecord, SegmentationMaskRecord } from "@meta-sam/parser";

import type { SourceImage } from "./pipeline.ts";
import { encodeGreyPng } from "./png.ts";
import type { MaskParser } from "./sam-meta.ts";
import { SegmentProtocolError } from "./sam.ts";
import { imageSize } from "./verifier.ts";

export const META_SAM_PARSER = "@meta-sam/parser";
export const META_SAM_PARSER_VERSION = "0.1.0";

/** One decoded segment before it becomes the sam.ts shape; exported for tests. */
export interface DecodedSegment {
  readonly label: string;
  readonly box: readonly [number, number, number, number];
  readonly score: number;
  /** Base64 of the full-frame greyscale PNG. */
  readonly mask: string;
  readonly frame: { readonly width: number; readonly height: number };
  readonly bounds: SegmentationMaskRecord["bounds"];
}

/** Runs @meta-sam/parser over the joined output text as a one-delta stream. */
export async function parseOutputText(text: string): Promise<ImageSegmentationResult> {
  const events = [
    { type: "response.output_text.delta", delta: text, item_id: "msg_0", output_index: 0, content_index: 0 },
    { type: "response.output_text.done", text, item_id: "msg_0", output_index: 0, content_index: 0 },
    { type: "response.completed" },
  ];
  async function* source() {
    for (const e of events) yield e;
  }
  const parsed = parseImageStream(source());
  for await (const _ of parsed) {
    // Snapshots are not needed; the final result is.
  }
  return parsed.finalResult;
}

/** The frame size: the image's own header first, else the `w=;h=` of the first box token. */
export function frameSize(text: string, image: SourceImage): { width: number; height: number } | null {
  const own = imageSize(image.bytes);
  if (own && own.width > 0 && own.height > 0) return own;
  const m = /<\|box;[^|]*?\bw=(\d+);h=(\d+)/.exec(text);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * The segments of one answer for one image. `prompt` is the noun phrase the
 * request asked for and becomes each segment's label (src/sam.ts then
 * prefixes the image name).
 */
export async function decodeSegments(text: string, image: SourceImage, prompt: string): Promise<DecodedSegment[]> {
  const fail = (reason: string): never => {
    throw new SegmentProtocolError(`${META_SAM_PARSER} on the answer for ${image.name}: ${reason}`);
  };
  let result: ImageSegmentationResult;
  try {
    result = await parseOutputText(text);
  } catch (err) {
    return fail(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  }
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) return fail(`${errors.length} parser error(s): ${errors.map((d) => `${d.code} on line ${d.line}: ${d.message}`).join("; ").slice(0, 300)}`);
  if (result.outcome.status !== "completed") return fail(`the parser's outcome is ${result.outcome.status}${"detail" in result.outcome && result.outcome.detail ? ` (${result.outcome.detail})` : ""}`);

  const masks = recordsOfKind(result.records, "mask");
  if (masks.length === 0) return [];
  const boxes = recordsOfKind(result.records, "box");
  const frame = frameSize(text, image) ?? fail("the frame size cannot be read from the image or the box token");

  return masks.map((m, i) => {
    const box = boxes.find((b) => b.objectId === m.objectId) ?? boxes[i] ?? null;
    const score = m.confidence ?? box?.confidence;
    if (typeof score !== "number" || !Number.isFinite(score)) return fail(`mask ${i} (${m.objectId}) has no confidence`);
    const rect = box ? pixelBox(box) : { left: m.bounds.left, top: m.bounds.top, right: m.bounds.right, bottom: m.bounds.bottom };
    const unit = (n: number) => Math.min(1, Math.max(0, n));
    const normalised: [number, number, number, number] = [
      unit(rect.left / frame.width),
      unit(rect.top / frame.height),
      unit((rect.right - rect.left) / frame.width),
      unit((rect.bottom - rect.top) / frame.height),
    ];
    let raster: Uint8Array;
    try {
      raster = decodeMaskToRaster(m.mask);
    } catch (err) {
      return fail(`mask ${i} (${m.objectId}) did not decode: ${err instanceof Error ? err.message : String(err)}`);
    }
    const { width: mw, height: mh } = m.mask;
    const bw = m.bounds.right - m.bounds.left;
    const bh = m.bounds.bottom - m.bounds.top;
    if (raster.length !== mw * mh) return fail(`mask ${i} raster is ${raster.length} bytes, not ${mw}x${mh}`);
    if (!(bw > 0 && bh > 0)) return fail(`mask ${i} bounds ${JSON.stringify(m.bounds)} are empty`);
    if (m.bounds.left < 0 || m.bounds.top < 0 || m.bounds.right > frame.width || m.bounds.bottom > frame.height) {
      return fail(`mask ${i} bounds ${JSON.stringify(m.bounds)} fall outside the ${frame.width}x${frame.height} frame`);
    }
    // The raster has its own resolution (the live call gave 516x1024 for a
    // 624x1239 box) and covers the bounds; it is stretched into them by
    // nearest neighbour, one source pixel per frame pixel, then placed.
    const full = new Uint8Array(frame.width * frame.height);
    for (let y = 0; y < bh; y++) {
      const ry = Math.min(mh - 1, Math.floor((y * mh) / bh));
      const rowStart = (m.bounds.top + y) * frame.width + m.bounds.left;
      for (let x = 0; x < bw; x++) {
        const rx = Math.min(mw - 1, Math.floor((x * mw) / bw));
        if (raster[ry * mw + rx]) full[rowStart + x] = 255;
      }
    }
    return {
      label: prompt,
      box: normalised,
      score,
      mask: Buffer.from(encodeGreyPng(frame.width, frame.height, full)).toString("base64"),
      frame,
      bounds: m.bounds,
    };
  });
}

function pixelBox(b: SegmentationBoxRecord): { left: number; top: number; right: number; bottom: number } {
  return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
}

/** The MaskParser src/sam-meta.ts calls: the sam.ts shape, labels from the prompt. */
export function metaSamParser(): MaskParser {
  return async (text, image, prompt) => ({
    segments: (await decodeSegments(text, image, prompt)).map(({ label, box, score, mask }) => ({ label, box, score, mask })),
  });
}
