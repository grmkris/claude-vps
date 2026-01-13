import type { Auth } from "@vps-claude/auth";
import type { Database } from "@vps-claude/db";
import type { Logger } from "@vps-claude/logger";

import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createContext, type Services } from "./context";
import { appRouter } from "./routers/index";

type HonoVariables = {
  requestId: string;
};

export interface CreateApiOptions {
  db: Database;
  logger: Logger;
  services: Services;
  auth: Auth;
  corsOrigin: string;
  agentsDomain: string;
  internalApiKey: string;
  inboundWebhookSecret?: string;
}

export function createApi({
  logger,
  services,
  auth,
  corsOrigin,
  agentsDomain,
  internalApiKey,
  inboundWebhookSecret,
}: CreateApiOptions) {
  const app = new Hono<{ Variables: HonoVariables }>();

  app.use(async (c, next) => {
    const requestId = crypto.randomUUID().slice(0, 8);
    const start = performance.now();

    c.set("requestId", requestId);

    await next();

    const duration = Math.round(performance.now() - start);
    const path = c.req.path;

    if (path === "/" || path === "/health") {
      return;
    }

    logger.info({
      requestId,
      method: c.req.method,
      path,
      status: c.res.status,
      durationMs: duration,
    });
  });

  app.use(
    "/*",
    cors({
      origin: corsOrigin,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    })
  );

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? "unknown";

    logger.error({
      msg: "Server error",
      requestId,
      error: err,
      path: c.req.path,
      method: c.req.method,
    });

    return c.json({ error: "Internal Server Error", requestId }, 500);
  });

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.get("/", (c) => c.text("OK"));
  app.get("/health", (c) => c.text("OK"));

  app.post("/webhooks/inbound-email", async (c) => {
    if (inboundWebhookSecret) {
      const token = c.req.header("X-Webhook-Verification-Token");
      if (token !== inboundWebhookSecret) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    }

    const body = await c.req.json();
    const emailData = body.email || body;
    const toAddress = emailData.to as string;

    if (!toAddress) {
      return c.json({ error: "Missing to address" }, 400);
    }

    const match = toAddress.match(
      new RegExp(`^[^@]+@([^.]+)\\.${agentsDomain.replace(".", "\\.")}$`, "i")
    );

    if (!match) {
      return c.json({ message: "Unknown recipient" }, 200);
    }

    const subdomain = match[1];
    if (!subdomain) {
      return c.json({ message: "Invalid recipient format" }, 200);
    }
    const result = await services.emailService.processInbound(subdomain, {
      messageId:
        emailData.messageId || emailData.message_id || crypto.randomUUID(),
      from: {
        email:
          typeof emailData.from === "string"
            ? emailData.from
            : emailData.from?.email || emailData.from_email,
        name:
          typeof emailData.from === "object" ? emailData.from?.name : undefined,
      },
      to: toAddress,
      subject: emailData.subject,
      textBody: emailData.text || emailData.text_body,
      htmlBody: emailData.html || emailData.html_body,
      rawEmail: emailData.raw,
    });

    if (result.isErr()) {
      return c.json({ message: result.error.message }, 200);
    }

    return c.json({ success: true, emailId: result.value.id });
  });

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
    const config = { agentsDomain, internalApiKey };
    const context = await createContext({ context: c, services, auth, config });

    const rpcResult = await rpcHandler.handle(c.req.raw, {
      prefix: "/rpc",
      context,
    });

    if (rpcResult.matched) {
      // biome-ignore lint/suspicious/noExplicitAny: ReadableStream type mismatch between node and web
      return new Response(rpcResult.response.body as any, rpcResult.response);
    }

    // Handle platform routes (ssh-bastion, INTERNAL_API_KEY auth)
    // Handle box routes (box-agent, per-box token auth)
    if (c.req.path.startsWith("/platform/") || c.req.path.startsWith("/box/")) {
      const apiResult = await apiHandler.handle(c.req.raw, {
        prefix: "/",
        context,
      });

      if (apiResult.matched) {
        // biome-ignore lint/suspicious/noExplicitAny: ReadableStream type mismatch between node and web
        return new Response(apiResult.response.body as any, apiResult.response);
      }
    }

    const apiResult = await apiHandler.handle(c.req.raw, {
      prefix: "/api-reference",
      context,
    });

    if (apiResult.matched) {
      // biome-ignore lint/suspicious/noExplicitAny: ReadableStream type mismatch between node and web
      return new Response(apiResult.response.body as any, apiResult.response);
    }

    await next();
  });

  return { app };
}
