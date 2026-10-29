// npm run models:fireworks
//
// Lists the model ids Fireworks serves to this key (GET /inference/v1/models,
// OpenAI-compatible), Meta ones first, so FIREWORKS_MODEL names a model that
// exists. Prints ids only; the key is never printed.

import { resolveFireworksKey } from "../src/fireworks-copy.ts";

const found = resolveFireworksKey(process.env);
if (!found) {
  console.error("FIREWORKS_API_KEY is not set in the process or the User env");
  process.exit(2);
}
const res = await fetch("https://api.fireworks.ai/inference/v1/models", { headers: { Authorization: `Bearer ${found.key}` } });
console.log(`HTTP ${res.status} (key from ${found.source})`);
const body = (await res.json()) as { data?: { id?: unknown }[] };
const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string").sort();
const meta = ids.filter((x) => /llama|muse/i.test(x));
console.log(`${ids.length} models, ${meta.length} Meta (Llama or Muse)${meta.length ? ":" : ""}`);
for (const id of meta) console.log(`  ${id}`);
console.log("every id:");
for (const id of ids) console.log(`  ${id}`);
