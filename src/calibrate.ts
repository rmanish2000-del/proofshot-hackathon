// Calibration scorer (R4, Grok 28 Oct 09:55): how often the fidelity check and
// the gate get a labelled pair wrong, for each candidate set of thresholds.
//
// A case is one source photo and one candidate render with their masks, and a
// label: `same` (the render shows the source's garment) or `different` (another
// garment). For each candidate thresholds set every case is checked with
// checkFidelity, then the gate's decide() on top with the case's verifier
// findings. A case with no findings (absent or undefined) has nothing verified
// and fails closed: the gate refuses it as not_verified, the same as a verifier
// that failed (N1, Grok 28 Oct 11:16). Scoring the fidelity check alone, as the
// CLI does over photos no verifier has seen, is an explicit option
// (`scope: "fidelity"`), never the default. A `different` case that comes out
// RELEASE is a false match; a `same` case that comes out REFUSE is a false
// refuse. REVIEW is neither and is counted on its own, as is a case fidelity
// could not measure (metrics null). Nothing here reads files or calls a model.

import { checkFidelity, judgeMetrics } from "./fidelity.ts";
import type { Metrics, Thresholds } from "./fidelity.ts";
import { decide } from "./gate.ts";
import type { Mask, RgbImage } from "./png.ts";
import type { Decision, DecisionInput } from "./types.ts";

export type CalibrationLabel = "same" | "different";

export interface CalibrationCase {
  readonly id: string;
  readonly label: CalibrationLabel;
  readonly source: RgbImage;
  readonly render: RgbImage;
  readonly sourceMask: Mask | null | undefined;
  readonly renderMask: Mask | null | undefined;
  /** The verifier's findings for this pair; absent means nothing was verified, so the gate refuses it. */
  readonly findings?: readonly DecisionInput[];
}

export interface ScoreOptions {
  /**
   * `gate` (default): the gate's decision, findings plus fidelity. `fidelity`:
   * the fidelity decision alone, findings ignored; for tuning thresholds on
   * photos no verifier has judged, and never a release decision.
   */
  readonly scope?: "gate" | "fidelity";
}

export interface Candidate {
  readonly name: string;
  readonly thresholds: Thresholds;
}

export interface CaseResult {
  readonly id: string;
  readonly label: CalibrationLabel;
  readonly fidelity: Decision;
  /** The gate's decision (REFUSE when the case has no findings), or the fidelity decision under scope `fidelity`. */
  readonly decision: Decision;
  readonly measured: boolean;
  /** The fidelity check's raw values for the pair (N10); null when unmeasured. They do not depend on the thresholds. */
  readonly metrics: Metrics | null;
}

export interface CandidateScore {
  readonly name: string;
  readonly same: number;
  readonly different: number;
  /** `different` cases released. */
  readonly false_match: number;
  /** `same` cases refused. */
  readonly false_refuse: number;
  readonly review_same: number;
  readonly review_different: number;
  readonly unmeasured: number;
  readonly cases: readonly CaseResult[];
}

export function scoreCalibration(cases: readonly CalibrationCase[], candidates: readonly Candidate[], options: ScoreOptions = {}): CandidateScore[] {
  return scoreWith(cases, candidates, options, checkFidelity);
}

/**
 * A render a committed job already checked: the fidelity values and verifier
 * findings its receipt recorded, and a label. The values do not depend on the
 * thresholds, so each candidate is applied to them with judgeMetrics; no image
 * is decoded and no model is called.
 */
export interface RecordedCase {
  readonly id: string;
  readonly label: CalibrationLabel;
  /** null when the job could not measure fidelity: REVIEW under every candidate. */
  readonly metrics: Metrics | null;
  /** The receipt's reasons for an unmeasured fidelity, kept as the REVIEW reasons. */
  readonly unmeasuredReasons?: readonly string[];
  /** The receipt's verifier findings; absent fails closed at the gate, as in scoreCalibration. */
  readonly findings?: readonly DecisionInput[];
}

export function scoreRecorded(cases: readonly RecordedCase[], candidates: readonly Candidate[], options: ScoreOptions = {}): CandidateScore[] {
  return scoreWith(cases, candidates, options, (c, t) =>
    c.metrics
      ? { ...judgeMetrics(c.metrics, t), metrics: c.metrics }
      : { decision: "REVIEW", reasons: c.unmeasuredReasons ?? ["fidelity was not measured on this job"], metrics: null },
  );
}

interface Judged {
  readonly decision: Decision;
  readonly reasons: readonly string[];
  readonly metrics: Metrics | null;
}

function scoreWith<C extends { readonly id: string; readonly label: CalibrationLabel; readonly findings?: readonly DecisionInput[] }>(
  cases: readonly C[],
  candidates: readonly Candidate[],
  options: ScoreOptions,
  judge: (c: C, t: Thresholds) => Judged,
): CandidateScore[] {
  const scope = options.scope ?? "gate";
  if (scope !== "gate" && scope !== "fidelity") throw new Error(`calibration: scope ${JSON.stringify(scope)}, say gate or fidelity`);
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`calibration: case id ${JSON.stringify(c.id)} appears twice`);
    ids.add(c.id);
    if (c.label !== "same" && c.label !== "different") throw new Error(`calibration: case ${c.id} has label ${JSON.stringify(c.label)}, not same or different`);
  }
  return candidates.map(({ name, thresholds }) => {
    const results = cases.map((c): CaseResult => {
      const fid = judge(c, thresholds);
      // No findings goes to the gate as none at all, which refuses it as not verified.
      const decision = scope === "fidelity" ? fid.decision : decide(c.findings ?? [], { decision: fid.decision, reasons: fid.reasons }).decision;
      return { id: c.id, label: c.label, fidelity: fid.decision, decision, measured: fid.metrics !== null, metrics: fid.metrics };
    });
    const count = (label: CalibrationLabel, decision: Decision) => results.filter((r) => r.label === label && r.decision === decision).length;
    return {
      name,
      same: results.filter((r) => r.label === "same").length,
      different: results.filter((r) => r.label === "different").length,
      false_match: count("different", "RELEASE"),
      false_refuse: count("same", "REFUSE"),
      review_same: count("same", "REVIEW"),
      review_different: count("different", "REVIEW"),
      unmeasured: results.filter((r) => !r.measured).length,
      cases: results,
    };
  });
}

/**
 * One line per pair with its label and the four fidelity values (N10, Grok 28
 * Oct 15:05), or `unmeasured` when fidelity could not measure it. Values only:
 * no decision and no threshold, so the lines read the same for every candidate.
 */
export function pairMetricLines(cases: readonly CaseResult[]): string[] {
  const n = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
  return cases.map((c) => {
    const values = c.metrics ? `delta_e ${n(c.metrics.delta_e)}  hist ${n(c.metrics.hist)}  texture ${n(c.metrics.texture)}  area ${n(c.metrics.area)}` : "unmeasured";
    return `${c.label.padEnd(9)}  ${c.id}: ${values}`;
  });
}

export interface GarmentPhoto {
  /** The garment's directory name, e.g. `kurta-01`. */
  readonly garment: string;
  readonly name: string;
}

export interface LabelledPair<T extends GarmentPhoto> {
  readonly id: string;
  readonly label: CalibrationLabel;
  readonly source: T;
  readonly render: T;
}

/**
 * Every ordered pair of two different photos, the first as the source and the
 * second as the render, labelled `same` when both come from one garment
 * directory and `different` otherwise (Grok 28 Oct 10:48, answer to 1002-23).
 * The id is `<garment>/<name> -> <garment>/<name>`.
 */
export function labelledPairs<T extends GarmentPhoto>(photos: readonly T[]): LabelledPair<T>[] {
  const pairs: LabelledPair<T>[] = [];
  for (const source of photos) {
    for (const render of photos) {
      if (source === render) continue;
      pairs.push({
        id: `${source.garment}/${source.name} -> ${render.garment}/${render.name}`,
        label: source.garment === render.garment ? "same" : "different",
        source,
        render,
      });
    }
  }
  return pairs;
}

/**
 * What one render image shows, keyed by its sha256 (Grok 29 Oct 14:10): the
 * garment directory (data/garments/<shows>/note.txt) and, when the image
 * altered it, what changed (e.g. a long kurta come back hip-length). The same
 * image can be a render in jobs for different garments, so the label is a fact
 * about the image; recordedRenders compares it with each job's garment. `by`
 * and `why` say who set it and from what.
 */
export interface RenderLabel {
  readonly shows: string;
  readonly changed?: string;
  readonly by: string;
  readonly why: string;
}

/** Validates a labels file `{ renders: { <sha256>: RenderLabel } }`; anything else throws. */
export function parseRenderLabels(value: unknown): Map<string, RenderLabel> {
  const renders = (value as { renders?: unknown } | null)?.renders;
  if (typeof renders !== "object" || renders === null || Array.isArray(renders)) throw new Error("calibration labels: need an object `renders`");
  const text = (v: unknown) => typeof v === "string" && v.trim() !== "";
  const out = new Map<string, RenderLabel>();
  for (const [sha, raw] of Object.entries(renders)) {
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`calibration labels: ${JSON.stringify(sha)} is not a sha256`);
    const l = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    for (const key of ["shows", "by", "why"] as const) {
      if (!text(l[key])) throw new Error(`calibration labels: ${sha} needs ${key}`);
    }
    if (l.changed !== undefined && !text(l.changed)) throw new Error(`calibration labels: ${sha} changed must say what changed, or be left out`);
    out.set(sha, { shows: l.shows as string, ...(l.changed !== undefined ? { changed: l.changed as string } : {}), by: l.by as string, why: l.why as string });
  }
  return out;
}

export interface ReceiptLine {
  readonly kind: string;
  readonly payload: Record<string, unknown>;
}

export interface RecordedRender extends RecordedCase {
  readonly job_id: string;
  readonly render_sha256: string;
  readonly garment: string;
  /** The gate decision the receipt recorded, to check a rerun at the config thresholds against. */
  readonly recorded: Decision | null;
}

export interface SkippedRender {
  readonly id: string;
  readonly render_sha256: string;
  readonly reason: string;
}

/**
 * The scoreable renders of one receipt: every render entry with a fidelity
 * entry, its recorded metrics (null when unmeasured) and verifier findings
 * (absent when no verifier entry, which fails closed). The job's garment is the
 * one garment directory all its source photos belong to, by sha256 (`photos`:
 * photo sha256 -> directory, from each intake.json); the case is `same` when
 * the render's label shows that garment unchanged, else `different`. Skipped
 * with the reason, never guessed: a fixture job (its fidelity entry was
 * written, not measured), sources from no or several garment directories, a
 * render with no label, or no fidelity entry (a job run without the check).
 */
export function recordedRenders(
  lines: readonly ReceiptLine[],
  labels: ReadonlyMap<string, RenderLabel>,
  photos: ReadonlyMap<string, string>,
): { cases: RecordedRender[]; skipped: SkippedRender[] } {
  const job = lines.find((l) => l.kind === "job")?.payload ?? {};
  const job_id = String(job.job_id ?? "");
  const sources = Array.isArray(job.source_images) ? (job.source_images as { sha256?: unknown }[]) : [];
  const garments = new Set(sources.map((s) => photos.get(String(s.sha256)) ?? null));
  const garment = garments.size === 1 ? [...garments][0] : null;
  const jobProblem = job.provenance === "fixture"
    ? "fixture job: its fidelity entry was written, not measured"
    : garment
      ? null
      : garments.size === 0
        ? "the job lists no source photos"
        : `source photos belong to ${[...garments].map((g) => g ?? "no garment directory").join(" and ")}`;
  const forRender = (kind: string, id: unknown) => lines.find((l) => l.kind === kind && l.payload.render_id === id)?.payload;
  const cases: RecordedRender[] = [];
  const skipped: SkippedRender[] = [];
  for (const { payload: render } of lines.filter((l) => l.kind === "render")) {
    const id = String(render.render_id);
    const render_sha256 = String(render.sha256);
    const skip = (reason: string) => skipped.push({ id, render_sha256, reason });
    if (jobProblem || !garment) {
      skip(jobProblem ?? "no garment");
      continue;
    }
    const fidelity = forRender("fidelity", render.render_id);
    if (!fidelity) {
      skip("no fidelity entry: the job ran without the fidelity check");
      continue;
    }
    const label = labels.get(render_sha256);
    if (!label) {
      skip("no label for this render");
      continue;
    }
    const m =fidelity.metrics as Record<string, unknown> | null | undefined;
    const metrics = m && ["delta_e", "hist", "texture", "area"].every((k) => typeof m[k] === "number")
      ? { delta_e: m.delta_e as number, hist: m.hist as number, texture: m.texture as number, area: m.area as number }
      : null;
    const verifier = forRender("verifier", render.render_id);
    const gate = forRender("gate", render.render_id)?.decision;
    cases.push({
      id,
      label: label.shows === garment && label.changed === undefined ? "same" : "different",
      metrics,
      ...(metrics ? {} : { unmeasuredReasons: Array.isArray(fidelity.reasons) ? fidelity.reasons.map(String) : [] }),
      ...(verifier && Array.isArray(verifier.findings) ? { findings: verifier.findings as DecisionInput[] } : {}),
      job_id,
      render_sha256,
      garment,
      recorded: gate === "RELEASE" || gate === "REVIEW" || gate === "REFUSE" ? gate : null,
    });
  }
  return { cases, skipped };
}

/** A mask that is garment everywhere: for a whole-frame baseline run only, background included. */
export function wholeFrameMask(img: RgbImage): Mask {
  return { width: img.width, height: img.height, data: new Uint8Array(img.width * img.height).fill(1) };
}

/**
 * Candidates around a base set: factor f multiplies the delta_e and hist
 * limits and divides the texture limits (capped at 1), so f > 1 is looser and
 * f < 1 stricter on all three. Area bounds stay as they are. Each factor must
 * be a positive finite number; the name is `x<f>`.
 */
export function scaledCandidates(base: Thresholds, factors: readonly number[]): Candidate[] {
  return factors.map((f) => {
    if (!(Number.isFinite(f) && f > 0)) throw new Error(`calibration: scale factor ${f} must be a positive finite number`);
    const tex = (v: number) => Math.min(1, v / f);
    return {
      name: `x${f}`,
      thresholds: {
        delta_e: { review_above: base.delta_e.review_above * f, refuse_above: base.delta_e.refuse_above * f },
        hist: { review_above: base.hist.review_above * f, refuse_above: base.hist.refuse_above * f },
        texture: { review_below: tex(base.texture.review_below), refuse_below: tex(base.texture.refuse_below) },
        area: base.area,
      },
    };
  });
}
