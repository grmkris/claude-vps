import { createAuthWebClient } from "@vps-claude/auth/client";
import { SERVICE_URLS } from "@vps-claude/shared/services.schema";

import { env } from "@/env";

export const authClient = createAuthWebClient({
  baseURL: SERVICE_URLS[env.NEXT_PUBLIC_ENV].api,
});
