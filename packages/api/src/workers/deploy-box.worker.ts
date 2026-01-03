import type { CoolifyClient } from "@vps-claude/coolify";
import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";

import {
  type DeployBoxJobData,
  type DeleteBoxJobData,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { BoxService } from "../services/box.service";

interface WorkerDeps {
  boxService: BoxService;
  coolifyClient: CoolifyClient;
  redis: Redis;
  logger: Logger;
}

export function createDeployWorker({ deps }: { deps: WorkerDeps }) {
  const { boxService, coolifyClient, redis, logger } = deps;

  const worker = new Worker<DeployBoxJobData>(
    WORKER_CONFIG.deployBox.name,
    async (job: Job<DeployBoxJobData>) => {
      const { boxId, subdomain, password } = job.data;

      try {
        const app = await coolifyClient.createApplication({
          subdomain,
          password,
          claudeMdContent: "",
        });
        await boxService.setCoolifyUuid(boxId, app.uuid);

        await coolifyClient.updateApplicationEnv(app.uuid, {
          CLAUDE_PASSWORD: password,
        });

        await coolifyClient.deployApplication(app.uuid);

        let attempts = 0;
        const maxAttempts = WORKER_CONFIG.deployBox.maxAttempts;
        const pollInterval = WORKER_CONFIG.deployBox.pollInterval;

        while (attempts < maxAttempts) {
          await sleep(pollInterval);
          attempts++;

          const status = await coolifyClient.getApplication(app.uuid);

          if (status.status === "running") {
            await boxService.updateStatus(boxId, "running");
            return { success: true };
          }

          if (status.status === "error" || status.status === "exited") {
            await boxService.updateStatus(
              boxId,
              "error",
              `Deployment failed: ${status.status}`
            );
            return { success: false, error: status.status };
          }
        }

        await boxService.updateStatus(boxId, "error", "Deployment timed out");
        return { success: false, error: "timeout" };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        await boxService.updateStatus(boxId, "error", message);
        throw error;
      }
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({
      msg: "Deploy job failed",
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}

export function createDeleteWorker({ deps }: { deps: WorkerDeps }) {
  const { coolifyClient, redis, logger } = deps;

  const worker = new Worker<DeleteBoxJobData>(
    WORKER_CONFIG.deleteBox.name,
    async (job: Job<DeleteBoxJobData>) => {
      const { coolifyApplicationUuid } = job.data;

      try {
        await coolifyClient.deleteApplication(coolifyApplicationUuid);
        return { success: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error({
          msg: "Failed to delete application",
          uuid: coolifyApplicationUuid,
          error: message,
        });
        throw error;
      }
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({
      msg: "Delete job failed",
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
