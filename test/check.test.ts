import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkImage } from "../src/check.ts";
import { fixtureProviders, runJob } from "../src/pipeline.ts";
import { RECEIPT_FILE } from "../src/prior.ts";
import { Receipt, parseReceipt, recordedClock } from "../src/receipt.ts";
import type { ReceiptEntry } from "../src/receipt.ts";
import { ATTRIBUTES } from "../src/types.ts";
import { sha256Hex } from "../src/util.ts";

const findings = (mismatch?: string) => ({
  findings: ATTRIBUTES.map((attribute) => ({
    attribute, verdict: attribute === mismatch ? "mismatch" : "match", confidence: 0.95, note: "", evidence: { source_bbox: null, render_bbox: null },
  })),
});

/** A job whose studio render releases and whose street render is refused on colour. */
async function record(): Promise<ReceiptEntry[]> {
  const r = await runJob(
    { jobId: "job", garmentNote: "indigo shirt", scenes: ["studio", "street"], sources: [{ name: "front.png", bytes: Buffer.from("front") }] },
    {
      outRoot: mkdtempSync(join(tmpdir(), "check-")),
      provenance: "fixture",
      clock: recordedClock(Array(20).fill("2026-10-27T09:00:00.000Z")),
      providers: fixtureProviders({ renders: (scene) => Buffer.from(`render of ${scene}`), findings: (scene) => findings(scene === "street" ? "color" : undefined) }),
    },
  );
  return parseReceipt(readFileSync(join(r.dir, RECEIPT_FILE), "utf8"));
}

const STUDIO = sha256Hex("render of studio");
const STREET = sha256Hex("render of street");

test("a released image is VALID, and hex case does not matter", async () => {
  const entries = await record();
  for (const sha of [STUDIO, STUDIO.toUpperCase(), ` ${STUDIO}\n`]) {
    assert.deepEqual(checkImage(entries, sha), { status: "VALID", render_id: "job-r0", decision: "RELEASE", reason: "this image was released by this record" });
  }
});

test("a rendered but refused image is NOT RELEASED and cites its gate decision", async () => {
  const r = checkImage(await record(), STREET);
  assert.equal(r.status, "NOT RELEASED");
  assert.equal(r.render_id, "job-r1");
  assert.equal(r.decision, "REFUSE");
});

test("a render with no gate entry is NOT RELEASED with no decision", () => {
  const receipt = new Receipt({ clock: recordedClock(Array(2).fill("2026-10-27T09:00:00.000Z")) });
  receipt.append("job", { job_id: "j" });
  receipt.append("render", { render_id: "j-r0", sha256: STUDIO });
  assert.deepEqual(checkImage(receipt.entries, STUDIO), {
    status: "NOT RELEASED", render_id: "j-r0", decision: null, reason: "this image was rendered but never reached the gate",
  });
});

test("an image in no entry, a malformed hash, or a record that does not verify is TAMPERED", async () => {
  const entries = await record();
  assert.equal(checkImage(entries, sha256Hex("something else")).status, "TAMPERED");
  for (const bad of ["", "abc", STUDIO.slice(1), `${STUDIO}0`, "g".repeat(64), null, undefined]) {
    const r = checkImage(entries, bad as unknown as string);
    assert.equal(r.status, "TAMPERED", String(bad));
    assert.match(r.reason, /not 64 hex/);
  }
  // Edit the refused render's gate entry to RELEASE: the chain breaks, so even the released image is not vouched for.
  const edited = entries.map((e) => (e.kind === "gate" && (e.payload as { render_id: string }).render_id === "job-r1" ? { ...e, payload: { ...(e.payload as object), decision: "RELEASE" } } : e));
  for (const sha of [STUDIO, STREET]) {
    const r = checkImage(edited, sha);
    assert.equal(r.status, "TAMPERED");
    assert.match(r.reason, /does not verify/);
  }
  assert.equal(checkImage([], STUDIO).status, "TAMPERED");
});
