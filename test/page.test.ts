import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkImage } from "../src/check.ts";
import { verifyRecord } from "../src/core.js";
import { CORE_PATH, PAGES, PAGE_PATH, inlineCore, pageWithCore } from "../src/page.ts";
import { fixtureProviders, runJob } from "../src/pipeline.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { parseReceipt, recordedClock, verifyChain } from "../src/receipt.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";

const html = () => readFileSync(PAGE_PATH, "utf8");
const core = () => readFileSync(CORE_PATH, "utf8");

/** The fixture receipt: studio releases, street is refused on colour. */
async function fixtureReceipt(): Promise<string> {
  const findings = (scene: string) => ({
    findings: ATTRIBUTES.map((attribute) => ({
      attribute, verdict: scene === "street" && attribute === "color" ? "mismatch" : "match", confidence: 0.95, note: "", evidence: { source_bbox: null, render_bbox: null },
    })),
  });
  const r = await runJob(
    { jobId: "job", garmentNote: "indigo shirt", scenes: ["studio", "street"], sources: [{ name: "front.png", bytes: Buffer.from("front") }] },
    {
      outRoot: mkdtempSync(join(tmpdir(), "page-")),
      provenance: "fixture",
      clock: recordedClock(Array(20).fill("2026-10-27T09:00:00.000Z")),
      providers: fixtureProviders({ renders: (scene) => Buffer.from(`render of ${scene}`), findings }),
    },
  );
  return readFileSync(join(r.dir, RECEIPT_FILE), "utf8");
}

test("every page carries the current core.js, unchanged but for its export keywords", () => {
  assert.deepEqual(PAGES.map((p) => p.name), ["web/verify.html", "web/shop.html"]);
  for (const { name, path } of PAGES) {
    const page = readFileSync(path, "utf8");
    assert.equal(page, pageWithCore(page, core()), `${name} is stale: run npm run page`);
    assert.ok(page.includes(inlineCore(core())), name);
  }
});

test("the page makes no network call and loads nothing from outside itself", () => {
  const page = html();
  assert.match(page, /Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"/);
  for (const banned of [/https?:\/\//i, /\bsrc=/i, /<link\b/i, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /\bimport\s*\(/, /sendBeacon/]) {
    assert.doesNotMatch(page, banned);
  }
});

test("the browser path (crypto.subtle) and node:crypto agree on the fixture receipt: verdict and head", async () => {
  const text = await fixtureReceipt();
  const entries = parseReceipt(text);
  const subtle = globalThis.crypto.subtle;
  const node = verifyChain(entries);
  assert.equal(node.ok, true);

  const studio = Buffer.from("render of studio");
  const cases: ({ bytes: Uint8Array } | { sha256: string })[] = [
    { bytes: studio },
    { sha256: sha256Hex("render of street") },
    { sha256: sha256Hex("something else") },
    { sha256: "not a hash" },
  ];
  for (const image of cases) {
    const out = await verifyRecord(text, image, subtle);
    assert.ok(out.supported);
    assert.deepEqual(out.chain, node);
    const sha = "bytes" in image ? sha256Hex(image.bytes) : image.sha256;
    assert.equal(out.image_sha256, sha);
    assert.deepEqual(out.image, checkImage(entries, sha));
  }
  assert.equal((await verifyRecord(text, { bytes: studio }, subtle) as { image: { status: string } }).image.status, "VALID");

  // One edited payload: both paths break at the same entry.
  const lines = text.trimEnd().split("\n");
  lines[3] = lines[3]!.replace('"fixture-verifier"', '"some-other-model"');
  const edited = lines.join("\n") + "\n";
  const out = await verifyRecord(edited, { bytes: studio }, subtle);
  assert.ok(out.supported);
  assert.deepEqual(out.chain, verifyChain(parseReceipt(edited)));
  assert.deepEqual(out.chain, { ok: false, index: 3, reason: "hash does not match the entry" });
  assert.equal(out.image?.status, "TAMPERED");
});

test("text that is not a receipt is TAMPERED on the page, never VALID", async () => {
  const out = await verifyRecord("{not json\n", { sha256: sha256Hex("x") }, globalThis.crypto.subtle);
  assert.ok(out.supported);
  assert.deepEqual(out.chain, { ok: false, index: 0, reason: "receipt line 1 is not JSON" });
  assert.equal(out.image?.status, "TAMPERED");
  const empty = await verifyRecord("", null, globalThis.crypto.subtle);
  assert.deepEqual(empty, { supported: true, chain: { ok: false, index: 0, reason: "empty receipt" }, image_sha256: null, image: null });
});

test("without a usable crypto.subtle the page says it cannot verify, and never VALID", async () => {
  const text = await fixtureReceipt();
  for (const subtle of [undefined, null, {} as never]) {
    assert.deepEqual(await verifyRecord(text, { bytes: Buffer.from("render of studio") }, subtle), { supported: false, message: "cannot verify in this browser" });
  }
});

test("inlineCore refuses a core that the page could not inline as it is", () => {
  assert.throws(() => inlineCore('const s = "</script>";'), /closing script tag/);
  assert.throws(() => inlineCore('import x from "y";'), /no imports/);
  assert.throws(() => inlineCore("export { a };"), /no imports/);
  assert.throws(() => pageWithCore("<script></script>", ""), /markers missing/);
});
