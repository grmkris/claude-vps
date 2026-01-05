import { ORPCError, os } from "@orpc/server";
import { UserId } from "@vps-claude/shared";

import type { Context } from "./context";

export { createApi } from "./create-api";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }

  // let's parse userid, and orgId to typeId
  const userId = UserId.parse(context.session?.user.id);
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
