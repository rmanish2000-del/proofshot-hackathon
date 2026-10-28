// Generative try-on (NR4, SPEC-generative-tryon, Grok 28 Oct 20:21 IST): the
// seller's garment cut-out and a licence-clean synthetic model image go to
// Pruna p-image-try-on on Replicate (third-party, non-Meta), which draws the
// model wearing the garment. Meta did not draw the image; SAM 3.1, Muse Spark
// and the gate decide whether it is released, exactly as for any other render.
//
// Built and tested offline. Every way this provider cannot run (no token, no
// model image or licence, no garment mask, spend cap, two failed or timed-out
// attempts, an output it cannot read) falls back to the composite renderer it
// was given, never silently: the render entry then names the composite as
// provider and model, says generative false, and carries `fallback_reason`.
//
// The token is read from REPLICATE_API_TOKEN only. It goes in the Authorization
// header and nowhere else: not in the receipt, the errors, or any log. The
// spend ledger lives outside the repo (%LOCALAPPDATA%\ProofShot).
//
// The request body is person_image, garment_images, seed and, when the seller
// claimed a garment type or length, prompt (the API schema Grok read 28 Oct
// 22:25 also has reference_pose, turbo, preserve_input_size, output_format and
// output_quality, which are not sent). The render entry's `input` records
// exactly the fields sent, images by hash, and the pipeline's own prompt is
// left off the entry because it is never sent (NR4b).
//
// NR4b, why the first live try-on (14dad54) lost the kurta's length: the
// cut-out was whole (the front segment's box runs y 0.15 to 0.97 of the photo),
// but the synthetic model wears a hip-length T-shirt over leggings and no
// prompt was sent, so Pruna replaced the T-shirt and drew the rest of the kurta
// as shorts. The prompt now says the type and length the seller claimed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeRgb } from "./image.ts";
import { stripJpegMetadata } from "./intake.ts";
import type { RenderedImage, Renderer, Segment, SourceImage } from "./pipeline.ts";
import { decodePng, encodeRgbPng, maskFromPng } from "./png.ts";
import { frontMaskSegment, imageExt } from "./render.ts";
import { sha256Hex } from "./util.ts";

export const REPLICATE_PROVIDER = "replicate-pruna-tryon";
export const REPLICATE_MODEL = "prunaai/p-image-try-on";
export const REPLICATE_PREDICTIONS_URL = `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`;
export const AI_PREVIEW_LABEL = "AI preview: look only";
/** Model page price, 28 Oct 2026: the first garment image, then each extra one. */
export const PRICE_USD = Object.freeze({ first_garment: 0.015, extra_garment: 0.008 });
export const SPEND_CAP_USD = 5;
export const ATTEMPT_TIMEOUT_MS = 120_000;
export const ATTEMPTS = 2;
export const POLL_MS = 2_000;
export const DEFAULT_SEED = 1;
/** The committed synthetic model image (Grok 3e852fd, AI-generated, LICENSE.md beside it). */
export const DEFAULT_MODEL_IMAGE = "synthetic-01";
/** The repo's data/models/ folder, one sub-folder per synthetic model image. */
export const MODELS_DIR = fileURLToPath(new URL("../data/models/", import.meta.url));

export type FallbackReason = "no_api_token" | "no_model_image" | "no_garment_mask" | "spend_cap" | "replicate_timeout" | "replicate_failed" | "unsupported_output";

export interface ReplicateResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type ReplicateFetch = (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<ReplicateResponse>;

export interface LedgerEntry {
  readonly at: string;
  readonly prediction_id: string;
  readonly cost_usd: number;
  /** True when the API reported no cost and the price table gave it. */
  readonly estimated: boolean;
}

/** The spend record. read() throws when the ledger cannot be read, and the guard then refuses. */
export interface Ledger {
  read(): readonly LedgerEntry[];
  append(entry: LedgerEntry): void;
}

/** The default ledger path: %LOCALAPPDATA%\ProofShot\replicate-ledger.json, outside the repo. Null with no LOCALAPPDATA. */
export function defaultLedgerPath(env: Readonly<Record<string, string | undefined>>): string | null {
  const base = (env.LOCALAPPDATA ?? "").trim();
  return base ? join(base, "ProofShot", "replicate-ledger.json") : null;
}

/** A JSON-file ledger. A missing file is an empty ledger; anything unreadable throws. */
export function fileLedger(path: string): Ledger {
  const read = (): LedgerEntry[] => {
    if (!existsSync(path)) return [];
    const v = JSON.parse(readFileSync(path, "utf8")) as { entries?: unknown };
    if (!Array.isArray(v.entries) || !v.entries.every((e) => typeof e?.cost_usd === "number" && Number.isFinite(e.cost_usd))) {
      throw new Error(`${path} is not a spend ledger`);
    }
    return v.entries as LedgerEntry[];
  };
  return {
    read,
    append: (entry) => {
      const entries = [...read(), entry];
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify({ entries }, null, 2)}\n`);
    },
  };
}

export function estimateCostUsd(garmentImages: number): number {
  if (garmentImages < 1) return 0;
  return Math.round((PRICE_USD.first_garment + (garmentImages - 1) * PRICE_USD.extra_garment) * 1000) / 1000;
}

export interface ModelImage {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly ext: "jpg" | "png";
}

/**
 * data/models/<id>/image.(jpg|png) or model.(jpg|png) (synthetic-01, 3e852fd) and its LICENSE.md (source, licence,
 * release, "synthetic, not a real person"). Null with the reason when either is
 * missing, the image is not a JPEG or PNG, or a JPEG still carries metadata.
 */
export function loadModelImage(modelsDir: string, id: string): ModelImage | { readonly missing: string } {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return { missing: `${JSON.stringify(id)} is not a model image id` };
  const dir = join(modelsDir, id);
  if (!existsSync(join(dir, "LICENSE.md"))) return { missing: `${id}/LICENSE.md is missing` };
  for (const name of ["image.jpg", "image.png", "model.jpg", "model.png"]) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const bytes = new Uint8Array(readFileSync(path));
    const ext = imageExt(bytes);
    if (!ext) return { missing: `${id}/${name} is not a JPEG or PNG` };
    if (ext === "jpg" && stripJpegMetadata(bytes).length !== bytes.length) return { missing: `${id}/${name} still carries metadata` };
    return { id, bytes, ext };
  }
  return { missing: `${id}/image.(jpg|png) or model.(jpg|png) is missing` };
}

/**
 * The garment cut-out sent to the model: the front photo's pixels inside its
 * best SAM mask, cropped to the mask's box, white outside the mask. Seller
 * pixels only. Null when there is no usable mask.
 */
export function garmentCutout(sources: readonly SourceImage[], segments: readonly Segment[]): Uint8Array | null {
  const pick = frontMaskSegment(sources, segments);
  if (!pick || !sources[0]) return null;
  let src, mask;
  try {
    src = decodeRgb(sources[0].bytes);
    mask = maskFromPng(decodePng(pick.segment.mask));
  } catch {
    return null;
  }
  if (mask.width !== src.width || mask.height !== src.height) return null;
  let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (!mask.data[y * src.width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Uint8Array(w * h * 3).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y + y0) * src.width + (x + x0);
      if (!mask.data[i]) continue;
      out.set(src.data.subarray(i * 3, i * 3 + 3), (y * w + x) * 3);
    }
  }
  return encodeRgbPng(w, h, out);
}

// Seller claim keys the try-on prompt may use (Grok 28 Oct 22:30): type and length, never colour or print.
// note.txt says "Type:" (job:live prefixes the folder name); the upload page says "hem:" for the length claim.
const CLAIM = /^(?:[A-Za-z0-9._-]+:\s*)?(type|length|hem)\s*:\s*(.+)$/i;
const UNCLAIMED = /^(not recorded|as in the photos?)\b/i;
const COLOUR_WORD = /\b(red|orange|rust|yellow|gold(en)?|green|blue|navy|indigo|purple|violet|pink|peach|maroon|brown|beige|cream|white|black|gr[ae]y|silver|colou?r|print(ed)?|floral|check(ed)?|stripe[ds]?|embroider(ed|y))\b/i;

/**
 * The prompt sent with a try-on: the seller's garment type and length claims
 * from the garment note and nothing else, or null when neither was claimed
 * (then no prompt is sent). A claim that names a colour or print is dropped.
 */
export function tryOnPrompt(garmentNote: string): string | null {
  const got: { type?: string; length?: string } = {};
  for (const part of garmentNote.split(/[;\r\n]/)) {
    const m = CLAIM.exec(part.trim());
    if (!m) continue;
    const key = m[1]!.toLowerCase() === "type" ? "type" : "length";
    const value = m[2]!.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!value || UNCLAIMED.test(value) || COLOUR_WORD.test(value) || got[key]) continue;
    got[key] = value;
  }
  const lines = [
    ...(got.type ? [`Garment type: ${got.type}.`] : []),
    ...(got.length ? [`Garment length: ${got.length}. Keep the garment's full length; do not shorten it.`] : []),
  ];
  return lines.length > 0 ? lines.join(" ") : null;
}

// PNG chunks kept when stripping an output: the image and its colour, nothing else.
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT"]);

/** A JPEG or PNG with its metadata removed; null for any other format. */
export function stripImageMetadata(bytes: Uint8Array): { bytes: Uint8Array; ext: "jpg" | "png" } | null {
  const ext = imageExt(bytes);
  if (ext === "jpg") return { bytes: stripJpegMetadata(bytes), ext };
  if (ext !== "png") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  for (let pos = 8; pos + 12 <= bytes.length; ) {
    const end = pos + 12 + view.getUint32(pos);
    if (end > bytes.length) return null;
    if (PNG_KEEP.has(String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)))) parts.push(bytes.subarray(pos, end));
    pos = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return { bytes: out, ext };
}

export interface ReplicateTryOnOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Null when the caller has no transport: every render falls back. */
  readonly fetch: ReplicateFetch | null;
  /** Runs when this provider cannot; normally the composite v2 renderer. */
  readonly fallback: Renderer;
  /** Null when there is no ledger path: every render falls back with spend_cap. */
  readonly ledger: Ledger | null;
  readonly modelsDir?: string;
  /** REPLICATE_MODEL_IMAGE names it when unset; default DEFAULT_MODEL_IMAGE. */
  readonly modelImageId?: string;
  readonly seed?: number;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

class AttemptError extends Error {
  readonly reason: "replicate_timeout" | "replicate_failed" | "unsupported_output";
  constructor(reason: AttemptError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * The Replicate Pruna try-on renderer. Its provider and model are the try-on's;
 * a render that falls back says so on the render entry (`made_by` names the
 * composite, which the pipeline writes as provider and model).
 */
export function replicateTryOnRenderer(opts: ReplicateTryOnOptions): Renderer {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const seed = opts.seed ?? DEFAULT_SEED;
  const modelImageId = opts.modelImageId ?? ((opts.env.REPLICATE_MODEL_IMAGE ?? "").trim() || DEFAULT_MODEL_IMAGE);

  const fallback = async (req: Parameters<Renderer["render"]>[0], reason: FallbackReason, detail: string): Promise<RenderedImage> => {
    const out = await opts.fallback.render(req);
    return {
      ...out,
      madeBy: { provider: opts.fallback.provider, model: opts.fallback.model },
      record: { ...(out.record ?? {}), generative: false, fallback_from: REPLICATE_PROVIDER, fallback_reason: reason, fallback_detail: detail },
    };
  };

  return {
    provider: REPLICATE_PROVIDER,
    model: REPLICATE_MODEL,
    render: async (req) => {
      const token = (opts.env.REPLICATE_API_TOKEN ?? "").trim();
      // Nothing that leaves this function may contain the token.
      const clean = (s: string) => (token ? s.split(token).join("[REDACTED]") : s);
      if (!token) return fallback(req, "no_api_token", "REPLICATE_API_TOKEN is not set");
      if (!opts.fetch) return fallback(req, "no_api_token", "no HTTP transport was given for Replicate");
      const model = loadModelImage(opts.modelsDir ?? MODELS_DIR, modelImageId);
      if ("missing" in model) return fallback(req, "no_model_image", model.missing);
      const garment = garmentCutout(req.sources, req.segments ?? []);
      if (!garment) return fallback(req, "no_garment_mask", "no usable SAM mask on the front photo");

      const estimate = estimateCostUsd(1);
      let spent: number;
      try {
        if (!opts.ledger) throw new Error("no ledger path (LOCALAPPDATA is not set)");
        spent = opts.ledger.read().reduce((n, e) => n + e.cost_usd, 0);
      } catch (err) {
        return fallback(req, "spend_cap", clean(`the spend ledger cannot be read: ${err instanceof Error ? err.message : String(err)}`));
      }
      if (spent + estimate > SPEND_CAP_USD + 1e-9) return fallback(req, "spend_cap", `spent ${spent.toFixed(3)} + ${estimate.toFixed(3)} would pass the ${SPEND_CAP_USD.toFixed(2)} USD cap`);

      const dataUri = (bytes: Uint8Array, ext: "jpg" | "png") => `data:image/${ext === "jpg" ? "jpeg" : "png"};base64,${Buffer.from(bytes).toString("base64")}`;
      const prompt = tryOnPrompt(req.garmentNote ?? "");
      const body = JSON.stringify({ input: { person_image: dataUri(model.bytes, model.ext), garment_images: [dataUri(garment, "png")], seed, ...(prompt ? { prompt } : {}) } });
      // The same fields as the body, images by hash: what was sent, and nothing that was not.
      const sent = {
        person_image: { sha256: sha256Hex(model.bytes), model_image_id: model.id },
        garment_images: [{ sha256: sha256Hex(garment), what: "garment_cutout" }],
        seed,
        ...(prompt ? { prompt } : {}),
      };
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      const attempt = async (): Promise<{ bytes: Uint8Array; ext: "jpg" | "png"; prediction: Record<string, unknown> }> => {
        const deadline = now() + timeoutMs;
        const call = async (url: string, method: "GET" | "POST", withBody: boolean): Promise<ReplicateResponse> => {
          const left = deadline - now();
          if (left <= 0) throw new AttemptError("replicate_timeout", `no answer within ${timeoutMs} ms`);
          try {
            return await opts.fetch!(url, { method, headers, ...(withBody ? { body } : {}), signal: AbortSignal.timeout(left) });
          } catch (err) {
            const name = err instanceof Error ? err.name : "";
            if (name === "TimeoutError" || name === "AbortError") throw new AttemptError("replicate_timeout", `no answer within ${timeoutMs} ms`);
            throw new AttemptError("replicate_failed", `request failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        };
        const created = await call(REPLICATE_PREDICTIONS_URL, "POST", true);
        if (!created.ok) throw new AttemptError("replicate_failed", `create returned HTTP ${created.status}`);
        let p = (await created.json()) as Record<string, unknown>;
        while (p.status !== "succeeded") {
          if (p.status === "failed" || p.status === "canceled") throw new AttemptError("replicate_failed", `prediction ${String(p.status)}: ${typeof p.error === "string" ? p.error.slice(0, 200) : "no error text"}`);
          const get = (p.urls as { get?: unknown } | undefined)?.get;
          if (typeof get !== "string") throw new AttemptError("replicate_failed", "the prediction has no poll URL");
          if (deadline - now() <= 0) throw new AttemptError("replicate_timeout", `no result within ${timeoutMs} ms`);
          await sleep(opts.pollMs ?? POLL_MS);
          const polled = await call(get, "GET", false);
          if (!polled.ok) throw new AttemptError("replicate_failed", `poll returned HTTP ${polled.status}`);
          p = (await polled.json()) as Record<string, unknown>;
        }
        const output = Array.isArray(p.output) ? p.output[0] : p.output;
        if (typeof output !== "string" || !/^https:\/\//.test(output)) throw new AttemptError("replicate_failed", "the prediction succeeded with no output URL");
        const file = await call(output, "GET", false);
        if (!file.ok) throw new AttemptError("replicate_failed", `output download returned HTTP ${file.status}`);
        const stripped = stripImageMetadata(new Uint8Array(await file.arrayBuffer()));
        if (!stripped) throw new AttemptError("unsupported_output", "the output is not a JPEG or PNG");
        return { ...stripped, prediction: p };
      };

      const errors: string[] = [];
      let last: AttemptError | null = null;
      for (let i = 0; i < ATTEMPTS; i++) {
        let got;
        try {
          got = await attempt();
        } catch (err) {
          last = err instanceof AttemptError ? err : new AttemptError("replicate_failed", err instanceof Error ? err.message : String(err));
          errors.push(clean(last.message));
          if (last.reason === "unsupported_output") break;
          continue;
        }
        const p = got.prediction;
        const id = typeof p.id === "string" ? p.id : "unknown";
        // Replicate's prediction carries no price; the cost is the price-table estimate.
        opts.ledger!.append({ at: new Date(now()).toISOString(), prediction_id: id, cost_usd: estimate, estimated: true });
        return {
          bytes: got.bytes,
          ext: got.ext,
          promptNotSent: true,
          record: {
            method: "generative",
            generative: true,
            model_version: typeof p.version === "string" ? p.version : null,
            prediction_id: id,
            input: sent,
            model_image_id: model.id,
            cost_usd: null,
            cost_estimated_usd: estimate,
            attempts: i + 1,
            label: AI_PREVIEW_LABEL,
          },
        };
      }
      return fallback(req, last!.reason, errors.join("; "));
    },
  };
}
