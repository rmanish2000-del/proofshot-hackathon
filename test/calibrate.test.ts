import assert from "node:assert/strict";
import { test } from "node:test";

import { labelledPairs, pairMetricLines, parseRenderLabels, recordedRenders, scaledCandidates, scoreCalibration, scoreRecorded, wholeFrameMask } from "../src/calibrate.ts";
import type { CalibrationCase, ReceiptLine } from "../src/calibrate.ts";
import { checkFidelity, judgeMetrics, loadThresholds } from "../src/fidelity.ts";
import { ATTRIBUTES } from "../src/types.ts";

// Synthetic fixtures: 8 x 8 solid images with a full mask. No photo is read.
const W = 8;
const H = 8;
const solid = (r: number, g: number, b: number) => ({ width: W, height: H, data: Uint8Array.from({ length: W * H * 3 }, (_, i) => [r, g, b][i % 3]!) });
const full = { width: W, height: H, data: new Uint8Array(W * H).fill(1) };
const pair = (id: string, label: "same" | "different", source: ReturnType<typeof solid>, render: ReturnType<typeof solid>, extra: Partial<CalibrationCase> = {}): CalibrationCase => ({
  id, label, source, render, sourceMask: full, renderMask: full, ...extra,
});

const grey = solid(128, 128, 128);
const cases: CalibrationCase[] = [
  pair("same-exact", "same", grey, solid(128, 128, 128)),
  pair("same-shift", "same", grey, solid(140, 140, 140)),
  pair("different-red", "different", grey, solid(220, 30, 30)),
  pair("no-mask", "same", grey, grey, { renderMask: null }),
];

const base = loadThresholds();
// These cases carry no findings, so the threshold tests score fidelity alone.
const FIDELITY = { scope: "fidelity" } as const;

test("config thresholds: an identical pair releases, a far colour refuses, a missing mask is counted unmeasured, not as an error", () => {
  const [score] = scoreCalibration(cases, [{ name: "config", thresholds: base }], FIDELITY);
  const by = Object.fromEntries(score!.cases.map((c) => [c.id, c]));
  assert.equal(by["same-exact"]!.decision, "RELEASE");
  assert.equal(by["different-red"]!.decision, "REFUSE");
  assert.deepEqual([by["no-mask"]!.decision, by["no-mask"]!.measured], ["REVIEW", false]);
  assert.deepEqual([score!.same, score!.different, score!.false_match, score!.unmeasured], [3, 1, 0, 1]);
});

test("looser thresholds release the different pair (a false match); stricter ones refuse the shifted same pair (a false refuse)", () => {
  const scores = scoreCalibration(cases, scaledCandidates(base, [0.001, 1, 1000]), FIDELITY);
  assert.deepEqual(scores.map((s) => s.name), ["x0.001", "x1", "x1000"]);
  const [strict, , loose] = scores;
  assert.equal(loose!.false_match, 1, "x1000: the red render releases");
  assert.equal(loose!.cases.find((c) => c.id === "different-red")!.decision, "RELEASE");
  assert.equal(strict!.false_match, 0);
  assert.equal(strict!.cases.find((c) => c.id === "same-shift")!.decision, "REFUSE");
  assert.equal(strict!.cases.find((c) => c.id === "same-exact")!.decision, "RELEASE", "zero distance passes any limit");
  assert.ok(strict!.false_refuse >= 1);
});

test("findings on a case put the gate on top of fidelity: a hard mismatch refuses a pair fidelity would release", () => {
  const findings = ATTRIBUTES.map((attribute) => ({ attribute, verdict: attribute === "color" ? ("mismatch" as const) : ("match" as const), confidence: 0.95 }));
  const [score] = scoreCalibration([pair("same-exact", "same", grey, grey, { findings })], [{ name: "config", thresholds: base }]);
  assert.deepEqual([score!.cases[0]!.fidelity, score!.cases[0]!.decision, score!.false_refuse], ["RELEASE", "REFUSE", 1]);
  const matches = ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match" as const, confidence: 0.95 }));
  const [ok] = scoreCalibration([pair("same-exact", "same", grey, grey, { findings: matches })], [{ name: "config", thresholds: base }]);
  assert.equal(ok!.cases[0]!.decision, "RELEASE");
});

test("N10: every case carries its raw fidelity values, the same under every candidate, and pairMetricLines prints them or unmeasured", () => {
  const scores = scoreCalibration(cases, scaledCandidates(base, [0.001, 1, 1000]), FIDELITY);
  const exact = scores[1]!.cases.find((c) => c.id === "same-exact")!;
  assert.deepEqual(exact.metrics, { delta_e: 0, hist: 0, texture: 1, area: 1 });
  assert.ok(scores[1]!.cases.find((c) => c.id === "different-red")!.metrics!.delta_e > base.delta_e.refuse_above);
  assert.equal(scores[1]!.cases.find((c) => c.id === "no-mask")!.metrics, null);
  assert.deepEqual(scores[0]!.cases.map((c) => c.metrics), scores[2]!.cases.map((c) => c.metrics), "values do not depend on the thresholds");
  const lines = pairMetricLines(scores[1]!.cases);
  assert.equal(lines.length, cases.length);
  assert.equal(lines[0], "same       same-exact: delta_e 0.000  hist 0.000  texture 1.000  area 1.000");
  assert.equal(lines[3], "same       no-mask: unmeasured");
  assert.ok(lines.every((l) => !/RELEASE|REVIEW|REFUSE/.test(l)), "values only, no decision");
});

test("scaled candidates keep area, cap texture at 1, and reject bad input", () => {
  const [c] = scaledCandidates(base, [0.5]);
  assert.deepEqual(c!.thresholds.delta_e, { review_above: base.delta_e.review_above * 0.5, refuse_above: base.delta_e.refuse_above * 0.5 });
  assert.deepEqual(c!.thresholds.texture, { review_below: 1, refuse_below: 1 }, "0.8/0.5 and 0.65/0.5 cap at 1");
  assert.deepEqual(c!.thresholds.area, base.area);
  for (const f of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => scaledCandidates(base, [f]), /positive finite/);
  assert.throws(() => scoreCalibration([cases[0]!, cases[0]!], []), /appears twice/);
  assert.throws(() => scoreCalibration([{ ...cases[0]!, label: "maybe" as "same" }], []), /not same or different/);
  assert.throws(() => scoreCalibration(cases, [], { scope: "release" as "gate" }), /say gate or fidelity/);
});

test("N1: a case with absent or undefined findings fails closed at the gate (REFUSE not_verified), whatever fidelity says", () => {
  const [score] = scoreCalibration(
    [pair("absent", "same", grey, grey), pair("undefined", "different", grey, grey, { findings: undefined }), pair("empty", "same", grey, grey, { findings: [] })],
    [{ name: "config", thresholds: base }],
  );
  assert.deepEqual(score!.cases.map((c) => [c.id, c.fidelity, c.decision]), [
    ["absent", "RELEASE", "REFUSE"],
    ["undefined", "RELEASE", "REFUSE"],
    ["empty", "RELEASE", "REFUSE"],
  ]);
  assert.equal(score!.false_match, 0, "a different pair with no findings is never released");
  // Fidelity alone is an explicit choice, and it still reports the fidelity decision.
  const [alone] = scoreCalibration([pair("absent", "same", grey, grey)], [{ name: "config", thresholds: base }], FIDELITY);
  assert.equal(alone!.cases[0]!.decision, "RELEASE");
});

test("labelledPairs: every ordered pair of two different photos, same when both come from one garment dir, different otherwise (Grok 10:48)", () => {
  const photos = [
    { garment: "kurta-01", name: "1-front.jpg" },
    { garment: "kurta-01", name: "3-back.jpg" },
    { garment: "kurta-02", name: "1-front.jpg" },
  ];
  const pairs = labelledPairs(photos);
  assert.equal(pairs.length, 6, "3 photos give 3 x 2 ordered pairs, no photo against itself");
  assert.deepEqual(pairs.map((p) => [p.id, p.label]), [
    ["kurta-01/1-front.jpg -> kurta-01/3-back.jpg", "same"],
    ["kurta-01/1-front.jpg -> kurta-02/1-front.jpg", "different"],
    ["kurta-01/3-back.jpg -> kurta-01/1-front.jpg", "same"],
    ["kurta-01/3-back.jpg -> kurta-02/1-front.jpg", "different"],
    ["kurta-02/1-front.jpg -> kurta-01/1-front.jpg", "different"],
    ["kurta-02/1-front.jpg -> kurta-01/3-back.jpg", "different"],
  ]);
  assert.equal(pairs[0]!.source, photos[0]);
  assert.equal(pairs[0]!.render, photos[1]);
  // The same file name in two garments is still two photos, and different.
  assert.equal(new Set(pairs.map((p) => p.id)).size, pairs.length);
  assert.deepEqual(labelledPairs([photos[0]!]), []);
});

test("judgeMetrics is checkFidelity's threshold step: same decision and reasons, and checkFidelity keeps its key order for receipts", () => {
  for (const render of [solid(128, 128, 128), solid(150, 140, 128), solid(220, 30, 30)]) {
    const fid = checkFidelity({ source: grey, render, sourceMask: full, renderMask: full }, base);
    assert.deepEqual(Object.keys(fid), ["decision", "metrics", "reasons"]);
    assert.deepEqual(judgeMetrics(fid.metrics!, base), { decision: fid.decision, reasons: fid.reasons });
  }
  assert.equal(judgeMetrics({ delta_e: Number.NaN, hist: 0, texture: 1, area: 1 }, base).decision, "REVIEW");
});

// Synthetic receipts: hashes are made-up 64-hex strings, no photo or image is read.
const hex = (c: string) => c.repeat(64);
const PHOTO_A = hex("a");
const PHOTO_B = hex("b");
const photos = new Map([[PHOTO_A, "kurta-01"], [PHOTO_B, "kurta-02"]]);
const MATCHES = ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match" as const, confidence: 0.95 }));
const OK = { delta_e: 1, hist: 0.05, texture: 0.95, area: 1 };
const receipt = (job_id: string, render: string, opts: { sources?: string[]; provenance?: string; metrics?: object | null; findings?: unknown; gate?: string; noFidelity?: boolean } = {}): ReceiptLine[] => {
  const render_id = `${job_id}-r0`;
  const lines: ReceiptLine[] = [
    { kind: "job", payload: { job_id, provenance: opts.provenance ?? "live", source_images: (opts.sources ?? [PHOTO_A]).map((sha256, i) => ({ name: `${i}.jpg`, sha256 })) } },
    { kind: "render", payload: { render_id, sha256: render } },
  ];
  if (opts.findings !== undefined) lines.push({ kind: "verifier", payload: { render_id, findings: opts.findings } });
  if (!opts.noFidelity) {
    const metrics = opts.metrics === undefined ? OK : opts.metrics;
    lines.push({ kind: "fidelity", payload: { render_id, decision: "REVIEW", metrics, reasons: metrics ? [] : ["source mask is missing"] } });
  }
  lines.push({ kind: "gate", payload: { render_id, decision: opts.gate ?? "RELEASE" } });
  return lines;
};
const labels = parseRenderLabels({
  renders: {
    [PHOTO_A]: { shows: "kurta-01", by: "test", why: "kurta-01 front" },
    [PHOTO_B]: { shows: "kurta-02", by: "test", why: "kurta-02 front" },
    [hex("c")]: { shows: "kurta-01", changed: "length cut to hip", by: "test", why: "try-on" },
  },
});

test("recordedRenders: the label compares what the render shows with the garment the job's source photos belong to", () => {
  const own = recordedRenders(receipt("own", PHOTO_A, { findings: MATCHES }), labels, photos);
  assert.deepEqual(own.cases.map((c) => [c.id, c.label, c.garment, c.recorded]), [["own-r0", "same", "kurta-01", "RELEASE"]]);
  assert.deepEqual(own.cases[0]!.metrics, OK);
  // The same image is a different case in a job for another garment: kurta-02's photo as kurta-01's render.
  assert.equal(recordedRenders(receipt("mismatch", PHOTO_B, { findings: MATCHES }), labels, photos).cases[0]!.label, "different");
  // An image that shows the garment but changed it is not faithful.
  assert.equal(recordedRenders(receipt("tryon", hex("c"), { findings: MATCHES }), labels, photos).cases[0]!.label, "different");
  // Unmeasured fidelity keeps the receipt's reasons; no verifier entry leaves findings absent.
  const [u] = recordedRenders(receipt("unmeasured", PHOTO_A, { metrics: null }), labels, photos).cases;
  assert.deepEqual([u!.metrics, u!.unmeasuredReasons, "findings" in u!], [null, ["source mask is missing"], false]);
});

test("recordedRenders skips, with the reason, what it cannot label honestly: fixture jobs, mixed or unknown sources, no label, no fidelity entry", () => {
  const reasons = (lines: ReceiptLine[]) => recordedRenders(lines, labels, photos).skipped.map((s) => s.reason);
  assert.deepEqual(reasons(receipt("fx", PHOTO_A, { provenance: "fixture" })), ["fixture job: its fidelity entry was written, not measured"]);
  assert.deepEqual(reasons(receipt("mixed", PHOTO_A, { sources: [PHOTO_A, PHOTO_B] })), ["source photos belong to kurta-01 and kurta-02"]);
  assert.deepEqual(reasons(receipt("unknown", PHOTO_A, { sources: [hex("d")] })), ["source photos belong to no garment directory"]);
  assert.deepEqual(reasons(receipt("none", PHOTO_A, { sources: [] })), ["the job lists no source photos"]);
  assert.deepEqual(reasons(receipt("unlabelled", hex("e"))), ["no label for this render"]);
  assert.deepEqual(reasons(receipt("old", PHOTO_A, { noFidelity: true })), ["no fidelity entry: the job ran without the fidelity check"]);
});

test("scoreRecorded re-applies each candidate to the recorded values: false match and false refuse per threshold, unmeasured stays REVIEW", () => {
  const far = { delta_e: base.delta_e.refuse_above * 1.2, hist: 0.05, texture: 0.95, area: 1 };
  const cases = [
    ...recordedRenders(receipt("own", PHOTO_A, { findings: MATCHES }), labels, photos).cases,
    ...recordedRenders(receipt("mismatch", PHOTO_B, { findings: MATCHES, metrics: far, gate: "REFUSE" }), labels, photos).cases,
    ...recordedRenders(receipt("unmeasured", PHOTO_A, { findings: MATCHES, metrics: null, gate: "REVIEW" }), labels, photos).cases,
    ...recordedRenders(receipt("unverified", PHOTO_A, { metrics: OK, gate: "REFUSE" }), labels, photos).cases,
  ];
  const [x1, x10] = scoreRecorded(cases, scaledCandidates(base, [1, 10]));
  assert.deepEqual(x1!.cases.map((c) => [c.id, c.decision]), [["own-r0", "RELEASE"], ["mismatch-r0", "REFUSE"], ["unmeasured-r0", "REVIEW"], ["unverified-r0", "REFUSE"]]);
  assert.deepEqual(x1!.cases.map((c) => c.decision), cases.map((c) => c.recorded), "x1 reproduces every recorded gate decision");
  assert.deepEqual([x1!.false_match, x1!.false_refuse, x1!.unmeasured], [0, 1, 1], "no findings fails closed: a false refuse, never a pass");
  // Ten times as loose: the different render's delta_e is under every limit, and with all-match findings it releases.
  assert.equal(x10!.cases.find((c) => c.id === "mismatch-r0")!.decision, "RELEASE");
  assert.equal(x10!.false_match, 1);
  const [alone] = scoreRecorded(cases, scaledCandidates(base, [1]), { scope: "fidelity" });
  assert.equal(alone!.cases.find((c) => c.id === "unverified-r0")!.decision, "RELEASE", "fidelity alone ignores findings");
});

test("parseRenderLabels rejects anything it cannot read as a label", () => {
  assert.throws(() => parseRenderLabels({}), /need an object `renders`/);
  assert.throws(() => parseRenderLabels({ renders: { abc: { shows: "k", by: "b", why: "w" } } }), /not a sha256/);
  assert.throws(() => parseRenderLabels({ renders: { [PHOTO_A]: { by: "b", why: "w" } } }), /needs shows/);
  assert.throws(() => parseRenderLabels({ renders: { [PHOTO_A]: { shows: "k", by: " ", why: "w" } } }), /needs by/);
  assert.throws(() => parseRenderLabels({ renders: { [PHOTO_A]: { shows: "k", changed: "", by: "b", why: "w" } } }), /changed must say/);
  assert.deepEqual(parseRenderLabels({ renders: { [PHOTO_A]: { shows: "k", by: "b", why: "w" } } }).get(PHOTO_A), { shows: "k", by: "b", why: "w" });
});

test("wholeFrameMask covers every pixel, so the pairs score end to end; a case with no mask stays unmeasured", () => {
  const m = wholeFrameMask(grey);
  assert.deepEqual([m.width, m.height, m.data.length, m.data.every((v) => v === 1)], [W, H, W * H, true]);
  const [score] = scoreCalibration(
    [
      pair("whole", "same", grey, solid(128, 128, 128), { sourceMask: m, renderMask: wholeFrameMask(grey) }),
      pair("no-mask", "different", grey, solid(10, 200, 10), { renderMask: null }),
    ],
    scaledCandidates(loadThresholds(), [1]),
    FIDELITY,
  );
  assert.deepEqual(score!.cases.map((c) => [c.id, c.decision, c.measured]), [["whole", "RELEASE", true], ["no-mask", "REVIEW", false]]);
  assert.equal(score!.false_match, 0);
  assert.equal(score!.unmeasured, 1);
});
