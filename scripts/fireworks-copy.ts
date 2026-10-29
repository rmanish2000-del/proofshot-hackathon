// npm run copy:fireworks -- [--lang en,hi] [--redo listing_copy] (--all | <job-id> [<job-id> ...])
//
// FW1 / FW1b / FW2: for each committed job, writes the receipt summary and the
// listing copy (src/fireworks-copy.ts) in each language asked for (English
// when --lang is absent) to data/copy/<job-id>.json, and one redacted call log
// per Fireworks request to evidence/fireworks-<started_at>.json. --all takes
// every job in data/jobs with a receipt, except the gitignored upload-* ones.
//
// A record the model already wrote for the same task, language and receipt
// head is kept, not paid for twice (a listing only if it has two sentences);
// anything else is written again. The
// model is Meta muse-spark-open on Fireworks unless FIREWORKS_MODEL says
// otherwise; each record names the model id it sent, or "none" for the
// template. With no FIREWORKS_API_KEY in the process or the Windows User env,
// every text comes from the template with fallback_reason no_api_token. Spend
// goes to %LOCALAPPDATA%\ProofShot\fireworks-ledger.json, capped in
// src/fireworks-copy.ts; the batch stops at the first spend_cap.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { FIREWORKS_LIMIT, copyFacts, fireworksLedger, recordStillGood, writeCopy } from "../src/fireworks-copy.ts";
import type { CopyLang, CopyRecord, CopyTask, FireworksCallLog, FireworksFetch } from "../src/fireworks-copy.ts";
import { parseReceipt, verifyChain } from "../src/receipt.ts";
import { spendSummary, summaryLine } from "../src/spend-meta.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TASKS: readonly CopyTask[] = ["receipt_summary", "listing_copy"];
const JOB = /^[a-z0-9][a-z0-9-]{0,63}$/;

function writeLog(log: FireworksCallLog): string {
  const dir = join(ROOT, "evidence");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `fireworks-${log.started_at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(log, null, 2)}\n`);
  return file;
}

const args = process.argv.slice(2);
let langs: CopyLang[] = ["en"];
const li = args.indexOf("--lang");
if (li !== -1) {
  const list = (args[li + 1] ?? "").split(",").filter(Boolean);
  if (list.length === 0 || list.some((l) => l !== "en" && l !== "hi")) {
    console.error("--lang takes en, hi or en,hi");
    process.exit(2);
  }
  langs = list as CopyLang[];
  args.splice(li, 2);
}
// --redo listing_copy (or receipt_summary): write that task again for every job, kept or not.
let redo: CopyTask[] = [];
const ri = args.indexOf("--redo");
if (ri !== -1) {
  const list = (args[ri + 1] ?? "").split(",").filter(Boolean);
  if (list.length === 0 || list.some((t) => !(TASKS as readonly string[]).includes(t))) {
    console.error("--redo takes receipt_summary, listing_copy or both");
    process.exit(2);
  }
  redo = list as CopyTask[];
  args.splice(ri, 2);
}
const jobsDir = join(ROOT, "data", "jobs");
const jobs = args.includes("--all")
  ? readdirSync(jobsDir).filter((j) => JOB.test(j) && !j.startsWith("upload-") && existsSync(join(jobsDir, j, "receipt.jsonl"))).sort()
  : args;
if (jobs.length === 0 || jobs.some((j) => !JOB.test(j) || j.startsWith("upload-"))) {
  console.error("usage: npm run copy:fireworks -- [--lang en,hi] (--all | <committed job id> [...])");
  process.exit(2);
}

const ledger = fireworksLedger(process.env);
let capped = false;
for (const job of jobs) {
  if (capped) break;
  const entries = parseReceipt(readFileSync(join(jobsDir, job, "receipt.jsonl"), "utf8"));
  const chain = verifyChain(entries);
  if (!chain.ok) {
    console.error(`${job}: receipt does not verify, skipped`);
    process.exitCode = 1;
    continue;
  }
  const facts = copyFacts(job, entries);
  const file = join(ROOT, "data", "copy", `${job}.json`);
  const before: CopyRecord[] = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { records: CopyRecord[] }).records : [];
  const records: CopyRecord[] = [];
  for (const lang of langs) {
    for (const task of TASKS) {
      // A record that fails today's checks (FW2: two sentences; FW2 fix: no pipeline words in a listing,
      // no "matched" in a summary without findings), or whose task is in --redo, is written again.
      const kept = redo.includes(task) ? undefined : before.find((r) => r.task === task && (r.lang ?? "en") === lang && recordStillGood(r, facts));
      if (kept) {
        records.push(kept);
        console.log(`${job} ${task} ${lang}: kept (${kept.provider} ${kept.model})`);
        continue;
      }
      const rec = await writeCopy(task, facts, {
        env: process.env,
        fetch: globalThis.fetch as unknown as FireworksFetch,
        ledger,
        lang,
        onCall: (log) => console.log(`log ${writeLog(log)}`),
      });
      records.push(rec);
      console.log(`${job} ${task} ${lang}: ${rec.provider} ${rec.model}${rec.fallback_reason ? ` (fallback_reason ${rec.fallback_reason})` : ""}${rec.cost_usd ? ` cost ${rec.cost_usd} USD` : ""}`);
      if (rec.fallback_reason === "spend_cap") capped = true;
    }
  }
  // Records for a language not asked for this run stay as they were.
  for (const r of before) if (!langs.includes(r.lang ?? "en")) records.push(r);
  mkdirSync(join(ROOT, "data", "copy"), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ job_id: job, records }, null, 2)}\n`);
}
if (capped) console.error("stopped: the Fireworks spend limit was reached (the batch cap, or cap + reserve with PROOFSHOT_USE_RESERVE=1)");
if (ledger) {
  console.log(summaryLine("Fireworks spend", spendSummary(ledger, FIREWORKS_LIMIT)));
}
