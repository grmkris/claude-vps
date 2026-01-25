/**
 * AI Provider Configuration
 *
 * Defines available AI providers and their capabilities.
 * MVP: Platform keys only (no BYOK), architecture allows adding later.
 */

export const AI_CAPABILITIES = [
  "image_generation",
  "text_to_speech",
  "speech_to_text",
  "video_generation",
] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const AI_PROVIDERS = {
  fal: {
    name: "Fal.ai",
    envKey: "FAL_API_KEY",
    capabilities: ["image_generation", "video_generation"] as const,
    models: {
      image_generation: "fal-ai/flux/dev",
      video_generation: "fal-ai/minimax/video-01",
    },
  },
  elevenlabs: {
    name: "ElevenLabs",
    envKey: "ELEVENLABS_API_KEY",
    capabilities: ["text_to_speech"] as const,
    models: {
      text_to_speech: "eleven_multilingual_v2",
    },
  },
  google: {
    name: "Google Cloud",
    envKey: "GOOGLE_CLOUD_API_KEY",
    capabilities: ["speech_to_text"] as const,
    models: {
      speech_to_text: "latest_long",
    },
  },
  replicate: {
    name: "Replicate",
    envKey: "REPLICATE_API_TOKEN",
    capabilities: [
      "image_generation",
      "text_to_speech",
      "speech_to_text",
      "video_generation",
    ] as const,
    models: {
      image_generation: "black-forest-labs/flux-schnell",
      text_to_speech: "cjwbw/xtts-v2",
      speech_to_text: "openai/whisper",
      video_generation: "minimax/video-01",
    },
  },
} as const;

export type AiProvider = keyof typeof AI_PROVIDERS;

/**
 * Get primary provider for a capability
 */
export function getPrimaryProvider(capability: AiCapability): AiProvider {
  switch (capability) {
    case "image_generation":
      return "fal";
    case "text_to_speech":
      return "elevenlabs";
    case "speech_to_text":
      return "google";
    case "video_generation":
      return "fal";
  }
}

/**
 * Get fallback provider (always Replicate for MVP)
 */
export function getFallbackProvider(): AiProvider {
  return "replicate";
}
