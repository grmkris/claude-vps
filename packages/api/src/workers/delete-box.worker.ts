import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";
import type { SpritesClient } from "@vps-claude/sprites";

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

      try {
        const boxResult = await boxService.getById(boxId);
        if (boxResult.isErr()) {
          throw new Error(boxResult.error.message);
        }
        const box = boxResult.value;
        if (!box?.spriteName) {
          logger.warn(
            { boxId },
            "Box has no sprite name, skipping sprite deletion"
          );
          return { success: true };
        }

        logger.info({ boxId, spriteName: box.spriteName }, "Deleting Sprite");
        await spritesClient.deleteSprite(box.spriteName);

        logger.info({ boxId }, "Sprite deleted successfully");
        return { success: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error({
          msg: "Failed to delete sprite",
          boxId,
          error: message,
        });
        throw error;
      }
    },
    {
      connection: redis,
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
