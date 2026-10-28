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

import type { Renderer, SourceImage } from "./pipeline.ts";

export const RENDER_PROVIDERS = ["openai-images", "fal", "meta", "stand-in"] as const;
export type RenderProvider = (typeof RENDER_PROVIDERS)[number];
/** The providers that send a request; the stand-in sends none. */
export type HttpRenderProvider = Exclude<RenderProvider, "stand-in">;

export const MUSE_IMAGE = /muse[\s._\/-]*image/i;

/** The only model id the stand-in records: it is the owner's photo, not a model. */
export const STAND_IN_MODEL = "owner-photo";

/** The model used when MODEL_RENDER is empty; null means MODEL_RENDER is required. */
export const DEFAULT_MODEL: Readonly<Record<RenderProvider, string | null>> = Object.freeze({
  "openai-images": "gpt-image-1",
  fal: null,
  meta: null,
  "stand-in": STAND_IN_MODEL,
});

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
export function rendererFromEnv(env: Readonly<Record<string, string | undefined>>, transport: RenderTransport): Renderer {
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
  const provider = name as HttpRenderProvider;
  const model = wanted || DEFAULT_MODEL[provider];
  if (!model) throw new RenderConfigError(`RENDER_PROVIDER ${provider} needs MODEL_RENDER`);
  refuseMuseImage(model);
  return {
    provider,
    model,
    render: async ({ scene, prompt, sources }) => {
      refuseMuseImage(model);
      return transport({ provider, model, scene, prompt, sources });
    },
  };
}
