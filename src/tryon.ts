// Try-on render run (CC_PROMPT_TRYON_31OCT): a render that is byte for byte one
// of the seller's own photos is not a render. Before this run, the RELEASEs on
// shirt-pink and kurta-mustard came from the stand-in renderer, so fidelity
// compared photo 1 with itself. The guard makes that impossible here: a
// renderer wrapped by guardRenderer throws SelfComparisonError when its output
// has the hash of any source photo, so runJob records render_failed (REFUSE)
// and the verifier is never paid for; the batch then fails the run.

import type { FidelityChecker, Renderer } from "./pipeline.ts";
import { sha256Hex } from "./util.ts";

export class SelfComparisonError extends Error {
  override name = "SelfComparisonError";
}

/** Throws when the render has the same sha256 as any source photo. */
export function assertNotSelfComparison(renderSha256: string, sourceSha256s: readonly string[]): void {
  const i = sourceSha256s.indexOf(renderSha256);
  if (i !== -1) {
    throw new SelfComparisonError(`the render is source photo ${i + 1} byte for byte (sha256 ${renderSha256.slice(0, 12)}): judging it would compare the photo with itself`);
  }
}

/** The renderer, refusing any output that is one of the sources it was given. */
export function guardRenderer(renderer: Renderer): Renderer {
  return {
    provider: renderer.provider,
    model: renderer.model,
    async render(req) {
      const image = await renderer.render(req);
      assertNotSelfComparison(sha256Hex(image.bytes), req.sources.map((s) => sha256Hex(s.bytes)));
      return image;
    },
  };
}

/**
 * SC1 (Grok, 31 Oct, from the DeepSeek Q31 red-team): the Evidence Recovery Agent's replace-photo-1 path takes a
 * new photo 1 from the seller, so a seller could answer with the image to publish itself. Then fidelity compares a
 * file with itself. This wrapper never lets that pass as a fidelity check: when the image to publish is a source
 * photo byte for byte, a RELEASE becomes REVIEW (a person looks), and REVIEW or REFUSE keeps its decision; either
 * way the fidelity entry says so in a reason. The thresholds and src/fidelity.ts are not touched.
 */
export function selfComparisonReview(checker: FidelityChecker): FidelityChecker {
  return {
    async check(req) {
      const out = await checker.check(req);
      const i = req.sources.map((s) => sha256Hex(s.bytes)).indexOf(sha256Hex(req.render));
      if (i === -1) return out;
      const reason = `self_comparison: the image to publish is source photo ${i + 1} (${req.sources[i]!.name}) byte for byte, so fidelity compared the photo with itself and checked no render; the seller's own photo, nothing generated, and a person must look`;
      const reasons = [...(Array.isArray(out.reasons) ? out.reasons : []), reason];
      return { ...out, decision: out.decision === "RELEASE" ? "REVIEW" : out.decision, reasons };
    },
  };
}
