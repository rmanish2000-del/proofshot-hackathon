// npm run calibrate [-- [<garments root>] [--masks sam|whole-frame] [--factors 0.5,1,2] [--out <file>]]
//
// R4 (Grok 28 Oct 09:55 and 10:48): the calibration scorer (src/calibrate.ts)
// run over the committed garment photos. Every garment directory with an
// intake.json gives its photos; every ordered pair of two different photos is a
// case, labelled `same` when both come from one garment directory and
// `different` otherwise. No note.txt is read or edited. No model is called.
//
// Masks: `sam` (default) takes each photo's mask from a committed SAM call log,
// evidence/sam-*.json, whose image sha256 is the photo's, decoded through the
// same parser glue as the pipeline; a photo with no log has no mask and every
// case it is in is unmeasured (counted, never a pass). `whole-frame` treats the
// whole photo as the garment, background included: a baseline only, not the
// SPEC §10 measure, and the output says so. Candidates scale the thresholds in
// config/fidelity.json by each factor (scaledCandidates).

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { labelledPairs, pairMetricLines, scaledCandidates, scoreCalibration, wholeFrameMask } from "../src/calibrate.ts";
import type { CalibrationCase, GarmentPhoto } from "../src/calibrate.ts";
import { loadThresholds } from "../src/fidelity.ts";
import { decodeRgb } from "../src/image.ts";
import { decodePng, maskFromPng } from "../src/png.ts";
import type { Mask, RgbImage } from "../src/png.ts";
import { MASK_TOKEN_START } from "../src/sam-meta.ts";
import { decodeSegments } from "../src/sam-parser.ts";
import { sha256Hex } from "../src/util.ts";

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
const maskMode = option("--masks") ?? "sam";
if (maskMode !== "sam" && maskMode !== "whole-frame") {
  console.error(`--masks ${maskMode}: say sam or whole-frame`);
  process.exit(2);
}
const factors = (option("--factors") ?? "0.5,0.75,1,1.5,2").split(",").map(Number);
const outFile = option("--out");
const [root = "data/garments"] = args;

interface Photo extends GarmentPhoto {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly image: RgbImage;
}

const photos: Photo[] = [];
for (const garment of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const intakeFile = join(root, garment, "intake.json");
  if (!existsSync(intakeFile)) continue;
  const intake = JSON.parse(readFileSync(intakeFile, "utf8")) as { files: { name: string }[] };
  for (const { name } of intake.files) {
    const bytes = new Uint8Array(readFileSync(join(root, garment, name)));
    photos.push({ garment, name, bytes, sha256: sha256Hex(bytes), image: decodeRgb(bytes) });
  }
}

const masks = new Map<string, Mask>();
const maskFrom = new Map<string, string>();
if (maskMode === "sam" && existsSync("evidence")) {
  for (const file of readdirSync("evidence").filter((f) => /^sam-.*\.json$/.test(f)).sort()) {
    const log = JSON.parse(readFileSync(join("evidence", file), "utf8")) as {
      image?: { sha256?: string };
      output_text?: string | null;
      prompt?: string;
      request?: { input?: { content?: { type: string; text?: string }[] }[] };
    };
    const photo = photos.find((p) => p.sha256 === log.image?.sha256);
    if (!photo || masks.has(photo.sha256) || !log.output_text?.includes(MASK_TOKEN_START)) continue;
    const prompt = log.prompt ?? log.request?.input?.[0]?.content?.find((c) => c.type === "input_text")?.text ?? "garment";
    const [seg] = await decodeSegments(log.output_text, { name: photo.name, bytes: photo.bytes }, prompt);
    if (!seg) continue;
    masks.set(photo.sha256, maskFromPng(decodePng(new Uint8Array(Buffer.from(seg.mask, "base64")))));
    maskFrom.set(photo.sha256, file);
  }
}
const maskOf = (p: Photo): Mask | null => (maskMode === "whole-frame" ? wholeFrameMask(p.image) : (masks.get(p.sha256) ?? null));

const cases: CalibrationCase[] = labelledPairs(photos).map((pair) => ({
  id: pair.id,
  label: pair.label,
  source: pair.source.image,
  render: pair.render.image,
  sourceMask: maskOf(pair.source),
  renderMask: maskOf(pair.render),
}));
// No verifier has judged these pairs, so the gate would refuse every one as not
// verified; the CLI scores the fidelity check alone and says so.
const scores = scoreCalibration(cases, scaledCandidates(loadThresholds(), factors), { scope: "fidelity" });

console.log(`calibration over ${root}: ${photos.length} photos in ${new Set(photos.map((p) => p.garment)).size} garments, ${cases.length} ordered pairs`);
console.log("scope: FIDELITY ONLY (no verifier findings): not a gate decision; the gate refuses a pair with no findings");
console.log(maskMode === "whole-frame" ? "masks: WHOLE FRAME (background included): a baseline, not the SPEC §10 measure" : `masks: SAM, from evidence logs for ${masks.size} of ${photos.length} photos`);
for (const p of photos) if (maskMode === "sam") console.log(`  ${p.garment}/${p.name}: ${maskFrom.get(p.sha256) ?? "no SAM log, no mask"}`);
console.log("candidate  same  diff  false_match  false_refuse  review_same  review_diff  unmeasured");
for (const s of scores) {
  console.log(`${s.name.padEnd(9)}  ${String(s.same).padStart(4)}  ${String(s.different).padStart(4)}  ${String(s.false_match).padStart(11)}  ${String(s.false_refuse).padStart(12)}  ${String(s.review_same).padStart(11)}  ${String(s.review_different).padStart(11)}  ${String(s.unmeasured).padStart(10)}`);
}
// N10: the raw values per pair. They do not depend on the thresholds, so the
// first candidate's cases carry them for all.
const pairs = scores[0]?.cases ?? [];
console.log("per-pair fidelity values (fidelity only, no threshold applied):");
for (const line of pairMetricLines(pairs)) console.log(`  ${line}`);
if (outFile) {
  writeFileSync(
    outFile,
    `${JSON.stringify({ root, masks: maskMode, scope: "fidelity", factors, photos: photos.map((p) => ({ garment: p.garment, name: p.name, sha256: p.sha256, mask_log: maskFrom.get(p.sha256) ?? null })), pairs: pairs.map((c) => ({ id: c.id, label: c.label, metrics: c.metrics })), scores }, null, 2)}\n`,
  );
  console.log(`written: ${outFile}`);
}
