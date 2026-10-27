import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { GENESIS, Receipt, entryHash, garmentId, parseReceipt, recordedClock, verifyChain } from "../src/receipt.ts";
import type { ReceiptEntry } from "../src/receipt.ts";
import { canonicalJson, sha256Hex } from "../src/util.ts";

const TIMES = ["2026-10-27T06:00:00.000Z", "2026-10-27T06:00:01.000Z", "2026-10-27T06:00:02.000Z", "2026-10-27T06:00:03.000Z"];

function sample(): Receipt {
  const r = new Receipt({ clock: recordedClock(TIMES) });
  r.append("job", { job_id: "j1", provenance: "fixture" });
  r.append("render", { render_id: "r1", sha256: "a".repeat(64) });
  r.append("gate", { render_id: "r1", decision: "REFUSE", cited: null, reasons: [] });
  return r;
}

function withTempDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "proofshot-receipt-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("entry 0 points at genesis, each prev is the last hash, and hash covers seq, at, kind, payload, prev", () => {
  const [a, b, c] = sample().entries as [ReceiptEntry, ReceiptEntry, ReceiptEntry];
  assert.equal(GENESIS, "0".repeat(64));
  assert.equal(a.prev, GENESIS);
  assert.equal(b.prev, a.hash);
  assert.equal(c.prev, b.hash);
  assert.deepEqual([a.seq, b.seq, c.seq], [0, 1, 2]);
  assert.equal(a.at, TIMES[0]);
  assert.equal(a.hash, sha256Hex(canonicalJson({ seq: 0, at: TIMES[0], kind: "job", payload: a.payload, prev: GENESIS })));
});

test("a good chain verifies and reports its head", () => {
  const r = sample();
  assert.deepEqual(verifyChain(r.entries), { ok: true, head: r.head, length: 3 });
});

test("an empty receipt does not verify", () => {
  assert.deepEqual(verifyChain([]), { ok: false, index: 0, reason: "empty receipt" });
});

test("editing a payload breaks the chain at that entry", () => {
  const entries = structuredClone(sample().entries) as ReceiptEntry[];
  (entries[2]!.payload as { decision: string }).decision = "RELEASE";
  assert.deepEqual(verifyChain(entries), { ok: false, index: 2, reason: "hash does not match the entry" });
});

test("reordering, deleting a line, or a wrong seq is caught at the first broken index", () => {
  const e = sample().entries;
  assert.equal(verifyChain([e[1]!, e[0]!, e[2]!]).ok, false);
  assert.deepEqual(verifyChain([e[0]!, e[2]!]), { ok: false, index: 1, reason: "seq is 2, expected 1" });
  assert.deepEqual(verifyChain([e[1]!, e[2]!]), { ok: false, index: 0, reason: "seq is 1, expected 0" });
});

test("a forged entry with a correct own hash still breaks the next link", () => {
  const e = structuredClone(sample().entries) as ReceiptEntry[];
  const forged = { ...e[1]!, payload: { render_id: "r1", sha256: "b".repeat(64) } };
  e[1] = { ...forged, hash: entryHash(forged) };
  assert.deepEqual(verifyChain(e), { ok: false, index: 2, reason: "prev does not match the previous hash" });
});

test("an entry that cannot be hashed, or is not an object, is reported, not thrown", () => {
  const e = structuredClone(sample().entries) as ReceiptEntry[];
  const bad = [{ ...e[0]!, payload: { x: NaN } }, e[1]!];
  assert.equal(verifyChain(bad).ok, false);
  assert.match((verifyChain(bad) as { reason: string }).reason, /cannot hash entry/);
  assert.deepEqual(verifyChain([null as unknown as ReceiptEntry]), { ok: false, index: 0, reason: "entry is not an object" });
});

test("a payload canonicalJson rejects never reaches the chain", () => {
  const r = new Receipt({ clock: recordedClock(TIMES) });
  assert.throws(() => r.append("job", { score: NaN }), /non-finite/);
  assert.equal(r.entries.length, 0);
});

test("the recorded clock hands out timestamps in order and throws when it runs out", () => {
  const clock = recordedClock(["t0", "t1"]);
  assert.equal(clock(), "t0");
  assert.equal(clock(), "t1");
  assert.throws(() => clock(), /ran out after 2/);
});

test("the same inputs and clock give byte-identical receipts", () => {
  assert.equal(sample().toJsonl(), sample().toJsonl());
});

test("the file receipt matches memory, parses back, and verifies", () => {
  withTempDir((dir) => {
    const path = join(dir, "receipt.jsonl");
    const r = new Receipt({ clock: recordedClock(TIMES), path });
    r.append("job", { job_id: "j1", note: undefined });
    r.append("release", { render_id: "r1" });
    const text = readFileSync(path, "utf8");
    assert.equal(text, r.toJsonl());
    assert.deepEqual(parseReceipt(text), r.entries);
    assert.equal(verifyChain(parseReceipt(text)).ok, true);
  });
});

test("reopening a receipt file continues the chain; it never truncates it", () => {
  withTempDir((dir) => {
    const path = join(dir, "receipt.jsonl");
    new Receipt({ clock: recordedClock(TIMES), path }).append("job", { job_id: "j1" });
    const again = new Receipt({ clock: recordedClock(TIMES.slice(1)), path });
    const second = again.append("job", { job_id: "j2" });
    const all = parseReceipt(readFileSync(path, "utf8"));
    assert.equal(all.length, 2);
    assert.equal(second.seq, 1);
    assert.equal(second.prev, all[0]!.hash);
    assert.equal(verifyChain(all).ok, true);
  });
});

test("appending to a receipt file that does not verify is refused, and the file is left as it was", () => {
  withTempDir((dir) => {
    const path = join(dir, "receipt.jsonl");
    const tampered = sample().toJsonl().replace('"REFUSE"', '"RELEASE"');
    writeFileSync(path, tampered);
    assert.throws(() => new Receipt({ path }), /broken receipt: entry 2/);
    assert.equal(readFileSync(path, "utf8"), tampered);
  });
});

test("a receipt line that is not JSON throws with its line number", () => {
  assert.throws(() => parseReceipt(sample().toJsonl() + "{oops\n"), /line 4 is not JSON/);
});

test("garment_id is order-independent over source hashes, and null with no sources", () => {
  const h1 = "1".repeat(64);
  const h2 = "2".repeat(64);
  assert.equal(garmentId([h2, h1]), garmentId([h1, h2]));
  assert.equal(garmentId([h1, h2]), sha256Hex(canonicalJson([h1, h2])));
  assert.notEqual(garmentId([h1]), garmentId([h1, h2]));
  assert.equal(garmentId([]), null);
});
