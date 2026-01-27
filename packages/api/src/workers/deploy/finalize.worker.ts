import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";

import {
  type FinalizeJobData,
  type DeployJobResult,
  DEPLOY_QUEUES,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { BoxService } from "../../services/box.service";

interface FinalizeWorkerDeps {
  boxService: BoxService;
  redis: Redis;
  logger: Logger;
}

/**
 * Finalize worker - marks box as running after all deploy steps complete
 *
 * This is the ROOT of the flow DAG, so it runs LAST after all children complete:
 * - All setup steps completed
 * - Health check passed
 * - Public access enabled
 * - Skills installed (if any)
 */
export function createFinalizeWorker({ deps }: { deps: FinalizeWorkerDeps }) {
  const { boxService, redis, logger } = deps;

  const worker = new Worker<FinalizeJobData, DeployJobResult>(
    DEPLOY_QUEUES.finalize,
    async (job: Job<FinalizeJobData>): Promise<DeployJobResult> => {
      const { boxId, deploymentAttempt, spriteName, spriteUrl } = job.data;

      logger.info(
        { boxId, spriteName, spriteUrl, attempt: deploymentAttempt },
        "FINALIZE: Marking box as running"
      );

      try {
        // Mark box as running - deployment complete!
        await boxService.updateStatus(boxId, "running");

        logger.info(
          { boxId, spriteName },
          "FINALIZE: Box deployment completed successfully"
        );

        return { success: true, spriteName, spriteUrl };
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";

        logger.error(
          { boxId, error: errorMsg },
          "FINALIZE: Failed to mark box as running"
        );

        // Mark box as error since finalization failed
        await boxService.updateStatus(boxId, "error", errorMsg);

        throw error;
      }
    },
    {
      connection: redis,
      concurrency: WORKER_CONFIG.finalize.concurrency,
      lockDuration: WORKER_CONFIG.finalize.timeout,
    }
  );

  worker.on("failed", async (job, err) => {
    logger.error({
      msg: "FINALIZE job failed",
      jobId: job?.id,
      boxId: job?.data.boxId,
      error: err.message,
    });

    // Ensure box is marked as error on permanent failure
    if (job?.data.boxId) {
      try {
        await boxService.updateStatus(job.data.boxId, "error", err.message);
      } catch {
        // Ignore - best effort
      }
    }
  });

  return worker;
}
