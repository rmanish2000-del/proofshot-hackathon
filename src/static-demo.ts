// Keyless static judge demo (round 4): the judge view, the verify page and the shop as plain files that any
// static host can serve, with no server and no API key. It reads only committed receipts; nothing is judged,
// generated or uploaded. The JSON a page would get from `npm run serve` is written to files at build time,
// with the same code (listReceipts, presentJob, sourcePhoto, verifyChain, tamperedCopy), and the copied
// judge.html is pointed at those files. The verify and tamper buttons show results computed at build time;
// web/verify.html, copied unchanged, still checks any receipt live in the browser.

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { presentJob, tamperedCopy } from "./present.ts";
import { RECEIPT_FILE } from "./prior.ts";
import { parseReceipt, verifyChain } from "./receipt.ts";
import { UPLOAD_JOB_PREFIX, UploadServer, imageFile, providersFromEnv } from "./serve.ts";

export interface StaticDemoOptions {
  readonly webDir: string;
  readonly jobsRoot: string;
  readonly garmentsDir: string;
  readonly outDir: string;
}

export interface StaticDemoResult {
  readonly jobs: readonly string[];
  readonly files: number;
}

/** The URL rewrites the static copy of judge.html needs; each must match exactly once, or the build fails. */
export const JUDGE_REWRITES: readonly (readonly [string, string])[] = [
  ['getJson("/api/receipts")', 'getJson("api/receipts.json")'],
  ["getJson(`/api/receipts/${encodeURIComponent(id)}`)", "getJson(`api/receipts/${encodeURIComponent(id)}.json`)"],
  ["frame(`/api/receipts/${encodeURIComponent(jobId)}/source/${i}`", "frame(`api/receipts/${encodeURIComponent(jobId)}/source/${i}.jpg`"],
  ['getJson(`/api/receipts/${encodeURIComponent(jobId)}/verify`, { method: "POST" })', "getJson(`api/receipts/${encodeURIComponent(jobId)}/verify.json`)"],
  ['getJson(`/api/receipts/${encodeURIComponent(jobId)}/tamper`, { method: "POST" })', "getJson(`api/receipts/${encodeURIComponent(jobId)}/tamper.json`)"],
];

const BANNER =
  '<div style="background:#fff7e0;border-bottom:1px solid #e0c060;padding:8px 16px;font:14px system-ui,sans-serif">' +
  "Static demo: no server and no API key. Every job here is a committed receipt. The <b>Verify chain</b> and " +
  "<b>Tamper demo</b> buttons show results computed when this demo was built; to check a receipt live in your " +
  'browser, open <a href="verify.html">verify.html</a>. <a href="index.html">All jobs</a></div>';

export function staticJudgeHtml(source: string): string {
  let html = source;
  for (const [from, to] of JUDGE_REWRITES) {
    const n = html.split(from).length - 1;
    if (n !== 1) throw new Error(`judge.html changed: expected one "${from}", found ${n}`);
    html = html.replace(from, to);
  }
  if (!/<body[^>]*>/.test(html)) throw new Error("judge.html has no <body>");
  return html.replace(/<body([^>]*)>/, `<body$1>${BANNER}`).replace(/href="\/"/g, 'href="index.html"');
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function indexHtml(jobs: readonly { job_id: string; decision: string | null; provenance: string | null }[]): string {
  const rows = jobs
    .map((j) => `<li><a href="judge.html?job=${encodeURIComponent(j.job_id)}">${j.job_id}</a> · ${j.decision ?? "no decision"} · ${j.provenance ?? "?"}</li>`)
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ProofShot: static judge demo</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px}code{background:#f2f2f2;padding:0 4px}</style></head>
<body><h1>ProofShot: static judge demo</h1>
<p>No server, no API key, nothing uploaded. Every job below is a committed receipt from the repository; each page only reads it.</p>
<p>Start here: <a href="judge.html?job=live-shirt-plaid-mismatch">REFUSE, a different shirt</a> ·
<a href="judge.html?job=live-shirt-plaid-composite-v2-r3">REVIEW, a label below its floor</a> ·
<a href="judge.html?job=ms2-shirt-plaid">RELEASE, the owner's own photo (pipeline smoke example)</a> ·
<a href="verify.html">verify a receipt in your browser</a> · <a href="shop.html">shop preview</a></p>
<h2>All committed jobs</h2><ul>
${rows}
</ul></body></html>
`;
}

/** Writes the static demo into outDir (emptied first) and returns the jobs it contains. */
export function buildStaticDemo(opts: StaticDemoOptions): StaticDemoResult {
  rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(opts.outDir, { recursive: true });
  let files = 0;
  // Fixture providers from an empty environment: no key is read and no model can be called.
  const server = new UploadServer({ webDir: opts.webDir, jobsRoot: opts.jobsRoot, shopDir: join(opts.webDir, "shop"), garmentsDir: opts.garmentsDir, providers: providersFromEnv({}) });

  // Local seller-page jobs (upload-*) are gitignored; only committed jobs go in.
  const all = server.listReceipts(10_000).jobs.filter((j) => !j.job_id.startsWith(UPLOAD_JOB_PREFIX));
  const counts = { RELEASE: 0, REVIEW: 0, REFUSE: 0 };
  for (const j of all) if (j.decision) counts[j.decision]++;
  writeJson(join(opts.outDir, "api", "receipts.json"), { jobs: all, counts });
  files++;

  for (const { job_id: id } of all) {
    const dir = join(opts.jobsRoot, id);
    const text = readFileSync(join(dir, RECEIPT_FILE), "utf8");
    const view = presentJob(parseReceipt(text));
    const images: Record<string, string> = {};
    const jobOut = join(opts.outDir, "jobs", id);
    mkdirSync(jobOut, { recursive: true });
    copyFileSync(join(dir, RECEIPT_FILE), join(jobOut, RECEIPT_FILE));
    files++;
    for (const r of view.renders) {
      const f = imageFile(dir, r.render_id);
      if (f === null) continue;
      copyFileSync(join(dir, f), join(jobOut, f));
      images[r.render_id] = `jobs/${id}/${f}`;
      files++;
    }
    writeJson(join(opts.outDir, "api", "receipts", `${id}.json`), { ...view, images, receipt: `jobs/${id}/${RECEIPT_FILE}` });
    const apiDir = join(opts.outDir, "api", "receipts", id);
    view.sources.forEach((_, i) => {
      try {
        const { file } = server.sourcePhoto(id, i); // served only when the bytes hash to the recorded sha256
        mkdirSync(join(apiDir, "source"), { recursive: true });
        // Always `<i>.jpg`, the name the page asks for; browsers sniff the bytes, so a PNG source still shows.
        copyFileSync(file, join(apiDir, "source", `${i}.jpg`));
        files++;
      } catch {
        // No file matches the recorded hash: the page shows the photo as missing, as the server does.
      }
    });
    writeJson(join(apiDir, "verify.json"), verifyChain(parseReceipt(text)));
    const copy = tamperedCopy(text);
    writeJson(join(apiDir, "tamper.json"), { tampered_entry: copy.index, result: verifyChain(parseReceipt(copy.text)) });
    files += 3;
  }

  writeFileSync(join(opts.outDir, "judge.html"), staticJudgeHtml(readFileSync(join(opts.webDir, "judge.html"), "utf8")));
  for (const page of ["verify.html", "shop.html"]) copyFileSync(join(opts.webDir, page), join(opts.outDir, page));
  if (existsSync(join(opts.webDir, "shop"))) cpSync(join(opts.webDir, "shop"), join(opts.outDir, "shop"), { recursive: true });
  writeFileSync(join(opts.outDir, "index.html"), indexHtml(all));
  files += 4;
  return { jobs: all.map((j) => j.job_id), files };
}
