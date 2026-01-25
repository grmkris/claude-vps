/**
 * AI Provider Adapters
 *
 * Each adapter exposes capability-specific functions that:
 * 1. Take API key and input parameters
 * 2. Call the provider's API
 * 3. Return standardized output with usage metrics
 */

export * from "./types";

export * as falProvider from "./fal";
export * as elevenlabsProvider from "./elevenlabs";
export * as googleProvider from "./google";
export * as replicateProvider from "./replicate";
