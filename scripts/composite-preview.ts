// npm run composite:preview -- <evidence/sam-*.json> <photo> <out.png> [<template id>]
//
// Offline look at the composite renderer (NR1): the mask comes from a committed
// SAM call log (its output_text, decoded by src/sam-parser.ts) and the photo
// is the one the log was made on (its sha256 must match the log's), so no
// request is made. Writes the composite PNG and prints its sha256, the mask
// used and the quads. A preview, not a job: nothing goes on a receipt.

import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { loadTemplate } from "../src/composite.ts";
import { DEFAULT_TEMPLATE, TEMPLATES_DIR, compositeRenderer } from "../src/render.ts";
import { decodeSegments } from "../src/sam-parser.ts";
import { sha256Hex } from "../src/util.ts";

const [logPath, photoPath, outPath, templateId = DEFAULT_TEMPLATE] = process.argv.slice(2);
if (!logPath || !photoPath || !outPath) {
  console.error("usage: npm run composite:preview -- <evidence/sam-*.json> <photo> <out.png> [<template id>]");
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
const renderer = compositeRenderer(loadTemplate(join(TEMPLATES_DIR, templateId), templateId));
const out = await renderer.render({ scene: "studio", prompt: "preview", sources: [front], segments });
writeFileSync(outPath, out.bytes);
console.log(`${outPath}: sha256 ${sha256Hex(out.bytes)}`);
console.log(JSON.stringify(out.record));
