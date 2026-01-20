import type { AppRouterClient } from "@vps-claude/api/routers/index";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

export type SDKConfig = {
  baseUrl: string;
  apiKey?: string;
  sessionToken?: string;
  fetch?: typeof fetch;
};

export function createClient(config: SDKConfig): AppRouterClient {
  const link = new RPCLink({
    url: `${config.baseUrl}/rpc`,
    headers: () => {
      const headers: Record<string, string> = {};

      if (config.apiKey) {
        headers["x-api-key"] = config.apiKey;
      }

      if (config.sessionToken) {
        headers.Cookie = `better-auth.session_token=${config.sessionToken}`;
      }

      return headers;
    },
    fetch: config.fetch ?? globalThis.fetch,
  });

  return createORPCClient(link);
}
