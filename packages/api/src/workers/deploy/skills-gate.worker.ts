import type { Redis } from "@vps-claude/redis";

import { createWideEvent, type Logger } from "@vps-claude/logger";
import {
  type SkillsGateJobData,
  type DeployJobResult,
  DEPLOY_QUEUES,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { DeployStepService } from "../../services/deploy-step.service";

interface SkillsGateWorkerDeps {
  deployStepService: DeployStepService;
  redis: Redis;
  logger: Logger;
}

/**
 * Skills gate worker - aggregates results from parallel skill installations
 *
 * This worker runs AFTER all skill installation jobs complete (they are its children).
 * It marks the INSTALL_SKILLS parent step as completed and reports any failures.
 *
 * Uses failParentOnFailure: false on skill jobs, so partial failures
 * don't block the deployment - skills are non-critical.
 */
export function createSkillsGateWorker({
  deps,
}: {
  deps: SkillsGateWorkerDeps;
}) {
  const { deployStepService, redis, logger } = deps;

  const worker = new Worker<SkillsGateJobData, DeployJobResult>(
    DEPLOY_QUEUES.skillsGate,
    async (job: Job<SkillsGateJobData>): Promise<DeployJobResult> => {
      const { boxId, deploymentAttempt } = job.data;

      const event = createWideEvent(logger, {
        worker: "SKILLS_GATE",
        jobId: job.id,
        boxId,
        attempt: deploymentAttempt,
      });

      try {
        // Get child job results (skill installations)
        const childResults = await job.getChildrenValues<DeployJobResult>();

        // Count successes and failures
        const results = Object.entries(childResults);
        const failures = results.filter(([, r]) => r && !r.success);
        const successes = results.filter(([, r]) => r && r.success);

        // Mark INSTALL_SKILLS step as completed (even with partial failures)
        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "INSTALL_SKILLS",
          "completed",
          {
            metadata: {
              totalSkills: results.length,
              succeeded: successes.length,
              failed: failures.length,
            },
          }
        );

        event.set({
          totalSkills: results.length,
          succeeded: successes.length,
          failed: failures.length,
          status: failures.length > 0 ? "partial" : "passed",
        });
        event.emit();

        return {
          success: true,
          error:
            failures.length > 0
              ? `${failures.length} skill(s) failed to install`
              : undefined,
        };
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";

        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "INSTALL_SKILLS",
          "failed",
          { errorMessage: errorMsg }
        );

        event.error(error instanceof Error ? error : new Error(String(error)));
        event.emit();

        throw error;
      }
    },
    {
      connection: redis,
      concurrency: WORKER_CONFIG.skillsGate.concurrency,
      lockDuration: WORKER_CONFIG.skillsGate.timeout,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({
      msg: "SKILLS_GATE job failed",
      jobId: job?.id,
      boxId: job?.data.boxId,
      error: err.message,
    });
  });

  return worker;
}
