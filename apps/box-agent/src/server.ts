import type { WideEvent } from "@vps-claude/logger";

import { StreamableHTTPTransport } from "@hono/mcp";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { wideEventMiddleware } from "@vps-claude/logger";
import { Hono } from "hono";

import { env } from "./env";
import { logger } from "./logger";
import { createMcpServer } from "./mcp";
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

// MCP server for HTTP transport (inspector, remote access)
const mcpServer = createMcpServer();
const mcpTransport = new StreamableHTTPTransport();

// MCP endpoint - must be before other routes
app.all("/mcp", async (c) => {
  if (!mcpServer.isConnected()) {
    await mcpServer.connect(mcpTransport);
  }
  return mcpTransport.handleRequest(c);
});

// Health endpoint
app.get("/health", (c) => c.json({ status: "ok", agent: "box-agent" }));

// ORPC handler for API routes at /rpc
app.all("/rpc/*", async (c) => {
  const context = {
    boxSecretHeader: c.req.header("X-Box-Secret"),
    wideEvent: c.get("wideEvent"),
  };
  const result = await apiHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context,
  });
  if (result.matched) {
    return c.newResponse(
      result.response.body as Parameters<typeof c.newResponse>[0],
      result.response
    );
  }
  return c.text("Not Found", 404);
});

// Scalar docs at root (catch-all)
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
    return c.newResponse(
      result.response.body as Parameters<typeof c.newResponse>[0],
      result.response
    );
  }
  return c.text("Not Found", 404);
});

logger.info(`Box agent starting on port ${env.BOX_AGENT_PORT}...`);

export default {
  port: env.BOX_AGENT_PORT,
  fetch: app.fetch,
};
