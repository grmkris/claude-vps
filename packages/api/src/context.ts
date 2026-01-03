import type { Auth } from "@vps-claude/auth";
import type { Context as HonoContext } from "hono";

import type { BoxService } from "./services/box.service";

export interface Services {
  boxService: BoxService;
}

export interface ApiConfig {
  agentsDomain: string;
}

export type CreateContextOptions = {
  context: HonoContext;
  services: Services;
  auth: Auth;
  config: ApiConfig;
};

export async function createContext({
  context,
  services,
  auth,
  config,
}: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    session,
    config,
    ...services,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
