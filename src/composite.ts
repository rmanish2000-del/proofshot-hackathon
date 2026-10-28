// The composite renderer's pixels (SPEC-render-fix, NR1): the seller's own
// garment, cut out of the front photo with its SAM mask, warped onto a body
// template we own, and laid over it. No image model runs and no garment pixel is
// invented: every garment pixel in the output is a bilinear sample of the
// seller's photo, and every other pixel is the template's.
//
// Deterministic by construction: plain float arithmetic (no Math.exp/sin, no
// canvas, sharp or GPU), Math.round at every output pixel, integer feather and
// blend, and a PNG encoder whose bytes depend only on the pixels. The same
// inputs give the same PNG on every run.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { decodePng, encodeRgbPng, rgbFromPng } from "./png.ts";
import type { Mask, RgbImage } from "./png.ts";
import { sha256Hex } from "./util.ts";

/** An 8-bit RGBA image, row-major, 4 bytes per pixel. */
export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export type Point = readonly [number, number];
/** Corners in order top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Point, Point, Point, Point];

export class CompositeError extends Error {
  override name = "CompositeError";
}

export const COMPOSITE_MODEL = "composite-v1";
export const FEATHER_PX = 3;
export const WARP = "homography-bilinear";

export interface Anchors {
  readonly kind: "mannequin" | "model";
  readonly torso_quad: Quad;
  readonly occluders: string | null;
  readonly source: string;
  readonly licence: string;
}

export interface Template {
  readonly id: string;
  readonly kind: Anchors["kind"];
  readonly base: RgbImage;
  readonly torsoQuad: Quad;
  readonly occluder: Rgba | null;
  readonly licence: string;
  readonly sha256_base: string;
  readonly sha256_anchors: string;
}

const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Reads and checks an anchors.json body; anything off throws CompositeError. */
export function parseAnchors(text: string): Anchors {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new CompositeError("anchors.json is not JSON");
  }
  const a = v as Partial<Record<keyof Anchors, unknown>> | null;
  if (!a || typeof a !== "object") throw new CompositeError("anchors.json is not an object");
  if (a.kind !== "mannequin" && a.kind !== "model") throw new CompositeError("anchors.json kind must be mannequin or model");
  const q = a.torso_quad;
  const isPoint = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n));
  if (!Array.isArray(q) || q.length !== 4 || !q.every(isPoint)) throw new CompositeError("anchors.json torso_quad must be four [x, y] points");
  if (a.occluders !== null && typeof a.occluders !== "string") throw new CompositeError("anchors.json occluders must be a file name or null");
  if (typeof a.source !== "string" || !a.source.trim()) throw new CompositeError("anchors.json source is missing");
  if (typeof a.licence !== "string" || !a.licence.trim()) throw new CompositeError("anchors.json licence is missing");
  return { kind: a.kind, torso_quad: q as unknown as Quad, occluders: a.occluders, source: a.source, licence: a.licence };
}

/**
 * A template from its files' bytes. base.png must be RGB(A); the torso quad
 * must lie inside it; a missing or empty licence text, bad anchors, or a
 * declared occluder that is not given are refused here, before any job.
 */
export function templateFromFiles(id: string, files: { base: Uint8Array; anchors: Uint8Array; licence: Uint8Array | null; occluder?: Uint8Array | null }): Template {
  if (!TEMPLATE_ID.test(id)) throw new CompositeError(`template id ${JSON.stringify(id)} is not a safe name`);
  if (!files.licence || Buffer.from(files.licence).toString("utf8").trim() === "") throw new CompositeError(`template ${id} has no LICENSE.txt`);
  const anchors = parseAnchors(Buffer.from(files.anchors).toString("utf8"));
  let base: RgbImage;
  try {
    base = rgbFromPng(decodePng(files.base));
  } catch (err) {
    throw new CompositeError(`template ${id} base.png: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const [x, y] of anchors.torso_quad) {
    if (x < 0 || y < 0 || x > base.width || y > base.height) throw new CompositeError(`template ${id} torso_quad point ${x},${y} is outside the ${base.width}x${base.height} base`);
  }
  let occluder: Rgba | null = null;
  if (anchors.occluders !== null) {
    if (!files.occluder) throw new CompositeError(`template ${id} names occluder ${anchors.occluders} but it is missing`);
    const png = decodePng(files.occluder);
    if (png.channels !== 4 || png.width !== base.width || png.height !== base.height) throw new CompositeError(`template ${id} occluder must be RGBA at the base size`);
    occluder = { width: png.width, height: png.height, data: png.data };
  }
  return {
    id,
    kind: anchors.kind,
    base,
    torsoQuad: anchors.torso_quad,
    occluder,
    licence: anchors.licence,
    sha256_base: sha256Hex(files.base),
    sha256_anchors: sha256Hex(files.anchors),
  };
}

/** Loads `<dir>` = templates/<id>/: base.png, anchors.json, LICENSE.txt, and the occluder if named. */
export function loadTemplate(dir: string, id: string): Template {
  const read = (name: string): Uint8Array | null => (existsSync(join(dir, name)) ? new Uint8Array(readFileSync(join(dir, name))) : null);
  const base = read("base.png");
  const anchors = read("anchors.json");
  if (!base) throw new CompositeError(`template ${id} has no base.png`);
  if (!anchors) throw new CompositeError(`template ${id} has no anchors.json`);
  const parsed = parseAnchors(Buffer.from(anchors).toString("utf8"));
  if (parsed.occluders !== null && !/^[A-Za-z0-9._-]+$/.test(parsed.occluders)) throw new CompositeError(`template ${id} occluder name is not a plain file name`);
  return templateFromFiles(id, { base, anchors, licence: read("LICENSE.txt"), occluder: parsed.occluders ? read(parsed.occluders) : null });
}

/**
 * The garment cut out: RGB from the photo, alpha from the mask. The edge is
 * feathered inward only: alpha is a (2·feather+1)² integer box mean of the
 * mask, and 0 wherever the mask is 0, so no pixel outside the mask is ever
 * carried over.
 */
export function cutout(src: RgbImage, mask: Mask, featherPx: number = FEATHER_PX): Rgba {
  const { width: w, height: h } = src;
  if (mask.width !== w || mask.height !== h) throw new CompositeError(`mask is ${mask.width}x${mask.height}, the photo is ${w}x${h}`);
  if (!Number.isInteger(featherPx) || featherPx < 0) throw new CompositeError(`feather ${featherPx} is not a whole number of pixels`);
  const alpha = new Uint8Array(w * h);
  if (featherPx === 0) {
    for (let i = 0; i < alpha.length; i++) alpha[i] = mask.data[i] ? 255 : 0;
  } else {
    // Separable box mean of the 0/1 mask, out-of-frame counted as 0, in integers.
    const r = featherPx;
    const n = 2 * r + 1;
    const rows = new Uint32Array(w * h);
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = -r; x <= r; x++) if (x >= 0 && x < w) s += mask.data[y * w + x] ? 1 : 0;
      for (let x = 0; x < w; x++) {
        rows[y * w + x] = s;
        const out = x - r;
        const inn = x + r + 1;
        if (out >= 0) s -= mask.data[y * w + out] ? 1 : 0;
        if (inn < w) s += mask.data[y * w + inn] ? 1 : 0;
      }
    }
    const total = n * n;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) if (y >= 0 && y < h) s += rows[y * w + x]!;
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        alpha[i] = mask.data[i] ? Math.floor((s * 255 + (total >> 1)) / total) : 0;
        const out = y - r;
        const inn = y + r + 1;
        if (out >= 0) s -= rows[out * w + x]!;
        if (inn < h) s += rows[inn * w + x]!;
      }
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = src.data[i * 3]!;
    data[i * 4 + 1] = src.data[i * 3 + 1]!;
    data[i * 4 + 2] = src.data[i * 3 + 2]!;
    data[i * 4 + 3] = alpha[i]!;
  }
  return { width: w, height: h, data };
}

/** The mask's tight axis-aligned box as a quad (pixel edges, half-open). An empty mask throws. */
export function garmentQuad(mask: Mask): Quad {
  let minX = mask.width, minY = mask.height, maxX = -1, maxY = -1;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!mask.data[y * mask.width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new CompositeError("no garment mask: the mask is empty");
  return [[minX, minY], [maxX + 1, minY], [maxX + 1, maxY + 1], [minX, maxY + 1]];
}

/**
 * Where the garment goes: its box scaled to fit the template's torso quad
 * (taken as its bounding rectangle), aspect kept, centred across and hung from
 * the top (the shoulder line). Whole-pixel corners, so the quad is exact.
 */
export function fitQuad(from: Quad, torso: Quad): Quad {
  const fw = from[1][0] - from[0][0];
  const fh = from[3][1] - from[0][1];
  const xs = torso.map((p) => p[0]);
  const ys = torso.map((p) => p[1]);
  const tx = Math.min(...xs), ty = Math.min(...ys);
  const tw = Math.max(...xs) - tx, th = Math.max(...ys) - ty;
  if (fw <= 0 || fh <= 0 || tw <= 0 || th <= 0) throw new CompositeError("cannot fit an empty box");
  const scale = Math.min(tw / fw, th / fh);
  const w = Math.round(fw * scale);
  const h = Math.round(fh * scale);
  const x0 = tx + Math.round((tw - w) / 2);
  const y0 = ty;
  return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
}

/**
 * The 3x3 homography (h33 = 1) taking each `from` corner to its `to` corner,
 * by Gaussian elimination with partial pivoting on the fixed 8x8 system.
 */
export function homography(from: Quad, to: Quad): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]!;
    const [u, v] = to[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    if (Math.abs(A[p]![c]!) < 1e-12) throw new CompositeError("the quads are degenerate: no homography");
    [A[c], A[p]] = [A[p]!, A[c]!];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      if (f === 0) continue;
      for (let k = c; k < 9; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  const h = A.map((row, i) => row[8]! / row[i]!);
  return [...h, 1];
}

/**
 * Warps `img` so its `fromQuad` lands on `toQuad` in an outW x outH canvas.
 * Each output pixel centre is mapped back through the inverse homography and
 * sampled bilinearly with premultiplied alpha; samples outside the image are
 * transparent. Coordinates within 1e-9 of a pixel centre snap to it, so an
 * identity warp copies pixels exactly.
 */
export function warp(img: Rgba, fromQuad: Quad, toQuad: Quad, outW: number, outH: number): Rgba {
  const H = homography(toQuad, fromQuad); // output -> source
  const out = new Uint8Array(outW * outH * 4);
  const { width: w, height: h, data } = img;
  const snap = (t: number): number => (Math.abs(t - Math.round(t)) < 1e-9 ? Math.round(t) : t);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const X = ox + 0.5, Y = oy + 0.5;
      const d = H[6]! * X + H[7]! * Y + H[8]!;
      if (d === 0) continue;
      const sx = snap((H[0]! * X + H[1]! * Y + H[2]!) / d - 0.5);
      const sy = snap((H[3]! * X + H[4]! * Y + H[5]!) / d - 0.5);
      if (sx <= -1 || sy <= -1 || sx >= w || sy >= h) continue;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      let a = 0, r = 0, g = 0, b = 0;
      for (const [px, py, wt] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]] as const) {
        if (wt === 0 || px < 0 || py < 0 || px >= w || py >= h) continue;
        const p = (py * w + px) * 4;
        const pa = data[p + 3]! * wt;
        a += pa;
        r += data[p]! * pa;
        g += data[p + 1]! * pa;
        b += data[p + 2]! * pa;
      }
      const A = Math.round(a);
      if (A === 0) continue;
      const q = (oy * outW + ox) * 4;
      out[q] = Math.round(r / a);
      out[q + 1] = Math.round(g / a);
      out[q + 2] = Math.round(b / a);
      out[q + 3] = A;
    }
  }
  return { width: outW, height: outH, data: out };
}

function over(dst: Uint8Array, i3: number, src: Uint8Array, i4: number): void {
  const a = src[i4 + 3]!;
  if (a === 0) return;
  for (let c = 0; c < 3; c++) dst[i3 + c] = Math.floor((src[i4 + c]! * a + dst[i3 + c]! * (255 - a) + 127) / 255);
}

/** Alpha-over of the warped garment on the base, then the occluder (if any) on top. Integer arithmetic. */
export function blend(base: RgbImage, warped: Rgba, occluder: Rgba | null = null): RgbImage {
  if (warped.width !== base.width || warped.height !== base.height) throw new CompositeError("the warped garment is not the base's size");
  const data = new Uint8Array(base.data);
  for (let i = 0; i < base.width * base.height; i++) over(data, i * 3, warped.data, i * 4);
  if (occluder) for (let i = 0; i < base.width * base.height; i++) over(data, i * 3, occluder.data, i * 4);
  return { width: base.width, height: base.height, data };
}

export interface CompositeResult {
  readonly png: Uint8Array;
  readonly image: RgbImage;
  readonly quad_from: Quad;
  readonly quad_to: Quad;
  /** The source mask carried to the output frame: 1 where the warped garment has any alpha. */
  readonly renderMask: Mask;
}

/** The whole composite: cutout, box, fit, warp, blend, encode. */
export function composite(src: RgbImage, mask: Mask, template: Template, featherPx: number = FEATHER_PX): CompositeResult {
  const quad_from = garmentQuad(mask);
  const quad_to = fitQuad(quad_from, template.torsoQuad);
  const warped = warp(cutout(src, mask, featherPx), quad_from, quad_to, template.base.width, template.base.height);
  const image = blend(template.base, warped, template.occluder);
  const renderMask = new Uint8Array(image.width * image.height);
  for (let i = 0; i < renderMask.length; i++) renderMask[i] = warped.data[i * 4 + 3]! > 0 ? 1 : 0;
  return { png: encodeRgbPng(image.width, image.height, image.data), image, quad_from, quad_to, renderMask: { width: image.width, height: image.height, data: renderMask } };
}
