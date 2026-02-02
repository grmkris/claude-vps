import type { ProviderFactory } from "@vps-claude/providers";
import type { Redis } from "@vps-claude/redis";

import { createWideEvent, type Logger } from "@vps-claude/logger";
import {
  type SetupStepJobData,
  type DeployJobResult,
  DEPLOY_QUEUES,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { BoxService } from "../../services/box.service";
import type { DeployStepService } from "../../services/deploy-step.service";

// Last setup step - when this completes, mark SETUP_SERVICES as completed
const LAST_SETUP_STEP = "SETUP_AGENT_APP_SERVICE" as const;

interface SetupStepWorkerDeps {
  boxService: BoxService;
  deployStepService: DeployStepService;
  providerFactory: ProviderFactory;
  redis: Redis;
  logger: Logger;
}

export function createSetupStepWorker({ deps }: { deps: SetupStepWorkerDeps }) {
  const { boxService, deployStepService, providerFactory, redis, logger } =
    deps;

  const worker = new Worker<SetupStepJobData, DeployJobResult>(
    DEPLOY_QUEUES.setupStep,
    async (job: Job<SetupStepJobData>): Promise<DeployJobResult> => {
      const {
        boxId,
        deploymentAttempt,
        instanceName,
        instanceUrl,
        stepKey,
        envVars,
        boxAgentBinaryUrl,
      } = job.data;

      const event = createWideEvent(logger, {
        worker: "SETUP_STEP",
        jobId: job.id,
        boxId,
        instanceName,
        stepKey,
        attempt: deploymentAttempt,
      });

      // Get parent step ID for tracking substeps
      const parentResult = await deployStepService.getStepByKey(
        boxId,
        deploymentAttempt,
        "SETUP_SERVICES"
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

        // Get box to determine provider type
        const boxResult = await boxService.getById(boxId);
        if (boxResult.isErr() || !boxResult.value) {
          throw new Error("Box not found");
        }

        // Run the setup step via provider abstraction
        const provider = providerFactory.getProviderForBox(boxResult.value);
        const result = await provider.runSetupStep({
          instanceName: instanceName, // instanceName is instanceName in job data
          stepKey,
          boxAgentBinaryUrl,
          envVars,
          instanceUrl: instanceUrl, // instanceUrl is instanceUrl in job data
        });

        // Capture Tailscale IP if this is the Tailscale step
        if (stepKey === "SETUP_TAILSCALE" && result.stdout) {
          const match = result.stdout.match(
            /TAILSCALE_IP=(\d+\.\d+\.\d+\.\d+)/
          );
          if (match?.[1]) {
            await boxService.setTailscaleIp(boxId, match[1]);
            event.set({ tailscaleIp: match[1] });
          }
        }

        // Mark step as completed
        await deployStepService.updateStepStatus(
          boxId,
          deploymentAttempt,
          stepKey,
          "completed",
          { parentId }
        );

        // If this is the last setup step, mark SETUP_SERVICES as completed
        if (stepKey === LAST_SETUP_STEP) {
          await deployStepService.updateStepStatus(
            boxId,
            deploymentAttempt,
            "SETUP_SERVICES",
            "completed"
          );
          event.set({ isLastStep: true });
        }

        event.set({ status: "completed" });

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
        throw error;
      } finally {
        event.emit();
      }
    },
    {
      connection: redis,
      concurrency: WORKER_CONFIG.setupStep.concurrency,
      lockDuration: WORKER_CONFIG.setupStep.timeout,
    }
  );

  worker.on("failed", async (job, err) => {
    logger.error({
      msg: "SETUP_STEP job failed",
      jobId: job?.id,
      boxId: job?.data.boxId,
      stepKey: job?.data.stepKey,
      error: err.message,
      attemptsMade: job?.attemptsMade,
    });

    // On permanent failure, mark box as error
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 1)) {
      try {
        await boxService.updateStatus(
          job.data.boxId,
          "error",
          `Setup step ${job.data.stepKey} failed: ${err.message}`
        );
      } catch {
        // Ignore - best effort
      }
    }
  });

  return worker;
}
