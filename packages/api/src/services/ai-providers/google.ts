/**
 * Google Cloud Speech-to-Text Provider Adapter
 *
 * Capabilities: speech_to_text
 *
 * Note: For MVP, uses Google's REST API directly.
 * Requires GOOGLE_CLOUD_API_KEY environment variable.
 */

import type {
  SpeechToTextInput,
  SpeechToTextOutput,
  UsageMetrics,
} from "./types";

const GOOGLE_STT_API = "https://speech.googleapis.com/v1/speech:recognize";

export async function speechToText(
  apiKey: string,
  input: SpeechToTextInput
): Promise<{ result: SpeechToTextOutput; metrics: UsageMetrics }> {
  const start = Date.now();

  // Fetch audio from URL and convert to base64
  const audioResponse = await fetch(input.audioUrl);
  if (!audioResponse.ok) {
    throw new Error(`Failed to fetch audio: ${audioResponse.statusText}`);
  }

  const audioBuffer = await audioResponse.arrayBuffer();
  const audioBase64 = Buffer.from(audioBuffer).toString("base64");

  // Detect encoding from URL or default to LINEAR16
  const encoding = detectEncoding(input.audioUrl);

  const response = await fetch(`${GOOGLE_STT_API}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      config: {
        encoding,
        sampleRateHertz: 16000,
        languageCode: input.language ?? "en-US",
        enableAutomaticPunctuation: true,
      },
      audio: {
        content: audioBase64,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google STT API error: ${error}`);
  }

  const data = (await response.json()) as GoogleSTTResponse;
  const durationMs = Date.now() - start;

  const transcript =
    data.results
      ?.map((r) => r.alternatives?.[0]?.transcript)
      .filter(Boolean)
      .join(" ") ?? "";

  const confidence = data.results?.[0]?.alternatives?.[0]?.confidence;

  // Estimate audio duration (rough: base64 size / bitrate)
  const estimatedSeconds = Math.ceil(audioBuffer.byteLength / 32000);

  return {
    result: {
      text: transcript,
      confidence,
    },
    metrics: {
      inputUnits: estimatedSeconds,
      outputUnits: transcript.length,
      unitType: "seconds",
      durationMs,
    },
  };
}

function detectEncoding(
  url: string
): "LINEAR16" | "FLAC" | "MP3" | "OGG_OPUS" | "WEBM_OPUS" {
  const lower = url.toLowerCase();
  if (lower.includes(".mp3") || lower.includes("audio/mpeg")) return "MP3";
  if (lower.includes(".flac")) return "FLAC";
  if (lower.includes(".ogg")) return "OGG_OPUS";
  if (lower.includes(".webm")) return "WEBM_OPUS";
  return "LINEAR16";
}

interface GoogleSTTResponse {
  results?: Array<{
    alternatives?: Array<{
      transcript?: string;
      confidence?: number;
    }>;
  }>;
}
