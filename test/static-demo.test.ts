import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { presentJob } from "../src/present.ts";
import { parseReceipt } from "../src/receipt.ts";
import { JUDGE_REWRITES, buildStaticDemo, staticJudgeHtml } from "../src/static-demo.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const JOBS = ["ms2-shirt-plaid", "live-shirt-plaid-mismatch"];

function setup() {
  const tmp = mkdtempSync(join(tmpdir(), "static-demo-"));
  const web = join(tmp, "web");
  const jobs = join(tmp, "jobs");
  mkdirSync(web);
  for (const page of ["judge.html", "verify.html", "shop.html"]) cpSync(join(ROOT, "web", page), join(web, page));
  for (const id of JOBS) cpSync(join(ROOT, "data", "jobs", id), join(jobs, id), { recursive: true });
  // A local seller-page job: gitignored in the repo, so the static demo must leave it out.
  cpSync(join(ROOT, "data", "jobs", "ms2-shirt-plaid"), join(jobs, "upload-20261030-000000-abcd"), { recursive: true });
  const out = join(tmp, "out");
  return { web, jobs, out, result: buildStaticDemo({ webDir: web, jobsRoot: jobs, garmentsDir: join(ROOT, "data", "garments"), outDir: out }) };
}

test("static demo: committed jobs only, the server's job view with relative URLs, build-time verify and tamper results", () => {
  const { jobs, out, result } = setup();
  assert.deepEqual([...result.jobs].sort(), [...JOBS].sort(), "upload-* jobs are left out");
  const listing = JSON.parse(readFileSync(join(out, "api", "receipts.json"), "utf8")) as { jobs: { job_id: string; decision: string }[]; counts: Record<string, number> };
  assert.deepEqual(listing.jobs.map((j) => j.job_id).sort(), [...JOBS].sort());
  assert.deepEqual(listing.counts, { RELEASE: 1, REVIEW: 0, REFUSE: 1 });

  for (const id of JOBS) {
    const text = readFileSync(join(jobs, id, "receipt.jsonl"), "utf8");
    const view = JSON.parse(readFileSync(join(out, "api", "receipts", `${id}.json`), "utf8")) as Record<string, unknown> & { images: Record<string, string>; receipt: string };
    const { images, receipt, ...rest } = view;
    assert.deepEqual(rest, JSON.parse(JSON.stringify(presentJob(parseReceipt(text)))), `${id}: the same view the server sends`);
    assert.equal(receipt, `jobs/${id}/receipt.jsonl`);
    assert.equal(readFileSync(join(out, receipt), "utf8"), text, `${id}: receipt copied byte for byte`);
    assert.ok(Object.keys(images).length > 0, `${id}: has its render image`);
    for (const url of Object.values(images)) {
      assert.ok(!url.startsWith("/"), `${url} is relative`);
      assert.ok(existsSync(join(out, url)), `${url} exists`);
    }
    assert.ok(existsSync(join(out, "api", "receipts", id, "source", "0.jpg")), `${id}: source photo 0 (hash-checked) is there`);
    const verify = JSON.parse(readFileSync(join(out, "api", "receipts", id, "verify.json"), "utf8")) as { ok: boolean };
    assert.equal(verify.ok, true, `${id}: the committed chain verifies`);
    const tamper = JSON.parse(readFileSync(join(out, "api", "receipts", id, "tamper.json"), "utf8")) as { result: { ok: boolean } };
    assert.equal(tamper.result.ok, false, `${id}: the one-byte copy does not verify`);
  }

  const judge = readFileSync(join(out, "judge.html"), "utf8");
  assert.doesNotMatch(judge, /["`]\/api\//, "no server API path is left in the static judge page");
  assert.match(judge, /Static demo: no server and no API key/);
  for (const [, to] of JUDGE_REWRITES) assert.ok(judge.includes(to), to);
  assert.equal(readFileSync(join(out, "verify.html"), "utf8"), readFileSync(join(ROOT, "web", "verify.html"), "utf8"), "verify.html is copied unchanged");
  assert.match(readFileSync(join(out, "index.html"), "utf8"), /judge\.html\?job=live-shirt-plaid-mismatch/);
});

test("static demo: the build fails loudly if judge.html no longer has a URL it rewrites", () => {
  const page = readFileSync(join(ROOT, "web", "judge.html"), "utf8");
  assert.throws(() => staticJudgeHtml(page.replace('getJson("/api/receipts")', 'getJson("/api/list")')), /judge\.html changed/);
});
