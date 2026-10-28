// PS-1: independent review tests for b20c36a..f77b05b (DeepSeek lane).
//
// Scope is edge cases the existing suites do not pin, in the direction that
// matters: the ways a calibration run can look better than it is, and the ways a
// fidelity REFUSE could be talked out of a decision by a verifier that says
// "match".
//
// These are additive. No product behaviour is changed by this file.

import assert from "node:assert/strict";
import { test } from "node:test";

import { scaledCandidates, scoreCalibration, type Candidate } from "../src/calibrate.ts";
import { checkFidelity, DEFAULT_THRESHOLDS_PATH, loadThresholds } from "../src/fidelity.ts";
import type { Mask, RgbImage } from "../src/png.ts";
import { ATTRIBUTES } from "../src/types.ts";
import type { DecisionInput } from "../src/types.ts";

const thresholds = loadThresholds(DEFAULT_THRESHOLDS_PATH);

function rgb(width: number, height: number, colour: readonly [number, number, number]): RgbImage {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 3] = colour[0];
    data[i * 3 + 1] = colour[1];
    data[i * 3 + 2] = colour[2];
  }
  return { width, height, data };
}

function fullMask(image: RgbImage): Mask {
  return { width: image.width, height: image.height, data: new Uint8Array(image.width * image.height).fill(255) };
}

/** Every attribute matches at high confidence: the verifier's most permissive answer. */
function allMatch(): DecisionInput[] {
  return ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match" as const, confidence: 0.99 }));
}

const config: Candidate[] = [{ name: "config", thresholds }];

test("an empty case set scores zeros rather than throwing or inventing a rate", () => {
  const [score] = scoreCalibration([], config);
  assert.ok(score);
  assert.equal(score.same, 0);
  assert.equal(score.different, 0);
  assert.equal(score.false_match, 0);
  assert.equal(score.false_refuse, 0);
  assert.equal(score.unmeasured, 0);
  assert.deepEqual(score.cases, []);
});

test("duplicate ids and unknown labels are rejected with the offending id in the message", () => {
  const image = rgb(4, 4, [10, 20, 30]);
  const mask = fullMask(image);
  const one = { id: "a", label: "same" as const, source: image, render: image, sourceMask: mask, renderMask: mask };

  assert.throws(() => scoreCalibration([one, { ...one }], config), /"a"/);
  assert.throws(() => scoreCalibration([{ ...one, label: "same-ish" as never }], config), /same or different/);
});

test("a fidelity REFUSE cannot be overridden by a verifier that says every attribute matches", () => {
  // Two very different colours: fidelity refuses. The verifier's all-match answer is
  // the permissive case, and it must not lift the refusal.
  const source = rgb(8, 8, [250, 250, 250]);
  const render = rgb(8, 8, [5, 5, 90]);
  const [score] = scoreCalibration(
    [
      {
        id: "far",
        label: "different",
        source,
        render,
        sourceMask: fullMask(source),
        renderMask: fullMask(render),
        findings: allMatch(),
      },
    ],
    config,
  );
  assert.ok(score);
  assert.equal(score.cases[0]?.fidelity, "REFUSE");
  assert.equal(score.cases[0]?.decision, "REFUSE");
  assert.equal(score.false_match, 0);
});

test("an unmeasured case is REVIEW and is never counted as a pass, however permissive the findings", () => {
  const source = rgb(8, 8, [200, 200, 200]);
  const render = rgb(8, 8, [200, 200, 200]);
  const [score] = scoreCalibration(
    [
      {
        id: "no-mask",
        label: "different",
        source,
        render,
        sourceMask: null,
        renderMask: null,
        findings: allMatch(),
      },
    ],
    config,
  );
  assert.ok(score);
  assert.equal(score.unmeasured, 1);
  assert.equal(score.cases[0]?.decision, "REVIEW");
  assert.equal(score.false_match, 0);

  // The gap this documents: a run in which nothing could be measured still reports
  // zero false matches. Coverage must be read beside the score, never instead of it.
  assert.equal(score.unmeasured, score.same + score.different);
});

test("an empty findings array is not the same as no findings, and it fails closed", () => {
  const image = rgb(8, 8, [120, 120, 120]);
  const mask = fullMask(image);
  const base = { id: "empty-findings", label: "same" as const, source: image, render: image, sourceMask: mask, renderMask: mask };

  const withoutFindings = scoreCalibration([base], config)[0];
  const withEmptyArray = scoreCalibration([{ ...base, findings: [] }], config)[0];

  assert.equal(withoutFindings?.cases[0]?.decision, "RELEASE");
  // `[]` is truthy, so it reaches the gate, which refuses an unverified garment.
  assert.equal(withEmptyArray?.cases[0]?.decision, "REFUSE");
  assert.equal(withEmptyArray?.false_refuse, 1);
});

test("a one-pixel pair yields either a measurement or an honest refusal, never NaN", () => {
  const source = rgb(1, 1, [90, 120, 150]);
  const render = rgb(1, 1, [90, 120, 150]);
  const [score] = scoreCalibration(
    [
      {
        id: "tiny",
        label: "same",
        source,
        render,
        sourceMask: fullMask(source),
        renderMask: fullMask(render),
      },
    ],
    config,
  );
  assert.ok(score);
  const result = score.cases[0];
  assert.ok(result);
  assert.ok(["RELEASE", "REVIEW", "REFUSE"].includes(result.decision));
  if (!result.measured) assert.equal(result.decision, "REVIEW");

  // The metric path itself: a 1x1 pair either refuses to measure, or produces four
  // finite numbers. NaN or Infinity here would poison every later threshold sweep.
  const fidelity = checkFidelity(
    { source, render, sourceMask: fullMask(source), renderMask: fullMask(render) },
    thresholds,
  );
  if (fidelity.metrics !== null) {
    for (const [key, value] of Object.entries(fidelity.metrics)) {
      assert.ok(Number.isFinite(value), `metric ${key} is not finite: ${value}`);
    }
  }
});

test("scaling refuses Infinity as well as zero and NaN, and keeps area untouched", () => {
  for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => scaledCandidates(thresholds, [factor]), /positive finite/);
  }
  const [loose] = scaledCandidates(thresholds, [4]);
  assert.ok(loose);
  assert.deepEqual(loose.thresholds.area, thresholds.area);
  assert.ok(loose.thresholds.delta_e.refuse_above > thresholds.delta_e.refuse_above);
  // texture limits are divided by f, so looser means a lower floor (and never above 1)
  assert.ok(loose.thresholds.texture.refuse_below <= thresholds.texture.refuse_below);
  assert.ok(loose.thresholds.texture.review_below <= 1);
});

test("the same input scores identically twice: the scorer is deterministic", () => {
  const source = rgb(6, 6, [30, 60, 90]);
  const render = rgb(6, 6, [32, 62, 92]);
  const cases = [
    { id: "one", label: "same" as const, source, render, sourceMask: fullMask(source), renderMask: fullMask(render) },
  ];
  assert.deepEqual(scoreCalibration(cases, config), scoreCalibration(cases, config));
});
