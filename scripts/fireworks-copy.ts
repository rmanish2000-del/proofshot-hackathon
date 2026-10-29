// npm run copy:fireworks -- <job-id> [<job-id> ...]
//
// FW1 / FW1b: for each committed job, writes the receipt summary and the
// listing copy (src/fireworks-copy.ts) to data/copy/<job-id>.json, and one
// redacted call log per Fireworks request to evidence/fireworks-<started_at>.json.
// The model is Meta muse-spark-open on Fireworks unless FIREWORKS_MODEL says
// otherwise; each record names the model id it sent, or "none" for the template.
// With no FIREWORKS_API_KEY in the process or the Windows User env, both texts
// come from the template and say fallback_reason no_api_token. Spend goes to
// %LOCALAPPDATA%\ProofShot\fireworks-ledger.json, capped in src/fireworks-copy.ts.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { copyFacts, fireworksLedger, writeCopy } from "../src/fireworks-copy.ts";
import type { CopyRecord, CopyTask, FireworksCallLog, FireworksFetch } from "../src/fireworks-copy.ts";
import { parseReceipt, verifyChain } from "../src/receipt.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TASKS: readonly CopyTask[] = ["receipt_summary", "listing_copy"];

function writeLog(log: FireworksCallLog): string {
  const dir = join(ROOT, "evidence");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `fireworks-${log.started_at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(log, null, 2)}\n`);
  return file;
}

const jobs = process.argv.slice(2);
if (jobs.length === 0 || jobs.some((j) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(j) || j.startsWith("upload-"))) {
  console.error("usage: npm run copy:fireworks -- <committed job id> [...]");
  process.exit(2);
}

const ledger = fireworksLedger(process.env);
for (const job of jobs) {
  const entries = parseReceipt(readFileSync(join(ROOT, "data", "jobs", job, "receipt.jsonl"), "utf8"));
  const chain = verifyChain(entries);
  if (!chain.ok) {
    console.error(`${job}: receipt does not verify, skipped`);
    process.exitCode = 1;
    continue;
  }
  const facts = copyFacts(job, entries);
  const records: CopyRecord[] = [];
  for (const task of TASKS) {
    const rec = await writeCopy(task, facts, {
      env: process.env,
      fetch: globalThis.fetch as unknown as FireworksFetch,
      ledger,
      onCall: (log) => console.log(`log ${writeLog(log)}`),
    });
    records.push(rec);
    console.log(`${job} ${task}: ${rec.provider} ${rec.model}${rec.fallback_reason ? ` (fallback_reason ${rec.fallback_reason})` : ""}${rec.cost_usd ? ` cost ${rec.cost_usd} USD` : ""}`);
  }
  const dir = join(ROOT, "data", "copy");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${job}.json`), `${JSON.stringify({ job_id: job, records }, null, 2)}\n`);
}
