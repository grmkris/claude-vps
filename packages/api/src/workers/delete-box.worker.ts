import type { ProviderFactory } from "@vps-claude/providers";
import type { Redis } from "@vps-claude/redis";

import { createWideEvent, type Logger } from "@vps-claude/logger";
import { type DeleteBoxJobData, Worker, type Job } from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

interface DeleteWorkerDeps {
  providerFactory: ProviderFactory;
  redis: Redis;
  logger: Logger;
}

export function createDeleteWorker({ deps }: { deps: DeleteWorkerDeps }) {
  const { providerFactory, redis, logger } = deps;

  const worker = new Worker<DeleteBoxJobData>(
    WORKER_CONFIG.deleteBox.name,
    async (job: Job<DeleteBoxJobData>) => {
      const { boxId, instanceName, provider } = job.data;
      const event = createWideEvent(logger, {
        worker: "DELETE_BOX",
        jobId: job.id,
        boxId,
        instanceName,
        provider,
      });

      try {
        const providerInstance = providerFactory.getProvider(provider);
        await providerInstance.deleteInstance(instanceName);

        event.set({ status: "deleted" });
        return { success: true };
      } catch (err) {
        event.error(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        event.emit();
      }
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  return worker;
}
