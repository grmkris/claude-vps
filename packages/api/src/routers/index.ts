import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { apiKeyRouter } from "./api-key.router";
import { boxAiRouter } from "./box-ai.router";
import { boxApiRouter } from "./box-api.router";
import { boxDetailsRouter } from "./box-details.router";
import { boxFsRouter } from "./box-fs.router";
import { boxRouter } from "./box.router";
import { credentialRouter } from "./credential.router";
import { cronjobRouter } from "./cronjob.router";
import { HealthCheckOutput, PrivateDataOutput } from "./schemas";
import { secretRouter } from "./secret.router";
import { skillRouter } from "./skill.router";

// Main app router for /rpc/* endpoints (user session auth)
// @ts-expect-error TS7056: Type serialization limit exceeded, but types work correctly at runtime
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
};

// Exported separately to avoid TS7056 type explosion when combined
export {
  boxApiRouter,
  boxAiRouter,
  boxDetailsRouter,
  apiKeyRouter,
  skillRouter,
  boxFsRouter,
  cronjobRouter,
  credentialRouter,
};
export type AppRouter = typeof appRouter;
export type ApiKeyRouterType = typeof apiKeyRouter;
export type SkillRouterType = typeof skillRouter;
export type BoxFsRouterType = typeof boxFsRouter;
export type BoxDetailsRouterType = typeof boxDetailsRouter;
export type CronjobRouterType = typeof cronjobRouter;
export type CredentialRouterType = typeof credentialRouter;

// Combined client type for SDK - includes all routers
export type AppRouterClient = RouterClient<AppRouter> & {
  apiKey: RouterClient<ApiKeyRouterType>;
  skill: RouterClient<SkillRouterType>;
  boxFs: RouterClient<BoxFsRouterType>;
  boxDetails: RouterClient<BoxDetailsRouterType>;
  cronjob: RouterClient<CronjobRouterType>;
  credential: RouterClient<CredentialRouterType>;
};
