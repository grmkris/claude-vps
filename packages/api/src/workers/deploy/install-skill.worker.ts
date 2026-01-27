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

        // topSource is pre-resolved by orchestrator from skills.sh API
        if (!topSource) {
          logger.warn(
            { skillId },
            "INSTALL_SKILL: No topSource provided, skipping"
          );
          await deployStepService.updateStepStatus(
            boxId,
            deploymentAttempt,
            stepKey,
            "skipped",
            { parentId }
          );
          return { success: true };
        }

        // Install skill via CLI
        // topSource is the GitHub repo path, e.g. "remotion-dev/skills"
        // --yes --global skips interactive prompts, echo "" | handles any remaining prompts
        const skillsRepoUrl = `https://github.com/${topSource}`;
        const cmd = `cd /home/sprite && echo "" | /.sprite/bin/npx --yes skills add ${skillsRepoUrl} --skill ${skillId} --yes --global`;
        logger.info(
          { skillId, topSource, cmd },
          "INSTALL_SKILL: Running install command"
        );
        const result = await spritesClient.execShell(spriteName, cmd);
        logger.info(
          {
            skillId,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          "INSTALL_SKILL: Command result"
        );

        if (result.exitCode !== 0) {
          throw new Error(
            `skills add ${topSource} failed: exit ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
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
          { boxId, skillId, topSource },
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
