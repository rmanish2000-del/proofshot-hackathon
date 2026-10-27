// The job pipeline (SPEC §3): job → segments → (render → verifier → gate →
// release) per scene, every step appended to the job's receipt as it happens.
//
// Providers are injected, so the same code runs live or on fixtures. Failure is
// closed at each boundary: unreadable prior records refuse the job before any
// render, and a verifier that throws or answers badly leaves its render with no
// findings, which the gate refuses as not verified.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { decide } from "./gate.ts";
import type { GateReason } from "./gate.ts";
import { RECEIPT_FILE, priorRecords } from "./prior.ts";
import type { PriorRecord } from "./prior.ts";
import { Receipt, garmentId } from "./receipt.ts";
import type { Clock } from "./receipt.ts";
import { parseFindings } from "./schema.ts";
import type { Finding } from "./schema.ts";
import type { Decision } from "./types.ts";
import { sha256Hex } from "./util.ts";

export type Provenance = "live" | "fixture";

export interface SourceImage {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface Segment {
  readonly label: string;
  /** [x, y, w, h], each 0..1 of the image. */
  readonly box: readonly [number, number, number, number];
  readonly score: number;
  readonly mask: Uint8Array | null;
}

export interface Segmenter {
  segment(sources: readonly SourceImage[]): Promise<Segment[]>;
}

export interface Renderer {
  readonly provider: "meta" | "openai-images" | "fal" | "fixture";
  readonly model: string;
  render(req: { scene: string; prompt: string; sources: readonly SourceImage[] }): Promise<{ bytes: Uint8Array; ext: string }>;
}

export interface VerifierUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly cached_tokens?: number;
  readonly images?: readonly { bytes: number; width: number; height: number }[];
}

export interface Verifier {
  readonly identity: { readonly provider: string; readonly model: string; readonly base: string };
  /** Returns the raw model output; parseFindings reads it. */
  verify(req: { sources: readonly SourceImage[]; render: Uint8Array; renderId: string; scene: string }): Promise<{ raw: unknown; usage?: VerifierUsage }>;
}

export interface Providers {
  readonly segmenter: Segmenter;
  readonly renderer: Renderer;
  readonly verifier: Verifier;
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
  readonly clock?: Clock;
}

export interface RenderOutcome {
  readonly render_id: string;
  readonly image_sha256: string;
  readonly decision: Decision;
  readonly cited: GateReason | JobRefusal | null;
}

/** A refusal of the whole job, written as a gate entry with no render. */
export interface JobRefusal {
  readonly attribute: null;
  readonly verdict: null;
  readonly confidence: null;
  readonly rule: "prior_records_unreadable";
  readonly reason: string;
}

export interface JobResult {
  readonly dir: string;
  readonly head: string;
  readonly garment_id: string | null;
  readonly prior_records: readonly PriorRecord[] | null;
  /** Set when the job was refused before any render. */
  readonly refused: JobRefusal | null;
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

  const source_images = job.sources.map((s) => ({ name: s.name, sha256: sha256Hex(s.bytes) }));
  const garment_id = garmentId(source_images.map((s) => s.sha256));

  let prior: PriorRecord[] | null;
  let refused: JobRefusal | null = null;
  try {
    prior = priorRecords(opts.outRoot, garment_id, job.jobId);
  } catch (err) {
    prior = null;
    refused = { attribute: null, verdict: null, confidence: null, rule: "prior_records_unreadable", reason: (err as Error).message };
  }

  mkdirSync(dir, { recursive: true });
  const receipt = new Receipt({ path, clock: opts.clock });
  receipt.append("job", {
    job_id: job.jobId,
    garment_note: job.garmentNote,
    provenance: opts.provenance,
    scenes: [...job.scenes],
    source_images,
    garment_id,
    prior_records: prior,
  });

  if (refused) {
    receipt.append("gate", { render_id: null, decision: "REFUSE", cited: refused, reasons: [refused] });
    return { dir, head: receipt.head, garment_id, prior_records: null, refused, renders: [] };
  }

  const segments = await opts.providers.segmenter.segment(job.sources);
  receipt.append("segments", {
    count: segments.length,
    segments: segments.map((s) => ({ label: s.label, box: [...s.box], score: s.score, mask_sha256: s.mask ? sha256Hex(s.mask) : null })),
  });

  const { renderer, verifier } = opts.providers;
  const approver = job.approver ?? "unattended";
  const renders: RenderOutcome[] = [];

  for (const [i, scene] of job.scenes.entries()) {
    const render_id = `${job.jobId}-r${i}`;
    const prompt = renderPrompt(job.garmentNote, scene);
    const image = await renderer.render({ scene, prompt, sources: job.sources });
    const image_sha256 = sha256Hex(image.bytes);
    writeFileSync(join(dir, `${render_id}.${image.ext}`), image.bytes);
    receipt.append("render", { render_id, sha256: image_sha256, model: renderer.model, provider: renderer.provider, prompt });

    // A verifier that throws or breaks the schema is a refusal, never a pass:
    // its render goes to the gate with no findings, so nothing is verified.
    let findings: Finding[] = [];
    let error: string | undefined;
    let usage: VerifierUsage | undefined;
    try {
      const out = await verifier.verify({ sources: job.sources, render: image.bytes, renderId: render_id, scene });
      usage = out.usage;
      findings = parseFindings(out.raw);
    } catch (err) {
      error = `${(err as Error).name}: ${(err as Error).message}`;
    }
    receipt.append("verifier", { render_id, findings, verifier: { ...verifier.identity }, usage, error });

    const gate = decide(findings);
    receipt.append("gate", { render_id, decision: gate.decision, cited: gate.cited, reasons: gate.reasons });
    if (gate.decision === "RELEASE") {
      receipt.append("release", { render_id, image_sha256, approver, approved_by_human: approver !== "unattended" });
    }
    renders.push({ render_id, image_sha256, decision: gate.decision, cited: gate.cited });
  }

  return { dir, head: receipt.head, garment_id, prior_records: prior, refused: null, renders };
}

/**
 * Fixture providers: no network. The renderer returns fixed bytes per scene and
 * the verifier returns the given raw output per scene (a function may throw, to
 * stand in for a broken verifier).
 */
export function fixtureProviders(opts: {
  renders: (scene: string) => Uint8Array;
  findings: (scene: string) => unknown;
  segments?: readonly Segment[];
}): Providers {
  return {
    segmenter: { segment: async () => [...(opts.segments ?? [])] },
    renderer: { provider: "fixture", model: "fixture-render", render: async ({ scene }) => ({ bytes: opts.renders(scene), ext: "png" }) },
    verifier: {
      identity: { provider: "fixture", model: "fixture-verifier", base: "fixture" },
      verify: async ({ scene }) => ({ raw: opts.findings(scene) }),
    },
  };
}
