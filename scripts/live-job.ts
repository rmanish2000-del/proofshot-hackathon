// npm run job:live [-- [--render <image>] <garment dir> <job id> [<jobs root>]]
//
// --render <image> (Grok, 28 Oct 09:55, R2): that file stands in for the
// render instead of the garment's own front photo, for a deliberate-mismatch
// job. It is still the stand-in provider (nothing generated) and the receipt's
// render model is file:<path as given>, so the record names the file.
//
// One real pipeline job (P6): the garment's intake photos go through the
// providers the environment names (src/serve.ts providersFromEnv), which must
// include the live verifier, Muse Spark Open on Baseten, read from
// BASETEN_API_KEY. The renderer is the stand-in (the owner's front photo), or
// with RENDER_PROVIDER=composite (NR1) the seller's garment cut out by the SAM
// mask and placed on the RENDER_TEMPLATE template (default mannequin-01), no
// image model; with no mask the composite refuses (render_failed). With
// PROOFSHOT_RENDER=replicate-pruna-tryon (NR4) the render is an AI try-on by
// Pruna on Replicate, read from REPLICATE_API_TOKEN, falling back to composite
// v2 with the reason on the receipt. The
// segmenter is whatever MODEL_SEGMENT, MODEL_API_KEY and the mask parser
// allow; without them no segment exists and the fidelity check is REVIEW with
// no metrics, so the gate's answer is REVIEW at best (SPEC §10 is not weakened
// for this). The receipt lands in <jobs root>/<job id>/ and the verifier call's
// redacted log in evidence/verifier-<started_at>.json, each SAM call's in
// evidence/sam-<started_at>.json (Grok 10:20, rule 13). Exits 2 with no job
// when the verifier is not live, 1 when the job was refused before the gate.
// When the jobs root is the repo's data/jobs it rebuilds web/shop afterwards
// (N6), and exits 1 if the shop then has problems.
//
// Defaults: data/garments/kurta-01, live-kurta-01, data/jobs (Grok, 28 Oct
// 09:00). The garment note is the "Key: value" lines of the garment's note.txt.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runJob } from "../src/pipeline.ts";
import { fileRenderer } from "../src/render.ts";
import { providersFromEnv } from "../src/serve.ts";
import { shopAfterJob } from "../src/shop.ts";
import { BASETEN_LIMIT, META_LIMIT, accountLedger, meteredFetch, spendSummary, summaryLine } from "../src/spend-meta.ts";
import { writeSamLog, writeVerifierLog } from "./verifier-log.ts";

const args = process.argv.slice(2);
let renderPath: string | null = null;
const flag = args.indexOf("--render");
if (flag !== -1) {
  renderPath = args[flag + 1] ?? null;
  if (!renderPath || renderPath.startsWith("--")) {
    console.error("--render needs an image path");
    process.exit(2);
  }
  args.splice(flag, 2);
}
const [garmentDir = "data/garments/kurta-01", jobId = "live-kurta-01", jobsRoot = "data/jobs"] = args;

if (existsSync(join(jobsRoot, jobId))) {
  console.error(`${join(jobsRoot, jobId)} already exists: a job id is used once`);
  process.exit(2);
}

const logs: string[] = [];
const samLogs: string[] = [];
// CAP1b: SAM 3.1 on the Meta Model API books to the Meta ledger, the verifier on Baseten to its own.
const metaLedger = accountLedger("meta", process.env);
const basetenLedger = accountLedger("baseten", process.env);
const providers = providersFromEnv(process.env, {
  sam: { fetch: meteredFetch((url, init) => fetch(url, init), { kind: "sam", account: "meta", ledger: metaLedger, env: process.env }), onCall: (log) => samLogs.push(writeSamLog("evidence", log)) },
  verifierFetch: meteredFetch((url, init) => fetch(url, init), { kind: "verifier", account: "baseten", ledger: basetenLedger, env: process.env }),
  onVerifierCall: (log) => logs.push(writeVerifierLog("evidence", log)),
  replicate: { fetch: (url, init) => fetch(url, init) },
});
if (providers.mode.fixture) {
  console.error(`the verifier is not live (${providers.mode.labels.verify}): no job run. Set BASETEN_API_KEY in this process.`);
  process.exit(2);
}
const runProviders = renderPath
  ? { ...providers.providers, renderer: fileRenderer(renderPath.replace(/\\/g, "/"), new Uint8Array(readFileSync(renderPath))) }
  : providers.providers;
const labels = renderPath
  ? { ...providers.mode.labels, render: `${runProviders.renderer.provider} / ${runProviders.renderer.model}: that file stands in for the render, nothing generated` }
  : providers.mode.labels;

const intake = JSON.parse(readFileSync(join(garmentDir, "intake.json"), "utf8")) as { files: { name: string }[] };
const sources = intake.files.map((f) => ({ name: f.name, bytes: new Uint8Array(readFileSync(join(garmentDir, f.name))) }));
const note = readFileSync(join(garmentDir, "note.txt"), "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /^[A-Za-z][^:]*: \S/.test(l))
  .join("; ");
const garmentNote = `${basename(garmentDir)}: ${note || "no note"}`;

console.log(`job ${jobId}: ${sources.length} source photo(s) from ${garmentDir}, providers:`);
for (const [step, label] of Object.entries(labels)) console.log(`  ${step}: ${label}`);

const result = await runJob({ jobId, garmentNote, scenes: ["studio"], sources }, { outRoot: jobsRoot, providers: runProviders, provenance: providers.mode.provenance });

console.log(`receipt: ${join(result.dir, "receipt.jsonl")} (head ${result.head})`);
for (const file of samLogs) console.log(`SAM log: ${file}`);
for (const file of logs) console.log(`verifier log: ${file}`);
if (result.refused) {
  console.log(`REFUSE before any render: ${result.refused.rule}: ${result.refused.reason}`);
  process.exitCode = 1;
}
for (const r of result.renders) {
  console.log(`${r.render_id}: ${r.decision}${r.cited ? ` (${r.cited.rule}: ${r.cited.reason})` : ""}`);
}
if (metaLedger) console.log(summaryLine("Meta spend", spendSummary(metaLedger, META_LIMIT)));
if (basetenLedger) console.log(summaryLine("Baseten spend", spendSummary(basetenLedger, BASETEN_LIMIT)));

// N6: a job in data/jobs feeds the committed shop, so rebuild it here rather
// than leave web/shop/catalog.json stale for the shop test in CI.
const shop = shopAfterJob(jobsRoot, fileURLToPath(new URL("..", import.meta.url)));
if (shop) {
  for (const p of shop.build.problems) console.error(`shop: skip ${p.job_id}: ${p.reason}`);
  console.log(`shop rebuilt: ${shop.build.rows.length} row(s) in ${shop.out}; commit web/shop with the job`);
  if (shop.build.problems.length > 0) {
    console.error("the shop has problems: fix them before committing this job");
    process.exitCode = 1;
  }
}
