import { createApi } from "@vps-claude/api/create-api";
import { createAiService } from "@vps-claude/api/services/ai.service";
import { createApiKeyService } from "@vps-claude/api/services/api-key.service";
import { createBoxEnvVarService } from "@vps-claude/api/services/box-env-var.service";
import { createBoxService } from "@vps-claude/api/services/box.service";
import { createCredentialService } from "@vps-claude/api/services/credential.service";
import { createCronjobService } from "@vps-claude/api/services/cronjob.service";
import { createDeployStepService } from "@vps-claude/api/services/deploy-step.service";
import { createEmailService } from "@vps-claude/api/services/email.service";
import {
  createOrchestratorWorker,
  createSetupStepWorker,
  createHealthCheckWorker,
  createInstallSkillWorker,
  createEnableAccessWorker,
  createFinalizeWorker,
  createSkillsGateWorker,
} from "@vps-claude/api/workers";
import { createCronjobWorker } from "@vps-claude/api/workers/cronjob.worker";
import { createDeleteWorker } from "@vps-claude/api/workers/delete-box.worker";
import {
  createEmailDeliveryWorker,
  createEmailSendWorker,
} from "@vps-claude/api/workers/email-delivery.worker";
import { createAuth } from "@vps-claude/auth";
import { createDb, runMigrations } from "@vps-claude/db";
import {
  createEmailClient,
  markdownToPlainText,
  renderAgentEmail,
} from "@vps-claude/email";
import { createLogger } from "@vps-claude/logger";
import { createProviderFactory } from "@vps-claude/providers";
import { createQueueClient } from "@vps-claude/queue";
import { createRedisClient } from "@vps-claude/redis";
import { SERVICE_URLS } from "@vps-claude/shared/services.schema";
import { createSpritesClient } from "@vps-claude/sprites";

import { env, BOX_AGENT_BINARY_URL } from "./env";

const logger = createLogger({
  appName: "vps-claude-server",
  level: env.LOG_LEVEL,
  environment: env.APP_ENV,
});

logger.debug({ msg: "Connecting to database..." });
const db = createDb({
  type: "bun-sql",
  connectionString: env.DATABASE_URL,
});
await runMigrations(db, logger);
logger.debug({ msg: "Database connected" });

logger.debug({ msg: "Connecting to Redis..." });
const redis = createRedisClient({ url: env.REDIS_URL });
logger.debug({ msg: "Redis connected" });

const queueClient = createQueueClient({ redis });
logger.debug({ msg: "Queue client initialized" });

const emailClient = createEmailClient({
  apiKey: env.INBOUND_EMAIL_API_KEY,
  logger,
});

const spritesClient = createSpritesClient({
  token: env.SPRITES_TOKEN,
  logger,
});

const providerFactory = createProviderFactory({
  spritesClient,
  dockerOptions: {
    baseDomain: "localhost",
    socketPath: "/var/run/docker.sock",
    useTls: false,
  },
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
const boxEnvVarService = createBoxEnvVarService({
  deps: { db, spritesClient },
});
const boxService = createBoxService({
  deps: { db, queueClient, spritesClient, boxEnvVarService },
});
const cronjobService = createCronjobService({ deps: { db, queueClient } });
const deployStepService = createDeployStepService({ deps: { db } });
const emailService = createEmailService({
  deps: {
    db,
    queueClient,
    agentsDomain: SERVICE_URLS[env.APP_ENV].agentsDomain,
  },
});
const credentialService = createCredentialService({ deps: { db } });

const services = {
  aiService,
  apiKeyService,
  boxEnvVarService,
  boxService,
  credentialService,
  cronjobService,
  deployStepService,
  emailService,
  providerFactory,
  spritesClient,
};

// Modular deploy orchestrator worker
const { worker: orchestratorWorker, flowProducer } = createOrchestratorWorker({
  deps: {
    boxService,
    boxEnvVarService,
    deployStepService,
    emailService,
    providerFactory,
    redis,
    logger,
    serverUrl: env.SERVER_URL ?? SERVICE_URLS[env.APP_ENV].api,
    boxAgentBinaryUrl: BOX_AGENT_BINARY_URL,
  },
});

// Deploy flow workers (execute steps from FlowProducer DAG)
const setupStepWorker = createSetupStepWorker({
  deps: { boxService, deployStepService, providerFactory, redis, logger },
});

const healthCheckWorker = createHealthCheckWorker({
  deps: { boxService, deployStepService, providerFactory, redis, logger },
});

const installSkillWorker = createInstallSkillWorker({
  deps: { boxService, deployStepService, providerFactory, redis, logger },
});

const enableAccessWorker = createEnableAccessWorker({
  deps: { boxService, deployStepService, providerFactory, redis, logger },
});

const finalizeWorker = createFinalizeWorker({
  deps: { boxService, redis, logger },
});

const skillsGateWorker = createSkillsGateWorker({
  deps: { deployStepService, redis, logger },
});

const deleteWorker = createDeleteWorker({
  deps: { providerFactory, redis, logger },
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
      // Render markdown body to HTML
      const html = await renderAgentEmail(params.body);
      const text = markdownToPlainText(params.body);

      // Build threading headers for proper email threading
      const headers: Record<string, string> = {};
      if (params.inReplyTo?.messageId) {
        const msgId = params.inReplyTo.messageId;
        // Ensure message ID is wrapped in angle brackets per RFC 5322
        const formattedId = msgId.startsWith("<") ? msgId : `<${msgId}>`;
        headers["In-Reply-To"] = formattedId;
        headers["References"] = formattedId;
      }

      await emailClient.sendRawEmail({
        from: params.from,
        to: params.to,
        subject: params.subject,
        text,
        html,
        replyTo: params.inReplyTo?.from,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
    },
    redis,
    logger,
  },
});

const cronjobWorker = createCronjobWorker({
  deps: {
    cronjobService,
    emailService,
    redis,
    logger,
  },
});

// Sync cronjob repeatable jobs on startup
void cronjobService.syncAllRepeatableJobs().then((result) => {
  result.match(
    (count) => logger.info({ msg: "Cronjobs synced", count }),
    (error) =>
      logger.error({ msg: "Failed to sync cronjobs", error: error.message })
  );
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

logger.debug({
  msg: "Workers registered",
  workers: [
    "orchestrator",
    "setupStep",
    "healthCheck",
    "installSkill",
    "enableAccess",
    "finalize",
    "skillsGate",
    "delete",
    "emailDelivery",
    "emailSend",
    "cronjob",
  ],
});

logger.info({
  msg: "Server started",
  port: 33000,
  env: env.APP_ENV,
  logLevel: env.LOG_LEVEL,
  agentsDomain: SERVICE_URLS[env.APP_ENV].agentsDomain,
});

const shutdown = async (signal: string) => {
  logger.info({ msg: `${signal} received, shutting down` });

  // Deploy flow workers
  await orchestratorWorker.close();
  await flowProducer.close();
  await setupStepWorker.close();
  await healthCheckWorker.close();
  await installSkillWorker.close();
  await enableAccessWorker.close();
  await finalizeWorker.close();
  await skillsGateWorker.close();

  // Other workers
  await deleteWorker.close();
  await emailDeliveryWorker.close();
  await emailSendWorker.close();
  await cronjobWorker.close();

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
