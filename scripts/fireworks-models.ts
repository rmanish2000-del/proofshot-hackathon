// npm run models:fireworks
//
// FW1: lists the Meta Llama model ids Fireworks serves to this key
// (GET /inference/v1/models, OpenAI-compatible), so FIREWORKS_MODEL names a
// model that exists. Prints ids only; the key is never printed.

import { resolveFireworksKey } from "../src/llama-fireworks.ts";

const found = resolveFireworksKey(process.env);
if (!found) {
  console.error("FIREWORKS_API_KEY is not set in the process or the User env");
  process.exit(2);
}
const res = await fetch("https://api.fireworks.ai/inference/v1/models", { headers: { Authorization: `Bearer ${found.key}` } });
console.log(`HTTP ${res.status} (key from ${found.source})`);
const body = (await res.json()) as { data?: { id?: unknown }[] };
const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
const llama = ids.filter((x) => /llama/i.test(x)).sort();
console.log(`${ids.length} models, ${llama.length} Llama${llama.length ? ":" : "; every id:"}`);
for (const id of llama.length ? llama : ids.sort()) console.log(id);
