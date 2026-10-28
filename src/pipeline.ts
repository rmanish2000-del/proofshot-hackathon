// The job pipeline (SPEC §3): job → segments → (render → verifier → fidelity →
// gate → release) per scene, every step appended to the job's receipt as it
// happens.
//
// Providers are injected, so the same code runs live or on fixtures. Failure is
// closed and visible at each boundary: unreadable prior records or a segmenter
// that throws refuse the job before any render; a renderer that throws refuses
// its scene and the job goes on; a verifier that throws or answers badly leaves
// its render with no findings, which the gate refuses as not verified; a
// fidelity check that throws is a REFUSE, never a pass.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { FidelityResult } from "./fidelity.ts";
import { decide } from "./gate.ts";
import type { GateReason } from "./gate.ts";
import { RECEIPT_FILE, priorRecords } from "./prior.ts";
import { refuseMuseImage } from "./render.ts";
import type { PriorRecord } from "./prior.ts";
import { Receipt, garmentId } from "./receipt.ts";
import type { Clock } from "./receipt.ts";
import { parseFindings } from "./schema.ts";
import type { Finding } from "./schema.ts";
import type { Decision } from "./types.ts";
import { sha256Hex } from "./util.ts";

export type Provenance = "live" | "fixture" | "replay";

/** What a replay's job entry names: the recording it ran from (SPEC §7). */
export interface RecordedFrom {
  readonly recording: string;
  readonly job_id: string;
  /** The recorded job's chain head. */
  readonly head: string;
}

export interface SourceImage {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface Segment {
  readonly label: string;
  /** [x, y, w, h], each 0..1 of the image. */
  readonly box: readonly [number, number, number, number];
  readonly score: number;
  /**
   * The mask bytes, or only their sha256 when the bytes are gone: a replay
   * (SPEC §7) knows a recorded mask by its hash alone, since the receipt
   * records masks as mask_sha256 and nothing else.
   */
  readonly mask: Uint8Array | { readonly sha256: string } | null;
}

export interface Segmenter {
  /**
   * Which model segmented, recorded on the segments entry as `segmenter`. A
   * fixture segmenter has none and the entry carries no claim (SPEC §3, §10).
   */
  readonly identity?: { readonly provider: string; readonly model: string };
  segment(sources: readonly SourceImage[]): Promise<Segment[]>;
}

export interface RenderedImage {
  readonly bytes: Uint8Array;
  readonly ext: string;
  /**
   * Extra fields for the receipt's render entry, after the fixed ones: how the
   * image was made (`method`, `generative`, template, mask, params). A renderer
   * that gives none adds nothing, so older receipts keep their shape.
   */
  readonly record?: Readonly<Record<string, unknown>>;
  /**
   * The garment's mask in the render's own frame, when the renderer knows it
   * exactly (a composite carries the source mask through its warp), as a
   * greyscale PNG. The fidelity check uses it instead of segmenting the render.
   */
  readonly renderMask?: Uint8Array;
  /**
   * The renderer that actually made this image, when it is not the one asked:
   * a generative provider that fell back to the composite (NR4). The render
   * entry's provider and model are then these, so the receipt never names a
   * model that drew nothing.
   */
  readonly madeBy?: { readonly provider: Renderer["provider"]; readonly model: string };
}

export interface Renderer {
  /**
   * `stand-in` generates nothing: it returns the owner's own photo (SPEC §8).
   * `composite` generates nothing either: it places the seller's garment pixels
   * on a template by deterministic code (SPEC-render-fix).
   * `replicate-pruna-tryon` is generative: Pruna p-image-try-on on Replicate (NR4).
   */
  readonly provider: "meta" | "openai-images" | "fal" | "fixture" | "stand-in" | "composite" | "replicate-pruna-tryon";
  readonly model: string;
  /** `segments` is the job's segmentation, which runs before any render (runJob always passes it); most renderers ignore it. */
  render(req: { scene: string; prompt: string; sources: readonly SourceImage[]; segments?: readonly Segment[] }): Promise<RenderedImage>;
}

/** One verifier request when the first answer was cut off: the limit asked for and how it ended. */
export interface VerifierAttempt {
  readonly max_tokens: number;
  readonly finish_reason: string | null;
  readonly completion_tokens?: number;
  readonly reasoning_tokens?: number;
}

export interface VerifierUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly cached_tokens?: number;
  readonly images?: readonly { bytes: number; width: number; height: number }[];
  /** Present only after a retry: every attempt in order, the last one is the answer used (or refused). */
  readonly attempts?: readonly VerifierAttempt[];
}

export interface Verifier {
  readonly identity: { readonly provider: string; readonly model: string; readonly base: string };
  /** Returns the raw model output; parseFindings reads it. */
  verify(req: { sources: readonly SourceImage[]; render: Uint8Array; renderId: string; scene: string }): Promise<{ raw: unknown; usage?: VerifierUsage }>;
}

/** The garment-fidelity check of SPEC §10 for one render. */
export interface FidelityChecker {
  /** `renderMask` is the renderer's own mask of the garment in the render (a greyscale PNG), when it has one. */
  check(req: { sources: readonly SourceImage[]; segments: readonly Segment[]; render: Uint8Array; renderMask?: Uint8Array; renderId: string; scene: string }): Promise<FidelityResult & { readonly render_mask?: string }>;
}

export interface Providers {
  readonly segmenter: Segmenter;
  readonly renderer: Renderer;
  readonly verifier: Verifier;
  readonly fidelity: FidelityChecker;
}

export interface JobInput {
  /** Also the job's directory name under the output root. */
  readonly jobId: string;
  readonly garmentNote: string;
  readonly scenes: readonly string[];
  readonly sources: readonly SourceImage[];
  /** Who releases a RELEASE decision; "unattended" (the default) is not a human. */
  readonly approver?: string;
}

export interface RunOptions {
  readonly outRoot: string;
  readonly providers: Providers;
  readonly provenance: Provenance;
  /** Required with provenance "replay", refused with any other. */
  readonly recordedFrom?: RecordedFrom;
  readonly clock?: Clock;
}

export interface RenderOutcome {
  readonly render_id: string;
  /** null when the renderer threw, so there is no image. */
  readonly image_sha256: string | null;
  readonly decision: Decision;
  readonly cited: GateReason | StepRefusal | null;
}

/**
 * A refusal the pipeline writes as a gate entry because a step failed, not
 * because of findings: the whole job (`render_id: null`) or one scene.
 */
export interface StepRefusal {
  readonly attribute: null;
  readonly verdict: null;
  readonly confidence: null;
  /**
   * `verifier_truncated` is per scene: the verifier's answer stopped at max_tokens twice (SPEC §4).
   * `render_quality` is per scene and the one rule that is REVIEW, not REFUSE: the composite's
   * pre-check found the photo unfit for a product shot (SPEC-composite-v2 §7), so there is no image.
   */
  readonly rule: "prior_records_unreadable" | "segment_failed" | "render_failed" | "verifier_truncated" | "render_quality";
  readonly reason: string;
}

export interface JobResult {
  readonly dir: string;
  readonly head: string;
  readonly garment_id: string | null;
  readonly prior_records: readonly PriorRecord[] | null;
  /** Set when the job was refused before any render. */
  readonly refused: StepRefusal | null;
  readonly renders: readonly RenderOutcome[];
}

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function renderPrompt(garmentNote: string, scene: string): string {
  return `Product photo of this exact garment, unchanged: ${garmentNote}. Scene: ${scene}.`;
}

export async function runJob(job: JobInput, opts: RunOptions): Promise<JobResult> {
  if (!JOB_ID.test(job.jobId)) throw new Error(`job id ${JSON.stringify(job.jobId)} is not a safe directory name`);
  const dir = join(opts.outRoot, job.jobId);
  const path = join(dir, RECEIPT_FILE);
  // One job, one chain: a job id that already has a receipt is never written into twice.
  if (existsSync(path)) throw new Error(`job ${job.jobId} already has a receipt at ${path}`);
  // A replay is always labelled, and nothing else may wear the label (SPEC §7).
  if (opts.provenance === "replay" && !opts.recordedFrom) throw new Error("a replay job must name the recording it ran from");
  if (opts.provenance !== "replay" && opts.recordedFrom) throw new Error(`a ${opts.provenance} job cannot name a recording`);

  const source_images = job.sources.map((s) => ({ name: s.name, sha256: sha256Hex(s.bytes) }));
  const garment_id = garmentId(source_images.map((s) => s.sha256));

  let prior: PriorRecord[] | null;
  let refused: StepRefusal | null = null;
  try {
    prior = priorRecords(opts.outRoot, garment_id, job.jobId);
  } catch (err) {
    prior = null;
    refused = stepRefusal("prior_records_unreadable", (err as Error).message);
  }

  mkdirSync(dir, { recursive: true });
  const receipt = new Receipt({ path, clock: opts.clock });
  receipt.append("job", {
    job_id: job.jobId,
    garment_note: job.garmentNote,
    provenance: opts.provenance,
    ...(opts.recordedFrom ? { mode: "replay", recorded_from: { ...opts.recordedFrom } } : {}),
    scenes: [...job.scenes],
    source_images,
    garment_id,
    prior_records: prior,
  });

  // A job-level refusal: one gate entry with no render, then nothing else.
  const refuseJob = (r: StepRefusal): JobResult => {
    receipt.append("gate", { render_id: null, decision: "REFUSE", cited: r, reasons: [r] });
    return { dir, head: receipt.head, garment_id, prior_records: prior, refused: r, renders: [] };
  };
  if (refused) return refuseJob(refused);

  let segments: Segment[];
  try {
    segments = await opts.providers.segmenter.segment(job.sources);
  } catch (err) {
    return refuseJob(stepRefusal("segment_failed", errorText(err)));
  }
  const segmenterId = opts.providers.segmenter.identity;
  receipt.append("segments", {
    count: segments.length,
    ...(segmenterId ? { segmenter: { provider: segmenterId.provider, model: segmenterId.model } } : {}),
    segments: segments.map((s) => ({ label: s.label, box: [...s.box], score: s.score, mask_sha256: maskSha256(s.mask) })),
  });

  const { renderer, verifier, fidelity: fidelityChecker } = opts.providers;
  const approver = job.approver ?? "unattended";
  const renders: RenderOutcome[] = [];

  for (const [i, scene] of job.scenes.entries()) {
    const render_id = `${job.jobId}-r${i}`;
    const prompt = renderPrompt(job.garmentNote, scene);
    // A renderer that throws refuses this scene and the job goes on, so every
    // scene attempted ends with a gate entry. A Muse Image model is refused here
    // too, before render() is called, whichever renderer was injected (SPEC §8).
    let image: RenderedImage;
    try {
      refuseMuseImage(renderer.model);
      image = await renderer.render({ scene, prompt, sources: job.sources, segments });
    } catch (err) {
      // A composite's quality pre-check (SPEC-composite-v2 §7) is REVIEW with
      // its reason and every check, and no image: never a product shot, never a
      // pass. Matched by name, not class, so a replay reviews the same way.
      if (err instanceof Error && err.name === "CompositeQualityReview") {
        const r = stepRefusal("render_quality", errorText(err));
        const quality = (err as { quality?: unknown }).quality;
        receipt.append("gate", { render_id, decision: "REVIEW", cited: r, reasons: [r], ...(isRecord(quality) ? { quality } : {}) });
        renders.push({ render_id, image_sha256: null, decision: "REVIEW", cited: r });
        continue;
      }
      const r = stepRefusal("render_failed", errorText(err));
      receipt.append("gate", { render_id, decision: "REFUSE", cited: r, reasons: [r] });
      renders.push({ render_id, image_sha256: null, decision: "REFUSE", cited: r });
      continue;
    }
    const image_sha256 = sha256Hex(image.bytes);
    writeFileSync(join(dir, `${render_id}.${image.ext}`), image.bytes);
    // The renderer's own fields follow the fixed ones and can never replace them.
    const fixed = { render_id, sha256: image_sha256, model: image.madeBy?.model ?? renderer.model, provider: image.madeBy?.provider ?? renderer.provider, prompt };
    const extra = Object.fromEntries(Object.entries(image.record ?? {}).filter(([k]) => !(k in fixed)));
    receipt.append("render", { ...fixed, ...extra });

    // A verifier that throws or breaks the schema is a refusal, never a pass:
    // its render goes to the gate with no findings, so nothing is verified.
    let findings: Finding[] = [];
    let error: string | undefined;
    let usage: VerifierUsage | undefined;
    let truncated = false;
    try {
      const out = await verifier.verify({ sources: job.sources, render: image.bytes, renderId: render_id, scene });
      usage = out.usage;
      findings = parseFindings(out.raw);
    } catch (err) {
      error = errorText(err);
      // Matched by name, not class, so a replayed recording refuses the same way.
      truncated = err instanceof Error && err.name === "VerifierTruncatedError";
      const thrownUsage = (err as { usage?: VerifierUsage } | null)?.usage;
      if (typeof thrownUsage === "object" && thrownUsage !== null) usage = thrownUsage;
    }
    receipt.append("verifier", { render_id, findings, verifier: { ...verifier.identity }, usage, error });

    const fidelity = await checkFidelitySafely(fidelityChecker, {
      sources: job.sources,
      segments,
      render: image.bytes,
      ...(image.renderMask ? { renderMask: image.renderMask } : {}),
      renderId: render_id,
      scene,
    });
    receipt.append("fidelity", { render_id, ...fidelity });

    const decided = decide(findings, fidelity);
    // A cut-off verifier answer refuses under its own name, ahead of the not_verified reasons it causes.
    const cut = truncated ? stepRefusal("verifier_truncated", error!) : null;
    const gate = cut ? { decision: "REFUSE" as const, cited: cut, reasons: [cut, ...decided.reasons] } : decided;
    receipt.append("gate", { render_id, decision: gate.decision, cited: gate.cited, reasons: gate.reasons });
    if (gate.decision === "RELEASE") {
      receipt.append("release", { render_id, image_sha256, approver, approved_by_human: approver !== "unattended" });
    }
    renders.push({ render_id, image_sha256, decision: gate.decision, cited: gate.cited });
  }

  return { dir, head: receipt.head, garment_id, prior_records: prior, refused: null, renders };
}

function maskSha256(mask: Segment["mask"]): string | null {
  if (mask === null) return null;
  return mask instanceof Uint8Array ? sha256Hex(mask) : mask.sha256;
}

function stepRefusal(rule: StepRefusal["rule"], reason: string): StepRefusal {
  return { attribute: null, verdict: null, confidence: null, rule, reason };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : `Error: ${String(err)}`;
}

/** The `fidelity` entry's payload, less `render_id`. */
export interface FidelityEntry {
  readonly decision: Decision;
  /** A metric that is not a finite number is recorded as null. */
  readonly metrics: Readonly<Record<string, number | null>> | null;
  readonly reasons: readonly string[];
  /** Where the render-side mask came from, when the checker says (`warped-source-mask` for a composite). */
  readonly render_mask?: string;
  readonly error?: string;
}

/**
 * Runs the fidelity check and makes its result safe to record: a throw, or a
 * result with a decision outside the three, is REFUSE with `error` set.
 */
async function checkFidelitySafely(checker: FidelityChecker, req: Parameters<FidelityChecker["check"]>[0]): Promise<FidelityEntry> {
  const refuse = (error: string): FidelityEntry => ({ decision: "REFUSE", metrics: null, reasons: [`fidelity check failed: ${error}`], error });
  let out: FidelityResult & { readonly render_mask?: string };
  try {
    out = await checker.check(req);
  } catch (err) {
    return refuse(errorText(err));
  }
  const decision = (out as Partial<FidelityResult> | null)?.decision;
  if (decision !== "RELEASE" && decision !== "REVIEW" && decision !== "REFUSE") {
    return refuse(`Error: fidelity decision ${JSON.stringify(decision ?? null)} is not RELEASE, REVIEW or REFUSE`);
  }
  const metrics = out.metrics && typeof out.metrics === "object"
    ? Object.fromEntries(Object.entries(out.metrics).map(([k, v]) => [k, typeof v === "number" && Number.isFinite(v) ? v : null]))
    : null;
  const reasons = Array.isArray(out.reasons) ? out.reasons.map(String) : [];
  return { decision, metrics, reasons, ...(typeof out.render_mask === "string" ? { render_mask: out.render_mask } : {}) };
}

/**
 * Fixture providers: no network. The renderer returns fixed bytes per scene and
 * the verifier returns the given raw output per scene (a function may throw, to
 * stand in for a broken verifier). Fidelity defaults to RELEASE with no
 * metrics: a fixture job measures nothing, and its receipt says `fixture`.
 */
export function fixtureProviders(opts: {
  renders: (scene: string) => Uint8Array;
  findings: (scene: string) => unknown;
  segments?: readonly Segment[];
  fidelity?: (scene: string) => FidelityResult;
}): Providers {
  return {
    segmenter: { segment: async () => [...(opts.segments ?? [])] },
    renderer: { provider: "fixture", model: "fixture-render", render: async ({ scene }) => ({ bytes: opts.renders(scene), ext: "png" }) },
    verifier: {
      identity: { provider: "fixture", model: "fixture-verifier", base: "fixture" },
      verify: async ({ scene }) => ({ raw: opts.findings(scene) }),
    },
    fidelity: { check: async ({ scene }) => opts.fidelity?.(scene) ?? { decision: "RELEASE", metrics: null, reasons: [] } },
  };
}
