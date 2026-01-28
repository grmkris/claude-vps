import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { Hono } from "hono";

import { env } from "./env";
import { logger } from "./logger";
import { cronRouter } from "./routers/cron.router";
import { emailRouter } from "./routers/email.router";
import { healthRouter } from "./routers/health.router";
import { sessionRouter } from "./routers/session.router";

const appRouter = {
  ...healthRouter,
  cron: cronRouter,
  email: emailRouter,
  session: sessionRouter,
};

const apiHandler = new OpenAPIHandler(appRouter, {});

const app = new Hono();

app.all("/*", async (c) => {
  const context = {
    boxSecretHeader: c.req.header("X-Box-Secret"),
  };

  const result = await apiHandler.handle(c.req.raw, {
    prefix: "/",
    context,
  });

  if (result.matched) {
    return c.newResponse(result.response.body, result.response);
  }

  return c.text("Not Found", 404);
});

logger.info(`Box agent starting on port ${env.BOX_AGENT_PORT}...`);

export default {
  port: env.BOX_AGENT_PORT,
  fetch: app.fetch,
};
