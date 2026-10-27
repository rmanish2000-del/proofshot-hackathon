// The release gate (SPEC §2): findings in, RELEASE / REVIEW / REFUSE out.
//
// Pure and deterministic. It reads only attribute, verdict and confidence, so no
// note or prompt text can move a decision, and anything it does not recognise
// fails closed.

import { ATTRIBUTES, POLICY, RULES, isAttribute } from "./types.ts";
import type { Decision, DecisionInput, Rule, Verdict } from "./types.ts";

export interface GateReason {
  readonly attribute: string;
  /** null when the attribute has no finding (`not_verified`). */
  readonly verdict: Verdict | null;
  readonly confidence: number | null;
  readonly rule: Rule;
  readonly reason: string;
}

export interface GateResult {
  readonly decision: Decision;
  /** The highest-priority firing rule, or null on RELEASE. */
  readonly cited: GateReason | null;
  /** Every firing rule, highest priority first, then in input order. */
  readonly reasons: readonly GateReason[];
}

const fmt = (n: number) => n.toFixed(2);

export function decide(findings: readonly DecisionInput[]): GateResult {
  const fired: GateReason[] = [];
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
