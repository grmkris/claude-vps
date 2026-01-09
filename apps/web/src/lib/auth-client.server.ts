import "server-only";

import { createAuthServerClient } from "@vps-claude/auth/client/server";
import { SERVICE_URLS } from "@vps-claude/shared/services.schema";
import { headers } from "next/headers";
import { cache } from "react";

import { env } from "@/env";

export const authServerClient = createAuthServerClient({
  baseURL: SERVICE_URLS[env.NEXT_PUBLIC_ENV].apiInternal,
});

export const getSession = cache(async () => {
  const h = await headers();
  const result = await authServerClient.getSession({
    fetchOptions: {
      headers: h,
      baseURL: SERVICE_URLS[env.NEXT_PUBLIC_ENV].apiInternal,
    },
  });
  return result.data;
});
