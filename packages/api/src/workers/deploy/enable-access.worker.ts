import type { ProviderFactory } from "@vps-claude/providers";
import type { Redis } from "@vps-claude/redis";

import { createWideEvent, type Logger } from "@vps-claude/logger";
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
  providerFactory: ProviderFactory;
  redis: Redis;
  logger: Logger;
}

export function createEnableAccessWorker({
  deps,
}: {
  deps: EnableAccessWorkerDeps;
}) {
  const { boxService, deployStepService, providerFactory, redis, logger } =
    deps;

  const worker = new Worker<EnableAccessJobData, DeployJobResult>(
    DEPLOY_QUEUES.enableAccess,
    async (job: Job<EnableAccessJobData>): Promise<DeployJobResult> => {
      const { boxId, deploymentAttempt, instanceName } = job.data;

      const event = createWideEvent(logger, {
        worker: "ENABLE_ACCESS",
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
          "ENABLE_PUBLIC_ACCESS",
          "running"
        );

        // Get box to determine provider type
        const boxResult = await boxService.getById(boxId);
        if (boxResult.isErr() || !boxResult.value) {
          throw new Error("Box not found");
        }

        // Set URL auth to public via provider (if supported)
        const provider = providerFactory.getProviderForBox(boxResult.value);
        if (provider.setUrlAuth) {
          await provider.setUrlAuth(instanceName, "public");
        }

        // Mark step as completed
        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "ENABLE_PUBLIC_ACCESS",
          "completed"
        );

        event.set({ status: "public" });

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

        event.error(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        event.emit();
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
