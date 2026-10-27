// The verify page's image check (SPEC §9): given a receipt and an image's
// sha256, say whether that image was released by this record.
//
// Pure, so the server and the page can run the same code. The chain is checked
// first: a record that does not verify vouches for nothing.

import { verifyChain } from "./receipt.ts";
import type { ReceiptEntry } from "./receipt.ts";
import type { Decision } from "./types.ts";

export type ImageStatus = "VALID" | "NOT RELEASED" | "TAMPERED";

export interface ImageCheck {
  readonly status: ImageStatus;
  /** The render the hash belongs to, when it belongs to one. */
  readonly render_id: string | null;
  /** On NOT RELEASED, that render's gate decision (null when no gate entry exists). */
  readonly decision: Decision | null;
  readonly reason: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

const field = (e: ReceiptEntry, key: string): unknown =>
  typeof e.payload === "object" && e.payload !== null ? (e.payload as Record<string, unknown>)[key] : undefined;

export function checkImage(entries: readonly ReceiptEntry[], imageSha256: string): ImageCheck {
  const no = (reason: string): ImageCheck => ({ status: "TAMPERED", render_id: null, decision: null, reason });

  const chain = verifyChain(entries);
  if (!chain.ok) return no(`the record does not verify: entry ${chain.index}, ${chain.reason}`);
  // Hex case carries no meaning, so it is folded; anything else is not a sha256.
  const sha = typeof imageSha256 === "string" ? imageSha256.trim().toLowerCase() : "";
  if (!HEX64.test(sha)) return no("the image hash is not 64 hex characters");

  const release = entries.find((e) => e.kind === "release" && field(e, "image_sha256") === sha);
  if (release) {
    const id = field(release, "render_id");
    return { status: "VALID", render_id: typeof id === "string" ? id : null, decision: "RELEASE", reason: "this image was released by this record" };
  }

  const render = entries.find((e) => e.kind === "render" && field(e, "sha256") === sha);
  if (render) {
    const id = field(render, "render_id");
    const render_id = typeof id === "string" ? id : null;
    const gate = entries.find((e) => e.kind === "gate" && render_id !== null && field(e, "render_id") === render_id);
    const d = gate ? field(gate, "decision") : undefined;
    const decision = d === "RELEASE" || d === "REVIEW" || d === "REFUSE" ? d : null;
    return {
      status: "NOT RELEASED",
      render_id,
      decision,
      reason: decision ? `this image was rendered but not released: the gate decided ${decision}` : "this image was rendered but never reached the gate",
    };
  }

  return no("this image is in no entry of this record");
}
