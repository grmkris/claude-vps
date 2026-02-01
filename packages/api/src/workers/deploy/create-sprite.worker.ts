import type { Redis } from "@vps-claude/redis";
import type { SpritesClient } from "@vps-claude/sprites";

import { createWideEvent, type Logger } from "@vps-claude/logger";
import {
  type CreateSpriteJobData,
  type DeployJobResult,
  DEPLOY_QUEUES,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { BoxService } from "../../services/box.service";
import type { DeployStepService } from "../../services/deploy-step.service";

interface CreateSpriteWorkerDeps {
  boxService: BoxService;
  deployStepService: DeployStepService;
  spritesClient: SpritesClient;
  redis: Redis;
  logger: Logger;
}

export function createCreateSpriteWorker({
  deps,
}: {
  deps: CreateSpriteWorkerDeps;
}) {
  const { boxService, deployStepService, spritesClient, redis, logger } = deps;

  const worker = new Worker<CreateSpriteJobData, DeployJobResult>(
    DEPLOY_QUEUES.createSprite,
    async (job: Job<CreateSpriteJobData>): Promise<DeployJobResult> => {
      const { boxId, userId, subdomain, deploymentAttempt } = job.data;

      const event = createWideEvent(logger, {
        worker: "CREATE_SPRITE",
        jobId: job.id,
        boxId,
        subdomain,
        attempt: deploymentAttempt,
      });

      try {
        // Update step status to running
        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "CREATE_SPRITE",
          "running"
        );

        // Create the sprite via Sprites API
        const sprite = await spritesClient.createSprite({
          name: subdomain,
          userId,
          subdomain,
          envVars: {}, // Env vars set during setup steps
        });

        // Store sprite info in DB
        await boxService.setSpriteInfo(boxId, sprite.spriteName, sprite.url);

        // Mark step as completed
        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "CREATE_SPRITE",
          "completed"
        );

        event.set({
          spriteName: sprite.spriteName,
          spriteUrl: sprite.url,
          status: "created",
        });

        return {
          success: true,
          spriteName: sprite.spriteName,
          spriteUrl: sprite.url,
        };
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";

        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "CREATE_SPRITE",
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
      concurrency: WORKER_CONFIG.createSprite.concurrency,
      lockDuration: WORKER_CONFIG.createSprite.timeout,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({
      msg: "CREATE_SPRITE job failed",
      jobId: job?.id,
      boxId: job?.data.boxId,
      error: err.message,
      attemptsMade: job?.attemptsMade,
    });
  });

  return worker;
}
