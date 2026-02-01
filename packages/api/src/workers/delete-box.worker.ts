import type { Redis } from "@vps-claude/redis";
import type { SpritesClient } from "@vps-claude/sprites";

import { createWideEvent, type Logger } from "@vps-claude/logger";
import { type DeleteBoxJobData, Worker, type Job } from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { BoxService } from "../services/box.service";

interface DeleteWorkerDeps {
  boxService: BoxService;
  spritesClient: SpritesClient;
  redis: Redis;
  logger: Logger;
}

export function createDeleteWorker({ deps }: { deps: DeleteWorkerDeps }) {
  const { boxService, spritesClient, redis, logger } = deps;

  const worker = new Worker<DeleteBoxJobData>(
    WORKER_CONFIG.deleteBox.name,
    async (job: Job<DeleteBoxJobData>) => {
      const { boxId } = job.data;
      const event = createWideEvent(logger, {
        worker: "DELETE_BOX",
        jobId: job.id,
        boxId,
      });

      try {
        const boxResult = await boxService.getById(boxId);
        if (boxResult.isErr()) {
          throw new Error(boxResult.error.message);
        }
        const box = boxResult.value;
        if (!box?.spriteName) {
          event.set({ status: "skipped", reason: "no_sprite_name" });
          return { success: true };
        }

        event.set({ spriteName: box.spriteName });
        await spritesClient.deleteSprite(box.spriteName);

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
