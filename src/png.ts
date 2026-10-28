// A small PNG reader for SAM masks and product photos (SPEC §10), no dependencies.
//
// Reads 8-bit, non-interlaced greyscale, grey+alpha, RGB and RGBA. Anything else
// (palette, 16-bit, interlaced, a bad CRC, a truncated file) throws with the
// reason rather than guessing.

import { crc32, deflateSync, inflateSync } from "node:zlib";

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** 1 grey, 2 grey+alpha, 3 RGB, 4 RGBA. */
  readonly channels: 1 | 2 | 3 | 4;
  /** Row-major, `channels` bytes per pixel, no filter bytes. */
  readonly data: Uint8Array;
}

/** A binary mask: data[i] is 1 where pixel i is garment, else 0. */
export interface Mask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** An 8-bit RGB image, row-major, 3 bytes per pixel. */
export interface RgbImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS: Record<number, DecodedPng["channels"]> = { 0: 1, 4: 2, 2: 3, 6: 4 };
const MAX_PIXELS = 50_000_000;

export class PngError extends Error {
  override name = "PngError";
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new PngError("not a PNG: bad signature");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let header: { width: number; height: number; channels: DecodedPng["channels"] } | undefined;
  const idat: Uint8Array[] = [];
  let ended = false;

  for (let pos = 8; pos < bytes.length && !ended; ) {
    if (pos + 12 > bytes.length) throw new PngError("truncated chunk header");
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (pos + 12 + length > bytes.length) throw new PngError(`truncated ${type} chunk`);
    const body = bytes.subarray(pos + 8, pos + 8 + length);
    const crc = view.getUint32(pos + 8 + length);
    if (crc32(bytes.subarray(pos + 4, pos + 8 + length)) !== crc) throw new PngError(`bad CRC in ${type} chunk`);
    pos += 12 + length;

    if (type === "IHDR") {
      if (length !== 13) throw new PngError("bad IHDR length");
      const hv = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const width = hv.getUint32(0);
      const height = hv.getUint32(4);
      const [depth, colorType, compression, filter, interlace] = body.subarray(8, 13);
      if (width === 0 || height === 0 || width * height > MAX_PIXELS) throw new PngError(`unsupported size ${width}x${height}`);
      if (depth !== 8) throw new PngError(`unsupported bit depth ${depth}; only 8-bit is read`);
      const channels = CHANNELS[colorType as number];
      if (!channels) throw new PngError(`unsupported colour type ${colorType}; palette PNGs are not read`);
      if (compression !== 0 || filter !== 0) throw new PngError("unsupported compression or filter method");
      if (interlace !== 0) throw new PngError("interlaced PNGs are not read");
      header = { width, height, channels };
    } else if (type === "IDAT") {
      if (!header) throw new PngError("IDAT before IHDR");
      idat.push(body);
    } else if (type === "IEND") {
      ended = true;
    }
  }
  if (!header) throw new PngError("no IHDR chunk");
  if (!ended) throw new PngError("no IEND chunk");
  if (idat.length === 0) throw new PngError("no IDAT chunk");

  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    throw new PngError("image data does not inflate");
  }
  const { width, height, channels } = header;
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) throw new PngError(`image data is ${raw.length} bytes, expected ${height * (stride + 1)}`);

  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[row + x - channels]! : 0;
      const b = y > 0 ? out[row - stride + x]! : 0;
      const c = x >= channels && y > 0 ? out[row - stride + x - channels]! : 0;
      let predictor: number;
      switch (filterType) {
        case 0: predictor = 0; break;
        case 1: predictor = a; break;
        case 2: predictor = b; break;
        case 3: predictor = (a + b) >> 1; break;
        case 4: predictor = paeth(a, b, c); break;
        default: throw new PngError(`bad filter type ${filterType} on row ${y}`);
      }
      out[row + x] = (line[x]! + predictor) & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * A pixel is garment when its brightness and its alpha are both at least 128.
 * Brightness is the grey value, or for colour the Rec. 601 luma of R, G, B.
 */
export function maskFromPng(png: DecodedPng): Mask {
  const { width, height, channels, data } = png;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const p = i * channels;
    const brightness = channels >= 3 ? 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]! : data[p]!;
    const alpha = channels === 2 ? data[p + 1]! : channels === 4 ? data[p + 3]! : 255;
    out[i] = brightness >= 128 && alpha >= 128 ? 1 : 0;
  }
  return { width, height, data: out };
}

/** The RGB pixels of an RGB or RGBA PNG (alpha dropped). Greyscale throws: the check needs colour. */
export function rgbFromPng(png: DecodedPng): RgbImage {
  const { width, height, channels, data } = png;
  if (channels === 3) return { width, height, data };
  if (channels !== 4) throw new PngError("not a colour image: the fidelity check needs RGB");
  const out = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    out[j] = data[i]!;
    out[j + 1] = data[i + 1]!;
    out[j + 2] = data[i + 2]!;
  }
  return { width, height, data: out };
}

/**
 * An 8-bit greyscale, non-interlaced PNG of `data` (row-major, one byte per
 * pixel, filter 0 on every row), the form a SAM mask takes on its way to the
 * receipt (SPEC §10, #18): decodePng + maskFromPng read it back exactly.
 */
export function encodeGreyPng(width: number, height: number, data: Uint8Array): Uint8Array {
  return encodePng(width, height, 1, data);
}

/**
 * An 8-bit RGB, non-interlaced PNG of `data` (row-major, three bytes per pixel,
 * filter 0 on every row): the composite render's output (SPEC-render-fix §2).
 * The bytes depend only on the pixels, so the same image always hashes the same.
 */
export function encodeRgbPng(width: number, height: number, data: Uint8Array): Uint8Array {
  return encodePng(width, height, 3, data);
}

function encodePng(width: number, height: number, channels: 1 | 3, data: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new PngError(`cannot encode a ${width}x${height} PNG`);
  const stride = width * channels;
  if (data.length !== stride * height) throw new PngError(`PNG data is ${data.length} bytes, not ${width}x${height}x${channels}`);
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 1 ? 0 : 2; // greyscale or RGB
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    out.set(Buffer.from(type, "ascii"), 4);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const parts = [Uint8Array.from(SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}
