// Try-on render run (CC_PROMPT_TRYON_31OCT): a render that is byte for byte one
// of the seller's own photos is not a render. Before this run, the RELEASEs on
// shirt-pink and kurta-mustard came from the stand-in renderer, so fidelity
// compared photo 1 with itself. The guard makes that impossible here: a
// renderer wrapped by guardRenderer throws SelfComparisonError when its output
// has the hash of any source photo, so runJob records render_failed (REFUSE)
// and the verifier is never paid for; the batch then fails the run.

import { decodeRgb } from "./image.ts";
import type { FidelityChecker, Renderer } from "./pipeline.ts";
import type { RgbImage } from "./png.ts";
import { sha256Hex } from "./util.ts";

export class SelfComparisonError extends Error {
  override name = "SelfComparisonError";
}

/** Throws when the render has the same sha256 as any source photo. */
export function assertNotSelfComparison(renderSha256: string, sourceSha256s: readonly string[]): void {
  const i = sourceSha256s.indexOf(renderSha256);
  if (i !== -1) {
    throw new SelfComparisonError(`the render is source photo ${i + 1} byte for byte (sha256 ${renderSha256.slice(0, 12)}): judging it would compare the photo with itself`);
  }
}

/** The renderer, refusing any output that is one of the sources it was given. */
export function guardRenderer(renderer: Renderer): Renderer {
  return {
    provider: renderer.provider,
    model: renderer.model,
    async render(req) {
      const image = await renderer.render(req);
      assertNotSelfComparison(sha256Hex(image.bytes), req.sources.map((s) => sha256Hex(s.bytes)));
      return image;
    },
  };
}

/**
 * SC1 (Grok, 31 Oct, from the DeepSeek Q31 red-team): the evidence-checking agent's replace-photo-1 path takes a
 * new photo 1 from the seller, so a seller could answer with the image to publish itself. Then fidelity compares a
 * file with itself. This wrapper never lets that pass as a fidelity check: when the image to publish is a source
 * photo byte for byte, a RELEASE becomes REVIEW (a person looks), and REVIEW or REFUSE keeps its decision; either
 * way the fidelity entry says so in a reason. The thresholds and src/fidelity.ts are not touched.
 */
export function selfComparisonReview(checker: FidelityChecker): FidelityChecker {
  return {
    async check(req) {
      const out = await checker.check(req);
      // The near-copy check decodes every photo, so it runs only where it can change the decision: on a RELEASE.
      const reason = selfComparisonReason(req.render, req.sources, out.decision === "RELEASE");
      if (reason === null) return out;
      const reasons = [...(Array.isArray(out.reasons) ? out.reasons : []), reason];
      return { ...out, decision: out.decision === "RELEASE" ? "REVIEW" : out.decision, reasons };
    },
  };
}

/**
 * SC2 (Grok, 31 Oct): a byte match misses the same picture re-saved, re-encoded, resized or stripped of EXIF. Both
 * images are box-averaged onto a NEAR_COPY_GRID x NEAR_COPY_GRID grid of RGB cells and compared by the mean absolute
 * cell difference (0 to 255). At or below NEAR_COPY_MAX it is the same picture. Measured in test/agent-replace.test.ts
 * "replace 10": re-encodes and a half-size copy of a committed photo stay below 1; a different photo of the same
 * garment (front vs back) is far above 10. Not caught: a crop, a rotation or a mirror (the aspect ratio or the grid
 * changes), and anything that is not a JPEG or PNG. Only ever stricter: it turns a RELEASE into REVIEW, and is not
 * run on a REVIEW or REFUSE, which it could not change.
 */
export const NEAR_COPY_GRID = 32;
export const NEAR_COPY_MAX = 3;
/** Aspect ratios further apart than this are different framings, not a near copy. */
const NEAR_COPY_ASPECT = 0.02;

function grid(img: RgbImage): Float64Array {
  const n = NEAR_COPY_GRID;
  const sum = new Float64Array(n * n * 3);
  const count = new Float64Array(n * n);
  for (let y = 0; y < img.height; y++) {
    const gy = Math.floor((y * n) / img.height);
    for (let x = 0; x < img.width; x++) {
      const cell = gy * n + Math.floor((x * n) / img.width);
      const p = (y * img.width + x) * 3;
      for (let k = 0; k < 3; k++) sum[cell * 3 + k]! += img.data[p + k]!;
      count[cell]! += 1;
    }
  }
  for (let c = 0; c < n * n; c++) for (let k = 0; k < 3; k++) sum[c * 3 + k]! /= count[c] || 1;
  return sum;
}

/** Width and height from the JPEG SOF or PNG IHDR header, without decoding; null when neither is found. */
export function headerSize(bytes: Uint8Array): { width: number; height: number } | null {
  const u16 = (i: number) => (bytes[i]! << 8) | bytes[i + 1]!;
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const u32 = (i: number) => ((bytes[i]! << 24) >>> 0) + (bytes[i + 1]! << 16) + (bytes[i + 2]! << 8) + bytes[i + 3]!;
    return { width: u32(16), height: u32(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) { i += 1; continue; }
    // SOF0..SOF15, except DHT (c4), JPG (c8) and DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: u16(i + 7), height: u16(i + 5) };
    }
    if (marker === 0xda || marker === 0xd9) return null;
    i += 2 + u16(i + 2);
  }
  return null;
}

/** Aspect ratio from the header; null when unknown. */
function headerAspect(bytes: Uint8Array): number | null {
  const s = headerSize(bytes);
  return s && s.width > 0 && s.height > 0 ? s.width / s.height : null;
}

interface Thumb { aspect: number; small: boolean; cells: Float64Array }

/** Decoded once per byte array: the gate runner passes the same arrays for every source. */
const thumbs = new WeakMap<Uint8Array, Thumb | null>();

function thumb(bytes: Uint8Array): Thumb | null {
  if (thumbs.has(bytes)) return thumbs.get(bytes)!;
  let t: Thumb | null;
  try {
    const img = decodeRgb(bytes);
    t = { aspect: img.width / img.height, small: Math.min(img.width, img.height) < NEAR_COPY_GRID, cells: grid(img) };
  } catch {
    t = null;
  }
  thumbs.set(bytes, t);
  return t;
}

/** The mean absolute grid-cell difference of two images, or null when they cannot be compared (no decode, other framing). */
export function nearCopyDistance(a: Uint8Array, b: Uint8Array): number | null {
  // Cheap first: a different framing read from the headers needs no decode (full-size JPEG decodes take seconds).
  const ha = headerAspect(a);
  const hb = headerAspect(b);
  if (ha === null || hb === null) return null;
  if (Math.abs(ha / hb - 1) > NEAR_COPY_ASPECT) return null;
  const ta = thumb(a);
  const tb = thumb(b);
  if (!ta || !tb || ta.small || tb.small) return null;
  if (Math.abs(ta.aspect / tb.aspect - 1) > NEAR_COPY_ASPECT) return null;
  let d = 0;
  for (let i = 0; i < ta.cells.length; i++) d += Math.abs(ta.cells[i]! - tb.cells[i]!);
  return d / ta.cells.length;
}

/**
 * The self_comparison reason for this render, or null when it is no source photo. A byte match is always reported;
 * the near-copy comparison only when `nearCopy` is set.
 */
export function selfComparisonReason(render: Uint8Array, sources: readonly { name: string; bytes: Uint8Array }[], nearCopy = true): string | null {
  const tail = "so fidelity compared the photo with itself and checked no render; the seller's own photo, nothing generated, and a person must look";
  const i = sources.map((s) => sha256Hex(s.bytes)).indexOf(sha256Hex(render));
  if (i !== -1) return `self_comparison: the image to publish is source photo ${i + 1} (${sources[i]!.name}) byte for byte, ${tail}`;
  if (!nearCopy) return null;
  for (const [j, s] of sources.entries()) {
    const d = nearCopyDistance(render, s.bytes);
    if (d !== null && d <= NEAR_COPY_MAX) {
      return `self_comparison: the image to publish is a near copy of source photo ${j + 1} (${s.name}): mean pixel difference ${d.toFixed(2)} on a ${NEAR_COPY_GRID}x${NEAR_COPY_GRID} grid, at most ${NEAR_COPY_MAX} counts as the same picture re-saved, re-encoded or resized, ${tail}`;
    }
  }
  return null;
}
