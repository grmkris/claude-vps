import { createApi } from "@vps-claude/api/create-api";
import { createAiService } from "@vps-claude/api/services/ai.service";
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

const aiService = createAiService({
  deps: {
    db,
    env: {
      FAL_API_KEY: env.FAL_API_KEY,
      ELEVENLABS_API_KEY: env.ELEVENLABS_API_KEY,
      GOOGLE_CLOUD_API_KEY: env.GOOGLE_CLOUD_API_KEY,
      REPLICATE_API_TOKEN: env.REPLICATE_API_TOKEN,
    },
  },
});
const apiKeyService = createApiKeyService({ deps: { auth } });
const boxService = createBoxService({
  deps: { db, queueClient, spritesClient },
});
const emailService = createEmailService({ deps: { db, queueClient } });
const secretService = createSecretService({ deps: { db } });

const services = {
  aiService,
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

export default {
  port: 33000,
  fetch: app.fetch,
};
