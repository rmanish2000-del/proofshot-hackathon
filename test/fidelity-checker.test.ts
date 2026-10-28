import assert from "node:assert/strict";
import { test } from "node:test";

import { loadThresholds, maskedFidelityChecker } from "../src/fidelity.ts";
import type { Segment } from "../src/pipeline.ts";
import { encodePng } from "./helpers.ts";

const W = 18;
const H = 16;
const T = loadThresholds();

const rgb = (v: number) => new Uint8Array(encodePng(W, H, 3, new Uint8Array(W * H * 3).fill(v)));
const maskPng = (inside: (x: number, y: number) => boolean = () => true) => {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = inside(x, y) ? 255 : 0;
  return new Uint8Array(encodePng(W, H, 1, data));
};
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

const seg = (label: string, mask: Segment["mask"]): Segment => ({ label, box: [0, 0, 1, 1], score: 0.9, mask });
const segmenterOf = (segments: Segment[]) => ({ segment: async () => segments });
const req = (sources: { name: string; bytes: Uint8Array }[], segments: Segment[], render: Uint8Array) => ({ sources, segments, render, renderId: "j-r0", scene: "studio" });

test("no source mask (no segmenter ran) is REVIEW with no metrics and the reason, never a pass", async () => {
  const c = maskedFidelityChecker({ thresholds: T });
  const out = await c.check(req([{ name: "1-front.jpg", bytes: JPEG }], [], JPEG));
  assert.deepEqual(out, { decision: "REVIEW", metrics: null, reasons: ["source mask is missing: no segment with mask bytes for 1-front.jpg"] });
  // A segment for another photo, or one known only by hash (a replay), is not a source mask either.
  const other = await c.check(req([{ name: "1-front.jpg", bytes: JPEG }], [seg("2-back.jpg/kurta", maskPng()), seg("1-front.jpg/kurta", { sha256: "ab" })], JPEG));
  assert.equal(other.decision, "REVIEW");
  assert.match(other.reasons[0]!, /source mask is missing/);
  const none = await c.check(req([], [], JPEG));
  assert.match(none.reasons[0]!, /no source photo/);
});

test("with a source mask but no segmenter for the render, or a segmenter that finds nothing, it is REVIEW with the reason", async () => {
  const segments = [seg("1-front.jpg/kurta", maskPng())];
  const noSegmenter = await maskedFidelityChecker({ thresholds: T }).check(req([{ name: "1-front.jpg", bytes: rgb(100) }], segments, rgb(100)));
  assert.deepEqual(noSegmenter, { decision: "REVIEW", metrics: null, reasons: ["render mask is missing: no segmenter is available for the render"] });
  const empty = await maskedFidelityChecker({ thresholds: T, segmenter: segmenterOf([]) }).check(req([{ name: "1-front.jpg", bytes: rgb(100) }], segments, rgb(100)));
  assert.match(empty.reasons[0]!, /render mask is missing: the segmenter found no garment/);
});

test("a JPEG image cannot be measured in this build (no JPEG decoder): REVIEW with the reason", async () => {
  const c = maskedFidelityChecker({ thresholds: T, segmenter: segmenterOf([seg("render/kurta", maskPng())]) });
  const out = await c.check(req([{ name: "1-front.jpg", bytes: JPEG }], [seg("1-front.jpg/kurta", maskPng())], rgb(100)));
  assert.equal(out.decision, "REVIEW");
  assert.equal(out.metrics, null);
  assert.match(out.reasons[0]!, /^source image is not a PNG: this build decodes only PNG/);
});

test("with both masks and both PNG images the result is checkFidelity's: same image RELEASE, a different colour REFUSE, a bad mask REVIEW", async () => {
  const renderSegmenter = { segment: async (images: readonly { name: string }[]) => (images[0]!.name === "render" ? [seg("render/kurta", maskPng())] : []) };
  const c = maskedFidelityChecker({ thresholds: T, segmenter: renderSegmenter });
  const same = await c.check(req([{ name: "1-front.jpg", bytes: rgb(120) }], [seg("1-front.jpg/kurta", maskPng())], rgb(120)));
  assert.equal(same.decision, "RELEASE");
  assert.deepEqual(same.reasons, []);
  assert.equal(same.metrics!.delta_e, 0);
  assert.equal(same.metrics!.area, 1);

  const differentColour = await c.check(req([{ name: "1-front.jpg", bytes: rgb(30) }], [seg("1-front.jpg/kurta", maskPng())], rgb(220)));
  assert.equal(differentColour.decision, "REFUSE");
  assert.match(differentColour.reasons[0]!, /^delta_e .* above 20/);

  const badMask = await c.check(req([{ name: "1-front.jpg", bytes: rgb(120) }], [seg("1-front.jpg/kurta", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]))], rgb(120)));
  assert.equal(badMask.decision, "REVIEW");
  assert.match(badMask.reasons[0]!, /^source mask could not be decoded/);
});
