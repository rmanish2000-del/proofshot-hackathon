import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fixtureProviders, runJob } from "../src/pipeline.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { parseReceipt, recordedClock } from "../src/receipt.ts";
import { MuseImageRefused, RenderConfigError, refuseMuseImage, rendererFromEnv } from "../src/render.ts";
import type { RenderTransport } from "../src/render.ts";
import { ATTRIBUTES } from "../src/types.ts";

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
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "META" }, transport), /is not one of openai-images, fal, meta/);
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
