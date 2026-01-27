import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { apiKeyRouter } from "./api-key.router";
import { boxAiRouter } from "./box-ai.router";
import { boxApiRouter } from "./box-api.router";
import { boxDetailsRouter } from "./box-details.router";
import { boxEnvVarRouter } from "./box-env-var.router";
import { boxFsRouter } from "./box-fs.router";
import { boxRouter } from "./box.router";
import { cronjobRouter } from "./cronjob.router";
import { HealthCheckOutput, PrivateDataOutput } from "./schemas";
import { secretRouter } from "./secret.router";
import { skillRouter } from "./skill.router";

// Minimal app router - only inline procedures to avoid TS7056
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
};

// All routers exported separately to avoid TS7056 type explosion
export {
  boxRouter,
  secretRouter,
  boxApiRouter,
  boxAiRouter,
  boxDetailsRouter,
  boxEnvVarRouter,
  apiKeyRouter,
  skillRouter,
  boxFsRouter,
  cronjobRouter,
};

// Individual router types for SDK client composition
export type AppRouter = typeof appRouter;
export type BoxRouterType = typeof boxRouter;
export type SecretRouterType = typeof secretRouter;
export type BoxEnvVarRouterType = typeof boxEnvVarRouter;
export type ApiKeyRouterType = typeof apiKeyRouter;
export type SkillRouterType = typeof skillRouter;
export type BoxFsRouterType = typeof boxFsRouter;
export type BoxDetailsRouterType = typeof boxDetailsRouter;
export type CronjobRouterType = typeof cronjobRouter;

// Combined client type for SDK - includes all routers
export type AppRouterClient = RouterClient<AppRouter> & {
  box: RouterClient<BoxRouterType>;
  secret: RouterClient<SecretRouterType>;
  boxEnvVar: RouterClient<BoxEnvVarRouterType>;
  apiKey: RouterClient<ApiKeyRouterType>;
  skill: RouterClient<SkillRouterType>;
  boxFs: RouterClient<BoxFsRouterType>;
  boxDetails: RouterClient<BoxDetailsRouterType>;
  cronjob: RouterClient<CronjobRouterType>;
};
