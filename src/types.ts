// The attribute vocabulary and the gate's rule table (SPEC §1, §2).
//
// Each attribute is one thing a render can get wrong about the garment. Its
// severity says what a mismatch costs; its floor is the confidence below which
// no verdict, a match included, is trusted.

export type Decision = "RELEASE" | "REVIEW" | "REFUSE";
export type Verdict = "match" | "mismatch" | "uncertain";
export type Severity = "hard" | "soft";

export const VERDICTS: readonly Verdict[] = Object.freeze(["match", "mismatch", "uncertain"]);

export interface AttributePolicy {
  readonly severity: Severity;
  readonly floor: number;
}

const policy = <T extends Record<string, AttributePolicy>>(table: T): Readonly<T> =>
  Object.freeze(Object.fromEntries(Object.entries(table).map(([name, p]) => [name, Object.freeze({ ...p })])) as T);

export const POLICY = policy({
  color: { severity: "hard", floor: 0.7 },
  print_pattern: { severity: "hard", floor: 0.7 },
  logo_text: { severity: "hard", floor: 0.85 },
  collar: { severity: "hard", floor: 0.8 },
  sleeve_length: { severity: "soft", floor: 0.6 },
  hem: { severity: "soft", floor: 0.6 },
  pocket_count: { severity: "soft", floor: 0.6 },
  buttons: { severity: "soft", floor: 0.7 },
  fabric_texture: { severity: "soft", floor: 0.65 },
});

export type Attribute = keyof typeof POLICY;
export const ATTRIBUTES: readonly Attribute[] = Object.freeze(Object.keys(POLICY) as Attribute[]);

/** True only for an attribute this build has a policy for (never an inherited key). */
export function isAttribute(name: unknown): name is Attribute {
  return typeof name === "string" && Object.hasOwn(POLICY, name);
}

/**
 * The gate's whole input, one per finding. `attribute` is a plain string because
 * an attribute with no policy must still reach the gate, to be refused there.
 * There is no note or prompt field: model prose cannot reach a decision.
 */
export interface DecisionInput {
  readonly attribute: string;
  readonly verdict: Verdict;
  readonly confidence: number;
}

export type Rule =
  | "duplicate_attribute"
  | "unknown_attribute"
  | "hard_mismatch"
  | "not_verified"
  | "low_confidence"
  | "soft_mismatch"
  | "uncertain";

/** Priority (higher wins the cited reason) and decision for each rule, SPEC §2. */
export const RULES: Readonly<Record<Rule, { readonly priority: number; readonly decision: Decision }>> = Object.freeze({
  duplicate_attribute: Object.freeze({ priority: 6, decision: "REFUSE" }),
  unknown_attribute: Object.freeze({ priority: 5, decision: "REFUSE" }),
  hard_mismatch: Object.freeze({ priority: 4, decision: "REFUSE" }),
  not_verified: Object.freeze({ priority: 3, decision: "REFUSE" }),
  low_confidence: Object.freeze({ priority: 2, decision: "REVIEW" }),
  soft_mismatch: Object.freeze({ priority: 1, decision: "REVIEW" }),
  uncertain: Object.freeze({ priority: 1, decision: "REVIEW" }),
});
