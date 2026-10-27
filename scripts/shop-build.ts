// npm run shop: builds web/shop/ (catalog.json plus each verified job's released
// images and receipt) from data/jobs/*/receipt.jsonl (SPEC §11).
//
//   --jobs <dir>      where the jobs are         (default data/jobs)
//   --out <dir>       where the shop is written   (default web/shop)
//   --garments <dir>  photographed garments to preview (default data/garments)
//   --no-fixture      write no fixture job first: neither the synthetic one nor the garment previews
//
// Exits 1 when any job was refused a row, so a broken receipt is never quietly
// left out of a shop that otherwise looks fine.

import { fileURLToPath } from "node:url";

import { FIXTURE_JOB_ID, GARMENTS_DIR, buildShop, writeFixtureJob, writeGarmentPreviewJobs } from "../src/shop.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const root = fileURLToPath(new URL("..", import.meta.url));
const jobs = option("--jobs", `${root}data/jobs`);
const out = option("--out", `${root}web/shop`);
const garments = option("--garments", `${root}${GARMENTS_DIR}`);

if (!args.includes("--no-fixture")) {
  const written = await writeFixtureJob(jobs);
  console.log(written ? `fixture job ${FIXTURE_JOB_ID} written to ${jobs}` : `fixture job ${FIXTURE_JOB_ID} already in ${jobs}`);
  const previews = await writeGarmentPreviewJobs(jobs, garments);
  console.log(previews.length > 0 ? `garment preview job(s) written: ${previews.join(", ")}` : `garment preview jobs already in ${jobs}`);
}

const { rows, problems } = buildShop(jobs, out);
for (const row of rows) console.log(`row  ${row.job_id} ${row.render_id} ${row.provenance} ${row.image_sha256.slice(0, 12)}…`);
for (const p of problems) console.error(`skip ${p.job_id}: ${p.reason}`);
console.log(`${rows.length} row(s), ${problems.length} problem(s) → ${out}`);
process.exitCode = problems.length === 0 ? 0 : 1;
