// SAMPLE1: the sample button replays a committed live receipt, labelled as
// recorded, and calls nothing. The decision, reasons and findings are the
// receipt's own; live uploads still run the pipeline.

import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { verifyRecord } from "../src/core.js";
import type { Providers } from "../src/pipeline.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { parseReceipt, verifyChain } from "../src/receipt.ts";
import { SAMPLE_GARMENT, SAMPLE_RECORDED_JOB, UploadError, UploadServer } from "../src/serve.ts";
import type { SampleReplay, ServeProviders } from "../src/serve.ts";
import { sha256Hex } from "../src/util.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = join(ROOT, "web");
const JOBS = join(ROOT, "data", "jobs");
const GARMENTS = join(ROOT, "data", "garments");
const SAMPLE_DIR = join(JOBS, SAMPLE_RECORDED_JOB);
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `sample-${name}-`));

type Payload = Record<string, unknown>;
const entries = () => parseReceipt(readFileSync(join(SAMPLE_DIR, RECEIPT_FILE), "utf8"));
const payloadOf = (kind: string) => entries().find((e) => e.kind === kind)!.payload as Payload;

/** Providers that count every call and throw: a replay must leave every count at zero. */
function countingProviders(): { serve: ServeProviders; calls: Record<string, number> } {
  const calls = { segment: 0, render: 0, verify: 0, fidelity: 0 };
  const fail = (name: keyof typeof calls) => async (): Promise<never> => {
    calls[name]++;
    throw new Error(`${name} must not be called by the replay`);
  };
  const providers: Providers = {
    segmenter: { segment: fail("segment") },
    renderer: { provider: "stand-in", model: "owner-photo", render: fail("render") },
    verifier: { identity: { provider: "fixture", model: "fixture-verifier", base: "fixture" }, verify: fail("verify") },
    fidelity: { check: fail("fidelity") } as unknown as Providers["fidelity"],
  };
  return { serve: { providers, mode: { provenance: "fixture", fixture: true, labels: { segment: "", render: "", verify: "", fidelity: "" } } }, calls };
}

test("SAMPLE1: the recorded sample is a committed live receipt with nine findings, on the sample shirt's own photos", () => {
  const job = payloadOf("job");
  assert.equal(job.provenance, "live");
  const verifier = payloadOf("verifier");
  assert.equal((verifier.findings as unknown[]).length, 9);
  assert.ok(verifyChain(entries()).ok, "the committed receipt verifies");
  // The three source photos the receipt names are the committed shirt-zebra photos, byte for byte.
  for (const s of job.source_images as { name: string; sha256: string }[]) {
    assert.equal(sha256Hex(new Uint8Array(readFileSync(join(GARMENTS, SAMPLE_GARMENT, s.name)))), s.sha256, s.name);
  }
});

test("SAMPLE1: the replay's decision, reasons and findings are the receipt's own, and its date is the job entry's", () => {
  const srv = new UploadServer({ webDir: WEB, jobsRoot: JOBS, shopDir: tmp("shop"), garmentsDir: GARMENTS, sampleJobDir: SAMPLE_DIR, providers: countingProviders().serve });
  const view = srv.sampleReplay();
  const gate = payloadOf("gate");
  assert.equal(view.replay, true);
  assert.equal(view.job_id, SAMPLE_RECORDED_JOB);
  assert.equal(view.decision, gate.decision, "the decision shown is the gate entry's, never altered");
  assert.equal(view.decision, "REVIEW");
  assert.equal(view.reasons.length, (gate.reasons as unknown[]).length);
  // RV17: the strings themselves, not only the count: the gate entry's one reason, verbatim.
  const recordedReasons = (gate.reasons as { rule: string; reason: string }[]).map((r) => r.reason);
  assert.deepEqual(recordedReasons, ["fidelity REVIEW: source mask is missing: no segment with mask bytes for 1-front.jpg"]);
  assert.deepEqual(view.reasons, recordedReasons);
  assert.equal(view.recorded_at, entries()[0]!.at);
  assert.equal(view.recorded_on, "2026-10-29");
  assert.equal(view.provenance, "live");
  assert.equal(view.verifier, "meta / muse-spark-1.3");
  const recorded = (payloadOf("verifier").findings as { attribute: string; verdict: string; confidence: number; note: string }[])
    .map(({ attribute, verdict, confidence, note }) => ({ attribute, verdict, confidence, note }));
  assert.deepEqual(view.findings.map(({ attribute, verdict, confidence, note }) => ({ attribute, verdict, confidence, note })), recorded, "chips equal the receipt's findings");
  const chain = verifyChain(entries());
  assert.ok(chain.ok);
  assert.equal(view.head, chain.ok ? chain.head : null);
  assert.equal(view.image_sha256, (payloadOf("render") as { sha256: string }).sha256);
  assert.equal(view.verify, `verify.html#sha=${view.image_sha256}`);
  assert.equal(view.judge, `judge?job=${SAMPLE_RECORDED_JOB}`);
  assert.equal(view.sources.length, 3);
});

test("SAMPLE1: the Verify offline link checks out for the replayed receipt (chain ok, the image reads as the receipt says)", async () => {
  const text = readFileSync(join(SAMPLE_DIR, RECEIPT_FILE), "utf8");
  const srv = new UploadServer({ webDir: WEB, jobsRoot: JOBS, shopDir: tmp("shop"), garmentsDir: GARMENTS, sampleJobDir: SAMPLE_DIR, providers: countingProviders().serve });
  const view = srv.sampleReplay();
  const sha = /#sha=([0-9a-f]{64})$/.exec(view.verify!)![1]!;
  const out = await verifyRecord(text, { sha256: sha }, globalThis.crypto.subtle) as { supported: boolean; chain: { ok: boolean; head?: string }; image: { status: string; decision: string | null } };
  assert.equal(out.supported, true);
  assert.equal(out.chain.ok, true);
  assert.equal(out.chain.head, view.head);
  // The gate said REVIEW, so verify.html reads the image as NOT RELEASED with that decision.
  assert.deepEqual([out.image.status, out.image.decision], ["NOT RELEASED", "REVIEW"]);
});

test("SAMPLE1: the replay routes call no provider, start no job and write nothing; the files served are the committed bytes", async () => {
  const { serve, calls } = countingProviders();
  const jobs = tmp("jobs");
  const before = readFileSync(join(SAMPLE_DIR, RECEIPT_FILE));
  const srv = new UploadServer({ webDir: WEB, jobsRoot: jobs, shopDir: tmp("shop"), garmentsDir: GARMENTS, correctionsDir: tmp("corr"), sampleJobDir: SAMPLE_DIR, providers: serve });
  const http: Server = createServer((req, res) => void srv.handler(req, res));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const url = (path: string) => `http://127.0.0.1:${(http.address() as { port: number }).port}${path}`;
  const realFetch = globalThis.fetch;
  try {
    const res = await realFetch(url("/api/sample/replay"));
    assert.equal(res.status, 200);
    const view = (await res.json()) as SampleReplay;
    assert.equal(view.decision, "REVIEW");
    assert.equal(view.judge, null, "no /judge link when the recorded job is not in this server's jobs root");
    const bytes = async (path: string) => new Uint8Array(await (await realFetch(url(path))).arrayBuffer());
    assert.deepEqual(await bytes(view.receipt), new Uint8Array(before));
    assert.deepEqual(await bytes(view.image!), new Uint8Array(readFileSync(join(SAMPLE_DIR, `${view.render_id}.jpg`))));
    const names = (payloadOf("job").source_images as { name: string }[]).map((s) => s.name);
    for (const [i, s] of view.sources.entries()) {
      assert.deepEqual(await bytes(s.url), new Uint8Array(readFileSync(join(GARMENTS, SAMPLE_GARMENT, names[i]!))));
    }
    assert.equal((await realFetch(url("/api/sample/replay"), { method: "POST" })).status, 405);
    assert.equal((await realFetch(url("/api/sample/replay/source/9"))).status, 404);
  } finally {
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
  assert.deepEqual(calls, { segment: 0, render: 0, verify: 0, fidelity: 0 }, "zero provider calls on replay");
  assert.deepEqual(readdirSync(jobs), [], "no job folder was made");
  assert.deepEqual(readFileSync(join(SAMPLE_DIR, RECEIPT_FILE)), before, "the stored receipt is unchanged");
});

test("SAMPLE1: without a recorded sample the replay answers 404 rather than running a live job", () => {
  const srv = new UploadServer({ webDir: WEB, jobsRoot: tmp("jobs"), shopDir: tmp("shop"), garmentsDir: GARMENTS, providers: countingProviders().serve });
  assert.throws(() => srv.sampleReplay(), /no recorded sample run on this server/);
});

/** A scratch copy of the recorded sample, with its receipt text rewritten by `edit`. */
function editedSample(name: string, edit: (text: string) => string): string {
  const dir = tmp(name);
  for (const f of readdirSync(SAMPLE_DIR)) copyFileSync(join(SAMPLE_DIR, f), join(dir, f));
  writeFileSync(join(dir, RECEIPT_FILE), edit(readFileSync(join(SAMPLE_DIR, RECEIPT_FILE), "utf8")));
  return dir;
}

test("RV17: a recorded receipt that does not verify answers 409 and shows no decision", async () => {
  // One changed byte in the gate entry's reason breaks the chain from there on.
  const dir = editedSample("tampered", (t) => t.replace("source mask is missing", "source mask is m1ssing"));
  assert.equal(verifyChain(parseReceipt(readFileSync(join(dir, RECEIPT_FILE), "utf8"))).ok, false);
  const srv = new UploadServer({ webDir: WEB, jobsRoot: tmp("jobs"), shopDir: tmp("shop"), garmentsDir: GARMENTS, sampleJobDir: dir, providers: countingProviders().serve });
  assert.throws(() => srv.sampleReplay(), (e: unknown) => e instanceof UploadError && e.status === 409 && e.message === "recorded receipt does not verify");
  const http: Server = createServer((req, res) => void srv.handler(req, res));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${(http.address() as { port: number }).port}/api/sample/replay`);
    assert.equal(res.status, 409);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body, { error: "recorded receipt does not verify" }, "no decision, reasons or findings in the answer");
  } finally {
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});

test("RV17: a recorded render_id that is not a plain file name gets no image (404) from the image route, which reads no chain", () => {
  const renderId = (payloadOf("render") as { render_id: string }).render_id;
  for (const bad of ["../" + renderId, "..", "a/b", "a\\b", "a b"]) {
    const dir = editedSample("badid", (t) => t.split(`"render_id":"${renderId}"`).join(`"render_id":${JSON.stringify(bad)}`));
    const srv = new UploadServer({ webDir: WEB, jobsRoot: tmp("jobs"), shopDir: tmp("shop"), garmentsDir: GARMENTS, sampleJobDir: dir, providers: countingProviders().serve });
    // The rewritten receipt no longer verifies, so the JSON route already refuses it (409) ...
    assert.throws(() => srv.sampleReplay(), (e: unknown) => e instanceof UploadError && e.status === 409, bad);
    // ... and the image route, which does not need the chain, still refuses the name itself.
    assert.throws(() => (srv as unknown as { sampleImage(): string }).sampleImage(), (e: unknown) => e instanceof UploadError && e.status === 404, bad);
  }
});

test("SAMPLE1 web/upload.html: the sample button replays, labelled recorded in EN and HI; no job, no correction, no publish on the replay", () => {
  const page = readFileSync(join(WEB, "upload.html"), "utf8");
  const tables = ["en", "hi"].map((lang) => new RegExp(`\\n\\s+${lang}: \\{[\\s\\S]*?\\n\\s+\\},\\n`).exec(page)![0]);
  assert.match(tables[0]!, /replayLabel: "Recorded run from \{date\}, not live"/);
  assert.match(tables[1]!, /replayLabel: "\{date\} का रिकॉर्ड किया गया रन, लाइव नहीं"/);
  for (const t of tables) for (const key of ["replayNote", "readLeadReplay", "verifyOffline", "sampleNote"]) assert.match(t, new RegExp(`\\b${key}: "`), key);
  assert.doesNotMatch(tables[0]!, /sampleNote: "[^"]*through the same steps/, "the note no longer says the sample runs the pipeline");
  const handler = /\$\("sample"\)\.addEventListener\("click", async \(\) => \{[\s\S]*?\n  \}\);/.exec(page)![0];
  assert.match(handler, /fetch\("api\/sample\/replay"/);
  assert.doesNotMatch(handler, /start\(\)|api\/jobs/, "the sample button never starts a job");
  const paint = /function paintReplay\(view\) \{[\s\S]*?\n  \}\n/.exec(page)![0];
  assert.match(paint, /T\(\)\.replayLabel\.replace\("\{date\}", view\.recorded_on\)/);
  assert.match(paint, /T\(\)\.badge\[view\.decision\]/, "the badge is the receipt's decision");
  assert.match(paint, /paintChips\(read, view\.findings \|\| \[\], T\(\)\.readLeadReplay\)/);
  assert.match(paint, /a\.href = view\.verify;/);
  assert.doesNotMatch(paint, /paintCorrection|publishControl/, "Correct it and Publish are not offered on a replay");
  // Live uploads are unchanged: start() still posts the chosen photos to api/jobs.
  assert.match(page, /fetch\("api\/jobs", \{ method: "POST"/);
});
