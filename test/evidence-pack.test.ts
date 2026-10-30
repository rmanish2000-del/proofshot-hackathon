import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { callStats, jobRows, percentile, rowsCsv, sampleFromLog, summarize } from "../src/evidence-pack.ts";
import { fileURLToPath } from "node:url";

import { Receipt, recordedClock } from "../src/receipt.ts";

function writeJob(root: string, id: string, decision: string, verifierError = "") {
  const r = new Receipt({ clock: recordedClock(Array.from({ length: 8 }, (_, i) => `2026-10-29T10:00:0${i}.000Z`)) });
  r.append("job", { job_id: id, garment_note: "shirt-x: Type: shirt", provenance: "live" });
  r.append("segments", { count: 1, segmenter: { provider: "meta", model: "sam" } });
  r.append("render", { render_id: `${id}-r0`, sha256: "a".repeat(64), provider: "composite", model: "composite-v2" });
  r.append("verifier", { render_id: `${id}-r0`, findings: verifierError ? [] : [{ attribute: "color" }], verifier: { provider: "meta", model: "muse-spark-1.3" }, usage: { prompt_tokens: 100, completion_tokens: 20 }, ...(verifierError ? { error: verifierError } : {}) });
  r.append("fidelity", { render_id: `${id}-r0`, decision: "RELEASE" });
  r.append("gate", { render_id: `${id}-r0`, decision, cited: verifierError ? { reason: "color: no finding, so not verified" } : null });
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, "receipt.jsonl"), r.toJsonl());
}

test("#10 pack 1: one row per render from receipts, chain checked, upload jobs left out; summary counts decisions and verifier failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "ps-pack-"));
  writeJob(root, "a-job", "RELEASE");
  writeJob(root, "b-job", "REFUSE", "VerifierTransportError: fetch failed");
  writeJob(root, "upload-x", "RELEASE");
  const rows = jobRows(root);
  assert.deepEqual(rows.map((r) => r.job_id), ["a-job", "b-job"]);
  assert.equal(rows[0]!.chain_ok, true);
  assert.equal(rows[0]!.garment, "shirt-x");
  assert.equal(rows[0]!.verifier_model, "muse-spark-1.3");
  assert.equal(rows[0]!.prompt_tokens, 100);
  assert.equal(rows[1]!.verifier_error, "VerifierTransportError: fetch failed");
  const s = summarize(rows);
  assert.deepEqual(s.decisions, { REFUSE: 1, RELEASE: 1 });
  assert.equal(s.verifier_errors, 1);
  assert.deepEqual(s.garments_with_receipts, ["shirt-x"]);
  const tampered = readFileSync(join(root, "a-job", "receipt.jsonl"), "utf8").replace('"composite-v2"', '"composite-v3"');
  writeFileSync(join(root, "a-job", "receipt.jsonl"), tampered);
  assert.equal(jobRows(root)[0]!.chain_ok, false, "an edited byte breaks the chain");
  assert.match(rowsCsv(rows).split("\n")[0]!, /^job_id,provenance,garment,chain_ok/);
});

test("#10 pack 2: nearest-rank percentiles; per-stage stats read latency and usage from logs, failed calls kept apart", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5, 1, 3], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  const ok = { provider: "meta", model: "muse-spark-1.3", latency_ms: 2000, response: { status: 200, body: { usage: { input_tokens: 1_000_000, output_tokens: 0 } } }, error: null };
  assert.deepEqual(sampleFromLog("verifier-1.json", ok), { stage: "verify: muse-spark-1.3 (meta)", ok: true, latency_ms: 2000, usd: 1.25 });
  assert.equal(sampleFromLog("sam-1.json", { latency_ms: 10, response: { status: 200 }, error: null })!.usd, 0.0025);
  assert.equal(sampleFromLog("other.json", {}), null);
  const dir = mkdtempSync(join(tmpdir(), "ps-logs-"));
  writeFileSync(join(dir, "verifier-a.json"), JSON.stringify(ok));
  writeFileSync(join(dir, "verifier-b.json"), JSON.stringify({ ...ok, latency_ms: 400, response: null, error: "TypeError: fetch failed" }));
  const [st] = callStats([dir]);
  assert.equal(st!.calls, 2);
  assert.equal(st!.failed, 1);
  assert.equal(st!.latency_ms_median, 2000, "a failed call's latency is not a latency sample");
});

test("#10 pack 4 (SUB14): a spend ledger beside the call logs is not a call; verifier failures split into failed calls and unusable answers", () => {
  assert.equal(sampleFromLog("fireworks-ledger-20261029.json", { entries: [] }), null);
  const dir = mkdtempSync(join(tmpdir(), "ps-logs-"));
  writeFileSync(join(dir, "fireworks-a.json"), JSON.stringify({ provider: "fireworks", model: "m", latency_ms: 5, response: { status: 200, body: {} }, error: null }));
  writeFileSync(join(dir, "fireworks-ledger-20261029.json"), JSON.stringify({ entries: [{ cost_usd: 0.001 }] }));
  assert.deepEqual(callStats([dir]).map((s) => [s.stage, s.calls]), [["copy: m (fireworks)", 1]]);
  const root = mkdtempSync(join(tmpdir(), "ps-pack-"));
  writeJob(root, "a-job", "REFUSE", "VerifierProtocolError: verifier output: not JSON");
  writeJob(root, "b-job", "REFUSE", "VerifierTransportError: fetch failed");
  writeJob(root, "c-job", "REFUSE", "VerifierTransportError: TimeoutError: aborted");
  writeJob(root, "d-job", "RELEASE");
  const s = summarize(jobRows(root));
  assert.equal(s.verifier_errors, 3);
  assert.deepEqual(s.verifier_errors_by_kind, { VerifierProtocolError: 1, VerifierTransportError: 2 });
});

test("#10 pack 3: the committed pack is current: results.csv and the receipts summary equal what the committed receipts give", () => {
  const pack = new URL("../evidence/pack/", import.meta.url);
  assert.ok(existsSync(new URL("results.csv", pack)), "run npm run evidence:pack");
  const rows = jobRows(fileURLToPath(new URL("../data/jobs/", import.meta.url)));
  assert.equal(readFileSync(new URL("results.csv", pack), "utf8"), rowsCsv(rows), "evidence/pack/results.csv is stale: run npm run evidence:pack");
  const summary = JSON.parse(readFileSync(new URL("summary.json", pack), "utf8")) as { receipts: unknown; sources: { museum_samples: string } };
  assert.deepEqual(summary.receipts, summarize(rows));
  assert.match(summary.sources.museum_samples, /^not used/);
  assert.equal(rows.every((r) => r.chain_ok), true, "every committed receipt verifies");
});

test("#10 pack 5 (SUB18): the calibration groups in the committed pack add up to the cases, with the unmeasured renders inside them", () => {
  const summary = JSON.parse(readFileSync(new URL("../evidence/pack/summary.json", import.meta.url), "utf8")) as { calibration: { cases: number; judged_as_labelled: number; same_released: number; different_held: number; false_refuse: number; same_sent_to_review: number; unmeasured: number; unmeasured_within: Record<string, number> } };
  const c = summary.calibration;
  assert.equal(c.judged_as_labelled + c.false_refuse + c.same_sent_to_review, c.cases);
  assert.equal(c.same_released + c.different_held, c.judged_as_labelled);
  assert.equal(Object.values(c.unmeasured_within).reduce((a, b) => a + b, 0), c.unmeasured);
});
