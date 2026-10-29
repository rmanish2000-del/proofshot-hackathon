// MS4 (Grok, 29 Oct 15:54 IST on #23): the Muse Spark cross-check matrix.
//
// Every garment with committed photos is paired with every distinct labelled
// render image in the committed jobs, its own and the other garment's, so the
// checker meets known-wrong pairs (kurta-01 photos against kurta-02 renders and
// the reverse), not only itself. Each pair is asked REPEATS times to measure how
// often Muse Spark gives the same answer. The truth for a pair comes from
// data/calibration/labels.json (what each render image shows, and what a try-on
// changed), never from the model. This file plans and scores; the calls are made
// by scripts/ms4-batch.ts. The gate itself is not changed: a pair's decision is
// the gate's own `decide` over Muse Spark's findings.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { RenderLabel } from "./calibrate.ts";
import { decide } from "./gate.ts";
import type { GateFidelity } from "./gate.ts";
import type { Decision, DecisionInput } from "./types.ts";

export const MS4_REPEATS = 3;

/** same: the render shows this garment unchanged; changed: this garment, altered (a try-on); other_garment: a different garment. */
export type Ms4Expected = "same" | "changed" | "other_garment";

export interface Ms4Render {
  readonly render_sha256: string;
  readonly path: string;
  readonly label: RenderLabel;
  /** Committed jobs whose receipt has this render. */
  readonly jobs: readonly string[];
}

export interface Ms4Pair {
  /** `<garment>~<first 12 hex of the render sha256>`. */
  readonly id: string;
  readonly garment: string;
  readonly garment_dir: string;
  readonly render_sha256: string;
  readonly render_path: string;
  readonly expected: Ms4Expected;
}

export interface Ms4Plan {
  readonly garments: readonly string[];
  readonly renders: readonly Ms4Render[];
  readonly pairs: readonly Ms4Pair[];
  readonly skipped: readonly { readonly what: string; readonly reason: string }[];
}

/** One call: findings when the verifier answered and its answer parsed, else the error. */
export interface Ms4Run {
  readonly pair_id: string;
  readonly rep: number;
  readonly started_at: string;
  readonly ok: boolean;
  readonly findings?: readonly DecisionInput[];
  readonly error?: string;
  readonly log?: string;
}

interface Line {
  readonly kind: string;
  readonly payload: Record<string, unknown>;
}

function lines(path: string): Line[] {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Line);
}

/** Garment directories that have committed photos (an intake.json). */
export function photographedGarments(garmentsRoot: string): string[] {
  return readdirSync(garmentsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(garmentsRoot, d.name, "intake.json")))
    .map((d) => d.name)
    .sort();
}

/** The photos of one garment as its intake.json lists them, in order. */
export function garmentPhotos(garmentDir: string): { name: string; path: string; sha256: string }[] {
  const intake = JSON.parse(readFileSync(join(garmentDir, "intake.json"), "utf8")) as { files?: { name?: unknown; sha256?: unknown }[] };
  return (intake.files ?? [])
    .filter((f) => typeof f.name === "string" && typeof f.sha256 === "string")
    .map((f) => ({ name: f.name as string, path: join(garmentDir, f.name as string), sha256: f.sha256 as string }));
}

export function expectedFor(garment: string, label: RenderLabel): Ms4Expected {
  if (label.shows !== garment) return "other_garment";
  return label.changed === undefined ? "same" : "changed";
}

/** Plans the matrix: photographed garments x distinct labelled render images stored in committed jobs. */
export function planMs4(jobsRoot: string, garmentsRoot: string, labels: ReadonlyMap<string, RenderLabel>): Ms4Plan {
  const garments = photographedGarments(garmentsRoot);
  const skipped: { what: string; reason: string }[] = [];
  const bySha = new Map<string, { path: string; jobs: string[] }>();
  const jobs = readdirSync(jobsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const job of jobs) {
    if (job.startsWith("upload-")) continue;
    const receipt = join(jobsRoot, job, "receipt.jsonl");
    if (!existsSync(receipt)) continue;
    for (const { payload } of lines(receipt).filter((l) => l.kind === "render")) {
      const sha = String(payload.sha256 ?? "");
      const id = String(payload.render_id ?? "");
      const file = ["png", "jpg"].map((ext) => join(jobsRoot, job, `${id}.${ext}`)).find((p) => existsSync(p));
      if (!/^[0-9a-f]{64}$/.test(sha) || !file) continue;
      const seen = bySha.get(sha);
      if (seen) seen.jobs.push(job);
      else bySha.set(sha, { path: file, jobs: [job] });
    }
  }
  const renders: Ms4Render[] = [];
  for (const [sha, r] of [...bySha].sort((a, b) => a[0].localeCompare(b[0]))) {
    const label = labels.get(sha);
    if (!label) {
      skipped.push({ what: `render ${sha.slice(0, 12)} (${r.jobs.join(", ")})`, reason: "no label in data/calibration/labels.json (the fixture shirt's synthetic images)" });
      continue;
    }
    if (!garments.includes(label.shows)) {
      skipped.push({ what: `render ${sha.slice(0, 12)}`, reason: `its garment ${label.shows} has no committed photos` });
      continue;
    }
    renders.push({ render_sha256: sha, path: r.path, label, jobs: r.jobs });
  }
  const pairs: Ms4Pair[] = [];
  for (const garment of garments) {
    for (const r of renders) {
      pairs.push({
        id: `${garment}~${r.render_sha256.slice(0, 12)}`,
        garment,
        garment_dir: join(garmentsRoot, garment),
        render_sha256: r.render_sha256,
        render_path: r.path,
        expected: expectedFor(garment, r.label),
      });
    }
  }
  return { garments, renders, pairs, skipped };
}

/** A recorded gate decision to compare with: the job, its garment, render and recorded fidelity. */
export interface Ms4Recorded {
  readonly job_id: string;
  readonly garment: string;
  readonly render_sha256: string;
  readonly fidelity: GateFidelity | null;
  readonly decision: Decision;
}

/**
 * The gate decisions committed receipts recorded, with each job's garment taken
 * from its source photo hashes (`photos`: photo sha256 -> garment). Fixture jobs
 * are left out: their fidelity entries were written, not measured.
 */
export function recordedDecisions(jobsRoot: string, photos: ReadonlyMap<string, string>): Ms4Recorded[] {
  const out: Ms4Recorded[] = [];
  for (const job of readdirSync(jobsRoot).sort()) {
    const receipt = join(jobsRoot, job, "receipt.jsonl");
    if (job.startsWith("upload-") || !existsSync(receipt)) continue;
    const ls = lines(receipt);
    const head = ls.find((l) => l.kind === "job")?.payload ?? {};
    if (head.provenance === "fixture") continue;
    const sources = Array.isArray(head.source_images) ? (head.source_images as { sha256?: unknown }[]) : [];
    const gs = new Set(sources.map((s) => photos.get(String(s.sha256))));
    const garment = gs.size === 1 ? [...gs][0] : undefined;
    if (!garment) continue;
    for (const { payload: render } of ls.filter((l) => l.kind === "render")) {
      const of = (kind: string) => ls.find((l) => l.kind === kind && l.payload.render_id === render.render_id)?.payload;
      const gate = of("gate")?.decision;
      if (gate !== "RELEASE" && gate !== "REVIEW" && gate !== "REFUSE") continue;
      const fid = of("fidelity");
      const fidelity = fid && typeof fid.decision === "string"
        ? { decision: fid.decision as Decision, reasons: Array.isArray(fid.reasons) ? fid.reasons.map(String) : [] }
        : null;
      out.push({ job_id: job, garment, render_sha256: String(render.sha256), fidelity, decision: gate });
    }
  }
  return out;
}

const rate = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 1000);

export interface Ms4PairScore {
  readonly id: string;
  readonly garment: string;
  readonly render_sha256: string;
  readonly expected: Ms4Expected;
  readonly runs: number;
  readonly failed: number;
  /** The gate's decision over Muse Spark's findings alone, per answered run, in rep order. */
  readonly decisions: readonly Decision[];
  /** True when every answered run gave the same decision (null with fewer than two answers). */
  readonly consistent: boolean | null;
  /** Share of the 9 attributes on which every answered run gave the same verdict. */
  readonly verdict_agreement: number | null;
  /** Answered runs whose decision is right for the label: RELEASE for same, not RELEASE otherwise. */
  readonly correct: number;
}

export interface Ms4Summary {
  readonly pairs: number;
  readonly runs: number;
  readonly answered: number;
  readonly failed: number;
  readonly by_expected: Readonly<Record<Ms4Expected, { readonly pairs: number; readonly answered: number; readonly correct: number; readonly correct_rate: number | null; readonly refused: number }>>;
  /** Known-wrong pairs (other_garment): answered runs not released, and the share. */
  readonly mismatch_catch: { readonly answered: number; readonly caught: number; readonly rate: number | null; readonly refused: number };
  readonly consistency: { readonly pairs_scored: number; readonly same_decision_all_reps: number; readonly rate: number | null; readonly mean_verdict_agreement: number | null };
  /**
   * Committed gate decisions re-made with Muse Spark's findings for the same
   * garment and render, plus the job's recorded fidelity result: one comparison
   * per (recorded decision, answered run).
   */
  readonly gate_agreement: { readonly compared: number; readonly agree: number; readonly rate: number | null; readonly disagreements: readonly { job_id: string; recorded: Decision; ms4: Decision; rep: number }[] };
  readonly pair_scores: readonly Ms4PairScore[];
}

export function scoreMs4(pairs: readonly Ms4Pair[], runs: readonly Ms4Run[], recorded: readonly Ms4Recorded[]): Ms4Summary {
  const scores: Ms4PairScore[] = [];
  for (const p of pairs) {
    const mine = runs.filter((r) => r.pair_id === p.id).sort((a, b) => a.rep - b.rep);
    const answered = mine.filter((r) => r.ok && r.findings);
    const decisions = answered.map((r) => decide(r.findings!).decision);
    const right = (d: Decision) => (p.expected === "same" ? d === "RELEASE" : d !== "RELEASE");
    let agreement: number | null = null;
    if (answered.length >= 2) {
      const attrs = new Set(answered.flatMap((r) => r.findings!.map((f) => f.attribute)));
      let same = 0;
      for (const a of attrs) {
        const vs = answered.map((r) => r.findings!.find((f) => f.attribute === a)?.verdict ?? "none");
        if (vs.every((v) => v === vs[0])) same++;
      }
      agreement = rate(same, attrs.size);
    }
    scores.push({
      id: p.id, garment: p.garment, render_sha256: p.render_sha256, expected: p.expected,
      runs: mine.length, failed: mine.length - answered.length, decisions,
      consistent: decisions.length >= 2 ? decisions.every((d) => d === decisions[0]) : null,
      verdict_agreement: agreement,
      correct: decisions.filter(right).length,
    });
  }
  const group = (e: Ms4Expected) => {
    const s = scores.filter((x) => x.expected === e);
    const answered = s.reduce((n, x) => n + x.decisions.length, 0);
    const correct = s.reduce((n, x) => n + x.correct, 0);
    return { pairs: s.length, answered, correct, correct_rate: rate(correct, answered), refused: s.reduce((n, x) => n + x.decisions.filter((d) => d === "REFUSE").length, 0) };
  };
  const by_expected = { same: group("same"), changed: group("changed"), other_garment: group("other_garment") };
  const scored = scores.filter((x) => x.consistent !== null);
  const agreements = scores.map((x) => x.verdict_agreement).filter((v): v is number => v !== null);

  const disagreements: { job_id: string; recorded: Decision; ms4: Decision; rep: number }[] = [];
  let compared = 0;
  for (const rec of recorded) {
    const pair = pairs.find((p) => p.garment === rec.garment && p.render_sha256 === rec.render_sha256);
    if (!pair) continue;
    for (const run of runs.filter((r) => r.pair_id === pair.id && r.ok && r.findings)) {
      compared++;
      const ms4 = decide(run.findings!, rec.fidelity ?? undefined).decision;
      if (ms4 !== rec.decision) disagreements.push({ job_id: rec.job_id, recorded: rec.decision, ms4, rep: run.rep });
    }
  }
  const answered = scores.reduce((n, x) => n + x.decisions.length, 0);
  return {
    pairs: pairs.length,
    runs: runs.length,
    answered,
    failed: runs.length - answered,
    by_expected,
    mismatch_catch: { answered: by_expected.other_garment.answered, caught: by_expected.other_garment.correct, rate: by_expected.other_garment.correct_rate, refused: by_expected.other_garment.refused },
    consistency: {
      pairs_scored: scored.length,
      same_decision_all_reps: scored.filter((x) => x.consistent).length,
      rate: rate(scored.filter((x) => x.consistent).length, scored.length),
      mean_verdict_agreement: agreements.length ? Math.round((agreements.reduce((a, b) => a + b, 0) / agreements.length) * 1000) / 1000 : null,
    },
    gate_agreement: { compared, agree: compared - disagreements.length, rate: rate(compared - disagreements.length, compared), disagreements },
    pair_scores: scores,
  };
}
