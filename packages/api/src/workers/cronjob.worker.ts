import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";

import {
  type Job,
  type TriggerCronjobJobData,
  Worker,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { CronjobService } from "../services/cronjob.service";
import type { EmailService } from "../services/email.service";

interface CronjobWorkerDeps {
  cronjobService: CronjobService;
  emailService: EmailService;
  redis: Redis;
  logger: Logger;
}

export function createCronjobWorker({ deps }: { deps: CronjobWorkerDeps }) {
  const { cronjobService, emailService, redis, logger } = deps;

  const worker = new Worker<TriggerCronjobJobData>(
    WORKER_CONFIG.triggerCronjob.name,
    async (job: Job<TriggerCronjobJobData>) => {
      const { cronjobId, boxId } = job.data;

      logger.info({ cronjobId, boxId }, "Processing cronjob trigger");

      // Create execution record
      const executionResult = await cronjobService.createExecution(cronjobId);
      if (executionResult.isErr()) {
        logger.error(
          { cronjobId, error: executionResult.error.message },
          "Failed to create execution record"
        );
        throw new Error(executionResult.error.message);
      }
      const execution = executionResult.value;
      const startTime = Date.now();

      try {
        // Get cronjob details
        const cronjobResult = await cronjobService.getById(cronjobId);
        if (cronjobResult.isErr() || !cronjobResult.value) {
          throw new Error("Cronjob not found");
        }
        const cronjob = cronjobResult.value;

        // Skip if disabled
        if (!cronjob.enabled) {
          logger.info({ cronjobId }, "Cronjob disabled, skipping");
          await cronjobService.updateExecution(execution.id, {
            status: "completed",
            completedAt: new Date(),
            durationMs: Date.now() - startTime,
            result: "Skipped: cronjob disabled",
          });
          return { success: true, skipped: true };
        }

        // Get box info
        const boxResult = await cronjobService.getBoxForCronjob(cronjobId);
        if (boxResult.isErr()) {
          throw new Error(boxResult.error.message);
        }
        const { spriteUrl } = boxResult.value;

        if (!spriteUrl) {
          throw new Error("Box not running (no sprite URL)");
        }

        // Get agent secret for auth
        const settingsResult = await emailService.getOrCreateSettings(boxId);
        if (settingsResult.isErr()) {
          throw new Error("Failed to get box settings");
        }
        const agentSecret = settingsResult.value.agentSecret;

        // Update status to waking_box
        await cronjobService.updateExecution(execution.id, {
          status: "waking_box",
        });

        // Check if sprite is awake, wake it if needed
        logger.info({ cronjobId, spriteUrl }, "Waking sprite if needed");
        try {
          const healthResponse = await fetch(`${spriteUrl}/health`, {
            method: "GET",
            signal: AbortSignal.timeout(
              WORKER_CONFIG.triggerCronjob.wakeTimeout
            ),
          });
          if (!healthResponse.ok) {
            logger.warn(
              { cronjobId, status: healthResponse.status },
              "Health check returned non-OK status"
            );
          }
        } catch (error) {
          logger.warn(
            { cronjobId, error },
            "Failed to wake sprite, will try trigger anyway"
          );
        }

        // Update status to running
        await cronjobService.updateExecution(execution.id, {
          status: "running",
        });

        // Trigger the cronjob via box-agent
        const triggerUrl = `${spriteUrl}/rpc/cron/trigger`;
        logger.info({ cronjobId, triggerUrl }, "Triggering cronjob");

        const response = await fetch(triggerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Box-Secret": agentSecret,
          },
          body: JSON.stringify({
            cronjobId: cronjob.id,
            cronjobName: cronjob.name,
            prompt: cronjob.prompt,
          }),
          signal: AbortSignal.timeout(WORKER_CONFIG.triggerCronjob.timeout),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Cron trigger failed: ${response.status} - ${text}`);
        }

        const result = await response.json();
        const durationMs = Date.now() - startTime;

        // Update execution as completed
        await cronjobService.updateExecution(execution.id, {
          status: "completed",
          completedAt: new Date(),
          durationMs,
          result: JSON.stringify(result),
        });

        // Update lastRunAt
        await cronjobService.updateLastRunAt(cronjobId);

        logger.info(
          { cronjobId, executionId: execution.id, durationMs },
          "Cronjob completed"
        );

        return { success: true };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        logger.error({ cronjobId, error: errorMessage }, "Cronjob failed");

        await cronjobService.updateExecution(execution.id, {
          status: "failed",
          completedAt: new Date(),
          durationMs,
          errorMessage,
        });

        throw error;
      }
    },
    {
      connection: redis,
      concurrency: WORKER_CONFIG.triggerCronjob.concurrency,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({
      msg: "Cronjob trigger job failed",
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
