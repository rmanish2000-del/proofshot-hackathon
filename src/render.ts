// Render providers (SPEC §8): which renderer runs, and the Muse Image refusal.
//
// Muse Image is not available in India (Meta Geographic Use Policy §2.2), so a
// model id that names it is refused before any request leaves, whatever the
// provider. The HTTP request itself is the transport's job; this module only
// decides what may be sent, and reads no key.

import type { Renderer, SourceImage } from "./pipeline.ts";

export const RENDER_PROVIDERS = ["openai-images", "fal", "meta"] as const;
export type RenderProvider = (typeof RENDER_PROVIDERS)[number];

export const MUSE_IMAGE = /muse[\s._\/-]*image/i;

/** The model used when MODEL_RENDER is empty; null means MODEL_RENDER is required. */
export const DEFAULT_MODEL: Readonly<Record<RenderProvider, string | null>> = Object.freeze({
  "openai-images": "gpt-image-1",
  fal: null,
  meta: null,
});

export class RenderConfigError extends Error {
  override name = "RenderConfigError";
}

export class MuseImageRefused extends Error {
  override name = "MuseImageRefused";
}

/** Throws MuseImageRefused when the model id names Muse Image. */
export function refuseMuseImage(model: string): void {
  if (MUSE_IMAGE.test(model)) throw new MuseImageRefused(`${JSON.stringify(model)} is Muse Image, which is not available in India (Meta GUP §2.2)`);
}

/** Sends one render request to the provider and returns the image. */
export type RenderTransport = (req: {
  provider: RenderProvider;
  model: string;
  scene: string;
  prompt: string;
  sources: readonly SourceImage[];
}) => Promise<{ bytes: Uint8Array; ext: string }>;

/**
 * The renderer RENDER_PROVIDER and MODEL_RENDER name. An unknown provider, a
 * missing model with no default, or a Muse Image model throws here, before any
 * request; the model is checked again before every request.
 */
export function rendererFromEnv(env: Readonly<Record<string, string | undefined>>, transport: RenderTransport): Renderer {
  const name = (env.RENDER_PROVIDER ?? "").trim() || "openai-images";
  if (!(RENDER_PROVIDERS as readonly string[]).includes(name)) {
    throw new RenderConfigError(`RENDER_PROVIDER ${JSON.stringify(name)} is not one of ${RENDER_PROVIDERS.join(", ")}`);
  }
  const provider = name as RenderProvider;
  const model = (env.MODEL_RENDER ?? "").trim() || DEFAULT_MODEL[provider];
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
