import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CompositeQualityReview, QUALITY_REASONS, V2_PARAMS, cleanMask, compositeV2, correctGarment, illumination, neckRegion, shadowScore, wbGains } from "../src/composite-v2.ts";
import type { V2Params } from "../src/composite-v2.ts";
import { fixtureProviders, runJob } from "../src/pipeline.ts";
import type { FidelityChecker, Segment, SourceImage, Verifier } from "../src/pipeline.ts";
import { encodeGreyPng, encodeRgbPng } from "../src/png.ts";
import type { Mask, RgbImage } from "../src/png.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { parseReceipt, recordedClock, verifyChain } from "../src/receipt.ts";
import { RenderConfigError, compositeV2Renderer, rendererFromEnv } from "../src/render.ts";
import type { RenderTransport } from "../src/render.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";

// A procedural kurta-like fixture: body, two sleeves, a V-neck notch, stripes
// and a little deterministic texture, on a magenta background (so a background
// pixel in the output would show), with an optional diagonal shadow band.
type Paint = (x: number, y: number) => readonly [number, number, number] | null;

function photo(w: number, h: number, paint: Paint): { img: RgbImage; mask: Mask } {
  const data = new Uint8Array(w * h * 3);
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = paint(x, y);
      m[i] = c ? 1 : 0;
      const [r, g, b] = c ?? [255, 0, 255];
      data[i * 3] = r;
      data[i * 3 + 1] = g;
      data[i * 3 + 2] = b;
    }
  }
  return { img: { width: w, height: h, data }, mask: { width: w, height: h, data: m } };
}

function kurtaShape(x: number, y: number, notch: boolean): boolean {
  if (notch && y < 140 && Math.abs(x - 320) < (140 - y) * 0.5 + 10) return false;
  if (x >= 180 && x < 460 && y >= 60 && y < 960) return true;
  if (x >= 80 && x < 180) return y >= 80 + (180 - x) * 0.8 && y < 300 + (180 - x) * 0.8;
  if (x >= 460 && x < 560) return y >= 80 + (x - 459) * 0.8 && y < 300 + (x - 459) * 0.8;
  return false;
}

function kurta(opts: { notch?: boolean; band?: number } = {}): { img: RgbImage; mask: Mask } {
  const band = opts.band ?? 0.25;
  return photo(640, 1000, (x, y) => {
    if (!kurtaShape(x, y, opts.notch ?? true)) return null;
    const stripe = (x >> 4) & 1 ? 22 : 0;
    const tex = (x * 7 + y * 13) % 11;
    const d = x + y * 0.5 - 600;
    const f = band > 0 && d > 0 && d < 160 ? 1 - band : 1;
    // Near-grey on purpose: gray-world WB on a coloured garment (maroon 150,40,60 or beige 140,118,104)
    // clamps at ±8% and the correction ΔE comes out about 8 > 6, which is the "correction too large" REVIEW.
    return [Math.round((128 + stripe + tex) * f), Math.round((125 + stripe + tex) * f), Math.round((121 + stripe + tex) * f)] as const;
  });
}

const maskPng = (m: Mask): Uint8Array => encodeGreyPng(m.width, m.height, m.data.map((v) => (v ? 255 : 0)));
const allMatch = () => ({ findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95 })) });

function jobFor(fixture: { img: RgbImage; mask: Mask }): { sources: SourceImage[]; segments: Segment[] } {
  const front = { name: "1-front.png", bytes: encodeRgbPng(fixture.img.width, fixture.img.height, fixture.img.data) };
  return { sources: [front], segments: [{ label: "1-front.png/kurta", box: [0, 0, 1, 1], score: 0.96, mask: maskPng(fixture.mask) }] };
}

const golden = kurta();
const runs = [0, 1].map(() => compositeV2(golden.img, golden.mask));

/** PNG chunk types in order. */
function chunks(png: Uint8Array): string[] {
  const out: string[] = [];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let at = 8; at < png.length; ) {
    const len = view.getUint32(at);
    out.push(Buffer.from(png.subarray(at + 4, at + 8)).toString("ascii"));
    at += 12 + len;
  }
  return out;
}

test("composite v2 is deterministic: two runs give one PNG, pinned by golden hashes, 1200x1600, no ancillary chunks", () => {
  assert.equal(sha256Hex(runs[0]!.png), sha256Hex(runs[1]!.png), "byte-identical PNG on every run");
  assert.deepEqual([runs[0]!.image.width, runs[0]!.image.height], [1200, 1600]);
  assert.deepEqual(chunks(runs[0]!.png), ["IHDR", "IDAT", "IEND"], "no EXIF or text chunks");
  // Golden values: the pixels (independent of the deflate build) and the PNG bytes (node 22's zlib, as in CI).
  assert.equal(sha256Hex(runs[0]!.image.data), "7cfc56930bbadaa3a04bf9bd356c0b8f49480a688dda4cad6ce1c6f60d7e0e42");
  assert.equal(sha256Hex(runs[0]!.png), "4d7636d1b7abd9b7ffce1f2522899a1b7ae08e7f0bde9e320b769045b19054b0");
});

test("ghost: outside the dilated garment every output pixel is backdrop or shadow (neutral grey), no form and no photo background", () => {
  const plain = kurta({ notch: false });
  const r = compositeV2(plain.img, plain.mask);
  assert.equal((r.params.insert as { present: boolean }).present, false);
  const { width: W, height: H, data } = r.image;
  const R = V2_PARAMS.feather_r + 1;
  const near = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (r.renderMask.data[y * W + x]) {
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) near[ny * W + nx] = 1;
    }
  }
  let outside = 0;
  for (let i = 0; i < W * H; i++) {
    if (near[i]) continue;
    outside++;
    const [rr, gg, bb] = [data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!];
    assert.ok(Math.abs(rr - gg) <= 2 && gg - bb >= 0 && gg - bb <= 6 && gg >= 150, `pixel ${i % W},${Math.floor(i / W)} is ${rr},${gg},${bb}, not backdrop or shadow`);
  }
  assert.ok(outside > W * H * 0.5, "most of the frame is backdrop");
});

test("the neck insert lies only inside the detected neck region: off the garment, in the top band, centred", () => {
  const cleaned = cleanMask(golden.mask);
  const neck = neckRegion(cleaned.mask);
  assert.ok(neck, "the V-neck notch is found");
  const { width: w, height: h } = cleaned.mask;
  let sx = 0;
  for (let i = 0; i < w * h; i++) {
    if (!neck.region[i]) continue;
    const x = i % w, y = Math.floor(i / w);
    sx += x + 0.5;
    assert.equal(cleaned.mask.data[i], 0, "never over a garment pixel");
    assert.ok(y < 60 + 0.25 * 900, `pixel ${x},${y} is below the top band`);
    assert.ok(kurtaShape(x, y, false) && !kurtaShape(x, y, true), `pixel ${x},${y} is not in the drawn notch`);
  }
  assert.ok(Math.abs(sx / neck.px - 320) <= 0.15 * 480, "the region's centroid is in the centre band");
  const insert = runs[0]!.params.insert as { present: boolean; colour: number[] };
  assert.equal(insert.present, true);
  assert.equal(neckRegion(cleanMask(kurta({ notch: false }).mask).mask), null, "no notch, no insert");
});

test("flattening lowers the shadow score, and WB and lighting gains never leave their bounds (50 seeded fixtures)", () => {
  const q = runs[0]!.params.quality as { shadow_score: number };
  const colour = runs[0]!.params.colour as { shadow_score_after: number; wb_gains: number[]; gain_applied: number[] };
  assert.ok(colour.shadow_score_after < q.shadow_score, `${colour.shadow_score_after} < ${q.shadow_score}`);
  let seed = 12345;
  const rand = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 2 ** 32;
  };
  for (let k = 0; k < 50; k++) {
    const n = 64;
    const rgb = Float64Array.from({ length: n * 3 }, () => Math.floor(rand() * 256));
    const m = Uint8Array.from({ length: n }, () => (rand() < 0.8 ? 1 : 0));
    for (const g of wbGains(rgb, m)) assert.ok(g >= 0.92 && g <= 1.08, `fixture ${k}: WB gain ${g}`);
    const fx = photo(24, 24, (x, y) => (x > 3 && y > 3 && x < 20 && y < 21 ? [Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256)] : null));
    const corr = correctGarment(fx.img, fx.mask, illumination(fx.img, fx.mask, 3));
    for (const g of corr.wb_gains) assert.ok(g >= 0.92 && g <= 1.08, `fixture ${k}: applied WB gain ${g}`);
    assert.ok(corr.gain_applied[0]! >= 1 + 0.7 * (0.8 - 1) - 1e-9 && corr.gain_applied[1]! <= 1 + 0.7 * (1.35 - 1) + 1e-9, `fixture ${k}: lighting gain ${corr.gain_applied}`);
  }
  assert.ok(shadowScore(illumination(golden.img, golden.mask, 108), golden.mask) > 0);
});

test("a composite-v2 job: receipt says composite-v2, generative false, every parameter; verifier and fidelity get the original photo bytes", async () => {
  const { sources, segments } = jobFor(golden);
  const seen: string[] = [];
  const verifier: Verifier = {
    identity: { provider: "fixture", model: "fixture-verifier", base: "fixture" },
    verify: async (req) => {
      seen.push(`verifier ${sha256Hex(req.sources[0]!.bytes)}`);
      return { raw: allMatch() };
    },
  };
  const fidelity: FidelityChecker = {
    check: async (req) => {
      seen.push(`fidelity ${sha256Hex(req.sources[0]!.bytes)}`);
      assert.ok(req.renderMask, "the composite hands over its own render mask");
      return { decision: "RELEASE", metrics: null, reasons: [] };
    },
  };
  const providers = { ...fixtureProviders({ renders: () => Buffer.from("never"), findings: allMatch, segments }), renderer: compositeV2Renderer(), verifier, fidelity };
  const out = mkdtempSync(join(tmpdir(), "composite-v2-job-"));
  const r = await runJob({ jobId: "v2", garmentNote: "kurta", scenes: ["studio"], sources }, { outRoot: out, providers, provenance: "fixture", clock: recordedClock(Array(20).fill("2026-10-28T13:00:00.000Z")) });
  const original = sha256Hex(sources[0]!.bytes);
  assert.deepEqual(seen, [`verifier ${original}`, `fidelity ${original}`]);
  const entries = parseReceipt(readFileSync(join(r.dir, RECEIPT_FILE), "utf8"));
  assert.equal(verifyChain(entries).ok, true);
  const render = entries.find((e) => e.kind === "render")!.payload as Record<string, unknown>;
  assert.deepEqual([render.provider, render.model, render.method, render.generative], ["composite", "composite-v2", "composite-v2", false]);
  const params = (render.composite as { params: Record<string, unknown> }).params;
  for (const key of Object.keys(V2_PARAMS)) assert.ok(key in params, `param ${key} is on the receipt`);
  for (const key of ["mask_cleanup", "quality", "colour", "insert", "rotation", "crop_box", "scale", "placed_box"]) assert.ok(key in params, `measured ${key} is on the receipt`);
  assert.match(String(render.note), /bounded, recorded amounts/);
  assert.equal(render.sha256, sha256Hex(readFileSync(join(r.dir, "v2-r0.png"))));
  assert.equal(r.renders[0]!.decision, "RELEASE");
});

test("each quality pre-check gives REVIEW with its exact reason, every check on the receipt, and no image", async () => {
  const flat = (r: number, g: number, b: number) => [r, g, b] as const;
  const cases: [keyof typeof QUALITY_REASONS, { img: RgbImage; mask: Mask }, V2Params?][] = [
    ["fragmentation", photo(400, 500, (x, y) => (x % 50 < 30 && y % 120 < 90 && x < 350 && y < 450 ? flat(120, 90, 60) : null))],
    ["coverage", photo(1000, 1000, (x, y) => (x >= 400 && x < 600 && y >= 300 && y < 600 ? flat(120, 90, 60) : null))],
    ["edge_touch", photo(500, 600, (x, y) => (y >= 100 ? flat(120, 90, 60) : null))],
    ["clipped", photo(640, 1000, (x, y) => (kurtaShape(x, y, true) ? flat(255, 255, 255) : null))],
    ["shadow", photo(640, 1000, (x, y) => (kurtaShape(x, y, true) ? (y > 500 ? flat(40, 15, 20) : flat(160, 60, 70)) : null))],
    ["resolution", photo(300, 400, (x, y) => (x >= 50 && x < 250 && y >= 25 && y < 375 ? flat(120, 90, 60) : null))],
    ["correction", golden, { ...V2_PARAMS, max_corr_de: 0.01 }],
  ];
  for (const [check, fixture, params] of cases) {
    const { sources, segments } = jobFor(fixture);
    const providers = { ...fixtureProviders({ renders: () => Buffer.from("never"), findings: allMatch, segments }), renderer: compositeV2Renderer(params) };
    const out = mkdtempSync(join(tmpdir(), `composite-v2-${check}-`));
    const r = await runJob({ jobId: check.replace("_", "-"), garmentNote: "kurta", scenes: ["studio"], sources }, { outRoot: out, providers, provenance: "fixture" });
    assert.deepEqual(r.renders.map((x) => [x.decision, x.cited?.rule, x.image_sha256]), [["REVIEW", "render_quality", null]], check);
    assert.equal(r.renders[0]!.cited?.reason, `CompositeQualityReview: ${QUALITY_REASONS[check].reason}`, check);
    const entries = parseReceipt(readFileSync(join(r.dir, RECEIPT_FILE), "utf8"));
    assert.deepEqual(entries.map((e) => e.kind), ["job", "segments", "gate"], `${check}: no render, no release`);
    const gate = entries[2]!.payload as { quality?: { quality?: { checks?: Record<string, unknown> } } };
    assert.deepEqual(Object.keys(gate.quality?.quality?.checks ?? {}), ["fragmentation", "coverage", "edge_touch", "clipped", "shadow", "resolution"], check);
    assert.equal(existsSync(join(r.dir, `${check.replace("_", "-")}-r0.png`)), false, `${check}: no image is written`);
  }
  assert.throws(() => compositeV2(cases[0]![1].img, cases[0]![1].mask), (e: unknown) => e instanceof CompositeQualityReview && e.check === "fragmentation");
});

test("RENDER_PROVIDER composite defaults to v2; v1 stays selectable; v2 takes no template", () => {
  const transport: RenderTransport = async () => ({ bytes: Buffer.from("x"), ext: "png" });
  assert.equal(rendererFromEnv({ RENDER_PROVIDER: "composite" }, transport).model, "composite-v2");
  assert.equal(rendererFromEnv({ RENDER_PROVIDER: "composite", MODEL_RENDER: "composite-v2" }, transport).model, "composite-v2");
  assert.equal(rendererFromEnv({ RENDER_PROVIDER: "composite", COMPOSITE_VERSION: "v1" }, transport).model, "composite-v1");
  assert.equal(rendererFromEnv({ RENDER_PROVIDER: "composite", MODEL_RENDER: "composite-v1" }, transport).model, "composite-v1");
  assert.equal(rendererFromEnv({ RENDER_PROVIDER: "composite", RENDER_TEMPLATE: "mannequin-01" }, transport).model, "composite-v1");
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "composite", COMPOSITE_VERSION: "v3" }, transport), RenderConfigError);
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "composite", COMPOSITE_VERSION: "v2", RENDER_TEMPLATE: "mannequin-01" }, transport), RenderConfigError);
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "composite", COMPOSITE_VERSION: "v2", MODEL_RENDER: "composite-v1" }, transport), RenderConfigError);
});
