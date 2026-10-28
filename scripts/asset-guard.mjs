// PS-2: asset guard for tracked images.
//
// Every photo in this repository is a real garment photographed by the owner. Two
// things must never leak with them: where the photo was taken (GPS), and which
// device took it (make/model/serial), because a phone serial identifies a person
// as surely as a name does. A third thing must not be silently wrong: EXIF
// orientation changes what a viewer sees while the pixels stay the same, so a
// render can look rotated for reasons no receipt records.
//
// This is a guard, not a cleaner: it reports, and only rewrites when asked with
// --strip. Run it before every commit that touches an image.
//
//   node scripts/asset-guard.mjs                 # every image tracked by git
//   node scripts/asset-guard.mjs data/garments   # specific paths
//   node scripts/asset-guard.mjs --json          # machine-readable report
//   node scripts/asset-guard.mjs --strip --out . # write metadata-free copies

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const IMAGE = /\.(jpe?g|png|webp)$/i;

/**
 * Folders whose images this repository publishes (PS-2). `data/jobs/` and
 * `web/shop/` are DERIVED: written by a job or by `npm run shop` from the
 * garments above, so they are allowed but named separately in the report.
 */
export const SOURCE_FOLDERS = ["data/garments/", "data/demo/", "demo/", "evidence/", "data/evidence/"];
export const DERIVED_FOLDERS = ["data/jobs/", "web/shop/"];
export const ALLOWED_FOLDERS = [...SOURCE_FOLDERS, ...DERIVED_FOLDERS];

/** True when the image sits in a folder the repository publishes. */
export function pathAllowed(path) {
  const normal = String(path).replace(/\\/g, "/");
  return ALLOWED_FOLDERS.some((prefix) => normal.startsWith(prefix));
}

/** Tags that identify a place or a person, by EXIF name. */
const SENSITIVE_TIFF_TAGS = new Map([
  [0x010f, "Make"],
  [0x0110, "Model"],
  [0x0131, "Software"],
  [0x0132, "DateTime"],
  [0x013b, "Artist"],
  [0x8298, "Copyright"],
  [0x8825, "GPSInfo"],
  [0xa431, "BodySerialNumber"],
  [0xa434, "LensModel"],
]);

export function auditJpeg(bytes) {
  const flags = [];
  const found = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break; // start of scan: metadata is behind us
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) break;
    const start = offset + 4;
    const end = offset + 2 + length;

    if (marker === 0xe1 && bytes.toString("latin1", start, start + 6) === "Exif\u0000\u0000") {
      const tiff = bytes.subarray(start + 6, end);
      const parsed = auditTiff(tiff);
      flags.push(...parsed.flags);
      found.push(...parsed.found);
    }
    offset = end;
  }
  return { flags: unique(flags), found };
}

export function auditTiff(tiff) {
  const flags = [];
  const found = [];
  if (tiff.length < 8) return { flags: ["exif-truncated"], found };

  const little = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (at) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));

  if (u16(2) !== 0x2a) return { flags: ["exif-bad-magic"], found };

  const readIfd = (ifdOffset, depth = 0) => {
    if (depth > 2 || ifdOffset + 2 > tiff.length) return;
    const count = u16(ifdOffset);
    for (let i = 0; i < count; i += 1) {
      const entry = ifdOffset + 2 + i * 12;
      if (entry + 12 > tiff.length) return;
      const tag = u16(entry);
      const name = SENSITIVE_TIFF_TAGS.get(tag);
      if (name) found.push(name);
      if (tag === 0x8825) flags.push("gps");
      if (tag === 0xa431) flags.push("serial");
      if (tag === 0x010f || tag === 0x0110) flags.push("device");
      if (tag === 0x0112) flags.push("orientation");
      if (tag === 0x8769) readIfd(u32(entry + 8), depth + 1); // Exif sub-IFD
      if (tag === 0x8825) readIfd(u32(entry + 8), depth + 1); // GPS sub-IFD
    }
  };

  readIfd(u32(4));
  return { flags: unique(flags), found: unique(found) };
}

export function auditPng(bytes) {
  const flags = [];
  const found = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    if (type === "eXIf") {
      flags.push("exif");
      const parsed = auditTiff(bytes.subarray(dataStart, dataEnd));
      flags.push(...parsed.flags);
      found.push(...parsed.found);
    }
    if (type === "tEXt" || type === "iTXt") {
      const chunk = bytes.toString("latin1", dataStart, dataEnd);
      const keyword = chunk.split("\u0000")[0] ?? "";
      if (/gps|make|model|author|artist|software|location/i.test(keyword)) {
        flags.push("text-metadata");
        found.push(keyword);
      }
    }
    offset = dataEnd + 4; // skip CRC
    if (type === "IEND") break;
  }
  return { flags: unique(flags), found: unique(found) };
}

/** Rewrites a JPEG without APP1/APP13/APP14 segments. Pixel data is untouched. */
export function stripJpeg(bytes) {
  const out = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (marker === 0xda) {
      out.push(bytes.subarray(offset)); // everything from the scan onwards
      break;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) break;
    const end = offset + 2 + length;
    const dropsMetadata = marker === 0xe1 || marker === 0xed || marker === 0xee;
    if (!dropsMetadata) out.push(bytes.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(out);
}

export function auditFile(path) {
  const bytes = readFileSync(path);
  const lower = path.toLowerCase();
  const base = lower.endsWith(".png")
    ? { kind: "png", ...auditPng(bytes) }
    : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? { kind: "jpeg", ...auditJpeg(bytes) }
      : { kind: "other", flags: [], found: [] };
  // PS-2 asks for two things from one guard: clean metadata AND a published folder.
  const folderFlags = pathAllowed(path) ? [] : ["outside-folder"];
  return { path, ...base, flags: [...base.flags, ...folderFlags] };
}

function trackedImages() {
  try {
    return execFileSync("git", ["ls-files"], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter((line) => line && IMAGE.test(line));
  } catch {
    return [];
  }
}

function unique(values) {
  return [...new Set(values)];
}

function main(argv) {
  const json = argv.includes("--json");
  const strip = argv.includes("--strip");
  const outIndex = argv.indexOf("--out");
  const outDir = outIndex >= 0 ? argv[outIndex + 1] : null;
  const paths = argv.filter((arg) => !arg.startsWith("--") && arg !== outDir);

  const targets = paths.length > 0 ? paths.flatMap((path) => (path.match(IMAGE) ? [path] : walk(path))) : trackedImages();
  const reports = targets.map(auditFile);
  const dirty = reports.filter((report) => report.flags.length > 0);

  if (strip) {
    if (!outDir) {
      console.error("--strip needs --out <directory>");
      process.exit(2);
    }
    mkdirSync(outDir, { recursive: true });
    for (const report of dirty) {
      if (report.kind !== "jpeg") {
        console.error(`cannot strip ${report.path}: only JPEG is supported here`);
        continue;
      }
      const target = join(outDir, report.path.replace(/[\\/]/g, "_"));
      writeFileSync(target, stripJpeg(readFileSync(report.path)));
      console.log(`stripped ${report.path} → ${target}`);
    }
  }

  if (json) {
    console.log(JSON.stringify({ checked: reports.length, flagged: dirty.length, reports }, null, 2));
  } else {
    for (const report of reports) {
      const mark = report.flags.length === 0 ? "ok  " : "FLAG";
      const detail = report.flags.length === 0 ? "" : `  ${report.flags.join(",")}${report.found.length ? ` (${report.found.join(",")})` : ""}`;
      console.log(`${mark} ${report.path}${detail}`);
    }
    const misfiled = reports.filter((report) => report.flags.includes("outside-folder")).length;
    console.log(`\n${reports.length} image(s) checked, ${dirty.length} with something to fix`
      + ` (${dirty.length - misfiled} with metadata, ${misfiled} outside the published folders)`);
  }

  process.exit(dirty.length === 0 || strip ? 0 : 1);
}

function walk(dir) {
  try {
    const out = [];
    for (const name of execFileSync("git", ["ls-files", dir], { encoding: "utf8" }).split(/\r?\n/)) {
      if (name && IMAGE.test(name)) out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) main(process.argv.slice(2));
