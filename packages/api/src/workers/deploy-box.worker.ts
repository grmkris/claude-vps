import type { Logger } from "@vps-claude/logger";

import {
  createApplication,
  deployApplication,
  getApplication,
  updateApplicationEnv,
  deleteApplication,
} from "@vps-claude/coolify";
import {
  type DeployBoxJobData,
  type DeleteBoxJobData,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { getRedis } from "@vps-claude/redis";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { BoxService } from "../services/box.service";

interface WorkerDeps {
  boxService: BoxService;
  logger: Logger;
}

export function createDeployWorker({ deps }: { deps: WorkerDeps }) {
  const { boxService, logger } = deps;

  const worker = new Worker<DeployBoxJobData>(
    WORKER_CONFIG.deployBox.name,
    async (job: Job<DeployBoxJobData>) => {
      const { boxId, subdomain, password } = job.data;

      try {
        const app = await createApplication({ subdomain, password });
        await boxService.setCoolifyUuid(boxId, app.uuid);

        await updateApplicationEnv(app.uuid, {
          CLAUDE_PASSWORD: password,
        });

        await deployApplication(app.uuid);

        let attempts = 0;
        const maxAttempts = WORKER_CONFIG.deployBox.maxAttempts;
        const pollInterval = WORKER_CONFIG.deployBox.pollInterval;

        while (attempts < maxAttempts) {
          await sleep(pollInterval);
          attempts++;

          const status = await getApplication(app.uuid);

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
      connection: getRedis(),
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
  const { logger } = deps;

  const worker = new Worker<DeleteBoxJobData>(
    WORKER_CONFIG.deleteBox.name,
    async (job: Job<DeleteBoxJobData>) => {
      const { coolifyApplicationUuid } = job.data;

      try {
        await deleteApplication(coolifyApplicationUuid);
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
      connection: getRedis(),
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
