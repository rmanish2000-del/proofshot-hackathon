// SP1 (Grok, 29 Oct 18:20 IST on #23 6497097719): the seller-pain tricky set.
//
// Twelve photos a real seller sends by mistake, each with the decision the gate
// should give by the README rules. The ones that can be made honestly from the
// committed photos are made here by one recorded pixel transform of the owner's
// shirt-plaid front photo (labelled `synthetic`, re-encoded by jpeg-js so no EXIF
// or other metadata survives, no person added); case 10 uses the other kurta's
// committed photo as the image to publish. The base is shirt-plaid, not a kurta,
// because its untouched front passes composite v2's pre-check (it rendered in
// live-shirt-plaid-composite-v2), while kurta-01's and kurta-02's untouched
// fronts already fail it on clipping, so a kurta base cannot show what a
// transform alone does. The rest need a real phone photo and
// are listed as not run, never faked. The calls are made by scripts/sp1.ts
// through job:live; this file plans, builds and scores. Thresholds are not
// touched: a disagreement is a finding to report.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import jpeg from "jpeg-js";

import { decodeRgb } from "./image.ts";
import type { RgbImage } from "./png.ts";
import type { Decision } from "./types.ts";
import { sha256Hex } from "./util.ts";

export type Sp1Transform =
  | { readonly op: "exposure"; readonly gain: number }
  | { readonly op: "hard_shadow"; readonly darken: number }
  | { readonly op: "crop_bottom"; readonly keep: number }
  | { readonly op: "downscale"; readonly long_edge: number }
  | { readonly op: "light_ramp"; readonly from: number; readonly to: number };

export interface Sp1Case {
  /** `sp1-<nn>-<slug>`, also the job id. */
  readonly id: string;
  readonly n: number;
  readonly pain: string;
  readonly expected: Decision;
  /** The rule the README says should fire. */
  readonly expected_rule: string;
  readonly garment: string;
  /** The SAM 3.1 noun phrase for this garment. */
  readonly segment_prompt: string;
  /** How the case is made: a transform of the garment's front photo, the other garment's photo as the render, or not at all. */
  readonly build:
    | { readonly kind: "transform"; readonly transform: Sp1Transform }
    | { readonly kind: "other_garment_render"; readonly render_garment: string }
    | { readonly kind: "needs_real_photo"; readonly why: string };
}

const t = (transform: Sp1Transform) => ({ kind: "transform", transform }) as const;
const real = (why: string) => ({ kind: "needs_real_photo", why }) as const;
const base = { garment: "shirt-plaid", segment_prompt: "shirt" } as const;

/** The list as Grok posted it, in order. */
export const SP1_CASES: readonly Sp1Case[] = [
  { id: "sp1-01-dim", n: 1, pain: "dim room, under-exposed/clipped", expected: "REVIEW", expected_rule: "render_quality (clipped)", ...base, build: t({ op: "exposure", gain: 0.04 }) },
  { id: "sp1-02-busy-background", n: 2, pain: "busy bedspread background, fragmented mask", expected: "REVIEW", expected_rule: "render_quality (fragmentation)", ...base, build: real("a busy background has to be photographed; pasting a texture behind a cut-out would test the paste, not the phone photo") },
  { id: "sp1-03-creased-hem", n: 3, pain: "creased hem read as hem mismatch", expected: "REVIEW", expected_rule: "soft hem mismatch", ...base, build: real("creases are fabric folds; no pixel transform makes them") },
  { id: "sp1-04-folded", n: 4, pain: "folded garment, length hidden", expected: "REVIEW", expected_rule: "length not visible", ...base, build: real("a folded garment has to be folded and photographed") },
  { id: "sp1-05-mirror-angle", n: 5, pain: "odd mirror angle, no person, hem uncertain", expected: "REVIEW", expected_rule: "hem uncertain", ...base, build: real("a mirror shot needs the mirror; a warp of the flat photo is not one") },
  { id: "sp1-06-moire", n: 6, pain: "printed fabric moire, confident print_pattern mismatch", expected: "REFUSE", expected_rule: "hard print_pattern mismatch", ...base, build: real("moire comes from the camera sensor meeting the print; synthetic moire would be a guess") },
  { id: "sp1-07-harsh-shadow", n: 7, pain: "harsh phone shadow", expected: "REVIEW", expected_rule: "render_quality (shadow)", ...base, build: t({ op: "hard_shadow", darken: 0.3 }) },
  { id: "sp1-08-cut-off", n: 8, pain: "sleeve or hem cut off at frame edge", expected: "REVIEW", expected_rule: "render_quality (edge_touch)", ...base, build: t({ op: "crop_bottom", keep: 0.7 }) },
  { id: "sp1-09-too-small", n: 9, pain: "photo too small", expected: "REVIEW", expected_rule: "render_quality (resolution)", ...base, build: t({ op: "downscale", long_edge: 400 }) },
  { id: "sp1-10-other-kurta", n: 10, pain: "different kurta by mistake", expected: "REFUSE", expected_rule: "hard mismatch", garment: "kurta-01", segment_prompt: "kurta", build: { kind: "other_garment_render", render_garment: "kurta-02" } },
  { id: "sp1-11-dark-on-dark", n: 11, pain: "dark garment on similar background, no mask", expected: "REFUSE", expected_rule: "render_failed (no mask)", ...base, build: real("no committed garment is dark on a matching background; darkening one would change the garment, not the photo") },
  { id: "sp1-12-correction", n: 12, pain: "white-balance correction above dE 6", expected: "REVIEW", expected_rule: "render_quality (correction)", ...base, build: real("white balance runs only on a near-neutral garment (C* <= 8) and no committed garment is that neutral, so it needs a grey or white garment shot under coloured light; a light ramp on shirt-plaid trips the shadow check before the correction check (offline synthetic check in test/sp1.test.ts, not a run case: ramp to 0.5 passes with correction dE 3.27, ramp to 0.4 fails on shadow 0.61)") },
];

const byte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** One transform, pure and deterministic. Every pixel kept or changed by the stated amount; nothing drawn. */
export function applyTransform(img: RgbImage, tr: Sp1Transform): RgbImage {
  const { width: w, height: h, data } = img;
  switch (tr.op) {
    case "exposure":
      return { width: w, height: h, data: Uint8Array.from(data, (v) => byte(v * tr.gain)) };
    case "hard_shadow": {
      // A hard-edged diagonal shadow over the lower-right half of the frame.
      const out = new Uint8Array(data);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (x / w + y / h <= 1) continue;
        for (let c = 0; c < 3; c++) out[(y * w + x) * 3 + c] = byte(data[(y * w + x) * 3 + c]! * tr.darken);
      }
      return { width: w, height: h, data: out };
    }
    case "crop_bottom": {
      const nh = Math.max(1, Math.round(h * tr.keep));
      return { width: w, height: nh, data: data.slice(0, w * nh * 3) };
    }
    case "downscale": {
      // Box average onto the smaller grid: what a phone's "small" upload size does.
      const s = tr.long_edge / Math.max(w, h);
      const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
      const out = new Uint8Array(nw * nh * 3);
      for (let y = 0; y < nh; y++) {
        const y0 = Math.floor((y * h) / nh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / nh));
        for (let x = 0; x < nw; x++) {
          const x0 = Math.floor((x * w) / nw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / nw));
          const sum = [0, 0, 0];
          for (let v = y0; v < y1; v++) for (let u = x0; u < x1; u++) for (let c = 0; c < 3; c++) sum[c]! += data[(v * w + u) * 3 + c]!;
          const n = (y1 - y0) * (x1 - x0);
          for (let c = 0; c < 3; c++) out[(y * nw + x) * 3 + c] = Math.round(sum[c]! / n);
        }
      }
      return { width: nw, height: nh, data: out };
    }
    case "light_ramp": {
      // Light falling off left to right, as from a window to one side.
      const out = new Uint8Array(data.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const g = tr.from + ((tr.to - tr.from) * x) / Math.max(1, w - 1);
        for (let c = 0; c < 3; c++) out[(y * w + x) * 3 + c] = byte(data[(y * w + x) * 3 + c]! * g);
      }
      return { width: w, height: h, data: out };
    }
  }
}

export const SP1_JPEG_QUALITY = 92;

/** RGB to a baseline JPEG by jpeg-js: a JFIF header only, no EXIF, no ICC, no comment. */
export function encodeJpeg(img: RgbImage, quality: number = SP1_JPEG_QUALITY): Uint8Array {
  const rgba = new Uint8Array(img.width * img.height * 4);
  for (let i = 0; i < img.width * img.height; i++) {
    rgba[i * 4] = img.data[i * 3]!;
    rgba[i * 4 + 1] = img.data[i * 3 + 1]!;
    rgba[i * 4 + 2] = img.data[i * 3 + 2]!;
    rgba[i * 4 + 3] = 255;
  }
  return new Uint8Array(jpeg.encode({ width: img.width, height: img.height, data: rgba }, quality).data);
}

/** The JPEG markers before the scan, e.g. ["E0", "DB", ...]: for the no-metadata check. */
export function jpegMarkers(bytes: Uint8Array): string[] {
  const out: string[] = [];
  let i = 2;
  while (i + 3 < bytes.length && bytes[i] === 0xff) {
    const m = bytes[i + 1]!;
    out.push(m.toString(16).toUpperCase());
    if (m === 0xda) break;
    i += 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!);
  }
  return out;
}

export interface Sp1Built {
  readonly case_id: string;
  readonly dir: string;
  readonly photo: { readonly name: string; readonly sha256: string; readonly width: number; readonly height: number };
}

/**
 * Writes one transform case as a garment directory the pipeline reads: the
 * transformed front as its only photo, intake.json, the garment's note.txt, and
 * manifest.json naming the source photo, its hash and the transform.
 */
export function buildTransformCase(c: Sp1Case, garmentsRoot: string, outRoot: string): Sp1Built {
  if (c.build.kind !== "transform") throw new Error(`${c.id} is not a transform case`);
  const gdir = join(garmentsRoot, c.garment);
  const intake = JSON.parse(readFileSync(join(gdir, "intake.json"), "utf8")) as { files: { name: string; sha256: string }[] };
  const front = intake.files[0]!;
  const srcBytes = new Uint8Array(readFileSync(join(gdir, front.name)));
  if (sha256Hex(srcBytes) !== front.sha256) throw new Error(`${gdir}/${front.name} does not match its intake.json hash`);
  const img = applyTransform(decodeRgb(srcBytes), c.build.transform);
  const bytes = encodeJpeg(img);
  const sha = sha256Hex(bytes);
  const dir = join(outRoot, c.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, front.name), bytes);
  writeFileSync(join(dir, "intake.json"), `${JSON.stringify({ garment: c.id, files: [{ source_name: front.name, name: front.name, source_sha256: sha, sha256: sha, removed: [] }] }, null, 2)}\n`);
  writeFileSync(join(dir, "note.txt"), readFileSync(join(gdir, "note.txt")));
  const manifest = {
    case: c.id,
    n: c.n,
    pain: c.pain,
    synthetic: true,
    from: { garment: c.garment, photo: `data/garments/${c.garment}/${front.name}`, sha256: front.sha256 },
    transform: c.build.transform,
    encoder: `jpeg-js ${SP1_JPEG_QUALITY}, JFIF only (no EXIF, no ICC)`,
    photo: { name: front.name, sha256: sha, width: img.width, height: img.height },
    segment_prompt: c.segment_prompt,
    person: "none (the owner's flat garment photo, transformed)",
    expected: { decision: c.expected, rule: c.expected_rule },
  };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { case_id: c.id, dir, photo: manifest.photo };
}

export interface Sp1Row {
  readonly n: number;
  readonly case: string;
  readonly pain: string;
  readonly expected: Decision;
  readonly expected_rule: string;
  readonly status: "run" | "not_run";
  readonly actual?: Decision | null;
  readonly actual_reason?: string | null;
  readonly agrees?: boolean | null;
  readonly synthetic?: boolean;
  readonly note: string;
}

interface Line {
  readonly kind: string;
  readonly payload: Record<string, unknown>;
}

/** The decision and cited reason of a job's last gate entry, or null when the receipt has none. */
export function gateOf(receiptText: string): { decision: Decision; reason: string } | null {
  const ls = receiptText.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Line);
  const gate = ls.filter((l) => l.kind === "gate").at(-1)?.payload;
  if (!gate || (gate.decision !== "RELEASE" && gate.decision !== "REVIEW" && gate.decision !== "REFUSE")) return null;
  const cited = gate.cited as { rule?: unknown; reason?: unknown; attribute?: unknown } | null | undefined;
  const reason = cited ? [cited.rule ?? cited.attribute, cited.reason].filter((x) => x !== undefined && x !== null).map(String).join(": ") : "";
  return { decision: gate.decision, reason };
}

export function sp1Summary(rows: readonly Sp1Row[]) {
  const run = rows.filter((r) => r.status === "run");
  const answered = run.filter((r) => r.actual);
  return {
    cases: rows.length,
    run: run.length,
    not_run: rows.length - run.length,
    answered: answered.length,
    agree: answered.filter((r) => r.agrees).length,
    disagree: answered.filter((r) => r.agrees === false).length,
    released: answered.filter((r) => r.actual === "RELEASE").length,
  };
}
