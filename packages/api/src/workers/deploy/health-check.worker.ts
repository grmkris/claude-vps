import type { ProviderFactory } from "@vps-claude/providers";
import type { Redis } from "@vps-claude/redis";

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
  providerFactory: ProviderFactory;
  redis: Redis;
  logger: Logger;
}

export function createHealthCheckWorker({
  deps,
}: {
  deps: HealthCheckWorkerDeps;
}) {
  const { boxService, deployStepService, providerFactory, redis, logger } =
    deps;

  const worker = new Worker<HealthCheckJobData, DeployJobResult>(
    DEPLOY_QUEUES.healthCheck,
    async (job: Job<HealthCheckJobData>): Promise<DeployJobResult> => {
      const { boxId, deploymentAttempt, instanceName, instanceUrl } = job.data;

      const event = createWideEvent(logger, {
        worker: "HEALTH_CHECK",
        jobId: job.id,
        boxId,
        instanceName,
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

        // Get box to determine provider type
        const boxResult = await boxService.getById(boxId);
        if (boxResult.isErr() || !boxResult.value) {
          throw new Error("Box not found");
        }

        // Check health via provider abstraction
        const provider = providerFactory.getProviderForBox(boxResult.value);
        const healthy = await provider.checkHealth(instanceName, instanceUrl);

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
        throw error;
      } finally {
        event.emit();
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
