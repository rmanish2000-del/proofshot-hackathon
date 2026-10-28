// Calibration scorer (R4, Grok 28 Oct 09:55): how often the fidelity check and
// the gate get a labelled pair wrong, for each candidate set of thresholds.
//
// A case is one source photo and one candidate render with their masks, and a
// label: `same` (the render shows the source's garment) or `different` (another
// garment). For each candidate thresholds set every case is checked with
// checkFidelity, and, when the case carries verifier findings, the gate's
// decide() on top. A `different` case that comes out RELEASE is a false match;
// a `same` case that comes out REFUSE is a false refuse. REVIEW is neither and is
// counted on its own, as is a case fidelity could not measure (metrics null).
// Nothing here reads files or calls a model.

import { checkFidelity } from "./fidelity.ts";
import type { Thresholds } from "./fidelity.ts";
import { decide } from "./gate.ts";
import type { Mask, RgbImage } from "./png.ts";
import type { Decision, DecisionInput } from "./types.ts";

export type CalibrationLabel = "same" | "different";

export interface CalibrationCase {
  readonly id: string;
  readonly label: CalibrationLabel;
  readonly source: RgbImage;
  readonly render: RgbImage;
  readonly sourceMask: Mask | null | undefined;
  readonly renderMask: Mask | null | undefined;
  /** The verifier's findings for this pair; absent scores fidelity alone. */
  readonly findings?: readonly DecisionInput[];
}

export interface Candidate {
  readonly name: string;
  readonly thresholds: Thresholds;
}

export interface CaseResult {
  readonly id: string;
  readonly label: CalibrationLabel;
  readonly fidelity: Decision;
  /** The gate's decision when the case has findings, else the fidelity decision. */
  readonly decision: Decision;
  readonly measured: boolean;
}

export interface CandidateScore {
  readonly name: string;
  readonly same: number;
  readonly different: number;
  /** `different` cases released. */
  readonly false_match: number;
  /** `same` cases refused. */
  readonly false_refuse: number;
  readonly review_same: number;
  readonly review_different: number;
  readonly unmeasured: number;
  readonly cases: readonly CaseResult[];
}

export function scoreCalibration(cases: readonly CalibrationCase[], candidates: readonly Candidate[]): CandidateScore[] {
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`calibration: case id ${JSON.stringify(c.id)} appears twice`);
    ids.add(c.id);
    if (c.label !== "same" && c.label !== "different") throw new Error(`calibration: case ${c.id} has label ${JSON.stringify(c.label)}, not same or different`);
  }
  return candidates.map(({ name, thresholds }) => {
    const results = cases.map((c): CaseResult => {
      const fid = checkFidelity(c, thresholds);
      const decision = c.findings ? decide(c.findings, { decision: fid.decision, reasons: fid.reasons }).decision : fid.decision;
      return { id: c.id, label: c.label, fidelity: fid.decision, decision, measured: fid.metrics !== null };
    });
    const count = (label: CalibrationLabel, decision: Decision) => results.filter((r) => r.label === label && r.decision === decision).length;
    return {
      name,
      same: results.filter((r) => r.label === "same").length,
      different: results.filter((r) => r.label === "different").length,
      false_match: count("different", "RELEASE"),
      false_refuse: count("same", "REFUSE"),
      review_same: count("same", "REVIEW"),
      review_different: count("different", "REVIEW"),
      unmeasured: results.filter((r) => !r.measured).length,
      cases: results,
    };
  });
}

/**
 * Candidates around a base set: factor f multiplies the delta_e and hist
 * limits and divides the texture limits (capped at 1), so f > 1 is looser and
 * f < 1 stricter on all three. Area bounds stay as they are. Each factor must
 * be a positive finite number; the name is `x<f>`.
 */
export function scaledCandidates(base: Thresholds, factors: readonly number[]): Candidate[] {
  return factors.map((f) => {
    if (!(Number.isFinite(f) && f > 0)) throw new Error(`calibration: scale factor ${f} must be a positive finite number`);
    const tex = (v: number) => Math.min(1, v / f);
    return {
      name: `x${f}`,
      thresholds: {
        delta_e: { review_above: base.delta_e.review_above * f, refuse_above: base.delta_e.refuse_above * f },
        hist: { review_above: base.hist.review_above * f, refuse_above: base.hist.refuse_above * f },
        texture: { review_below: tex(base.texture.review_below), refuse_below: tex(base.texture.refuse_below) },
        area: base.area,
      },
    };
  });
}
