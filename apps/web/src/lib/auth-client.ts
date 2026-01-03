import { createAuthWebClient } from "@vps-claude/auth/client";

import { env } from "@/env";

export const authClient = createAuthWebClient({
  baseURL: env.NEXT_PUBLIC_SERVER_URL,
});
