// Evidence Recovery Agent: the deterministic, rule-based policy (the default; keyless and offline). Given what
// this step has learned so far, it proposes the next action, or null to end the step. A model-backed proposer
// can stand in for it, but every proposal still goes through validateAction: the policy is advice, the
// allowlist is the law. Nothing in a photo, a filename or a model answer reaches this function: it sees the job
// record (structured fields) and tool results only.

import type { Outcome, ReplaceTrigger } from "./reasons.ts";
import { MAX_REPLACES_PER_JOB } from "./schema.ts";
import type { QualityReport } from "./quality.ts";
import type { JobRecord } from "./store.ts";
import { VIEW_INSTRUCTIONS } from "./vocab.ts";
import type { View } from "./vocab.ts";

export interface StepState {
  readonly record: JobRecord;
  /** The latest gate outcome read in this step (read_receipt), or undefined before the first read. */
  outcome?: Outcome;
  /** What the same receipt shows about photo 1 (replaceTrigger), read with the outcome; null when nothing. */
  replace?: ReplaceTrigger | null;
  replaceRequested?: boolean;
  missingViews?: readonly View[];
  quality: Record<string, QualityReport>;
  requested?: View;
  rerun?: { readonly decision: string; readonly mode: "offline" | "live" };
  explained?: boolean;
}

export type Proposer = (state: StepState) => unknown | null;

/** The photo the seller added for the open request, if any. */
export function answerToRequest(record: JobRecord): string | null {
  if (!record.request) return null;
  const photo = [...record.photos].reverse().find((p) => p.view === record.request!.view);
  return photo ? photo.file : null;
}

const req = (view: View) => ({ tool: "request_seller_photo", args: { view, instructions: VIEW_INSTRUCTIONS[view].en } });

export const rulePolicy: Proposer = (s) => {
  const r = s.record;
  // A request or an explanation ends the step: the next step starts only after the seller acts.
  if (s.requested || s.explained || s.replaceRequested) return null;
  const answered = answerToRequest(r);
  const replaces = r.replaced ?? [];
  const fresh = replaces.at(-1);
  const liveApproval = r.approvals.find((a) => a.what === "paid_rerun" && !a.used);

  // The seller answered a request: check the new photo, re-run the same gate offline, read it, explain it.
  if (answered && !s.rerun && !s.requested) {
    const q = s.quality[answered];
    if (!q) return { tool: "check_photo_quality", args: { photo: answered } };
    if (q.issues.length > 0) return req(r.request!.view);
    return { tool: "rerun_gate", args: { listing: r.job, mode: "offline" } };
  }
  // The seller replaced photo 1: check the new photo, then run the gate again from the start (offline first).
  if (fresh && fresh.runs.length === 0 && !s.rerun) {
    const q = s.quality[fresh.new.file];
    if (!q) return { tool: "check_photo_quality", args: { photo: fresh.new.file } };
    if (q.issues.length === 0) return { tool: "rerun_gate", args: { listing: r.job, mode: "offline" } };
  }
  // The seller approved a paid re-check: run it once.
  if (liveApproval && !s.rerun) return { tool: "rerun_gate", args: { listing: r.job, mode: "live" } };

  // The runner clears the outcome after a re-run, so the fresh receipt is read before anything else.
  if (s.outcome === undefined) return { tool: "read_receipt", args: {} };
  const o = s.outcome;

  // The fidelity check measures against photo 1 only; when the receipt shows photo 1 is the problem, ask the
  // seller to replace it (once per job). This comes before the violation rule: added photos cannot fix it.
  if (s.replace && o.class !== "release" && replaces.length < MAX_REPLACES_PER_JOB && r.photos[0]?.file === s.replace.photo) {
    return { tool: "request_replace_primary", args: { listing: r.job, photo: s.replace.photo, problems: [...s.replace.problems] } };
  }

  if (o.class === "missing_evidence") {
    if (s.missingViews === undefined) return { tool: "detect_missing_view", args: {} };
    if (s.missingViews.length > 0) return req(s.missingViews[0]!);
    // Every needed view is there: check those photos; a bad one is asked for again, else only a paid re-check can help.
    for (const view of o.views) {
      const photo = r.photos.find((p) => p.view === view);
      if (photo && !s.quality[photo.file]) return { tool: "check_photo_quality", args: { photo: photo.file } };
      if (photo && s.quality[photo.file]!.issues.length > 0) return req(view);
    }
  }
  return { tool: "explain", args: { reason_code: o.code } };
};
