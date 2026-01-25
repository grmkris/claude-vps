/**
 * Shared types for AI provider adapters
 */

export interface ImageGenerationInput {
  prompt: string;
  width?: number;
  height?: number;
  negativePrompt?: string;
}

export interface ImageGenerationOutput {
  url: string;
  width: number;
  height: number;
}

export interface TextToSpeechInput {
  text: string;
  voice?: string;
  modelId?: string;
}

export interface TextToSpeechOutput {
  audioUrl: string;
  durationSeconds?: number;
}

export interface SpeechToTextInput {
  audioUrl: string;
  language?: string;
}

export interface SpeechToTextOutput {
  text: string;
  confidence?: number;
}

export interface UsageMetrics {
  inputUnits?: number;
  outputUnits?: number;
  unitType?: "characters" | "seconds" | "megapixels" | "tokens";
  durationMs: number;
}
