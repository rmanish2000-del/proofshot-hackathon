// The gate side of the evidence-checking agent: rerun_gate's only implementation. It is outside src/agent/ on
// purpose: the agent holds a GateRunner function and nothing else; this file turns a re-run request into an
// ordinary runJob call, so the same pipeline and the same deterministic gate (decide) write the same receipt as
// any job would. The agent cannot pass a verdict, a threshold or findings in: only photos, labels and a mode.
//
// cannedDemoProviders is the keyless demo's verifier: labelled fixture, "no model judged the image". It answers
// "uncertain" for an attribute when no photo the seller labelled with the view that shows it was supplied, and
// "match" otherwise. That is a stand-in for what a verifier does without the right view, used only to show the
// agent's mechanics offline; it is not a model result and claims no accuracy.

import { runJob } from "./pipeline.ts";
import type { Providers } from "./pipeline.ts";
import type { Clock } from "./receipt.ts";
import { selfComparisonReview } from "./tryon.ts";
import type { GateRunInput, GateRunner } from "./agent/runner.ts";
import { VIEW_FOR_ATTRIBUTE } from "./agent/vocab.ts";
import { ATTRIBUTES } from "./types.ts";

export type ProvidersFor = (input: GateRunInput) => Providers;

export const CANNED_VERIFIER_MODEL = "canned-demo-verifier (no model judged the image)";

export function cannedDemoProviders(input: GateRunInput): Providers {
  const present = new Set(Object.values(input.views));
  const findings = ATTRIBUTES.map((attribute) =>
    present.has(VIEW_FOR_ATTRIBUTE[attribute]!)
      ? { attribute, verdict: "match", confidence: 0.92, note: "canned demo: the photo for this detail was supplied" }
      : { attribute, verdict: "uncertain", confidence: 0.5, note: "canned demo: no photo shows this detail" });
  return {
    segmenter: { segment: async () => [] },
    renderer: { provider: "fixture", model: "fixture-render", render: async () => ({ bytes: input.candidate, ext: "jpg" }) },
    verifier: { identity: { provider: "fixture", model: CANNED_VERIFIER_MODEL, base: "fixture" }, verify: async () => ({ raw: { findings } }) },
    // The fixture fidelity check measures nothing (SPEC §10, README "Judge quickstart"): RELEASE with no metrics.
    fidelity: { check: async () => ({ decision: "RELEASE", metrics: null, reasons: [] }) },
  };
}

/**
 * A GateRunner over runJob. `offline` builds the providers for a keyless run; `live`, when given, builds
 * providers that call models (the agent reaches it only after the seller approved the cost). Without `live`,
 * a live re-run is refused.
 */
export function pipelineGate(opts: { readonly offline: ProvidersFor; readonly live?: ProvidersFor; readonly clock?: Clock }): GateRunner {
  return async (input) => {
    const providersFor = input.mode === "live" ? opts.live : opts.offline;
    if (!providersFor) throw new Error("no live gate configured: a live re-run is not available here");
    // The seller supplies both the photos and the image to publish here, so a photo equal to that image is never a
    // fidelity pass (src/tryon.ts selfComparisonReview, SC1).
    const providers = providersFor(input);
    const result = await runJob(
      { jobId: input.runId, garmentNote: input.garmentNote, scenes: ["studio"], sources: input.sources },
      { outRoot: input.outRoot, providers: { ...providers, fidelity: selfComparisonReview(providers.fidelity) }, provenance: input.mode === "live" ? "live" : "fixture", clock: opts.clock },
    );
    const decision = result.refused ? "REFUSE" : (result.renders[0]?.decision ?? "REFUSE");
    return { decision, head: result.head };
  };
}
