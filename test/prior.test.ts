import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { RECEIPT_FILE, priorRecords } from "../src/prior.ts";
import { Receipt, garmentId, recordedClock } from "../src/receipt.ts";

const GARMENT = garmentId(["a".repeat(64), "b".repeat(64)])!;
const OTHER = garmentId(["c".repeat(64)])!;

/** Writes one finished job into root/dir and returns its head. */
function writeJob(root: string, dir: string, at: string, garment: string | null, decisions: string[]): string {
  mkdirSync(join(root, dir), { recursive: true });
  const receipt = new Receipt({ path: join(root, dir, RECEIPT_FILE), clock: recordedClock(Array(1 + decisions.length * 2).fill(at)) });
  receipt.append("job", { job_id: dir, garment_id: garment, prior_records: [] });
  decisions.forEach((decision, i) => {
    receipt.append("gate", { render_id: `r${i}`, decision, cited: null, reasons: [] });
    if (decision === "RELEASE") receipt.append("release", { render_id: `r${i}`, image_sha256: "d".repeat(64), approver: "unattended", approved_by_human: false });
  });
  return receipt.head;
}

const root = () => mkdtempSync(join(tmpdir(), "prior-"));

test("earlier jobs on the same garment are listed oldest first, with refusals and releases counted", () => {
  const out = root();
  const late = writeJob(out, "job-b", "2026-10-27T10:00:00.000Z", GARMENT, ["RELEASE"]);
  const early = writeJob(out, "job-a", "2026-10-27T09:00:00.000Z", GARMENT, ["REFUSE", "REVIEW", "REFUSE"]);
  writeJob(out, "job-c", "2026-10-27T08:00:00.000Z", OTHER, ["REFUSE"]);
  assert.deepEqual(priorRecords(out, GARMENT), [
    { job_id: "job-a", head: early, refusals: 2, releases: 0, at: "2026-10-27T09:00:00.000Z" },
    { job_id: "job-b", head: late, refusals: 0, releases: 1, at: "2026-10-27T10:00:00.000Z" },
  ]);
});

test("a re-run adds a record and the earlier refusal stays visible", () => {
  const out = root();
  writeJob(out, "run-1", "2026-10-27T09:00:00.000Z", GARMENT, ["REFUSE"]);
  writeJob(out, "run-2", "2026-10-27T09:05:00.000Z", GARMENT, ["RELEASE"]);
  const records = priorRecords(out, GARMENT, "run-3");
  assert.deepEqual(records.map((r) => [r.job_id, r.refusals, r.releases]), [["run-1", 1, 0], ["run-2", 0, 1]]);
});

test("the job being written is skipped, and equal timestamps order by directory name", () => {
  const out = root();
  writeJob(out, "z", "2026-10-27T09:00:00.000Z", GARMENT, []);
  writeJob(out, "m", "2026-10-27T09:00:00.000Z", GARMENT, []);
  writeJob(out, "self", "2026-10-27T08:00:00.000Z", GARMENT, ["REFUSE"]);
  assert.deepEqual(priorRecords(out, GARMENT, "self").map((r) => r.job_id), ["m", "z"]);
});

test("a null garment id, a missing root, or directories without a receipt give no history", () => {
  const out = root();
  writeJob(out, "j", "2026-10-27T09:00:00.000Z", null, ["REFUSE"]);
  mkdirSync(join(out, "empty"));
  writeFileSync(join(out, "stray.txt"), "not a job");
  assert.deepEqual(priorRecords(out, null), []);
  assert.deepEqual(priorRecords(out, GARMENT), []);
  assert.deepEqual(priorRecords(join(out, "nope"), GARMENT), []);
});

test("a sibling receipt that was edited throws instead of hiding its refusals", () => {
  const out = root();
  writeJob(out, "j", "2026-10-27T09:00:00.000Z", GARMENT, ["REFUSE"]);
  const path = join(out, "j", RECEIPT_FILE);
  writeFileSync(path, readFileSync(path, "utf8").replace('"REFUSE"', '"RELEASE"'));
  assert.throws(() => priorRecords(out, GARMENT), /does not verify: entry 1/);
});

test("a sibling receipt that is not JSON throws with its path", () => {
  const out = root();
  mkdirSync(join(out, "j"));
  writeFileSync(join(out, "j", RECEIPT_FILE), "{not json\n");
  assert.throws(() => priorRecords(out, GARMENT), (err: Error) => err.message.includes(join(out, "j", RECEIPT_FILE)) && /not JSON/.test(err.message));
});
