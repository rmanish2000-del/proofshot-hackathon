import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkFidelity, loadThresholds, maskedFidelityChecker } from "../src/fidelity.ts";
import { fixtureProviders, runJob } from "../src/pipeline.ts";
import type { RenderedImage, Renderer, Segment, SourceImage } from "../src/pipeline.ts";
import { decodePng, encodeGreyPng, encodeRgbPng } from "../src/png.ts";
import type { RgbImage } from "../src/png.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { parseReceipt } from "../src/receipt.ts";
import {
  AI_PREVIEW_LABEL, DEFAULT_MODEL_IMAGE, MODELS_DIR, REPLICATE_MODEL, REPLICATE_PREDICTIONS_URL, REPLICATE_PROVIDER, SPEND_CAP_USD,
  GARMENT_MARGIN, TRYON_LONG_ENV, claimedReach, estimateCostUsd, isLongGarment, tryOnLongRequested, modelCovers, fileLedger, garmentCutout, loadModelImage, replicateTryOnRenderer, stripImageMetadata, tryOnOptions, tryOnPrompt,
} from "../src/render-replicate.ts";
import type { Ledger, LedgerEntry, ReplicateFetch, ReplicateResponse } from "../src/render-replicate.ts";
import { loadRecording, recordJob, replayJob } from "../src/replay.ts";
import { providersFromEnv } from "../src/serve.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";

// Low-entropy fake, never a real token.
const TOKEN = "r8_test-token-not-real"; // gitleaks:allow

// A striped garment on grey: the source photo, its full-garment mask, and a recoloured lookalike.
function garment(recolour = false): RgbImage {
  const w = 64, h = 80, data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const inside = x >= 8 && x < 56 && y >= 8 && y < 72;
      const stripe = (x >> 3) & 1;
      const c = !inside ? [128, 128, 128] : recolour ? (stripe ? [30, 160, 40] : [20, 90, 30]) : (stripe ? [200, 30, 40] : [120, 20, 30]);
      data.set(c, i);
    }
  }
  return { width: w, height: h, data };
}
const maskBytes = (img: RgbImage): Uint8Array => {
  const m = new Uint8Array(img.width * img.height);
  for (let y = 8; y < 72; y++) for (let x = 8; x < 56; x++) m[y * img.width + x] = 255;
  return encodeGreyPng(img.width, img.height, m);
};
const SOURCE = garment();
const sources: SourceImage[] = [{ name: "1-front.png", bytes: encodeRgbPng(SOURCE.width, SOURCE.height, SOURCE.data) }];
const segments: Segment[] = [{ label: "1-front.png/kurta", box: [0, 0, 1, 1], score: 0.95, mask: maskBytes(SOURCE) }];
const req = { scene: "studio", prompt: "p", sources, segments };

/** A fallback that stands for composite v2 and records that it ran. */
function fakeComposite(): Renderer & { calls: number } {
  const r = {
    provider: "composite" as const,
    model: "composite-v2",
    calls: 0,
    render: async (): Promise<RenderedImage> => {
      r.calls++;
      return { bytes: sources[0]!.bytes, ext: "png", record: { method: "composite-v2", generative: false } };
    },
  };
  return r;
}

function memoryLedger(entries: LedgerEntry[] = []): Ledger & { entries: LedgerEntry[] } {
  return { entries, read: () => entries, append: (e) => void entries.push(e) };
}

function modelsDir(opts: { image?: boolean; licence?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "ps-models-"));
  mkdirSync(join(dir, DEFAULT_MODEL_IMAGE));
  if (opts.image ?? true) writeFileSync(join(dir, DEFAULT_MODEL_IMAGE, "image.png"), encodeRgbPng(4, 4, new Uint8Array(48).fill(200)));
  if (opts.licence ?? true) writeFileSync(join(dir, DEFAULT_MODEL_IMAGE, "LICENSE.md"), "synthetic, not a real person\n");
  return dir;
}

const json = (status: number, body: unknown): ReplicateResponse => ({ ok: status < 300, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) });
const file = (bytes: Uint8Array): ReplicateResponse => ({ ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });

/** A Replicate that creates, answers one poll with processing, then succeeded, then serves `output`. */
function fakeReplicate(output: Uint8Array) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fetch: ReplicateFetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
    if (url === REPLICATE_PREDICTIONS_URL) return json(201, { id: "pred-1", version: "v-abc", status: "starting", urls: { get: "https://api.replicate.com/v1/predictions/pred-1" } });
    if (url.endsWith("/pred-1")) {
      const n = calls.filter((c) => c.url.endsWith("/pred-1")).length;
      return json(200, n === 1 ? { id: "pred-1", status: "processing", urls: { get: url } } : { id: "pred-1", version: "v-abc", status: "succeeded", output: ["https://replicate.delivery/out.png"] });
    }
    if (url === "https://replicate.delivery/out.png") return file(output);
    throw new Error(`unexpected ${url}`);
  };
  return { calls, fetch };
}

const base = (over: Partial<Parameters<typeof replicateTryOnRenderer>[0]> = {}) => {
  const fallback = fakeComposite();
  const ledger = memoryLedger();
  const opts = { env: { REPLICATE_API_TOKEN: TOKEN }, fetch: null, fallback, ledger, modelsDir: modelsDir(), sleep: async () => {}, ...over };
  return { fallback, ledger, renderer: replicateTryOnRenderer(opts) };
};

test("NR4 1: no REPLICATE_API_TOKEN falls back to the composite with no_api_token, and no request is sent", async () => {
  const { fetch, calls } = fakeReplicate(sources[0]!.bytes);
  const { fallback, renderer } = base({ env: {}, fetch });
  assert.deepEqual([renderer.provider, renderer.model], [REPLICATE_PROVIDER, REPLICATE_MODEL]);
  const out = await renderer.render(req);
  assert.equal(calls.length, 0);
  assert.equal(fallback.calls, 1);
  assert.deepEqual(out.madeBy, { provider: "composite", model: "composite-v2" });
  assert.equal(out.record?.generative, false);
  assert.equal(out.record?.fallback_reason, "no_api_token");
  assert.equal(out.record?.method, "composite-v2");
});

test("NR4 2: a missing model image or LICENSE.md falls back with no_model_image", async () => {
  const { fetch, calls } = fakeReplicate(sources[0]!.bytes);
  for (const dir of [modelsDir({ image: false }), modelsDir({ licence: false })]) {
    const { renderer } = base({ fetch, modelsDir: dir });
    const out = await renderer.render(req);
    assert.equal(out.record?.fallback_reason, "no_model_image");
  }
  assert.equal(calls.length, 0);
  assert.ok("missing" in loadModelImage(modelsDir(), `../${DEFAULT_MODEL_IMAGE}`));
  // The committed synthetic-01 (3e852fd: model.png + LICENSE.md) loads as the default.
  const committed = loadModelImage(MODELS_DIR, DEFAULT_MODEL_IMAGE);
  assert.ok(!("missing" in committed), JSON.stringify("missing" in committed ? committed : null));
  assert.deepEqual([committed.id, committed.ext], [DEFAULT_MODEL_IMAGE, "png"]);
});

test("NR4 3: two timed-out attempts fall back with replicate_timeout and the reason, never silently", async () => {
  let posts = 0;
  const fetch: ReplicateFetch = async () => {
    posts++;
    throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  };
  const { fallback, ledger, renderer } = base({ fetch });
  const out = await renderer.render(req);
  assert.equal(posts, 2);
  assert.equal(fallback.calls, 1);
  assert.equal(out.record?.fallback_reason, "replicate_timeout");
  assert.match(String(out.record?.fallback_detail), /no answer within 120000 ms; no answer within 120000 ms/);
  assert.equal(ledger.entries.length, 0);

  // A prediction that never finishes times out on the clock too.
  let t = 0;
  const slow: ReplicateFetch = async (url) => json(200, { id: "p", status: "processing", urls: { get: `${url}/p` } });
  const r2 = base({ fetch: slow, now: () => t, sleep: async (ms) => void (t += ms), timeoutMs: 10_000 });
  const out2 = await r2.renderer.render(req);
  assert.equal(out2.record?.fallback_reason, "replicate_timeout");
});

test("NR4 4: a mocked success carries every receipt field, strips metadata, logs the spend, and the token appears nowhere", async () => {
  // The output PNG carries a tEXt chunk that must not survive.
  const plain = encodeRgbPng(SOURCE.width, SOURCE.height, SOURCE.data);
  const text = Buffer.from([0, 0, 0, 5, ...Buffer.from("tEXtsecrt"), 0, 0, 0, 0]);
  const tagged = Buffer.concat([plain.subarray(0, 33), text, plain.subarray(33)]);
  const { fetch, calls } = fakeReplicate(tagged);
  const { ledger, renderer, fallback } = base({ fetch });
  const out = await renderer.render(req);

  assert.equal(fallback.calls, 0);
  assert.equal(out.madeBy, undefined);
  assert.deepEqual(Buffer.from(out.bytes), Buffer.from(plain));
  const r = out.record!;
  assert.equal(r.generative, true);
  assert.equal(r.model_version, "v-abc");
  assert.equal(r.prediction_id, "pred-1");
  assert.equal(r.model_image_id, DEFAULT_MODEL_IMAGE);
  assert.equal(r.cost_usd, null);
  assert.equal(r.cost_estimated_usd, 0.015);
  assert.equal(r.label, AI_PREVIEW_LABEL);
  assert.deepEqual(ledger.entries.map((e) => [e.prediction_id, e.cost_usd, e.estimated]), [["pred-1", 0.015, true]]);

  // The token goes in the Authorization header and nowhere else.
  assert.ok(calls.every((c) => c.headers.Authorization === `Bearer ${TOKEN}`));
  const body = JSON.parse(calls[0]!.body!);
  // req carries no garment note, so no type or length was claimed and no prompt is sent.
  assert.deepEqual(Object.keys(body.input).sort(), ["garment_images", "person_image", "seed"]);
  assert.equal(out.promptNotSent, true);
  // NR4b: the record's input has exactly the fields sent, each image by the hash of the bytes sent.
  const input = r.input as { person_image: { sha256: string; model_image_id: string }; garment_images: { sha256: string }[]; seed: number };
  assert.deepEqual(Object.keys(input).sort(), Object.keys(body.input).sort());
  const sentHash = (uri: string) => sha256Hex(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64"));
  assert.equal(input.person_image.sha256, sentHash(body.input.person_image));
  assert.equal(input.person_image.model_image_id, DEFAULT_MODEL_IMAGE);
  assert.deepEqual(input.garment_images.map((g) => g.sha256), body.input.garment_images.map(sentHash));
  assert.equal(input.seed, body.input.seed);
  assert.ok(!JSON.stringify(out.record).includes(TOKEN));
  assert.ok(!calls.some((c) => (c.body ?? "").includes(TOKEN)));

  // Through the pipeline: the receipt names the try-on and holds no token.
  const outRoot = mkdtempSync(join(tmpdir(), "ps-nr4-"));
  const fx = fixtureProviders({ renders: () => new Uint8Array(0), findings: () => ({ findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95 })) }) });
  const again = base({ fetch: fakeReplicate(tagged).fetch });
  await runJob({ jobId: "nr4-ok", garmentNote: "red stripes", scenes: ["studio"], sources }, { outRoot, providers: { ...fx, segmenter: { segment: async () => segments }, renderer: again.renderer }, provenance: "fixture" });
  const receipt = readFileSync(join(outRoot, "nr4-ok", RECEIPT_FILE), "utf8");
  assert.ok(!receipt.includes(TOKEN));
  const render = parseReceipt(receipt).find((e) => e.kind === "render")!.payload as Record<string, unknown>;
  assert.deepEqual([render.provider, render.model, render.generative, render.label], [REPLICATE_PROVIDER, REPLICATE_MODEL, true, AI_PREVIEW_LABEL]);
  // "red stripes" claims no type or length: no prompt was sent, so the entry has none, at the top or in input.
  assert.equal("prompt" in render, false);
  assert.equal("prompt" in (render.input as Record<string, unknown>), false);
});

test("NR4b: the try-on prompt states only the seller's type and length claims, never colour or print", () => {
  const kurta02 = "kurta-02: Type: kurta (women's); Fabric and weave: not recorded; Main colour: peach; Print or motif (what, where, size): as in the photos; not recorded in words; Collar and cuffs: as in the photos";
  assert.equal(tryOnPrompt(kurta02), "Garment type: kurta (women's).");
  assert.equal(
    tryOnPrompt(`${kurta02}; Length: below the knee, mid-calf`),
    "Garment type: kurta (women's). Garment length: below the knee, mid-calf. Keep the garment's full length; do not shorten it.",
  );
  // The upload page's claims: the free-text type is not keyed, hem is the length claim; sleeve length is not the garment's length.
  assert.equal(tryOnPrompt("long kurta; color: peach; sleeve_length: 3/4; hem: ankle length"), "Garment length: ankle length. Keep the garment's full length; do not shorten it.");
  assert.equal(tryOnPrompt("Sleeve length: elbow"), null);
  // A claim that names a colour or print is dropped whole; unrecorded values are not claims.
  assert.equal(tryOnPrompt("Type: peach kurta; Length: not recorded"), null);
  assert.equal(tryOnPrompt("Type: embroidered kurta; Length: knee"), "Garment length: knee. Keep the garment's full length; do not shorten it.");
  assert.equal(tryOnPrompt(""), null);
});

test("NR4b: with a length claim the prompt is sent, recorded in input, and the pipeline's prompt is not on the entry; record + replay keep it", async () => {
  const note = "kurta-02: Type: kurta (women's); Main colour: peach; Length: below the knee";
  const want = tryOnPrompt(note)!;
  const { fetch, calls } = fakeReplicate(sources[0]!.bytes);
  // A below-the-knee claim is long, so the try-on runs only on request (NR6).
  const { renderer } = base({ env: { REPLICATE_API_TOKEN: TOKEN, [TRYON_LONG_ENV]: "1" }, fetch });
  const outRoot = mkdtempSync(join(tmpdir(), "ps-nr4b-"));
  const fx = fixtureProviders({ renders: () => new Uint8Array(0), findings: () => ({ findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95 })) }) });
  await runJob({ jobId: "nr4b", garmentNote: note, scenes: ["studio"], sources }, { outRoot, providers: { ...fx, segmenter: { segment: async () => segments }, renderer }, provenance: "fixture" });

  const body = JSON.parse(calls[0]!.body!);
  assert.equal(body.input.prompt, want);
  assert.doesNotMatch(body.input.prompt, /peach/);
  const render = parseReceipt(readFileSync(join(outRoot, "nr4b", RECEIPT_FILE), "utf8")).find((e) => e.kind === "render")!.payload as Record<string, unknown>;
  assert.equal("prompt" in render, false, "the pipeline prompt was never sent, so it is not recorded");
  const input = render.input as Record<string, unknown>;
  assert.deepEqual(Object.keys(input).sort(), Object.keys(body.input).sort());
  assert.equal(input.prompt, want);

  // A recording of the job replays to the same render entry, still with no pipeline prompt.
  const recDir = join(outRoot, "rec-nr4b");
  recordJob({ jobDir: join(outRoot, "nr4b"), sources, to: recDir });
  const replayRoot = mkdtempSync(join(tmpdir(), "ps-nr4b-replay-"));
  await replayJob(loadRecording(recDir), { outRoot: replayRoot });
  const replayed = parseReceipt(readFileSync(join(replayRoot, "nr4b", RECEIPT_FILE), "utf8")).find((e) => e.kind === "render")!.payload;
  assert.deepEqual(replayed, render);
});

test("NR4 4b: a fallback render entry names the composite, not the try-on model", async () => {
  const outRoot = mkdtempSync(join(tmpdir(), "ps-nr4-"));
  const fx = fixtureProviders({ renders: () => new Uint8Array(0), findings: () => ({ findings: [] }) });
  const { renderer } = base({ env: {} });
  await runJob({ jobId: "nr4-fb", garmentNote: "n", scenes: ["studio"], sources }, { outRoot, providers: { ...fx, renderer }, provenance: "fixture" });
  const render = parseReceipt(readFileSync(join(outRoot, "nr4-fb", RECEIPT_FILE), "utf8")).find((e) => e.kind === "render")!.payload as Record<string, unknown>;
  assert.deepEqual([render.provider, render.model, render.generative, render.fallback_from, render.fallback_reason], ["composite", "composite-v2", false, REPLICATE_PROVIDER, "no_api_token"]);
});

test("NR4 5: a ledger at 4.99 USD plus a 0.015 estimate refuses with spend_cap; an unreadable ledger refuses too", async () => {
  const { fetch, calls } = fakeReplicate(sources[0]!.bytes);
  const near = memoryLedger([{ at: "2026-10-28T00:00:00.000Z", prediction_id: "old", cost_usd: 4.99, estimated: false }]);
  const out = await base({ fetch, ledger: near }).renderer.render(req);
  assert.equal(out.record?.fallback_reason, "spend_cap");
  assert.equal(estimateCostUsd(1) + 4.99 > SPEND_CAP_USD, true);

  const dir = mkdtempSync(join(tmpdir(), "ps-ledger-"));
  writeFileSync(join(dir, "bad.json"), "not json");
  const bad = await base({ fetch, ledger: fileLedger(join(dir, "bad.json")) }).renderer.render(req);
  assert.equal(bad.record?.fallback_reason, "spend_cap");
  const none = await base({ fetch, ledger: null }).renderer.render(req);
  assert.equal(none.record?.fallback_reason, "spend_cap");
  assert.equal(calls.length, 0);

  const good = fileLedger(join(dir, "sub", "ledger.json"));
  good.append({ at: "t", prediction_id: "a", cost_usd: 0.015, estimated: true });
  assert.deepEqual(good.read().map((e) => e.cost_usd), [0.015]);
});

test("NR4 6: a recoloured lookalike from the try-on is REFUSED by the fidelity gate", async () => {
  const fake = garment(true);
  const t = loadThresholds();
  const direct = checkFidelity({ source: SOURCE, render: fake, sourceMask: { width: 64, height: 80, data: decodePng(maskBytes(SOURCE)).data.map((v) => (v ? 1 : 0)) }, renderMask: { width: 64, height: 80, data: decodePng(maskBytes(fake)).data.map((v) => (v ? 1 : 0)) } }, t);
  assert.equal(direct.decision, "REFUSE");

  const outRoot = mkdtempSync(join(tmpdir(), "ps-nr4-"));
  const fx = fixtureProviders({ renders: () => new Uint8Array(0), findings: () => ({ findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95 })) }) });
  const { renderer } = base({ fetch: fakeReplicate(encodeRgbPng(fake.width, fake.height, fake.data)).fetch });
  // SAM on the output: the garment region of the render.
  const renderSegmenter = { segment: async () => [{ label: "render/kurta", box: [0, 0, 1, 1] as [number, number, number, number], score: 0.9, mask: maskBytes(fake) }] };
  const result = await runJob({ jobId: "nr4-lookalike", garmentNote: "red stripes", scenes: ["studio"], sources }, {
    outRoot,
    providers: { ...fx, segmenter: { segment: async () => segments }, renderer, fidelity: maskedFidelityChecker({ segmenter: renderSegmenter }) },
    provenance: "fixture",
  });
  assert.equal(result.renders[0]!.decision, "REFUSE");
});

test("NR4/NR4d: the garment cut-out is the whole masked box of seller pixels with a white margin on every side; no mask gives none", () => {
  const png = decodePng(garmentCutout(sources, segments)!);
  const m = Math.round(GARMENT_MARGIN * 64);
  assert.deepEqual([png.width, png.height], [48 + 2 * m, 64 + 2 * m]);
  const px = (x: number, y: number) => [...png.data.subarray((y * png.width + x) * 3, (y * png.width + x) * 3 + 3)];
  assert.deepEqual(px(m, m), [200, 30, 40], "the mask box starts after the margin");
  const row = (y: number) => Array.from({ length: png.width }, (_, x) => px(x, y).join()).filter((c) => c !== "255,255,255").length;
  assert.ok(row(m + 63) > 0 && row(m + 64) === 0, "the last mask row (the hem) is sent, not cropped, and the margin starts below it");
  // Every row and column of the margin is white, so no garment edge touches the image edge.
  for (let x = 0; x < png.width; x++) for (const y of [0, m - 1, png.height - m, png.height - 1]) assert.deepEqual(px(x, y), [255, 255, 255]);
  for (let y = 0; y < png.height; y++) for (const x of [0, m - 1, png.width - m, png.width - 1]) assert.deepEqual(px(x, y), [255, 255, 255]);
  assert.equal(garmentCutout(sources, []), null);
  assert.equal(stripImageMetadata(Buffer.from("GIF89a")), null);
});

test("NR4d/NR4f: preserve_input_size is sent only when its env var is true or false, reference_pose never, and the record's input matches the body", async () => {
  assert.deepEqual(tryOnOptions({}), {});
  assert.deepEqual(tryOnOptions({ REPLICATE_PRESERVE_INPUT_SIZE: "yes" }), {});
  assert.deepEqual(tryOnOptions({ REPLICATE_PRESERVE_INPUT_SIZE: "false" }), { preserve_input_size: false });
  // reference_pose is an image input in Pruna's schema, so a boolean env var must not reach the body.
  assert.deepEqual(tryOnOptions({ REPLICATE_PRESERVE_INPUT_SIZE: "true", REPLICATE_REFERENCE_POSE: "true" }), { preserve_input_size: true });

  const { fetch, calls } = fakeReplicate(sources[0]!.bytes);
  const { renderer } = base({ env: { REPLICATE_API_TOKEN: TOKEN, REPLICATE_PRESERVE_INPUT_SIZE: "false", REPLICATE_REFERENCE_POSE: "true" }, fetch });
  const out = await renderer.render(req);
  const body = JSON.parse(calls.find((c) => c.url === REPLICATE_PREDICTIONS_URL)!.body!) as { input: Record<string, unknown> };
  assert.equal(body.input.preserve_input_size, false);
  assert.equal("reference_pose" in body.input, false);
  const input = out.record!.input as Record<string, unknown>;
  assert.deepEqual(Object.keys(input).sort(), Object.keys(body.input).sort());
  assert.equal(input.preserve_input_size, false);
  assert.equal("reference_pose" in input, false);
});

test("NR4e: a garment claimed longer than the model's own outfit falls back with model_too_short before any request; a long enough outfit or no claim sends", async () => {
  assert.equal(claimedReach("kurta-01: Type: kurta; Length: long, below the knee (as photographed)"), "calf");
  assert.equal(claimedReach("Length: ankle length"), "ankle");
  assert.equal(claimedReach("hem: at the hip"), "hip");
  assert.equal(claimedReach("Length: not recorded"), null);
  assert.equal(claimedReach("Type: kurta"), null);
  // The committed models declare their reach.
  assert.equal(modelCovers(MODELS_DIR, "synthetic-01"), "hip");
  assert.equal(modelCovers(MODELS_DIR, "synthetic-02"), "ankle");

  const dir = modelsDir();
  assert.equal(modelCovers(dir, DEFAULT_MODEL_IMAGE), null, "no model.json: unknown, the guard does not apply");
  writeFileSync(join(dir, DEFAULT_MODEL_IMAGE, "model.json"), JSON.stringify({ covers: "hip" }));
  const long = { ...req, garmentNote: "Type: kurta; Length: long, below the knee" };
  // The try-on is asked for on the long garment (NR6), so the model_too_short guard is what stops it.
  const asked = { REPLICATE_API_TOKEN: TOKEN, [TRYON_LONG_ENV]: "1" };

  const short = fakeReplicate(sources[0]!.bytes);
  const a = base({ env: asked, fetch: short.fetch, modelsDir: dir });
  const out = await a.renderer.render(long);
  assert.equal(short.calls.length, 0, "no paid call");
  assert.equal(a.fallback.calls, 1);
  assert.equal(out.record!.fallback_reason, "model_too_short");
  assert.match(String(out.record!.fallback_detail), /calf.*hip/);

  // A hip-length claim fits a hip outfit, and no length claim leaves the guard out: both are sent.
  for (const note of ["Type: kurta; Length: to the hip", "Type: kurta"]) {
    const ok = fakeReplicate(sources[0]!.bytes);
    const b = base({ fetch: ok.fetch, modelsDir: dir });
    const r = await b.renderer.render({ ...req, garmentNote: note });
    assert.equal(b.fallback.calls, 0, note);
    assert.equal(r.record!.fallback_reason, undefined);
  }
  writeFileSync(join(dir, DEFAULT_MODEL_IMAGE, "model.json"), JSON.stringify({ covers: "ankle" }));
  const ankle = fakeReplicate(sources[0]!.bytes);
  const c = base({ env: asked, fetch: ankle.fetch, modelsDir: dir });
  await c.renderer.render(long);
  assert.equal(c.fallback.calls, 0);
  assert.ok(ankle.calls.length > 0);
});

test("option B: REPLICATE_GARMENT_CONTEXT=front sends the stripped front photo as a second garment image, both hashed on the record, priced as two; unset sends the cut-out only", async () => {
  const sentHash = (uri: string) => sha256Hex(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64"));
  const run = async (env: Record<string, string>) => {
    const { fetch, calls } = fakeReplicate(sources[0]!.bytes);
    const out = await base({ env: { REPLICATE_API_TOKEN: TOKEN, ...env }, fetch }).renderer.render(req);
    const body = JSON.parse(calls.find((c) => c.url === REPLICATE_PREDICTIONS_URL)!.body!) as { input: { garment_images: string[] } };
    return { body, record: out.record as { input: { garment_images: { sha256: string; what: string }[] }; cost_estimated_usd: number } };
  };
  const two = await run({ REPLICATE_GARMENT_CONTEXT: "front" });
  assert.equal(two.body.input.garment_images.length, 2);
  assert.deepEqual(two.record.input.garment_images.map((g) => g.what), ["garment_cutout", "front_photo"]);
  assert.deepEqual(two.record.input.garment_images.map((g) => g.sha256), two.body.input.garment_images.map(sentHash));
  assert.equal(two.record.input.garment_images[1]!.sha256, sha256Hex(stripImageMetadata(sources[0]!.bytes)!.bytes));
  assert.equal(two.record.cost_estimated_usd, estimateCostUsd(2));

  const one = await run({ REPLICATE_GARMENT_CONTEXT: "yes" });
  assert.equal(one.body.input.garment_images.length, 1);
  assert.equal(one.record.cost_estimated_usd, estimateCostUsd(1));
});

test("NR6: a long garment with no flag never reaches the try-on transport; the receipt says why the composite was chosen", async () => {
  assert.equal(isLongGarment("Type: kurta; Length: long, below the knee (as photographed)"), true);
  assert.equal(isLongGarment("Length: ankle length"), true);
  assert.equal(isLongGarment("Length: knee"), true, "NR6b: knee length is long");
  assert.equal(isLongGarment("Length: mid thigh"), false);
  assert.equal(isLongGarment("Length: to the hip"), false);
  assert.equal(isLongGarment("Type: kurta"), false);
  assert.equal(tryOnLongRequested({ [TRYON_LONG_ENV]: "1" }), true);
  assert.equal(tryOnLongRequested({ [TRYON_LONG_ENV]: "TRUE" }), true);
  assert.equal(tryOnLongRequested({ [TRYON_LONG_ENV]: "yes" }), false);
  assert.equal(tryOnLongRequested({}), false);

  const note = "kurta-01: Type: kurta; Length: long, below the knee (as photographed)";
  const { fetch, calls } = fakeReplicate(sources[0]!.bytes);
  const { fallback, ledger, renderer } = base({ fetch });
  const outRoot = mkdtempSync(join(tmpdir(), "ps-nr6-"));
  const fx = fixtureProviders({ renders: () => new Uint8Array(0), findings: () => ({ findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95 })) }) });
  await runJob({ jobId: "nr6", garmentNote: note, scenes: ["studio"], sources }, { outRoot, providers: { ...fx, segmenter: { segment: async () => segments }, renderer }, provenance: "fixture" });
  assert.equal(calls.length, 0, "no request reaches Replicate");
  assert.equal(ledger.entries.length, 0);
  assert.equal(fallback.calls, 1);
  const render = parseReceipt(readFileSync(join(outRoot, "nr6", RECEIPT_FILE), "utf8")).find((e) => e.kind === "render")!.payload as Record<string, unknown>;
  assert.deepEqual([render.provider, render.model], ["composite", "composite-v2"]);
  assert.equal(render.generative, false);
  assert.equal(render.render_choice, "composite");
  assert.equal(render.render_choice_reason, "long_garment_default");
  assert.match(String(render.render_choice_detail), /calf.*PROOFSHOT_TRYON_LONG=1/);
  assert.equal("fallback_reason" in render, false, "a choice, not a failure");
});

test("NR6b: a knee-length garment with no flag gets the composite: no request, nothing spent; a thigh-length one is still sent", async () => {
  const knee = fakeReplicate(sources[0]!.bytes);
  const a = base({ env: { REPLICATE_API_TOKEN: TOKEN }, fetch: knee.fetch });
  const out = await a.renderer.render({ ...req, garmentNote: "Type: kurta; Length: knee length" });
  assert.equal(knee.calls.length, 0, "no request reaches Replicate");
  assert.equal(a.ledger.entries.length, 0, "nothing spent");
  assert.equal(a.fallback.calls, 1);
  assert.equal(out.record!.render_choice_reason, "long_garment_default");
  assert.match(String(out.record!.render_choice_detail), /reach the knee/);

  const thigh = fakeReplicate(sources[0]!.bytes);
  const b = base({ env: { REPLICATE_API_TOKEN: TOKEN }, fetch: thigh.fetch });
  const r = await b.renderer.render({ ...req, garmentNote: "Type: kurti; Length: mid thigh" });
  assert.ok(thigh.calls.some((c) => c.url === REPLICATE_PREDICTIONS_URL), "a thigh-length garment reaches the try-on");
  assert.equal(b.fallback.calls, 0);
  assert.equal(r.record!.render_choice_reason, undefined);
});

test("NR6: with the flag a long garment goes to the try-on, labelled AI preview, and the gate still judges it", async () => {
  const note = "kurta-01: Type: kurta; Length: long, below the knee (as photographed)";
  const { fetch, calls } = fakeReplicate(sources[0]!.bytes);
  const { fallback, renderer } = base({ env: { REPLICATE_API_TOKEN: TOKEN, [TRYON_LONG_ENV]: "1" }, fetch });
  const outRoot = mkdtempSync(join(tmpdir(), "ps-nr6-flag-"));
  // The verifier finds a colour mismatch, so the gate must refuse the try-on.
  const fx = fixtureProviders({ renders: () => new Uint8Array(0), findings: () => ({ findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: attribute === "color" ? "mismatch" : "match", confidence: 0.95 })) }) });
  const result = await runJob({ jobId: "nr6-flag", garmentNote: note, scenes: ["studio"], sources }, { outRoot, providers: { ...fx, segmenter: { segment: async () => segments }, renderer }, provenance: "fixture" });
  assert.ok(calls.some((c) => c.url === REPLICATE_PREDICTIONS_URL), "the try-on transport was called");
  assert.equal(fallback.calls, 0);
  const entries = parseReceipt(readFileSync(join(outRoot, "nr6-flag", RECEIPT_FILE), "utf8"));
  const render = entries.find((e) => e.kind === "render")!.payload as Record<string, unknown>;
  assert.equal(render.provider, REPLICATE_PROVIDER);
  assert.equal(render.label, AI_PREVIEW_LABEL);
  assert.equal(render.render_choice, "tryon");
  assert.equal(render.render_choice_reason, "long_garment_tryon_requested");
  assert.equal(result.renders[0]!.decision, "REFUSE", "the gate judged the try-on and refused the colour mismatch");
});

test("NR4: PROOFSHOT_RENDER selects the try-on in providersFromEnv, with a label naming Replicate", () => {
  const p = providersFromEnv({ PROOFSHOT_RENDER: REPLICATE_PROVIDER }, { replicate: { fetch: fakeReplicate(new Uint8Array(0)).fetch, ledger: memoryLedger() } });
  assert.equal(p.providers.renderer.provider, REPLICATE_PROVIDER);
  assert.match(p.mode.labels.render, /Pruna p-image-try-on on Replicate \(third-party, non-Meta\)/);
  assert.equal(providersFromEnv({ PROOFSHOT_RENDER: "composite" }).providers.renderer.provider, "composite");
  assert.equal(providersFromEnv({}).providers.renderer.provider, "stand-in");
});
