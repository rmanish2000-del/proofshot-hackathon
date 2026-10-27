// Canonical JSON and hashing, the two things every receipt hash depends on (SPEC §3).
// canonicalJson lives in core.js, shared with the verify page.

import { createHash } from "node:crypto";

export { canonicalJson } from "./core.js";

/** sha256 of a string (as UTF-8) or of raw bytes, lowercase hex. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
