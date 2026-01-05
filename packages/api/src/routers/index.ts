import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { boxApiRouter } from "./box-api.router";
import { boxRouter } from "./box.router";
import { platformRouter } from "./platform.router";
import { secretRouter } from "./secret.router";
import { skillRouter } from "./skill.router";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),

  // Level 1: User routers (web app, session auth)
  box: boxRouter,
  secret: secretRouter,
  skill: skillRouter,

  // Level 2: Platform routers (ssh-bastion, INTERNAL_API_KEY)
  platform: platformRouter,

  // Level 3: Box routers (box-agent, per-box token)
  boxApi: boxApiRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
