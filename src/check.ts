// The verify page's image check (SPEC §9): given a receipt and an image's
// sha256, say whether that image was released by this record.
//
// The logic is core.js checkImageWith, which the page runs too. The chain is
// checked first: a record that does not verify vouches for nothing.

import { checkImageWith } from "./core.js";
import type { ImageCheck } from "./core.js";
import { verifyChain } from "./receipt.ts";
import type { ReceiptEntry } from "./receipt.ts";

export type { ImageCheck, ImageStatus } from "./core.js";

export function checkImage(entries: readonly ReceiptEntry[], imageSha256: string): ImageCheck {
  return checkImageWith(entries, verifyChain(entries), imageSha256);
}
