import type { Redis } from "@vps-claude/redis";

import { createWideEvent, type Logger } from "@vps-claude/logger";
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
      const { boxId, deploymentAttempt, instanceName, instanceUrl } = job.data;
      const event = createWideEvent(logger, {
        worker: "FINALIZE",
        jobId: job.id,
        boxId,
        attempt: deploymentAttempt,
      });

      try {
        // Mark box as running - deployment complete!
        await boxService.updateStatus(boxId, "running");

        event.set({ instanceName, instanceUrl, status: "running" });
        return { success: true, instanceName, instanceUrl };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";

        // Mark box as error since finalization failed
        await boxService.updateStatus(boxId, "error", errorMsg);

        event.error(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        event.emit();
      }
    },
    {
      connection: redis,
      concurrency: WORKER_CONFIG.finalize.concurrency,
      lockDuration: WORKER_CONFIG.finalize.timeout,
    }
  );

  worker.on("failed", async (job, err) => {
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
