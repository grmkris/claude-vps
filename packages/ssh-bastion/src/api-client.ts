import type { AppRouterClient } from "@vps-claude/api/routers/index";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { env } from "./env";

export interface BoxInfo {
  subdomain: string;
  containerName: string;
}

const link = new RPCLink({
  url: `${env.API_URL}/rpc`,
  headers: () => ({
    Authorization: `Bearer ${env.INTERNAL_API_KEY}`,
  }),
});

const client: AppRouterClient = createORPCClient(link);

export async function fetchRunningBoxes(): Promise<BoxInfo[]> {
  const result = await client.platform.ssh.boxes();
  return result.boxes;
}
