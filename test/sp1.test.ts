import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CompositeQualityReview, compositeV2 } from "../src/composite-v2.ts";
import { decodeRgb } from "../src/image.ts";
import { decodePng, maskFromPng } from "../src/png.ts";
import type { Mask, RgbImage } from "../src/png.ts";
import { decodeSegments } from "../src/sam-parser.ts";
import { SP1_CASES, applyTransform, buildTransformCase, encodeJpeg, gateOf, jpegMarkers, sp1Summary } from "../src/sp1.ts";
import type { Sp1Transform } from "../src/sp1.ts";
import { sha256Hex } from "../src/util.ts";

const FRONT = "data/garments/shirt-plaid/1-front.jpg";
// The committed SAM 3.1 call on exactly that photo (prompt "shirt").
const SAM_LOG = "evidence/sam-2026-10-29T14-44-39-411Z.json";
const KURTA_FRONT = "data/garments/kurta-01/1-front.jpg";
const KURTA_SAM_LOG = "evidence/sam-2026-10-29T08-27-01-097Z.json";

test("SP1 lists Grok's twelve cases in order, each either built or marked as needing a real photo", () => {
  assert.deepEqual(SP1_CASES.map((c) => c.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(new Set(SP1_CASES.map((c) => c.id)).size, 12);
  const real = SP1_CASES.filter((c) => c.build.kind === "needs_real_photo").map((c) => c.n);
  assert.deepEqual(real, [2, 3, 4, 5, 6, 11, 12]);
  for (const c of SP1_CASES) {
    if (c.build.kind === "needs_real_photo") assert.ok(c.build.why.length > 10, `${c.id} says why it is not run`);
  }
});

test("SP1 transforms are pure: same input, same pixels; sizes as stated", () => {
  const img: RgbImage = { width: 40, height: 30, data: Uint8Array.from({ length: 40 * 30 * 3 }, (_, i) => (i * 7) % 256) };
  const ops: Sp1Transform[] = [
    { op: "exposure", gain: 0.04 },
    { op: "hard_shadow", darken: 0.3 },
    { op: "crop_bottom", keep: 0.7 },
    { op: "downscale", long_edge: 10 },
    { op: "light_ramp", from: 1, to: 0.62 },
  ];
  for (const op of ops) assert.deepEqual(applyTransform(img, op), applyTransform(img, op), op.op);
  assert.equal(applyTransform(img, { op: "crop_bottom", keep: 0.7 }).height, 21);
  const small = applyTransform(img, { op: "downscale", long_edge: 10 });
  assert.deepEqual([small.width, small.height], [10, 8]);
  assert.ok(applyTransform(img, { op: "exposure", gain: 0.04 }).data.every((v) => v <= 10));
});

test("SP1 photos carry no metadata: jpeg-js writes a JFIF header and no EXIF (APP1) or ICC (APP2)", () => {
  const bytes = encodeJpeg({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 3).fill(128) });
  const markers = jpegMarkers(bytes);
  assert.equal(markers[0], "E0");
  assert.ok(!markers.includes("E1") && !markers.includes("E2") && !markers.includes("FE"), markers.join(","));
});

test("buildTransformCase writes the photo, intake hash and a manifest that names the source and the transform", () => {
  const out = mkdtempSync(join(tmpdir(), "sp1-"));
  try {
    const c = SP1_CASES.find((x) => x.n === 9)!;
    const built = buildTransformCase(c, "data/garments", out);
    const bytes = new Uint8Array(readFileSync(join(built.dir, "1-front.jpg")));
    const intake = JSON.parse(readFileSync(join(built.dir, "intake.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(built.dir, "manifest.json"), "utf8"));
    assert.equal(intake.files[0].sha256, sha256Hex(bytes));
    assert.equal(manifest.synthetic, true);
    assert.equal(manifest.from.sha256, sha256Hex(new Uint8Array(readFileSync(FRONT))));
    assert.deepEqual(manifest.transform, { op: "downscale", long_edge: 400 });
    assert.equal(Math.max(manifest.photo.width, manifest.photo.height), 400);
    assert.ok(!jpegMarkers(bytes).includes("E1"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

async function frontAndMask(front = FRONT, samLog = SAM_LOG): Promise<{ img: RgbImage; mask: Mask }> {
  const bytes = new Uint8Array(readFileSync(front));
  const log = JSON.parse(readFileSync(samLog, "utf8")) as { output_text: string; prompt: string; image: { sha256: string } };
  assert.equal(log.image.sha256, sha256Hex(bytes));
  const segs = await decodeSegments(log.output_text, { name: "1-front.jpg", bytes }, log.prompt);
  return { img: decodeRgb(bytes), mask: maskFromPng(decodePng(new Uint8Array(Buffer.from(segs[0]!.mask, "base64")))) };
}

function preCheck(img: RgbImage, mask: Mask): string {
  try {
    compositeV2(img, mask);
    return "pass";
  } catch (err) {
    if (err instanceof CompositeQualityReview) return err.check;
    throw err;
  }
}

test("why the base is shirt-plaid: kurta-01's untouched front already fails the pre-check on clipping", async () => {
  const { img, mask } = await frontAndMask(KURTA_FRONT, KURTA_SAM_LOG);
  assert.equal(preCheck(img, mask), "clipped");
});

test("offline prediction on shirt-plaid's real front + its committed SAM mask: each transform trips the check its case names", async () => {
  const { img, mask } = await frontAndMask();
  assert.equal(preCheck(img, mask), "pass", "the untouched photo passes, so a failure below comes from the transform");
  const tr = (n: number) => (SP1_CASES.find((c) => c.n === n)!.build as { transform: Sp1Transform }).transform;
  // Brightness transforms keep the geometry, so the same mask still fits.
  assert.equal(preCheck(applyTransform(img, tr(1)), mask), "clipped");
  assert.equal(preCheck(applyTransform(img, tr(7)), mask), "shadow");
  // The crop cuts the mask the same way.
  const keep = (tr(8) as { keep: number }).keep;
  const cropped = applyTransform(img, tr(8));
  const cmask: Mask = { width: mask.width, height: cropped.height, data: mask.data.slice(0, mask.width * cropped.height) };
  assert.equal(preCheck(cropped, cmask), "edge_touch", `keep ${keep}`);
});

test("case 12 is not run: a light ramp on shirt-plaid reaches the shadow check before the correction check", async () => {
  const { img, mask } = await frontAndMask();
  const out = compositeV2(applyTransform(img, { op: "light_ramp", from: 1, to: 0.5 }), mask);
  const p = out.params as { colour: { correction_delta_e: number } };
  assert.equal(p.colour.correction_delta_e, 3.2701);
  assert.equal(preCheck(applyTransform(img, { op: "light_ramp", from: 1, to: 0.4 }), mask), "shadow");
});

test("gateOf reads the last gate entry and its cited reason", () => {
  const r = [
    JSON.stringify({ kind: "job", payload: {} }),
    JSON.stringify({ kind: "gate", payload: { render_id: "x-r0", decision: "REVIEW", cited: { rule: "render_quality", reason: "harsh shadow across the garment; retake in shade" } } }),
  ].join("\n");
  assert.deepEqual(gateOf(r), { decision: "REVIEW", reason: "render_quality: harsh shadow across the garment; retake in shade" });
  assert.equal(gateOf(JSON.stringify({ kind: "job", payload: {} })), null);
});

test("sp1Summary counts run, not run, agreement and releases", () => {
  const s = sp1Summary([
    { n: 1, case: "a", pain: "", expected: "REVIEW", expected_rule: "", status: "run", actual: "REVIEW", agrees: true, note: "" },
    { n: 2, case: "b", pain: "", expected: "REVIEW", expected_rule: "", status: "not_run", note: "" },
    { n: 3, case: "c", pain: "", expected: "REFUSE", expected_rule: "", status: "run", actual: "REVIEW", agrees: false, note: "" },
  ]);
  assert.deepEqual(s, { cases: 3, run: 2, not_run: 1, answered: 2, agree: 1, disagree: 1, released: 0 });
});
