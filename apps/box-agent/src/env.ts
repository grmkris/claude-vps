import "dotenv/config";
import { env as bunEnv } from "bun";
import { z } from "zod";

export const env = z
  .object({
    BOX_AGENT_SECRET: z.string().min(32),
    BOX_API_URL: z.string().url(), // Server URL for box API (e.g., http://server:33000/box)
    BOX_API_TOKEN: z.string().min(1), // Per-box auth token
    BOX_SUBDOMAIN: z.string().min(1),
    BOX_AGENT_PORT: z.coerce.number().default(33002),
    BOX_INBOX_DIR: z.string().default("/home/sprite/.inbox"),
    BOX_DB_PATH: z.string().default("/home/sprite/.box-agent/sessions.db"),
  })
  .parse(bunEnv);
