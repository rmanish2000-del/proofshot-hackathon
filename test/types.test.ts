import assert from "node:assert/strict";
import { test } from "node:test";

import { ATTRIBUTES, POLICY, RULES, VERDICTS, isAttribute } from "../src/types.ts";

test("the nine attributes carry the severities and floors of SPEC §1", () => {
  assert.deepEqual(
    ATTRIBUTES.map((name) => [name, POLICY[name].severity, POLICY[name].floor]),
    [
      ["color", "hard", 0.7],
      ["print_pattern", "hard", 0.7],
      ["logo_text", "hard", 0.85],
      ["collar", "hard", 0.8],
      ["sleeve_length", "soft", 0.6],
      ["hem", "soft", 0.6],
      ["pocket_count", "soft", 0.6],
      ["buttons", "soft", 0.7],
      ["fabric_texture", "soft", 0.65],
    ],
  );
});

test("only own policy keys are attributes: unknown names and inherited keys are not", () => {
  for (const name of ATTRIBUTES) assert.ok(isAttribute(name), name);
  for (const name of ["sleeve", "Color", "", "toString", "__proto__", "constructor", 3, null, undefined]) {
    assert.equal(isAttribute(name), false, String(name));
  }
});

test("the policy cannot be changed at runtime", () => {
  assert.throws(() => {
    (POLICY.color as { floor: number }).floor = 0;
  }, TypeError);
  assert.throws(() => {
    (POLICY as Record<string, unknown>).new_attribute = { severity: "soft", floor: 0 };
  }, TypeError);
  assert.equal(POLICY.color.floor, 0.7);
  assert.ok(Object.isFrozen(ATTRIBUTES) && Object.isFrozen(VERDICTS) && Object.isFrozen(RULES));
});

test("the rule table matches SPEC §2: refusals outrank reviews", () => {
  assert.deepEqual(VERDICTS, ["match", "mismatch", "uncertain"]);
  const table = Object.entries(RULES).map(([rule, r]) => [rule, r.priority, r.decision]);
  assert.deepEqual(table, [
    ["duplicate_attribute", 6, "REFUSE"],
    ["unknown_attribute", 5, "REFUSE"],
    ["hard_mismatch", 4, "REFUSE"],
    ["not_verified", 3, "REFUSE"],
    ["low_confidence", 2, "REVIEW"],
    ["soft_mismatch", 1, "REVIEW"],
    ["uncertain", 1, "REVIEW"],
  ]);
  const lowestRefuse = Math.min(...Object.values(RULES).filter((r) => r.decision === "REFUSE").map((r) => r.priority));
  const highestReview = Math.max(...Object.values(RULES).filter((r) => r.decision === "REVIEW").map((r) => r.priority));
  assert.ok(lowestRefuse > highestReview);
});
