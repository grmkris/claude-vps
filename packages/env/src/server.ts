import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    REDIS_URL: z.string().min(1),
    COOLIFY_API_URL: z.url(),
    COOLIFY_API_TOKEN: z.string().min(1),
    COOLIFY_PROJECT_UUID: z.string().min(1),
    COOLIFY_SERVER_UUID: z.string().min(1),
    COOLIFY_ENVIRONMENT_NAME: z.string().min(1),
    AGENTS_DOMAIN: z.string().min(1),
    AGENT_REPO_URL: z.url(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
