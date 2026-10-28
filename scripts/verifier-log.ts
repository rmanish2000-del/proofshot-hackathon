// Writes one redacted verifier call log (src/verifier.ts) to
// <dir>/verifier-<started_at>.json, or one SAM call log (src/sam-meta.ts) to
// <dir>/sam-<started_at>.json, and returns the path. The log already holds
// no key and no image bytes; this only puts it on disk, pretty-printed, LF.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { SamCallLog } from "../src/sam-meta.ts";
import type { VerifierCallLog } from "../src/verifier.ts";

function writeLog(dir: string, prefix: string, log: { started_at: string }): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${prefix}-${log.started_at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(log, null, 2)}\n`);
  return file;
}

export function writeVerifierLog(dir: string, log: VerifierCallLog): string {
  return writeLog(dir, "verifier", log);
}

export function writeSamLog(dir: string, log: SamCallLog): string {
  return writeLog(dir, "sam", log);
}
