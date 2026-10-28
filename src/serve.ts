// The seller upload server (P7, SPEC §12): one local HTTP server that serves
// web/ and runs the real pipeline on photos a seller drops in the browser.
//
// A job goes: intake (metadata stripped, both hashes kept) → runJob with the
// providers the environment names → a receipt under the jobs root → a result
// the page paints as a card. The server decides nothing the pipeline does not:
// the gate's decision, reasons and receipt are passed through, and "Publish to
// shop" is a shop build, which lists a job only if its receipt verifies and the
// decision was RELEASE (src/shop.ts). Progress is reported per step by wrapping
// the providers, so what the page shows is what actually ran.
//
// Fixture mode is the honest default: with no model key, the segmenter is a
// fixture that finds nothing, the verifier records all attributes as matching
// without a model, fidelity measures nothing, and the renderer is the stand-in
// (the seller's own front photo). The receipt's provenance is then `fixture`
// and the page says so. With BASETEN_API_KEY (P6) the verifier is Muse Spark
// Open and the run is live. No key is read here; the transports read their own.
//
// Jobs this server names start with `upload-`; data/jobs/upload-*/ is in
// .gitignore so a seller's photos can never be committed by a sync.

import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

import { maskedFidelityChecker } from "./fidelity.ts";
import { intakeJpeg } from "./intake.ts";
import type { IntakeFile } from "./intake.ts";
import { fixtureProviders, runJob } from "./pipeline.ts";
import type { FidelityChecker, Provenance, Providers, Renderer, Segment, Segmenter, SourceImage, Verifier } from "./pipeline.ts";
import { presentJob, tamperedCopy } from "./present.ts";
import { RECEIPT_FILE } from "./prior.ts";
import { parseReceipt, verifyChain } from "./receipt.ts";
import type { Clock } from "./receipt.ts";
import { compositeV2Renderer, rendererFromEnv } from "./render.ts";
import { REPLICATE_PROVIDER, defaultLedgerPath, fileLedger, replicateTryOnRenderer } from "./render-replicate.ts";
import type { Ledger, ReplicateFetch } from "./render-replicate.ts";
import { segmenterFromEnv } from "./sam.ts";
import type { SamTransport } from "./sam.ts";
import { metaSamTransportFromEnv } from "./sam-meta.ts";
import type { FetchLike, MaskParser, SamCallLog } from "./sam-meta.ts";
import { metaSamParser } from "./sam-parser.ts";
import { buildShop } from "./shop.ts";
import type { CatalogRow } from "./shop.ts";
import { ATTRIBUTES } from "./types.ts";
import type { Decision } from "./types.ts";
import { sha256Hex } from "./util.ts";
import { basetenVerifier } from "./verifier.ts";
import type { VerifierCallLog, VerifierFetch } from "./verifier.ts";

/** Jobs the upload server names itself start with this; .gitignore keeps the data/jobs/upload-* folders out of every commit. */
export const UPLOAD_JOB_PREFIX = "upload-";

export const STEPS = ["exif", "segment", "render", "verify", "gate"] as const;
export type StepName = (typeof STEPS)[number];
export type StepState = "pending" | "running" | "done" | "failed" | "skipped";

export interface Step {
  readonly name: StepName;
  readonly state: StepState;
  /** One line about what ran, or why it failed. */
  readonly detail: string | null;
}

/** Which provider stands behind each step, in words the page can show. */
export interface ModeReport {
  readonly provenance: Provenance;
  /** True when any provider is a fixture: the page labels the whole run. */
  readonly fixture: boolean;
  readonly labels: Readonly<Record<"segment" | "render" | "verify" | "fidelity", string>>;
}

export interface ServeProviders {
  readonly providers: Providers;
  readonly mode: ModeReport;
}

export interface UploadRequest {
  readonly garment_note: string;
  readonly scenes?: readonly string[];
  readonly files: readonly { readonly name: string; readonly base64: string }[];
}

export interface UploadResult {
  readonly decision: Decision;
  readonly render_id: string | null;
  readonly image_sha256: string | null;
  /** URL paths on this server; image is null when the render failed. */
  readonly image: string | null;
  readonly receipt: string;
  readonly head: string;
  readonly provenance: Provenance;
  /** The gate's reasons in words; empty on RELEASE. */
  readonly reasons: readonly string[];
  /** verify.html with the image hash prefilled, or null with no image. */
  readonly verify: string | null;
}

export interface JobStatus {
  readonly job_id: string;
  readonly status: "running" | "done" | "failed";
  readonly mode: ModeReport;
  readonly steps: readonly Step[];
  readonly intake: readonly IntakeFile[] | null;
  readonly result: UploadResult | null;
  /** Set when the job never reached the pipeline (bad upload); the gate was not involved. */
  readonly error: string | null;
  readonly published: CatalogRow[] | null;
}

export class UploadError extends Error {
  override name = "UploadError";
  /** The HTTP status the handler answers with. */
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const MAX_FILES = 6;
export const MAX_BODY_BYTES = 40 * 1024 * 1024;
export const DEFAULT_SCENES: readonly string[] = ["studio"];
const SOURCES_DIR = "sources";
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/;

/** The recorded-findings verifier of fixture mode: every attribute matches, and the note says no model judged it. */
export function fixtureVerifier(): Verifier {
  return fixtureProviders({
    renders: () => new Uint8Array(0),
    findings: () => ({
      findings: ATTRIBUTES.map((attribute) => ({
        attribute,
        verdict: "match",
        confidence: 0.95,
        note: "recorded in fixture mode: no model judged this image",
        evidence: { source_bbox: null, render_bbox: null },
      })),
    }),
  }).verifier;
}

export interface ProvidersFromEnvOptions {
  /**
   * Needed for a live segmenter: the fetch it calls api.meta.ai with. The parser
   * defaults to the @meta-sam/parser glue; `onCall` receives the redacted log of
   * every SAM request sent.
   */
  readonly sam?: { readonly fetch: FetchLike; readonly parse?: MaskParser; readonly onCall?: (log: SamCallLog) => void };
  /** Overrides MODEL_API_KEY-based wiring in tests. */
  readonly samTransport?: SamTransport;
  /** Needed for the live verifier (P6): the fetch it calls Baseten with. Without it the verifier is a fixture even with a key. */
  readonly verifierFetch?: VerifierFetch;
  /** Receives the redacted log of every live verifier call. */
  readonly onVerifierCall?: (log: VerifierCallLog) => void;
  /**
   * For PROOFSHOT_RENDER=replicate-pruna-tryon (NR4): the fetch it calls
   * Replicate with, and overrides for the spend ledger (default
   * %LOCALAPPDATA%\ProofShot\replicate-ledger.json) and data/models/.
   */
  readonly replicate?: { readonly fetch: ReplicateFetch; readonly ledger?: Ledger | null; readonly modelsDir?: string };
}

/**
 * The providers the environment names, each labelled. RENDER_PROVIDER defaults
 * to `stand-in` here (no render transport exists); any other provider is built
 * by rendererFromEnv and every render is refused by a transport that throws,
 * which the receipt records as render_failed. The segmenter is live only with
 * MODEL_SEGMENT, MODEL_API_KEY and a mask parser. The verifier is Muse Spark
 * Open on Baseten (P6) with BASETEN_API_KEY and a fetch; then the fidelity
 * check is the masked one of SPEC §10 (REVIEW while no mask is available),
 * and the run is live. Without the key, verifier and fidelity are fixtures and
 * the run is fixture mode. A segmenter that did not run claims nothing (zero
 * segments, no model on the receipt), so it does not make a live run a fixture.
 */
export function providersFromEnv(env: Readonly<Record<string, string | undefined>>, opts: ProvidersFromEnvOptions = {}): ServeProviders {
  const base = fixtureProviders({ renders: () => new Uint8Array(0), findings: () => ({ findings: [] }) });
  const labels: Record<"segment" | "render" | "verify" | "fidelity", string> = {
    segment: "fixture: no segmenter ran (MODEL_SEGMENT is not set)",
    render: "",
    verify: "fixture: findings recorded as all matching; no model judged the image",
    fidelity: "fixture: not measured",
  };

  let segmenter: Segmenter = base.segmenter;
  const wantsSam = (env.MODEL_SEGMENT ?? "").trim() !== "";
  const transport = opts.samTransport ?? (opts.sam && (env.MODEL_API_KEY ?? "").trim() !== "" ? metaSamTransportFromEnv(env, opts.sam.fetch, opts.sam.parse ?? metaSamParser(), opts.sam.onCall) : null);
  if (wantsSam && transport) {
    segmenter = segmenterFromEnv(env, transport);
    labels.segment = `${segmenter.identity!.provider} / ${segmenter.identity!.model}`;
  } else if (wantsSam) {
    labels.segment = `fixture: MODEL_SEGMENT is set but ${(env.MODEL_API_KEY ?? "").trim() === "" ? "MODEL_API_KEY is not" : "no fetch was given to providersFromEnv"}, so no segmenter ran`;
  }

  // PROOFSHOT_RENDER (NR4) wins over RENDER_PROVIDER; only it or RENDER_PROVIDER selects the Replicate try-on.
  const renderName = (env.PROOFSHOT_RENDER ?? "").trim() || (env.RENDER_PROVIDER ?? "").trim() || "stand-in";
  const renderer: Renderer = renderName === REPLICATE_PROVIDER
    ? replicateTryOnRenderer({
        env,
        fetch: opts.replicate?.fetch ?? null,
        fallback: compositeV2Renderer(),
        ledger: opts.replicate?.ledger !== undefined ? opts.replicate.ledger : ((path) => (path ? fileLedger(path) : null))(defaultLedgerPath(env)),
        ...(opts.replicate?.modelsDir ? { modelsDir: opts.replicate.modelsDir } : {}),
      })
    : rendererFromEnv({ ...env, RENDER_PROVIDER: renderName }, async ({ provider }) => {
        throw new Error(`no HTTP render transport for ${provider} exists in this build`);
      });
  labels.render = renderer.provider === "stand-in"
    ? "stand-in: the seller's own front photo, nothing generated"
    : renderer.provider === "composite"
      ? `composite / ${renderer.model}: the seller's garment pixels, cut out by the SAM mask, placed on a template by deterministic code; no image model, and no mask means REFUSE`
      : renderer.provider === REPLICATE_PROVIDER
        ? `${renderer.provider} / ${renderer.model}: AI preview by Pruna p-image-try-on on Replicate (third-party, non-Meta); falls back to composite v2 with the reason on the receipt`
        : `${renderer.provider} / ${renderer.model}: no render transport in this build, every render is refused`;

  let verifier: Verifier = fixtureVerifier();
  let fidelity: FidelityChecker = base.fidelity;
  const hasKey = (env.BASETEN_API_KEY ?? "").trim() !== "";
  const live = hasKey && opts.verifierFetch !== undefined;
  if (live) {
    verifier = basetenVerifier({ env, fetch: opts.verifierFetch!, ...(opts.onVerifierCall ? { onCall: opts.onVerifierCall } : {}) });
    labels.verify = `${verifier.identity.provider} / ${verifier.identity.model}: the model judges every attribute`;
    // Masks come from the segmenter's segments; the render is segmented only by a live segmenter.
    fidelity = maskedFidelityChecker(segmenter.identity ? { segmenter } : {});
    labels.fidelity = segmenter.identity
      ? "masked metrics (SPEC §10): delta_e, hist, texture, area against config/fidelity.json"
      : "masked metrics (SPEC §10): REVIEW with no metrics, since no segmenter ran and there is no mask";
  } else if (hasKey) {
    labels.verify = "fixture: BASETEN_API_KEY is set but no fetch was given to providersFromEnv, so no verifier ran";
  }

  const providers: Providers = { segmenter, renderer, verifier, fidelity };
  return { providers, mode: { provenance: live ? "live" : "fixture", fixture: !live, labels } };
}

export interface UploadServerOptions {
  readonly webDir: string;
  readonly jobsRoot: string;
  readonly shopDir: string;
  /** data/garments: where the source photos of committed jobs are found, by recorded hash (NR5 side-by-side). */
  readonly garmentsDir?: string;
  readonly providers: ServeProviders;
  readonly clock?: Clock;
  readonly now?: () => Date;
  readonly jobId?: () => string;
}

/** Decodes and checks one upload; throws UploadError with the reason the page shows. */
export function parseUpload(body: unknown): { garment_note: string; scenes: string[]; files: SourceImage[] } {
  if (typeof body !== "object" || body === null) throw new UploadError("the request body is not a JSON object");
  const b = body as Partial<UploadRequest>;
  const garment_note = typeof b.garment_note === "string" ? b.garment_note.trim() : "";
  if (garment_note === "") throw new UploadError("say what the garment is (garment_note)");
  if (garment_note.length > 300) throw new UploadError("garment_note is longer than 300 characters");
  const scenes = b.scenes === undefined ? [...DEFAULT_SCENES] : Array.isArray(b.scenes) ? b.scenes.map(String).map((s) => s.trim()).filter((s) => s !== "") : [];
  if (scenes.length === 0 || scenes.length > 3) throw new UploadError("scenes must name 1 to 3 scenes");
  if (!Array.isArray(b.files) || b.files.length === 0) throw new UploadError("choose at least one photo");
  if (b.files.length > MAX_FILES) throw new UploadError(`at most ${MAX_FILES} photos`);
  const names = new Set<string>();
  const files = b.files.map((f, i) => {
    if (typeof f !== "object" || f === null || typeof f.name !== "string" || typeof f.base64 !== "string") throw new UploadError(`file ${i} needs a name and base64 bytes`);
    if (!SAFE_NAME.test(f.name)) throw new UploadError(`file name ${JSON.stringify(f.name)} is not a plain file name`);
    if (names.has(f.name)) throw new UploadError(`two photos are both named ${f.name}`);
    names.add(f.name);
    const bytes = new Uint8Array(Buffer.from(f.base64, "base64"));
    if (bytes.length === 0) throw new UploadError(`${f.name} is empty`);
    return { name: f.name, bytes };
  });
  return { garment_note, scenes, files };
}

export class UploadServer {
  private readonly jobs = new Map<string, JobStatus>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly opts: UploadServerOptions;

  constructor(opts: UploadServerOptions) {
    this.opts = opts;
  }

  get mode(): ModeReport {
    return this.opts.providers.mode;
  }

  status(id: string): JobStatus | null {
    return this.jobs.get(id) ?? null;
  }

  /** Resolves when the job's run has finished (tests wait on it). */
  async settled(id: string): Promise<void> {
    await this.running.get(id);
  }

  /** Validates the upload, starts the job and returns its id without waiting for the pipeline. */
  submit(body: unknown): { job_id: string } {
    const upload = parseUpload(body);
    const job_id = this.opts.jobId?.() ?? defaultJobId(this.opts.now?.() ?? new Date());
    if (this.jobs.has(job_id) || existsSync(join(this.opts.jobsRoot, job_id))) throw new UploadError(`job ${job_id} already exists`, 409);
    const steps: Step[] = STEPS.map((name) => ({ name, state: "pending", detail: null }));
    this.jobs.set(job_id, { job_id, status: "running", mode: this.mode, steps, intake: null, result: null, error: null, published: null });
    this.running.set(job_id, this.run(job_id, upload));
    return { job_id };
  }

  private patch(id: string, change: Partial<JobStatus>): void {
    const current = this.jobs.get(id)!;
    this.jobs.set(id, { ...current, ...change });
  }

  private step(id: string, name: StepName, state: StepState, detail: string | null = null): void {
    const current = this.jobs.get(id)!;
    this.patch(id, { steps: current.steps.map((s) => (s.name === name ? { name, state, detail } : s)) });
  }

  private async run(id: string, upload: ReturnType<typeof parseUpload>): Promise<void> {
    const { providers } = this.opts.providers;
    // Intake: every photo loses its metadata; a file that is not a JPEG ends the job here, with no receipt.
    this.step(id, "exif", "running");
    let sources: SourceImage[];
    let intake: IntakeFile[];
    try {
      const done = upload.files.map((f) => intakeJpeg(f.name, f.bytes));
      sources = done.map((d) => ({ name: d.file.name, bytes: d.bytes }));
      intake = done.map((d) => d.file);
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.step(id, "exif", "failed", message);
      this.skipRest(id);
      this.patch(id, { status: "failed", error: `refused at intake, before the pipeline: ${message}` });
      return;
    }
    const removed = intake.flatMap((f) => f.removed);
    this.step(id, "exif", "done", `${intake.length} photo(s); removed ${removed.length > 0 ? [...new Set(removed)].join(", ") : "nothing (no metadata found)"}`);
    this.patch(id, { intake });

    // The stripped sources go beside the receipt so the job can be recorded (demo:record) later.
    const dir = join(this.opts.jobsRoot, id);
    mkdirSync(join(dir, SOURCES_DIR), { recursive: true });
    for (const s of sources) writeFileSync(join(dir, SOURCES_DIR, s.name), s.bytes);

    const wrapped = this.wrap(id, providers);
    let result: Awaited<ReturnType<typeof runJob>>;
    try {
      result = await runJob(
        { jobId: id, garmentNote: upload.garment_note, scenes: upload.scenes, sources },
        { outRoot: this.opts.jobsRoot, providers: wrapped, provenance: this.mode.provenance, ...(this.opts.clock ? { clock: this.opts.clock } : {}) },
      );
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.skipRest(id);
      this.patch(id, { status: "failed", error: `the pipeline did not finish: ${message}` });
      return;
    }

    const first = result.renders[0] ?? null;
    const refusal = result.refused;
    const decision: Decision = refusal ? "REFUSE" : first ? first.decision : "REFUSE";
    const reasons = refusal ? [refusal.reason] : first ? gateReasons(dir, first.render_id) : ["no scene was attempted"];
    if (refusal) {
      // Refused before any render: the segment step failed or a prior record was unreadable.
      if (refusal.rule === "segment_failed") this.step(id, "segment", "failed", refusal.reason);
      this.skipRest(id, ["gate"]);
    } else if (first && first.image_sha256 === null) {
      this.step(id, "render", "failed", first.cited?.reason ?? "render failed");
      this.skipRest(id, ["gate"]);
    }
    this.step(id, "gate", "done", decision);
    const image = first && first.image_sha256 !== null ? imageFile(dir, first.render_id) : null;
    this.patch(id, {
      status: "done",
      result: {
        decision,
        render_id: first?.render_id ?? null,
        image_sha256: first?.image_sha256 ?? null,
        image: image ? `/jobs/${id}/${image}` : null,
        receipt: `/jobs/${id}/${RECEIPT_FILE}`,
        head: result.head,
        provenance: this.mode.provenance,
        reasons,
        verify: first?.image_sha256 ? `verify.html#sha=${first.image_sha256}` : null,
      },
    });
  }

  private skipRest(id: string, keep: readonly StepName[] = []): void {
    for (const s of this.jobs.get(id)!.steps) if (s.state === "pending" && !keep.includes(s.name)) this.step(id, s.name, "skipped");
  }

  /** The providers with the step board updated around each call; errors pass through to the pipeline. */
  private wrap(id: string, p: Providers): Providers {
    const { labels } = this.mode;
    return {
      segmenter: {
        ...(p.segmenter.identity ? { identity: p.segmenter.identity } : {}),
        segment: async (sources) => {
          this.step(id, "segment", "running", labels.segment);
          try {
            const out: Segment[] = await p.segmenter.segment(sources);
            this.step(id, "segment", "done", `${out.length} segment(s); ${labels.segment}`);
            return out;
          } catch (err) {
            this.step(id, "segment", "failed", errorText(err));
            throw err;
          }
        },
      },
      renderer: {
        provider: p.renderer.provider,
        model: p.renderer.model,
        render: async (req) => {
          this.step(id, "render", "running", labels.render);
          try {
            const out = await p.renderer.render(req);
            this.step(id, "render", "done", labels.render);
            return out;
          } catch (err) {
            this.step(id, "render", "failed", errorText(err));
            throw err;
          }
        },
      },
      verifier: {
        identity: p.verifier.identity,
        verify: async (req) => {
          this.step(id, "verify", "running", labels.verify);
          try {
            const out = await p.verifier.verify(req);
            this.step(id, "verify", "done", labels.verify);
            this.step(id, "gate", "running");
            return out;
          } catch (err) {
            this.step(id, "verify", "failed", `${errorText(err)}: the gate refuses an unverified render`);
            this.step(id, "gate", "running");
            throw err;
          }
        },
      },
      fidelity: p.fidelity,
    };
  }

  /**
   * Publishes a finished RELEASE job: rebuilds the shop from the jobs root,
   * which lists the job only if its receipt verifies and its image hashes as
   * released. Anything else is refused with the reason.
   */
  publish(id: string): CatalogRow[] {
    const job = this.jobs.get(id);
    if (!job) throw new UploadError(`no job ${id}`, 404);
    if (job.status !== "done" || !job.result) throw new UploadError(`job ${id} has not finished`, 409);
    if (job.result.decision !== "RELEASE") throw new UploadError(`job ${id} was ${job.result.decision}, not RELEASE: it cannot be published`, 409);
    const built = buildShop(this.opts.jobsRoot, this.opts.shopDir);
    const rows = built.rows.filter((r) => r.job_id === id);
    const problem = built.problems.find((p) => p.job_id === id);
    if (problem) throw new UploadError(`the shop refused ${id}: ${problem.reason}`, 409);
    if (rows.length === 0) throw new UploadError(`the shop found no release for ${id}`, 409);
    this.patch(id, { published: rows });
    return rows;
  }

  /** The node:http handler: static web/, job files, and the JSON API. */
  handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = decodeURIComponent(url.pathname);
      if (req.method === "GET" && path === "/api/mode") return sendJson(res, 200, this.mode);
      if (req.method === "POST" && path === "/api/jobs") return sendJson(res, 202, this.submit(await readJson(req)));
      const jobMatch = /^\/api\/jobs\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})(\/publish)?$/.exec(path);
      if (jobMatch) {
        const id = jobMatch[1]!;
        if (jobMatch[2] && req.method === "POST") return sendJson(res, 200, { job_id: id, rows: this.publish(id) });
        if (!jobMatch[2] && req.method === "GET") {
          const status = this.status(id);
          return status ? sendJson(res, 200, status) : sendJson(res, 404, { error: `no job ${id}` });
        }
        return sendJson(res, 405, { error: "method not allowed" });
      }
      const receiptMatch = /^\/api\/receipts(?:\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?:\/(verify|tamper|source)(?:\/(\d{1,2}))?)?)?$/.exec(path);
      if (receiptMatch) return this.receiptRoute(req, res, receiptMatch[1] ?? null, receiptMatch[2] ?? null, receiptMatch[3] ?? null);
      if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method not allowed" });
      if (path === "/judge") return sendFile(res, safeJoin(this.opts.webDir, "judge.html"));
      const jobFile = /^\/jobs\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\/([^/]+)$/.exec(path);
      if (jobFile) return sendFile(res, safeJoin(join(this.opts.jobsRoot, jobFile[1]!), jobFile[2]!));
      return sendFile(res, safeJoin(this.opts.webDir, path === "/" ? "upload.html" : path));
    } catch (err) {
      if (err instanceof UploadError) return sendJson(res, err.status, { error: err.message });
      sendJson(res, 500, { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
    }
  };

  /** The jobs under the jobs root that have a receipt, newest job entry first, at most `limit`. */
  listReceipts(limit = 20): ReceiptListing {
    const root = this.opts.jobsRoot;
    const rows: ReceiptListing["jobs"][number][] = [];
    for (const name of existsSync(root) ? readdirSync(root) : []) {
      if (!JOB_ID.test(name) || !existsSync(join(root, name, RECEIPT_FILE))) continue;
      try {
        const entries = parseReceipt(readFileSync(join(root, name, RECEIPT_FILE), "utf8"));
        const view = presentJob(entries);
        rows.push({ job_id: name, at: entries[0]?.at ?? "", decision: view.renders[0]?.decision ?? null, provenance: view.provenance, badge: view.renders[0]?.badge.label ?? null });
      } catch {
        rows.push({ job_id: name, at: "", decision: null, provenance: null, badge: null });
      }
    }
    rows.sort((a, b) => (a.at === b.at ? a.job_id.localeCompare(b.job_id) : b.at.localeCompare(a.at)));
    const jobs = rows.slice(0, limit);
    const counts = { RELEASE: 0, REVIEW: 0, REFUSE: 0 };
    for (const j of jobs) if (j.decision) counts[j.decision]++;
    return { jobs, counts };
  }

  private receiptText(id: string): string {
    const file = join(this.opts.jobsRoot, id, RECEIPT_FILE);
    if (!existsSync(file)) throw new UploadError(`no receipt for job ${id}`, 404);
    return readFileSync(file, "utf8");
  }

  /** One job's source photo, served only when a file's bytes hash to the receipt's recorded sha256. */
  sourcePhoto(id: string, index: number): { file: string } {
    const view = presentJob(parseReceipt(this.receiptText(id)));
    const source = view.sources[index];
    if (!source) throw new UploadError("not found", 404);
    const dirs = [join(this.opts.jobsRoot, id, SOURCES_DIR), ...(this.opts.garmentsDir && existsSync(this.opts.garmentsDir) ? readdirSync(this.opts.garmentsDir).map((d) => join(this.opts.garmentsDir!, d)) : [])];
    for (const dir of dirs) {
      const file = join(dir, source.name);
      if (source.name.includes("/") || source.name.includes("\\") || !existsSync(file) || !statSync(file).isFile()) continue;
      if (sha256Hex(new Uint8Array(readFileSync(file))) === source.sha256) return { file };
    }
    throw new UploadError(`no file matches the recorded hash of ${source.name}`, 404);
  }

  private receiptRoute(req: IncomingMessage, res: ServerResponse, id: string | null, action: string | null, index: string | null): void {
    if (id === null) {
      if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
      return sendJson(res, 200, this.listReceipts());
    }
    if (action === null && req.method === "GET") {
      const view = presentJob(parseReceipt(this.receiptText(id)));
      const images = Object.fromEntries(view.renders.map((r) => [r.render_id, imageFile(join(this.opts.jobsRoot, id), r.render_id)]).filter(([, f]) => f !== null).map(([r, f]) => [r, `/jobs/${id}/${f}`]));
      return sendJson(res, 200, { ...view, images, receipt: `/jobs/${id}/${RECEIPT_FILE}` });
    }
    if (action === "source" && index !== null && req.method === "GET") return sendFile(res, this.sourcePhoto(id, Number(index)).file);
    // Verify and tamper read the stored file and write nothing.
    if (action === "verify" && req.method === "POST") return sendJson(res, 200, verifyChain(parseReceipt(this.receiptText(id))));
    if (action === "tamper" && req.method === "POST") {
      const copy = tamperedCopy(this.receiptText(id));
      return sendJson(res, 200, { tampered_entry: copy.index, result: verifyChain(parseReceipt(copy.text)) });
    }
    return sendJson(res, 405, { error: "method not allowed" });
  }
}

export interface ReceiptListing {
  readonly jobs: readonly { readonly job_id: string; readonly at: string; readonly decision: Decision | null; readonly provenance: string | null; readonly badge: string | null }[];
  readonly counts: Readonly<Record<Decision, number>>;
}

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function defaultJobId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
  return `${UPLOAD_JOB_PREFIX}${stamp}-${randomBytes(2).toString("hex")}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : `Error: ${String(err)}`;
}

/** The gate entry's reasons for one render, read back from the receipt the pipeline just wrote. */
function gateReasons(dir: string, renderId: string): string[] {
  const lines = readFileSync(join(dir, RECEIPT_FILE), "utf8").split("\n").filter((l) => l.trim() !== "");
  for (const line of lines) {
    const e = JSON.parse(line) as { kind: string; payload: { render_id?: string; reasons?: { reason?: unknown }[] } };
    if (e.kind === "gate" && e.payload.render_id === renderId) {
      return (e.payload.reasons ?? []).map((r) => (typeof r.reason === "string" ? r.reason : "")).filter((r) => r !== "");
    }
  }
  return [];
}

function imageFile(dir: string, renderId: string): string | null {
  for (const ext of ["jpg", "png"]) if (existsSync(join(dir, `${renderId}.${ext}`))) return `${renderId}.${ext}`;
  return null;
}

/** root/path, refused when it escapes root or names the sources folder. */
function safeJoin(root: string, path: string): string {
  const base = resolve(root);
  const full = resolve(base, `.${path.startsWith("/") ? path : `/${path}`}`);
  if (full !== base && !full.startsWith(base + sep)) throw new UploadError("not found", 404);
  if (full.split(sep).includes(SOURCES_DIR)) throw new UploadError("not found", 404);
  return full;
}

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
};

function sendFile(res: ServerResponse, file: string): void {
  if (!existsSync(file) || !statSync(file).isFile()) return sendJson(res, 404, { error: "not found" });
  res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(`${JSON.stringify(body)}\n`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new UploadError(`the upload is over ${MAX_BODY_BYTES} bytes`, 413);
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new UploadError("the request body is not JSON");
  }
}
