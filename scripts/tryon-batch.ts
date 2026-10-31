// npm run tryon -- [--only <garment>] [--renderers pruna,composite] [--budget <usd>]
//
// Try-on render run (CC_PROMPT_TRYON_31OCT, Manish's choice 31 Oct: both
// renderers side by side). Until now the RELEASEs on shirt-pink and
// kurta-mustard compared photo 1 with itself (stand-in). Here every garment in
// data/seller-pairs gets a real render, and the unchanged pipeline judges it
// against the seller's photos, full-length front first:
//
//   pruna      Pruna p-image-try-on on Replicate (third-party, non-Meta), on the
//              committed synthetic model image; PROOFSHOT_TRYON_LONG=1 so long
//              kurtas are tried on too. A failed call falls back to composite
//              v2 with the reason on the receipt.
//   composite  composite v2: the SAM-cut garment on the mannequin, no image model.
//
// No Meta image model: the only one on the key is Muse Image, which is not
// available in India and is refused by src/render.ts (SPEC §8).
//
// Live: SAM 3.1 and Muse Spark 1.3 on api.meta.ai (MODEL_API_KEY), Replicate
// (REPLICATE_API_TOKEN). Keys are never printed. Each renderer is wrapped by
// guardRenderer (src/tryon.ts), so a render with a source photo's hash is
// render_failed before any verifier call, and the run exits 1.
//
// Budget: --budget (default and maximum 15 USD) is for this whole run, read
// from the Meta and Replicate ledgers; a job starts only when the spend so far
// plus JOB_ESTIMATE_USD stays within it. A job folder that exists is skipped
// (a job id is used once), so `--only <garment>` is the dry run and the next
// call carries on with the rest.
//
// Out: evidence/tryon/<garment>/<renderer>/ (receipt.jsonl and the render),
// evidence/tryon/<garment>/<renderer>.json (model, prompt, hashes, verdict,
// cost), evidence/tryon/logs/ (redacted SAM and verifier logs), and
// evidence/tryon/run-<started>.json for this call.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runJob } from "../src/pipeline.ts";
import type { SourceImage } from "../src/pipeline.ts";
import { fileLedger } from "../src/render-replicate.ts";
import { TRYON_LONG_ENV, defaultLedgerPath } from "../src/render-replicate.ts";
import { providersFromEnv } from "../src/serve.ts";
import { META_LIMIT, accountLedger, meteredFetch, spendSummary, summaryLine } from "../src/spend-meta.ts";
import { assertNotSelfComparison, guardRenderer } from "../src/tryon.ts";
import { sha256Hex } from "../src/util.ts";
import { META_KEY_ENV, resolveUserEnvKey } from "../src/verifier-meta.ts";
import { writeSamLog, writeVerifierLog } from "./verifier-log.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "evidence", "tryon");
const MAX_BUDGET_USD = 15;
/** What one job may cost at most: 2-3 SAM calls, one Muse Spark call with every photo, one try-on. Measured jobs cost less. */
const JOB_ESTIMATE_USD = 0.1;

/**
 * The garments, each with its full-length front first (the photo fidelity
 * measures against), and the synthetic model the try-on dresses: synthetic-02
 * (an ankle-length slip dress) for the kurtas, so the try-on is not refused as
 * model_too_short; synthetic-01 (a hip-length top) for the shirts.
 */
const GARMENTS: readonly { name: string; primary: string; model: string }[] = [
  { name: "shirt-pink", primary: "2-full-front.jpg", model: "synthetic-01" },
  { name: "kurta-mustard", primary: "2-full-front.jpg", model: "synthetic-02" },
  { name: "kurta-pink-patchwork", primary: "front.jpg", model: "synthetic-02" },
  { name: "kurta-red-floral", primary: "front.jpg", model: "synthetic-02" },
  { name: "shirt-grey-mufti", primary: "front.jpg", model: "synthetic-01" },
];
const RENDERERS = {
  pruna: { PROOFSHOT_RENDER: "replicate-pruna-tryon", [TRYON_LONG_ENV]: "1" },
  composite: { RENDER_PROVIDER: "composite" },
} as const;
type RendererName = keyof typeof RENDERERS;

const args = process.argv.slice(2);
const opt = (name: string): string | null => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const only = opt("--only");
const renderers = (opt("--renderers") ?? "pruna,composite").split(",").map((s) => s.trim()) as RendererName[];
const budget = Number(opt("--budget") ?? MAX_BUDGET_USD);
if (!(budget > 0 && budget <= MAX_BUDGET_USD)) {
  console.error(`--budget must be above 0 and at most ${MAX_BUDGET_USD} USD`);
  process.exit(2);
}
for (const r of renderers) {
  if (!(r in RENDERERS)) {
    console.error(`unknown renderer ${r}: use ${Object.keys(RENDERERS).join(", ")}`);
    process.exit(2);
  }
}
const garments = GARMENTS.filter((g) => !only || g.name === only);
if (garments.length === 0) {
  console.error(`no garment named ${only}`);
  process.exit(2);
}

const metaKey = resolveUserEnvKey(process.env, META_KEY_ENV);
const replicateToken = resolveUserEnvKey(process.env, "REPLICATE_API_TOKEN");
if (!metaKey || !replicateToken) {
  console.error(`${!metaKey ? META_KEY_ENV : "REPLICATE_API_TOKEN"} is not set in the process or the User env: no job run`);
  process.exit(2);
}
const metaLedger = accountLedger("meta", process.env);
const replicatePath = defaultLedgerPath(process.env);
const replicateLedger = replicatePath ? fileLedger(replicatePath) : null;
if (!metaLedger || !replicateLedger) {
  console.error("LOCALAPPDATA is not set, so the spend ledgers cannot be read: no job run");
  process.exit(2);
}
const spent = (): { meta: number; replicate: number } => ({
  meta: metaLedger.read().reduce((n, e) => n + e.cost_usd, 0),
  replicate: replicateLedger.read().reduce((n, e) => n + e.cost_usd, 0),
});
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const start = spent();
const runSpent = () => {
  const now = spent();
  return r4(now.meta - start.meta + now.replicate - start.replicate);
};

const startedAt = new Date().toISOString();
const logDir = join(OUT, "logs");
mkdirSync(logDir, { recursive: true });
const rows: Record<string, unknown>[] = [];
let stopped: string | null = null;

outer: for (const g of garments) {
  const dir = join(ROOT, "data", "seller-pairs", g.name);
  const files = (JSON.parse(readFileSync(join(dir, "intake.json"), "utf8")) as { files: { name: string }[] }).files.map((f) => f.name);
  if (!files.includes(g.primary)) throw new Error(`${g.name}: ${g.primary} is not in intake.json`);
  const ordered = [g.primary, ...files.filter((f) => f !== g.primary)];
  const sources: SourceImage[] = ordered.map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
  const sourceShas = sources.map((s) => sha256Hex(s.bytes));
  const note = readFileSync(join(dir, "note.txt"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[A-Za-z][^:]*: \S/.test(l))
    .join("; ");

  for (const r of renderers) {
    const jobsRoot = join(OUT, g.name);
    if (existsSync(join(jobsRoot, r))) {
      console.log(`${g.name}/${r}: ran before, skipped (a job id is used once)`);
      continue;
    }
    if (runSpent() + JOB_ESTIMATE_USD > budget) {
      stopped = `budget: ${runSpent()} USD spent in this run, the next job could take it past ${budget} USD`;
      break outer;
    }
    const env = {
      ...process.env,
      [META_KEY_ENV]: metaKey.key,
      REPLICATE_API_TOKEN: replicateToken.key,
      VERIFIER_PROVIDER: "meta",
      MODEL_SEGMENT: "meta/sam-3.1 (api.meta.ai)",
      REPLICATE_MODEL_IMAGE: g.model,
      ...RENDERERS[r],
    };
    const logs: string[] = [];
    const providers = providersFromEnv(env, {
      sam: { fetch: meteredFetch((url, init) => fetch(url, init), { kind: "sam", account: "meta", ledger: metaLedger, env: process.env }), onCall: (log) => logs.push(writeSamLog(logDir, log)) },
      metaVerifierFetch: meteredFetch((url, init) => fetch(url, init), { kind: "muse", account: "meta", ledger: metaLedger, env: process.env }),
      onVerifierCall: (log) => logs.push(writeVerifierLog(logDir, log)),
      replicate: { fetch: (url, init) => fetch(url, init), ledger: replicateLedger },
    });
    if (providers.mode.fixture) {
      console.error(`the verifier is not live (${providers.mode.labels.verify}): stopping`);
      process.exit(2);
    }
    console.log(`${g.name}/${r}: ${providers.mode.labels.render}`);
    const before = spent();
    const result = await runJob(
      { jobId: r, garmentNote: `${g.name}: ${note || "no note"}`, scenes: ["studio"], sources },
      { outRoot: jobsRoot, providers: { ...providers.providers, renderer: guardRenderer(providers.providers.renderer) }, provenance: providers.mode.provenance },
    );
    const after = spent();
    const cost = { meta: r4(after.meta - before.meta), replicate: r4(after.replicate - before.replicate) };

    const entries = readFileSync(join(result.dir, "receipt.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { kind: string; payload: Record<string, unknown> });
    const of = (kind: string) => entries.filter((e) => e.kind === kind).at(-1)?.payload ?? null;
    const render = of("render");
    const fidelity = of("fidelity");
    const gate = of("gate");
    const outcome = result.renders[0];
    let selfComparison: string | null = null;
    if (render) {
      try {
        assertNotSelfComparison(String(render.sha256), sourceShas);
      } catch (err) {
        selfComparison = (err as Error).message;
      }
    }
    const row = {
      garment: g.name,
      renderer: r,
      job_dir: `evidence/tryon/${g.name}/${r}`,
      render: render
        ? {
            path: `evidence/tryon/${g.name}/${r}/${render.render_id}.${existsSync(join(result.dir, `${render.render_id}.png`)) ? "png" : "jpg"}`,
            provider: render.provider,
            model: render.model,
            generative: render.generative ?? false,
            prompt: render.prompt ?? (render.input as { prompt?: unknown } | undefined)?.prompt ?? null,
            sha256: render.sha256,
            ...(render.fallback_reason ? { fallback_reason: render.fallback_reason } : {}),
          }
        : null,
      inputs: sources.map((s, i) => ({ photo: i + 1, name: s.name, sha256: sourceShas[i] })),
      self_comparison: selfComparison,
      fidelity: fidelity ? { decision: fidelity.decision, metrics: fidelity.metrics ?? null, reasons: fidelity.reasons ?? [] } : null,
      verdict: outcome?.decision ?? (gate?.decision as string | undefined) ?? "REFUSE",
      cited: outcome?.cited ?? gate?.cited ?? result.refused ?? null,
      cost_usd: { ...cost, total: r4(cost.meta + cost.replicate) },
      logs: logs.map((l) => l.replace(/\\/g, "/").replace(/^.*?evidence\//, "evidence/")),
    };
    writeFileSync(join(OUT, g.name, `${r}.json`), JSON.stringify(row, null, 2) + "\n");
    rows.push(row);
    console.log(`${g.name}/${r}: ${row.verdict}${row.cited ? ` (${(row.cited as { rule?: string }).rule}: ${(row.cited as { reason?: string }).reason})` : ""}; fidelity ${fidelity?.decision ?? "none"}; ${row.cost_usd.total} USD; run so far ${runSpent()} USD`);
    if (selfComparison) {
      stopped = `self-comparison: ${selfComparison}`;
      process.exitCode = 1;
      break outer;
    }
  }
}

const summary = { started_at: startedAt, budget_usd: budget, spent_usd: runSpent(), stopped, jobs: rows };
writeFileSync(join(OUT, `run-${startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(summary, null, 2) + "\n");
console.log(`run: ${rows.length} job(s), ${summary.spent_usd} USD of ${budget}${stopped ? `; stopped: ${stopped}` : ""}`);
console.log(summaryLine("Meta spend", spendSummary(metaLedger, META_LIMIT)));
