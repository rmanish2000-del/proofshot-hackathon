import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkImage } from "../src/check.ts";
import { COMPOSITE_MODEL, CompositeError, composite, cutout, garmentQuad, loadTemplate, templateFromFiles, warp } from "../src/composite.ts";
import type { Quad, Template } from "../src/composite.ts";
import { maskedFidelityChecker } from "../src/fidelity.ts";
import { MANNEQUIN_LICENSE, drawMannequin, mannequinAnchors } from "../src/mannequin.ts";
import { fixtureProviders, runJob } from "../src/pipeline.ts";
import type { Segment } from "../src/pipeline.ts";
import { encodeGreyPng, encodeRgbPng } from "../src/png.ts";
import type { Mask, RgbImage } from "../src/png.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { parseReceipt, recordedClock, verifyChain } from "../src/receipt.ts";
import { RenderConfigError, TEMPLATES_DIR, compositeRenderer, rendererFromEnv } from "../src/render.ts";
import type { RenderTransport } from "../src/render.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";

// A tiny synthetic fixture: a 32x48 template and a 16x16 garment photo whose
// background is pure magenta, so a background pixel in the output would show.
const MAGENTA = [255, 0, 255] as const;

function baseImage(): RgbImage {
  const w = 32, h = 48;
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    data[i * 3] = 200;
    data[i * 3 + 1] = 190 + (i % 7);
    data[i * 3 + 2] = 180;
  }
  return { width: w, height: h, data };
}

function garmentPhoto(): { img: RgbImage; mask: Mask } {
  const w = 16, h = 16;
  const data = new Uint8Array(w * h * 3);
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // A 10x12 garment with a notch (the neckline) cut from its top middle.
      const inside = x >= 3 && x < 13 && y >= 2 && y < 14 && !(y < 4 && x >= 7 && x < 9);
      m[i] = inside ? 1 : 0;
      const [r, g, b] = inside ? [20 + x * 10, 60 + y * 8, (x * y) % 256] : MAGENTA;
      data[i * 3] = r;
      data[i * 3 + 1] = g;
      data[i * 3 + 2] = b;
    }
  }
  return { img: { width: w, height: h, data }, mask: { width: w, height: h, data: m } };
}

const TORSO: Quad = [[4, 4], [28, 4], [28, 44], [4, 44]];

function tinyTemplate(): Template {
  const base = baseImage();
  return templateFromFiles("tiny-01", {
    base: encodeRgbPng(base.width, base.height, base.data),
    anchors: Buffer.from(JSON.stringify({ kind: "mannequin", torso_quad: TORSO, occluders: null, source: "test", licence: "CC0-1.0" })),
    licence: Buffer.from("CC0"),
  });
}

function maskPng(mask: Mask): Uint8Array {
  return encodeGreyPng(mask.width, mask.height, mask.data.map((v) => (v ? 255 : 0)));
}

test("composite is deterministic: three runs give one PNG, and it matches the golden hashes", () => {
  const { img, mask } = garmentPhoto();
  const t = tinyTemplate();
  const runs = [0, 1, 2].map(() => composite(img, mask, t));
  const shas = runs.map((r) => sha256Hex(r.png));
  assert.equal(new Set(shas).size, 1, "byte-identical PNG on every run");
  // Golden values for this fixture: the pixels (independent of the deflate
  // build) and the PNG bytes (node 22's zlib, as in CI).
  assert.equal(sha256Hex(runs[0]!.image.data), "b4d776d2c8ff84e607341b8d22441e096d23e90120b6a81ab35c9963832727ec");
  assert.equal(shas[0], "da339d6b57b507fcfa42eaf3c272390810f211d76a30fcab296c35293b22da86");
  assert.deepEqual(runs[0]!.quad_from, [[3, 2], [13, 2], [13, 14], [3, 14]]);
});

test("an identity warp with no feather copies the masked pixels exactly and nothing else", () => {
  const { img, mask } = garmentPhoto();
  const cut = cutout(img, mask, 0);
  const q = garmentQuad(mask);
  const out = warp(cut, q, q, img.width, img.height);
  for (let i = 0; i < img.width * img.height; i++) {
    if (mask.data[i]) {
      assert.deepEqual([...out.data.subarray(i * 4, i * 4 + 4)], [img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2], 255], `pixel ${i}`);
    } else {
      assert.equal(out.data[i * 4 + 3], 0, `pixel ${i} is outside the mask and stays transparent`);
    }
  }
});

test("outside the warped mask every pixel is the template's, and no source background pixel reaches the output", () => {
  const { img, mask } = garmentPhoto();
  const t = tinyTemplate();
  const r = composite(img, mask, t);
  let inside = 0;
  for (let i = 0; i < r.image.width * r.image.height; i++) {
    const px = [...r.image.data.subarray(i * 3, i * 3 + 3)];
    if (!r.renderMask.data[i]) assert.deepEqual(px, [...t.base.data.subarray(i * 3, i * 3 + 3)], `pixel ${i}`);
    else inside++;
    assert.ok(!(px[0]! > 200 && px[1]! < 60 && px[2]! > 200), `pixel ${i} carries magenta from the photo's background`);
  }
  assert.ok(inside > 100, "the garment landed on the template");
  // Feathering is inward only: a feathered cutout has no alpha outside the mask.
  const cut = cutout(img, mask);
  for (let i = 0; i < mask.data.length; i++) if (!mask.data[i]) assert.equal(cut.data[i * 4 + 3], 0);
});

test("an empty or missing mask is a CompositeError, recorded as render_failed, and the gate refuses", async () => {
  const { img } = garmentPhoto();
  assert.throws(() => garmentQuad({ width: 4, height: 4, data: new Uint8Array(16) }), CompositeError);
  const t = tinyTemplate();
  const front = { name: "1-front.png", bytes: encodeRgbPng(img.width, img.height, img.data) };
  const back = { name: "2-back.png", bytes: front.bytes };
  const allMatch = () => ({ findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95 })) });
  const backOnly: Segment[] = [{ label: "2-back.png/kurta", box: [0, 0, 1, 1], score: 0.99, mask: maskPng(garmentPhoto().mask) }];
  const out = mkdtempSync(join(tmpdir(), "composite-nomask-"));
  for (const [jobId, segments] of [["none", []], ["back-only", backOnly], ["hash-only", [{ label: "1-front.png/kurta", box: [0, 0, 1, 1], score: 0.9, mask: { sha256: "ab" } }]]] as const) {
    const providers = { ...fixtureProviders({ renders: () => Buffer.from("never"), findings: allMatch, segments: segments as Segment[] }), renderer: compositeRenderer(t) };
    const r = await runJob({ jobId, garmentNote: "kurta", scenes: ["studio"], sources: [front, back] }, { outRoot: out, providers, provenance: "fixture" });
    assert.deepEqual(r.renders.map((x) => [x.decision, x.cited?.rule, x.image_sha256]), [["REFUSE", "render_failed", null]], jobId);
    assert.match(String(r.renders[0]!.cited?.reason), /^CompositeError: no garment mask/, jobId);
  }
});

test("RENDER_PROVIDER composite loads its template, refuses another MODEL_RENDER, and never calls the transport", async () => {
  const calls: unknown[] = [];
  const transport: RenderTransport = async (req) => {
    calls.push(req);
    return { bytes: Buffer.from("x"), ext: "png" };
  };
  const dir = mkdtempSync(join(tmpdir(), "templates-"));
  const base = baseImage();
  mkdirSync(join(dir, "tiny-01"));
  writeFileSync(join(dir, "tiny-01", "base.png"), encodeRgbPng(base.width, base.height, base.data));
  writeFileSync(join(dir, "tiny-01", "anchors.json"), JSON.stringify({ kind: "mannequin", torso_quad: TORSO, occluders: null, source: "test", licence: "CC0-1.0" }));
  writeFileSync(join(dir, "tiny-01", "LICENSE.txt"), "CC0");
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "composite", MODEL_RENDER: "gpt-image-1", RENDER_TEMPLATE: "tiny-01" }, transport, dir), RenderConfigError);
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "composite", RENDER_TEMPLATE: "../x" }, transport, dir), RenderConfigError);
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "composite", RENDER_TEMPLATE: "absent" }, transport, dir), CompositeError);
  const r = rendererFromEnv({ RENDER_PROVIDER: "composite", MODEL_RENDER: COMPOSITE_MODEL, RENDER_TEMPLATE: "tiny-01" }, transport, dir);
  assert.deepEqual([r.provider, r.model], ["composite", "composite-v1"]);
  const { img, mask } = garmentPhoto();
  const front = { name: "1-front.png", bytes: encodeRgbPng(img.width, img.height, img.data) };
  const out = await r.render({ scene: "studio", prompt: "p", sources: [front], segments: [{ label: "1-front.png/kurta", box: [0, 0, 1, 1], score: 0.9, mask: maskPng(mask) }] });
  assert.equal(out.ext, "png");
  assert.equal(calls.length, 0, "composite sends no request");
  // The default template is mannequin-01, committed in templates/.
  assert.equal(rendererFromEnv({ RENDER_PROVIDER: "composite" }, transport).model, COMPOSITE_MODEL);
  assert.equal(calls.length, 0);
});

test("a composite job's receipt names the method, generative false, template and mask; fidelity uses the warped source mask; the chain verifies", async () => {
  const { img, mask } = garmentPhoto();
  const t = tinyTemplate();
  const front = { name: "1-front.png", bytes: encodeRgbPng(img.width, img.height, img.data) };
  const segments: Segment[] = [
    { label: "1-front.png/kurta", box: [0, 0, 1, 1], score: 0.5, mask: maskPng({ ...mask, data: mask.data.map((v, i) => (i % 16 < 8 ? v : 0)) }) },
    { label: "1-front.png/kurta", box: [0, 0, 1, 1], score: 0.97, mask: maskPng(mask) },
  ];
  const allMatch = () => ({ findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95 })) });
  const p = fixtureProviders({ renders: () => Buffer.from("never"), findings: allMatch, segments });
  const providers = { ...p, renderer: compositeRenderer(t), fidelity: maskedFidelityChecker() };
  const out = mkdtempSync(join(tmpdir(), "composite-job-"));
  const r = await runJob({ jobId: "comp", garmentNote: "kurta", scenes: ["studio"], sources: [front] }, { outRoot: out, providers, provenance: "fixture", clock: recordedClock(Array(20).fill("2026-10-28T12:00:00.000Z")) });
  const entries = parseReceipt(readFileSync(join(r.dir, RECEIPT_FILE), "utf8"));
  assert.equal(verifyChain(entries).ok, true);
  const render = entries.find((e) => e.kind === "render")!.payload as Record<string, unknown>;
  assert.equal(render.provider, "composite");
  assert.equal(render.model, "composite-v1");
  assert.equal(render.method, "composite");
  assert.equal(render.generative, false);
  assert.deepEqual(render.template, { id: "tiny-01", sha256_base: t.sha256_base, sha256_anchors: t.sha256_anchors, licence: "CC0-1.0", kind: "mannequin" });
  assert.deepEqual(render.mask, { source: "1-front.png", segment_index: 1, sam_score: 0.97 }, "the top-scoring front mask");
  assert.deepEqual((render.params as Record<string, unknown>).feather_px, 3);
  const png = readFileSync(join(r.dir, "comp-r0.png"));
  assert.equal(render.sha256, sha256Hex(png));
  const fidelity = entries.find((e) => e.kind === "fidelity")!.payload as Record<string, unknown>;
  assert.equal(fidelity.render_mask, "warped-source-mask");
  assert.ok(fidelity.metrics, "measured, not REVIEW for a missing mask");
  if (r.renders[0]!.decision === "RELEASE") assert.equal(checkImage(entries, sha256Hex(png)).status, "VALID");
  else assert.equal(checkImage(entries, sha256Hex(png)).status, "NOT RELEASED");
});

test("a template with no licence, bad anchors, or a quad outside its base is refused at load", () => {
  const base = baseImage();
  const png = encodeRgbPng(base.width, base.height, base.data);
  const anchors = (over: Record<string, unknown>) => Buffer.from(JSON.stringify({ kind: "mannequin", torso_quad: TORSO, occluders: null, source: "s", licence: "CC0-1.0", ...over }));
  assert.throws(() => templateFromFiles("t", { base: png, anchors: anchors({}), licence: null }), /no LICENSE\.txt/);
  assert.throws(() => templateFromFiles("t", { base: png, anchors: anchors({}), licence: Buffer.from("  \n") }), /no LICENSE\.txt/);
  assert.throws(() => templateFromFiles("t", { base: png, anchors: anchors({ torso_quad: [[0, 0], [1, 0], [1, 1]] }), licence: Buffer.from("x") }), /four \[x, y\] points/);
  assert.throws(() => templateFromFiles("t", { base: png, anchors: anchors({ kind: "person" }), licence: Buffer.from("x") }), /kind/);
  assert.throws(() => templateFromFiles("t", { base: png, anchors: anchors({ licence: "" }), licence: Buffer.from("x") }), /licence is missing/);
  assert.throws(() => templateFromFiles("t", { base: png, anchors: anchors({ torso_quad: [[0, 0], [99, 0], [99, 9], [0, 9]] }), licence: Buffer.from("x") }), /outside/);
  assert.throws(() => templateFromFiles("t", { base: png, anchors: anchors({ occluders: "occ.png" }), licence: Buffer.from("x") }), /occluder/);
  assert.throws(() => templateFromFiles("t", { base: png, anchors: Buffer.from("{"), licence: Buffer.from("x") }), /not JSON/);
  assert.throws(() => templateFromFiles("t", { base: Buffer.from("nope"), anchors: anchors({}), licence: Buffer.from("x") }), CompositeError);
  const dir = mkdtempSync(join(tmpdir(), "tpl-nolicence-"));
  writeFileSync(join(dir, "base.png"), png);
  writeFileSync(join(dir, "anchors.json"), anchors({}));
  assert.throws(() => loadTemplate(dir, "t"), /no LICENSE\.txt/);
});

test("the committed mannequin-01 template is exactly what src/mannequin.ts draws", () => {
  const dir = join(TEMPLATES_DIR, "mannequin-01");
  const img = drawMannequin();
  assert.equal(sha256Hex(readFileSync(join(dir, "base.png"))), sha256Hex(encodeRgbPng(img.width, img.height, img.data)), "run npm run make:template");
  assert.equal(readFileSync(join(dir, "anchors.json"), "utf8"), mannequinAnchors());
  assert.equal(readFileSync(join(dir, "LICENSE.txt"), "utf8"), MANNEQUIN_LICENSE);
  const t = loadTemplate(dir, "mannequin-01");
  assert.deepEqual([t.base.width, t.base.height, t.kind], [1024, 1536, "mannequin"]);
});
