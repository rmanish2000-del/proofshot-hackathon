import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { maskedFidelityChecker } from "../src/fidelity.ts";
import { decodePng, maskFromPng } from "../src/png.ts";
import { META_SAM_MODEL_ID, metaSamTransport } from "../src/sam-meta.ts";
import { META_SAM_PARSER_VERSION, decodeSegments, frameSize, metaSamParser, parseOutputText } from "../src/sam-parser.ts";
import { SegmentProtocolError, parseSegments, samSegmenter } from "../src/sam.ts";
import { sha256Hex } from "../src/util.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// The one live SAM 3.1 call (#18, proofshot-hackathon 4c5df28): "kurta" on kurta-01's front photo.
const LOG = JSON.parse(readFileSync(join(ROOT, "evidence/sam-2026-10-28T03-04-30-778Z.json"), "utf8")) as { output_text: string; image: { path: string; sha256: string }; response: { status: number; body: string } };
const FRONT = { name: "1-front.jpg", bytes: new Uint8Array(readFileSync(join(ROOT, LOG.image.path))) };

test("the pinned parser version is the one package.json names", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  assert.equal(pkg.dependencies["@meta-sam/parser"], META_SAM_PARSER_VERSION);
  assert.equal(META_SAM_PARSER_VERSION, "0.1.0");
});

test("the logged live answer decodes to one box and one mask that match the token text", async () => {
  assert.equal(sha256Hex(FRONT.bytes), LOG.image.sha256, "the committed photo is the one the call was made on");
  const result = await parseOutputText(LOG.output_text);
  assert.equal(result.outcome.status, "completed");
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
  const kinds = result.records.map((r) => r.kind);
  assert.ok(kinds.includes("box") && kinds.includes("mask"), `records: ${kinds.join(", ")}`);
  assert.deepEqual(frameSize(LOG.output_text, FRONT), { width: 715, height: 1600 }, "the JPEG header agrees with the box token's w=715;h=1600");
  assert.deepEqual(frameSize(LOG.output_text, { name: "x", bytes: new Uint8Array(3) }), { width: 715, height: 1600 }, "with no readable image the box token's frame is used");
});

test("decodeSegments: box in 0..1 of the 715x1600 frame, score from the token, a full-frame greyscale PNG mask that is white only inside the bounds", async () => {
  const segments = await decodeSegments(LOG.output_text, FRONT, "kurta");
  assert.equal(segments.length, 1);
  const s = segments[0]!;
  assert.equal(s.label, "kurta");
  assert.deepEqual(s.frame, { width: 715, height: 1600 });
  // <|box;x1=27;y1=169;x2=650;y2=1407;w=715;h=1600;c=0.9569892287254333|>: the parser's box is half-open, so right is x2+1 and bottom y2+1.
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  assert.ok(close(s.box[0], 27 / 715) && close(s.box[1], 169 / 1600) && close(s.box[2], (651 - 27) / 715) && close(s.box[3], (1408 - 169) / 1600), JSON.stringify(s.box));
  assert.deepEqual(s.bounds, { left: 27, top: 169, right: 651, bottom: 1408 });
  assert.ok(close(s.score, 0.9569892287254333));

  const png = decodePng(new Uint8Array(Buffer.from(s.mask, "base64")));
  assert.deepEqual([png.width, png.height, png.channels], [715, 1600, 1]);
  const mask = maskFromPng(png);
  let inside = 0, outside = 0;
  for (let y = 0; y < 1600; y++) {
    for (let x = 0; x < 715; x++) {
      const on = mask.data[y * 715 + x] === 1;
      if (!on) continue;
      if (x >= s.bounds.left && x < s.bounds.right && y >= s.bounds.top && y < s.bounds.bottom) inside++;
      else outside++;
    }
  }
  assert.equal(outside, 0, "no garment pixel outside the mask's bounds");
  assert.ok(inside > 0, "the mask has garment pixels");
  const boundsArea = (s.bounds.right - s.bounds.left) * (s.bounds.bottom - s.bounds.top);
  assert.ok(inside > boundsArea * 0.2 && inside <= boundsArea, `the garment fills a sensible share of its bounds: ${inside} of ${boundsArea}`);
});

test("the glue's answer is what src/sam.ts accepts, and the whole chain from the logged SSE body gives one labelled segment with a PNG mask", async () => {
  const parse = metaSamParser();
  const raw = await parse(LOG.output_text, FRONT, "kurta");
  const checked = parseSegments(raw, FRONT.name);
  assert.equal(checked.length, 1);
  assert.equal(checked[0]!.label, "1-front.jpg/kurta");
  assert.ok(checked[0]!.mask instanceof Uint8Array);

  const transport = metaSamTransport({ fetch: async () => ({ ok: true, status: 200, text: async () => LOG.response.body }), apiKey: () => "test-key-value-never-logged", parse });
  const segmenter = samSegmenter({ model: META_SAM_MODEL_ID, transport, prompt: "kurta" });
  const segments = await segmenter.segment([FRONT]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.label, "1-front.jpg/kurta");
  assert.equal(segments[0]!.score > 0.95, true);
  assert.deepEqual(segmenter.identity, { provider: "meta", model: META_SAM_MODEL_ID });

  // With these masks the fidelity check reaches the images, and a JPEG is unmeasured in this build.
  const fidelity = maskedFidelityChecker({ segmenter: { segment: async () => segments.map((x) => ({ ...x, label: `render/${x.label.split("/")[1]}` })) } });
  const out = await fidelity.check({ sources: [FRONT], segments, render: FRONT.bytes, renderId: "r0", scene: "studio" });
  assert.equal(out.decision, "REVIEW");
  assert.match(out.reasons[0]!, /^source image is not a PNG/);
});

test("fails closed: text with no mask is no match, a broken mask token or a mask without confidence throws SegmentProtocolError", async () => {
  assert.deepEqual(await decodeSegments("", FRONT, "kurta"), []);
  // A line the parser cannot read is an error, not "no garment": the transport only calls the glue when a mask token is present anyway.
  await assert.rejects(decodeSegments("<0f>0 nothing here\n", FRONT, "kurta"), (e: unknown) => e instanceof SegmentProtocolError && /parser error/.test((e as Error).message));
  const noConfidence = LOG.output_text.replace(/;c=0\.9569892287254333/g, "");
  assert.equal(noConfidence.includes("c=0.95"), false);
  await assert.rejects(decodeSegments(noConfidence, FRONT, "kurta"), (e: unknown) => e instanceof SegmentProtocolError && /no confidence|parser error|outcome/.test((e as Error).message));
  const broken = LOG.output_text.replace(/data=1024,516,[^|]*\|>/, "data=1024,516,!!|>");
  assert.notEqual(broken, LOG.output_text);
  await assert.rejects(decodeSegments(broken, FRONT, "kurta"), SegmentProtocolError);
});
