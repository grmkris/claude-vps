import { ORPCError, os } from "@orpc/server";
import { UserId } from "@vps-claude/shared";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }

  const userId = UserId.parse(context.session.user.id);
  const typedSession = {
    ...context.session,
    user: {
      ...context.session.user,
      id: userId,
    },
  };

  return next({ context: { session: typedSession } });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

/**
 * Middleware for box-agent requests authenticated via X-Box-Secret header.
 */
const requireBoxAuth = o.middleware(async ({ context, next }) => {
  if (!context.boxToken) {
    throw new ORPCError("UNAUTHORIZED", { message: "Missing box token" });
  }
  return next({ context });
});

export const boxProcedure = publicProcedure.use(requireBoxAuth);
