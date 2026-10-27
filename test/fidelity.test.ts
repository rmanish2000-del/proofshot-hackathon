import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkFidelity, loadThresholds, parseThresholds, srgbToLab } from "../src/fidelity.ts";
import type { Thresholds } from "../src/fidelity.ts";
import { decodePng, maskFromPng } from "../src/png.ts";
import type { Mask, RgbImage } from "../src/png.ts";
import { encodePng } from "./helpers.ts";

const W = 18;
const H = 16;
const T: Thresholds = loadThresholds();

function image(pixel: (x: number, y: number) => number): RgbImage {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.fill(pixel(x, y), (y * W + x) * 3, (y * W + x) * 3 + 3);
  return { width: W, height: H, data };
}
const flat = (v: number) => image(() => v);

function mask(inside: (x: number, y: number) => boolean = () => true): Mask {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = inside(x, y) ? 1 : 0;
  return { width: W, height: H, data };
}

const check = (source: RgbImage, render: RgbImage, sourceMask: Mask | null = mask(), renderMask: Mask | null = mask()) =>
  checkFidelity({ source, render, sourceMask, renderMask }, T);

test("the shipped thresholds are the SPEC §10 starting values, with area bounded on both sides", () => {
  assert.deepEqual(T, {
    delta_e: { review_above: 10, refuse_above: 20 },
    hist: { review_above: 0.35, refuse_above: 0.6 },
    texture: { review_below: 0.8, refuse_below: 0.65 },
    area: { review_below: 0.4, review_above: 2.5 },
  });
});

test("Lab conversion: white is L 100, black is L 0, both neutral", () => {
  const [L, a, b] = srgbToLab(255, 255, 255);
  assert.ok(Math.abs(L - 100) < 0.01 && Math.abs(a) < 0.01 && Math.abs(b) < 0.01);
  assert.deepEqual(srgbToLab(0, 0, 0).map((v) => Math.abs(v) < 1e-9), [true, true, true]);
});

test("the same garment in the same place releases with perfect metrics", () => {
  const r = check(image((x) => x * 14), image((x) => x * 14));
  assert.equal(r.decision, "RELEASE");
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.metrics, { delta_e: 0, hist: 0, texture: 1, area: 1 });
});

test("pixels outside the mask do not count", () => {
  const left = (x: number) => x < W / 2;
  const r = check(image((x) => (left(x) ? 128 : 0)), image((x) => (left(x) ? 128 : 255)), mask(left), mask(left));
  assert.equal(r.decision, "RELEASE");
});

test("a moderate colour shift goes to review on delta_e alone", () => {
  const r = check(flat(128), flat(160));
  assert.equal(r.decision, "REVIEW");
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0]!, /^delta_e \d+\.\d+ above 10$/);
  assert.ok(r.metrics!.delta_e > 10 && r.metrics!.delta_e <= 20);
});

test("a large colour shift refuses, and every breach is listed", () => {
  const r = check(flat(128), flat(200));
  assert.equal(r.decision, "REFUSE");
  assert.deepEqual(r.reasons.map((s) => s.split(" ")[0]), ["delta_e", "hist"]);
});

test("a mirrored pattern keeps colour and histogram but fails the texture hash", () => {
  const r = check(image((x) => x * 14), image((x) => (W - 1 - x) * 14));
  assert.ok(r.metrics!.delta_e < 1e-9 && r.metrics!.hist < 1e-6);
  assert.equal(r.metrics!.texture, 0);
  assert.equal(r.decision, "REFUSE");
  assert.deepEqual(r.reasons, ["texture 0 below 0.650"]);
});

test("a garment that shrinks or grows a lot in frame goes to review", () => {
  const quarter = mask((x, y) => x < W / 2 && y < H / 2);
  const shrank = check(flat(128), flat(128), mask(), quarter);
  assert.equal(shrank.decision, "REVIEW");
  assert.equal(shrank.metrics!.area, 0.25);
  assert.match(shrank.reasons[0]!, /shrank/);
  const grew = check(flat(128), flat(128), quarter, mask());
  assert.equal(grew.decision, "REVIEW");
  assert.equal(grew.metrics!.area, 4);
  assert.match(grew.reasons[0]!, /grew/);
});

test("the worst outcome wins: a refusal beside a review is a refusal, and both are listed", () => {
  const quarter = mask((x, y) => x < W / 2 && y < H / 2);
  const r = check(flat(128), flat(200), mask(), quarter);
  assert.equal(r.decision, "REFUSE");
  assert.deepEqual(r.reasons.map((s) => s.split(" ")[0]), ["delta_e", "hist", "area"]);
});

test("a missing, empty or wrong-size mask is review with no metrics", () => {
  const small: Mask = { width: W - 1, height: H, data: new Uint8Array((W - 1) * H).fill(1) };
  const cases: [Mask | null, Mask | null, string][] = [
    [null, mask(), "source mask is missing"],
    [mask(), null, "render mask is missing"],
    [mask(() => false), mask(), "source mask is empty"],
    [mask(), small, "render mask is not the size of its image"],
  ];
  for (const [sm, rm, reason] of cases) {
    assert.deepEqual(check(flat(128), flat(128), sm, rm), { decision: "REVIEW", metrics: null, reasons: [reason] });
  }
});

test("an image that is not 8-bit RGB is review with no metrics", () => {
  const rgba: RgbImage = { width: W, height: H, data: new Uint8Array(W * H * 4) };
  const clamped = { width: W, height: H, data: new Uint8ClampedArray(W * H * 3) } as unknown as RgbImage;
  for (const bad of [rgba, clamped, null as unknown as RgbImage]) {
    const r = check(bad, flat(128));
    assert.deepEqual(r, { decision: "REVIEW", metrics: null, reasons: ["source image is not 8-bit RGB"] });
  }
});

test("a broken thresholds config throws; it never falls back to defaults", () => {
  const good = JSON.parse(JSON.stringify(T)) as Record<string, Record<string, unknown>>;
  const broken = (edit: (t: typeof good) => void) => {
    const t = structuredClone(good);
    edit(t);
    return t;
  };
  assert.throws(() => parseThresholds(null), /delta_e\.review_above/);
  assert.throws(() => parseThresholds(broken((t) => delete t.area!.review_above)), /area\.review_above must be a finite number/);
  assert.throws(() => parseThresholds(broken((t) => (t.hist!.refuse_above = "0.6"))), /hist\.refuse_above/);
  assert.throws(() => parseThresholds(broken((t) => (t.delta_e!.review_above = 30))), /delta_e review_above/);
  assert.throws(() => parseThresholds(broken((t) => (t.texture!.refuse_below = 0.9))), /texture/);
  assert.throws(() => parseThresholds(broken((t) => (t.area!.review_above = 0.9))), /either side of 1/);

  const dir = mkdtempSync(join(tmpdir(), "proofshot-fidelity-"));
  try {
    writeFileSync(join(dir, "bad.json"), "{ not json");
    assert.throws(() => loadThresholds(join(dir, "bad.json")), /is not JSON/);
    assert.throws(() => loadThresholds(join(dir, "missing.json")), /cannot read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a SAM-style mask PNG feeds the check end to end", () => {
  const maskPixels = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) maskPixels[y * W + x] = x < W / 2 ? 255 : 0;
  const m = maskFromPng(decodePng(encodePng(W, H, 1, maskPixels, { filter: 4 })));
  const r = check(flat(128), flat(128), m, m);
  assert.equal(r.decision, "RELEASE");
  assert.equal(r.metrics!.area, 1);
});
