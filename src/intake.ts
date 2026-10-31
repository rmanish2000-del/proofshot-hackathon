// Garment intake: a phone JPEG in, the same JPEG out with its metadata removed,
// and both hashes recorded. Removal is lossless: every segment that carries
// image data is copied byte for byte, so the pixels do not change.
//
// Removed: APP1 (Exif with GPS and device, XMP), APP3..APP15 (IPTC and vendor
// data), COM, and any APP2 that is not an ICC profile (MPF). Kept: APP0 (JFIF)
// and the APP2 ICC profile, because without it a Display P3 phone photo is read
// as sRGB and its colour shifts, and colour is what the gate is checking.
//
// One exception to "the pixels do not change" (EX1, 31 Oct): a phone that saves
// a photo sideways and sets the Exif orientation tag (2 to 8) relies on the
// viewer to turn it. Stripping the tag would leave the stored photo sideways for
// SAM, the verifier and fidelity (the grey shirt's front on 31 Oct). So such a
// photo is decoded with jpeg-js, turned upright, and encoded again at quality
// ORIENTED_QUALITY with the original JFIF and ICC segments; the file records
// `orientation_applied`. A photo with no tag or tag 1 is stripped losslessly.

import jpeg from "jpeg-js";

import { sha256Hex } from "./util.ts";

export class JpegError extends Error {
  override name = "JpegError";
}

/** One file as intake wrote it. */
export interface IntakeFile {
  /** The file name the photo arrived with. */
  readonly source_name: string;
  /** The name it is stored under. */
  readonly name: string;
  /** sha256 of the bytes as they arrived. */
  readonly source_sha256: string;
  /** sha256 of the stored bytes: this is the hash a receipt's source_images carries. */
  readonly sha256: string;
  /** What was removed, in file order, e.g. "APP1 Exif". */
  readonly removed: readonly string[];
  /** The Exif orientation (2 to 8) turned into the pixels before the tag was removed; absent when none was. */
  readonly orientation_applied?: number;
}

interface JpegSegment {
  /** The marker byte after 0xFF. */
  readonly marker: number;
  readonly start: number;
  readonly end: number;
  /** Where the payload starts (after the length bytes), for segments that have one. */
  readonly payload?: number;
  /** For APPn and COM, a label for what it holds. */
  readonly label: string | null;
}

const ICC_ID = "ICC_PROFILE\0";

/** "1-front.jpg.jpg" and "1-front.JPEG" are both stored as "1-front.jpg". */
export function intakeName(sourceName: string): string {
  const base = sourceName.replace(/(\.jpe?g)+$/i, "");
  if (base === sourceName || base === "") throw new JpegError(`${JSON.stringify(sourceName)} is not named as a JPEG`);
  return `${base}.jpg`;
}

/** The metadata segments a JPEG carries, as labels; empty when there are none. */
export function jpegMetadata(bytes: Uint8Array): string[] {
  return segments(bytes).filter(isMetadata).map((s) => s.label!);
}

/** The JPEG with its metadata segments removed and everything else unchanged. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const kept = segments(bytes).filter((s) => !isMetadata(s));
  const out = new Uint8Array(kept.reduce((n, s) => n + s.end - s.start, 0));
  let at = 0;
  for (const s of kept) {
    out.set(bytes.subarray(s.start, s.end), at);
    at += s.end - s.start;
  }
  return out;
}

/** Strips one photo (turning it upright first if its Exif orientation says so) and records both hashes. */
export function intakeJpeg(sourceName: string, bytes: Uint8Array): { file: IntakeFile; bytes: Uint8Array } {
  const name = intakeName(sourceName);
  const removed = jpegMetadata(bytes);
  const orientation = exifOrientation(bytes);
  const stripped = orientation === 1 ? stripJpegMetadata(bytes) : orientJpeg(bytes, orientation);
  return {
    file: {
      source_name: sourceName, name, source_sha256: sha256Hex(bytes), sha256: sha256Hex(stripped), removed,
      ...(orientation === 1 ? {} : { orientation_applied: orientation }),
    },
    bytes: stripped,
  };
}

/** Quality for the one case intake re-encodes: a photo turned upright. */
export const ORIENTED_QUALITY = 95;

/**
 * The Exif orientation tag (0x0112) in IFD0 of the first APP1 Exif segment: 1 to 8. 1 (upright) when there is
 * no Exif, no tag, or anything malformed: a broken tag never turns a photo.
 */
export function exifOrientation(bytes: Uint8Array): number {
  const app1 = segments(bytes).find((s) => s.marker === 0xe1 && s.label === "APP1 Exif");
  if (!app1 || app1.payload === undefined) return 1;
  const tiff = app1.payload + 6; // after "Exif\0\0"
  const end = app1.end;
  if (tiff + 8 > end) return 1;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return 1;
  const u16 = (at: number) => (little ? bytes[at]! | (bytes[at + 1]! << 8) : (bytes[at]! << 8) | bytes[at + 1]!);
  const u32 = (at: number) => (little ? u16(at) + u16(at + 2) * 0x10000 : u16(at) * 0x10000 + u16(at + 2));
  if (u16(tiff + 2) !== 42) return 1;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) return 1;
    if (u16(e) !== 0x0112) continue;
    if (u16(e + 2) !== 3 || u32(e + 4) !== 1) return 1; // SHORT, one value
    const v = u16(e + 8);
    return v >= 1 && v <= 8 ? v : 1;
  }
  return 1;
}

/** Decodes, applies the orientation to the pixels, encodes; keeps the original APP0 and ICC; no metadata, nothing after EOI. */
function orientJpeg(bytes: Uint8Array, orientation: number): Uint8Array {
  let src: { width: number; height: number; data: Uint8Array };
  try {
    src = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 50 });
  } catch (err) {
    throw new JpegError(`orientation ${orientation}: the JPEG did not decode: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { width: w, height: h, data } = src;
  const swap = orientation >= 5;
  const W = swap ? h : w;
  const H = swap ? w : h;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // The source pixel shown at (x, y) once the viewer applies the tag.
      const [sx, sy] =
        orientation === 2 ? [w - 1 - x, y]
        : orientation === 3 ? [w - 1 - x, h - 1 - y]
        : orientation === 4 ? [x, h - 1 - y]
        : orientation === 5 ? [y, x]
        : orientation === 6 ? [y, h - 1 - x]
        : orientation === 7 ? [w - 1 - y, h - 1 - x]
        : [w - 1 - y, x]; // 8
      const s = (sy * w + sx) * 4;
      const d = (y * W + x) * 4;
      out[d] = data[s]!;
      out[d + 1] = data[s + 1]!;
      out[d + 2] = data[s + 2]!;
      out[d + 3] = 255;
    }
  }
  const encoded = new Uint8Array(jpeg.encode({ data: out, width: W, height: H }, ORIENTED_QUALITY).data);
  const keep = segments(bytes).filter((s) => s.marker === 0xe0 || (s.marker === 0xe2 && s.label === "APP2 ICC"));
  const body = segments(encoded).filter((s) => s.marker !== 0xd8 && !(s.marker >= 0xe0 && s.marker <= 0xef) && s.marker !== 0xfe);
  const parts = [bytes.subarray(0, 2), ...keep.map((s) => bytes.subarray(s.start, s.end)), ...body.map((s) => encoded.subarray(s.start, s.end))];
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    result.set(p, at);
    at += p.length;
  }
  return result;
}

/** Not a JPEG marker: the bytes after EOI that the MPF segment declares as a secondary image. */
const TRAILER = 0x100;

function isMetadata(s: JpegSegment): boolean {
  if (s.marker === 0xfe || s.marker === TRAILER) return true;
  if (s.marker < 0xe1 || s.marker > 0xef) return false;
  return !(s.marker === 0xe2 && s.label === "APP2 ICC");
}

/**
 * Splits a JPEG into segments that cover every byte. Entropy-coded data after
 * SOS is part of the SOS segment, up to the next marker that is not a stuffed
 * byte or a restart; progressive files have several SOS segments.
 */
function segments(bytes: Uint8Array): JpegSegment[] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new JpegError("not a JPEG: no SOI marker");
  const out: JpegSegment[] = [{ marker: 0xd8, start: 0, end: 2, label: null }];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new JpegError(`expected a marker at byte ${i}`);
    let m = i + 1;
    while (bytes[m] === 0xff) m++; // fill bytes
    const marker = bytes[m];
    if (marker === undefined) throw new JpegError("truncated: file ends in fill bytes");
    if (marker === 0xd9) {
      out.push({ marker, start: i, end: m + 1, label: null });
      if (m + 1 === bytes.length) return out;
      // A phone's secondary image (an Ultra HDR gain map, a depth map) sits after EOI and is declared by the
      // MPF segment; it is dropped with the metadata. Any other trailing data is refused.
      if (out.some((s) => s.label === "APP2 MPF") && bytes[m + 1] === 0xff && bytes[m + 2] === 0xd8) {
        out.push({ marker: TRAILER, start: m + 1, end: bytes.length, label: `MPF secondary image (${bytes.length - m - 1} bytes after EOI)` });
        return out;
      }
      throw new JpegError(`${bytes.length - m - 1} bytes after EOI`);
    }
    if (m + 2 >= bytes.length) throw new JpegError(`truncated at marker 0x${marker.toString(16)}`);
    const end = m + 1 + ((bytes[m + 1]! << 8) | bytes[m + 2]!);
    if (end > bytes.length) throw new JpegError(`segment 0x${marker.toString(16)} at byte ${i} runs past the end`);
    let segEnd = end;
    if (marker === 0xda) {
      while (segEnd < bytes.length && !(bytes[segEnd] === 0xff && endsScan(bytes[segEnd + 1]))) segEnd++;
      if (segEnd >= bytes.length) throw new JpegError("truncated: scan data has no end marker");
    }
    out.push({ marker, start: i, end: segEnd, payload: m + 3, label: label(marker, bytes.subarray(m + 3, end)) });
    i = segEnd;
  }
  throw new JpegError("truncated: no EOI marker");
}

/** A byte after 0xFF inside scan data that starts a new segment. */
function endsScan(next: number | undefined): boolean {
  return next !== undefined && next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7);
}

function label(marker: number, payload: Uint8Array): string | null {
  if (marker === 0xfe) return "COM";
  if (marker < 0xe0 || marker > 0xef) return null;
  const n = marker - 0xe0;
  const head = String.fromCharCode(...payload.subarray(0, 32));
  if (n === 2 && head.startsWith(ICC_ID)) return "APP2 ICC";
  const id = head.split("\0")[0]!.replace(/[^\x20-\x7e]/g, "").trim();
  return id ? `APP${n} ${id}` : `APP${n}`;
}
