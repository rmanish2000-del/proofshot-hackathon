// npm run evidence:pack
//
// #10 evidence pack from committed material only (Grok, 29 Oct 18:30 IST on
// proofshot #23; museum samples not used). Reads data/jobs receipts, the call
// logs in evidence/ and evidence/ms4/, evidence/ms4-summary.json,
// evidence/calibration-jobs-2026-10-29.json and data/copy; makes no request and
// writes, deterministically:
//   evidence/pack/results.csv   one row per render of every committed receipt
//   evidence/pack/summary.json  counts, decisions, per-stage latency and cost,
//                               MS4, calibration, copy, adversarial evidence
//   evidence/pack/README.md     the same as tables, for judges
// A test checks the committed pack equals what this script writes.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { callStats, jobRows, rowsCsv, summarize } from "../src/evidence-pack.ts";
import type { StageStats } from "../src/evidence-pack.ts";

const OUT = join("evidence", "pack");
const rows = jobRows(join("data", "jobs"));
const summary = summarize(rows);
const stages = callStats(["evidence", join("evidence", "ms4")]);
const readJson = (p: string) => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Record<string, any>) : null);

const ms4 = readJson(join("evidence", "ms4-summary.json"));
const cal = readJson(join("evidence", "calibration-jobs-2026-10-29.json"));
const x1 = (cal?.gate as { name: string }[] | undefined)?.find((c) => c.name === "x1") as (Record<string, number> & { cases?: { label: string; decision: string }[] }) | undefined;
// Judged as the label says: a same-garment render released, a different-garment render held (REVIEW or REFUSE).
const x1Cases = x1?.cases ?? [];
const asLabelled = x1Cases.filter((c) => (c.label === "same" ? c.decision === "RELEASE" : c.decision !== "RELEASE")).length;
const sameReview = x1Cases.filter((c) => c.label === "same" && c.decision === "REVIEW").length;

let texts = 0;
let byModel = 0;
const copyJobs: string[] = [];
for (const f of existsSync(join("data", "copy")) ? readdirSync(join("data", "copy")).sort() : []) {
  const j = JSON.parse(readFileSync(join("data", "copy", f), "utf8")) as { job_id: string; records: { generated: boolean }[] };
  copyJobs.push(j.job_id);
  texts += j.records.length;
  byModel += j.records.filter((r) => r.generated).length;
}

const adversarial = [
  { case: "wrong garment (render of B against photos of A)", expected: "REFUSE", evidence: "MS4 matrix, other_garment pairs", result: ms4 ? `${ms4.mismatch_catch.refused} of ${ms4.mismatch_catch.answered} runs REFUSE` : "not run" },
  { case: "deliberate mismatch job (kurta-02 photo as kurta-01's render)", expected: "REFUSE", evidence: "data/jobs/live-kurta-01-mismatch, ms3-live-kurta-01-mismatch", result: rows.filter((r) => /kurta-01-mismatch$/.test(r.job_id)).map((r) => `${r.job_id} ${r.decision}`).join("; ") },
  { case: "try-on that changed the garment (length)", expected: "REVIEW or REFUSE", evidence: "MS4 matrix, changed pairs (Muse Spark findings alone)", result: ms4 ? `${ms4.by_expected.changed.correct} of ${ms4.by_expected.changed.answered} runs held` : "not run" },
  { case: "tampered receipt: edited payload, reordered or deleted line, forged entry", expected: "chain FAIL", evidence: "test/receipt.test.ts, test/check.test.ts (TAMPERED); by hand: web/verify.html", result: "in npm test" },
  { case: "banned model id (muse-image-*)", expected: "refused before any request", evidence: "test/render.test.ts, test/verifier-meta.test.ts MS2 2", result: "in npm test" },
  { case: "verifier gives no usable answer (timeout, network error, empty, or an answer that is not JSON)", expected: "REFUSE not_verified", evidence: "test/gate-edge.test.ts; live: every receipt in the Result column", result: rows.filter((r) => r.verifier_error !== "").map((r) => `${r.job_id} ${r.decision} (${r.verifier_error.split(":")[0]})`).join("; ") },
];

const pack = {
  item: "#10 evidence pack from committed material (Grok, proofshot #23, 29 Oct 18:30 IST)",
  sources: {
    receipts: "data/jobs/*/receipt.jsonl",
    call_logs: "evidence/{sam,verifier,fireworks}-*.json, evidence/ms4/verifier-*.json",
    museum_samples: "not used (the Met / Rijksmuseum fetch was dropped on 29 Oct; no museum image is in this pack)",
  },
  receipts: summary,
  stages,
  ms4: ms4
    ? { pairs: ms4.pairs, runs: ms4.runs, answered: ms4.answered, by_expected: ms4.by_expected, mismatch_catch: ms4.mismatch_catch, consistency: ms4.consistency, gate_agreement: { compared: ms4.gate_agreement.compared, agree: ms4.gate_agreement.agree }, spend: ms4.spend }
    : null,
  calibration: x1 ? { factor: "x1 (config/fidelity.json)", same: x1.same, different: x1.different, judged_as_labelled: asLabelled, false_match: x1.false_match, false_refuse: x1.false_refuse, same_sent_to_review: sameReview, unmeasured: x1.unmeasured } : null,
  copy: {
    jobs: copyJobs.length, texts, by_model: byModel, template: texts - byModel,
    note: "texts are the final records in data/copy; the answered copy calls in stages are more, because retries, superseded runs and rewrites are logged too",
  },
  adversarial,
  limits: [
    `${summary.garments_with_receipts.length} real garments (${summary.garments_with_receipts.join(", ")}), all the owner's own; the plan for this pack (an issue in the private coordination repository, not in this one) asked for 12 or more, and no museum garments are used.`,
    "Latency is per committed call, across days and payload sizes; it is not a controlled benchmark.",
    "Cost is the ledger rule applied to logged usage (tokens x price table; SAM flat); no provider invoice was read.",
  ],
};

const fmt = (v: number | null, d = 0) => (v === null ? "n/a" : v.toFixed(d));
const stageName = (s: StageStats) => (s.answered === 0 ? `${s.stage}: ${s.calls} ${s.calls === 1 ? "call" : "calls"}, none answered, never used` : s.stage);
const stageRow = (s: StageStats) => `| ${stageName(s)} | ${s.calls} | ${s.answered} | ${s.failed} | ${fmt(s.latency_ms_median)} | ${fmt(s.latency_ms_p90)} | ${fmt(s.usd_per_call_median, 4)} | ${s.usd_total.toFixed(4)} |`;
const totals = (d: Readonly<Record<string, number>>) => Object.entries(d).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
const decisions = Object.entries(summary.decisions).map(([d, n]) => `${d} ${n}`).join(", ");
const verifierErrors = totals(summary.verifier_errors_by_kind);
const md = [
  "# Evidence pack, from committed material only",
  "",
  "Generated by `npm run evidence:pack` from the receipts in `data/jobs` and the call logs in `evidence/`. Generating this pack makes no new model calls; it reads committed call logs. No museum image (that fetch was dropped on 29 Oct). A test checks this file is current.",
  "",
  "## Receipts",
  "",
  `- ${summary.jobs} jobs, ${summary.renders} renders; ${summary.chains_ok} of ${summary.jobs} hash chains verify (one chain per job; ${summary.jobs_with_several_renders.join(", ") || "no job"} has more than one render).`,
  `- Garments with receipts: ${summary.garments_with_receipts.join(", ")}.`,
  `- Gate decisions per render: ${decisions}. Live renders (${summary.live_renders}): ${totals(summary.decisions_live)}. Fixture renders (${summary.renders - summary.live_renders}): ${totals(summary.decisions_fixture)}. Renders with no usable verifier answer (gate REFUSE not_verified): ${summary.verifier_errors} (${verifierErrors}). These are renders, not calls: a VerifierTransportError is a call counted as Failed in the table below, a VerifierProtocolError is a call that answered but whose output was not JSON.`,
  "- One row per render, with providers, model ids and tokens: `results.csv`.",
  "",
  "## Latency and cost per stage (committed call logs)",
  "",
  "| Stage | Calls | Answered | Failed | Median ms | p90 ms | Median USD/call | USD total |",
  "|---|---|---|---|---|---|---|---|",
  ...stages.map(stageRow),
  "",
  "Latency and USD count answered calls only. USD is the ledger rule applied to each logged usage (tokens x the price table; SAM at a flat 0.0025 USD from secondary sources): an estimate, not an invoice.",
  "",
  "## Verify a receipt offline",
  "",
  "Open `web/verify.html` served over local HTTP (checked that way; opening it from disk is not yet checked). It makes no network request: its Content-Security-Policy blocks every request. Give it a job's `receipt.jsonl` and its released image: it says VALID. Change one byte of the receipt and give it again: it says TAMPERED. `test/check.test.ts` runs the same check in Node with the same `src/core.js`.",
  "",
  "## Adversarial cases",
  "",
  "| Case | Expected | Evidence | Result |",
  "|---|---|---|---|",
  ...adversarial.map((a) => `| ${a.case} | ${a.expected} | ${a.evidence} | ${a.result} |`),
  "",
  ...(pack.ms4 ? ["## Muse Spark cross-check (MS4)", "", `${pack.ms4.pairs} pairs, ${pack.ms4.answered} of ${pack.ms4.runs} runs answered. Same garment: ${pack.ms4.by_expected.same.correct} of ${pack.ms4.by_expected.same.answered} released. Wrong garment: ${pack.ms4.mismatch_catch.refused} of ${pack.ms4.mismatch_catch.answered} refused. Changed by a try-on: ${pack.ms4.by_expected.changed.correct} of ${pack.ms4.by_expected.changed.answered} held. Same decision on all 3 runs: ${pack.ms4.consistency.same_decision_all_reps} of ${pack.ms4.consistency.pairs_scored} pairs.`, ""] : []),
  ...(pack.calibration ? ["## Calibration at the shipped thresholds", "", `${pack.calibration.same} same and ${pack.calibration.different} different recorded renders: ${pack.calibration.judged_as_labelled} of ${x1Cases.length} judged as their label says (same released, different held). ${pack.calibration.false_match} false matches; ${pack.calibration.false_refuse} false refusals and ${pack.calibration.same_sent_to_review} same-garment renders sent to REVIEW; ${pack.calibration.unmeasured} unmeasured (\`evidence/calibration-jobs-2026-10-29.json\`).`, ""] : []),
  "## Copy",
  "",
  `${texts} final texts for ${copyJobs.length} jobs (English and Hindi summary and listing): ${byModel} by Meta muse-spark-open on Fireworks, ${texts - byModel} from the template. The answered copy calls above are more: retries, superseded runs and rewrites are logged too.`,
  "",
  "## Limits",
  "",
  ...pack.limits.map((l) => `- ${l}`),
  "",
].join("\n");

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "results.csv"), rowsCsv(rows));
writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(pack, null, 2)}\n`);
writeFileSync(join(OUT, "README.md"), md);
console.log(`evidence pack: ${summary.jobs} jobs, ${summary.renders} renders, ${stages.length} stages -> ${OUT}`);
