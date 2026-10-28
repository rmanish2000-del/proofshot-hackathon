import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fixtureProviders, runJob } from "../src/pipeline.ts";
import type { JobInput, Providers, Verifier } from "../src/pipeline.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { parseReceipt, recordedClock, verifyChain } from "../src/receipt.ts";
import { MANIFEST_FILE, STEPS_FILE, loadRecording, recordJob, replayJob, stripSecrets } from "../src/replay.ts";
import type { Manifest } from "../src/replay.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";

const root = () => mkdtempSync(join(tmpdir(), "replay-"));
const clock = () => recordedClock(Array.from({ length: 40 }, (_, i) => `2026-10-28T02:00:${String(i).padStart(2, "0")}.000Z`));
const read = (dir: string) => parseReceipt(readFileSync(join(dir, RECEIPT_FILE), "utf8"));
const content = (e: { seq: number; at: string; kind: string; payload: unknown }) => ({ seq: e.seq, at: e.at, kind: e.kind, payload: e.payload });

const allMatch = (overrides: Record<string, object> = {}) => ({
  findings: ATTRIBUTES.map((attribute) => ({
    attribute, verdict: "match", confidence: 0.95, note: "same", evidence: { source_bbox: null, render_bbox: null }, ...overrides[attribute],
  })),
});

const SCENES = ["a", "b", "c", "d", "e", "f"];
const job = (jobId = "job-1"): JobInput => ({
  jobId,
  garmentNote: "indigo kurta, six buttons",
  scenes: SCENES,
  sources: [{ name: "front.png", bytes: Buffer.from("front") }, { name: "back.png", bytes: Buffer.from("back") }],
  approver: "priya",
});

/**
 * One job that exercises every path a receipt can take: a RELEASE with usage
 * and a mask (a), a REVIEW with a non-finite metric (b), a hard-mismatch REFUSE
 * whose fidelity check throws (c), a renderer that throws (d), a verifier that
 * throws (e), and a fidelity answer outside the three decisions (f).
 */
function providers(verifier?: Partial<Verifier>): Providers {
  const p = fixtureProviders({
    renders: (scene) => {
      if (scene === "d") throw new TypeError("render timed out");
      return Buffer.from(`render of ${scene}`);
    },
    findings: (scene) => {
      if (scene === "e") throw new Error("verifier unreachable");
      return scene === "b" ? allMatch({ hem: { verdict: "mismatch" } }) : scene === "c" ? allMatch({ color: { verdict: "mismatch" } }) : allMatch();
    },
    segments: [{ label: "kurta", box: [0.1, 0.2, 0.5, 0.6], score: 0.93, mask: new Uint8Array([0, 255, 255, 0]) }, { label: "hem", box: [0, 0, 1, 1], score: 0.5, mask: null }],
    fidelity: (scene) => {
      if (scene === "c") throw new RangeError("mask decode failed");
      if (scene === "f") return { decision: "PASS", metrics: null, reasons: [] } as never;
      if (scene === "b") return { decision: "REVIEW", metrics: { delta_e: Number.NaN, hist: 0.2, texture: 0.9, area: 1 }, reasons: ["delta_e is not a finite number"] };
      return { decision: "RELEASE", metrics: null, reasons: [] };
    },
  });
  return {
    ...p,
    // A segmenter with a model claim, so the recorded segments entry carries one and the replay repeats it.
    segmenter: { identity: { provider: "meta", model: "sam-test-model" }, segment: p.segmenter.segment },
    verifier: {
      identity: { provider: "fixture", model: "fixture-verifier", base: "https://verifier.example.test/v1" },
      verify: async (req) => ({ ...(await p.verifier.verify(req)), ...(req.scene === "a" ? { usage: { prompt_tokens: 12, completion_tokens: 3 } } : {}) }),
      ...verifier,
    },
  };
}

async function recorded(name = "rec-1") {
  const jobsRoot = root();
  const r = await runJob(job(), { outRoot: jobsRoot, providers: providers(), provenance: "fixture", clock: clock() });
  const to = join(root(), name);
  const manifest = recordJob({ jobDir: r.dir, sources: job().sources, to });
  return { r, to, manifest, entries: read(r.dir) };
}

test("recording a job and replaying it reproduces every entry after the job entry, and the job entry says replay", async () => {
  const { r, to, manifest, entries } = await recorded();
  assert.equal(entries.length, 24);
  assert.deepEqual(manifest.recorded_from, { job_id: "job-1", head: r.head });
  assert.deepEqual(Object.keys(manifest.files), [
    "renders/job-1-r0.png", "renders/job-1-r1.png", "renders/job-1-r2.png", "renders/job-1-r4.png", "renders/job-1-r5.png",
    "sources/back.png", "sources/front.png", STEPS_FILE,
  ]);
  assert.equal(manifest.files["renders/job-1-r0.png"], sha256Hex("render of a"));

  const rec = loadRecording(to);
  const replay = await replayJob(rec, { outRoot: root() });
  const replayed = read(replay.dir);
  assert.deepEqual(verifyChain(replayed), { ok: true, head: replay.head, length: 24 });
  assert.notEqual(replay.head, r.head);
  assert.deepEqual(replayed.slice(1).map(content), entries.slice(1).map(content));
  assert.deepEqual(replayed[0]!.payload, {
    ...(entries[0]!.payload as object),
    provenance: "replay",
    mode: "replay",
    recorded_from: { recording: "rec-1", job_id: "job-1", head: r.head },
  });
  assert.deepEqual(replay.renders.map((x) => [x.decision, x.cited?.rule]), r.renders.map((x) => [x.decision, x.cited?.rule]));
  // The replayed images are the recorded ones, byte for byte.
  assert.equal(sha256Hex(readFileSync(join(replay.dir, "job-1-r0.png"))), sha256Hex("render of a"));
  // The mask was known only by its hash, and the segments entry still matches, model claim included.
  const segments = replayed[1]!.payload as { segmenter: unknown; segments: { mask_sha256: string }[] };
  assert.equal(segments.segments[0]!.mask_sha256, sha256Hex(new Uint8Array([0, 255, 255, 0])));
  assert.deepEqual(segments.segmenter, { provider: "meta", model: "sam-test-model" });
});

test("two replays of one recording are byte-identical", async () => {
  const { to } = await recorded();
  const once = async () => readFileSync(join((await replayJob(loadRecording(to), { outRoot: root() })).dir, RECEIPT_FILE), "utf8");
  assert.equal(await once(), await once());
});

test("replay calls fetch zero times, even with a key in the environment", async () => {
  const { to } = await recorded();
  const original = globalThis.fetch;
  const env = process.env.BASETEN_API_KEY;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("network");
  }) as typeof fetch;
  process.env.BASETEN_API_KEY = "set-but-never-read";
  try {
    const replay = await replayJob(loadRecording(to), { outRoot: root() });
    assert.equal(replay.renders.length, SCENES.length);
  } finally {
    globalThis.fetch = original;
    if (env === undefined) delete process.env.BASETEN_API_KEY;
    else process.env.BASETEN_API_KEY = env;
  }
  assert.equal(calls, 0);
});

test("loading refuses a changed file, a missing file, a path outside the layout, and a Muse Image renderer", async () => {
  const { to } = await recorded();
  const manifestPath = join(to, MANIFEST_FILE);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

  appendFileSync(join(to, "renders", "job-1-r1.png"), "x");
  assert.throws(() => loadRecording(to), /renders\/job-1-r1\.png changed/);
  unlinkSync(join(to, "renders", "job-1-r1.png"));
  assert.throws(() => loadRecording(to), /renders\/job-1-r1\.png is missing/);
  writeFileSync(join(to, "renders", "job-1-r1.png"), "render of b");
  assert.equal(loadRecording(to).steps.scenes.length, SCENES.length);

  writeFileSync(manifestPath, JSON.stringify({ ...manifest, files: { ...manifest.files, "../escape.json": manifest.files[STEPS_FILE] } }));
  assert.throws(() => loadRecording(to), /not a recording file/);

  // A manifest that honestly lists a Muse Image renderer is still refused.
  const steps = JSON.parse(readFileSync(join(to, STEPS_FILE), "utf8")) as { renderer: { model: string } };
  const muse = JSON.stringify({ ...steps, renderer: { ...steps.renderer, model: "muse-image-v1" } });
  writeFileSync(join(to, STEPS_FILE), muse);
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, files: { ...manifest.files, [STEPS_FILE]: sha256Hex(muse) } }));
  assert.throws(() => loadRecording(to), /MuseImageRefused|Muse Image/);
});

test("recording refuses a broken chain, a replay, sources that are not the job's, and an unfinished job", async () => {
  const { r, to } = await recorded();
  const sources = job().sources;

  const replay = await replayJob(loadRecording(to), { outRoot: root() });
  assert.throws(() => recordJob({ jobDir: replay.dir, sources, to: join(root(), "again") }), /is itself a replay/);

  assert.throws(() => recordJob({ jobDir: r.dir, sources: [...sources].reverse(), to: join(root(), "swapped") }), /source 0 \(back\.png\) is not the job's front\.png/);
  assert.throws(() => recordJob({ jobDir: r.dir, sources, to }), /already a recording/);

  const path = join(r.dir, RECEIPT_FILE);
  const lines = readFileSync(path, "utf8").split("\n");
  writeFileSync(path, lines.slice(0, 3).join("\n") + "\n");
  assert.throws(() => recordJob({ jobDir: r.dir, sources, to: join(root(), "short") }), /job-1-r0\) has no gate entry/);
  writeFileSync(path, lines.join("\n").replace('"note":"same"', '"note":"SAME"'));
  assert.throws(() => recordJob({ jobDir: r.dir, sources, to: join(root(), "edited") }), /does not verify/);
});

test("recording strips credential fields and URL query strings, and keeps token counts", async () => {
  const jobsRoot = root();
  const identity = { provider: "live", model: "verifier-x", base: "https://api.example.test/v1?api_key=not-a-real-value", authorization: "not-a-real-credential" };
  const p = providers({ identity: identity as Verifier["identity"] });
  const r = await runJob(job("job-2"), { outRoot: jobsRoot, providers: p, provenance: "fixture", clock: clock() });
  const to = join(root(), "stripped");
  recordJob({ jobDir: r.dir, sources: job().sources, to });
  const text = readFileSync(join(to, STEPS_FILE), "utf8");
  assert.doesNotMatch(text, /api_key|authorization|not-a-real/);
  const steps = JSON.parse(text) as { verifier: Record<string, unknown>; scenes: { verifier: { usage?: unknown } }[] };
  assert.deepEqual(steps.verifier, { provider: "live", model: "verifier-x", base: "https://api.example.test/v1" });
  assert.deepEqual(steps.scenes[0]!.verifier.usage, { prompt_tokens: 12, completion_tokens: 3 });

  assert.deepEqual(stripSecrets({ prompt_tokens: 1, cached_tokens: 2, access_token: "t", "x-api-key": "k", url: "https://a.test/b?sig=1", nested: [{ secret: 1, ok: "mailto:x?y" }] }), {
    prompt_tokens: 1, cached_tokens: 2, url: "https://a.test/b", nested: [{ ok: "mailto:x?y" }],
  });
});

test("a job that was refused before any render on segment_failed replays; one refused on prior records does not record", async () => {
  const out = root();
  const p = providers();
  const broken = { ...p, segmenter: { segment: async () => { throw new Error("SAM endpoint returned 503"); } } };
  const r = await runJob(job("seg"), { outRoot: out, providers: broken, provenance: "fixture", clock: clock() });
  const to = join(root(), "seg");
  recordJob({ jobDir: r.dir, sources: job().sources, to });
  const replay = await replayJob(loadRecording(to), { outRoot: root() });
  assert.deepEqual(replay.refused, r.refused);
  assert.deepEqual(read(replay.dir).slice(1).map(content), read(r.dir).slice(1).map(content));

  const unreadable = root();
  mkdirSync(join(unreadable, "prior"));
  writeFileSync(join(unreadable, "prior", RECEIPT_FILE), "{not json\n");
  const r2 = await runJob(job("pr"), { outRoot: unreadable, providers: p, provenance: "fixture", clock: clock() });
  assert.equal(r2.refused?.rule, "prior_records_unreadable");
  assert.throws(() => recordJob({ jobDir: r2.dir, sources: job().sources, to: join(root(), "pr") }), /refused on prior_records_unreadable/);
});

test("the pipeline labels a replay and refuses the label on anything else", async () => {
  const opts = { outRoot: root(), providers: providers(), clock: clock() };
  const from = { recording: "rec", job_id: "job-1", head: "0".repeat(64) };
  await assert.rejects(runJob(job("no-label"), { ...opts, provenance: "replay" }), /must name the recording/);
  await assert.rejects(runJob(job("wrong-label"), { ...opts, provenance: "fixture", recordedFrom: from }), /fixture job cannot name a recording/);
  const r = await runJob(job("ok"), { ...opts, provenance: "replay", recordedFrom: from });
  const payload = read(r.dir)[0]!.payload as Record<string, unknown>;
  assert.equal(payload.provenance, "replay");
  assert.equal(payload.mode, "replay");
  assert.deepEqual(payload.recorded_from, from);
});

test("the verify page says when a record is a replay", () => {
  const html = readFileSync(new URL("../web/verify.html", import.meta.url), "utf8");
  assert.match(html, /Replay of a recorded run/);
  assert.match(html, /payload\.mode === "replay"/);
});
