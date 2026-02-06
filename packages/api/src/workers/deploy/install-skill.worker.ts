import type { ProviderFactory } from "@vps-claude/providers";
import type { Redis } from "@vps-claude/redis";

import { createWideEvent, type Logger } from "@vps-claude/logger";
import {
  type InstallSkillJobData,
  type DeployJobResult,
  DEPLOY_QUEUES,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { BoxService } from "../../services/box.service";
import type { DeployStepService } from "../../services/deploy-step.service";

interface InstallSkillWorkerDeps {
  boxService: BoxService;
  deployStepService: DeployStepService;
  providerFactory: ProviderFactory;
  redis: Redis;
  logger: Logger;
}

export function createInstallSkillWorker({
  deps,
}: {
  deps: InstallSkillWorkerDeps;
}) {
  const { boxService, deployStepService, providerFactory, redis, logger } =
    deps;

  const worker = new Worker<InstallSkillJobData, DeployJobResult>(
    DEPLOY_QUEUES.installSkill,
    async (job: Job<InstallSkillJobData>): Promise<DeployJobResult> => {
      const { boxId, deploymentAttempt, instanceName, skillId, source } =
        job.data;

      const stepKey = `SKILL_${skillId}`;

      const event = createWideEvent(logger, {
        worker: "INSTALL_SKILL",
        jobId: job.id,
        boxId,
        instanceName,
        skillId,
        attempt: deploymentAttempt,
      });

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

        // source is pre-resolved by orchestrator from skills.sh API
        if (!source) {
          await deployStepService.updateStepStatus(
            boxId,
            deploymentAttempt,
            stepKey,
            "skipped",
            { parentId }
          );
          event.set({ status: "skipped", reason: "no_top_source" });
          return { success: true };
        }

        // Get box to determine provider type
        const boxResult = await boxService.getById(boxId);
        if (boxResult.isErr() || !boxResult.value) {
          throw new Error("Box not found");
        }

        // Install skill via CLI
        // source is the GitHub repo path, e.g. "remotion-dev/skills"
        // --yes --global skips interactive prompts, echo "" | handles any remaining prompts
        const skillsRepoUrl = `https://github.com/${source}`;
        const cmd = `cd /home/sprite && echo "" | /.sprite/bin/npx --yes skills add ${skillsRepoUrl} --skill ${skillId} --yes --global`;
        const provider = providerFactory.getProviderForBox(boxResult.value);
        const result = await provider.execShell(instanceName, cmd);

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

        event.set({
          source,
          exitCode: result.exitCode,
          status: "installed",
        });

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

        event.error(error instanceof Error ? error : new Error(String(error)));

        // Don't throw - skill failures shouldn't fail entire deployment
        // Return success with error noted
        return { success: false, error: errorMsg };
      } finally {
        event.emit();
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
