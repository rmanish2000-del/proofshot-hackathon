import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { shaFromFragment } from "../src/core.js";
import { CORE_PATH, SHOP_PATH, inlineCore, pageWithCore } from "../src/page.ts";
import { fixtureProviders, runJob } from "../src/pipeline.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { recordedClock } from "../src/receipt.ts";
import { CATALOG_FILE, FIXTURE_JOB_ID, GARMENTS_DIR, buildShop, garmentDirs, garmentNoteFrom, rowsForJob, writeFixtureJob, writeGarmentPreviewJob, writeGarmentPreviewJobs } from "../src/shop.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `shop-${name}-`));

type Verdict = "match" | "mismatch" | "uncertain";

/** One fixture job under jobsRoot. The scene's findings decide its gate: all match → RELEASE. */
async function job(jobsRoot: string, jobId: string, scene: { verdict?: Verdict; confidence?: number; attribute?: string } = {}): Promise<string> {
  const findings = () => ({
    findings: ATTRIBUTES.map((attribute) => ({
      attribute,
      verdict: attribute === (scene.attribute ?? "color") ? (scene.verdict ?? "match") : "match",
      confidence: scene.confidence ?? 0.95,
      note: "",
      evidence: { source_bbox: null, render_bbox: null },
    })),
  });
  const r = await runJob(
    { jobId, garmentNote: `note for ${jobId}`, scenes: ["studio"], sources: [{ name: "front.png", bytes: Buffer.from(`front ${jobId}`) }] },
    {
      outRoot: jobsRoot,
      provenance: "fixture",
      clock: recordedClock(Array(10).fill("2026-10-27T09:00:00.000Z")),
      providers: fixtureProviders({ renders: () => Buffer.from(`render ${jobId}`), findings }),
    },
  );
  return r.dir;
}

test("REVIEW and REFUSE jobs produce no row; only a release does", async () => {
  const jobs = tmp("jobs");
  await job(jobs, "refused", { verdict: "mismatch" }); // hard mismatch on colour → REFUSE
  await job(jobs, "reviewed", { confidence: 0.5 }); // below every floor → REVIEW
  await job(jobs, "released");
  const out = tmp("out");
  const built = buildShop(jobs, out);
  assert.deepEqual(built.problems, []);
  assert.deepEqual(built.rows.map((r) => r.job_id), ["released"]);
  assert.equal(existsSync(join(out, "refused")), false);
  assert.equal(existsSync(join(out, "reviewed")), false);
});

test("each row's image_sha256 is the sha256 of the copied file, and the receipt is copied byte for byte", async () => {
  const jobs = tmp("jobs");
  const dir = await job(jobs, "released");
  const out = tmp("out");
  const { rows } = buildShop(jobs, out);
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.render_id, "released-r0");
  assert.equal(row.scene, "studio");
  assert.equal(row.provenance, "fixture");
  assert.equal(row.approved_by_human, false);
  assert.match(row.gate_reason, /^RELEASE/);
  assert.equal(row.image, "shop/released/released-r0.png");
  assert.equal(row.receipt, "shop/released/receipt.jsonl");
  const copied = readFileSync(join(out, row.image.replace(/^shop\//, "")));
  assert.equal(sha256Hex(copied), row.image_sha256);
  assert.equal(sha256Hex(copied), sha256Hex("render released"));
  assert.deepEqual(readFileSync(join(out, "released", RECEIPT_FILE)), readFileSync(join(dir, RECEIPT_FILE)));
  const catalog = JSON.parse(readFileSync(join(out, CATALOG_FILE), "utf8")) as { rows: unknown[] };
  assert.deepEqual(catalog.rows, rows);
});

test("an edited receipt, or a released image with other bytes, yields no row and a non-zero exit", async () => {
  const jobs = tmp("jobs");
  // All three jobs first: a broken sibling receipt refuses a later job before any
  // render (SPEC §3, prior records), which is right, but not what this test is about.
  const edited = await job(jobs, "edited");
  const swapped = await job(jobs, "swapped");
  await job(jobs, "good");
  const path = join(edited, RECEIPT_FILE);
  writeFileSync(path, readFileSync(path, "utf8").replace("note for edited", "note for someone else"));
  writeFileSync(join(swapped, "swapped-r0.png"), "other bytes");

  assert.throws(() => rowsForJob(edited, "edited"), /does not verify/);
  assert.throws(() => rowsForJob(swapped, "swapped"), /does not hash to the release/);

  const out = tmp("out");
  const built = buildShop(jobs, out);
  assert.deepEqual(built.rows.map((r) => r.job_id), ["good"]);
  assert.deepEqual(built.problems.map((p) => p.job_id).sort(), ["edited", "swapped"]);
  assert.equal(existsSync(join(out, "edited")), false);

  const script = join(ROOT, "scripts", "shop-build.ts");
  const run = (jobsDir: string) =>
    spawnSync(process.execPath, ["--experimental-strip-types", script, "--jobs", jobsDir, "--out", tmp("script-out"), "--no-fixture"], { encoding: "utf8" });
  const bad = run(jobs);
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /skip edited: the record does not verify/);
  const goodOnly = tmp("jobs");
  await job(goodOnly, "good");
  assert.equal(run(goodOnly).status, 0);
});

test("the fixture job is byte-identical on every run, and the committed copy and catalog are current", async () => {
  const a = tmp("fixture");
  const b = tmp("fixture");
  assert.equal(await writeFixtureJob(a), true);
  assert.equal(await writeFixtureJob(a), false, "one job id is one chain");
  await writeFixtureJob(b);
  const receipt = (root: string) => readFileSync(join(root, FIXTURE_JOB_ID, RECEIPT_FILE), "utf8");
  assert.equal(receipt(a), receipt(b));
  assert.equal(receipt(join(ROOT, "data", "jobs")), receipt(a), "data/jobs/fixture-shirt-01 is stale: delete it and run npm run shop");

  const built = buildShop(join(ROOT, "data", "jobs"), tmp("out"));
  assert.deepEqual(built.problems, []);
  assert.ok(built.rows.some((r) => r.job_id === FIXTURE_JOB_ID && r.render_id === `${FIXTURE_JOB_ID}-r0`), "studio releases");
  assert.ok(!built.rows.some((r) => r.render_id === `${FIXTURE_JOB_ID}-r1`), "street is refused on colour and gets no row");
  const committed = JSON.parse(readFileSync(join(ROOT, "web", "shop", CATALOG_FILE), "utf8")) as { rows: unknown[] };
  assert.deepEqual(committed.rows, built.rows, "web/shop/catalog.json is stale: run npm run shop");
  for (const row of built.rows) {
    const bytes = readFileSync(join(ROOT, "web", row.image));
    assert.equal(sha256Hex(bytes), row.image_sha256, `${row.image} does not match its row`);
  }
});

test("garment preview jobs: sources are the intake photos, the image is the front photo, byte-identical, and the committed copies are current", async () => {
  const garmentsRoot = join(ROOT, GARMENTS_DIR);
  const previewed = garmentDirs(garmentsRoot);
  assert.ok(previewed.includes("kurta-01") && previewed.includes("kurta-02"), "kurta-01 and kurta-02 have been through intake");

  const a = tmp("previews");
  const b = tmp("previews");
  assert.deepEqual(await writeGarmentPreviewJobs(a, garmentsRoot), previewed);
  assert.deepEqual(await writeGarmentPreviewJobs(a, garmentsRoot), [], "one job id is one chain");
  await writeGarmentPreviewJobs(b, garmentsRoot);
  for (const garment of previewed) {
    const receipt = (root: string) => readFileSync(join(root, garment, RECEIPT_FILE), "utf8");
    assert.equal(receipt(a), receipt(b), `${garment}: the receipt is byte-identical on every run`);
    assert.equal(receipt(join(ROOT, "data", "jobs")), receipt(a), `data/jobs/${garment} is stale: delete it and run npm run shop`);

    const intake = JSON.parse(readFileSync(join(garmentsRoot, garment, "intake.json"), "utf8")) as { files: { name: string; sha256: string }[] };
    const [rowList] = [rowsForJob(join(a, garment), garment)];
    assert.equal(rowList.length, 1);
    const row = rowList[0]!;
    assert.equal(row.render_id, `${garment}-r0`);
    assert.equal(row.scene, "studio");
    assert.equal(row.provenance, "fixture");
    assert.equal(row.image, `shop/${garment}/${garment}-r0.jpg`);
    assert.match(row.garment_note, /stands in for the render/);
    const front = [...intake.files].sort((x, y) => x.name.localeCompare(y.name))[0]!;
    assert.equal(row.image_sha256, front.sha256, `${garment}: the released image is the front photo, unchanged`);
    const jobEntry = JSON.parse(receipt(a).split("\n")[0]!) as { payload: { source_images: { name: string; sha256: string }[] } };
    assert.deepEqual(
      jobEntry.payload.source_images,
      [...intake.files].sort((x, y) => x.name.localeCompare(y.name)).map((f) => ({ name: f.name, sha256: f.sha256 })),
      `${garment}: source_images are the intake photos with the intake hashes`,
    );
  }

  // A photo whose bytes changed since intake is refused, not previewed.
  const broken = tmp("garment");
  const dir = join(broken, "kurta-01");
  mkdirSync(dir);
  for (const name of ["intake.json", "note.txt"]) copyFileSync(join(garmentsRoot, "kurta-01", name), join(dir, name));
  writeFileSync(join(dir, "1-front.jpg"), "not the photo");
  await assert.rejects(writeGarmentPreviewJob(tmp("jobs"), dir, "kurta-01"), /does not hash as intake\.json says/);

  assert.equal(garmentNoteFrom("Type: kurta (women's)\nMain colour: peach\n", "x"), "kurta (women's), peach");
  assert.equal(garmentNoteFrom("Type: not recorded\nMain colour: as in the photos\n", "kurta-09"), "kurta-09");
});

test("web/shop.html carries the current core.js, and loads nothing from outside its own folder", () => {
  const page = readFileSync(SHOP_PATH, "utf8");
  const core = readFileSync(CORE_PATH, "utf8");
  assert.equal(page, pageWithCore(page, core), "web/shop.html is stale: run npm run page");
  assert.ok(page.includes(inlineCore(core)));
  assert.match(page, /Content-Security-Policy" content="default-src 'none'; connect-src 'self'; img-src blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'"/);
  for (const banned of [/https?:\/\//i, /<link\b/i, /<script\b[^>]*\bsrc=/i, /XMLHttpRequest/, /WebSocket/, /\bimport\s*\(/, /sendBeacon/]) {
    assert.doesNotMatch(page, banned);
  }
  // The badge text appears once, in the one place that paints a verified item.
  assert.equal(page.split("Verified by ProofShot").length - 1, 1);
  assert.match(page, /verify\.html#sha=/);
});

test("#sha prefill parses the fragment and lower-cases it; anything else is null", () => {
  const hex = "ABCDEF0123456789".repeat(4);
  assert.equal(shaFromFragment(`#sha=${hex}`), hex.toLowerCase());
  assert.equal(shaFromFragment(`sha=${hex}`), hex.toLowerCase());
  assert.equal(shaFromFragment(`#x=1&sha=${hex}&y=2`), hex.toLowerCase());
  assert.equal(shaFromFragment(`#sha=${hex.slice(1)}`), null);
  assert.equal(shaFromFragment(`#sha=${hex}0`), null);
  assert.equal(shaFromFragment(`#sha=${hex.slice(0, 63)}g`), null);
  assert.equal(shaFromFragment("#job=x"), null);
  assert.equal(shaFromFragment(""), null);
  assert.equal(shaFromFragment(null), null);
  assert.equal(shaFromFragment(undefined), null);
});
