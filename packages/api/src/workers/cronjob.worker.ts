import type { Redis } from "@vps-claude/redis";

import { createWideEvent, type Logger } from "@vps-claude/logger";
import {
  type Job,
  type TriggerCronjobJobData,
  Worker,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { AgentInboxService } from "../services/agent-inbox.service";
import type { CronjobService } from "../services/cronjob.service";
import type { EmailService } from "../services/email.service";

interface CronjobWorkerDeps {
  cronjobService: CronjobService;
  emailService: EmailService;
  agentInboxService: AgentInboxService;
  redis: Redis;
  logger: Logger;
}

export function createCronjobWorker({ deps }: { deps: CronjobWorkerDeps }) {
  const { cronjobService, emailService, agentInboxService, redis, logger } =
    deps;

  const worker = new Worker<TriggerCronjobJobData>(
    WORKER_CONFIG.triggerCronjob.name,
    async (job: Job<TriggerCronjobJobData>) => {
      const { cronjobId, boxId } = job.data;
      const event = createWideEvent(logger, {
        worker: "CRONJOB_TRIGGER",
        jobId: job.id,
        cronjobId,
        boxId,
      });

      // Create execution record
      const executionResult = await cronjobService.createExecution(cronjobId);
      if (executionResult.isErr()) {
        event.error(new Error(executionResult.error.message));
        throw new Error(executionResult.error.message);
      }
      const execution = executionResult.value;
      event.set({ executionId: execution.id });
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
          await cronjobService.updateExecution(execution.id, {
            status: "completed",
            completedAt: new Date(),
            durationMs: Date.now() - startTime,
            result: "Skipped: cronjob disabled",
          });
          event.set({ status: "skipped", reason: "disabled" });
          return { success: true, skipped: true };
        }

        // Create unified inbox record for the cron trigger
        const inboxResult = await agentInboxService.create({
          boxId,
          type: "cron",
          content: cronjob.prompt,
          sourceType: "system",
          metadata: {
            cronJobId: cronjob.id,
            cronSchedule: cronjob.schedule,
          },
        });
        if (inboxResult.isOk()) {
          event.set({ inboxId: inboxResult.value.id });
        }

        // Get box info
        const boxResult = await cronjobService.getBoxForCronjob(cronjobId);
        if (boxResult.isErr()) {
          throw new Error(boxResult.error.message);
        }
        const { instanceUrl } = boxResult.value;

        if (!instanceUrl) {
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
        try {
          const healthResponse = await fetch(`${instanceUrl}/box/health`, {
            method: "GET",
            signal: AbortSignal.timeout(
              WORKER_CONFIG.triggerCronjob.wakeTimeout
            ),
          });
          if (!healthResponse.ok) {
            event.set({ healthCheckStatus: healthResponse.status });
          }
        } catch {
          event.set({ healthCheckFailed: true });
        }

        // Update status to running
        await cronjobService.updateExecution(execution.id, {
          status: "running",
        });

        // Trigger the cronjob via box-agent (path-based routing: /box/rpc/...)
        const triggerUrl = `${instanceUrl}/box/rpc/cron/trigger`;
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

        event.set({ status: "completed" });
        return { success: true };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";

        await cronjobService.updateExecution(execution.id, {
          status: "failed",
          completedAt: new Date(),
          durationMs,
          errorMessage,
        });

        event.error(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        event.emit();
      }
    },
    {
      connection: redis,
      concurrency: WORKER_CONFIG.triggerCronjob.concurrency,
    }
  );

  return worker;
}
