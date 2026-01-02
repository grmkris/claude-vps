import type { Context as HonoContext } from "hono";

import { auth } from "@vps-claude/auth";

import type { EnvironmentService } from "./services/environment.service";

export interface Services {
  environmentService: EnvironmentService;
}

export type CreateContextOptions = {
  context: HonoContext;
  services: Services;
};

export async function createContext({ context, services }: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    session,
    ...services,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
