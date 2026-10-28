// Render providers (SPEC §8): which renderer runs, and the Muse Image refusal.
//
// Muse Image is not available in India (Meta Geographic Use Policy §2.2), so a
// model id that names it is refused before any request leaves, whatever the
// provider. The HTTP request itself is the transport's job; this module only
// decides what may be sent, and reads no key.
//
// The `stand-in` provider generates nothing: it hands back the owner's own
// photo of the garment, so the receipt's render entry names `stand-in` /
// `owner-photo` and a reader can tell the image was never rendered.

//
// The `composite` provider generates nothing either: it cuts the garment out of
// the owner's front photo with the job's SAM mask and places it on a body
// template by deterministic code (src/composite.ts, SPEC-render-fix). Its render
// entry says method `composite`, generative false, and names the template and
// mask it used.

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMPOSITE_MODEL, CompositeError, FEATHER_PX, WARP, composite, loadTemplate } from "./composite.ts";
import { COMPOSITE_V2_MODEL, V2_CORRECTION_NOTE, V2_PARAMS, compositeV2 } from "./composite-v2.ts";
import type { V2Params } from "./composite-v2.ts";
import type { Template } from "./composite.ts";
import { decodeRgb } from "./image.ts";
import type { Renderer, Segment, SourceImage } from "./pipeline.ts";
import { decodePng, encodeGreyPng, maskFromPng } from "./png.ts";

export const RENDER_PROVIDERS = ["openai-images", "fal", "meta", "stand-in", "composite"] as const;
export type RenderProvider = (typeof RENDER_PROVIDERS)[number];
/** The providers that send a request; the stand-in and the composite send none. */
export type HttpRenderProvider = Exclude<RenderProvider, "stand-in" | "composite">;

export const MUSE_IMAGE = /muse[\s._\/-]*image/i;

/** The only model id the stand-in records: it is the owner's photo, not a model. */
export const STAND_IN_MODEL = "owner-photo";

/** The model used when MODEL_RENDER is empty; null means MODEL_RENDER is required. */
export const DEFAULT_MODEL: Readonly<Record<RenderProvider, string | null>> = Object.freeze({
  "openai-images": "gpt-image-1",
  fal: null,
  meta: null,
  "stand-in": STAND_IN_MODEL,
  composite: COMPOSITE_MODEL,
});

/** The template RENDER_TEMPLATE names when it is empty. */
export const DEFAULT_TEMPLATE = "mannequin-01";
/** The repo's templates/ folder, one sub-folder per template id. */
export const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

export class RenderConfigError extends Error {
  override name = "RenderConfigError";
}

export class MuseImageRefused extends Error {
  override name = "MuseImageRefused";
}

export class StandInError extends Error {
  override name = "StandInError";
}

/** "jpg" or "png" from the file's first bytes; null for anything else. */
export function imageExt(bytes: Uint8Array): "jpg" | "png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) return "png";
  return null;
}

/**
 * The stand-in renderer: returns the job's first source image, byte for byte,
 * as the "render" of every scene. No request, no key, nothing generated. A job
 * with no source, or a first source that is not a JPEG or PNG, throws
 * StandInError, which the pipeline records as `render_failed` (SPEC §3).
 */
export function standInRenderer(): Renderer {
  return {
    provider: "stand-in",
    model: STAND_IN_MODEL,
    render: async ({ sources }) => {
      const front = sources[0];
      if (!front) throw new StandInError("the stand-in renderer needs a source photo to return and the job has none");
      const ext = imageExt(front.bytes);
      if (!ext) throw new StandInError(`${front.name} is not a JPEG or PNG, so the stand-in renderer cannot return it`);
      return { bytes: front.bytes, ext };
    },
  };
}

/** The model-id prefix of a file stand-in: `file:<label>`. */
export const FILE_MODEL_PREFIX = "file:";

/**
 * A stand-in that returns one given image file instead of the job's own front
 * photo (job:live --render, for a deliberate-mismatch job). It generates
 * nothing either, so the provider stays `stand-in`; the model is
 * `file:<label>`, naming the file, so the receipt never claims the image is the
 * owner's photo of this garment. Bytes that are not a JPEG or PNG throw
 * StandInError here, before any job runs.
 */
export function fileRenderer(label: string, bytes: Uint8Array): Renderer {
  const ext = imageExt(bytes);
  if (!ext) throw new StandInError(`${label} is not a JPEG or PNG, so it cannot stand in for a render`);
  const name = label.trim();
  if (!name) throw new StandInError("a file stand-in needs a label for the receipt");
  return {
    provider: "stand-in",
    model: `${FILE_MODEL_PREFIX}${name}`,
    render: async () => ({ bytes, ext }),
  };
}

/**
 * The segment the composite cuts with: among the front source's segments
 * (label `<front name>/...`) that carry mask bytes, the top score; the first
 * of equals. Null when there is none.
 */
export function frontMaskSegment(sources: readonly SourceImage[], segments: readonly Segment[]): { segment: Segment & { mask: Uint8Array }; index: number } | null {
  const front = sources[0];
  if (!front) return null;
  let best: { segment: Segment & { mask: Uint8Array }; index: number } | null = null;
  segments.forEach((s, index) => {
    if (!s.label.startsWith(`${front.name}/`) || !(s.mask instanceof Uint8Array)) return;
    if (!best || s.score > best.segment.score) best = { segment: s as Segment & { mask: Uint8Array }, index };
  });
  return best;
}

/**
 * The composite renderer (SPEC-render-fix): the front photo's garment, cut out
 * with its SAM mask, warped onto `template` and laid over it, as a PNG. No
 * request, no key, no image model. No mask, a mask the wrong size, or a photo
 * that does not decode throws CompositeError, which the pipeline records as
 * `render_failed`, so the gate refuses: there is never a silent fall-back to
 * the stand-in.
 */
export function compositeRenderer(template: Template): Renderer {
  return {
    provider: "composite",
    model: COMPOSITE_MODEL,
    render: async ({ sources, segments }) => {
      const front = sources[0];
      if (!front) throw new CompositeError("no garment mask: the job has no source photo");
      const pick = frontMaskSegment(sources, segments ?? []);
      if (!pick) throw new CompositeError(`no garment mask: no segment with mask bytes for ${front.name}`);
      let src, mask;
      try {
        src = decodeRgb(front.bytes);
        mask = maskFromPng(decodePng(pick.segment.mask));
      } catch (err) {
        throw new CompositeError(`${front.name} or its mask did not decode: ${err instanceof Error ? err.message : String(err)}`);
      }
      const out = composite(src, mask, template);
      const renderMask = new Uint8Array(out.renderMask.data.length);
      for (let i = 0; i < renderMask.length; i++) renderMask[i] = out.renderMask.data[i] ? 255 : 0;
      return {
        bytes: out.png,
        ext: "png",
        renderMask: encodeGreyPng(out.renderMask.width, out.renderMask.height, renderMask),
        record: {
          method: "composite",
          generative: false,
          template: { id: template.id, sha256_base: template.sha256_base, sha256_anchors: template.sha256_anchors, licence: template.licence, kind: template.kind },
          mask: { source: front.name, segment_index: pick.index, sam_score: pick.segment.score },
          params: { feather_px: FEATHER_PX, warp: WARP, quad_from: out.quad_from, quad_to: out.quad_to },
        },
      };
    },
  };
}

/**
 * The composite v2 renderer (SPEC-composite-v2): the front photo's garment as
 * a ghost-mannequin product shot on a studio backdrop, 1200x1600, by
 * deterministic code, no template. No mask throws CompositeError
 * (render_failed, REFUSE); a photo that fails the quality pre-check throws
 * CompositeQualityReview (render_quality, REVIEW, no image). The fidelity
 * check still compares against the seller's unmodified photo: the pipeline
 * hands the checker the job's sources, never this output.
 */
export function compositeV2Renderer(params: V2Params = V2_PARAMS): Renderer {
  return {
    provider: "composite",
    model: COMPOSITE_V2_MODEL,
    render: async ({ sources, segments }) => {
      const front = sources[0];
      if (!front) throw new CompositeError("no garment mask: the job has no source photo");
      const pick = frontMaskSegment(sources, segments ?? []);
      if (!pick) throw new CompositeError(`no garment mask: no segment with mask bytes for ${front.name}`);
      let src, mask;
      try {
        src = decodeRgb(front.bytes);
        mask = maskFromPng(decodePng(pick.segment.mask));
      } catch (err) {
        throw new CompositeError(`${front.name} or its mask did not decode: ${err instanceof Error ? err.message : String(err)}`);
      }
      const out = compositeV2(src, mask, params);
      return {
        bytes: out.png,
        ext: "png",
        renderMask: encodeGreyPng(out.renderMask.width, out.renderMask.height, out.renderMask.data.map((v) => (v ? 255 : 0))),
        record: {
          method: COMPOSITE_V2_MODEL,
          generative: false,
          mask: { source: front.name, segment_index: pick.index, sam_score: pick.segment.score },
          composite: { params: out.params },
          note: V2_CORRECTION_NOTE,
          camera_use: "UNVERIFIED for camera",
        },
      };
    },
  };
}

/** Throws MuseImageRefused when the model id names Muse Image. */
export function refuseMuseImage(model: string): void {
  if (MUSE_IMAGE.test(model)) throw new MuseImageRefused(`${JSON.stringify(model)} is Muse Image, which is not available in India (Meta GUP §2.2)`);
}

/** Sends one render request to the provider and returns the image. */
export type RenderTransport = (req: {
  provider: HttpRenderProvider;
  model: string;
  scene: string;
  prompt: string;
  sources: readonly SourceImage[];
}) => Promise<{ bytes: Uint8Array; ext: string }>;

/**
 * The renderer RENDER_PROVIDER and MODEL_RENDER name. An unknown provider, a
 * missing model with no default, or a Muse Image model throws here, before any
 * request; the model is checked again before every request. `stand-in` never
 * calls the transport, and a MODEL_RENDER other than its own id is refused: the
 * receipt would otherwise claim a model that generated nothing.
 */
export function rendererFromEnv(env: Readonly<Record<string, string | undefined>>, transport: RenderTransport, templatesDir: string = TEMPLATES_DIR): Renderer {
  const name = (env.RENDER_PROVIDER ?? "").trim() || "openai-images";
  if (!(RENDER_PROVIDERS as readonly string[]).includes(name)) {
    throw new RenderConfigError(`RENDER_PROVIDER ${JSON.stringify(name)} is not one of ${RENDER_PROVIDERS.join(", ")}`);
  }
  const wanted = (env.MODEL_RENDER ?? "").trim();
  if (name === "stand-in") {
    if (wanted && wanted !== STAND_IN_MODEL) {
      throw new RenderConfigError(`RENDER_PROVIDER stand-in generates nothing, so MODEL_RENDER ${JSON.stringify(wanted)} cannot go on a receipt; leave it unset`);
    }
    return standInRenderer();
  }
  if (name === "composite") {
    if (wanted && wanted !== COMPOSITE_MODEL && wanted !== COMPOSITE_V2_MODEL) {
      throw new RenderConfigError(`RENDER_PROVIDER composite runs no image model, so MODEL_RENDER ${JSON.stringify(wanted)} cannot go on a receipt; leave it unset`);
    }
    // v2 is the default. v1 stays selectable for old receipts: COMPOSITE_VERSION=v1,
    // MODEL_RENDER composite-v1, or a RENDER_TEMPLATE (only v1 uses a template).
    const template = (env.RENDER_TEMPLATE ?? "").trim();
    const version = (env.COMPOSITE_VERSION ?? "").trim() || (wanted === COMPOSITE_MODEL || template ? "v1" : "v2");
    if (version !== "v1" && version !== "v2") throw new RenderConfigError(`COMPOSITE_VERSION ${JSON.stringify(version)} is not v1 or v2`);
    if (wanted && wanted !== (version === "v1" ? COMPOSITE_MODEL : COMPOSITE_V2_MODEL)) {
      throw new RenderConfigError(`MODEL_RENDER ${JSON.stringify(wanted)} does not match COMPOSITE_VERSION ${version}`);
    }
    if (version === "v2") {
      if (template) throw new RenderConfigError("composite v2 uses no template, so RENDER_TEMPLATE must be unset");
      return compositeV2Renderer();
    }
    const id = template || DEFAULT_TEMPLATE;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new RenderConfigError(`RENDER_TEMPLATE ${JSON.stringify(id)} is not a template id`);
    return compositeRenderer(loadTemplate(join(templatesDir, id), id));
  }
  const provider = name as HttpRenderProvider;
  const model = wanted || DEFAULT_MODEL[provider];
  if (!model) throw new RenderConfigError(`RENDER_PROVIDER ${provider} needs MODEL_RENDER`);
  refuseMuseImage(model);
  return {
    provider,
    model,
    render: async ({ scene, prompt, sources }) => {
      refuseMuseImage(model);
      const out = await transport({ provider, model, scene, prompt, sources });
      return { ...out, record: { method: "generative", generative: true } };
    },
  };
}
