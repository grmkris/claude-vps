import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { apiKeyRouter } from "./api-key.router";
import { boxApiRouter } from "./box-api.router";
import { boxRouter } from "./box.router";
import { HealthCheckOutput, PrivateDataOutput } from "./schemas";
import { secretRouter } from "./secret.router";
import { skillRouter } from "./skill.router";

export const appRouter = {
  healthCheck: publicProcedure.output(HealthCheckOutput).handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure
    .output(PrivateDataOutput)
    .handler(({ context }) => {
      return {
        message: "This is private",
        user: context.session?.user,
      };
    }),
  secret: secretRouter,
  box: boxRouter,
  boxApi: boxApiRouter,
  apiKey: apiKeyRouter,
  skill: skillRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<AppRouter>;
