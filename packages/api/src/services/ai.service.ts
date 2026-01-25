/**
 * AI Service
 *
 * Orchestrates AI capabilities (image gen, TTS, STT) across providers.
 * - Uses primary providers (Fal, ElevenLabs, Google) with Replicate as fallback
 * - Tracks all usage in ai_usage table for billing
 * - Returns neverthrow Results for error handling
 */

import type { Database, NewAiUsage } from "@vps-claude/db";

import { aiUsage } from "@vps-claude/db";
import {
  type AiCapability,
  type AiProvider,
  type BoxId,
  type UserId,
} from "@vps-claude/shared";
import { type Result, err, ok } from "neverthrow";

import {
  elevenlabsProvider,
  falProvider,
  googleProvider,
  replicateProvider,
  type ImageGenerationInput,
  type ImageGenerationOutput,
  type SpeechToTextInput,
  type SpeechToTextOutput,
  type TextToSpeechInput,
  type TextToSpeechOutput,
  type UsageMetrics,
} from "./ai-providers";

export type AiServiceError =
  | { type: "MISSING_API_KEY"; message: string }
  | { type: "PROVIDER_ERROR"; message: string; provider: AiProvider }
  | { type: "VALIDATION_ERROR"; message: string };

interface AiServiceEnv {
  FAL_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  GOOGLE_CLOUD_API_KEY?: string;
  REPLICATE_API_TOKEN?: string;
}

interface AiServiceDeps {
  db: Database;
  env: AiServiceEnv;
}

export function createAiService({ deps }: { deps: AiServiceDeps }) {
  const { db, env } = deps;

  const trackUsage = async (params: {
    userId: UserId;
    boxId?: BoxId;
    provider: AiProvider;
    capability: AiCapability;
    modelId?: string;
    metrics: UsageMetrics;
    success: boolean;
    errorMessage?: string;
  }) => {
    const insert: NewAiUsage = {
      userId: params.userId,
      boxId: params.boxId ?? null,
      provider: params.provider,
      capability: params.capability,
      modelId: params.modelId ?? null,
      inputUnits: params.metrics.inputUnits ?? null,
      outputUnits: params.metrics.outputUnits ?? null,
      unitType: params.metrics.unitType ?? null,
      durationMs: params.metrics.durationMs,
      success: params.success,
      errorMessage: params.errorMessage ?? null,
      // costUsd will be calculated later based on provider pricing
      costUsd: null,
    };

    await db.insert(aiUsage).values(insert);
  };

  const getApiKey = (provider: AiProvider): string | undefined => {
    switch (provider) {
      case "fal":
        return env.FAL_API_KEY;
      case "elevenlabs":
        return env.ELEVENLABS_API_KEY;
      case "google":
        return env.GOOGLE_CLOUD_API_KEY;
      case "replicate":
        return env.REPLICATE_API_TOKEN;
    }
  };

  return {
    async generateImage(params: {
      userId: UserId;
      boxId?: BoxId;
      prompt: string;
      width?: number;
      height?: number;
    }): Promise<Result<ImageGenerationOutput, AiServiceError>> {
      const input: ImageGenerationInput = {
        prompt: params.prompt,
        width: params.width,
        height: params.height,
      };

      // Try Fal.ai first
      const falKey = getApiKey("fal");
      if (falKey) {
        try {
          const { result, metrics } = await falProvider.generateImage(
            falKey,
            input
          );
          await trackUsage({
            userId: params.userId,
            boxId: params.boxId,
            provider: "fal",
            capability: "image_generation",
            modelId: "fal-ai/flux/dev",
            metrics,
            success: true,
          });
          return ok(result);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          await trackUsage({
            userId: params.userId,
            boxId: params.boxId,
            provider: "fal",
            capability: "image_generation",
            modelId: "fal-ai/flux/dev",
            metrics: { durationMs: 0 },
            success: false,
            errorMessage,
          });
          // Fall through to Replicate
        }
      }

      // Fallback to Replicate
      const replicateKey = getApiKey("replicate");
      if (!replicateKey) {
        return err({
          type: "MISSING_API_KEY",
          message: "No API key available for image generation",
        });
      }

      try {
        const { result, metrics } = await replicateProvider.generateImage(
          replicateKey,
          input
        );
        await trackUsage({
          userId: params.userId,
          boxId: params.boxId,
          provider: "replicate",
          capability: "image_generation",
          modelId: "black-forest-labs/flux-schnell",
          metrics,
          success: true,
        });
        return ok(result);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        await trackUsage({
          userId: params.userId,
          boxId: params.boxId,
          provider: "replicate",
          capability: "image_generation",
          modelId: "black-forest-labs/flux-schnell",
          metrics: { durationMs: 0 },
          success: false,
          errorMessage,
        });
        return err({
          type: "PROVIDER_ERROR",
          message: errorMessage,
          provider: "replicate",
        });
      }
    },

    async textToSpeech(params: {
      userId: UserId;
      boxId?: BoxId;
      text: string;
      voice?: string;
    }): Promise<Result<TextToSpeechOutput, AiServiceError>> {
      const input: TextToSpeechInput = {
        text: params.text,
        voice: params.voice,
      };

      // Try ElevenLabs first
      const elevenlabsKey = getApiKey("elevenlabs");
      if (elevenlabsKey) {
        try {
          const { result, metrics } = await elevenlabsProvider.textToSpeech(
            elevenlabsKey,
            input
          );
          await trackUsage({
            userId: params.userId,
            boxId: params.boxId,
            provider: "elevenlabs",
            capability: "text_to_speech",
            modelId: "eleven_multilingual_v2",
            metrics,
            success: true,
          });
          return ok(result);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          await trackUsage({
            userId: params.userId,
            boxId: params.boxId,
            provider: "elevenlabs",
            capability: "text_to_speech",
            modelId: "eleven_multilingual_v2",
            metrics: { durationMs: 0 },
            success: false,
            errorMessage,
          });
          // Fall through to Replicate
        }
      }

      // Fallback to Replicate
      const replicateKey = getApiKey("replicate");
      if (!replicateKey) {
        return err({
          type: "MISSING_API_KEY",
          message: "No API key available for text-to-speech",
        });
      }

      try {
        const { result, metrics } = await replicateProvider.textToSpeech(
          replicateKey,
          input
        );
        await trackUsage({
          userId: params.userId,
          boxId: params.boxId,
          provider: "replicate",
          capability: "text_to_speech",
          modelId: "lucataco/xtts-v2",
          metrics,
          success: true,
        });
        return ok(result);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        await trackUsage({
          userId: params.userId,
          boxId: params.boxId,
          provider: "replicate",
          capability: "text_to_speech",
          modelId: "lucataco/xtts-v2",
          metrics: { durationMs: 0 },
          success: false,
          errorMessage,
        });
        return err({
          type: "PROVIDER_ERROR",
          message: errorMessage,
          provider: "replicate",
        });
      }
    },

    async speechToText(params: {
      userId: UserId;
      boxId?: BoxId;
      audioUrl: string;
      language?: string;
    }): Promise<Result<SpeechToTextOutput, AiServiceError>> {
      const input: SpeechToTextInput = {
        audioUrl: params.audioUrl,
        language: params.language,
      };

      // Try Google first
      const googleKey = getApiKey("google");
      if (googleKey) {
        try {
          const { result, metrics } = await googleProvider.speechToText(
            googleKey,
            input
          );
          await trackUsage({
            userId: params.userId,
            boxId: params.boxId,
            provider: "google",
            capability: "speech_to_text",
            modelId: "latest_long",
            metrics,
            success: true,
          });
          return ok(result);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          await trackUsage({
            userId: params.userId,
            boxId: params.boxId,
            provider: "google",
            capability: "speech_to_text",
            modelId: "latest_long",
            metrics: { durationMs: 0 },
            success: false,
            errorMessage,
          });
          // Fall through to Replicate
        }
      }

      // Fallback to Replicate (Whisper)
      const replicateKey = getApiKey("replicate");
      if (!replicateKey) {
        return err({
          type: "MISSING_API_KEY",
          message: "No API key available for speech-to-text",
        });
      }

      try {
        const { result, metrics } = await replicateProvider.speechToText(
          replicateKey,
          input
        );
        await trackUsage({
          userId: params.userId,
          boxId: params.boxId,
          provider: "replicate",
          capability: "speech_to_text",
          modelId: "openai/whisper",
          metrics,
          success: true,
        });
        return ok(result);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        await trackUsage({
          userId: params.userId,
          boxId: params.boxId,
          provider: "replicate",
          capability: "speech_to_text",
          modelId: "openai/whisper",
          metrics: { durationMs: 0 },
          success: false,
          errorMessage,
        });
        return err({
          type: "PROVIDER_ERROR",
          message: errorMessage,
          provider: "replicate",
        });
      }
    },
  };
}

export type AiService = ReturnType<typeof createAiService>;
