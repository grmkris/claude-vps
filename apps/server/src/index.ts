import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createContext, type Services } from "@vps-claude/api/context";
import { appRouter } from "@vps-claude/api/routers/index";
import { createEnvironmentService } from "@vps-claude/api/services/environment.service";
import { createTerminalHandler } from "@vps-claude/api/terminal/terminal-handler";
import {
  createDeployWorker,
  createDeleteWorker,
} from "@vps-claude/api/workers/deploy-environment.worker";
import { auth } from "@vps-claude/auth";
import { db } from "@vps-claude/db/client";
import { env } from "@vps-claude/env/server";
import { createLogger } from "@vps-claude/logger";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";

const logger = createLogger({ appName: "vps-claude-server" });

const environmentService = createEnvironmentService({ deps: { db } });

const services: Services = {
  environmentService,
};

createDeployWorker({ deps: { environmentService, logger } });
createDeleteWorker({ deps: { environmentService, logger } });

const terminalHandler = createTerminalHandler({
  environmentService,
  logger,
  getContainerWsUrl: (subdomain) => `wss://${subdomain}.${env.AGENTS_DOMAIN}/ws`,
});

export interface TerminalSessionData {
  envId: string;
  userId: string;
}

const app = new Hono();

app.use(honoLogger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      logger.error({ msg: "API error", error });
    }),
  ],
});

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      logger.error({ msg: "RPC error", error });
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c, services });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

logger.info({ msg: "Server started", port: 3000 });

const server = Bun.serve<TerminalSessionData>({
  port: 3000,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws/terminal") {
      const envId = url.searchParams.get("envId");
      if (!envId) {
        return new Response("Missing envId", { status: 400 });
      }

      const session = await auth.api.getSession({ headers: req.headers });
      if (!session?.user?.id) {
        return new Response("Unauthorized", { status: 401 });
      }

      const upgraded = server.upgrade(req, {
        data: { envId, userId: session.user.id },
      });

      if (upgraded) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      terminalHandler.open(ws);
    },
    message(ws, message) {
      terminalHandler.message(ws, message);
    },
    close(ws) {
      terminalHandler.close(ws);
    },
  },
});

export default server;
