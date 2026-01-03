import { createAuthWebClient } from "@vps-claude/auth/client";
import { env } from "@vps-claude/env/web";

export const authClient = createAuthWebClient({
  baseURL: env.NEXT_PUBLIC_SERVER_URL,
});
