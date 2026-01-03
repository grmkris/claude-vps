import { createApi } from "@vps-claude/api/create-api";
import { createBoxService } from "@vps-claude/api/services/box.service";
import {
  createDeployWorker,
  createDeleteWorker,
} from "@vps-claude/api/workers/deploy-box.worker";
import { createAuth } from "@vps-claude/auth";
import { createCoolifyClient } from "@vps-claude/coolify";
import { createDb } from "@vps-claude/db";
import { createEmailClient } from "@vps-claude/email";
import { createLogger } from "@vps-claude/logger";
import { createQueueClient } from "@vps-claude/queue";
import { createRedisClient } from "@vps-claude/redis";

import { env } from "./env";

const logger = createLogger({ appName: "vps-claude-server" });

const db = createDb({
  type: "node-postgres",
  connectionString: env.DATABASE_URL,
});

const redis = createRedisClient({ url: env.REDIS_URL });

const queueClient = createQueueClient({ redis });

const emailClient = createEmailClient({
  apiKey: env.INBOUND_EMAIL_API_KEY,
  logger,
});

const coolifyClient = createCoolifyClient({
  env: env.APP_ENV,
  apiToken: env.COOLIFY_API_TOKEN,
  projectUuid: env.COOLIFY_PROJECT_UUID,
  serverUuid: env.COOLIFY_SERVER_UUID,
  environmentName: env.COOLIFY_ENVIRONMENT_NAME,
  environmentUuid: env.COOLIFY_ENVIRONMENT_UUID,
  agentsDomain: env.AGENTS_DOMAIN,
});

const auth = createAuth({
  db,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.CORS_ORIGIN],
  emailClient,
  appEnv: env.APP_ENV,
});

const boxService = createBoxService({ deps: { db, queueClient } });

const services = {
  boxService,
};

const deployWorker = createDeployWorker({
  deps: { boxService, coolifyClient, redis, logger },
});
const deleteWorker = createDeleteWorker({
  deps: { boxService, coolifyClient, redis, logger },
});

const { app } = createApi({
  db,
  logger,
  services,
  auth,
  corsOrigin: env.CORS_ORIGIN,
  agentsDomain: env.AGENTS_DOMAIN,
});

logger.info({ msg: "Server started", port: 33000 });

const shutdown = async (signal: string) => {
  logger.info({ msg: `${signal} received, shutting down` });

  await deployWorker.close();
  await deleteWorker.close();
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
