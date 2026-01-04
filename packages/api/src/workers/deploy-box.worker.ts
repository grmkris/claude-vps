import type { CoolifyClient } from "@vps-claude/coolify";
import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";

import {
  type DeployBoxJobData,
  type DeleteBoxJobData,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { BoxService } from "../services/box.service";

interface WorkerDeps {
  boxService: BoxService;
  coolifyClient: CoolifyClient;
  redis: Redis;
  logger: Logger;
}

export function createDeployWorker({ deps }: { deps: WorkerDeps }) {
  const { boxService, coolifyClient, redis, logger } = deps;

  const worker = new Worker<DeployBoxJobData>(
    WORKER_CONFIG.deployBox.name,
    async (job: Job<DeployBoxJobData>) => {
      const { boxId, subdomain, password } = job.data;

      try {
        // Create application (PASSWORD env is set automatically inside createApplication)
        const app = (
          await coolifyClient.createApplication({
            subdomain,
            password,
            claudeMdContent: "",
          })
        ).match(
          (v) => v,
          (e) => {
            throw new Error(`${e.type}: ${e.message}`);
          }
        );
        await boxService.setCoolifyUuid(boxId, app.uuid);

        // Deploy and get deployment UUID
        const { deploymentUuid } = (
          await coolifyClient.deployApplication(app.uuid)
        ).match(
          (v) => v,
          (e) => {
            throw new Error(`${e.type}: ${e.message}`);
          }
        );

        // Wait for Docker build to complete
        const deployResult = await coolifyClient.waitForDeployment(
          deploymentUuid,
          {
            pollIntervalMs: WORKER_CONFIG.deployBox.pollInterval,
            timeoutMs: WORKER_CONFIG.deployBox.timeout,
          }
        );

        if (deployResult.isErr()) {
          await boxService.updateStatus(
            boxId,
            "error",
            deployResult.error.message
          );
          return { success: false, error: deployResult.error.message };
        }

        if (deployResult.value.status === "failed") {
          await boxService.updateStatus(
            boxId,
            "error",
            "Deployment build failed"
          );
          return { success: false, error: "build_failed" };
        }

        // Wait for container to be healthy
        const healthResult = await coolifyClient.waitForHealthy(app.uuid, {
          pollIntervalMs: WORKER_CONFIG.deployBox.pollInterval,
          timeoutMs: 120000, // 2 min for container to start
        });

        if (healthResult.isErr()) {
          await boxService.updateStatus(
            boxId,
            "error",
            healthResult.error.message
          );
          return { success: false, error: healthResult.error.message };
        }

        await boxService.updateStatus(boxId, "running");
        return { success: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        await boxService.updateStatus(boxId, "error", message);
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
      msg: "Deploy job failed",
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}

export function createDeleteWorker({ deps }: { deps: WorkerDeps }) {
  const { coolifyClient, redis, logger } = deps;

  const worker = new Worker<DeleteBoxJobData>(
    WORKER_CONFIG.deleteBox.name,
    async (job: Job<DeleteBoxJobData>) => {
      const { coolifyApplicationUuid } = job.data;

      try {
        (await coolifyClient.deleteApplication(coolifyApplicationUuid)).match(
          (v) => v,
          (e) => {
            throw new Error(`${e.type}: ${e.message}`);
          }
        );
        return { success: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error({
          msg: "Failed to delete application",
          uuid: coolifyApplicationUuid,
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
