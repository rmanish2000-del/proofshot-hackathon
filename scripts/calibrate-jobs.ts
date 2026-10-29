// npm run calibrate:jobs [-- [--jobs <dir>] [--garments <dir>] [--labels <file>] [--factors 0.5,1,2] [--out <file>]]
//
// The calibration scorer over renders committed jobs already checked (Grok 29
// Oct 14:10): every data/jobs/<job>/receipt.jsonl render with a fidelity entry
// gives a case with the recorded fidelity values and verifier findings. Its
// label compares what data/calibration/labels.json says the render shows with
// the job's garment, the data/garments/<garment> directory (note.txt, intake.json)
// whose photos are the job's sources. Each candidate scales the thresholds in
// config/fidelity.json (scaledCandidates) and is applied to the recorded values,
// then the gate decides with the recorded findings. Reports false match
// (`different` released) and false refuse (`same` refused) per candidate, for
// the gate and for fidelity alone. No image is decoded, no model is called.
// Local upload-* jobs (gitignored) are left out so the result matches a clone.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseRenderLabels, recordedRenders, scaledCandidates, scoreRecorded } from "../src/calibrate.ts";
import type { CandidateScore, ReceiptLine, RecordedRender, SkippedRender } from "../src/calibrate.ts";
import { loadThresholds } from "../src/fidelity.ts";

const args = process.argv.slice(2);
const option = (name: string): string | null => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`${name} needs a value`);
    process.exit(2);
  }
  args.splice(i, 2);
  return v;
};
const jobsDir = option("--jobs") ?? "data/jobs";
const garmentsDir = option("--garments") ?? "data/garments";
const labelsFile = option("--labels") ?? "data/calibration/labels.json";
const factors = (option("--factors") ?? "0.5,0.75,1,1.5,2").split(",").map(Number);
const outFile = option("--out");

const labels = parseRenderLabels(JSON.parse(readFileSync(labelsFile, "utf8")));
// Photo sha256 -> garment directory, from each garment's intake.json.
const photos = new Map<string, string>();
for (const garment of readdirSync(garmentsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  const intake = join(garmentsDir, garment, "intake.json");
  if (!existsSync(intake)) continue;
  for (const f of (JSON.parse(readFileSync(intake, "utf8")) as { files: { sha256: string }[] }).files) photos.set(f.sha256, garment);
}
const cases: RecordedRender[] = [];
const skipped: SkippedRender[] = [];
for (const job of readdirSync(jobsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("upload-")).map((d) => d.name).sort()) {
  const file = join(jobsDir, job, "receipt.jsonl");
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as ReceiptLine);
  const r = recordedRenders(lines, labels, photos);
  cases.push(...r.cases);
  skipped.push(...r.skipped);
}

const candidates = scaledCandidates(loadThresholds(), factors);
const gate = scoreRecorded(cases, candidates);
const fidelity = scoreRecorded(cases, candidates, { scope: "fidelity" });

const table = (scores: readonly CandidateScore[]) => {
  console.log("  candidate  same  diff  false_match  false_refuse  review_same  review_diff  unmeasured");
  for (const s of scores) {
    console.log(`  ${s.name.padEnd(9)}  ${String(s.same).padStart(4)}  ${String(s.different).padStart(4)}  ${String(s.false_match).padStart(11)}  ${String(s.false_refuse).padStart(12)}  ${String(s.review_same).padStart(11)}  ${String(s.review_different).padStart(11)}  ${String(s.unmeasured).padStart(10)}`);
  }
};

console.log(`calibration over recorded renders in ${jobsDir}: ${cases.length} labelled, ${skipped.length} skipped; labels from ${labelsFile}`);
console.log("values and findings as recorded on each receipt; thresholds re-applied per candidate");
console.log("gate (recorded findings + fidelity):");
table(gate);
console.log("fidelity alone (findings ignored; not a gate decision):");
table(fidelity);
const x1 = gate.find((s) => s.name === "x1");
if (x1) {
  const recorded = new Map(cases.map((c) => [c.id, c.recorded]));
  const differ = x1.cases.filter((c) => c.decision !== recorded.get(c.id));
  console.log(`x1 against the gate decision each receipt recorded: ${x1.cases.length - differ.length} of ${x1.cases.length} the same`);
  for (const c of differ) console.log(`  differs: ${c.id}: recorded ${recorded.get(c.id)}, now ${c.decision}`);
}
console.log("per render (x1):");
for (const c of x1?.cases ?? []) console.log(`  ${c.label.padEnd(9)}  ${c.decision.padEnd(7)}  fidelity ${c.fidelity.padEnd(7)}  ${c.id}`);
console.log("skipped:");
for (const s of skipped) console.log(`  ${s.id} (${s.render_sha256.slice(0, 12)}): ${s.reason}`);
if (outFile) {
  writeFileSync(
    outFile,
    `${JSON.stringify({ jobs: jobsDir, labels: labelsFile, factors, cases: cases.map(({ findings: _f, ...c }) => c), skipped, gate, fidelity }, null, 2)}\n`,
  );
  console.log(`written: ${outFile}`);
}
