// npm run composite:preview -- <evidence/sam-*.json> <photo> <out.png> [<template id> | v2]
//
// Offline look at the composite renderer (NR1, NR3): the mask comes from a
// committed SAM call log (its output_text, decoded by src/sam-parser.ts) and the
// photo is the one the log was made on (its sha256 must match the log's), so no
// request is made. Writes the composite PNG and prints its sha256, the mask used
// and the parameters. `v2` runs composite v2 (SPEC-composite-v2); a template id
// runs v1 on that template. A v2 quality REVIEW writes no image and prints the
// reason and every check (exit 3). A preview, not a job: nothing goes on a receipt.
// `tryon-garment` writes, instead, exactly the garment image the Replicate
// try-on sends (garmentCutout, NR4d) and prints its size and the mask box.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { loadTemplate } from "../src/composite.ts";
import { CompositeQualityReview, V2_PARAMS } from "../src/composite-v2.ts";
import { DEFAULT_TEMPLATE, TEMPLATES_DIR, compositeRenderer, compositeV2Renderer } from "../src/render.ts";
import { decodeRgb } from "../src/image.ts";
import { decodePng, encodeRgbPng } from "../src/png.ts";
import { garmentCutout } from "../src/render-replicate.ts";
import type { RgbImage } from "../src/png.ts";
import { decodeSegments } from "../src/sam-parser.ts";
import { sha256Hex } from "../src/util.ts";

const [logPath, photoPath, outPath, which = DEFAULT_TEMPLATE, beforeAfterPath] = process.argv.slice(2);
if (!logPath || !photoPath || !outPath) {
  console.error("usage: npm run composite:preview -- <evidence/sam-*.json> <photo> <out.png> [<template id> | v2 | v2-debug | tryon-garment] [<before-after.png>]");
  process.exit(2);
}
const log = JSON.parse(readFileSync(logPath, "utf8")) as { output_text: string; prompt?: string; image: { sha256: string } };
const bytes = new Uint8Array(readFileSync(photoPath));
if (sha256Hex(bytes) !== log.image.sha256) {
  console.error(`${photoPath} is not the photo the log was made on`);
  process.exit(1);
}
const front = { name: basename(photoPath), bytes };
// decodeSegments gives the transport's wire form (mask as base64 PNG); the pipeline's Segment holds the bytes.
const segments = (await decodeSegments(log.output_text, front, log.prompt ?? "kurta")).map((s) => ({
  label: `${front.name}/${s.label}`,
  box: s.box,
  score: s.score,
  mask: new Uint8Array(Buffer.from(s.mask, "base64")),
}));
if (which === "tryon-garment") {
  const garment = garmentCutout([front], segments);
  if (!garment) {
    console.error("no usable mask: the try-on would fall back with no_garment_mask");
    process.exit(3);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, garment);
  const png = decodePng(garment);
  const photo = decodeRgb(bytes);
  console.log(`${outPath}: sha256 ${sha256Hex(garment)}, ${png.width}x${png.height} (photo ${photo.width}x${photo.height}); box ${JSON.stringify(segments.map((s) => s.box))}`);
  process.exit(0);
}
// `v2-debug` switches the quality checks off to look at the pixels of a photo that
// would REVIEW. Debug only: never a product shot, never on a receipt or in the shop.
const debug = { ...V2_PARAMS, clip_max: 1, shadow_max: Infinity, max_corr_de: Infinity, frag_max: Infinity };
const renderer = which === "v2" ? compositeV2Renderer() : which === "v2-debug" ? compositeV2Renderer(debug) : compositeRenderer(loadTemplate(join(TEMPLATES_DIR, which), which));
try {
  const out = await renderer.render({ scene: "studio", prompt: "preview", sources: [front], segments });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out.bytes);
  console.log(`${outPath}: sha256 ${sha256Hex(out.bytes)}`);
  if (beforeAfterPath) {
    const ba = beforeAfter(decodeRgb(bytes), decodeRgb(out.bytes));
    writeFileSync(beforeAfterPath, ba);
    console.log(`${beforeAfterPath}: sha256 ${sha256Hex(ba)}`);
  }
  console.log(JSON.stringify(out.record));
} catch (err) {
  if (!(err instanceof CompositeQualityReview)) throw err;
  console.log(`REVIEW (no image written): ${err.message}`);
  console.log(JSON.stringify(err.quality));
  process.exit(3);
}

/** The original photo, box-averaged to the render's height, left of the render (NR3b before/after). No ancillary chunks. */
function beforeAfter(before: RgbImage, after: RgbImage): Uint8Array {
  const H = after.height;
  const bw = Math.max(1, Math.round((before.width * H) / before.height));
  const W = bw + after.width;
  const data = new Uint8Array(W * H * 3);
  const sx = before.width / bw, sy = before.height / H;
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(before.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < bw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(before.width, Math.floor((x + 1) * sx)));
      const sum = [0, 0, 0];
      for (let v = y0; v < y1; v++) for (let u = x0; u < x1; u++) for (let c = 0; c < 3; c++) sum[c]! += before.data[(v * before.width + u) * 3 + c]!;
      const n = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < 3; c++) data[(y * W + x) * 3 + c] = Math.round(sum[c]! / n);
    }
    data.set(after.data.subarray(y * after.width * 3, (y + 1) * after.width * 3), (y * W + bw) * 3);
  }
  return encodeRgbPng(W, H, data);
}
