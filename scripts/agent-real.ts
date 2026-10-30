// npm run agent:real
//
// The Evidence Recovery Agent on real seller photos (Manish, 30 Oct 2026, in chat: "copy them into the repo as
// new jobs only after checking for faces/personal data, run the Evidence Recovery Agent on them, and report the
// real resolution rate and seller steps. Don't invent or synthesize photos." Paid calls approved in chat the
// same day). Two garments in data/seller-pairs (shirt-pink, kurta-mustard; kept out of data/garments so the shop and the calibration sets do not pick them up), each a deliberately bad photo and a
// full-length good one, intaken (metadata removed) after a person-and-personal-data check.
//
// Each job plays the seller honestly with only the photos the seller gave:
//   1. The seller lists the bad photo, labelled with the view the seller would pick. The render is the stand-in:
//      the seller's own full-length front photo, nothing generated (as in the committed ms2 jobs). run-1 is the
//      free offline check (the canned verifier, which judges nothing).
//   2. The seller approves one paid re-check; the agent runs the live gate (SAM 3.1 and Muse Spark 1.3 on
//      api.meta.ai, metered on the Meta ledger) and reads its receipt.
//   3. If the agent asks for a photo the seller has (the good photo is a full_length_front), the seller adds it;
//      the agent checks it and re-runs offline, as it always does. The seller approves one more paid re-check and
//      the agent runs the live gate again. If the agent asks for a view the seller has no photo of, the job stops
//      there. If it asks for nothing, the seller adds the good photo unprompted (a control, not a resolution) and
//      approves the second paid re-check.
// Nothing is published. The result goes to evidence/agent-real-2026-10-30.json; receipts and the agent section
// stay under evidence/agent-real-2026-10-30/records; the photo copies the store made are removed afterwards
// (the same bytes are in data/seller-pairs, by the hash on each receipt).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeConfig } from "../src/agent/config.ts";
import { summarizeMetrics } from "../src/agent/metrics.ts";
import { FileQueue, drainQueue } from "../src/agent/queue.ts";
import { outcomeOf } from "../src/agent/reasons.ts";
import { addPhoto, approve, createJob } from "../src/agent/service.ts";
import { Store } from "../src/agent/store.ts";
import type { JobRecord } from "../src/agent/store.ts";
import type { View } from "../src/agent/vocab.ts";
import { cannedDemoProviders, pipelineGate } from "../src/recovery-gate.ts";
import { fileRenderer } from "../src/render.ts";
import { providersFromEnv } from "../src/serve.ts";
import { META_LIMIT, accountLedger, meteredFetch, spendSummary, summaryLine } from "../src/spend-meta.ts";
import { META_KEY_ENV, resolveUserEnvKey } from "../src/verifier-meta.ts";
import { writeSamLog, writeVerifierLog } from "./verifier-log.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "evidence", "agent-real-2026-10-30");
const SUMMARY = join(ROOT, "evidence", "agent-real-2026-10-30.json");
const SELLER = "seller-manish";
const APPROVER = "Manish Patel";

const JOBS: readonly { job: string; garment: string; bad: string; badView: View; good: string; goodView: View }[] = [
  { job: "shirt-pink", garment: "shirt-pink", bad: "1-cropped.jpg", badView: "full_length_front", good: "2-full-front.jpg", goodView: "full_length_front" },
  { job: "kurta-mustard", garment: "kurta-mustard", bad: "1-back-cropped.jpg", badView: "full_length_back", good: "2-full-front.jpg", goodView: "full_length_front" },
];

if (existsSync(OUT) || existsSync(SUMMARY)) {
  console.error(`${OUT} already exists: these jobs ran once; their records are the result`);
  process.exit(2);
}
const ledger = accountLedger("meta", process.env);
if (!ledger) {
  console.error("no Meta ledger path (LOCALAPPDATA is not set): no unmetered live run");
  process.exit(2);
}
const key = resolveUserEnvKey(process.env, META_KEY_ENV);
if (!key) {
  console.error(`no ${META_KEY_ENV} in the process or User env: no live run`);
  process.exit(2);
}
const logs = join(OUT, "logs");
const env = { ...process.env, [META_KEY_ENV]: key.key, VERIFIER_PROVIDER: "meta", MODEL_SEGMENT: "meta/sam-3.1 (api.meta.ai)", RENDER_PROVIDER: "stand-in" };
const live = providersFromEnv(env, {
  sam: { fetch: meteredFetch((url, init) => fetch(url, init), { kind: "sam", account: "meta", ledger, env: process.env }), onCall: (log) => void writeSamLog(logs, log) },
  metaVerifierFetch: meteredFetch((url, init) => fetch(url, init), { kind: "muse", account: "meta", ledger, env: process.env }),
  onVerifierCall: (log) => void writeVerifierLog(logs, log),
});
if (live.mode.fixture) {
  console.error(`the verifier is not live (${live.mode.labels.verify}): no job run`);
  process.exit(2);
}
for (const [step, label] of Object.entries(live.mode.labels)) console.log(`live ${step}: ${label}`);

const before = spendSummary(ledger, META_LIMIT);
const store = new Store(join(OUT, "store"));
const queue = new FileQueue(store.root);
// One live gate run is SAM on every photo plus one Muse call; 30 s is too short for that, so the step gets 5 min.
const config = makeConfig({ stepTimeoutMs: 300_000 });
const gate = pipelineGate({
  offline: cannedDemoProviders,
  live: (input) => ({ ...live.providers, renderer: fileRenderer(`${input.job}/render-standin.jpg (the seller's own full-length front photo)`, input.candidate) }),
});
const photo = (garment: string, file: string) => new Uint8Array(readFileSync(join(ROOT, "data", "seller-pairs", garment, file)));
const note = (garment: string) =>
  `${garment}: ${readFileSync(join(ROOT, "data", "seller-pairs", garment, "note.txt"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Za-z][^:]*: \S/.test(l)).join("; ")}`;

async function step(job: string): Promise<JobRecord> {
  queue.enqueue(SELLER, job);
  await drainQueue(queue, { store, gate, config });
  return store.readJob(SELLER, job);
}

function runRow(job: string, r: JobRecord["runs"][number]) {
  const o = outcomeOf(store.readRunReceipt(SELLER, job, r.n));
  return { run: r.n, mode: r.mode, verifier: r.mode === "live" ? "muse-spark-1.3 (api.meta.ai)" : "canned-demo-verifier (no model judged the image)", decision: r.decision, code: o.code, class: o.class, attributes: o.attributes, views: o.views };
}

const results = [];
for (const j of JOBS) {
  console.log(`\n== ${j.job}`);
  const sellerSteps: string[] = [];
  const agentAsked: (string | null)[] = [];
  let rec = await createJob(store, gate, {
    seller: SELLER, job: j.job, garmentNote: note(j.garment),
    candidate: { file: "render-standin.jpg", bytes: photo(j.garment, j.good) },
    photos: [{ file: j.bad, bytes: photo(j.garment, j.bad), view: j.badView }],
  }, config);
  sellerSteps.push(`listed ${j.bad} as ${j.badView}`);
  approve(store, SELLER, j.job, "paid_rerun", APPROVER, config);
  sellerSteps.push("approved paid re-check 1");
  rec = await step(j.job);
  agentAsked.push(rec.request?.view ?? null);
  console.log(`step 1: ${rec.status}; runs ${rec.runs.map((r) => `${r.n}:${r.mode}:${r.decision}`).join(" ")}; asked for ${rec.request?.view ?? "nothing"}`);

  let path: "agent_request" | "unprompted_control" | "stopped_no_such_photo" | "none_needed";
  const liveRun2 = rec.runs.at(-1)!;
  if (liveRun2.mode === "live" && liveRun2.decision === "RELEASE") path = "none_needed";
  else if (rec.request && rec.request.view === j.goodView) path = "agent_request";
  else if (rec.request) path = "stopped_no_such_photo";
  else path = "unprompted_control";

  if (path === "agent_request" || path === "unprompted_control") {
    addPhoto(store, SELLER, j.job, { file: j.good, bytes: photo(j.garment, j.good), view: j.goodView }, config);
    sellerSteps.push(`added ${j.good} as ${j.goodView}${path === "agent_request" ? " (asked for)" : " (not asked for)"}`);
    if (path === "agent_request") {
      rec = await step(j.job); // check the photo, offline re-run, read, explain
      agentAsked.push(rec.request?.view ?? null);
      console.log(`step 2: ${rec.status}; runs ${rec.runs.map((r) => `${r.n}:${r.mode}:${r.decision}`).join(" ")}`);
    }
    approve(store, SELLER, j.job, "paid_rerun", APPROVER, config);
    sellerSteps.push("approved paid re-check 2");
    rec = await step(j.job);
    agentAsked.push(rec.request?.view ?? null);
    console.log(`final step: ${rec.status}; runs ${rec.runs.map((r) => `${r.n}:${r.mode}:${r.decision}`).join(" ")}`);
  }

  const runs = rec.runs.map((r) => runRow(j.job, r));
  const liveRuns = runs.filter((r) => r.mode === "live");
  const firstLive = liveRuns[0]!;
  const lastLive = liveRuns.at(-1)!;
  const resolved = path === "agent_request" && firstLive.decision !== "RELEASE" && lastLive.decision === "RELEASE";
  results.push({
    job: j.job, garment: j.garment, bad_photo: `${j.bad} (${j.badView})`, good_photo: `${j.good} (${j.goodView})`,
    path, resolved_by_agent: resolved, first_live: firstLive.decision, last_live: lastLive.decision,
    agent_asked_for: agentAsked, seller_steps: sellerSteps, seller_step_count: sellerSteps.length - 1,
    status: rec.status, explanation: rec.explanation, runs, model_calls: rec.model_calls, estimate_usd: rec.cost_usd,
  });
}

const after = spendSummary(ledger, META_LIMIT);
const metrics = summarizeMetrics(store.root);
// The store's photo copies and the render copies in each run are the same bytes as data/seller-pairs (hash on the
// receipts); they are removed so the evidence holds records only.
rmSync(join(store.root, "blobs"), { recursive: true, force: true });
const dropImages = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) dropImages(p);
    else if (/\.(jpe?g|png)$/i.test(name)) rmSync(p);
  }
};
dropImages(store.root);
mkdirSync(OUT, { recursive: true });
const resolvedCount = results.filter((r) => r.resolved_by_agent).length;
const summary = {
  what: "Evidence Recovery Agent on real seller photos: two garments, each a deliberately bad photo and a full-length good one, checked for people and personal data before intake. The render is the stand-in (the seller's own full-length front photo, nothing generated), so a RELEASE here says the evidence matched, not that a generated image is faithful.",
  run_on: new Date().toISOString().slice(0, 10),
  live_providers: live.mode.labels,
  resolved_by_agent: `${resolvedCount} of ${results.length}`,
  meta_spend_usd_this_run: Math.round((after.spent_usd - before.spent_usd) * 10000) / 10000,
  jobs: results,
  metrics,
};
writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\nresolved by the agent: ${resolvedCount} of ${results.length}`);
console.log(summaryLine("Meta spend", after));
console.log(`wrote ${SUMMARY}`);
