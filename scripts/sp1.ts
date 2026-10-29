// npm run sp1 [-- --build-only]
//
// SP1 (Grok, 29 Oct 18:20 IST on #23 6497097719): builds the seller-pain cases
// src/sp1.ts can make honestly into data/sp1/cases/<case>/ (synthetic, manifest
// per case), then runs each through the real pipeline, one job:live per case,
// with composite v2 as the renderer, SAM 3.1 masks and Muse Spark 1.3 on the
// Meta Model API (RENDER_PROVIDER, VERIFIER_PROVIDER, MODEL_SEGMENT and
// SEGMENT_PROMPT are set here for each child; MODEL_API_KEY is read by job:live
// from the process or User env and never printed). Every call is booked on the
// Meta ledger; the batch stops when less than STOP_BELOW_USD of the batch cap is
// left, and never sets PROOFSHOT_USE_RESERVE. Jobs go to data/sp1/jobs, not
// data/jobs, so the shop is not touched. A job already on disk is not re-run;
// its receipt is read again. Writes evidence/sp1-tricky-set.json: expected vs
// actual per case, and the cases that need a real photo as not run.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { META_LIMIT, accountLedger, spendSummary, summaryLine } from "../src/spend-meta.ts";
import { SP1_CASES, buildTransformCase, gateOf, sp1Summary } from "../src/sp1.ts";
import type { Sp1Row } from "../src/sp1.ts";

const STOP_BELOW_USD = 0.5;
const buildOnly = process.argv.includes("--build-only");
const casesRoot = "data/sp1/cases";
const jobsRoot = "data/sp1/jobs";

const planned: { id: string; garmentDir: string; prompt: string; render?: string }[] = [];
for (const c of SP1_CASES) {
  if (c.build.kind === "transform") {
    const built = buildTransformCase(c, "data/garments", casesRoot);
    console.log(`built ${c.id}: ${built.photo.width}x${built.photo.height} ${built.photo.sha256.slice(0, 12)}`);
    planned.push({ id: c.id, garmentDir: built.dir.split("\\").join("/"), prompt: c.segment_prompt });
  } else if (c.build.kind === "other_garment_render") {
    planned.push({ id: c.id, garmentDir: `data/garments/${c.garment}`, prompt: c.segment_prompt, render: `data/garments/${c.build.render_garment}/1-front.jpg` });
  }
}
if (buildOnly) process.exit(0);

const ledger = accountLedger("meta", process.env);
if (!ledger) {
  console.error("no Meta ledger path (LOCALAPPDATA is not set): SP1 does not run unmetered");
  process.exit(2);
}
mkdirSync(jobsRoot, { recursive: true });
const stopped: string[] = [];
for (const p of planned) {
  if (existsSync(join(jobsRoot, p.id))) continue;
  const left = spendSummary(ledger, META_LIMIT).batch_left_usd;
  if (left < STOP_BELOW_USD) {
    stopped.push(`stopped before ${p.id}: ${left} USD of the batch cap left`);
    break;
  }
  console.log(`\n== ${p.id}`);
  const args = ["--experimental-strip-types", "scripts/live-job.ts", ...(p.render ? ["--render", p.render] : []), p.garmentDir, p.id, jobsRoot];
  const env: Record<string, string | undefined> = { ...process.env, RENDER_PROVIDER: "composite", VERIFIER_PROVIDER: "meta", MODEL_SEGMENT: "meta/sam-3.1 (api.meta.ai)", SEGMENT_PROMPT: p.prompt };
  delete env.PROOFSHOT_RENDER;
  delete env.PROOFSHOT_USE_RESERVE;
  const run = spawnSync(process.execPath, args, { stdio: "inherit", env });
  if (run.status === 2) {
    stopped.push(`${p.id}: job:live exit 2 (verifier not live or id taken)`);
    break;
  }
}

const rows: Sp1Row[] = SP1_CASES.map((c) => {
  const base = { n: c.n, case: c.id, pain: c.pain, expected: c.expected, expected_rule: c.expected_rule };
  if (c.build.kind === "needs_real_photo") return { ...base, status: "not_run", note: `needs real photo, not run: ${c.build.why}` };
  const receipt = join(jobsRoot, c.id, "receipt.jsonl");
  const gate = existsSync(receipt) ? gateOf(readFileSync(receipt, "utf8")) : null;
  const how = c.build.kind === "transform"
    ? `synthetic: ${JSON.stringify(c.build.transform)} on data/garments/${c.garment}/1-front.jpg (manifest in ${casesRoot}/${c.id})`
    : `the image to publish is data/garments/${c.build.render_garment}/1-front.jpg, the sources are ${c.garment}'s own photos`;
  return {
    ...base,
    status: "run",
    synthetic: c.build.kind === "transform",
    actual: gate?.decision ?? null,
    actual_reason: gate?.reason ?? null,
    agrees: gate ? gate.decision === c.expected : null,
    note: gate ? how : `${how}; no receipt (job not run)`,
  };
});
const out = {
  item: "SP1 seller-pain tricky set (#23 6497097719)",
  generated_by: "npm run sp1",
  pipeline: "job:live: RENDER_PROVIDER=composite (v2), VERIFIER_PROVIDER=meta (Muse Spark 1.3, api.meta.ai), MODEL_SEGMENT meta/sam-3.1 (api.meta.ai), SEGMENT_PROMPT shirt (transform cases) or kurta (case 10); thresholds unchanged",
  jobs_root: jobsRoot,
  summary: sp1Summary(rows),
  rows,
  stopped,
  limits: [
    "Synthetic cases are one pixel transform of the owner's shirt-plaid front photo, so they test the checks, not a seller's real phone.",
    "shirt-plaid is the base because its untouched front passes composite v2's pre-check; the untouched kurta-01 and kurta-02 fronts already fail it on clipping.",
    "Cases 2, 3, 4, 5, 6, 11 and 12 need a real photo and were not run.",
    "A disagreement is a finding to report; no threshold was changed for it.",
  ],
};
writeFileSync("evidence/sp1-tricky-set.json", `${JSON.stringify(out, null, 2)}\n`);
console.log("\nSP1:");
for (const r of rows) console.log(`  ${r.n} ${r.case}: expected ${r.expected}, ${r.status === "run" ? `actual ${r.actual ?? "none"}${r.actual_reason ? ` (${r.actual_reason})` : ""}` : "not run"}`);
for (const s of stopped) console.log(`  ${s}`);
console.log(summaryLine("Meta spend", spendSummary(ledger, META_LIMIT)));
