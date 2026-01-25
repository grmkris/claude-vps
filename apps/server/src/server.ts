import type { ServerWebSocket } from "bun";

import { createApi } from "@vps-claude/api/create-api";
import {
  createWebSocketTerminalHandler,
  type TerminalConnectionData,
} from "@vps-claude/api/handlers/websocket-terminal.handler";
import { createApiKeyService } from "@vps-claude/api/services/api-key.service";
import { createBoxService } from "@vps-claude/api/services/box.service";
import { createEmailService } from "@vps-claude/api/services/email.service";
import { createSecretService } from "@vps-claude/api/services/secret.service";
import {
  createDeployWorker,
  createDeleteWorker,
} from "@vps-claude/api/workers/deploy-box.worker";
import {
  createEmailDeliveryWorker,
  createEmailSendWorker,
} from "@vps-claude/api/workers/email-delivery.worker";
import { createAuth } from "@vps-claude/auth";
import { createDb, runMigrations } from "@vps-claude/db";
import { createEmailClient } from "@vps-claude/email";
import { createLogger } from "@vps-claude/logger";
import { createQueueClient } from "@vps-claude/queue";
import { createRedisClient } from "@vps-claude/redis";
import { SERVICE_URLS } from "@vps-claude/shared/services.schema";
import { createSpritesClient } from "@vps-claude/sprites";

import { env, BOX_AGENT_BINARY_URL } from "./env";

const logger = createLogger({ appName: "vps-claude-server" });

const db = createDb({
  type: "bun-sql",
  connectionString: env.DATABASE_URL,
});
await runMigrations(db, logger);

const redis = createRedisClient({ url: env.REDIS_URL });

const queueClient = createQueueClient({ redis });

const emailClient = createEmailClient({
  apiKey: env.INBOUND_EMAIL_API_KEY,
  logger,
});

const spritesClient = createSpritesClient({
  token: env.SPRITES_TOKEN,
  logger,
});

const trustedOrigins = [
  SERVICE_URLS[env.APP_ENV].web,
  ...(env.APP_ENV === "dev" || env.APP_ENV === "local"
    ? [SERVICE_URLS[env.APP_ENV].api]
    : []),
];

const auth = createAuth({
  db,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: SERVICE_URLS[env.APP_ENV].auth,
  trustedOrigins,
  emailClient,
  appEnv: env.APP_ENV,
});

const apiKeyService = createApiKeyService({ deps: { auth } });
const boxService = createBoxService({
  deps: { db, queueClient, spritesClient },
});
const emailService = createEmailService({ deps: { db, queueClient } });
const secretService = createSecretService({ deps: { db } });

const services = {
  apiKeyService,
  boxService,
  emailService,
  secretService,
  spritesClient,
};

const deployWorker = createDeployWorker({
  deps: {
    boxService,
    emailService,
    secretService,
    spritesClient,
    redis,
    logger,
    serverUrl: SERVICE_URLS[env.APP_ENV].api,
    boxAgentBinaryUrl: BOX_AGENT_BINARY_URL,
  },
});
const deleteWorker = createDeleteWorker({
  deps: { boxService, spritesClient, redis, logger },
});

const emailDeliveryWorker = createEmailDeliveryWorker({
  deps: {
    emailService,
    redis,
    logger,
  },
});
const emailSendWorker = createEmailSendWorker({
  deps: {
    emailService,
    sendEmail: async (params) => {
      await emailClient.sendRawEmail({
        to: params.to,
        subject: params.subject,
        text: params.body,
        replyTo: params.inReplyTo?.from,
      });
    },
    redis,
    logger,
  },
});

const { app } = createApi({
  db,
  logger,
  services,
  auth,
  corsOrigin: SERVICE_URLS[env.APP_ENV].web,
  agentsDomain: SERVICE_URLS[env.APP_ENV].agentsDomain,
  inboundWebhookSecret: env.INBOUND_WEBHOOK_SECRET,
});

// WebSocket terminal handler
const wsTerminalHandler = createWebSocketTerminalHandler({
  boxService,
  spritesClient,
  auth,
  logger,
});

logger.info({ msg: "Server started", port: 33000 });

const shutdown = async (signal: string) => {
  logger.info({ msg: `${signal} received, shutting down` });

  await deployWorker.close();
  await deleteWorker.close();
  await emailDeliveryWorker.close();
  await emailSendWorker.close();
  await queueClient.close();
  await redis.quit();

  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// WebSocket terminal route pattern: /ws/box/:id/terminal
const WS_TERMINAL_PATTERN = /^\/ws\/box\/([^/]+)\/terminal/;

export default {
  port: 33000,
  async fetch(
    req: Request,
    server: {
      upgrade: (
        req: Request,
        opts: { data: TerminalConnectionData }
      ) => boolean;
    }
  ) {
    const url = new URL(req.url);
    const match = WS_TERMINAL_PATTERN.exec(url.pathname);

    // Handle WebSocket terminal upgrade
    if (match && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const boxId = match[1];
      if (!boxId) {
        return new Response(JSON.stringify({ error: "Invalid box ID" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const data = await wsTerminalHandler.validateUpgrade(req, boxId);
      if (!data) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Attempt WebSocket upgrade
      if (server.upgrade(req, { data })) {
        // Upgrade successful, return undefined to signal Bun to complete it
        return undefined;
      }

      return new Response(
        JSON.stringify({ error: "WebSocket upgrade failed" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Delegate to Hono for all other requests
    return app.fetch(req);
  },
  websocket: wsTerminalHandler.handlers as {
    open: (ws: ServerWebSocket<TerminalConnectionData>) => void;
    message: (
      ws: ServerWebSocket<TerminalConnectionData>,
      message: string | Buffer
    ) => void;
    close: (
      ws: ServerWebSocket<TerminalConnectionData>,
      code: number,
      reason: string
    ) => void;
  },
};
