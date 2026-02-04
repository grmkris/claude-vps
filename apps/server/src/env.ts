import "dotenv/config";
import { getBoxAgentBinaryUrl } from "@vps-claude/shared";
import { env as bunEnv } from "bun";
import { z } from "zod";

export const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    REDIS_URL: z.string().min(1),
    SPRITES_TOKEN: z.string().min(1),
    INBOUND_EMAIL_API_KEY: z.string().min(1),
    INBOUND_WEBHOOK_SECRET: z.string().min(1).optional(),
    APP_ENV: z.enum(["dev", "prod", "local"]).default("dev"),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),
    BOX_AGENT_BINARY_URL: z.string().url().optional(),
    // Override API URL for sprite callbacks (useful for ngrok testing)
    SERVER_URL: z.string().url().optional(),
    // AI Provider API Keys (optional - service gracefully degrades if missing)
    FAL_API_KEY: z.string().optional(),
    ELEVENLABS_API_KEY: z.string().optional(),
    GOOGLE_CLOUD_API_KEY: z.string().optional(),
    REPLICATE_API_TOKEN: z.string().optional(),
  })
  .parse(bunEnv);

// Box-agent binary URL (auto-detects architecture)
export const BOX_AGENT_BINARY_URL = getBoxAgentBinaryUrl(
  env.BOX_AGENT_BINARY_URL
);
