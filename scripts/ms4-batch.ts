// npm run ms4 [-- --dry-run] [-- --score-only]
//
// MS4 (Grok, 29 Oct 15:54 IST on #23): the Muse Spark cross-check matrix
// planned in src/ms4.ts. Each (garment photos, render) pair goes to Muse Spark
// 1.3 on the Meta Model API (api.meta.ai) MS4_REPEATS times with the same
// garment-check prompt the gate's verifier uses; no job, receipt or render is
// written. Every call is metered on the Meta ledger (%LOCALAPPDATA%\ProofShot\
// meta-ledger.json) and refused before it is sent past the 80 USD batch cap (the
// reserve only with PROOFSHOT_USE_RESERVE=1, never set here). MODEL_API_KEY is
// read from the process or User env and never printed; each call's redacted log
// goes to evidence/ms4/verifier-<started_at>.json. Answers are appended to
// evidence/ms4-runs.jsonl, so a stopped batch resumes; the score goes to
// evidence/ms4-summary.json.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseRenderLabels } from "../src/calibrate.ts";
import { MS4_REPEATS, garmentPhotos, planMs4, recordedDecisions, scoreMs4 } from "../src/ms4.ts";
import type { Ms4Pair, Ms4Run } from "../src/ms4.ts";
import { parseFindings } from "../src/schema.ts";
import { META_LIMIT, accountLedger, meteredFetch, spendSummary, summaryLine, tokensUsd } from "../src/spend-meta.ts";
import { META_KEY_ENV, META_VERIFIER_MODEL, metaVerifier, resolveUserEnvKey } from "../src/verifier-meta.ts";
import { writeVerifierLog } from "./verifier-log.ts";

const CONCURRENCY = 4;
const STOP_BELOW_USD = 0.5;
const RUNS = "evidence/ms4-runs.jsonl";
const SUMMARY = "evidence/ms4-summary.json";
const dryRun = process.argv.includes("--dry-run");
const scoreOnly = process.argv.includes("--score-only");

const labels = parseRenderLabels(JSON.parse(readFileSync("data/calibration/labels.json", "utf8")));
const plan = planMs4("data/jobs", "data/garments", labels);
for (const s of plan.skipped) console.log(`skip ${s.what}: ${s.reason}`);
for (const p of plan.pairs) console.log(`pair ${p.id}: ${p.expected} (${p.render_path})`);
console.log(`${plan.pairs.length} pairs x ${MS4_REPEATS} = ${plan.pairs.length * MS4_REPEATS} calls planned`);
if (dryRun) process.exit(0);

const ledger = accountLedger("meta", process.env);
if (!ledger) {
  console.error("no Meta ledger path (LOCALAPPDATA is not set): MS4 does not run unmetered");
  process.exit(2);
}

function readRuns(): Ms4Run[] {
  if (!existsSync(RUNS)) return [];
  return readFileSync(RUNS, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Ms4Run);
}

let stopped: string | null = null;
if (!scoreOnly) {
  const found = resolveUserEnvKey(process.env, META_KEY_ENV);
  if (!found) {
    console.error(`no ${META_KEY_ENV} in the process or User env: MS4 not run`);
    process.exit(2);
  }
  const fetch = meteredFetch((url, init) => globalThis.fetch(url, init), { kind: "muse", account: "meta", ledger, env: process.env });
  const verifier = metaVerifier({ key: found.key, env: process.env, fetch, onCall: (log) => void writeVerifierLog("evidence/ms4", log) });
  mkdirSync("evidence/ms4", { recursive: true });

  const done = new Set(readRuns().filter((r) => r.ok).map((r) => `${r.pair_id}#${r.rep}`));
  const todo: { pair: Ms4Pair; rep: number }[] = [];
  for (let rep = 1; rep <= MS4_REPEATS; rep++) for (const pair of plan.pairs) if (!done.has(`${pair.id}#${rep}`)) todo.push({ pair, rep });
  console.log(`${todo.length} calls to make (${done.size} already answered)`);

  const photos = new Map<string, { name: string; bytes: Uint8Array }[]>();
  const sourcesOf = (dir: string) => {
    if (!photos.has(dir)) photos.set(dir, garmentPhotos(dir).map((p) => ({ name: p.name, bytes: new Uint8Array(readFileSync(p.path)) })));
    return photos.get(dir)!;
  };

  let next = 0;
  const worker = async () => {
    while (next < todo.length && !stopped) {
      const { pair, rep } = todo[next++]!;
      if (spendSummary(ledger, META_LIMIT).batch_left_usd < STOP_BELOW_USD) {
        stopped = "less than 0.5 USD of the Meta batch cap left";
        break;
      }
      const started_at = new Date().toISOString();
      let run: Ms4Run;
      try {
        const out = await verifier.verify({ sources: sourcesOf(pair.garment_dir), render: new Uint8Array(readFileSync(pair.render_path)), renderId: `${pair.id}#${rep}`, scene: "studio" });
        const findings = parseFindings(out.raw).map((f) => ({ attribute: f.attribute, verdict: f.verdict, confidence: f.confidence }));
        run = { pair_id: pair.id, rep, started_at, ok: true, findings };
      } catch (e) {
        const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        run = { pair_id: pair.id, rep, started_at, ok: false, error };
        if (e instanceof Error && e.name === "SpendCapError") stopped = error;
      }
      appendFileSync(RUNS, `${JSON.stringify(run)}\n`);
      console.log(`${pair.id} #${rep} ${pair.expected}: ${run.ok ? "answered" : `failed (${run.error})`}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (stopped) console.error(`stopped: ${stopped}`);
}

// One run per (pair, rep): an answered attempt if there is one, else the last failure.
const all = readRuns();
const byKey = new Map<string, Ms4Run>();
for (const r of all) {
  const k = `${r.pair_id}#${r.rep}`;
  const had = byKey.get(k);
  if (!had || (!had.ok && r.ok) || (!had.ok && !r.ok)) byKey.set(k, r);
}
const runs = [...byKey.values()];
const photoGarment = new Map<string, string>();
for (const g of plan.garments) for (const p of garmentPhotos(join("data/garments", g))) photoGarment.set(p.sha256, g);
const score = scoreMs4(plan.pairs, runs, recordedDecisions("data/jobs", photoGarment));
const meta = spendSummary(ledger, META_LIMIT);
const ledgerEntries = ledger.read();
// MS4's spend: the ledger rule (tokens x price) over MS4's own call logs in evidence/ms4/, so Meta calls
// made by other jobs in the same hours (NR3, MS2 shirts) are not counted here.
let batchUsd = 0;
let batchCalls = 0;
for (const name of readdirSync("evidence/ms4").filter((n) => n.endsWith(".json"))) {
  const log = JSON.parse(readFileSync(join("evidence/ms4", name), "utf8")) as { response?: { body?: { usage?: { input_tokens?: number; output_tokens?: number } } } };
  const u = log.response?.body?.usage;
  batchCalls++;
  if (typeof u?.input_tokens === "number" && typeof u.output_tokens === "number") batchUsd += tokensUsd(u.input_tokens, u.output_tokens);
}
batchUsd = Math.round(batchUsd * 1e6) / 1e6;

writeFileSync(SUMMARY, `${JSON.stringify({
  item: "MS4: Muse Spark cross-check matrix (Grok, #23, 29 Oct 15:54 IST)",
  verifier: { provider: "meta", model: META_VERIFIER_MODEL, base: "https://api.meta.ai/v1", prompt: "the gate verifier's own garment-check prompt (src/verifier.ts)" },
  repeats: MS4_REPEATS,
  truth: "data/calibration/labels.json: which garment each render image shows and what a try-on changed; the 7 try-on labels come from Grok's 28 Oct #23 review lines, not from a visual check in this batch",
  decision_rule: "the gate's own decide() over Muse Spark's findings alone (verifier only, no fidelity); for gate_agreement, decide() with the job's recorded fidelity result, compared with the recorded gate decision",
  garments: plan.garments,
  renders: plan.renders.map((r) => ({ render_sha256: r.render_sha256, path: r.path.split("\\").join("/"), shows: r.label.shows, ...(r.label.changed ? { changed: r.label.changed } : {}), jobs: r.jobs })),
  skipped: plan.skipped,
  tricky_photo_set: {
    status: "not run",
    reason: "the PS-SP1 list is not in proofshot-hackathon, proofshot (coordination) or the #23 comments, and no garment photos exist beyond kurta-01 and kurta-02 (shirt-01..03 have notes only)",
  },
  attempts: { lines: all.length, failed_attempts: all.filter((r) => !r.ok).length },
  ...score,
  spend: { account: "meta", batch_usd: batchUsd, batch_calls: batchCalls, estimated: true, ledger_spent_usd: meta.spent_usd, ledger_calls: ledgerEntries.length, batch_cap_usd: meta.cap_usd, batch_left_usd: meta.batch_left_usd, reserve_used: false },
  limits: "Small sample: 2 photographed garments (both women's kurtas), one photo set each, 3 repeats per pair. A rate here says how this checker behaved on these pairs, not how it behaves in general.",
}, null, 2)}\n`);
console.log(`wrote ${SUMMARY}`);
console.log(`same ${JSON.stringify(score.by_expected.same)}; changed ${JSON.stringify(score.by_expected.changed)}; mismatch catch ${JSON.stringify(score.mismatch_catch)}`);
console.log(`consistency ${JSON.stringify(score.consistency)}; gate agreement ${score.gate_agreement.agree}/${score.gate_agreement.compared}`);
console.log(summaryLine("Meta spend", meta));
