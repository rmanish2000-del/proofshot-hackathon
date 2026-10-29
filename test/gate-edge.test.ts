// Gate edge cases (Grok 18:05 #23 item 3): empty findings, a verifier timeout,
// and mixed REVIEW/REFUSE. Tests only; they pin the behaviour the gate has.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decide } from "../src/gate.ts";
import type { GateFidelity } from "../src/gate.ts";
import { runJob } from "../src/pipeline.ts";
import { parseReceipt } from "../src/receipt.ts";
import { standInRenderer } from "../src/render.ts";
import { ATTRIBUTES, RULES } from "../src/types.ts";
import type { DecisionInput } from "../src/types.ts";
import { VerifierTransportError } from "../src/verifier.ts";

function findings(overrides: Record<string, Partial<DecisionInput>> = {}): DecisionInput[] {
  return ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match" as const, confidence: 0.95, ...overrides[attribute] }));
}

const fid = (decision: GateFidelity["decision"]): GateFidelity => ({ decision, reasons: [`area ${decision}`] });

test("empty findings refuse as not_verified whatever fidelity says; fidelity is never cited over them", () => {
  for (const decision of ["RELEASE", "REVIEW", "REFUSE"] as const) {
    const r = decide([], fid(decision));
    assert.equal(r.decision, "REFUSE", decision);
    assert.equal(r.cited?.rule, "not_verified", decision);
    assert.equal(r.reasons.filter((x) => x.rule === "not_verified").length, ATTRIBUTES.length, decision);
    // A fidelity REVIEW or REFUSE is still listed, last; a fidelity RELEASE adds nothing.
    assert.equal(r.reasons.at(-1)!.rule, decision === "RELEASE" ? "not_verified" : "fidelity", decision);
  }
});

test("a findings wrapper object, or entries with no attribute, leave every attribute not_verified", () => {
  for (const input of [{ findings: [] }, { findings: undefined }, [undefined], [{}]]) {
    const r = decide(input as unknown as DecisionInput[]);
    assert.equal(r.decision, "REFUSE", JSON.stringify(input));
    for (const attribute of ATTRIBUTES) {
      assert.ok(r.reasons.some((x) => x.attribute === attribute && x.rule === "not_verified"), `${JSON.stringify(input)} ${attribute}`);
    }
  }
});

test("mixed: any REFUSE rule beats any REVIEW rule in either input order, and the REVIEW reason is still listed", () => {
  const review: Record<string, Record<string, Partial<DecisionInput>>> = {
    low_confidence: { buttons: { confidence: 0.1 } },
    soft_mismatch: { hem: { verdict: "mismatch", confidence: 0.9 } },
    uncertain: { pocket_count: { verdict: "uncertain", confidence: 0.9 } },
  };
  const refuse: Record<string, (base: DecisionInput[]) => DecisionInput[]> = {
    hard_mismatch: (b) => b.map((f) => (f.attribute === "color" ? { ...f, verdict: "mismatch" as const } : f)),
    not_verified: (b) => b.filter((f) => f.attribute !== "collar"),
    unknown_attribute: (b) => [...b, { attribute: "sleeve", verdict: "match", confidence: 1 }],
    duplicate_attribute: (b) => [...b, { attribute: "logo_text", verdict: "match", confidence: 1 }],
  };
  for (const [rv, over] of Object.entries(review)) {
    for (const [rf, apply] of Object.entries(refuse)) {
      const input = apply(findings(over));
      for (const order of [input, [...input].reverse()]) {
        const r = decide(order);
        assert.equal(r.decision, "REFUSE", `${rv} + ${rf}`);
        assert.equal(r.cited?.rule, rf, `${rv} + ${rf}`);
        assert.ok(r.reasons.some((x) => x.rule === rv), `${rv} listed beside ${rf}`);
        // Reasons are sorted by priority, highest first.
        const p = r.reasons.map((x) => RULES[x.rule as keyof typeof RULES].priority);
        assert.deepEqual(p, [...p].sort((a, b) => b - a), `${rv} + ${rf}`);
      }
    }
  }
});

test("mixed: only REVIEW rules give REVIEW, never REFUSE, and equal priorities keep input order", () => {
  const r = decide(findings({
    pocket_count: { verdict: "uncertain", confidence: 0.9 },
    hem: { verdict: "mismatch", confidence: 0.9 },
    buttons: { confidence: 0.1 },
  }));
  assert.equal(r.decision, "REVIEW");
  assert.deepEqual(r.reasons.map((x) => [x.rule, x.attribute]), [
    ["low_confidence", "buttons"],
    ["soft_mismatch", "hem"],
    ["uncertain", "pocket_count"],
  ]);
});

test("mixed with fidelity: findings REVIEW + fidelity REFUSE refuses on fidelity; findings REFUSE + fidelity REVIEW keeps the finding cited", () => {
  const soft = findings({ hem: { verdict: "mismatch", confidence: 0.9 } });
  const a = decide(soft, fid("REFUSE"));
  assert.deepEqual([a.decision, a.cited?.rule, a.reasons.map((x) => x.rule)], ["REFUSE", "fidelity", ["fidelity", "soft_mismatch"]]);

  const hard = findings({ color: { verdict: "mismatch", confidence: 0.9 } });
  const b = decide(hard, fid("REVIEW"));
  assert.deepEqual([b.decision, b.cited?.rule, b.reasons.map((x) => x.rule)], ["REFUSE", "hard_mismatch", ["hard_mismatch", "fidelity"]]);

  // Both REFUSE: the verifier's reason stays cited, fidelity is listed last.
  const c = decide(hard, fid("REFUSE"));
  assert.deepEqual([c.decision, c.cited?.rule, c.reasons.at(-1)?.rule], ["REFUSE", "hard_mismatch", "fidelity"]);
});

test("a verifier timeout on one render refuses that render only: the other is judged on its own findings, one release entry", async () => {
  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const sources = [{ name: "1-front.jpg", bytes: JPEG }];
  let calls = 0;
  const providers = {
    segmenter: { segment: async () => [] },
    renderer: standInRenderer(),
    verifier: {
      identity: { provider: "fixture", model: "fixture-verifier", base: "fixture" },
      verify: async () => {
        calls += 1;
        if (calls === 1) throw new VerifierTransportError("TimeoutError: The operation was aborted due to timeout", true);
        return { raw: { findings: findings().map((f) => ({ ...f, note: "same", evidence: { source_bbox: null, render_bbox: null } })) } };
      },
    },
    fidelity: { check: async () => ({ decision: "RELEASE" as const, metrics: null, reasons: [] }) },
  };
  const out = mkdtempSync(join(tmpdir(), "gate-edge-"));
  const r = await runJob({ jobId: "edge-timeout", garmentNote: "kurta", scenes: ["studio", "street"], sources }, { outRoot: out, providers, provenance: "fixture" });
  assert.equal(calls, 2);
  assert.deepEqual(r.renders.map((x) => [x.render_id, x.decision, x.cited?.rule ?? null]), [
    ["edge-timeout-r0", "REFUSE", "not_verified"],
    ["edge-timeout-r1", "RELEASE", null],
  ]);
  const entries = parseReceipt(readFileSync(join(r.dir, "receipt.jsonl"), "utf8"));
  const verifier = entries.filter((e) => e.kind === "verifier").map((e) => e.payload as { render_id: string; findings: unknown[]; error?: string });
  assert.deepEqual(verifier[0]!.findings, []);
  assert.match(verifier[0]!.error!, /TimeoutError/);
  assert.equal(verifier[1]!.error, undefined);
  const releases = entries.filter((e) => e.kind === "release").map((e) => (e.payload as { render_id: string }).render_id);
  assert.deepEqual(releases, ["edge-timeout-r1"]);
});
