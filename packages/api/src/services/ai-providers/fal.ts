/**
 * Fal.ai Provider Adapter
 *
 * Capabilities: image_generation, video_generation
 * SDK: @fal-ai/client
 */

import { fal } from "@fal-ai/client";

import type {
  ImageGenerationInput,
  ImageGenerationOutput,
  UsageMetrics,
} from "./types";

export async function generateImage(
  apiKey: string,
  input: ImageGenerationInput
): Promise<{ result: ImageGenerationOutput; metrics: UsageMetrics }> {
  const start = Date.now();

  fal.config({ credentials: apiKey });

  const result = await fal.subscribe("fal-ai/flux/dev", {
    input: {
      prompt: input.prompt,
      image_size: {
        width: input.width ?? 1024,
        height: input.height ?? 1024,
      },
      num_images: 1,
    },
  });

  const durationMs = Date.now() - start;
  const image = result.data.images?.[0];

  if (!image?.url) {
    throw new Error("No image returned from Fal.ai");
  }

  const width = image.width ?? input.width ?? 1024;
  const height = image.height ?? input.height ?? 1024;
  const megapixels = (width * height) / 1_000_000;

  return {
    result: {
      url: image.url,
      width,
      height,
    },
    metrics: {
      inputUnits: input.prompt.length,
      outputUnits: Math.round(megapixels * 100) / 100,
      unitType: "megapixels",
      durationMs,
    },
  };
}
