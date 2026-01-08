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
    COOLIFY_API_TOKEN: z.string().min(1),
    COOLIFY_PROJECT_UUID: z.string().min(1),
    COOLIFY_SERVER_UUID: z.string().min(1),
    COOLIFY_ENVIRONMENT_NAME: z.string().min(1),
    COOLIFY_ENVIRONMENT_UUID: z.string().min(1),
    INBOUND_EMAIL_API_KEY: z.string().min(1),
    INBOUND_WEBHOOK_SECRET: z.string().min(1).optional(),
    INTERNAL_API_KEY: z.string().min(32),
    APP_ENV: z.enum(["dev", "prod"]).default("dev"),
  })
  .parse(bunEnv);
