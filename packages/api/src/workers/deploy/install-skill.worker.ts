import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";
import type { SpritesClient } from "@vps-claude/sprites";

import {
  type InstallSkillJobData,
  type DeployJobResult,
  DEPLOY_QUEUES,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { DeployStepService } from "../../services/deploy-step.service";

interface InstallSkillWorkerDeps {
  deployStepService: DeployStepService;
  spritesClient: SpritesClient;
  redis: Redis;
  logger: Logger;
}

/**
 * Fetch skill metadata from skills.sh API
 */
async function fetchSkillMetadata(
  skillId: string
): Promise<{ topSource: string } | null> {
  try {
    const res = await fetch(
      `https://skills.sh/api/skills?search=${encodeURIComponent(skillId)}&limit=1`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      skills: Array<{ id: string; topSource: string }>;
    };
    const skill = data.skills.find((s) => s.id === skillId);
    return skill ? { topSource: skill.topSource } : null;
  } catch {
    return null;
  }
}

export function createInstallSkillWorker({
  deps,
}: {
  deps: InstallSkillWorkerDeps;
}) {
  const { deployStepService, spritesClient, redis, logger } = deps;

  const worker = new Worker<InstallSkillJobData, DeployJobResult>(
    DEPLOY_QUEUES.installSkill,
    async (job: Job<InstallSkillJobData>): Promise<DeployJobResult> => {
      const { boxId, deploymentAttempt, spriteName, skillId, topSource } =
        job.data;

      const stepKey = `SKILL_${skillId}`;

      logger.info(
        { boxId, spriteName, skillId, attempt: deploymentAttempt },
        `INSTALL_SKILL: Starting ${skillId}`
      );

      // Get parent step ID for tracking
      const parentResult = await deployStepService.getStepByKey(
        boxId,
        deploymentAttempt,
        "INSTALL_SKILLS"
      );
      const parentId = parentResult.isOk() ? parentResult.value?.id : undefined;

      try {
        // Update step status to running
        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          stepKey,
          "running",
          { parentId }
        );

        // Get topSource if not provided
        let source = topSource;
        if (!source) {
          const metadata = await fetchSkillMetadata(skillId);
          if (!metadata) {
            logger.warn({ skillId }, "Could not find skill metadata, skipping");
            await deployStepService.updateStepStatus(
              boxId,
              deploymentAttempt,
              stepKey,
              "skipped",
              { parentId }
            );
            return { success: true };
          }
          source = metadata.topSource;
        }

        // Install skill via CLI
        const result = await spritesClient.execShell(
          spriteName,
          `cd /home/sprite && /.sprite/bin/npx --yes skills add https://github.com/${source} --skill ${skillId}`
        );

        if (result.exitCode !== 0) {
          throw new Error(
            `skills add ${source} failed: exit ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
          );
        }

        // Mark step as completed
        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          stepKey,
          "completed",
          { parentId }
        );

        logger.info(
          { boxId, skillId, topSource: source },
          `INSTALL_SKILL: Completed ${skillId}`
        );

        return { success: true };
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";

        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          stepKey,
          "failed",
          { errorMessage: errorMsg, parentId }
        );

        logger.error(
          { boxId, skillId, error: errorMsg },
          `INSTALL_SKILL: Failed ${skillId}`
        );

        // Don't throw - skill failures shouldn't fail entire deployment
        // Return success with error noted
        return { success: false, error: errorMsg };
      }
    },
    {
      connection: redis,
      concurrency: WORKER_CONFIG.installSkill.concurrency,
      lockDuration: WORKER_CONFIG.installSkill.timeout,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({
      msg: "INSTALL_SKILL job failed",
      jobId: job?.id,
      boxId: job?.data.boxId,
      skillId: job?.data.skillId,
      error: err.message,
      attemptsMade: job?.attemptsMade,
    });
  });

  return worker;
}
