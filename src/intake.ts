// Garment intake: a phone JPEG in, the same JPEG out with its metadata removed,
// and both hashes recorded. Removal is lossless: every segment that carries
// image data is copied byte for byte, so the pixels do not change.
//
// Removed: APP1 (Exif with GPS and device, XMP), APP3..APP15 (IPTC and vendor
// data), COM, and any APP2 that is not an ICC profile (MPF). Kept: APP0 (JFIF)
// and the APP2 ICC profile, because without it a Display P3 phone photo is read
// as sRGB and its colour shifts, and colour is what the gate is checking.

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
}

interface JpegSegment {
  /** The marker byte after 0xFF. */
  readonly marker: number;
  readonly start: number;
  readonly end: number;
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

/** Strips one photo and records both hashes. */
export function intakeJpeg(sourceName: string, bytes: Uint8Array): { file: IntakeFile; bytes: Uint8Array } {
  const name = intakeName(sourceName);
  const removed = jpegMetadata(bytes);
  const stripped = stripJpegMetadata(bytes);
  return {
    file: { source_name: sourceName, name, source_sha256: sha256Hex(bytes), sha256: sha256Hex(stripped), removed },
    bytes: stripped,
  };
}

function isMetadata(s: JpegSegment): boolean {
  if (s.marker === 0xfe) return true;
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
      if (m + 1 !== bytes.length) throw new JpegError(`${bytes.length - m - 1} bytes after EOI`);
      return out;
    }
    if (m + 2 >= bytes.length) throw new JpegError(`truncated at marker 0x${marker.toString(16)}`);
    const end = m + 1 + ((bytes[m + 1]! << 8) | bytes[m + 2]!);
    if (end > bytes.length) throw new JpegError(`segment 0x${marker.toString(16)} at byte ${i} runs past the end`);
    let segEnd = end;
    if (marker === 0xda) {
      while (segEnd < bytes.length && !(bytes[segEnd] === 0xff && endsScan(bytes[segEnd + 1]))) segEnd++;
      if (segEnd >= bytes.length) throw new JpegError("truncated: scan data has no end marker");
    }
    out.push({ marker, start: i, end: segEnd, label: label(marker, bytes.subarray(m + 3, end)) });
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
