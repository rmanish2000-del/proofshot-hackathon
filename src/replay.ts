// Replay and record (SPEC §7): a finished job becomes a recording, and a
// recording runs the same pipeline and the same receipt writer again with
// nothing reaching the network.
//
// A recording is a directory: manifest.json (every other file with its sha256),
// sources/ (the input photos), renders/<render_id>.<ext> (the images the job
// produced) and steps.json (what each provider answered, the verifier's
// identity and usage, the fidelity results, and every timestamp in order).
// Loading re-hashes every listed file and refuses one that changed or is
// missing, and refuses a renderer that names Muse Image (SPEC §8).
//
// What "reproduces" means here (proposal 1, accepted by Grok 27 Oct): every
// entry after the job entry has the recorded seq, at, kind and payload. The job
// entry itself says provenance "replay", mode "replay" and names the recording,
// so its hash, and through prev every hash after it, differ from the recorded
// chain. Two replays of one recording are byte-identical.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { FidelityResult } from "./fidelity.ts";
import { renderPrompt, runJob } from "./pipeline.ts";
import type { FidelityEntry, JobInput, JobResult, Providers, Renderer, Segment, SourceImage, VerifierUsage } from "./pipeline.ts";
import { RECEIPT_FILE } from "./prior.ts";
import { parseReceipt, recordedClock, verifyChain } from "./receipt.ts";
import type { ReceiptEntry } from "./receipt.ts";
import { refuseMuseImage } from "./render.ts";
import type { Finding } from "./schema.ts";
import { sha256Hex } from "./util.ts";

export const MANIFEST_FILE = "manifest.json";
export const STEPS_FILE = "steps.json";
const SOURCES_DIR = "sources";
const RENDERS_DIR = "renders";
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * A key that holds a credential. Token counts (`prompt_tokens`, `cached_tokens`)
 * end in "tokens", not "token", so they stay.
 */
export const CREDENTIAL_KEY = /(api[_-]?key|secret|password|passwd|authorization|bearer|credential|cookie|^key$|(^|[_-])token$)/i;

export class RecordingError extends Error {
  override name = "RecordingError";
}

export interface RecordedScene {
  readonly scene: string;
  readonly render_id: string;
  /** The image under renders/, or null when the renderer threw. */
  /** `record` is the renderer's own render-entry fields (method, generative, template...), absent when it had none. */
  readonly render: { readonly file: string; readonly sha256: string; readonly record?: Readonly<Record<string, unknown>> } | null;
  /** The render_failed (or render_quality) reason, `<name>: <message>`, when `render` is null. */
  readonly render_error: string | null;
  readonly verifier: { readonly findings: readonly Finding[]; readonly usage?: VerifierUsage; readonly error?: string } | null;
  readonly fidelity: FidelityEntry | null;
}

export interface RecordedSteps {
  readonly job: {
    readonly job_id: string;
    readonly garment_note: string;
    readonly scenes: readonly string[];
    readonly approver: string;
    readonly source_images: readonly { readonly name: string; readonly sha256: string }[];
  };
  /** Every entry's `at`, in order; the replay clock hands them out again. */
  readonly timestamps: readonly string[];
  /** Set when the job was refused before any render. Only segment_failed can be replayed. */
  readonly refused: { readonly rule: "segment_failed"; readonly reason: string } | null;
  readonly segments: readonly { readonly label: string; readonly box: readonly [number, number, number, number]; readonly score: number; readonly mask_sha256: string | null }[] | null;
  /** The segments entry's `segmenter` claim, when the recorded segmenter made one. */
  readonly segmenter?: { readonly provider: string; readonly model: string } | null;
  /** null when no scene reached a render entry. */
  readonly renderer: { readonly provider: Renderer["provider"]; readonly model: string } | null;
  readonly verifier: { readonly provider: string; readonly model: string; readonly base: string };
  readonly scenes: readonly RecordedScene[];
}

export interface Manifest {
  readonly name: string;
  readonly recorded_from: { readonly job_id: string; readonly head: string };
  /** Relative path (forward slashes) to sha256, for every file but this one. */
  readonly files: Readonly<Record<string, string>>;
}

export interface Recording {
  readonly dir: string;
  readonly manifest: Manifest;
  readonly steps: RecordedSteps;
  readonly sources: readonly SourceImage[];
  readonly renders: ReadonlyMap<string, { readonly bytes: Uint8Array; readonly ext: string }>;
}

export interface RecordOptions {
  /** The finished job's directory: receipt.jsonl and its render images. */
  readonly jobDir: string;
  /** The job's input photos, which the job directory does not hold. */
  readonly sources: readonly SourceImage[];
  /** The recording directory to create. */
  readonly to: string;
  readonly name?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const payloadOf = (e: ReceiptEntry): Record<string, unknown> => (isObject(e.payload) ? e.payload : {});
// A declaration with an explicit never return, so a call narrows what follows.
function refuse(reason: string): never {
  throw new RecordingError(reason);
}

/**
 * Drops credential fields and URL query strings anywhere in a value, so a
 * recording never carries a key that a live run's output or identity might.
 */
export function stripSecrets<T>(value: T): T {
  if (typeof value === "string") {
    const q = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value.indexOf("?") : -1;
    return (q < 0 ? value : value.slice(0, q)) as T;
  }
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v)) as T;
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !CREDENTIAL_KEY.test(k)).map(([k, v]) => [k, stripSecrets(v)])) as T;
  }
  return value;
}

/**
 * Writes a recording of a finished job. Refuses a receipt that does not
 * verify, a job that is itself a replay, sources that are not the job's own,
 * a render image whose hash is not on the receipt, and a job this build could
 * not reproduce (a prompt from another template, or a refusal on unreadable
 * prior records, which depend on the replay's own output directory).
 */
export function recordJob(opts: RecordOptions): Manifest {
  const name = opts.name ?? basename(opts.to);
  if (!FILE_NAME.test(name)) refuse(`recording name ${JSON.stringify(name)} is not a plain name`);
  if (existsSync(join(opts.to, MANIFEST_FILE))) refuse(`${opts.to} is already a recording`);
  const path = join(opts.jobDir, RECEIPT_FILE);
  if (!existsSync(path)) refuse(`no ${RECEIPT_FILE} in ${opts.jobDir}`);

  const entries = parseReceipt(readFileSync(path, "utf8"));
  const check = verifyChain(entries);
  if (!check.ok) refuse(`${path} does not verify: entry ${check.index}, ${check.reason}`);
  const jobEntry = entries[0]!;
  if (jobEntry.kind !== "job") refuse(`${path}: entry 0 is ${jobEntry.kind}, not job`);
  const job = payloadOf(jobEntry);
  if (job.provenance === "replay" || job.mode === "replay") refuse(`${path} is itself a replay, so it is not recorded`);
  const job_id = typeof job.job_id === "string" ? job.job_id : refuse("job entry has no job_id");
  const garment_note = typeof job.garment_note === "string" ? job.garment_note : refuse("job entry has no garment_note");
  const scenes = Array.isArray(job.scenes) && job.scenes.every((s) => typeof s === "string") ? (job.scenes as string[]) : refuse("job entry has no scenes");
  const source_images = Array.isArray(job.source_images) ? (job.source_images as { name: string; sha256: string }[]) : refuse("job entry has no source_images");

  // The sources must be the job's own inputs, in the job's order.
  if (opts.sources.length !== source_images.length) refuse(`${opts.sources.length} sources given, the job had ${source_images.length}`);
  const seen = new Set<string>();
  opts.sources.forEach((s, i) => {
    const want = source_images[i]!;
    if (!FILE_NAME.test(s.name)) refuse(`source name ${JSON.stringify(s.name)} is not a plain file name`);
    if (seen.has(s.name)) refuse(`source name ${s.name} appears twice`);
    seen.add(s.name);
    if (s.name !== want.name || sha256Hex(s.bytes) !== want.sha256) refuse(`source ${i} (${s.name}) is not the job's ${want.name} ${want.sha256}`);
  });

  const byId = (kind: ReceiptEntry["kind"], render_id: string | null) => entries.find((e) => e.kind === kind && payloadOf(e).render_id === render_id);
  let refused: RecordedSteps["refused"] = null;
  const jobGate = byId("gate", null);
  if (jobGate) {
    const cited = payloadOf(jobGate).cited;
    const rule = isObject(cited) ? cited.rule : undefined;
    if (rule !== "segment_failed") refuse(`the job was refused on ${String(rule)}, which a replay cannot reproduce`);
    refused = { rule: "segment_failed", reason: String((cited as Record<string, unknown>).reason) };
  }
  const segEntry = entries.find((e) => e.kind === "segments");
  const segments = segEntry ? (payloadOf(segEntry).segments as RecordedSteps["segments"]) : null;
  if (!refused && !segments) refuse("the receipt has no segments entry and no job refusal");
  const segmenterClaim = segEntry && isObject(payloadOf(segEntry).segmenter) ? (payloadOf(segEntry).segmenter as RecordedSteps["segmenter"]) : null;

  const writes: { rel: string; bytes: Uint8Array }[] = opts.sources.map((s) => ({ rel: `${SOURCES_DIR}/${s.name}`, bytes: s.bytes }));
  const recordedScenes: RecordedScene[] = [];
  let renderer: RecordedSteps["renderer"] = null;
  let verifier: RecordedSteps["verifier"] | null = null;

  const toRecord: readonly string[] = refused ? [] : scenes;
  for (const [i, scene] of toRecord.entries()) {
    const render_id = `${job_id}-r${i}`;
    const gate = byId("gate", render_id) ?? refuse(`scene ${i} (${render_id}) has no gate entry: the job did not finish`);
    const cited = payloadOf(gate).cited;
    // A composite quality REVIEW (SPEC-composite-v2 §7) has no image either; its reason replays by name.
    if (isObject(cited) && (cited.rule === "render_failed" || cited.rule === "render_quality")) {
      recordedScenes.push({ scene, render_id, render: null, render_error: String(cited.reason), verifier: null, fidelity: null });
      continue;
    }
    const render = payloadOf(byId("render", render_id) ?? refuse(`${render_id} has no render entry`));
    const verified = payloadOf(byId("verifier", render_id) ?? refuse(`${render_id} has no verifier entry`));
    const fidelity = payloadOf(byId("fidelity", render_id) ?? refuse(`${render_id} has no fidelity entry`));

    if (render.prompt !== renderPrompt(garment_note, scene)) refuse(`${render_id} was rendered from a prompt this build does not produce`);
    const model = { provider: render.provider as Renderer["provider"], model: String(render.model) };
    if (renderer && (renderer.provider !== model.provider || renderer.model !== model.model)) refuse(`${render_id} names a different renderer than an earlier scene`);
    renderer ??= model;
    verifier ??= isObject(verified.verifier) ? (verified.verifier as RecordedSteps["verifier"]) : refuse(`${render_id} has no verifier identity`);

    const file = renderFile(opts.jobDir, render_id);
    const bytes = readFileSync(join(opts.jobDir, file));
    if (sha256Hex(bytes) !== render.sha256) refuse(`${file} does not hash to the receipt's ${String(render.sha256)}`);
    writes.push({ rel: `${RENDERS_DIR}/${file}`, bytes });

    const FIXED = ["render_id", "sha256", "model", "provider", "prompt"];
    const extra = Object.fromEntries(Object.entries(render).filter(([k]) => !FIXED.includes(k)));
    recordedScenes.push({
      scene,
      render_id,
      render: { file, sha256: String(render.sha256), ...(Object.keys(extra).length > 0 ? { record: extra } : {}) },
      render_error: null,
      verifier: {
        findings: (Array.isArray(verified.findings) ? verified.findings : []) as Finding[],
        ...(verified.usage !== undefined ? { usage: verified.usage as VerifierUsage } : {}),
        ...(verified.error !== undefined ? { error: String(verified.error) } : {}),
      },
      fidelity: {
        decision: fidelity.decision as FidelityEntry["decision"],
        metrics: (fidelity.metrics ?? null) as FidelityEntry["metrics"],
        reasons: (Array.isArray(fidelity.reasons) ? fidelity.reasons : []) as string[],
        ...(fidelity.error !== undefined ? { error: String(fidelity.error) } : {}),
      },
    });
  }

  const release = entries.find((e) => e.kind === "release");
  const approver = release && typeof payloadOf(release).approver === "string" ? (payloadOf(release).approver as string) : "unattended";

  const steps: RecordedSteps = stripSecrets({
    job: { job_id, garment_note, scenes: [...scenes], approver, source_images: source_images.map((s) => ({ name: s.name, sha256: s.sha256 })) },
    timestamps: entries.map((e) => e.at),
    refused,
    segments,
    segmenter: segmenterClaim,
    renderer,
    verifier: verifier ?? { provider: "none", model: "none", base: "none" },
    scenes: recordedScenes,
  });
  writes.push({ rel: STEPS_FILE, bytes: Buffer.from(JSON.stringify(steps, null, 2) + "\n") });

  mkdirSync(join(opts.to, SOURCES_DIR), { recursive: true });
  mkdirSync(join(opts.to, RENDERS_DIR), { recursive: true });
  const files: Record<string, string> = {};
  for (const w of writes.sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
    writeFileSync(join(opts.to, ...w.rel.split("/")), w.bytes);
    files[w.rel] = sha256Hex(w.bytes);
  }
  const manifest: Manifest = { name, recorded_from: { job_id, head: check.head }, files };
  writeFileSync(join(opts.to, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

/** The one file in the job directory named `<render_id>.<ext>`. */
function renderFile(jobDir: string, render_id: string): string {
  const found = readdirSync(jobDir).filter((f) => f.startsWith(`${render_id}.`));
  if (found.length !== 1) refuse(`${render_id}: expected one image file in ${jobDir}, found ${found.length}`);
  return found[0]!;
}

/**
 * Reads a recording, re-hashing every file the manifest lists. A missing or
 * changed file, a manifest that lists a path outside sources/, renders/ and
 * steps.json, a source or render that does not match steps.json, or a
 * renderer that names Muse Image is refused.
 */
export function loadRecording(dir: string): Recording {
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) refuse(`${dir} has no ${MANIFEST_FILE}`);
  const manifest = checkManifest(JSON.parse(readFileSync(manifestPath, "utf8")));

  const bytes = new Map<string, Buffer>();
  for (const [rel, want] of Object.entries(manifest.files)) {
    const parts = rel.split("/");
    const listed = (parts.length === 2 && (parts[0] === SOURCES_DIR || parts[0] === RENDERS_DIR) && FILE_NAME.test(parts[1]!)) || rel === STEPS_FILE;
    if (!listed) refuse(`manifest lists ${JSON.stringify(rel)}, which is not a recording file`);
    const path = join(dir, ...parts);
    if (!existsSync(path)) refuse(`${rel} is missing`);
    const b = readFileSync(path);
    const got = sha256Hex(b);
    if (got !== want) refuse(`${rel} changed: recorded ${want}, found ${got}`);
    bytes.set(rel, b);
  }
  const stepsBytes = bytes.get(STEPS_FILE) ?? refuse(`${STEPS_FILE} is not in the manifest`);
  const steps = checkSteps(JSON.parse(stepsBytes.toString("utf8")));
  if (steps.renderer) refuseMuseImage(steps.renderer.model);

  const sources = steps.job.source_images.map((s) => {
    const b = bytes.get(`${SOURCES_DIR}/${s.name}`) ?? refuse(`source ${s.name} is not in the manifest`);
    if (sha256Hex(b) !== s.sha256) refuse(`source ${s.name} does not hash to ${s.sha256}`);
    return { name: s.name, bytes: new Uint8Array(b) };
  });
  const renders = new Map<string, { bytes: Uint8Array; ext: string }>();
  for (const scene of steps.scenes) {
    if (!scene.render) continue;
    const b = bytes.get(`${RENDERS_DIR}/${scene.render.file}`) ?? refuse(`render ${scene.render.file} is not in the manifest`);
    if (sha256Hex(b) !== scene.render.sha256) refuse(`render ${scene.render.file} does not hash to ${scene.render.sha256}`);
    const dot = scene.render.file.lastIndexOf(".");
    renders.set(scene.render_id, { bytes: new Uint8Array(b), ext: dot < 0 ? "bin" : scene.render.file.slice(dot + 1) });
  }
  return { dir, manifest, steps, sources, renders };
}

function checkManifest(v: unknown): Manifest {
  if (!isObject(v) || typeof v.name !== "string" || !FILE_NAME.test(v.name)) refuse("manifest has no plain name");
  const from = v.recorded_from;
  if (!isObject(from) || typeof from.job_id !== "string" || typeof from.head !== "string") refuse("manifest has no recorded_from job_id and head");
  if (!isObject(v.files) || !Object.values(v.files).every((h) => typeof h === "string" && HEX64.test(h))) refuse("manifest files must map paths to sha256 hex");
  return { name: v.name, recorded_from: { job_id: from.job_id, head: from.head }, files: v.files as Record<string, string> };
}

function checkSteps(v: unknown): RecordedSteps {
  if (!isObject(v) || !isObject(v.job)) refuse(`${STEPS_FILE} has no job`);
  const job = v.job;
  if (typeof job.job_id !== "string" || typeof job.garment_note !== "string" || typeof job.approver !== "string") refuse(`${STEPS_FILE} job needs job_id, garment_note and approver`);
  if (!Array.isArray(job.scenes) || !job.scenes.every((s) => typeof s === "string")) refuse(`${STEPS_FILE} job has no scenes`);
  if (!Array.isArray(job.source_images) || !job.source_images.every((s) => isObject(s) && typeof s.name === "string" && typeof s.sha256 === "string")) refuse(`${STEPS_FILE} job has no source_images`);
  if (!Array.isArray(v.timestamps) || !v.timestamps.every((t) => typeof t === "string")) refuse(`${STEPS_FILE} has no timestamps`);
  if (!isObject(v.verifier) || typeof v.verifier.model !== "string") refuse(`${STEPS_FILE} has no verifier identity`);
  if (v.renderer !== null && (!isObject(v.renderer) || typeof v.renderer.model !== "string")) refuse(`${STEPS_FILE} renderer must be null or name a model`);
  if (!Array.isArray(v.scenes) || !v.scenes.every((s) => isObject(s) && typeof s.scene === "string" && typeof s.render_id === "string")) refuse(`${STEPS_FILE} has no scenes`);
  const steps = v as unknown as RecordedSteps;
  if (steps.refused === null && steps.scenes.length !== steps.job.scenes.length) refuse(`${STEPS_FILE} records ${steps.scenes.length} scenes for a job of ${steps.job.scenes.length}`);
  return steps;
}

/**
 * Throws an Error whose `<name>: <message>` text is the recorded one, so the
 * pipeline writes it again; recorded usage (a cut-off verifier's attempts) rides on it.
 */
function throwRecorded(text: string, usage?: VerifierUsage): never {
  const i = text.indexOf(": ");
  const err = new Error(i < 0 ? text : text.slice(i + 2)) as Error & { usage?: VerifierUsage };
  err.name = i < 0 ? "Error" : text.slice(0, i);
  if (usage !== undefined) err.usage = usage;
  throw err;
}

/**
 * Providers that answer from the recording and nothing else. The renderer
 * hands out the recorded images in scene order; the verifier and the fidelity
 * check answer by render id; a recorded error is thrown again as recorded.
 */
export function replayProviders(rec: Recording): Providers {
  const { steps } = rec;
  const sceneOf = (render_id: string): RecordedScene =>
    steps.scenes.find((s) => s.render_id === render_id) ?? refuse(`the recording has no scene ${render_id}`);
  let next = 0;
  return {
    segmenter: {
      ...(steps.segmenter ? { identity: { provider: steps.segmenter.provider, model: steps.segmenter.model } } : {}),
      segment: async () => {
        if (steps.refused) throwRecorded(steps.refused.reason);
        return (steps.segments ?? []).map((s): Segment => ({
          label: s.label, box: [s.box[0], s.box[1], s.box[2], s.box[3]], score: s.score, mask: s.mask_sha256 === null ? null : { sha256: s.mask_sha256 },
        }));
      },
    },
    renderer: {
      provider: steps.renderer?.provider ?? "fixture",
      model: steps.renderer?.model ?? "recorded",
      render: async ({ scene }) => {
        const s = steps.scenes[next++];
        if (!s || s.scene !== scene) refuse(`replay asked to render ${JSON.stringify(scene)}, the recording's scene ${next - 1} is ${JSON.stringify(s?.scene ?? null)}`);
        if (!s.render) throwRecorded(s.render_error ?? "Error: render failed");
        const image = rec.renders.get(s.render_id) ?? refuse(`no image for ${s.render_id}`);
        return s.render.record ? { ...image, record: { ...s.render.record } } : image;
      },
    },
    verifier: {
      identity: { ...steps.verifier },
      verify: async ({ renderId }) => {
        const v = sceneOf(renderId).verifier ?? refuse(`the recording has no verifier answer for ${renderId}`);
        if (v.error !== undefined) throwRecorded(v.error, v.usage);
        return { raw: { findings: v.findings }, ...(v.usage !== undefined ? { usage: v.usage } : {}) };
      },
    },
    fidelity: {
      check: async ({ renderId }) => {
        const f = sceneOf(renderId).fidelity ?? refuse(`the recording has no fidelity result for ${renderId}`);
        if (f.error !== undefined) throwRecorded(f.error);
        return { decision: f.decision, metrics: f.metrics as unknown as FidelityResult["metrics"], reasons: f.reasons };
      },
    },
  };
}

/**
 * Runs the recorded job again through runJob: same pipeline, same receipt
 * writer, the recorded clock, no provider that can reach the network. The job
 * entry says provenance "replay", mode "replay" and names the recording.
 */
export async function replayJob(rec: Recording, opts: { outRoot: string }): Promise<JobResult> {
  const { steps, manifest } = rec;
  const job: JobInput = {
    jobId: steps.job.job_id,
    garmentNote: steps.job.garment_note,
    scenes: steps.job.scenes,
    sources: rec.sources,
    approver: steps.job.approver,
  };
  return runJob(job, {
    outRoot: opts.outRoot,
    providers: replayProviders(rec),
    provenance: "replay",
    recordedFrom: { recording: manifest.name, job_id: manifest.recorded_from.job_id, head: manifest.recorded_from.head },
    clock: recordedClock(steps.timestamps),
  });
}
