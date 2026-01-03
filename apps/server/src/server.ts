import { createApi } from "@vps-claude/api/create-api";
import { createBoxService } from "@vps-claude/api/services/box.service";
import {
  createDeployWorker,
  createDeleteWorker,
} from "@vps-claude/api/workers/deploy-box.worker";
import { createAuth } from "@vps-claude/auth";
import { db } from "@vps-claude/db/client";
import { env } from "@vps-claude/env/server";
import { createLogger } from "@vps-claude/logger";
import { closeQueues } from "@vps-claude/queue";
import { closeRedis } from "@vps-claude/redis";

const logger = createLogger({ appName: "vps-claude-server" });

const auth = createAuth({
  db,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.CORS_ORIGIN],
});

const boxService = createBoxService({ deps: { db } });

const services = {
  boxService,
};

const deployWorker = createDeployWorker({ deps: { boxService, logger } });
const deleteWorker = createDeleteWorker({ deps: { boxService, logger } });

const { app } = createApi({
  db,
  logger,
  services,
  auth,
  corsOrigin: env.CORS_ORIGIN,
});

logger.info({ msg: "Server started", port: 33000 });

const shutdown = async (signal: string) => {
  logger.info({ msg: `${signal} received, shutting down` });

  await deployWorker.close();
  await deleteWorker.close();
  await closeQueues();
  await closeRedis();

  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default {
  port: 33000,
  fetch: app.fetch,
};
