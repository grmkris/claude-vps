import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { apiKeyRouter } from "./api-key.router";
import { boxAgentConfigRouter } from "./box-agent-config.router";
import { boxAiRouter } from "./box-ai.router";
import { boxApiRouter } from "./box-api.router";
import { boxDetailsRouter } from "./box-details.router";
import { boxEnvVarRouter } from "./box-env-var.router";
import { boxFsRouter } from "./box-fs.router";
import { boxRouter } from "./box.router";
import { credentialRouter } from "./credential.router";
import { cronjobRouter } from "./cronjob.router";
import { HealthCheckOutput, PrivateDataOutput } from "./schemas";
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
  credentialRouter,
  boxApiRouter,
  boxAiRouter,
  boxDetailsRouter,
  boxEnvVarRouter,
  boxAgentConfigRouter,
  apiKeyRouter,
  skillRouter,
  boxFsRouter,
  cronjobRouter,
};

// Individual router types for SDK client composition
export type AppRouter = typeof appRouter;
export type BoxRouterType = typeof boxRouter;
export type CredentialRouterType = typeof credentialRouter;
export type BoxEnvVarRouterType = typeof boxEnvVarRouter;
export type BoxAgentConfigRouterType = typeof boxAgentConfigRouter;
export type ApiKeyRouterType = typeof apiKeyRouter;
export type SkillRouterType = typeof skillRouter;
export type BoxFsRouterType = typeof boxFsRouter;
export type BoxDetailsRouterType = typeof boxDetailsRouter;
export type CronjobRouterType = typeof cronjobRouter;

// Combined client type for SDK - includes all routers
export type AppRouterClient = RouterClient<AppRouter> & {
  box: RouterClient<BoxRouterType>;
  credential: RouterClient<CredentialRouterType>;
  boxEnvVar: RouterClient<BoxEnvVarRouterType>;
  boxAgentConfig: RouterClient<BoxAgentConfigRouterType>;
  apiKey: RouterClient<ApiKeyRouterType>;
  skill: RouterClient<SkillRouterType>;
  boxFs: RouterClient<BoxFsRouterType>;
  boxDetails: RouterClient<BoxDetailsRouterType>;
  cronjob: RouterClient<CronjobRouterType>;
};
