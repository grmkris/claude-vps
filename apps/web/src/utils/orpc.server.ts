import "server-only";
import type { AppRouterClient } from "@vps-claude/api/routers/index";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { SERVICE_URLS } from "@vps-claude/shared/services.schema";
import { headers } from "next/headers";

import { env } from "@/env";

const serverLink = new RPCLink({
  url: `${SERVICE_URLS[env.NEXT_PUBLIC_ENV].apiInternal}/rpc`,
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
  headers: async () => Object.fromEntries(await headers()),
});

export const serverClient: AppRouterClient = createORPCClient(serverLink);
export const serverOrpc = createTanstackQueryUtils(serverClient);
