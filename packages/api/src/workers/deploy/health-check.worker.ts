import type { Redis } from "@vps-claude/redis";
import type { SpritesClient } from "@vps-claude/sprites";

import { createWideEvent, type Logger } from "@vps-claude/logger";
import {
  type HealthCheckJobData,
  type DeployJobResult,
  DEPLOY_QUEUES,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { BoxService } from "../../services/box.service";
import type { DeployStepService } from "../../services/deploy-step.service";

interface HealthCheckWorkerDeps {
  boxService: BoxService;
  deployStepService: DeployStepService;
  spritesClient: SpritesClient;
  redis: Redis;
  logger: Logger;
}

export function createHealthCheckWorker({
  deps,
}: {
  deps: HealthCheckWorkerDeps;
}) {
  const { boxService, deployStepService, spritesClient, redis, logger } = deps;

  const worker = new Worker<HealthCheckJobData, DeployJobResult>(
    DEPLOY_QUEUES.healthCheck,
    async (job: Job<HealthCheckJobData>): Promise<DeployJobResult> => {
      const { boxId, deploymentAttempt, spriteName, spriteUrl } = job.data;

      const event = createWideEvent(logger, {
        worker: "HEALTH_CHECK",
        jobId: job.id,
        boxId,
        spriteName,
        attempt: deploymentAttempt,
      });

      try {
        // Update step status to running
        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "HEALTH_CHECK",
          "running"
        );

        // Check health via sprites client
        const healthy = await spritesClient.checkHealth(spriteName, spriteUrl);

        if (!healthy) {
          throw new Error(
            "Services unhealthy: box-agent or agent-app not responding"
          );
        }

        // Mark step as completed
        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "HEALTH_CHECK",
          "completed"
        );

        event.set({ status: "healthy" });
        event.emit();

        return { success: true };
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";

        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "HEALTH_CHECK",
          "failed",
          { errorMessage: errorMsg }
        );

        event.error(error instanceof Error ? error : new Error(String(error)), {
          status: "unhealthy",
          attemptsMade: job.attemptsMade,
        });
        event.emit();

        throw error;
      }
    },
    {
      connection: redis,
      concurrency: WORKER_CONFIG.healthCheck.concurrency,
      lockDuration: WORKER_CONFIG.healthCheck.timeout,
    }
  );

  worker.on("failed", async (job, err) => {
    logger.error({
      msg: "HEALTH_CHECK job failed",
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
          `Health check failed: ${err.message}`
        );
      } catch {
        // Ignore - best effort
      }
    }
  });

  return worker;
}
