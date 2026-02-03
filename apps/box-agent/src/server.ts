import type { WideEvent } from "@vps-claude/logger";

import { StreamableHTTPTransport } from "@hono/mcp";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { wideEventMiddleware } from "@vps-claude/logger";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { env } from "./env";
import { logger } from "./logger";
import { createMcpServer } from "./mcp";
import { cronRouter } from "./routers/cron.router";
import { emailRouter } from "./routers/email.router";
import { sessionRouter } from "./routers/session.router";
import { streamWithSession } from "./utils/agent";

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

// Static landing page at root (for path-based routing)
app.get("/", (c) => {
  const subdomain = env.BOX_SUBDOMAIN;
  const instanceName = env.INSTANCE_NAME || "container";
  return c.html(`<!DOCTYPE html>
<html>
<head>
  <title>Box: ${subdomain}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; color: #333; }
    h1 { border-bottom: 1px solid #ddd; padding-bottom: 0.5rem; }
    nav { display: flex; gap: 1rem; margin: 1rem 0; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 14px; }
    section { margin: 1.5rem 0; }
    h2 { font-size: 1.1rem; color: #555; }
  </style>
</head>
<body>
  <h1>Box: ${subdomain}</h1>
  <nav>
    <a href="/app">App Dashboard</a>
    <a href="/box/health">Health Check</a>
    <a href="/box/docs">API Docs</a>
  </nav>
  <section>
    <h2>Docker Access</h2>
    <pre>docker exec -it ${instanceName} bash</pre>
  </section>
</body>
</html>`);
});

// SSE streaming endpoint for Claude sessions (before ORPC handler since ORPC doesn't support SSE)
app.post("/rpc/sessions/stream", async (c) => {
  // Auth check
  const boxSecret = c.req.header("X-Box-Secret");
  if (boxSecret !== env.BOX_AGENT_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = (await c.req.json()) as {
    message: string;
    contextType?: string;
    contextId?: string;
  };

  if (!body.message) {
    return c.json({ error: "message is required" }, 400);
  }

  const contextId = body.contextId ?? `chat-${Date.now()}`;

  logger.info(
    `[stream] Starting streaming session: ${body.contextType ?? "chat"}:${contextId}`
  );

  return streamSSE(c, async (stream) => {
    try {
      for await (const msg of streamWithSession({
        prompt: body.message,
        contextType: body.contextType ?? "chat",
        contextId,
        triggerType: "manual",
      })) {
        await stream.writeSSE({
          event: msg.type,
          data: JSON.stringify(msg),
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error({ err: error }, "[stream] Session streaming error");
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: errorMessage }),
      });
    }
  });
});

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
