import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fixtureProviders, runJob } from "../src/pipeline.ts";
import type { JobInput } from "../src/pipeline.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { parseReceipt, recordedClock, verifyChain } from "../src/receipt.ts";
import { parseSegments, samSegmenter, segmenterFromEnv } from "../src/sam.ts";
import type { SamTransport } from "../src/sam.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";
import { encodePng } from "./helpers.ts";

const root = () => mkdtempSync(join(tmpdir(), "sam-"));
const clock = () => recordedClock(Array.from({ length: 20 }, (_, i) => `2026-10-28T03:00:${String(i).padStart(2, "0")}.000Z`));
const read = (dir: string) => parseReceipt(readFileSync(join(dir, RECEIPT_FILE), "utf8"));
const allMatch = () => ({
  findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95, note: "same", evidence: { source_bbox: null, render_bbox: null } })),
});
const job: JobInput = {
  jobId: "sam-1",
  garmentNote: "rust kurta",
  scenes: ["studio"],
  sources: [{ name: "front.png", bytes: Buffer.from("front") }, { name: "back.png", bytes: Buffer.from("back") }],
};
const maskPng = encodePng(2, 2, 1, new Uint8Array([0, 255, 255, 0]));
const answer = (label: string, mask: Buffer | null) => ({ segments: [{ label, box: [0.1, 0.2, 0.5, 0.6], score: 0.93, mask: mask ? mask.toString("base64") : null }] });

test("a SAM segmenter asks the transport once per source, records the model id and mask hashes on the segments entry, and reads no key", async () => {
  const calls: { model: string; prompt: string; image: string }[] = [];
  const transport: SamTransport = async ({ model, prompt, image }) => {
    calls.push({ model, prompt, image: image.name });
    return image.name === "front.png" ? answer("kurta", maskPng) : JSON.stringify(answer("kurta", null));
  };
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches++;
    throw new Error("network");
  }) as typeof fetch;
  let r;
  try {
    const p = { ...fixtureProviders({ renders: () => Buffer.from("r"), findings: allMatch }), segmenter: samSegmenter({ model: "sam-test-model", transport }) };
    r = await runJob(job, { outRoot: root(), providers: p, provenance: "fixture", clock: clock() });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(fetches, 0);
  assert.deepEqual(calls, [
    { model: "sam-test-model", prompt: "the garment", image: "front.png" },
    { model: "sam-test-model", prompt: "the garment", image: "back.png" },
  ]);
  const entries = read(r.dir);
  assert.equal(verifyChain(entries).ok, true);
  assert.deepEqual(entries[1]!.payload, {
    count: 2,
    segmenter: { provider: "meta", model: "sam-test-model" },
    segments: [
      { label: "front.png/kurta", box: [0.1, 0.2, 0.5, 0.6], score: 0.93, mask_sha256: sha256Hex(maskPng) },
      { label: "back.png/kurta", box: [0.1, 0.2, 0.5, 0.6], score: 0.93, mask_sha256: null },
    ],
  });
  assert.equal(r.renders[0]!.decision, "RELEASE");
});

test("a fixture segmenter puts no segmenter claim on the entry", async () => {
  const r = await runJob(job, { outRoot: root(), providers: fixtureProviders({ renders: () => Buffer.from("r"), findings: allMatch }), provenance: "fixture", clock: clock() });
  assert.deepEqual(read(r.dir)[1]!.payload, { count: 0, segments: [] });
});

test("an answer outside the shape is a protocol error, and the pipeline refuses the job as segment_failed", async () => {
  const bad: [unknown, RegExp][] = [
    [null, /not an object/],
    ["{oops", /not JSON/],
    [{ masks: [] }, /no segments array/],
    [{ segments: [1] }, /segment 0 is not an object/],
    [{ segments: [{ box: [0, 0, 1, 1], score: 1 }] }, /segment 0 has no label/],
    [{ segments: [{ label: "k", box: [0, 0, 1], score: 1 }] }, /no box of four finite numbers/],
    [{ segments: [{ label: "k", box: [0, 0, 1, Number.NaN], score: 1 }] }, /no box of four finite numbers/],
    [{ segments: [{ label: "k", box: [0, 0, 1, 1], score: "high" }] }, /no finite score/],
    [{ segments: [{ label: "k", box: [0, 0, 1, 1], score: 1, mask: 42 }] }, /mask is not a base64 string/],
    [{ segments: [{ label: "k", box: [0, 0, 1, 1], score: 1, mask: Buffer.from("not a png").toString("base64") }] }, /mask is not a PNG/],
  ];
  for (const [raw, re] of bad) assert.throws(() => parseSegments(raw, "front.png"), re);
  // Box and score are clamped to 0..1, like the verifier's bboxes.
  assert.deepEqual(parseSegments({ segments: [{ label: "k", box: [-1, 0.5, 2, 1], score: 1.5 }] }, "x.png")[0], { label: "x.png/k", box: [0, 0.5, 1, 1], score: 1, mask: null });

  const transport: SamTransport = async () => ({ masks: [] });
  const p = { ...fixtureProviders({ renders: () => Buffer.from("r"), findings: allMatch }), segmenter: samSegmenter({ model: "sam-test-model", transport }) };
  const r = await runJob(job, { outRoot: root(), providers: p, provenance: "fixture", clock: clock() });
  assert.deepEqual(r.refused, { attribute: null, verdict: null, confidence: null, rule: "segment_failed", reason: "SegmentProtocolError: segmenter output for front.png: no segments array" });
  assert.deepEqual(read(r.dir).map((e) => e.kind), ["job", "gate"]);
});

test("a blank model id or a Muse Image model id is refused before any request, and MODEL_SEGMENT has no default", () => {
  let called = 0;
  const transport: SamTransport = async () => (called++, answer("k", null));
  assert.throws(() => samSegmenter({ model: "  ", transport }), /needs a model id/);
  assert.throws(() => samSegmenter({ model: "muse-image-seg", transport }), /Muse Image/);
  assert.throws(() => segmenterFromEnv({}, transport), /MODEL_SEGMENT is not set/);
  assert.throws(() => segmenterFromEnv({ MODEL_SEGMENT: " " }, transport), /MODEL_SEGMENT is not set/);
  const s = segmenterFromEnv({ MODEL_SEGMENT: " sam-test-model ", SEGMENT_PROMPT: "the shirt" }, transport);
  assert.deepEqual(s.identity, { provider: "meta", model: "sam-test-model" });
  assert.equal(called, 0);
});
