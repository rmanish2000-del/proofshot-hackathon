// The verifier's output contract and its parser (SPEC §4).
//
// FINDINGS_SCHEMA is sent as a strict structured-output schema. parseFindings
// reads whatever came back and fails closed: anything the gate could not read
// safely throws VerifierProtocolError, and a thrown verifier is a refusal. It is
// lenient only where the gate already fails closed (missing or unknown
// attributes, the item count, the 0..1 range).

import { ATTRIBUTES, VERDICTS } from "./types.ts";
import type { Verdict } from "./types.ts";

/** [x, y, w, h], each 0..1 of the image. */
export type Bbox = readonly [number, number, number, number];

export interface Finding {
  readonly attribute: string;
  readonly verdict: Verdict;
  readonly confidence: number;
  readonly note: string;
  readonly evidence: { readonly source_bbox: Bbox | null; readonly render_bbox: Bbox | null };
}

export class VerifierProtocolError extends Error {
  override readonly name = "VerifierProtocolError";
}

const bbox = {
  anyOf: [
    { type: "array", items: { type: "number", minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 },
    { type: "null" },
  ],
} as const;

export const FINDINGS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      minItems: ATTRIBUTES.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["attribute", "verdict", "confidence", "note", "evidence"],
        properties: {
          attribute: { type: "string", enum: [...ATTRIBUTES] },
          verdict: { type: "string", enum: [...VERDICTS] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          note: { type: "string" },
          evidence: {
            type: "object",
            additionalProperties: false,
            required: ["source_bbox", "render_bbox"],
            properties: { source_bbox: bbox, render_bbox: bbox },
          },
        },
      },
    },
  },
});

const fail = (reason: string): never => {
  throw new VerifierProtocolError(`verifier output: ${reason}`);
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The findings object itself, or a JSON string of it. */
function unwrap(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fail("not JSON");
  }
}

function toBbox(v: unknown): Bbox | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const c = (n: number) => Math.min(1, Math.max(0, n));
  return [c(v[0]), c(v[1]), c(v[2]), c(v[3])];
}

/**
 * Accepts the findings object, a JSON string of it, or an object whose
 * `content` field holds either. Returns the findings in input order.
 */
export function parseFindings(raw: unknown): Finding[] {
  const empty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  if (empty(raw)) fail("no message content");
  let value = unwrap(raw);
  if (isObject(value) && !("findings" in value) && "content" in value) {
    if (empty(value.content)) fail("no message content");
    value = unwrap(value.content);
  }
  if (!isObject(value) || !Array.isArray(value.findings)) return fail("no findings array");

  return value.findings.map((f: unknown, i: number): Finding => {
    if (!isObject(f)) return fail(`finding ${i} is not an object`);
    if (typeof f.attribute !== "string") return fail(`finding ${i} has no attribute string`);
    if (!(VERDICTS as readonly unknown[]).includes(f.verdict)) return fail(`finding ${i} (${f.attribute}) has an unknown verdict`);
    if (typeof f.confidence !== "number" || !Number.isFinite(f.confidence)) return fail(`finding ${i} (${f.attribute}) has no finite confidence`);
    const evidence = isObject(f.evidence) ? f.evidence : {};
    return {
      attribute: f.attribute,
      verdict: f.verdict as Verdict,
      confidence: f.confidence,
      note: typeof f.note === "string" ? f.note : "(no note)",
      evidence: { source_bbox: toBbox(evidence.source_bbox), render_bbox: toBbox(evidence.render_bbox) },
    };
  });
}
