// PS-1 edge cases (DeepSeek lane, 28 Oct): the ways a calibration run or a gate
// decision can be talked out of its answer by malformed input.
//
// Scope is what the existing suites do not pin:
//   * the confidence floor boundary — exactly at the floor must still fire
//   * findings that are not an array, and a confidence that is not a number
//   * note.txt labels that are empty or carry the "not recorded" sentinel
//   * a SAM box token with a zero or absurd frame size
//   * non-JPEG and very large byte buffers through imageExt / fileRenderer
//   * rendererFromEnv refusing a provider or model the receipt cannot claim
//
// Additive only: no product behaviour changes here unless a test fails first.

import assert from "node:assert/strict";
import { test } from "node:test";

import { decide } from "../src/gate.ts";
import { ATTRIBUTES, POLICY } from "../src/types.ts";
import type { DecisionInput } from "../src/types.ts";
import { garmentNoteFrom } from "../src/shop.ts";
import { frameSize } from "../src/sam-parser.ts";
import {
  FILE_MODEL_PREFIX,
  MuseImageRefused,
  RenderConfigError,
  STAND_IN_MODEL,
  StandInError,
  fileRenderer,
  imageExt,
  refuseMuseImage,
  rendererFromEnv,
} from "../src/render.ts";
import type { SourceImage } from "../src/pipeline.ts";

const FID = { decision: "RELEASE" as const, reasons: [] };

function findingsAt(confidence: number): DecisionInput[] {
  return ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match" as const, confidence }));
}

/** Each attribute at its OWN floor: floors differ per attribute, so one number cannot test them all. */
function findingsAtOwnFloors(): DecisionInput[] {
  return ATTRIBUTES.map((attribute) => ({ attribute, verdict: "match" as const, confidence: POLICY[attribute].floor }));
}

const FLOORS = ATTRIBUTES.map((a) => POLICY[a].floor);
const MIN_FLOOR = Math.min(...FLOORS);

test("gate boundary: a match at exactly the floor fires nothing, so the pair releases", () => {
  const findings = findingsAtOwnFloors();
  const out = decide(findings, FID);
  assert.equal(out.decision, "RELEASE");
  assert.equal(out.reasons.length, 0, JSON.stringify(out.reasons));
});

test("gate boundary: one ulp under the floor is low_confidence, so the pair is REVIEWED not released", () => {
  const findings = findingsAtOwnFloors();
  // every attribute one hair under its own floor: no index gymnastics, no attribute left verified
  const out = decide(findings.map((f) => ({ ...f, confidence: f.confidence - 1e-9 })), FID);
  // The policy table maps low_confidence to REVIEW, which is the point: under the floor a "match"
  // is never enough on its own.
  assert.equal(out.decision, "REVIEW");
  assert.ok(out.reasons.some((r) => r.rule === "low_confidence"), JSON.stringify(out.reasons));
});

test("findings that are not an array are no findings: every attribute is not_verified", () => {
  for (const bad of [undefined, null, {}, 42, "match", [{}]]) {
    const out = decide(bad as unknown as DecisionInput[], FID);
    assert.equal(out.decision, "REFUSE", `input ${JSON.stringify(bad)}`);
    assert.equal(out.reasons.filter((r) => r.rule === "not_verified").length, ATTRIBUTES.length);
  }
});

test("a non-numeric or non-finite confidence is zero, never certainty", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "0.99", null, undefined]) {
    const findings = findingsAtOwnFloors().map((f, i) =>
      i === 0 ? { ...f, confidence: bad as unknown as number } : f);
    const out = decide(findings, FID);
    // A match at confidence 0 is low confidence, which is REVIEW per the policy table:
    // the point is that it is never RELEASE and the finding is never treated as verified.
    assert.notEqual(out.decision, "RELEASE", `confidence ${String(bad)}`);
    assert.ok(out.reasons.some((r) => r.rule === "low_confidence"), `confidence ${String(bad)}`);
  }
});

test("note.txt: empty, blank and sentinel labels fall back to the folder name", () => {
  assert.equal(garmentNoteFrom("", "kurta-01"), "kurta-01");
  assert.equal(garmentNoteFrom("Type:   \nMain colour:   \n", "kurta-01"), "kurta-01");
  assert.equal(garmentNoteFrom("Type: not recorded\nMain colour: not recorded\n", "kurta-01"), "kurta-01");
  assert.equal(garmentNoteFrom("Type: as in the photos\n", "kurta-01"), "kurta-01");
});

test("note.txt: CRLF, extra fields and a one-line label still parse", () => {
  assert.equal(garmentNoteFrom("Type: kurta\r\nMain colour: rust\r\n", "kurta-01"), "kurta, rust");
  assert.equal(garmentNoteFrom("Type: kurta\n", "kurta-01"), "kurta");
  assert.equal(garmentNoteFrom("Fabric: silk\nType: kurta\nMain colour: indigo\n", "kurta-01"), "kurta, indigo");
});

test("note.txt: a very large note does not hang or throw", () => {
  const huge = `Type: kurta\nMain colour: rust\n${"x".repeat(1_000_000)}\n`;
  assert.equal(garmentNoteFrom(huge, "kurta-01"), "kurta, rust");
});

test("SAM frame token: a zero or absurd size is refused, not returned", () => {
  const image: SourceImage = { name: "x.jpg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 0, 0]) };
  assert.equal(frameSize("", image), null, "no token, no header");
  assert.equal(frameSize("<|box;w=0;h=0|>", image), null, "a zero frame is not a frame");
  assert.equal(frameSize("<|box;w=99999999;h=99999999|>", image), null, "a billion-pixel frame is refused");
  assert.equal(frameSize("<|box;w=12;h=8|>", image)?.width, 12, "a sane token is used");
});

test("imageExt: short, empty and huge buffers are not images, and never throw", () => {
  assert.equal(imageExt(new Uint8Array(0)), null);
  assert.equal(imageExt(new Uint8Array([0xff, 0xd8])), null, "two bytes is not a JPEG");
  assert.equal(imageExt(new Uint8Array([0xff, 0xd8, 0xff])), "jpg");
  assert.equal(imageExt(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), "png");
  assert.equal(imageExt(new Uint8Array([137, 80, 78])), null, "a truncated PNG is not a PNG");
  assert.equal(imageExt(new Uint8Array(8 * 1024 * 1024)), null, "8 MB of zeros is not an image");
});

test("fileRenderer: a non-image is refused before a job runs; a large buffer is returned by reference", () => {
  assert.throws(() => fileRenderer("nope.txt", new Uint8Array([1, 2, 3])), StandInError);
  assert.throws(() => fileRenderer("  ", new Uint8Array([0xff, 0xd8, 0xff])), StandInError);
  const big = new Uint8Array(5 * 1024 * 1024);
  big.set([0xff, 0xd8, 0xff]);
  const renderer = fileRenderer("big.jpg", big);
  assert.equal(renderer.model, `${FILE_MODEL_PREFIX}big.jpg`);
  return renderer.render({ sources: [] } as never).then((out) => {
    assert.equal(out.bytes, big, "the same buffer is returned, not copied");
    assert.equal(out.ext, "jpg");
  });
});

test("rendererFromEnv: an unknown provider, a missing model and a Muse id are all refused before any request", () => {
  const transport = () => {
    throw new Error("the transport must not be called");
  };
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "dall-e" }, transport), RenderConfigError);
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "fal" }, transport), RenderConfigError);
  assert.throws(
    () => rendererFromEnv({ RENDER_PROVIDER: "openai-images", MODEL_RENDER: "muse-image-1" }, transport),
    MuseImageRefused,
  );
  assert.throws(() => rendererFromEnv({ RENDER_PROVIDER: "stand-in", MODEL_RENDER: "gpt-image-1" }, transport), RenderConfigError);
  const standIn = rendererFromEnv({ RENDER_PROVIDER: "stand-in" }, transport);
  assert.equal(standIn.model, STAND_IN_MODEL);
});

test("refuseMuseImage: the separator variants in the regex are all refused", () => {
  for (const id of ["muse-image", "MUSE IMAGE", "muse_image", "muse/image", "muse.image", "Muse-Image-1"]) {
    assert.throws(() => refuseMuseImage(id), MuseImageRefused, id);
  }
  for (const id of ["gpt-image-1", "image-muse", "musical-image"]) {
    assert.doesNotThrow(() => refuseMuseImage(id), id);
  }
});
