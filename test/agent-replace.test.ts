import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { makeConfig } from "../src/agent/config.ts";
import type { AgentConfig } from "../src/agent/config.ts";
import { EXPLAIN, replaceTrigger } from "../src/agent/reasons.ts";
import { runAgentStep } from "../src/agent/runner.ts";
import type { GateRunner } from "../src/agent/runner.ts";
import { validateAction } from "../src/agent/schema.ts";
import { SellerError, approve, createJob, replacePrimary } from "../src/agent/service.ts";
import { Store } from "../src/agent/store.ts";
import { parseReceipt, verifyChain } from "../src/receipt.ts";
import { cannedDemoProviders, pipelineGate } from "../src/recovery-gate.ts";
import type { ProvidersFor } from "../src/recovery-gate.ts";
import { headerSize, nearCopyDistance, selfComparisonReview } from "../src/tryon.ts";
import { decodeRgb } from "../src/image.ts";
import jpeg from "jpeg-js";
import { ATTRIBUTES } from "../src/types.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const G = join(ROOT, "data", "garments", "shirt-plaid");
const photo = (f: string) => new Uint8Array(readFileSync(join(G, f)));
const CLOCK = () => "2026-10-31T00:00:00.000Z";

/**
 * A keyless gate where photo 1 decides fidelity, as src/fidelity.ts does: a photo named bad*.jpg is "cropped"
 * (its mask box runs to the bottom edge) and fidelity says REFUSE; any other photo 1 measures RELEASE. The
 * verifier matches every attribute, as Muse Spark did on both real pairs.
 */
const badFirst: ProvidersFor = (input) => {
  const p = cannedDemoProviders(input);
  return {
    ...p,
    segmenter: { segment: async (sources) => sources.map((s) => ({ label: `${s.name}/the garment`, box: s.name.startsWith("bad") ? [0, 0.05, 1, 0.95] as const : [0.05, 0.1, 0.9, 0.8] as const, score: 0.98, mask: null })) },
    verifier: { ...p.verifier, verify: async () => ({ raw: { findings: ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match", confidence: 0.95, note: "same in both" })) } }) },
    fidelity: {
      check: async ({ sources }) => sources[0]!.name.startsWith("bad")
        ? { decision: "REFUSE", metrics: { delta_e: 3, hist: 0.1, texture: 0.5, area: 0.8 }, reasons: ["texture 0.500 below 0.650"] }
        : { decision: "RELEASE", metrics: { delta_e: 1, hist: 0.02, texture: 0.9, area: 1 }, reasons: [] },
    },
  };
};

function setup() {
  let gateCalls = 0;
  const store = new Store(mkdtempSync(join(tmpdir(), "agent-rp-")));
  const config = makeConfig({});
  const inner = pipelineGate({ offline: badFirst, live: badFirst, clock: CLOCK });
  const gate: GateRunner = (i) => { gateCalls++; return inner(i); };
  return { store, config, gate, calls: () => gateCalls };
}

async function badJob(store: Store, gate: GateRunner, config: AgentConfig, seller = "seller-a", job = "polo-1") {
  return createJob(store, gate, {
    // The candidate is not one of the photos' bytes: "replace 8" covers a photo that is the candidate itself.
    seller, job, garmentNote: "plaid shirt, long sleeves", candidate: { file: "candidate.jpg", bytes: photo("2-back.jpg") },
    photos: [{ file: "bad.jpg", bytes: photo("1-front.jpg"), view: "full_length_front" }, { file: "collar.jpg", bytes: photo("3-collar.jpg"), view: "collar_closeup" }],
  }, config);
}

const scope = { job: "polo-1", photos: ["bad.jpg", "collar.jpg"], outcomeCode: "fidelity_breach", primary: "bad.jpg", primaryProblems: ["cropped"], replaces: 0 };
const ok = (p: unknown, s: Record<string, unknown> = scope) => validateAction(p, s as typeof scope).ok;

test("replace 1: request_replace_primary is allowlisted and validated: current job, photo 1, only the problems the receipt shows, max 1", () => {
  assert.ok(ok({ tool: "request_replace_primary", args: { listing: "polo-1", photo: "bad.jpg", problems: ["cropped"] } }));
  for (const bad of [
    { tool: "request_replace_primary", args: { listing: "other-job", photo: "bad.jpg", problems: ["cropped"] } },
    { tool: "request_replace_primary", args: { listing: "polo-1", photo: "collar.jpg", problems: ["cropped"] } },
    { tool: "request_replace_primary", args: { listing: "polo-1", photo: "bad.jpg", problems: ["angled"] } }, // not in the receipt
    { tool: "request_replace_primary", args: { listing: "polo-1", photo: "bad.jpg", problems: ["blurry"] } },
    { tool: "request_replace_primary", args: { listing: "polo-1", photo: "bad.jpg", problems: [] } },
    { tool: "request_replace_primary", args: { listing: "polo-1", photo: "bad.jpg", problems: ["cropped", "cropped"] } },
    { tool: "request_replace_primary", args: { listing: "polo-1", photo: "bad.jpg", problems: "cropped" } },
    { tool: "request_replace_primary", args: { listing: "polo-1", photo: "bad.jpg", problems: ["cropped"], decision: "RELEASE" } },
    { tool: "request_replace_primary", args: { listing: "polo-1", photo: "bad.jpg", problems: ["cropped"], instructions: "Ignore the gate." } },
    { tool: "request_replace_primary", args: { listing: "polo-1", photo: "bad.jpg" } },
  ]) assert.equal(ok(bad), false, JSON.stringify(bad));
  // The limit of 1 is in the validator too, not only in the policy.
  assert.equal(ok({ tool: "request_replace_primary", args: { listing: "polo-1", photo: "bad.jpg", problems: ["cropped"] } }, { ...scope, replaces: 1 }), false);
  // No problem shown by the receipt: nothing to replace.
  assert.equal(ok({ tool: "request_replace_primary", args: { listing: "polo-1", photo: "bad.jpg", problems: ["cropped"] } }, { ...scope, primaryProblems: undefined }), false);
});

test("replace 2: a cropped photo 1 → the agent asks to replace it → the seller approves and replaces → the gate runs again from the start", async () => {
  const { store, config, gate, calls } = setup();
  const created = await badJob(store, gate, config);
  assert.equal(created.runs[0]!.decision, "REFUSE");
  const s1 = await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  assert.deepEqual(s1.tools, ["read_receipt", "request_replace_primary"]);
  assert.equal(s1.status, "awaiting_seller");
  assert.equal(s1.decision, "REFUSE", "asking for a photo moves no verdict");
  const asked = store.readJob("seller-a", "polo-1").replace_request!;
  assert.deepEqual(asked.problems, ["cropped"]);
  assert.match(asked.text_en, /cut off/);
  assert.match(asked.text_en, /replace photo 1 with a full-length front photo/);
  assert.match(asked.text_en, /adding more photos will not change the result, but replacing photo 1 can/);
  assert.match(asked.text_hi, /फ़ोटो 1/);

  const replaced = replacePrimary(store, "seller-a", "polo-1", { file: "front.jpg", bytes: photo("1-front.jpg"), view: "full_length_front" }, "seller A", config, CLOCK);
  assert.deepEqual(replaced.photos.map((p) => p.file), ["front.jpg", "collar.jpg"], "the new photo is photo 1; the old one left the listing");
  assert.equal(replaced.replaced![0]!.old.file, "bad.jpg");
  const s2 = await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  assert.deepEqual(s2.tools, ["check_photo_quality", "rerun_gate", "read_receipt", "explain"]);
  assert.equal(s2.decision, "RELEASE");
  assert.equal(s2.status, "ready_to_publish");

  // A paid re-check after the replacement is approved as always, and its cost is logged on the replacement.
  approve(store, "seller-a", "polo-1", "paid_rerun", "seller A", config, CLOCK);
  const rec0 = store.readJob("seller-a", "polo-1");
  store.writeJob({ ...rec0, status: "new" });
  const s3 = await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  assert.equal(s3.tools[0], "rerun_gate");
  const rec = store.readJob("seller-a", "polo-1");
  assert.deepEqual(rec.replaced![0]!.runs.map((r) => [r.n, r.mode, r.decision, r.cost_usd]), [[2, "offline", "RELEASE", 0], [3, "live", "RELEASE", config.verifierCallEstimateUsd]]);
  assert.equal(rec.cost_usd, config.verifierCallEstimateUsd);
  assert.equal(calls(), 3, "every run went through the gate runner");
});

test("replace 3: only the job's own seller can replace, only while asked, only with a full-length front", async () => {
  const { store, config, gate } = setup();
  await badJob(store, gate, config);
  const front = { file: "front.jpg", bytes: photo("1-front.jpg"), view: "full_length_front" as const };
  assert.throws(() => replacePrimary(store, "seller-a", "polo-1", front, "seller A", config, CLOCK), /has not asked/, "no open request yet");
  await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  assert.throws(() => replacePrimary(store, "seller-b", "polo-1", front, "seller B", config, CLOCK), SellerError, "another seller");
  assert.throws(() => replacePrimary(store, "../seller-a", "polo-1", front, "x", config, CLOCK));
  assert.throws(() => replacePrimary(store, "seller-a", "polo-1", { ...front, view: "collar_closeup" }, "seller A", config, CLOCK), /full-length front/);
  assert.throws(() => replacePrimary(store, "seller-a", "polo-1", front, "Robert'); DROP", config, CLOCK), /plain name/);
  assert.equal(store.readJob("seller-a", "polo-1").photos[0]!.file, "bad.jpg", "nothing changed");
  assert.equal(replacePrimary(store, "seller-a", "polo-1", front, "seller A", config, CLOCK).photos[0]!.file, "front.jpg");
});

test("replace 4: at most 1 replacement per job, even when the new photo 1 is cropped too", async () => {
  const { store, config, gate } = setup();
  await badJob(store, gate, config);
  await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  replacePrimary(store, "seller-a", "polo-1", { file: "bad-2.jpg", bytes: photo("1-front.jpg"), view: "full_length_front" }, "seller A", config, CLOCK);
  const s2 = await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  assert.deepEqual(s2.tools, ["check_photo_quality", "rerun_gate", "read_receipt", "explain"], "no second request");
  assert.equal(s2.decision, "REFUSE");
  assert.equal(s2.status, "done");
  // A model proposing a second replacement is rejected by the validator.
  const rec = store.readJob("seller-a", "polo-1");
  store.writeJob({ ...rec, status: "new" });
  let n = 0;
  const pushy = () => (n++ === 0 ? { tool: "read_receipt", args: {} } : { tool: "request_replace_primary", args: { listing: "polo-1", photo: "bad-2.jpg", problems: ["cropped"] } });
  const s3 = await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK, proposer: pushy });
  assert.equal(s3.rejected.length, 1);
  assert.match(s3.rejected[0]!, /already had 1 replacement/);
  // And the seller side refuses too, even with a request forced onto the record.
  store.writeJob({ ...store.readJob("seller-a", "polo-1"), replace_request: { photo: "bad-2.jpg", problems: ["cropped"], text_en: "", text_hi: "" } });
  assert.throws(() => replacePrimary(store, "seller-a", "polo-1", { file: "front.jpg", bytes: photo("1-front.jpg"), view: "full_length_front" }, "seller A", config, CLOCK), /1 time per job/);
});

test("replace 5: the agent section logs the action, the approval, the replacement, the result and the cost, hash-chained", async () => {
  const { store, config, gate } = setup();
  await badJob(store, gate, config);
  await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  replacePrimary(store, "seller-a", "polo-1", { file: "front.jpg", bytes: photo("1-front.jpg"), view: "full_length_front" }, "seller A", config, CLOCK);
  await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  const log = store.readAgentLog("seller-a", "polo-1");
  assert.equal(verifyChain(log).ok, true);
  const p = log.map((e) => e.payload as Record<string, unknown>);
  const proposed = p.find((x) => x.event === "proposed" && (x.action as { tool: string }).tool === "request_replace_primary")!;
  assert.equal(proposed.validation, "ok");
  const read = p.find((x) => x.event === "tool_result" && x.tool === "read_receipt")!;
  assert.deepEqual((read.result as { primary: { problems: string[] } }).primary.problems, ["cropped"]);
  assert.match((read.result as { primary: { evidence: string[] } }).primary.evidence[0]!, /bottom edge/);
  const approval = p.find((x) => x.event === "approval")!;
  assert.deepEqual(approval.approval, { what: "replace_primary", by: "seller A", at: CLOCK() });
  const swap = p.find((x) => x.event === "replaced_primary")!;
  assert.equal((swap.old as { file: string }).file, "bad.jpg");
  assert.match((swap.new as { sha256: string }).sha256, /^[0-9a-f]{64}$/);
  const rerun = p.find((x) => x.event === "tool_result" && x.tool === "rerun_gate")!;
  assert.equal((rerun.result as { after_replace: boolean }).after_replace, true);
  assert.equal(rerun.cost_usd, 0);
  const final = p.filter((x) => x.event === "final").at(-1)!;
  assert.equal(final.gate_decision, "RELEASE");
});

test("replace 6: the gate verdict is never set by the agent: the receipt after a replacement is byte-identical to a direct gate run", async () => {
  const { store, config, gate } = setup();
  await badJob(store, gate, config);
  await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  replacePrimary(store, "seller-a", "polo-1", { file: "front.jpg", bytes: photo("1-front.jpg"), view: "full_length_front" }, "seller A", config, CLOCK);
  await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  const viaAgent = readFileSync(join(store.runDir("seller-a", "polo-1"), "run-2", "receipt.jsonl"), "utf8");
  const rec = store.readJob("seller-a", "polo-1");
  const out = mkdtempSync(join(tmpdir(), "no-agent-"));
  // The same prior records the agent's run saw (run-1), so only the agent's presence differs.
  cpSync(join(store.runDir("seller-a", "polo-1"), "run-1"), join(out, "run-1"), { recursive: true });
  const res = await pipelineGate({ offline: badFirst, clock: CLOCK })({
    seller: "seller-a", job: "polo-1", runId: "run-2", outRoot: out, garmentNote: rec.garment_note,
    sources: rec.photos.map((x) => ({ name: x.file, bytes: store.readPhoto("seller-a", "polo-1", x.file) })),
    candidate: store.readPhoto("seller-a", "polo-1", rec.candidate), views: Object.fromEntries(rec.photos.map((x) => [x.file, x.view])), mode: "offline",
  });
  assert.equal(readFileSync(join(out, "run-2", "receipt.jsonl"), "utf8"), viaAgent);
  assert.equal(rec.runs.at(-1)!.decision, res.decision);
  // Every decision on the record is the one in that run's own gate entry.
  for (const r of rec.runs) {
    const gateEntry = store.readRunReceipt("seller-a", "polo-1", r.n).filter((e) => e.kind === "gate").at(-1)!;
    assert.equal((gateEntry.payload as { decision: string }).decision, r.decision, `run-${r.n}`);
  }
  // No tool takes a verdict.
  for (const t of ["set_verdict", "set_decision", "publish", "replace_and_release"]) assert.equal(ok({ tool: t, args: {} }), false, t);
});

test("replace 8 (SC1): a new photo 1 that is the image to publish itself is REVIEW, said plainly in the receipt, and cannot be published", async () => {
  const { store, config, gate } = setup();
  await badJob(store, gate, config);
  await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  // The seller answers the request with the candidate's own bytes.
  replacePrimary(store, "seller-a", "polo-1", { file: "front.jpg", bytes: photo("2-back.jpg"), view: "full_length_front" }, "seller A", config, CLOCK);
  const s2 = await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  assert.equal(s2.decision, "REVIEW", "the measured RELEASE does not stand: fidelity compared the photo with itself");
  assert.notEqual(s2.status, "ready_to_publish");
  const receipt = store.readRunReceipt("seller-a", "polo-1", 2);
  const fid = receipt.find((e) => e.kind === "fidelity")!.payload as { decision: string; reasons: string[] };
  assert.equal(fid.decision, "REVIEW");
  assert.match(fid.reasons.at(-1)!, /^self_comparison: the image to publish is source photo 1 \(front\.jpg\) byte for byte/);
  assert.match(fid.reasons.at(-1)!, /nothing generated/);
  const gateEntry = receipt.filter((e) => e.kind === "gate").at(-1)!.payload as { decision: string; cited: { rule: string; reason: string } };
  assert.deepEqual([gateEntry.decision, gateEntry.cited.rule], ["REVIEW", "fidelity"]);
  assert.equal(receipt.some((e) => e.kind === "release"), false);
  assert.throws(() => approve(store, "seller-a", "polo-1", "publish", "seller A", config, CLOCK), /only a RELEASE/);
});

test("replace 9 (SC1): the self-comparison wrapper only ever makes fidelity stricter, and leaves other renders alone", async () => {
  const a = photo("1-front.jpg");
  const b = photo("2-back.jpg");
  const sources = [{ name: "front.jpg", bytes: a }, { name: "collar.jpg", bytes: photo("3-collar.jpg") }];
  const fixed = (decision: "RELEASE" | "REVIEW" | "REFUSE") => selfComparisonReview({ check: async () => ({ decision, metrics: null, reasons: decision === "RELEASE" ? [] : ["measured"] }) });
  const req = (render: Uint8Array) => ({ sources, segments: [], render, renderId: "r0", scene: "studio" });
  assert.deepEqual(await fixed("RELEASE").check(req(b)), { decision: "RELEASE", metrics: null, reasons: [] }, "a different image: untouched");
  assert.equal((await fixed("RELEASE").check(req(a))).decision, "REVIEW");
  assert.equal((await fixed("REVIEW").check(req(a))).decision, "REVIEW");
  const refused = await fixed("REFUSE").check(req(a));
  assert.equal(refused.decision, "REFUSE");
  assert.deepEqual(refused.reasons.slice(0, 1), ["measured"]);
  assert.match(refused.reasons[1]!, /source photo 1/);
  assert.match((await fixed("RELEASE").check(req(photo("3-collar.jpg")))).reasons[0]!, /source photo 2 \(collar\.jpg\)/);
});

/** Re-encode a JPEG at another quality, optionally at 1/step size (nearest pixel): a seller re-saving or resizing it. */
function resave(bytes: Uint8Array, quality: number, step = 1): Uint8Array {
  const img = decodeRgb(bytes);
  const width = Math.floor(img.width / step);
  const height = Math.floor(img.height / step);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * step * img.width + x * step) * 3;
    rgba.set([img.data[p]!, img.data[p + 1]!, img.data[p + 2]!, 255], (y * width + x) * 4);
  }
  return new Uint8Array(jpeg.encode({ data: rgba, width, height }, quality).data);
}

/** A JPEG stretched to width x height (nearest pixel), quality 90: another picture with the candidate's framing. */
function resize(bytes: Uint8Array, width: number, height: number): Uint8Array {
  const img = decodeRgb(bytes);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (Math.floor((y * img.height) / height) * img.width + Math.floor((x * img.width) / width)) * 3;
    rgba.set([img.data[p]!, img.data[p + 1]!, img.data[p + 2]!, 255], (y * width + x) * 4);
  }
  return new Uint8Array(jpeg.encode({ data: rgba, width, height }, 90).data);
}

test("replace 10 (SC2): a new photo 1 that is the image to publish re-encoded or resized is REVIEW too; a different photo is not", async (t) => {
  const candidate = photo("2-back.jpg");
  // exif: the same pixels with an Exif APP1 block after SOI, as a phone file differs from its stripped copy.
  const exif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0, 0, 0, 0, ...candidate.subarray(2)]);
  const copies = { exif, q50: resave(candidate, 50), q95: resave(candidate, 95), half: resave(candidate, 70, 2) };
  for (const [name, bytes] of Object.entries(copies)) {
    assert.notEqual(Buffer.compare(Buffer.from(bytes), Buffer.from(candidate)), 0, `${name} has other bytes`);
    const d = nearCopyDistance(candidate, bytes)!;
    t.diagnostic(`near copy ${name}: ${d.toFixed(3)}`);
    assert.ok(d < 1, `${name}: distance ${d}`);
  }
  // The other side of the threshold: other photos of the same garment.
  for (const other of ["1-front.jpg", "3-collar.jpg"]) {
    const d = nearCopyDistance(candidate, photo(other));
    t.diagnostic(`other photo ${other}: ${d === null ? "not comparable" : d.toFixed(3)}`);
    assert.ok(d === null || d > 10, `${other}: distance ${d}`);
  }
  // Same aspect, different picture: the front photo stretched to the candidate's size is compared, and is far.
  const size = decodeRgb(candidate);
  for (const other of ["1-front.jpg", "3-collar.jpg"]) {
    const d = nearCopyDistance(candidate, resize(photo(other), size.width, size.height))!;
    t.diagnostic(`other photo ${other} at the candidate's size: ${d.toFixed(3)}`);
    assert.ok(d > 10, `${other} resized: distance ${d}`);
  }
  assert.deepEqual(headerSize(candidate), { width: size.width, height: size.height }, "header size matches the decode");
  assert.deepEqual(headerSize(exif), { width: size.width, height: size.height }, "header size skips an Exif block");
  assert.equal(nearCopyDistance(candidate, new Uint8Array([1, 2, 3])), null, "not an image: no claim either way");

  // Through the agent: the seller answers the replace request with the candidate re-saved at quality 50.
  const { store, config, gate } = setup();
  await badJob(store, gate, config);
  await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  replacePrimary(store, "seller-a", "polo-1", { file: "front.jpg", bytes: copies.q50, view: "full_length_front" }, "seller A", config, CLOCK);
  const s2 = await runAgentStep({ store, seller: "seller-a", job: "polo-1", gate, config, clock: CLOCK });
  assert.equal(s2.decision, "REVIEW", "a re-saved copy of the image to publish is not a fidelity pass");
  assert.notEqual(s2.status, "ready_to_publish");
  const fid = store.readRunReceipt("seller-a", "polo-1", 2).find((e) => e.kind === "fidelity")!.payload as { decision: string; reasons: string[] };
  assert.equal(fid.decision, "REVIEW");
  assert.match(fid.reasons.at(-1)!, /^self_comparison: the image to publish is a near copy of source photo 1 \(front\.jpg\): mean pixel difference \d+\.\d\d on a 32x32 grid, at most 3 /);
  assert.match(fid.reasons.at(-1)!, /nothing generated/);

  // Only ever stricter: REFUSE stays REFUSE; a different image is untouched.
  const fixed = (decision: "RELEASE" | "REFUSE") => selfComparisonReview({ check: async () => ({ decision, metrics: null, reasons: [] }) });
  const req = (render: Uint8Array) => ({ sources: [{ name: "front.jpg", bytes: copies.half }], segments: [], render, renderId: "r0", scene: "studio" });
  assert.equal((await fixed("REFUSE").check(req(candidate))).decision, "REFUSE");
  assert.equal((await fixed("RELEASE").check(req(candidate))).decision, "REVIEW");
  assert.deepEqual(await fixed("RELEASE").check(req(photo("1-front.jpg"))), { decision: "RELEASE", metrics: null, reasons: [] });
});

test("replace 7: the trigger on the real 30 Oct receipts, and the seller text says what would change the outcome", () => {
  const real = join(ROOT, "evidence", "agent-real-2026-10-30", "store", "records", "seller-manish");
  const read = (job: string, run: number) => parseReceipt(readFileSync(join(real, job, "runs", `run-${run}`, "receipt.jsonl"), "utf8"));
  // The polo: photo 1 angled with the hem cut off; its SAM mask box runs to the bottom edge. The verifier notes did not say so.
  const polo = replaceTrigger(read("shirt-pink", 2), "1-cropped.jpg")!;
  assert.deepEqual([polo.fidelity, polo.problems], ["REFUSE", ["cropped"]]);
  // The kurta: photo 1 is the back; the verifier's note says the source shows the back view only.
  const kurta = replaceTrigger(read("kurta-mustard", 2), "1-back-cropped.jpg")!;
  assert.deepEqual([kurta.fidelity, kurta.problems], ["REFUSE", ["partial_view"]]);
  // With the full-length front added as photo 2, the notes no longer say the source is the back and its mask is
  // clear of the edges: from the receipt alone nothing shows. The seller's own label for photo 1 does.
  assert.equal(replaceTrigger(read("kurta-mustard", 3), "1-back-cropped.jpg"), null);
  const byLabel = replaceTrigger(read("kurta-mustard", 3), "1-back-cropped.jpg", "full_length_back")!;
  assert.deepEqual(byLabel.problems, ["partial_view"]);
  assert.match(byLabel.evidence[0]!, /labelled full_length_back/);
  // The 31 Oct kurta receipt, whose notes missed the fixed patterns: caught by the label alone.
  const missed = join(ROOT, "evidence", "agent-replace-2026-10-31", "store", "records", "seller-manish", "kurta-mustard", "runs", "run-2", "receipt.jsonl");
  const missedEntries = parseReceipt(readFileSync(missed, "utf8"));
  assert.equal(replaceTrigger(missedEntries, "1-back-cropped.jpg"), null);
  assert.deepEqual(replaceTrigger(missedEntries, "1-back-cropped.jpg", "full_length_back")!.problems, ["partial_view"]);
  // A full_length_front label adds nothing, and a label never triggers without a fidelity REVIEW/REFUSE.
  assert.equal(replaceTrigger(read("kurta-mustard", 3), "2-full-front.jpg", "full_length_front"), null);
  const passing = read("shirt-pink", 3).map((e) => (e.kind === "fidelity" ? { ...e, payload: { ...(e.payload as object), decision: "RELEASE" } } : e));
  assert.equal(replaceTrigger(passing, "2-full-front.jpg", "collar_closeup"), null);
  // The good full-length front is not flagged as photo 1 (its mask stays clear of the top and bottom edges).
  assert.equal(replaceTrigger(read("kurta-mustard", 3), "2-full-front.jpg"), null);
  assert.equal(replaceTrigger(read("shirt-pink", 3), "2-full-front.jpg"), null);
  for (const code of ["hard_mismatch", "fidelity_breach"] as const) {
    assert.doesNotMatch(EXPLAIN[code].fix_en, /More photos will not change this/);
    assert.match(EXPLAIN[code].fix_en, /^What changes this: /);
    assert.match(EXPLAIN[code].fix_en, /full-length front photo/);
    assert.doesNotMatch(EXPLAIN[code].fix_hi, /और फ़ोटो से यह नहीं बदलेगा/);
  }
  assert.match(EXPLAIN.fidelity_breach.fix_en, /measured against photo 1 only/);
});
