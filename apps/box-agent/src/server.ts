import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
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

const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
});

const app = new Hono();

// Health endpoints - direct Hono routes (same pattern as main server)
app.get("/", (c) => c.text("OK"));
app.get("/health", (c) => c.json({ status: "ok", agent: "box-agent" }));

// ORPC handler for API routes
app.all("/*", async (c) => {
  const context = {
    boxSecretHeader: c.req.header("X-Box-Secret"),
  };

  const result = await apiHandler.handle(c.req.raw, {
    prefix: "/rpc",
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
