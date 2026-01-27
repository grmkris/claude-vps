import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";

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

      logger.info(
        { boxId, attempt: deploymentAttempt, jobId: job.id },
        "SKILLS_GATE: Starting - checking skill installation results"
      );

      try {
        // Get child job results (skill installations)
        logger.info({ boxId }, "SKILLS_GATE: Getting children values...");
        const childResults = await job.getChildrenValues<DeployJobResult>();
        logger.info(
          { boxId, childCount: Object.keys(childResults).length, childResults },
          "SKILLS_GATE: Got children values"
        );

        // Count successes and failures
        const results = Object.entries(childResults);
        const failures = results.filter(([, r]) => r && !r.success);
        const successes = results.filter(([, r]) => r && r.success);

        if (failures.length > 0) {
          const failedSkills = failures
            .map(([key, r]) => {
              // Extract skill ID from job key (format: "skill-{skillId}-{boxId}")
              const match = key.match(/skill-([^-]+)-/);
              return match ? `${match[1]}: ${r?.error}` : r?.error;
            })
            .join(", ");

          logger.warn(
            {
              boxId,
              totalSkills: results.length,
              succeeded: successes.length,
              failed: failures.length,
              failedSkills,
            },
            "SKILLS_GATE: Some skills failed to install"
          );
        } else {
          logger.info(
            { boxId, totalSkills: results.length },
            "SKILLS_GATE: All skills installed successfully"
          );
        }

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

        logger.error(
          { boxId, error: errorMsg },
          "SKILLS_GATE: Failed to process skill results"
        );

        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          "INSTALL_SKILLS",
          "failed",
          { errorMessage: errorMsg }
        );

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
