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
import {
  appRouter,
  boxRouter,
  boxEnvVarRouter,
  boxAgentConfigRouter,
  credentialRouter,
  boxAiRouter,
  boxApiRouter,
  boxDetailsRouter,
  boxFsRouter,
  apiKeyRouter,
  skillRouter,
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
  boxFs: boxFsRouter,
  boxDetails: boxDetailsRouter,
  cronjob: cronjobRouter,
};

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
    logger.debug({ msg: "Inbound email webhook received" });

    if (inboundWebhookSecret) {
      const token = c.req.header("X-Webhook-Verification-Token");
      if (token !== inboundWebhookSecret) {
        logger.debug({ msg: "Webhook auth failed" });
        return c.json({ error: "Unauthorized" }, 401);
      }
    }

    const body = await c.req.json();
    const emailData = body.email || body;

    logger.debug({
      msg: "Parsing email",
      hasEmailWrapper: !!body.email,
      subject: emailData.subject,
      recipient: emailData.recipient,
    });

    // Extract to address - inbound.new uses { to: { addresses: [{address}] }, recipient }
    const toAddress =
      emailData.recipient ||
      emailData.to?.addresses?.[0]?.address ||
      (typeof emailData.to === "string" ? emailData.to : null) ||
      (Array.isArray(emailData.to) ? emailData.to[0] : null);

    if (!toAddress) {
      logger.debug({ msg: "Missing to address in email payload" });
      return c.json({ error: "Missing to address" }, 400);
    }

    // Match format: subdomain@agentsDomain (e.g., claude-box-abc1@yoda.fun)
    const match = toAddress.match(
      new RegExp(`^([^@]+)@${agentsDomain.replace(".", "\\.")}$`, "i")
    );

    logger.debug({
      msg: "Regex match result",
      toAddress,
      agentsDomain,
      matched: !!match,
      subdomain: match?.[1],
    });

    if (!match) {
      return c.json({ message: "Unknown recipient" }, 200);
    }

    const subdomain = match[1];
    if (!subdomain) {
      return c.json({ message: "Invalid recipient format" }, 200);
    }
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
      logger.debug({
        msg: "processInbound failed",
        subdomain,
        error: result.error.message,
        errorType: result.error.type,
      });
      return c.json({ message: result.error.message }, 200);
    }

    logger.debug({
      msg: "Email processed",
      subdomain,
      emailId: result.value.id,
    });
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
      prefix: "/api-reference",
      context,
    });

    if (apiResult.matched) {
      return new Response(apiResult.response.body, apiResult.response);
    }

    await next();
  });

  return { app };
}
