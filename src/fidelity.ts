// Garment fidelity (SPEC §10): a deterministic check beside the verifier.
//
// SAM masks say where the garment is in the source photo and in the render; this
// code measures the masked regions and compares the numbers with thresholds from
// config/fidelity.json. No model judges anything. The thresholds are starting
// values and UNCALIBRATED.

import { readFileSync } from "node:fs";

import { decodeRgb } from "./image.ts";
import type { FidelityChecker, Segmenter } from "./pipeline.ts";
import { decodePng, maskFromPng } from "./png.ts";
import type { Mask, RgbImage } from "./png.ts";
import { imageExt } from "./render.ts";
import type { Decision } from "./types.ts";

export interface Thresholds {
  readonly delta_e: { readonly review_above: number; readonly refuse_above: number };
  readonly hist: { readonly review_above: number; readonly refuse_above: number };
  readonly texture: { readonly review_below: number; readonly refuse_below: number };
  /** area is the render's masked share over the source's, so it is bounded on both sides. */
  readonly area: { readonly review_below: number; readonly review_above: number };
}

export interface Metrics {
  /** CIE76 distance between the mean Lab colours of the two masked regions. */
  readonly delta_e: number;
  /** Hellinger distance between 64-bin Lab histograms: 0 same, 1 disjoint. */
  readonly hist: number;
  /** Share of matching bits in a 64-bit dHash of the masked crops. */
  readonly texture: number;
  /** Render masked share of its frame over the source's. */
  readonly area: number;
}

export interface FidelityResult {
  readonly decision: Decision;
  /** null when the inputs could not be measured. */
  readonly metrics: Metrics | null;
  /** Every breach, or why nothing could be measured. Empty on RELEASE. */
  readonly reasons: readonly string[];
}

export interface FidelityInput {
  readonly source: RgbImage;
  readonly render: RgbImage;
  readonly sourceMask: Mask | null | undefined;
  readonly renderMask: Mask | null | undefined;
}

export const DEFAULT_THRESHOLDS_PATH = new URL("../config/fidelity.json", import.meta.url);

/** Validates a thresholds object. Anything missing, non-finite or out of order throws; there are no defaults. */
export function parseThresholds(value: unknown): Thresholds {
  const get = (group: string, key: string): number => {
    const g = (value as Record<string, unknown> | null)?.[group];
    const n = (g as Record<string, unknown> | null | undefined)?.[key];
    if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`fidelity thresholds: ${group}.${key} must be a finite number`);
    return n;
  };
  const t: Thresholds = {
    delta_e: { review_above: get("delta_e", "review_above"), refuse_above: get("delta_e", "refuse_above") },
    hist: { review_above: get("hist", "review_above"), refuse_above: get("hist", "refuse_above") },
    texture: { review_below: get("texture", "review_below"), refuse_below: get("texture", "refuse_below") },
    area: { review_below: get("area", "review_below"), review_above: get("area", "review_above") },
  };
  if (!(t.delta_e.review_above <= t.delta_e.refuse_above)) throw new Error("fidelity thresholds: delta_e review_above must not exceed refuse_above");
  if (!(t.hist.review_above <= t.hist.refuse_above)) throw new Error("fidelity thresholds: hist review_above must not exceed refuse_above");
  if (!(t.texture.review_below >= t.texture.refuse_below)) throw new Error("fidelity thresholds: texture review_below must not be under refuse_below");
  if (!(t.area.review_below < 1 && 1 < t.area.review_above)) throw new Error("fidelity thresholds: area bounds must sit either side of 1");
  return t;
}

export function loadThresholds(path: string | URL = DEFAULT_THRESHOLDS_PATH): Thresholds {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`fidelity thresholds: cannot read ${String(path)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`fidelity thresholds: ${String(path)} is not JSON`);
  }
  return parseThresholds(json);
}

export function checkFidelity(input: FidelityInput, t: Thresholds): FidelityResult {
  const unmeasured = (reason: string): FidelityResult => ({ decision: "REVIEW", metrics: null, reasons: [reason] });

  for (const [name, img] of [["source", input.source], ["render", input.render]] as const) {
    if (!isRgb(img)) return unmeasured(`${name} image is not 8-bit RGB`);
  }
  for (const [name, mask, img] of [["source", input.sourceMask, input.source], ["render", input.renderMask, input.render]] as const) {
    if (!mask) return unmeasured(`${name} mask is missing`);
    if (mask.width !== img.width || mask.height !== img.height || !(mask.data instanceof Uint8Array) || mask.data.length !== img.width * img.height) {
      return unmeasured(`${name} mask is not the size of its image`);
    }
    if (!mask.data.some((v) => v !== 0)) return unmeasured(`${name} mask is empty`);
  }

  const s = measure(input.source, input.sourceMask!);
  const r = measure(input.render, input.renderMask!);
  const metrics: Metrics = {
    delta_e: Math.hypot(s.meanLab[0] - r.meanLab[0], s.meanLab[1] - r.meanLab[1], s.meanLab[2] - r.meanLab[2]),
    hist: hellinger(s.hist, s.count, r.hist, r.count),
    texture: matchingBits(s.dhash, r.dhash) / 64,
    area: r.share / s.share,
  };

  const refuse: string[] = [];
  const review: string[] = [];
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3));
  for (const [name, v] of Object.entries(metrics)) {
    if (!Number.isFinite(v)) review.push(`${name} is not a finite number`);
  }
  const { delta_e, hist, texture, area } = metrics;
  for (const [name, v, lim] of [["delta_e", delta_e, t.delta_e], ["hist", hist, t.hist]] as const) {
    if (v > lim.refuse_above) refuse.push(`${name} ${f(v)} above ${f(lim.refuse_above)}`);
    else if (v > lim.review_above) review.push(`${name} ${f(v)} above ${f(lim.review_above)}`);
  }
  if (texture < t.texture.refuse_below) refuse.push(`texture ${f(texture)} below ${f(t.texture.refuse_below)}`);
  else if (texture < t.texture.review_below) review.push(`texture ${f(texture)} below ${f(t.texture.review_below)}`);
  if (area < t.area.review_below) review.push(`area ${f(area)} below ${f(t.area.review_below)}: the garment shrank in frame`);
  else if (area > t.area.review_above) review.push(`area ${f(area)} above ${f(t.area.review_above)}: the garment grew in frame`);

  const decision: Decision = refuse.length > 0 ? "REFUSE" : review.length > 0 ? "REVIEW" : "RELEASE";
  return { decision, metrics, reasons: [...refuse, ...review] };
}

function isRgb(img: unknown): img is RgbImage {
  if (typeof img !== "object" || img === null) return false;
  const { width, height, data } = img as RgbImage;
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && data instanceof Uint8Array && data.length === width * height * 3;
}

// sRGB byte -> linear light, once per value.
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** CIE Lab (D65) of one sRGB pixel. */
export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = LINEAR[r]!;
  const G = LINEAR[g]!;
  const B = LINEAR[b]!;
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
}

const bin4 = (v: number, lo: number, hi: number) => Math.min(3, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * 4)));

function measure(img: RgbImage, mask: Mask) {
  const { width, height, data } = img;
  const sum = [0, 0, 0];
  const hist = new Float64Array(64);
  const grey = new Float64Array(width * height);
  let count = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask.data[i]) continue;
      const r = data[i * 3]!, g = data[i * 3 + 1]!, b = data[i * 3 + 2]!;
      const [L, A, B] = srgbToLab(r, g, b);
      sum[0]! += L; sum[1]! += A; sum[2]! += B;
      hist[bin4(L, 0, 100) * 16 + bin4(A, -128, 128) * 4 + bin4(B, -128, 128)]! += 1;
      grey[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // dHash over the mask's bounding box: a 9x8 grid of mean masked grey, then
  // one bit per horizontal neighbour pair. A cell with no garment pixel takes
  // the crop's mean, so it carries no edge.
  const cells = new Float64Array(72);
  const cellCount = new Float64Array(72);
  let greySum = 0;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * width + x;
      if (!mask.data[i]) continue;
      const c = Math.min(7, Math.floor(((y - minY) * 8) / h)) * 9 + Math.min(8, Math.floor(((x - minX) * 9) / w));
      cells[c]! += grey[i]!;
      cellCount[c]! += 1;
      greySum += grey[i]!;
    }
  }
  const meanGrey = greySum / count;
  for (let c = 0; c < 72; c++) cells[c] = cellCount[c]! > 0 ? cells[c]! / cellCount[c]! : meanGrey;
  const dhash: number[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) dhash.push(cells[row * 9 + col]! < cells[row * 9 + col + 1]! ? 1 : 0);
  }

  return { meanLab: [sum[0]! / count, sum[1]! / count, sum[2]! / count] as const, hist, count, dhash, share: count / (width * height) };
}

/** Hellinger distance from raw bin counts; integer sums keep identical histograms at exactly 0. */
function hellinger(p: Float64Array, pTotal: number, q: Float64Array, qTotal: number): number {
  let bc = 0;
  for (let k = 0; k < p.length; k++) bc += Math.sqrt(p[k]! * q[k]!);
  return Math.sqrt(Math.max(0, 1 - bc / Math.sqrt(pTotal * qTotal)));
}

function matchingBits(a: readonly number[], b: readonly number[]): number {
  let same = 0;
  for (let k = 0; k < a.length; k++) if (a[k] === b[k]) same++;
  return same;
}

/** The pipeline's checker (P6): masks from the segments, images decoded here, numbers from checkFidelity. */
export interface MaskedFidelityOptions {
  readonly thresholds?: Thresholds;
  /** Segments the render; without one, no render mask exists and the result is REVIEW. */
  readonly segmenter?: Segmenter;
}

/**
 * The `FidelityChecker` the pipeline calls (SPEC §10). The source mask is the
 * first segment with mask bytes for the first source photo (labels are
 * `<image name>/<label>`); the render mask comes from the given segmenter, asked
 * once with the render as an image named `render`. A missing mask, or an image
 * that is not a JPEG or PNG or does not decode (image.ts), is
 * REVIEW with `metrics: null` and the reason, never a pass. With both masks and
 * both images decoded, the result is checkFidelity's.
 */
export function maskedFidelityChecker(opts: MaskedFidelityOptions = {}): FidelityChecker {
  const t = opts.thresholds ?? loadThresholds();
  const unmeasured = (reason: string): FidelityResult => ({ decision: "REVIEW", metrics: null, reasons: [reason] });
  return {
    check: async ({ sources, segments, render, renderMask }) => {
      const source = sources[0];
      if (!source) return unmeasured("source mask is missing: the job has no source photo");
      const sourceSeg = segments.find((s) => s.label.startsWith(`${source.name}/`) && s.mask instanceof Uint8Array);
      if (!sourceSeg) return unmeasured(`source mask is missing: no segment with mask bytes for ${source.name}`);
      // A composite knows its render mask exactly (the source mask through the
      // warp), so the render is not segmented again (SPEC-render-fix §4).
      let renderSeg: { mask: Uint8Array };
      if (renderMask) {
        renderSeg = { mask: renderMask };
      } else {
        if (!opts.segmenter) return unmeasured("render mask is missing: no segmenter is available for the render");
        const renderSegs = await opts.segmenter.segment([{ name: "render", bytes: render }]);
        const found = renderSegs.find((s) => s.mask instanceof Uint8Array);
        if (!found) return unmeasured("render mask is missing: the segmenter found no garment in the render");
        renderSeg = { mask: found.mask as Uint8Array };
      }

      const decoded: Record<"source" | "render", RgbImage | null> = { source: null, render: null };
      for (const [name, bytes] of [["source", source.bytes], ["render", render]] as const) {
        if (!imageExt(bytes)) return unmeasured(`${name} image is not a JPEG or PNG, so it cannot be measured`);
        try {
          decoded[name] = decodeRgb(bytes);
        } catch (err) {
          return unmeasured(`${name} image could not be decoded: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const masks: Record<"source" | "render", Mask | null> = { source: null, render: null };
      for (const [name, seg] of [["source", sourceSeg], ["render", renderSeg]] as const) {
        try {
          masks[name] = maskFromPng(decodePng(seg.mask as Uint8Array));
        } catch (err) {
          return unmeasured(`${name} mask could not be decoded: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const result = checkFidelity({ source: decoded.source!, render: decoded.render!, sourceMask: masks.source, renderMask: masks.render }, t);
      return renderMask ? { ...result, render_mask: "warped-source-mask" } : result;
    },
  };
}
