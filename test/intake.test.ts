import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import jpeg from "jpeg-js";

import { JpegError, exifOrientation, intakeJpeg, intakeName, jpegMetadata, stripJpegMetadata } from "../src/intake.ts";
import type { IntakeFile } from "../src/intake.ts";
import { sha256Hex } from "../src/util.ts";

/** One marker segment: 0xFF, the marker, a big-endian length that counts itself, the payload. */
function seg(marker: number, payload: string | number[]): number[] {
  const body = typeof payload === "string" ? [...Buffer.from(payload, "latin1")] : payload;
  const n = body.length + 2;
  return [0xff, marker, n >> 8, n & 0xff, ...body];
}

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const APP0 = seg(0xe0, "JFIF\0\x01\x02\0\0\x01\0\x01\0\0");
const ICC = seg(0xe2, "ICC_PROFILE\0\x01\x01display-p3");
const DQT = seg(0xdb, [0, 1, 2, 3]);
const SOF = seg(0xc0, [8, 0, 4, 0, 4, 1, 1, 0x11, 0]);
const DHT = seg(0xc4, [0, 1, 0, 0]);
// Scan data with a stuffed 0xFF00, a restart marker and a fill byte before the next marker.
const SCAN1 = [...seg(0xda, [1, 1, 0, 0, 0x3f, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff];
const SCAN2 = [...seg(0xda, [1, 1, 0, 1, 0x3f, 0]), 0x78, 0xff, 0x00];
const EXIF = seg(0xe1, "Exif\0\0GPS 19.07N 72.87E Pixel 8");
const MPF = seg(0xe2, "MPF\0\x01\x02");
const IPTC = seg(0xed, "Photoshop 3.0\0city");
const COM = seg(0xfe, "taken by someone");

const clean = Uint8Array.from([...SOI, ...APP0, ...ICC, ...DQT, ...SOF, ...DHT, ...SCAN1, ...DHT, ...SCAN2, ...EOI]);
const phone = Uint8Array.from([...SOI, ...APP0, ...EXIF, ...ICC, ...MPF, ...DQT, ...SOF, ...DHT, ...SCAN1, ...COM, ...DHT, ...IPTC, ...SCAN2, ...EOI]);

test("stripping removes Exif, XMP-style APPn, IPTC, MPF and comments and keeps every other byte in order", () => {
  assert.deepEqual(jpegMetadata(phone), ["APP1 Exif", "APP2 MPF", "COM", "APP13 Photoshop 3.0"]);
  assert.deepEqual(stripJpegMetadata(phone), clean);
  assert.deepEqual(jpegMetadata(clean), []);
  // A phone's MPF secondary image after EOI (an Ultra HDR gain map) goes with the metadata.
  const gainMap = Uint8Array.from([...phone, ...SOI, ...DQT, ...EOI]);
  assert.deepEqual(jpegMetadata(gainMap), ["APP1 Exif", "APP2 MPF", "COM", "APP13 Photoshop 3.0", "MPF secondary image (12 bytes after EOI)"]);
  assert.deepEqual(stripJpegMetadata(gainMap), clean);
  // A clean file comes back unchanged, so stripping twice is the same as once.
  assert.deepEqual(stripJpegMetadata(clean), clean);
});

test("intake records the arrival hash and the stored hash, and fixes a doubled extension", () => {
  const { file, bytes } = intakeJpeg("1-front.jpg.jpg", phone);
  assert.deepEqual(file, {
    source_name: "1-front.jpg.jpg",
    name: "1-front.jpg",
    source_sha256: sha256Hex(phone),
    sha256: sha256Hex(clean),
    removed: ["APP1 Exif", "APP2 MPF", "COM", "APP13 Photoshop 3.0"],
  });
  assert.notEqual(file.source_sha256, file.sha256);
  assert.deepEqual(bytes, clean);
  // A photo with nothing to remove has the same hash both times.
  const same = intakeJpeg("2-back.JPEG", clean).file;
  assert.deepEqual([same.name, same.source_sha256 === same.sha256, same.removed], ["2-back.jpg", true, []]);
});

test("a name that is not a JPEG, or bytes that are not a whole JPEG, throw", () => {
  for (const name of ["front.png", "front", ".jpg", "front.heic"]) assert.throws(() => intakeName(name), JpegError, name);
  assert.throws(() => jpegMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), /no SOI/);
  assert.throws(() => jpegMetadata(clean.subarray(0, clean.length - 2)), /no end marker|no EOI/);
  assert.throws(() => jpegMetadata(Uint8Array.from([...clean, 0])), /1 bytes after EOI/);
  // A second JPEG after EOI is refused too unless an MPF segment declares it.
  assert.throws(() => jpegMetadata(Uint8Array.from([...clean, ...SOI, ...EOI])), /4 bytes after EOI/);
  assert.throws(() => jpegMetadata(Uint8Array.from([...phone, 0])), /1 bytes after EOI/);
  assert.throws(() => jpegMetadata(Uint8Array.from([...SOI, 0xff, 0xe1, 0x00, 0x40, 1, 2])), /runs past the end/);
});

/** A real 32x16 JPEG: left half red, right half blue. */
function halves(): Uint8Array {
  const w = 32, h = 16;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(i % w < 16 ? [220, 20, 20, 255] : [20, 20, 220, 255], i * 4);
  return new Uint8Array(jpeg.encode({ data, width: w, height: h }, 95).data);
}

/** An APP1 Exif segment whose IFD0 holds one orientation tag (SHORT, one value). */
function exifOrient(value: number, little = false): number[] {
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (little ? [...u16(v & 0xffff), ...u16(v >>> 16)] : [...u16(v >>> 16), ...u16(v & 0xffff)]);
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(value), 0, 0, ...u32(0)];
  return seg(0xe1, [...Buffer.from("Exif\0\0", "latin1"), ...tiff]);
}

const withTag = (base: Uint8Array, app1: number[]) => Uint8Array.from([...SOI, ...app1, ...ICC, ...base.subarray(2)]);
const rgbAt = (img: { width: number; data: Uint8Array }, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
const isRed = (p: number[]) => p[0]! > 150 && p[2]! < 100;
const isBlue = (p: number[]) => p[2]! > 150 && p[0]! < 100;

test("EX1: an orientation-6 photo is turned upright before the tag is stripped; EXIF-free, nothing after EOI, ICC kept", () => {
  const base = halves();
  const sideways = withTag(base, exifOrient(6));
  assert.equal(exifOrientation(sideways), 6);
  const { file, bytes } = intakeJpeg("1-front.jpg", sideways);
  assert.equal(file.orientation_applied, 6);
  assert.deepEqual(file.removed, ["APP1 Exif"]);
  assert.equal(file.sha256, sha256Hex(bytes));
  assert.deepEqual(jpegMetadata(bytes), [], "no metadata, and no trailing bytes (jpegMetadata throws on any)");
  assert.deepEqual([...bytes.subarray(bytes.length - 2)], [0xff, 0xd9]);
  assert.ok(Buffer.from(bytes).includes(Buffer.from("ICC_PROFILE\0", "latin1")), "the ICC profile is kept");
  assert.equal(exifOrientation(bytes), 1);
  const img = jpeg.decode(bytes, { useTArray: true });
  assert.deepEqual([img.width, img.height], [16, 32], "rotated 90 degrees clockwise");
  assert.ok(isRed(rgbAt(img, 8, 4)) && isBlue(rgbAt(img, 8, 27)), "the left half is now on top");
  // Intake again is lossless: the stored photo has nothing left to turn or strip.
  assert.deepEqual(intakeJpeg("1-front.jpg", bytes).bytes, bytes);
});

test("EX1: orientations 3 and 8 (little-endian TIFF too); tag 1, no tag or a malformed tag changes no pixel", () => {
  const base = halves();
  const eight = jpeg.decode(intakeJpeg("a.jpg", withTag(base, exifOrient(8, true))).bytes, { useTArray: true });
  assert.deepEqual([eight.width, eight.height], [16, 32]);
  assert.ok(isBlue(rgbAt(eight, 8, 4)) && isRed(rgbAt(eight, 8, 27)), "turned 90 degrees anticlockwise: the right half is on top");
  const three = jpeg.decode(intakeJpeg("a.jpg", withTag(base, exifOrient(3))).bytes, { useTArray: true });
  assert.deepEqual([three.width, three.height], [32, 16]);
  assert.ok(isBlue(rgbAt(three, 4, 8)) && isRed(rgbAt(three, 27, 8)), "turned 180 degrees");
  for (const app1 of [exifOrient(1), exifOrient(9), exifOrient(0, true), EXIF]) {
    const photo = withTag(base, app1);
    const { file, bytes } = intakeJpeg("a.jpg", photo);
    assert.equal(file.orientation_applied, undefined);
    assert.deepEqual(bytes, stripJpegMetadata(photo), "lossless strip, as before");
  }
});

const GARMENTS = fileURLToPath(new URL("../data/garments/", import.meta.url));
// The real seller pairs for the Evidence Recovery Agent: the same intake, kept out of data/garments (shop, calibration).
const SELLER_PAIRS = fileURLToPath(new URL("../data/seller-pairs/", import.meta.url));

test("every committed garment photo carries no metadata and matches its intake.json", () => {
  const allowed = /^(WHY\.txt|note\.txt|intake\.json|[^.]+\.jpg)$/;
  for (const [root, garment] of [GARMENTS, SELLER_PAIRS].flatMap((r) => readdirSync(r).map((g) => [r, g] as const))) {
    const dir = join(root, garment);
    if (!statSync(dir).isDirectory()) continue;
    const names = readdirSync(dir);
    for (const name of names) assert.match(name, allowed, `${garment}/${name}`);
    const photos = names.filter((n) => n.endsWith(".jpg"));
    if (photos.length === 0) continue;
    assert.ok(existsSync(join(dir, "intake.json")), `${garment} has photos but no intake.json`);
    const files = (JSON.parse(readFileSync(join(dir, "intake.json"), "utf8")) as { files: IntakeFile[] }).files;
    assert.deepEqual(files.map((f) => f.name).sort(), photos.sort(), `${garment}: intake.json lists exactly the photos`);
    for (const f of files) {
      const bytes = readFileSync(join(dir, f.name));
      assert.deepEqual(jpegMetadata(bytes), [], `${garment}/${f.name} still carries metadata`);
      assert.equal(sha256Hex(bytes), f.sha256, `${garment}/${f.name} does not match intake.json`);
      // EX1 changed no committed photo: none was turned at intake, and none has a tag left to turn.
      assert.equal(f.orientation_applied, undefined, `${garment}/${f.name}`);
      assert.equal(exifOrientation(bytes), 1, `${garment}/${f.name}`);
    }
  }
});
