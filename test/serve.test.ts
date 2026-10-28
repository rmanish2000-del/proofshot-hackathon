import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { stripJpegMetadata } from "../src/intake.ts";
import { fixtureProviders } from "../src/pipeline.ts";
import type { Providers } from "../src/pipeline.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { standInRenderer } from "../src/render.ts";
import { parseReceipt, verifyChain } from "../src/receipt.ts";
import { STEPS, UPLOAD_JOB_PREFIX, UploadError, UploadServer, parseUpload, providersFromEnv } from "../src/serve.ts";
import type { ServeProviders, StepName, StepState } from "../src/serve.ts";
import { CATALOG_FILE } from "../src/shop.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = join(ROOT, "web");
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `serve-${name}-`));

// A phone JPEG with Exif, as in test/intake.test.ts: SOI, APP0, APP1 Exif, tables, one scan, EOI.
function seg(marker: number, payload: string | number[]): number[] {
  const body = typeof payload === "string" ? [...Buffer.from(payload, "latin1")] : payload;
  const n = body.length + 2;
  return [0xff, marker, n >> 8, n & 0xff, ...body];
}
const PHONE = Uint8Array.from([
  0xff, 0xd8,
  ...seg(0xe0, "JFIF\0\x01\x02\0\0\x01\0\x01\0\0"),
  ...seg(0xe1, "Exif\0\0GPS 19.07N 72.87E Pixel 8"),
  ...seg(0xdb, [0, 1, 2, 3]),
  ...seg(0xc0, [8, 0, 4, 0, 4, 1, 1, 0x11, 0]),
  ...seg(0xc4, [0, 1, 0, 0]),
  ...seg(0xda, [1, 1, 0, 0, 0x3f, 0]), 0x12, 0xff, 0x00, 0x34,
  0xff, 0xd9,
]);
const STRIPPED = stripJpegMetadata(PHONE);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const upload = (files: { name: string; bytes: Uint8Array }[], note = "cotton kurta, rust orange") => ({ garment_note: note, files: files.map((f) => ({ name: f.name, base64: b64(f.bytes) })) });

type Verdict = "match" | "mismatch" | "uncertain";

/** Fixture providers with the stand-in renderer; the colour finding decides the gate. */
function providers(scene: { verdict?: Verdict; confidence?: number } = {}, override: Partial<Providers> = {}): ServeProviders {
  const findings = () => ({
    findings: ATTRIBUTES.map((attribute) => ({
      attribute,
      verdict: attribute === "color" ? (scene.verdict ?? "match") : "match",
      confidence: scene.confidence ?? 0.95,
      note: "",
      evidence: { source_bbox: null, render_bbox: null },
    })),
  });
  const base = fixtureProviders({ renders: () => new Uint8Array(0), findings });
  return {
    providers: { ...base, renderer: standInRenderer(), ...override },
    mode: { provenance: "fixture", fixture: true, labels: { segment: "fixture segmenter", render: "stand-in: the seller's own front photo, nothing generated", verify: "fixture verifier", fidelity: "fixture: not measured" } },
  };
}

function server(p: ServeProviders, name: string): { srv: UploadServer; jobs: string; shop: string } {
  const jobs = tmp(`${name}-jobs`);
  const shop = tmp(`${name}-shop`);
  let n = 0;
  const srv = new UploadServer({ webDir: WEB, jobsRoot: jobs, shopDir: shop, providers: p, jobId: () => `${name}-${++n}` });
  return { srv, jobs, shop };
}

const states = (s: { steps: readonly { name: StepName; state: StepState }[] }): Record<StepName, StepState> =>
  Object.fromEntries(s.steps.map((x) => [x.name, x.state])) as Record<StepName, StepState>;

test("providersFromEnv: fixture mode with no key, stand-in render by default, labels say what did not run", () => {
  const none = providersFromEnv({});
  assert.equal(none.mode.fixture, true);
  assert.equal(none.mode.provenance, "fixture");
  assert.equal(none.providers.renderer.provider, "stand-in");
  assert.equal(none.providers.segmenter.identity, undefined, "a fixture segmenter makes no model claim");
  assert.match(none.mode.labels.segment, /^fixture: no segmenter ran/);
  assert.match(none.mode.labels.render, /^stand-in/);
  assert.match(none.mode.labels.verify, /^fixture: findings recorded/);

  const noKey = providersFromEnv({ MODEL_SEGMENT: "meta/sam-3.1 (api.meta.ai)" });
  assert.match(noKey.mode.labels.segment, /MODEL_API_KEY is not/);
  const noFetch = providersFromEnv({ MODEL_SEGMENT: "meta/sam-3.1 (api.meta.ai)", MODEL_API_KEY: "set-in-the-test-only" });
  assert.match(noFetch.mode.labels.segment, /no fetch was given/);
  const withFetch = providersFromEnv({ MODEL_SEGMENT: "meta/sam-3.1 (api.meta.ai)", MODEL_API_KEY: "set-in-the-test-only" }, { sam: { fetch: async () => ({ ok: true, status: 200, text: async () => "" }) } });
  assert.deepEqual(withFetch.providers.segmenter.identity, { provider: "meta", model: "meta/sam-3.1 (api.meta.ai)" }, "the @meta-sam/parser glue is the default parser");

  const live = providersFromEnv({ MODEL_SEGMENT: "meta/sam-3.1 (api.meta.ai)" }, { samTransport: async () => ({ segments: [] }) });
  assert.deepEqual(live.providers.segmenter.identity, { provider: "meta", model: "meta/sam-3.1 (api.meta.ai)" });
  assert.equal(live.mode.labels.segment, "meta / meta/sam-3.1 (api.meta.ai)");
  assert.equal(live.mode.fixture, true, "the verifier is still a fixture, so the run is");

  const openai = providersFromEnv({ RENDER_PROVIDER: "openai-images" });
  assert.match(openai.mode.labels.render, /^openai-images \/ gpt-image-1: no render transport/);
  assert.throws(() => providersFromEnv({ RENDER_PROVIDER: "meta", MODEL_RENDER: "muse-image-1.0" }), /Muse Image/);
});

test("providersFromEnv: BASETEN_API_KEY plus a fetch makes the verifier live and the run live; the key alone does not", () => {
  const keyOnly = providersFromEnv({ BASETEN_API_KEY: "set-in-the-test-only" });
  assert.equal(keyOnly.mode.fixture, true);
  assert.match(keyOnly.mode.labels.verify, /^fixture: BASETEN_API_KEY is set but no fetch/);
  assert.equal(keyOnly.providers.verifier.identity.provider, "fixture");

  const live = providersFromEnv({ BASETEN_API_KEY: "set-in-the-test-only" }, { verifierFetch: async () => ({ status: 500, text: async () => "" }) });
  assert.equal(live.mode.fixture, false);
  assert.equal(live.mode.provenance, "live");
  assert.deepEqual(live.providers.verifier.identity, { provider: "baseten", model: "meta-models/muse-spark-open-1026", base: "https://inference.baseten.co/v1" });
  assert.equal(live.mode.labels.verify, "baseten / meta-models/muse-spark-open-1026: the model judges every attribute");
  assert.match(live.mode.labels.fidelity, /REVIEW with no metrics, since no segmenter ran/);
  assert.match(live.mode.labels.segment, /^fixture: no segmenter ran/, "the segmenter still claims nothing");
});

test("a live run with no mask is REVIEW, not RELEASE: the live verifier's findings and the masked fidelity check both reach the receipt", async () => {
  const findings = { findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95, note: "same", evidence: { source_bbox: null, render_bbox: null } })) };
  const answer = JSON.stringify({ choices: [{ message: { content: JSON.stringify(findings) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  let calls = 0;
  const live = providersFromEnv({ BASETEN_API_KEY: "set-in-the-test-only" }, { verifierFetch: async () => { calls++; return { status: 200, text: async () => answer }; } });
  const { srv, jobs } = server(live, "live");
  const { job_id } = srv.submit(upload([{ name: "1-front.jpg", bytes: PHONE }]));
  await srv.settled(job_id);
  const s = srv.status(job_id)!;
  assert.equal(calls, 1);
  assert.equal(s.status, "done");
  assert.deepEqual(states(s), { exif: "done", segment: "done", render: "done", verify: "done", gate: "done" });
  assert.equal(s.result!.decision, "REVIEW");
  assert.equal(s.result!.provenance, "live");
  assert.deepEqual(s.result!.reasons, ["fidelity REVIEW: source mask is missing: no segment with mask bytes for 1-front.jpg"]);
  const entries = parseReceipt(readFileSync(join(jobs, job_id, RECEIPT_FILE), "utf8"));
  assert.equal((entries[0]!.payload as { provenance: string }).provenance, "live");
  const verifier = entries.find((e) => e.kind === "verifier")!.payload as { verifier: { provider: string }; findings: unknown[] };
  assert.equal(verifier.verifier.provider, "baseten");
  assert.equal(verifier.findings.length, ATTRIBUTES.length);
  const fidelity = entries.find((e) => e.kind === "fidelity")!.payload as { decision: string; metrics: unknown };
  assert.deepEqual([fidelity.decision, fidelity.metrics], ["REVIEW", null]);
  assert.throws(() => srv.publish(job_id), /was REVIEW, not RELEASE/);
});

test("a seller upload the server names itself is upload-* and .gitignore keeps data/jobs/upload-*/ out of every commit", async () => {
  const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8").split(/\r?\n/);
  assert.ok(ignore.includes(`data/jobs/${UPLOAD_JOB_PREFIX}*/`), ".gitignore has the upload jobs line");
  const jobs = tmp("named-jobs");
  const srv = new UploadServer({ webDir: WEB, jobsRoot: jobs, shopDir: tmp("named-shop"), providers: providers() });
  const { job_id } = srv.submit(upload([{ name: "1-front.jpg", bytes: PHONE }]));
  assert.match(job_id, new RegExp(`^${UPLOAD_JOB_PREFIX}\\d{8}-\\d{6}-[0-9a-f]{4}$`));
  await srv.settled(job_id);
  assert.ok(existsSync(join(jobs, job_id, RECEIPT_FILE)), "the server still writes the job under the jobs root");
});

test("parseUpload refuses what the page must never send, with the reason", () => {
  assert.throws(() => parseUpload(null), /not a JSON object/);
  assert.throws(() => parseUpload({ files: [{ name: "a.jpg", base64: b64(PHONE) }] }), /garment_note/);
  assert.throws(() => parseUpload({ garment_note: "x", files: [] }), /at least one photo/);
  assert.throws(() => parseUpload({ garment_note: "x", files: Array(7).fill({ name: "a.jpg", base64: "AA==" }) }), /at most 6/);
  assert.throws(() => parseUpload({ garment_note: "x", files: [{ name: "../a.jpg", base64: "AA==" }] }), /not a plain file name/);
  assert.throws(() => parseUpload({ garment_note: "x", files: [{ name: "a.jpg", base64: "AA==" }, { name: "a.jpg", base64: "AA==" }] }), /both named/);
  assert.throws(() => parseUpload({ garment_note: "x", files: [{ name: "a.jpg", base64: "" }] }), /is empty/);
  assert.throws(() => parseUpload({ garment_note: "x", scenes: [], files: [{ name: "a.jpg", base64: "AA==" }] }), /1 to 3 scenes/);
  const ok = parseUpload({ garment_note: " kurta ", files: [{ name: "1-front.jpg", base64: b64(PHONE) }] });
  assert.equal(ok.garment_note, "kurta");
  assert.deepEqual(ok.scenes, ["studio"]);
  assert.deepEqual(ok.files[0]!.bytes, PHONE);
  assert.throws(() => parseUpload(null), (e: unknown) => e instanceof UploadError && e.status === 400);
});

test("RELEASE: metadata stripped, every step done, the image is the stripped front photo, the receipt verifies, publish lists it", async () => {
  const { srv, jobs, shop } = server(providers(), "release");
  const { job_id } = srv.submit(upload([{ name: "1-front.jpg", bytes: PHONE }, { name: "2-back.jpg", bytes: PHONE }]));
  assert.equal(srv.status(job_id)!.status, "running");
  await srv.settled(job_id);
  const s = srv.status(job_id)!;
  assert.equal(s.status, "done");
  assert.deepEqual(states(s), { exif: "done", segment: "done", render: "done", verify: "done", gate: "done" });
  assert.match(s.steps.find((x) => x.name === "exif")!.detail!, /2 photo\(s\); removed APP1 Exif/);
  assert.equal(s.steps.find((x) => x.name === "gate")!.detail, "RELEASE");
  assert.deepEqual(s.intake!.map((f) => [f.name, f.removed, f.sha256]), [["1-front.jpg", ["APP1 Exif"], sha256Hex(STRIPPED)], ["2-back.jpg", ["APP1 Exif"], sha256Hex(STRIPPED)]]);

  const r = s.result!;
  assert.equal(r.decision, "RELEASE");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.render_id, `${job_id}-r0`);
  assert.equal(r.image_sha256, sha256Hex(STRIPPED), "the stand-in returned the stripped front photo");
  assert.equal(r.image, `/jobs/${job_id}/${job_id}-r0.jpg`);
  assert.equal(r.receipt, `/jobs/${job_id}/${RECEIPT_FILE}`);
  assert.equal(r.verify, `verify.html#sha=${sha256Hex(STRIPPED)}`);
  assert.equal(r.provenance, "fixture");

  const entries = parseReceipt(readFileSync(join(jobs, job_id, RECEIPT_FILE), "utf8"));
  const chain = verifyChain(entries);
  assert.ok(chain.ok && chain.head === r.head);
  const job = entries[0]!.payload as { provenance: string; source_images: { name: string; sha256: string }[] };
  assert.equal(job.provenance, "fixture");
  assert.deepEqual(job.source_images.map((x) => x.sha256), [sha256Hex(STRIPPED), sha256Hex(STRIPPED)], "the receipt hashes the stripped bytes, never the originals");
  assert.deepEqual(readFileSync(join(jobs, job_id, "sources", "1-front.jpg")), Buffer.from(STRIPPED), "the stripped source is kept beside the receipt for demo:record");
  assert.equal(readFileSync(join(jobs, job_id, `${job_id}-r0.jpg`)).length, STRIPPED.length);

  const rows = srv.publish(job_id);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]!.job_id, rows[0]!.render_provider, rows[0]!.render_model, rows[0]!.provenance], [job_id, "stand-in", "owner-photo", "fixture"]);
  const catalog = JSON.parse(readFileSync(join(shop, CATALOG_FILE), "utf8")) as { rows: { job_id: string }[] };
  assert.deepEqual(catalog.rows.map((x) => x.job_id), [job_id]);
  assert.equal(sha256Hex(readFileSync(join(shop, job_id, `${job_id}-r0.jpg`))), sha256Hex(STRIPPED));
  assert.deepEqual(srv.status(job_id)!.published, rows);
});

test("REVIEW and REFUSE: the decision and reasons come from the gate, and publish is refused with 409", async () => {
  const review = server(providers({ confidence: 0.5 }), "review");
  const a = review.srv.submit(upload([{ name: "1-front.jpg", bytes: PHONE }])).job_id;
  await review.srv.settled(a);
  const ra = review.srv.status(a)!;
  assert.equal(ra.status, "done");
  assert.equal(ra.result!.decision, "REVIEW");
  assert.ok(ra.result!.reasons.length > 0 && ra.result!.reasons.every((t) => /below the \d\.\d\d floor/.test(t)), ra.result!.reasons.join(" | "));
  assert.equal(ra.steps.find((x) => x.name === "gate")!.detail, "REVIEW");
  assert.equal(ra.result!.image, `/jobs/${a}/${a}-r0.jpg`, "the render exists; it is just not released");
  assert.throws(() => review.srv.publish(a), (e: unknown) => e instanceof UploadError && e.status === 409 && /was REVIEW, not RELEASE/.test(e.message));
  assert.equal(existsSync(join(review.shop, CATALOG_FILE)), false, "a refused publish builds nothing");

  const refuse = server(providers({ verdict: "mismatch" }), "refuse");
  const b = refuse.srv.submit(upload([{ name: "1-front.jpg", bytes: PHONE }])).job_id;
  await refuse.srv.settled(b);
  const rb = refuse.srv.status(b)!;
  assert.equal(rb.result!.decision, "REFUSE");
  assert.ok(rb.result!.reasons.some((t) => /color/.test(t) && /mismatch/.test(t)), rb.result!.reasons.join(" | "));
  assert.throws(() => refuse.srv.publish(b), /was REFUSE, not RELEASE/);
  assert.throws(() => refuse.srv.publish("nope"), (e: unknown) => e instanceof UploadError && e.status === 404);
});

test("a segmenter that throws refuses the job before any render; a verifier that throws refuses as not verified; both are on the step board", async () => {
  const seg = server(providers({}, { segmenter: { segment: async () => { throw new Error("SAM is down"); } } }), "segfail");
  const a = seg.srv.submit(upload([{ name: "1-front.jpg", bytes: PHONE }])).job_id;
  await seg.srv.settled(a);
  const sa = seg.srv.status(a)!;
  assert.equal(sa.status, "done");
  assert.deepEqual(states(sa), { exif: "done", segment: "failed", render: "skipped", verify: "skipped", gate: "done" });
  assert.equal(sa.result!.decision, "REFUSE");
  assert.match(sa.result!.reasons[0]!, /SAM is down/);
  assert.equal(sa.result!.image, null);
  assert.equal(sa.result!.verify, null);
  assert.equal(sa.result!.render_id, null);

  const ver = server(providers({}, { verifier: { identity: { provider: "x", model: "y", base: "z" }, verify: async () => { throw new Error("verifier timeout"); } } }), "verfail");
  const b = ver.srv.submit(upload([{ name: "1-front.jpg", bytes: PHONE }])).job_id;
  await ver.srv.settled(b);
  const sb = ver.srv.status(b)!;
  assert.deepEqual(states(sb), { exif: "done", segment: "done", render: "done", verify: "failed", gate: "done" });
  assert.equal(sb.result!.decision, "REFUSE");
  assert.ok(sb.result!.reasons.every((t) => /no finding/.test(t)), sb.result!.reasons.join(" | "));
  assert.equal(sb.result!.image, `/jobs/${b}/${b}-r0.jpg`);
});

test("a photo that is not a JPEG is refused at intake: no pipeline, no receipt, the board says why", async () => {
  const { srv, jobs } = server(providers(), "png");
  const { job_id } = srv.submit(upload([{ name: "front.jpg", bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]) }]));
  await srv.settled(job_id);
  const s = srv.status(job_id)!;
  assert.equal(s.status, "failed");
  assert.match(s.error!, /refused at intake, before the pipeline: JpegError: not a JPEG/);
  assert.deepEqual(states(s), { exif: "failed", segment: "skipped", render: "skipped", verify: "skipped", gate: "skipped" });
  assert.equal(s.result, null);
  assert.equal(existsSync(join(jobs, job_id)), false);
  assert.throws(() => srv.publish(job_id), /has not finished/);
});

test("over HTTP: the page, the mode, a job from submit to publish, job files, and nothing outside web/ or the job", async () => {
  const { srv } = server(providers(), "http");
  const http: Server = createServer((req, res) => void srv.handler(req, res));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as { port: number }).port;
  const url = (path: string) => `http://127.0.0.1:${port}${path}`;
  try {
    const page = await fetch(url("/"));
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type")!, /text\/html/);
    assert.equal(await page.text(), readFileSync(join(WEB, "upload.html"), "utf8"));
    assert.equal((await fetch(url("/verify.html"))).status, 200);
    assert.equal((await fetch(url("/../package.json"))).status, 404);
    assert.equal((await fetch(url("/%2e%2e/package.json"))).status, 404);
    assert.equal((await fetch(url("/nope.html"))).status, 404);

    const mode = await (await fetch(url("/api/mode"))).json() as { fixture: boolean; labels: { render: string } };
    assert.equal(mode.fixture, true);
    assert.match(mode.labels.render, /^stand-in/);

    const bad = await fetch(url("/api/jobs"), { method: "POST", body: "{not json" });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "the request body is not JSON" });
    const empty = await fetch(url("/api/jobs"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ garment_note: "kurta", files: [] }) });
    assert.equal(empty.status, 400);
    assert.deepEqual(await empty.json(), { error: "choose at least one photo" });

    const posted = await fetch(url("/api/jobs"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(upload([{ name: "1-front.jpg", bytes: PHONE }])) });
    assert.equal(posted.status, 202);
    const { job_id } = await posted.json() as { job_id: string };
    assert.equal(job_id, "http-1");
    let status: { status: string; result: { image: string; receipt: string; image_sha256: string; decision: string } | null } | null = null;
    for (let i = 0; i < 200; i++) {
      status = await (await fetch(url(`/api/jobs/${job_id}`))).json() as typeof status;
      if (status!.status !== "running") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(status!.status, "done");
    assert.equal(status!.result!.decision, "RELEASE");
    const image = await fetch(url(status!.result!.image));
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.equal(sha256Hex(new Uint8Array(await image.arrayBuffer())), status!.result!.image_sha256);
    const receipt = await fetch(url(status!.result!.receipt));
    assert.equal(receipt.status, 200);
    assert.ok(verifyChain(parseReceipt(await receipt.text())).ok);
    assert.equal((await fetch(url(`/jobs/${job_id}/sources/1-front.jpg`))).status, 404, "the seller's stripped sources are not served");
    assert.equal((await fetch(url("/api/jobs/missing"))).status, 404);
    assert.equal((await fetch(url(`/api/jobs/${job_id}`), { method: "DELETE" })).status, 405);

    const published = await fetch(url(`/api/jobs/${job_id}/publish`), { method: "POST" });
    assert.equal(published.status, 200);
    const body = await published.json() as { job_id: string; rows: { job_id: string }[] };
    assert.deepEqual(body.rows.map((r) => r.job_id), [job_id]);
    assert.equal((await fetch(url(`/api/jobs/${job_id}/publish`))).status, 405);
  } finally {
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});

test("web/upload.html: same-origin only, both languages name every step, publish is painted only on RELEASE, receipt link goes to verify.html", () => {
  const page = readFileSync(join(WEB, "upload.html"), "utf8");
  assert.match(page, /Content-Security-Policy" content="default-src 'none'; connect-src 'self'; img-src 'self' blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'"/);
  for (const banned of [/https?:\/\//i, /<link\b/i, /<script\b[^>]*\bsrc=/i, /XMLHttpRequest/, /WebSocket/, /\bimport\s*\(/, /sendBeacon/]) assert.doesNotMatch(page, banned);
  for (const lang of ["en", "hi"]) {
    const table = new RegExp(`\\n\\s+${lang}: \\{[\\s\\S]*?\\n\\s+\\},\\n`).exec(page);
    assert.ok(table, `${lang} string table`);
    for (const step of STEPS) assert.match(table![0], new RegExp(`\\b${step}: "`), `${lang} names the ${step} step`);
    for (const decision of ["RELEASE", "REVIEW", "REFUSE"]) assert.match(table![0], new RegExp(`\\b${decision}: "`), `${lang} names ${decision}`);
    assert.match(table![0], /modeFixture: "/, `${lang} labels fixture mode`);
  }
  assert.match(page, /[ऀ-ॿ]/, "Hindi is written in Devanagari, not transliterated");
  assert.match(page, /lang === "en" \? "हिन्दी" : "English"/, "the toggle names the other language");
  assert.equal(page.split("append(publishControl(").length - 1, 1, "the publish control is added in one place");
  assert.match(page, /if \(result\.decision === "RELEASE"\) body\.append\(publishControl\(status\)\);/);
  assert.match(page, /a\.href = result\.verify;/, "the receipt link is the server's verify.html#sha= link, not one the page makes up");
  assert.match(page, /fetch\("api\/jobs"/);
  assert.match(page, /fetch\("api\/mode"/);
  assert.match(page, /name="viewport" content="width=device-width, initial-scale=1"/);
});
