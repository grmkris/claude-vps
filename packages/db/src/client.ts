import { env } from "@vps-claude/env/server";

import { createDb } from "./index";

export const db = createDb({
  type: "node-postgres",
  connectionString: env.DATABASE_URL,
});
