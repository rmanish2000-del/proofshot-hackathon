// Evidence-checking agent: a local photo check (no model, no network). Resolution and exposure come straight from
// the pixels; blur is the variance of a 3x3 Laplacian on a downscaled grey copy (low variance = few sharp edges).
// Crop needs a garment mask, which this check does not have, so it reports crop as not checked rather than guess.
// Thresholds are starting values set on the committed garment photos (all pass), not a calibrated blur model.

import { decodeRgb } from "../image.ts";

export interface QualityThresholds {
  readonly minShortSide: number;
  readonly minMeanLuma: number;
  readonly maxMeanLuma: number;
  readonly minSharpness: number;
}

export const QUALITY: QualityThresholds = Object.freeze({ minShortSide: 640, minMeanLuma: 40, maxMeanLuma: 220, minSharpness: 200 });

export type QualityIssue = "low_resolution" | "too_dark" | "too_bright" | "blurry" | "not_an_image";

export interface QualityReport {
  readonly width: number;
  readonly height: number;
  readonly mean_luma: number;
  readonly sharpness: number;
  readonly crop: "not checked (no garment mask)";
  readonly issues: readonly QualityIssue[];
}

export function checkPhotoQuality(bytes: Uint8Array, t: QualityThresholds = QUALITY): QualityReport {
  let img;
  try {
    img = decodeRgb(bytes);
  } catch {
    return { width: 0, height: 0, mean_luma: 0, sharpness: 0, crop: "not checked (no garment mask)", issues: ["not_an_image"] };
  }
  const { width, height, data } = img;
  // Grey copy at most ~512 px on the long side, by striding (enough for exposure and edge energy).
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 512));
  const w = Math.floor(width / step);
  const h = Math.floor(height / step);
  const grey = new Float32Array(w * h);
  let sum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * step * width + x * step) * 3;
      const l = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      grey[y * w + x] = l;
      sum += l;
    }
  }
  const mean = sum / (w * h);
  let lsum = 0;
  let lsq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = y * w + x;
      const lap = grey[c - w]! + grey[c + w]! + grey[c - 1]! + grey[c + 1]! - 4 * grey[c]!;
      lsum += lap;
      lsq += lap * lap;
      n++;
    }
  }
  const sharpness = n > 0 ? lsq / n - (lsum / n) ** 2 : 0;
  const issues: QualityIssue[] = [];
  if (Math.min(width, height) < t.minShortSide) issues.push("low_resolution");
  if (mean < t.minMeanLuma) issues.push("too_dark");
  if (mean > t.maxMeanLuma) issues.push("too_bright");
  if (sharpness < t.minSharpness) issues.push("blurry");
  return { width, height, mean_luma: Math.round(mean * 10) / 10, sharpness: Math.round(sharpness * 10) / 10, crop: "not checked (no garment mask)", issues };
}
