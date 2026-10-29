import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { RenderLabel } from "../src/calibrate.ts";
import { expectedFor, planMs4, recordedDecisions, scoreMs4 } from "../src/ms4.ts";
import type { Ms4Run } from "../src/ms4.ts";
import { ATTRIBUTES } from "../src/types.ts";

const sha = (c: string) => c.repeat(64);
const allMatch = ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match" as const, confidence: 0.9 }));
const withMismatch = (attribute: string, confidence = 0.95) => allMatch.map((f) => (f.attribute === attribute ? { ...f, verdict: "mismatch" as const, confidence } : f));

/** Two photographed garments (a, b), one unphotographed (c), and jobs whose renders are a's photo, b's photo, an a try-on and an unlabelled image. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ps-ms4-"));
  const garments = join(root, "garments");
  const jobs = join(root, "jobs");
  for (const [g, s] of [["a", "1"], ["b", "2"]] as const) {
    mkdirSync(join(garments, g), { recursive: true });
    writeFileSync(join(garments, g, "front.jpg"), "x");
    writeFileSync(join(garments, g, "intake.json"), JSON.stringify({ garment: g, files: [{ name: "front.jpg", sha256: sha(s) }] }));
  }
  mkdirSync(join(garments, "c"), { recursive: true });
  const job = (id: string, source: string, render: string, gate: string, provenance = "live", fidelity: unknown = { decision: "RELEASE", reasons: [] }) => {
    mkdirSync(join(jobs, id), { recursive: true });
    writeFileSync(join(jobs, id, `${id}-r0.jpg`), "r");
    const lines = [
      { kind: "job", payload: { job_id: id, provenance, source_images: [{ name: "front.jpg", sha256: source }] } },
      { kind: "render", payload: { render_id: `${id}-r0`, sha256: render } },
      ...(fidelity ? [{ kind: "fidelity", payload: { render_id: `${id}-r0`, ...(fidelity as object) } }] : []),
      { kind: "gate", payload: { render_id: `${id}-r0`, decision: gate } },
    ];
    writeFileSync(join(jobs, id, "receipt.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  };
  job("a-own", sha("1"), sha("1"), "RELEASE");
  job("a-again", sha("1"), sha("1"), "RELEASE"); // same render bytes: one render, two jobs
  job("a-tryon", sha("1"), sha("3"), "REVIEW", "live", { decision: "REVIEW", reasons: ["area 0.2 below 0.4"] });
  job("b-own", sha("2"), sha("2"), "RELEASE", "fixture");
  job("odd", sha("1"), sha("9"), "REFUSE");
  mkdirSync(join(jobs, "upload-x"), { recursive: true });
  const labels = new Map<string, RenderLabel>([
    [sha("1"), { shows: "a", by: "t", why: "a's photo" }],
    [sha("2"), { shows: "b", by: "t", why: "b's photo" }],
    [sha("3"), { shows: "a", changed: "length", by: "t", why: "try-on" }],
  ]);
  return { garments, jobs, labels };
}

test("MS4 1: the matrix pairs every photographed garment with every distinct labelled render, its own and the other garment's", () => {
  const { garments, jobs, labels } = fixture();
  const plan = planMs4(jobs, garments, labels);
  assert.deepEqual(plan.garments, ["a", "b"], "c has no photos");
  assert.equal(plan.renders.length, 3, "sha 1 is stored twice but is one render; sha 9 has no label");
  assert.deepEqual(plan.renders.find((r) => r.render_sha256 === sha("1"))!.jobs, ["a-again", "a-own"]);
  assert.match(plan.skipped.map((s) => s.what).join(" "), /render 999999999999/);
  assert.equal(plan.pairs.length, 6);
  const exp = Object.fromEntries(plan.pairs.map((p) => [p.id, p.expected]));
  assert.deepEqual(exp, {
    "a~111111111111": "same", "a~222222222222": "other_garment", "a~333333333333": "changed",
    "b~111111111111": "other_garment", "b~222222222222": "same", "b~333333333333": "other_garment",
  });
  assert.equal(expectedFor("b", { shows: "a", changed: "length", by: "t", why: "w" }), "other_garment", "another garment's try-on is a wrong pair, not a changed one");
});

test("MS4 2: the score: right = RELEASE on same, not RELEASE otherwise; mismatch catch, consistency over repeats, and failed calls kept apart", () => {
  const { garments, jobs, labels } = fixture();
  const { pairs } = planMs4(jobs, garments, labels);
  const run = (pair_id: string, rep: number, findings: Ms4Run["findings"] | null): Ms4Run =>
    findings ? { pair_id, rep, started_at: `t${rep}`, ok: true, findings } : { pair_id, rep, started_at: `t${rep}`, ok: false, error: "VerifierTransportError: HTTP 500" };
  const runs: Ms4Run[] = [
    ...[1, 2, 3].map((r) => run("a~111111111111", r, allMatch)),
    run("a~222222222222", 1, withMismatch("color")), run("a~222222222222", 2, withMismatch("color")), run("a~222222222222", 3, allMatch), // missed once
    run("a~333333333333", 1, withMismatch("hem")), run("a~333333333333", 2, null), run("a~333333333333", 3, withMismatch("hem")),
    ...[1, 2, 3].map((r) => run("b~111111111111", r, withMismatch("color"))),
  ];
  const s = scoreMs4(pairs, runs, []);
  assert.equal(s.runs, 12);
  assert.equal(s.failed, 1);
  assert.deepEqual(s.by_expected.same, { pairs: 2, answered: 3, correct: 3, correct_rate: 1, refused: 0 });
  assert.deepEqual(s.by_expected.changed, { pairs: 1, answered: 2, correct: 2, correct_rate: 1, refused: 0 }, "a soft hem mismatch is REVIEW: caught, not refused");
  assert.deepEqual(s.mismatch_catch, { answered: 6, caught: 5, rate: 0.833, refused: 5 });
  const a2 = s.pair_scores.find((p) => p.id === "a~222222222222")!;
  assert.deepEqual(a2.decisions, ["REFUSE", "REFUSE", "RELEASE"]);
  assert.equal(a2.consistent, false);
  assert.equal(a2.verdict_agreement, 0.889, "8 of 9 attributes the same in all three");
  assert.equal(s.pair_scores.find((p) => p.id === "b~222222222222")!.consistent, null, "no answers, no consistency");
  assert.deepEqual(s.consistency, { pairs_scored: 4, same_decision_all_reps: 3, rate: 0.75, mean_verdict_agreement: 0.972 });
});

test("MS4 3: gate agreement re-makes each recorded decision from Muse Spark's findings plus the job's recorded fidelity; fixture jobs are left out", () => {
  const { garments, jobs, labels } = fixture();
  const { pairs } = planMs4(jobs, garments, labels);
  const photos = new Map([[sha("1"), "a"], [sha("2"), "b"]]);
  const recorded = recordedDecisions(jobs, photos);
  assert.deepEqual(recorded.map((r) => r.job_id).sort(), ["a-again", "a-own", "a-tryon", "odd"], "b-own is a fixture job");
  const runs: Ms4Run[] = [
    { pair_id: "a~111111111111", rep: 1, started_at: "t", ok: true, findings: allMatch },
    { pair_id: "a~333333333333", rep: 1, started_at: "t", ok: true, findings: allMatch },
  ];
  const s = scoreMs4(pairs, runs, recorded);
  // a-own and a-again: RELEASE = RELEASE. a-tryon: all match, but its recorded fidelity is REVIEW, so REVIEW = REVIEW. odd: no pair.
  assert.deepEqual(s.gate_agreement, { compared: 3, agree: 3, rate: 1, disagreements: [] });
  const missed = scoreMs4(pairs, [{ pair_id: "a~111111111111", rep: 2, started_at: "t", ok: true, findings: withMismatch("color") }], recorded);
  assert.equal(missed.gate_agreement.agree, 0);
  assert.deepEqual(missed.gate_agreement.disagreements.map((d) => [d.job_id, d.recorded, d.ms4, d.rep]), [["a-again", "RELEASE", "REFUSE", 2], ["a-own", "RELEASE", "REFUSE", 2]]);
});
