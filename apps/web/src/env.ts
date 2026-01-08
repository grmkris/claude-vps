import { createEnv } from "@t3-oss/env-nextjs";
import { Environment } from "@vps-claude/shared/services.schema";

export const env = createEnv({
  client: {
    NEXT_PUBLIC_ENV: Environment,
  },
  runtimeEnv: {
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
  },
  emptyStringAsUndefined: true,
});
