import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { fixtureProviders } from "../src/pipeline.ts";
import { FIDELITY_NOT_RUN, GATE_LABEL, presentJob, renderBadge, sourceLabels, tamperedCopy } from "../src/present.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { Receipt, parseReceipt, verifyChain } from "../src/receipt.ts";
import { REPLICATE_PROVIDER } from "../src/render-replicate.ts";
import { UploadServer } from "../src/serve.ts";
import type { ReceiptListing } from "../src/serve.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const JOBS = join(ROOT, "data", "jobs");
const load = (job: string) => parseReceipt(readFileSync(join(JOBS, job, RECEIPT_FILE), "utf8"));

test("present: a live composite RELEASE names SAM 3.1, Muse Spark Open and the gate from their entries, badge Not AI-generated", () => {
  const view = presentJob(load("live-kurta-01-composite-r2"));
  assert.equal(view.chain.ok, true);
  const r = view.renders[0]!;
  assert.equal(r.decision, "RELEASE");
  assert.equal(r.badge.kind, "not-ai");
  assert.equal(r.badge.label, "Not AI-generated");
  assert.match(r.badge.tooltip, /mannequin\. No pixels generated/);
  assert.equal(r.released, true);
  assert.deepEqual(view.pipeline.map((n) => n.status), ["done", "done", "done", "done", "done", "done"]);
  assert.ok(view.components.some((c) => c.startsWith("SAM 3.1")));
  assert.ok(view.components.some((c) => c.startsWith("Muse Spark Open via Baseten")));
  assert.ok(view.components.includes(GATE_LABEL));
  assert.ok(!JSON.stringify(view).includes("Pruna"));
  assert.equal(view.cards.length, 7);
  assert.equal(view.cards[1]!.prev, view.cards[0]!.hash);
});

test("present: the v2 quality pre-check REVIEW shows render and verifier as UNVERIFIED and names no verifier model", () => {
  const view = presentJob(load("live-kurta-02-composite-v2"));
  const r = view.renders[0]!;
  assert.equal(r.decision, "REVIEW");
  assert.equal(r.badge.kind, "none");
  assert.equal(r.cited?.quality_precheck, true);
  assert.match(r.cited!.reason, /over- or under-exposed/);
  const status = Object.fromEntries(view.pipeline.map((n) => [n.key, n.status]));
  assert.deepEqual(status, { upload: "done", segment: "done", render: "UNVERIFIED", verify: "UNVERIFIED", gate: "done", receipt: "done" });
  assert.ok(!JSON.stringify(view).includes("Muse Spark"));
});

test("present: a fixture REFUSE cites the hard colour mismatch with its severity; no segmenter means segmentation UNVERIFIED", () => {
  const view = presentJob(load("fixture-shirt-01"));
  const refused = view.renders.find((r) => r.decision === "REFUSE")!;
  assert.equal(refused.cited?.attribute, "color");
  assert.equal(refused.cited?.severity, "hard");
  assert.equal(refused.cited?.rule, "hard_mismatch");
  assert.equal(refused.badge.kind, "fixture");
  assert.equal(view.pipeline.find((n) => n.key === "segment")!.status, "UNVERIFIED");
  assert.ok(!view.components.some((c) => /SAM|Muse Spark|Pruna/.test(c)));
});

test("NR5b: each render has its own pipeline, so /judge shows the gate of the render picked (fixture-shirt-01 r0 vs r1)", () => {
  const view = presentJob(load("fixture-shirt-01"));
  assert.ok(view.renders.length >= 2);
  const gateOf = (id: string) => view.pipelines[id]!.find((n) => n.key === "gate")!;
  for (const r of view.renders) {
    assert.equal(gateOf(r.render_id).detail, r.decision, `${r.render_id}: the pipeline's gate is this render's decision`);
    const gateEntry = load("fixture-shirt-01").find((e) => e.kind === "gate" && (e.payload as { render_id: string }).render_id === r.render_id)!;
    assert.equal(gateOf(r.render_id).seq, gateEntry.seq);
  }
  assert.notEqual(gateOf(view.renders[0]!.render_id).detail, gateOf(view.renders[1]!.render_id).detail, "r0 and r1 differ, so a single pipeline was wrong for one of them");
  assert.deepEqual(view.pipeline, view.pipelines[view.renders[0]!.render_id]);

  const page = readFileSync(join(ROOT, "web", "judge.html"), "utf8");
  assert.match(page, /view\.pipelines\?\.\[r\.render_id\]/, "judge.html draws the picked render's pipeline");
  assert.match(page, /function drawRender\(r\) \{\n  drawPipeline\(r\);/, "picking a render redraws the pipeline");
});

test("NR5b: a source photo not on this machine shows a card naming the recorded hash, not an error line", () => {
  const page = readFileSync(join(ROOT, "web", "judge.html"), "utf8");
  assert.match(page, /We don't have this source file here, but its hash is recorded\./);
  assert.match(page, /notStored\(s\)\)/, "the source frames pass the card to frame()");
});

test("NR5c: judge microcopy: render picker hint, hash tooltip on the source hashes, old card text gone", () => {
  const page = readFileSync(join(ROOT, "web", "judge.html"), "utf8");
  assert.match(page, /<div id="render-pick-row" hidden>\s*<p class="muted" id="render-pick-hint">Pipeline card redraws for whichever render you pick\.<\/p>/, "the hint sits above the picker and hides with it");
  assert.match(page, /const HASH_TIP = "Shown so the exact source file can be identified\.";/);
  assert.equal(page.match(/title: HASH_TIP/g)?.length, 2, "the tooltip is on the card's hash and the caption's hash");
  assert.doesNotMatch(page, /Source photo not stored here/);
});

test("NR5b: kurta-01 shows three labelled inputs, both fronts kept with their own hashes", () => {
  const view = presentJob(load("live-kurta-01-composite-r2"));
  const intake = JSON.parse(readFileSync(join(ROOT, "data", "garments", "kurta-01", "intake.json"), "utf8")) as { files: { name: string; sha256: string }[] };
  assert.deepEqual(view.sources.map((s) => s.label), ["Front", "Front (2nd shot)", "Back"]);
  assert.deepEqual(view.sources.map((s) => [s.name, s.sha256]), intake.files.map((f) => [f.name, f.sha256]), "intake order, every image and hash kept");
  assert.notEqual(view.sources[0]!.sha256, view.sources[1]!.sha256);
  assert.deepEqual(sourceLabels(["front.png", "x.jpg", "2-side.jpg"]), ["Front", "Photo 2", "Side"]);
  const page = readFileSync(join(ROOT, "web", "judge.html"), "utf8");
  assert.match(page, /el\("strong", \{ text: s\.label \}\)/, "judge.html captions each input with its label");
});

test("DEMO1e: a job that stored no mask says fidelity was not run, in plain words; the receipt text and the gate decision are unchanged", () => {
  const entries = load("live-kurta-01-mismatch");
  const view = presentJob(entries);
  const r = view.renders[0]!;
  assert.equal(r.decision, "REFUSE");
  assert.equal(r.cited!.rule, "hard_mismatch");
  assert.equal(r.cited!.plain, null);
  const fid = r.reasons.find((x) => x.rule === "fidelity")!;
  assert.equal(fid.plain, FIDELITY_NOT_RUN);
  assert.equal(fid.reason, "fidelity REVIEW: source mask is missing: no segment with mask bytes for 1-front.jpg", "receipt text kept");
  assert.ok(r.reasons.filter((x) => x.rule !== "fidelity").every((x) => x.plain === null));
  // A job whose segments entry has masks keeps the receipt's fidelity text as it is.
  // upload-* jobs are local serve uploads, gitignored and never committed.
  for (const v of readdirSync(JOBS).filter((job) => !job.startsWith("upload-")).map((job) => presentJob(load(job)))) {
    for (const x of v.renders.flatMap((rv) => rv.reasons)) {
      if (x.plain !== null) assert.ok(v.job_id && ["live-kurta-01", "live-kurta-01-2", "live-kurta-01-mismatch"].includes(v.job_id), `${v.job_id}: plain only on jobs with no stored mask`);
    }
  }
  const page = readFileSync(join(ROOT, "web", "judge.html"), "utf8");
  assert.match(page, /x\.plain \? \{ text: x\.plain, title: `receipt text: \$\{x\.reason\}` \}/, "judge.html shows the plain line, receipt text in the tooltip");
});

test("present: across every committed job, a model name appears only when its receipt entry exists", () => {
  for (const job of readdirSync(JOBS)) {
    const entries = load(job);
    const text = JSON.stringify(presentJob(entries));
    const has = (kind: string, re: RegExp) => entries.some((e) => e.kind === kind && re.test(JSON.stringify(e.payload)));
    assert.equal(text.includes("SAM 3.1"), has("segments", /"segmenter":\{[^}]*sam-3\.1/i), `${job}: SAM 3.1`);
    assert.equal(text.includes("Muse Spark"), has("verifier", /"verifier":\{[^}]*muse-spark/i), `${job}: Muse Spark`);
    assert.equal(text.includes("Pruna"), has("render", /"generative":true/) && has("render", new RegExp(REPLICATE_PROVIDER)), `${job}: Pruna`);
  }
});

test("present: a try-on render entry gives the AI-generated badge, the Pruna component and the model image id", () => {
  const receipt = new Receipt({ clock: (() => { let n = 0; return () => `2026-10-28T16:00:0${n++}.000Z`; })() });
  receipt.append("job", { job_id: "t", provenance: "live", source_images: [{ name: "front.jpg", sha256: "a".repeat(64) }] });
  receipt.append("render", { render_id: "t-r0", sha256: "b".repeat(64), provider: REPLICATE_PROVIDER, model: "prunaai/p-image-try-on", method: "generative", generative: true, model_image_id: "synthetic-01" });
  receipt.append("gate", { render_id: "t-r0", decision: "REVIEW", cited: { attribute: "color", verdict: "uncertain", confidence: 0.5, rule: "low_confidence", reason: "color: uncertain at 0.50" }, reasons: [] });
  const view = presentJob(receipt.entries);
  const r = view.renders[0]!;
  assert.equal(r.badge.kind, "ai-generated");
  assert.equal(r.badge.label, "AI-generated model");
  assert.match(r.badge.tooltip, /not a real person/);
  assert.equal(r.model_image_id, "synthetic-01");
  assert.ok(view.components.some((c) => c.startsWith("Pruna P-Image-Try-On via Replicate")));
  // A composite fallback from the try-on is not generative and gets the green badge.
  assert.equal(renderBadge({ provider: "composite", model: "composite-v2", method: "composite", generative: false, fallback_from: REPLICATE_PROVIDER }).kind, "not-ai");
  assert.equal(renderBadge({ provider: "x", model: "y" }).kind, "none");
});

test("present: tamperedCopy changes one byte and the chain breaks at that entry; the original still verifies", () => {
  const text = readFileSync(join(JOBS, "live-kurta-01-composite-r2", RECEIPT_FILE), "utf8");
  const copy = tamperedCopy(text);
  assert.equal(copy.text.length, text.length);
  assert.equal([...copy.text].filter((c, i) => c !== text[i]).length, 1);
  const check = verifyChain(parseReceipt(copy.text));
  assert.equal(check.ok, false);
  assert.equal(!check.ok && check.index, copy.index);
  assert.equal(verifyChain(parseReceipt(text)).ok, true);
});

test("web/upload.html (NR5): the claim fields are the ATTRIBUTES vocabulary, every label has English and Hindi text, EXIF strip is stated", () => {
  const page = readFileSync(join(ROOT, "web", "upload.html"), "utf8");
  const attrs = /const ATTRS = (\[[^\]]*\]);/.exec(page);
  assert.ok(attrs, "ATTRS list");
  assert.deepEqual(JSON.parse(attrs![1]!), [...ATTRIBUTES]);
  const keys = [...new Set([...page.matchAll(/data-t="([A-Za-z0-9]+)"/g)].map((m) => m[1]!))];
  for (const lang of ["en", "hi"]) {
    const table = new RegExp(`\\n\\s+${lang}: \\{[\\s\\S]*?\\n\\s+\\},\\n`).exec(page)![0];
    for (const key of keys) assert.match(table, new RegExp(`\\b${key}: "`), `${lang} has ${key}`);
    for (const a of ATTRIBUTES) assert.match(table, new RegExp(`\\b${a}: "`), `${lang} labels ${a}`);
  }
  assert.match(page, /exifNote: "Location, camera and date \(EXIF\) are removed/);
  // The method badge on the result card is read from the receipt API, never written by the page.
  assert.match(page, /fetch\(`api\/receipts\//);
  assert.doesNotMatch(page, /AI-generated model|Not AI-generated/);
});

test("web/judge.html (NR5): offline, same-origin, and names no model itself", () => {
  const page = readFileSync(join(ROOT, "web", "judge.html"), "utf8");
  assert.match(page, /Content-Security-Policy" content="default-src 'none'; connect-src 'self'; img-src 'self';/);
  for (const banned of [/<link\b/i, /<script\b[^>]*\bsrc=/i, /<img\b[^>]*src="https?:/i, /XMLHttpRequest/, /WebSocket/, /\bimport\s*\(/]) assert.doesNotMatch(page, banned);
  for (const model of [/SAM ?3/i, /Muse Spark/i, /Pruna/i, /Baseten/i, /Replicate/i]) assert.doesNotMatch(page, model, `judge.html must read ${model} from the receipt`);
  // No browser runs in the suite: at least the inline scripts of both pages must parse.
  for (const file of ["judge.html", "upload.html"]) {
    const html = readFileSync(join(ROOT, "web", file), "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    assert.doesNotThrow(() => new Function(script), `${file} inline script parses`);
  }
  assert.match(page, /Deterministic gate \(rules, no model\)/);
  assert.match(page, /Any doubt ends in REVIEW or REFUSE, never RELEASE\./);
  assert.match(page, /name="viewport" content="width=device-width, initial-scale=1"/);
});

test("present: serve lists receipts, verifies, runs the tamper demo without writing, and serves sources only by recorded hash", async () => {
  const providers = { providers: fixtureProviders({ renders: () => new Uint8Array(0), findings: () => ({ findings: [] }) }), mode: { provenance: "fixture" as const, fixture: true, labels: { segment: "", render: "", verify: "", fidelity: "" } } };
  const srv = new UploadServer({ webDir: join(ROOT, "web"), jobsRoot: JOBS, shopDir: join(ROOT, "out", "present-shop-unused"), garmentsDir: join(ROOT, "data", "garments"), providers });
  const http: Server = createServer((req, res) => void srv.handler(req, res));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const url = (path: string) => `http://127.0.0.1:${(http.address() as { port: number }).port}${path}`;
  const before = readFileSync(join(JOBS, "live-kurta-01-composite-r2", RECEIPT_FILE));
  try {
    const list = await (await fetch(url("/api/receipts"))).json() as ReceiptListing;
    assert.ok(list.jobs.length > 0 && list.jobs.length <= 20);
    assert.ok(list.counts.RELEASE > 0 && list.counts.REVIEW > 0 && list.counts.REFUSE > 0);

    const view = await (await fetch(url("/api/receipts/live-kurta-01-composite-r2"))).json() as { images: Record<string, string>; renders: { badge: { label: string } }[] };
    assert.equal(view.renders[0]!.badge.label, "Not AI-generated");
    assert.equal(view.images["live-kurta-01-composite-r2-r0"], "/jobs/live-kurta-01-composite-r2/live-kurta-01-composite-r2-r0.png");

    const ok = await (await fetch(url("/api/receipts/live-kurta-01-composite-r2/verify"), { method: "POST" })).json() as { ok: boolean; length: number };
    assert.deepEqual([ok.ok, ok.length], [true, 7]);
    const bad = await (await fetch(url("/api/receipts/live-kurta-01-composite-r2/tamper"), { method: "POST" })).json() as { tampered_entry: number; result: { ok: boolean; index: number } };
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.index, bad.tampered_entry);
    assert.deepEqual(readFileSync(join(JOBS, "live-kurta-01-composite-r2", RECEIPT_FILE)), before);

    const photo = await fetch(url("/api/receipts/live-kurta-01-composite-r2/source/0"));
    assert.equal(photo.status, 200);
    assert.equal(sha256Hex(new Uint8Array(await photo.arrayBuffer())), "12c00767fb1895e387d8bcb3768f628ccccd4a693a786f70ee20bcbe6b6c12fe");
    // The fixture job's source is a recorded hash with no file under data/garments.
    assert.equal((await fetch(url("/api/receipts/fixture-shirt-01/source/0"))).status, 404);
    assert.equal((await fetch(url("/api/receipts/live-kurta-01-composite-r2/source/9"))).status, 404);
    assert.equal((await fetch(url("/api/receipts/nope"))).status, 404);
    assert.equal((await fetch(url("/api/receipts/live-kurta-01-composite-r2/verify"))).status, 405);
    assert.equal((await fetch(url("/judge"))).status, 200);
  } finally {
    http.close();
  }
});
