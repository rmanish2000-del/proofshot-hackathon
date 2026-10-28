// npm run demo:canned -- [recordings dir]
//
// Writes the three canned recordings (SPEC §7): one fixture job each that ends
// in RELEASE, REVIEW and REFUSE, recorded into demo/recordings/<name>/. The
// images are synthetic PNGs, no garment was photographed, and the fixture
// verifier answers from a table, so nothing here used a model. A recording
// that already exists is left alone.

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { fixtureProviders, runJob } from "../src/pipeline.ts";
import { recordedClock } from "../src/receipt.ts";
import { MANIFEST_FILE, recordJob } from "../src/replay.ts";
import { pngRgb } from "../src/shop.ts";
import { ATTRIBUTES } from "../src/types.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const recordingsDir = process.argv[2] ?? join(root, "demo", "recordings");

const CANNED = [
  { name: "release", mismatch: null, note: "every attribute matches" },
  { name: "review", mismatch: "hem", note: "a soft attribute mismatched: the side slits disappeared" },
  { name: "refuse", mismatch: "color", note: "a hard attribute mismatched: the indigo came out purple" },
] as const;

const image = (seed: string) => pngRgb(16, 16, (x, y) => [(seed.length * 37 + x * 9) & 255, (y * 13 + 60) & 255, (x * y + seed.charCodeAt(0)) & 255]);

for (const c of CANNED) {
  const to = join(recordingsDir, c.name);
  if (existsSync(join(to, MANIFEST_FILE))) {
    console.log(`${c.name}: already recorded in ${to}`);
    continue;
  }
  const jobsRoot = mkdtempSync(join(tmpdir(), "canned-"));
  const sources = [{ name: "front.png", bytes: new Uint8Array(image("source")) }];
  const findings = {
    findings: ATTRIBUTES.map((attribute) => ({
      attribute,
      verdict: attribute === c.mismatch ? "mismatch" : "match",
      confidence: 0.95,
      note: attribute === c.mismatch ? c.note : "matches the source",
      evidence: { source_bbox: null, render_bbox: null },
    })),
  };
  const r = await runJob(
    {
      jobId: `demo-${c.name}`,
      garmentNote: "indigo cotton kurta, side slits (fixture: synthetic images, no garment was photographed)",
      scenes: ["studio"],
      sources,
    },
    {
      outRoot: jobsRoot,
      provenance: "fixture",
      clock: recordedClock(Array.from({ length: 12 }, (_, i) => `2026-10-28T02:30:${String(i).padStart(2, "0")}.000Z`)),
      providers: fixtureProviders({ renders: (scene) => new Uint8Array(image(`${c.name}-${scene}`)), findings: () => findings }),
    },
  );
  const manifest = recordJob({ jobDir: r.dir, sources, to, name: c.name });
  console.log(`${c.name}: job ${manifest.recorded_from.job_id} (${r.renders.map((x) => x.decision).join(", ")}) recorded in ${to}, head ${manifest.recorded_from.head}`);
}
