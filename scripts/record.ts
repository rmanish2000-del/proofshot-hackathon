// npm run demo:record -- <job dir> <sources dir> <recording dir> [name]
//
// Records a finished job (SPEC §7): its receipt, render images and the source
// photos named on its job entry, read from <sources dir> by name. Refuses a
// receipt that does not verify, a replay, and sources that are not the job's.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { RECEIPT_FILE } from "../src/prior.ts";
import { parseReceipt } from "../src/receipt.ts";
import { recordJob } from "../src/replay.ts";

const [jobDir, sourcesDir, to, name] = process.argv.slice(2);
if (!jobDir || !sourcesDir || !to) {
  console.error("usage: npm run demo:record -- <job dir> <sources dir> <recording dir> [name]");
  process.exit(2);
}

const jobEntry = parseReceipt(readFileSync(join(jobDir, RECEIPT_FILE), "utf8"))[0];
const payload = (jobEntry?.payload ?? {}) as { source_images?: { name: string }[] };
const sources = (payload.source_images ?? []).map((s) => ({ name: s.name, bytes: new Uint8Array(readFileSync(join(sourcesDir, s.name))) }));

const manifest = recordJob({ jobDir, sources, to, ...(name ? { name } : {}) });
console.log(`recorded ${manifest.recorded_from.job_id} (head ${manifest.recorded_from.head}) as ${manifest.name} in ${to}`);
for (const [file, sha] of Object.entries(manifest.files)) console.log(`  ${file} ${sha}`);
