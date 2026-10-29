// npm run ms3 [-- --dry-run]
//
// MS3 (Grok, 29 Oct 13:45 on #23): runs the plan from src/ms3.ts, one
// job:live --render per item, on Muse Spark via the Meta Model API with SAM 3.1
// masks (VERIFIER_PROVIDER=meta, MODEL_SEGMENT, SEGMENT_PROMPT are set here for
// each child, MODEL_API_KEY is read by job:live from the process or User env and
// never printed). Every call is booked on the Meta ledger by job:live; the batch
// stops before an item when less than STOP_BELOW_USD of the 80 USD batch cap is
// left, and job:live itself refuses a call past the cap (the reserve only with
// PROOFSHOT_USE_RESERVE=1, passed through unchanged). An ms3-<job> already on
// disk is skipped, so a stopped batch resumes.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { planMs3 } from "../src/ms3.ts";
import { META_LIMIT, accountLedger, spendSummary, summaryLine } from "../src/spend-meta.ts";

const STOP_BELOW_USD = 0.5;
const dryRun = process.argv.includes("--dry-run");
const jobsRoot = "data/jobs";
const plan = planMs3(jobsRoot, "data/garments");

for (const s of plan.skipped) console.log(`skip ${s.job}: ${s.reason}`);
for (const i of plan.items) console.log(`plan ${i.job_id}: ${i.render_path} on ${i.garment_dir} (SAM prompt ${i.segment_prompt})`);
if (dryRun) process.exit(0);

const ledger = accountLedger("meta", process.env);
if (!ledger) {
  console.error("no Meta ledger path (LOCALAPPDATA is not set): MS3 does not run unmetered");
  process.exit(2);
}

const outcomes: string[] = [];
for (const item of plan.items) {
  if (existsSync(join(jobsRoot, item.job_id))) {
    outcomes.push(`${item.job_id}: already on disk, skipped`);
    continue;
  }
  const left = spendSummary(ledger, META_LIMIT).batch_left_usd;
  if (left < STOP_BELOW_USD) {
    outcomes.push(`stopped before ${item.job_id}: ${left} USD of the batch cap left`);
    break;
  }
  console.log(`\n== ${item.job_id} (from ${item.from_job})`);
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/live-job.ts", "--render", item.render_path, item.garment_dir, item.job_id], {
    stdio: "inherit",
    env: { ...process.env, VERIFIER_PROVIDER: "meta", MODEL_SEGMENT: "meta/sam-3.1 (api.meta.ai)", SEGMENT_PROMPT: item.segment_prompt },
  });
  outcomes.push(`${item.job_id}: job:live exit ${run.status}`);
  if (run.status === 2) break; // the verifier is not live or the id is taken: nothing more will run
}

console.log("\nMS3 batch:");
for (const o of outcomes) console.log(`  ${o}`);
console.log(summaryLine("Meta spend", spendSummary(ledger, META_LIMIT)));
