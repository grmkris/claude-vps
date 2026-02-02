import type { Auth } from "@vps-claude/auth";
import type { Database } from "@vps-claude/db";
import type { Logger, WideEvent } from "@vps-claude/logger";

import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { wideEventMiddleware } from "@vps-claude/logger";
import { BoxId, UserId } from "@vps-claude/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";

import { createContext, type Services } from "./context";
import {
  appRouter,
  boxRouter,
  boxEnvVarRouter,
  boxAgentConfigRouter,
  credentialRouter,
  boxAiRouter,
  boxApiRouter,
  boxDetailsRouter,
  boxSessionsRouter,
  boxFsRouter,
  apiKeyRouter,
  skillRouter,
  mcpRouter,
  cronjobRouter,
} from "./routers/index";

// Combined router for handlers - includes all routes
// (Type not exported to avoid TS7056)
const fullAppRouter = {
  ...appRouter,
  box: boxRouter,
  boxEnvVar: boxEnvVarRouter,
  boxAgentConfig: boxAgentConfigRouter,
  credential: credentialRouter,
  apiKey: apiKeyRouter,
  skill: skillRouter,
  mcp: mcpRouter,
  boxFs: boxFsRouter,
  boxDetails: boxDetailsRouter,
  boxSessions: boxSessionsRouter,
  cronjob: cronjobRouter,
};

type HonoVariables = {
  requestId: string;
  wideEvent: WideEvent;
};

export interface CreateApiOptions {
  db: Database;
  logger: Logger;
  services: Services;
  auth: Auth;
  corsOrigin: string;
  agentsDomain: string;
  inboundWebhookSecret?: string;
}

export function createApi({
  logger,
  services,
  auth,
  corsOrigin,
  agentsDomain,
  inboundWebhookSecret,
}: CreateApiOptions) {
  const app = new Hono<{ Variables: HonoVariables }>();

  app.use(
    wideEventMiddleware({
      logger,
      skipPaths: ["/", "/health"],
    })
  );

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
  app.get("/health", (c) => c.text("OK"));

  // SSE streaming endpoint for Claude sessions (before ORPC handler)
  app.post("/rpc/box/:id/sessions/stream", async (c) => {
    const wideEvent = c.get("wideEvent");
    wideEvent?.set({ op: "box.sessions.stream" });

    // Get user session
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session?.user?.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const userId = UserId.parse(session.user.id);
    const boxId = BoxId.parse(c.req.param("id"));

    wideEvent?.set({ boxId, user: { id: userId } });

    // Get box and verify ownership
    const boxResult = await services.boxService.getById(boxId);
    if (boxResult.isErr()) {
      return c.json({ error: boxResult.error.message }, 500);
    }

    const box = boxResult.value;
    if (!box || box.userId !== userId) {
      return c.json({ error: "Box not found" }, 404);
    }

    if (box.status !== "running" || !box.instanceUrl) {
      return c.json({ error: "Box not running" }, 400);
    }

    // Get agent secret for auth
    const settingsResult =
      await services.emailService.getOrCreateSettings(boxId);
    if (settingsResult.isErr()) {
      return c.json({ error: "Failed to get box settings" }, 500);
    }

    const body = await c.req.json();

    // Make streaming request to box-agent
    const response = await fetch(`${box.instanceUrl}/rpc/sessions/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Box-Secret": settingsResult.value.agentSecret,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return c.json(
        { error: `Box agent returned ${response.status}` },
        response.status as 400
      );
    }

    // Proxy SSE response through to client
    return streamSSE(c, async (stream) => {
      const reader = response.body?.getReader();
      if (!reader) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message: "No response body" }),
        });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEvent = "";
          let currentData = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7);
            } else if (line.startsWith("data: ")) {
              currentData = line.slice(6);
            } else if (line === "" && currentData) {
              // Empty line marks end of event
              await stream.writeSSE({
                event: currentEvent || "message",
                data: currentData,
              });
              currentEvent = "";
              currentData = "";
            }
          }
        }
      } catch (error) {
        logger.error({ err: error }, "SSE proxy error");
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            message: error instanceof Error ? error.message : "Unknown error",
          }),
        });
      } finally {
        reader.releaseLock();
      }
    });
  });

  app.post("/webhooks/inbound-email", async (c) => {
    const wideEvent = c.get("wideEvent");
    wideEvent?.set({ op: "webhook.inboundEmail" });

    if (inboundWebhookSecret) {
      const token = c.req.header("X-Webhook-Verification-Token");
      if (token !== inboundWebhookSecret) {
        wideEvent?.set({ status: "unauthorized" });
        return c.json({ error: "Unauthorized" }, 401);
      }
    }

    const body = await c.req.json();
    const emailData = body.email || body;

    // Extract to address - inbound.new uses { to: { addresses: [{address}] }, recipient }
    const toAddress =
      emailData.recipient ||
      emailData.to?.addresses?.[0]?.address ||
      (typeof emailData.to === "string" ? emailData.to : null) ||
      (Array.isArray(emailData.to) ? emailData.to[0] : null);

    if (!toAddress) {
      wideEvent?.set({ status: "missing_to_address" });
      return c.json({ error: "Missing to address" }, 400);
    }

    // Match format: subdomain@agentsDomain (e.g., claude-box-abc1@yoda.fun)
    const match = toAddress.match(
      new RegExp(`^([^@]+)@${agentsDomain.replace(".", "\\.")}$`, "i")
    );

    if (!match) {
      wideEvent?.set({ status: "unknown_recipient", toAddress });
      return c.json({ message: "Unknown recipient" }, 200);
    }

    const subdomain = match[1];
    if (!subdomain) {
      wideEvent?.set({ status: "invalid_recipient_format" });
      return c.json({ message: "Invalid recipient format" }, 200);
    }

    wideEvent?.set({ subdomain });

    // Extract from - inbound.new uses { from: { addresses: [{name, address}] } }
    const fromAddr = emailData.from?.addresses?.[0];
    const fromEmail =
      fromAddr?.address ||
      (typeof emailData.from === "string" ? emailData.from : null) ||
      emailData.from_email;
    const fromName = fromAddr?.name || emailData.from?.name;

    const result = await services.emailService.processInbound(subdomain, {
      messageId:
        emailData.messageId || emailData.message_id || crypto.randomUUID(),
      from: {
        email: fromEmail,
        name: fromName,
      },
      to: toAddress,
      subject: emailData.subject,
      textBody:
        emailData.parsedData?.textBody ||
        emailData.cleanedContent?.text ||
        emailData.text ||
        emailData.text_body,
      htmlBody:
        emailData.parsedData?.htmlBody ||
        emailData.cleanedContent?.html ||
        emailData.html ||
        emailData.html_body,
      rawEmail: emailData.parsedData?.raw || emailData.raw,
    });

    if (result.isErr()) {
      wideEvent?.set({
        status: "error",
        errorType: result.error.type,
        errorMessage: result.error.message,
      });
      return c.json({ message: result.error.message }, 200);
    }

    wideEvent?.set({ emailId: result.value.id, status: "queued" });
    return c.json({ success: true, emailId: result.value.id });
  });

  const apiHandler = new OpenAPIHandler(fullAppRouter, {
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

  // Combined box router for /box/* routes (uses box token auth, not session)
  const combinedBoxRouter = {
    ...boxApiRouter,
    ai: boxAiRouter,
  };

  const boxApiHandler = new OpenAPIHandler(combinedBoxRouter, {
    plugins: [
      new OpenAPIReferencePlugin({
        schemaConverters: [new ZodToJsonSchemaConverter()],
      }),
    ],
    interceptors: [
      onError((error) => {
        logger.error({ msg: "Box API error", error });
      }),
    ],
  });

  const rpcHandler = new RPCHandler(fullAppRouter, {
    interceptors: [
      onError((error) => {
        logger.error({ msg: "RPC error", error });
      }),
    ],
  });

  app.use("/*", async (c, next) => {
    const config = { agentsDomain };
    const context = await createContext({ context: c, services, auth, config });

    // Auto-inject user context into wide event
    if (context.session?.user) {
      c.get("wideEvent")?.set({
        user: { id: context.session.user.id },
      });
    }

    const rpcResult = await rpcHandler.handle(c.req.raw, {
      prefix: "/rpc",
      context,
    });

    if (rpcResult.matched) {
      return new Response(rpcResult.response.body, rpcResult.response);
    }

    if (c.req.path.startsWith("/box/")) {
      const boxResult = await boxApiHandler.handle(c.req.raw, {
        prefix: "/",
        context,
      });

      if (boxResult.matched) {
        return new Response(boxResult.response.body, boxResult.response);
      }
    }

    const apiResult = await apiHandler.handle(c.req.raw, {
      prefix: "/",
      context,
    });

    if (apiResult.matched) {
      return new Response(apiResult.response.body, apiResult.response);
    }

    await next();
  });

  return { app };
}
