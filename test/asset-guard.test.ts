// PS-2: tests for the asset guard (scripts/asset-guard.mjs).
//
// The guard is a byte parser, so these fixtures are bytes, not photographs: a JPEG
// with an EXIF block carrying GPS and device tags, a stripped one, and a PNG with a
// text chunk naming a location. What matters is that each is detected, and that
// stripping removes metadata without touching the image data.

import assert from "node:assert/strict";
import { test } from "node:test";

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ALLOWED_FOLDERS, auditFile, auditJpeg, auditPng, pathAllowed, stripJpeg } from "../scripts/asset-guard.mjs";

/** Minimal little-endian TIFF with Make, Model, Orientation and a GPS pointer. */
function exifTiff() {
  const ifd0At = 8;
  const entryCount = 4;
  const makeAt = ifd0At + 2 + entryCount * 12 + 4; // 62
  const modelAt = makeAt + 4; // 66
  const gpsIfdAt = modelAt + 4; // 70
  const size = gpsIfdAt + 6; // count 0 + next-IFD offset
  const tiff = Buffer.alloc(size);

  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(ifd0At, 4);
  tiff.writeUInt16LE(entryCount, ifd0At);

  const entry = (index: number, tag: number, type: number, count: number, value: number) => {
    const at = ifd0At + 2 + index * 12;
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    if (type === 3) tiff.writeUInt16LE(value, at + 8);
    else tiff.writeUInt32LE(value, at + 8);
  };

  entry(0, 0x010f, 2, 4, makeAt); // Make "AAA\0"
  entry(1, 0x0110, 2, 4, modelAt); // Model "BBB\0"
  entry(2, 0x8825, 4, 1, gpsIfdAt); // GPSInfo pointer
  entry(3, 0x0112, 3, 1, 1); // Orientation
  tiff.writeUInt32LE(0, ifd0At + 2 + entryCount * 12); // no next IFD

  tiff.write("AAA\0", makeAt, "latin1");
  tiff.write("BBB\0", modelAt, "latin1");
  tiff.writeUInt16LE(0, gpsIfdAt);
  tiff.writeUInt32LE(0, gpsIfdAt + 2);

  return tiff;
}

function app1(tiff: Buffer) {
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
/** Stand-in for entropy-coded data: from SOS onwards the guard must copy it verbatim. */
const SCAN = Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0xff, 0xd9]);

test("a JPEG with no metadata is clean", () => {
  const clean = Buffer.concat([SOI, SCAN]);
  assert.deepEqual(auditJpeg(clean).flags, []);
});

test("GPS, device tags and orientation in EXIF are all flagged, with the tag names", () => {
  const dirty = Buffer.concat([SOI, app1(exifTiff()), SCAN]);
  const report = auditJpeg(dirty);
  assert.ok(report.flags.includes("gps"));
  assert.ok(report.flags.includes("device"));
  assert.ok(report.flags.includes("orientation"));
  assert.ok(report.found.includes("Make"));
  assert.ok(report.found.includes("Model"));
  assert.ok(report.found.includes("GPSInfo"));
});

test("stripping removes the metadata and copies the scan data byte for byte", () => {
  const dirty = Buffer.concat([SOI, app1(exifTiff()), SCAN]);
  const stripped = stripJpeg(dirty);

  assert.deepEqual(auditJpeg(stripped).flags, []);
  assert.deepEqual(stripped.subarray(0, 2), SOI);
  // Everything from the scan marker onwards survives untouched.
  const at = stripped.indexOf(Buffer.from([0xff, 0xda]));
  assert.ok(at > 0);
  assert.deepEqual(stripped.subarray(at), SCAN);
  assert.ok(stripped.length < dirty.length);
});

test("a truncated EXIF block is reported rather than trusted", () => {
  const truncated = Buffer.concat([SOI, app1(Buffer.from("II*\0", "latin1")), SCAN]);
  const report = auditJpeg(truncated);
  assert.ok(report.flags.includes("exif-truncated"));
});

test("a PNG text chunk naming a location is flagged; a harmless one is not", () => {
  const png = (keyword: string, value: string) => {
    const chunk = (type: string, data: Buffer) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length, 0);
      const crc = Buffer.alloc(4); // the guard does not verify CRCs
      return Buffer.concat([length, Buffer.from(type, "latin1"), data, crc]);
    };
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", Buffer.alloc(13)),
      chunk("tEXt", Buffer.from(`${keyword}\0${value}`, "latin1")),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  };

  assert.ok(auditPng(png("GPSLatitude", "23.8")).flags.includes("text-metadata"));
  // A harmless caption stays clean; "Software" is deliberately not used here,
  // because an editing app can identify a device and the guard flags it.
  assert.deepEqual(auditPng(png("Title", "indigo shirt")).flags, []);
});

test("folder policy: the published folders pass and a stray photo does not", () => {
  for (const prefix of ALLOWED_FOLDERS) {
    assert.equal(pathAllowed(`${prefix}anything/photo.jpg`), true, prefix);
    assert.equal(pathAllowed(`${prefix.replaceAll("/", "\\")}photo.jpg`), true, `windows path for ${prefix}`);
  }
  for (const path of ["photos/leak.jpg", "data/private/x.jpg", "docs/garment.jpg", "data/garments"]) {
    assert.equal(pathAllowed(path), false, path);
  }
});

test("a clean image outside the published folders is still a finding", () => {
  const dir = mkdtempSync(join(tmpdir(), "asset-guard-"));
  const path = join(dir, "stray.jpg");
  writeFileSync(path, Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]));
  const report = auditFile(path);
  assert.deepEqual(report.flags, ["outside-folder"]);
});

test("the repository's own tracked images are clean and sit in published folders", () => {
  let listed;
  try {
    listed = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  } catch {
    return; // not a checkout: nothing to enforce
  }
  const paths = listed.split(/\r?\n/).filter((line) => line && /\.(jpe?g|png|webp)$/i.test(line));
  assert.ok(paths.length > 0, "expected tracked images");
  const reports = paths.map(auditFile);
  const dirty = reports.filter((report) => report.flags.length > 0);
  assert.deepEqual(dirty.map((r) => `${r.path}:${r.flags.join(",")}`), []);
});
