// The release gate (SPEC §2): findings in, RELEASE / REVIEW / REFUSE out.
//
// Pure and deterministic. It reads only attribute, verdict and confidence, so no
// note or prompt text can move a decision, and anything it does not recognise
// fails closed. A fidelity result (SPEC §10), when given, can only make the
// decision worse, never better.

import { ATTRIBUTES, POLICY, RULES, isAttribute } from "./types.ts";
import type { Decision, DecisionInput, Rule, Verdict } from "./types.ts";

export interface GateReason {
  /** null for the fidelity reason, which is about no single attribute. */
  readonly attribute: string | null;
  /** null when the attribute has no finding (`not_verified`). */
  readonly verdict: Verdict | null;
  readonly confidence: number | null;
  readonly rule: Rule | "fidelity";
  readonly reason: string;
}

/** The part of a fidelity result the gate reads. */
export interface GateFidelity {
  readonly decision: Decision;
  readonly reasons: readonly string[];
}

export interface GateResult {
  readonly decision: Decision;
  /** The highest-priority firing rule, or null on RELEASE. */
  readonly cited: GateReason | null;
  /** Every firing rule, highest priority first, then in input order. */
  readonly reasons: readonly GateReason[];
}

const fmt = (n: number) => n.toFixed(2);
const RANK: Readonly<Record<Decision, number>> = { RELEASE: 0, REVIEW: 1, REFUSE: 2 };

/**
 * The verifier-based decision, made worse by fidelity when fidelity is worse.
 * Fidelity is cited only when it is what made the decision worse; otherwise its
 * reason (if not RELEASE) is listed last. A fidelity decision outside the three
 * is REFUSE.
 */
export function decide(findings: readonly DecisionInput[], fidelity?: GateFidelity): GateResult {
  const base = decideFindings(findings);
  if (fidelity === undefined) return base;
  const decision: Decision = fidelity.decision === "RELEASE" || fidelity.decision === "REVIEW" ? fidelity.decision : "REFUSE";
  if (decision === "RELEASE") return base;
  const list = Array.isArray(fidelity.reasons) ? fidelity.reasons.map(String) : [];
  const reason: GateReason = {
    attribute: null, verdict: null, confidence: null, rule: "fidelity",
    reason: `fidelity ${decision}: ${list.length > 0 ? list.join("; ") : "no reason given"}`,
  };
  if (RANK[decision] > RANK[base.decision]) return { decision, cited: reason, reasons: [reason, ...base.reasons] };
  return { ...base, reasons: [...base.reasons, reason] };
}

function decideFindings(findings: readonly DecisionInput[]): GateResult {
  const fired: (GateReason & { readonly rule: Rule })[] = [];
  const fire = (attribute: string, verdict: Verdict | null, confidence: number | null, rule: Rule, reason: string) =>
    fired.push({ attribute, verdict, confidence, rule, reason });

  // Anything that is not an array is no findings at all: every attribute is unverified.
  const list: readonly unknown[] = Array.isArray(findings) ? findings : [];
  const seen = new Set<string>();

  for (const raw of list) {
    const f = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof DecisionInput, unknown>>;
    const attribute = typeof f.attribute === "string" ? f.attribute : String(f.attribute);
    // NaN, Infinity or a non-number is no confidence at all, never certainty.
    const confidence = typeof f.confidence === "number" && Number.isFinite(f.confidence) ? f.confidence : 0;
    // A verdict outside the vocabulary is treated as uncertain: it can never release.
    const verdict: Verdict = f.verdict === "match" || f.verdict === "mismatch" ? f.verdict : "uncertain";

    if (seen.has(attribute)) {
      fire(attribute, verdict, confidence, "duplicate_attribute", `${attribute}: more than one finding`);
      continue;
    }
    seen.add(attribute);

    if (!isAttribute(attribute)) {
      fire(attribute, verdict, confidence, "unknown_attribute", `${attribute}: no policy for this attribute in this build`);
      continue;
    }

    const { severity, floor } = POLICY[attribute];
    if (confidence < floor) {
      fire(attribute, verdict, confidence, "low_confidence", `${attribute}: ${verdict} at ${fmt(confidence)}, below the ${fmt(floor)} floor`);
    } else if (verdict === "mismatch") {
      const rule = severity === "hard" ? "hard_mismatch" : "soft_mismatch";
      fire(attribute, verdict, confidence, rule, `${attribute}: mismatch at ${fmt(confidence)} on a ${severity} attribute`);
    } else if (verdict === "uncertain") {
      fire(attribute, verdict, confidence, "uncertain", `${attribute}: the verifier could not tell`);
    }
  }

  for (const attribute of ATTRIBUTES) {
    if (!seen.has(attribute)) fire(attribute, null, null, "not_verified", `${attribute}: no finding, so not verified`);
  }

  // Array.prototype.sort is stable, so equal priorities keep input order.
  const reasons = fired.sort((a, b) => RULES[b.rule].priority - RULES[a.rule].priority);
  const cited = reasons[0] ?? null;
  return { decision: cited ? RULES[cited.rule].decision : "RELEASE", cited, reasons };
}
