// npm run call:sam [-- <image path> [<noun phrase>]]: one real SAM 3.1 call on
// the Meta Model API (#18), logged to evidence/sam-<started_at>.json.
//
// Defaults: data/garments/kurta-01/1-front.jpg and the phrase "kurta" (Grok,
// 28 Oct 08:21). The key comes only from MODEL_API_KEY and goes into the
// Authorization header; the log holds no header at all, the request with the
// image data URL replaced by its byte count and sha256, the raw answer text
// (capped), the joined output text and whether it holds a mask token. The whole
// log is checked for the key's value before it is written, and nothing is
// written when the key is unset. The mask tokens are logged, not decoded here
// (src/sam-parser.ts decodes them in the pipeline). Exits 1 when the call failed.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { MASK_TOKEN_START, META_MODEL_API_URL, META_SAM_MODEL_ID, joinOutputText, metaSamRequestBody } from "../src/sam-meta.ts";
import { sha256Hex } from "../src/util.ts";

const CAP = 1_000_000;
const [imagePath = "data/garments/kurta-01/1-front.jpg", prompt = "kurta"] = process.argv.slice(2);

const key = (process.env.MODEL_API_KEY ?? "").trim();
if (key === "") {
  console.error("MODEL_API_KEY is not set in this process: no call made, no log written");
  process.exit(2);
}

const bytes = new Uint8Array(readFileSync(imagePath));
const image = { name: basename(imagePath), bytes };
const body = metaSamRequestBody(prompt, image);
const request = JSON.parse(body) as { input: { content: { type: string; image_url?: string }[] }[] };
for (const part of request.input[0]!.content) {
  if (part.type === "input_image" && part.image_url) {
    const mime = /^data:([^;]+);/.exec(part.image_url)?.[1] ?? "?";
    part.image_url = `data:${mime};base64,[${bytes.length} bytes, sha256 ${sha256Hex(bytes)}, left out of the log]`;
  }
}

const started_at = new Date().toISOString();
const t0 = performance.now();
let status: number | null = null;
let text: string | null = null;
let error: string | null = null;
try {
  const res = await fetch(META_MODEL_API_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "text/event-stream" },
    body,
  });
  status = res.status;
  text = await res.text();
} catch (e) {
  error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
const latency_ms = Math.round(performance.now() - t0);

let output_text: string | null = null;
let join_error: string | null = null;
if (text !== null && status !== null && status >= 200 && status < 300) {
  try {
    output_text = joinOutputText(text, image.name);
  } catch (e) {
    join_error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
}

const cap = (s: string | null) => (s === null ? null : s.length > CAP ? `${s.slice(0, CAP)}…[truncated, ${s.length} chars in all]` : s);
const log = {
  started_at,
  latency_ms,
  url: META_MODEL_API_URL,
  model_segment: META_SAM_MODEL_ID,
  image: { path: imagePath, bytes: bytes.length, sha256: sha256Hex(bytes) },
  request,
  response: error ? null : { status, body: cap(text) },
  output_text: cap(output_text),
  mask_token_present: output_text === null ? null : output_text.includes(MASK_TOKEN_START),
  join_error,
  error,
  note: "no header is logged; the image data URL is replaced by its size and hash; mask tokens are logged here, not decoded (src/sam-parser.ts decodes them in the pipeline)",
};
let json = JSON.stringify(log, null, 2);
if (json.includes(key)) json = json.split(key).join("[MODEL_API_KEY]");

mkdirSync("evidence", { recursive: true });
const file = join("evidence", `sam-${started_at.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, `${json}\n`);
const ok = error === null && status !== null && status >= 200 && status < 300 && join_error === null;
console.log(`sam-3.1: ${error ?? `status ${status}`}${join_error ? `, ${join_error}` : ""}, ${latency_ms} ms, mask token ${log.mask_token_present === null ? "n/a" : log.mask_token_present ? "present" : "absent"}, log in ${file}`);
if (!ok) process.exitCode = 1;
