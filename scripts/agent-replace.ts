// npm run agent:replace
//
// The evidence-checking agent's replace-the-first-photo action on the two real seller pairs (Manish and Grok,
// 31 Oct 2026: "implement option 1, replace the first photo ... Re-run live on data/seller-pairs/shirt-pink and
// kurta-mustard with the good photo as the replacement (budget cap 0.20 USD). Report the real verdicts, even if
// still REFUSE."). The 30 Oct run (evidence/agent-real-2026-10-30.json) showed the blocker: the fidelity check
// measures against photo 1 only, and photo 1 was the bad one.
//
// Each job, playing the seller honestly with only the photos the seller gave:
//   1. The seller lists the bad photo as photo 1 (the view the seller would pick). The render is the stand-in:
//      the seller's own full-length front photo, nothing generated. run-1 is the free offline check.
//   2. The seller approves one paid re-check; the agent runs the live gate (SAM 3.1 and Muse Spark 1.3 on
//      api.meta.ai, metered on the Meta ledger) and reads its receipt.
//   3. If the agent asks to replace photo 1, the seller approves and gives the full-length front; the agent checks
//      it and runs the gate again from the start, offline, as it always does first. The seller approves one more
//      paid re-check and the agent runs the live gate. If the agent does not ask, the job stops there.
// A hard stop: before each paid re-check, the Meta spend of this run plus 0.05 USD (above any single run so far)
// must stay within 0.20 USD, or the run stops. Nothing is published. The result goes to
// evidence/agent-replace-2026-10-31.json; records under evidence/agent-replace-2026-10-31/store/records; the
// store's photo copies are removed afterwards (the same bytes are in data/seller-pairs, by the hash on each receipt).
//
// Options: --jobs a,b runs only those jobs; --tag T writes evidence/agent-replace-T(.json) instead; --budget USD
// lowers the cap. Used once on 31 Oct after the view-label trigger was added (Manish: "Yes, add and re-run"):
// --jobs kurta-mustard --tag 2026-10-31-label --budget 0.1244 (what was left of the 0.20 USD cap).

import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { makeConfig } from "../src/agent/config.ts";
import { FileQueue, drainQueue } from "../src/agent/queue.ts";
import { outcomeOf } from "../src/agent/reasons.ts";
import { approve, createJob, replacePrimary } from "../src/agent/service.ts";
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
const { values: opt } = parseArgs({ options: { jobs: { type: "string" }, tag: { type: "string", default: "2026-10-31" }, budget: { type: "string" } } });
if (!/^[0-9a-z-]{1,40}$/.test(opt.tag!)) throw new Error("--tag must be lowercase letters, digits and dashes");
const OUT = join(ROOT, "evidence", `agent-replace-${opt.tag}`);
const SUMMARY = join(ROOT, "evidence", `agent-replace-${opt.tag}.json`);
const SELLER = "seller-manish";
const APPROVER = "Manish Patel";
const BUDGET_USD = opt.budget === undefined ? 0.2 : Number(opt.budget);
if (!(BUDGET_USD > 0 && BUDGET_USD <= 0.2)) throw new Error("--budget must be above 0 and at most 0.20 USD");
const PER_RUN_MARGIN_USD = 0.05;

const ALL_JOBS: readonly { job: string; garment: string; bad: string; badView: View; good: string }[] = [
  { job: "shirt-pink", garment: "shirt-pink", bad: "1-cropped.jpg", badView: "full_length_front", good: "2-full-front.jpg" },
  { job: "kurta-mustard", garment: "kurta-mustard", bad: "1-back-cropped.jpg", badView: "full_length_back", good: "2-full-front.jpg" },
];
const JOBS = opt.jobs ? ALL_JOBS.filter((j) => opt.jobs!.split(",").includes(j.job)) : ALL_JOBS;
if (JOBS.length === 0) throw new Error("--jobs matched no job");

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
const spentNow = () => spendSummary(ledger, META_LIMIT).spent_usd - before.spent_usd;
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

/** The hard budget stop, checked before each paid re-check is approved. */
function withinBudget(): boolean {
  const spent = spentNow();
  if (spent + PER_RUN_MARGIN_USD > BUDGET_USD + 1e-9) {
    console.log(`budget stop: ${spent.toFixed(4)} USD spent + ${PER_RUN_MARGIN_USD} margin would pass ${BUDGET_USD} USD`);
    return false;
  }
  return true;
}

function runRow(job: string, r: JobRecord["runs"][number]) {
  const o = outcomeOf(store.readRunReceipt(SELLER, job, r.n));
  const fid = store.readRunReceipt(SELLER, job, r.n).find((e) => e.kind === "fidelity");
  const fp = (fid?.payload ?? null) as { decision?: string; metrics?: Record<string, number> | null; reasons?: string[] } | null;
  return {
    run: r.n, mode: r.mode, verifier: r.mode === "live" ? "muse-spark-1.3 (api.meta.ai)" : "canned-demo-verifier (no model judged the image)",
    decision: r.decision, code: o.code, class: o.class, attributes: o.attributes,
    fidelity: fp ? { decision: fp.decision ?? null, metrics: fp.metrics ?? null, reasons: fp.reasons ?? [] } : null,
  };
}

const results = [];
let stopped: string | null = null;
for (const j of JOBS) {
  console.log(`\n== ${j.job}`);
  if (stopped) break;
  const sellerSteps: string[] = [];
  let rec = await createJob(store, gate, {
    seller: SELLER, job: j.job, garmentNote: note(j.garment),
    candidate: { file: "render-standin.jpg", bytes: photo(j.garment, j.good) },
    photos: [{ file: j.bad, bytes: photo(j.garment, j.bad), view: j.badView }],
  }, config);
  sellerSteps.push(`listed ${j.bad} as ${j.badView} (photo 1)`);
  if (!withinBudget()) { stopped = "budget"; break; }
  approve(store, SELLER, j.job, "paid_rerun", APPROVER, config);
  sellerSteps.push("approved paid re-check 1");
  rec = await step(j.job);
  const asked = rec.replace_request ?? null;
  console.log(`step 1: ${rec.status}; runs ${rec.runs.map((r) => `${r.n}:${r.mode}:${r.decision}`).join(" ")}; replace asked: ${asked ? asked.problems.join(", ") : "no"}`);

  let path: "replaced" | "not_asked" | "budget_stop" = "not_asked";
  if (asked) {
    replacePrimary(store, SELLER, j.job, { file: j.good, bytes: photo(j.garment, j.good), view: "full_length_front" }, APPROVER, config);
    sellerSteps.push(`approved the replacement and gave ${j.good} as photo 1`);
    rec = await step(j.job); // check the photo, run the gate again from the start offline, read, explain
    console.log(`step 2: ${rec.status}; runs ${rec.runs.map((r) => `${r.n}:${r.mode}:${r.decision}`).join(" ")}`);
    if (withinBudget()) {
      approve(store, SELLER, j.job, "paid_rerun", APPROVER, config);
      sellerSteps.push("approved paid re-check 2");
      rec = await step(j.job);
      console.log(`step 3: ${rec.status}; runs ${rec.runs.map((r) => `${r.n}:${r.mode}:${r.decision}`).join(" ")}`);
      path = "replaced";
    } else {
      path = "budget_stop";
      stopped = "budget";
    }
  }

  const runs = rec.runs.map((r) => runRow(j.job, r));
  const liveRuns = runs.filter((r) => r.mode === "live");
  results.push({
    job: j.job, garment: j.garment, bad_photo: `${j.bad} (${j.badView})`, replacement: `${j.good} (full_length_front)`,
    path, replace_asked_for: asked ? asked.problems : null, replace_text_en: asked?.text_en ?? null,
    first_live: liveRuns[0]?.decision ?? null, last_live: liveRuns.at(-1)?.decision ?? null,
    resolved: path === "replaced" && liveRuns[0]?.decision !== "RELEASE" && liveRuns.at(-1)?.decision === "RELEASE",
    seller_steps: sellerSteps, status: rec.status, explanation: rec.explanation, runs,
    replaced: rec.replaced ?? [], model_calls: rec.model_calls, estimate_usd: rec.cost_usd,
  });
}

const after = spendSummary(ledger, META_LIMIT);
rmSync(join(store.root, "blobs"), { recursive: true, force: true });
const dropImages = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) dropImages(p);
    else if (/\.(jpe?g|png)$/i.test(name)) rmSync(p);
  }
};
dropImages(store.root);
const resolvedCount = results.filter((r) => r.resolved).length;
const summary = {
  what: "Evidence-checking agent, replace-the-first-photo action, on the two real seller pairs (the same photos as evidence/agent-real-2026-10-30.json). The render is the stand-in: the seller's own full-length front photo, nothing generated; after the replacement, photo 1 and the stand-in render are the same file. Trigger signals: photo 1's SAM mask box, fixed patterns over verifier notes, and (from the 2026-10-31-label run on) the view label the seller picked for photo 1, so a RELEASE here says the evidence path now works, not that a generated image is faithful.",
  run_on: new Date().toISOString().slice(0, 10),
  live_providers: live.mode.labels,
  budget_usd: BUDGET_USD,
  stopped,
  resolved: `${resolvedCount} of ${results.length}`,
  meta_spend_usd_this_run: Math.round((after.spent_usd - before.spent_usd) * 10000) / 10000,
  jobs: results,
};
writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\nresolved: ${resolvedCount} of ${results.length}`);
console.log(summaryLine("Meta spend", after));
console.log(`wrote ${SUMMARY}`);
