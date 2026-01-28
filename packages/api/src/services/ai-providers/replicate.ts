/**
 * Replicate Provider Adapter
 *
 * Capabilities: image_generation, text_to_speech, speech_to_text, video_generation
 * Used as fallback provider when primary providers fail.
 *
 * SDK: replicate
 */

import Replicate from "replicate";

import type {
  ImageGenerationInput,
  ImageGenerationOutput,
  SpeechToTextInput,
  SpeechToTextOutput,
  TextToSpeechInput,
  TextToSpeechOutput,
  UsageMetrics,
} from "./types";

export async function generateImage(
  apiToken: string,
  input: ImageGenerationInput
): Promise<{ result: ImageGenerationOutput; metrics: UsageMetrics }> {
  const start = Date.now();

  const replicate = new Replicate({ auth: apiToken });

  const width = input.width ?? 1024;
  const height = input.height ?? 1024;

  const output = (await replicate.run("black-forest-labs/flux-schnell", {
    input: {
      prompt: input.prompt,
      width,
      height,
      num_outputs: 1,
    },
  })) as string[];

  const durationMs = Date.now() - start;

  if (!output?.[0]) {
    throw new Error("No image returned from Replicate");
  }

  const megapixels = (width * height) / 1_000_000;

  return {
    result: {
      url: output[0],
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

export async function textToSpeech(
  apiToken: string,
  input: TextToSpeechInput
): Promise<{ result: TextToSpeechOutput; metrics: UsageMetrics }> {
  const start = Date.now();

  const replicate = new Replicate({ auth: apiToken });

  const output = await replicate.run(
    "lucataco/xtts-v2:684bc3855b37866c0c65add2ff39c78f3dea3f4ff103a436465326e0f438d55e",
    {
      input: {
        text: input.text,
        speaker:
          "https://replicate.delivery/pbxt/Jt79w0xsT64R1JsiJ0LQRL8UcWspg5J4RFrU6YwEKpOT1ukS/male.wav",
        language: "en",
      },
    }
  );

  const durationMs = Date.now() - start;

  if (!output || typeof output !== "string") {
    throw new Error("No audio URL returned from Replicate");
  }

  // Estimate audio duration (rough: ~150 chars per second of speech)
  const estimatedDurationSeconds = Math.ceil(input.text.length / 150);

  return {
    result: {
      audioUrl: output,
      durationSeconds: estimatedDurationSeconds,
    },
    metrics: {
      inputUnits: input.text.length,
      outputUnits: estimatedDurationSeconds,
      unitType: "characters",
      durationMs,
    },
  };
}

export async function speechToText(
  apiToken: string,
  input: SpeechToTextInput
): Promise<{ result: SpeechToTextOutput; metrics: UsageMetrics }> {
  const start = Date.now();

  const replicate = new Replicate({ auth: apiToken });

  const output = (await replicate.run(
    "openai/whisper:4d50797290df275329f202e48c76360b3f22b08d28c196cbc54600319435f8d2",
    {
      input: {
        audio: input.audioUrl,
        model: "large-v3",
        language: input.language,
        translate: false,
      },
    }
  )) as WhisperOutput;

  const durationMs = Date.now() - start;

  if (!output?.transcription) {
    throw new Error("No transcription returned from Replicate Whisper");
  }

  return {
    result: {
      text: output.transcription,
      confidence: undefined, // Whisper doesn't return confidence
    },
    metrics: {
      inputUnits: Math.ceil(durationMs / 1000), // Rough estimate
      outputUnits: output.transcription.length,
      unitType: "seconds",
      durationMs,
    },
  };
}

interface WhisperOutput {
  transcription: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}
