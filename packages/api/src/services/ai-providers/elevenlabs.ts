/**
 * ElevenLabs Provider Adapter
 *
 * Capabilities: text_to_speech
 * SDK: elevenlabs
 */

import { ElevenLabsClient } from "elevenlabs";

import type {
  TextToSpeechInput,
  TextToSpeechOutput,
  UsageMetrics,
} from "./types";

// Default voice ID (Rachel - clear, professional)
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export async function textToSpeech(
  apiKey: string,
  input: TextToSpeechInput
): Promise<{ result: TextToSpeechOutput; metrics: UsageMetrics }> {
  const start = Date.now();

  const client = new ElevenLabsClient({ apiKey });

  const voiceId = input.voice ?? DEFAULT_VOICE_ID;
  const modelId = input.modelId ?? "eleven_multilingual_v2";

  const audioStream = await client.textToSpeech.convert(voiceId, {
    text: input.text,
    model_id: modelId,
    output_format: "mp3_44100_128",
  });

  // Collect chunks into buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk);
  }
  const audioBuffer = Buffer.concat(chunks);

  // Convert to base64 data URL
  const base64 = audioBuffer.toString("base64");
  const audioUrl = `data:audio/mpeg;base64,${base64}`;

  const durationMs = Date.now() - start;

  // Estimate audio duration (rough: ~150 chars per second of speech)
  const estimatedDurationSeconds = Math.ceil(input.text.length / 150);

  return {
    result: {
      audioUrl,
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
