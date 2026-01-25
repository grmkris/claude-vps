import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { apiKeyRouter } from "./api-key.router";
import { boxAiRouter } from "./box-ai.router";
import { boxApiRouter } from "./box-api.router";
import { boxFsRouter } from "./box-fs.router";
import { boxRouter } from "./box.router";
import { HealthCheckOutput, PrivateDataOutput } from "./schemas";
import { secretRouter } from "./secret.router";
import { skillRouter } from "./skill.router";

// Main app router for /rpc/* endpoints (user session auth)
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
  // skill: skillRouter,  // Moved to fullAppRouter
  // apiKey: apiKeyRouter, // Moved to fullAppRouter
  box: boxRouter,
};

// Exported separately to avoid TS7056 type explosion when combined
export { boxApiRouter, boxAiRouter, apiKeyRouter, skillRouter, boxFsRouter };

export type AppRouter = typeof appRouter;
export type ApiKeyRouterType = typeof apiKeyRouter;
export type SkillRouterType = typeof skillRouter;
export type BoxFsRouterType = typeof boxFsRouter;

// Combined client type for SDK - includes all routers
export type AppRouterClient = RouterClient<AppRouter> & {
  apiKey: RouterClient<ApiKeyRouterType>;
  skill: RouterClient<SkillRouterType>;
  boxFs: RouterClient<BoxFsRouterType>;
};
