import { z } from "zod";

const envSchema = z.object({
  API_URL: z.string().url().default("http://localhost:33000"),
  INTERNAL_API_KEY: z.string().min(32),
  WORKDIR: z.string().default("/etc/sshpiper/workingdir"),
  SYNC_INTERVAL_MS: z.coerce.number().default(30_000),
});

export const env = envSchema.parse(Bun.env);
