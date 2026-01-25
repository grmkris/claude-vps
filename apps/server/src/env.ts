import "dotenv/config";
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
    BOX_AGENT_BINARY_URL: z.string().url().optional(),
    // AI Provider API Keys (optional - service gracefully degrades if missing)
    FAL_API_KEY: z.string().optional(),
    ELEVENLABS_API_KEY: z.string().optional(),
    GOOGLE_CLOUD_API_KEY: z.string().optional(),
    REPLICATE_API_TOKEN: z.string().optional(),
  })
  .parse(bunEnv);

// Default box-agent binary URL (GitHub releases)
export const BOX_AGENT_BINARY_URL =
  env.BOX_AGENT_BINARY_URL ||
  "https://github.com/grmkris/claude-vps/releases/latest/download/box-agent-linux-x64";
