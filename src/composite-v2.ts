// Composite v2 (SPEC-composite-v2, NR3): a camera-quality "ghost mannequin"
// product shot of the seller's own garment, by deterministic code. No body
// template is drawn: the cleaned garment cut-out is lit evenly within recorded
// bounds, given a neck insert where the neck opening is, shaded, and framed on a
// plain studio backdrop at 1200x1600.
//
// No garment pixel is invented. The only synthetic pixels are the backdrop, the
// shadow, the neck insert and the alpha feather at the mask edge; small enclosed
// mask holes are filled with the photo's own pixels at those positions.
// Lighting and white balance change by bounded amounts that the receipt records;
// white balance only on near-neutral garments (gray-world assumes a grey subject).
//
// A photo the composite cannot make look right (cut off, too small, harsh sun,
// clipped, a fragmented mask, a correction too large) throws
// CompositeQualityReview with the reason and every check: the pipeline records
// REVIEW and no image (SPEC-composite-v2 §7).
//
// Deterministic: fixed-order float arithmetic, Math.round at every output pixel,
// no Math.random, Date or locale, and the PNG encoder of png.ts (no ancillary
// chunks). The same inputs give the same PNG bytes.

import { CompositeError, warp } from "./composite.ts";
import type { Quad, Rgba } from "./composite.ts";
import { srgbToLab } from "./fidelity.ts";
import { encodeRgbPng } from "./png.ts";
import type { Mask, RgbImage } from "./png.ts";

export const COMPOSITE_V2_MODEL = "composite-v2";

/** Every parameter of SPEC-composite-v2 §3 to §8, recorded on the receipt as given. Thresholds are provisional (UNVERIFIED). */
export const V2_PARAMS = Object.freeze({
  // §3 mask cleanup
  mask_t: 128,
  min_blob: 0.005,
  hole_max: 0.015,
  morph_r: 2,
  feather_r: 3,
  // §4 ghost mannequin
  insert_darken: 0.62,
  insert_gradient: 0.12,
  // NR3c: the back neckline's curve dips this share of the opening's height at its centre.
  insert_back_depth: 0.35,
  neck_top_band: 0.25,
  neck_centre_band: 0.15,
  max_rotate_deg: 4,
  min_rotate_deg: 0.5,
  // §5 exposure and colour
  illum_r: 0.12,
  gain_min: 0.8,
  gain_max: 1.35,
  flatten_strength: 0.7,
  wb_min: 0.92,
  wb_max: 1.08,
  // NR3b: WB only on near-neutral garments. Measured C*: kurta-01 42.6, kurta-02 12.3, the grey test fixture about 2.5.
  wb_max_chroma: 8,
  max_corr_de: 6,
  // §6 shading
  sh_dy: 0.015,
  sh_r: 0.025,
  sh_a: 0.22,
  ground_w: 0.7,
  ground_h: 0.025,
  ground_a: 0.12,
  grad_bottom: 0.94,
  rim: 0.06,
  edge_d: 0.02,
  // §7 quality pre-check
  cov_min: 0.12,
  edge_max_borders: 2,
  edge_max_share: 0.2,
  shadow_max: 0.55,
  shadow_uneven: 0.35,
  clip_max: 0.03,
  clip_hi: 250,
  clip_lo: 5,
  frag_max: 6,
  // §8 framing
  out_w: 1200,
  out_h: 1600,
  margin_top: 0.08,
  margin_bottom: 0.1,
  margin_side: 0.08,
  max_upscale: 1.5,
  backdrop_top: [0xf4, 0xf4, 0xf2],
  backdrop_bottom: [0xe6, 0xe6, 0xe3],
  radial_lift: 0.02,
});
export type V2Params = { readonly [K in keyof typeof V2_PARAMS]: (typeof V2_PARAMS)[K] extends number ? number : readonly number[] };

/** The honesty note for the receipt, the shop card and the README (§5). */
export const V2_CORRECTION_NOTE =
  "Lighting and white balance were adjusted by bounded, recorded amounts (max ±8% per colour channel, shadow gain 0.80 to 1.35). Fidelity checks compare against the seller's original photo.";

/** The §7 reasons, word for word, each with the capture-guide step that fixes it (docs/CAPTURE.md). */
export const QUALITY_REASONS = Object.freeze({
  fragmentation: { reason: "mask is fragmented", guide: "docs/CAPTURE.md#1-background" },
  coverage: { reason: "garment fills too little of the photo; retake closer", guide: "docs/CAPTURE.md#4-framing" },
  edge_touch: { reason: "garment is cut off at the edge of the photo", guide: "docs/CAPTURE.md#4-framing" },
  clipped: { reason: "over- or under-exposed photo", guide: "docs/CAPTURE.md#2-light" },
  shadow: { reason: "harsh shadow across the garment; retake in shade", guide: "docs/CAPTURE.md#2-light" },
  resolution: { reason: "photo resolution too low", guide: "docs/CAPTURE.md#4-framing" },
  correction: { reason: "correction too large", guide: "docs/CAPTURE.md#2-light" },
});
export type QualityCheck = keyof typeof QUALITY_REASONS;

/** Thrown when a §7 check fails: the pipeline records REVIEW with this reason and no image. */
export class CompositeQualityReview extends Error {
  override name = "CompositeQualityReview";
  readonly check: QualityCheck;
  readonly quality: Readonly<Record<string, unknown>>;
  constructor(check: QualityCheck, quality: Readonly<Record<string, unknown>>) {
    super(QUALITY_REASONS[check].reason);
    this.check = check;
    this.quality = quality;
  }
}

// ---------- small deterministic helpers ----------

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const byte = (v: number): number => clamp(Math.round(v), 0, 255);
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** One box-mean pass along rows or columns, out-of-frame counted as 0. */
function boxPass(src: Float64Array, w: number, h: number, r: number, horizontal: boolean): Float64Array {
  const out = new Float64Array(w * h);
  const n = 2 * r + 1;
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 1 : w;
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w : l;
    let s = 0;
    for (let k = 0; k <= r && k < len; k++) s += src[base + k * stride]!;
    for (let k = 0; k < len; k++) {
      out[base + k * stride] = s / n;
      const inn = k + r + 1;
      const gone = k - r;
      if (inn < len) s += src[base + inn * stride]!;
      if (gone >= 0) s -= src[base + gone * stride]!;
    }
  }
  return out;
}

/** Box blur x3 (about a Gaussian), radius r, zero outside the frame. */
export function blur3(src: Float64Array, w: number, h: number, r: number): Float64Array {
  if (r < 1) return Float64Array.from(src);
  let p = src;
  for (let k = 0; k < 3; k++) p = boxPass(boxPass(p, w, h, r, true), w, h, r, false);
  return p;
}

/** Connected components of the 1-pixels: label 1..n per pixel (0 for none) and each label's size. */
function components(bin: Uint8Array, w: number, h: number, eight: boolean): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(w * h);
  const sizes = [0];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!bin[start] || labels[start]) continue;
    const id = sizes.length;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top > 0) {
      const i = stack[--top]!;
      size++;
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (bin[j] && !labels[j]) {
            labels[j] = id;
            stack[top++] = j;
          }
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** Square-kernel box count of the 1-pixels within radius r, out-of-frame 0, in integers. */
function boxCount(bin: Uint8Array, w: number, h: number, r: number): Int32Array {
  const rows = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x <= r && x < w; x++) s += bin[y * w + x]!;
    for (let x = 0; x < w; x++) {
      rows[y * w + x] = s;
      if (x + r + 1 < w) s += bin[y * w + x + r + 1]!;
      if (x - r >= 0) s -= bin[y * w + x - r]!;
    }
  }
  const out = new Int32Array(w * h);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y <= r && y < h; y++) s += rows[y * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s;
      if (y + r + 1 < h) s += rows[(y + r + 1) * w + x]!;
      if (y - r >= 0) s -= rows[(y - r) * w + x]!;
    }
  }
  return out;
}

/** Erosion over the in-frame part of the kernel only, so a garment cut off by the photo edge keeps its edge pixels (the §7 edge check needs them). */
function erode(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const c = boxCount(bin, w, h, r);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ny = Math.min(y + r, h - 1) - Math.max(y - r, 0) + 1;
    for (let x = 0; x < w; x++) {
      const nx = Math.min(x + r, w - 1) - Math.max(x - r, 0) + 1;
      out[y * w + x] = c[y * w + x] === nx * ny ? 1 : 0;
    }
  }
  return out;
}

function dilate(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const c = boxCount(bin, w, h, r);
  return Uint8Array.from(c, (v) => (v > 0 ? 1 : 0));
}

export interface Box {
  readonly x0: number;
  readonly y0: number;
  /** Exclusive. */
  readonly x1: number;
  readonly y1: number;
}

function bboxOf(bin: Uint8Array | Float64Array, w: number, h: number): Box | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!(bin[y * w + x]! > 0)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

const lumaInt = (r: number, g: number, b: number): number => (77 * r + 150 * g + 29 * b) >> 8;

// ---------- §3 mask cleanup ----------

export interface CleanedMask {
  readonly mask: Mask;
  readonly record: {
    readonly components_before: number;
    readonly components_dropped: number;
    readonly small_blobs: number;
    readonly holes_filled: number;
    readonly holes_filled_px: number;
    readonly holes_kept: number;
    readonly coverage: number;
  };
}

/** Largest 8-connected component, small enclosed holes filled, open then close. An empty mask throws CompositeError. */
export function cleanMask(mask: Mask, p: V2Params = V2_PARAMS): CleanedMask {
  const { width: w, height: h } = mask;
  const n = w * h;
  const bin = Uint8Array.from(mask.data, (v) => (v ? 1 : 0));
  const comp = components(bin, w, h, true);
  const before = comp.sizes.length - 1;
  if (before === 0) throw new CompositeError("no garment mask: the mask is empty");
  let best = 1;
  let total = 0;
  for (let k = 1; k < comp.sizes.length; k++) {
    total += comp.sizes[k]!;
    if (comp.sizes[k]! > comp.sizes[best]!) best = k;
  }
  const small = comp.sizes.slice(1).filter((s) => s < p.min_blob * total).length;
  let m: Uint8Array = Uint8Array.from(comp.labels, (l) => (l === best ? 1 : 0));
  const area = comp.sizes[best]!;

  // Holes: background not reachable from the border (4-connected).
  const bg = Uint8Array.from(m, (v) => 1 - v);
  const bgComp = components(bg, w, h, false);
  const touches = new Uint8Array(bgComp.sizes.length);
  for (let x = 0; x < w; x++) {
    touches[bgComp.labels[x]!] = 1;
    touches[bgComp.labels[(h - 1) * w + x]!] = 1;
  }
  for (let y = 0; y < h; y++) {
    touches[bgComp.labels[y * w]!] = 1;
    touches[bgComp.labels[y * w + w - 1]!] = 1;
  }
  let filled = 0, filledPx = 0, kept = 0;
  const fill = new Uint8Array(bgComp.sizes.length);
  for (let k = 1; k < bgComp.sizes.length; k++) {
    if (touches[k]) continue;
    if (bgComp.sizes[k]! < p.hole_max * area) {
      fill[k] = 1;
      filled++;
      filledPx += bgComp.sizes[k]!;
    } else kept++;
  }
  for (let i = 0; i < n; i++) if (fill[bgComp.labels[i]!]) m[i] = 1;

  m = dilate(erode(m, w, h, p.morph_r), w, h, p.morph_r);
  m = erode(dilate(m, w, h, p.morph_r), w, h, p.morph_r);
  let count = 0;
  for (let i = 0; i < n; i++) count += m[i]!;
  if (count === 0) throw new CompositeError("no garment mask: nothing is left after mask cleanup");
  return {
    mask: { width: w, height: h, data: m },
    record: {
      components_before: before,
      components_dropped: before - 1,
      small_blobs: small,
      holes_filled: filled,
      holes_filled_px: filledPx,
      holes_kept: kept,
      coverage: round4(count / n),
    },
  };
}

// ---------- §4 neck region ----------

/**
 * The neck opening: non-garment pixels in the top band of the garment box with
 * garment to their left and right on the same row and below them in the same
 * column (an enclosed hole or the top-centre notch). The largest such
 * 4-connected region whose centroid lies in the centre band; null when there is none.
 */
export function neckRegion(m: Mask, p: V2Params = V2_PARAMS): { region: Uint8Array; bbox: Box; px: number } | null {
  const { width: w, height: h, data } = m;
  const box = bboxOf(data, w, h);
  if (!box) return null;
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const yTop = box.y0 + Math.floor(p.neck_top_band * bh);
  const cx = (box.x0 + box.x1) / 2;
  const xa = Math.ceil(cx - p.neck_centre_band * bw), xb = Math.floor(cx + p.neck_centre_band * bw);
  const lowest = new Int32Array(w).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x]) lowest[x] = y;
  const cand = new Uint8Array(w * h);
  for (let y = box.y0; y < yTop; y++) {
    let first = -1, last = -1;
    for (let x = box.x0; x < box.x1; x++) {
      if (!data[y * w + x]) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first < 0) continue;
    for (let x = first + 1; x < last; x++) {
      if (!data[y * w + x] && lowest[x]! > y) cand[y * w + x] = 1;
    }
  }
  // The band picks the region by its centroid; it does not clip the region's shape.
  const comp = components(cand, w, h, false);
  const sx = new Float64Array(comp.sizes.length);
  for (let i = 0; i < w * h; i++) if (comp.labels[i]) sx[comp.labels[i]!]! += i % w;
  let best = 0;
  for (let k = 1; k < comp.sizes.length; k++) {
    const c = sx[k]! / comp.sizes[k]! + 0.5;
    if (c < xa || c > xb) continue;
    if (best === 0 || comp.sizes[k]! > comp.sizes[best]!) best = k;
  }
  if (best === 0) return null;
  const region = Uint8Array.from(comp.labels, (l) => (l === best ? 1 : 0));
  return { region, bbox: bboxOf(region, w, h)!, px: comp.sizes[best]! };
}

/**
 * NR3c: the back of the neckline seen through the opening. Its top edge is an
 * arc, at the opening's top at the sides and `insert_back_depth` of the
 * opening's height lower at the centre, so the insert reads as a curved back
 * collar rather than a flat block. `top[x]` is the arc's row for each column of
 * the bbox (x - bbox.x0); `mask` is 1 on region pixels on or below it.
 */
export function backNeckInsert(neck: { region: Uint8Array; bbox: Box }, w: number, p: V2Params = V2_PARAMS): { mask: Uint8Array; top: Float64Array; px: number } {
  const nb = neck.bbox;
  const mask = new Uint8Array(neck.region.length);
  const top = new Float64Array(nb.x1 - nb.x0);
  const cx = (nb.x0 + nb.x1) / 2, half = Math.max(0.5, (nb.x1 - nb.x0) / 2);
  const depth = p.insert_back_depth * (nb.y1 - nb.y0);
  let px = 0;
  for (let x = nb.x0; x < nb.x1; x++) {
    const u = (x + 0.5 - cx) / half;
    const yArc = nb.y0 + depth * Math.sqrt(Math.max(0, 1 - u * u));
    top[x - nb.x0] = yArc;
    for (let y = Math.ceil(yArc); y < nb.y1; y++) {
      const i = y * w + x;
      if (neck.region[i]) {
        mask[i] = 1;
        px++;
      }
    }
  }
  return { mask, top, px };
}

// ---------- §5 illumination and colour ----------

/** Illumination L: masked box-blur x3 of Y, normalised by the blurred mask, so the background never leaks in. */
export function illumination(src: RgbImage, m: Mask, r: number): Float64Array {
  const { width: w, height: h } = src;
  const ym = new Float64Array(w * h);
  const mm = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!m.data[i]) continue;
    ym[i] = lumaInt(src.data[i * 3]!, src.data[i * 3 + 1]!, src.data[i * 3 + 2]!);
    mm[i] = 1;
  }
  const by = blur3(ym, w, h, r);
  const bm = blur3(mm, w, h, r);
  const L = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = m.data[i] && bm[i]! > 0 ? by[i]! / bm[i]! : 0;
  return L;
}

/** (p95 - p5) / mean of L over the garment pixels. */
export function shadowScore(L: Float64Array, m: Mask): number {
  const vals: number[] = [];
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) vals.push(L[i]!);
  if (vals.length === 0) return 0;
  const sorted = Float64Array.from(vals).sort();
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sum / sorted.length;
  const at = (q: number): number => sorted[Math.floor(q * (sorted.length - 1))]!;
  return mean > 0 ? (at(0.95) - at(0.05)) / mean : 0;
}

/** Gray-world gains per channel, meanY / meanC over the garment pixels, each clamped to [wb_min, wb_max]. */
export function wbGains(rgb: Float64Array, m: Uint8Array, p: V2Params = V2_PARAMS): [number, number, number] {
  let sr = 0, sg = 0, sb = 0, sy = 0, n = 0;
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const r = rgb[i * 3]!, g = rgb[i * 3 + 1]!, b = rgb[i * 3 + 2]!;
    sr += r;
    sg += g;
    sb += b;
    sy += (77 * r + 150 * g + 29 * b) / 256;
    n++;
  }
  const gain = (c: number): number => (c > 0 ? clamp(sy / c, p.wb_min, p.wb_max) : 1);
  return n === 0 ? [1, 1, 1] : [gain(sr), gain(sg), gain(sb)];
}

/** Mean Lab chroma C* = sqrt(a*² + b*²) over the garment pixels of the photo. */
export function garmentChroma(src: RgbImage, m: Mask): number {
  let sum = 0, n = 0;
  for (let i = 0; i < m.data.length; i++) {
    if (!m.data[i]) continue;
    const [, a, b] = srgbToLab(src.data[i * 3]!, src.data[i * 3 + 1]!, src.data[i * 3 + 2]!);
    sum += Math.sqrt(a * a + b * b);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

export interface Correction {
  /** The photo with only the garment pixels corrected. */
  readonly image: RgbImage;
  readonly wb_gains: readonly [number, number, number];
  readonly wb_applied: boolean;
  readonly wb_reason: string;
  readonly garment_chroma: number;
  readonly gain_applied: readonly [number, number];
  /** Over everything applied: the flatten, and WB when it was applied. */
  readonly correction_delta_e: number;
}

/**
 * §5: illumination flattening (bounded gain, same on R, G, B) then bounded
 * gray-world WB, on garment pixels only. Gray-world assumes a grey subject, so
 * WB is skipped when the garment's mean chroma C* is above wb_max_chroma (NR3b).
 */
export function correctGarment(src: RgbImage, m: Mask, L: Float64Array, p: V2Params = V2_PARAMS): Correction {
  const { width: w, height: h } = src;
  const n = w * h;
  const chroma = round4(garmentChroma(src, m));
  const wbApplied = chroma <= p.wb_max_chroma;
  let sumL = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (!m.data[i]) continue;
    sumL += L[i]!;
    count++;
  }
  const meanL = count > 0 ? sumL / count : 0;
  const flat = new Float64Array(n * 3);
  let gmin = Infinity, gmax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!m.data[i]) continue;
    const g = L[i]! > 0 ? clamp(meanL / L[i]!, p.gain_min, p.gain_max) : 1;
    const g2 = 1 + p.flatten_strength * (g - 1);
    if (g2 < gmin) gmin = g2;
    if (g2 > gmax) gmax = g2;
    for (let c = 0; c < 3; c++) flat[i * 3 + c] = src.data[i * 3 + c]! * g2;
  }
  const wb: [number, number, number] = wbApplied ? wbGains(flat, m.data, p) : [1, 1, 1];
  const out = new Uint8Array(src.data);
  let de = 0;
  for (let i = 0; i < n; i++) {
    if (!m.data[i]) continue;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = byte(flat[i * 3 + c]! * wb[c]!);
    const a = srgbToLab(src.data[i * 3]!, src.data[i * 3 + 1]!, src.data[i * 3 + 2]!);
    const b = srgbToLab(out[i * 3]!, out[i * 3 + 1]!, out[i * 3 + 2]!);
    de += Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  }
  return {
    image: { width: w, height: h, data: out },
    wb_gains: [round4(wb[0]), round4(wb[1]), round4(wb[2])],
    wb_applied: wbApplied,
    wb_reason: wbApplied
      ? `garment chroma C* ${chroma} <= ${p.wb_max_chroma}: near-neutral, gray-world WB applied`
      : `garment chroma C* ${chroma} > ${p.wb_max_chroma}: coloured garment, gray-world WB skipped`,
    garment_chroma: chroma,
    gain_applied: count > 0 ? [round4(gmin), round4(gmax)] : [1, 1],
    correction_delta_e: round4(count > 0 ? de / count : 0),
  };
}

// ---------- §7 quality pre-check ----------

export interface QualityRecord {
  readonly checks: Readonly<Record<string, { value: number | readonly number[]; threshold: number | string; pass: boolean }>>;
  readonly lighting: "even" | "uneven-corrected";
  readonly shadow_score: number;
}

function qualityChecks(src: RgbImage, cleaned: CleanedMask, L: Float64Array, scale: number, p: V2Params): { record: QualityRecord; failed: QualityCheck | null } {
  const { width: w, height: h } = src;
  const m = cleaned.mask.data;
  let area = 0, clipped = 0;
  for (let i = 0; i < w * h; i++) {
    if (!m[i]) continue;
    area++;
    const r = src.data[i * 3]!, g = src.data[i * 3 + 1]!, b = src.data[i * 3 + 2]!;
    if (r >= p.clip_hi || g >= p.clip_hi || b >= p.clip_hi || (r <= p.clip_lo && g <= p.clip_lo && b <= p.clip_lo)) clipped++;
  }
  const border = (len: number, at: (k: number) => number): number => {
    let s = 0;
    for (let k = 0; k < len; k++) s += m[at(k)]!;
    return s / len;
  };
  const shares = [border(w, (x) => x), border(h, (y) => y * w + w - 1), border(w, (x) => (h - 1) * w + x), border(h, (y) => y * w)].map(round4);
  const touched = shares.filter((s) => s > 0).length;
  const shadow = round4(shadowScore(L, cleaned.mask));
  const coverage = round4(area / (w * h));
  const clipShare = round4(area > 0 ? clipped / area : 0);
  const checks = {
    fragmentation: { value: cleaned.record.components_before, threshold: p.frag_max, pass: cleaned.record.components_before <= p.frag_max },
    coverage: { value: coverage, threshold: p.cov_min, pass: coverage >= p.cov_min },
    edge_touch: { value: shares, threshold: `${p.edge_max_borders} borders, ${p.edge_max_share} of any border`, pass: touched <= p.edge_max_borders && shares.every((s) => s <= p.edge_max_share) },
    clipped: { value: clipShare, threshold: p.clip_max, pass: clipShare <= p.clip_max },
    shadow: { value: shadow, threshold: p.shadow_max, pass: shadow <= p.shadow_max },
    resolution: { value: round4(scale), threshold: p.max_upscale, pass: scale <= p.max_upscale },
  };
  const order: QualityCheck[] = ["fragmentation", "coverage", "edge_touch", "clipped", "shadow", "resolution"];
  const failed = order.find((k) => !checks[k as keyof typeof checks].pass) ?? null;
  return { record: { checks, lighting: shadow > p.shadow_uneven ? "uneven-corrected" : "even", shadow_score: shadow }, failed };
}

// ---------- §8 resampling ----------

interface Taps {
  readonly start: Int32Array;
  readonly weights: Float64Array[];
}

/** Per output index, the source taps: area-averaging when shrinking, bilinear (edge-clamped) when growing. */
function taps(srcLen: number, dstLen: number): Taps {
  const s = dstLen / srcLen;
  const start = new Int32Array(dstLen);
  const weights: Float64Array[] = [];
  for (let o = 0; o < dstLen; o++) {
    if (s < 1) {
      const a = o / s, b = (o + 1) / s;
      const i0 = Math.floor(a), i1 = Math.min(srcLen, Math.ceil(b));
      const wts = new Float64Array(i1 - i0);
      for (let i = i0; i < i1; i++) wts[i - i0] = (Math.min(b, i + 1) - Math.max(a, i)) * s;
      start[o] = i0;
      weights.push(wts);
    } else {
      const c = clamp((o + 0.5) / s - 0.5, 0, srcLen - 1);
      const i0 = Math.min(Math.floor(c), Math.max(0, srcLen - 2));
      const f = c - i0;
      start[o] = i0;
      weights.push(srcLen === 1 ? Float64Array.of(1) : Float64Array.of(1 - f, f));
    }
  }
  return { start, weights };
}

/** Separable resample of planar float channels from sw x sh to dw x dh. */
function resample(planes: Float64Array[], sw: number, sh: number, dw: number, dh: number): Float64Array[] {
  const tx = taps(sw, dw), ty = taps(sh, dh);
  return planes.map((src) => {
    const mid = new Float64Array(dw * sh);
    for (let y = 0; y < sh; y++) {
      for (let o = 0; o < dw; o++) {
        const wts = tx.weights[o]!;
        const s0 = tx.start[o]!;
        let v = 0;
        for (let k = 0; k < wts.length; k++) v += src[y * sw + s0 + k]! * wts[k]!;
        mid[y * dw + o] = v;
      }
    }
    const out = new Float64Array(dw * dh);
    for (let o = 0; o < dh; o++) {
      const wts = ty.weights[o]!;
      const s0 = ty.start[o]!;
      for (let x = 0; x < dw; x++) {
        let v = 0;
        for (let k = 0; k < wts.length; k++) v += mid[(s0 + k) * dw + x]! * wts[k]!;
        out[o * dw + x] = v;
      }
    }
    return out;
  });
}

/** Chamfer (3-4) distance in pixels from each inside pixel to the nearest outside pixel or frame edge. */
function insideDistance(inside: Uint8Array, w: number, h: number): Float64Array {
  const BIG = 1 << 29;
  const d = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = inside[i] ? BIG : 0;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  return Float64Array.from(d, (v) => v / 3);
}

/** The studio sweep: vertical gradient top to bottom, plus a radial lift at the centre. A pure function of (x, y). */
export function backdrop(p: V2Params = V2_PARAMS): Float64Array {
  const W = p.out_w, H = p.out_h;
  const out = new Float64Array(W * H * 3);
  const half = Math.sqrt(2);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - W / 2) / (W / 2), dy = (y + 0.5 - H / 2) / (H / 2);
      const lift = 1 + p.radial_lift * Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / half);
      for (let c = 0; c < 3; c++) out[(y * W + x) * 3 + c] = (p.backdrop_top[c]! + (p.backdrop_bottom[c]! - p.backdrop_top[c]!) * t) * lift;
    }
  }
  return out;
}

// ---------- the whole composite ----------

export interface CompositeV2Result {
  readonly png: Uint8Array;
  readonly image: RgbImage;
  /** 1 where the seller's garment is in the output (not the insert, not the backdrop). */
  readonly renderMask: Mask;
  /** Every parameter and measured value, for the receipt's render entry. */
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * SPEC-composite-v2 §2 in fixed order: mask cleanup, quality pre-check,
 * flattening + WB, ghost assembly (insert, rotation), framing, shading, encode.
 * A failed check throws CompositeQualityReview; a bad mask throws CompositeError.
 */
export function compositeV2(src: RgbImage, mask: Mask, p: V2Params = V2_PARAMS): CompositeV2Result {
  const { width: w, height: h } = src;
  if (mask.width !== w || mask.height !== h) throw new CompositeError(`mask is ${mask.width}x${mask.height}, the photo is ${w}x${h}`);
  const W = p.out_w, H = p.out_h;

  // §3
  const cleaned = cleanMask(mask, p);
  const m = cleaned.mask;
  const box = bboxOf(m.data, w, h)!;
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;

  // §7 (before rendering, on the original photo and the cleaned mask)
  const illumR = Math.max(1, Math.round(p.illum_r * bh));
  const L = illumination(src, m, illumR);
  const availW = W * (1 - 2 * p.margin_side), availH = H * (1 - p.margin_top - p.margin_bottom);
  const scale = Math.min(availW / bw, availH / bh);
  const qc = qualityChecks(src, cleaned, L, scale, p);
  const base: Record<string, unknown> = { version: COMPOSITE_V2_MODEL, ...p, mask_cleanup: cleaned.record, quality: qc.record, illum_r_px: illumR };
  if (qc.failed) throw new CompositeQualityReview(qc.failed, base);

  // §5
  const corr = correctGarment(src, m, L, p);
  const shadowAfter = round4(shadowScore(illumination(corr.image, m, illumR), m));
  const colour = { wb_applied: corr.wb_applied, wb_reason: corr.wb_reason, garment_chroma: corr.garment_chroma, wb_max_chroma: p.wb_max_chroma, wb_gains: corr.wb_gains, gain_applied: corr.gain_applied, correction_delta_e: corr.correction_delta_e, shadow_score_after: shadowAfter, note: V2_CORRECTION_NOTE };
  if (corr.correction_delta_e > p.max_corr_de) throw new CompositeQualityReview("correction", { ...base, colour });

  // §4 ghost assembly at source scale: garment + neck insert, feathered inward.
  const neck = neckRegion(m, p);
  const union = new Uint8Array(m.data);
  let insertColour: number[] | null = null;
  let back: ReturnType<typeof backNeckInsert> | null = null;
  const layer = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) if (m.data[i]) for (let c = 0; c < 3; c++) layer[i * 3 + c] = corr.image.data[i * 3 + c]!;
  if (neck) {
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let count = 0;
    for (let i = 0; i < w * h; i++) {
      if (!m.data[i]) continue;
      count++;
      for (let c = 0; c < 3; c++) hist[c]![corr.image.data[i * 3 + c]!]!++;
    }
    const median = hist.map((hc) => {
      let s = 0;
      for (let v = 0; v < 256; v++) if ((s += hc[v]!) * 2 >= count) return v;
      return 255;
    });
    insertColour = median.map((v) => byte(v * p.insert_darken));
    const nb = neck.bbox;
    back = backNeckInsert(neck, w, p);
    for (let x = nb.x0; x < nb.x1; x++) {
      const yArc = back.top[x - nb.x0]!;
      for (let y = Math.ceil(yArc); y < nb.y1; y++) {
        const i = y * w + x;
        if (!back.mask[i]) continue;
        // Darker just under the back collar's edge, lighter towards the bottom of the opening.
        const t = nb.y1 - yArc > 1 ? (y - yArc) / (nb.y1 - yArc - 1) : 1;
        const f = 1 - p.insert_gradient + p.insert_gradient * Math.min(1, t);
        union[i] = 1;
        for (let c = 0; c < 3; c++) layer[i * 3 + c] = byte(insertColour[c]! * f);
      }
    }
  }
  const feather = blur3(Float64Array.from(union), w, h, p.feather_r);
  let rgbaAll: Rgba = { width: w, height: h, data: new Uint8Array(w * h * 4) };
  let rgbaGarment: Rgba = { width: w, height: h, data: new Uint8Array(w * h * 4) };
  for (let i = 0; i < w * h; i++) {
    if (!union[i]) continue;
    const a = byte(feather[i]! * 255);
    for (let c = 0; c < 3; c++) rgbaAll.data[i * 4 + c] = rgbaGarment.data[i * 4 + c] = layer[i * 3 + c]!;
    rgbaAll.data[i * 4 + 3] = a;
    rgbaGarment.data[i * 4 + 3] = m.data[i] ? a : 0;
  }

  // Rotation: by the dominant axis angle, only when 0.5 deg <= |angle| <= 4 deg.
  let mx = 0, my = 0, cnt = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m.data[y * w + x]) { mx += x; my += y; cnt++; }
  mx /= cnt;
  my /= cnt;
  let m20 = 0, m02 = 0, m11 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m.data[y * w + x]) continue;
      m20 += (x - mx) * (x - mx);
      m02 += (y - my) * (y - my);
      m11 += (x - mx) * (y - my);
    }
  }
  const thetaDeg = (0.5 * Math.atan2(2 * m11, m20 - m02) * 180) / Math.PI;
  const angle = round4(thetaDeg - 90 * Math.round(thetaDeg / 90));
  const rotate = Math.abs(angle) >= p.min_rotate_deg && Math.abs(angle) <= p.max_rotate_deg;
  if (rotate) {
    const rad = (-angle * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rot = ([x, y]: readonly [number, number]): [number, number] => [mx + (x - mx) * cos - (y - my) * sin, my + (x - mx) * sin + (y - my) * cos];
    const from: Quad = [[0, 0], [w, 0], [w, h], [0, h]];
    const to = from.map(rot) as unknown as Quad;
    rgbaAll = warp(rgbaAll, from, to, w, h);
    rgbaGarment = warp(rgbaGarment, from, to, w, h);
  }

  // §8 framing: crop to the layer, scale to fit the margins, centre on the garment's centroid column.
  const alphaAll = Float64Array.from({ length: w * h }, (_, i) => rgbaAll.data[i * 4 + 3]!);
  const crop = bboxOf(alphaAll, w, h);
  if (!crop) throw new CompositeError("no garment mask: nothing is left after assembly");
  const cw = crop.x1 - crop.x0, ch = crop.y1 - crop.y0;
  const s = Math.min(availW / cw, availH / ch);
  if (s > p.max_upscale) throw new CompositeQualityReview("resolution", { ...base, colour });
  const tw = Math.max(1, Math.round(cw * s)), th = Math.max(1, Math.round(ch * s));
  const planes = [0, 1, 2, 3, 4].map(() => new Float64Array(cw * ch));
  let gx = 0, gn = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (crop.y0 + y) * w + crop.x0 + x;
      const j = y * cw + x;
      const a = rgbaAll.data[i * 4 + 3]! / 255;
      for (let c = 0; c < 3; c++) planes[c]![j] = rgbaAll.data[i * 4 + c]! * a;
      planes[3]![j] = a;
      const ag = rgbaGarment.data[i * 4 + 3]! / 255;
      planes[4]![j] = ag;
      gx += x * ag;
      gn += ag;
    }
  }
  const [pr, pg, pb, pa, pga] = resample(planes, cw, ch, tw, th) as [Float64Array, Float64Array, Float64Array, Float64Array, Float64Array];
  const centroidX = gn > 0 ? ((gx / gn + 0.5) * tw) / cw : tw / 2;
  const ox = clamp(Math.round(W / 2 - centroidX), 0, W - tw);
  const oy = Math.round(H * p.margin_top + (availH - th) / 2);

  // Output-frame planes.
  const A = new Float64Array(W * H);
  const AG = new Float64Array(W * H);
  const col = new Float64Array(W * H * 3);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const j = y * tw + x;
      const i = (oy + y) * W + ox + x;
      const a = clamp(pa[j]!, 0, 1);
      A[i] = a;
      AG[i] = clamp(pga[j]!, 0, 1);
      if (pa[j]! > 0) {
        col[i * 3] = pr[j]! / pa[j]!;
        col[i * 3 + 1] = pg[j]! / pa[j]!;
        col[i * 3 + 2] = pb[j]! / pa[j]!;
      }
    }
  }

  // §6 shading on real pixels: depth gradient top to bottom, and a rim inside the edge.
  const gInside = Uint8Array.from(AG, (v) => (v >= 0.5 ? 1 : 0));
  const gBox = bboxOf(gInside, W, H) ?? { x0: ox, y0: oy, x1: ox + tw, y1: oy + th };
  const dist = insideDistance(gInside, W, H);
  const edgeD = p.edge_d * W;
  for (let y = gBox.y0; y < gBox.y1; y++) {
    const t = gBox.y1 - gBox.y0 > 1 ? (y - gBox.y0) / (gBox.y1 - gBox.y0 - 1) : 0;
    const grad = 1 - (1 - p.grad_bottom) * t;
    for (let x = gBox.x0; x < gBox.x1; x++) {
      const i = y * W + x;
      if (!(AG[i]! > 0)) continue;
      const rim = gInside[i] && dist[i]! < edgeD ? 1 - p.rim * (1 - dist[i]! / edgeD) : 1;
      for (let c = 0; c < 3; c++) col[i * 3 + c] = col[i * 3 + c]! * grad * rim;
    }
  }

  // Drop shadow from the layer's alpha, and a ground ellipse under the hem.
  const dy = Math.round(p.sh_dy * H);
  const shR = Math.round(p.sh_r * H);
  const shifted = new Float64Array(W * H);
  for (let y = dy; y < H; y++) for (let x = 0; x < W; x++) shifted[y * W + x] = A[(y - dy) * W + x]!;
  const shadow = blur3(shifted, W, H, shR);
  const hemRows = Math.max(1, Math.round((gBox.y1 - gBox.y0) * 0.02));
  let hx0 = W, hx1 = -1;
  for (let y = gBox.y1 - hemRows; y < gBox.y1; y++) for (let x = gBox.x0; x < gBox.x1; x++) if (gInside[y * W + x]) { if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; }
  const hemW = hx1 >= hx0 ? hx1 - hx0 + 1 : gBox.x1 - gBox.x0;
  const hemCx = hx1 >= hx0 ? (hx0 + hx1 + 1) / 2 : (gBox.x0 + gBox.x1) / 2;
  const rx = (p.ground_w * hemW) / 2, ry = (p.ground_h * H) / 2;
  const ground = new Float64Array(W * H);
  for (let y = Math.max(0, Math.floor(gBox.y1 - ry)); y < Math.min(H, Math.ceil(gBox.y1 + ry)); y++) {
    for (let x = Math.max(0, Math.floor(hemCx - rx)); x < Math.min(W, Math.ceil(hemCx + rx)); x++) {
      const ex = (x + 0.5 - hemCx) / rx, ey = (y + 0.5 - gBox.y1) / ry;
      if (ex * ex + ey * ey <= 1) ground[y * W + x] = 1;
    }
  }
  const groundBlur = blur3(ground, W, H, shR);

  const bg = backdrop(p);
  const out = new Uint8Array(W * H * 3);
  const renderMask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const dark = (1 - p.sh_a * shadow[i]!) * (1 - p.ground_a * groundBlur[i]!);
    const a = A[i]!;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = byte(col[i * 3 + c]! * a + bg[i * 3 + c]! * dark * (1 - a));
    renderMask[i] = Math.round(AG[i]! * 255) > 0 ? 1 : 0;
  }

  const params = {
    ...base,
    colour,
    insert: neck && back ? { present: true, shape: "curved-back", bbox: [neck.bbox.x0, neck.bbox.y0, neck.bbox.x1, neck.bbox.y1], opening_px: neck.px, px: back.px, colour: insertColour } : { present: false, bbox: null, px: 0, colour: null },
    rotation: { angle_deg: angle, applied: rotate },
    crop_box: [crop.x0, crop.y0, crop.x1, crop.y1],
    scale: round4(s),
    placed_box: [ox, oy, ox + tw, oy + th],
    output: [W, H],
  };
  return { png: encodeRgbPng(W, H, out), image: { width: W, height: H, data: out }, renderMask: { width: W, height: H, data: renderMask }, params };
}
