import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";
import type { SpritesClient } from "@vps-claude/sprites";

import {
  type EnableAccessJobData,
  type DeployJobResult,
  DEPLOY_QUEUES,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { BoxService } from "../../services/box.service";
import type { DeployStepService } from "../../services/deploy-step.service";

interface EnableAccessWorkerDeps {
  boxService: BoxService;
  deployStepService: DeployStepService;
  spritesClient: SpritesClient;
  redis: Redis;
  logger: Logger;
}

export function createEnableAccessWorker({
  deps,
}: {
  deps: EnableAccessWorkerDeps;
}) {
  const { boxService, deployStepService, spritesClient, redis, logger } = deps;

  const worker = new Worker<EnableAccessJobData, DeployJobResult>(
    DEPLOY_QUEUES.enableAccess,
    async (job: Job<EnableAccessJobData>): Promise<DeployJobResult> => {
      const { boxId, deploymentAttempt, spriteName } = job.data;

      logger.info(
        { boxId, spriteName, attempt: deploymentAttempt },
        "ENABLE_PUBLIC_ACCESS: Starting"
      );

      try {
        // Update step status to running
        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "ENABLE_PUBLIC_ACCESS",
          "running"
        );

        // Set URL auth to public
        await spritesClient.setUrlAuth(spriteName, "public");

        // Mark step as completed
        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "ENABLE_PUBLIC_ACCESS",
          "completed"
        );

        logger.info(
          { boxId, spriteName },
          "ENABLE_PUBLIC_ACCESS: Completed"
        );

        return { success: true };
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";

        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "ENABLE_PUBLIC_ACCESS",
          "failed",
          { errorMessage: errorMsg }
        );

        logger.error(
          { boxId, error: errorMsg },
          "ENABLE_PUBLIC_ACCESS: Failed"
        );

        throw error;
      }
    },
    {
      connection: redis,
      concurrency: WORKER_CONFIG.enableAccess.concurrency,
      lockDuration: WORKER_CONFIG.enableAccess.timeout,
    }
  );

  worker.on("failed", async (job, err) => {
    logger.error({
      msg: "ENABLE_PUBLIC_ACCESS job failed",
      jobId: job?.id,
      boxId: job?.data.boxId,
      error: err.message,
      attemptsMade: job?.attemptsMade,
    });

    // On permanent failure, mark box as error
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 1)) {
      try {
        await boxService.updateStatus(
          job.data.boxId,
          "error",
          `Enable access failed: ${err.message}`
        );
      } catch {
        // Ignore - best effort
      }
    }
  });

  return worker;
}
