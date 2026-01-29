import type { WideEvent } from "@vps-claude/logger";

import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { wideEventMiddleware } from "@vps-claude/logger";
import { Hono } from "hono";

import { env } from "./env";
import { logger } from "./logger";
import { cronRouter } from "./routers/cron.router";
import { emailRouter } from "./routers/email.router";
import { sessionRouter } from "./routers/session.router";

const appRouter = {
  cron: cronRouter,
  email: emailRouter,
  session: sessionRouter,
};

const apiHandler = new OpenAPIHandler(appRouter, {});

type HonoVariables = {
  requestId: string;
  wideEvent: WideEvent;
};

const app = new Hono<{ Variables: HonoVariables }>();

// Wide event middleware for structured logging
app.use(
  wideEventMiddleware({
    logger,
    skipPaths: ["/", "/health"],
    serviceName: "box-agent",
  })
);

// Health endpoints - direct Hono routes (same pattern as main server)
app.get("/", (c) => c.text("OK"));
app.get("/health", (c) => c.json({ status: "ok", agent: "box-agent" }));

// ORPC handler for API routes
app.all("/*", async (c) => {
  const context = {
    boxSecretHeader: c.req.header("X-Box-Secret"),
    wideEvent: c.get("wideEvent"),
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
