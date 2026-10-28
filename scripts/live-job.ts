// npm run job:live [-- <garment dir> <job id> [<jobs root>]]
//
// One real pipeline job (P6): the garment's intake photos go through the
// providers the environment names (src/serve.ts providersFromEnv), which must
// include the live verifier, Muse Spark Open on Baseten, read from
// BASETEN_API_KEY. The renderer is the stand-in (the owner's front photo) and
// the segmenter is whatever MODEL_SEGMENT, MODEL_API_KEY and the mask parser
// allow; without them no segment exists and the fidelity check is REVIEW with
// no metrics, so the gate's answer is REVIEW at best (SPEC §10 is not weakened
// for this). The receipt lands in <jobs root>/<job id>/ and the verifier call's
// redacted log in evidence/verifier-<started_at>.json. Exits 2 with no job
// when the verifier is not live, 1 when the job was refused before the gate.
//
// Defaults: data/garments/kurta-01, live-kurta-01, data/jobs (Grok, 28 Oct
// 09:00). The garment note is the "Key: value" lines of the garment's note.txt.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { runJob } from "../src/pipeline.ts";
import { providersFromEnv } from "../src/serve.ts";
import { writeVerifierLog } from "./verifier-log.ts";

const [garmentDir = "data/garments/kurta-01", jobId = "live-kurta-01", jobsRoot = "data/jobs"] = process.argv.slice(2);

if (existsSync(join(jobsRoot, jobId))) {
  console.error(`${join(jobsRoot, jobId)} already exists: a job id is used once`);
  process.exit(2);
}

const logs: string[] = [];
const providers = providersFromEnv(process.env, {
  verifierFetch: (url, init) => fetch(url, init),
  onVerifierCall: (log) => logs.push(writeVerifierLog("evidence", log)),
});
if (providers.mode.fixture) {
  console.error(`the verifier is not live (${providers.mode.labels.verify}): no job run. Set BASETEN_API_KEY in this process.`);
  process.exit(2);
}

const intake = JSON.parse(readFileSync(join(garmentDir, "intake.json"), "utf8")) as { files: { name: string }[] };
const sources = intake.files.map((f) => ({ name: f.name, bytes: new Uint8Array(readFileSync(join(garmentDir, f.name))) }));
const note = readFileSync(join(garmentDir, "note.txt"), "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /^[A-Za-z][^:]*: \S/.test(l))
  .join("; ");
const garmentNote = `${basename(garmentDir)}: ${note || "no note"}`;

console.log(`job ${jobId}: ${sources.length} source photo(s) from ${garmentDir}, providers:`);
for (const [step, label] of Object.entries(providers.mode.labels)) console.log(`  ${step}: ${label}`);

const result = await runJob({ jobId, garmentNote, scenes: ["studio"], sources }, { outRoot: jobsRoot, providers: providers.providers, provenance: providers.mode.provenance });

console.log(`receipt: ${join(result.dir, "receipt.jsonl")} (head ${result.head})`);
for (const file of logs) console.log(`verifier log: ${file}`);
if (result.refused) {
  console.log(`REFUSE before any render: ${result.refused.rule}: ${result.refused.reason}`);
  process.exitCode = 1;
}
for (const r of result.renders) {
  console.log(`${r.render_id}: ${r.decision}${r.cited ? ` (${r.cited.rule}: ${r.cited.reason})` : ""}`);
}
