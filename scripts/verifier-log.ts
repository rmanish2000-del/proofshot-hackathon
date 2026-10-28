// Writes one redacted verifier call log (src/verifier.ts) to
// <dir>/verifier-<started_at>.json and returns the path. The log already holds
// no key and no image bytes; this only puts it on disk, pretty-printed, LF.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { VerifierCallLog } from "../src/verifier.ts";

export function writeVerifierLog(dir: string, log: VerifierCallLog): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `verifier-${log.started_at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(log, null, 2)}\n`);
  return file;
}
