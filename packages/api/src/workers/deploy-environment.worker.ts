import {
  createApplication,
  deployApplication,
  getApplication,
  updateApplicationEnv,
  deleteApplication,
} from "@vps-claude/coolify";
import type { Logger } from "@vps-claude/logger";
import { getRedis } from "@vps-claude/redis";
import {
  type DeployEnvironmentJobData,
  type DeleteEnvironmentJobData,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { EnvironmentService } from "../services/environment.service";

interface WorkerDeps {
  environmentService: EnvironmentService;
  logger: Logger;
}

export function createDeployWorker({ deps }: { deps: WorkerDeps }) {
  const { environmentService, logger } = deps;

  const worker = new Worker<DeployEnvironmentJobData>(
    WORKER_CONFIG.deployEnvironment.name,
    async (job: Job<DeployEnvironmentJobData>) => {
      const { environmentId, subdomain, password } = job.data;

      try {
        const app = await createApplication({ subdomain, password });
        await environmentService.setCoolifyUuid(environmentId, app.uuid);

        await updateApplicationEnv(app.uuid, {
          CLAUDE_PASSWORD: password,
        });

        await deployApplication(app.uuid);

        let attempts = 0;
        const maxAttempts = WORKER_CONFIG.deployEnvironment.maxAttempts;
        const pollInterval = WORKER_CONFIG.deployEnvironment.pollInterval;

        while (attempts < maxAttempts) {
          await sleep(pollInterval);
          attempts++;

          const status = await getApplication(app.uuid);

          if (status.status === "running") {
            await environmentService.updateStatus(environmentId, "running");
            return { success: true };
          }

          if (status.status === "error" || status.status === "exited") {
            await environmentService.updateStatus(
              environmentId,
              "error",
              `Deployment failed: ${status.status}`,
            );
            return { success: false, error: status.status };
          }
        }

        await environmentService.updateStatus(environmentId, "error", "Deployment timed out");
        return { success: false, error: "timeout" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        await environmentService.updateStatus(environmentId, "error", message);
        throw error;
      }
    },
    {
      connection: getRedis(),
      concurrency: 5,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ msg: "Deploy job failed", jobId: job?.id, error: err.message });
  });

  return worker;
}

export function createDeleteWorker({ deps }: { deps: WorkerDeps }) {
  const { logger } = deps;

  const worker = new Worker<DeleteEnvironmentJobData>(
    WORKER_CONFIG.deleteEnvironment.name,
    async (job: Job<DeleteEnvironmentJobData>) => {
      const { coolifyApplicationUuid } = job.data;

      try {
        await deleteApplication(coolifyApplicationUuid);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
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
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ msg: "Delete job failed", jobId: job?.id, error: err.message });
  });

  return worker;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
