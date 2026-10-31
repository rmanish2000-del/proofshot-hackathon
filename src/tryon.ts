// Try-on render run (CC_PROMPT_TRYON_31OCT): a render that is byte for byte one
// of the seller's own photos is not a render. Before this run, the RELEASEs on
// shirt-pink and kurta-mustard came from the stand-in renderer, so fidelity
// compared photo 1 with itself. The guard makes that impossible here: a
// renderer wrapped by guardRenderer throws SelfComparisonError when its output
// has the hash of any source photo, so runJob records render_failed (REFUSE)
// and the verifier is never paid for; the batch then fails the run.

import type { Renderer } from "./pipeline.ts";
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
