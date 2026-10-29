// npm run models:meta
//
// MS2: lists the model ids the Meta Model API serves to this key
// (GET https://api.meta.ai/v1/models), Muse Spark ones first, so MS2 names a
// model that exists. MODEL_API_KEY comes from the process env, or the Windows
// User env when the process did not inherit it. Prints ids only; the key is
// never printed.

import { resolveUserEnvKey } from "../src/verifier-meta.ts";

const found = resolveUserEnvKey(process.env, "MODEL_API_KEY");
if (!found) {
  console.error("MODEL_API_KEY is not set in the process or the User env");
  process.exit(2);
}
const res = await fetch("https://api.meta.ai/v1/models", { headers: { Authorization: `Bearer ${found.key}` } });
console.log(`HTTP ${res.status} (key from ${found.source})`);
const text = await res.text();
let ids: string[] = [];
try {
  const body = JSON.parse(text) as { data?: { id?: unknown }[] };
  ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string").sort();
} catch {
  console.log(`answer is not JSON (${text.length} bytes)`);
}
const muse = ids.filter((x) => /muse-spark/i.test(x));
console.log(`${ids.length} models, ${muse.length} Muse Spark${muse.length ? ":" : ""}`);
for (const id of muse) console.log(`  ${id}`);
console.log("every id:");
for (const id of ids) console.log(`  ${id}`);
