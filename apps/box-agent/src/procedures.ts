import { ORPCError, os } from "@orpc/server";

import { env } from "./env";

export interface BoxAgentContext {
  boxSecretHeader: string | undefined;
}

export const o = os.$context<BoxAgentContext>();

export const publicProcedure = o;

const requireBoxSecret = o.middleware(async ({ context, next }) => {
  if (context.boxSecretHeader !== env.BOX_AGENT_SECRET) {
    throw new ORPCError("UNAUTHORIZED");
  }

  return next({ context });
});

export const protectedProcedure = publicProcedure.use(requireBoxSecret);
