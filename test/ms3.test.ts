import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planMs3 } from "../src/ms3.ts";

function job(root: string, id: string, garment: string, sha: string, provider: string, ext = "jpg"): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const lines = [
    { kind: "job", payload: { job_id: id, garment_note: `${garment}: Type: kurta (women's)` } },
    { kind: "render", payload: { render_id: `${id}-r0`, sha256: sha } },
    { kind: "verifier", payload: { verifier: { provider, model: "m" } } },
  ];
  writeFileSync(join(dir, "receipt.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(dir, `${id}-r0.${ext}`), "x");
}

test("MS3 plans one Meta re-check per distinct garment and render, skipping what has no photos or was already checked on Meta", () => {
  const base = mkdtempSync(join(tmpdir(), "ms3-"));
  const jobs = join(base, "jobs");
  const garments = join(base, "garments");
  mkdirSync(join(garments, "kurta-01"), { recursive: true });
  writeFileSync(join(garments, "kurta-01", "intake.json"), "{}");
  writeFileSync(join(garments, "kurta-01", "note.txt"), "Type: kurta (women's)\n");

  job(jobs, "kurta-01", "kurta-01", "front", "baseten");
  job(jobs, "live-kurta-01", "kurta-01", "front", "baseten"); // same bytes as the stand-in above
  job(jobs, "live-kurta-01-tryon", "kurta-01", "tryon", "baseten");
  job(jobs, "live-kurta-01-composite", "kurta-01", "comp", "baseten", "png");
  job(jobs, "ms2-kurta-01", "kurta-01", "front2", "meta");
  job(jobs, "live-kurta-01-sam", "kurta-01", "front2", "baseten"); // already checked on Meta by ms2
  job(jobs, "fixture-shirt-01", "shirt-01", "s", "baseten"); // no committed photos
  job(jobs, "upload-20261029-0000-aaaa", "kurta-01", "u", "baseten");
  job(jobs, "ms3-kurta-01", "kurta-01", "front", "meta"); // MS3 output is never planned again

  const plan = planMs3(jobs, garments);
  assert.deepEqual(
    plan.items.map((i) => [i.job_id, i.render_sha256, i.segment_prompt]),
    [
      ["ms3-kurta-01", "front", "kurta"],
      ["ms3-live-kurta-01-composite", "comp", "kurta"],
      ["ms3-live-kurta-01-tryon", "tryon", "kurta"],
    ],
  );
  assert.ok(plan.items[1]!.render_path.endsWith("live-kurta-01-composite-r0.png"));
  const reasons = Object.fromEntries(plan.skipped.map((s) => [s.job, s.reason]));
  assert.match(reasons["live-kurta-01"]!, /same garment and render bytes/);
  assert.match(reasons["live-kurta-01-sam"]!, /same garment and render bytes/);
  assert.match(reasons["ms2-kurta-01"]!, /already checked on the Meta verifier/);
  assert.match(reasons["fixture-shirt-01"]!, /shirt-01 has no committed photos/);
  assert.match(reasons["upload-20261029-0000-aaaa"]!, /upload job/);
  assert.equal(reasons["ms3-kurta-01"], undefined);
});
