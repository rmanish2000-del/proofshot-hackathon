// npm run call:baseten: one real Muse Spark Open call on Baseten, logged to
// evidence/baseten-<started_at>.json. The key comes only from BASETEN_API_KEY
// and is never printed or written. Exits 1 when the call failed; the log is
// written either way, so a failure can be committed too.
//
// max_tokens is 1024, not the client's default of 64: Muse Spark Open reasons
// before it answers (reasoning_content), and the first live call
// (evidence/baseten-2026-10-27T13-23-37-385Z.json) spent all 64 tokens on that
// and came back with content null and finish_reason "length" (proofshot #16).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { basetenCall } from "../src/baseten.ts";

export const MAX_TOKENS = 1024;

const log = await basetenCall({
  env: process.env,
  fetch: (url, init) => fetch(url, init),
  messages: [{ role: "user", content: "Reply with exactly one word: ready" }],
  maxTokens: MAX_TOKENS,
});

mkdirSync("evidence", { recursive: true });
const file = join("evidence", `baseten-${log.started_at.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(log, null, 2) + "\n");
console.log(`${log.model}: ${log.error ?? `status ${log.response?.status}`}, ${log.latency_ms} ms, log in ${file}`);
if (log.error) process.exitCode = 1;
