import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fixtureProviders, runJob } from "../src/pipeline.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { parseReceipt, recordedClock } from "../src/receipt.ts";
import { FILE_MODEL_PREFIX, MuseImageRefused, RenderConfigError, STAND_IN_MODEL, StandInError, fileRenderer, imageExt, refuseMuseImage, rendererFromEnv, standInRenderer } from "../src/render.ts";
import type { RenderTransport } from "../src/render.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

/** A transport that records every request and never touches the network. */
function recording() {
  const calls: Parameters<RenderTransport>[0][] = [];
  const transport: RenderTransport = async (req) => {
    calls.push(req);
    return { bytes: Buffer.from(`rendered by ${req.model}`), ext: "png" };
  };
  return { calls, transport };
}

const req = { scene: "studio", prompt: "p", sources: [{ name: "front.png", bytes: Buffer.from("front") }] };

const MUSE_IDS = ["muse-image", "Muse Image", "meta/muse_image-1", "MUSE.IMAGE", "muse/image", "muse  image v2", "llama-muse-image-preview"];

test("RENDER_PROVIDER defaults to openai-images with its default model, and the request carries provider and model", async () => {
  const { calls, transport } = recording();
  for (const env of [{}, { RENDER_PROVIDER: "" }, { RENDER_PROVIDER: "  ", MODEL_RENDER: " " }]) {
    const r = rendererFromEnv(env, transport);
    assert.deepEqual([r.provider, r.model], ["openai-images", "gpt-image-1"]);
  }
  const r = rendererFromEnv({ RENDER_PROVIDER: "fal", MODEL_RENDER: " some/model " }, transport);
  assert.deepEqual([r.provider, r.model], ["fal", "some/model"]);
  await r.render(req);
  assert.deepEqual(calls.map((c) => [c.provider, c.model, c.scene, c.prompt]), [["fal", "some/model", "studio", "p"]]);
});

test("an unknown provider, or meta or fal with no MODEL_RENDER, throws before any request", () => {
  const { calls, transport } = recording();
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "midjourney" }, transport), RenderConfigError);
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "META" }, transport), /is not one of openai-images, fal, meta, stand-in/);
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "meta" }, transport), /meta needs MODEL_RENDER/);
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "meta", MODEL_RENDER: "  " }, transport), /meta needs MODEL_RENDER/);
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "fal" }, transport), /fal needs MODEL_RENDER/);
  assert.equal(calls.length, 0);
});

test("a Muse Image model is refused on every provider before any request", () => {
  const { calls, transport } = recording();
  for (const provider of ["openai-images", "fal", "meta"]) {
    for (const model of MUSE_IDS) {
      assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: provider, MODEL_RENDER: model }, transport), MuseImageRefused, `${provider} ${model}`);
    }
  }
  assert.equal(calls.length, 0);
  // No separator is still Muse Image: the pattern allows zero separators.
  assert.throws(() => refuseMuseImage("museimage"), MuseImageRefused);
  for (const model of ["muse-spark", "gpt-image-1", "image-muse", "muse"]) assert.doesNotThrow(() => refuseMuseImage(model), model);
});

test("the stand-in renderer returns the first source byte for byte, names itself, and never calls a transport", async () => {
  const r = standInRenderer();
  assert.deepEqual([r.provider, r.model], ["stand-in", STAND_IN_MODEL]);
  const jpg = await r.render({ scene: "studio", prompt: "p", sources: [{ name: "1-front.jpg", bytes: JPEG }, { name: "2-back.jpg", bytes: PNG }] });
  assert.equal(jpg.ext, "jpg");
  assert.equal(Buffer.compare(Buffer.from(jpg.bytes), JPEG), 0, "the bytes are the first source's, unchanged");
  const png = await r.render({ scene: "street", prompt: "p", sources: [{ name: "front.png", bytes: PNG }] });
  assert.equal(png.ext, "png");
  // Nothing to stand in for, or bytes that are not an image, is a throw: the pipeline records render_failed.
  await assert.rejects(r.render({ scene: "studio", prompt: "p", sources: [] }), StandInError);
  await assert.rejects(r.render({ scene: "studio", prompt: "p", sources: [{ name: "note.txt", bytes: Buffer.from("not an image") }] }), /note\.txt is not a JPEG or PNG/);
  assert.equal(imageExt(Buffer.from([0xff, 0xd8])), null, "a JPEG needs three magic bytes");
  assert.equal(imageExt(new Uint8Array(0)), null);

  const { calls, transport } = recording();
  const fromEnv = rendererFromEnv({ RENDER_PROVIDER: "stand-in" }, transport);
  assert.deepEqual([fromEnv.provider, fromEnv.model], ["stand-in", STAND_IN_MODEL]);
  await fromEnv.render({ ...req, sources: [{ name: "1-front.jpg", bytes: JPEG }] });
  assert.equal(calls.length, 0, "the stand-in sends no request");
  assert.doesNotThrow(() => rendererFromEnv({ RENDER_PROVIDER: "stand-in", MODEL_RENDER: ` ${STAND_IN_MODEL} ` }, transport));
  // A model id on a stand-in receipt would be a false claim: refused before anything runs.
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "stand-in", MODEL_RENDER: "gpt-image-1" }, transport), RenderConfigError);
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "stand-in", MODEL_RENDER: "gpt-image-1" }, transport), /generates nothing/);
});

test("a stand-in job's receipt says stand-in / owner-photo on the render entry and releases the source's own hash", async () => {
  const p = fixtureProviders({
    renders: () => Buffer.from("never used"),
    findings: () => ({ findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95 })) }),
  });
  const providers = { ...p, renderer: standInRenderer() };
  const clock = () => recordedClock(Array(20).fill("2026-10-28T03:00:00.000Z"));
  const out = mkdtempSync(join(tmpdir(), "stand-in-"));
  const r = await runJob(
    { jobId: "owner", garmentNote: "peach kurta", scenes: ["studio"], sources: [{ name: "1-front.jpg", bytes: JPEG }, { name: "2-back.jpg", bytes: PNG }] },
    { outRoot: out, providers, provenance: "fixture", clock: clock() },
  );
  assert.deepEqual(r.renders.map((x) => [x.decision, x.image_sha256]), [["RELEASE", sha256Hex(JPEG)]]);
  const entries = parseReceipt(readFileSync(join(r.dir, RECEIPT_FILE), "utf8"));
  const render = entries.find((e) => e.kind === "render")!.payload as { provider: string; model: string; sha256: string };
  assert.deepEqual([render.provider, render.model, render.sha256], ["stand-in", STAND_IN_MODEL, sha256Hex(JPEG)]);
  assert.equal(Buffer.compare(readFileSync(join(r.dir, "owner-r0.jpg")), JPEG), 0, "the file beside the receipt is the photo, as a .jpg");

  // A source that is not an image: the scene is refused as render_failed, with the reason on the receipt.
  const bad = await runJob(
    { jobId: "text", garmentNote: "x", scenes: ["studio"], sources: [{ name: "note.txt", bytes: Buffer.from("words") }] },
    { outRoot: out, providers, provenance: "fixture", clock: clock() },
  );
  assert.deepEqual(bad.renders.map((x) => [x.decision, x.cited?.rule]), [["REFUSE", "render_failed"]]);
  assert.match(String(bad.renders[0]!.cited?.reason), /^StandInError: note\.txt is not a JPEG or PNG/);
});

test("a file stand-in returns the given image, not the job's front, and the receipt names the file", async () => {
  assert.throws(() => fileRenderer("kurta-02/1-front.jpg", Buffer.from("not an image")), StandInError);
  assert.throws(() => fileRenderer("  ", JPEG), /needs a label/);
  const r = fileRenderer("kurta-02/1-front.jpg", PNG);
  assert.deepEqual([r.provider, r.model], ["stand-in", `${FILE_MODEL_PREFIX}kurta-02/1-front.jpg`]);
  const p = fixtureProviders({
    renders: () => Buffer.from("never used"),
    findings: () => ({ findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "mismatch", confidence: 0.95 })) }),
  });
  const out = await runJob(
    { jobId: "mismatch", garmentNote: "peach kurta", scenes: ["studio"], sources: [{ name: "1-front.jpg", bytes: JPEG }] },
    { outRoot: mkdtempSync(join(tmpdir(), "file-stand-in-")), providers: { ...p, renderer: r }, provenance: "fixture", clock: recordedClock(Array(20).fill("2026-10-28T04:30:00.000Z")) },
  );
  assert.deepEqual(out.renders.map((x) => x.image_sha256), [sha256Hex(PNG)], "the released bytes are the file's, not the source's");
  assert.notEqual(out.renders[0]!.decision, "RELEASE", "mismatch findings never release");
  const render = parseReceipt(readFileSync(join(out.dir, RECEIPT_FILE), "utf8")).find((e) => e.kind === "render")!.payload as { provider: string; model: string };
  assert.deepEqual([render.provider, render.model], ["stand-in", "file:kurta-02/1-front.jpg"]);
});

test("the pipeline refuses every scene of a renderer that names Muse Image, without calling it", async () => {
  let called = 0;
  const p = fixtureProviders({
    renders: () => Buffer.from("x"),
    findings: () => ({ findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95 })) }),
  });
  const muse = { ...p, renderer: { provider: "meta" as const, model: "Muse-Image-1", render: async () => (called++, { bytes: Buffer.from("x"), ext: "png" }) } };
  const r = await runJob(
    { jobId: "muse", garmentNote: "kurta", scenes: ["studio", "street"], sources: req.sources },
    { outRoot: mkdtempSync(join(tmpdir(), "render-")), providers: muse, provenance: "fixture", clock: recordedClock(Array(10).fill("2026-10-27T10:00:00.000Z")) },
  );
  assert.equal(called, 0);
  assert.deepEqual(r.renders.map((x) => [x.decision, x.cited?.rule]), [["REFUSE", "render_failed"], ["REFUSE", "render_failed"]]);
  assert.match(String(r.renders[0]!.cited?.reason), /^MuseImageRefused: "Muse-Image-1" is Muse Image/);
  const kinds = parseReceipt(readFileSync(join(r.dir, RECEIPT_FILE), "utf8")).map((e) => e.kind);
  assert.deepEqual(kinds, ["job", "segments", "gate", "gate"]);
});
