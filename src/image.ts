// Product photos and renders to RGB pixels for the fidelity check (SPEC §10).
//
// PNG goes through the in-house reader (png.ts); JPEG through jpeg-js 0.4.4
// (open-source dependency, BSD-3-Clause), decode only. Anything else, or a file
// either decoder rejects, throws ImageError with the reason rather than guessing.

import jpeg from "jpeg-js";

import { decodePng, rgbFromPng } from "./png.ts";
import type { RgbImage } from "./png.ts";
import { imageExt } from "./render.ts";

export class ImageError extends Error {
  override name = "ImageError";
}

/** Same cap as png.ts: 50 million pixels. */
const MAX_MP = 50;

/** The RGB pixels of a JPEG or PNG. EXIF orientation is not applied here: intake turned the pixels upright before stripping the tag (EX1), and SAM saw the same bytes. */
export function decodeRgb(bytes: Uint8Array): RgbImage {
  const ext = imageExt(bytes);
  if (ext === "png") return rgbFromPng(decodePng(bytes));
  if (ext !== "jpg") throw new ImageError("not a JPEG or PNG");
  let raw: { width: number; height: number; data: Uint8Array };
  try {
    raw = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: MAX_MP });
  } catch (err) {
    throw new ImageError(`JPEG did not decode: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!raw.width || !raw.height || raw.data.length !== raw.width * raw.height * 3) {
    throw new ImageError(`JPEG decoded to ${raw.data.length} bytes for ${raw.width}x${raw.height}, not 3 per pixel`);
  }
  return { width: raw.width, height: raw.height, data: raw.data };
}
