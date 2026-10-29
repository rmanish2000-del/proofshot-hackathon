// npm run verify:meta -- <garment dir> <render image> <label>
//
// One Muse Spark 1.3 garment check on the Meta Model API (api.meta.ai) for a
// (garment photos, render) pair, outside a job: used to re-check a committed
// render whose job's verifier call failed in transport (NR3 shirt-plaid, 29 Oct:
// "fetch failed"). Metered on the Meta ledger like every Meta call; the key is
// read from the process or User env and never printed; the redacted call log
// goes to evidence/verifier-<started_at>.json. Prints the request size, then the
// findings and the gate's decision over them, or the error with its cause.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { decide } from "../src/gate.ts";
import { garmentPhotos } from "../src/ms4.ts";
import { parseFindings } from "../src/schema.ts";
import { META_LIMIT, accountLedger, meteredFetch, spendSummary, summaryLine } from "../src/spend-meta.ts";
import { META_KEY_ENV, metaVerifier, resolveUserEnvKey } from "../src/verifier-meta.ts";
import { writeVerifierLog } from "./verifier-log.ts";

const [garmentDir, renderPath, label] = process.argv.slice(2);
if (!garmentDir || !renderPath || !label || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(label)) {
  console.error("usage: npm run verify:meta -- <garment dir> <render image> <label>");
  process.exit(2);
}
const ledger = accountLedger("meta", process.env);
const found = resolveUserEnvKey(process.env, META_KEY_ENV);
if (!ledger || !found) {
  console.error(`needs a Meta ledger (LOCALAPPDATA) and ${META_KEY_ENV}`);
  process.exit(2);
}
const sources = garmentPhotos(garmentDir).map((p) => ({ name: p.name, bytes: new Uint8Array(readFileSync(p.path)) }));
const render = new Uint8Array(readFileSync(renderPath));
const bytes = sources.reduce((n, s) => n + s.bytes.length, render.length);
console.log(`${sources.length} photos + render: ${(bytes / 1e6).toFixed(2)} MB of image bytes (about ${((bytes * 4) / 3 / 1e6).toFixed(1)} MB as base64)`);

const fetch = meteredFetch((url, init) => globalThis.fetch(url, init), { kind: "muse", account: "meta", ledger, env: process.env });
let logPath = "";
const verifier = metaVerifier({ key: found.key, env: process.env, fetch, onCall: (log) => void (logPath = writeVerifierLog("evidence", log)) });
const started_at = new Date().toISOString();
const out: Record<string, unknown> = { label, garment_dir: garmentDir.split("\\").join("/"), render: renderPath.split("\\").join("/"), started_at, image_bytes: bytes };
try {
  const res = await verifier.verify({ sources, render, renderId: label, scene: "studio" });
  const findings = parseFindings(res.raw).map((f) => ({ attribute: f.attribute, verdict: f.verdict, confidence: f.confidence, note: f.note }));
  const gate = decide(findings);
  Object.assign(out, { ok: true, findings, decision: gate.decision, cited: gate.cited?.reason ?? null });
  console.log(`decision over the findings: ${gate.decision}${gate.cited ? ` (${gate.cited.reason})` : ""}`);
  for (const f of findings) console.log(`  ${f.attribute}: ${f.verdict} ${f.confidence}`);
} catch (e) {
  const cause = e instanceof Error && e.cause instanceof Error ? `${e.cause.name}: ${e.cause.message}` : e instanceof Error && e.cause ? String(e.cause) : null;
  Object.assign(out, { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), cause });
  console.error(`failed: ${out.error}${cause ? ` (cause ${cause})` : ""}`);
  process.exitCode = 1;
}
out.log = logPath.split("\\").join("/");
mkdirSync(join("evidence", "reverify"), { recursive: true });
writeFileSync(join("evidence", "reverify", `${label}.json`), `${JSON.stringify(out, null, 2)}\n`);
console.log(summaryLine("Meta spend", spendSummary(ledger, META_LIMIT)));
